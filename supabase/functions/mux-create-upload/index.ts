import { corsHeaders, HttpError, json, requireApprovedUser } from "../_shared/index.ts";
import { muxRequest } from "../_shared/mux.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST request only.");
    await requireApprovedUser(req);
    const body = await req.json().catch(() => ({}));
    const corsOrigin = String(body?.corsOrigin || "").trim();
    if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(corsOrigin)) throw new HttpError(400, "Invalid upload origin.");
    const filename = String(body?.filename || "video").trim().slice(0, 180);
    const upload = await muxRequest("/uploads", {
      method: "POST",
      body: JSON.stringify({
        cors_origin: corsOrigin,
        new_asset_settings: { playback_policies: ["signed"], passthrough: filename },
      }),
    });
    if (!upload?.id || !upload?.url) throw new HttpError(502, "Mux upload URL was not returned.");
    return json({ uploadId: upload.id, uploadUrl: upload.url });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Mux upload setup failed." }, error instanceof HttpError ? error.status : 500);
  }
});
