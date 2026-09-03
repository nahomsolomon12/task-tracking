# Daily Practice

A client-side weekly task planner with localStorage persistence and optional Google Docs archiving.

## Local development

1. In Google Cloud Console, create a project and enable **Google Docs API** and **Google Drive API**.
2. Configure the OAuth consent screen. During development, add your Google account as a test user.
3. Create a Web application OAuth client.
4. Add this authorized redirect URI:

   `http://localhost:8787/api/google/callback`

5. Copy `.env.example` to `.env` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a long random `SESSION_SECRET`.
6. Start the API server in one terminal:

   `npm run server`

7. Start Vite in another terminal:

   `npm run dev`

Open `http://localhost:5173`, then go to **Settings** to connect Google and choose an archive document.

## Google Docs behavior

The weekly Google export is available after every task is marked completed or skipped. It appends the week, weekdays, goal tags, task status, and estimated minutes to the selected Google Doc. Markdown and JSON downloads remain available as offline fallbacks.

The OAuth flow requests Google Drive read-only access to list existing Docs and Google Docs access to append the weekly record.

OAuth tokens are encrypted and stored in `.data/google-tokens.json`, which is ignored by Git. Client secrets and refresh tokens must never be committed or placed in frontend source code.

For production, set `APP_URL`, `GOOGLE_REDIRECT_URI`, and `TOKEN_STORE_PATH` to deployment-specific values and serve both the frontend and API over HTTPS.
