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

type SignupRequest = {
  id: string;
  login_id: string;
  name: string;
  department: string;
  status: string;
  password_ciphertext: string | null;
  password_iv: string | null;
};

function bytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function aesKey() {
  const secret = new TextEncoder().encode(env("BIGHUB_SIGNUP_SECRET"));
  const digest = await crypto.subtle.digest("SHA-256", secret);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
}

async function decryptPassword(ciphertext: string, iv: string) {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv) }, await aesKey(), bytes(ciphertext)));
}

async function getRequest(id: string): Promise<SignupRequest> {
  const response = await fetch(baseUrl() + "/rest/v1/signup_requests?id=eq." + encodeURIComponent(id) + "&select=*", { headers: serviceHeaders() });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !rows[0]) throw new HttpError(404, "\uAC00\uC785 \uC2E0\uCCAD\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  return rows[0];
}

async function patchRequest(id: string, payload: Record<string, unknown>) {
  const response = await fetch(baseUrl() + "/rest/v1/signup_requests?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new HttpError(500, "\uAC00\uC785 \uC2E0\uCCAD \uC0C1\uD0DC \uBCC0\uACBD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
}

async function findAuthUserByEmail(email: string) {
  const response = await fetch(baseUrl() + "/auth/v1/admin/users?page=1&per_page=1000", { headers: serviceHeaders() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(500, "Auth \uC0AC\uC6A9\uC790 \uBAA9\uB85D\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  const users = Array.isArray(payload.users) ? payload.users : [];
  return users.find((user: { id?: string; email?: string }) => String(user.email || "").toLowerCase() === email.toLowerCase()) || null;
}

async function updateAuthUser(id: string, password: string, request: SignupRequest) {
  const response = await fetch(baseUrl() + "/auth/v1/admin/users/" + encodeURIComponent(id), {
    method: "PUT",
    headers: serviceHeaders(),
    body: JSON.stringify({ password, email_confirm: true, user_metadata: { login_id: request.login_id, name: request.name, department: request.department } }),
  });
  if (!response.ok) throw new HttpError(500, "기존 Auth 계정 정보를 갱신하지 못했습니다.");
}

async function createOrFindAuthUser(email: string, password: string, request: SignupRequest) {
  const body = { email, password, email_confirm: true, user_metadata: { login_id: request.login_id, name: request.name, department: request.department } };
  const userResponse = await fetch(baseUrl() + "/auth/v1/admin/users", {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(body),
  });
  const userPayload = await userResponse.json().catch(() => ({}));
  if (userResponse.ok && userPayload.id) return { user: userPayload, created: true };

  const detail = String(userPayload.msg || userPayload.error_description || userPayload.error || "");
  if (/already|registered|exists|duplicate/i.test(detail)) {
    const existing = await findAuthUserByEmail(email);
    if (existing?.id) {
      await updateAuthUser(existing.id, password, request);
      return { user: existing, created: false };
    }
  }

  throw new HttpError(500, detail || "Auth 계정 생성에 실패했습니다.");
}

async function deleteAuthUser(id: string) {
  const response = await fetch(baseUrl() + "/auth/v1/admin/users/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  if (!response.ok) console.warn("Auth rollback failed", await response.text().catch(() => ""));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST \uC694\uCCAD\uB9CC \uAC00\uB2A5\uD569\uB2C8\uB2E4.");
    const admin = await currentAdmin(req);
    const { requestId } = await req.json().catch(() => ({}));
    const request = await getRequest(String(requestId || ""));

    if (request.status !== "pending") throw new HttpError(409, "\uB300\uAE30 \uC911\uC778 \uAC00\uC785 \uC2E0\uCCAD\uB9CC \uC2B9\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
    if (!request.password_ciphertext || !request.password_iv) throw new HttpError(409, "\uAC00\uC785 \uC2E0\uCCAD \uBE44\uBC00\uBC88\uD638 \uC815\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2E0\uCCAD\uD574\uC57C \uD569\uB2C8\uB2E4.");

    const email = request.login_id + "@bighub.local";
    const password = await decryptPassword(request.password_ciphertext, request.password_iv);
    const { user: userPayload, created } = await createOrFindAuthUser(email, password, request);

    try {
      const response = await fetch(baseUrl() + "/rest/v1/rpc/approve_signup_request", {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({ request_id_input: request.id, user_id_input: userPayload.id, approved_by_input: admin.id }),
      });
      const approved = await response.json().catch(() => false);
      if (!response.ok || approved !== true) throw new HttpError(409, "이미 처리된 가입 신청입니다.");
    } catch (error) {
      if (created) await deleteAuthUser(userPayload.id);
      throw error;
    }
    return json({ ok: true, userId: userPayload.id });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "\uAC00\uC785 \uC2B9\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4." }, error instanceof HttpError ? error.status : 500);
  }
});
