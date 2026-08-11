import { corsHeaders, HttpError, json, googleAccessToken, requireApprovedUser, requiredGoogleFolderId, safeFileName } from "../_shared/index.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST \uc694\uccad\ub9cc \uac00\ub2a5\ud569\ub2c8\ub2e4.");
    await requireApprovedUser(req);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "\ud30c\uc77c\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.");
    if (file.size === 0) throw new HttpError(400, "\ube48 \ud30c\uc77c\uc740 \uc5c5\ub85c\ub4dc\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.");
    if (file.size > 10 * 1024 * 1024) throw new HttpError(413, "\ud30c\uc77c\uc740 10MB \uc774\ud558\ub9cc \uc5c5\ub85c\ub4dc\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4. \uc601\uc0c1\uc740 YouTube \ub9c1\ud06c\ub97c \uc0ac\uc6a9\ud558\uc138\uc694.");
    const name = safeFileName(file.name);
    const metadata = new Blob([JSON.stringify({ name, parents: [requiredGoogleFolderId()], appProperties: { source: "bighub" } })], { type: "application/json" });
    const body = new FormData();
    body.append("metadata", metadata);
    body.append("file", file, name);
    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType", {
      method: "POST", headers: { Authorization: "Bearer " + await googleAccessToken() }, body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.id) {
      const detail = typeof payload?.error?.message === "string" ? payload.error.message : "Google Drive did not return file metadata.";
      console.error("Google Drive upload failed", response.status, detail);
      throw new HttpError(502, `Google Drive \ud30c\uc77c \uc5c5\ub85c\ub4dc\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4: ${detail}`);
    }
    return json({ id: payload.id, name: payload.name || name, mimeType: payload.mimeType || file.type || "application/octet-stream" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "\ud30c\uc77c \uc5c5\ub85c\ub4dc\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4." }, error instanceof HttpError ? error.status : 500);
  }
});