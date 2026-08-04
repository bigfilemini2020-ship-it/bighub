const SUPABASE_URL = "https://kxorrekxpwkpggvdgwru.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_QShFn9QtmBMrdWBBEdVhuA_J1_wpnbj";

function bearer(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : "";
}

async function requireApprovedUser(req) {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, message: "로그인이 필요합니다." };

  const headers = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` };
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers });
  if (!userResponse.ok) return { ok: false, status: 401, message: "로그인 세션이 만료됐습니다. 다시 로그인하세요." };
  const user = await userResponse.json();

  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,status`, { headers });
  if (!profileResponse.ok) return { ok: false, status: 403, message: "사용자 승인 정보를 확인할 수 없습니다." };
  const profiles = await profileResponse.json();
  if (!profiles[0] || profiles[0].status !== "approved") return { ok: false, status: 403, message: "관리자 승인 후 이용할 수 있습니다." };

  return { ok: true, userId: user.id };
}

module.exports = { requireApprovedUser };