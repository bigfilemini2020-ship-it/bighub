import { corsHeaders, HttpError, json } from "../_shared/index.ts";

const DEPARTMENTS = new Set(["\uC784\uC6D0", "\uACBD\uC601\uC9C0\uC6D0", "\uAC1C\uBC1C", "\uC6B4\uC601", "\uB9C8\uCF00\uD305", "\uAE30\uD0C0"]);

type SignupResult = { ok?: boolean; status?: number; error?: string };

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

function publicHeaders() {
  const key = defaultSecret("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_publishable_")) headers.Authorization = "Bearer " + key;
  return headers;
}

function validLoginId(value: unknown) {
  const loginId = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(loginId)) {
    throw new HttpError(400, "\uC544\uC774\uB514\uB294 \uC601\uBB38 \uC18C\uBB38\uC790, \uC22B\uC790, \uC810, \uBC11\uC904, \uD558\uC774\uD508\uC73C\uB85C 3~32\uC790 \uC785\uB825\uD558\uC138\uC694.");
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
  if (!response.ok) throw new HttpError(500, "\uAC00\uC785 \uC2E0\uCCAD \uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
  if (!result.ok) throw new HttpError(result.status || 500, result.error || "\uAC00\uC785 \uC2E0\uCCAD \uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST \uC694\uCCAD\uB9CC \uAC00\uB2A5\uD569\uB2C8\uB2E4.");
    const input = await req.json().catch(() => ({}));
    const login_id = validLoginId(input.loginId);
    const name = String(input.name || "").trim();
    const department = String(input.department || "").trim();
    const password = String(input.password || "");

    if (!name) throw new HttpError(400, "\uC774\uB984\uC744 \uC785\uB825\uD558\uC138\uC694.");
    if (!DEPARTMENTS.has(department)) throw new HttpError(400, "\uBD80\uC11C\uB97C \uB2E4\uC2DC \uC120\uD0DD\uD558\uC138\uC694.");
    if (password.length < 6) throw new HttpError(400, "\uBE44\uBC00\uBC88\uD638\uB294 6\uC790 \uC774\uC0C1 \uC785\uB825\uD558\uC138\uC694.");

    await saveSignup({ login_id, name, department, ...(await encryptPassword(password)) });
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "\uAC00\uC785 \uC2E0\uCCAD\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4." }, error instanceof HttpError ? error.status : 500);
  }
});
