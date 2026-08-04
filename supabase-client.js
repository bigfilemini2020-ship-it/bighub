(function (root) {
  function config() {
    return root.BigHubConfig || {};
  }

  function isConfigured() {
    const item = config();
    return Boolean(item.supabaseUrl && item.supabaseAnonKey && root.supabase && root.EducationState);
  }

  function client() {
    const item = config();
    return root.supabase.createClient(item.supabaseUrl, item.supabaseAnonKey);
  }

  function userMessage(error, fallback) {
    const text = String(error?.message || error || "").toLowerCase();
    const code = String(error?.code || "").toLowerCase();
    if (text.includes("already registered") || text.includes("already exists") || text.includes("duplicate key")) {
      return "이미 가입 신청된 아이디입니다. 관리자 승인 후 로그인하세요.";
    }
    if (text.includes("invalid login credentials")) {
      return "아이디 또는 비밀번호가 맞지 않습니다.";
    }
    if (text.includes("email not confirmed")) {
      return "계정 확인이 아직 완료되지 않았습니다. 관리자에게 확인을 요청하세요.";
    }
    if (text.includes("permission denied") || text.includes("row-level security") || code === "42501") {
      return "가입/로그인 정보 저장 권한이 없습니다. 관리자에게 Supabase SQL 업데이트를 요청하세요.";
    }
    if (code === "pgrst116" || text.includes("json object requested")) {
      return "가입 신청 정보가 아직 생성되지 않았습니다. 관리자에게 Supabase SQL 업데이트를 요청하세요.";
    }
    return fallback || "요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.";
  }

  function toUser(profile) {
    return {
      id: profile.id,
      loginId: profile.login_id,
      authEmail: profile.auth_email,
      name: profile.name,
      department: profile.department,
      role: profile.role,
      status: profile.status,
      avatar: profile.avatar || String(profile.name || "?").slice(0, 1),
      approvedAt: profile.approved_at,
      createdAt: profile.created_at,
    };
  }

  async function signUp(input) {
    const auth = client();
    const loginId = root.EducationState.validateLoginId(input.loginId);
    const authEmail = root.EducationState.loginIdToAuthEmail(loginId);
    const { data, error } = await auth.auth.signUp({
      email: authEmail,
      password: input.password,
      options: { data: { login_id: loginId, name: input.name, department: input.department } },
    });
    if (error) throw new Error(userMessage(error, "가입 신청에 실패했습니다. 다시 시도하세요."));
    if (!data.user) throw new Error("가입 계정을 만들지 못했습니다. 다시 시도하세요.");
    const { data: profile, error: profileError } = await auth
      .from("profiles")
      .select("id,status")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError) throw new Error(userMessage(profileError));
    if (!profile) throw new Error("가입 신청 저장 설정이 아직 적용되지 않았습니다. Supabase SQL 업데이트 후 다시 신청하세요.");
    await auth.auth.signOut();
  }

  async function signIn(input) {
    const auth = client();
    const email = root.EducationState.loginIdToAuthEmail(input.loginId);
    const { data, error } = await auth.auth.signInWithPassword({ email, password: input.password });
    if (error) throw new Error(userMessage(error, "로그인에 실패했습니다. 다시 시도하세요."));
    const { data: profile, error: profileError } = await auth.from("profiles").select("*").eq("id", data.user.id).single();
    if (profileError) throw new Error(userMessage(profileError));
    if (profile.status !== "approved") {
      await auth.auth.signOut();
      throw new Error("관리자 승인 대기 중입니다.");
    }
    return toUser(profile);
  }

  async function accessToken() {
    const { data } = await client().auth.getSession();
    return data.session?.access_token || "";
  }

  async function signOut() {
    await client().auth.signOut();
  }

  async function currentProfile() {
    const auth = client();
    const { data } = await auth.auth.getUser();
    if (!data.user) return null;
    const { data: profile, error } = await auth.from("profiles").select("*").eq("id", data.user.id).single();
    if (error || !profile || profile.status !== "approved") return null;
    return toUser(profile);
  }

  async function listProfiles() {
    const { data, error } = await client().from("profiles").select("*").order("created_at", { ascending: true });
    if (error) throw new Error(userMessage(error));
    return data.map(toUser);
  }

  async function approveProfile(id) {
    const { error } = await client().from("profiles").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(userMessage(error, "가입 승인 처리에 실패했습니다."));
  }

  root.BigHubSupabase = { isConfigured, signUp, signIn, signOut, currentProfile, listProfiles, approveProfile, accessToken };
})(window);