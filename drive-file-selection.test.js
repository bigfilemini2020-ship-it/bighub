const assert = require("node:assert/strict");
const test = require("node:test");
const { mergeFiles } = require("./drive-file-selection");

const file = (name, size, lastModified) => ({ name, size, lastModified });

test("keeps existing selections when files are added one at a time", () => {
  const first = file("one.pdf", 100, 1);
  const second = file("two.pdf", 200, 2);

  assert.deepEqual(mergeFiles([first], [second]), [first, second]);
});

test("does not duplicate a file selected again", () => {
  const first = file("one.pdf", 100, 1);

  assert.deepEqual(mergeFiles([first], [first]), [first]);
});
