import { corsHeaders, HttpError, json } from "../_shared/index.ts";

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, "\uD658\uACBD \uBCC0\uC218 " + name + "\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
  return value;
}

function baseUrl() {
  return env("SUPABASE_URL").replace(/\/$/, "");
}

function defaultSecret(name: string, legacyName: string) {
  const raw = Deno.env.get(name);
  if (raw) {
    const value = JSON.parse(raw).default;
    if (value) return value;
  }
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  throw new HttpError(500, "\uD658\uACBD \uBCC0\uC218 " + name + ".default\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
}

function anonHeaders(token: string) {
  return { apikey: defaultSecret("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), Authorization: "Bearer " + token };
}

function bearerToken(req: Request) {
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");
  return token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST \uC694\uCCAD\uB9CC \uAC00\uB2A5\uD569\uB2C8\uB2E4.");
    const token = bearerToken(req);
    const { requestId } = await req.json().catch(() => ({}));
    const id = String(requestId || "");
    if (!id) throw new HttpError(400, "\uAC00\uC785 \uC2E0\uCCAD ID\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");

    const response = await fetch(baseUrl() + "/rest/v1/rpc/reject_signup_request", {
      method: "POST",
      headers: { ...anonHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ request_id_input: id }),
    });
    const responseText = await response.text().catch(() => "");
    const deleted = (() => { try { return JSON.parse(responseText || "false"); } catch { return false; } })();
    if (!response.ok) {
      const detail = responseText.slice(0, 300) || response.statusText || "empty response";
      console.error("reject-signup rpc failed", JSON.stringify({ status: response.status, detail }));
      throw new HttpError(response.status === 401 || response.status === 403 ? response.status : 500, "\uAC00\uC785 \uC2E0\uCCAD \uAC70\uC808\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. RPC " + response.status + ": " + detail);
    }
    if (!deleted) return json({ ok: true, deleted: 0, alreadyHandled: true });
    return json({ ok: true, deleted: 1 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "\uAC00\uC785 \uC2E0\uCCAD \uAC70\uC808\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4." }, error instanceof HttpError ? error.status : 500);
  }
});
