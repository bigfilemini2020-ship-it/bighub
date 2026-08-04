const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizePrivateKey, safeFileName } = require("./api/drive/google-auth");

test("normalizes Vercel private key newlines", () => {
  const key = '"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n"';
  assert.equal(normalizePrivateKey(key), "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
});


test("normalizes private key from service account json", () => {
  const key = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n";
  const json = JSON.stringify({ private_key: key });
  assert.equal(normalizePrivateKey(json), "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
});

test("normalizes private key from base64 encoded json", () => {
  const key = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n";
  const encoded = Buffer.from(JSON.stringify({ private_key: key })).toString("base64");
  assert.equal(normalizePrivateKey(encoded), "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n");
});

test("normalizes single line PEM copied with spaces", () => {
  const key = "-----BEGIN PRIVATE KEY----- abcdefghijklmnopqrstuvwxyz0123456789 -----END PRIVATE KEY-----";
  assert.equal(normalizePrivateKey(key), "-----BEGIN PRIVATE KEY-----\nabcdefghijklmnopqrstuvwxyz0123456789\n-----END PRIVATE KEY-----\n");
});
test("sanitizes download filenames", () => {
  assert.equal(safeFileName('report:final?.pdf'), "report_final_.pdf");
  assert.equal(safeFileName(''), "download");
});