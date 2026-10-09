// ─── OpenVSX registry client + VSIX installer (pure Node, no electron) ──────
// open-vsx.org API: search → extension info → version files → .vsix download.
// VSIX ek zip hai (extension/ prefix + package.json) — tar/PowerShell se extract.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const API = "https://open-vsx.org/api";
const USER_AGENT = "IdiotBox-Extension-Client/1.0";

async function httpGet(url, timeoutMs = 30000) {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenVSX ${res.status} ${res.statusText}${body ? ` — ${String(body).slice(0, 200)}` : ""} (${url})`);
  }
  return res;
}

async function getJson(url, timeoutMs = 30000) {
  const res = await httpGet(url, timeoutMs);
  return res.json();
}

function normalize(e) {
  if (!e || typeof e !== "object") return null;
  const ns = e.namespace || "";
  const name = e.name || "";
  return {
    id: e.id || `${ns}.${name}`,
    namespace: ns,
    name,
    displayName: e.displayName || e.name || "",
    version: e.version || "",
    description: String(e.description || "").slice(0, 400),
    publisher: (e.publishedBy && (e.publishedBy.loginName || e.publishedBy.fullName)) || ns,
    downloads: Number(e.downloadCount) || 0,
    rating: Number(e.averageRating) || 0,
    reviews: Number(e.reviewCount) || 0,
    icon: (e.files && (e.files.icon || e.files.iconSvg)) || null,
    date: e.date || e.timestamp || null,
    vsix: (e.files && (e.files.vsix || e.files.download)) || null,
  };
}

// ── Search: GET /api/-/search?query=&size=&offset= ─────────────────────────
async function search(query, { size = 25, offset = 0 } = {}) {
  const q = String(query || "").trim();
  if (!q) return { total: 0, items: [] };
  const url = `${API}/-/search?query=${encodeURIComponent(q)}&size=${Math.min(100, size)}&offset=${Math.max(0, offset)}`;
  const j = await getJson(url);
  const items = (Array.isArray(j.extensions) ? j.extensions : []).map(normalize).filter(Boolean);
  return { total: Number(j.totalSize) || items.length, items };
}

// ── Resolve a .vsix download URL for ns.name@version ────────────────────────
async function resolveVsixUrl(namespace, name, version) {
  const base = `${API}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
  if (version) {
    const j = await getJson(`${base}/${encodeURIComponent(version)}`);
    const url = j && j.files && (j.files.vsix || j.files.download);
    if (url) return url;
  }
  const latest = await getJson(base);           // no version → latest version JSON
  const url = latest && latest.files && (latest.files.vsix || latest.files.download);
  if (url) return url;
  if (latest && latest.version) {               // fallback: walk latest.version
    const v = await getJson(`${base}/${encodeURIComponent(latest.version)}`);
    return (v && v.files && (v.files.vsix || v.files.download)) || null;
  }
  return null;
}

async function downloadVsix(url, timeoutMs = 120000) {
  const res = await httpGet(url, timeoutMs);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64) throw new Error("VSIX download too small — bad response");
  return buf;
}

// ── zip extract — bsdtar (Win10+/macOS/Linux) first, PowerShell fallback ────
function extractZip(zipPath, destDir) {
  const run = (bin, args) => new Promise((resolve) => {
    try {
      execFile(bin, args, { timeout: 120000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) resolve({ ok: false, error: String(stderr || err.message || err).slice(0, 300) });
        else resolve({ ok: true });
      });
    } catch (e) { resolve({ ok: false, error: String(e) }); }
  });
  return run("tar", ["-xf", zipPath, "-C", destDir]).then((r) => {
    if (r.ok || process.platform !== "win32") return r;
    return run("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ]);
  });
}

function readManifest(dir) {
  const mf = path.join(dir, "package.json");
  if (!fs.existsSync(mf)) return null;
  try { return JSON.parse(fs.readFileSync(mf, "utf8")); } catch { return null; }
}

function safeId(v) {
  return String(v || "").replace(/[^a-z0-9._-]/gi, "-").replace(/^[-.]+|[-.]+$/g, "") || "";
}

// ── Install from a VSIX buffer → rootDir/<publisher.name>/ ─────────────────
async function installFromBuffer(buf, rootDir, { namespace, name } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ibx-vsix-"));
  const zip = path.join(tmp, "pkg.zip");
  const out = path.join(tmp, "out");
  try {
    fs.writeFileSync(zip, buf);
    fs.mkdirSync(out, { recursive: true });
    const ex = await extractZip(zip, out);
    if (!ex.ok) throw new Error(`VSIX extract failed: ${ex.error}`);
    // VSIX me payload `extension/` ke neeche hota hai; folder install me seedha root.
    let src = path.join(out, "extension");
    if (!fs.existsSync(path.join(src, "package.json"))) src = out;
    const manifest = readManifest(src);
    if (!manifest || !manifest.name) throw new Error("No package.json with a name inside VSIX");
    const id = safeId(`${manifest.publisher || namespace || "local"}.${manifest.name}`);
    if (!id) throw new Error("Could not derive an extension id");
    const dest = path.join(rootDir, id);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    return { id, dir: dest, manifest };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ── Install from an unpacked folder (copy into rootDir so state is uniform) ─
function installFromFolder(folder, rootDir) {
  const src = path.resolve(folder);
  const manifest = readManifest(src);
  if (!manifest || !manifest.name) throw new Error("No package.json with a name in that folder");
  const id = safeId(`${manifest.publisher || "local"}.${manifest.name}`);
  const dest = path.join(rootDir, id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s) });
  return { id, dir: dest, manifest };
}

// ── Full install: resolve URL → download → extract ─────────────────────────
async function installFromRegistry(rootDir, { namespace, name, version, vsix }) {
  const url = vsix || (await resolveVsixUrl(namespace, name, version));
  if (!url) throw new Error(`No VSIX found for ${namespace}.${name}${version ? "@" + version : ""}`);
  const buf = await downloadVsix(url);
  return installFromBuffer(buf, rootDir, { namespace, name });
}

module.exports = {
  API,
  search,
  resolveVsixUrl,
  downloadVsix,
  installFromBuffer,
  installFromFolder,
  installFromRegistry,
  readManifest,
  extractZip,
};
