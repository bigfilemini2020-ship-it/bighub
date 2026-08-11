const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("keeps file picker state out of the accumulated attachment list", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.doesNotMatch(source, /input\.files\s*=/);
  assert.match(source, /input\.value\s*=\s*""/);
});

test("shows desktop version without a placeholder separator", () => {
  const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

  assert.doesNotMatch(source, /\/ \? \$\{webAppVersion\}/);
});
