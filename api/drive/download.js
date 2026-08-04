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

    const range = req.headers.range || req.headers.Range || "";
    const fileHeaders = { authorization: `Bearer ${token}` };
    if (range) fileHeaders.range = range;
    const fileResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
      headers: fileHeaders,
    });
    if (!fileResponse.ok && fileResponse.status !== 206) throw new Error("Drive 파일 다운로드에 실패했습니다.");

    const filename = safeFileName(req.query.name || meta.name);
    const inline = req.query.inline === "1";
    res.statusCode = fileResponse.status === 206 ? 206 : 200;
    res.setHeader("accept-ranges", "bytes");
    res.setHeader("content-type", meta.mimeType || "application/octet-stream");
    const contentLength = fileResponse.headers.get("content-length") || meta.size;
    const contentRange = fileResponse.headers.get("content-range");
    if (contentLength) res.setHeader("content-length", contentLength);
    if (contentRange) res.setHeader("content-range", contentRange);
    res.setHeader("content-disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`);
    if (fileResponse.body && Readable.fromWeb) return Readable.fromWeb(fileResponse.body).pipe(res);
    const buffer = Buffer.from(await fileResponse.arrayBuffer());
    return res.end(buffer);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Drive 파일 다운로드에 실패했습니다." });
  }
};