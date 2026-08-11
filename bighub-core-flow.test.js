const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createInitialState,
  createSignupRequest,
  approveSignupRequest,
  authenticateUser,
  addPost,
  addComment,
  addReaction,
  recordFileDownload,
  getPostCompletion,
  departments,
} = require("./app-state");

const now = "2026-08-11T06:00:00.000Z";

test("core user flow works from signup approval through post activity completion", () => {
  let state = createInitialState(now);

  state = createSignupRequest(state, {
    loginId: "flowuser",
    name: "Flow User",
    department: departments[2],
    password: "pass1234",
    passwordConfirm: "pass1234",
  }, now);

  assert.equal(state.signupRequests.length, 1);
  assert.equal(state.signupRequests[0].status, "pending");
  assert.equal(authenticateUser(state, { loginId: "flowuser", password: "pass1234" }), null);

  state = approveSignupRequest(state, state.signupRequests[0].id, now);
  const user = authenticateUser(state, { loginId: "flowuser", password: "pass1234" });

  assert.ok(user);
  assert.equal(user.loginId, "flowuser");
  assert.equal(user.role, "member");

  state = addPost(state, {
    type: "mission",
    title: "Required reading",
    body: "Read, comment, download, and mark done.",
    authorId: "u-admin",
    attachmentUrl: "https://example.com/file.pdf",
    attachmentName: "file.pdf",
    attachmentMimeType: "application/pdf",
    targetUserIds: [user.id],
    completionRules: ["download", "done"],
  }, now);

  const postId = state.posts[0].id;
  state = addComment(state, { postId, userId: user.id, body: "Checked" }, now);
  state = recordFileDownload(state, { postId, userId: user.id }, now);
  state = recordFileDownload(state, { postId, userId: user.id }, now);
  state = addReaction(state, { postId, userId: user.id, sticker: "done" }, now);

  const completion = getPostCompletion(state, postId);

  assert.equal(state.comments.length, 1);
  assert.equal(state.downloads.length, 1);
  assert.equal(completion.totalMembers, 1);
  assert.equal(completion.completedCount, 1);
  assert.deepEqual(completion.completedUserIds, [user.id]);
});
