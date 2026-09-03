import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();
const app = express();
const port = Number(process.env.PORT || 8787);
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const redirectUri =
  process.env.GOOGLE_REDIRECT_URI ||
  `http://localhost:${port}/api/google/callback`;
const appUrl = process.env.APP_URL || "http://localhost:5173";
const encryptionKey = crypto
  .createHash("sha256")
  .update(process.env.SESSION_SECRET || "change-me")
  .digest();
const tokenPath = path.resolve(
  process.env.TOKEN_STORE_PATH || ".data/google-tokens.json",
);
const sessions = new Map();

app.use(express.json({ limit: "100kb" }));
app.use((request, response, next) => {
  response.setHeader(
    "Access-Control-Allow-Origin",
    request.headers.origin || "http://localhost:5173",
  );
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});

async function readTokens() {
  try {
    return JSON.parse(await fs.readFile(tokenPath, "utf8"));
  } catch {
    return {};
  }
}
async function writeTokens(tokens) {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify(tokens), { mode: 0o600 });
}
function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: encrypted.toString("base64url"),
  };
}
function decrypt(value) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(value.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(value.data, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
function sessionId(request, response) {
  const match = request.headers.cookie?.match(/(?:^|; )daily_session=([^;]+)/);
  const id = match?.[1] || crypto.randomBytes(24).toString("base64url");
  if (!match)
    response.setHeader(
      "Set-Cookie",
      `daily_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
    );
  return id;
}
function oauthClient() {
  if (!clientId || !clientSecret)
    throw new Error("Google OAuth environment variables are not configured");
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
async function authorizedClient(request, response) {
  const id = sessionId(request, response);
  const stored = (await readTokens())[id];
  if (!stored) return { client: null, id };
  const client = oauthClient();
  client.setCredentials(decrypt(stored));
  client.on("tokens", async (tokens) => {
    const all = await readTokens();
    all[id] = encrypt({ ...decrypt(stored), ...tokens });
    await writeTokens(all);
  });
  return { client, id };
}
function requireTaskList(tasks) {
  if (
    !Array.isArray(tasks) ||
    tasks.length === 0 ||
    tasks.some((task) => !["completed", "skipped"].includes(task.status))
  )
    throw new Error(
      "Every weekly task must be completed or skipped before archiving",
    );
}
function weeklyText(weekly) {
  const days = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  return `\n\nWEEK OF ${weekly.week}\n${days
    .map(
      (day) =>
        `\n${day.toUpperCase()}\n${
          weekly.tasks
            .filter((task) => task.day === day)
            .map(
              (task) =>
                `[${task.status === "completed" ? "x" : "-"}] ${task.name} | ${task.goal || "Unassigned goal"}${task.estimatedMinutes ? ` | ${task.estimatedMinutes}m` : ""}`,
            )
            .join("\n") || "No tasks"
        }`,
    )
    .join("\n")}\n`;
}

app.get("/api/google/auth", (request, response) => {
  try {
    const id = sessionId(request, response);
    const state = crypto.randomBytes(24).toString("base64url");
    sessions.set(id, state);
    const url = oauthClient().generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/documents",
      ],
      state,
    });
    response.redirect(url);
  } catch (error) {
    response.status(500).send(error.message);
  }
});
app.get("/api/google/callback", async (request, response) => {
  try {
    const id = sessionId(request, response);
    if (!request.query.code || sessions.get(id) !== request.query.state)
      return response.status(400).send("Invalid OAuth state");
    const client = oauthClient();
    const { tokens } = await client.getToken(request.query.code);
    const all = await readTokens();
    all[id] = encrypt(tokens);
    await writeTokens(all);
    sessions.delete(id);
    response.redirect(`${appUrl}/?google=connected`);
  } catch (error) {
    response.status(500).send("Google connection failed");
  }
});
app.get("/api/google/status", async (request, response) => {
  try {
    const { client } = await authorizedClient(request, response);
    response.json({ connected: Boolean(client) });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});
app.get("/api/google/docs", async (request, response) => {
  try {
    const { client } = await authorizedClient(request, response);
    if (!client) return response.status(401).json({ error: "Not connected" });
    const drive = google.drive({ version: "v3", auth: client });
    const result = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.document' and trashed=false",
      fields: "files(id,name,modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 100,
    });
    response.json(result.data.files || []);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});
app.post("/api/google/archive-week", async (request, response) => {
  try {
    const { client } = await authorizedClient(request, response);
    if (!client) return response.status(401).json({ error: "Not connected" });
    const { documentId, weekly } = request.body;
    requireTaskList(weekly?.tasks);
    if (!documentId)
      return response
        .status(400)
        .json({ error: "A Google Doc must be selected" });
    const docs = google.docs({ version: "v1", auth: client });
    const document = await docs.documents.get({ documentId });
    const content = document.data.body.content || [];
    const last = content[content.length - 1];
    const index = Math.max(1, (last?.endIndex || 2) - 1);
    await docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          { insertText: { location: { index }, text: weeklyText(weekly) } },
        ],
      },
    });
    response.json({
      archived: true,
      documentId,
      archivedAt: new Date().toISOString(),
    });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
});
app.delete("/api/google/disconnect", async (request, response) => {
  const id = sessionId(request, response);
  const all = await readTokens();
  delete all[id];
  await writeTokens(all);
  response.json({ connected: false });
});
app.listen(port, () =>
  console.log(`Google archive server listening on http://localhost:${port}`),
);
