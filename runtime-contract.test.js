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