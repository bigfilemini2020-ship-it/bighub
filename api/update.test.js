const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("./update");

function call(env = {}) {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  for (const key of ["BIGHUB_UPDATE_VERSION", "BIGHUB_UPDATE_URL", "BIGHUB_UPDATE_SIGNATURE", "BIGHUB_UPDATE_NOTES", "BIGHUB_UPDATE_PUB_DATE"]) {
    if (!(key in env)) delete process.env[key];
  }
  const result = { statusCode: null, body: null, ended: false };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
    end() { result.ended = true; return this; },
  };
  try {
    handler({}, res);
    return result;
  } finally {
    process.env = previous;
  }
}

test("returns 204 when no desktop update is configured", () => {
  const result = call();
  assert.equal(result.statusCode, 204);
  assert.equal(result.ended, true);
});

test("returns Tauri update manifest from environment", () => {
  const result = call({
    BIGHUB_UPDATE_VERSION: "0.1.2",
    BIGHUB_UPDATE_URL: "https://example.com/BigHub_0.1.2_x64-setup.exe",
    BIGHUB_UPDATE_SIGNATURE: "sig-value",
    BIGHUB_UPDATE_NOTES: "icon update",
    BIGHUB_UPDATE_PUB_DATE: "2026-08-05T00:00:00Z",
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, {
    version: "0.1.2",
    url: "https://example.com/BigHub_0.1.2_x64-setup.exe",
    signature: "sig-value",
    notes: "icon update",
    pub_date: "2026-08-05T00:00:00Z",
  });
});
