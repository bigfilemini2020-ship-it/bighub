const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appBundles = ["app.js", path.join("desktop-dist", "app.js")];
const composeBundles = ["app-compose.js", path.join("desktop-dist", "app-compose.js")];
const htmlFiles = ["index.html", path.join("desktop-dist", "index.html")];

test("notice option is marked admin-only in compose form", () => {
  for (const file of htmlFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /<option value="notice"[^>]*data-admin-only="true"[^>]*>공지<\/option>/, `${file} marks notice admin-only`);
  }
});

test("compose hides and blocks notice posts for non-admin users", () => {
  for (const file of composeBundles) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /function syncPostTypeAccess\(/, `${file} has type access sync`);
    assert.match(source, /option\.hidden = !canCreateNoticePost\(\)/, `${file} hides notice option for non-admin`);
    assert.match(source, /option\.disabled = !canCreateNoticePost\(\)/, `${file} disables notice option for non-admin`);
    assert.match(source, /if \(data\.type === "notice" && !canCreateNoticePost\(\)\)/, `${file} blocks forged notice submit`);
  }
});

test("notice posts can only be managed by admins", () => {
  for (const file of appBundles) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /function canCreateNoticePost\(\) \{ return currentUser\(\)\?\.role === "admin"; \}/, `${file} exposes notice author permission`);
    assert.match(source, /if \(post\.type === "notice"\) return item\.role === "admin";/, `${file} restricts notice management to admins`);
  }
});
