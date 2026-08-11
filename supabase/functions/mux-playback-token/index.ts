import { corsHeaders, HttpError, json, requireApprovedUser } from "../_shared/index.ts";
import { muxPlaybackToken } from "../_shared/mux.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST request only.");
    await requireApprovedUser(req);
    const body = await req.json().catch(() => ({}));
    const playbackId = String(body?.playbackId || "").trim();
    if (!/^[A-Za-z0-9]+$/.test(playbackId)) throw new HttpError(400, "Invalid playback ID.");
    return json({ token: await muxPlaybackToken(playbackId) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Mux playback token failed." }, error instanceof HttpError ? error.status : 500);
  }
});
