const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

test("Drive functions check approval from profile status with the user token", () => {
  const source = fs.readFileSync("supabase/functions/_shared/index.ts", "utf8");
  assert.match(source, /rest\/v1\/profiles/);
  assert.match(source, /Authorization: "Bearer " \+ token/);
  assert.match(source, /apikey: anonKey/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /profiles\[0\]\?\.status !== "approved"/);
  assert.doesNotMatch(source, /rest\/v1\/rpc\/is_approved/);
});

for (const file of ["app-drive.js", "desktop-dist/app-drive.js"]) {
  test(`${file} uses Supabase Edge Functions for Drive`, () => {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /functions\/v1/);
    assert.match(source, /driveFunctionUrl\("drive-upload"\)/);
    assert.match(source, /formData\.append\("file", file, file\.name\)/);
    assert.match(source, /driveFunctionUrl\("drive-download"/);
    assert.doesNotMatch(source, /remoteApiOrigin|\/api\/create-upload|upload-chunk/);
  });

  test(`${file} loads protected Drive images with authenticated Blob URLs`, () => {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /const source = normalizeDriveDownloadUrl\(item\.dataset\.driveSrc\)/);
    assert.match(source, /fetch\(source, \{ headers \}\)/);
    assert.match(source, /URL\.createObjectURL\(await response\.blob\(\)\)/);
  });
}