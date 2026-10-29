// Project-wide search and replace.
//
// The main process owns the heavy file walking so the renderer stays
// responsive. Ripgrep is used when it is on PATH; otherwise this module
// falls back to a streaming Node walker with the same result shape.
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { createHash } = require("crypto");
const { spawn, execFile } = require("child_process");
const { BrowserWindow } = require("electron");

const MAX_FILE_BYTES = 1_500_000;
const MAX_LINE_PREVIEW = 400;
const MAX_UNDO_RECORDS = 25;

const IGNORED_DIRS = new Set([
  ".git", ".hg", ".svn", ".bin", ".trash", ".cache",
  "node_modules", "__pycache__", ".venv", "venv", "env",
  ".next", ".nuxt", ".turbo", ".parcel-cache", ".pytest_cache",
  ".mypy_cache", ".ruff_cache", ".idea", ".vscode-test",
  "coverage", "target", "vendor",
]);

// ── Matcher construction ───────────────────────────────────────────────────

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function makeRegex(query, options = {}) {
  const q = String(query ?? "");
  if (!q) return null;
  let src = options.regex ? q : escapeRegExp(q);
  if (options.wholeWord) src = `(?<![\\w$])(?:${src})(?![\\w$])`;
  const flags = "gm" + (options.caseSensitive ? "" : "i");
  try {
    return new RegExp(src, flags);
  } catch (err) {
    const e = new Error(`Invalid regular expression: ${err.message}`);
    e.code = "BAD_REGEX";
    throw e;
  }
}

function globToRegExp(glob) {
  const raw = String(glob || "").trim().replace(/\\/g, "/");
  if (!raw) return null;
  const pathOnly = raw.replace(/^\.\//, "").replace(/\/+$/, "");
  if (!pathOnly) return null;
  let out = "^";
  for (let i = 0; i < pathOnly.length; i++) {
    const ch = pathOnly[i];
    if (ch === "*") {
      if (pathOnly[i + 1] === "*") {
        i++;
        if (pathOnly[i + 1] === "/") { i++; out += "(?:.*/)?"; }
        else out += ".*";
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  out += "$";
  return new RegExp(out, process.platform === "win32" ? "i" : "");
}

function splitPatterns(spec) {
  if (!spec) return [];
  if (Array.isArray(spec)) return spec.map((s) => String(s).trim()).filter(Boolean);
  return String(spec).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

function compileFilter(spec, fallback) {
  const pats = splitPatterns(spec);
  if (!pats.length) return fallback;
  const matchers = pats.map((p) => {
    const negated = p.startsWith("!");
    const raw = (negated ? p.slice(1) : p).replace(/\\/g, "/");
    const re = globToRegExp(raw);
    if (!re) return null;
    return { re, negated, basenameOnly: !raw.replace(/^\.\//, "").includes("/") };
  }).filter(Boolean);
  if (!matchers.length) return fallback;
  return (rel) => {
    const base = rel.split("/").pop();
    let hit = false;
    for (const { re, negated, basenameOnly } of matchers) {
      if (re.test(rel) || (basenameOnly && re.test(base))) {
        if (!negated) hit = true;
        else return false;
      }
    }
    return hit;
  };
}

// ── Project walking ────────────────────────────────────────────────────────

function safeRoot(rootPath) {
  if (typeof rootPath !== "string" || !rootPath.trim() || rootPath.includes("\0")) return null;
  try {
    const resolved = path.resolve(rootPath);
    if (!fs.statSync(resolved).isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
}

const isInside = (root, candidate) => {
  const rel = path.relative(root, candidate);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

async function* walkFiles(root, excludes) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) continue;
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (excludes(rel)) continue;
      yield { full, rel };
    }
  }
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function locate(starts, index) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: index - starts[lo], lineStart: starts[lo] };
}

function linePreview(text, start) {
  let end = text.indexOf("\n", start);
  if (end === -1) end = text.length;
  let line = text.slice(start, end);
  if (line.endsWith("\r")) line = line.slice(0, -1);
  if (line.length > MAX_LINE_PREVIEW) line = line.slice(0, MAX_LINE_PREVIEW) + "…";
  return line;
}

const readText = async (file) => {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const buf = await fsp.readFile(file);
    if (buf.includes(0)) return null; // binary
    return buf.toString("utf8");
  } catch {
    return null;
  }
};

// ── Ripgrep fast path ──────────────────────────────────────────────────────

let rgPath = undefined;
function findRipgrep() {
  if (rgPath !== undefined) return Promise.resolve(rgPath);
  return new Promise((resolve) => {
    try {
      execFile("rg", ["--version"], { timeout: 2000, windowsHide: true }, (err) => {
        rgPath = err ? null : "rg";
        resolve(rgPath);
      });
    } catch {
      rgPath = null;
      resolve(null);
    }
  });
}

function rgArgs(query, options) {
  const args = ["--json", "--line-number", "--no-heading", "--color", "never"];
  if (!options.caseSensitive) args.push("--ignore-case");
  if (options.wholeWord) args.push("--word-regexp");
  if (!options.regex) args.push("--fixed-strings");
  args.push("--max-filesize", String(MAX_FILE_BYTES));
  for (const dir of IGNORED_DIRS) args.push("--glob", `!${dir}/**`);
  for (const p of splitPatterns(options.include)) args.push("--glob", p);
  for (const p of splitPatterns(options.exclude)) {
    args.push("--glob", p.startsWith("!") ? p : `!${p}`);
  }
  args.push("--", String(query), ".");
  return args;
}

async function ripgrepSearch(root, query, options, maxResults) {
  const bin = await findRipgrep();
  if (!bin) return null;
  const byFile = new Map();
  let count = 0;
  let truncated = false;

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, rgArgs(query, options), { cwd: root, windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let buf = "";
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill(); } catch {}
      resolve(value);
    };
    timer = setTimeout(() => finish(null), 15000);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      if (settled) return;
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type !== "match") continue;
        const data = evt.data || {};
        const full = path.resolve(root, data.path?.text || "");
        if (!isInside(root, full)) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        const lineNo = Number(data.line_number) || 1;
        const text = (data.lines?.text || "").replace(/\r?\n$/, "");
        const bytes = Buffer.from(data.lines?.text || "", "utf8");
        for (const match of data.submatches || []) {
          // Ripgrep uses UTF-8 byte offsets; the editor uses UTF-16 columns.
          const column = bytes.subarray(0, match.start).toString("utf8").length;
          const end = bytes.subarray(0, match.end).toString("utf8").length;
          if (!byFile.has(full)) byFile.set(full, { path: full, rel, matches: [] });
          byFile.get(full).matches.push({
            line: lineNo,
            column,
            length: Math.max(1, end - column),
            lineText: text.length > MAX_LINE_PREVIEW ? text.slice(0, MAX_LINE_PREVIEW) + "…" : text,
          });
          count++;
          if (count >= maxResults) { truncated = true; finish([...byFile.values()]); return; }
        }
      }
    });
    proc.on("error", () => { clearTimeout(timer); finish(null); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 2) finish(null);
      else finish([...byFile.values()]);
    });
  });
}

// ── Search ─────────────────────────────────────────────────────────────────

const clampInt = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

async function searchProject(payload = {}) {
  const root = safeRoot(payload.rootPath);
  if (!root) return { ok: false, error: "Open a project folder first." };
  const query = String(payload.query ?? "");
  if (!query) return { ok: true, results: [], count: 0, files: 0, truncated: false };
  const options = payload.options && typeof payload.options === "object" ? payload.options : {};
  const maxResults = clampInt(options.maxResults, 1, 5000, 2000);

  let re;
  try { re = makeRegex(query, options); } catch (err) { return { ok: false, error: err.message }; }

  const include = compileFilter(options.include, () => true);
  const exclude = compileFilter(options.exclude, () => false);

  // Ripgrep fast path (falls back silently when unavailable).
  try {
    const rgResults = await ripgrepSearch(root, query, options, maxResults);
    if (rgResults) {
      const results = rgResults.filter((f) => include(f.rel));
      return {
        ok: true,
        results,
        count: results.reduce((n, f) => n + f.matches.length, 0),
        files: results.length,
        truncated: rgResults.length > 0 && results.reduce((n, f) => n + f.matches.length, 0) >= maxResults,
        engine: "rg",
      };
    }
  } catch {}

  // Node fallback.
  const results = [];
  let count = 0;
  let truncated = false;
  for await (const file of walkFiles(root, exclude)) {
    if (!include(file.rel)) continue;
    const text = await readText(file.full);
    if (text == null) continue;
    let startsCache = null;
    const matches = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!startsCache) startsCache = lineStarts(text);
      const idx = m.index;
      const loc = locate(startsCache, idx);
      const endOfLine = text.indexOf("\n", loc.lineStart);
      const lineEnd = endOfLine === -1 ? text.length : endOfLine;
      matches.push({
        line: loc.line,
        column: loc.column,
        length: Math.max(1, Math.min(m[0].length, lineEnd - idx)),
        lineText: linePreview(text, loc.lineStart),
      });
      count++;
      if (count >= maxResults) { truncated = true; break; }
      if (m[0].length === 0) re.lastIndex++;
    }
    if (matches.length) results.push({ path: file.full, rel: file.rel, matches });
    if (truncated) break;
  }
  return { ok: true, results, count, files: results.length, truncated, engine: "node" };
}

// ── Replace / undo ─────────────────────────────────────────────────────────

const undoStore = new Map();
const contentHash = (content) => createHash("sha256").update(content).digest("hex");

function rememberUndo(root, entries) {
  const token = `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  undoStore.set(token, { root, entries, at: Date.now() });
  while (undoStore.size > MAX_UNDO_RECORDS) undoStore.delete(undoStore.keys().next().value);
  return token;
}

function broadcastChanged(root, file) {
  let rel = path.basename(file);
  try { rel = path.relative(root, file).split(path.sep).join("/"); } catch {}
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send("liveEdit:fileChanged", { filePath: file, rel });
    } catch {}
  }
}

function buildReplacementText(text, re, replacement, isRegex) {
  let hits = 0;
  const rep = replacement == null ? "" : String(replacement);
  let next;
  if (isRegex) {
    const all = text.match(re);
    hits = all ? all.length : 0;
    if (!hits) return { next: text, hits: 0 };
    re.lastIndex = 0;
    next = text.replace(re, rep);
  } else {
    next = text.replace(re, () => { hits++; return rep; });
  }
  return { next, hits };
}

function undoReplace(payload = {}) {
  const token = String(payload.token || "");
  const record = undoStore.get(token);
  if (!record) return { ok: false, error: "This replace can no longer be undone." };
  let restored = 0;
  const failures = [];
  const pending = [];
  for (const entry of record.entries) {
    try {
      // Only undo our own write. A later save belongs to the user.
      if (contentHash(fs.readFileSync(entry.path)) !== entry.afterHash) {
        failures.push(`${path.basename(entry.path)} changed since Replace All; left untouched`);
        pending.push(entry);
        continue;
      }
      fs.writeFileSync(entry.path, entry.before, "utf8");
      broadcastChanged(record.root, entry.path);
      restored++;
    } catch (err) {
      failures.push(`${path.basename(entry.path)}: ${err.message}`);
      pending.push(entry);
    }
  }
  if (pending.length) record.entries = pending;
  else undoStore.delete(token);
  return {
    ok: failures.length === 0,
    restored,
    error: failures.length ? `Restored ${restored} file${restored === 1 ? "" : "s"}. ${failures.join("; ")}` : undefined,
  };
}

async function replaceProject(payload = {}) {
  const root = safeRoot(payload.rootPath);
  if (!root) return { ok: false, error: "Open a project folder first." };
  const query = String(payload.query ?? "");
  if (!query) return { ok: false, error: "Enter something to replace." };
  const options = payload.options && typeof payload.options === "object" ? payload.options : {};
  let re;
  try { re = makeRegex(query, options); } catch (err) { return { ok: false, error: err.message }; }

  const include = compileFilter(options.include, () => true);
  const exclude = compileFilter(options.exclude, () => false);
  const requested = Array.isArray(payload.files) ? payload.files.filter((f) => typeof f === "string") : null;

  const candidates = [];
  if (requested && requested.length) {
    for (const raw of requested) {
      const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
      if (!isInside(root, abs)) continue;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (exclude(rel) || !include(rel)) continue;
      candidates.push({ full: abs, rel });
    }
  } else {
    for await (const file of walkFiles(root, exclude)) {
      if (include(file.rel)) candidates.push(file);
    }
  }

  const entries = [];
  const changedFiles = [];
  let totalHits = 0;
  let skipped = 0;
  for (const file of candidates) {
    const text = await readText(file.full);
    if (text == null) { skipped++; continue; }
    const { next, hits } = buildReplacementText(text, re, payload.replacement, !!options.regex);
    if (!hits || next === text) continue;
    try {
      // Local history snapshot is best-effort; never block the replace.
      try { require("./local-history").recordSnapshotSync(file.full, text, "Replace in Files"); } catch {}
      fs.writeFileSync(file.full, next, "utf8");
      entries.push({ path: file.full, before: text, afterHash: contentHash(Buffer.from(next, "utf8")) });
      changedFiles.push({ path: file.full, rel: file.rel, matches: hits });
      totalHits += hits;
      broadcastChanged(root, file.full);
    } catch (err) {
      skipped++;
    }
  }

  const token = entries.length ? rememberUndo(root, entries) : null;
  return {
    ok: true,
    replaced: totalHits,
    files: changedFiles,
    fileCount: changedFiles.length,
    skipped,
    undoToken: token,
  };
}

module.exports = { searchProject, replaceProject, undoReplace, makeRegex, _undoStore: undoStore };
