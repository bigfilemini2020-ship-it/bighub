(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BigHubDriveFileSelection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function fileKey(file) {
    return file ? `${file.name}:${file.size}:${file.lastModified}` : "";
  }

  function mergeFiles(existing = [], incoming = []) {
    const seen = new Set();
    return [...existing, ...incoming].filter((file) => {
      const key = fileKey(file);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return { fileKey, mergeFiles };
});
