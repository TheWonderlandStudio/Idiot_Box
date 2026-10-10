// ─── Community extensions — GitHub repo se list + install ───────────────────
// Repo me `extensions/<publisher>.<name>/` structure hota hai. List ke liye
// GitHub contents API + raw package.json; install ke liye repo zipball
// download karke sirf wo extension folder extract/copy karte hain.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { summarizeContributions } = require("./contrib");

const UA = "IdiotBox-Community-Extensions/1.0";
const DEFAULT_SUBFOLDER = "extensions";

async function gh(url, timeoutMs = 30000) {
  const res = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": UA },
    signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (res.status === 403 || res.status === 429) throw new Error("GitHub rate limit exceeded — ek minute baad try karo");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status} ${res.statusText}${body ? ` — ${String(body).slice(0, 200)}` : ""}`);
  }
  return res;
}
const ghJson = async (url) => (await gh(url)).json();

// "owner/repo", "https://github.com/owner/repo", ".../tree/branch/sub/folder"
function parseRepo(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  s = s
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1];
  let branch = "";
  let subfolder = DEFAULT_SUBFOLDER;
  const ti = parts.findIndex((p) => p === "tree");
  if (ti >= 0 && parts[ti + 1]) {
    branch = parts[ti + 1];
    if (parts.length > ti + 2) subfolder = parts.slice(ti + 2).join("/");
  }
  return { owner, repo, branch, subfolder };
}

async function resolveRepo(input) {
  const parsed = parseRepo(input);
  if (!parsed) throw new Error("Invalid repo — expected `owner/repo` ya GitHub URL");
  let branch = parsed.branch;
  if (!branch) {
    const info = await ghJson(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`);
    branch = info && info.default_branch ? info.default_branch : "main";
  }
  return { owner: parsed.owner, repo: parsed.repo, branch, subfolder: parsed.subfolder || DEFAULT_SUBFOLDER };
}

const rawUrl = (r, relPath) =>
  `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.branch}/${relPath.split("/").map(encodeURIComponent).join("/")}`;

// ── List: repo ke subfolder ke har extension ki basic info ──────────────────
async function listExtensions(input) {
  const r = await resolveRepo(input);
  const url = `https://api.github.com/repos/${r.owner}/${r.repo}/contents/${r.subfolder}?ref=${encodeURIComponent(r.branch)}`;
  let contents;
  try { contents = await ghJson(url); }
  catch (e) {
    throw new Error(`Repo folder not found: ${r.subfolder}/ — (${String((e && e.message) || e)})`);
  }
  const dirs = (Array.isArray(contents) ? contents : []).filter((e) => e && e.type === "dir");
  const items = await Promise.all(dirs.map(async (d) => {
    try {
      const mf = await ghJson(rawUrl(r, `${r.subfolder}/${d.name}/package.json`));
      if (!mf || !mf.name) return null;
      const native = mf.idiotbox || mf.ibox || {};
      return {
        id: `${(native.id || mf.publisher || "local")}.${native.name || mf.name}`,
        name: native.name || mf.displayName || mf.name,
        rawName: d.name,
        publisher: native.publisher || mf.publisher || "",
        version: native.version || mf.version || "0.0.0",
        description: String(native.description || mf.description || "").slice(0, 300),
        engines: native.engines || "",
        main: native.main || mf.main || mf.browser || "extension.js",
        path: `${r.subfolder}/${d.name}`,
        features: summarizeContributions(mf),
      };
    } catch { return null; }
  }));
  return { repo: `${r.owner}/${r.repo}`, branch: r.branch, subfolder: r.subfolder, items: items.filter(Boolean) };
}

// ── README: extension folder ka README.md (details panel ke liye) ───────────
async function readme(input, folderName) {
  const r = await resolveRepo(input);
  const name = String(folderName || "").trim();
  if (!name || /[^a-z0-9._-]/i.test(name)) throw new Error("Bad extension folder name");
  for (const f of ["README.md", "readme.md", "README.markdown", "Readme.md"]) {
    try {
      const res = await gh(rawUrl(r, `${r.subfolder}/${name}/${f}`));
      return { file: f, text: await res.text() };
    } catch {}
  }
  return null;
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

// Zipball ke andar repo-root ka naam alag hota hai (repo-branch) — suffix se dhoond.
function findDirBySuffix(root, relSuffix) {
  const want = (process.platform === "win32" ? relSuffix.toLowerCase() : relSuffix);
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (process.platform === "win32" ? rel.toLowerCase() === want : rel === want) return full;
      stack.push(full);
    }
  }
  return null;
}

// ── Download: repo zipball → sirf `<subfolder>/<folderName>` ka source dir ──
// Caller `src` ko install karke `tmp` cleanup kare.
async function downloadExtension(input, folderName) {
  const r = await resolveRepo(input);
  const name = String(folderName || "").trim();
  if (!name || /[^a-z0-9._-]/i.test(name)) throw new Error("Bad extension folder name");
  const res = await gh(`https://codeload.github.com/${r.owner}/${r.repo}/zip/refs/heads/${r.branch}`, 180000);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64) throw new Error("Repo download too small — bad response");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ibx-repo-"));
  const zip = path.join(tmp, "repo.zip");
  const out = path.join(tmp, "out");
  try {
    fs.writeFileSync(zip, buf);
    fs.mkdirSync(out, { recursive: true });
    const ex = await extractZip(zip, out);
    if (!ex.ok) throw new Error(`Repo extract failed: ${ex.error}`);
    const src = findDirBySuffix(out, `${r.subfolder}/${name}`.split("/").join(path.sep));
    if (!src) throw new Error(`Folder not found in repo zip: ${r.subfolder}/${name}`);
    return { tmp, src, branch: r.branch };
  } catch (e) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    throw e;
  }
}

module.exports = { parseRepo, listExtensions, readme, downloadExtension, extractZip };
