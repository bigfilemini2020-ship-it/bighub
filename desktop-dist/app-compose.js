var editingPostId = "";
var uploadedAttachments = [];
var removeExistingAttachment = false;

function openComposeModal() {
  if (!currentUser()) return;
  editingPostId = "";
  const form = byId("postForm");
  form.reset();
  uploadedAttachments = [];
  removeExistingAttachment = false;
  byId("composeTitle").textContent = "새 게시물 만들기";
  byId("driveUploadStatus").textContent = "";
  syncPostTypeAccess(form);
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
  form.elements.attachmentUrl.value = isAttachmentBundle(post.attachmentUrl) ? "" : post.attachmentUrl || "";
  removeExistingAttachment = false;
  formDataCheckAll(form, "targetUserIds", post.targetUserIds || []);
  formDataCheckAll(form, "completionRules", post.completionRules || []);
  byId("composeTitle").textContent = "게시물 수정";
  renderExistingAttachmentStatus(post);
  syncPostTypeAccess(form);
  byId("composeModal").classList.remove("hidden");
  form.querySelector("input[name='title']").focus();
}

function formDataCheckAll(form, name, values) {
  if (!values.length) return;
  const selected = new Set(values);
  Array.from(form.querySelectorAll(`input[name='${name}']`)).forEach((input) => { input.checked = selected.has(input.value); });
}

function closeComposeModal() { byId("composeModal").classList.add("hidden"); editingPostId = ""; uploadedAttachments = []; removeExistingAttachment = false; }

function setDriveFiles(files) {
  addDriveFiles(files);
}

function bindDriveDropZone() {
  const dropZone = document.querySelector(".upload-drop");
  if (!dropZone || dropZone.dataset.dropBound === "1") return;
  dropZone.dataset.dropBound = "1";
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (eventName === "drop") setDriveFiles(Array.from(event.dataTransfer?.files || []));
      if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("drag-over");
    });
  });
}

function syncPostTypeAccess(form = byId("postForm")) {
  const select = form?.elements?.type || byId("postTypeSelect");
  if (!select) return;
  Array.from(select.options).forEach((option) => {
    if (option.dataset.adminOnly === "true") {
      option.hidden = !canCreateNoticePost();
      option.disabled = !canCreateNoticePost();
    }
  });
  if (select.value === "notice" && !canCreateNoticePost()) select.value = "general";
  updateMissionSettings();
}
function updateMissionSettings() {
  const type = byId("postTypeSelect")?.value;
  const settings = byId("missionSettings");
  if (settings) settings.classList.toggle("hidden", type !== "mission");
}

function bindForms() {
  renderMissionTargets();
  updateMissionSettings();
  byId("postTypeSelect")?.addEventListener("change", () => { syncPostTypeAccess(); updateMissionSettings(); });
  bindDriveDropZone();
  byId("driveFileInput")?.addEventListener("change", (event) => {
    const input = event.currentTarget;
    const incoming = Array.from(input.files || []);
    input.value = "";
    addDriveFiles(incoming, { resetInput: false });
  });
  byId("postForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    if (data.type === "notice" && !canCreateNoticePost()) throw new Error("공지는 관리자만 작성할 수 있습니다.");
    const files = selectedDriveFiles();
    const status = byId("driveUploadStatus");
    const submitButton = form.querySelector("button[type='submit']");
    clientLog("post-submit-start", { editing: Boolean(editingPostId), fileCount: files.length, type: data.type || "general", hasMediaUrl: Boolean(data.mediaUrl), hasAttachmentUrl: Boolean(data.attachmentUrl) });
    try {
      const manualAttachmentUrl = String(data.attachmentUrl || "").trim();
      const uploadedFileAttachments = [];
      if (files.length) {
        if (submitButton) submitButton.disabled = true;
        if (!hasUploadedSelectedFiles(files)) {
          const uploaded = [];
          for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            setUploadStatus(`Drive 업로드 중... ${index + 1}/${files.length}`, Math.round((index / files.length) * 100));
            const result = isVideoFile(file) ? await uploadMuxVideoFile(file) : await uploadDriveFile(file);
            uploaded.push({ ...result, fileKey: driveFileKey(file) });
          }
          rememberUploadedAttachments(uploaded);
          setUploadStatus("업로드 완료", 100);
        } else {
          setUploadStatus("이미 업로드된 파일 연결 중...", 100);
        }
        uploadedFileAttachments.push(...uploadedAttachments.map((item) => ({ ...item, url: item.downloadUrl || item.url, name: item.name, mimeType: item.mimeType })));
      }
      const manualAttachments = manualAttachmentUrl ? [{ url: manualAttachmentUrl, name: driveFileName(manualAttachmentUrl), mimeType: "" }] : [];
      const existingPost = editingPostId ? state.posts.find((post) => post.id === editingPostId) : null;
      const existingIsBundle = existingPost && isAttachmentBundle(existingPost.attachmentUrl);
      const existingSingleUrl = existingPost && !existingIsBundle ? String(existingPost.attachmentUrl || "").trim() : "";
      const singleAttachmentCleared = Boolean(editingPostId && existingSingleUrl && !manualAttachmentUrl && !files.length);
      const nextAttachments = [...uploadedFileAttachments, ...manualAttachments];
      if (nextAttachments.length) Object.assign(data, attachmentPayload(nextAttachments));
      else if (removeExistingAttachment || singleAttachmentCleared) Object.assign(data, attachmentPayload([]));
      else if (existingPost && existingIsBundle) Object.assign(data, attachmentPayload(attachmentList(existingPost)));
      else Object.assign(data, attachmentPayload([]));
      delete data.driveFile;
      data.targetUserIds = data.type === "mission" ? formData.getAll("targetUserIds") : [];
      data.completionRules = formData.getAll("completionRules");
      if (remoteAuth()) {
        clientLog("post-current-profile-start");
        const remoteUser = await window.BigHubSupabase.currentProfile();
        clientLog("post-current-profile-result", { hasRemoteUser: Boolean(remoteUser?.id) });
        if (!remoteUser?.id) throw new Error("로그인 세션을 확인할 수 없습니다. 다시 로그인하세요.");
        currentUserId = remoteUser.id;
        mergeRemoteUser(remoteUser);
        const payload = { ...data, authorId: currentUserId };
        clientLog("post-save-start", { editing: Boolean(editingPostId) });
        if (editingPostId) await window.BigHubSupabase.updatePost(editingPostId, payload);
        else await window.BigHubSupabase.createPost(payload);
        clientLog("post-save-done");
        clientLog("post-refresh-start");
        await refreshRemoteData();
        clientLog("post-refresh-done");
        mergeRemoteUser(remoteUser);
      } else {
        state = editingPostId ? S.updatePost(state, editingPostId, data, currentUserId) : S.addPost(state, { ...data, authorId: currentUserId });
        saveState();
      }
      form.reset();
      clearUploadedAttachments();
      removeExistingAttachment = false;
      setUploadStatus("");
      closeComposeModal();
      activeView = "feed";
      shouldRestoreFeedPosition = false;
      clientLog("post-render-start");
      render();
      clientLog("post-render-done");
      // 최신 글이 피드 맨 아래에 붙으므로, 방금 쓴 글로 내려가야 보인다.
      const cards = document.querySelectorAll("#postList .feed-card[data-post-id]");
      const newest = cards[cards.length - 1];
      if (newest) { newest.scrollIntoView({ block: "start" }); window.scrollBy(0, -88); }
      else window.scrollTo(0, 0);
    } catch (error) {
      clientLog("post-submit-error", { message: error.message || String(error || ""), name: error.name || "" });
      setUploadStatus(error.message || "파일 업로드에 실패했습니다.");
      alert(error.message || "파일 업로드에 실패했습니다.");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}
