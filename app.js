const storeKey = "bighub-state-v5";
const sessionKey = "bighub-session-v1";
const rememberedLoginIdKey = "bighub-remembered-login-id";
const autoLoginKey = "bighub-auto-login";
const S = window.EducationState;

let state = loadState();
let currentUserId = localStorage.getItem(autoLoginKey) === "1" ? localStorage.getItem(sessionKey) || "" : sessionStorage.getItem(sessionKey) || "";
let activeView = "feed";
let postFilter = "all";

function loadState() {
  const saved = localStorage.getItem(storeKey);
  if (saved) return JSON.parse(saved);
  return S.createInitialState();
}

function saveState() { localStorage.setItem(storeKey, JSON.stringify(state)); }
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

async function init() {
  bindAuthForms();
  bindNavigation();
  bindForms();
  if (remoteAuth()) await restoreRemoteSession();
  render();
}

async function restoreRemoteSession() {
  if (localStorage.getItem(autoLoginKey) !== "1") { await window.BigHubSupabase.signOut(); return; }
  try {
    const profile = await window.BigHubSupabase.currentProfile();
    if (!profile) return;
    currentUserId = profile.id;
    await refreshRemoteUsers();
  } catch (error) {
    console.warn(error);
  }
}

async function refreshRemoteUsers() {
  if (!remoteAuth()) return;
  const users = await window.BigHubSupabase.listProfiles();
  state = { ...state, users };
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
      const rememberId = byId("rememberId").checked || byId("autoLogin").checked;
      if (rememberId) localStorage.setItem(rememberedLoginIdKey, data.loginId || ""); else localStorage.removeItem(rememberedLoginIdKey);
      setSession(currentUserId, byId("autoLogin").checked);
      if (remoteAuth()) await refreshRemoteUsers();
      byId("loginMessage").textContent = "";
      render();
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
      if (remoteAuth()) await refreshRemoteUsers();
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
  document.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => { postFilter = button.dataset.filter; renderFeed(); }));
  byId("globalSearch").addEventListener("input", renderSearch);
  byId("logoutButton").addEventListener("click", async () => { if (remoteAuth()) await window.BigHubSupabase.signOut(); currentUserId = ""; clearSession(); render(); });
  byId("resetDemo").addEventListener("click", () => { localStorage.removeItem(storeKey); clearSession(); state = loadState(); currentUserId = ""; render(); });
}

function openComposeModal() { if (!currentUser()) return; byId("composeModal").classList.remove("hidden"); byId("postForm").querySelector("input[name='title']").focus(); }
function closeComposeModal() { byId("composeModal").classList.add("hidden"); }
async function authHeaders() {
  if (!remoteAuth()) throw new Error("Supabase 로그인이 필요합니다.");
  const token = await window.BigHubSupabase.accessToken();
  if (!token) throw new Error("로그인 세션이 만료됐습니다. 다시 로그인하세요.");
  return { Authorization: `Bearer ${token}` };
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
  const uploadResponse = await fetch(session.uploadUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  const uploaded = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !uploaded.id) throw new Error(uploaded.error?.message || "Drive 업로드에 실패했습니다.");
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
  state = S.recordFileDownload(state, { postId, userId: currentUserId });
  saveState();
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
    return `<div class="attachment-line drive-attachment"><span><strong>${kind}</strong>${escapeHtml(name)}</span><button class="mini-button" data-action="download-file" data-post-id="${post.id}" data-url="${escapeHtml(post.attachmentUrl)}" type="button">다운로드</button></div>`;
  }
  return `<div class="attachment-line">${linkHtml(post.attachmentUrl, "첨부파일 열기")}</div>`;
}


function saveControlHtml(post) {
  if (!post.attachmentUrl) return "";
  if (isDriveDownloadUrl(post.attachmentUrl)) {
    return `<button class="save-link" data-action="download-file" data-post-id="${post.id}" data-url="${escapeHtml(post.attachmentUrl)}" type="button" title="다운로드" aria-label="다운로드">⇩</button>`;
  }
  return `<a class="save-link" href="${escapeHtml(post.attachmentUrl)}" target="_blank" rel="noreferrer" title="저장/열기" data-action="download-file" data-post-id="${post.id}" data-url="${escapeHtml(post.attachmentUrl)}">⇩</a>`;
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
        if (status) status.textContent = "Drive에 업로드 중...";
        if (submitButton) submitButton.disabled = true;
        const uploaded = await uploadDriveFile(file);
        data.attachmentUrl = uploaded.downloadUrl;
        data.attachmentName = uploaded.name;
        data.attachmentMimeType = uploaded.mimeType;
        if (status) status.textContent = "업로드 완료";
      }
      delete data.driveFile;
      data.targetUserIds = data.type === "mission" ? formData.getAll("targetUserIds") : [];
      data.completionRules = data.type === "mission" ? formData.getAll("completionRules") : [];
      state = S.addPost(state, { ...data, authorId: currentUserId });
      saveState();
      form.reset();
      if (status) status.textContent = "";
      closeComposeModal();
      activeView = "feed";
      render();
    } catch (error) {
      if (status) status.textContent = error.message || "파일 업로드에 실패했습니다.";
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
  renderCurrentUser(); renderFeed(); renderSearch(); renderProgress(); renderStats(); renderApprovals(); renderCalendar();
}

function renderMissionTargets() {
  const target = byId("missionTargets");
  if (!target) return;
  target.innerHTML = state.users.filter((item) => item.role === "member").map((item) => `<label><input type="checkbox" name="targetUserIds" value="${item.id}" checked /> ${escapeHtml(item.name)} · ${escapeHtml(item.department || "")}</label>`).join("");
}

function renderCurrentUser() { const item = currentUser(); const avatar = byId("currentAvatar"); avatar.classList.toggle("admin-icon", item.role === "admin"); avatar.textContent = item.role === "admin" ? "" : item.avatar || item.name.slice(0, 1); avatar.setAttribute("aria-label", item.role === "admin" ? "관리자" : item.name); byId("currentName").textContent = item.name; byId("currentRole").textContent = `${item.department} · ${item.role}`; }

function renderFeed() {
  document.querySelectorAll(".filter-chip").forEach((button) => button.classList.toggle("active", button.dataset.filter === postFilter));
  const posts = state.posts.filter((post) => postFilter === "all" || post.type === postFilter);
  byId("postList").innerHTML = posts.length ? posts.map(postCardHtml).join("") : emptyHtml();
  hydrateDriveVideos();
}

function postCardHtml(post) {
  const completion = S.getPostCompletion(state, post.id);
  const reactions = state.reactions.filter((reaction) => reaction.postId === post.id);
  const comments = state.comments.filter((comment) => comment.postId === post.id);
  const mine = reactions.filter((reaction) => reaction.userId === currentUserId);
  const likeCount = reactions.filter((reaction) => reaction.sticker === "like").length;
  const doneCount = reactions.filter((reaction) => reaction.sticker === "done").length;
  const mediaUrl = post.mediaUrl || post.videoUrl || post.attachmentUrl;
  const presentation = S.getPostPresentation(post);
  const cardClass = presentation.kind === "text" ? "feed-card text-card" : "feed-card media-card";
  const preview = presentation.kind === "media" ? mediaPreviewHtml(mediaUrl, post) : "";
  return `<article class="${cardClass}"><header class="feed-head"><div class="author-line">${avatarHtml(post.authorId)}<div><strong>${escapeHtml(userName(post.authorId))}</strong><span>${postTypeLabel(post.type)} · ${formatDate(post.createdAt)}${dateText(post)}</span></div></div><span class="post-type">${postTypeLabel(post.type)}</span></header>${preview}<section class="feed-body"><h3>${escapeHtml(post.title)}</h3><p>${escapeHtml(post.body)}</p>${attachmentHtml(post)}<p class="feed-counts">좋아요 ${likeCount} · 완료 ${doneCount}/${completion.totalMembers} · 댓글 ${comments.length}</p><div class="feed-actions">${actionButton(post.id, "like", mine, "heart", "좋아요")}${actionButton(post.id, "done", mine, "check", "완료")}<button class="icon-action comment" data-focus-comment="${post.id}" type="button" title="댓글" aria-label="댓글">${iconSvg("comment")}<span>댓글</span></button>${saveControlHtml(post)}</div>${comments.length ? `<div class="comment-list">${comments.map(commentHtml).join("")}</div>` : ""}<form class="inline-form" data-action="comment" data-post-id="${post.id}"><input id="comment-${post.id}" name="body" placeholder="댓글을 입력하세요. 댓글도 완료로 기록됩니다." required /><button type="submit">게시</button></form></section></article>`;
}

function actionButton(postId, sticker, mine, icon, label) { const active = mine.some((reaction) => reaction.sticker === sticker) ? " active" : ""; return `<button class="icon-action ${sticker}${active}" data-action="reaction" data-post-id="${postId}" data-sticker="${sticker}" type="button" title="${label}" aria-label="${label}">${iconSvg(icon)}<span>${label}</span></button>`; }
function iconSvg(name) { const icons = { heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.2-4.4-9.5-9.1C.7 8.2 2.9 4.5 6.7 4.5c2 0 3.7 1.1 4.7 2.7 1-1.6 2.7-2.7 4.7-2.7 3.8 0 6 3.7 4.2 7.4C19.2 16.6 12 21 12 21Z"/></svg>`, check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`, comment: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.8 8.4 9.6 9.6 0 0 1-4-.8L3 20l1.1-4.4A8.1 8.1 0 0 1 3 11.5C3 6.8 7 3 12 3s9 3.8 9 8.5Z"/></svg>` }; return icons[name] || name; }
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
function commentHtml(comment) { return `<div class="comment"><strong>${escapeHtml(userName(comment.userId))}</strong>${escapeHtml(comment.body)}</div>`; }
function dateText(post) { if (post.startDate && post.dueDate) return ` · ${post.startDate} ~ ${post.dueDate}`; if (post.dueDate) return ` · ${post.dueDate} 마감`; if (post.startDate) return ` · ${post.startDate} 시작`; return ""; }

function renderSearch() { const input = byId("globalSearch"); if (!input) return; const query = input.value.trim().toLowerCase(); if (!query) { byId("searchResults").innerHTML = `<div class="empty">검색어를 입력하세요.</div>`; return; } const results = state.posts.filter((post) => `${post.title} ${post.body} ${postTypeLabel(post.type)}`.toLowerCase().includes(query)).map((post) => resultCard(postTypeLabel(post.type), post.title, post.body)); byId("searchResults").innerHTML = results.length ? results.join("") : emptyHtml(); }
function resultCard(type, title, body) { return `<article class="resource-card result-card"><span class="status-pill">${escapeHtml(type)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></article>`; }
function renderProgress() { const members = state.users.filter((item) => item.role === "member"); const posts = state.posts.filter((post) => post.type === "notice" || post.type === "mission"); byId("userProgress").innerHTML = members.map((item) => { const done = posts.filter((post) => S.getPostCompletion(state, post.id).completedUserIds.includes(item.id)).length; const percent = posts.length ? Math.round((done / posts.length) * 100) : 0; return progressCard(item.name, `${done}/${posts.length}개 완료`, percent); }).join("") || emptyHtml(); byId("postProgress").innerHTML = posts.map((post) => { const completion = S.getPostCompletion(state, post.id); return progressCard(post.title, `${completion.completedCount}/${completion.totalMembers}명 완료`, completion.percent); }).join("") || emptyHtml(); }
function progressCard(title, meta, percent) { return `<article class="progress-card"><h3>${escapeHtml(title)}</h3><span class="feed-meta">${escapeHtml(meta)} · ${percent}%</span><div class="bar" aria-hidden="true"><span style="width: ${percent}%"></span></div></article>`; }
function renderStats() { const questionCount = state.posts.filter((post) => post.type === "question").length; byId("quickStats").innerHTML = `<div class="stat-row"><span>게시물</span><strong>${state.posts.length}</strong></div><div class="stat-row"><span>질문</span><strong>${questionCount}</strong></div>`; }
function renderApprovals() { const panel = byId("approvalPanel"); const pending = remoteAuth() ? state.users.filter((user) => user.status === "pending") : (state.signupRequests || []).filter((request) => request.status === "pending"); const admin = currentUser()?.role === "admin"; const compactHtml = pending.length ? pending.map((request) => `<div class="mini-item"><div><strong>${escapeHtml(request.name)}</strong><span>${escapeHtml(request.department)} · ${escapeHtml(request.loginId || "")}</span></div><button class="mini-button" data-action="approve-signup" data-request-id="${request.id}" type="button">승인</button></div>`).join("") : `<div class="mini-empty">대기 중인 신청 없음</div>`; const fullHtml = pending.length ? pending.map((request) => `<article class="feed-card text-card approval-card"><header class="feed-head"><div class="author-line"><div class="avatar">${escapeHtml((request.name || "?").slice(0, 1))}</div><div><strong>${escapeHtml(request.name)}</strong><span>${escapeHtml(request.department)} · ${escapeHtml(request.loginId || "")}</span></div></div><button class="mini-button" data-action="approve-signup" data-request-id="${request.id}" type="button">승인</button></header></article>`).join("") : emptyHtml(); panel.classList.toggle("hidden", !admin); byId("pendingCount").textContent = pending.length; byId("pendingList").innerHTML = compactHtml; byId("approvalViewCount").textContent = pending.length; byId("approvalViewList").innerHTML = fullHtml; }
function renderCalendar() { const posts = state.posts.filter((post) => post.startDate || post.dueDate).sort((a, b) => String(a.dueDate || a.startDate).localeCompare(String(b.dueDate || b.startDate))); byId("calendarList").innerHTML = posts.length ? posts.map((post) => `<div class="mini-item calendar-item"><div><strong>${escapeHtml(post.title)}</strong><span>${postTypeLabel(post.type)} · ${escapeHtml(dateText(post).replace(/^ · /, ""))}</span></div></div>`).join("") : `<div class="mini-empty">등록된 일정 없음</div>`; }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "방금" : `${date.getMonth() + 1}.${date.getDate()}`; }

document.addEventListener("click", async (event) => {
  const focusTarget = event.target.closest("[data-focus-comment]");
  if (focusTarget) { const input = byId(`comment-${focusTarget.dataset.focusComment}`); if (input) input.focus(); return; }
  const target = event.target.closest("[data-action]");
  if (!target || target.tagName === "FORM") return;
  if (target.dataset.action === "reaction") state = S.addReaction(state, { postId: target.dataset.postId, userId: currentUserId, sticker: target.dataset.sticker });
  if (target.dataset.action === "download-file") {
    const url = target.dataset.url || target.href;
    if (!isDriveDownloadUrl(url)) {
      state = S.recordFileDownload(state, { postId: target.dataset.postId, userId: currentUserId });
      saveState();
      return;
    }
    event.preventDefault();
    try { await downloadDriveFile(url, target.dataset.postId); } catch (error) { alert(error.message || "파일 다운로드에 실패했습니다."); }
    render();
    return;
  }
  if (target.dataset.action === "approve-signup") { if (remoteAuth()) { window.BigHubSupabase.approveProfile(target.dataset.requestId).then(refreshRemoteUsers).then(render); return; } state = S.approveSignupRequest(state, target.dataset.requestId); }
  saveState();
  render();
});

document.addEventListener("submit", (event) => { const form = event.target.closest("[data-action]"); if (!form) return; event.preventDefault(); const data = Object.fromEntries(new FormData(form)); if (form.dataset.action === "comment") state = S.addComment(state, { ...data, postId: form.dataset.postId, userId: currentUserId }); saveState(); form.reset(); render(); });

init();

