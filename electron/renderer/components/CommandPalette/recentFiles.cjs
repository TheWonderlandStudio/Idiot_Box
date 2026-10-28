const KEY = "ibx.quickOpen.recents.v1";
const normalize = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
const pathKey = (value) => /^[a-z]:(\/|$)/i.test(normalize(value)) || normalize(value).startsWith("//") ? normalize(value).toLowerCase() : normalize(value);
const fileEntry = (root, filePath) => {
  if (!root || !filePath || !pathKey(filePath).startsWith(`${pathKey(root)}/`)) return null;
  const rel = normalize(filePath).slice(normalize(root).length + 1);
  if (!rel || rel.split("/").includes("..")) return null;
  return { path: filePath, rel, name: rel.split("/").at(-1) };
};
function projects(storage) {
  try {
    const value = JSON.parse(storage.getItem(KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item?.root === "string" && Array.isArray(item.files)).slice(0, 12) : [];
  } catch { return []; }
}
function readRecentFiles(storage, root) {
  const seen = new Set();
  return (projects(storage).find((item) => pathKey(item.root) === pathKey(root))?.files || [])
    .map((item) => fileEntry(root, item?.path)).filter((item) => {
      if (!item || seen.has(pathKey(item.path))) return false;
      seen.add(pathKey(item.path)); return true;
    }).slice(0, 20);
}
function updateRecentFiles(storage, root, filePath, remove = false) {
  const entry = fileEntry(root, filePath);
  if (!entry) return readRecentFiles(storage, root);
  const files = readRecentFiles(storage, root).filter((item) => pathKey(item.path) !== pathKey(filePath));
  if (!remove) files.unshift(entry);
  files.splice(20);
  const next = [{ root, files }, ...projects(storage).filter((item) => pathKey(item.root) !== pathKey(root))].slice(0, 12);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch {}
  return files;
}
function mergeRecentFiles(recent, files) {
  const seen = new Set();
  return [...recent.map((item) => ({ ...item, recent: true })), ...files].filter((item) => {
    if (seen.has(pathKey(item.path))) return false;
    seen.add(pathKey(item.path)); return true;
  }).slice(0, 30);
}
module.exports = { readRecentFiles, updateRecentFiles, mergeRecentFiles };
