const storeKey = "bighub-state-v5";
const sessionKey = "bighub-session-v1";
const rememberedLoginIdKey = "bighub-remembered-login-id";
const autoLoginKey = "bighub-auto-login";
const uploadedAttachmentKey = "bighub-uploaded-attachment-v1";
const feedPositionKey = "bighub-feed-position-v1";
const S = window.EducationState;

let state = loadState();
let currentUserId = localStorage.getItem(autoLoginKey) === "1" ? localStorage.getItem(sessionKey) || "" : sessionStorage.getItem(sessionKey) || "";
let activeView = "feed";
let postFilter = "all";
let editingPostId = "";
let uploadedAttachment = null;
let shouldRestoreFeedPosition = true;
let feedPositionSaveTimer = 0;
let remoteSyncInFlight = false;

function loadState() {
  const saved = localStorage.getItem(storeKey);
  if (saved) return JSON.parse(saved);
  return S.createInitialState();
}

function saveState() { if (!remoteAuth()) localStorage.setItem(storeKey, JSON.stringify(state)); }
function remoteAuth() { return window.BigHubSupabase && window.BigHubSupabase.isConfigured(); }
function byId(id) { return document.getElementById(id); }
function escapeHtml(value) { return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function user(userId) { return state.users.find((item) => item.id === userId) || state.users[0]; }
function userName(userId) { return user(userId).name; }
function currentUser() { return state.users.find((item) => item.id === currentUserId) || null; }
function avatarHtml(userId) { const item = user(userId); return item.role === "admin" ? `<div class="avatar admin-icon" aria-label="관리자"></div>` : `<div class="avatar">${escapeHtml(item.avatar || item.name.slice(0, 1))}</div>`; }
function linkHtml(url, label) { return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>` : ""; }
function emptyHtml() { return byId("emptyTemplate").innerHTML; }
function setSession(userId, autoLogin) { const primary = autoLogin ? localStorage : sessionStorage; const secondary = autoLogin ? sessionStorage : localStorage; primary.setItem(sessionKey, userId); secondary.removeItem(sessionKey); if (autoLogin) localStorage.setItem(autoLoginKey, "1"); else localStorage.removeItem(autoLoginKey); }
function clearSession() { localStorage.removeItem(sessionKey); sessionStorage.removeItem(sessionKey); localStorage.removeItem(autoLoginKey); }
function postTypeLabel(type) { return { general: "일반", notice: "공지", mission: "미션", question: "질문" }[type] || "일반"; }
function feedPositionStorageKey() { return `${feedPositionKey}:${currentUserId || "guest"}`; }
function readFeedPosition() {
  if (!currentUserId) return null;
  try { return JSON.parse(localStorage.getItem(feedPositionStorageKey()) || "null"); }
  catch { return null; }
}
function applySavedFeedFilter() {
  const saved = readFeedPosition();
  if (saved?.userId === currentUserId && saved.filter) postFilter = saved.filter;
}
function currentVisiblePostId() {
  const cards = Array.from(document.querySelectorAll(".feed-card[data-post-id]"));
  const visible = cards.find((card) => card.getBoundingClientRect().bottom > 120) || cards[0];
  return visible?.dataset.postId || "";
}
function saveFeedPosition() {
  if (!currentUser() || activeView !== "feed") return;
  localStorage.setItem(feedPositionStorageKey(), JSON.stringify({
    userId: currentUserId,
    filter: postFilter,
    postId: currentVisiblePostId(),
    scrollY: Math.max(0, Math.round(window.scrollY || 0)),
    savedAt: Date.now()
  }));
}
function scheduleSaveFeedPosition() {
  if (feedPositionSaveTimer) return;
  feedPositionSaveTimer = window.setTimeout(() => {
    feedPositionSaveTimer = 0;
    saveFeedPosition();
  }, 200);
}
function restoreFeedPosition() {
  if (!shouldRestoreFeedPosition || activeView !== "feed" || !currentUser()) return;
  shouldRestoreFeedPosition = false;
  const saved = readFeedPosition();
  if (!saved || saved.userId !== currentUserId) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = Array.from(document.querySelectorAll(".feed-card[data-post-id]")).find((card) => card.dataset.postId === saved.postId);
    if (target) {
      target.scrollIntoView({ block: "start" });
      window.scrollBy(0, -88);
    } else if (Number.isFinite(saved.scrollY)) {
      window.scrollTo(0, saved.scrollY);
    }
  }));
}

async function init() {
  bindAuthForms();
  bindNavigation();
  bindForms();
  if (remoteAuth()) await restoreRemoteSession();
  applySavedFeedFilter();
  render();
}

async function restoreRemoteSession() {
  if (localStorage.getItem(autoLoginKey) !== "1") { await window.BigHubSupabase.signOut(); return; }
  try {
    const profile = await window.BigHubSupabase.currentProfile();
    if (!profile) return;
    currentUserId = profile.id;
    mergeRemoteUser(profile);
    await tryRefreshRemoteData();
  } catch (error) {
    console.warn(error);
  }
}

function mergeRemoteUser(user) {
  state = { ...state, users: [user, ...state.users.filter((item) => item.id !== user.id)] };
}

async function refreshRemoteData() {
  if (!remoteAuth()) return;
  const users = await window.BigHubSupabase.listProfiles();
  state = { ...state, users };
  const content = await window.BigHubSupabase.listContent();
  state = { ...state, ...content };
}

async function tryRefreshRemoteData() {
  try {
    await refreshRemoteData();
    return "";
  } catch (error) {
    console.warn(error);
    return error.message || "게시글 동기화에 실패했습니다.";
  }
}

async function syncRemoteData() {
  if (!remoteAuth() || !currentUser() || remoteSyncInFlight) return;
  remoteSyncInFlight = true;
  try {
    const error = await tryRefreshRemoteData();
    if (error) console.warn(error);
    else render();
  } finally {
    remoteSyncInFlight = false;
  }
}

function setupAuthForms() {
  const savedId = localStorage.getItem(rememberedLoginIdKey) || "";
  byId("loginIdInput").value = savedId;
  byId("rememberId").checked = Boolean(savedId);
  byId("autoLogin").checked = localStorage.getItem(autoLoginKey) === "1";
  byId("showSignup").addEventListener("click", () => setAuthMode("signup"));
  byId("showLogin").addEventListener("click", () => setAuthMode("login"));
  byId("autoLogin").addEventListener("change", (event) => {
    if (event.currentTarget.checked) byId("rememberId").checked = true;
  });
}

function setAuthMode(mode) {
  const signup = mode === "signup";
  byId("loginForm").classList.toggle("hidden", signup);
  byId("signupForm").classList.toggle("hidden", !signup);
  byId("loginMessage").textContent = "";
  byId("signupMessage").textContent = "";
}
function bindAuthForms() {
  setupAuthForms();
  byId("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const user = remoteAuth() ? await window.BigHubSupabase.signIn(data) : S.authenticateUser(state, data);
      if (!user) { byId("loginMessage").textContent = "승인된 계정이 없거나 비밀번호가 맞지 않습니다."; return; }
      currentUserId = user.id;
      if (remoteAuth()) mergeRemoteUser(user);
      const rememberId = byId("rememberId").checked || byId("autoLogin").checked;
      if (rememberId) localStorage.setItem(rememberedLoginIdKey, data.loginId || ""); else localStorage.removeItem(rememberedLoginIdKey);
      setSession(currentUserId, byId("autoLogin").checked);
      const syncError = remoteAuth() ? await tryRefreshRemoteData() : "";
      byId("loginMessage").textContent = "";
      shouldRestoreFeedPosition = true;
      applySavedFeedFilter();
      render();
      if (syncError) alert(`로그인은 됐지만 게시글 동기화에 실패했습니다. Supabase SQL 업데이트가 필요합니다.\n\n${syncError}`);
    } catch (error) {
      byId("loginMessage").textContent = error.message || "로그인에 실패했습니다.";
    }
  });
  byId("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (remoteAuth()) {
        await window.BigHubSupabase.signUp(data);
      } else {
        state = S.createSignupRequest(state, data);
        saveState();
      }
      event.currentTarget.reset();
      byId("signupMessage").textContent = "가입 신청이 접수됐습니다. 관리자 승인 후 로그인할 수 있습니다.";
      if (remoteAuth()) await refreshRemoteData();
      setAuthMode("login");
      byId("loginMessage").textContent = "가입 신청이 접수됐습니다. 승인 후 로그인하세요.";
      alert("가입 신청이 접수됐습니다. 관리자 승인 후 로그인할 수 있습니다.");
      render();
    } catch (error) {
      const message = error.message || "가입 신청에 실패했습니다.";
      byId("signupMessage").textContent = message;
      alert(`가입 신청 실패: ${message}`);
    }
  });
}

function bindNavigation() {
  document.querySelectorAll(".rail-button[data-view]").forEach((button) => button.addEventListener("click", () => { activeView = button.dataset.view; render(); }));
  document.querySelector("[data-action='compose-focus']").addEventListener("click", openComposeModal);
  document.querySelectorAll("[data-action='close-compose']").forEach((item) => item.addEventListener("click", closeComposeModal));
  document.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => { postFilter = button.dataset.filter; saveFeedPosition(); renderFeed(); }));
  window.addEventListener("scroll", scheduleSaveFeedPosition, { passive: true });
  window.addEventListener("beforeunload", saveFeedPosition);
  window.addEventListener("focus", syncRemoteData);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncRemoteData(); });
  window.setInterval(syncRemoteData, 30000);
  byId("globalSearch").addEventListener("input", renderSearch);
  byId("logoutButton").addEventListener("click", async () => { if (remoteAuth()) await window.BigHubSupabase.signOut(); currentUserId = ""; clearSession(); render(); });
  byId("resetDemo").addEventListener("click", () => { localStorage.removeItem(storeKey); clearSession(); state = loadState(); currentUserId = ""; render(); });
}

function openComposeModal() {
  if (!currentUser()) return;
  editingPostId = "";
  const form = byId("postForm");
  form.reset();
  uploadedAttachment = null;
  byId("composeTitle").textContent = "새 게시물 만들기";
  byId("driveUploadStatus").textContent = "";
  updateMissionSettings();
  byId("composeModal").classList.remove("hidden");
  form.querySelector("input[name='title']").focus();
}

function openEditModal(postId) {
  const post = state.posts.find((item) => item.id === postId);
  if (!post || !canEditPost(post)) return;
  editingPostId = post.id;
  const form = byId("postForm");
  form.reset();
  form.elements.type.value = post.type || "general";
  form.elements.title.value = post.title || "";
  form.elements.body.value = post.body || "";
  form.elements.startDate.value = post.startDate || "";
  form.elements.dueDate.value = post.dueDate || "";
  form.elements.mediaUrl.value = post.mediaUrl || "";
  form.elements.attachmentUrl.value = post.attachmentUrl || "";
  formDataCheckAll(form, "targetUserIds", post.targetUserIds || []);
  formDataCheckAll(form, "completionRules", post.completionRules || []);
  byId("composeTitle").textContent = "게시물 수정";
  byId("driveUploadStatus").textContent = post.attachmentName ? `현재 첨부: ${post.attachmentName}` : "";
  updateMissionSettings();
  byId("composeModal").classList.remove("hidden");
  form.querySelector("input[name='title']").focus();
}

function formDataCheckAll(form, name, values) {
  if (!values.length) return;
  const selected = new Set(values);
  Array.from(form.querySelectorAll(`input[name='${name}']`)).forEach((input) => { input.checked = selected.has(input.value); });
}

function closeComposeModal() { byId("composeModal").classList.add("hidden"); editingPostId = ""; uploadedAttachment = null; }
function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)}GB`;
}
function driveFileKey(file) {
  return file ? `${file.name}:${file.size}:${file.lastModified}` : "";
}

function loadUploadedAttachment(file) {
  const key = driveFileKey(file);
  if (!key) return null;
  if (uploadedAttachment?.fileKey === key) return uploadedAttachment;
  try {
    const cached = JSON.parse(sessionStorage.getItem(uploadedAttachmentKey) || "null");
    if (cached?.fileKey === key && cached.downloadUrl) {
      uploadedAttachment = cached;
      return cached;
    }
  } catch {}
  return null;
}

function rememberUploadedAttachment(value) {
  uploadedAttachment = value;
  if (value?.downloadUrl) sessionStorage.setItem(uploadedAttachmentKey, JSON.stringify(value));
}

function clearUploadedAttachment() {
  uploadedAttachment = null;
  sessionStorage.removeItem(uploadedAttachmentKey);
}

function updateDriveFileStatus() {
  const file = byId("driveFileInput")?.files?.[0];
  const status = byId("driveUploadStatus");
  if (!status) return;
  if (!file) {
    clearUploadedAttachment();
    status.textContent = "";
    return;
  }
  loadUploadedAttachment(file);
  if (uploadedAttachment?.fileKey !== driveFileKey(file)) uploadedAttachment = null;
  status.textContent = uploadedAttachment
    ? `업로드 완료: ${uploadedAttachment.name}`
    : `선택됨: ${file.name} (${formatFileSize(file.size)})`;
}
async function authHeaders() {
  if (!remoteAuth()) throw new Error("Supabase 로그인이 필요합니다.");
  const token = await window.BigHubSupabase.accessToken();
  if (!token) throw new Error("로그인 세션이 만료됐습니다. 다시 로그인하세요.");
  return { Authorization: `Bearer ${token}` };
}

function setUploadStatus(message, progress = 0) {
  const status = byId("driveUploadStatus");
  if (!status) return;
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
  status.innerHTML = message
    ? `<span>${escapeHtml(message)}</span><i style="--progress:${safeProgress}%"></i>`
    : "";
}

async function uploadDriveFile(file) {
  const headers = await authHeaders();
  const sessionResponse = await fetch("/api/drive/create-upload", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", size: file.size }),
  });
  const session = await sessionResponse.json().catch(() => ({}));
  if (!sessionResponse.ok) throw new Error(session.error || "Drive 업로드 준비에 실패했습니다.");
  if (session.file?.id) {
    setUploadStatus("이미 Drive에 있는 파일 연결 중...", 100);
    return {
      id: session.file.id,
      name: session.file.name || file.name,
      mimeType: session.file.mimeType || file.type || "application/octet-stream",
      downloadUrl: `/api/drive/download?id=${encodeURIComponent(session.file.id)}&name=${encodeURIComponent(session.file.name || file.name)}`,
    };
  }

  const chunkSize = 3 * 1024 * 1024;
  let uploaded;
  for (let start = 0; start < file.size; start += chunkSize) {
    const end = Math.min(start + chunkSize, file.size) - 1;
    const chunk = file.slice(start, end + 1);
    setUploadStatus(`Drive에 업로드 중... ${Math.round(((end + 1) / file.size) * 100)}%`, ((end + 1) / file.size) * 100);
    const uploadResponse = await fetch("/api/drive/upload-chunk", {
      method: "POST",
      headers: {
        ...headers,
        "content-type": file.type || "application/octet-stream",
        "x-upload-url": session.uploadUrl,
        "x-upload-start": String(start),
        "x-upload-end": String(end),
        "x-upload-size": String(file.size),
      },
      body: chunk,
    });
    const result = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok) throw new Error(result.error || "Drive 업로드에 실패했습니다.");
    if (result.done) uploaded = result.file;
  }

  if (!uploaded?.id) throw new Error("Drive 업로드가 완료되지 않았습니다.");
  return {
    id: uploaded.id,
    name: uploaded.name || file.name,
    mimeType: uploaded.mimeType || file.type || "application/octet-stream",
    downloadUrl: `/api/drive/download?id=${encodeURIComponent(uploaded.id)}&name=${encodeURIComponent(uploaded.name || file.name)}`,
  };
}

async function downloadDriveFile(url, postId) {
  const response = await fetch(url, { headers: await authHeaders() });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "파일 다운로드에 실패했습니다.");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const fallback = new URL(url, location.href).searchParams.get("name") || "download";
  const filename = match ? decodeURIComponent(match[1]) : fallback;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  if (remoteAuth()) {
    await window.BigHubSupabase.recordFileDownload({ postId, userId: currentUserId });
    await refreshRemoteData();
  } else {
    state = S.recordFileDownload(state, { postId, userId: currentUserId });
    saveState();
  }
}

function isDriveDownloadUrl(url) {
  return String(url || "").startsWith("/api/drive/download");
}

function driveFileName(url) {
  try { return new URL(url, location.href).searchParams.get("name") || "Drive 파일"; } catch { return "Drive 파일"; }
}


function isVideoAttachment(post) {
  const mime = String(post.attachmentMimeType || "").toLowerCase();
  const name = String(post.attachmentName || driveFileName(post.attachmentUrl)).toLowerCase();
  return mime.startsWith("video/") || /\.(mp4|mov|m4v|webm)(\?.*)?$/.test(name);
}

function attachmentHtml(post) {
  if (!post.attachmentUrl) return "";
  if (isDriveDownloadUrl(post.attachmentUrl)) {
    const name = post.attachmentName || driveFileName(post.attachmentUrl);
    const kind = isVideoAttachment(post) ? "영상" : "파일";
    return `<div class="attachment-line drive-attachment"><span><strong>${kind}</strong>${escapeHtml(name)}</span></div>`;
  }
  return `<div class="attachment-line">${linkHtml(post.attachmentUrl, "첨부파일 열기")}</div>`;
}


function saveControlHtml(post) {
  if (!post.attachmentUrl) return "";
  if (isDriveDownloadUrl(post.attachmentUrl)) {
    return `<button class="save-link" data-action="download-file" data-post-id="${post.id}" data-url="${escapeHtml(post.attachmentUrl)}" type="button" title="다운로드" aria-label="다운로드">${iconSvg("download")}</button>`;
  }
  return `<a class="save-link" href="${escapeHtml(post.attachmentUrl)}" target="_blank" rel="noreferrer" title="저장/열기" data-action="download-file" data-post-id="${post.id}" data-url="${escapeHtml(post.attachmentUrl)}">${iconSvg("download")}</a>`;
}
function updateMissionSettings() {
  const type = byId("postTypeSelect")?.value;
  const settings = byId("missionSettings");
  if (settings) settings.classList.toggle("hidden", type !== "mission");
}

function bindForms() {
  renderMissionTargets();
  updateMissionSettings();
  byId("postTypeSelect")?.addEventListener("change", updateMissionSettings);
  byId("driveFileInput")?.addEventListener("change", updateDriveFileStatus);
  byId("postForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    const file = byId("driveFileInput")?.files?.[0];
    const status = byId("driveUploadStatus");
    const submitButton = form.querySelector("button[type='submit']");
    try {
      if (file) {
        if (submitButton) submitButton.disabled = true;
        const cachedUpload = loadUploadedAttachment(file);
        if (!cachedUpload) {
          setUploadStatus("Drive 업로드 준비 중...", 5);
          const uploaded = await uploadDriveFile(file);
          rememberUploadedAttachment({ ...uploaded, fileKey: driveFileKey(file) });
          setUploadStatus("업로드 완료", 100);
        } else {
          setUploadStatus("이미 업로드된 파일 연결 중...", 100);
        }
        data.attachmentUrl = uploadedAttachment.downloadUrl;
        data.attachmentName = uploadedAttachment.name;
        data.attachmentMimeType = uploadedAttachment.mimeType;
      }
      delete data.driveFile;
      data.targetUserIds = data.type === "mission" ? formData.getAll("targetUserIds") : [];
      data.completionRules = formData.getAll("completionRules");
      if (remoteAuth()) {
        const payload = { ...data, authorId: currentUserId };
        if (editingPostId) await window.BigHubSupabase.updatePost(editingPostId, payload);
        else await window.BigHubSupabase.createPost(payload);
        await refreshRemoteData();
      } else {
        state = editingPostId ? S.updatePost(state, editingPostId, data, currentUserId) : S.addPost(state, { ...data, authorId: currentUserId });
        saveState();
      }
      form.reset();
      clearUploadedAttachment();
      setUploadStatus("");
      closeComposeModal();
      activeView = "feed";
      shouldRestoreFeedPosition = false;
      render();
      window.scrollTo(0, 0);
    } catch (error) {
      setUploadStatus(error.message || "파일 업로드에 실패했습니다.");
      alert(error.message || "파일 업로드에 실패했습니다.");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function render() {
  const signedIn = Boolean(currentUser());
  byId("authView").classList.toggle("hidden", signedIn);
  byId("appShell").classList.toggle("hidden", !signedIn);
  if (!signedIn) return;
  const admin = currentUser()?.role === "admin";
  byId("approvalMenuButton").classList.toggle("hidden", !admin);
  if (activeView === "approvals" && !admin) activeView = "feed";
  document.querySelectorAll(".rail-button[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  byId(`${activeView}View`).classList.add("active");
  renderCurrentUser(); renderFeed(); renderSearch(); renderProgress(); renderStats(); renderApprovals(); renderCalendar(); restoreFeedPosition();
}

function renderMissionTargets() {
  const target = byId("missionTargets");
  if (!target) return;
  target.innerHTML = state.users.filter((item) => item.role === "member").map((item) => `<label><input type="checkbox" name="targetUserIds" value="${item.id}" checked /> ${escapeHtml(item.name)} · ${escapeHtml(item.department || "")}</label>`).join("");
}

function renderCurrentUser() { const item = currentUser(); const avatar = byId("currentAvatar"); avatar.classList.toggle("admin-icon", item.role === "admin"); avatar.textContent = item.role === "admin" ? "" : item.avatar || item.name.slice(0, 1); avatar.setAttribute("aria-label", item.role === "admin" ? "관리자" : item.name); byId("currentName").textContent = item.name; byId("currentRole").textContent = item.role === "admin" ? "admin" : `${item.department} · ${item.role}`; }

function canManagePost(post) { const item = currentUser(); return Boolean(item && (item.role === "admin" || post.authorId === item.id)); }
function canEditPost(post) { return canManagePost(post); }
function hasCompletionCheck(post) { return Array.isArray(post.completionRules) && post.completionRules.includes("done"); }

function renderFeed() {
  document.querySelectorAll(".filter-chip").forEach((button) => button.classList.toggle("active", button.dataset.filter === postFilter));
  const posts = sortFeedPosts(state.posts.filter((post) => postFilter === "all" || post.type === postFilter));
  byId("postList").innerHTML = posts.length ? posts.map(postCardHtml).join("") : emptyHtml();
  hydrateDriveVideos();
}

function sortFeedPosts(posts) {
  return [...posts].sort((a, b) => {
    const aIntro = a.title === "BigHub 사용 안내";
    const bIntro = b.title === "BigHub 사용 안내";
    if (aIntro !== bIntro) return aIntro ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function postCardHtml(post) {
  const completionEnabled = hasCompletionCheck(post);
  const completion = completionEnabled ? S.getPostCompletion(state, post.id) : { totalMembers: 0 };
  const reactions = state.reactions.filter((reaction) => reaction.postId === post.id);
  const comments = state.comments.filter((comment) => comment.postId === post.id);
  const mine = reactions.filter((reaction) => reaction.userId === currentUserId);
  const doneCount = reactions.filter((reaction) => reaction.sticker === "done").length;
  const mediaUrl = post.mediaUrl || post.videoUrl || post.attachmentUrl;
  const presentation = S.getPostPresentation(post);
  const cardClass = presentation.kind === "text" ? "feed-card text-card" : "feed-card media-card";
  const preview = presentation.kind === "media" ? mediaPreviewHtml(mediaUrl, post) : "";
  const menuButton = canManagePost(post) ? postMenuHtml(post.id) : "";
  const doneLabel = post.type === "mission" ? `완료 ${doneCount}/${completion.totalMembers}` : `완료 ${doneCount}`;
  const doneAction = completionEnabled ? actionButton(post.id, "done", mine, "check", doneLabel) : "";
  return `<article class="${cardClass}" data-post-id="${escapeHtml(post.id)}"><header class="feed-head"><div class="author-line">${avatarHtml(post.authorId)}<div><strong>${escapeHtml(userName(post.authorId))}</strong><span>${postTypeLabel(post.type)} · ${formatDate(post.createdAt)}${dateText(post)}</span></div></div><div class="post-tools">${menuButton}<span class="post-type">${postTypeLabel(post.type)}</span></div></header>${preview}<section class="feed-body"><h3>${escapeHtml(post.title)}</h3><p class="post-text">${escapeHtml(post.body)}</p>${attachmentHtml(post)}<div class="feed-actions">${doneAction}<button class="icon-action comment" data-focus-comment="${post.id}" type="button" title="댓글" aria-label="댓글">${iconSvg("comment")}<span>댓글 ${comments.length}</span></button>${saveControlHtml(post)}</div>${comments.length ? `<div class="comment-list">${commentsHtml(post.id, comments)}</div>` : ""}<form class="inline-form" data-action="comment" data-post-id="${post.id}"><input id="comment-${post.id}" name="body" placeholder="댓글을 입력하세요." required /><button type="submit">게시</button></form></section></article>`;
}
function postMenuHtml(postId) {
  return `<div class="post-menu"><button class="post-menu-button" data-action="toggle-post-menu" data-post-id="${postId}" type="button" aria-label="게시글 메뉴">${iconSvg("more")}</button><div class="post-menu-popover hidden" data-menu-for="${postId}"><button data-action="edit-post" data-post-id="${postId}" type="button">수정</button><button class="danger" data-action="delete-post" data-post-id="${postId}" type="button">삭제</button></div></div>`;
}

function actionButton(postId, sticker, mine, icon, label) { const active = mine.some((reaction) => reaction.sticker === sticker) ? " active" : ""; return `<button class="icon-action ${sticker}${active}" data-action="reaction" data-post-id="${postId}" data-sticker="${sticker}" type="button" title="${label}" aria-label="${label}">${iconSvg(icon)}<span>${label}</span></button>`; }
function iconSvg(name) { const icons = { heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.2-4.4-9.5-9.1C.7 8.2 2.9 4.5 6.7 4.5c2 0 3.7 1.1 4.7 2.7 1-1.6 2.7-2.7 4.7-2.7 3.8 0 6 3.7 4.2 7.4C19.2 16.6 12 21 12 21Z"/></svg>`, check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`, comment: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.8 8.4 9.6 9.6 0 0 1-4-.8L3 20l1.1-4.4A8.1 8.1 0 0 1 3 11.5C3 6.8 7 3 12 3s9 3.8 9 8.5Z"/></svg>`, download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>`, more: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>` }; return icons[name] || name; }
function mediaPreviewHtml(url, post) {
  if (isDriveDownloadUrl(url) && isVideoAttachment(post)) {
    return `<div class="media-preview video-preview"><video class="drive-video" controls preload="metadata" playsinline data-drive-src="${escapeHtml(`${url}&inline=1`)}"></video></div>`;
  }
  const preview = S.getLinkPreview(url);
  if (preview.type === "youtube") return `<a class="media-preview" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(preview.thumbnailUrl)}" alt="${escapeHtml(post.title)} 썸네일" /></a>`;
  if (preview.type === "image") return `<a class="media-preview" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(url)}" alt="${escapeHtml(post.title)}" /></a>`;
  const label = preview.type === "html" ? "HTML" : "LINK";
  return `<a class="media-preview" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><div class="file-preview"><div class="file-icon">${label}</div><strong>${escapeHtml(post.title)}</strong><span>열어서 보기</span></div></a>`;
}

async function hydrateDriveVideos() {
  const videos = Array.from(document.querySelectorAll("video[data-drive-src]:not([src])"));
  if (!videos.length || !remoteAuth()) return;
  const token = await window.BigHubSupabase.accessToken().catch(() => "");
  if (!token) return;
  videos.forEach((video) => {
    const separator = video.dataset.driveSrc.includes("?") ? "&" : "?";
    video.src = `${video.dataset.driveSrc}${separator}token=${encodeURIComponent(token)}`;
  });
}
function commentsHtml(postId, comments) {
  const roots = comments.filter((comment) => !comment.parentId);
  return roots.map((comment) => commentHtml(comment, comments.filter((reply) => reply.parentId === comment.id))).join("");
}
function commentHtml(comment, replies = []) {
  const canDelete = currentUser()?.role === "admin" || comment.userId === currentUserId;
  return `<div class="comment" id="comment-${comment.id}"><div class="comment-main"><strong>${escapeHtml(userName(comment.userId))}</strong><span>${escapeHtml(comment.body)}</span></div><div class="comment-tools"><button data-focus-reply="${comment.id}" type="button">답글</button>${canDelete ? `<button data-action="delete-comment" data-comment-id="${comment.id}" type="button">삭제</button>` : ""}</div>${replies.length ? `<div class="reply-list">${replies.map((reply) => replyHtml(reply)).join("")}</div>` : ""}<form class="inline-form reply-form hidden" data-action="comment" data-post-id="${comment.postId}" data-parent-id="${comment.id}"><input name="body" placeholder="답글을 입력하세요." required /><button type="submit">게시</button></form></div>`;
}
function replyHtml(comment) {
  const canDelete = currentUser()?.role === "admin" || comment.userId === currentUserId;
  return `<div class="comment reply" id="comment-${comment.id}"><div class="comment-main"><strong>${escapeHtml(userName(comment.userId))}</strong><span>${escapeHtml(comment.body)}</span></div>${canDelete ? `<div class="comment-tools"><button data-action="delete-comment" data-comment-id="${comment.id}" type="button">삭제</button></div>` : ""}</div>`;
}
function dateText(post) { if (post.startDate && post.dueDate) return ` · ${post.startDate} ~ ${post.dueDate}`; if (post.dueDate) return ` · ${post.dueDate} 마감`; if (post.startDate) return ` · ${post.startDate} 시작`; return ""; }

function renderSearch() { const input = byId("globalSearch"); if (!input) return; const query = input.value.trim().toLowerCase(); if (!query) { byId("searchResults").innerHTML = `<div class="empty">검색어를 입력하세요.</div>`; return; } const results = state.posts.filter((post) => `${post.title} ${post.body} ${postTypeLabel(post.type)}`.toLowerCase().includes(query)).map((post) => resultCard(postTypeLabel(post.type), post.title, post.body)); byId("searchResults").innerHTML = results.length ? results.join("") : emptyHtml(); }
function resultCard(type, title, body) { return `<article class="resource-card result-card"><span class="status-pill">${escapeHtml(type)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></article>`; }
function renderProgress() { const members = state.users.filter((item) => item.role === "member"); const posts = state.posts.filter(hasCompletionCheck); byId("userProgress").innerHTML = members.map((item) => { const done = posts.filter((post) => S.getPostCompletion(state, post.id).completedUserIds.includes(item.id)).length; const percent = posts.length ? Math.round((done / posts.length) * 100) : 0; return progressCard(item.name, `${done}/${posts.length}개 완료`, percent); }).join("") || emptyHtml(); byId("postProgress").innerHTML = posts.map((post) => { const completion = S.getPostCompletion(state, post.id); return progressCard(post.title, `${completion.completedCount}/${completion.totalMembers}명 완료`, completion.percent); }).join("") || emptyHtml(); }
function progressCard(title, meta, percent) { return `<article class="progress-card"><h3>${escapeHtml(title)}</h3><span class="feed-meta">${escapeHtml(meta)} · ${percent}%</span><div class="bar" aria-hidden="true"><span style="width: ${percent}%"></span></div></article>`; }
function renderStats() { const questionCount = state.posts.filter((post) => post.type === "question").length; byId("quickStats").innerHTML = `<div class="stat-row"><span>게시물</span><strong>${state.posts.length}</strong></div><div class="stat-row"><span>질문</span><strong>${questionCount}</strong></div>`; }
function renderApprovals() { const panel = byId("approvalPanel"); const pending = remoteAuth() ? state.users.filter((user) => user.status === "pending") : (state.signupRequests || []).filter((request) => request.status === "pending"); const admin = currentUser()?.role === "admin"; const compactHtml = pending.length ? pending.map((request) => `<div class="mini-item"><div><strong>${escapeHtml(request.name)}</strong><span>${escapeHtml(request.department)} · ${escapeHtml(request.loginId || "")}</span></div><button class="mini-button" data-action="approve-signup" data-request-id="${request.id}" type="button">승인</button></div>`).join("") : `<div class="mini-empty">대기 중인 신청 없음</div>`; const fullHtml = pending.length ? pending.map((request) => `<article class="feed-card text-card approval-card"><header class="feed-head"><div class="author-line"><div class="avatar">${escapeHtml((request.name || "?").slice(0, 1))}</div><div><strong>${escapeHtml(request.name)}</strong><span>${escapeHtml(request.department)} · ${escapeHtml(request.loginId || "")}</span></div></div><button class="mini-button" data-action="approve-signup" data-request-id="${request.id}" type="button">승인</button></header></article>`).join("") : emptyHtml(); panel.classList.toggle("hidden", !admin); byId("pendingCount").textContent = pending.length; byId("pendingList").innerHTML = compactHtml; byId("approvalViewCount").textContent = pending.length; byId("approvalViewList").innerHTML = fullHtml; }
function renderCalendar() { const posts = state.posts.filter((post) => post.startDate || post.dueDate).sort((a, b) => String(a.dueDate || a.startDate).localeCompare(String(b.dueDate || b.startDate))); byId("calendarList").innerHTML = posts.length ? posts.map((post) => `<div class="mini-item calendar-item"><div><strong>${escapeHtml(post.title)}</strong><span>${postTypeLabel(post.type)} · ${escapeHtml(dateText(post).replace(/^ · /, ""))}</span></div></div>`).join("") : `<div class="mini-empty">등록된 일정 없음</div>`; }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "방금" : `${date.getMonth() + 1}.${date.getDate()}`; }

document.addEventListener("click", async (event) => {
  const focusTarget = event.target.closest("[data-focus-comment]");
  if (focusTarget) { const input = byId(`comment-${focusTarget.dataset.focusComment}`); if (input) input.focus(); return; }
  const replyTarget = event.target.closest("[data-focus-reply]");
  if (replyTarget) { const form = replyTarget.closest(".comment")?.querySelector(".reply-form"); if (form) { form.classList.toggle("hidden"); form.querySelector("input")?.focus(); } return; }
  const target = event.target.closest("[data-action]");
  if (!target || target.tagName === "FORM") return;
  if (target.dataset.action === "toggle-post-menu") {
    const menu = document.querySelector(`[data-menu-for="${target.dataset.postId}"]`);
    document.querySelectorAll(".post-menu-popover").forEach((item) => { if (item !== menu) item.classList.add("hidden"); });
    if (menu) menu.classList.toggle("hidden");
    return;
  }
  if (target.dataset.action === "edit-post") { openEditModal(target.dataset.postId); return; }
  if (target.dataset.action === "delete-post") {
    const postId = target.dataset.postId;
    const post = state.posts.find((item) => item.id === postId);
    if (!post || !canManagePost(post)) return;
    if (!confirm("이 게시글을 삭제할까요? 삭제하면 댓글과 완료 기록도 함께 삭제됩니다.")) return;
    if (remoteAuth()) {
      try { await window.BigHubSupabase.deletePost(postId); await refreshRemoteData(); }
      catch (error) { alert(error.message || "게시글 삭제에 실패했습니다."); return; }
    } else {
      state = S.deletePost(state, postId, currentUserId);
      saveState();
    }
    render();
    return;
  }
  if (target.dataset.action === "reaction") {
    const reaction = { postId: target.dataset.postId, userId: currentUserId, sticker: target.dataset.sticker };
    if (remoteAuth()) {
      const previousState = state;
      state = S.addReaction(state, reaction);
      render();
      try { await window.BigHubSupabase.addReaction(reaction); await refreshRemoteData(); }
      catch (error) { state = previousState; alert(error.message || "반응 저장에 실패했습니다."); }
      render();
      return;
    }
    state = S.addReaction(state, reaction);
  }
  if (target.dataset.action === "download-file") {
    const url = target.dataset.url || target.href;
    if (!isDriveDownloadUrl(url)) {
      if (remoteAuth()) await window.BigHubSupabase.recordFileDownload({ postId: target.dataset.postId, userId: currentUserId });
      else { state = S.recordFileDownload(state, { postId: target.dataset.postId, userId: currentUserId }); saveState(); }
      return;
    }
    event.preventDefault();
    try { await downloadDriveFile(url, target.dataset.postId); } catch (error) { alert(error.message || "파일 다운로드에 실패했습니다."); }
    render();
    return;
  }
  if (target.dataset.action === "delete-comment") {
    const commentId = target.dataset.commentId;
    if (remoteAuth()) {
      try { await window.BigHubSupabase.deleteComment(commentId); await refreshRemoteData(); }
      catch (error) { alert(error.message || "댓글 삭제에 실패했습니다."); return; }
    } else {
      state = S.deleteComment(state, commentId);
      saveState();
    }
    render();
    return;
  }
  if (target.dataset.action === "approve-signup") { if (remoteAuth()) { window.BigHubSupabase.approveProfile(target.dataset.requestId).then(refreshRemoteData).then(render); return; } state = S.approveSignupRequest(state, target.dataset.requestId); }
  saveState();
  render();
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-action]");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.action === "comment") {
    if (remoteAuth()) {
      try { await window.BigHubSupabase.addComment({ ...data, postId: form.dataset.postId, parentId: form.dataset.parentId || "", userId: currentUserId }); await refreshRemoteData(); }
      catch (error) { alert(error.message || "댓글 저장에 실패했습니다."); return; }
    } else {
      state = S.addComment(state, { ...data, postId: form.dataset.postId, parentId: form.dataset.parentId || "", userId: currentUserId });
      saveState();
    }
  }
  form.reset();
  render();
});

init();

