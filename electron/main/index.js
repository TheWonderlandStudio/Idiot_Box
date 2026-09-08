// Main process entry point
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage, clipboard, protocol, net: electronNet, session } = require("electron");
const path    = require("path");
const fs      = require("fs");
const { pathToFileURL } = require("url");
const { spawn, execFile } = require("child_process");
let chokidar = null;
try { chokidar = require("chokidar"); } catch (e) { console.warn("[main] chokidar not available:", e.message); }
let pty = null;
try { pty = require("node-pty"); } catch (e) { console.warn("[main] node-pty not available:", e.message); }
// ─── esbuild binary path in packaged app (asar ENOENT fix) ─────────────────
// esbuild resolves its service binary via __dirname → app.asar/node_modules/…
// but child_process.spawn bypasses Electron's asar shim, so the spawn fails
// with "The service was stopped: spawn …app.asar…esbuild.exe ENOENT" even
// though the binary IS unpacked (asarUnpack) at app.asar.unpacked/….
// Fix: point esbuild at the unpacked exe via ESBUILD_BINARY_PATH (honored by
// esbuild's lib/main.js). Must run BEFORE require("esbuild") reads the env.
try {
  if (!process.env.ESBUILD_BINARY_PATH) {
    let resourcesPath = null;
    try { resourcesPath = process.resourcesPath || null; } catch {}
    if (!resourcesPath) {
      try { if (app.isPackaged) resourcesPath = path.join(path.dirname(app.getPath("exe")), "resources"); } catch {}
    }
    if (resourcesPath) {
      const exeName = process.platform === "win32" ? "esbuild.exe" : "esbuild";
      const plat = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
      const arch = process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "ia32" : "x64";
      const unpackedExe = path.join(resourcesPath, "app.asar.unpacked", "node_modules", "@esbuild", `${plat}-${arch}`, exeName);
      try {
        if (fs.existsSync(unpackedExe)) {
          process.env.ESBUILD_BINARY_PATH = unpackedExe;
        }
      } catch {}
    }
  }
} catch {}
let esbuild = null;
try { esbuild = require("esbuild"); } catch (e) { console.warn("[main] esbuild not available:", e.message); }
let ElectronChromeExtensions = null;
try { ({ ElectronChromeExtensions } = require("electron-chrome-extensions")); } catch (e) { console.warn("[main] electron-chrome-extensions not available:", e.message); }
let autoUpdater = null;
try { ({ autoUpdater } = require("electron-updater")); } catch (e) { console.warn("[main] electron-updater not available:", e.message); }
let aiService = null;
try { aiService = require("./ai-service"); } catch (e) { console.warn("[main] ai-service not available:", e.message); }
let androidManager = null;
try { androidManager = require("./android"); } catch (e) { console.warn("[main] android manager not available:", e.message); }

// ─── Guard stdio EPIPE — prevent crash when parent closes pipes ──────────────
// When stdout/stderr is a pipe whose reader has gone away, writes throw EPIPE
// and must not crash the service. This is especially important for the
// packaged Electron main process.
try {
  process.stdout.on("error", (err) => {
    if (err && err.code === "EPIPE") return;
    try { console.error("[stdout error]", err); } catch {}
  });
  process.stderr.on("error", (err) => {
    if (err && err.code === "EPIPE") return;
    try { console.error("[stderr error]", err); } catch {}
  });
} catch {}

// ─── Global error handlers — prevent crash on missing optional deps ──────────
process.on("uncaughtException", (err) => {
  // Broken pipe from a closed stdio, socket, or pty is not fatal — swallow
  // to keep the app alive (service's log consumer may legitimately disappear)
  if (err && (err.code === "EPIPE" || String(err?.message || "").includes("EPIPE") || String(err).includes("write EPIPE") || String(err).includes("The service is no longer running"))) {
    try { console.error("[uncaughtException:EPIPE suppressed]", err?.message || err); } catch {}
    return;
  }
  try { console.error("[uncaughtException]", err); } catch {}
  try {
    dialog.showErrorBox("Idiot Box — Error", String(err?.message || err));
  } catch {}
});
process.on("unhandledRejection", (reason) => {
  const msg = String(reason?.message || reason || "");
  if (reason && (reason.code === "EPIPE" || msg.includes("EPIPE") || msg.includes("The service is no longer running") || msg.includes("The service was stopped"))) {
    try { console.error("[unhandledRejection:EPIPE suppressed]", msg); } catch {}
    return;
  }
  try { console.error("[unhandledRejection]", reason); } catch {}
});

// ─── Custom scheme: extension-host file access ───────────────────────────────
// The web-worker extension host runs in a sandboxed worker that cannot
// fetch(file://...) — serve extension files through this privileged scheme
// so workers can fetch() them like regular http resources.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "ibx-file",
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
const nextBundle = () => {
  while (bundleQueue.length && bundleActive < BUNDLE_CONCURRENCY) {
    const task = bundleQueue.shift();
    bundleActive++;
    (async () => {
      try { task.resolve(await task.fn()); } catch (err) { task.reject(err); }
      finally {
        bundleActive--;
        nextBundle();
      }
    })();
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
    const isEpipe = (err) => {
      const m = String(err?.message || err || "");
      return m.includes("EPIPE") || m.includes("The service is no longer running") || m.includes("The service was stopped") || m.includes("write EPIPE");
    };
    const isEnoent = (err) => {
      const m = String(err?.message || err || "");
      return err?.code === "ENOENT" || err?.errno === -4058 || m.includes("ENOENT") || (m.includes("spawn") && m.includes("esbuild"));
    };
    const buildWithRecovery = async (useAlias) => {
      try {
        return await tryBuild(useAlias);
      } catch (err) {
        if (isEnoent(err)) throw err; // binary missing — retry is pointless
        if (isEpipe(err)) {
          // esbuild service died (antivirus, closed pipe, OOM). Restart service and retry once.
          try { if (esbuild && typeof esbuild.stop === "function") esbuild.stop(); } catch {}
          try { await new Promise((r) => setTimeout(r, 200)); } catch {}
          // one retry
          return await tryBuild(useAlias);
        }
        throw err;
      }
    };
    try {
      let result;
      try {
        result = await buildWithRecovery(true);
      } catch (aliasErr) {
        if (isEpipe(aliasErr)) {
          // Already retried inside buildWithRecovery; surface friendly message
          throw aliasErr;
        }
        // retry without alias - alias often fails if src not found
        const msg = aliasErr?.errors?.[0]?.text || aliasErr?.message || "";
        if (msg.includes("@") || msg.includes("src")) {
          result = await buildWithRecovery(false);
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
      if (isEnoent(err)) {
        hint = "\nHint: esbuild binary not found (ENOENT). In the installed app this means the update didn't unpack the binary — reinstall Idiot Box from the latest release. In dev, run `npm ci` to restore node_modules/@esbuild.";
      } else if (isEpipe(err)) {
        hint = "\nHint: esbuild service crashed (write EPIPE) — often caused by antivirus blocking the esbuild binary, a closed stdio pipe, or the service being killed. Try disabling antivirus temporarily, running `npm ci`, or restarting Idiot Box. The app has already retried once automatically.";
      } else if (detail.includes("Could not resolve")) hint = "\nHint: check import path / missing node_modules. Run `npm install` in project.";
      else if (detail.includes("Unexpected")) hint = "\nHint: JSX syntax error — check component file.";
      try { console.error("[component:bundle] failed:", detail); } catch {}
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

// ─── Safe rename (handles EXDEV cross-device) ────────────────────────────────
function safeRename(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code === "EXDEV") {
      const st = fs.statSync(src);
      if (st.isDirectory()) fs.cpSync(src, dest, { recursive: true });
      else fs.copyFileSync(src, dest);
      fs.rmSync(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

// ─── Project storage — app memory (userData) instead of polluting project ───
const crypto = require("crypto");
const getProjectStoreRoot = () => path.join(app.getPath("userData"), "projects");
function getProjectStoreDir(rootPath) {
  if (!rootPath) return null;
  try {
    const resolved = path.resolve(rootPath);
    const hash = crypto.createHash("md5").update(resolved).digest("hex").slice(0, 12);
    const safe = (path.basename(resolved) || "project").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 32) || "project";
    const dir = path.join(getProjectStoreRoot(), `${safe}-${hash}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // keep a human-readable index for debugging/manage UI
    try {
      const indexFile = path.join(getProjectStoreRoot(), "index.json");
      let idx = {};
      try { idx = JSON.parse(fs.readFileSync(indexFile, "utf8")); } catch {}
      if (idx[resolved] !== `${safe}-${hash}`) {
        idx[resolved] = `${safe}-${hash}`;
        // also store reverse: folder -> original path for manage UI
        idx[`_folder:${safe}-${hash}`] = resolved;
        fs.mkdirSync(getProjectStoreRoot(), { recursive: true });
        fs.writeFileSync(indexFile, JSON.stringify(idx, null, 2));
      }
    } catch {}
    return dir;
  } catch { return null; }
}

// Migrate legacy files from project folder to new store (one-time, keeps project clean)
function migrateLegacyFile(rootPath, legacyRel, storeFileName) {
  try {
    if (!rootPath || !legacyRel || !storeFileName) return;
    const legacy = path.join(rootPath, legacyRel);
    const storeDir = getProjectStoreDir(rootPath);
    if (!storeDir || !fs.existsSync(legacy)) return;
    const dest = path.join(storeDir, storeFileName);
    if (fs.existsSync(dest)) return; // already migrated
    const st = fs.statSync(legacy);
    if (st.isDirectory()) {
      fs.cpSync(legacy, dest, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(legacy, dest);
    }
    // remove legacy after successful copy — keep project clean
    try { fs.rmSync(legacy, { recursive: true, force: true }); } catch {}
  } catch {}
}
function migrateLegacyIfNeeded(rootPath) {
  if (!rootPath) return;
  migrateLegacyFile(rootPath, path.join(".project_config", "tabs.json"), "tabs.json");
  migrateLegacyFile(rootPath, path.join(".project_config", ".pinconfig"), "pinconfig.json");
  migrateLegacyFile(rootPath, path.join(".canvas", "layout.json"), "canvas-layout.json");
  // .trash is handled separately (large files) — migrate manifest + contents lazily on first trash access
  try {
    const legacyTrash = path.join(rootPath, ".trash");
    const storeTrash = path.join(getProjectStoreDir(rootPath), "trash");
    const legacyManifest = path.join(legacyTrash, "manifest.json");
    if (fs.existsSync(legacyTrash) && !fs.existsSync(storeTrash)) {
      // move entire .trash folder
      try { fs.cpSync(legacyTrash, storeTrash, { recursive: true }); } catch {}
      // keep manifest migration but don't delete immediately if large — try
      try { fs.rmSync(legacyTrash, { recursive: true, force: true }); } catch {}
    } else if (fs.existsSync(legacyManifest) && fs.existsSync(storeTrash)) {
      // merge manifests if both exist
      try {
        const legacyM = JSON.parse(fs.readFileSync(legacyManifest, "utf8"));
        const newMPath = path.join(storeTrash, "manifest.json");
        let newM = {};
        try { newM = JSON.parse(fs.readFileSync(newMPath, "utf8")); } catch {}
        let changed = false;
        for (const [k, v] of Object.entries(legacyM)) {
          if (!newM[k]) { newM[k] = v; changed = true; }
          const legacyItem = path.join(legacyTrash, k);
          const newItem = path.join(storeTrash, k);
          if (fs.existsSync(legacyItem) && !fs.existsSync(newItem)) {
            try {
              const s = fs.statSync(legacyItem);
              if (s.isDirectory()) fs.cpSync(legacyItem, newItem, { recursive: true });
              else fs.copyFileSync(legacyItem, newItem);
              changed = true;
            } catch {}
          }
        }
        if (changed) fs.writeFileSync(newMPath, JSON.stringify(newM, null, 2));
        try { fs.rmSync(legacyTrash, { recursive: true, force: true }); } catch {}
      } catch {}
    }
  } catch {}
}

// In-memory cache for project configs (app memory) — speeds up reads + survives until app quit
const memPinCache = new Map(); // rootPath -> data
const memTabsCache = new Map();
const memCanvasCache = new Map();

// ─── Settings ─────────────────────────────────────────────────────────────────
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const readSettings  = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; } };
const writeSettings = (d) => { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(d, null, 2)); return true; } catch { return false; } };
ipcMain.handle("settings:read",  () => readSettings());
ipcMain.handle("settings:write", (_e, data) => {
  const ok = writeSettings(data);
  if (ok) {
    // Broadcast to all windows — BroadcastChannel doesn't work across file:// origins in Electron,
    // so we use ipc to notify every renderer (editor, settings, etc.)
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send("settings:updated", data); } catch {}
    }
  }
  return ok;
});

// ─── AI panel — Vercel AI SDK streaming (https://ai-sdk.dev) ─────────────────
try {
  if (aiService && typeof aiService.setupAiIpc === "function") {
    aiService.setupAiIpc({ ipcMain, BrowserWindow, readSettings });
  }
} catch (e) { console.warn("[main] ai-service setup failed:", e.message); }

// ─── Android Emulator — SDK rooted at <userData>/.appdata/android ───────────
// All sdkmanager/avdmanager/emulator/adb spawns use absolute sdk paths (no PATH).
try {
  if (androidManager && typeof androidManager.setupAndroidIpc === "function") {
    androidManager.setupAndroidIpc();
  }
} catch (e) { console.warn("[main] android setup failed:", e.message); }

// ─── UI Zoom (View → UI Size — Ctrl + + / Ctrl + -) ──────────────────────────
// Whole-app zoom via Electron's webContents zoomFactor (0.25x to 3x).
// Persisted to settings.json as uiZoomFactor so it restores on next launch.
const ZOOM_MIN  = 0.25;
const ZOOM_MAX  = 3.0;
const ZOOM_STEP = 0.1;

function getUiZoomFactor() {
  try {
    const s = readSettings();
    const v = parseFloat(s.uiZoomFactor);
    if (Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX) return Math.round(v * 100) / 100;
  } catch {}
  return 1;
}
function saveUiZoomFactor(factor) {
  try {
    const s = readSettings();
    s.uiZoomFactor = Math.round(factor * 100) / 100;
    writeSettings(s);
  } catch {}
}
function getFocusedWin() {
  try { return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null; } catch { return null; }
}
let _lastZoomAt = 0;
function applyUiZoom(win, factor) {
  // win may be null when called from IPC without sender; fallback to first window
  const targetWins = win && !win.isDestroyed() ? [win] : BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed());
  // For global UI zoom, apply to all windows so Settings etc. stay in sync
  const allWins = BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed());
  const now = Date.now();
  // Debounce rapid duplicate triggers (Menu accelerator + renderer fallback for same keypress)
  if (now - _lastZoomAt < 90) return;
  _lastZoomAt = now;
  factor = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(factor * 100) / 100));
  for (const w of (allWins.length ? allWins : targetWins)) {
    try { w.webContents.setZoomFactor(factor); } catch {}
  }
  saveUiZoomFactor(factor);
  try { Menu.setApplicationMenu(buildMenu()); } catch {}
  for (const w of allWins) {
    try { w.webContents.send("zoom:changed", factor); } catch {}
  }
}
function zoomIn(win) {
  const w = win || getFocusedWin();
  if (!w) return;
  const cur = w.webContents.getZoomFactor();
  applyUiZoom(w, Math.min(ZOOM_MAX, +(cur + ZOOM_STEP).toFixed(2)));
}
function zoomOut(win) {
  const w = win || getFocusedWin();
  if (!w) return;
  const cur = w.webContents.getZoomFactor();
  applyUiZoom(w, Math.max(ZOOM_MIN, +(cur - ZOOM_STEP).toFixed(2)));
}
function zoomReset(win) {
  const w = win || getFocusedWin();
  if (!w) return;
  applyUiZoom(w, 1);
}

// IPC for renderer-initiated zoom (Ctrl+wheel, key fallback, status bar etc.)
ipcMain.handle("zoom:in",    (e) => { const w = BrowserWindow.fromWebContents(e.sender) || getFocusedWin(); zoomIn(w); return w ? w.webContents.getZoomFactor() : 1; });
ipcMain.handle("zoom:out",   (e) => { const w = BrowserWindow.fromWebContents(e.sender) || getFocusedWin(); zoomOut(w); return w ? w.webContents.getZoomFactor() : 1; });
ipcMain.handle("zoom:reset", (e) => { const w = BrowserWindow.fromWebContents(e.sender) || getFocusedWin(); zoomReset(w); return 1; });
ipcMain.handle("zoom:get",   (e) => { try { const w = BrowserWindow.fromWebContents(e.sender) || getFocusedWin(); return w ? w.webContents.getZoomFactor() : getUiZoomFactor(); } catch { return getUiZoomFactor(); } });
ipcMain.handle("zoom:set",   (e, factor) => { const w = BrowserWindow.fromWebContents(e.sender) || getFocusedWin(); if (w && Number.isFinite(factor)) applyUiZoom(w, factor); return w ? w.webContents.getZoomFactor() : getUiZoomFactor(); });

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
  try {
    // Windows editors are .cmd shims (code.cmd etc.) — spawn needs a shell to resolve them
    const child = spawn(editor.commands[0], [filePath], { detached: true, stdio: "ignore", shell: process.platform === "win32" });
    child.on("error", () => { shell.openPath(filePath).catch(() => {}); });
    child.unref();
  }
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

// ─── Live Edit (Browser edit-mode) — text-only, auto detection html/js/jsx/ts/tsx ─
const LIVE_EDIT_EXTS = new Set([".html", ".htm", ".js", ".jsx", ".ts", ".tsx"]);
const LIVE_EDIT_IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "out", "coverage", ".cache", ".parcel-cache", ".turbo", ".vscode", ".idea", ".output", ".trash", ".project_config", ".canvas", "trash"]);

function decodeIbxFileUrl(url) {
  try {
    if (!url || typeof url !== "string") return null;
    let p = url.trim();
    // ibx-file://file/C:/...  or ibx-file://file//C:/...
    if (p.startsWith("ibx-file://")) {
      p = p.replace(/^ibx-file:\/\/file\//, "").replace(/^ibx-file:\/\//, "");
      // remove leading slash for Windows drive
      if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
      // decode URI components and hash fragments
      p = decodeURI(p.replace(/#/g, "%23").split("?")[0].split("#")[0]);
      // ibx-file urls encode backslashes as / still
      p = p.replace(/\//g, path.sep);
      // on Windows, ensure drive letter
      if (process.platform === "win32" && /^[A-Za-z]:/.test(p)) p = p.replace(/\//g, "\\");
      return p;
    }
    if (p.startsWith("file://")) {
      try { return path.normalize(decodeURI(new URL(p).pathname).replace(/^\/([A-Za-z]:)/, "$1")); } catch { return null; }
    }
    return null;
  } catch { return null; }
}

function scoreLiveEditContext(content, pos, outerSnippet, tagName, oldText) {
  try {
    const ctxStart = Math.max(0, pos - 400);
    const ctxEnd = Math.min(content.length, pos + oldText.length + 400);
    const ctx = content.slice(ctxStart, ctxEnd);
    const ctxLow = ctx.toLowerCase();
    const snippetLow = String(outerSnippet || "").toLowerCase().slice(0, 800);
    let score = 0;
    // Exact snippet overlap (outerHTML)
    if (snippetLow && ctxLow.includes(snippetLow.slice(0, 80))) score += 100;
    else if (snippetLow) {
      // token overlap
      const tokens = snippetLow.split(/[^a-z0-9]+/).filter(t => t.length >= 3).slice(0, 20);
      let hits = 0;
      for (const tok of tokens) if (ctxLow.includes(tok)) hits++;
      score += hits * 6;
    }
    // tagName proximity
    if (tagName) {
      const tn = String(tagName).toLowerCase();
      if (ctxLow.includes("<" + tn)) score += 18;
      if (ctxLow.includes("</" + tn)) score += 10;
    }
    // Prefer occurrence where oldText is inside JSX/HTML tag content: check surrounding chars
    const before = content.slice(Math.max(0, pos - 4), pos);
    const after = content.slice(pos + oldText.length, pos + oldText.length + 4);
    if (before.includes(">") || before.includes('"') || before.includes("'") || before.includes("`") || before.includes("{")) score += 4;
    if (after.includes("<") || after.includes('"') || after.includes("'") || after.includes("`") || after.includes("}")) score += 4;
    // Prefer closer to snippet tag
    // Smaller distance? not needed
    return score;
  } catch { return 0; }
}

ipcMain.handle("liveEdit:applyTextChange", async (_e, { projectRoot, url, oldText, newText, outerSnippet, tagName } = {}) => {
  try {
    const o = String(oldText || "");
    const n = String(newText || "");
    if (!o || !o.trim()) return { ok: false, error: "Empty original text" };
    if (o === n) return { ok: false, error: "No change" };
    if (n.length > 5000) return { ok: false, error: "New text too long" };
    const oldTrim = o.trim();
    const newTrim = n.trim();
    // Try ibx-file direct path first
    const ibxPath = decodeIbxFileUrl(url);
    let candidates = [];
    let directPath = null;
    if (ibxPath && fs.existsSync(toLongPath(ibxPath))) {
      try {
        const st = fs.statSync(toLongPath(ibxPath));
        if (st.isFile() && LIVE_EDIT_EXTS.has(path.extname(ibxPath).toLowerCase())) {
          const contentCheck = fs.readFileSync(toLongPath(ibxPath), "utf8");
          if (contentCheck.includes(oldTrim) || contentCheck.includes(o)) {
            directPath = ibxPath;
          } else {
            // try normalized whitespace match
            const normOld = oldTrim.replace(/\s+/g, " ");
            const normContent = contentCheck.replace(/\s+/g, " ");
            if (normContent.includes(normOld)) directPath = ibxPath;
          }
        }
      } catch {}
      if (directPath) candidates = [directPath];
    }
    // If not direct, search project
    if (!candidates.length) {
      const root = projectRoot || lastProjectPath;
      if (!root || !fs.existsSync(toLongPath(root))) {
        return { ok: false, error: "No project open — open a project or load a project file via ibx-file" };
      }
      // iterative walk, collect files that contain oldTrim
      const stack = [path.resolve(root)];
      const visited = new Set();
      const found = [];
      const limitFiles = 8000;
      let scanned = 0;
      while (stack.length && found.length < 80 && scanned < limitFiles) {
        const dir = stack.pop();
        let real = dir;
        try { real = fs.realpathSync(toLongPath(dir)); } catch {}
        if (visited.has(real)) continue;
        visited.add(real);
        let entries = [];
        try { entries = fs.readdirSync(toLongPath(dir), { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          if (e.name.startsWith(".") && e.name !== ".env" && e.name !== ".env.example") continue;
          if (LIVE_EDIT_IGNORE_DIRS.has(e.name)) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            stack.push(full);
          } else if (e.isFile()) {
            const ext = path.extname(e.name).toLowerCase();
            if (!LIVE_EDIT_EXTS.has(ext)) continue;
            scanned++;
            if (scanned > limitFiles) break;
            try {
              const st = fs.statSync(toLongPath(full));
              if (st.size > 2 * 1024 * 1024) continue; // skip huge
              const content = fs.readFileSync(toLongPath(full), "utf8");
              if (content.includes(oldTrim) || content.includes(o)) {
                found.push({ path: full, content });
                if (found.length >= 80) break;
              } else {
                // try normalized whitespace fallback — check if normalized version contains
                const normOld = oldTrim.replace(/\s+/g, " ");
                if (normOld.length >= 3) {
                  const snippet = normOld.slice(0, 60);
                  if (content.includes(snippet)) {
                    // do more thorough normalized check
                    const normContent = content.replace(/\s+/g, " ");
                    if (normContent.includes(normOld)) found.push({ path: full, content });
                  }
                }
              }
            } catch {}
            if (found.length >= 80) break;
          }
        }
      }
      if (!found.length) {
        return { ok: false, error: `Text "${oldTrim.slice(0, 40)}" not found in project (${path.basename(root)}). Auto detection searched html/js/jsx/ts/tsx.` };
      }
      if (found.length === 1) {
        candidates = [found[0].path];
        // keep content for scoring optimization
      } else {
        // rank by context score
        let best = null;
        let bestScore = -1;
        let bestPos = -1;
        let bestContent = null;
        for (const { path: fp, content } of found) {
          let pos = content.indexOf(oldTrim);
          let localBestPos = -1;
          let localBestScore = -1;
          let idx = pos;
          let iter = 0;
          while (idx !== -1 && iter < 12) {
            const sc = scoreLiveEditContext(content, idx, outerSnippet, tagName, oldTrim);
            if (sc > localBestScore) { localBestScore = sc; localBestPos = idx; }
            idx = content.indexOf(oldTrim, idx + 1);
            iter++;
          }
          // also try original o (untrimmed) if different
          if (o !== oldTrim) {
            let idx2 = content.indexOf(o);
            let it2 = 0;
            while (idx2 !== -1 && it2 < 6) {
              const sc = scoreLiveEditContext(content, idx2, outerSnippet, tagName, o);
              if (sc > localBestScore) { localBestScore = sc; localBestPos = idx2; }
              // store which oldText matched best for replacement
              idx2 = content.indexOf(o, idx2 + 1);
              it2++;
            }
          }
          if (localBestScore > bestScore) {
            bestScore = localBestScore;
            best = fp;
            bestPos = localBestPos;
            bestContent = content;
          }
        }
        // If scores are tied low (0), prefer shortest path or recently modified? Prefer file with smaller size or jsx/tsx first
        if (bestScore <= 0) {
          // fallback: prefer .tsx/.jsx/.html over .js/.ts, and shorter path depth
          found.sort((a, b) => {
            const rank = (p) => {
              const e = path.extname(p.path).toLowerCase();
              if (e === ".tsx" || e === ".jsx") return 0;
              if (e === ".html" || e === ".htm") return 1;
              return 2;
            };
            const ra = rank(a), rb = rank(b);
            if (ra !== rb) return ra - rb;
            return a.path.length - b.path.length;
          });
          best = found[0].path;
          bestContent = found[0].content;
          bestPos = bestContent.indexOf(oldTrim) !== -1 ? bestContent.indexOf(oldTrim) : bestContent.indexOf(o);
        }
        candidates = best ? [best] : found.slice(0, 1).map(f=>f.path);
        // store bestPos for precise replacement
        if (best && bestPos !== -1) {
          // attach via map
          global.__liveEditBestPos = { file: best, pos: bestPos, oldUsed: (bestContent.indexOf(oldTrim, bestPos)===bestPos ? oldTrim : o) };
        }
      }
    }

    const targetPath = candidates[0];
    if (!targetPath) return { ok: false, error: "No candidate file found" };

    // Read, replace at best position if available, else global first occurrence
    let content = fs.readFileSync(toLongPath(targetPath), "utf8");
    let oldUsed = oldTrim;
    let pos = -1;
    const bestInfo = global.__liveEditBestPos && global.__liveEditBestPos.file === targetPath ? global.__liveEditBestPos : null;
    if (bestInfo && typeof bestInfo.pos === "number" && bestInfo.pos >= 0) {
      pos = bestInfo.pos;
      oldUsed = bestInfo.oldUsed || oldTrim;
      // verify still at position
      if (content.slice(pos, pos + oldUsed.length) !== oldUsed) {
        pos = content.indexOf(oldTrim);
        if (pos === -1) pos = content.indexOf(o);
        if (pos !== -1) oldUsed = content.slice(pos, pos + (content.indexOf(oldTrim) !== -1 ? oldTrim.length : o.length));
      }
    } else {
      pos = content.indexOf(oldTrim);
      if (pos === -1) { pos = content.indexOf(o); if (pos !== -1) oldUsed = o; }
      // try normalized fallback: find via regex whitespace flexible
      if (pos === -1) {
        const esc = oldTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pat = esc.replace(/\s+/g, "\\s+");
        try {
          const re = new RegExp(pat);
          const m = content.match(re);
          if (m && m.index !== undefined) { pos = m.index; oldUsed = m[0]; }
        } catch {}
      }
    }
    if (pos === -1) return { ok: false, error: `Text "${oldTrim.slice(0,40)}" not found at expected location in ${path.basename(targetPath)}` };

    const newContent = content.slice(0, pos) + newTrim + content.slice(pos + oldUsed.length);
    // safety: ensure file still valid? For html/jsx we could do light check, but skip
    fs.writeFileSync(toLongPath(targetPath), newContent, "utf8");
    // clear cache
    try { global.__liveEditBestPos = null; } catch {}
    const rel = (projectRoot || lastProjectPath) ? path.relative(projectRoot || lastProjectPath, targetPath).replace(/\\/g, "/") : path.basename(targetPath);
    // notify renderer for live update (Monaco etc.)
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("liveEdit:fileChanged", { filePath: targetPath, rel, oldText: oldUsed, newText: newTrim });
      }
    } catch {}
    return { ok: true, filePath: targetPath, rel, ext: path.extname(targetPath).toLowerCase() };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
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

// 3-way unsaved-changes guard for editor tab close (Save / Don't Save / Cancel)
ipcMain.handle("dialog:confirmSave", async (event, fileName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const name = String(fileName || "Untitled").split(/[\\/]/).pop() || "Untitled";
  const { response } = await dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    message: `"${name}" has unsaved changes.`,
    detail: "Do you want to save your changes before closing?",
  });
  return ["save", "dontSave", "cancel"][response] || "cancel";
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
const FIND_IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "out", "coverage", ".cache", ".parcel-cache", ".turbo", ".vscode", ".idea", ".output", ".trash"]);
const FIND_IGNORE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".mp4", ".webm", ".avi", ".mov", ".mkv", ".woff", ".woff2", ".ttf", ".eot", ".zip", ".tar", ".gz", ".pdf", ".exe", ".dll", ".lock", ".map", ".wasm"]);
function shouldIgnoreFile(name, isDir) {
  if (name.startsWith(".")) return name !== ".env" && name !== ".env.example" && name !== ".project_config" && name !== ".canvas";
  if (isDir) return FIND_IGNORE_DIRS.has(name);
  const ext = path.extname(name).toLowerCase();
  return FIND_IGNORE_EXTS.has(ext);
}
ipcMain.handle("fs:findFiles", async (_e, rootPath, query = "", limit = 100) => {
  if (!rootPath || !fs.existsSync(rootPath)) return [];
  const q = String(query || "").toLowerCase().trim();
  const results = [];
  const stack = [rootPath];
  const visitedDirs = new Set();
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
    try {
      const real = fs.realpathSync(dir);
      if (visitedDirs.has(real)) continue;
      visitedDirs.add(real);
    } catch {}
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
  const tryRg = () => new Promise((resolve) => {
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
        const m = line.match(/^((?:[A-Za-z]:)?[^:]+):(\d+):(.*)$/);
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
  const results = [];
  const stack = [rootPath];
  const visitedDirs = new Set();
  const qLower = q.toLowerCase();
  while (stack.length && results.length < limit) {
    const dir = stack.pop();
    try {
      const real = fs.realpathSync(dir);
      if (visitedDirs.has(real)) continue;
      visitedDirs.add(real);
    } catch {}
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
            const st = fs.statSync(toLongPath(full));
            if (st.size > 5 * 1024 * 1024) continue;
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

// ─── Git helpers — lightweight async (non-blocking) ────────────────────────────
function gitExec(args, cwd, timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout, encoding: "utf8", windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout);
    });
  });
}
function humanGitError(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s) return "Git operation failed";
  if (s.includes("not a git repository")) return "Not a git repository. Initialize with “git init” or open a git project.";
  if (s.includes("no remote") || s.includes("no configured push destination") || s.includes("fatal: no remote")) return "No remote configured. Add a remote with “git remote add origin <url>”.";
  if (s.includes("authentication failed") || s.includes("could not read username") || s.includes("could not read password") || s.includes("invalid username or password") || s.includes("401") || s.includes("403")) return "Authentication failed — check your git credentials or remote URL.";
  if (s.includes("could not resolve host") || s.includes("unable to access") && s.includes("could not resolve")) return "Network error — could not reach the git remote. Check your internet connection.";
  if (s.includes("network is unreachable") || s.includes("connection timed out") || s.includes("timed out") || s.includes("failed to connect")) return "Network error — remote is unreachable.";
  if (s.includes("merge conflict") || s.includes("automatic merge failed") || s.includes("fix conflicts") || s.includes("conflict")) return "Merge conflict — resolve conflicts, stage the files, then commit.";
  if (s.includes("rebase conflict") || s.includes("could not apply")) return "Rebase conflict — resolve conflicts and continue the rebase.";
  if (s.includes("non-fast-forward") || s.includes("fetch first") || s.includes("rejected") && s.includes("fetch first")) return "Push rejected — remote has newer commits. Pull (or fetch + rebase) first, then push again.";
  if (s.includes("rejected") && s.includes("non-fast-forward")) return "Push rejected (non-fast-forward) — pull/merge first.";
  if (s.includes("nothing to commit") || s.includes("no changes added to commit")) return "Nothing to commit — stage some changes first.";
  if (s.includes("please tell me who you are") || s.includes("author identity unknown")) return "Git user not configured. Run: git config --global user.name and git config --global user.email.";
  if (s.includes("pathspec") && s.includes("did not match")) return "File not found in git index — refresh and try again.";
  if (s.includes("permission denied")) return "Permission denied — check file permissions or remote access rights.";
  if (s.includes("would be overwritten by merge") || s.includes("overwritten by merge")) return "Local changes would be overwritten — stash or commit them first, then pull.";
  if (s.includes("branch") && s.includes("already exists")) return "Branch already exists — pick a different name or switch to it.";
  if (s.includes("cannot lock ref") || s.includes("unable to create")) return "Git lock error — another git operation may be running. Try again.";
  // fallback: first meaningful line
  const first = String(raw).split("\n").map(l=>l.trim()).filter(Boolean)[0];
  return first ? first.slice(0, 320) : "Git operation failed";
}
function sanitizeGitArg(v) {
  if (typeof v !== "string") return "";
  // allow letters, numbers, - _ / .  but also allow spaces for commit messages? caller handles -m separately
  return v.trim();
}
function validateRelPath(rel) {
  if (!rel || typeof rel !== "string") return false;
  if (rel.includes("..") || rel.includes("\0")) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}
function ensureInsideRoot(root, rel) {
  try {
    const joined = path.resolve(path.join(root, rel));
    const r = path.resolve(root);
    if (joined === r || joined.startsWith(r + path.sep)) return true;
  } catch {}
  return false;
}
// tiny cache to avoid hammering git when multiple panels poll simultaneously
const gitCache = new Map(); // key -> { data, time, promise }
function gitCacheGet(key, ttl) {
  const e = gitCache.get(key);
  if (!e) return null;
  if (e.promise && Date.now() - e.time < ttl) return e.promise; // in-flight
  if (e.data !== undefined && Date.now() - e.time < ttl) return e.data;
  return null;
}
function gitCacheSet(key, data, isPromise = false) {
  if (isPromise) gitCache.set(key, { promise: data, time: Date.now(), data: undefined });
  else gitCache.set(key, { data, time: Date.now() });
}
function gitCacheInvalidate(rootPath) {
  if (!rootPath) return;
  for (const k of [...gitCache.keys()]) {
    if (k.includes(rootPath)) gitCache.delete(k);
  }
}

ipcMain.handle("git:status", async (_e, rootPath) => {
  if (!rootPath) return [];
  const key = `status:${rootPath}`;
  const cached = gitCacheGet(key, 2500);
  if (cached) return cached instanceof Promise ? cached : cached;
  const p = (async () => {
    try {
      const raw = await gitExec(["status", "--porcelain", "-z", "-uall"], rootPath, 4000);
      if (!raw) return [];
      const out = [];
      const parts = raw.split("\0");
      for (let i = 0; i < parts.length; i++) {
        let entry = parts[i];
        if (!entry) continue;
        const x = entry[0] || " ", y = entry[1] || " ";
        let rawStatus = (x + y);
        let rel = entry.slice(3);
        // handle rename/copy: "R  old\0new\0"  -> second part is new path
        let origRel = null;
        if (x === "R" || x === "C" || y === "R" || y === "C") {
          origRel = rel.trim();
          // next NUL is destination
          const next = parts[i + 1] || "";
          if (next && !next.match(/^[ ?!A-Z][ ?!A-Z] /)) {
            // heuristic: if next doesn't look like a new git entry (2-char status), treat as dest
            // git -z for R/C emits: "R100\0old\0new\0" or "R  old -> new" depending on -z variant
            // With our slice(3), for normal it'd be orig; next is dest
            rel = next.trim();
            i++;
          } else {
            rel = rel.trim();
          }
        } else {
          rel = rel.trim();
        }
        if (!rel) continue;
        // filter out entries where rel is numeric score like "100"
        if (/^\d+$/.test(rel) && origRel) { rel = (parts[i+1]||"").trim(); if (!rel) continue; }
        const status = rawStatus.trim() || (x==="?" && y==="?" ? "??" : rawStatus);
        // conflict detection: UU, AA, DD, AU, UA, DU, UD etc.
        const isConflict = (x === "U" || y === "U" || (x==="A"&&y==="A") || (x==="D"&&y==="D"));
        const isUntracked = rawStatus === "??" || (x==="?" && y==="?") || status==="??";
        // detect partially staged: both x and y indicate changes (e.g., MM, AM, MD...)
        const stagedChange = x !== " " && x !== "?" && x !== "!" && x !== "U";
        const unstagedChange = y !== " " && y !== "?" && y !== "!" && y !== "U";
        const partiallyStaged = stagedChange && unstagedChange;
        out.push({
          status: isUntracked ? "??" : (rawStatus.trim() || rawStatus),
          x, y,
          path: path.join(rootPath, rel),
          rel,
          origRel: origRel || undefined,
          conflicted: !!isConflict,
          partiallyStaged: !!partiallyStaged,
        });
      }
      return out;
    } catch { return []; }
  })();
  gitCacheSet(key, p, true);
  p.then((d) => gitCacheSet(key, d)).catch(() => gitCache.delete(key));
  return p;
});

ipcMain.handle("git:diff", async (_e, rootPath, filePath) => {
  if (!rootPath || !filePath) return "";
  try {
    let rel = filePath;
    if (path.isAbsolute(filePath)) rel = path.relative(rootPath, filePath).replace(/\\/g, "/");
    else rel = String(filePath).replace(/\\/g, "/");
    if (!validateRelPath(rel)) rel = String(filePath).replace(/\\/g, "/").replace(/^\//, "");
    // ensure inside
    if (!ensureInsideRoot(rootPath, rel)) return "";
    // Try staged diff first, then unstaged, then combined with --no-color, handle binary
    // If file is untracked, diff returns empty -> try --no-index vs /dev/null handling
    try {
      const out = await gitExec(["diff", "--", rel], rootPath, 4000);
      if (out && out.trim()) return String(out);
    } catch {}
    try {
      const out2 = await gitExec(["diff", "--staged", "--", rel], rootPath, 4000);
      if (out2 && out2.trim()) return String(out2);
    } catch {}
    try {
      const out3 = await gitExec(["diff", "HEAD", "--", rel], rootPath, 4000);
      if (out3 && out3.trim()) return String(out3);
    } catch {}
    // check binary
    try {
      const check = await gitExec(["diff", "--numstat", "--", rel], rootPath, 2000);
      if (check && check.includes("-\t-\t")) return "Binary file — diff not displayed";
    } catch {}
    return "";
  } catch { return ""; }
});

ipcMain.handle("git:diffStaged", async (_e, rootPath, filePath) => {
  if (!rootPath || !filePath) return "";
  try {
    let rel = path.isAbsolute(filePath) ? path.relative(rootPath, filePath).replace(/\\/g, "/") : String(filePath).replace(/\\/g, "/");
    if (!ensureInsideRoot(rootPath, rel)) return "";
    const out = await gitExec(["diff", "--staged", "--", rel], rootPath, 4000);
    return String(out || "");
  } catch { return ""; }
});

ipcMain.handle("git:diffAll", async (_e, rootPath) => {
  if (!rootPath) return "";
  try {
    const out = await gitExec(["diff", "--unified=0"], rootPath, 4000);
    return String(out || "");
  } catch { return ""; }
});

ipcMain.handle("git:branch", async (_e, rootPath) => {
  if (!rootPath) return { branch: "", isRepo: false };
  const key = `branch:${rootPath}`;
  const cached = gitCacheGet(key, 5000);
  if (cached) return cached instanceof Promise ? cached : cached;
  const p = (async () => {
    try {
      await gitExec(["rev-parse", "--is-inside-work-tree"], rootPath, 2000);
    } catch { return { branch: "", isRepo: false }; }
    try {
      const branch = (await gitExec(["rev-parse", "--abbrev-ref", "HEAD"], rootPath, 2000)).trim();
      let ahead = 0, behind = 0;
      try {
        const ab = (await gitExec(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], rootPath, 2000)).trim();
        const parts = ab.split(/\s+/); ahead = parseInt(parts[0] || "0", 10) || 0; behind = parseInt(parts[1] || "0", 10) || 0;
      } catch {}
      // also check remote existence
      let hasRemote = true;
      try { await gitExec(["remote"], rootPath, 1500); const r = (await gitExec(["remote"], rootPath, 1500)).trim(); hasRemote = !!r; } catch { hasRemote = false; }
      return { branch, isRepo: true, ahead, behind, hasRemote };
    } catch { return { branch: "HEAD", isRepo: true, ahead: 0, behind: 0, hasRemote: false }; }
  })();
  gitCacheSet(key, p, true);
  p.then((d) => gitCacheSet(key, d)).catch(() => gitCache.delete(key));
  return p;
});

ipcMain.handle("git:branches", async (_e, rootPath) => {
  if (!rootPath) return { local: [], remote: [], current: "" };
  try {
    await gitExec(["rev-parse", "--is-inside-work-tree"], rootPath, 2000);
  } catch { return { local: [], remote: [], current: "", isRepo: false }; }
  try {
    const [curRaw, localRaw, remoteRaw] = await Promise.all([
      gitExec(["rev-parse", "--abbrev-ref", "HEAD"], rootPath, 2000).catch(()=> ""),
      gitExec(["branch", "--format=%(refname:short)"], rootPath, 2500).catch(()=> ""),
      gitExec(["branch", "-r", "--format=%(refname:short)"], rootPath, 2500).catch(()=> ""),
    ]);
    const current = curRaw.trim();
    const local = localRaw.split("\n").map(s=>s.trim()).filter(Boolean);
    const remote = remoteRaw.split("\n").map(s=>s.trim()).filter(Boolean);
    return { current, local, remote, isRepo: true };
  } catch (e) {
    return { local: [], remote: [], current: "", error: humanGitError(e?.stderr||e?.message) };
  }
});

ipcMain.handle("git:createBranch", async (_e, rootPath, name) => {
  if (!rootPath || !name) return { ok: false, error: "Missing branch name" };
  const n = sanitizeGitArg(name);
  if (!n || /[\s~^:?*\[\\]/.test(n) || n.includes("..") || n.includes("//")) return { ok: false, error: "Invalid branch name" };
  try { await gitExec(["checkout", "-b", n], rootPath, 6000); gitCacheInvalidate(rootPath); return { ok: true, branch: n }; }
  catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:switchBranch", async (_e, rootPath, name) => {
  if (!rootPath || !name) return { ok: false, error: "Missing branch name" };
  const n = String(name).trim();
  if (!n || n.includes("\0")) return { ok: false, error: "Invalid branch name" };
  try { await gitExec(["checkout", n], rootPath, 8000); gitCacheInvalidate(rootPath); return { ok: true, branch: n }; }
  catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:deleteBranch", async (_e, rootPath, name, force) => {
  if (!rootPath || !name) return { ok: false, error: "Missing branch name" };
  const n = String(name).trim();
  try { await gitExec(["branch", force ? "-D" : "-d", n], rootPath, 5000); gitCacheInvalidate(rootPath); return { ok: true }; }
  catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:renameBranch", async (_e, rootPath, oldName, newName) => {
  if (!rootPath || !oldName || !newName) return { ok: false, error: "Missing names" };
  const nn = sanitizeGitArg(newName);
  if (!nn) return { ok: false, error: "Invalid new name" };
  try { await gitExec(["branch", "-m", String(oldName).trim(), nn], rootPath, 5000); gitCacheInvalidate(rootPath); return { ok: true, branch: nn }; }
  catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:init", async (_e, rootPath) => {
  if (!rootPath) return { ok: false, error: "Missing path" };
  try { await gitExec(["init"], rootPath, 5000); gitCacheInvalidate(rootPath); return { ok: true }; }
  catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:conflicts", async (_e, rootPath) => {
  if (!rootPath) return [];
  try {
    const raw = await gitExec(["diff", "--name-only", "--diff-filter=U"], rootPath, 3000);
    const list = raw.split("\n").map(s=>s.trim()).filter(Boolean).map(rel=>({ rel, path: path.join(rootPath, rel) }));
    return list;
  } catch { return []; }
});

ipcMain.handle("git:markResolved", async (_e, rootPath, relPath) => {
  if (!rootPath || !relPath) return { ok: false, error: "missing path" };
  if (!validateRelPath(relPath) || !ensureInsideRoot(rootPath, relPath)) return { ok: false, error: "Invalid path" };
  try { await gitExec(["add", "--", relPath], rootPath, 4000); gitCacheInvalidate(rootPath); return { ok: true }; }
  catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:commitShow", async (_e, rootPath, hash) => {
  if (!rootPath || !hash) return "";
  const h = String(hash).trim();
  if (!/^[0-9a-f]{4,40}$/i.test(h)) return "";
  try { const out = await gitExec(["show", "--stat", "--oneline", h], rootPath, 4000); return String(out||""); } catch { return ""; }
});
ipcMain.handle("git:commitDiff", async (_e, rootPath, hash) => {
  if (!rootPath || !hash) return "";
  const h = String(hash).trim();
  if (!/^[0-9a-f]{4,40}$/i.test(h)) return "";
  try { const out = await gitExec(["show", h], rootPath, 6000); return String(out||""); } catch { return ""; }
});

ipcMain.handle("git:log", async (_e, rootPath, limit = 20) => {
  if (!rootPath) return [];
  const key = `log:${rootPath}:${limit}`;
  const cached = gitCacheGet(key, 8000);
  if (cached) return cached instanceof Promise ? cached : cached;
  const p = (async () => {
    try {
      const n = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50); // cap 50 vs 100 to lighten
      const fmt = "%H%x1f%an%x1f%ae%x1f%ar%x1f%s%x1f%D";
      const out = await gitExec(["log", "--oneline", "-n", String(n), `--pretty=format:${fmt}`], rootPath, 3000);
      return out.split("\n").filter(Boolean).map((l) => {
        const [hash, author, email, relTime, msg, refs] = l.split("\x1f");
        return { hash: hash?.slice(0, 7), fullHash: hash, author, email, relTime, msg, refs: refs || "" };
      });
    } catch { return []; }
  })();
  gitCacheSet(key, p, true);
  p.then((d) => gitCacheSet(key, d)).catch(() => gitCache.delete(key));
  return p;
});

ipcMain.handle("git:stage", async (_e, rootPath, relPath) => {
  if (!rootPath || !relPath) return { ok: false, error: "missing path" };
  if (!validateRelPath(relPath) || !ensureInsideRoot(rootPath, relPath)) return { ok: false, error: "Invalid path" };
  try { await gitExec(["add", "--", relPath], rootPath, 4000); gitCacheInvalidate(rootPath); return { ok: true }; } catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:unstage", async (_e, rootPath, relPath) => {
  if (!rootPath || !relPath) return { ok: false, error: "missing path" };
  if (!validateRelPath(relPath) || !ensureInsideRoot(rootPath, relPath)) return { ok: false, error: "Invalid path" };
  try {
    try { await gitExec(["restore", "--staged", "--", relPath], rootPath, 4000); }
    catch { await gitExec(["reset", "HEAD", "--", relPath], rootPath, 4000); }
    gitCacheInvalidate(rootPath); return { ok: true };
  } catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:stageAll", async (_e, rootPath) => {
  if (!rootPath) return { ok: false };
  try { await gitExec(["add", "-A"], rootPath, 5000); gitCacheInvalidate(rootPath); return { ok: true }; } catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:unstageAll", async (_e, rootPath) => {
  if (!rootPath) return { ok: false };
  try { await gitExec(["reset", "HEAD"], rootPath, 5000); gitCacheInvalidate(rootPath); return { ok: true }; } catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:discard", async (_e, rootPath, relPath) => {
  if (!rootPath || !relPath) return { ok: false };
  if (!validateRelPath(relPath) || !ensureInsideRoot(rootPath, relPath)) return { ok: false, error: "Invalid path" };
  try {
    // For untracked, clean handles removal; for tracked, restore
    try { await gitExec(["clean", "-fd", "--", relPath], rootPath, 4000); } catch {}
    try { await gitExec(["restore", "--", relPath], rootPath, 4000); } catch {}
    try { await gitExec(["checkout", "--", relPath], rootPath, 4000); } catch {}
    gitCacheInvalidate(rootPath); return { ok: true };
  } catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

ipcMain.handle("git:commit", async (_e, rootPath, message, opts) => {
  if (!rootPath || !message?.trim()) return { ok: false, error: "Empty message" };
  const amend = opts && opts.amend;
  try {
    if (amend) await gitExec(["commit", "--amend", "-m", message.trim()], rootPath, 6000);
    else await gitExec(["commit", "-m", message.trim()], rootPath, 6000);
    gitCacheInvalidate(rootPath); return { ok: true };
  } catch (e) { return { ok: false, error: humanGitError(e.stderr?.toString() || e.message || String(e)) }; }
});
ipcMain.handle("git:commitAmend", async (_e, rootPath, message) => {
  if (!rootPath || !message?.trim()) return { ok: false, error: "Empty message" };
  try { await gitExec(["commit", "--amend", "-m", message.trim()], rootPath, 6000); gitCacheInvalidate(rootPath); return { ok: true }; }
  catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});
ipcMain.handle("git:push", async (_e, rootPath) => {
  if (!rootPath) return { ok: false };
  try { const out = await gitExec(["push"], rootPath, 15000); gitCacheInvalidate(rootPath); return { ok: true, out }; } catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});
ipcMain.handle("git:pull", async (_e, rootPath) => {
  if (!rootPath) return { ok: false };
  try { const out = await gitExec(["pull"], rootPath, 15000); gitCacheInvalidate(rootPath); return { ok: true, out }; } catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});
ipcMain.handle("git:fetch", async (_e, rootPath) => {
  if (!rootPath) return { ok: false };
  try { const out = await gitExec(["fetch"], rootPath, 15000); gitCacheInvalidate(rootPath); return { ok: true, out }; } catch (e) { return { ok: false, error: humanGitError(e.stderr||e.message) }; }
});

// ─── Project config (tabs state + pin config) — stored in appData/projects/ ───
// Legacy constants kept for migration only — new data lives in userData/projects/
const PIN_FILE = ".pinconfig";
const TABS_FILE = "tabs.json";

ipcMain.handle("projectConfig:readTabs", async (_e, rootPath) => {
  if (!rootPath) return null;
  try {
    if (memTabsCache.has(rootPath)) return memTabsCache.get(rootPath);
    migrateLegacyIfNeeded(rootPath);
    const storeDir = getProjectStoreDir(rootPath);
    if (!storeDir) return null;
    const filePath = path.join(storeDir, TABS_FILE);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    memTabsCache.set(rootPath, data);
    return data;
  } catch { return null; }
});

ipcMain.handle("projectConfig:writeTabs", async (_e, rootPath, data) => {
  if (!rootPath) return false;
  try {
    migrateLegacyIfNeeded(rootPath);
    const storeDir = getProjectStoreDir(rootPath);
    if (!storeDir) return false;
    const filePath = path.join(storeDir, TABS_FILE);
    fs.mkdirSync(storeDir, { recursive: true });
    if (data == null) {
      try { fs.unlinkSync(filePath); } catch {}
      memTabsCache.delete(rootPath);
      return true;
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    memTabsCache.set(rootPath, data);
    return true;
  } catch { return false;
  }
});

// ─── Pin config ────────────────────────────────────────────────────────────────
ipcMain.handle("fs:readPinConfig", async (_e, rootPath) => {
  if (!rootPath) return [];
  try {
    if (memPinCache.has(rootPath)) return memPinCache.get(rootPath);
    migrateLegacyIfNeeded(rootPath);
    const storeDir = getProjectStoreDir(rootPath);
    if (storeDir) {
      const filePath = path.join(storeDir, "pinconfig.json");
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        memPinCache.set(rootPath, data);
        return data;
      }
    }
  } catch {}
  // fallback defaults - check legacy location once
  try {
    const legacy = path.join(rootPath, ".project_config", PIN_FILE);
    if (fs.existsSync(legacy)) {
      const data = JSON.parse(fs.readFileSync(legacy, "utf8"));
      memPinCache.set(rootPath, data);
      // migrate immediately
      try {
        const storeDir = getProjectStoreDir(rootPath);
        if (storeDir) {
          fs.mkdirSync(storeDir, { recursive: true });
          fs.writeFileSync(path.join(storeDir, "pinconfig.json"), JSON.stringify(data, null, 2));
          memPinCache.set(rootPath, data);
        }
      } catch {}
      return data;
    }
  } catch {}
  const exists = (name) => fs.existsSync(path.join(rootPath, name));
  const def = ["assets", "components"].filter(exists);
  memPinCache.set(rootPath, def);
  return def;
});

ipcMain.handle("fs:writePinConfig", async (_e, rootPath, data) => {
  if (!rootPath) return false;
  try {
    migrateLegacyIfNeeded(rootPath);
    const storeDir = getProjectStoreDir(rootPath);
    if (!storeDir) return false;
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(path.join(storeDir, "pinconfig.json"), JSON.stringify(data, null, 2));
    memPinCache.set(rootPath, data);
    // also clean up legacy file if exists — keep project clean
    try { fs.rmSync(path.join(rootPath, ".project_config", PIN_FILE), { force: true }); } catch {}
    try {
      const legacyDir = path.join(rootPath, ".project_config");
      if (fs.existsSync(legacyDir) && fs.readdirSync(legacyDir).length === 0) fs.rmdirSync(legacyDir);
    } catch {}
    return true;
  } catch { return false; }
});

// ─── Canvas (Visual Project Map) ──────────────────────────────────────────────
const CANVAS_EXT_RE        = /\.(jsx|tsx|js|ts|vue|svelte|html)$/i;
const CANVAS_EXCLUDE_DIRS  = new Set(["node_modules", "dist", "build", ".git", ".next", ".nuxt", ".output", ".cache", "coverage", "out"]);
const CANVAS_SCAN_NAMES    = ["pages", "components", "views", "widgets", "features", "ui"];
// Legacy dir/file for migration — new location is userData/projects/<hash>/canvas-layout.json
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
  if (!rootPath) return false;
  try {
    if (memCanvasCache.has(rootPath) && data == null) memCanvasCache.delete(rootPath);
    else if (data) memCanvasCache.set(rootPath, data);
    migrateLegacyIfNeeded(rootPath);
    const storeDir = getProjectStoreDir(rootPath);
    if (!storeDir) return false;
    const filePath = path.join(storeDir, "canvas-layout.json");
    if (data == null) {
      try { fs.unlinkSync(filePath); } catch {}
      return true;
    }
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data || {}, null, 2));
    // clean legacy
    try { fs.rmSync(path.join(rootPath, CANVAS_LAYOUT_DIR, CANVAS_LAYOUT_FILE), { force: true }); } catch {}
    try {
      const legacyDir = path.join(rootPath, CANVAS_LAYOUT_DIR);
      if (fs.existsSync(legacyDir) && fs.readdirSync(legacyDir).length === 0) fs.rmdirSync(legacyDir);
    } catch {}
    return true;
  } catch { return false; }
});

ipcMain.handle("canvas:loadLayout", async (_e, rootPath) => {
  if (!rootPath) return null;
  try {
    if (memCanvasCache.has(rootPath)) return memCanvasCache.get(rootPath);
    migrateLegacyIfNeeded(rootPath);
    const storeDir = getProjectStoreDir(rootPath);
    if (!storeDir) return null;
    const filePath = path.join(storeDir, "canvas-layout.json");
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      memCanvasCache.set(rootPath, data);
      return data;
    }
    // try legacy once
    try {
      const legacy = path.join(rootPath, CANVAS_LAYOUT_DIR, CANVAS_LAYOUT_FILE);
      if (fs.existsSync(legacy)) {
        const data = JSON.parse(fs.readFileSync(legacy, "utf8"));
        memCanvasCache.set(rootPath, data);
        // migrate
        try {
          fs.mkdirSync(storeDir, { recursive: true });
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        } catch {}
        return data;
      }
    } catch {}
    return null;
  } catch { return null; }
});

// ─── Canvas drawings (Excalidraw JSON / .excalidraw) ─────────────────────────
// Per-project scratch drawing persisted in app storage (userData) so the
// project folder stays clean. File-backed drawings (*.excalidraw inside the
// project) use the generic fs:readTextFile / fs:writeFile IPC instead.
const CANVAS_DRAWING_FILE = "drawing.excalidraw";
const memDrawingCache = new Map(); // rootPath -> raw JSON string

ipcMain.handle("canvas:saveDrawing", async (_e, rootPath, data) => {
  if (!rootPath) return { ok: false, error: "No project open" };
  try {
    const text = typeof data === "string" ? data : JSON.stringify(data || {}, null, 2);
    // Validate it's JSON before writing so a corrupt scene never lands on disk.
    try {
      JSON.parse(text);
    } catch {
      return { ok: false, error: "Invalid drawing JSON" };
    }
    memDrawingCache.set(rootPath, text);
    const storeDir = getProjectStoreDir(rootPath);
    if (!storeDir) return { ok: false, error: "No storage" };
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(path.join(storeDir, CANVAS_DRAWING_FILE), text, "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("canvas:loadDrawing", async (_e, rootPath) => {
  if (!rootPath) return { ok: false, content: null };
  try {
    if (memDrawingCache.has(rootPath)) return { ok: true, content: memDrawingCache.get(rootPath) };
    const storeDir = getProjectStoreDir(rootPath);
    if (!storeDir) return { ok: false, content: null };
    const filePath = path.join(storeDir, CANVAS_DRAWING_FILE);
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, "utf8");
      memDrawingCache.set(rootPath, text);
      return { ok: true, content: text };
    }
    return { ok: true, content: null };
  } catch (err) {
    return { ok: false, content: null, error: err?.message || String(err) };
  }
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
  try { safeRename(po, np); return path.join(path.dirname(oldPath), newName); }
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

// ─── Local trash (project-level recycle bin) — stored in userData/projects/ ───
// Legacy: was .trash in project folder — now migrated to userData
const TRASH_DIR = ".trash"; // kept for legacy migration check only
const TRASH_DIR_NAME = "trash"; // inside storeDir
const MANIFEST  = "manifest.json";

function trashDir(rootPath) {
  // New location: userData/projects/<hash>/trash
  if (!rootPath) return null;
  // migrate on first access
  try { migrateLegacyIfNeeded(rootPath); } catch {}
  const storeDir = getProjectStoreDir(rootPath);
  if (!storeDir) return null;
  const td = path.join(storeDir, TRASH_DIR_NAME);
  if (!fs.existsSync(td)) {
    try { fs.mkdirSync(td, { recursive: true }); } catch {}
  }
  return td;
}

function manifestPath(rootPath) {
  const td = trashDir(rootPath);
  if (!td) return null;
  return path.join(td, MANIFEST);
}

function readManifest(rootPath) {
  try {
    const mp = manifestPath(rootPath);
    if (!mp || !fs.existsSync(mp)) return {};
    return JSON.parse(fs.readFileSync(mp, "utf8"));
  }
  catch { return {}; }
}

function writeManifest(rootPath, manifest) {
  const td = trashDir(rootPath);
  if (!td) return;
  if (!fs.existsSync(td)) fs.mkdirSync(td, { recursive: true });
  fs.writeFileSync(path.join(td, MANIFEST), JSON.stringify(manifest, null, 2));
}

ipcMain.handle("fs:trashItem", async (_e, { itemPath, rootPath }) => {
  const lpItem = toLongPath(itemPath);
  // rootPath may be different from itemPath's parent — use provided rootPath for store location
  const effectiveRoot = rootPath || path.dirname(itemPath);
  try {
    if (!fs.existsSync(lpItem)) throw new Error(`File does not exist: ${itemPath}`);
    const name = path.basename(lpItem);
    const td   = trashDir(effectiveRoot);
    if (!td) throw new Error("Cannot resolve trash dir");
    if (!fs.existsSync(td)) fs.mkdirSync(td, { recursive: true });

    let trashId = `${Date.now()}_${name}`;
    let dest    = path.join(td, trashId);
    let i = 1;
    while (fs.existsSync(dest)) {
      trashId = `${Date.now()}_${i++}_${name}`;
      dest    = path.join(td, trashId);
    }

    // prevent trashing the trash store itself or legacy .trash
    const legacyTrash = path.join(path.resolve(effectiveRoot), TRASH_DIR);
    if (lpItem === td || lpItem.startsWith(td + path.sep) || lpItem === legacyTrash || lpItem.startsWith(legacyTrash + path.sep)) {
      throw new Error("Cannot trash item inside trash folder");
    }

    safeRename(lpItem, dest);

    const manifest = readManifest(effectiveRoot);
    manifest[trashId] = { originalPath: itemPath, timestamp: Date.now(), isDir: fs.statSync(dest).isDirectory() };
    writeManifest(effectiveRoot, manifest);

    return { trashId, originalPath: itemPath };
  } catch (err) {
    throw new Error(`Cannot trash "${path.basename(itemPath)}": ${err.message}`);
  }
});

ipcMain.handle("fs:restoreTrashItem", async (_e, { trashId, rootPath }) => {
  const effectiveRoot = rootPath;
  if (!effectiveRoot) throw new Error("Missing rootPath");
  const manifest = readManifest(effectiveRoot);
  const entry = manifest[trashId];
  if (!entry) throw new Error(`Trash entry "${trashId}" not found`);

  const td = trashDir(effectiveRoot);
  if (!td) throw new Error("Cannot resolve trash dir");
  const src = path.join(td, trashId);
  const dst = toLongPath(entry.originalPath);

  let finalDst = dst, i = 1;
  while (fs.existsSync(finalDst)) {
    const { dir, name, ext } = path.parse(dst);
    finalDst = path.join(dir, `${name} (${i++})${ext}`);
  }

  const parentDir = path.dirname(finalDst);
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

  safeRename(src, finalDst);

  delete manifest[trashId];
  writeManifest(effectiveRoot, manifest);

  return finalDst;
});

// ─── Project storage management (app memory) — menu bar actions ──────────────
function getStorageInfo(rootPath) {
  try {
    if (!rootPath) return null;
    const storeDir = getProjectStoreDir(rootPath);
    if (!storeDir) return null;
    const pinPath = path.join(storeDir, "pinconfig.json");
    const tabsPath = path.join(storeDir, "tabs.json");
    const canvasPath = path.join(storeDir, "canvas-layout.json");
    const td = path.join(storeDir, "trash");
    const mf = path.join(td, "manifest.json");
    let trashCount = 0;
    let trashSize = 0;
    try {
      if (fs.existsSync(mf)) {
        const m = JSON.parse(fs.readFileSync(mf, "utf8"));
        trashCount = Object.keys(m).length;
      }
      if (fs.existsSync(td)) {
        const entries = fs.readdirSync(td);
        for (const e of entries) {
          if (e === "manifest.json") continue;
          try {
            const st = fs.statSync(path.join(td, e));
            trashSize += st.isDirectory() ? 0 : st.size;
            // for dirs, rough size
            if (st.isDirectory()) {
              try {
                const walk = (dir) => {
                  let s = 0;
                  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                    const fp = path.join(dir, f.name);
                    try {
                      const ss = fs.statSync(fp);
                      if (ss.isDirectory()) s += walk(fp);
                      else s += ss.size;
                    } catch {}
                  }
                  return s;
                };
                trashSize += walk(path.join(td, e));
              } catch {}
            }
          } catch {}
        }
      }
    } catch {}
    const exists = (p) => fs.existsSync(p);
    return {
      storeDir,
      pinExists: exists(pinPath),
      tabsExists: exists(tabsPath),
      canvasExists: exists(canvasPath),
      trashCount,
      trashSize,
      pinPath,
      tabsPath,
      canvasPath,
      trashDir: td,
      manifestPath: mf,
    };
  } catch { return null; }
}

ipcMain.handle("projectStorage:getInfo", async (_e, rootPath) => {
  return getStorageInfo(rootPath || lastProjectPath);
});

ipcMain.handle("projectStorage:getTrashList", async (_e, rootPath) => {
  const rp = rootPath || lastProjectPath;
  if (!rp) return [];
  try {
    const manifest = readManifest(rp);
    const td = trashDir(rp);
    const out = [];
    for (const [id, info] of Object.entries(manifest)) {
      let size = 0;
      let exists = false;
      try {
        const fp = path.join(td, id);
        if (fs.existsSync(fp)) {
          exists = true;
          const st = fs.statSync(fp);
          if (!st.isDirectory()) size = st.size;
          else {
            // dir size approx
            try {
              const walk = (dir) => {
                let s = 0;
                for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
                  const fp2 = path.join(dir, f.name);
                  try {
                    const ss = fs.statSync(fp2);
                    if (ss.isDirectory()) s += walk(fp2);
                    else s += ss.size;
                  } catch {}
                }
                return s;
              };
              size = walk(fp);
            } catch {}
          }
        }
      } catch {}
      out.push({ trashId: id, originalPath: info.originalPath, timestamp: info.timestamp, isDir: !!info.isDir, size, exists });
    }
    out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return out;
  } catch { return []; }
});

ipcMain.handle("projectStorage:reveal", async (_e, rootPath) => {
  const rp = rootPath || lastProjectPath;
  const info = getStorageInfo(rp);
  const target = info?.storeDir || getProjectStoreRoot();
  try {
    if (fs.existsSync(target)) {
      await shell.openPath(target);
      return { ok: true, path: target };
    }
    return { ok: false, error: "Not found: " + target };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("projectStorage:revealTrash", async (_e, rootPath) => {
  const rp = rootPath || lastProjectPath;
  const td = trashDir(rp);
  try {
    if (td && fs.existsSync(td)) {
      await shell.openPath(td);
      return { ok: true, path: td };
    }
    return { ok: false, error: "Trash empty or not found" };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("projectStorage:clearPin", async (_e, rootPath) => {
  const rp = rootPath || lastProjectPath;
  if (!rp) return { ok: false, error: "No project" };
  try {
    memPinCache.delete(rp);
    const p = path.join(getProjectStoreDir(rp), "pinconfig.json");
    try { fs.unlinkSync(p); } catch {}
    // legacy cleanup
    try { fs.rmSync(path.join(rp, ".project_config", ".pinconfig"), { force: true }); } catch {}
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("projectStorage:clearTabs", async (_e, rootPath) => {
  const rp = rootPath || lastProjectPath;
  if (!rp) return { ok: false, error: "No project" };
  try {
    memTabsCache.delete(rp);
    const p = path.join(getProjectStoreDir(rp), "tabs.json");
    try { fs.unlinkSync(p); } catch {}
    try { fs.rmSync(path.join(rp, ".project_config", "tabs.json"), { force: true }); } catch {}
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("projectStorage:clearCanvas", async (_e, rootPath) => {
  const rp = rootPath || lastProjectPath;
  if (!rp) return { ok: false, error: "No project" };
  try {
    memCanvasCache.delete(rp);
    try { memDrawingCache.delete(rp); } catch {}
    const p = path.join(getProjectStoreDir(rp), "canvas-layout.json");
    try { fs.unlinkSync(p); } catch {}
    try { fs.unlinkSync(path.join(getProjectStoreDir(rp), "drawing.excalidraw")); } catch {}
    try { fs.rmSync(path.join(rp, ".canvas", "layout.json"), { force: true }); } catch {}
    try {
      const legacyDir = path.join(rp, ".canvas");
      if (fs.existsSync(legacyDir) && fs.readdirSync(legacyDir).length === 0) fs.rmdirSync(legacyDir);
    } catch {}
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("projectStorage:clearTrash", async (_e, rootPath) => {
  const rp = rootPath || lastProjectPath;
  if (!rp) return { ok: false, error: "No project" };
  try {
    const td = trashDir(rp);
    if (td && fs.existsSync(td)) {
      const entries = fs.readdirSync(td);
      for (const e of entries) {
        if (e === "manifest.json") continue;
        try { fs.rmSync(path.join(td, e), { recursive: true, force: true }); } catch {}
      }
      try { fs.writeFileSync(path.join(td, "manifest.json"), JSON.stringify({}, null, 2)); } catch {}
    }
    // legacy cleanup
    try { fs.rmSync(path.join(rp, ".trash"), { recursive: true, force: true }); } catch {}
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("projectStorage:clearAll", async (_e, rootPath) => {
  const rp = rootPath || lastProjectPath;
  if (!rp) return { ok: false, error: "No project" };
  try {
    memPinCache.delete(rp);
    memTabsCache.delete(rp);
    memCanvasCache.delete(rp);
    try { memDrawingCache.delete(rp); } catch {}
    const storeDir = getProjectStoreDir(rp);
    if (storeDir && fs.existsSync(storeDir)) {
      fs.rmSync(storeDir, { recursive: true, force: true });
    }
    // legacy cleanup — keep project folder clean
    try { fs.rmSync(path.join(rp, ".project_config"), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(path.join(rp, ".canvas"), { recursive: true, force: true }); } catch {}
    try { fs.rmSync(path.join(rp, ".trash"), { recursive: true, force: true }); } catch {}
    // remove from index
    try {
      const idxFile = path.join(getProjectStoreRoot(), "index.json");
      if (fs.existsSync(idxFile)) {
        const idx = JSON.parse(fs.readFileSync(idxFile, "utf8"));
        const resolved = path.resolve(rp);
        let changed = false;
        if (idx[resolved]) { delete idx[resolved]; changed = true; }
        // find folder key
        for (const k of Object.keys(idx)) {
          if (k.startsWith("_folder:") && idx[k] === resolved) { delete idx[k]; changed = true; }
        }
        if (changed) fs.writeFileSync(idxFile, JSON.stringify(idx, null, 2));
      }
    } catch {}
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("projectStorage:listAll", async () => {
  try {
    const root = getProjectStoreRoot();
    if (!fs.existsSync(root)) return [];
    const idxFile = path.join(root, "index.json");
    let idx = {};
    try { idx = JSON.parse(fs.readFileSync(idxFile, "utf8")); } catch {}
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    const out = [];
    for (const dirName of dirs) {
      const storeDir = path.join(root, dirName);
      let original = idx[`_folder:${dirName}`] || null;
      if (!original) {
        // try reverse lookup
        for (const [k, v] of Object.entries(idx)) {
          if (v === dirName) { original = k; break; }
        }
      }
      let info = null;
      try { info = getStorageInfo(original || storeDir); } catch {}
      // fallback: use dirName as pseudo root if not resolved
      out.push({
        folder: dirName,
        storeDir,
        originalPath: original || "(unknown)",
        exists: original ? fs.existsSync(original) : false,
        pinExists: info?.pinExists || false,
        tabsExists: info?.tabsExists || false,
        canvasExists: info?.canvasExists || false,
        trashCount: info?.trashCount || 0,
      });
    }
    return out;
  } catch { return []; }
});

ipcMain.handle("projectStorage:revealAll", async () => {
  const root = getProjectStoreRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
    await shell.openPath(root);
    return { ok: true, path: root };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle("projectStorage:clearAllProjects", async () => {
  try {
    const root = getProjectStoreRoot();
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    memPinCache.clear();
    memTabsCache.clear();
    memCanvasCache.clear();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
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
    safeRename(lpSrc, dest);
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
    ignoreInitial:     true,
    ignored:           /(^|[/\\])\.(git|hg|svn)($|[/\\])|node_modules/,
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

// ── Browser guest user-agent — responsive/mobile preview ────────────────────
// Renderer (Browser panel) switches UA per viewport preset so sites serve
// their mobile layout instead of desktop + horizontal scrollbar.
ipcMain.handle("browser:getGuestUA", (_event, wcId) => {
  try {
    const wc = require("electron").webContents.fromId(Number(wcId));
    return wc ? wc.getUserAgent() : null;
  } catch { return null; }
});
ipcMain.handle("browser:setGuestUA", (_event, { wcId, ua }) => {
  try {
    const wc = require("electron").webContents.fromId(Number(wcId));
    // NOTE: hamesha explicit UA string aata hai — default restore ke liye
    // renderer pehle getGuestUA se original capture karke wahi wapas bhejta hai.
    if (!wc || typeof ua !== "string" || !ua.length || ua.length > 500) return false;
    wc.setUserAgent(ua);
    return true;
  } catch { return false; }
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
        { label: "Open in Terminal",                                     click: () => act("openInTerminal") },
        sep,
        { label: "Paste",                   accelerator: "Ctrl+V", enabled: !!(clipboardPaths?.length), click: () => act("paste") },
        sep,
        { label: "Reveal in File Explorer", accelerator: "Ctrl+Shift+R", click: () => act("reveal")  },
        { label: "Copy Path",               accelerator: "Ctrl+Shift+C", click: () => act("copyPath") },
        { label: "Copy Relative Path",       accelerator: "Ctrl+K Ctrl+Alt+C", click: () => act("copyRelativePath") },
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
        { label: "Copy Relative Path",       accelerator: "Ctrl+K Ctrl+Alt+C", click: () => act("copyRelativePath") },
        sep,
        { label: "Reveal in File Explorer", accelerator: "Ctrl+Shift+R", click: () => act("reveal") },
        { label: "Refresh",                 accelerator: "F5", click: () => act("refresh") },
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
        { label: "Copy Relative Path",       accelerator: "Ctrl+K Ctrl+Alt+C", click: () => act("copyRelativePath") },
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
        { label: "Copy Relative Path",       accelerator: "Ctrl+K Ctrl+Alt+C", click: () => act("copyRelativePath") },
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
          { label: "Open in Browser",             accelerator: "Alt+B", click: () => act("openInBrowser") },
          { label: "Open in External Browser",                          click: () => act("openInExternalBrowser") },
          { label: "Open with Live Server",        accelerator: "Alt+L", click: () => act("openWithLiveServer") },
        ] : []),
        sep,
        { label: "New File",                accelerator: "Ctrl+N",       click: () => act("newFile") },
        { label: "New Folder",              accelerator: "Ctrl+Shift+N", click: () => act("newFolder") },
        sep,
        { label: "Open in Terminal",                                     click: () => act("openInTerminal") },
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
        { label: "Copy Relative Path",       accelerator: "Ctrl+K Ctrl+Alt+C", click: () => act("copyRelativePath") },
        sep,
        { label: "Refresh",                 accelerator: "F5",           click: () => act("refresh") },
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

// Probe for a shell binary that actually exists — minimal Linux containers
// may lack $SHELL or even /bin/bash, which would make pty.spawn throw ENOENT.
function pickShell() {
  if (process.platform === "win32") return getShell();
  const cands = [process.env.SHELL, "/bin/bash", "/bin/sh"].filter(Boolean);
  for (const c of cands) {
    try {
      if (c.includes("/")) fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch { /* try next */ }
  }
  return "/bin/sh";
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

  const shell = pickShell();
  const shellArgs = getShellArgs(shell);
  let p;
  try {
    p = pty.spawn(shell, shellArgs, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: cwd || process.cwd(),
      env: { ...process.env },
    });
  } catch (err) {
    console.error("[terminal:open] failed to spawn shell:", shell, err?.message || err);
    try { event.sender.send("terminal:data", { tabId, data: `\r\n\x1b[31mcould not start shell (${shell})\x1b[0m\r\n` }); } catch {}
    return false;
  }

  termProcesses.set(key, p);

  p.onData((data) => {
    try { event.sender.send("terminal:data", { tabId, data }); } catch {}
    try { if (typeof sniffPortsFromTerminalOutput === "function") sniffPortsFromTerminalOutput(data); } catch {}
  });

  p.onExit(({ exitCode, signal }) => {
    if (termProcesses.get(key) === p) termProcesses.delete(key);
    try { event.sender.send("terminal:exit", { tabId, code: exitCode, signal }); } catch {}
  });

  return true;
});

ipcMain.handle("terminal:write", async (event, { tabId, data }) => {
  const p = termProcesses.get(termKey(event.sender, tabId));
  if (!p) return { ok: false, error: "no pty" };
  try {
    p.write(data);
    return { ok: true };
  } catch (err) {
    // EPIPE: pty already exited — clean up entry and surface friendly error
    if (err && (err.code === "EPIPE" || String(err.message || "").includes("EPIPE"))) {
      try { termProcesses.delete(termKey(event.sender, tabId)); } catch {}
      try { event.sender.send("terminal:data", { tabId, data: "\r\n\x1b[33m[terminal closed — write failed: EPIPE]\x1b[0m\r\n" }); } catch {}
      return { ok: false, error: "EPIPE" };
    }
    try { console.error("[terminal:write] failed:", err?.message || err); } catch {}
    return { ok: false, error: err?.message || String(err) };
  }
});

// Shell-aware chdir: cmd.exe needs `cd /d` to switch drives, pwsh/bash work with plain `cd`
ipcMain.handle("terminal:chdir", async (event, { tabId, cwd }) => {
  try {
    if (!tabId || !cwd) return { ok: false };
    const p = termProcesses.get(termKey(event.sender, tabId));
    if (!p) return { ok: false, error: "no pty" };
    const shell = getShell();
    const q = String(cwd).replace(/"/g, '\\"');
    const cmd = /cmd\.exe$/i.test(shell || "") ? `cd /d "${q}"\r` : `cd "${q}"\r`;
    p.write(cmd);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("terminal:resize", async (event, { tabId, cols, rows }) => {
  const p = termProcesses.get(termKey(event.sender, tabId));
  if (!p || cols <= 0 || rows <= 0) return { ok: false };
  try {
    p.resize(cols, rows);
    return { ok: true };
  } catch (err) {
    if (err && (err.code === "EPIPE" || String(err.message || "").includes("EPIPE"))) return { ok: false, error: "EPIPE" };
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle("terminal:close", async (event, { tabId }) => {
  const key = termKey(event.sender, tabId);
  const p = termProcesses.get(key);
  if (p) {
    try { p.kill(); } catch (err) {
      if (!err || (err.code !== "EPIPE" && !String(err.message || "").includes("EPIPE"))) {
        try { console.error("[terminal:close] kill failed:", err); } catch {}
      }
    }
    termProcesses.delete(key);
  }
  return { ok: true };
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

// ─── Notebook (Jupyter-like cell execution, no jupyter dependency) ──────────
// Persistent per-file Python process running a small runner loop on stdin.
// Protocol (utf-8, byte-counted):
//   main  -> kernel: "__IBX_RUN__ <id> <byteLen>\n" + <code bytes> + "\n"
//   kernel -> main : "__IBX_OUT__ <id> <jsonLen>\n" + <json bytes> + "\n__IBX_END__ <id>\n"
// JSON payload: { status, stdout, stderr, result, displays[], error }
// State (variables, imports, functions) persists across cells until restart.
const notebookSessions = new Map(); // normFilePath -> { proc, buf, pending, execCounter, cwd, python, version, starting }
let _notebookPythonCache = null;

const notebookNorm = (p) => { try { return String(p || "").replace(/\\/g, "/"); } catch { return String(p); } };

function notebookDetectPython() {
  return new Promise((resolve) => {
    if (_notebookPythonCache) return resolve(_notebookPythonCache);
    const candidates = process.platform === "win32"
      ? [["python", []], ["python3", []], ["py", ["-3"]]]
      : [["python3", []], ["python", []]];
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        _notebookPythonCache = { ok: false, error: "Python not found. Install Python 3 and ensure `python` / `python3` is on PATH." };
        return resolve(_notebookPythonCache);
      }
      const [cmd, extra] = candidates[i++];
      let child = null;
      try {
        child = spawn(cmd, [...extra, "--version"], { windowsHide: true, timeout: 8000 });
      } catch (e) { tryNext(); return; }
      let out = "";
      try {
        child.stdout?.on("data", (d) => { out += String(d); });
        child.stderr?.on("data", (d) => { out += String(d); });
      } catch {}
      const done = (ok) => {
        try { child.kill(); } catch {}
        if (ok) {
          const m = String(out).match(/Python\s+([\d.]+)/i);
          _notebookPythonCache = { ok: true, python: cmd, args: extra, version: m ? m[1] : String(out).trim().slice(0, 32) };
          return resolve(_notebookPythonCache);
        }
        tryNext();
      };
      child.on("error", () => done(false));
      child.on("exit", (code) => done(code === 0 || /python/i.test(out)));
      setTimeout(() => { try { child.kill(); } catch {} done(/python/i.test(out)); }, 8000);
    };
    tryNext();
  });
}

// Runner loop: stateful globals + stdout/stderr capture + last-expr display +
// display() collector + matplotlib inline figures. input() is stubbed — the
// kernel's stdin carries the run protocol, so interactive input can't work.
const NOTEBOOK_RUNNER_CODE = `
import sys, io, json, ast, traceback, base64
user_ns = {"__name__": "__main__"}
exec_count = 0
_real_stdout = sys.__stdout__
_real_stderr = sys.__stderr__
_pending_displays = []
def display(*objs, **kwargs):
    for o in objs:
        try:
            d = {}
            if hasattr(o, "_repr_png_"):
                try:
                    v = o._repr_png_()
                    if v:
                        import base64 as _b
                        d["image/png"] = _b.b64encode(v if isinstance(v, (bytes, bytearray)) else str(v).encode()).decode()
                except Exception: pass
            if hasattr(o, "_repr_html_"):
                try:
                    v = o._repr_html_()
                    if v: d["text/html"] = str(v)
                except Exception: pass
            if hasattr(o, "_repr_svg_"):
                try:
                    v = o._repr_svg_()
                    if v: d["image/svg+xml"] = str(v)
                except Exception: pass
            if not d:
                try: d["text/plain"] = repr(o)
                except Exception: d["text/plain"] = str(o)
            _pending_displays.append(d)
        except Exception: pass
user_ns["display"] = display
try:
    import builtins as _bi
    _orig_input = _bi.input
    def _no_input(*a, **k):
        raise EOFError("input() is not supported in Idiot Box notebooks — run interactive prompts in the Terminal instead.")
    _bi.input = _no_input
except Exception: pass
def _emit(exec_id, payload):
    # NOTE: framing goes through the BINARY buffer only. Text-mode stdout
    # on Windows rewrites newlines, which would corrupt byte counts.
    try:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        _outbuf = _real_stdout.buffer
        _outbuf.write(("__IBX_OUT__ %s %d\\n" % (exec_id, len(data))).encode("utf-8"))
        _outbuf.write(data)
        _outbuf.write(b"\\n__IBX_END__ " + str(exec_id).encode() + b"\\n")
        _outbuf.flush()
    except Exception:
        try:
            _outbuf = _real_stdout.buffer
            _outbuf.write(("__IBX_OUT__ %s 0\\n\\n__IBX_END__ %s\\n" % (exec_id, exec_id)).encode("utf-8"))
            _outbuf.flush()
        except Exception: pass
def _capture_matplotlib():
    figs = []
    try:
        import matplotlib
        try: matplotlib.use("Agg")
        except Exception: pass
        import matplotlib.pyplot as plt
        try: nums = plt.get_fignums()
        except Exception: nums = []
        for n in nums:
            try:
                fig = plt.figure(n)
                buf = io.BytesIO()
                fig.savefig(buf, format="png", bbox_inches="tight")
                figs.append({"image/png": base64.b64encode(buf.getvalue()).decode()})
            except Exception: pass
        try: plt.close("all")
        except Exception: pass
    except Exception: pass
    return figs
_stdin_buf = sys.stdin.buffer
def _readline():
    line = _stdin_buf.readline()
    if not line: return None
    return line.decode("utf-8", "replace")
_real_stdout.buffer.write(b"__IBX_READY__\\n"); _real_stdout.buffer.flush()
while True:
    try:
        header = _readline()
        if header is None: break
        header = header.strip()
        if not header: continue
        if header == "__IBX_EXIT__":
            break
        parts = header.split()
        if len(parts) != 3 or parts[0] != "__IBX_RUN__":
            continue
        _, exec_id, nstr = parts
        try: n = int(nstr)
        except Exception: continue
        raw = b""
        while len(raw) < n:
            chunk = _stdin_buf.read(n - len(raw))
            if not chunk: break
            raw += chunk
        try: _stdin_buf.readline()
        except Exception: pass
        try: code = raw.decode("utf-8", "replace")
        except Exception: code = ""
        exec_count += 1
        _pending_displays = []
        stdout_buf = io.StringIO(); stderr_buf = io.StringIO()
        _old_out, _old_err = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = stdout_buf, stderr_buf
        status = "ok"; result = None; err = None
        try:
            try: tree = ast.parse(code)
            except SyntaxError:
                raise
            last_val = None; has_expr = False
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                has_expr = True
                mod = ast.Module(body=tree.body[:-1], type_ignores=[])
                try: ast.fix_missing_locations(mod)
                except Exception: pass
                exec(compile(mod, "<cell>", "exec"), user_ns)
                try:
                    expr = ast.Expression(body=tree.body[-1].value)
                    try: ast.fix_missing_locations(expr)
                    except Exception: pass
                    last_val = eval(compile(expr, "<cell>", "eval"), user_ns)
                except Exception:
                    raise
                if last_val is not None:
                    try: result = repr(last_val)
                    except Exception:
                        try: result = str(last_val)
                        except Exception: result = None
            else:
                exec(compile(tree, "<cell>", "exec"), user_ns)
        except Exception as e:
            status = "error"
            try:
                tb = traceback.format_exception(type(e), e, e.__traceback__)
                # Drop the runner's own <string> frame — only <cell> matters.
                tb = [ln for ln in tb if "<string>" not in ln]
                err = {"ename": type(e).__name__, "evalue": str(e), "traceback": tb}
            except Exception:
                err = {"ename": "Error", "evalue": str(e), "traceback": [str(e)]}
        finally:
            sys.stdout, sys.stderr = _old_out, _old_err
        figs = _capture_matplotlib()
        displays = list(_pending_displays) + list(figs)
        _emit(exec_id, {"status": status, "stdout": stdout_buf.getvalue(), "stderr": stderr_buf.getvalue(), "result": result, "displays": displays, "error": err, "execution_count": exec_count})
    except Exception as e:
        try: _emit("unknown", {"status": "error", "stdout": "", "stderr": "", "result": None, "displays": [], "error": {"ename": "KernelError", "evalue": str(e), "traceback": []}, "execution_count": exec_count})
        except Exception: pass
`;

function notebookPump(session) {
  // Parse buffered kernel stdout into completed executions.
  try {
    let str = session.buf.toString("utf8");
    for (;;) {
      // Tolerate \r\n (Windows pipe translation from older kernels) as well
      // as pure \n framing.
      const hm = str.match(/__IBX_OUT__[ \t]+(\S+)[ \t]+(\d+)\r?\n/);
      if (!hm) break;
      const execId = hm[1];
      const jsonLen = parseInt(hm[2], 10);
      const headerStart = hm.index;
      if (!Number.isFinite(jsonLen) || jsonLen < 0 || jsonLen > 64 * 1024 * 1024) {
        // Poisoned header — skip past it to resync rather than wedge the kernel.
        const skip = Buffer.byteLength(str.slice(0, headerStart + hm[0].length), "utf8");
        session.buf = session.buf.slice(skip);
        str = session.buf.toString("utf8");
        continue;
      }
      // Headers are ASCII so char offset == byte offset up to headerStart.
      const headerByteStart = Buffer.byteLength(str.slice(0, headerStart), "utf8");
      const headerByteLen = Buffer.byteLength(hm[0], "utf8");
      const jsonByteStart = headerByteStart + headerByteLen;
      const marker = Buffer.from("__IBX_END__ " + execId, "utf8");
      const mIdx = session.buf.indexOf(marker, jsonByteStart + jsonLen);
      if (mIdx < 0 || mIdx > jsonByteStart + jsonLen + 4) break; // wait for more data
      let lineEnd = session.buf.indexOf(0x0a, mIdx); // '\n'
      if (lineEnd < 0) break; // wait for more data
      lineEnd += 1;
      let payload = null;
      try {
        const jsonBytes = session.buf.slice(jsonByteStart, jsonByteStart + jsonLen);
        payload = JSON.parse(jsonBytes.toString("utf8"));
      } catch (e) {
        payload = { status: "error", stdout: "", stderr: "", result: null, displays: [], error: { ename: "KernelError", evalue: "Bad kernel response: " + (e?.message || e), traceback: [] } };
      }
      // Consume through end of the marker line
      session.buf = session.buf.slice(lineEnd);
      str = session.buf.toString("utf8");
      const pend = session.pending.get(execId);
      if (pend) {
        session.pending.delete(execId);
        try { clearTimeout(pend.timer); } catch {}
        try { pend.resolve({ ok: true, python: session.python, ...payload }); } catch {}
      }
    }
  } catch (e) {
    try { console.error("[notebook] pump failed:", e?.message || e); } catch {}
  }
}

function notebookEnsureSession(filePath, cwd) {
  return new Promise(async (resolve) => {
    const key = notebookNorm(filePath || cwd || "global");
    const existing = notebookSessions.get(key);
    if (existing && existing.proc && !existing.proc.killed && existing.proc.exitCode === null) {
      return resolve({ ok: true, session: existing });
    }
    if (existing) { try { existing.proc?.kill(); } catch {} notebookSessions.delete(key); }
    const det = await notebookDetectPython();
    if (!det.ok) return resolve({ ok: false, error: det.error });
    const workDir = cwd || (() => { try { return path.dirname(String(filePath)); } catch { return process.cwd(); } })();
    let proc = null;
    try {
      const pyArgs = [...(det.args || []), "-u", "-c", NOTEBOOK_RUNNER_CODE];
      proc = spawn(det.python, pyArgs, { cwd: workDir, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8", MPLBACKEND: "Agg" } });
    } catch (e) {
      return resolve({ ok: false, error: "Could not start Python: " + (e?.message || e) });
    }
    const session = { proc, buf: Buffer.alloc(0), pending: new Map(), execCounter: 0, cwd: workDir, python: det.python, version: det.version, key, ready: false, readyWaiters: [] };
    notebookSessions.set(key, session);
    const onData = (d) => {
      try {
        // Swallow the ready banner — it is not part of any execution.
        let s = String(d);
        if (!session.ready && s.includes("__IBX_READY__")) {
          session.ready = true;
          s = s.replace("__IBX_READY__\n", "").replace("__IBX_READY__", "");
          try { session.readyWaiters.forEach((w) => w()); session.readyWaiters = []; } catch {}
          if (!s) return;
          d = Buffer.from(s, "utf8");
        }
        session.buf = Buffer.concat([session.buf, Buffer.isBuffer(d) ? d : Buffer.from(String(d), "utf8")]);
        if (session.buf.length > 32 * 1024 * 1024) {
          // Safety: drop oldest bytes rather than ballooning forever.
          session.buf = session.buf.slice(session.buf.length - 32 * 1024 * 1024);
        }
        notebookPump(session);
      } catch (e) { try { console.error("[notebook] onData failed:", e?.message || e); } catch {} }
    };
    try {
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", (d) => {
        // Kernel-level stderr (outside cell capture) — surface only when no
        // pending execution can own it, to avoid confusing cell outputs.
        try {
          const msg = String(d);
          if (!msg.trim()) return;
          if (session.pending.size === 0) console.error("[notebook:kernel-stderr]", msg.slice(0, 2000));
        } catch {}
      });
    } catch {}
    const failAll = (msg) => {
      try {
        for (const [, pend] of session.pending) {
          try { clearTimeout(pend.timer); } catch {}
          try { pend.resolve({ ok: false, error: msg }); } catch {}
        }
        session.pending.clear();
      } catch {}
      try { session.readyWaiters.forEach((w) => w()); session.readyWaiters = []; } catch {}
    };
    proc.on("error", (e) => {
      try { console.error("[notebook] kernel spawn error:", e?.message || e); } catch {}
      notebookSessions.delete(key);
      failAll("Python kernel failed to start: " + (e?.message || e));
    });
    proc.on("exit", (code) => {
      if (notebookSessions.get(key) === session) notebookSessions.delete(key);
      failAll("Python kernel exited (code " + code + "). Restart the kernel and run again.");
    });
    // Wait for ready banner (max 15s), then resolve.
    const t0 = Date.now();
    const waitReady = () => {
      if (session.ready) return resolve({ ok: true, session });
      if (Date.now() - t0 > 15000) {
        try { proc.kill(); } catch {}
        notebookSessions.delete(key);
        return resolve({ ok: false, error: "Python kernel did not start in time (" + det.python + " " + (det.version || "") + ")." });
      }
      setTimeout(waitReady, 60);
    };
    waitReady();
  });
}

ipcMain.handle("notebook:checkPython", async () => {
  try { return await notebookDetectPython(); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

ipcMain.handle("notebook:execute", async (_e, { filePath, code, cwd, timeoutMs } = {}) => {
  const src = String(code ?? "");
  if (!src.trim()) return { ok: true, status: "ok", stdout: "", stderr: "", result: null, displays: [], error: null };
  if (src.length > 2 * 1024 * 1024) return { ok: false, error: "Cell too large (>2MB) — split it into smaller cells." };
  const ensured = await notebookEnsureSession(filePath, cwd);
  if (!ensured.ok) return ensured;
  const session = ensured.session;
  const execId = "e" + (++session.execCounter) + "_" + Date.now().toString(36);
  const timeout = Math.min(Math.max(Number(timeoutMs) || 60000, 5000), 600000);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { session.pending.delete(execId); } catch {}
      // A hung cell (infinite loop) would wedge the kernel for every later
      // cell — kill it so the next run starts fresh instead of hanging too.
      try { session.proc?.kill(); } catch {}
      try { notebookSessions.delete(session.key); } catch {}
      resolve({ ok: false, error: "Timed out after " + Math.round(timeout / 1000) + "s — kernel restarted. Check for infinite loops or blocking input()." });
    }, timeout);
    session.pending.set(execId, { resolve, timer });
    try {
      const bytes = Buffer.from(src, "utf8");
      session.proc.stdin.write("__IBX_RUN__ " + execId + " " + bytes.length + "\n", "utf8");
      session.proc.stdin.write(bytes);
      session.proc.stdin.write("\n", "utf8");
    } catch (e) {
      try { clearTimeout(timer); } catch {}
      try { session.pending.delete(execId); } catch {}
      resolve({ ok: false, error: "Kernel write failed: " + (e?.message || e) });
    }
  });
});

ipcMain.handle("notebook:restart", async (_e, { filePath, cwd } = {}) => {
  try {
    const key = notebookNorm(filePath || cwd || "global");
    const s = notebookSessions.get(key);
    if (s) {
      try { s.proc?.stdin?.write("__IBX_EXIT__\n"); } catch {}
      try { s.proc?.kill(); } catch {}
      try {
        for (const [, pend] of s.pending) {
          try { clearTimeout(pend.timer); } catch {}
          try { pend.resolve({ ok: false, error: "Kernel restarted." }); } catch {}
        }
      } catch {}
      notebookSessions.delete(key);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
});

try {
  app.on("before-quit", () => {
    try {
      for (const [, s] of notebookSessions) { try { s.proc?.kill(); } catch {} }
      notebookSessions.clear();
    } catch {}
  });
} catch {}

ipcMain.handle("panel:addMenu", async (event) => {
  return new Promise((resolve) => {
    const act = (action) => resolve({ action });
    const items = [
      { label: "Browser", click: () => act("browser") },
      { label: "Terminal", click: () => act("terminal") },
      { label: "AI Panel", click: () => act("ai") },
      { label: "Android Emulator", click: () => act("android") },
    ];
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

// ─── Live Server (static file server for HTML preview) ────────────────────────
const net = require("net");
const http = require("http");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".htm":  "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif":  "image/gif",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml; charset=utf-8",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
  ".txt":  "text/plain; charset=utf-8",
};
const liveServers = new Map(); // rootPath -> { server, port, clients, watcher }

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

const LIVE_RELOAD_SCRIPT = `<script>(function(){try{var es=new EventSource('/__live_reload');es.onmessage=function(e){if(e.data==='reload')location.reload();};es.onerror=function(){};console.log('[LiveServer] auto-reload enabled');}catch(e){}})();</script>`;

function broadcastLiveReload(lsRoot) {
  const entry = liveServers.get(lsRoot);
  if (!entry || !entry.clients) return;
  for (const res of [...entry.clients]) {
    try { res.write('data: reload\n\n'); } catch { try { entry.clients.delete(res); } catch {} }
  }
}

ipcMain.handle("liveServer:start", async (_e, { rootPath: lsRoot, filePath: lsFile }) => {
  // Reuse an already-running server for this project root
  if (liveServers.has(lsRoot)) {
    const { port } = liveServers.get(lsRoot);
    const rel = path.relative(lsRoot, lsFile).replace(/\\/g, "/");
    return { url: `http://127.0.0.1:${port}/${rel}`, port };
  }

  const port = await getFreePort();
  const clients = new Set();
  let debounceTimer = null;
  const scheduleReload = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => broadcastLiveReload(lsRoot), 120);
  };

  // ── File watcher for live reload ───────────────────────────────
  let watcher = null;
  if (chokidar) {
    try {
      watcher = chokidar.watch(lsRoot, {
        ignored: /[\\\/](node_modules|\.git|dist|\.next|out|build|__pycache__)[\\\/]/,
        persistent: true,
        ignoreInitial: true,
        depth: 99,
      });
      watcher.on('all', (ev) => {
        if (['change', 'add', 'unlink'].includes(ev)) scheduleReload();
      });
      watcher.on('error', (err) => console.warn('[LiveServer] watcher error', err?.message));
    } catch (e) { console.warn('[LiveServer] watcher failed', e.message); }
  } else if (process.platform === "win32" || process.platform === "darwin") {
    // Fallback: fs.watch recursive (Windows/macOS only — unsupported on Linux)
    try {
      watcher = fs.watch(lsRoot, { recursive: true }, (ev) => {
        if (['change', 'rename'].includes(ev)) scheduleReload();
      });
    } catch {}
  } else {
    console.warn("[LiveServer] chokidar not available — live reload disabled on Linux (run `npm install`)");
  }

  const server = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent(req.url.split("?")[0]);

      // ── SSE endpoint for live reload ──────────────────────────
      if (urlPath === "/__live_reload") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
        });
        res.write("data: connected\n\n");
        clients.add(res);
        req.on("close", () => { try { clients.delete(res); } catch {} });
        return;
      }

      if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
      const filePath = path.join(lsRoot, urlPath);
      // Security: prevent directory traversal outside root
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(lsRoot))) {
        res.writeHead(403); res.end("Forbidden"); return;
      }
      fs.readFile(resolved, (err, data) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end(`Not found: ${urlPath}`);
          return;
        }
        const ext = path.extname(resolved).toLowerCase();
        const ct  = mime[ext] || "application/octet-stream";
        // Inject live-reload script into HTML files
        if (ext === ".html" || ext === ".htm") {
          try {
            let html = data.toString("utf8");
            if (!html.includes("__live_reload")) {
              if (html.includes("</body>")) html = html.replace("</body>", LIVE_RELOAD_SCRIPT + "</body>");
              else if (html.includes("</html>")) html = html.replace("</html>", LIVE_RELOAD_SCRIPT + "</html>");
              else html += LIVE_RELOAD_SCRIPT;
            }
            const buf = Buffer.from(html, "utf8");
            res.writeHead(200, {
              "Content-Type": ct,
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-cache, no-store, must-revalidate",
            });
            res.end(buf);
            return;
          } catch {}
        }
        res.writeHead(200, {
          "Content-Type": ct,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
        res.end(data);
      });
    } catch (e) {
      try { res.writeHead(500); res.end(String(e)); } catch {}
    }
  });

  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", resolve);
    server.once("error", reject);
  });

  liveServers.set(lsRoot, { server, port, clients, watcher });

  // Clean up when the server closes
  server.on("close", () => {
    try { if (watcher) { watcher.close?.(); watcher.removeAllListeners?.(); } } catch {}
    try { for (const c of clients) { try { c.end(); } catch {} } clients.clear(); } catch {}
    liveServers.delete(lsRoot);
  });

  const rel = path.relative(lsRoot, lsFile).replace(/\\/g, "/");
  return { url: `http://127.0.0.1:${port}/${rel}`, port };
});

// ─── Auto Updater (electron-updater) — Proper Update Cycle with Progress Bar ───
// Cycle: idle → checking → available → downloading (progress: percent, transferred, total, bytesPerSecond, ETA) → downloaded → installing → idle
//         ↘ not-available / error → idle
// Manual check shows center modal; auto checks only banner when available. Periodic check every 6h + 2s launch.
let _updaterWindow = null;
let _updaterState = "idle"; // idle | checking | available | downloading | downloaded | error
let _latestUpdateInfo = null;
let _downloadProgress = null;
let _isDownloading = false;

function isVersionNewer(latest, current) {
  const a = String(latest).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(current).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0, bv = b[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

function broadcastUpdater(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) {
    try { if (!w.isDestroyed()) w.webContents.send(channel, data); } catch {}
  }
}
function setUpdaterState(s, data) {
  _updaterState = s;
  // also broadcast a generic state event if needed
  try { broadcastUpdater("updater:state", { state: s, info: _latestUpdateInfo, progress: _downloadProgress }); } catch {}
}

async function checkForUpdatesViaGitHub(win) {
  const targetWins = win && !win.isDestroyed() ? [win] : BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed());
  const primaryWin = targetWins[0] || null;
  try {
    const current = app.getVersion();
    setUpdaterState("checking");
    _latestUpdateInfo = null;
    _downloadProgress = null;
    broadcastUpdater("updater:checking", { version: current });
    console.log(`[updater] cycle: checking current=${current}`);
    // Use GitHub API directly — works in dev and packaged, no need for app-update.yml
    const res = await fetch("https://api.github.com/repos/TheWonderlandStudio/Idiot_Box/releases/latest", {
      headers: { "User-Agent": "IdiotBox-Updater", "Accept": "application/vnd.github.v3+json" },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    const latestTag = data.tag_name || data.name || "";
    const latestVersion = String(latestTag).replace(/^v/, "").trim();
    console.log(`[updater] GitHub check current=${current} latest=${latestVersion}`);
    if (!latestVersion) throw new Error("No version in GitHub response");
    if (isVersionNewer(latestVersion, current)) {
      const info = {
        version: latestVersion,
        releaseNotes: data.body || "",
        releaseUrl: data.html_url,
        tag: data.tag_name,
        publishedAt: data.published_at,
        assets: data.assets || [],
      };
      _latestUpdateInfo = info;
      setUpdaterState("available");
      console.log("[updater] cycle: available", latestVersion);
      broadcastUpdater("updater:available", info);
      // Prime autoUpdater so subsequent downloadUpdate() knows what to fetch (only when packaged)
      if (app.isPackaged && autoUpdater) {
        try { autoUpdater.checkForUpdates().catch(() => {}); } catch {}
      }
      return info;
    } else {
      console.log("[updater] cycle: not-available");
      setUpdaterState("idle");
      broadcastUpdater("updater:not-available", { version: current });
      return null;
    }
  } catch (e) {
    console.warn("[updater] GitHub check failed:", e.message);
    // Fallback to electron-updater's built-in check (needs latest.yml, only works when packaged)
    if (autoUpdater && app.isPackaged) {
      try {
        const res = await autoUpdater.checkForUpdates();
        const info = res?.updateInfo || null;
        if (info && isVersionNewer(info.version, app.getVersion())) {
          _latestUpdateInfo = info;
          setUpdaterState("available");
          broadcastUpdater("updater:available", info);
          return info;
        } else {
          setUpdaterState("idle");
          if (primaryWin) broadcastUpdater("updater:not-available", { version: app.getVersion() });
          return null;
        }
      } catch (e2) {
        console.warn("[updater] fallback check also failed:", e2.message);
        setUpdaterState("error");
        broadcastUpdater("updater:error", String(e.message || e2.message));
      }
    } else {
      setUpdaterState("error");
      broadcastUpdater("updater:error", String(e.message));
    }
    return null;
  }
}

function setupAutoUpdater(win) {
  if (!autoUpdater) { console.warn("[updater] electron-updater not installed"); return; }
  _updaterWindow = win;
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    try { if (autoUpdater.logger && autoUpdater.logger.transports && autoUpdater.logger.transports.file) autoUpdater.logger.transports.file.level = "info"; } catch {}

    // Always attach listeners so manual "Check for Updates" works even in dev
    autoUpdater.removeAllListeners("checking-for-update");
    autoUpdater.removeAllListeners("update-available");
    autoUpdater.removeAllListeners("update-not-available");
    autoUpdater.removeAllListeners("error");
    autoUpdater.removeAllListeners("download-progress");
    autoUpdater.removeAllListeners("update-downloaded");

    autoUpdater.on("checking-for-update", () => {
      console.log("[updater] cycle: checking-for-update (autoUpdater)");
      setUpdaterState("checking");
      broadcastUpdater("updater:checking", { version: app.getVersion() });
    });
    autoUpdater.on("update-available", (info) => {
      console.log("[updater] cycle: update-available (autoUpdater)", info?.version);
      _latestUpdateInfo = info;
      setUpdaterState("available");
      broadcastUpdater("updater:available", info);
    });
    autoUpdater.on("update-not-available", (info) => {
      console.log("[updater] cycle: update-not-available (autoUpdater)", info?.version);
      // Don't override available/downloading/downloaded with idle race
      if (_updaterState === "available" || _updaterState === "downloading" || _updaterState === "downloaded") return;
      setUpdaterState("idle");
      broadcastUpdater("updater:not-available", info);
    });
    autoUpdater.on("error", (err) => {
      console.error("[updater] cycle: error", err?.message || err);
      _isDownloading = false;
      _downloadProgress = null;
      setUpdaterState("error");
      broadcastUpdater("updater:error", String(err?.message || err));
    });
    autoUpdater.on("download-progress", (p) => {
      // p: { percent, transferred, total, bytesPerSecond, delta, total, ... }
      _isDownloading = true;
      _downloadProgress = p;
      setUpdaterState("downloading");
      // Ensure percent is 0-100
      const pct = Math.min(100, Math.max(0, Math.round(p.percent || 0)));
      console.log(`[updater] cycle: downloading ${pct}% ${((p.transferred||0)/1024/1024).toFixed(1)}MB / ${((p.total||0)/1024/1024).toFixed(1)}MB @ ${((p.bytesPerSecond||0)/1024/1024).toFixed(2)} MB/s`);
      broadcastUpdater("updater:progress", p);
    });
    autoUpdater.on("update-downloaded", (info) => {
      console.log("[updater] cycle: downloaded", info?.version);
      _isDownloading = false;
      _downloadProgress = null;
      _latestUpdateInfo = info || _latestUpdateInfo;
      setUpdaterState("downloaded");
      broadcastUpdater("updater:downloaded", info || _latestUpdateInfo);
    });

    // Run detection on launch — use GitHub API so banner shows even in dev.
    const runGitHubCheck = () => { try { checkForUpdatesViaGitHub(win); } catch (e) { console.warn("[updater] GitHub check error", e.message); } };
    if (!app.isPackaged && !process.env.IBX_FORCE_UPDATE_CHECK) {
      console.log("[updater] Dev mode: running GitHub API check after 2.5s (autoUpdater periodic check skipped)");
      setTimeout(runGitHubCheck, 2500);
      setInterval(runGitHubCheck, 6 * 60 * 60 * 1000);
      return;
    }

    // Packaged: run both GitHub API and autoUpdater checks for best coverage
    setTimeout(() => { try { console.log("[updater] initial check (GitHub + autoUpdater)..."); runGitHubCheck(); autoUpdater.checkForUpdates().catch((e) => console.warn("[updater] autoUpdater check failed", e.message)); } catch {} }, 2000);
    setInterval(() => { try { console.log("[updater] periodic check..."); runGitHubCheck(); autoUpdater.checkForUpdates().catch(()=>{}); } catch {} }, 6 * 60 * 60 * 1000);
  } catch (e) { console.warn("[updater] setup failed", e.message); }
}

ipcMain.handle("updater:check", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || _updaterWindow;
  try {
    // Reset state to checking for proper cycle
    setUpdaterState("checking");
    broadcastUpdater("updater:checking", { version: app.getVersion() });
    const info = await checkForUpdatesViaGitHub(win);
    if (info) return { ok: true, info, available: true, state: _updaterState };
    return { ok: true, info: null, available: false, state: _updaterState };
  } catch (err) {
    setUpdaterState("error");
    return { error: err?.message || String(err), state: _updaterState };
  }
});
ipcMain.handle("updater:download", async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) || _updaterWindow;
  if (!app.isPackaged) {
    try { shell.openExternal("https://github.com/TheWonderlandStudio/Idiot_Box/releases/latest"); } catch {}
    return { ok: true, manual: true, message: "Opened releases page (not packaged — manual download)" };
  }
  if (!autoUpdater) return { error: "updater not available" };
  if (_isDownloading) return { ok: false, error: "Already downloading" };
  if (_updaterState === "downloaded" && _latestUpdateInfo) return { ok: true, alreadyDownloaded: true, info: _latestUpdateInfo };
  try {
    _isDownloading = true;
    setUpdaterState("downloading");
    if (win && !win.isDestroyed()) win.webContents.send("updater:progress", { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    else broadcastUpdater("updater:progress", { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    // Prime with latest info if not already checked
    if (!_latestUpdateInfo) {
      try { await autoUpdater.checkForUpdates(); } catch {}
    }
    await autoUpdater.downloadUpdate();
    // progress will be emitted via download-progress, downloaded via update-downloaded
    return { ok: true };
  } catch (e) {
    _isDownloading = false;
    setUpdaterState("error");
    broadcastUpdater("updater:error", String(e?.message || e));
    return { error: e?.message || String(e) };
  }
});
ipcMain.handle("updater:install", async () => {
  if (!autoUpdater) return { error: "updater not available" };
  try {
    setUpdaterState("installing");
    autoUpdater.quitAndInstall(false, true);
  } catch (e) { setUpdaterState("error"); return { error: e?.message || String(e) }; }
  return { ok: true };
});
ipcMain.handle("updater:getVersion", async () => {
  try { return { version: app.getVersion(), state: _updaterState, info: _latestUpdateInfo }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle("updater:getState", async () => {
  return { state: _updaterState, info: _latestUpdateInfo, progress: _downloadProgress, version: app.getVersion() };
});

// ─── Port Manager — detect listening ports & manage forwarding ────────────────
const forwardedPorts = new Map(); // port(string) -> { label, createdAt }
const autoDetectedPorts = new Map(); // port -> { lastSeen, source }
let _portPidCache = { map: new Map(), ts: 0 };

function execOutAsync(cmd, args, timeout = 4000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout || "");
    });
  });
}

async function getListeningWindows() {
  const out = await execOutAsync("netstat", ["-ano"], 4500);
  const lines = out.split("\n");
  const raw = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // Example: TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345
    //          TCP    [::]:5173             [::]:0                 LISTENING       6789
    if (!/LISTENING/i.test(t)) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 4) continue;
    const proto = parts[0].toUpperCase();
    if (proto !== "TCP" && proto !== "TCPv6") continue;
    const local = parts[1];
    const pidStr = parts[parts.length - 1];
    const pid = parseInt(pidStr, 10);
    if (!pid || isNaN(pid)) continue;
    // extract port — last :port
    const pm = local.match(/:(\d+)\s*$/);
    if (!pm) continue;
    const port = parseInt(pm[1], 10);
    if (!port || port < 1 || port > 65535) continue;
    // extract address part before :port — keep brackets
    let address = local.slice(0, local.lastIndexOf(":"));
    if (!address) address = "0.0.0.0";
    // normalize
    if (address === "0.0.0.0" || address === "[::]" || address === "::") address = "0.0.0.0";
    raw.push({ port, pid, address, proto: "TCP", state: "LISTEN", source: "netstat" });
  }
  return raw;
}

async function enrichWindows(ports) {
  if (!ports.length) return ports;
  // cache tasklist for 3s
  if (Date.now() - _portPidCache.ts < 3000 && _portPidCache.map.size) {
    for (const p of ports) p.process = _portPidCache.map.get(String(p.pid)) || p.process || "";
    return ports;
  }
  try {
    const out = await execOutAsync("tasklist", ["/FO", "CSV", "/NH"], 4000);
    const map = new Map();
    for (const line of out.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      // CSV: "Image Name","PID","Session Name","Session#","Mem Usage"
      // naive split respecting quotes
      const cols = [];
      let cur = "", inQ = false;
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === "," && !inQ) { cols.push(cur); cur = ""; continue; }
        cur += ch;
      }
      cols.push(cur);
      if (cols.length >= 2) {
        const name = (cols[0] || "").trim();
        const pid = (cols[1] || "").trim();
        if (pid && name) map.set(pid, name);
      }
    }
    _portPidCache = { map, ts: Date.now() };
    for (const p of ports) p.process = map.get(String(p.pid)) || p.process || "";
  } catch {}
  return ports;
}

async function getListeningUnixLsof() {
  // lsof -iTCP -sTCP:LISTEN -n -P
  const out = await execOutAsync("lsof", ["-iTCP", "-sTCP:LISTEN", "-n", "-P"], 4000);
  const lines = out.split("\n");
  const raw = [];
  // skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    // NAME field like *:3000 (LISTEN) or 127.0.0.1:5173 (LISTEN) or [::1]:3000
    const m = line.match(/(\S+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(.+)/);
    if (!m) continue;
    const cmd = m[1];
    const pid = parseInt(m[2], 10);
    const nameField = m[3];
    // find :port pattern before space or (
    const pm = nameField.match(/:(\d+)(?:\s|\(|$)/);
    if (!pm) continue;
    const port = parseInt(pm[1], 10);
    if (!port || port < 1 || port > 65535) continue;
    let address = "*";
    const am = nameField.match(/^(\S+):\d+/);
    if (am) address = am[1];
    if (address === "*") address = "0.0.0.0";
    raw.push({ port, pid, address, proto: "TCP", state: "LISTEN", source: "lsof", process: cmd });
  }
  return raw;
}

async function getListeningUnixSs() {
  const trySs = async (cmd) => {
    const out = await execOutAsync(cmd, ["-tlnp"], 4000);
    const lines = out.split("\n");
    const raw = [];
    for (const line of lines) {
      if (!line.includes("LISTEN")) continue;
      // ss -tlnp: State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
      // Local column is 4th field (index 3) for ss, but be flexible: find :port pattern
      const pm = line.match(/(?:\[?[\d\w\.\:\*\]]+):(\d+)\s/);
      if (!pm) continue;
      const port = parseInt(pm[1], 10);
      if (!port || port < 1 || port > 65535) continue;
      // address: extract local addr before port
      let address = "0.0.0.0";
      const addrMatch = line.match(/(\S+):\d+\s/);
      if (addrMatch) {
        // careful: line has multiple :port occurrences; take first (local)
        const first = line.match(/LISTEN\s+\d+\s+\d+\s+(\S+):\d+/);
        if (first) address = first[1];
        else address = addrMatch[1];
      }
      if (address === "*" || address === "0.0.0.0" || address === "::" || address === "[::]") address = "0.0.0.0";
      // process: users:(("node",pid=12345,fd=3))
      let proc = "";
      let pid = null;
      const pidMatch = line.match(/pid=(\d+)/);
      if (pidMatch) pid = parseInt(pidMatch[1], 10);
      const nameMatch = line.match(/users:\(\("([^"]+)"/);
      if (nameMatch) proc = nameMatch[1];
      raw.push({ port, pid, address, proto: "TCP", state: "LISTEN", source: cmd, process: proc });
    }
    return raw;
  };
  try { const lsof = await trySs("ss"); if (lsof.length) return lsof; } catch {}
  try { const nt = await trySs("netstat"); if (nt.length) return nt; } catch {}
  return [];
}

async function enrichUnix(ports) {
  if (!ports.length) return ports;
  // try to fill missing process names via ps
  const missing = ports.filter((p) => !p.process && p.pid);
  if (!missing.length) return ports;
  // batch ps
  try {
    const out = await execOutAsync("ps", ["-A", "-o", "pid=,comm="], 3500);
    const map = new Map();
    for (const line of out.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(.+)$/);
      if (m) map.set(m[1], m[2].trim());
    }
    for (const p of ports) if (!p.process && p.pid) p.process = map.get(String(p.pid)) || p.process || "";
  } catch {}
  return ports;
}

async function enrichWithCommand(ports) {
  if (!ports.length) return ports;
  const withPid = ports.filter((p) => p.pid);
  if (!withPid.length) return ports;
  const fetchCmd = async (pid) => {
    if (process.platform === "win32") {
      try {
        const out = await execOutAsync("wmic", ["process", "where", `ProcessId=${pid}`, "get", "CommandLine", "/value"], 2500);
        const m = out.match(/CommandLine=(.*)/s);
        if (m) {
          const v = m[1].trim().split("\n")[0].trim();
          if (v) return v;
        }
      } catch {}
      try {
        const out2 = await execOutAsync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`], 3000);
        const t = out2.trim().split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
        if (t) return t.slice(0, 600);
      } catch {}
      return "";
    } else {
      try {
        const out = await execOutAsync("ps", ["-p", String(pid), "-o", "args="], 2000);
        return out.trim().slice(0, 800);
      } catch { return ""; }
    }
  };
  // limit concurrency to avoid spawning too many at once
  const CONC = 6;
  for (let i = 0; i < withPid.length; i += CONC) {
    const chunk = withPid.slice(i, i + CONC);
    await Promise.all(chunk.map(async (p) => {
      try {
        const cmd = await fetchCmd(p.pid);
        if (cmd) p.command = cmd;
      } catch {}
    }));
  }
  return ports;
}

async function getListeningPorts() {
  let raw = [];
  if (process.platform === "win32") {
    try { raw = await getListeningWindows(); } catch { raw = []; }
    try { raw = await enrichWindows(raw); } catch {}
  } else {
    // unix: try lsof first, then ss/netstat
    try {
      raw = await getListeningUnixLsof();
      if (!raw.length) raw = await getListeningUnixSs();
      else raw = await enrichUnix(raw);
    } catch {
      try { raw = await getListeningUnixSs(); raw = await enrichUnix(raw); } catch { raw = []; }
    }
    try { raw = await enrichUnix(raw); } catch {}
  }
  // dedupe by port (multiple addresses bind same port)
  const byPort = new Map();
  for (const p of raw) {
    const key = String(p.port);
    if (!byPort.has(key)) byPort.set(key, p);
    else {
      const ex = byPort.get(key);
      // prefer entry with pid/process and non 0.0.0.0? keep most informative
      const score = (x) => (x.pid ? 1 : 0) + (x.process ? 1 : 0) + (x.address !== "0.0.0.0" ? 0.5 : 0);
      if (score(p) > score(ex)) byPort.set(key, p);
    }
  }
  let list = [...byPort.values()];

  // enrich with command line for better project filtering (best effort, non-blocking)
  try { await enrichWithCommand(list); } catch {}

  // merge live servers (IbX internal) — ensure visible even if OS scan missed (race)
  for (const [, { port }] of liveServers) {
    if (!byPort.has(String(port))) {
      list.push({ port, pid: process.pid, process: "Idiot Box — Live Server", address: "127.0.0.1", proto: "TCP", state: "LISTEN", source: "liveServer" });
    } else {
      const e = list.find((x) => x.port === port);
      if (e) { e.source = "liveServer"; e.process = e.process || "Idiot Box — Live Server"; }
    }
  }

  // merge auto-detected terminal ports (not yet listening but seen in terminal output) — show as detected
  for (const [portStr, info] of autoDetectedPorts) {
    const port = parseInt(portStr, 10);
    if (!list.find((x) => x.port === port)) {
      // only keep recent (last 5min)
      if (Date.now() - info.lastSeen < 5 * 60 * 1000) {
        list.push({ port, pid: null, process: info.label || "Terminal", address: "127.0.0.1", proto: "TCP", state: "DETECTED", source: "terminal" });
      }
    }
  }

  // merge forwarded/manual ports (user added) — show even if not listening as forwarded
  for (const [portStr, info] of forwardedPorts) {
    const port = parseInt(portStr, 10);
    if (!list.find((x) => x.port === port)) {
      list.push({ port, pid: null, process: info.label || "Forwarded", address: "localhost", proto: "TCP", state: "FORWARDED", source: "forwarded", forwarded: true });
    } else {
      const e = list.find((x) => x.port === port);
      if (e) e.forwarded = true;
    }
  }

  // ensure each has url and defaults
  for (const p of list) {
    if (!p.process) p.process = p.pid ? `PID ${p.pid}` : (p.source === "forwarded" ? "Forwarded" : "Unknown");
    if (!p.address) p.address = "localhost";
    p.url = `http://localhost:${p.port}`;
    p.localUrl = `http://localhost:${p.port}`;
    p.host = p.address === "0.0.0.0" ? "localhost" : p.address;
  }

  list.sort((a, b) => a.port - b.port);
  return list;
}

function portInUse(host, port, timeout = 1200) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port }, () => { s.end(); resolve(true); });
    s.on("error", () => resolve(false));
    s.setTimeout(timeout, () => { try { s.destroy(); } catch {}; resolve(false); });
  });
}

ipcMain.handle("ports:list", async () => {
  try { return await getListeningPorts(); } catch (e) { console.error("[ports:list] failed:", e); return []; }
});

ipcMain.handle("ports:check", async (_e, port) => {
  const p = parseInt(port, 10);
  if (!p || p < 1 || p > 65535) return { ok: false, error: "Invalid port" };
  const open = await portInUse("127.0.0.1", p).catch(() => false);
  return { ok: true, port: p, open };
});

ipcMain.handle("ports:forward", async (_e, port, label) => {
  const p = parseInt(port, 10);
  if (!p || p < 1 || p > 65535) return { ok: false, error: "Port must be 1–65535" };
  forwardedPorts.set(String(p), { label: String(label || "").slice(0, 80) || "Forwarded", createdAt: Date.now() });
  return { ok: true, port: p };
});

ipcMain.handle("ports:unforward", async (_e, port) => {
  const p = String(parseInt(port, 10));
  if (!forwardedPorts.has(p)) return { ok: false, error: "Not forwarded" };
  forwardedPorts.delete(p);
  // also remove from autoDetected if present
  autoDetectedPorts.delete(p);
  return { ok: true };
});

ipcMain.handle("ports:kill", async (_e, pid) => {
  const n = parseInt(pid, 10);
  if (!n || n <= 0) return { ok: false, error: "Invalid PID" };
  if (n === process.pid) return { ok: false, error: "Refusing to kill Idiot Box itself" };
  try {
    if (process.platform === "win32") {
      await execOutAsync("taskkill", ["/PID", String(n), "/F"], 5000);
    } else {
      process.kill(n, "SIGTERM");
      // give 1.2s then SIGKILL if still around
      await new Promise((r) => setTimeout(r, 1200));
      try { process.kill(n, 0); process.kill(n, "SIGKILL"); } catch {}
    }
    return { ok: true };
  } catch (err) {
    const msg = err?.stderr?.toString?.() || err?.message || String(err);
    // fallback: try taskkill without /F or kill -9 directly
    try {
      if (process.platform === "win32") await execOutAsync("taskkill", ["/PID", String(n)], 3000);
      else { try { process.kill(n, "SIGKILL"); } catch {}}
      return { ok: true };
    } catch (e2) {
      return { ok: false, error: msg.slice(0, 280) };
    }
  }
});

ipcMain.handle("ports:clearAutoDetected", async () => {
  autoDetectedPorts.clear();
  return { ok: true };
});

// helper to register terminal port sniffing — called from terminal onData
function sniffPortsFromTerminalOutput(data) {
  if (!data || typeof data !== "string") return;
  const re = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\s*:\s*)(\d{2,5})/gi;
  let m;
  while ((m = re.exec(data)) !== null) {
    const port = parseInt(m[1], 10);
    if (!port || port < 1 || port > 65535) continue;
    // ignore common false positives like 0, 1? ignore well-known <1024 except 3000 etc? keep all 1024+
    // keep all but filter obviously not dev ports > 1024 or common 80/443 allowed
    // we store anyway, will be shown as detected if not already listening
    const key = String(port);
    if (!autoDetectedPorts.has(key) || Date.now() - (autoDetectedPorts.get(key)?.lastSeen || 0) > 5000) {
      autoDetectedPorts.set(key, { lastSeen: Date.now(), label: "Terminal" });
    }
  }
}

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
function openSettingsWindow(initialPage) {
  const page = typeof initialPage === "string" && initialPage ? initialPage : null;
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    // Already open — navigate to requested page (e.g. extensions)
    if (page) { try { settingsWin.webContents.send("settings:navigate", page); } catch {} }
    return;
  }
  settingsWin = new BrowserWindow({
    width: 780, height: 520, minWidth: 600, minHeight: 400,
    title: "Settings", backgroundColor: "#1a1a1a",
    icon: path.join(__dirname, "../renderer/assets/idot_box.png"),
    parent: BrowserWindow.getAllWindows()[0], modal: false, show: false,
    webPreferences: { preload: path.join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.setMenuBarVisibility(false);
  // Apply persisted UI zoom to settings window as well
  try {
    const iz = getUiZoomFactor();
    if (iz !== 1) settingsWin.webContents.setZoomFactor(iz);
  } catch {}
  settingsWin.loadFile(path.join(__dirname, "../renderer/settings.html"), page ? { query: { page } } : undefined);
  settingsWin.once("ready-to-show", () => settingsWin.show());
  settingsWin.on("closed", () => { settingsWin = null; });
}

ipcMain.handle("settings:openWindow", (_e, initialPage) => openSettingsWindow(initialPage));

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
        { label: "Save All",        accelerator: "CmdOrCtrl+Alt+S",      click: () => sendToRenderer("menu:saveFile", null) },
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
        { type: "separator" },
        // NOTE: no accelerators here on purpose — these keys are already bound
        // inside Monaco (Ctrl+/, Shift+Alt+Down, Shift+Alt+F, Ctrl+G,
        // Ctrl+Shift+O). A native accelerator would fire AND Monaco would fire
        // (double toggle). Menu = discoverability + mouse access.
        { label: "Toggle Line Comment", click: () => sendToRenderer("menu:commentLine", null) },
        { label: "Duplicate Line Down", click: () => sendToRenderer("menu:copyLineDown", null) },
        { label: "Move Line Up", click: () => sendToRenderer("menu:moveLineUp", null) },
        { label: "Move Line Down", click: () => sendToRenderer("menu:moveLineDown", null) },
        { label: "Format Document", click: () => sendToRenderer("menu:formatDocument", null) },
        { type: "separator" },
        { label: "Go to Line…", click: () => sendToRenderer("menu:gotoLine", null) },
        { label: "Go to Symbol…", click: () => sendToRenderer("menu:gotoSymbol", null) },
      ],
    },
    {
      label: "View", submenu: [
        { label: "Command Palette…", accelerator: "CmdOrCtrl+Shift+P", click: () => sendToRenderer("menu:commandPalette", null) },
        { label: "Quick Open…", accelerator: "CmdOrCtrl+P", click: () => sendToRenderer("menu:commandPalette", null) },
        { type: "separator" },
        { label: "Toggle Full Screen", accelerator: "F11", click: () => sendToRenderer("menu:fullscreen", null) },
        { type: "separator" },
        // ── UI Size — requested Ctrl + + (Zoom In) / Ctrl + - (Zoom Out) ──
        { label: "Zoom In — Increase UI Size", accelerator: "CmdOrCtrl+Plus", click: () => zoomIn() },
        { label: "Zoom In — Increase UI Size (Ctrl+=)", accelerator: "CmdOrCtrl+=", click: () => zoomIn() },
        { label: "Zoom Out — Decrease UI Size", accelerator: "CmdOrCtrl+-", click: () => zoomOut() },
        { label: "Reset UI Size — Actual Size", accelerator: "CmdOrCtrl+0", click: () => zoomReset() },
        { label: "Zoom In (Numpad +)", accelerator: "CmdOrCtrl+numadd", visible: false, click: () => zoomIn() },
        { label: "Zoom Out (Numpad -)", accelerator: "CmdOrCtrl+numsub", visible: false, click: () => zoomOut() },
        { label: "Reset UI Size (Numpad 0)", accelerator: "CmdOrCtrl+num0", visible: false, click: () => zoomReset() },
        { label: `Zoom: ${Math.round(getUiZoomFactor() * 100)}%`, enabled: false },
        {
          label: "UI Size",
          submenu: [
            { label: "Increase UI Size (Zoom In)", accelerator: "CmdOrCtrl+Plus", click: () => zoomIn() },
            { label: "Increase UI Size (Zoom In) — Ctrl+=", accelerator: "CmdOrCtrl+=", click: () => zoomIn() },
            { label: "Decrease UI Size (Zoom Out)", accelerator: "CmdOrCtrl+-", click: () => zoomOut() },
            { label: "Reset UI Size (100%)", accelerator: "CmdOrCtrl+0", click: () => zoomReset() },
            { type: "separator" },
            { label: `Current Zoom: ${Math.round(getUiZoomFactor() * 100)}%`, enabled: false },
          ],
        },
        {
          label: "Appearance",
          submenu: [
            { label: "Zoom In — Increase UI Size", accelerator: "CmdOrCtrl+Plus", click: () => zoomIn() },
            { label: "Zoom Out — Decrease UI Size", accelerator: "CmdOrCtrl+-", click: () => zoomOut() },
            { label: "Reset UI Size", accelerator: "CmdOrCtrl+0", click: () => zoomReset() },
            { type: "separator" },
            { label: `Zoom: ${Math.round(getUiZoomFactor() * 100)}%`, enabled: false },
            { type: "separator" },
            { label: "Toggle Full Screen", accelerator: "F11", click: () => sendToRenderer("menu:fullscreen", null) },
          ],
        },
        { type: "separator" },
        { label: "Reset Layout", accelerator: "CmdOrCtrl+Alt+R", click: () => sendToRenderer("menu:resetLayout", null) },
        { label: "Split Editor Right", accelerator: "CmdOrCtrl+\\", click: () => sendToRenderer("menu:splitEditorRight", null) },
        { type: "separator" },
        { label: "Ports", click: () => sendToRenderer("menu:openPorts", null) },
        { label: "AI Panel", accelerator: "CmdOrCtrl+Shift+A", click: () => sendToRenderer("menu:openAI", null) },
        { label: "Android Emulator", click: () => sendToRenderer("menu:openAndroid", null) },
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
    {
      label: "Storage", submenu: [
        { label: "Current Project Storage…", enabled: false },
        { label: "Reveal Project Storage Folder", click: async () => {
          const rp = lastProjectPath;
          if (!rp) { dialog.showMessageBox({ type: "info", message: "No project open", detail: "Open a project first to reveal its storage." }); return; }
          const info = getStorageInfo(rp);
          const target = info?.storeDir || getProjectStoreDir(rp);
          try { if (target && fs.existsSync(target)) await shell.openPath(target); else dialog.showMessageBox({ type: "info", message: "No storage yet", detail: `Storage will be created at:\n${target}` }); } catch (e) { dialog.showErrorBox("Error", String(e)); }
        }},
        { label: "Show Storage Info", click: async () => {
          const rp = lastProjectPath;
          if (!rp) { dialog.showMessageBox({ type: "info", message: "No project open" }); return; }
          const info = getStorageInfo(rp);
          if (!info) { dialog.showErrorBox("Error", "Cannot get storage info"); return; }
          const detail = `Project: ${rp}\nStore: ${info.storeDir}\n\nPin: ${info.pinExists ? "yes" : "no"}  Tabs: ${info.tabsExists ? "yes" : "no"}  Canvas: ${info.canvasExists ? "yes" : "no"}\nTrash: ${info.trashCount} items (${(info.trashSize/1024).toFixed(1)} KB)\n\n(App memory: userData/projects — not in project folder)`;
          dialog.showMessageBox({ type: "info", message: "Project Storage — App Memory", detail });
        }},
        { label: "Reveal Trash Folder", click: async () => {
          const rp = lastProjectPath;
          if (!rp) { dialog.showMessageBox({ type: "info", message: "No project open" }); return; }
          const td = trashDir(rp);
          if (td && fs.existsSync(td)) await shell.openPath(td);
          else dialog.showMessageBox({ type: "info", message: "Trash is empty", detail: `Trash location:\n${td || "(unknown)"}` });
        }},
        { type: "separator" },
        { label: "Clear Pin Config", click: async () => {
          const rp = lastProjectPath;
          if (!rp) return;
          const { response } = await dialog.showMessageBox({ type: "question", buttons: ["Cancel", "Clear"], defaultId: 1, cancelId: 0, message: "Clear pinned folders for this project?" });
          if (response !== 1) return;
          memPinCache.delete(rp);
          try { fs.unlinkSync(path.join(getProjectStoreDir(rp), "pinconfig.json")); } catch {}
          try { fs.rmSync(path.join(rp, ".project_config", ".pinconfig"), { force: true }); } catch {}
          dialog.showMessageBox({ type: "info", message: "Pin config cleared (app memory)" });
          try { Menu.setApplicationMenu(buildMenu()); } catch {}
        }},
        { label: "Clear Tabs (Open Editors)", click: async () => {
          const rp = lastProjectPath;
          if (!rp) return;
          const { response } = await dialog.showMessageBox({ type: "question", buttons: ["Cancel", "Clear"], defaultId: 1, cancelId: 0, message: "Clear saved tabs for this project?" });
          if (response !== 1) return;
          memTabsCache.delete(rp);
          try { fs.unlinkSync(path.join(getProjectStoreDir(rp), "tabs.json")); } catch {}
          try { fs.rmSync(path.join(rp, ".project_config", "tabs.json"), { force: true }); } catch {}
          dialog.showMessageBox({ type: "info", message: "Tabs cleared (app memory)" });
        }},
        { label: "Clear Canvas Layout", click: async () => {
          const rp = lastProjectPath;
          if (!rp) return;
          const { response } = await dialog.showMessageBox({ type: "question", buttons: ["Cancel", "Clear"], defaultId: 1, cancelId: 0, message: "Clear canvas layout for this project?" });
          if (response !== 1) return;
          memCanvasCache.delete(rp);
          try { fs.unlinkSync(path.join(getProjectStoreDir(rp), "canvas-layout.json")); } catch {}
          try { fs.rmSync(path.join(rp, ".canvas", "layout.json"), { force: true }); } catch {}
          dialog.showMessageBox({ type: "info", message: "Canvas layout cleared" });
        }},
        { label: "Empty Trash (App Memory)", click: async () => {
          const rp = lastProjectPath;
          if (!rp) return;
          const info = getStorageInfo(rp);
          if (!info || info.trashCount === 0) { dialog.showMessageBox({ type: "info", message: "Trash is already empty" }); return; }
          const { response } = await dialog.showMessageBox({ type: "warning", buttons: ["Cancel", "Empty Trash"], defaultId: 1, cancelId: 0, message: `Empty trash?`, detail: `${info.trashCount} items will be permanently deleted from app memory.` });
          if (response !== 1) return;
          try {
            const td = trashDir(rp);
            if (td && fs.existsSync(td)) {
              for (const e of fs.readdirSync(td)) {
                if (e === "manifest.json") continue;
                try { fs.rmSync(path.join(td, e), { recursive: true, force: true }); } catch {}
              }
              try { fs.writeFileSync(path.join(td, "manifest.json"), JSON.stringify({}, null, 2)); } catch {}
            }
            try { fs.rmSync(path.join(rp, ".trash"), { recursive: true, force: true }); } catch {}
            dialog.showMessageBox({ type: "info", message: "Trash emptied" });
          } catch (e) { dialog.showErrorBox("Error", String(e)); }
        }},
        { type: "separator" },
        { label: "Clear All Project Data…", click: async () => {
          const rp = lastProjectPath;
          if (!rp) { dialog.showMessageBox({ type: "info", message: "No project open" }); return; }
          const { response } = await dialog.showMessageBox({ type: "warning", buttons: ["Cancel", "Clear All"], defaultId: 1, cancelId: 0, message: "Clear ALL data for this project?", detail: `Project: ${rp}\n\nThis deletes pin config, tabs, canvas layout and trash from app memory (userData/projects). Project files are NOT deleted.\n\nLegacy .project_config / .canvas / .trash in project folder will also be removed.` });
          if (response !== 1) return;
          try {
            memPinCache.delete(rp); memTabsCache.delete(rp); memCanvasCache.delete(rp);
            const storeDir = getProjectStoreDir(rp);
            if (storeDir && fs.existsSync(storeDir)) fs.rmSync(storeDir, { recursive: true, force: true });
            try { fs.rmSync(path.join(rp, ".project_config"), { recursive: true, force: true }); } catch {}
            try { fs.rmSync(path.join(rp, ".canvas"), { recursive: true, force: true }); } catch {}
            try { fs.rmSync(path.join(rp, ".trash"), { recursive: true, force: true }); } catch {}
            dialog.showMessageBox({ type: "info", message: "All project data cleared" });
          } catch (e) { dialog.showErrorBox("Error", String(e)); }
        }},
        { type: "separator" },
        { label: "Global Storage…", enabled: false },
        { label: "Reveal All Storages Folder", click: async () => {
          const root = getProjectStoreRoot();
          try { fs.mkdirSync(root, { recursive: true }); await shell.openPath(root); } catch (e) { dialog.showErrorBox("Error", String(e)); }
        }},
        { label: "Clear All Projects Data…", click: async () => {
          const { response } = await dialog.showMessageBox({ type: "warning", buttons: ["Cancel", "Clear Everything"], defaultId: 1, cancelId: 0, message: "Clear data for ALL projects?", detail: "This deletes every project's pin, tabs, canvas and trash from app memory (userData/projects). Project files are NOT deleted. This cannot be undone." });
          if (response !== 1) return;
          try {
            const root = getProjectStoreRoot();
            if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
            memPinCache.clear(); memTabsCache.clear(); memCanvasCache.clear();
            dialog.showMessageBox({ type: "info", message: "All projects storage cleared" });
          } catch (e) { dialog.showErrorBox("Error", String(e)); }
        }},
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
        { label: "About Idiot Box", click: () => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
            if (win) dialog.showMessageBox(win, {
              type: "info",
              title: "About Idiot Box",
              message: `Idiot Box v${app.getVersion()}`,
              detail: "A fast, modern and lightweight code editor crafted for developers.\nDesigned to be simple, powerful and extensible.\n\n© 2026 TheWonderlandStudio\nhttps://github.com/TheWonderlandStudio/Idiot_Box",
              buttons: ["OK", "View on GitHub"],
              defaultId: 0,
            }).then(({ response }) => { if (response === 1) shell.openExternal("https://github.com/TheWonderlandStudio/Idiot_Box"); });
          } },
        { label: "Check for Updates…", click: async () => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
            if (!win) return;
            try {
              // tell renderer this is a manual check so "You're up to date" shows in-app (not auto)
              try { win.webContents.send("updater:manualCheck"); } catch {}
              await checkForUpdatesViaGitHub(win);
              // in-app popup via updater:* events (UpdaterBanner + nav button), no system dialog
            } catch (e) {
              console.warn("[updater] manual check failed", e.message);
              try { win.webContents.send("updater:error", String(e.message || e)); } catch {}
            }
          }},
        { label: "View Releases", click: () => shell.openExternal("https://github.com/TheWonderlandStudio/Idiot_Box/releases") },
        { type: "separator" },
        { label: "Keyboard Shortcuts", accelerator: "CmdOrCtrl+K CmdOrCtrl+S", click: () => sendToRenderer("menu:commandPalette", null) },
        { label: "Toggle Developer Tools", click: () => { const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]; if (win) win.webContents.toggleDevTools(); } },
        { type: "separator" },
        { label: "Report Issue", click: () => shell.openExternal("https://github.com/TheWonderlandStudio/Idiot_Box/issues") },
        { label: "View on GitHub", click: () => shell.openExternal("https://github.com/TheWonderlandStudio/Idiot_Box") },
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
        width: Number.isFinite(w) && w >= 640 ? Math.min(w, 3000) : 1280,
        height: Number.isFinite(h) && h >= 480 ? Math.min(h, 2000) : 720,
        ...(Number.isFinite(x) ? { x } : {}),
        ...(Number.isFinite(y) ? { y } : {}),
      };
      wasMaximized = !!s.window.maximized;
    }
  } catch {}

  const win = new BrowserWindow({
    ...winState,
    minWidth: 640,
    minHeight: 480,
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
      if (/^(https?:|ibx-file:|view-source:)/i.test(url) || url.startsWith("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(url) || /^[^\s]+\.[^\s]+/.test(url)) {
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

  // ── Apply persisted UI zoom (View → UI Size) ───────────────────────────
  try {
    const iz = getUiZoomFactor();
    if (iz !== 1) win.webContents.setZoomFactor(iz);
  } catch {}

  // ── Fix Ctrl+W: only close project, never close window/app ───
  // ── + Global Zoom shortcuts: Ctrl + + / Ctrl + = / Ctrl + numadd  → Zoom In
  // ──                        Ctrl + - / Ctrl + numsub → Zoom Out, Ctrl + 0 → Reset
  const handleGlobalShortcuts = (event, input) => {
    try {
      const isCtrl = !!(input.control || input.meta);
      const key = String(input.key || "").toLowerCase();
      const typeDown = input.type === "keyDown";
      // Ctrl+W — close project only (handle for both main and guest)
      if (isCtrl && key === "w" && typeDown && !input.shift && !input.alt) {
        try { event.preventDefault(); } catch {}
        lastProjectPath = null;
        sendToRenderer("menu:closeProject", null);
        return;
      }
      // Zoom shortcuts are handled by Menu accelerators (View → UI Size) and
      // renderer fallback (window keydown + Ctrl+Wheel) for Monaco/webview
      // focus cases. No main-process before-input zoom handling needed here
      // to avoid double-step and conflict with Browser webview's own Ctrl+Plus
      // content-zoom. See View menu and renderer/index.jsx zoom overlay.
    } catch {}
  };
  win.webContents.on("before-input-event", handleGlobalShortcuts);

  // Register every browser webview as a chrome.tabs tab
  win.webContents.on("did-attach-webview", (_e, wc) => {
    lastGuestWc = wc; lastGuestWin = win;
    try { chromeExt?.addTab(wc, win); } catch {}
    wc.on("did-navigate", () => { try { chromeExt?.selectTab(wc); } catch {} });
    wc.on("focus",       () => { try { chromeExt?.selectTab(wc); } catch {} });
    try { wc.on("before-input-event", handleGlobalShortcuts); } catch {}
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
        width: Math.max(640, Math.min(bounds.width || 1280, 3000)),
        height: Math.max(480, Math.min(bounds.height || 720, 2000)),
        x: bounds.x,
        y: bounds.y,
        maximized,
      };
      const data = { window: sane, layout };
      fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
    } catch {}
  });

  // ── Auto Updater ───────────────────────────────────────────────────────
  try { setupAutoUpdater(win); } catch (e) { console.warn("[updater] setup error", e.message); }
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
  protocol.handle("ibx-file", async (request) => {
    try {
      const referrer = request.referrer || "";
      if (referrer.startsWith("http:") || referrer.startsWith("https:")) {
        // Block external untrusted website origins from accessing local filesystem
        const refUrl = new URL(referrer);
        if (refUrl.hostname !== "localhost" && refUrl.hostname !== "127.0.0.1") {
          return new Response("Access Denied", { status: 403 });
        }
      }
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname.replace(/^\/([A-Za-z]):/, (_m, d) => d.toUpperCase() + ":"));
      const normPath = path.normalize(filePath);
      if (!fs.existsSync(normPath)) {
        return new Response("Not found", { status: 404 });
      }
      const res = await electronNet.fetch(pathToFileURL(normPath).toString());
      const headers = new Headers(res.headers);
      if (referrer.startsWith("file:") || referrer.startsWith("ibx-file:")) {
        headers.set("Access-Control-Allow-Origin", "*");
      } else {
        headers.set("Access-Control-Allow-Origin", "null");
      }
      headers.set("Content-Type", PP_FILE_MIME[path.extname(normPath).toLowerCase()] || "application/octet-stream");
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
