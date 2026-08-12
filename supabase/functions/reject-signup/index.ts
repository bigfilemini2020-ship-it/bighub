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

function serviceHeaders() {
  const key = defaultSecret("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) headers.Authorization = "Bearer " + key;
  return headers;
}

function anonHeaders(token: string) {
  return { apikey: defaultSecret("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"), Authorization: "Bearer " + token };
}

async function currentAdmin(req: Request) {
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");

  const userResponse = await fetch(baseUrl() + "/auth/v1/user", { headers: anonHeaders(token) });
  if (!userResponse.ok) throw new HttpError(401, "\uB85C\uADF8\uC778 \uC815\uBCF4\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  const user = await userResponse.json();

  const profileResponse = await fetch(baseUrl() + "/rest/v1/profiles?id=eq." + encodeURIComponent(user.id) + "&select=role,status", { headers: anonHeaders(token) });
  const profiles = await profileResponse.json().catch(() => []);
  if (!profileResponse.ok || profiles[0]?.role !== "admin" || profiles[0]?.status !== "approved") {
    throw new HttpError(403, "\uAD00\uB9AC\uC790\uB9CC \uCC98\uB9AC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  }
  return user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST \uC694\uCCAD\uB9CC \uAC00\uB2A5\uD569\uB2C8\uB2E4.");
    await currentAdmin(req);
    const { requestId } = await req.json().catch(() => ({}));
    const id = String(requestId || "");
    if (!id) throw new HttpError(400, "\uAC00\uC785 \uC2E0\uCCAD ID\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");

    const response = await fetch(baseUrl() + "/rest/v1/signup_requests?id=eq." + encodeURIComponent(id) + "&status=eq.pending", {
      method: "DELETE",
      headers: { ...serviceHeaders(), Prefer: "return=representation" },
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new HttpError(500, "\uAC00\uC785 \uC2E0\uCCAD \uAC70\uC808\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(404, "\uB300\uAE30 \uC911\uC778 \uAC00\uC785 \uC2E0\uCCAD\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
    return json({ ok: true, deleted: rows.length });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "\uAC00\uC785 \uC2E0\uCCAD \uAC70\uC808\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4." }, error instanceof HttpError ? error.status : 500);
  }
});
