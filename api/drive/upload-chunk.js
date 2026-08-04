const { requireApprovedUser } = require("./supabase-auth");

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function readBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST 요청만 가능합니다." });

  const auth = await requireApprovedUser(req);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.message });

  try {
    const uploadUrl = String(req.headers["x-upload-url"] || "");
    const start = Number(req.headers["x-upload-start"]);
    const end = Number(req.headers["x-upload-end"]);
    const size = Number(req.headers["x-upload-size"]);
    const mimeType = String(req.headers["content-type"] || "application/octet-stream");
    if (!uploadUrl.startsWith("https://www.googleapis.com/upload/drive/")) return sendJson(res, 400, { error: "Drive 업로드 주소가 올바르지 않습니다." });
    if (![start, end, size].every(Number.isFinite) || start < 0 || end < start || size <= end) return sendJson(res, 400, { error: "업로드 범위가 올바르지 않습니다." });

    const body = await readBuffer(req);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": mimeType,
        "content-length": String(body.length),
        "content-range": `bytes ${start}-${end}/${size}`,
      },
      body,
    });

    if (response.status === 308) return sendJson(res, 200, { done: false });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) throw new Error(data.error?.message || "Drive 업로드에 실패했습니다.");
    return sendJson(res, 200, { done: true, file: data });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Drive 업로드에 실패했습니다." });
  }
};