const sessionKey = "bighub-session-v1";
const rememberedLoginIdKey = "bighub-remembered-login-id";
const autoLoginKey = "bighub-auto-login";
const currentUserSnapshotKey = "bighub-current-user-snapshot-v1";

var currentUserId = localStorage.getItem(autoLoginKey) === "1"
  ? localStorage.getItem(sessionKey) || ""
  : sessionStorage.getItem(sessionKey) || "";
var currentUserSnapshot = loadCurrentUserSnapshot();

function loadCurrentUserSnapshot() {
  try { return JSON.parse(localStorage.getItem(currentUserSnapshotKey) || "null"); } catch { return null; }
}
function hydrateCurrentUserId() {
  if (currentUserId) return currentUserId;
  currentUserId = sessionStorage.getItem(sessionKey) || localStorage.getItem(sessionKey) || currentUserSnapshot?.id || "";
  return currentUserId;
}
function setSession(userId, autoLogin) {
  const primary = autoLogin ? localStorage : sessionStorage;
  const secondary = autoLogin ? sessionStorage : localStorage;
  primary.setItem(sessionKey, userId);
  secondary.removeItem(sessionKey);
  if (autoLogin) localStorage.setItem(autoLoginKey, "1");
  else localStorage.removeItem(autoLoginKey);
}
function clearSession() {
  localStorage.removeItem(sessionKey);
  sessionStorage.removeItem(sessionKey);
  localStorage.removeItem(autoLoginKey);
  localStorage.removeItem(currentUserSnapshotKey);
  currentUserSnapshot = null;
}