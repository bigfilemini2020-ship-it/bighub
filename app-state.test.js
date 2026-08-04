const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createInitialState,
  addPost,
  addReaction,
  addComment,
  getPostCompletion,
  getLinkPreview,
  getPostPresentation,
  recordFileDownload,
  createSignupRequest,
  approveSignupRequest,
  authenticateUser,
} = require("./app-state");

const now = "2026-08-04T09:00:00.000Z";

test("initial state has demo users and post containers", () => {
  const state = createInitialState(now);

  assert.equal(state.users.length, 5);
  assert.equal(state.users[0].role, "admin");
  assert.deepEqual(state.posts, []);
  assert.deepEqual(state.reactions, []);
  assert.deepEqual(state.comments, []);
});

test("supports general, notice, mission, and question post types", () => {
  let state = createInitialState(now);
  for (const type of ["general", "notice", "mission", "question"]) {
    state = addPost(state, { type, title: type, body: "body", authorId: "u-admin" }, now);
  }

  assert.deepEqual(state.posts.map((post) => post.type).sort(), ["general", "mission", "notice", "question"]);
});

test("like and done reactions are independent and toggle off", () => {
  let state = createInitialState(now);
  state = addPost(state, {
    type: "notice",
    title: "Week 1 guide",
    body: "Watch intro video",
    authorId: "u-admin",
  }, now);

  const postId = state.posts[0].id;
  state = addReaction(state, { postId, userId: "u-1", sticker: "like" }, now);
  state = addReaction(state, { postId, userId: "u-1", sticker: "done" }, now);

  let completion = getPostCompletion(state, postId);

  assert.equal(state.reactions.length, 2);
  assert.equal(completion.completedCount, 1);
  assert.deepEqual(completion.completedUserIds, ["u-1"]);

  state = addReaction(state, { postId, userId: "u-1", sticker: "like" }, now);
  completion = getPostCompletion(state, postId);

  assert.equal(state.reactions.length, 1);
  assert.equal(state.reactions[0].sticker, "done");
  assert.equal(completion.completedCount, 1);

  state = addReaction(state, { postId, userId: "u-1", sticker: "done" }, now);
  completion = getPostCompletion(state, postId);

  assert.equal(state.reactions.length, 0);
  assert.equal(completion.completedCount, 0);

  state = addReaction(state, { postId, userId: "u-1", sticker: "like" }, now);
  state = addReaction(state, { postId, userId: "u-1", sticker: "done" }, now);

  assert.equal(new Set(state.reactions.map((reaction) => reaction.id)).size, state.reactions.length);
});

test("like reaction does not mark a post complete", () => {
  let state = createInitialState(now);
  state = addPost(state, {
    type: "notice",
    title: "Week 1 guide",
    body: "Watch intro video",
    authorId: "u-admin",
  }, now);

  const postId = state.posts[0].id;
  state = addReaction(state, { postId, userId: "u-1", sticker: "like" }, now);

  const completion = getPostCompletion(state, postId);

  assert.equal(completion.completedCount, 0);
  assert.deepEqual(completion.completedUserIds, []);
});

test("comment marks a mission complete for the commenting user", () => {
  let state = createInitialState(now);
  state = addPost(state, {
    type: "mission",
    title: "Prompt practice",
    body: "Reply after reading",
    authorId: "u-admin",
  }, now);

  const postId = state.posts[0].id;
  state = addComment(state, { postId, userId: "u-2", body: "Checked" }, now);

  const completion = getPostCompletion(state, postId);

  assert.equal(state.comments.length, 1);
  assert.deepEqual(completion.completedUserIds, ["u-2"]);
});

test("question posts can include attachments and receive answer comments", () => {
  let state = createInitialState(now);
  state = addPost(state, {
    type: "question",
    title: "Can I attach a file?",
    body: "Need help",
    authorId: "u-1",
    attachmentUrl: "https://example.com/error.png",
  }, now);

  const postId = state.posts[0].id;
  state = addComment(state, { postId, userId: "u-admin", body: "Yes, attach it to the post." }, now);

  assert.equal(state.posts[0].attachmentUrl, "https://example.com/error.png");
  assert.equal(state.comments[0].body, "Yes, attach it to the post.");
});

test("link preview detects youtube, image, html, and generic links", () => {
  assert.deepEqual(getLinkPreview("https://youtu.be/abc123"), {
    type: "youtube",
    embedUrl: "https://www.youtube.com/embed/abc123",
    thumbnailUrl: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
  });
  assert.equal(getLinkPreview("https://example.com/poster.png").type, "image");
  assert.equal(getLinkPreview("https://example.com/course.html").type, "html");
  assert.equal(getLinkPreview("https://drive.google.com/file").type, "link");
});

test("post presentation separates media cards from text thread cards", () => {
  assert.deepEqual(getPostPresentation({ mediaUrl: "", attachmentUrl: "" }), { kind: "text" });
  assert.deepEqual(getPostPresentation({ mediaUrl: "https://example.com/slide.png", attachmentUrl: "" }), { kind: "media" });
  assert.deepEqual(getPostPresentation({ mediaUrl: "", attachmentUrl: "https://example.com/file.pdf" }), { kind: "media" });
});




test("signup request waits for admin approval before login", () => {
  let state = createInitialState(now);
  state = createSignupRequest(state, {
    name: "홍길동",
    department: "개발",
    password: "pass1234",
    passwordConfirm: "pass1234",
  }, now);

  assert.equal(state.signupRequests.length, 1);
  assert.equal(state.signupRequests[0].status, "pending");
  assert.equal(authenticateUser(state, { name: "홍길동", password: "pass1234" }), null);

  state = approveSignupRequest(state, state.signupRequests[0].id, now);
  const user = authenticateUser(state, { name: "홍길동", password: "pass1234" });

  assert.equal(user.name, "홍길동");
  assert.equal(user.department, "개발");
  assert.equal(user.role, "member");
});

test("signup validates department and matching password", () => {
  const state = createInitialState(now);

  assert.throws(() => createSignupRequest(state, {
    name: "홍길동",
    department: "없는부서",
    password: "pass1234",
    passwordConfirm: "pass1234",
  }, now), /department/);

  assert.throws(() => createSignupRequest(state, {
    name: "홍길동",
    department: "개발",
    password: "pass1234",
    passwordConfirm: "different",
  }, now), /password/);
});

test("mission completion can require selected people and multiple checkpoints", () => {
  let state = createInitialState(now);
  state = addPost(state, {
    type: "mission",
    title: "Watch training video",
    body: "Download, watch, then mark complete.",
    authorId: "u-admin",
    attachmentUrl: "https://example.com/video.mp4",
    targetUserIds: ["u-1", "u-2"],
    completionRules: ["download", "done"],
  }, now);

  const postId = state.posts[0].id;
  state = recordFileDownload(state, { postId, userId: "u-1" }, now);
  state = addReaction(state, { postId, userId: "u-1", sticker: "done" }, now);
  state = addReaction(state, { postId, userId: "u-2", sticker: "done" }, now);

  const completion = getPostCompletion(state, postId);

  assert.equal(completion.totalMembers, 2);
  assert.equal(completion.completedCount, 1);
  assert.deepEqual(completion.completedUserIds, ["u-1"]);
});
