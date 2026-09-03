const request = async (path, options = {}) => {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Google Docs request failed");
  return body;
};

export const getGoogleStatus = () => request("/api/google/status");
export const getGoogleDocs = () => request("/api/google/docs");
export const archiveWeekToGoogle = (documentId, weekly) =>
  request("/api/google/archive-week", {
    method: "POST",
    body: JSON.stringify({ documentId, weekly }),
  });
export const disconnectGoogle = () =>
  request("/api/google/disconnect", { method: "DELETE" });
