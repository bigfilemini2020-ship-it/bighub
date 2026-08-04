const { getAccessToken } = require("./google-auth");
const { requireApprovedUser } = require("./supabase-auth");

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function escapeDriveQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findExistingFile({ token, folderId, name, size }) {
  const query = [`'${escapeDriveQueryValue(folderId)}' in parents`, `name = '${escapeDriveQueryValue(name)}'`, "trashed = false"].join(" and ");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,mimeType,size,createdTime)");
  url.searchParams.set("orderBy", "createdTime desc");
  url.searchParams.set("pageSize", "10");
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  return (data.files || []).find((file) => Number(file.size || 0) === size) || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST 요청만 가능합니다." });

  const auth = await requireApprovedUser(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.message });

  try {
    const input = await readJson(req);
    const name = String(input.name || "").trim();
    const mimeType = String(input.mimeType || "application/octet-stream");
    const size = Number(input.size || 0);
    if (!name) return sendJson(res, 400, { error: "파일명이 필요합니다." });
    if (!Number.isFinite(size) || size <= 0) return sendJson(res, 400, { error: "업로드할 파일을 선택하세요." });

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID 환경변수가 없습니다.");
    const token = await getAccessToken();
    const existing = await findExistingFile({ token, folderId, name, size });
    if (existing) return sendJson(res, 200, { file: existing });

    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
        "x-upload-content-type": mimeType,
        "x-upload-content-length": String(size),
      },
      body: JSON.stringify({ name, parents: [folderId] }),
    });
    const uploadUrl = response.headers.get("location");
    if (!response.ok || !uploadUrl) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || "Google Drive 업로드 세션 생성에 실패했습니다.");
    }
    return sendJson(res, 200, { uploadUrl });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Drive 업로드 준비에 실패했습니다." });
  }
};