import { corsHeaders, HttpError, json, requireApprovedUser } from "../_shared/index.ts";
import { muxRequest } from "../_shared/mux.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST request only.");
    await requireApprovedUser(req);
    const body = await req.json().catch(() => ({}));
    const uploadId = String(body?.uploadId || "").trim();
    if (!uploadId) throw new HttpError(400, "Upload ID missing.");
    const upload = await muxRequest(`/uploads/${encodeURIComponent(uploadId)}`);
    if (!upload?.asset_id) return json({ state: "processing" });
    const asset = await muxRequest(`/assets/${encodeURIComponent(upload.asset_id)}`);
    const playbackId = asset?.playback_ids?.find((item: { policy?: string }) => item.policy === "signed")?.id || asset?.playback_ids?.[0]?.id || "";
    return json({ state: asset?.status || "processing", assetId: upload.asset_id, playbackId });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Mux status check failed." }, error instanceof HttpError ? error.status : 500);
  }
});
