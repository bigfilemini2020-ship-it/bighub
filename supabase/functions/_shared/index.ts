export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
};

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, "\uD658\uACBD \uBCC0\uC218 " + name + "\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.");
  return value;
}

export async function requireApprovedUser(req: Request) {
  const token = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "\uB85C\uADF8\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.");

  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const anonKey = requiredEnv("SUPABASE_ANON_KEY");
  const authResponse = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: { Authorization: "Bearer " + token, apikey: anonKey },
  });
  if (!authResponse.ok) throw new HttpError(401, "\uC0AC\uC6A9\uC790 \uC815\uBCF4\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uB85C\uADF8\uC778\uD558\uC138\uC694.");

  const user = await authResponse.json();
  const profileResponse = await fetch(
    supabaseUrl + "/rest/v1/profiles?id=eq." + encodeURIComponent(user.id) + "&select=status",
    {
      headers: {
        Authorization: "Bearer " + token,
        apikey: anonKey,
      },
    },
  );
  const profiles = await profileResponse.json().catch(() => []);
  if (!profileResponse.ok) throw new HttpError(500, "\uC2B9\uC778 \uC815\uBCF4\uB97C \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.");
  if (!Array.isArray(profiles) || profiles[0]?.status !== "approved") {
    throw new HttpError(403, "\uC2B9\uC778\uB41C \uC0AC\uC6A9\uC790\uB9CC \uC0AC\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  }

  return user;
}

export async function googleAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: requiredEnv("GOOGLE_OAUTH_CLIENT_ID"), client_secret: requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"), refresh_token: requiredEnv("GOOGLE_REFRESH_TOKEN"), grant_type: "refresh_token" }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const detail = typeof payload.error_description === "string" ? payload.error_description : typeof payload.error === "string" ? payload.error : "access token was not issued.";
    throw new HttpError(502, "Google Drive \uC778\uC99D \uC815\uBCF4\uB97C \uAC00\uC838\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4: " + detail);
  }
  return payload.access_token as string;
}

export function requiredGoogleFolderId() { return requiredEnv("GOOGLE_DRIVE_FOLDER_ID"); }
export function safeFileName(value: string) { return String(value || "\uCCA8\uBD80\uD30C\uC77C").replace(/[\\/\0]/g, "_").slice(0, 180) || "\uCCA8\uBD80\uD30C\uC77C"; }
export function contentDisposition(type: string, name: string) {
  const safe = safeFileName(name);
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_");
  return type + "; filename=\"" + ascii + "\"; filename*=UTF-8''" + encodeURIComponent(safe);
}
