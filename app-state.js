(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EducationState = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const memberIds = ["u-1", "u-2", "u-3", "u-4"];
  const departments = ["임원", "경영지원", "개발", "운영", "마케팅", "기타"];
  const authEmailDomain = "bighub.local";

  function createInitialState(now = new Date().toISOString()) {
    return {
      users: [
        { id: "u-admin", loginId: "admin", authEmail: "admin@bighub.local", name: "관리자", department: "임원", role: "admin", avatar: "관", password: "admin1234", approvedAt: now },
        { id: "u-1", loginId: "minji", authEmail: "minji@bighub.local", name: "김민지", department: "개발", role: "member", avatar: "민", password: "pass1234", approvedAt: now },
        { id: "u-2", loginId: "junho", authEmail: "junho@bighub.local", name: "박준호", department: "운영", role: "member", avatar: "준", password: "pass1234", approvedAt: now },
        { id: "u-3", loginId: "seoyeon", authEmail: "seoyeon@bighub.local", name: "이서연", department: "마케팅", role: "member", avatar: "서", password: "pass1234", approvedAt: now },
        { id: "u-4", loginId: "hyunwoo", authEmail: "hyunwoo@bighub.local", name: "최현우", department: "경영지원", role: "member", avatar: "현", password: "pass1234", approvedAt: now },
      ],
      posts: [],
      reactions: [],
      comments: [],
      downloads: [],
      resources: [],
      questions: [],
      answers: [],
      signupRequests: [],
      createdAt: now,
    };
  }

  function nextId(prefix, items) {
    return `${prefix}-${items.length + 1}`;
  }

  function trim(value) {
    return String(value || "").trim();
  }

  function validateLoginId(value) {
    const loginId = trim(value).toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(loginId)) throw new Error("login id is invalid");
    return loginId;
  }

  function loginIdToAuthEmail(value) {
    return `${validateLoginId(value)}@${authEmailDomain}`;
  }

  function normalizeList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (!value) return [];
    return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  }

  function addPost(state, input, now = new Date().toISOString()) {
    const post = {
      id: nextId("post", state.posts),
      type: input.type || "notice",
      title: trim(input.title),
      body: trim(input.body),
      authorId: input.authorId,
      mediaUrl: trim(input.mediaUrl || input.videoUrl),
      attachmentUrl: trim(input.attachmentUrl),
      attachmentName: trim(input.attachmentName),
      attachmentMimeType: trim(input.attachmentMimeType),
      startDate: trim(input.startDate),
      dueDate: trim(input.dueDate),
      targetUserIds: normalizeList(input.targetUserIds),
      completionRules: normalizeList(input.completionRules),
      createdAt: now,
    };
    return { ...state, posts: [post, ...state.posts] };
  }

  function addReaction(state, input, now = new Date().toISOString()) {
    const sticker = input.sticker || "like";
    const existing = state.reactions.find(
      (reaction) => reaction.postId === input.postId && reaction.userId === input.userId && reaction.sticker === sticker
    );
    if (existing) {
      return { ...state, reactions: state.reactions.filter((reaction) => reaction.id !== existing.id) };
    }
    const next = {
      id: nextId("reaction", state.reactions),
      postId: input.postId,
      userId: input.userId,
      sticker,
      createdAt: now,
      updatedAt: now,
    };
    return { ...state, reactions: [next, ...state.reactions] };
  }

  function addComment(state, input, now = new Date().toISOString()) {
    const comment = {
      id: nextId("comment", state.comments),
      postId: input.postId,
      userId: input.userId,
      body: trim(input.body),
      createdAt: now,
    };
    return { ...state, comments: [comment, ...state.comments] };
  }

  function addResource(state, input, now = new Date().toISOString()) {
    const resource = {
      id: nextId("resource", state.resources),
      userId: input.userId,
      title: trim(input.title),
      description: trim(input.description),
      url: trim(input.url),
      tags: trim(input.tags),
      createdAt: now,
    };
    resource.searchText = `${resource.title} ${resource.description} ${resource.tags}`.toLowerCase();
    return { ...state, resources: [resource, ...state.resources] };
  }

  function addQuestion(state, input, now = new Date().toISOString()) {
    const question = {
      id: nextId("question", state.questions),
      userId: input.userId,
      title: trim(input.title),
      body: trim(input.body),
      status: "open",
      createdAt: now,
    };
    return { ...state, questions: [question, ...state.questions] };
  }

  function addAnswer(state, input, now = new Date().toISOString()) {
    const answer = {
      id: nextId("answer", state.answers),
      questionId: input.questionId,
      userId: input.userId,
      body: trim(input.body),
      createdAt: now,
    };
    return { ...state, answers: [answer, ...state.answers] };
  }

  function toggleQuestionStatus(state, questionId) {
    return {
      ...state,
      questions: state.questions.map((question) => {
        if (question.id !== questionId) return question;
        return { ...question, status: question.status === "resolved" ? "open" : "resolved" };
      }),
    };
  }

  function recordFileDownload(state, input, now = new Date().toISOString()) {
    const existing = (state.downloads || []).find((download) => download.postId === input.postId && download.userId === input.userId);
    if (existing) return state;
    const download = {
      id: nextId("download", state.downloads || []),
      postId: input.postId,
      userId: input.userId,
      createdAt: now,
    };
    return { ...state, downloads: [download, ...(state.downloads || [])] };
  }

  function createSignupRequest(state, input, now = new Date().toISOString()) {
    const loginId = validateLoginId(input.loginId);
    const name = trim(input.name);
    const department = trim(input.department);
    const password = trim(input.password);
    const passwordConfirm = trim(input.passwordConfirm);
    if (!name) throw new Error("name is required");
    if (!departments.includes(department)) throw new Error("department is invalid");
    if (password.length < 6) throw new Error("password is too short");
    if (password !== passwordConfirm) throw new Error("password confirmation does not match");
    const authEmail = loginIdToAuthEmail(loginId);
    const loginIdTaken = state.users.some((user) => user.loginId === loginId || user.authEmail === authEmail) || state.signupRequests.some((request) => request.loginId === loginId && request.status === "pending");
    if (loginIdTaken) throw new Error("login id already exists");
    if (state.users.some((user) => user.name === name) || state.signupRequests.some((request) => request.name === name && request.status === "pending")) {
      throw new Error("name already exists");
    }
    const request = {
      id: nextId("signup", state.signupRequests || []),
      loginId,
      authEmail,
      name,
      department,
      password,
      status: "pending",
      createdAt: now,
    };
    return { ...state, signupRequests: [request, ...(state.signupRequests || [])] };
  }

  function approveSignupRequest(state, requestId, now = new Date().toISOString()) {
    const request = (state.signupRequests || []).find((item) => item.id === requestId);
    if (!request || request.status !== "pending") return state;
    const user = {
      id: `u-${state.users.length}`,
      loginId: request.loginId,
      authEmail: request.authEmail,
      name: request.name,
      department: request.department,
      role: "member",
      avatar: request.name.slice(0, 1),
      password: request.password,
      approvedAt: now,
    };
    return {
      ...state,
      users: [...state.users, user],
      signupRequests: state.signupRequests.map((item) => item.id === requestId ? { ...item, status: "approved", approvedAt: now, userId: user.id } : item),
    };
  }

  function authenticateUser(state, input) {
    const loginId = input.loginId ? validateLoginId(input.loginId) : "";
    const name = trim(input.name);
    const password = trim(input.password);
    const user = state.users.find((item) => (loginId ? item.loginId === loginId : item.name === name) && item.password === password && item.approvedAt);
    return user ? { ...user, password: undefined } : null;
  }

  function getPostCompletion(state, postId) {
    const post = state.posts.find((item) => item.id === postId) || {};
    const targets = post.targetUserIds && post.targetUserIds.length ? post.targetUserIds : memberIds;
    const rules = post.type === "mission" && post.completionRules && post.completionRules.length ? post.completionRules : ["doneOrComment"];
    const completedUserIds = targets.filter((userId) => rules.every((rule) => hasCheckpoint(state, postId, userId, rule))).sort();
    return {
      postId,
      totalMembers: targets.length,
      completedCount: completedUserIds.length,
      completedUserIds,
      percent: targets.length ? Math.round((completedUserIds.length / targets.length) * 100) : 0,
    };
  }

  function hasCheckpoint(state, postId, userId, rule) {
    if (rule === "download") return (state.downloads || []).some((download) => download.postId === postId && download.userId === userId);
    if (rule === "done") return state.reactions.some((reaction) => reaction.postId === postId && reaction.userId === userId && reaction.sticker === "done");
    if (rule === "comment") return state.comments.some((comment) => comment.postId === postId && comment.userId === userId);
    if (rule === "doneOrComment") return hasCheckpoint(state, postId, userId, "done") || hasCheckpoint(state, postId, userId, "comment");
    return false;
  }

  function getLinkPreview(url) {
    const cleanUrl = trim(url);
    const youtubeId = extractYoutubeId(cleanUrl);
    if (youtubeId) {
      return {
        type: "youtube",
        embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
        thumbnailUrl: `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`,
      };
    }
    if (/\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i.test(cleanUrl)) {
      return { type: "image", url: cleanUrl };
    }
    if (/\.(html?|pdf|pptx?|docx?|xlsx?)(\?.*)?$/i.test(cleanUrl)) {
      return { type: "html", url: cleanUrl };
    }
    return { type: "link", url: cleanUrl };
  }

  function getPostPresentation(post) {
    return post.mediaUrl || post.videoUrl || post.attachmentUrl ? { kind: "media" } : { kind: "text" };
  }

  function extractYoutubeId(url) {
    const patterns = [
      /youtu\.be\/([A-Za-z0-9_-]{6,})/,
      /youtube\.com\/watch\?v=([A-Za-z0-9_-]{6,})/,
      /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
      /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return "";
  }

  return {
    createInitialState,
    addPost,
    addReaction,
    addComment,
    recordFileDownload,
    addResource,
    addQuestion,
    addAnswer,
    toggleQuestionStatus,
    getPostCompletion,
    getLinkPreview,
    getPostPresentation,
    createSignupRequest,
    approveSignupRequest,
    authenticateUser,
    loginIdToAuthEmail,
    validateLoginId,
    departments,
  };
});





