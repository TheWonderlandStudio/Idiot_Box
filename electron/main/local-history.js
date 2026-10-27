// Local file history — per-file snapshots stored outside the project.
//
// Layout (under userData/local-history):
//   index.json                       { version, files: { <pathHash>: { path, entries } } }
//   <pathHash>/<id>.txt              snapshot contents
//
// Entries are deduplicated by content hash and capped per file, so repeated
// saves of unchanged content do not grow the history.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, BrowserWindow } = require("electron");

const MAX_ENTRIES_PER_FILE = 40;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_ENTRIES = 3000;

let cache = null;

const historyRoot = () => path.join(app.getPath("userData"), "local-history");
const indexPath = () => path.join(historyRoot(), "index.json");
const normalizePath = (p) => {
  const abs = path.resolve(String(p));
  return process.platform === "win32" ? abs.toLowerCase() : abs;
};
const keyFor = (p) => crypto.createHash("sha1").update(normalizePath(p)).digest("hex");
const hashText = (text) => crypto.createHash("sha1").update(text, "utf8").digest("hex");
const byteLength = (text) => Buffer.byteLength(String(text), "utf8");

function loadIndex() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(), "utf8"));
    cache = raw && typeof raw === "object" && raw.files && typeof raw.files === "object"
      ? raw
      : { version: 1, files: {} };
  } catch {
    cache = { version: 1, files: {} };
  }
  return cache;
}

function saveIndex() {
  try {
    fs.mkdirSync(historyRoot(), { recursive: true });
    const tmp = `${indexPath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), "utf8");
    fs.renameSync(tmp, indexPath());
  } catch {}
}

function removeBlob(key, entry) {
  if (!entry || !entry.blob) return;
  try { fs.unlinkSync(path.join(historyRoot(), key, entry.blob)); } catch {}
}

function publicEntry(entry) {
  return { id: entry.id, at: entry.at, reason: entry.reason, size: entry.size };
}

function pruneTotal() {
  let total = 0;
  for (const entry of Object.values(cache.files)) total += entry.entries.length;
  if (total <= MAX_TOTAL_ENTRIES) return;
  // Collect the oldest entries across every file and drop until under the cap.
  const all = [];
  for (const [key, file] of Object.entries(cache.files)) {
    for (const entry of file.entries) all.push({ key, entry });
  }
  all.sort((a, b) => a.entry.at - b.entry.at);
  for (const { key, entry } of all) {
    if (total <= MAX_TOTAL_ENTRIES) break;
    const file = cache.files[key];
    if (!file) continue;
    file.entries = file.entries.filter((e) => e.id !== entry.id);
    removeBlob(key, entry);
    total--;
    if (!file.entries.length) delete cache.files[key];
  }
}

/**
 * Store a snapshot of `content` for `filePath`. Returns the new entry, or null
 * when the snapshot was skipped (binary/oversized/duplicate).
 */
function recordSnapshotSync(filePath, content, reason = "Saved") {
  try {
    if (!filePath || typeof content !== "string") return null;
    if (byteLength(content) > MAX_SNAPSHOT_BYTES) return null;
    const abs = path.resolve(String(filePath));
    let st;
    try { st = fs.statSync(abs); } catch { return null; }
    if (!st.isFile()) return null;

    const key = keyFor(abs);
    const idx = loadIndex();
    const file = idx.files[key] || (idx.files[key] = { path: abs, entries: [] });
    const hash = hashText(content);
    if (file.entries.some((e) => e.hash === hash)) return null; // nothing changed

    const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const blob = `${id}.txt`;
    const dir = path.join(historyRoot(), key);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, blob), content, "utf8");

    const entry = {
      id, blob, at: Date.now(), reason: String(reason || "Saved"),
      size: byteLength(content), hash,
    };
    file.path = abs;
    file.entries.unshift(entry);
    while (file.entries.length > MAX_ENTRIES_PER_FILE) {
      removeBlob(key, file.entries.pop());
    }
    pruneTotal();
    saveIndex();
    return publicEntry(entry);
  } catch {
    return null;
  }
}

/** Snapshot the on-disk file before it is overwritten. */
function recordDiskSnapshotSync(filePath, reason = "Saved") {
  try {
    const text = fs.readFileSync(path.resolve(String(filePath)), "utf8");
    return recordSnapshotSync(filePath, text, reason);
  } catch {
    return null;
  }
}

function listHistory(filePath) {
  if (!filePath) return [];
  const key = keyFor(filePath);
  loadIndex();
  const file = cache.files[key];
  if (!file) return [];
  // Drop entries whose blobs disappeared (manual cleanup, disk errors).
  const alive = [];
  for (const entry of file.entries) {
    try {
      if (fs.existsSync(path.join(historyRoot(), key, entry.blob))) alive.push(entry);
    } catch {}
  }
  if (alive.length !== file.entries.length) {
    file.entries = alive;
    if (!alive.length) delete cache.files[key];
    saveIndex();
  }
  return alive.map(publicEntry);
}

function readHistory(filePath, id) {
  if (!filePath || !id) return { ok: false, error: "Missing snapshot" };
  const key = keyFor(filePath);
  loadIndex();
  const file = cache.files[key];
  const entry = file?.entries.find((e) => e.id === id);
  if (!entry) return { ok: false, error: "Snapshot not found" };
  try {
    const text = fs.readFileSync(path.join(historyRoot(), key, entry.blob), "utf8");
    return { ok: true, text, meta: publicEntry(entry), path: file.path };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function broadcastChanged(filePath) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send("liveEdit:fileChanged", { filePath, rel: path.basename(filePath) });
    } catch {}
  }
}

function restoreHistory(filePath, id) {
  const abs = path.resolve(String(filePath || ""));
  const snap = readHistory(abs, id);
  if (!snap.ok) return snap;
  try {
    // Keep the current content so the restore itself can be undone.
    try { recordDiskSnapshotSync(abs, "Before restore"); } catch {}
    fs.writeFileSync(abs, snap.text, "utf8");
    broadcastChanged(abs);
    return { ok: true, restored: snap.meta };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function deleteHistory(filePath, id) {
  const key = keyFor(filePath);
  loadIndex();
  const file = cache.files[key];
  if (!file) return { ok: true, removed: 0 };
  const entry = file.entries.find((e) => e.id === id);
  if (!entry) return { ok: true, removed: 0 };
  file.entries = file.entries.filter((e) => e.id !== id);
  removeBlob(key, entry);
  if (!file.entries.length) delete cache.files[key];
  saveIndex();
  return { ok: true, removed: 1 };
}

function clearHistory(filePath) {
  const key = keyFor(filePath);
  loadIndex();
  const file = cache.files[key];
  if (!file) return { ok: true, removed: 0 };
  const removed = file.entries.length;
  for (const entry of file.entries) removeBlob(key, entry);
  delete cache.files[key];
  saveIndex();
  return { ok: true, removed };
}

function stats() {
  loadIndex();
  let files = 0, entries = 0, bytes = 0;
  for (const file of Object.values(cache.files)) {
    files++;
    entries += file.entries.length;
    for (const entry of file.entries) bytes += entry.size || 0;
  }
  return { files, entries, bytes };
}

module.exports = {
  recordSnapshotSync,
  recordDiskSnapshotSync,
  listHistory,
  readHistory,
  restoreHistory,
  deleteHistory,
  clearHistory,
  stats,
  historyRoot,
  _resetCacheForTests() { cache = null; },
};
