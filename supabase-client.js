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
    if (error) throw error;
    if (!data.user) throw new Error("가입 계정을 만들지 못했습니다.");
    const { data: profile, error: profileError } = await auth
      .from("profiles")
      .select("id,status")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileError) throw new Error("가입 신청 저장 권한 설정이 필요합니다. 관리자에게 Supabase SQL 업데이트를 요청하세요.");
    if (!profile) throw new Error("가입 신청 저장 설정이 아직 적용되지 않았습니다. Supabase SQL 업데이트 후 다시 신청하세요.");
    await auth.auth.signOut();
  }

  async function signIn(input) {
    const auth = client();
    const email = root.EducationState.loginIdToAuthEmail(input.loginId);
    const { data, error } = await auth.auth.signInWithPassword({ email, password: input.password });
    if (error) throw error;
    const { data: profile, error: profileError } = await auth.from("profiles").select("*").eq("id", data.user.id).single();
    if (profileError) throw profileError;
    if (profile.status !== "approved") {
      await auth.auth.signOut();
      throw new Error("관리자 승인 대기 중입니다.");
    }
    return toUser(profile);
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
    if (error) throw error;
    return data.map(toUser);
  }

  async function approveProfile(id) {
    const { error } = await client().from("profiles").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  }

  root.BigHubSupabase = { isConfigured, signUp, signIn, signOut, currentProfile, listProfiles, approveProfile };
})(window);