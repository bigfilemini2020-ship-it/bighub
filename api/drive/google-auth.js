const crypto = require("node:crypto");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경변수가 없습니다.`);
  return value;
}

function normalizePrivateKey(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\n/g, "\n");
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createJwt({ clientEmail, privateKey, now = Math.floor(Date.now() / 1000) }) {
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(normalizePrivateKey(privateKey));
  return `${unsigned}.${base64url(signature)}`;
}

async function getAccessToken(fetchImpl = fetch) {
  const assertion = createJwt({
    clientEmail: env("GOOGLE_CLIENT_EMAIL"),
    privateKey: env("GOOGLE_PRIVATE_KEY"),
  });
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || "Google 인증에 실패했습니다.");
  return data.access_token;
}

function safeFileName(value) {
  const name = String(value || "download").replace(/[\\/:*?"<>|\r\n]/g, "_").slice(0, 160);
  return name || "download";
}

module.exports = { normalizePrivateKey, createJwt, getAccessToken, safeFileName };