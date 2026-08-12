const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("profile approval metadata is not self-updatable", () => {
  const schema = fs.readFileSync(path.join(__dirname, "supabase-schema.sql"), "utf8");
  assert.match(schema, /revoke update on public.profiles from authenticated;/);
  assert.ok(schema.includes("grant update (avatar) on public.profiles to authenticated;"));
  assert.doesNotMatch(schema, /grant update ([^)]*status[^)]*) on public.profiles to authenticated;/);
  assert.doesNotMatch(schema, /grant update ([^)]*approved_at[^)]*) on public.profiles to authenticated;/);
  assert.doesNotMatch(schema, /grant update ([^)]*approved_by[^)]*) on public.profiles to authenticated;/);
});

test("security definer functions revoke default PUBLIC execute", () => {
  const schema = fs.readFileSync(path.join(__dirname, "supabase-schema.sql"), "utf8");
  for (const signature of ["public.is_admin()", "public.is_approved()", "public.delete_post(uuid)", "public.request_signup(text, text, text, text, text)"]) {
    assert.ok(schema.includes("revoke execute on function " + signature + " from public;"));
  }
});

test("request signup has a basic pending flood limit", () => {
  const schema = fs.readFileSync(path.join(__dirname, "supabase-schema.sql"), "utf8");
  assert.ok(schema.includes("created_at > now() - interval '10 minutes'"));
  assert.match(schema, /'status', 429/);
});

test("approve signup can recover existing Auth user and rolls back new Auth user on downstream failure", () => {
  const source = fs.readFileSync(path.join(__dirname, "supabase", "functions", "approve-signup", "index.ts"), "utf8");
  assert.match(source, /async function findAuthUserByEmail/);
  assert.match(source, /async function createOrFindAuthUser/);
  assert.match(source, /already|registered|exists|duplicate/);
  assert.match(source, /async function deleteAuthUser/);
  assert.ok(source.includes("if (created) await deleteAuthUser(userPayload.id);"));
});

test("drive download verifies the file id belongs to the requested post", () => {
  const source = fs.readFileSync(path.join(__dirname, "supabase", "functions", "drive-download", "index.ts"), "utf8");
  assert.match(source, /async function requirePostAttachment/);
  assert.match(source, /select=attachment_url,media_url/);
  assert.ok(source.includes("await requirePostAttachment(req, postId, id);"));
  assert.ok(source.includes("ids.includes(fileId)"));
});
