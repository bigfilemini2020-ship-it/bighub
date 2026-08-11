var selectedDriveFileList = [];
var downloadToastTimer = 0;
const driveMediaObjectUrls = new Map();
const driveMediaLoads = new Map();

function driveFileKey(file) {
  return file ? `${file.name}:${file.size}:${file.lastModified}` : "";
}

function selectedDriveFiles() {
  return selectedDriveFileList.slice();
}

function mergeDriveFiles(existingFiles, incomingFiles) {
  const filesByKey = new Map();
  [...(existingFiles || []), ...(incomingFiles || [])].forEach((file) => {
    const key = driveFileKey(file);
    if (key) filesByKey.set(key, file);
  });
  return Array.from(filesByKey.values());
}

function addDriveFiles(files, { resetInput = true } = {}) {
  const incoming = Array.from(files || []);
  if (!incoming.length) return;
  const next = mergeDriveFiles(selectedDriveFiles(), incoming);
  selectedDriveFileList = next;
  const input = byId("driveFileInput");
  if (resetInput && input) input.value = "";
  clearUploadedAttachments();
  updateDriveFileStatus();
}

function removeSelectedDriveFile(index) {
  selectedDriveFileList.splice(index, 1);
  clearUploadedAttachments();
  updateDriveFileStatus();
}

function uploadedFileKeys() {
  return uploadedAttachments.map((item) => item.fileKey).filter(Boolean).join("|");
}

function selectedFileKeys(files) {
  return files.map(driveFileKey).filter(Boolean).join("|");
}

function hasUploadedSelectedFiles(files) {
  return files.length > 0 && uploadedAttachments.length === files.length && uploadedFileKeys() === selectedFileKeys(files);
}

function rememberUploadedAttachments(values) {
  uploadedAttachments = values;
  if (values.length) sessionStorage.setItem(uploadedAttachmentKey, JSON.stringify(values));
}

function loadUploadedAttachments(files) {
  if (!files.length) return [];
  if (hasUploadedSelectedFiles(files)) return uploadedAttachments;
  try {
    const cached = JSON.parse(sessionStorage.getItem(uploadedAttachmentKey) || "[]");
    if (Array.isArray(cached) && cached.length === files.length && cached.map((item) => item.fileKey).join("|") === selectedFileKeys(files)) {
      uploadedAttachments = cached;
      return cached;
    }
  } catch {}
  return [];
}

function clearUploadedAttachments() {
  uploadedAttachments = [];
  sessionStorage.removeItem(uploadedAttachmentKey);
}

function renderExistingAttachmentStatus(post) {
  const status = byId("driveUploadStatus");
  if (!status) return;
  const count = attachmentList(post).length;
  if (!editingPostId || !count) { status.textContent = ""; return; }
  if (removeExistingAttachment) { status.textContent = "현재 첨부 제거 예정"; return; }
  status.innerHTML = `현재 첨부: ${count}개 <button class="clear-attachment-button" data-action="remove-existing-attachment" type="button">첨부 제거</button>`;
}

function updateDriveFileStatus() {
  const files = selectedDriveFiles();
  const status = byId("driveUploadStatus");
  if (!status) return;
  if (!files.length) {
    clearUploadedAttachments();
    const existingPost = editingPostId ? state.posts.find((post) => post.id === editingPostId) : null;
    if (existingPost && !removeExistingAttachment) renderExistingAttachmentStatus(existingPost);
    else status.textContent = "";
    return;
  }
  loadUploadedAttachments(files);
  if (!hasUploadedSelectedFiles(files)) uploadedAttachments = [];
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const label = hasUploadedSelectedFiles(files)
    ? `업로드 완료: ${files.length}개 파일`
    : `선택 파일 ${files.length}개 (${formatFileSize(totalSize)})`;
  status.innerHTML = `<strong>${label}</strong><div class="selected-file-list">${files.map((file, index) => `<div class="selected-file-row"><span>${escapeHtml(file.name)} <small>${formatFileSize(file.size)}</small></span><button class="selected-file-remove" data-action="remove-selected-drive-file" data-file-index="${index}" type="button">삭제</button></div>`).join("")}</div>`;
}

async function authHeaders() {
  if (!remoteAuth()) throw new Error("Supabase 로그인이 필요합니다.");
  const token = await window.BigHubSupabase.accessToken();
  if (!token) throw new Error("로그인 세션이 만료됐습니다. 다시 로그인하세요.");
  return { Authorization: `Bearer ${token}` };
}

function uploadErrorMessage(error) {
  const message = error?.message || "파일 업로드에 실패했습니다.";
  if (/Failed to fetch|Load failed|NetworkError|fetch/i.test(message)) {
    return "파일 업로드에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.";
  }
  return message;
}

function setUploadStatus(message, progress = 0) {
  const status = byId("driveUploadStatus");
  if (!status) return;
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
  status.innerHTML = message
    ? `<span>${escapeHtml(message)}</span><i style="--progress:${safeProgress}%"></i>`
    : "";
}

function ensureDownloadToast() {
  let toast = byId("downloadToast");
  if (toast) return toast;
  toast = document.createElement("div");
  toast.id = "downloadToast";
  toast.className = "download-toast hidden";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.append(toast);
  return toast;
}

function setDownloadStatus(message, progress = 0, tone = "active") {
  const toast = ensureDownloadToast();
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
  window.clearTimeout(downloadToastTimer);
  toast.className = `download-toast ${tone}`;
  toast.innerHTML = `<strong>${escapeHtml(message)}</strong><span>${safeProgress}%</span><i style="--progress:${safeProgress}%"></i>`;
  if (tone !== "active") {
    downloadToastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3500);
  }
}

function driveFunctionBaseUrl() {
  const config = window.BigHubConfig || {};
  const baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  if (!baseUrl || !config.supabaseAnonKey) throw new Error("Supabase 설정을 확인하세요.");
  return `${baseUrl}/functions/v1`;
}

function driveFunctionUrl(name, parameters = {}) {
  const search = new URLSearchParams();
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "") search.set(key, String(value));
  });
  const query = search.toString();
  return `${driveFunctionBaseUrl()}/${name}${query ? `?${query}` : ""}`;
}

async function driveHeaders() {
  const config = window.BigHubConfig || {};
  return { ...(await authHeaders()), apikey: config.supabaseAnonKey };
}

function driveDownloadUrl(id, name) {
  return driveFunctionUrl("drive-download", { id, name });
}

function normalizeDriveDownloadUrl(value) {
  const raw = String(value || "").trim();
  try {
    const parsed = new URL(raw, location.href);
    if (parsed.pathname.endsWith("/api/drive/download")) {
      return driveDownloadUrl(parsed.searchParams.get("id") || "", parsed.searchParams.get("name") || "");
    }
  } catch {}
  return raw;
}
function driveDownloadParams(value) {
  try {
    const parsed = new URL(normalizeDriveDownloadUrl(value), location.href);
    if (parsed.protocol === "bighub-drive:") {
      return { id: decodeURIComponent(parsed.hostname || parsed.pathname.replace(/^\//, "")), name: parsed.searchParams.get("name") || "download" };
    }
    return { id: parsed.searchParams.get("id") || "", name: parsed.searchParams.get("name") || "download" };
  } catch {
    return { id: "", name: "download" };
  }
}

async function responseBlobWithProgress(response) {
  const total = Number(response.headers.get("content-length") || 0);
  if (!response.body || !total) return response.blob();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    setDownloadStatus("다운로드 중", 15 + Math.round((received / total) * 75));
  }
  return new Blob(chunks);
}

function saveBlobDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
async function uploadDriveFile(file) {
  const maxUploadSize = 10 * 1024 * 1024;
  if (file.size > maxUploadSize) throw new Error("Files must be 10MB or less. Video files use Mux upload.");

  setUploadStatus("Uploading to Drive...", 20);
  const formData = new FormData();
  formData.append("file", file, file.name);
  const response = await fetch(driveFunctionUrl("drive-upload"), {
    method: "POST",
    headers: await driveHeaders(),
    body: formData,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id) throw new Error(result.error || "File upload failed.");
  setUploadStatus("Drive upload complete", 100);
  return {
    id: result.id,
    name: result.name || file.name,
    mimeType: result.mimeType || file.type || "application/octet-stream",
    downloadUrl: driveDownloadUrl(result.id, result.name || file.name),
  };
}

async function downloadDriveFile(url, postId) {
  setDownloadStatus("다운로드 준비 중", 8);
  const params = driveDownloadParams(url);
  try {
    const response = await fetch(normalizeDriveDownloadUrl(url), { headers: await driveHeaders() });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "파일 다운로드에 실패했습니다.");
    }
    const disposition = response.headers.get("content-disposition") || "";
    const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const filename = match ? decodeURIComponent(match[1]) : params.name;
    const blob = await responseBlobWithProgress(response);
    if (isDesktopApp()) {
      setDownloadStatus("다운로드 저장 중", 95);
      await desktopInvoke("save_downloaded_file", { input: { name: filename, data: Array.from(new Uint8Array(await blob.arrayBuffer())) } });
    } else {
      saveBlobDownload(blob, filename);
    }
    setDownloadStatus("다운로드 완료", 100, "success");
  } catch (error) {
    setDownloadStatus("다운로드 실패", 100, "error");
    throw error;
  }
  try {
    if (remoteAuth()) {
      await window.BigHubSupabase.recordFileDownload({ postId, userId: currentUserId });
      await refreshRemoteData();
    } else {
      state = S.recordFileDownload(state, { postId, userId: currentUserId });
      saveState();
    }
  } catch (error) {
    console.warn("Download record skipped", error);
  }
}
function isDriveDownloadUrl(url) {
  const value = String(url || "");
  return value.includes("/functions/v1/drive-download") || value.includes("/api/drive/download");
}

function driveFileName(url) {
  try { return new URL(url, location.href).searchParams.get("name") || "Drive 파일"; } catch { return "Drive 파일"; }
}

async function getDriveMediaObjectUrl(source, headers) {
  const cached = driveMediaObjectUrls.get(source);
  if (cached) return cached;
  if (driveMediaLoads.has(source)) return driveMediaLoads.get(source);
  const load = fetch(source, { headers })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Drive media request failed (${response.status})`);
      const objectUrl = URL.createObjectURL(await response.blob());
      driveMediaObjectUrls.set(source, objectUrl);
      return objectUrl;
    })
    .finally(() => driveMediaLoads.delete(source));
  driveMediaLoads.set(source, load);
  return load;
}

async function hydrateDriveVideos() {
  const media = Array.from(document.querySelectorAll("[data-drive-src]:not([src])"));
  if (!media.length || !remoteAuth()) return;
  const headers = await driveHeaders().catch(() => null);
  if (!headers) return;
  await Promise.allSettled(media.map(async (item) => {
    const source = normalizeDriveDownloadUrl(item.dataset.driveSrc);
    try {
      if (!source) return;
      item.src = await getDriveMediaObjectUrl(source, headers);
    } catch (error) {
      item.closest(item.tagName === "IMG" ? ".image-preview" : ".video-preview")?.classList.add("preview-error");
      console.warn("Drive preview failed", error);
    }
  }));
}
