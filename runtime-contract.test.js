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
  assert.ok(requestSignup.includes("/rest/v1/rpc/request_signup"));
  assert.match(requestSignup, /BIGHUB_SIGNUP_SECRET/);
  assert.match(requestSignup, /function defaultSecret/);
  assert.match(requestSignup, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.doesNotMatch(requestSignup, /SUPABASE_SECRET_KEYS/);
  assert.match(approveSignup, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.match(approveSignup, /sb_secret_/);
  assert.match(approveSignup, /auth\/v1\/admin\/users/);
  assert.match(approveSignup, /password_ciphertext: null/);
  assert.match(rejectSignup, /method: "DELETE"/);
  assert.doesNotMatch(rejectSignup, /status: "rejected"/);
  for (const source of [requestSignup, approveSignup, rejectSignup]) {
    assert.ok(source.includes('replace(/\\/$/, "")'));
    assert.ok(!source.includes('replace(//$/, "")'));
  }
});


