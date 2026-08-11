import { contentDisposition, corsHeaders, HttpError, json, googleAccessToken, requireApprovedUser, safeFileName } from "../_shared/index.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "GET") throw new HttpError(405, "GET \uc694\uccad\ub9cc \uac00\ub2a5\ud569\ub2c8\ub2e4.");
    await requireApprovedUser(req);
    const requestUrl = new URL(req.url);
    const id = String(requestUrl.searchParams.get("id") || "");
    const name = safeFileName(requestUrl.searchParams.get("name") || "\ucca8\ubd80\ud30c\uc77c");
    const inline = requestUrl.searchParams.get("inline") === "1";
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new HttpError(400, "\uc62c\ubc14\ub978 \ud30c\uc77c ID\uac00 \uc544\ub2d9\ub2c8\ub2e4.");
    const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media", { headers: { Authorization: "Bearer " + await googleAccessToken() } });
    if (!response.ok || !response.body) throw new HttpError(404, "Drive\uc5d0\uc11c \ud30c\uc77c\uc744 \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.");
    return new Response(response.body, { status: 200, headers: { ...corsHeaders, "Content-Type": response.headers.get("content-type") || "application/octet-stream", "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", name) } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "\ud30c\uc77c \ub2e4\uc6b4\ub85c\ub4dc\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4." }, error instanceof HttpError ? error.status : 500);
  }
});