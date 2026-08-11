const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const bundles = ["app-drive.js", path.join("desktop-dist", "app-drive.js")];

test("Drive image previews reuse a cached object URL across feed renders", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(path.join(__dirname, bundle), "utf8");

    assert.match(source, /const driveMediaObjectUrls = new Map\(\);/);
    assert.match(source, /const driveMediaLoads = new Map\(\);/);
    assert.match(source, /async function getDriveMediaObjectUrl\(source, headers\)/);
    assert.match(source, /driveMediaObjectUrls\.get\(source\)/);
    assert.match(source, /item\.src = await getDriveMediaObjectUrl\(source, headers\);/);
    assert.match(source, /Promise\.allSettled\(media\.map/);
  }
});
