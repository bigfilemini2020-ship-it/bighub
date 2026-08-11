const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const driveBundles = ["app-drive.js", "desktop-dist/app-drive.js"];

test("Drive upload and image preview messages contain no corrupted question-mark text", () => {
  for (const file of driveBundles) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /function uploadErrorMessage\(error\)/);
    assert.match(source, /async function hydrateDriveVideos\(\)/);
    assert.doesNotMatch(source, /\?\?\?|\?\?\?\?/);
  }
  for (const file of ["supabase/functions/drive-upload/index.ts", "supabase/functions/drive-download/index.ts", "supabase/functions/_shared/index.ts"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\?\?\?|\?\?\?\?/);
  }
});

test("desktop app keeps browser bundles aligned with source", () => {
  assert.equal(fs.readFileSync("app.js", "utf8"), fs.readFileSync("desktop-dist/app.js", "utf8"));
  assert.equal(fs.readFileSync("app-drive.js", "utf8"), fs.readFileSync("desktop-dist/app-drive.js", "utf8"));
  assert.equal(fs.readFileSync("app-session.js", "utf8"), fs.readFileSync("desktop-dist/app-session.js", "utf8"));
});