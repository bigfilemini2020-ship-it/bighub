const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const bundles = ["app.js", path.join("desktop-dist", "app.js")];
const driveBundles = ["app-drive.js", path.join("desktop-dist", "app-drive.js")];
const composeBundles = ["app-compose.js", path.join("desktop-dist", "app-compose.js")];

test("post refresh does not fail after content succeeds when profiles are unavailable", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("async function refreshRemoteData()");
    const end = source.indexOf("async function tryRefreshRemoteData()", start);
    const refresh = source.slice(start, end);

    assert.match(refresh, /const content = await window\.BigHubSupabase\.listContent\(\);/);
    assert.match(refresh, /try\s*{\s*const users = await window\.BigHubSupabase\.listProfiles\(\);/);
    assert.ok(refresh.indexOf("listContent()") < refresh.indexOf("listProfiles()"));
  }
});

test("inline attachment rows suppress duplicate footer download button", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("function saveControlHtml(post)");
    const end = source.indexOf("function setDriveFiles(files)", start);
    const saveControl = source.slice(start, end);

    assert.match(saveControl, /const hasInlineAttachments = attachments\.some\(/);
    assert.match(saveControl, /if \(hasInlineAttachments\) return "";/);
  }
});

test("remote restore does not clear local desktop sessions on transient profile gaps", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("async function restoreRemoteSession()");
    const end = source.indexOf("function mergeRemoteUser", start);
    const restore = source.slice(start, end);
    assert.doesNotMatch(restore, /clearSession\(\);/);
    assert.match(restore, /if \(!profile\) \{/);
    assert.match(restore, /hydrateCurrentUserId\(\);\s*return;/);
  }
});

test("Drive and Mux functions use BigHubConfig", () => {
  for (const bundle of driveBundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    assert.match(source, /const config = window\.BigHubConfig \|\| \{\};/);
    assert.doesNotMatch(source, /BigHubSupabaseConfig/);
  }
});
test("desktop bundle loads Supabase from local vendor", () => {
  for (const file of ["index.html", path.join("desktop-dist", "index.html")]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(source, /<script src="vendor\/supabase-js\.js"><\/script>/);
    assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/);
  }
  assert.ok(fs.existsSync(path.join(__dirname, "vendor", "supabase-js.js")));
  assert.ok(fs.existsSync(path.join(__dirname, "desktop-dist", "vendor", "supabase-js.js")));
});

test("YouTube previews use iframe embeds when embedding is allowed", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("function mediaPreviewHtml(url, post)");
    const end = source.indexOf("async function muxPlaybackUrl", start);
    const mediaPreview = source.slice(start, end);

    assert.match(mediaPreview, /youtube-preview"><iframe/);
    assert.match(mediaPreview, /preview\.embedUrl/);
    assert.doesNotMatch(mediaPreview, /youtube-link-preview/);
  }
});
test("remote refresh preserves the signed-in user when profile lists omit it", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("async function refreshRemoteData()");
    const end = source.indexOf("async function tryRefreshRemoteData()", start);
    const refresh = source.slice(start, end);

    assert.match(refresh, /const activeUser = currentUser\(\);/);
    assert.match(refresh, /if \(currentUserId && !currentUser\(\)\)/);
    assert.match(refresh, /window\.BigHubSupabase\.currentProfile\(\)\.catch/);
    assert.match(refresh, /else if \(activeUser\) mergeRemoteUser\(activeUser\)/);
  }
});
test("current user snapshot keeps authenticated rendering during profile gaps", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const session = fs.readFileSync(path.join(__dirname, bundle.startsWith("desktop-dist") ? "desktop-dist/app-session.js" : "app-session.js"), "utf8");
    assert.match(session, /var currentUserSnapshot = loadCurrentUserSnapshot\(\);/);
    assert.match(source, /currentUserSnapshot\?\.id === currentUserId \? currentUserSnapshot : null/);
    assert.match(source, /if \(user\.id === currentUserId\) \{[\s\S]*?currentUserSnapshot = user;[\s\S]*?localStorage\.setItem\(currentUserSnapshotKey, JSON\.stringify\(user\)\);/);
    assert.match(session, /currentUserSnapshot = null;/);
  }
});

test("download still completes when download event recording is blocked", () => {
  for (const bundle of driveBundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("async function downloadDriveFile(url, postId)");
    const end = source.indexOf("function isDriveDownloadUrl(url)", start);
    const download = source.slice(start, end);

    assert.match(source, /function saveBlobDownload\(blob, filename\)/);
    assert.match(download, /try \{\s*if \(remoteAuth\(\)\)/);
    assert.match(download, /console\.warn\("Download record skipped", error\);/);
    assert.ok(download.search(/setDownloadStatus\([^\n]+, 100, "success"\)/) < download.indexOf("recordFileDownload"));
  }
});
test("desktop Drive downloads fetch through Supabase and save through native filesystem", () => {
  for (const bundle of driveBundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("async function downloadDriveFile(url, postId)");
    const end = source.indexOf("function isDriveDownloadUrl(url)", start);
    const download = source.slice(start, end);

    assert.match(source, /function setDownloadStatus\(/);
    assert.match(source, /function driveDownloadParams\(/);
    assert.match(download, /setDownloadStatus\([^\n]+, 8\)/);
    assert.match(download, /fetch\(normalizeDriveDownloadUrl\(url\), \{ headers: await driveHeaders\(\) \}\)/);
    assert.match(download, /desktopInvoke\("save_downloaded_file", \{ input: \{ name: filename, data: Array\.from\(new Uint8Array\(await blob\.arrayBuffer\(\)\)\) \} \}\)/);
    assert.doesNotMatch(download, /desktopInvoke\("download_drive_file"/);
    assert.match(download, /setDownloadStatus\([^\n]+, 100, "success"\)/);
  }
});

test("sidebar reset button is labeled refresh", () => {
  for (const file of ["index.html", path.join("desktop-dist", "index.html")]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(source, /id="resetDemo"[\s\S]*?<strong>새로고침<\/strong>/);
    assert.doesNotMatch(source, /id="resetDemo"[\s\S]*?<strong>초기화<\/strong>/);
  }
});
test("Rust exposes only native save command for desktop downloads", () => {
  const source = fs.readFileSync(path.join(__dirname, "src-tauri", "src", "lib.rs"), "utf8");
  assert.match(source, /struct SaveDownloadedFileInput/);
  assert.match(source, /async fn save_downloaded_file/);
  assert.match(source, /save_downloaded_file/);
  assert.doesNotMatch(source, /upload_drive_file/);
  assert.doesNotMatch(source, /download_drive_file/);
  assert.doesNotMatch(source, /GOOGLE_OAUTH_/);
});
test("remote session id keeps app shell visible while the profile refresh catches up", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    assert.match(source, /function fallbackRemoteUser\(\)/);
    assert.match(source, /remoteAuth\(\) && currentUserId/);
    assert.match(source, /name: "사용자/);
    assert.match(source, /function currentUser\(\)[\s\S]*fallbackRemoteUser\(\)/);
  }
});

test("post submit refreshes the authenticated profile before remote save", () => {
  for (const bundle of composeBundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf('byId("postForm").addEventListener("submit"');
    const end = source.indexOf('function renderDesktopSettings()', start);
    const submit = source.slice(start, end);

    assert.match(submit, /const remoteUser = await window\.BigHubSupabase\.currentProfile\(\);/);
    assert.match(submit, /if \(!remoteUser\?\.id\) throw new Error/);
    assert.match(submit, /currentUserId = remoteUser\.id;/);
    assert.match(submit, /mergeRemoteUser\(remoteUser\);/);
    assert.match(submit, /const payload = \{ \.\.\.data, authorId: currentUserId \};/);
    assert.match(submit, /await refreshRemoteData\(\);/);
  }
});
test("persisted current user snapshot restores app shell after a transient id loss", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const session = fs.readFileSync(path.join(__dirname, bundle.startsWith("desktop-dist") ? "desktop-dist/app-session.js" : "app-session.js"), "utf8");
    assert.match(session, /const currentUserSnapshotKey = "bighub-current-user-snapshot-v1";/);
    assert.match(session, /function loadCurrentUserSnapshot\(\)/);
    assert.match(session, /function hydrateCurrentUserId\(\)/);
    assert.match(source, /localStorage\.setItem\(currentUserSnapshotKey, JSON\.stringify\(user\)\)/);
    assert.match(session, /localStorage\.removeItem\(currentUserSnapshotKey\)/);
    assert.match(source, /const sessionUserId = hydrateCurrentUserId\(\);/);
    assert.match(source, /const signedIn = Boolean\(sessionUserId \|\| currentUser\(\)\);/);
  }
});
test("desktop settings expose a download folder picker", () => {
  for (const file of ["index.html", path.join("desktop-dist", "index.html")]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(source, /id="desktopDownloadDirPath"/);
    assert.match(source, /id="desktopDownloadDirButton"/);
  }
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    assert.match(source, /desktopSettings\.downloadDir/);
    assert.match(source, /desktopInvoke\("choose_download_dir"\)/);
    assert.match(source, /function renderDesktopSettings\(\)[\s\S]*desktopDownloadDirPath/);
  }
});

test("Rust saves downloads in the configured folder when present", () => {
  const source = fs.readFileSync(path.join(__dirname, "src-tauri", "src", "lib.rs"), "utf8");
  assert.match(source, /download_dir: Option<String>/);
  assert.match(source, /fn configured_download_dir/);
  assert.match(source, /fn choose_download_dir/);
  assert.match(source, /tauri_plugin_dialog::init\(\)/);
  assert.match(source, /configured_download_dir\(&app\)\?/);
  assert.match(source, /choose_download_dir,/);
});

test("remote session restore checks Supabase before clearing local session", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("async function restoreRemoteSession()");
    const end = source.indexOf("function mergeRemoteUser", start);
    const restore = source.slice(start, end);

    assert.match(restore, /const profile = await window\.BigHubSupabase\.currentProfile\(\);/);
    assert.doesNotMatch(restore, /localStorage\.getItem\(autoLoginKey\) !== "1"/);
    assert.doesNotMatch(restore, /await window\.BigHubSupabase\.signOut\(\);/);
  }
});
test("remote session restore keeps app state when Supabase profile is temporarily null", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("async function restoreRemoteSession()");
    const end = source.indexOf("function mergeRemoteUser", start);
    const restore = source.slice(start, end);
    assert.match(restore, /if \(!profile\) \{/);
    assert.match(restore, /hydrateCurrentUserId\(\);\s*return;/);
    assert.doesNotMatch(restore, /clearSession\(\);/);
    assert.doesNotMatch(restore, /diagMark/);
  }
});
test("render keeps app shell visible when a remote session id exists during profile gaps", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    const start = source.indexOf("function render()");
    const end = source.indexOf("function renderMissionTargets", start);
    const render = source.slice(start, end);
    assert.match(render, /const sessionUserId = hydrateCurrentUserId\(\);/);
    assert.match(render, /const signedIn = Boolean\(sessionUserId \|\| currentUser\(\)\);/);
    assert.doesNotMatch(render, /const signedIn = Boolean\(currentUser\(\)\);/);
  }
});
test("renderSearch is present because render calls it", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");
    assert.match(source, /function renderSearch\(\)/);
    assert.match(source, /renderCurrentUser\(\); renderFeed\(\); renderSearch\(\);/);
  }
});

test("post form uses JavaScript submit handler without inline cancellation", () => {
  for (const file of ["index.html", path.join("desktop-dist", "index.html")]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(source, /<form id="postForm" class="modal-form">/);
    assert.doesNotMatch(source, /onsubmit="return false;"/);
  }
});