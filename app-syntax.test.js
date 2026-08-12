const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

test("web and desktop bundles parse before packaging", () => {
  for (const file of ["app.js", "desktop-dist/app.js"]) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }));
  }
});

test("session code is split into its own browser bundle", () => {
  for (const file of ["app-session.js", "desktop-dist/app-session.js"]) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }));
  }

  for (const htmlFile of ["index.html", "desktop-dist/index.html"]) {
    const html = require("node:fs").readFileSync(htmlFile, "utf8");
    const sessionIndex = html.indexOf('app-session.js?v=session-0811-1');
    const appIndex = html.indexOf('app.js?v=prod-0811-16');
    assert.notEqual(sessionIndex, -1, `${htmlFile} loads app-session.js`);
    assert.notEqual(appIndex, -1, `${htmlFile} loads current app.js bundle`);
    assert.ok(sessionIndex < appIndex, `${htmlFile} loads session before app`);
  }

  for (const appFile of ["app.js", "desktop-dist/app.js"]) {
    const app = require("node:fs").readFileSync(appFile, "utf8");
    assert.doesNotMatch(app, /const sessionKey =/);
    assert.doesNotMatch(app, /const rememberedLoginIdKey =/);
    assert.doesNotMatch(app, /const autoLoginKey =/);
    assert.doesNotMatch(app, /const currentUserSnapshotKey =/);
    assert.doesNotMatch(app, /let currentUserId =/);
    assert.doesNotMatch(app, /let currentUserSnapshot =/);
    assert.doesNotMatch(app, /function loadCurrentUserSnapshot\(/);
    assert.doesNotMatch(app, /function hydrateCurrentUserId\(/);
    assert.doesNotMatch(app, /function setSession\(/);
    assert.doesNotMatch(app, /function clearSession\(/);
  }

  const session = require("node:fs").readFileSync("app-session.js", "utf8");
  for (const marker of [
    'const sessionKey = "bighub-session-v1"',
    'const rememberedLoginIdKey = "bighub-remembered-login-id"',
    'const autoLoginKey = "bighub-auto-login"',
    'const currentUserSnapshotKey = "bighub-current-user-snapshot-v1"',
    'function hydrateCurrentUserId()',
    'function setSession(userId, autoLogin)',
    'function clearSession()'
  ]) {
    assert.ok(session.includes(marker), `session bundle contains ${marker}`);
  }
});
test("drive and attachment transport code is split into its own browser bundle", () => {
  for (const file of ["app-drive.js", "desktop-dist/app-drive.js"]) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }));
  }

  for (const htmlFile of ["index.html", "desktop-dist/index.html"]) {
    const html = require("node:fs").readFileSync(htmlFile, "utf8");
    const sessionIndex = html.indexOf('app-session.js?v=session-0811-1');
    const driveIndex = html.indexOf('app-drive.js?v=drive-0811-1');
    const appIndex = html.indexOf('app.js?v=prod-0811-16');
    assert.notEqual(driveIndex, -1, `${htmlFile} loads app-drive.js`);
    assert.notEqual(appIndex, -1, `${htmlFile} loads current app.js bundle`);
    assert.ok(sessionIndex < driveIndex, `${htmlFile} loads drive after session`);
    assert.ok(driveIndex < appIndex, `${htmlFile} loads drive before app`);
  }

  for (const appFile of ["app.js", "desktop-dist/app.js"]) {
    const app = require("node:fs").readFileSync(appFile, "utf8");
    for (const pattern of [
      /let selectedDriveFileList =/,
      /let downloadToastTimer =/,
      /const driveMediaObjectUrls =/,
      /const driveMediaLoads =/,
      /function driveFileKey\(/,
      /function selectedDriveFiles\(/,
      /function addDriveFiles\(/,
      /function clearUploadedAttachments\(/,
      /function updateDriveFileStatus\(/,
      /function authHeaders\(/,
      /function setUploadStatus\(/,
      /function setDownloadStatus\(/,
      /function driveFunctionUrl\(/,
      /function driveHeaders\(/,
      /function uploadDriveFile\(/,
      /function downloadDriveFile\(/,
      /function isDriveDownloadUrl\(/,
      /function driveFileName\(/,
      /function hydrateDriveVideos\(/
    ]) {
      assert.doesNotMatch(app, pattern, `${appFile} should not own ${pattern}`);
    }
  }

  const drive = require("node:fs").readFileSync("app-drive.js", "utf8");
  for (const marker of [
    'function selectedDriveFiles()',
    'function addDriveFiles(files, { resetInput = true } = {})',
    'function clearUploadedAttachments()',
    'function setUploadStatus(message, progress = 0)',
    'function driveFunctionUrl(name, parameters = {})',
    'async function driveHeaders()',
    'async function uploadDriveFile(file)',
    'async function downloadDriveFile(url, postId)',
    'function isDriveDownloadUrl(url)',
    'async function hydrateDriveVideos()'
  ]) {
    assert.ok(drive.includes(marker), `drive bundle contains ${marker}`);
  }
});
test("compose form code is split into its own browser bundle", () => {
  for (const file of ["app-compose.js", "desktop-dist/app-compose.js"]) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" }));
  }

  for (const htmlFile of ["index.html", "desktop-dist/index.html"]) {
    const html = require("node:fs").readFileSync(htmlFile, "utf8");
    const driveIndex = html.indexOf('app-drive.js?v=drive-0811-1');
    const composeIndex = html.indexOf('app-compose.js?v=compose-0811-1');
    const appIndex = html.indexOf('app.js?v=prod-0811-16');
    assert.notEqual(composeIndex, -1, `${htmlFile} loads app-compose.js`);
    assert.notEqual(appIndex, -1, `${htmlFile} loads current app.js bundle`);
    assert.ok(driveIndex < composeIndex, `${htmlFile} loads compose after drive`);
    assert.ok(composeIndex < appIndex, `${htmlFile} loads compose before app`);
  }

  for (const appFile of ["app.js", "desktop-dist/app.js"]) {
    const app = require("node:fs").readFileSync(appFile, "utf8");
    for (const pattern of [
      /let editingPostId =/,
      /let uploadedAttachments =/,
      /let removeExistingAttachment =/,
      /function openComposeModal\(/,
      /function openEditModal\(/,
      /function closeComposeModal\(/,
      /function bindDriveDropZone\(/,
      /function bindForms\(/,
      /postForm"\)\.addEventListener\("submit"/
    ]) {
      assert.doesNotMatch(app, pattern, `${appFile} should not own ${pattern}`);
    }
  }

  const compose = require("node:fs").readFileSync("app-compose.js", "utf8");
  for (const marker of [
    'var editingPostId = ""',
    'var uploadedAttachments = []',
    'var removeExistingAttachment = false',
    'function openComposeModal()',
    'function openEditModal(postId)',
    'function closeComposeModal()',
    'function bindDriveDropZone()',
    'function bindForms()'
  ]) {
    assert.ok(compose.includes(marker), `compose bundle contains ${marker}`);
  }
});
test("signup submit keeps form reference and guides duplicate requests", () => {
  for (const file of ["app.js", "desktop-dist/app.js"]) {
    const app = require("node:fs").readFileSync(file, "utf8");
    assert.match(app, /const signupForm = event.currentTarget/);
    assert.ok(app.includes("new FormData(signupForm)"));
    assert.ok(app.includes("signupForm.reset()"));
    assert.ok(!app.includes("event.currentTarget.reset"));
    assert.ok(app.includes('message.includes("\\uC774\\uBBF8 \\uAC00\\uC785")'));
    assert.ok(app.includes('message.includes("\\uAC00\\uC785 \\uC2E0\\uCCAD\\uB41C")'));
    assert.ok(app.includes('message.includes("\\uAD00\\uB9AC\\uC790 \\uC2B9\\uC778")'));
    assert.ok(app.includes('message.includes("\\uC2B9\\uC778 \\uD6C4 \\uB85C\\uADF8\\uC778")'));
    assert.ok(app.includes("alert(message);"));
    assert.ok(app.includes('byId("loginMessage").textContent = message'));
    assert.ok(app.includes('setAuthMode("login")'));
  }
});


test("signup approval buttons surface remote failures", () => {
  for (const file of ["app.js", "desktop-dist/app.js"]) {
    const app = require("node:fs").readFileSync(file, "utf8");
    assert.ok(app.includes('target.dataset.action === "approve-signup"'));
    assert.ok(app.includes('target.dataset.action === "reject-signup"'));
    assert.ok(app.includes('await window.BigHubSupabase.approveProfile'));
    assert.ok(app.includes('await window.BigHubSupabase.rejectProfile'));
    assert.ok(app.includes('catch (error)'));
    assert.ok(app.includes('\\uAC00\\uC785 \\uC2B9\\uC778 \\uCC98\\uB9AC\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4.'));
    assert.ok(app.includes('\\uAC00\\uC785 \\uAC70\\uC808 \\uCC98\\uB9AC\\uC5D0 \\uC2E4\\uD328\\uD588\\uC2B5\\uB2C8\\uB2E4.'));
  }
});
