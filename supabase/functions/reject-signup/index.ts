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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "POST 요청만 가능합니다.");
    const admin = await currentAdmin(req);
    const { requestId } = await req.json().catch(() => ({}));
    const id = String(requestId || "");
    if (!id) throw new HttpError(400, "가입 신청 ID가 없습니다.");

    const response = await fetch(baseUrl() + "/rest/v1/signup_requests?id=eq." + encodeURIComponent(id) + "&status=eq.pending", {
      method: "PATCH",
      headers: { ...serviceHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({ status: "rejected", password_ciphertext: null, password_iv: null, decided_at: new Date().toISOString(), decided_by: admin.id }),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new HttpError(500, "가입 거절 처리에 실패했습니다.");
    if (!Array.isArray(rows) || rows.length === 0) throw new HttpError(404, "대기 중인 가입 신청을 찾을 수 없습니다.");
    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "가입 거절 처리에 실패했습니다." }, error instanceof HttpError ? error.status : 500);
  }
});
