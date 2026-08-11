import { HttpError } from "./index.ts";

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new HttpError(500, `Missing ${name}.`);
  return value;
}

function muxAuthorization() {
  const tokenId = requiredEnv("MUX_TOKEN_ID");
  const tokenSecret = requiredEnv("MUX_TOKEN_SECRET");
  return `Basic ${btoa(`${tokenId}:${tokenSecret}`)}`;
}

export async function muxRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.mux.com/video/v1${path}`, {
    ...init,
    headers: {
      Authorization: muxAuthorization(),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error?.messages?.[0] || "Mux request failed.";
    throw new HttpError(response.status, message);
  }
  return payload?.data ?? payload;
}

function base64Url(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function privateKeyBytes(value: string) {
  const normalized = value.replaceAll("\\n", "\n").trim();
  const pem = normalized.includes("BEGIN PRIVATE KEY") ? normalized : atob(normalized);
  const raw = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(raw);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function muxPlaybackToken(playbackId: string) {
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: requiredEnv("MUX_SIGNING_KEY_ID"), typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ aud: "v", exp: now + 3600, sub: playbackId })));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(requiredEnv("MUX_SIGNING_PRIVATE_KEY")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}
