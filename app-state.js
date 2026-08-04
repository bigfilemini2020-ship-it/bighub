(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.EducationState = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const memberIds = ["u-1", "u-2", "u-3", "u-4"];

  function createInitialState(now = new Date().toISOString()) {
    return {
      users: [
        { id: "u-admin", name: "교육 운영자", role: "admin", avatar: "운" },
        { id: "u-1", name: "김민지", role: "member", avatar: "민" },
        { id: "u-2", name: "박준호", role: "member", avatar: "준" },
        { id: "u-3", name: "이서연", role: "member", avatar: "서" },
        { id: "u-4", name: "최현우", role: "member", avatar: "현" },
      ],
      posts: [],
      reactions: [],
      comments: [],
      resources: [],
      questions: [],
      answers: [],
      createdAt: now,
    };
  }

  function nextId(prefix, items) {
    return `${prefix}-${items.length + 1}`;
  }

  function trim(value) {
    return String(value || "").trim();
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
      dueDate: trim(input.dueDate),
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

  function getPostCompletion(state, postId) {
    const completed = new Set();
    state.reactions.forEach((reaction) => {
      if (reaction.postId === postId && reaction.sticker === "done") completed.add(reaction.userId);
    });
    state.comments.forEach((comment) => {
      if (comment.postId === postId) completed.add(comment.userId);
    });
    const completedUserIds = Array.from(completed).sort();
    return {
      postId,
      totalMembers: memberIds.length,
      completedCount: completedUserIds.length,
      completedUserIds,
      percent: Math.round((completedUserIds.length / memberIds.length) * 100),
    };
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
    addResource,
    addQuestion,
    addAnswer,
    toggleQuestionStatus,
    getPostCompletion,
    getLinkPreview,
    getPostPresentation,
  };
});


