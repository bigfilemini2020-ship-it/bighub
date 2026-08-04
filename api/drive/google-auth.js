const crypto = require("node:crypto");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} 환경변수가 없습니다.`);
  return value;
}

function stripWrappingQuotes(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function normalizePemKey(value) {
  const begin = "-----BEGIN PRIVATE KEY-----";
  const end = "-----END PRIVATE KEY-----";
  const start = value.indexOf(begin);
  const finish = value.indexOf(end);
  if (start === -1 || finish === -1) return value;
  const body = value.slice(start + begin.length, finish).replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") || body;
  return `${begin}\n${wrapped}\n${end}\n`;
}

function normalizePrivateKey(value) {
  const raw = stripWrappingQuotes(value);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.private_key) return normalizePrivateKey(parsed.private_key);
  } catch {}
  let key = raw.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r/g, "");
  if (!key.includes("BEGIN PRIVATE KEY")) {
    try {
      const decoded = Buffer.from(key, "base64").toString("utf8").trim();
      if (decoded.includes("BEGIN PRIVATE KEY") || decoded.includes("private_key")) return normalizePrivateKey(decoded);
    } catch {}
  }
  return normalizePemKey(key);
}

function googleAuthErrorMessage(error) {
  const message = String(error?.message || "");
  if (/DECODER routines|unsupported|PEM|private key/i.test(message)) {
    return "Google Drive 인증키 형식이 맞지 않습니다. Vercel의 GOOGLE_PRIVATE_KEY에는 서비스 계정 JSON 안의 private_key 값만 넣어야 합니다.";
  }
  return message || "Google 인증에 실패했습니다.";
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
  let signature;
  try {
    signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(normalizePrivateKey(privateKey));
  } catch (error) {
    throw new Error(googleAuthErrorMessage(error));
  }
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

module.exports = { normalizePrivateKey, googleAuthErrorMessage, createJwt, getAccessToken, safeFileName };