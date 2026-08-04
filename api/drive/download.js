const { Readable } = require("node:stream");
const { getAccessToken, safeFileName } = require("./google-auth");
const { requireApprovedUser } = require("./supabase-auth");

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { error: "GET 요청만 가능합니다." });

  const auth = await requireApprovedUser(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.message });

  try {
    const id = String(req.query.id || "");
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return sendJson(res, 400, { error: "파일 ID가 올바르지 않습니다." });

    const token = await getAccessToken();
    const metaResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,size`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!metaResponse.ok) throw new Error("Drive 파일 정보를 확인할 수 없습니다.");
    const meta = await metaResponse.json();

    const fileResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!fileResponse.ok) throw new Error("Drive 파일 다운로드에 실패했습니다.");

    const filename = safeFileName(req.query.name || meta.name);
    res.statusCode = 200;
    res.setHeader("content-type", meta.mimeType || "application/octet-stream");
    if (meta.size) res.setHeader("content-length", meta.size);
    res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    if (fileResponse.body && Readable.fromWeb) return Readable.fromWeb(fileResponse.body).pipe(res);
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    return res.end(buffer);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Drive 파일 다운로드에 실패했습니다." });
  }
};