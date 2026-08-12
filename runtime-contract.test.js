const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

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