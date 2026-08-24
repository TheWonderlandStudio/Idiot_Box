// Main process entry point
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage, clipboard, protocol, net: electronNet, session } = require("electron");
const path    = require("path");
const fs      = require("fs");
const { pathToFileURL } = require("url");
const { spawn } = require("child_process");
let chokidar = null;
try { chokidar = require("chokidar"); } catch (e) { console.warn("[main] chokidar not available:", e.message); }
let pty = null;
try { pty = require("node-pty"); } catch (e) { console.warn("[main] node-pty not available:", e.message); }
let esbuild = null;
try { esbuild = require("esbuild"); } catch (e) { console.warn("[main] esbuild not available:", e.message); }
let ElectronChromeExtensions = null;
try { ({ ElectronChromeExtensions } = require("electron-chrome-extensions")); } catch (e) { console.warn("[main] electron-chrome-extensions not available:", e.message); }

// ─── Global error handlers — prevent crash on missing optional deps ──────────
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  try {
    dialog.showErrorBox("Idiot Box — Error", String(err?.message || err));
  } catch {}
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

// ─── Custom scheme: extension-host file access ───────────────────────────────
// The web-worker extension host runs in a sandboxed worker that cannot
// fetch(file://...) — serve extension files through this privileged scheme
// so workers can fetch() them like regular http resources.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "ppoo-file",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// ─── Component Bundling for Canvas/Preview ──────────────────────────────────
// Real module resolution: esbuild bundles the component with the project's
// node_modules (clsx, class-variance-authority, @radix-ui/*, react-day-picker,
// date-fns, ...) plus local imports and the "@" -> src alias, leaving only
// react/react-dom as externals. The renderer evals the CJS output with a
// sandbox require() that maps those to the host React.
const BUNDLE_CONCURRENCY = 4;
let bundleActive = 0;
const bundleQueue = [];
const nextBundle = async () => {
  while (bundleQueue.length && bundleActive < BUNDLE_CONCURRENCY) {
    const task = bundleQueue.shift();
    bundleActive++;
    try { task.resolve(await task.fn()); } catch (err) { task.reject(err); }
    bundleActive--;
  }
};
const queuedBundle = (fn) => new Promise((resolve, reject) => {
  bundleQueue.push({ fn, resolve, reject });
  nextBundle();
});

ipcMain.handle("component:bundle", async (_e, { source, filePath, projectRoot } = {}) => {
  if (!esbuild) {
    return { ok: false, error: "esbuild not available - run `npm install` or reinstall the app" };
  }
  if (typeof source !== "string" || !source.trim()) {
    return { ok: false, error: "Empty source" };
  }
  if (typeof filePath !== "string" || !filePath) {
    return { ok: false, error: "Missing file path" };
  }
  return queuedBundle(async () => {
    const tryBuild = async (useAlias) => {
      const opts = {
        stdin: {
          contents: source,
          resolveDir: path.dirname(filePath),
          sourcefile: filePath,
          loader: "tsx",
        },
        bundle: true,
        format: "cjs",
        platform: "browser",
        target: "es2020",
        jsx: "automatic",
        loader: {
          ".js": "jsx",
          ".jsx": "jsx",
          ".ts": "tsx",
          ".tsx": "tsx",
          ".css": "empty", ".scss": "empty", ".less": "empty", ".pcss": "empty",
          ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".gif": "dataurl", ".webp": "dataurl", ".svg": "dataurl",
        },
        external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
        absWorkingDir: projectRoot || path.dirname(filePath),
        write: false,
        logLevel: "silent",
        define: { "process.env.NODE_ENV": '"development"' },
      };
      if (useAlias) {
        try {
          const srcDir = path.join(projectRoot || path.dirname(filePath), "src");
          if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
            opts.alias = { "@": srcDir };
          }
        } catch {}
      }
      return esbuild.build(opts);
    };
    try {
      let result;
      try {
        result = await tryBuild(true);
      } catch (aliasErr) {
        // retry without alias - alias often fails if src not found
        const msg = aliasErr?.errors?.[0]?.text || aliasErr?.message || "";
        if (msg.includes("@") || msg.includes("src")) {
          result = await tryBuild(false);
        } else {
          throw aliasErr;
        }
      }
      if (!result.outputFiles?.[0]) throw new Error("Empty bundle output");
      return { ok: true, code: result.outputFiles[0].text };
    } catch (err) {
      const e = err?.errors?.[0];
      const loc = e?.location;
      const where = loc ? ` (${path.basename(loc.file || filePath)}:${loc.line}:${loc.column})` : "";
      const detail = e?.text || err?.message || String(err);
      // Provide more helpful hint for common failures
      let hint = "";
      if (detail.includes("Could not resolve")) hint = "\nHint: check import path / missing node_modules. Run `npm install` in project.";
      if (detail.includes("Unexpected")) hint = "\nHint: JSX syntax error — check component file.";
      return { ok: false, error: `${detail}${where}${hint}` };
    }
  });
});

// ─── Long path helper (Windows) ──────────────────────────────────────────────
const toLongPath = (p) => {
  if (process.platform !== "win32" || !p) return p;
  let n = p.replace(/\//g, "\\");
  if (n.startsWith("\\\\?\\")) return n;
  if (n.startsWith("\\\\")) return "\\\\?\\UNC\\" + n.slice(2);
  if (n.length >= 250 && path.isAbsolute(n) && !n.startsWith("\\\\?\\")) {
    return "\\\\?\\" + n;
  }
  return n;
};

// ─── Settings ─────────────────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const readSettings  = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; } };
const writeSettings = (d) => { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(d, null, 2)); return true; } catch { return false; } };
ipcMain.handle("settings:read",  () => readSettings());
ipcMain.handle("settings:write", (_e, data) => writeSettings(data));

// ─── Editors (open files externally) ──────────────────────────────────────────
const KNOWN_EDITORS = [
  { id: "vscode",   label: "Visual Studio Code", commands: ["code"]               },
  { id: "cursor",   label: "Cursor",             commands: ["cursor"]             },
  { id: "windsurf", label: "Windsurf",           commands: ["windsurf"]           },
  { id: "zed",      label: "Zed",                commands: ["zed"]                },
  { id: "sublime",  label: "Sublime Text",       commands: ["subl","sublime_text"]},
  { id: "npp",      label: "Notepad++",          commands: ["notepad++"]          },
  { id: "webstorm", label: "WebStorm",           commands: ["webstorm"]           },
  { id: "idea",     label: "IntelliJ IDEA",      commands: ["idea"]               },
  { id: "rider",    label: "Rider",              commands: ["rider"]              },
  { id: "vstudio",  label: "Visual Studio",      commands: ["devenv"]             },
  { id: "android",  label: "Android Studio",     commands: ["studio"]             },
  { id: "vim",      label: "Vim",                commands: ["vim"]                },
  { id: "nvim",     label: "Neovim",             commands: ["nvim"]               },
  { id: "editor",   label: "Editor",               commands: []                     },
  { id: "system",   label: "System Default",       commands: []                     },
];
let _availableEditors = null;
const getAvailableEditors = () => {
  if (_availableEditors) return _availableEditors;
  const cmdExists = (cmd) => { try { require("child_process").execSync(process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } };
  _availableEditors = [
    { id: "editor", label: "Editor" },
    ...KNOWN_EDITORS
      .filter((e) => e.id !== "system" && e.id !== "editor" && e.commands.some(cmdExists))
      .map((e) => ({ id: e.id, label: e.label }))
  ];
  return _availableEditors;
};
ipcMain.handle("editors:list", () => getAvailableEditors().map((e) => ({ id: e.id, label: e.label, available: true })));

ipcMain.handle("fs:openFile", async (event, { filePath, editorId }) => {
  if (editorId === "editor") {
    try { event.sender.send("editor:openFile", { filePath }); } catch {}
    return;
  }
  const editor = KNOWN_EDITORS.find((e) => e.id === editorId);
  if (!editor || editor.id === "system" || !editor.commands.length) { await shell.openPath(filePath); return; }
  try { require("child_process").spawn(editor.commands[0], [filePath], { detached: true, stdio: "ignore" }).unref(); }
  catch { await shell.openPath(filePath); }
});

ipcMain.handle("fs:writeFile", async (_e, { filePath, text }) => {
  try {
    fs.writeFileSync(toLongPath(filePath), text, "utf8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("fs:saveFileAs", async (event, { filePath, text }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const defaultName = filePath ? filePath.replace(/.*[\\/]/, "") : "untitled.txt";
  const { canceled, filePath: newPath } = await dialog.showSaveDialog(win, {
    title: "Save As",
    defaultPath: defaultName,
  });
  if (canceled || !newPath) return { canceled: true };
  try {
    fs.writeFileSync(toLongPath(newPath), text, "utf8");
    return { canceled: false, path: newPath };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
});

ipcMain.handle("dialog:confirm", async (event, message) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Cancel", "OK"],
    defaultId: 1,
    cancelId: 0,
    message,
  });
  return response === 1;
});

ipcMain.handle("dialog:alert", async (event, message) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  await dialog.showMessageBox(win, {
    type: "error",
    buttons: ["OK"],
    defaultId: 0,
    message,
  });
});

// ─── Dialog ───────────────────────────────────────────────────────────────────
ipcMain.handle("dialog:openFolder", async (event) => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths.length) return null;
  const folderPath = r.filePaths[0];
  lastProjectPath = folderPath;
  event.sender.send("menu:openProject", folderPath);
  return folderPath;
});

// ─── Directory reads ──────────────────────────────────────────────────────────
const sortByName = (arr) => arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

ipcMain.handle("fs:readDir", async (_e, dirPath) => {
  try {
    return sortByName(fs.readdirSync(toLongPath(dirPath), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: path.join(dirPath, e.name) })));
  } catch { return []; }
});

ipcMain.handle("fs:readDirAll", async (_e, dirPath) => {
  try {
    const entries = fs.readdirSync(toLongPath(dirPath), { withFileTypes: true });
    return [
      ...sortByName(entries.filter((e) => e.isDirectory()).map((e) => ({ name: e.name, path: path.join(dirPath, e.name), isDir: true }))),
      ...sortByName(entries.filter((e) => e.isFile()).map((e)      => ({ name: e.name, path: path.join(dirPath, e.name), isDir: false }))),
    ];
  } catch { return []; }
});

// ─── File finder (Ctrl+P) and text search (Ctrl+Shift+F) ───────────────────────
const FIND_IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "out", "coverage", ".cache", ".parcel-cache", ".turbo", ".vscode", ".idea"]);
const FIND_IGNORE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".mp4", ".webm", ".avi", ".mov", ".mkv", ".woff", ".woff2", ".ttf", ".eot", ".zip", ".tar", ".gz", ".pdf", ".exe", ".dll"]);
function shouldIgnoreFile(name, isDir) {
  if (name.startsWith(".")) return name !== ".env" && name !== ".env.example";
  if (isDir) return FIND_IGNORE_DIRS.has(name);
  const ext = path.extname(name).toLowerCase();
  return FIND_IGNORE_EXTS.has(ext);
}
ipcMain.handle("fs:findFiles", async (_e, rootPath, query = "", limit = 100) => {
  if (!rootPath || !fs.existsSync(rootPath)) return [];
  const q = String(query || "").toLowerCase().trim();
  const results = [];
  const stack = [rootPath];
  const gitignore = (() => {
    try {
      const gi = fs.readFileSync(path.join(rootPath, ".gitignore"), "utf8");
      return gi.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => l.replace(/\/$/, ""));
    } catch { return []; }
  })();
  const isIgnoredByGitignore = (rel) => gitignore.some((pat) => {
    if (pat.includes("*")) {
      const re = new RegExp("^" + pat.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      return re.test(rel) || re.test(path.basename(rel));
    }
    return rel === pat || rel.startsWith(pat + "/") || path.basename(rel) === pat;
  });
  while (stack.length && results.length < limit * 3) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(toLongPath(dir), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (shouldIgnoreFile(e.name, e.isDirectory())) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(rootPath, full).replace(/\\/g, "/");
      if (isIgnoredByGitignore(rel)) continue;
      if (e.isDirectory()) {
        stack.push(full);
      } else {
        if (!q || rel.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)) {
          results.push({ path: full, rel, name: e.name });
          if (results.length >= limit) break;
        } else if (q) {
          // Fuzzy: check if query chars appear in order
          let qi = 0;
          const nameLow = e.name.toLowerCase();
          for (let i = 0; i < nameLow.length && qi < q.length; i++) if (nameLow[i] === q[qi]) qi++;
          if (qi === q.length) results.push({ path: full, rel, name: e.name });
        }
      }
    }
  }
  // Sort by relevance: exact name match first, then rel, then alphabetical
  results.sort((a, b) => {
    const aName = a.name.toLowerCase(), bName = b.name.toLowerCase();
    const aExact = aName === q, bExact = bName === q;
    if (aExact !== bExact) return aExact ? -1 : 1;
    const aStarts = aName.startsWith(q), bStarts = bName.startsWith(q);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.rel.localeCompare(b.rel);
  });
  return results.slice(0, limit);
});

ipcMain.handle("fs:searchText", async (_e, rootPath, query, limit = 200) => {
  if (!rootPath || !query || !query.trim()) return [];
  const q = String(query).trim();
  if (q.length < 2) return [];
  // Try ripgrep first
  const tryRg = () => new Promise((resolve) => {
    const { spawn } = require("child_process");
    const rg = spawn("rg", ["--no-heading", "--line-number", "--color", "never", "--max-count", String(limit), "--glob", "!.git/*", "--glob", "!node_modules/*", "-i", q, rootPath], { timeout: 8000, windowsHide: true });
    let out = "";
    let err = "";
    rg.stdout.on("data", (d) => { out += d.toString(); if (out.length > 500000) rg.kill(); });
    rg.stderr.on("data", (d) => { err += d.toString(); });
    rg.on("error", () => resolve(null));
    rg.on("close", (code) => {
      if (code !== 0 && code !== 1 && !out) return resolve(null);
      const results = [];
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        const m = line.match(/^([^:]+):(\d+):(.*)$/);
        if (m) {
          const file = m[1];
          const rel = path.relative(rootPath, file).replace(/\\/g, "/");
          if (rel.includes("node_modules") || rel.startsWith(".git/")) continue;
          results.push({ path: file, rel, line: parseInt(m[2], 10), text: m[3].trim().slice(0, 300), preview: m[3].trim().slice(0, 120) });
          if (results.length >= limit) break;
        }
      }
      resolve(results);
    });
    setTimeout(() => { try { rg.kill(); } catch {}; resolve(null); }, 7500);
  });
  const rgRes = await tryRg();
  if (rgRes && rgRes.length) return rgRes;
  // Fallback: Node fs walk + grep
  const results = [];
  const stack = [rootPath];
  const qLower = q.toLowerCase();
  while (stack.length && results.length < limit) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(toLongPath(dir), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (shouldIgnoreFile(e.name, e.isDirectory())) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(rootPath, full).replace(/\\/g, "/");
      if (rel.includes("node_modules") || rel.startsWith(".git/")) continue;
      if (e.isDirectory()) {
        stack.push(full);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if ([".json", ".js", ".jsx", ".ts", ".tsx", ".html", ".css", ".scss", ".py", ".md", ".txt", ".yaml", ".yml", ".xml", ".php", ".rs", ".go", ".java", ".c", ".cpp", ".h"].includes(ext) || !ext) {
          try {
            const content = fs.readFileSync(toLongPath(full), "utf8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(qLower)) {
                results.push({ path: full, rel, line: i + 1, text: lines[i].trim().slice(0, 300), preview: lines[i].trim().slice(0, 120) });
                if (results.length >= limit) break;
              }
            }
          } catch {}
        }
        if (results.length >= limit) break;
      }
    }
  }
  return results.slice(0, limit);
});

// ─── Git helpers ───────────────────────────────────────────────────────────────
ipcMain.handle("git:status", async (_e, rootPath) => {
  if (!rootPath) return [];
  const { exec } = require("child_process");
  return new Promise((resolve) => {
    exec('git status --porcelain -uall', { cwd: rootPath, timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const out = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        const x = line.slice(0, 1), y = line.slice(1, 2);
        const file = line.slice(3).trim().replace(/^"(.*)"$/, "$1");
        const status = (x + y).trim() || "??";
        out.push({ status, x, y, path: path.join(rootPath, file), rel: file });
      }
      resolve(out);
    });
  });
});
ipcMain.handle("git:diff", async (_e, rootPath, filePath) => {
  if (!rootPath || !filePath) return "";
  try {
    const rel = path.relative(rootPath, filePath).replace(/\\/g, "/");
    const { execSync } = require("child_process");
    const out = execSync(`git diff --unified=0 -- "${rel.replace(/"/g, '\\"')}"`, { cwd: rootPath, timeout: 3000, encoding: "utf8", windowsHide: true });
    return String(out || "");
  } catch { return ""; }
});
ipcMain.handle("git:diffAll", async (_e, rootPath) => {
  if (!rootPath) return "";
  try {
    const { execSync } = require("child_process");
    const out = execSync(`git diff --unified=0`, { cwd: rootPath, timeout: 4000, encoding: "utf8", windowsHide: true });
    return String(out || "");
  } catch { return ""; }
});
ipcMain.handle("git:branch", async (_e, rootPath) => {
  if (!rootPath) return { branch: "", isRepo: false };
  const { execSync } = require("child_process");
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd: rootPath, timeout: 2000, encoding: "utf8", windowsHide: true });
  } catch { return { branch: "", isRepo: false }; }
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: rootPath, timeout: 2000, encoding: "utf8", windowsHide: true }).trim();
    let ahead = 0, behind = 0;
    try {
      const ab = execSync("git rev-list --left-right --count HEAD...@{upstream} 2>nul || git rev-list --left-right --count HEAD...origin/HEAD 2>nul || echo '0 0'", { cwd: rootPath, timeout: 2000, encoding: "utf8", windowsHide: true, shell: true }).trim();
      const parts = ab.split(/\s+/); ahead = parseInt(parts[0]||"0",10)||0; behind = parseInt(parts[1]||"0",10)||0;
    } catch {}
    return { branch, isRepo: true, ahead, behind };
  } catch { return { branch: "HEAD", isRepo: true, ahead: 0, behind: 0 }; }
});
ipcMain.handle("git:log", async (_e, rootPath, limit = 20) => {
  if (!rootPath) return [];
  try {
    const { execSync } = require("child_process");
    const n = Math.min(Math.max(parseInt(limit,10)||20, 1), 100);
    const fmt = "%H%x1f%an%x1f%ae%x1f%ar%x1f%s%x1f%D";
    const out = execSync(`git log --oneline -n ${n} --pretty=format:"${fmt}"`, { cwd: rootPath, timeout: 3000, encoding: "utf8", windowsHide: true });
    return out.split("\n").filter(Boolean).map((l) => {
      const [hash, author, email, relTime, msg, refs] = l.split("\x1f");
      return { hash: hash?.slice(0,7), fullHash: hash, author, email, relTime, msg, refs: refs||"" };
    });
  } catch { return []; }
});
ipcMain.handle("git:stage", async (_e, rootPath, relPath) => {
  if (!rootPath || !relPath) return { ok:false, error:"missing path" };
  try { const { execSync } = require("child_process"); execSync(`git add -- "${relPath.replace(/"/g,'\\"')}"`, { cwd: rootPath, timeout: 4000, windowsHide: true }); return { ok:true }; } catch(e){ return { ok:false, error: e.message }; }
});
ipcMain.handle("git:unstage", async (_e, rootPath, relPath) => {
  if (!rootPath || !relPath) return { ok:false, error:"missing path" };
  try { const { execSync } = require("child_process"); execSync(`git restore --staged -- "${relPath.replace(/"/g,'\\"')}" 2>nul || git reset HEAD -- "${relPath.replace(/"/g,'\\"')}"`, { cwd: rootPath, timeout: 4000, windowsHide: true, shell: true }); return { ok:true }; } catch(e){ return { ok:false, error: e.message }; }
});
ipcMain.handle("git:stageAll", async (_e, rootPath) => {
  if (!rootPath) return { ok:false };
  try { const { execSync } = require("child_process"); execSync(`git add -A`, { cwd: rootPath, timeout: 5000, windowsHide: true }); return { ok:true }; } catch(e){ return { ok:false, error: e.message }; }
});
ipcMain.handle("git:unstageAll", async (_e, rootPath) => {
  if (!rootPath) return { ok:false };
  try { const { execSync } = require("child_process"); execSync(`git reset HEAD`, { cwd: rootPath, timeout: 5000, windowsHide: true }); return { ok:true }; } catch(e){ return { ok:false, error: e.message }; }
});
ipcMain.handle("git:discard", async (_e, rootPath, relPath) => {
  if (!rootPath || !relPath) return { ok:false };
  try { const { execSync } = require("child_process"); execSync(`git checkout -- "${relPath.replace(/"/g,'\\"')}" 2>nul; git clean -f -- "${relPath.replace(/"/g,'\\"')}" 2>nul; git restore -- "${relPath.replace(/"/g,'\\"')}" 2>nul`, { cwd: rootPath, timeout: 4000, windowsHide: true, shell: true }); return { ok:true }; } catch(e){ return { ok:false, error: e.message }; }
});
ipcMain.handle("git:commit", async (_e, rootPath, message) => {
  if (!rootPath || !message?.trim()) return { ok:false, error: "Empty message" };
  try {
    const { execSync } = require("child_process");
    const safe = message.replace(/"/g,'\\"').replace(/\n/g,' ');
    execSync(`git commit -m "${safe}"`, { cwd: rootPath, timeout: 6000, encoding: "utf8", windowsHide: true });
    return { ok:true };
  } catch(e){ return { ok:false, error: e.stderr?.toString() || e.message || String(e) }; }
});
ipcMain.handle("git:push", async (_e, rootPath) => {
  if (!rootPath) return { ok:false };
  try { const { execSync } = require("child_process"); const out = execSync(`git push`, { cwd: rootPath, timeout: 15000, encoding:"utf8", windowsHide:true }); return { ok:true, out }; } catch(e){ return { ok:false, error: e.message }; }
});
ipcMain.handle("git:pull", async (_e, rootPath) => {
  if (!rootPath) return { ok:false };
  try { const { execSync } = require("child_process"); const out = execSync(`git pull`, { cwd: rootPath, timeout: 15000, encoding:"utf8", windowsHide:true }); return { ok:true, out }; } catch(e){ return { ok:false, error: e.message }; }
});
ipcMain.handle("git:fetch", async (_e, rootPath) => {
  if (!rootPath) return { ok:false };
  try { const { execSync } = require("child_process"); const out = execSync(`git fetch`, { cwd: rootPath, timeout: 15000, encoding:"utf8", windowsHide:true }); return { ok:true, out }; } catch(e){ return { ok:false, error: e.message }; }
});

// ─── Project config (tabs state + pin config) ──────────────────────────────────
const PIN_DIR  = ".project_config";
const PIN_FILE = ".pinconfig";
const TABS_FILE = "tabs.json";

ipcMain.handle("projectConfig:readTabs", async (_e, rootPath) => {
  const filePath = path.join(rootPath, PIN_DIR, TABS_FILE);
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch { return null; }
});

ipcMain.handle("projectConfig:writeTabs", async (_e, rootPath, data) => {
  const dir = path.join(rootPath, PIN_DIR);
  const filePath = path.join(dir, TABS_FILE);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch { return false; }
});

// ─── Pin config ────────────────────────────────────────────────────────────────
ipcMain.handle("fs:readPinConfig", async (_e, rootPath) => {
  const filePath = path.join(rootPath, PIN_DIR, PIN_FILE);
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch {
    const exists = (name) => fs.existsSync(path.join(rootPath, name));
    return ["assets", "components"].filter(exists);
  }
});

ipcMain.handle("fs:writePinConfig", async (_e, rootPath, data) => {
  const dir  = path.join(rootPath, PIN_DIR);
  const filePath = path.join(dir, PIN_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
});

// ─── Canvas (Visual Project Map) ──────────────────────────────────────────────
const CANVAS_EXT_RE        = /\.(jsx|tsx|js|ts|vue|svelte|html)$/i;
const CANVAS_EXCLUDE_DIRS  = new Set(["node_modules", "dist", "build", ".git", ".next", ".nuxt", ".output", ".cache", "coverage", "out"]);
const CANVAS_SCAN_NAMES    = ["pages", "components", "views", "widgets", "features", "ui"];
const CANVAS_LAYOUT_DIR    = ".canvas";
const CANVAS_LAYOUT_FILE   = "layout.json";

const detectFramework = (rootPath) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootPath, "package.json"), "utf8"));
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    if (names.includes("next")) return "next";
    if (names.includes("react") || names.includes("react-dom")) return "react";
    if (names.includes("vue")) return "vue";
    if (names.includes("svelte")) return "svelte";
    if (names.includes("solid-js")) return "solid";
    if (names.includes("preact")) return "preact";
    if (names.includes("@angular/core")) return "angular";
    return "unknown";
  } catch { return "unknown"; }
};

// Iterative scan — no recursion, so deeply nested trees can't overflow the
// call stack on large projects. Each directory fails soft (permission errors,
// long paths) without aborting the whole scan.
const scanCanvasDir = (rootAbs, rootRel) => {
  const root = { name: path.basename(rootAbs), relPath: rootRel, absPath: rootAbs, groups: [], children: [] };
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(toLongPath(node.absPath), { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && !CANVAS_EXCLUDE_DIRS.has(e.name));
    } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (const e of entries) {
      const childAbs = path.join(node.absPath, e.name);
      const childRel = node.relPath ? `${node.relPath}/${e.name}` : e.name;
      if (e.isDirectory()) {
        const g = { name: e.name, relPath: childRel, absPath: childAbs, groups: [], children: [] };
        node.groups.push(g);
        stack.push(g);
      } else if (CANVAS_EXT_RE.test(e.name)) {
        node.children.push({ name: e.name, relPath: childRel, absPath: childAbs, ext: e.name.slice(e.name.lastIndexOf(".")) });
      }
    }
  }
  return root;
};

ipcMain.handle("canvas:scan", async (_e, rootPath) => {
  try {
    if (!rootPath || !fs.existsSync(rootPath)) return null;
    const srcExists = fs.existsSync(path.join(rootPath, "src"));
    const roots = [];
    for (const name of CANVAS_SCAN_NAMES) {
      const cand = srcExists ? path.join(rootPath, "src", name) : path.join(rootPath, name);
      const final = srcExists && !fs.existsSync(cand) ? path.join(rootPath, name) : cand;
      if (fs.existsSync(final)) roots.push(scanCanvasDir(final, path.relative(rootPath, final).replace(/\\/g, "/")));
    }
    let count = 0;
    const tally = (n) => { count += n.children.length; n.groups.forEach(tally); };
    roots.forEach(tally);
    return { root: rootPath, framework: detectFramework(rootPath), roots, count };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
});

ipcMain.handle("canvas:saveLayout", async (_e, rootPath, data) => {
  const dir = path.join(rootPath, CANVAS_LAYOUT_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, CANVAS_LAYOUT_FILE), JSON.stringify(data || {}, null, 2));
    return true;
  } catch { return false; }
});

ipcMain.handle("canvas:loadLayout", async (_e, rootPath) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootPath, CANVAS_LAYOUT_DIR, CANVAS_LAYOUT_FILE), "utf8"));
  } catch { return null; }
});

// ─── File system operations ───────────────────────────────────────────────────
ipcMain.handle("fs:newFolder", async (_e, { parentPath, name }) => {
  const lp = toLongPath(parentPath);
  let target = path.join(lp, name || "New Folder"), i = 1, final = target;
  while (fs.existsSync(final)) final = `${target} (${i++})`;
  fs.mkdirSync(final, { recursive: true }); return path.join(parentPath, path.basename(final));
});

ipcMain.handle("fs:newFile", async (_e, { parentPath, name }) => {
  const lp = toLongPath(parentPath);
  let target = path.join(lp, name || "New File.txt"), i = 1, final = target;
  while (fs.existsSync(final)) { const { name: n, ext } = path.parse(target); final = path.join(lp, `${n} (${i++})${ext}`); }
  fs.writeFileSync(final, ""); return path.join(parentPath, path.basename(final));
});

ipcMain.handle("fs:rename", async (_e, { oldPath, newName }) => {
  const po = toLongPath(oldPath);
  const np = path.join(path.dirname(po), newName);
  try { fs.renameSync(po, np); return path.join(path.dirname(oldPath), newName); }
  catch (err) { throw new Error(`Cannot rename "${path.basename(oldPath)}": ${err.code === "EBUSY" ? "file is in use by another process" : err.message}`); }
});

ipcMain.handle("fs:delete", async (_e, { itemPath }) => {
  const lp = toLongPath(itemPath);
  try {
    const s = fs.statSync(lp);
    if (s.isDirectory()) fs.rmSync(lp, { recursive: true, force: true });
    else fs.unlinkSync(lp);
    return true;
  } catch (err) {
    throw new Error(`Cannot delete "${path.basename(itemPath)}": ${err.code === "EBUSY" ? "item is in use by another process" : err.message}`);
  }
});

// ─── Local trash (project-level recycle bin) ──────────────────────────────
const TRASH_DIR = ".trash";
const MANIFEST  = "manifest.json";

function trashDir(rootPath) {
  return path.join(rootPath, TRASH_DIR);
}

function manifestPath(rootPath) {
  return path.join(trashDir(rootPath), MANIFEST);
}

function readManifest(rootPath) {
  try { return JSON.parse(fs.readFileSync(manifestPath(rootPath), "utf8")); }
  catch { return {}; }
}

function writeManifest(rootPath, manifest) {
  const td = trashDir(rootPath);
  if (!fs.existsSync(td)) fs.mkdirSync(td, { recursive: true });
  fs.writeFileSync(manifestPath(rootPath), JSON.stringify(manifest, null, 2));
}

ipcMain.handle("fs:trashItem", async (_e, { itemPath, rootPath }) => {
  const lpItem = toLongPath(itemPath);
  const lpRoot = toLongPath(rootPath);
  try {
    const name = path.basename(lpItem);
    const td   = trashDir(lpRoot);
    if (!fs.existsSync(td)) fs.mkdirSync(td, { recursive: true });

    let trashId = `${Date.now()}_${name}`;
    let dest    = path.join(td, trashId);
    let i = 1;
    while (fs.existsSync(dest)) {
      trashId = `${Date.now()}_${i++}_${name}`;
      dest    = path.join(td, trashId);
    }

    if (lpItem === td || lpItem.startsWith(td + path.sep)) {
      throw new Error("Cannot trash item inside .trash folder");
    }

    fs.renameSync(lpItem, dest);

    const manifest = readManifest(lpRoot);
    manifest[trashId] = { originalPath: itemPath, timestamp: Date.now(), isDir: fs.statSync(dest).isDirectory() };
    writeManifest(lpRoot, manifest);

    return { trashId, originalPath: itemPath };
  } catch (err) {
    throw new Error(`Cannot trash "${path.basename(itemPath)}": ${err.message}`);
  }
});

ipcMain.handle("fs:restoreTrashItem", async (_e, { trashId, rootPath }) => {
  const lpRoot = toLongPath(rootPath);
  const manifest = readManifest(lpRoot);
  const entry = manifest[trashId];
  if (!entry) throw new Error(`Trash entry "${trashId}" not found`);

  const src = path.join(trashDir(lpRoot), trashId);
  const dst = toLongPath(entry.originalPath);

  let finalDst = dst, i = 1;
  while (fs.existsSync(finalDst)) {
    const { dir, name, ext } = path.parse(dst);
    finalDst = path.join(dir, `${name} (${i++})${ext}`);
  }

  const parentDir = path.dirname(finalDst);
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

  fs.renameSync(src, finalDst);

  delete manifest[trashId];
  writeManifest(lpRoot, manifest);

  return finalDst;
});

ipcMain.handle("fs:duplicate", async (_e, { itemPath }) => {
  const lp = toLongPath(itemPath);
  try {
    const { dir, name, ext } = path.parse(lp);
    let dest = path.join(dir, `${name} copy${ext}`), i = 2;
    while (fs.existsSync(dest)) dest = path.join(dir, `${name} copy ${i++}${ext}`);
    const s = fs.statSync(lp);
    if (s.isDirectory()) fs.cpSync(lp, dest, { recursive: true }); else fs.copyFileSync(lp, dest);
    return path.join(path.dirname(itemPath), path.basename(dest));
  } catch (err) {
    throw new Error(`Cannot duplicate "${path.basename(itemPath)}": ${err.message}`);
  }
});

ipcMain.handle("fs:copyItem", async (_e, { srcPath, destDir }) => {
  const lpSrc = toLongPath(srcPath);
  const lpDst = toLongPath(destDir);
  try {
    const name = path.basename(lpSrc);
    let dest = path.join(lpDst, name), i = 2;
    while (fs.existsSync(dest)) dest = path.join(lpDst, `${path.parse(name).name} (${i++})${path.extname(name)}`);
    const s = fs.statSync(lpSrc);
    if (s.isDirectory()) fs.cpSync(lpSrc, dest, { recursive: true }); else fs.copyFileSync(lpSrc, dest);
    return path.join(destDir, path.basename(dest));
  } catch (err) {
    throw new Error(`Cannot copy "${path.basename(srcPath)}": ${err.code === "EBUSY" ? "item is in use by another process" : err.message}`);
  }
});

ipcMain.handle("fs:moveItem", async (_e, { srcPath, destDir }) => {
  const lpSrc = toLongPath(srcPath);
  const lpDst = toLongPath(destDir);
  try {
    const dest = path.join(lpDst, path.basename(lpSrc));
    fs.renameSync(lpSrc, dest);
    return path.join(destDir, path.basename(srcPath));
  } catch (err) {
    throw new Error(`Cannot move "${path.basename(srcPath)}": ${err.code === "EBUSY" ? "item is in use by another process" : err.message}`);
  }
});

ipcMain.handle("fs:revealInExplorer", (_e, { itemPath }) => shell.showItemInFolder(itemPath));

ipcMain.handle("fs:stat", async (_e, itemPath) => {
  try { const s = fs.statSync(toLongPath(itemPath)); return { isDir: s.isDirectory(), exists: true, size: s.size, mtime: s.mtime, birthtime: s.birthtime }; }
  catch { return { isDir: false, exists: false }; }
});

ipcMain.handle("media:copyImage", async (_e, filePath) => {
  try {
    const img = nativeImage.createFromPath(toLongPath(filePath));
    clipboard.writeImage(img);
    return true;
  } catch {
    return false;
  }
});

// ─── Icons ────────────────────────────────────────────────────────────────────
const vsicons   = require("vscode-icons-js");
const VSICONS_B = "https://raw.githubusercontent.com/vscode-icons/vscode-icons/master/icons/";
ipcMain.handle("fs:getVscodeIcon", (_e, { name, isDir, isOpen }) => {
  try { return VSICONS_B + (isDir ? (isOpen ? vsicons.getIconForOpenFolder(name) : vsicons.getIconForFolder(name)) : vsicons.getIconForFile(name)); }
  catch { return VSICONS_B + (isDir ? "default_folder.svg" : "default_file.svg"); }
});
ipcMain.handle("fs:getIcon", async (_e, filePath) => {
  try { return (await app.getFileIcon(filePath, { size: "normal" })).toDataURL(); } catch { return null; }
});

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico"];
const VIDEO_EXTS = [".mp4", ".webm", ".avi", ".mov", ".mkv", ".wmv", ".flv"];

ipcMain.handle("fs:getFilePreview", async (_e, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.includes(ext)) {
    try {
      const data = fs.readFileSync(toLongPath(filePath));
      if (data.length > 2 * 1024 * 1024) return { type: "image", data: null };
      const mime = ext === ".svg" ? "image/svg+xml"
        : ext === ".ico" ? "image/x-icon"
        : `image/${ext.slice(1)}`;
      return { type: "image", data: `data:${mime};base64,${data.toString("base64")}` };
    } catch { return null; }
  }
  if (VIDEO_EXTS.includes(ext)) return { type: "video" };
  return null;
});

ipcMain.handle("fs:readTextFile", async (_e, filePath) => {
  try { return fs.readFileSync(toLongPath(filePath), "utf8"); } catch { return null; }
});

ipcMain.handle("fs:readFileAsDataUrl", async (_e, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const data = fs.readFileSync(toLongPath(filePath));
    if (data.length > 10 * 1024 * 1024) return null;
    const mime = ext === ".svg" ? "image/svg+xml"
      : ext === ".ico" ? "image/x-icon"
      : ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".bmp" || ext === ".webp" ? `image/${ext.slice(1)}`
      : ext === ".mp4" ? "video/mp4"
      : ext === ".webm" ? "video/webm"
      : null;
    if (!mime) return null;
    return `data:${mime};base64,${data.toString("base64")}`;
  } catch { return null; }
});

// ─── Chokidar filesystem watcher ─────────────────────────────────────────────
const watchers = new Map();

function watcherKey(rootPath, wcId) { return `${rootPath}::${wcId}`; }

function makeDebouncer(delay = 150) {
  const timers = new Map();
  return (key, fn) => {
    if (timers.has(key)) clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); fn(); }, delay));
  };
}

ipcMain.handle("fs:watch", (event, rootPath) => {
  if (!chokidar) {
    console.warn("[fs:watch] chokidar not available, skipping watcher for", rootPath);
    return;
  }
  const wcId = event.sender.id;
  const key  = watcherKey(rootPath, wcId);
  if (watchers.has(key)) return;

  const debounce = makeDebouncer(200);

  const watcher = chokidar.watch(rootPath, {
    depth:             3,
    ignoreInitial:     true,
    ignored:           /(^|[/\\])\..|(node_modules)/,
    persistent:        true,
    usePolling:        false,
    awaitWriteFinish:  { stabilityThreshold: 100, pollInterval: 50 },
  });

  const notify = (changedPath) => {
    const affectedDir = fs.existsSync(changedPath) && fs.statSync(changedPath).isDirectory()
      ? changedPath
      : path.dirname(changedPath);

    debounce(affectedDir, () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed() && !event.sender.isDestroyed()) {
        event.sender.send("fs:change", affectedDir, changedPath);
      }
    });
  };

  watcher.on("add",       notify);
  watcher.on("unlink",    notify);
  watcher.on("addDir",    notify);
  watcher.on("unlinkDir", notify);
  watcher.on("change",    notify);

  watchers.set(key, watcher);
});

ipcMain.handle("fs:unwatch", async (event, rootPath) => {
  const key = watcherKey(rootPath, event.sender.id);
  const w   = watchers.get(key);
  if (w) { await w.close(); watchers.delete(key); }
});

// ─── Browser webview context menu ────────────────────────────────────────────
ipcMain.handle("browser:webviewContextMenu", (event, { hasSelection, selectionText, linkURL, srcURL, isEditable, pageURL, x, y, webContentsId }) => {
  return new Promise((resolve) => {
    const act = (action, data) => resolve({ action, data });
    const sep = { type: "separator" };
    const items = [];

    if (linkURL) {
      items.push({ label: "Open Link in New Tab",     click: () => act("openLinkNewTab", { url: linkURL }) });
      items.push({ label: "Open Link in New Window",  click: () => act("openLinkNewWindow", { url: linkURL }) });
      items.push({ label: "Save Link As…",            click: () => act("saveLinkAs", { url: linkURL }) });
      items.push({ label: "Copy Link Address",        click: () => act("copyLink",       { url: linkURL }) });
      items.push({ label: "Copy Link Text",           click: () => act("copyLinkText", { text: selectionText || linkURL }) });
      items.push(sep);
    }

    if (srcURL) {
      items.push({ label: "Open Image in New Tab",    click: () => act("openImageNewTab", { url: srcURL }) });
      items.push({ label: "Save Image As…",           click: () => act("saveImageAs", { url: srcURL }) });
      items.push({ label: "Copy Image",               click: () => act("copyImage", { url: srcURL }) });
      items.push({ label: "Copy Image Address",       click: () => act("copyImageURL",    { url: srcURL }) });
      items.push(sep);
    }

    if (hasSelection && selectionText) {
      const label = `Search Google for "${selectionText.slice(0, 30)}${selectionText.length > 30 ? "…" : ""}"`;
      items.push({ label, click: () => act("searchSelection", { text: selectionText }) });
      items.push(sep);
      items.push({ label: "Copy",                  accelerator: "Ctrl+C",  click: () => act("copy") });
      if (isEditable) items.push({ label: "Cut",   accelerator: "Ctrl+X",  click: () => act("cut")   });
      items.push({ label: "Select All",            accelerator: "Ctrl+A", click: () => act("selectAll") });
      items.push(sep);
    } else if (hasSelection) {
      items.push({ label: "Copy",                  accelerator: "Ctrl+C",  click: () => act("copy") });
      items.push(sep);
    }

    if (isEditable) {
      items.push({ label: "Undo",    accelerator: "Ctrl+Z",  click: () => act("undo") });
      items.push({ label: "Redo",    accelerator: "Ctrl+Y",  click: () => act("redo") });
      items.push(sep);
      items.push({ label: "Cut",     accelerator: "Ctrl+X",  click: () => act("cut")   });
      items.push({ label: "Copy",    accelerator: "Ctrl+C",  click: () => act("copy")  });
      items.push({ label: "Paste",   accelerator: "Ctrl+V",  click: () => act("paste") });
      items.push({ label: "Delete",  accelerator: "Delete", click: () => act("delete") });
      items.push({ label: "Select All", accelerator: "Ctrl+A", click: () => act("selectAll") });
      items.push(sep);
    }

    items.push({ label: "Back",    accelerator: "Alt+Left",  click: () => act("back"),    enabled: true });
    items.push({ label: "Forward", accelerator: "Alt+Right", click: () => act("forward"), enabled: true });
    items.push({ label: "Reload",  accelerator: "Ctrl+R",    click: () => act("reload") });
    items.push(sep);

    items.push({ label: "Save Page As…", accelerator: "Ctrl+S", click: () => act("saveAs") });
    items.push({ label: "Print…",        accelerator: "Ctrl+P", click: () => act("print") });
    items.push(sep);

    // Chrome extension contextMenus
    if (chromeExt && webContentsId) {
      try {
        const wc = require("electron").webContents.fromId(webContentsId);
        const extItems = wc ? chromeExt.getContextMenuItems(wc, { linkURL, srcURL, selectionText, isEditable, editable: isEditable, pageURL, x, y }) : [];
        if (extItems && extItems.length) {
          items.push(sep);
          items.push(...extItems);
          items.push(sep);
        }
      } catch {}
    }

    items.push({ label: "View Page Source", click: () => act("viewSource", { url: pageURL }) });
    items.push({ label: "Inspect Element",  click: () => act("inspect", { x, y }) });

    const menu = Menu.buildFromTemplate(items);
    const win  = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win, callback: () => resolve(null) });
  });
});

// ─── Browser tab context menu ─────────────────────────────────────────────────
ipcMain.handle("browser:tabContextMenu", (event) => {
  return new Promise((resolve) => {
    const act = (action) => resolve({ action });
    const items = [
      { label: "Settings",           click: () => act("settings") },
      { label: "Refresh",            click: () => act("refresh") },
    ];
    const menu = Menu.buildFromTemplate(items);
    const win  = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win, callback: () => resolve(null) });
  });
});

// ─── Context menu ─────────────────────────────────────────────────────────────
ipcMain.handle("contextMenu:show", (event, { type, selectedPaths = [], clipboardPaths = null }) => {
  return new Promise((resolve) => {
    const act = (action) => resolve({ action });
    const has = (n) => selectedPaths.length >= n;
    const sep = { type: "separator" };

    let items = [];

    if (type === "breadcrumb") {
      items = [
        { label: "Copy Path",               accelerator: "Ctrl+Shift+C", click: () => act("copyPath") },
        { label: "Copy Name",                                             click: () => act("copyName") },
        sep,
        { label: "Open in Terminal",                                     click: () => act("openInTerminal") },
        { label: "Reveal in File Explorer", accelerator: "Ctrl+Shift+R", click: () => act("reveal")   },
        sep,
        { label: "Refresh",                 accelerator: "F5",           click: () => act("refresh") },
      ];
    } else if (type === "none") {
      items = [
        { label: "New Folder",              accelerator: "Ctrl+Shift+N", click: () => act("newFolder") },
        { label: "New File",                accelerator: "Ctrl+N",       click: () => act("newFile")   },
        sep,
        { label: "Paste",                   accelerator: "Ctrl+V", enabled: !!(clipboardPaths?.length), click: () => act("paste") },
        sep,
        { label: "Reveal in File Explorer", accelerator: "Ctrl+Shift+R", click: () => act("reveal")  },
        { label: "Refresh",                 accelerator: "F5",           click: () => act("refresh") },
      ];
    } else if (type === "multi") {
      items = [
        { label: `Delete (${selectedPaths.length} items)`, accelerator: "Delete", click: () => act("delete") },
        sep,
        { label: "Copy",                    accelerator: "Ctrl+C", click: () => act("copy") },
        { label: "Cut",                     accelerator: "Ctrl+X", click: () => act("cut")  },
        sep,
        { label: "Copy Path",               accelerator: "Ctrl+Shift+C", click: () => act("copyPath") },
      ];
    } else if (type === "pinned") {
      items = [
        { label: "New Folder",              accelerator: "Ctrl+Shift+N", click: () => act("newFolder") },
        { label: "New File",                accelerator: "Ctrl+N",       click: () => act("newFile")   },
        sep,
        { label: "Open in Terminal",                                     click: () => act("openInTerminal") },
        sep,
        { label: "Unpin",                                                click: () => act("pinToSidebar") },
        sep,
        { label: "Rename",                  accelerator: "F2",           click: () => act("rename")    },
        { label: "Delete",                  accelerator: "Delete",       click: () => act("delete")    },
        { label: "Duplicate",               accelerator: "Ctrl+D",       click: () => act("duplicate") },
        sep,
        { label: "Copy",                    accelerator: "Ctrl+C",       click: () => act("copy") },
        { label: "Cut",                     accelerator: "Ctrl+X",       click: () => act("cut")  },
        { label: "Paste",                   accelerator: "Ctrl+V", enabled: !!(clipboardPaths?.length), click: () => act("paste") },
        sep,
        { label: "Reveal in File Explorer", accelerator: "Ctrl+Shift+R", click: () => act("reveal")   },
        { label: "Copy Path",               accelerator: "Ctrl+Shift+C", click: () => act("copyPath") },
        { label: "Refresh",                 accelerator: "F5",           click: () => act("refresh")  },
      ];
    } else if (type === "folder") {
      items = [
        { label: "New Folder",              accelerator: "Ctrl+Shift+N", click: () => act("newFolder") },
        { label: "New File",                accelerator: "Ctrl+N",       click: () => act("newFile")   },
        sep,
        { label: "Open in Terminal",                                     click: () => act("openInTerminal") },
        sep,
        { label: "Pin to sidebar",                                       click: () => act("pinToSidebar") },
        sep,
        { label: "Rename",                  accelerator: "F2",           click: () => act("rename")    },
        { label: "Delete",                  accelerator: "Delete",       click: () => act("delete")    },
        { label: "Duplicate",               accelerator: "Ctrl+D",       click: () => act("duplicate") },
        sep,
        { label: "Copy",                    accelerator: "Ctrl+C",       click: () => act("copy") },
        { label: "Cut",                     accelerator: "Ctrl+X",       click: () => act("cut")  },
        { label: "Paste",                   accelerator: "Ctrl+V", enabled: !!(clipboardPaths?.length), click: () => act("paste") },
        sep,
        { label: "Reveal in File Explorer", accelerator: "Ctrl+Shift+R", click: () => act("reveal")   },
        { label: "Copy Path",               accelerator: "Ctrl+Shift+C", click: () => act("copyPath") },
        { label: "Refresh",                 accelerator: "F5",           click: () => act("refresh")  },
      ];
    } else if (type === "file") {
      const singlePath = selectedPaths.length === 1 ? selectedPaths[0] : "";
      const ext = singlePath ? path.extname(singlePath).toLowerCase() : "";
      const isHtml = [".html", ".htm", ".xhtml", ".shtml"].includes(ext);
      const openWithSubmenu = [
        { label: "System Default", accelerator: "Ctrl+Enter", click: () => act("openWithSystem") },
        { type: "separator" },
        { label: "Media Viewer",                          click: () => act("openInMediaViewer") },
      ];

      items = [
        { label: "Open",                    accelerator: "Enter",        click: () => act("open")     },
        { label: "Open in New Editor Tab",                               click: () => act("openInNewEditorTab") },
        { label: "Open with", submenu: openWithSubmenu },
        ...(isHtml ? [
          sep,
          { label: "Open in Browser",                accelerator: "Alt+B", click: () => act("openInBrowser") },
          { label: "Open in External Browser",                       click: () => act("openInExternalBrowser") },
        ] : []),
        sep,
        { label: "Rename",                  accelerator: "F2",           click: () => act("rename")    },
        { label: "Delete",                  accelerator: "Delete",       click: () => act("delete")    },
        { label: "Duplicate",               accelerator: "Ctrl+D",       click: () => act("duplicate") },
        sep,
        { label: "Copy",                    accelerator: "Ctrl+C",       click: () => act("copy") },
        { label: "Cut",                     accelerator: "Ctrl+X",       click: () => act("cut")  },
        { label: "Paste",                   accelerator: "Ctrl+V", enabled: !!(clipboardPaths?.length), click: () => act("paste") },
        sep,
        { label: "Reveal in File Explorer", accelerator: "Ctrl+Shift+R", click: () => act("reveal")   },
        { label: "Copy Path",               accelerator: "Ctrl+Shift+C", click: () => act("copyPath") },
      ];
    } else if (type === "mediaViewer") {
      const filePath = selectedPaths?.[0] || "";
      const extName = path.extname(filePath).toLowerCase();
      const isImg = IMAGE_EXTS.includes(extName);
      items = [
        { label: "Zoom In (+25%)",           accelerator: "Ctrl+=",       click: () => act("zoomIn") },
        { label: "Zoom Out (-25%)",          accelerator: "Ctrl+-",       click: () => act("zoomOut") },
        { label: "Reset Zoom (100%)",        accelerator: "Ctrl+0",       click: () => act("resetZoom") },
        { label: "Fit to Screen",            accelerator: "F",            click: () => act("fitWindow") },
        sep,
        { label: "Rotate 90° Right",         accelerator: "R",            click: () => act("rotateRight") },
        { label: "Rotate 90° Left",          accelerator: "Shift+R",      click: () => act("rotateLeft") },
        { label: "Flip Horizontally",        accelerator: "H",            click: () => act("flipH") },
        { label: "Flip Vertically",          accelerator: "V",            click: () => act("flipV") },
        sep,
        { label: "Copy Image to Clipboard",  enabled: isImg,              click: () => act("copyImage") },
        { label: "Copy File Path",           accelerator: "Ctrl+Shift+C", click: () => act("copyPath") },
        { label: "Reveal in File Explorer",  accelerator: "Ctrl+Shift+R", click: () => act("reveal") },
        { label: "Open in System Default",   accelerator: "Enter",        click: () => act("openWithSystem") },
        sep,
        { label: "Close Media Viewer",       accelerator: "Esc",          click: () => act("close") },
      ];
    }

    const menu = Menu.buildFromTemplate(items);
    const win  = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win, callback: () => resolve(null) });
  });
});

// ─── Terminal ─────────────────────────────────────────────────────────────────
const termProcesses = new Map();
let lastProjectPath = null;

function detectShell() {
  if (process.platform !== "win32") return process.env.SHELL || "/bin/bash";
  try { require("child_process").execSync("pwsh -c exit", { stdio: "ignore" }); return "pwsh.exe"; } catch {}
  try { require("child_process").execSync("powershell -c exit", { stdio: "ignore" }); return "powershell.exe"; } catch {}
  return process.env.COMSPEC || "cmd.exe";
}

let cachedShell = null;
function getShell() {
  if (!cachedShell) cachedShell = detectShell();
  return cachedShell;
}

function getShellArgs(shell) {
  if (shell === "pwsh.exe" || shell === "powershell.exe") return ["-NoLogo"];
  return [];
}

function termKey(sender, tabId) { return `${sender.id}:${tabId}`; }

ipcMain.handle("terminal:getProjectPath", () => lastProjectPath);

ipcMain.handle("terminal:open", async (event, { tabId, cwd, forceRestart }) => {
  if (!pty) {
    console.error("[terminal:open] node-pty not available, cannot spawn terminal");
    try { event.sender.send("terminal:data", { tabId, data: "\r\n\x1b[31mnode-pty not available - run `npm install` and rebuild\x1b[0m\r\n" }); } catch {}
    return false;
  }
  const key = termKey(event.sender, tabId);

  if (termProcesses.has(key)) {
    if (!forceRestart) return true;
    termProcesses.get(key).kill();
    termProcesses.delete(key);
  }

  const shell = getShell();
  const shellArgs = getShellArgs(shell);
  const p = pty.spawn(shell, shellArgs, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: cwd || process.cwd(),
    env: { ...process.env },
  });

  termProcesses.set(key, p);

  p.onData((data) => {
    try { event.sender.send("terminal:data", { tabId, data }); } catch {}
  });

  p.onExit(({ exitCode, signal }) => {
    if (termProcesses.get(key) === p) termProcesses.delete(key);
    try { event.sender.send("terminal:exit", { tabId, code: exitCode, signal }); } catch {}
  });

  return true;
});

ipcMain.handle("terminal:write", async (event, { tabId, data }) => {
  const p = termProcesses.get(termKey(event.sender, tabId));
  if (p) p.write(data);
});

ipcMain.handle("terminal:resize", async (event, { tabId, cols, rows }) => {
  const p = termProcesses.get(termKey(event.sender, tabId));
  if (p && cols > 0 && rows > 0) p.resize(cols, rows);
});

ipcMain.handle("terminal:close", async (event, { tabId }) => {
  const key = termKey(event.sender, tabId);
  const p = termProcesses.get(key);
  if (p) { p.kill(); termProcesses.delete(key); }
});

ipcMain.handle("terminal:contextMenu", (event, { hasSelection }) => {
  return new Promise((resolve) => {
    const act = (action) => resolve({ action });
    const items = [
      { label: "Copy",                  accelerator: "Ctrl+Shift+C", enabled: hasSelection, click: () => act("copy") },
      { label: "Paste",                 accelerator: "Ctrl+Shift+V",                       click: () => act("paste") },
      { type: "separator" },
      { label: "New Terminal Panel",     accelerator: "Ctrl+Shift+T",                        click: () => act("addPanel") },
      { label: "Split Right",           accelerator: "Ctrl+Shift+\\",                       click: () => act("splitRight") },
      { label: "Split Down",            accelerator: "Ctrl+Shift+-",                        click: () => act("splitDown") },
      { type: "separator" },
      { label: "Clear Terminal",        accelerator: "Ctrl+K",                              click: () => act("clear") },
      { label: "Restart Shell",         accelerator: "Ctrl+Shift+R",                        click: () => act("restart") },
      { label: "Close Panel",           accelerator: "Ctrl+W",                              click: () => act("close") },
    ];
    const menu = Menu.buildFromTemplate(items);
    const win = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win, callback: () => resolve(null) });
  });
});

ipcMain.handle("terminal:tabContextMenu", (event) => {
  return new Promise((resolve) => {
    const act = (action) => resolve({ action });
    const items = [
      { label: "Kill Terminal",   click: () => act("kill") },
      { label: "Restart",         click: () => act("restart") },
      { type: "separator" },
      { label: "Rename Tab",      click: () => act("rename") },
      { type: "separator" },
      { label: "Close Tab",       click: () => act("close") },
    ];
    const menu = Menu.buildFromTemplate(items);
    const win = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win, callback: () => resolve(null) });
  });
});

// ─── Port scanner ────────────────────────────────────────────────────────────
const net = require("net");
const COMMON_PORTS = [3000, 3001, 5000, 5173, 8080, 8081, 4200, 8000, 3005, 3006, 4173, 4321, 9000, 9001];
let scanPortsInProgress = null;
function scanPortsViaConnect(ports) {
  return new Promise((resolve) => {
    const active = [];
    let remaining = ports.length;
    if (!remaining) { resolve(active); return; }
    for (const port of ports) {
      let done = false;
      const tryHost = (host) => {
        const s = net.createConnection({ port, host, timeout: 700 });
        s.on("connect", () => { if (!done) { done = true; s.destroy(); active.push(port); checkDone(); } else s.destroy(); });
        s.on("error", () => { s.destroy(); if (host === "127.0.0.1") tryHost("::1"); else if (!done) checkDone(); });
        s.on("timeout", () => { s.destroy(); if (host === "127.0.0.1") tryHost("::1"); else checkDone(); });
      };
      tryHost("127.0.0.1");
      function checkDone() { if (!done) { done = true; if (--remaining <= 0) resolve(active.sort((a, b) => a - b)); } else if (--remaining <= 0) resolve(active.sort((a, b) => a - b)); }
    }
  });
}
function scanPortsViaNetstatDetailed() {
  return new Promise((resolve) => {
    const { exec } = require("child_process");
    const cmd = process.platform === "win32" ? "netstat -ano | findstr LISTENING" : "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || ss -tln 2>/dev/null || echo ''";
    exec(cmd, { timeout: 2500 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const map = new Map(); // port -> pid
      const lines = stdout.split("\n");
      for (const line of lines) {
        // Windows: TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234
        // Linux: LISTEN 0 128 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=1234,fd=3))
        let m = line.match(/:(\d+)\s+.*\s+(\d+)\s*$/);
        if (m) {
          const port = parseInt(m[1], 10);
          const pid = parseInt(m[2], 10);
          if (port >= 1024 && port <= 65535 && pid) {
            if (!map.has(port) || !map.get(port).pid) map.set(port, { port, pid });
          }
          continue;
        }
        m = line.match(/:(\d+)\b/);
        if (m) {
          const port = parseInt(m[1], 10);
          if (port >= 1024 && port <= 65535 && !map.has(port)) {
            map.set(port, { port, pid: null });
          }
        }
      }
      resolve([...map.values()]);
    });
  });
}
function execAsync(cmd, timeout = 1800) {
  return new Promise((resolve) => {
    const { exec } = require("child_process");
    exec(cmd, { timeout, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve("");
      resolve(String(stdout));
    });
  });
}
async function getProcessName(pid) {
  if (!pid) return "";
  try {
    if (process.platform === "win32") {
      const out = await execAsync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV 2>nul`, 1200);
      const m = out.match(/"([^"]+)"\s*,\s*"${pid}"/) || out.match(/"([^"]+)","${pid}"/);
      if (m) return m[1];
      const parts = out.split(",");
      if (parts[0]) return parts[0].replace(/"/g, "").trim();
    } else {
      const out = await execAsync(`ps -p ${pid} -o comm= 2>/dev/null || ps -o comm= -p ${pid} 2>/dev/null`, 1200);
      return out.trim().split("\n")[0].trim();
    }
  } catch {}
  return "";
}
async function getProcessCmdline(pid) {
  if (!pid) return "";
  try {
    if (process.platform === "win32") {
      let out = await execAsync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine" 2>nul`, 1200);
      if (out && out.trim()) return out.trim();
      const out2 = await execAsync(`wmic process where ProcessId=${pid} get CommandLine /value 2>nul`, 1200);
      const m = out2.match(/CommandLine=(.*)/);
      if (m) return m[1].trim();
      // Fallback to parent's cmdline (e.g., npm -> node)
      try {
        const parentOut = await execAsync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId" 2>nul`, 800);
        const ppid = parseInt((parentOut || "").trim(), 10);
        if (ppid) {
          const pOut = await execAsync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${ppid}').CommandLine" 2>nul`, 800);
          if (pOut && pOut.trim()) return pOut.trim();
        }
      } catch {}
    } else {
      const out = await execAsync(`ps -p ${pid} -o args= 2>/dev/null || cat /proc/${pid}/cmdline 2>/dev/null | tr '\\0' ' '`, 1200);
      if (out && out.trim()) return out.trim();
      // Try parent
      try {
        const ppidOut = await execAsync(`ps -o ppid= -p ${pid} 2>/dev/null`, 800);
        const ppid = parseInt(ppidOut.trim(), 10);
        if (ppid) {
          const pOut = await execAsync(`ps -p ${ppid} -o args= 2>/dev/null`, 800);
          if (pOut && pOut.trim()) return pOut.trim();
        }
      } catch {}
    }
  } catch {}
  return "";
}
async function getProcessCwd(pid) {
  if (!pid) return "";
  try {
    if (process.platform !== "win32") {
      const out = await execAsync(`readlink /proc/${pid}/cwd 2>/dev/null || pwdx ${pid} 2>/dev/null | cut -d: -f2`, 1000);
      if (out && out.trim()) return out.trim();
      const out2 = await execAsync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-`, 1000);
      if (out2 && out2.trim()) return out2.trim();
    } else {
      // Windows: executable path's dir is best we can get without handle.exe
      const out = await execAsync(`powershell -NoProfile -Command "try{(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ExecutablePath}catch{}" 2>nul`, 1000);
      const exe = out.trim();
      if (exe) return require("path").dirname(exe);
    }
  } catch {}
  return "";
}
async function scanPortsDetailed() {
  if (scanPortsInProgress) return scanPortsInProgress;
  scanPortsInProgress = (async () => {
  const [detailed, viaConnect] = await Promise.all([
    scanPortsViaNetstatDetailed().catch(() => []),
    scanPortsViaConnect(COMMON_PORTS).catch(() => []),
  ]);
  const map = new Map();
  for (const d of detailed) {
    if (!map.has(d.port)) map.set(d.port, d);
  }
  for (const p of viaConnect) {
    if (!map.has(p)) map.set(p, { port: p, pid: null });
  }
  // Enrich with process names/cwd/cmdline (limit to avoid slow/blocking)
  const entries = [...map.values()].sort((a, b) => a.port - b.port).slice(0, 30);
  const enrichCount = Math.min(entries.length, 10);
  for (let i = 0; i < enrichCount; i++) {
    const e = entries[i];
    if (e.pid) {
      try { e.name = await getProcessName(e.pid); } catch { e.name = ""; }
      try { e.cwd = await getProcessCwd(e.pid); } catch { e.cwd = ""; }
      try { e.cmdline = await getProcessCmdline(e.pid); } catch { e.cmdline = ""; }
      // Small yield to avoid blocking
      await new Promise((r) => setImmediate(r));
    } else {
      e.name = "";
      e.cwd = "";
      e.cmdline = "";
    }
  }
  for (let i = enrichCount; i < entries.length; i++) {
    entries[i].name = "";
    entries[i].cwd = "";
    entries[i].cmdline = "";
  }
  // Filter to web range if too many, but keep all if under 30
  const web = entries.filter((e) => (e.port >= 3000 && e.port <= 9999) || [80, 443].includes(e.port));
  return web.length ? web : entries;
  })();
  try { return await scanPortsInProgress; } finally { scanPortsInProgress = null; }
}
async function scanPorts() {
  const detailed = await scanPortsDetailed().catch(() => []);
  // Fallback to simple numbers if detailed fails
  if (detailed.length) return detailed;
  try {
    const viaConnect = await scanPortsViaConnect(COMMON_PORTS);
    return viaConnect.map((p) => ({ port: p, pid: null, name: "" }));
  } catch { return []; }
}

ipcMain.handle("port:scan", async () => {
  try { return await scanPorts(); } catch { return []; }
});
// Backward compat: old callers expect number[], but new returns objects — handle both
ipcMain.handle("port:scanDetailed", async () => {
  try { return await scanPortsDetailed(); } catch { return []; }
});

ipcMain.handle("port:kill", async (_e, port) => {
  const p = parseInt(port, 10);
  if (!p || p < 1 || p > 65535) return { ok: false, error: "Invalid port" };
  let pid = null;
  try {
    const detailed = await scanPortsDetailed().catch(() => []);
    const entry = detailed.find((e) => e.port === p);
    pid = entry?.pid || null;
  } catch {}
  if (!pid) {
    try {
      const { execSync } = require("child_process");
      if (process.platform === "win32") {
        const out = execSync(`netstat -ano | findstr :${p} | findstr LISTENING`, { encoding: "utf8", timeout: 2000 });
        const m = out.match(/\s+(\d+)\s*$/m);
        if (m) pid = parseInt(m[1], 10);
      } else {
        const out = execSync(`lsof -ti :${p} -sTCP:LISTEN 2>/dev/null | head -n 1`, { encoding: "utf8", timeout: 2000 });
        pid = parseInt(out.trim(), 10) || null;
      }
    } catch {}
  }
  if (!pid) return { ok: false, error: `No process found on port ${p}` };
  try {
    if (process.platform === "win32") {
      require("child_process").execSync(`taskkill /F /PID ${pid}`, { timeout: 4000, stdio: "ignore" });
    } else {
      try { process.kill(pid, "SIGTERM"); } catch {}
      await new Promise((r) => setTimeout(r, 900));
      try { process.kill(pid, 0); require("child_process").execSync(`kill -9 ${pid} 2>/dev/null`, { timeout: 2000, stdio: "ignore" }); } catch {}
    }
    return { ok: true, pid };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle("port:restart", async (_e, port) => {
  // Kill first
  const killRes = await (async () => {
    try {
      const p = parseInt(port, 10);
      const { execSync } = require("child_process");
      let pid = null;
      try {
        const detailed = await scanPortsDetailed().catch(() => []);
        const entry = detailed.find((e) => e.port === p);
        pid = entry?.pid || null;
      } catch {}
      if (!pid && process.platform === "win32") {
        try {
          const out = execSync(`netstat -ano | findstr :${p} | findstr LISTENING`, { encoding: "utf8", timeout: 2000 });
          const m = out.match(/\s+(\d+)\s*$/m);
          if (m) pid = parseInt(m[1], 10);
        } catch {}
      }
      if (!pid) return { ok: false, error: `No process on ${p}` };
      if (process.platform === "win32") execSync(`taskkill /F /PID ${pid}`, { timeout: 4000, stdio: "ignore" });
      else { try { process.kill(pid, "SIGTERM"); } catch {} }
      return { ok: true, pid };
    } catch (e) { return { ok: false, error: String(e) }; }
  })();
  // We don't auto-restart unknown command — just report killed, user can start again
  return killRes;
});

ipcMain.handle("panel:addMenu", async (event) => {
  const ports = await scanPorts();
  return new Promise((resolve) => {
    const act = (action) => resolve({ action });
    const items = [
      { label: "Browser", click: () => act("browser") },
      { label: "Terminal", click: () => act("terminal") },
    ];
    if (ports.length) {
      items.push({ type: "separator" });
      items.push({ label: "Running Ports", enabled: false });
      for (const p of ports) {
        const portNum = typeof p === "object" ? p.port : p;
        const labelPid = typeof p === "object" && p.pid ? ` (PID ${p.pid})` : "";
        items.push({ label: `  http://localhost:${portNum}${labelPid}`, click: () => act(`port:${portNum}`) });
      }
    }
    const menu = Menu.buildFromTemplate(items);
    const win = BrowserWindow.fromWebContents(event.sender);
    menu.popup({ window: win, callback: () => resolve(null) });
  });
});

ipcMain.handle("open:url", async (_e, url) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win && require("electron").shell) {
    require("electron").shell.openExternal(url);
    return true;
  }
  return false;
});

// ─── Native file drag ──────────────────────────────────────────────────────────
const dragIcon = nativeImage.createFromDataURL(
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAMlJREFUOE9jZBi4gBEDDxg/fvz4f/78+f+BGJQHU3MAiPkfKH6AiYH0AB8U/AfEDED8n5mB9ABGqHj8B+L/QMz7nxwXUJYF/xlI9wEzA+kBdFAA4gdENSHVBUxAg/8C8X8GBtIDiC4gxYVMFEQAy3+g4xmY6O8Coh2Ay4VMDAR4wZvk5QJqBAAjIwVcAAwW5v+BiQivCygNAHo4UCMAkIEB5QISTcCXCxguIDkEKB0AlAYA5VwAGn1UhwE12YDqAqTUC6gJAOq7gHQTMDXQ0gUA7VlTtGxCBnQAAAAASUVORK5CYII="
);

ipcMain.on("drag:startNative", (event, paths) => {
  try {
    if (paths?.length) {
      event.sender.startDrag({ files: paths, icon: dragIcon });
    }
  } catch (err) {
    console.error("startDrag failed:", err);
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sendToRenderer = (channel, payload) => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send(channel, payload);
};

// ─── Session restore ───────────────────────────────────────────────────────────
const SESSION_FILE = path.join(app.getPath("userData"), "session.json");

ipcMain.handle("session:save", (_e, data) => {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2)); return true; } catch { return false; }
});

ipcMain.handle("session:load", () => {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); } catch { return null; }
});

// ─── Chrome extensions ──────────────────────────────────────────────────────
// Native session.extensions API + electron-chrome-extensions for
// chrome.tabs/windows/action/storage/... support in the browser webviews.
const EXTENSIONS_FILE = path.join(app.getPath("userData"), "extensions.json");
let chromeExt = null;
const pendingCreateTabs = [];   // FIFO of { url, resolve } awaiting webview attach
let lastGuestWc = null;
let lastGuestWin = null;

// The package instance exposes the session via `.ctx.session`.
function chromeExtensionsApi() {
  if (!chromeExt) return null;
  const ses = chromeExt.ctx?.session || session.defaultSession;
  return ses.extensions || ses;
}

function loadChromeExtensions() {
  if (!chromeExt) return;
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(EXTENSIONS_FILE, "utf8")); } catch { entries = []; }
  for (const e of entries) {
    const p = typeof e === "string" ? e : e?.path;
    if (!p || e?.enabled === false) continue;
    try { chromeExtensionsApi().loadExtension(p); } catch (err) { console.error("loadExtension failed:", p, err); }
  }
}

function readChromeExtensionEntries() {
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(EXTENSIONS_FILE, "utf8")); } catch { entries = []; }
  return entries;
}

function saveChromeExtensionEntry(entry) {
  let entries = readChromeExtensionEntries();
  const i = entries.findIndex((e) => (typeof e === "string" ? e === entry.path : e.path === entry.path));
  if (i >= 0) entries[i] = entry;
  else entries.push(entry);
  try { fs.writeFileSync(EXTENSIONS_FILE, JSON.stringify(entries, null, 2)); } catch {}
}

ipcMain.handle("chrome:loadExtension", async () => {
  const r = await dialog.showOpenDialog({
    title: "Load unpacked Chrome extension", properties: ["openDirectory"],
  });
  if (r.canceled || !r.filePaths.length || !chromeExt) return { ok: false };
  try {
    const ext = await chromeExtensionsApi().loadExtension(r.filePaths[0]);
    saveChromeExtensionEntry({ path: r.filePaths[0], id: ext.id, enabled: true });
    return { ok: true, id: ext.id, name: ext.name };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("chrome:listExtensions", () => {
  if (!chromeExt) return [];
  const out = [];
  try {
    const all = chromeExtensionsApi().getAllExtensions() || [];
    const entries = readChromeExtensionEntries();
    for (const ext of all) {
      const entry = entries.find((e) => typeof e === "object" && e.id === ext.id);
      out.push({
        id: ext.id,
        name: ext.name,
        version: ext.version,
        description: ext.manifest?.description || "",
        path: entry?.path || ext.path || "",
        enabled: entry ? entry.enabled !== false : true,
      });
    }
  } catch {}
  return out;
});

ipcMain.handle("chrome:setExtensionEnabled", async (_e, id, enabled) => {
  if (!chromeExt) return { ok: false };
  const entries = readChromeExtensionEntries();
  const entry = entries.find((e) => typeof e === "object" && e.id === id);
  if (!entry) return { ok: false, error: "Not found" };
  try {
    if (enabled) {
      const ext = await chromeExtensionsApi().loadExtension(entry.path);
      entry.id = ext.id;
    } else {
      chromeExtensionsApi().removeExtension(id);
    }
    entry.enabled = !!enabled;
    saveChromeExtensionEntry(entry);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("chrome:removeExtension", (_e, id) => {
  if (!chromeExt) return { ok: false };
  try { chromeExtensionsApi().removeExtension(id); } catch {}
  const entries = readChromeExtensionEntries().filter((e) => typeof e !== "object" || e.id !== id);
  try { fs.writeFileSync(EXTENSIONS_FILE, JSON.stringify(entries, null, 2)); } catch {}
  return { ok: true };
});

// ─── Settings window ──────────────────────────────────────────────────────────
let settingsWin = null;
function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 780, height: 520, minWidth: 600, minHeight: 400,
    title: "Settings", backgroundColor: "#1a1a1a",
    icon: path.join(__dirname, "../renderer/assets/idot_box.png"),
    parent: BrowserWindow.getAllWindows()[0], modal: false, show: false,
    webPreferences: { preload: path.join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, "../renderer/settings.html"));
  settingsWin.once("ready-to-show", () => settingsWin.show());
  settingsWin.on("closed", () => { settingsWin = null; });
}

ipcMain.handle("settings:openWindow", () => openSettingsWindow());

// ─── App menu ─────────────────────────────────────────────────────────────────
let autoSaveEnabled = false;
const RECENT_FILE = path.join(app.getPath("userData"), "recent-projects.json");
let recentProjects = [];
const MAX_RECENT = 10;

function loadRecentProjects() {
  try {
    const arr = JSON.parse(fs.readFileSync(RECENT_FILE, "utf8"));
    if (Array.isArray(arr)) recentProjects = arr.filter((p) => typeof p === "string").slice(0, MAX_RECENT);
  } catch {}
}
function saveRecentProjects() {
  try { fs.writeFileSync(RECENT_FILE, JSON.stringify(recentProjects, null, 2)); } catch {}
}
// load at startup
try { loadRecentProjects(); } catch {}

function addRecentProject(projectPath) {
  if (!projectPath) return;
  const idx = recentProjects.indexOf(projectPath);
  if (idx >= 0) recentProjects.splice(idx, 1);
  recentProjects.unshift(projectPath);
  if (recentProjects.length > MAX_RECENT) recentProjects.pop();
  saveRecentProjects();
  try { Menu.setApplicationMenu(buildMenu()); } catch {}
}
function clearRecentProjects() {
  recentProjects = [];
  saveRecentProjects();
  try { Menu.setApplicationMenu(buildMenu()); } catch {}
}

function buildMenu() {
  const template = [
    {
      label: "File", submenu: [
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: async () => { const r = await dialog.showOpenDialog({ title: "Open Project", properties: ["openDirectory"] }); if (!r.canceled && r.filePaths.length) { lastProjectPath = r.filePaths[0]; addRecentProject(r.filePaths[0]); sendToRenderer("menu:openProject", r.filePaths[0]); } } },
        { label: "Open File…", accelerator: "CmdOrCtrl+Shift+O", click: async () => { const r = await dialog.showOpenDialog({ title: "Open File", properties: ["openFile"] }); if (!r.canceled && r.filePaths.length) { const fp = r.filePaths[0]; const lastWin = BrowserWindow.getAllWindows()[0]; if (lastWin) lastWin.webContents.send("editor:openFile", { filePath: fp }); } } },
        { label: "New Project…",  accelerator: "CmdOrCtrl+N", click: async () => { const r = await dialog.showOpenDialog({ title: "Select folder for new project", properties: ["openDirectory","createDirectory"] }); if (!r.canceled && r.filePaths.length) { lastProjectPath = r.filePaths[0]; addRecentProject(r.filePaths[0]); sendToRenderer("menu:newProject", r.filePaths[0]); } } },
        { type: "separator" },
        {
          label: "Open Recent", submenu: recentProjects.length
            ? [
                ...recentProjects.map((p, i) => ({ label: `${i + 1}. ${path.basename(p)}  —  ${p}`, click: () => { lastProjectPath = p; addRecentProject(p); sendToRenderer("menu:openProject", p); } })),
                { type: "separator" },
                { label: "Clear Recently Opened", click: () => clearRecentProjects() },
              ]
            : [{ label: "No recent projects", enabled: false }],
        },
        { type: "separator" },
        { label: "Save",            accelerator: "CmdOrCtrl+S",          click: () => sendToRenderer("menu:saveFile", null) },
        { label: "Save As…",         accelerator: "CmdOrCtrl+Shift+S",    click: () => sendToRenderer("menu:saveFileAs", null) },
        { label: "Save All",        accelerator: "CmdOrCtrl+K S",        click: () => sendToRenderer("menu:saveFile", null) },
        { label: "Auto Save", type: "checkbox", checked: autoSaveEnabled, click: (item) => { autoSaveEnabled = item.checked; sendToRenderer("menu:toggleAutoSave", item.checked); } },
        { type: "separator" },
        { label: "Close Editor",    accelerator: "CmdOrCtrl+W", click: () => sendToRenderer("menu:closeProject", null) },
        { label: "Close Project", click: () => { lastProjectPath = null; sendToRenderer("menu:closeProject", null); } },
        { type: "separator" },
        { label: "New Window", accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow() },
        { type: "separator" },
        { label: "Exit",        accelerator: process.platform === "win32" ? "Alt+F4" : "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "Edit", submenu: [
        { label: "Undo",  accelerator: "CmdOrCtrl+Z", click: () => sendToRenderer("menu:undo", null) },
        { label: "Redo",  accelerator: "CmdOrCtrl+Y", click: () => sendToRenderer("menu:redo", null) },
        { label: "Redo (Alt)",  accelerator: "CmdOrCtrl+Shift+Z", click: () => sendToRenderer("menu:redo", null) },
        { type: "separator" },
        { label: "Cut",   accelerator: "CmdOrCtrl+X", click: () => sendToRenderer("menu:cut", null) },
        { label: "Copy",  accelerator: "CmdOrCtrl+C", click: () => sendToRenderer("menu:copy", null) },
        { label: "Paste", accelerator: "CmdOrCtrl+V", click: () => sendToRenderer("menu:paste", null) },
        { type: "separator" },
        { label: "Select All", accelerator: "CmdOrCtrl+A", click: () => sendToRenderer("menu:selectAll", null) },
        { type: "separator" },
        { label: "Find",      accelerator: "CmdOrCtrl+F", click: () => sendToRenderer("menu:find", null) },
        { label: "Find Next", accelerator: "F3", click: () => sendToRenderer("menu:findNext", null) },
        { label: "Find Previous", accelerator: "Shift+F3", click: () => sendToRenderer("menu:findPrevious", null) },
        { label: "Replace",   accelerator: "CmdOrCtrl+H", click: () => sendToRenderer("menu:replace", null) },
      ],
    },
    {
      label: "View", submenu: [
        { label: "Command Palette…", accelerator: "CmdOrCtrl+Shift+P", click: () => sendToRenderer("menu:commandPalette", null) },
        { label: "Quick Open…", accelerator: "CmdOrCtrl+P", click: () => sendToRenderer("menu:commandPalette", null) },
        { type: "separator" },
        { label: "Toggle Full Screen", accelerator: "F11", click: () => sendToRenderer("menu:fullscreen", null) },
        { type: "separator" },
        { label: "Reset Layout", accelerator: "CmdOrCtrl+Alt+R", click: () => sendToRenderer("menu:resetLayout", null) },
        { type: "separator" },
        { label: "Toggle Developer Tools", accelerator: process.platform === "darwin" ? "Alt+Cmd+I" : "Ctrl+Shift+I", click: () => { const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; if (win) win.webContents.toggleDevTools(); } },
      ],
    },
    {
      label: "Git", submenu: [
        { label: "Refresh Status", accelerator: "CmdOrCtrl+Shift+G", click: () => sendToRenderer("git:refresh", null) },
        { type: "separator" },
        { label: "Commit…", accelerator: "CmdOrCtrl+Enter", click: () => sendToRenderer("git:commit", null) },
        { label: "Commit All & Push", click: () => sendToRenderer("git:commit", null) },
        { type: "separator" },
        { label: "Pull", click: () => sendToRenderer("git:pull", null) },
        { label: "Push", click: () => sendToRenderer("git:push", null) },
        { label: "Fetch", click: () => sendToRenderer("git:fetch", null) },
        { type: "separator" },
        { label: "View Diff (All)", click: () => sendToRenderer("git:diffAll", null) },
        { label: "Show Log", click: () => sendToRenderer("git:log", null) },
      ],
    },
    {
      label: "Terminal", submenu: [
        { label: "New Terminal", accelerator: "Ctrl+`", click: () => sendToRenderer("menu:newTerminal", null) },
        { label: "Split Terminal Right", accelerator: "Ctrl+Shift+5", click: () => sendToRenderer("menu:splitTerminalRight", null) },
        { label: "Split Terminal Down", accelerator: "Ctrl+Shift+\\", click: () => sendToRenderer("menu:splitTerminalDown", null) },
        { type: "separator" },
        { label: "Clear Terminal", accelerator: "Ctrl+K", click: () => sendToRenderer("menu:clearTerminal", null) },
        { label: "Kill Terminal", click: () => sendToRenderer("menu:killTerminal", null) },
      ],
    },
    { label: "Settings", accelerator: "CmdOrCtrl+,", click: openSettingsWindow },
    {
      label: "Window", submenu: [
        { label: "Minimize", accelerator: "CmdOrCtrl+M", role: "minimize" },
        { label: "Zoom", role: "zoom" },
        { type: "separator" },
        { label: "Reset Window Layout", click: () => sendToRenderer("menu:resetLayout", null) },
        { type: "separator" },
        { label: "Close Window", accelerator: "CmdOrCtrl+Shift+W", role: "close" },
      ],
    },
    {
      label: "Help", submenu: [
        { label: "About Idiot Box", click: () => { const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; if (win) dialog.showMessageBox(win, { type: "info", title: "About Idiot Box", message: "Idiot Box v0.1.0", detail: "A VS Code-like editor built with Electron, React, and Monaco.\n\n© 2026 Idiot Box" }); } },
        { type: "separator" },
        { label: "Keyboard Shortcuts", accelerator: "CmdOrCtrl+K CmdOrCtrl+S", click: () => sendToRenderer("menu:commandPalette", null) },
        { label: "Toggle Developer Tools", click: () => { const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; if (win) win.webContents.toggleDevTools(); } },
        { type: "separator" },
        { label: "Report Issue", click: () => shell.openExternal("https://github.com/anomalyco/opencode/issues") },
        { label: "View on GitHub", click: () => shell.openExternal("https://github.com/anomalyco/opencode") },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ─── Main window ──────────────────────────────────────────────────────────────
function createWindow() {
  let winState = { width: 1280, height: 720 };
  let wasMaximized = false;
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    if (s.window) {
      const w = parseInt(s.window.width, 10);
      const h = parseInt(s.window.height, 10);
      const x = s.window.x != null ? parseInt(s.window.x, 10) : undefined;
      const y = s.window.y != null ? parseInt(s.window.y, 10) : undefined;
      winState = {
        width: Number.isFinite(w) && w >= 800 ? Math.min(w, 3000) : 1280,
        height: Number.isFinite(h) && h >= 600 ? Math.min(h, 2000) : 720,
        ...(Number.isFinite(x) ? { x } : {}),
        ...(Number.isFinite(y) ? { y } : {}),
      };
      wasMaximized = !!s.window.maximized;
    }
  } catch {}

  const win = new BrowserWindow({
    ...winState,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0d0d0d",
    icon: path.join(__dirname, "../renderer/assets/idot_box.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload-bundle.cjs"),
      contextIsolation: true, nodeIntegration: false, webviewTag: true,
    },
  });

  // Ensure window is not off-screen after display config change
  try {
    const { screen } = require("electron");
    const bounds = win.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const inArea = bounds.x >= area.x - 100 && bounds.x <= area.x + area.width - 100 &&
                   bounds.y >= area.y - 100 && bounds.y <= area.y + area.height - 100;
    if (!inArea) win.center();
  } catch {}

  win.webContents.setBackgroundThrottling(false);

  // ── Navigation isolation guard: main window must never navigate away from IDE ──
  // All http/https/localhost/redirects/window.location/target="_blank" stay in their own view.
  const safeForward = (url) => {
    if (!url) return;
    try {
      const js = `window.dispatchEvent(new CustomEvent("add-browser-panel", {detail:{url: ${JSON.stringify(url)} }}))`;
      win.webContents.executeJavaScript(js).catch(()=>{});
    } catch {}
    try { win.webContents.send("add-browser-panel", { url }); } catch {}
  };
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file://")) {
      event.preventDefault();
      if (/^(https?:|ppoo-file:|view-source:)/i.test(url) || url.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(url) || /^[^\s]+\.[^\s]+/.test(url)) {
        safeForward(url);
      } else {
        safeForward(url);
      }
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && !url.startsWith("file://") && !url.startsWith("about:blank")) {
      safeForward(url);
    }
    return { action: "deny" };
  });

  // ── Fix Ctrl+W: only close project, never close window/app ───
  const handleCtrlW = (event, input) => {
    if ((input.control || input.meta) && String(input.key || "").toLowerCase() === "w" && input.type === "keyDown" && !input.shift && !input.alt) {
      try { event.preventDefault(); } catch {}
      lastProjectPath = null;
      sendToRenderer("menu:closeProject", null);
    }
  };
  win.webContents.on("before-input-event", handleCtrlW);

  // Register every browser webview as a chrome.tabs tab
  win.webContents.on("did-attach-webview", (_e, wc) => {
    lastGuestWc = wc; lastGuestWin = win;
    try { chromeExt?.addTab(wc, win); } catch {}
    wc.on("did-navigate", () => { try { chromeExt?.selectTab(wc); } catch {} });
    wc.on("focus",       () => { try { chromeExt?.selectTab(wc); } catch {} });
    try { wc.on("before-input-event", handleCtrlW); } catch {}
    const pending = pendingCreateTabs.shift();
    if (pending) pending.resolve([wc, win]);
  });

  // Lightweight console forwarding — only log warnings/errors to main console
  win.webContents.on("console-message", (...args) => {
    let level, message, line, sourceId;
    if (args.length === 2 && args[1] && typeof args[1] === "object") {
      ({ level, message, lineNumber: line, sourceId } = args[1]);
    } else {
      [, level, message, line, sourceId] = args;
    }
    if (level >= 2) {
      console.warn(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    }
  });

  // Load first, show when ready — prevents white flash and ensures correct restore bounds
  win.loadFile(path.join(__dirname, "../renderer/index.html"));

  win.once("ready-to-show", () => {
    try {
      if (wasMaximized) win.maximize();
    } catch {}
    if (!win.isDestroyed()) win.show();
    // Workaround for Windows restore-down flicker — force a layout pass after show
    setTimeout(() => {
      try {
        if (!win.isDestroyed()) win.webContents.invalidate();
      } catch {}
    }, 100);
  });

  // Gracefully handle maximize / unmaximize / restore without crashing layout
  const safeInvalidate = () => {
    try {
      if (!win.isDestroyed()) win.webContents.invalidate();
      // Notify renderer to re-flow flexlayout after window state change
      win.webContents.send("window:stateChanged", { maximized: win.isMaximized() });
    } catch {}
  };
  win.on("maximize", safeInvalidate);
  win.on("unmaximize", safeInvalidate);
  win.on("restore", safeInvalidate);
  win.on("resize", () => {
    // Debounced invalidate to avoid flood during drag-resize
    clearTimeout(win._resizeTimer);
    win._resizeTimer = setTimeout(safeInvalidate, 120);
  });

  // Save session on close — use normal bounds when maximized so restore-down is correct size
  win.on("close", async () => {
    try {
      let bounds;
      let maximized = false;
      try { maximized = win.isMaximized(); } catch {}
      try {
        if (maximized && typeof win.getNormalBounds === "function") {
          bounds = win.getNormalBounds();
        } else {
          bounds = win.getBounds();
        }
      } catch {
        bounds = win.getBounds();
      }
      let layout = null;
      try { layout = await win.webContents.executeJavaScript("window.__getLayoutJSON()"); } catch {}
      // Sanitize bounds — never save 0 or fullscreen-sized normal bounds that would make restore-down cover screen
      const sane = {
        width: Math.max(900, Math.min(bounds.width || 1280, 3000)),
        height: Math.max(600, Math.min(bounds.height || 720, 2000)),
        x: bounds.x,
        y: bounds.y,
        maximized,
      };
      const data = { window: sane, layout };
      fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
    } catch {}
  });
}

app.whenReady().then(async () => {
  if (ElectronChromeExtensions) {
    try { ElectronChromeExtensions.handleCRXProtocol(session.defaultSession); } catch (e) { console.warn("[electron-chrome-extensions] handleCRXProtocol failed:", e.message); }
  }
  if (ElectronChromeExtensions) {
  chromeExt = new ElectronChromeExtensions({
    license: "GPL-3.0",
    session: session.defaultSession,
    async createTab(details) {
      const url = details.url || "about:blank";
      const result = await new Promise((resolve) => {
        pendingCreateTabs.push({ url, resolve });
        sendToRenderer("chrome:createTab", url);
        setTimeout(() => resolve([lastGuestWc, lastGuestWin]), 4000);
      });
      return result;
    },
  });

  // Keep browser-action popup windows inside the app window so they don't
  // overlap the window's edges or the webview's right-side scrollbar, and
  // hold them hidden until the content size settles so they don't visibly
  // flicker/grow while loading.
  chromeExt.on("browser-action-popup-created", (popup) => {
    const pwin = popup?.browserWindow;
    const parent = popup?.parent;
    if (!pwin || !parent) return;

    let settleTimer = null;
    let settleShown = false;
    let suppressShow = true;
    let contentLoaded = false;

    const clamp = () => {
      try {
        if (pwin.isDestroyed() || parent.isDestroyed()) return;
        const pb = parent.getContentBounds();
        const wb = pwin.getBounds();
        const x = Math.max(pb.x, Math.min(wb.x, pb.x + pb.width - wb.width));
        const y = Math.max(pb.y, Math.min(wb.y, pb.y + pb.height - wb.height));
        if (x !== wb.x || y !== wb.y) pwin.setBounds({ ...wb, x, y });
      } catch {}
    };

    const showSettled = () => {
      if (settleShown || pwin.isDestroyed() || parent.isDestroyed()) return;
      settleShown = true;
      suppressShow = false;
      clamp();
      pwin.show();
    };

    const kickSettle = () => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(showSettled, 120);
    };

    const onLayoutChange = () => { clamp(); kickSettle(); };

    // Hide the initial premature show (library shows on first preferred-size-changed)
    pwin.on("show", () => {
      if (suppressShow) { try { pwin.hide(); } catch {} }
      if (!settleShown) kickSettle();
    });

    // Wait for content to fully load, then wait for size to stabilize
    pwin.webContents.on("did-finish-load", () => {
      contentLoaded = true;
      if (!settleShown) kickSettle();
    });

    // Also track resize/move for any post-load adjustments
    pwin.on("resize", onLayoutChange);
    pwin.on("move", onLayoutChange);
    if (typeof popup.on === "function") {
      popup.on("resized", onLayoutChange);
      popup.on("moved", onLayoutChange);
    }

    // Safety net: show anyway after 1s
    setTimeout(showSettled, 1000);
  });
  } // end if (ElectronChromeExtensions)

  loadChromeExtensions();
  const PP_FILE_MIME = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".json": "application/json",
    ".html": "text/html",
    ".css": "text/css",
    ".map": "application/json",
    ".wasm": "application/wasm",
    ".txt": "text/plain",
    ".md": "text/plain",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
  };
  protocol.handle("ppoo-file", async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]):/, (_m, d) => d.toUpperCase() + ":"));
      const res = await electronNet.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(res.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Content-Type", PP_FILE_MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream");
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  getShell();
  Menu.setApplicationMenu(buildMenu());
  createWindow();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
