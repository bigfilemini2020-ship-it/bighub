const storeKey = "bighub-state-v5";
const uploadedAttachmentKey = "bighub-uploaded-attachment-v1";
const feedPositionKey = "bighub-feed-position-v1";
const desktopSettingsKey = "bighub-desktop-settings-cache-v1";
const clientLogKey = "bighub-client-log-v1";
const webAppVersion = "2026.08.13-update-button-1";
const S = window.EducationState;

let state = loadState();
let activeView = "feed";
let postFilter = "all";
let shouldRestoreFeedPosition = true;
let feedPositionSaveTimer = 0;
let remoteSyncInFlight = false;
let signupInFlight = false;
let desktopSettings = null;
let desktopNotificationsArmed = false;
let desktopUpdateInfo = null;
let desktopUpdateChecking = false;
let desktopAppVersion = "";
let mediaRenderHoldUntil = 0;

async function loadDesktopAppVersion() {
  if (!isDesktopApp()) return;
  try {
    desktopAppVersion = await desktopInvoke("get_desktop_app_version");
  } catch (error) {
    console.warn(error);
  }
}

function renderVersionStatus() {
  const status = byId("desktopVersionStatus");
  if (!status) return;
  const desktopText = isDesktopApp() ? `데스크톱 v${desktopAppVersion || "확인 중"}` : "웹 브라우저";
  status.textContent = `${desktopText} · 웹 빌드 ${webAppVersion}`;
}
const notificationPollIntervalMs = 10000;
let openCommentPostIds = new Set();

function loadState() {
  const saved = localStorage.getItem(storeKey);
  if (saved) return JSON.parse(saved);
  return S.createInitialState();
}

function saveState() { if (!remoteAuth()) localStorage.setItem(storeKey, JSON.stringify(state)); }
function remoteAuth() { return window.BigHubSupabase && window.BigHubSupabase.isConfigured(); }
function byId(id) { return document.getElementById(id); }
function isDesktopApp() { return Boolean(window.__TAURI__?.core?.invoke); }
async function desktopInvoke(command, args = {}) { return window.__TAURI__.core.invoke(command, args); }
function clientLog(event, detail = {}) {
  const entry = {
    time: new Date().toISOString(),
    event,
    activeView,
    hasCurrentUserId: Boolean(currentUserId),
    hasHydratedSession: Boolean(hydrateCurrentUserId()),
    remoteConfigured: Boolean(remoteAuth()),
    ...detail,
  };
  const line = JSON.stringify(entry);
  try {
    const items = JSON.parse(localStorage.getItem(clientLogKey) || "[]");
    items.push(entry);
    localStorage.setItem(clientLogKey, JSON.stringify(items.slice(-120)));
  } catch {}
  console.info("[BigHub]", line);
  if (isDesktopApp()) desktopInvoke("write_client_log", { input: { line } }).catch(() => {});
}
window.addEventListener("error", (event) => clientLog("window-error", { message: event.message || "", source: event.filename || "", line: event.lineno || 0 }));
window.addEventListener("unhandledrejection", (event) => clientLog("unhandled-rejection", { message: event.reason?.message || String(event.reason || "") }));
function cachedDesktopSettings() {
  try { return JSON.parse(localStorage.getItem(desktopSettingsKey) || "null"); } catch { return null; }
}
async function loadDesktopSettings() {
  desktopSettings = cachedDesktopSettings() || {
    minimizeToTray: true,
    autostart: false,
    notificationsEnabled: true,
    notifyPosts: true,
    notifyComments: true,
    notifyMissions: true,
    downloadDir: "",
  };
  if (!isDesktopApp()) return desktopSettings;
  try {
    desktopSettings = await desktopInvoke("get_desktop_settings");
    localStorage.setItem(desktopSettingsKey, JSON.stringify(desktopSettings));
  } catch (error) {
    console.warn(error);
  }
  return desktopSettings;
}
async function setDesktopSetting(key, value) {
  desktopSettings = { ...(desktopSettings || {}), [key]: value };
  localStorage.setItem(desktopSettingsKey, JSON.stringify(desktopSettings));
  if (!isDesktopApp()) return desktopSettings;
  desktopSettings = await desktopInvoke("set_desktop_setting", { key, value });
  localStorage.setItem(desktopSettingsKey, JSON.stringify(desktopSettings));
  return desktopSettings;
}
async function chooseDesktopDownloadDir() {
  if (!isDesktopApp()) return desktopSettings;
  desktopSettings = await desktopInvoke("choose_download_dir");
  localStorage.setItem(desktopSettingsKey, JSON.stringify(desktopSettings));
  return desktopSettings;
}
function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}
function updateDesktopUpdateStatus(text, disabled = false) {
  const status = byId("desktopUpdateStatus");
  const button = byId("desktopUpdateButton");
  if (status && text) status.textContent = text;
  if (button) button.disabled = disabled;
}

async function checkDesktopUpdate(options = {}) {
  if (!isDesktopApp() || desktopUpdateChecking) return null;
  desktopUpdateChecking = true;
  if (!options.silent) updateDesktopUpdateStatus("업데이트 확인 중...", true);
  try {
    const info = await desktopInvoke("check_desktop_update");
    desktopUpdateInfo = info;
    if (info?.currentVersion) desktopAppVersion = info.currentVersion;
    renderVersionStatus();
    if (info?.available) {
      updateDesktopUpdateStatus(`${info.version || "새 버전"} 업데이트가 있습니다.`, false);
    } else if (!options.silent) {
      updateDesktopUpdateStatus(`현재 최신 버전입니다. (${info?.currentVersion || "현재 버전"})`, false);
    }
    return info;
  } catch (error) {
    clientLog("update-check-failed", { message: String(error?.message || error || "") });
    if (!options.silent) updateDesktopUpdateStatus(desktopUpdateErrorMessage(error), false);
    return null;
  } finally {
    desktopUpdateChecking = false;
  }
}

// Prompt and install outside checkDesktopUpdate. Asking inside it held
// desktopUpdateChecking for as long as the dialog waited, so the settings
// button hit the re-entrancy guard and returned null -- pressing it did
// nothing at all.
async function offerDesktopUpdate(info) {
  if (!info?.available) return;
  clientLog("update-available", { version: info.version || "" });
  await installDesktopUpdate();
}

function desktopUpdateErrorMessage(error) {
  const message = String(error?.message || error || "");
  if (/204|status|fetch|network|endpoint|manifest|release|update/i.test(message)) {
    return "업데이트 서버에 아직 새 버전 정보가 없습니다. 현재 설치된 버전을 사용하면 됩니다.";
  }
  return message || "업데이트 확인에 실패했습니다.";
}

async function installDesktopUpdate() {
  if (!isDesktopApp()) return;
  const version = desktopUpdateInfo?.version || "새 버전";
  const ok = await confirm(`BigHub ${version} 업데이트를 설치합니다. 설치 중 앱이 자동으로 종료될 수 있습니다.`);
  if (!ok) return;
  updateDesktopUpdateStatus("업데이트 다운로드 및 설치 중...", true);
  clientLog("update-install-start", { version });
  try {
    await desktopInvoke("install_desktop_update");
  } catch (error) {
    clientLog("update-install-failed", { message: String(error?.message || error || "") });
    updateDesktopUpdateStatus(error.message || "업데이트 설치에 실패했습니다.", false);
  }
}
async function requestBrowserNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try { return (await Notification.requestPermission()) === "granted"; } catch { return false; }
}
async function notifyDesktop(title, body) {
  if (!desktopSettings?.notificationsEnabled) {
    clientLog("notification-skipped", { reason: "disabled" });
    return { ok: false, error: "\uC54C\uB9BC \uBC1B\uAE30\uAC00 \uB044\uC838 \uC788\uC2B5\uB2C8\uB2E4." };
  }
  if (isDesktopApp()) {
    try {
      await withTimeout(desktopInvoke("notify_desktop", { title, body }), 2500, "Windows \uC54C\uB9BC \uD638\uCD9C\uC774 \uC751\uB2F5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.");
      clientLog("notification-sent", { channel: "desktop" });
      return { ok: true };
    } catch (error) {
      console.warn(error);
      clientLog("notification-failed", { channel: "desktop", message: error.message || String(error || "") });
      return { ok: false, error: error.message || "Windows \uC54C\uB9BC\uC744 \uBCF4\uB0BC \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." };
    }
  }
  if (await requestBrowserNotificationPermission()) {
    new Notification(title, { body, icon: "icons/icon.png" });
    clientLog("notification-sent", { channel: "browser" });
    return { ok: true };
  }
  clientLog("notification-failed", { channel: "browser", message: "permission denied" });
  return { ok: false, error: "\uBE0C\uB77C\uC6B0\uC800 \uC54C\uB9BC \uAD8C\uD55C\uC774 \uB044\uC838 \uC788\uC2B5\uB2C8\uB2E4." };
}
function notifyForRemoteChanges(beforePostIds, beforeCommentIds) {
  if (!desktopSettings?.notificationsEnabled) return;
  const myId = currentUserId;
  const newPosts = state.posts.filter((post) => !beforePostIds.has(post.id) && post.authorId !== myId);
  const mission = newPosts.find((post) => post.type === "mission");
  const regular = newPosts.find((post) => post.type !== "mission");
  if (mission && desktopSettings.notifyMissions) {
    notifyDesktop("BigHub \uC0C8 \uBBF8\uC158", mission.title || "\uC0C8 \uBBF8\uC158\uC774 \uB4F1\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    return;
  }
  if (regular && desktopSettings.notifyPosts) {
    notifyDesktop("BigHub \uC0C8 \uAC8C\uC2DC\uAE00", regular.title || "\uC0C8 \uAC8C\uC2DC\uAE00\uC774 \uB4F1\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4.");
    return;
  }
  if (desktopSettings.notifyComments) {
    const comment = state.comments.find((item) => !beforeCommentIds.has(item.id) && item.userId !== myId);
    if (comment) {
      const post = state.posts.find((item) => item.id === comment.postId);
      const body = `${userName(comment.userId)}: ${comment.body || post?.title || "\uB313\uAE00\uC774 \uB4F1\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4."}`.slice(0, 90);
      notifyDesktop("BigHub \uC0C8 \uB313\uAE00", body);
    }
  }
}
function escapeHtml(value) { return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function user(userId) { return state.users.find((item) => item.id === userId) || state.users[0]; }
function userName(userId) { return user(userId).name; }
function fallbackRemoteUser() { hydrateCurrentUserId(); return remoteAuth() && currentUserId ? { id: currentUserId, name: "사용자", role: "member", department: "", avatar: "" } : null; }
function currentUser() { return state.users.find((item) => item.id === currentUserId) || (currentUserSnapshot?.id === currentUserId ? currentUserSnapshot : null) || fallbackRemoteUser(); }
function isImageAvatar(value) { return /^(data:image\/|https?:\/\/)/.test(String(value || "")); }
function departmentAvatarClass(department) {
  const key = String(department || "");
  if (key === "\uAC1C\uBC1C") return "avatar-team-dev";
  if (key === "\uC6B4\uC601") return "avatar-team-ops";
  if (key === "\uB9C8\uCF00\uD305") return "avatar-team-marketing";
  if (key === "\uACBD\uC601\uC9C0\uC6D0") return "avatar-team-support";
  if (key === "\uC784\uC6D0") return "avatar-team-exec";
  return "avatar-team-etc";
}
function avatarMarkup(item, className = "avatar") {
  const target = item || {};
  const label = escapeHtml(target.name || "\uC0AC\uC6A9\uC790");
  const value = target.avatar || "";
  if (isImageAvatar(value)) return `<span class="${className} image-avatar" aria-label="${label}" title="${label}"><img src="${escapeHtml(value)}" alt="" /></span>`;
  if (target.role === "admin") return `<span class="${className} admin-icon" aria-label="${label}" title="${label}"></span>`;
  return `<span class="${className} ${departmentAvatarClass(target.department)}" aria-label="${label}" title="${label}">${escapeHtml(value || String(target.name || "?").slice(0, 1))}</span>`;
}
function avatarHtml(userId) { return avatarMarkup(user(userId), "avatar"); }
function linkHtml(url, label) { return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>` : ""; }
function emptyHtml() { return byId("emptyTemplate").innerHTML; }
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
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!saved || saved.userId !== currentUserId) {
      const cards = Array.from(document.querySelectorAll(".feed-card[data-post-id]"));
      const firstPost = cards[cards.length - 1];
      if (firstPost) firstPost.scrollIntoView({ block: "start" });
      return;
    }
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
  clientLog("init-start");
  bindAuthForms();
  bindNavigation();
  bindForms();
  bindDesktopSettings();
  await loadDesktopSettings();
  await loadDesktopAppVersion();
  setTimeout(async () => offerDesktopUpdate(await checkDesktopUpdate({ silent: true })), 2500);
  if (remoteAuth()) await restoreRemoteSession();
  applySavedFeedFilter();
  render();
  clientLog("init-rendered");
}

async function restoreRemoteSession() {
  hydrateCurrentUserId();
  try {
    const profile = await window.BigHubSupabase.currentProfile();
    if (!profile) {
      hydrateCurrentUserId();
      return;
    }
    currentUserId = profile.id;
    setSession(currentUserId, localStorage.getItem(autoLoginKey) === "1");
    mergeRemoteUser(profile);
    await tryRefreshRemoteData();
  } catch (error) {
    hydrateCurrentUserId();
    console.warn(error);
  }
}
function mergeRemoteUser(user) {
  if (!user) return;
  if (user.id === currentUserId) {
    currentUserSnapshot = user;
    localStorage.setItem(currentUserSnapshotKey, JSON.stringify(user));
  }
  state = { ...state, users: [user, ...state.users.filter((item) => item.id !== user.id)] };
}

async function refreshRemoteData() {
  if (!remoteAuth()) return;
  const activeUser = currentUser();
  const content = await window.BigHubSupabase.listContent();
  state = { ...state, ...content };
  try {
    const users = await window.BigHubSupabase.listProfiles();
    const signupRequests = currentUser()?.role === "admin" ? await window.BigHubSupabase.listSignupRequests().catch(() => []) : [];
    state = { ...state, users, signupRequests };
    if (currentUserId && !currentUser()) {
      const profile = await window.BigHubSupabase.currentProfile().catch(() => null);
      if (profile) mergeRemoteUser(profile);
      else if (activeUser) mergeRemoteUser(activeUser);
    }
  } catch (error) {
    if (activeUser && currentUserId && !currentUser()) mergeRemoteUser(activeUser);
    console.warn("Profile refresh skipped", error);
  }
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

function hasActiveCommentDraft() {
  const fields = Array.from(document.querySelectorAll("form[data-action='comment'] input, form[data-action='comment'] textarea"));
  return fields.some((field) => field === document.activeElement && field.value.trim());
}

function isFullscreenActive() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.pictureInPictureElement);
}

function holdMediaRender(ms = 30000) {
  mediaRenderHoldUntil = Math.max(mediaRenderHoldUntil, Date.now() + ms);
}

function hasActiveMediaPlayback() {
  return Array.from(document.querySelectorAll("video, audio")).some((media) => {
    const activelyPlaying = !media.paused && !media.ended;
    const bufferingDuringPlayback = activelyPlaying && media.readyState < 3;
    return activelyPlaying || media.seeking || bufferingDuringPlayback;
  });
}

function shouldDeferRemoteRender() {
  return hasActiveCommentDraft() || hasActiveMediaPlayback() || isFullscreenActive() || Date.now() < mediaRenderHoldUntil;
}

async function syncRemoteData() {
  if (!remoteAuth() || !currentUser() || remoteSyncInFlight) return;
  remoteSyncInFlight = true;
  try {
    const beforePostIds = new Set(state.posts.map((post) => post.id));
    const beforeCommentIds = new Set(state.comments.map((comment) => comment.id));
    const error = await tryRefreshRemoteData();
    if (error) console.warn(error);
    else {
      if (desktopNotificationsArmed) notifyForRemoteChanges(beforePostIds, beforeCommentIds);
      desktopNotificationsArmed = true;
      if (!shouldDeferRemoteRender()) render();
    }
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
// Alert as well as the inline line: the inline text sits below the fold on short
// windows and users kept missing it.
function showLoginError(message) {
  byId("loginMessage").textContent = message;
  alert(message);
}

function bindAuthForms() {
  setupAuthForms();
  byId("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    // A failed sign-in costs two round trips: the auth call, then the pending
    // lookup. Without this the button sits idle and looks stuck.
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    const submitLabel = submitButton?.textContent || "로그인";
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "로그인 중...";
    }
    try {
      const user = remoteAuth() ? await window.BigHubSupabase.signIn(data) : S.authenticateUser(state, data);
      if (!user) { showLoginError("\uC2B9\uC778\uB41C \uACC4\uC815\uC774 \uC5C6\uAC70\uB098 \uBE44\uBC00\uBC88\uD638\uAC00 \uB9DE\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4."); return; }
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
      if (syncError) alert("\uB85C\uADF8\uC778\uC740 \uB410\uC9C0\uB9CC \uAC8C\uC2DC\uAE00 \uB3D9\uAE30\uD654\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. Supabase SQL \uC5C5\uB370\uC774\uD2B8\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.\n\n" + syncError);
    } catch (error) {
      showLoginError(error.message || "\uB85C\uADF8\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = submitLabel;
      }
    }
  });
  byId("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (signupInFlight) return;
    const signupForm = event.currentTarget;
    const submitButton = signupForm.querySelector('button[type="submit"]');
    const submitLabel = submitButton?.textContent || "가입 신청";
    const data = Object.fromEntries(new FormData(signupForm));
    signupInFlight = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "처리 중...";
    }
    try {
      if (remoteAuth()) {
        await window.BigHubSupabase.signUp(data);
      } else {
        state = S.createSignupRequest(state, data);
        saveState();
      }
      if (typeof signupForm.reset === "function") signupForm.reset();
      const successMessage = "가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.";
      alert(successMessage);
      setAuthMode("login");
      byId("loginMessage").textContent = successMessage;
      render();
    } catch (error) {
      const message = error.message || "가입 신청에 실패했습니다.";
      const isDuplicate = error?.status === 409 || message.includes("이미 사용 중") || message.includes("이미 가입") || message.includes("가입 신청된");
      if (isDuplicate) {
        setAuthMode("signup");
        byId("signupMessage").textContent = message;
        alert(message);
        return;
      }
      byId("signupMessage").textContent = message;
      alert("가입 신청 실패: " + message);
    } finally {
      signupInFlight = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = submitLabel;
      }
    }
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("\uC774\uBBF8\uC9C0\uB97C \uCC98\uB9AC\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."));
    image.src = src;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("\uC774\uBBF8\uC9C0\uB97C \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4."));
    reader.readAsDataURL(file);
  });
}

async function resizeAvatarImage(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("\uC774\uBBF8\uC9C0 \uD30C\uC77C\uC744 \uC120\uD0DD\uD558\uC138\uC694.");
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const size = 256;
  const side = Math.min(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function updateCurrentUserAvatar(avatar) {
  state = { ...state, users: state.users.map((item) => item.id === currentUserId ? { ...item, avatar } : item) };
}

async function handleAvatarFile(file) {
  const avatar = await resizeAvatarImage(file);
  if (remoteAuth()) await window.BigHubSupabase.updateAvatar(avatar);
  updateCurrentUserAvatar(avatar);
  saveState();
  render();
  if (remoteAuth()) {
    await refreshRemoteData();
    render();
  }
}

// Pause a player once its post has scrolled out of sight. A <video> we can
// pause directly; a YouTube embed is cross-origin, so we post the player API's
// pause command into it -- which is why the embed URL carries enablejsapi=1.
let offscreenPauseObserver = null;

function pauseMediaElement(element) {
  if (element.tagName === "VIDEO") {
    if (!element.paused) element.pause();
    return;
  }
  element.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), "*");
}

function watchMediaLeavingView() {
  if (!("IntersectionObserver" in window)) return;
  if (!offscreenPauseObserver) {
    offscreenPauseObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (!entry.isIntersecting) pauseMediaElement(entry.target); });
    }, { threshold: 0 });
  }
  document.querySelectorAll(".media-preview video, .youtube-preview iframe").forEach((element) => {
    if (element.dataset.offscreenWatched) return;
    element.dataset.offscreenWatched = "1";
    offscreenPauseObserver.observe(element);
  });
}

function bindMediaRenderGuards() {
  const holdEvents = new Set(["play", "playing", "waiting", "seeking", "stalled", "progress", "timeupdate", "fullscreenchange", "webkitfullscreenchange"]);
  holdEvents.forEach((name) => document.addEventListener(name, (event) => {
    if (name.includes("fullscreen") || event.target?.matches?.("video, audio")) holdMediaRender(name === "timeupdate" ? 15000 : 45000);
  }, true));
  ["pause", "ended"].forEach((name) => document.addEventListener(name, (event) => {
    if (event.target?.matches?.("video, audio")) holdMediaRender(3000);
  }, true));
}

function bindNavigation() {
  bindMediaRenderGuards();
  document.querySelectorAll(".rail-button[data-view]").forEach((button) => button.addEventListener("click", () => { activeView = button.dataset.view; render(); }));
  document.querySelector("[data-action='compose-focus']").addEventListener("click", openComposeModal);
  document.querySelectorAll("[data-action='close-compose']").forEach((item) => item.addEventListener("click", closeComposeModal));
  document.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => { postFilter = button.dataset.filter; saveFeedPosition(); renderFeed(); }));
  window.addEventListener("scroll", scheduleSaveFeedPosition, { passive: true });
  window.addEventListener("beforeunload", saveFeedPosition);
  window.addEventListener("focus", syncRemoteData);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncRemoteData(); });
  window.setInterval(syncRemoteData, notificationPollIntervalMs);
  byId("globalSearch").addEventListener("input", renderSearch);
  byId("logoutButton").addEventListener("click", async () => { if (remoteAuth()) await window.BigHubSupabase.signOut(); currentUserId = ""; clearSession(); render(); });
  byId("currentAvatar")?.addEventListener("click", () => byId("avatarFileInput")?.click());
  byId("avatarFileInput")?.addEventListener("change", async (event) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      await handleAvatarFile(file);
    } catch (error) {
      alert(error.message || "\uD504\uB85C\uD544 \uC0AC\uC9C4 \uC800\uC7A5\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
    } finally {
      event.currentTarget.value = "";
    }
  });
  byId("resetDemo").addEventListener("click", async () => { const button = byId("resetDemo"); if (button) { button.disabled = true; button.classList.add("is-busy"); } const minimumSpin = wait(600); try { if (remoteAuth()) await refreshRemoteData(); else state = loadState(); render(); } catch (error) { alert(error.message || "새로고침에 실패했습니다."); } finally { await minimumSpin; if (button) { button.disabled = false; button.classList.remove("is-busy"); } } });
}

function bindDesktopSettings() {
  byId("desktopNotificationTestButton")?.addEventListener("click", async () => {
    const status = byId("desktopNotificationStatus");
    const button = byId("desktopNotificationTestButton");
    if (button) button.disabled = true;
    for (let remaining = 3; remaining > 0; remaining -= 1) {
      if (status) status.textContent = `${remaining}\uCD08 \uD6C4 \uC54C\uB9BC\uC744 \uBCF4\uB0C5\uB2C8\uB2E4. BigHub\uB97C \uD2B8\uB808\uC774\uB098 \uB4A4\uB85C \uBCF4\uB0B4\uACE0 \uD655\uC778\uD558\uC138\uC694.`;
      await wait(1000);
    }
    const result = await notifyDesktop("BigHub 알림 테스트", "이 알림이 보이면 Windows 알림 연결이 정상입니다.");
    if (status) status.textContent = result.ok ? "알림을 보냈습니다. Windows 알림 센터와 작업표시줄을 확인하세요." : `알림 실패: ${result.error || "알림을 보낼 수 없습니다."}`;
    if (button) button.disabled = false;
  });
  byId("desktopUpdateButton")?.addEventListener("click", async () => {
    const settingsStatus = byId("desktopSettingsStatus");
    if (settingsStatus) settingsStatus.textContent = "";
    const info = await checkDesktopUpdate();
    await offerDesktopUpdate(info);
  });
  byId("desktopDownloadDirButton")?.addEventListener("click", async () => {
    const status = byId("desktopSettingsStatus");
    const button = byId("desktopDownloadDirButton");
    if (status) status.textContent = "다운로드 폴더 선택 중...";
    if (button) button.disabled = true;
    try {
      await chooseDesktopDownloadDir();
      renderDesktopSettings();
      if (status) status.textContent = "다운로드 폴더가 저장되었습니다.";
    } catch (error) {
      if (status) status.textContent = error.message || "다운로드 폴더 저장에 실패했습니다.";
    } finally {
      if (button) button.disabled = false;
    }
  });
  document.querySelectorAll("[data-desktop-setting]").forEach((input) => {
    input.addEventListener("change", async () => {
      const status = byId("desktopSettingsStatus");
      if (status) status.textContent = "설정 저장 중...";
      try {
        await setDesktopSetting(input.dataset.desktopSetting, input.checked);
        renderDesktopSettings();
        if (input.dataset.desktopSetting === "notificationsEnabled" && input.checked) {
          if (status) status.textContent = "설정이 저장됐습니다. 알림을 확인하는 중...";
          const notificationStatus = byId("desktopNotificationStatus");
          notifyDesktop("BigHub 알림", "새 글과 댓글 알림이 켜졌습니다.").then((result) => {
            if (status) status.textContent = result.ok ? "알림 받기가 켜졌습니다." : `설정은 저장됐지만 Windows 알림이 뜨지 않았습니다. ${result.error || ""}`;
            if (notificationStatus) notificationStatus.textContent = result.ok ? "알림을 보냈습니다. Windows 알림 센터를 확인하세요." : `알림 실패: ${result.error || "알림을 보낼 수 없습니다."}`;
          });
        } else {
          if (status) status.textContent = "설정이 저장됐습니다.";
        }
      } catch (error) {
        input.checked = !input.checked;
        renderDesktopSettings();
        if (status) status.textContent = "설정 저장에 실패했습니다.";
      }
    });
  });
}

window.BigHubDesktopOpenSettings = () => {
  activeView = "settings";
  render();
};
function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)}GB`;
}


function muxCorsOrigin() {
  const origin = String(location.origin || "").trim();
  return /^https?:\/\//i.test(origin) ? origin : "http://tauri.localhost";
}

async function checkMuxUploadStatus(uploadId) {
  const response = await fetch(driveFunctionUrl("mux-upload-status"), {
    method: "POST",
    headers: { ...(await driveHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Mux status request failed.");
  return result;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function pollMuxUploadStatus(uploadId) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const status = await checkMuxUploadStatus(uploadId);
    if (status.playbackId && status.state === "ready") return status;
    setUploadStatus("Mux video processing...", Math.min(95, 70 + attempt));
    await wait(5000);
  }
  return { state: "processing" };
}

async function uploadMuxVideoFile(file) {
  if (!remoteAuth()) throw new Error("Supabase login is required.");
  setUploadStatus("Preparing Mux upload...", 10);
  const createResponse = await fetch(driveFunctionUrl("mux-create-upload"), {
    method: "POST",
    headers: { ...(await driveHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type || "video/mp4", corsOrigin: muxCorsOrigin() }),
  });
  const result = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok) throw new Error(result.error || "Mux upload setup failed.");
  if (!result.uploadId || !result.uploadUrl) throw new Error("Mux upload URL was not returned.");

  setUploadStatus("Uploading video to Mux...", 35);
  const uploadResponse = await fetch(result.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploadResponse.ok) throw new Error("Mux video upload failed.");

  const status = await pollMuxUploadStatus(result.uploadId);
  setUploadStatus(status.playbackId ? "Mux video ready" : "Mux video processing", status.playbackId ? 100 : 95);
  return {
    url: `mux:${result.uploadId}`,
    provider: "mux",
    uploadId: result.uploadId,
    assetId: status.assetId || "",
    playbackId: status.playbackId || "",
    state: status.state || "processing",
    name: file.name,
    mimeType: file.type || "video/mp4",
  };
}



function isAttachmentBundle(value) {
  const raw = String(value || "").trim();
  return raw.startsWith("[");
}

function normalizeAttachment(item) {
  const url = String(item?.url || item?.downloadUrl || "").trim();
  return {
    url,
    provider: String(item?.provider || "").trim(),
    uploadId: String(item?.uploadId || "").trim(),
    assetId: String(item?.assetId || "").trim(),
    playbackId: String(item?.playbackId || "").trim(),
    state: String(item?.state || "").trim(),
    name: String(item?.name || driveFileName(url)).trim(),
    mimeType: String(item?.mimeType || item?.attachmentMimeType || "").trim(),
  };
}

function attachmentList(post) {
  const raw = String(post?.attachmentUrl || "").trim();
  if (!raw) return [];
  if (isAttachmentBundle(raw) || post.attachmentMimeType === "application/vnd.bighub.attachments+json") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(normalizeAttachment).filter((item) => item.url);
    } catch {}
  }
  return [normalizeAttachment({ url: raw, name: post.attachmentName || driveFileName(raw), mimeType: post.attachmentMimeType || "" })];
}

function isMuxAttachment(item) {
  return item?.provider === "mux" || String(item?.url || "").startsWith("mux:");
}

function attachmentPayload(attachments) {
  const list = attachments.map(normalizeAttachment).filter((item) => item.url);
  if (!list.length) return { attachmentUrl: "", attachmentName: "", attachmentMimeType: "" };
  if (list.length === 1 && !isMuxAttachment(list[0])) return { attachmentUrl: list[0].url, attachmentName: list[0].name, attachmentMimeType: list[0].mimeType };
  return { attachmentUrl: JSON.stringify(list), attachmentName: list.length === 1 ? list[0].name : `${list.length} files`, attachmentMimeType: "application/vnd.bighub.attachments+json" };
}

function isVideoFile(item) {
  const mime = String(item?.mimeType || item?.type || "").toLowerCase();
  const name = String(item?.name || driveFileName(item?.url)).toLowerCase();
  return mime.startsWith("video/") || /\.(mp4|mov|m4v|webm)(\?.*)?$/.test(name);
}

function isImageFile(item) {
  const mime = String(item?.mimeType || item?.type || "").toLowerCase();
  const name = String(item?.name || driveFileName(item?.url)).toLowerCase();
  return mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/.test(name);
}

function representativeAttachment(post) {
  return attachmentList(post).find((item) => isVideoFile(item) || isImageFile(item)) || null;
}

function isVideoAttachment(post, attachment = null) {
  return isVideoFile(attachment || representativeAttachment(post) || attachmentList(post)[0]);
}

function isImageAttachment(post, attachment = null) {
  return isImageFile(attachment || representativeAttachment(post) || attachmentList(post)[0]);
}

function attachmentHtml(post) {
  const representative = representativeAttachment(post);
  const attachments = attachmentList(post).filter((item) => item.url !== representative?.url);
  if (!attachments.length) return "";
  return `<div class="attachment-list">${attachments.map((item) => attachmentRowHtml(post.id, item)).join("")}</div>`;
}

function attachmentRowHtml(postId, item) {
  const label = isVideoFile(item) ? "영상" : isImageFile(item) ? "이미지" : "첨부";
  const safeUrl = escapeHtml(item.url);
  const button = isDriveDownloadUrl(item.url)
    ? `<button class="attachment-download" data-action="download-file" data-post-id="${postId}" data-url="${safeUrl}" type="button" title="다운로드" aria-label="다운로드">${iconSvg("download")}</button>`
    : `<a class="attachment-download" href="${safeUrl}" target="_blank" rel="noreferrer" data-action="download-file" data-post-id="${postId}" data-url="${safeUrl}" title="열기" aria-label="열기">${iconSvg("download")}</a>`;
  return `<div class="attachment-line drive-attachment"><span><strong>${escapeHtml(label)}</strong>${escapeHtml(item.name)}</span>${button}</div>`;
}

function saveControlHtml(post) {
  const attachments = attachmentList(post);
  if (!attachments.length) return "";
  const representative = representativeAttachment(post);
  const hasInlineAttachments = attachments.some((item) => item.url !== representative?.url);
  if (hasInlineAttachments) return "";
  const item = representative || attachments[0];
  const safeUrl = escapeHtml(item.url);
  if (isDriveDownloadUrl(item.url)) {
    return `<button class="save-link" data-action="download-file" data-post-id="${post.id}" data-url="${safeUrl}" type="button" title="다운로드" aria-label="다운로드">${iconSvg("download")}</button>`;
  }
  return `<a class="save-link" href="${safeUrl}" target="_blank" rel="noreferrer" title="열기" data-action="download-file" data-post-id="${post.id}" data-url="${safeUrl}">${iconSvg("download")}</a>`;
}


function renderDesktopSettings() {
  const button = byId("desktopSettingsButton");
  if (button) button.classList.toggle("hidden", !isDesktopApp());
  renderVersionStatus();
  if (!desktopSettings) return;
  document.querySelectorAll("[data-desktop-setting]").forEach((input) => {
    input.checked = Boolean(desktopSettings[input.dataset.desktopSetting]);
  });
  const downloadDirPath = byId("desktopDownloadDirPath");
  if (downloadDirPath) downloadDirPath.textContent = desktopSettings.downloadDir || "기본 다운로드 폴더 사용";
}

function render() {
  const sessionUserId = hydrateCurrentUserId();
  const signedIn = Boolean(sessionUserId || currentUser());
  byId("authView").classList.toggle("hidden", signedIn);
  byId("appShell").classList.toggle("hidden", !signedIn);
  if (!signedIn) return;
  const admin = currentUser()?.role === "admin";
  byId("approvalMenuButton").classList.toggle("hidden", !admin);
  byId("desktopSettingsButton")?.classList.toggle("hidden", !isDesktopApp());
  if (activeView === "approvals" && !admin) activeView = "feed";
  if (activeView === "settings" && !isDesktopApp()) activeView = "feed";
  document.querySelectorAll(".rail-button[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  byId(`${activeView}View`).classList.add("active");
  renderCurrentUser(); renderFeed(); renderCommentsDrawer(); renderSearch(); renderProgress(); renderStats(); renderApprovals(); renderCalendar(); renderDesktopSettings(); restoreFeedPosition();
}

function renderMissionTargets() {
  const target = byId("missionTargets");
  if (!target) return;
  target.innerHTML = state.users.filter((item) => item.role === "member").map((item) => `<label><input type="checkbox" name="targetUserIds" value="${item.id}" checked /> ${escapeHtml(item.name)} · ${escapeHtml(item.department || "")}</label>`).join("");
}

function renderCurrentUser() {
  const item = currentUser();
  const avatar = byId("currentAvatar");
  if (avatar && item) {
    avatar.className = `avatar current avatar-picker${isImageAvatar(item.avatar) ? " image-avatar" : ""}${!isImageAvatar(item.avatar) && item.role === "admin" ? " admin-icon" : ""}${!isImageAvatar(item.avatar) && item.role !== "admin" ? ` ${departmentAvatarClass(item.department)}` : ""}`;
    avatar.innerHTML = isImageAvatar(item.avatar) ? `<img src="${escapeHtml(item.avatar)}" alt="" />` : (item.role === "admin" ? "" : escapeHtml(item.avatar || item.name.slice(0, 1)));
    avatar.setAttribute("aria-label", "\uD504\uB85C\uD544 \uC0AC\uC9C4 \uBCC0\uACBD");
    avatar.setAttribute("title", "\uD504\uB85C\uD544 \uC0AC\uC9C4 \uBCC0\uACBD");
  }
  byId("currentName").textContent = item.name;
  byId("currentRole").textContent = item.role === "admin" ? "admin" : `${item.department} \u00B7 ${item.role}`;
}

function canCreateNoticePost() { return currentUser()?.role === "admin"; }
function canManagePost(post) { const item = currentUser(); if (!item) return false; if (post.type === "notice") return item.role === "admin"; return item.role === "admin" || post.authorId === item.id; }
function canEditPost(post) { return canManagePost(post); }
function hasCompletionCheck(post) { return Array.isArray(post.completionRules) && post.completionRules.includes("done"); }

// Writing innerHTML tears down and rebuilds every embedded player, so a render
// that produces the same feed would still stop a playing YouTube video. The
// <video> guard cannot see into a cross-origin iframe, and window focus alone
// triggers a sync: clicking any empty space after starting a video was enough.
let lastFeedMarkup = null;

function renderFeed() {
  const target = byId("postList");
  document.querySelectorAll(".filter-chip").forEach((button) => button.classList.toggle("active", button.dataset.filter === postFilter));
  let markup;
  try {
    const posts = sortFeedPosts(state.posts.filter((post) => postFilter === "all" || post.type === postFilter));
    markup = posts.length ? posts.map((post) => {
      try { return postCardHtml(post); }
      catch (error) {
        console.warn("Post render failed", post, error);
        return `<article class="feed-card text-card"><section class="feed-body"><h3>${escapeHtml(post.title || "게시글 표시 오류")}</h3><p class="post-text">게시글을 표시하는 중 문제가 발생했습니다.</p></section></article>`;
      }
    }).join("") : emptyHtml();
  } catch (error) {
    console.warn("Feed render failed", error);
    markup = emptyHtml();
  }
  if (markup !== lastFeedMarkup || !target.firstElementChild) {
    target.innerHTML = markup;
    lastFeedMarkup = markup;
  }
  hydrateDriveVideos();
  hydrateMuxVideos();
  watchMediaLeavingView();
}

function sortFeedPosts(posts) {
  return [...posts].sort((a, b) => {
    const aIntro = a.title === "BigHub 사용 안내";
    const bIntro = b.title === "BigHub 사용 안내";
    if (aIntro !== bIntro) return aIntro ? 1 : -1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

// Rebuilding the feed re-creates every embedded player, so the video reloads.
// The drawer lives outside the feed: opening it only needs the drawer itself
// and the comment buttons' state.
// Drop the drawer to the post's line rather than scrolling the post up to the
// drawer: the reader keeps their place in the feed. Matching the drawer's
// height to the post as well would leave a three-line post almost no room for
// comments, so only the tops meet.
function alignDrawerToPost(postId) {
  const drawer = byId("commentsDrawer");
  if (!drawer) return;
  const card = document.querySelector(`.feed-card[data-post-id="${postId}"]`);
  const column = document.querySelector(".feed-column");
  if (!card || !column) { drawer.style.marginTop = ""; return; }
  const offset = Math.round(card.getBoundingClientRect().top - column.getBoundingClientRect().top);
  drawer.style.marginTop = `${Math.max(0, offset)}px`;
}

function syncCommentButtons() {
  const openId = [...openCommentPostIds][0] || "";
  document.querySelectorAll('[data-action="toggle-comments"]').forEach((button) => {
    button.classList.toggle("active", button.dataset.postId === openId);
    const count = state.comments.filter((comment) => comment.postId === button.dataset.postId).length;
    const label = button.querySelector("span");
    if (label) label.textContent = `댓글 ${count}`;
  });
  renderCommentsDrawer();
}

// Comments open in a drawer over the side panel rather than inside the card:
// inline they pushed the post up and off screen. One post at a time, so
// openCommentPostIds holds at most one id.
function renderCommentsDrawer() {
  const drawer = byId("commentsDrawer");
  if (!drawer) return;
  const postId = [...openCommentPostIds][0] || "";
  const post = postId ? state.posts.find((item) => item.id === postId) : null;
  if (!post) {
    openCommentPostIds.clear();
    drawer.classList.add("hidden");
    drawer.innerHTML = "";
    drawer.style.marginTop = "";
    return;
  }
  const comments = state.comments.filter((comment) => comment.postId === post.id);
  const list = comments.length
    ? `<div class="comment-list">${commentsHtml(post.id, comments)}</div>`
    : `<p class="comments-drawer-empty">첫 댓글을 남겨보세요.</p>`;
  drawer.classList.remove("hidden");
  drawer.innerHTML = `<header class="comments-drawer-head"><strong>댓글 ${comments.length}</strong><button class="modal-close" data-action="close-comments" type="button" aria-label="닫기">×</button></header><div class="comments-drawer-body">${list}</div><form class="inline-form comments-drawer-form" data-action="comment" data-post-id="${escapeHtml(post.id)}"><input id="comment-${escapeHtml(post.id)}" name="body" placeholder="댓글을 입력하세요." required /><button type="submit">게시</button></form>`;
  alignDrawerToPost(post.id);
}

function canManageComment(comment) {
  const item = currentUser();
  return Boolean(item) && (item.role === "admin" || comment.userId === item.id);
}

// Markup contract: the reply toggle finds its form via
// closest(".comment").querySelector(".reply-form"), so the form must sit inside
// the comment it belongs to, and replies must not carry one of their own.
function commentHtml(postId, comment, replies, isReply) {
  const reply = isReply
    ? ""
    : `<button type="button" data-focus-reply>답글</button>`;
  const remove = canManageComment(comment)
    ? `<button type="button" data-action="delete-comment" data-comment-id="${escapeHtml(comment.id)}">삭제</button>`
    : "";
  const tools = reply || remove ? `<div class="comment-tools">${reply}${remove}</div>` : "";
  const replyForm = isReply
    ? ""
    : `<form class="inline-form reply-form hidden" data-action="comment" data-post-id="${escapeHtml(postId)}" data-parent-id="${escapeHtml(comment.id)}"><input name="body" placeholder="답글을 입력하세요." required /><button type="submit">게시</button></form>`;
  const replyList = replies.length
    ? `<div class="reply-list">${replies.map((item) => commentHtml(postId, item, [], true)).join("")}</div>`
    : "";
  return `<div class="comment${isReply ? " reply" : ""}">${avatarMarkup(user(comment.userId), "comment-avatar")}<div class="comment-content"><p><strong>${escapeHtml(userName(comment.userId))}</strong>${escapeHtml(comment.body)}</p>${tools}${replyForm}${replyList}</div></div>`;
}

function commentsHtml(postId, comments) {
  return comments
    .filter((comment) => !comment.parentId)
    .map((comment) => commentHtml(postId, comment, comments.filter((item) => item.parentId === comment.id), false))
    .join("");
}

// white-space: pre-line turned every blank line an author typed into a full
// empty line -- on a four-paragraph post that was a third of the body's height.
// Paragraphs get a measured gap instead; single newlines still break.
function postBodyHtml(body) {
  const blocks = String(body || "").split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  if (!blocks.length) return "";
  return blocks.map((block) => `<p class="post-text">${escapeHtml(block)}</p>`).join("");
}

function postCardHtml(post) {
  const completionEnabled = hasCompletionCheck(post);
  const completion = completionEnabled ? S.getPostCompletion(state, post.id) : { totalMembers: 0, completedCount: 0, completedUserIds: [] };
  const reactions = state.reactions.filter((reaction) => reaction.postId === post.id);
  const comments = state.comments.filter((comment) => comment.postId === post.id);
  const mine = reactions.filter((reaction) => reaction.userId === currentUserId);
  const doneCount = completionEnabled ? completion.completedCount : reactions.filter((reaction) => reaction.sticker === "done").length;
  const mediaUrl = post.mediaUrl || post.videoUrl || representativeAttachment(post)?.url || "";
  const presentation = S.getPostPresentation(post);
  const baseClass = presentation.kind === "text" ? "feed-card text-card" : "feed-card media-card";
  const commentsOpen = openCommentPostIds.has(post.id);
  const cardClass = baseClass;
  const preview = mediaUrl && presentation.kind === "media" ? mediaPreviewHtml(mediaUrl, post) : "";
  const menuButton = canManagePost(post) ? postMenuHtml(post.id) : "";
  const doneLabel = post.type === "mission" ? `완료 ${doneCount}/${completion.totalMembers}` : `완료 ${doneCount}`;
  const doneAction = completionEnabled ? actionButton(post.id, "done", mine, "check", doneLabel) : "";
  const commentAction = `<button class="icon-action comment${commentsOpen ? " active" : ""}" data-action="toggle-comments" data-post-id="${escapeHtml(post.id)}" type="button" title="댓글" aria-label="댓글">${iconSvg("comment")}<span>댓글 ${comments.length}</span></button>`;
  const completionAvatars = completionEnabled ? completionAvatarStack(completion.completedUserIds) : "";
  const actions = `<div class="feed-actions">${commentAction}${doneAction}${completionAvatars}${saveControlHtml(post)}</div>`;
  const header = `<header class="feed-head"><div class="author-line">${avatarHtml(post.authorId)}<div><strong>${escapeHtml(userName(post.authorId))}</strong><span>${postTypeLabel(post.type)} · ${formatDate(post.createdAt)}${dateText(post)}</span></div></div><div class="post-tools">${menuButton}<span class="post-type">${postTypeLabel(post.type)}</span></div></header>`;
  return `<article class="${cardClass}" data-post-id="${escapeHtml(post.id)}">${header}${preview}<section class="feed-body"><h3>${escapeHtml(post.title)}</h3>${postBodyHtml(post.body)}${attachmentHtml(post)}${actions}</section></article>`;
}
function miniAvatarHtml(userId) {
  return avatarMarkup(user(userId), "completion-avatar");
}

function completionAvatarStack(userIds = []) {
  const visible = userIds.slice(0, 5);
  if (!visible.length) return "";
  const more = userIds.length > visible.length ? `<span class="completion-avatar more-count">+${userIds.length - visible.length}</span>` : "";
  return `<div class="completion-avatars" aria-label="completed users">${visible.map(miniAvatarHtml).join("")}${more}</div>`;
}

function postMenuHtml(postId) {
  return `<div class="post-menu"><button class="post-menu-button" data-action="toggle-post-menu" data-post-id="${postId}" type="button" aria-label="게시글 메뉴">${iconSvg("more")}</button><div class="post-menu-popover hidden" data-menu-for="${postId}"><button data-action="edit-post" data-post-id="${postId}" type="button">수정</button><button class="danger" data-action="delete-post" data-post-id="${postId}" type="button">삭제</button></div></div>`;
}

function actionButton(postId, sticker, mine, icon, label) { const active = mine.some((reaction) => reaction.sticker === sticker) ? " active" : ""; return `<button class="icon-action ${sticker}${active}" data-action="reaction" data-post-id="${postId}" data-sticker="${sticker}" type="button" title="${label}" aria-label="${label}">${iconSvg(icon)}<span>${label}</span></button>`; }
function iconSvg(name) { const icons = { heart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.2-4.4-9.5-9.1C.7 8.2 2.9 4.5 6.7 4.5c2 0 3.7 1.1 4.7 2.7 1-1.6 2.7-2.7 4.7-2.7 3.8 0 6 3.7 4.2 7.4C19.2 16.6 12 21 12 21Z"/></svg>`, check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`, comment: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.8 8.4 9.6 9.6 0 0 1-4-.8L3 20l1.1-4.4A8.1 8.1 0 0 1 3 11.5C3 6.8 7 3 12 3s9 3.8 9 8.5Z"/></svg>`, download: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>`, more: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>` }; return icons[name] || name; }
function mediaPreviewHtml(url, post) {
  const attachment = attachmentList(post).find((item) => item.url === url) || null;
  if (isDriveDownloadUrl(url) && isVideoAttachment(post, attachment)) {
    return `<div class="media-preview video-preview"><video class="drive-video" controls preload="auto" playsinline data-drive-src="${escapeHtml(`${url}&inline=1`)}"></video></div>`;
  }
  if (isDriveDownloadUrl(url) && isImageAttachment(post, attachment)) {
    return `<div class="media-preview image-preview"><img class="drive-image" data-drive-src="${escapeHtml(`${url}&inline=1`)}" alt="${escapeHtml(post.title)}" loading="lazy" /></div>`;
  }
  const preview = S.getLinkPreview(url);
  if (preview.type === "youtube") return `<div class="media-preview youtube-preview"><iframe src="${escapeHtml(preview.embedUrl)}" title="${escapeHtml(post.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
  if (preview.type === "image") return `<a class="media-preview" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(url)}" alt="${escapeHtml(post.title)}" /></a>`;
  const label = preview.type === "html" ? "HTML" : "LINK";
  return `<a class="media-preview" href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><div class="file-preview"><div class="file-icon">${label}</div><strong>${escapeHtml(post.title)}</strong><span>열어서 보기</span></div></a>`;
}



async function muxPlaybackUrl(playbackId) {
  if (muxPlaybackUrls.has(playbackId)) return muxPlaybackUrls.get(playbackId);
  if (muxPlaybackLoads.has(playbackId)) return muxPlaybackLoads.get(playbackId);
  const load = fetch(driveFunctionUrl("mux-playback-token"), {
    method: "POST",
    headers: { ...(await driveHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ playbackId }),
  })
    .then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Mux playback token request failed.");
      if (!result.token) throw new Error("Mux playback token was not returned.");
      const url = `https://stream.mux.com/${encodeURIComponent(playbackId)}.m3u8?token=${encodeURIComponent(result.token)}`;
      muxPlaybackUrls.set(playbackId, url);
      return url;
    })
    .finally(() => muxPlaybackLoads.delete(playbackId));
  muxPlaybackLoads.set(playbackId, load);
  return load;
}

function attachMuxVideoSource(video, url) {
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    return;
  }
  if (window.Hls?.isSupported()) {
    if (video._bighubHls) video._bighubHls.destroy();
    const hls = new window.Hls();
    video._bighubHls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    return;
  }
  video.src = url;
}
async function hydrateMuxVideos() {
  const videos = Array.from(document.querySelectorAll("[data-mux-playback-id]:not([src])"));
  await Promise.allSettled(videos.map(async (item) => {
    try {
      attachMuxVideoSource(item, await muxPlaybackUrl(item.dataset.muxPlaybackId));
    } catch (error) {
      item.closest(".video-preview")?.classList.add("preview-error");
      console.warn("Mux video preview failed", error);
    }
  }));
  refreshMuxProcessingAttachments();
}

async function refreshMuxProcessingAttachments() {
  const items = Array.from(document.querySelectorAll("[data-mux-upload-id][data-post-id]"));
  await Promise.allSettled(items.map(async (item) => {
    const uploadId = item.dataset.muxUploadId;
    const postId = item.dataset.postId;
    if (!uploadId || !postId || muxProcessingChecks.has(uploadId)) return;
    muxProcessingChecks.add(uploadId);
    try {
      const status = await checkMuxUploadStatus(uploadId);
      if (!status.playbackId || status.state !== "ready") return;
      const post = state.posts.find((entry) => entry.id === postId);
      if (!post) return;
      const nextAttachments = attachmentList(post).map((attachment) => attachment.uploadId === uploadId ? { ...attachment, assetId: status.assetId || attachment.assetId, playbackId: status.playbackId, state: "ready" } : attachment);
      const payload = attachmentPayload(nextAttachments);
      if (remoteAuth()) await window.BigHubSupabase.updatePost(postId, { ...post, ...payload });
      else state = S.updatePost(state, postId, payload, currentUserId);
      if (remoteAuth()) await refreshRemoteData();
      render();
    } catch (error) {
      console.warn("Mux processing status failed", error);
    } finally {
      window.setTimeout(() => muxProcessingChecks.delete(uploadId), 15000);
    }
  }));
}

function renderSearch() {
  const input = byId("globalSearch");
  const target = byId("searchResults");
  if (!input || !target) return;
  const query = input.value.trim().toLowerCase();
  if (!query) {
    target.innerHTML = `<div class="empty">검색어를 입력하세요.</div>`;
    return;
  }
  const results = state.posts
    .filter((post) => `${post.title} ${post.body} ${postTypeLabel(post.type)}`.toLowerCase().includes(query))
    .map((post) => resultCard(postTypeLabel(post.type), post.title, post.body));
  target.innerHTML = results.length ? results.join("") : emptyHtml();
}
function resultCard(type, title, body) { return `<article class="resource-card result-card"><span class="status-pill">${escapeHtml(type)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></article>`; }
function renderProgress() { const members = state.users.filter((item) => item.role === "member"); const posts = state.posts.filter(hasCompletionCheck); byId("userProgress").innerHTML = members.map((item) => { const done = posts.filter((post) => S.getPostCompletion(state, post.id).completedUserIds.includes(item.id)).length; const percent = posts.length ? Math.round((done / posts.length) * 100) : 0; return progressCard(item.name, `${done}/${posts.length}개 완료`, percent); }).join("") || emptyHtml(); byId("postProgress").innerHTML = posts.map((post) => { const completion = S.getPostCompletion(state, post.id); return progressCard(post.title, `${completion.completedCount}/${completion.totalMembers}명 완료`, completion.percent); }).join("") || emptyHtml(); }
function progressCard(title, meta, percent) { return `<article class="progress-card"><h3>${escapeHtml(title)}</h3><span class="feed-meta">${escapeHtml(meta)} · ${percent}%</span><div class="bar" aria-hidden="true"><span style="width: ${percent}%"></span></div></article>`; }
function renderStats() { const questionCount = state.posts.filter((post) => post.type === "question").length; byId("quickStats").innerHTML = `<div class="stat-row"><span>게시물</span><strong>${state.posts.length}</strong></div><div class="stat-row"><span>질문</span><strong>${questionCount}</strong></div>`; }
function approvalActionsHtml(request) {
  return `<div class="approval-actions"><button class="mini-button" data-action="approve-signup" data-request-id="${request.id}" type="button">승인</button><button class="mini-button secondary" data-action="reject-signup" data-request-id="${request.id}" type="button">거절</button></div>`;
}
function renderApprovals() { const panel = byId("approvalPanel"); const rawPending = (state.signupRequests || []).filter((request) => request.status === "pending"); const pending = rawPending; const admin = currentUser()?.role === "admin"; const compactHtml = pending.length ? pending.map((request) => `<div class="mini-item"><div><strong>${escapeHtml(request.name)}</strong><span>${escapeHtml(request.department)} · ${escapeHtml(request.loginId || "")}</span></div>${approvalActionsHtml(request)}</div>`).join("") : `<div class="mini-empty">대기 중인 신청 없음</div>`; const fullHtml = pending.length ? pending.map((request) => `<article class="feed-card text-card approval-card"><header class="feed-head"><div class="author-line"><div class="avatar">${escapeHtml((request.name || "?").slice(0, 1))}</div><div><strong>${escapeHtml(request.name)}</strong><span>${escapeHtml(request.department)} · ${escapeHtml(request.loginId || "")}</span></div></div>${approvalActionsHtml(request)}</header></article>`).join("") : emptyHtml(); panel.classList.toggle("hidden", !admin); byId("pendingCount").textContent = pending.length; byId("pendingList").innerHTML = compactHtml; byId("approvalViewCount").textContent = pending.length; byId("approvalViewList").innerHTML = fullHtml; }
function renderCalendar() { const posts = state.posts.filter((post) => post.startDate || post.dueDate).sort((a, b) => String(a.dueDate || a.startDate).localeCompare(String(b.dueDate || b.startDate))); byId("calendarList").innerHTML = posts.length ? posts.map((post) => `<div class="mini-item calendar-item"><div><strong>${escapeHtml(post.title)}</strong><span>${postTypeLabel(post.type)} · ${escapeHtml(dateText(post).replace(/^ · /, ""))}</span></div></div>`).join("") : `<div class="mini-empty">등록된 일정 없음</div>`; }
function dateText(post) { if (post.startDate && post.dueDate) return ` · ${post.startDate} ~ ${post.dueDate}`; if (post.dueDate) return ` · ${post.dueDate} 마감`; if (post.startDate) return ` · ${post.startDate} 시작`; return ""; }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "방금" : `${date.getMonth() + 1}.${date.getDate()}`; }

document.addEventListener("click", async (event) => {
  const focusTarget = event.target.closest("[data-focus-comment]");
  if (focusTarget) { openCommentPostIds.clear(); openCommentPostIds.add(focusTarget.dataset.focusComment); syncCommentButtons(); const input = byId(`comment-${focusTarget.dataset.focusComment}`); if (input) input.focus(); return; }
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
  if (target.dataset.action === "remove-existing-attachment") {
    removeExistingAttachment = true;
    selectedDriveFileList = [];
    const input = byId("driveFileInput");
    if (input) input.value = "";
    const form = byId("postForm");
    if (form?.elements?.attachmentUrl) form.elements.attachmentUrl.value = "";
    clearUploadedAttachments();
    const status = byId("driveUploadStatus");
    if (status) status.textContent = "현재 첨부 제거 예정";
    return;
  }
  if (target.dataset.action === "edit-post") { openEditModal(target.dataset.postId); return; }
  if (target.dataset.action === "delete-post") {
    const postId = target.dataset.postId;
    const post = state.posts.find((item) => item.id === postId);
    if (!post || !canManagePost(post)) return;
    if (!(await confirm("이 게시글을 삭제할까요? 삭제하면 댓글과 완료 기록도 함께 삭제됩니다."))) return;
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
  if (target.dataset.action === "close-comments") {
    openCommentPostIds.clear();
    syncCommentButtons();
    return;
  }
  if (target.dataset.action === "toggle-comments") {
    const postId = target.dataset.postId;
    const wasOpen = openCommentPostIds.has(postId);
    openCommentPostIds.clear();
    if (!wasOpen) openCommentPostIds.add(postId);
    syncCommentButtons();
    return;
  }
  if (target.dataset.action === "download-file") {
    const url = target.dataset.url || target.href;
    if (!isDriveDownloadUrl(url)) {
      try {
        if (remoteAuth()) await window.BigHubSupabase.recordFileDownload({ postId: target.dataset.postId, userId: currentUserId });
        else { state = S.recordFileDownload(state, { postId: target.dataset.postId, userId: currentUserId }); saveState(); }
      } catch (error) {
        console.warn("Download record skipped", error);
      }
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
    syncCommentButtons();
    return;
  }
  if (target.dataset.action === "approve-signup") {
    clientLog("signup-approve-click", { requestId: target.dataset.requestId || "" });
    const originalText = target.textContent;
    target.disabled = true;
    target.textContent = "\uCC98\uB9AC \uC911";
    if (remoteAuth()) {
      try {
        await window.BigHubSupabase.approveProfile(target.dataset.requestId);
        await refreshRemoteData();
        render();
        clientLog("signup-approve-success", { requestId: target.dataset.requestId || "" });
        showAppToast("\uAC00\uC785 \uC2E0\uCCAD\uC744 \uC2B9\uC778\uD588\uC2B5\uB2C8\uB2E4.");
      } catch (error) {
        target.disabled = false;
        target.textContent = originalText;
        clientLog("signup-approve-error", { requestId: target.dataset.requestId || "", message: error.message || String(error || "") });
        alert(error.message || "\uAC00\uC785 \uC2B9\uC778 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
      }
      return;
    }
    state = S.approveSignupRequest(state, target.dataset.requestId);
    saveState();
    render();
    showAppToast("\uAC00\uC785 \uC2E0\uCCAD\uC744 \uC2B9\uC778\uD588\uC2B5\uB2C8\uB2E4.");
    return;
  }
  if (target.dataset.action === "reject-signup") {
    clientLog("signup-reject-click", { requestId: target.dataset.requestId || "" });
    const originalText = target.textContent;
    target.disabled = true;
    target.textContent = "\uCC98\uB9AC \uC911";
    if (remoteAuth()) {
      try {
        await window.BigHubSupabase.rejectProfile(target.dataset.requestId);
        state = S.rejectSignupRequest(state, target.dataset.requestId);
        render();
        await refreshRemoteData();
        render();
        clientLog("signup-reject-success", { requestId: target.dataset.requestId || "" });
        showAppToast("\uAC00\uC785 \uC2E0\uCCAD\uC744 \uAC70\uC808\uD588\uC2B5\uB2C8\uB2E4.");
      } catch (error) {
        target.disabled = false;
        target.textContent = originalText;
        clientLog("signup-reject-error", { requestId: target.dataset.requestId || "", message: error.message || String(error || "") });
        alert(error.message || "\uAC00\uC785 \uAC70\uC808 \uCC98\uB9AC\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.");
      }
      return;
    }
    state = S.rejectSignupRequest(state, target.dataset.requestId);
    saveState();
    render();
    showAppToast("\uAC00\uC785 \uC2E0\uCCAD\uC744 \uAC70\uC808\uD588\uC2B5\uB2C8\uB2E4.");
    return;
  }
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
    form.reset();
    syncCommentButtons();
    return;
  }
  form.reset();
  render();
});

init();

