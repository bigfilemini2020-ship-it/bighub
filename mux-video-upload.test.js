const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const bundles = ["app.js", path.join("desktop-dist", "app.js")];
const composeBundles = ["app-compose.js", path.join("desktop-dist", "app-compose.js")];

test("video files use Mux direct upload while other files stay on Drive", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, "utf8");
    assert.match(source, /async function uploadMuxVideoFile\(file\)/);
    assert.match(source, /driveFunctionUrl\("mux-create-upload"\)/);
    assert.match(source, /item\?\.mimeType \|\| item\?\.type/);
  }
  for (const bundle of composeBundles) {
    const source = fs.readFileSync(bundle, "utf8");
    assert.match(source, /isVideoFile\(file\) \? await uploadMuxVideoFile\(file\) : await uploadDriveFile\(file\)/);
  }
});

test("Mux attachments preserve provider metadata and render through signed playback", () => {
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, "utf8");
    assert.match(source, /provider: "mux"/);
    assert.match(source, /uploadId: result\.uploadId/);
    assert.match(source, /data-mux-playback-id/);
    assert.match(source, /driveFunctionUrl\("mux-playback-token"\)/);
  }
});

test("Mux Edge Functions keep credentials server-side", () => {
  for (const name of ["mux-create-upload", "mux-upload-status", "mux-playback-token"]) {
    const file = path.join("supabase", "functions", name, "index.ts");
    assert.ok(fs.existsSync(file), `${name} function is missing`);
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /requireApprovedUser/);
  }
  const client = fs.readFileSync("app.js", "utf8");
  assert.doesNotMatch(client, /MUX_TOKEN_SECRET|MUX_SIGNING_PRIVATE_KEY/);
});

test("Mux HLS playback uses local hls.js fallback for Windows WebView", () => {
  for (const file of ["index.html", path.join("desktop-dist", "index.html")]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /vendor\/hls\.min\.js/);
  }
  for (const bundle of bundles) {
    const source = fs.readFileSync(bundle, "utf8");
    assert.match(source, /function attachMuxVideoSource\(video, url\)/);
    assert.match(source, /video\.canPlayType\("application\/vnd\.apple\.mpegurl"\)/);
    assert.match(source, /window\.Hls\?\.isSupported\(\)/);
    assert.match(source, /hls\.loadSource\(url\)/);
    assert.match(source, /attachMuxVideoSource\(item, await muxPlaybackUrl/);
  }
});