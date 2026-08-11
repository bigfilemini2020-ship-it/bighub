import fs from "node:fs";
import path from "node:path";

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const repo = readArg("repo") || "bigfilemini2020-ship-it/bighub";
const version = readArg("version");
const tag = readArg("tag") || (version ? `v${version.replace(/^v/, "")}` : "");
const asset = readArg("asset");
const sig = readArg("sig") || (asset ? `${asset}.sig` : "");
const out = readArg("out") || "latest.json";
const notes = readArg("notes") || "BigHub desktop update";

if (!version) fail("Missing --version, for example --version 0.1.8");
if (!asset) fail("Missing --asset, for example --asset src-tauri/target/release/bundle/nsis/BigHub_0.1.8_x64-setup.exe");
if (!tag) fail("Missing --tag, for example --tag v0.1.8");
if (!fs.existsSync(asset)) fail(`Asset not found: ${asset}`);
if (!fs.existsSync(sig)) fail(`Signature not found: ${sig}`);

const signature = fs.readFileSync(sig, "utf8").trim();
if (!signature) fail(`Signature file is empty: ${sig}`);

const fileName = path.basename(asset);
const encodedFileName = encodeURIComponent(fileName).replace(/%20/g, "+");

const manifest = {
  version: version.replace(/^v/, ""),
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${encodedFileName}`,
    },
  },
};

fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${out}`);
console.log(`Upload these files to GitHub Release ${tag}:`);
console.log(`- ${asset}`);
console.log(`- ${sig}`);
console.log(`- ${out}`);
