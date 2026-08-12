import { corsHeaders, HttpError, json } from "../_shared/index.ts";

const DEPARTMENTS = new Set(["임원", "경영지원", "개발", "운영", "마케팅", "기타"]);

type SignupResult = { ok?: boolean; status?: number; error?: string };

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, "환경 변수 " + name + "가 없습니다.");
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
  throw new HttpError(500, "환경 변수 " + name + ".default" + "가 없습니다.");
}

function publicHeaders() {
  const key = defaultSecret("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_publishable_")) headers.Authorization = "Bearer " + key;
  return headers;
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

async function saveSignup(input: {
  login_id: string;
  name: string;
  department: string;
  password_ciphertext: string;
  password_iv: string;
}) {
  const response = await fetch(baseUrl() + "/rest/v1/rpc/request_signup", {
    method: "POST",
    headers: publicHeaders(),
    body: JSON.stringify({
      login_id_input: input.login_id,
      name_input: input.name,
      department_input: input.department,
      password_ciphertext_input: input.password_ciphertext,
      password_iv_input: input.password_iv,
    }),
  });
  const result = await response.json().catch(() => ({})) as SignupResult;
  if (!response.ok) throw new HttpError(500, "가입 신청 저장에 실패했습니다.");
  if (!result.ok) throw new HttpError(result.status || 500, result.error || "가입 신청 저장에 실패했습니다.");
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

    await saveSignup({ login_id, name, department, ...(await encryptPassword(password)) });
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "가입 신청에 실패했습니다." }, error instanceof HttpError ? error.status : 500);
  }
});
