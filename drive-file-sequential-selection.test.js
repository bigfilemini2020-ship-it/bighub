const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = __dirname;
const bundles = ["app.js", path.join("desktop-dist", "app.js")];
const driveBundles = ["app-drive.js", path.join("desktop-dist", "app-drive.js")];
const composeBundles = ["app-compose.js", path.join("desktop-dist", "app-compose.js")];

test("picker keeps prior selections when files are added later", () => {
  for (const bundle of driveBundles) {
    const source = fs.readFileSync(path.join(root, bundle), "utf8");
    assert.match(source, /function mergeDriveFiles\(existingFiles, incomingFiles\)/);
    assert.match(source, /const next = mergeDriveFiles\(selectedDriveFiles\(\), incoming\);/);
    assert.match(source, /selectedDriveFileList = next;/);
    assert.match(source, /if \(resetInput && input\) input\.value = "";/);
  }
  for (const bundle of composeBundles) {
    const source = fs.readFileSync(path.join(root, bundle), "utf8");
    assert.match(source, /const incoming = Array\.from\(input\.files \|\| \[\]\);/);
    assert.match(source, /input\.value = "";\s*\r?\n\s*addDriveFiles\(incoming, \{ resetInput: false \}\);/);
    assert.doesNotMatch(source, /input\.files\s*=/);
  }
});

test("desktop bundle includes the selection helper asset", () => {
  const source = fs.readFileSync(path.join(root, "drive-file-selection.js"), "utf8");
  const desktop = fs.readFileSync(path.join(root, "desktop-dist", "drive-file-selection.js"), "utf8");
  assert.equal(desktop, source);
});