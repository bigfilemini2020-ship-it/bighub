import { corsHeaders, HttpError, json } from "../_shared/index.ts";

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, "환경 변수 " + name + "가 없습니다.");
  return value;
}

function baseUrl() {
  return env("SUPABASE_URL").replace(/\/$/, "");
}

function serviceHeaders() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  return { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
}

function anonHeaders(token: string) {
  return { apikey: env("SUPABASE_ANON_KEY"), Authorization: "Bearer " + token };
}

async function currentAdmin(req: Request) {
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "로그인이 필요합니다.");

  const userResponse = await fetch(baseUrl() + "/auth/v1/user", { headers: anonHeaders(token) });
  if (!userResponse.ok) throw new HttpError(401, "로그인 정보를 확인할 수 없습니다.");
  const user = await userResponse.json();

  const profileResponse = await fetch(baseUrl() + "/rest/v1/profiles?id=eq." + encodeURIComponent(user.id) + "&select=role,status", { headers: anonHeaders(token) });
  const profiles = await profileResponse.json().catch(() => []);
  if (!profileResponse.ok || profiles[0]?.role !== "admin" || profiles[0]?.status !== "approved") {
    throw new HttpError(403, "관리자만 처리할 수 있습니다.");
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
  if (!response.ok || !rows[0]) throw new HttpError(404, "가입 신청을 찾을 수 없습니다.");
  return rows[0];
}

async function patchRequest(id: string, payload: Record<string, unknown>) {
  const response = await fetch(baseUrl() + "/rest/v1/signup_requests?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new HttpError(500, "가입 신청 상태 변경에 실패했습니다.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST 요청만 가능합니다.");
    const admin = await currentAdmin(req);
    const { requestId } = await req.json().catch(() => ({}));
    const request = await getRequest(String(requestId || ""));

    if (request.status !== "pending") throw new HttpError(409, "대기 중인 가입 신청만 승인할 수 있습니다.");
    if (!request.password_ciphertext || !request.password_iv) throw new HttpError(409, "가입 신청 비밀번호 정보가 없습니다. 다시 신청해야 합니다.");

    const email = request.login_id + "@bighub.local";
    const password = await decryptPassword(request.password_ciphertext, request.password_iv);
    const userResponse = await fetch(baseUrl() + "/auth/v1/admin/users", {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { login_id: request.login_id, name: request.name, department: request.department } }),
    });
    const userPayload = await userResponse.json().catch(() => ({}));
    if (!userResponse.ok || !userPayload.id) {
      throw new HttpError(500, userPayload.msg || userPayload.error_description || "Auth 계정 생성에 실패했습니다.");
    }

    const now = new Date().toISOString();
    const profile = {
      id: userPayload.id,
      login_id: request.login_id,
      auth_email: email,
      name: request.name,
      department: request.department,
      role: "member",
      status: "approved",
      avatar: String(request.name || "?").slice(0, 1),
      approved_at: now,
      approved_by: admin.id,
    };
    const profileResponse = await fetch(baseUrl() + "/rest/v1/profiles?on_conflict=id", {
      method: "POST",
      headers: { ...serviceHeaders(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(profile),
    });
    if (!profileResponse.ok) throw new HttpError(500, "프로필 생성에 실패했습니다.");

    await patchRequest(request.id, { status: "approved", password_ciphertext: null, password_iv: null, decided_at: now, decided_by: admin.id, user_id: userPayload.id });
    return json({ ok: true, userId: userPayload.id });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "가입 승인에 실패했습니다." }, error instanceof HttpError ? error.status : 500);
  }
});
