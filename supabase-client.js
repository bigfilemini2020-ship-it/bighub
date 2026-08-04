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
    if (text.includes("invalid login credentials")) return "아이디 또는 비밀번호가 맞지 않습니다.";
    if (text.includes("email not confirmed")) return "계정 확인이 아직 완료되지 않았습니다. 관리자에게 확인을 요청하세요.";
    if (text.includes("permission denied") || text.includes("row-level security") || code === "42501") {
      return "가입/로그인 정보 저장 권한이 없습니다. 관리자에게 Supabase SQL 업데이트를 요청하세요.";
    }
    if (code === "pgrst116" || text.includes("json object requested")) return "가입 신청 정보가 아직 생성되지 않았습니다. 관리자에게 Supabase SQL 업데이트를 요청하세요.";
    if (text.includes("column") && text.includes("attachment")) return "첨부파일 저장 컬럼이 없습니다. Supabase SQL 업데이트를 다시 실행하세요.";
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

  function cleanDate(value) {
    return value || null;
  }

  function postPayload(input, includeAttachmentFields = true) {
    const payload = {
      author_id: input.authorId,
      type: input.type || "general",
      title: input.title || "",
      body: input.body || "",
      media_url: input.mediaUrl || "",
      attachment_url: input.attachmentUrl || "",
      start_date: cleanDate(input.startDate),
      due_date: cleanDate(input.dueDate),
      completion_rules: input.completionRules || [],
    };
    if (includeAttachmentFields) {
      payload.attachment_name = input.attachmentName || "";
      payload.attachment_mime_type = input.attachmentMimeType || "";
    }
    return payload;
  }

  function toPost(row, targetsByPost) {
    return {
      id: row.id,
      authorId: row.author_id,
      type: row.type,
      title: row.title,
      body: row.body,
      mediaUrl: row.media_url || "",
      attachmentUrl: row.attachment_url || "",
      attachmentName: row.attachment_name || "",
      attachmentMimeType: row.attachment_mime_type || "",
      startDate: row.start_date || "",
      dueDate: row.due_date || "",
      completionRules: row.completion_rules || [],
      targetUserIds: targetsByPost.get(row.id) || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function toReaction(row) {
    return { id: row.id, postId: row.post_id, userId: row.user_id, sticker: row.sticker, createdAt: row.created_at, updatedAt: row.created_at };
  }

  function toComment(row) {
    return { id: row.id, postId: row.post_id, userId: row.user_id, body: row.body, createdAt: row.created_at };
  }

  function toDownload(row) {
    return { id: row.id, postId: row.post_id, userId: row.user_id, createdAt: row.created_at };
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
    const { data: profile, error: profileError } = await auth.from("profiles").select("id,status").eq("id", data.user.id).maybeSingle();
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

  async function listContent() {
    const auth = client();
    const [{ data: posts, error: postsError }, { data: targets, error: targetsError }, { data: comments, error: commentsError }, { data: reactions, error: reactionsError }, { data: events, error: eventsError }] = await Promise.all([
      auth.from("posts").select("*").order("created_at", { ascending: false }),
      auth.from("mission_targets").select("*"),
      auth.from("comments").select("*").order("created_at", { ascending: true }),
      auth.from("reactions").select("*").order("created_at", { ascending: false }),
      auth.from("mission_events").select("*").eq("event_type", "download"),
    ]);
    const error = postsError || targetsError || commentsError || reactionsError || eventsError;
    if (error) throw new Error(userMessage(error, "게시글을 불러오지 못했습니다."));
    const targetsByPost = new Map();
    (targets || []).forEach((item) => targetsByPost.set(item.post_id, [...(targetsByPost.get(item.post_id) || []), item.user_id]));
    return {
      posts: (posts || []).map((post) => toPost(post, targetsByPost)),
      comments: (comments || []).map(toComment),
      reactions: (reactions || []).map(toReaction),
      downloads: (events || []).map(toDownload),
    };
  }

  async function saveMissionTargets(postId, userIds) {
    const auth = client();
    await auth.from("mission_targets").delete().eq("post_id", postId);
    if (!userIds || !userIds.length) return;
    const { error } = await auth.from("mission_targets").insert(userIds.map((userId) => ({ post_id: postId, user_id: userId })));
    if (error) throw new Error(userMessage(error, "미션 참여 인원 저장에 실패했습니다."));
  }

  async function createPost(input) {
    const auth = client();
    let response = await auth.from("posts").insert(postPayload(input, true)).select("*").single();
    if (response.error && String(response.error.message || "").includes("attachment")) {
      response = await auth.from("posts").insert(postPayload(input, false)).select("*").single();
    }
    if (response.error) throw new Error(userMessage(response.error, "게시글 저장에 실패했습니다."));
    await saveMissionTargets(response.data.id, input.type === "mission" ? input.targetUserIds || [] : []);
    return response.data.id;
  }

  async function updatePost(id, input) {
    const auth = client();
    let response = await auth.from("posts").update(postPayload(input, true)).eq("id", id).select("*").single();
    if (response.error && String(response.error.message || "").includes("attachment")) {
      response = await auth.from("posts").update(postPayload(input, false)).eq("id", id).select("*").single();
    }
    if (response.error) throw new Error(userMessage(response.error, "게시글 수정에 실패했습니다."));
    await saveMissionTargets(id, input.type === "mission" ? input.targetUserIds || [] : []);
  }

  async function addReaction(input) {
    const auth = client();
    const { data: existing, error: selectError } = await auth.from("reactions").select("id").eq("post_id", input.postId).eq("user_id", input.userId).eq("sticker", input.sticker).maybeSingle();
    if (selectError) throw new Error(userMessage(selectError, "반응 확인에 실패했습니다."));
    if (existing) {
      const { error } = await auth.from("reactions").delete().eq("id", existing.id);
      if (error) throw new Error(userMessage(error, "반응 취소에 실패했습니다."));
      return;
    }
    const { error } = await auth.from("reactions").insert({ post_id: input.postId, user_id: input.userId, sticker: input.sticker });
    if (error) throw new Error(userMessage(error, "반응 저장에 실패했습니다."));
  }

  async function addComment(input) {
    const { error } = await client().from("comments").insert({ post_id: input.postId, user_id: input.userId, body: input.body });
    if (error) throw new Error(userMessage(error, "댓글 저장에 실패했습니다."));
  }

  async function recordFileDownload(input) {
    const { error } = await client().from("mission_events").upsert({ post_id: input.postId, user_id: input.userId, event_type: "download" }, { onConflict: "post_id,user_id,event_type" });
    if (error) throw new Error(userMessage(error, "다운로드 기록에 실패했습니다."));
  }

  async function approveProfile(id) {
    const { error } = await client().from("profiles").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new Error(userMessage(error, "가입 승인 처리에 실패했습니다."));
  }

  root.BigHubSupabase = { isConfigured, signUp, signIn, signOut, currentProfile, listProfiles, listContent, createPost, updatePost, addReaction, addComment, recordFileDownload, approveProfile, accessToken };
})(window);