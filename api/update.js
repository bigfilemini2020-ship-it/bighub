function requiredEnv(name) {
  return String(process.env[name] || "").trim();
}

module.exports = function handler(_req, res) {
  const version = requiredEnv("BIGHUB_UPDATE_VERSION");
  const url = requiredEnv("BIGHUB_UPDATE_URL");
  const signature = requiredEnv("BIGHUB_UPDATE_SIGNATURE");

  if (!version || !url || !signature) {
    return res.status(204).end();
  }

  const manifest = {
    version,
    url,
    signature,
    notes: requiredEnv("BIGHUB_UPDATE_NOTES") || "BigHub desktop update",
  };
  const pubDate = requiredEnv("BIGHUB_UPDATE_PUB_DATE");
  if (pubDate) manifest.pub_date = pubDate;

  return res.status(200).json(manifest);
};
