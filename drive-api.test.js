const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizePrivateKey, safeFileName } = require("./api/drive/google-auth");

test("normalizes Vercel private key newlines", () => {
  const key = '"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"';
  assert.equal(normalizePrivateKey(key), "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
});

test("sanitizes download filenames", () => {
  assert.equal(safeFileName('report:final?.pdf'), "report_final_.pdf");
  assert.equal(safeFileName(''), "download");
});