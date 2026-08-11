const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const bundles = ["app.js", path.join("desktop-dist", "app.js")];
const htmlFiles = ["index.html", path.join("desktop-dist", "index.html")];
const rustFile = path.join("src-tauri", "src", "lib.rs");

test("desktop notification settings and test button are wired", () => {
  for (const file of htmlFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const marker of [
      'data-desktop-setting="notificationsEnabled"',
      'data-desktop-setting="notifyPosts"',
      'data-desktop-setting="notifyComments"',
      'data-desktop-setting="notifyMissions"',
      'id="desktopNotificationTestButton"',
      'id="desktopNotificationStatus"',
    ]) {
      assert.ok(source.includes(marker), `${file} contains ${marker}`);
    }
  }
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, "utf8");
    assert.match(source, /byId\("desktopNotificationTestButton"\)\?\.addEventListener\("click"/);
    assert.match(source, /notifyDesktop\("BigHub 알림 테스트"/);
  }
});



test("desktop notification test button keeps one-line layout", () => {
  for (const file of htmlFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /id="desktopNotificationTestButton" class="mini-button notification-test-button"/);
  }
  for (const file of ["styles.css", path.join("desktop-dist", "styles.css")]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /\.notification-test-button\s*\{/);
    assert.match(source, /white-space:\s*nowrap/);
    assert.match(source, /min-width:\s*108px/);
  }
});

test("desktop notification test shows countdown in status text", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, "utf8");
    const start = source.indexOf('byId("desktopNotificationTestButton")?.addEventListener("click"');
    const end = source.indexOf('byId("desktopUpdateButton")?.addEventListener', start);
    const body = source.slice(start, end);
    assert.match(body, /for \(let remaining = 3; remaining > 0; remaining -= 1\)/);
    assert.match(body, /remaining\}\\uCD08 \\uD6C4 \\uC54C\\uB9BC\\uC744 \\uBCF4\\uB0C5\\uB2C8\\uB2E4/);
    assert.match(body, /await wait\(1000\)/);
  }
});
test("desktop notification test waits before sending", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, "utf8");
    const start = source.indexOf('byId("desktopNotificationTestButton")?.addEventListener("click"');
    const end = source.indexOf('byId("desktopUpdateButton")?.addEventListener', start);
    const body = source.slice(start, end);
    assert.match(body, /await wait\(1000\)/, `${bundle} delays notification test`);
    assert.match(body, /for \(let remaining = 3; remaining > 0; remaining -= 1\)/, `${bundle} counts 3 seconds`);
  }
});
test("remote sync arms notifications after the initial refresh only", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, "utf8");
    assert.match(source, /let desktopNotificationsArmed = false;/);
    assert.match(source, /if \(desktopNotificationsArmed\) notifyForRemoteChanges\(beforePostIds, beforeCommentIds\);/);
    assert.match(source, /desktopNotificationsArmed = true;/);
  }
});

test("notifyDesktop writes diagnostic results", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, "utf8");
    const start = source.indexOf("async function notifyDesktop");
    const end = source.indexOf("function notifyForRemoteChanges", start);
    const body = source.slice(start, end);
    assert.match(body, /clientLog\("notification-sent"/);
    assert.match(body, /clientLog\("notification-failed"/);
    assert.match(body, /desktopInvoke\("notify_desktop"/);
  }
});

test("Tauri notification command requests permission and shows notification", () => {
  const source = fs.readFileSync(rustFile, "utf8");
  assert.match(source, /fn notify_desktop\(app: AppHandle, title: String, body: String\) -> Result<\(\), String>/);
  assert.match(source, /request_permission\(\)/);
  assert.match(source, /PermissionState::Granted/);
  assert.match(source, /\.builder\(\)\s*\.title\(title\)\s*\.body\(body\)\s*\.show\(\)/s);
  assert.match(source, /notify_desktop,/);
});

test("Tauri notification command requests taskbar attention", () => {
  const source = fs.readFileSync(rustFile, "utf8");
  assert.match(source, /UserAttentionType/);
  assert.match(source, /request_taskbar_attention\(&app\)/);
  assert.match(source, /request_user_attention\(Some\(UserAttentionType::Informational\)\)/);
});
test("Tauri taskbar attention does not foreground hidden tray window", () => {
  const source = fs.readFileSync(rustFile, "utf8");
  const start = source.indexOf("fn request_taskbar_attention");
  const end = source.indexOf("#[tauri::command]", start);
  const body = source.slice(start, end);
  assert.match(body, /is_visible\(\)/);
  assert.match(body, /if visible \{/);
  assert.doesNotMatch(body, /window\.show\(\)/);
  assert.doesNotMatch(body, /window\.minimize\(\)/);
  assert.match(body, /request_user_attention\(Some\(UserAttentionType::Informational\)\)/);
});