import { contentDisposition, corsHeaders, HttpError, json, googleAccessToken, requireApprovedUser, safeFileName } from "../_shared/index.ts";

function authToken(req: Request) {
  return String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

function baseUrl() {
  const value = Deno.env.get("SUPABASE_URL");
  if (!value) throw new HttpError(500, "\uD658\uACBD \uBCC0\uC218 SUPABASE_URL\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.");
  return value.replace(/\/$/, "");
}

function publishableKey() {
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    const value = JSON.parse(raw).default;
    if (value) return value;
  }
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  throw new HttpError(500, "\uD658\uACBD \uBCC0\uC218 SUPABASE_PUBLISHABLE_KEYS.default\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
}

function driveIdFromUrl(value: string) {
  const raw = String(value || "");
  try {
    const parsed = new URL(raw);
    const queryId = parsed.searchParams.get("id");
    if (queryId) return queryId;
    const fileMatch = /\/d\/([A-Za-z0-9_-]{10,})/.exec(parsed.pathname);
    if (fileMatch) return fileMatch[1];
  } catch {}
  const protocolMatch = /^bighub-drive:\/\/([A-Za-z0-9_-]{10,})/.exec(raw);
  if (protocolMatch) return protocolMatch[1];
  const idMatch = /(?:id=|\/d\/)([A-Za-z0-9_-]{10,})/.exec(raw);
  return idMatch ? idMatch[1] : "";
}

async function requirePostAttachment(req: Request, postId: string, fileId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(postId)) {
    throw new HttpError(400, "\uAC8C\uC2DC\uAE00 \uC815\uBCF4\uAC00 \uC5C6\uB294 \uCCA8\uBD80\uD30C\uC77C\uC785\uB2C8\uB2E4.");
  }
  const response = await fetch(
    baseUrl() + "/rest/v1/posts?id=eq." + encodeURIComponent(postId) + "&select=attachment_url,media_url",
    { headers: { Authorization: "Bearer " + authToken(req), apikey: publishableKey() } },
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new HttpError(500, "\uAC8C\uC2DC\uAE00 \uCCA8\uBD80 \uC815\uBCF4\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  const post = Array.isArray(rows) ? rows[0] : null;
  const ids = [post?.attachment_url, post?.media_url].map((value) => driveIdFromUrl(String(value || ""))).filter(Boolean);
  if (!ids.includes(fileId)) throw new HttpError(403, "\uC774 \uAC8C\uC2DC\uAE00\uC5D0 \uC5F0\uACB0\uB41C \uCCA8\uBD80\uD30C\uC77C\uB9CC \uB2E4\uC6B4\uB85C\uB4DC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "GET") throw new HttpError(405, "GET \uC694\uCCAD\uB9CC \uAC00\uB2A5\uD569\uB2C8\uB2E4.");
    await requireApprovedUser(req);
    const requestUrl = new URL(req.url);
    const id = String(requestUrl.searchParams.get("id") || "");
    const postId = String(requestUrl.searchParams.get("postId") || "");
    const name = safeFileName(requestUrl.searchParams.get("name") || "\uCCA8\uBD80\uD30C\uC77C");
    const inline = requestUrl.searchParams.get("inline") === "1";
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new HttpError(400, "\uC62C\uBC14\uB978 \uD30C\uC77C ID\uAC00 \uC544\uB2D9\uB2C8\uB2E4.");
    await requirePostAttachment(req, postId, id);
    const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media", { headers: { Authorization: "Bearer " + await googleAccessToken() } });
    if (!response.ok || !response.body) throw new HttpError(404, "Drive\uC5D0\uC11C \uD30C\uC77C\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    return new Response(response.body, { status: 200, headers: { ...corsHeaders, "Content-Type": response.headers.get("content-type") || "application/octet-stream", "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", name) } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "\uD30C\uC77C \uB2E4\uC6B4\uB85C\uB4DC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4." }, error instanceof HttpError ? error.status : 500);
  }
});
