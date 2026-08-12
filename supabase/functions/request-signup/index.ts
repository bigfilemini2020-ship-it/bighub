import { corsHeaders, HttpError, json } from "../_shared/index.ts";

type ExistingProfile = { id: string; status: string };
type ExistingRequest = { id: string; status: string };

const DEPARTMENTS = new Set(["임원", "경영지원", "개발", "운영", "마케팅", "기타"]);

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

function validLoginId(value: unknown) {
  const loginId = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(loginId)) {
    throw new HttpError(400, "아이디는 영문 소문자, 숫자, 점, 밑줄, 하이픈으로 3~32자 입력하세요.");
  }
  return loginId;
}

function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

async function aesKey() {
  const secret = new TextEncoder().encode(env("BIGHUB_SIGNUP_SECRET"));
  const digest = await crypto.subtle.digest("SHA-256", secret);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
}

async function encryptPassword(password: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(password)));
  return { password_ciphertext: b64(encrypted), password_iv: b64(iv) };
}

async function selectOne<T>(path: string): Promise<T | null> {
  const response = await fetch(baseUrl() + path, { headers: serviceHeaders() });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new HttpError(500, "가입 신청 정보를 확인하지 못했습니다.");
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function deleteStaleAuthUser(id: string) {
  const response = await fetch(baseUrl() + "/auth/v1/admin/users/" + encodeURIComponent(id), { method: "DELETE", headers: serviceHeaders() });
  if (!response.ok && response.status !== 404) throw new HttpError(500, "이전 가입 신청 정보를 정리하지 못했습니다.");
}

async function upsertRequest(row: Record<string, unknown>) {
  const response = await fetch(baseUrl() + "/rest/v1/signup_requests?on_conflict=login_id", {
    method: "POST",
    headers: { ...serviceHeaders(), Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new HttpError(500, "가입 신청 저장에 실패했습니다.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST 요청만 가능합니다.");
    const input = await req.json().catch(() => ({}));
    const login_id = validLoginId(input.loginId);
    const name = String(input.name || "").trim();
    const department = String(input.department || "").trim();
    const password = String(input.password || "");

    if (!name) throw new HttpError(400, "이름을 입력하세요.");
    if (!DEPARTMENTS.has(department)) throw new HttpError(400, "부서를 다시 선택하세요.");
    if (password.length < 6) throw new HttpError(400, "비밀번호는 6자 이상 입력하세요.");

    const existingProfile = await selectOne<ExistingProfile>("/rest/v1/profiles?login_id=eq." + encodeURIComponent(login_id) + "&select=id,status");
    if (existingProfile?.status === "approved") throw new HttpError(409, "이미 가입 완료된 아이디입니다.");
    if (existingProfile?.id) await deleteStaleAuthUser(existingProfile.id);

    const existing = await selectOne<ExistingRequest>("/rest/v1/signup_requests?login_id=eq." + encodeURIComponent(login_id) + "&select=id,status");
    if (existing?.status === "pending") throw new HttpError(409, "이미 가입 신청된 아이디입니다. 관리자 승인 후 로그인하세요.");
    if (existing?.status === "approved") throw new HttpError(409, "이미 가입 완료된 아이디입니다.");

    await upsertRequest({
      login_id,
      name,
      department,
      status: "pending",
      ...(await encryptPassword(password)),
      created_at: new Date().toISOString(),
      decided_at: null,
      decided_by: null,
      user_id: null,
    });
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "가입 신청에 실패했습니다." }, error instanceof HttpError ? error.status : 500);
  }
});
