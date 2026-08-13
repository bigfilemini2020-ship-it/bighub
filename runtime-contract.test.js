const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const crypto = require("node:crypto");

const bundleSets = [
  ["app-session.js", "app-drive.js", "app-compose.js", "app.js"],
  ["desktop-dist/app-session.js", "desktop-dist/app-drive.js", "desktop-dist/app-compose.js", "desktop-dist/app.js"],
];

function joinedSource(files) {
  return files.map((file) => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n");
}

test("render pipeline only calls render helpers that exist in loaded bundles", () => {
  for (const files of bundleSets) {
    const source = joinedSource(files);
    const called = new Set(Array.from(source.matchAll(/\b(render[A-Z][A-Za-z0-9_]*)\s*\(/g)).map((match) => match[1]));
    const defined = new Set(Array.from(source.matchAll(/function\s+(render[A-Z][A-Za-z0-9_]*)\s*\(/g)).map((match) => match[1]));
    const missing = [...called].filter((name) => !defined.has(name)).sort();
    assert.deepEqual(missing, [], `${files.join(", ")} missing ${missing.join(", ")}`);
  }
});

// The render-helper check above only covers render*-named functions, so a
// missing commentsHtml() slipped through: opening a comment panel on a post
// that had comments threw ReferenceError and the card fell back to
// "게시글을 표시하는 중 문제가 발생했습니다." Same shape, whole *Html convention.
test("every *Html helper called in the bundles is defined in them", () => {
  for (const files of bundleSets) {
    const source = joinedSource(files);
    const called = new Set(Array.from(source.matchAll(/\b([a-z][A-Za-z0-9_]*Html)\s*\(/g)).map((match) => match[1]));
    const defined = new Set(Array.from(source.matchAll(/function\s+([a-z][A-Za-z0-9_]*Html)\s*\(/g)).map((match) => match[1]));
    const missing = [...called].filter((name) => !defined.has(name)).sort();
    assert.deepEqual(missing, [], `${files.join(", ")} missing ${missing.join(", ")}`);
  }
});

test("main bundles do not contain known undefined-function regressions", () => {
  for (const files of bundleSets) {
    const source = joinedSource(files);
    for (const name of ["renderSearch", "dateText", "formatFileSize"]) {
      assert.match(source, new RegExp(`function ${name}\\(`), `${name} must be defined`);
    }
  }
});

test("client diagnostics avoid high-frequency render logging", () => {
  for (const file of ["app.js", "desktop-dist/app.js"]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.doesNotMatch(source, /clientLog\("render"/);
  }
});
test("approval UI exposes reject action", () => {
  const app = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  assert.match(app, /data-action="reject-signup"/);
  assert.match(app, /rejectProfile\(target\.dataset\.requestId\)/);
  assert.match(app, /rejectSignupRequest\(state, target\.dataset\.requestId\);/);
});


test("signup request schema uses temporary requests", () => {
  const schema = fs.readFileSync(path.join(__dirname, "supabase-schema.sql"), "utf8");
  assert.match(schema, /create table if not exists public.signup_requests/);
  assert.match(schema, /password_ciphertext text/);
  assert.match(schema, /create policy "admins select signup requests"/);
  assert.match(schema, /create or replace function public.request_signup/);
  assert.match(schema, /grant execute on function public.request_signup/);
  assert.match(schema, /drop trigger if exists on_auth_user_created on auth.users/);
  assert.doesNotMatch(schema, /create trigger on_auth_user_created/);
  assert.doesNotMatch(schema, /create policy "profiles insert own pending"/);
  assert.match(schema, /type <> 'notice' or \(select public\.is_admin\(\)\)/);
});

test("signup edge functions are wired to request table and admin auth", () => {
  const requestSignup = fs.readFileSync(path.join(__dirname, "supabase/functions/request-signup/index.ts"), "utf8");
  const approveSignup = fs.readFileSync(path.join(__dirname, "supabase/functions/approve-signup/index.ts"), "utf8");
  const rejectSignup = fs.readFileSync(path.join(__dirname, "supabase/functions/reject-signup/index.ts"), "utf8");
  const schema = fs.readFileSync(path.join(__dirname, "supabase-schema.sql"), "utf8");
  assert.ok(requestSignup.includes("/rest/v1/rpc/request_signup"));
  assert.match(requestSignup, /BIGHUB_SIGNUP_SECRET/);
  assert.match(requestSignup, /function defaultSecret/);
  assert.match(requestSignup, /SUPABASE_SECRET_KEYS/);
  assert.doesNotMatch(requestSignup, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.match(requestSignup, /passwordConfirm/);
  assert.match(approveSignup, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.match(approveSignup, /if \(!key.startsWith\("sb_secret_"\)\) headers.Authorization = "Bearer " \+ key/);
  assert.match(approveSignup, /auth\/v1\/admin\/users/);
  assert.match(approveSignup, /rpc\/approve_signup_request/);
  assert.ok(rejectSignup.includes("/rest/v1/rpc/reject_signup_request"));
  assert.match(rejectSignup, /bearerToken\(req\)/);
  assert.doesNotMatch(rejectSignup, /auth\/v1\/user/);
  assert.match(rejectSignup, /alreadyHandled/);
  assert.doesNotMatch(rejectSignup, /status: "rejected"/);
  assert.match(schema, /create or replace function public\.approve_signup_request/);
  assert.match(schema, /grant execute on function public\.request_signup\(text, text, text, text, text\) to service_role/);
  assert.match(schema, /create or replace function public\.reject_signup_request/);
  assert.match(schema, /grant execute on function public\.reject_signup_request\(uuid\) to authenticated/);
  for (const source of [requestSignup, approveSignup, rejectSignup]) {
    assert.ok(source.includes('replace(/\\/$/, "")'));
    assert.ok(!source.includes('replace(//$/, "")'));
  }
});




test("admin signup edge functions keep opaque secret keys out of bearer auth", () => {
  for (const file of ["supabase/functions/approve-signup/index.ts"]) {
    const source = fs.readFileSync(path.join(__dirname, file), "utf8");
    assert.match(source, /if \(!key.startsWith\("sb_secret_"\)\) headers.Authorization = "Bearer " \+ key/);
    assert.doesNotMatch(source, /return \{ apikey: key, Authorization: "Bearer " \+ key/);
  }
});

test("signup schema has one canonical lifecycle definition", () => {
  const schema = fs.readFileSync(path.join(__dirname, "supabase-schema.sql"), "utf8");
  const count = (pattern) => (schema.match(pattern) || []).length;
  assert.equal(count(/create or replace function public\.request_signup\(/g), 1);
  assert.equal(count(/create or replace function public\.approve_signup_request\(/g), 1);
  assert.equal(count(/create or replace function public\.reject_signup_request\(/g), 1);
  assert.equal(count(/create policy "admins select signup requests"/g), 1);
  assert.doesNotMatch(schema, /approved_at = coalesce\(public\.profiles\.approved_at, now\(\)\);\r?\n\s+then/);
});

// The token-match test below only proves the ?v= values agree with each other.
// Editing styles.css without changing webAppVersion keeps them agreeing while
// WebView2 serves the cached old file -- the refresh spinner shipped invisible
// that way. Pinning a hash of the assets to the version forces the bump.
//
// When this fails: bump webAppVersion in app.js, the ?v= tokens in index.html
// (both copies), then paste the reported sha256 into asset-fingerprint.json.
test("asset fingerprint matches webAppVersion and the desktop mirror", () => {
  const fingerprint = JSON.parse(fs.readFileSync(path.join(__dirname, "asset-fingerprint.json"), "utf8"));
  const version = fs.readFileSync(path.join(__dirname, "app.js"), "utf8").match(/const webAppVersion = "([^"]+)"/)?.[1];
  assert.equal(fingerprint.webAppVersion, version, "asset-fingerprint.json is stale: webAppVersion moved");

  const hash = crypto.createHash("sha256");
  for (const asset of fingerprint.assets) {
    const root = fs.readFileSync(path.join(__dirname, asset));
    const mirror = fs.readFileSync(path.join(__dirname, "desktop-dist", asset));
    assert.ok(root.equals(mirror), `desktop-dist/${asset} differs from the root copy`);
    hash.update(asset);
    hash.update(root);
  }
  assert.equal(hash.digest("hex"), fingerprint.sha256, "assets changed without a webAppVersion bump");
});

// ponytail: 캐시버스터를 손으로 맞춘다. 자산이 늘거나 배포가 잦아지면 index.html 생성 스텝으로 올려라.
test("cache-buster tokens match webAppVersion in every bundle", () => {
  for (const dir of [".", "desktop-dist"]) {
    const app = fs.readFileSync(path.join(__dirname, dir, "app.js"), "utf8");
    const version = app.match(/const webAppVersion = "([^"]+)"/)?.[1];
    assert.ok(version, `${dir}/app.js must declare webAppVersion`);
    const html = fs.readFileSync(path.join(__dirname, dir, "index.html"), "utf8");
    const stale = Array.from(html.matchAll(/(?:src|href)="([^"?]+)\?v=([^"]+)"/g))
      .filter(([, , token]) => token !== version)
      .map(([, asset, token]) => `${asset}?v=${token}`);
    assert.deepEqual(stale, [], `${dir}/index.html cache-busters must be ?v=${version}`);
  }
});

// checkDesktopUpdate holds desktopUpdateChecking for its whole body. Awaiting a
// dialog inside it kept that flag set while the prompt waited, so the settings
// button returned null and did nothing on 0.1.33.
test("the update check never waits on a dialog while holding its guard", () => {
  for (const dir of [".", "desktop-dist"]) {
    const app = fs.readFileSync(path.join(__dirname, dir, "app.js"), "utf8");
    const start = app.indexOf("async function checkDesktopUpdate(");
    assert.ok(start > -1, `${dir}/app.js must define checkDesktopUpdate`);
    const body = app.slice(start, app.indexOf("\n}", start));
    assert.doesNotMatch(body, /\bconfirm\(/, `${dir}: prompt outside the guarded check`);
    assert.doesNotMatch(body, /installDesktopUpdate\(/, `${dir}: install outside the guarded check`);
    assert.match(body, /desktopUpdateChecking = false;/, `${dir}: the guard must still be released`);
  }
});

// The dialog plugin kept refusing: bighub-client.log recorded
// "plugin:dialog|confirm not allowed by ACL" even on builds whose capability
// lists dialog:allow-confirm. A refused dialog rejects, so nothing appears and
// no answer arrives -- the delete confirmation and the update prompt both died
// that way. The app owns both dialogs now and depends on no plugin.
test("alert and confirm are the app's own, not the dialog plugin's", () => {
  for (const dir of [".", "desktop-dist"]) {
    const app = fs.readFileSync(path.join(__dirname, dir, "app.js"), "utf8");
    assert.match(app, /^function alert\(message\) \{/m, `${dir}: alert must be the app's`);
    assert.match(app, /^function confirm\(message\) \{/m, `${dir}: confirm must be the app's`);
    assert.match(app, /function showAppDialog\(message, options = \{\}\) \{/, `${dir}: shared dialog implementation`);
    assert.match(app, /resolve\(value\)/, `${dir}: the dialog must resolve an answer`);
  }
});

// Tauri routes window.alert/confirm through the dialog plugin, so both need ACL
// permissions or every dialog in the app dies as an unhandled rejection. That is
// what bighub-client.log recorded: 30 denials of plugin:dialog|message and 3 of
// plugin:dialog|confirm. File dialogs stay out — the capability also covers
// remote URLs, and directory picking has its own Rust command.
test("desktop capability grants the dialog commands alert and confirm need", () => {
  const capability = JSON.parse(fs.readFileSync(path.join(__dirname, "src-tauri/capabilities/default.json"), "utf8"));
  assert.ok(capability.permissions.includes("dialog:allow-message"), "alert() needs dialog:allow-message");
  assert.ok(capability.permissions.includes("dialog:allow-confirm"), "confirm() needs dialog:allow-confirm");
  assert.ok(!capability.permissions.includes("dialog:default"), "dialog:default would also grant file open/save");
});

// Under Tauri confirm() resolves asynchronously, so an unawaited call yields a
// Promise -- always truthy. `if (!confirm(...)) return;` then deletes without
// asking. Awaiting is correct in the browser too, where it is already a boolean.
test("every confirm() is awaited", () => {
  for (const dir of [".", "desktop-dist"]) {
    const app = fs.readFileSync(path.join(__dirname, dir, "app.js"), "utf8");
    // "function confirm(" is the app's own declaration, not a call site.
    const unawaited = Array.from(app.matchAll(/(?<!await\s)(?<!function )\bconfirm\(/g))
      .map((match) => app.slice(Math.max(0, match.index - 60), match.index + 40).split("\n").pop());
    assert.deepEqual(unawaited, [], `${dir}/app.js has an unawaited confirm()`);
  }
});

// A pending user has no auth account, so signInWithPassword cannot distinguish
// them from a wrong password. The status check inside signIn runs only after a
// successful sign-in and never fires for them.
test("login reports pending approval instead of bad credentials", () => {
  const schema = fs.readFileSync(path.join(__dirname, "supabase-schema.sql"), "utf8");
  assert.match(schema, /create or replace function public\.signup_is_pending\(login_id_input text\)/);
  assert.ok(schema.includes("grant execute on function public.signup_is_pending(text) to anon, authenticated;"));
  assert.doesNotMatch(schema, /signup_is_pending[\s\S]{0,400}from public\.profiles/);

  for (const dir of [".", "desktop-dist"]) {
    const client = fs.readFileSync(path.join(__dirname, dir, "supabase-client.js"), "utf8");
    assert.match(client, /invalid login credentials/, `${dir} must branch on the auth error`);
    assert.match(client, /rpc\("signup_is_pending", \{ login_id_input: loginId \}\)/, `${dir} must ask the database`);
    assert.match(client, /관리자 승인 대기 중입니다/, `${dir} must say pending, not bad credentials`);

    const app = fs.readFileSync(path.join(__dirname, dir, "app.js"), "utf8");
    assert.match(app, /function showLoginError\(message\) \{[\s\S]*?alert\(message\);/, `${dir} must alert login errors`);
    assert.doesNotMatch(app, /byId\("loginMessage"\)\.textContent = error\.message/, `${dir} must route login errors through showLoginError`);
  }
});

test("signup lifecycle does not retain rejected requests", () => {
  const schema = fs.readFileSync(path.join(__dirname, "supabase-schema.sql"), "utf8");
  const start = schema.indexOf("create or replace function public.request_signup(");
  const end = schema.indexOf("$fn$;", start);
  const requestSignup = schema.slice(start, end);
  assert.doesNotMatch(requestSignup, /existing_request_status = 'rejected'/);
  assert.doesNotMatch(requestSignup, /status = 'rejected'/);
});