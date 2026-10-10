// ─── App extension host ──────────────────────────────────────────────────────
// Installed (local unpacked) extensions ko load karke unhe Idiot Box-native
// API surface deta hai. Sab kuch main process me chalta hai, renderer sirf
// IPC bridge hai (commands → palette, views → iframe tabs, status items →
// status bar, messages → toasts).
//
//   context.ibox       → Idiot Box API
//   activate(context)  → extension entry (function export bhi chalega)
"use strict";

const { app, ipcMain, BrowserWindow, dialog, shell, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const folder = require("./folder");
const community = require("./community");
const { summarizeContributions } = require("./contrib");

// ── Paths / state ───────────────────────────────────────────────────────────
const stateFile = () => path.join(app.getPath("userData"), "extensions-state.json");
const storeFile = () => path.join(app.getPath("userData"), "extensions-storage.json");
const rootDir = () => {
  const d = path.join(app.getPath("userData"), "vsx-extensions");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
};

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); return true; } catch { return false; }
}

// ── contributes.commands → { id: { title, category } } (NLS titles resolved) ─
function resolveNlsValue(nls, v) {
  const s = String(v || "");
  const m = s.match(/^%(.+)%$/);
  return m ? (nls[m[1]] || s) : s;
}
function contribCommandMeta(dir) {
  const mf = loadJson(path.join(dir, "package.json"), {});
  const list = (mf.contributes && mf.contributes.commands) || [];
  let nls = {};
  try {
    const nlsFile = path.join(dir, "package.nls.json");
    if (fs.existsSync(nlsFile)) nls = JSON.parse(fs.readFileSync(nlsFile, "utf8"));
  } catch {}
  const map = new Map();
  for (const c of list) {
    if (!c || !c.command) continue;
    map.set(c.command, {
      title: resolveNlsValue(nls, c.title) || c.command,
      category: resolveNlsValue(nls, c.category) || "",
      editorAction: c.editorAction || "",
    });
  }
  return map;
}

let state = loadJson(stateFile(), { extensions: {} });
if (!state.extensions || typeof state.extensions !== "object") state.extensions = {};
let kvStore = loadJson(storeFile(), {});

const persistState = () => saveJson(stateFile(), state);
const persistStore = () => saveJson(storeFile(), kvStore);

// ── Runtime registries (activation ke waqt bante hain) ──────────────────────
// extId → { disposables:[], commands:Map, views:Map, statusItems:Map, error }
const runtime = new Map();
const commandRegistry = new Map();   // commandId → { extId, title, category }
const builtInCommands = new Map();    // commandId → { fn, title, category }
const builtInRegistry = new Map();    // explicit native command registry
let statusSeq = 0;

function normalizeManifest(extDir, manifest = {}) {
  const custom = manifest.idiotbox || manifest.ibox || {};
  const id = custom.id || manifest.name || path.basename(extDir) || "unknown-extension";
  const name = custom.name || manifest.displayName || manifest.name || id;
  const version = custom.version || manifest.version || "0.0.0";
  const description = custom.description || manifest.description || "";
  const main = custom.main || manifest.main || manifest.browser || "extension.js";
  const commands = Array.isArray(custom.commands) ? custom.commands : (manifest.contributes && Array.isArray(manifest.contributes.commands) ? manifest.contributes.commands : []);
  const views = Array.isArray(custom.views) ? custom.views : (manifest.contributes && Array.isArray(manifest.contributes.views) ? manifest.contributes.views : []);
  const asset = custom.asset || custom.window || {};
  return {
    id,
    name,
    rawName: manifest.name || id,
    publisher: manifest.publisher || custom.publisher || (String(id).split(".")[0] || ""),
    version,
    description: String(description).slice(0, 400),
    main,
    commands,
    views,
    asset,
    engines: custom.engines || "",
  };
}

function registerBuiltInCommand(id, fn, meta = {}) {
  const info = { fn, title: meta.title || id, category: meta.category || "Idiot Box" };
  builtInCommands.set(id, info);
  builtInRegistry.set(id, { extId: "__ibox__", title: info.title, category: info.category });
  commandRegistry.set(id, { extId: "__ibox__", title: info.title, category: info.category });
}

function registerBuiltInCommands() {
  registerBuiltInCommand("ibox:reload-extensions", async () => {
    await activateAll();
    notify("info", "Extensions reloaded");
    return { ok: true };
  }, { title: "Reload extensions", category: "Idiot Box" });

  registerBuiltInCommand("ibox:toggle-devtools", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win || win.isDestroyed()) return { ok: false, error: "No focused window" };
    const wc = win.webContents;
    if (wc.isDevToolsOpened()) wc.closeDevTools();
    else wc.openDevTools({ mode: "detach" });
    return { ok: true };
  }, { title: "Toggle DevTools", category: "Idiot Box" });

  registerBuiltInCommand("ibox:show-notification", (_, type, message) => {
    notify(type || "info", message || "");
    return { ok: true };
  }, { title: "Show notification", category: "Idiot Box" });

  registerBuiltInCommand("ibox:copy-to-clipboard", (_, text) => {
    clipboard.writeText(String(text ?? ""));
    return { ok: true };
  }, { title: "Copy to clipboard", category: "Idiot Box" });
}

registerBuiltInCommands();

// ── Broadcast helpers ───────────────────────────────────────────────────────
function broadcast(channel, payload) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send(channel, payload); } catch {}
    }
  } catch {}
}
const changed = () => broadcast("ext:changed", null);
const notify = (type, message) => broadcast("ext:notify", { type, message: String(message || "") });

// ── Minimal EventEmitter (VS Code style: event(listener) → Disposable) ──────
class Emitter {
  constructor() { this.listeners = new Set(); }
  get event() {
    return (cb) => {
      this.listeners.add(cb);
      return { dispose: () => this.listeners.delete(cb) };
    };
  }
  fire(value) { for (const cb of [...this.listeners]) { try { cb(value); } catch (e) { console.warn("[ext] listener error:", e && e.message); } } }
  dispose() { this.listeners.clear(); }
}
const Disposable = (fn) => ({ dispose: () => { try { fn(); } catch {} } });

// ── Uri (file:// subset — sirf wahi jo extensions aam taur par use karti hain) ─
class Uri {
  constructor(scheme, authority, path_, query, fragment) {
    this.scheme = scheme; this.authority = authority || "";
    this.path = path_ || ""; this.query = query || ""; this.fragment = fragment || "";
    this.fsPath = scheme === "file" ? path_ : path_;
  }
  static file(p) { return new Uri("file", "", String(p).replace(/\\/g, "/"), "", ""); }
  static parse(s) {
    try {
      const u = new URL(s);
      return new Uri(u.protocol.replace(":", ""), u.hostname, u.pathname, u.search.replace(/^\?/, ""), u.hash.replace(/^#/, ""));
    } catch { return new Uri("file", "", String(s), "", ""); }
  }
  with(change) {
    return new Uri(change.scheme ?? this.scheme, change.authority ?? this.authority, change.path ?? this.path, change.query ?? this.query, change.fragment ?? this.fragment);
  }
  toString() {
    const q = this.query ? `?${this.query}` : "";
    const f = this.fragment ? `#${this.fragment}` : "";
    if (this.scheme === "file") return `file://${this.path}${q}${f}`;
    return `${this.scheme}://${this.authority}${this.path}${q}${f}`;
  }
}

// ── Current project (main se getter milta hai registerExtensions ke time) ──
let getProjectPath = () => null;

// ── Per-extension pieces ────────────────────────────────────────────────────
function ensureRuntime(extId) {
  let rt = runtime.get(extId);
  if (!rt) { rt = { disposables: [], commands: new Map(), views: new Map(), statusItems: new Map(), formatters: [], error: null }; runtime.set(extId, rt); }
  return rt;
}

function registerCommand(extId, commandId, fn, title, category, editorAction) {
  const rt = ensureRuntime(extId);
  const id = String(commandId || "");
  if (!id || typeof fn !== "function") return Disposable(() => {});
  if (commandRegistry.has(id) && commandRegistry.get(id).extId !== extId) {
    console.warn(`[ext] command id collision: ${id} (${commandRegistry.get(id).extId} vs ${extId})`);
  }
  commandRegistry.set(id, { extId, title: title || id, category: category || "", editorAction: editorAction || "" });
  rt.commands.set(id, fn);
  changed();
  return Disposable(() => {
    if (commandRegistry.get(id)?.extId === extId) commandRegistry.delete(id);
    rt.commands.delete(id);
    changed();
  });
}

async function runCommand(commandId, ...args) {
  const builtIn = builtInCommands.get(commandId);
  if (builtIn && typeof builtIn.fn === "function") {
    try {
      const res = await builtIn.fn(...args);
      return res && typeof res === "object" && "ok" in res ? res : { ok: true, result: res };
    } catch (e) {
      const msg = String((e && e.message) || e);
      notify("error", `${commandId}: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  const entry = commandRegistry.get(commandId);
  if (!entry) return { ok: false, error: `Unknown command: ${commandId}` };
  try {
    const rt = runtime.get(entry.extId);
    const fn = rt && rt.commands.get(commandId);
    if (!fn) return { ok: false, error: `Command not active: ${commandId}` };
    const res = await fn(...args);
    return res && typeof res === "object" && "ok" in res ? res : { ok: true, result: res };
  } catch (e) {
    const msg = String((e && e.message) || e);
    notify("error", `${commandId}: ${msg}`);
    return { ok: false, error: msg };
  }
}

function createStatusItem(extId, item = {}) {
  const rt = ensureRuntime(extId);
  const key = `${extId}:${item.id || ++statusSeq}`;
  const state = {
    key, extId, text: String(item.text || ""), tooltip: String(item.tooltip || ""),
    command: item.command || null, visible: item.text !== undefined,
  };
  const api = {
    get text() { return state.text; },
    set text(v) { state.text = String(v ?? ""); changed(); },
    get tooltip() { return state.tooltip; },
    set tooltip(v) { state.tooltip = String(v ?? ""); changed(); },
    get command() { return state.command; },
    set command(v) { state.command = v || null; changed(); },
    show() { state.visible = true; changed(); },
    hide() { state.visible = false; changed(); },
    dispose() { rt.statusItems.delete(key); changed(); },
  };
  rt.statusItems.set(key, state);
  changed();
  return api;
}

function statusItemsList() {
  const all = Object.values(state.extensions);
  const out = [];
  for (const rt of runtime.values()) for (const s of rt.statusItems.values()) {
    if (s.visible && s.text) {
      const rec = all.find((e) => e.id === s.extId);
      out.push({ ...s, extName: rec ? rec.name : s.extId });
    }
  }
  return out;
}

// ── Webview panel / views ───────────────────────────────────────────────────
function createWebviewPanel(extId, viewType, title, opts) {
  const rt = ensureRuntime(extId);
  const id = String(viewType || `view-${++statusSeq}`);
  const emitter = new Emitter();
  const rec = {
    extId, viewType: id, title: String(title || id),
    _html: "", onMessage: emitter, column: (opts && opts.viewColumn) || 1,
  };
  const panel = {
    get title() { return rec.title; },
    set title(v) { rec.title = String(v || ""); changed(); },
    viewType: id,
    webview: {
      get html() { return rec._html; },
      set html(v) { rec._html = String(v || ""); broadcast("ext:viewHtmlChanged", { extId, viewType: id }); },
      options: (opts && opts.webviewOptions) || {},
      onDidReceiveMessage: emitter.event,
      postMessage: (msg) => { broadcast("ext:viewPush", { extId, viewType: id, msg }); return Promise.resolve(true); },
      asWebviewUri: (u) => Uri.parse(String(u)),
    },
    onDidChangeViewState: new Emitter().event,
    reveal: () => broadcast("ext:viewFocus", { extId, viewType: id }),
    dispose: () => { rt.views.delete(id); emitter.dispose(); changed(); },
  };
  rt.views.set(id, rec);
  changed();
  return panel;
}

function viewsList() {
  const out = [];
  for (const [extId, rt] of runtime.entries()) {
    const rec = state.extensions[extId];
    for (const v of rt.views.values()) {
      out.push({ extId, extName: rec ? rec.name : extId, viewType: v.viewType, title: v.title });
    }
  }
  return out;
}

function getViewHtml(extId, viewType) {
  const rt = runtime.get(extId);
  const view = rt && rt.views.get(String(viewType));
  if (!view) return null;
  return injectBridge(String(view._html || ""), extId, String(viewType));
}

// Iframe ke andar chhota native bridge: extension code `ibx.post()` / `window.__iboxBridge`
// se main window ko message bhej sakta hai — reverse path bhi yahi se aata hai.
function injectBridge(html, extId, viewType) {
  const boot = `<script>(function(){
var EXT=${JSON.stringify(String(extId)).replace(/<\//g, "<\\/")},VIEW=${JSON.stringify(String(viewType)).replace(/<\//g, "<\\/")},LISTENERS=[],BUSY=false;
function post(m){try{parent.postMessage({__ibxExt:1,extId:EXT,viewType:VIEW,msg:m},"*");}catch(e){}}
function deliver(m){
  if(BUSY)return; BUSY=true;
  try{
    for(var i=0;i<LISTENERS.length;i++){try{LISTENERS[i](m);}catch(e){}}
    try{window.dispatchEvent(new MessageEvent("message",{data:m}));}catch(e){}
    try{window.dispatchEvent(new CustomEvent("ibx-message",{detail:m}));}catch(e){}
  }finally{BUSY=false;}
}
window.__iboxBridge={
  post: post,
  on: function(fn){LISTENERS.push(fn);return{dispose:function(){var i=LISTENERS.indexOf(fn);if(i>=0)LISTENERS.splice(i,1);}};},
  getState: function(){return window.__iboxState || (window.__iboxState = {});},
  setState: function(v){window.__iboxState=v||{};},
};
window.ibx = window.__iboxBridge;
window.addEventListener("message",function(e){var d=e.data;if(d&&d.__ibxHost&&d.extId===EXT&&d.viewType===VIEW)deliver(d.msg);});
})();<\/script>`;
  if (!html) return `<!doctype html><html><head><meta charset="utf-8"></head><body>${boot}</body></html>`;
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i >= 0 ? html.slice(0, i) + boot + html.slice(i) : html + boot;
}

// ── Storage (globalState / getConfiguration overrides) ─────────────────────
function memento(extId, scope) {
  const bucket = () => {
    kvStore[extId] = kvStore[extId] || {};
    kvStore[extId][scope] = kvStore[extId][scope] || {};
    return kvStore[extId][scope];
  };
  return {
    get: (key, def) => { const b = bucket(); return Object.prototype.hasOwnProperty.call(b, key) ? b[key] : def; },
    update: (key, value) => { bucket()[key] = value; persistStore(); return Promise.resolve(); },
    keys: () => Object.keys(bucket()),
  };
}

// ── Idiot Box native extension API ───────────────────────────────────────────

function createApis(extRec) {
  const extId = extRec.id;
  const rt = ensureRuntime(extId);
  const cmdMeta = contribCommandMeta(extRec.dir);
  const showMessage = (kind, ...raw) => {
    const items = raw.filter((x) => typeof x === "string");
    const message = items.shift() || "";
    notify(kind === 2 ? "error" : kind === 1 ? "warn" : "info", message);
    return Promise.resolve(undefined);
  };

  const configDefaults = () => {
    const out = {};
    try {
      const mf = JSON.parse(fs.readFileSync(path.join(extRec.dir, "package.json"), "utf8"));
      const cfg = mf && mf.contributes && mf.contributes.configuration;
      const add = (sect) => {
        if (!sect || !sect.properties) return;
        for (const [k, v] of Object.entries(sect.properties)) out[k] = v && Object.prototype.hasOwnProperty.call(v, "default") ? v.default : undefined;
      };
      if (Array.isArray(cfg)) cfg.forEach(add); else add(cfg);
    } catch {}
    return out;
  };
  const defaults = configDefaults();
  const overrides = memento(extId, "config");

  const workspaceFolders = () => {
    const p = getProjectPath();
    return p ? [{ uri: Uri.file(p), name: path.basename(p), index: 0 }] : [];
  };

  // Class-level helpers — vsCode literal se PEHLE define (self-reference TDZ error deta)
  class Pos {
    constructor(l, c) { this.line = l; this.character = c; }
    compareTo(o) { return this.line - o.line || this.character - o.character; }
    isAfter(o) { return this.compareTo(o) > 0; }
    isAfterOrEqual(o) { return this.compareTo(o) >= 0; }
    isBefore(o) { return this.compareTo(o) < 0; }
    isBeforeOrEqual(o) { return this.compareTo(o) <= 0; }
    isEqual(o) { return this.compareTo(o) === 0; }
  }
  class Rng {
    constructor(a, b, c, d) {
      if (typeof a === "number") { this.start = new Pos(a, b); this.end = new Pos(c, d); }
      else { this.start = a; this.end = b; }
    }
    get isEmpty() { return this.start.isEqual(this.end); }
    get isSingleLine() { return this.start.line === this.end.line; }
    contains(value) {
      const range = value && value.start && value.end ? value : new Rng(value, value);
      return this.start.isBeforeOrEqual(range.start) && this.end.isAfterOrEqual(range.end);
    }
  }
  class TextEdit {
    constructor(range, newText) { this.range = range; this.newText = String(newText ?? ""); }
    static replace(range, newText) { return new TextEdit(range, newText); }
    static insert(position, newText) { return new TextEdit(new Rng(position, position), newText); }
    static delete(range) { return new TextEdit(range, ""); }
  }
  class Sel extends Rng {}
  class Loc { constructor(uri, range) { this.uri = uri; this.range = range; } }
  class ThemeColor { constructor(id) { this.id = id; } }
  class MarkdownString {
    constructor(v) { this.value = v || ""; }
    appendCodeblock(c, l) { this.value += "\n```" + (l || "") + "\n" + c + "\n```"; return this; }
    appendMarkdown(s) { this.value += s; return this; }
  }
  class CancellationTokenSource {
    constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: new Emitter().event }; }
    cancel() { this.token.isCancellationRequested = true; }
    dispose() {}
  }

  const workspaceConfig = (section) => {
    const prefix = section ? `${section}.` : "";
    const api = {
      get: (key, def) => {
        const full = `${prefix}${key}`;
        const b = memento(extId, "config");
        const v = b.get(full, undefined);
        if (v !== undefined) return v;
        return Object.prototype.hasOwnProperty.call(defaults, full) ? defaults[full] : def;
      },
      update: (key, value) => memento(extId, "config").update(`${prefix}${key}`, value),
      has: (key) => Object.prototype.hasOwnProperty.call(defaults, `${prefix}${key}`),
      inspect: (key) => ({ key, defaultValue: defaults[`${prefix}${key}`], globalValue: memento(extId, "config").get(`${prefix}${key}`, undefined) }),
    };
    return new Proxy(api, {
      get(t, p) {
        if (typeof p === "symbol" || p in t) return Reflect.get(t, p);
        if (typeof p !== "string") return undefined;
        return t.get(p, undefined);
      },
    });
  };

  const ibox = {
    extension: { id: extId, name: extRec.name, version: extRec.version, dir: extRec.dir },
    commands: {
      registerCommand: (id, fn, title, category) => registerCommand(extId, id, fn, title, category),
      executeCommand: (id, ...args) => runCommand(id, ...args),
    },
    languages: {
      registerDocumentFormattingEditProvider: (selector, provider) => {
        const rt = ensureRuntime(extId);
        const entry = { selector, provider };
        rt.formatters.push(entry);
        changed();
        return Disposable(() => {
          rt.formatters = rt.formatters.filter((item) => item !== entry);
          changed();
        });
      },
    },
    window: {
      showMessage: (msg, type) => { notify(type || "info", msg); return Promise.resolve(); },
      showInfo: (msg) => { notify("info", msg); return Promise.resolve(); },
      showWarning: (msg) => { notify("warn", msg); return Promise.resolve(); },
      showError: (msg) => { notify("error", msg); return Promise.resolve(); },
      createStatusBarItem: (opts) => createStatusItem(extId, opts || {}),
      createPanel: (opts) => createWebviewPanel(extId, (opts && (opts.id || opts.viewType)) || "view", (opts && opts.title) || extRec.name, opts),
    },
    panels: {
      register: (opts) => {
        const p = createWebviewPanel(extId, opts.id || opts.viewType, opts.title || extRec.name, opts);
        if (opts && opts.html) p.webview.html = opts.html;
        return p;
      },
    },
    storage: { globalState: memento(extId, "globalState"), workspaceState: memento(extId, "workspaceState") },
    env: {
      appName: "Idiot Box",
      appRoot: app.getAppPath(),
      language: "en",
      machineId: "idiotbox",
      sessionId: String(process.pid),
      clipboard: {
        writeText: (t) => { clipboard.writeText(String(t || "")); return Promise.resolve(); },
        readText: () => Promise.resolve(String(clipboard.readText() || "")),
      },
      openExternal: (uri) => shell.openExternal(typeof uri === "string" ? uri : uri.toString()),
      uriScheme: "idiotbox",
      isTelemetryEnabled: false,
    },
    workspace: {
      getProjectPath: () => getProjectPath(),
      getConfiguration: workspaceConfig,
      workspaceFolders: () => {
        const p = getProjectPath();
        return p ? [{ uri: Uri.file(p), name: path.basename(p), index: 0 }] : [];
      },
      fs: {
        readFile: (uri) => fs.promises.readFile(uri.fsPath || String(uri)),
        writeFile: (uri, data) => fs.promises.writeFile(uri.fsPath || String(uri), data),
        appendFile: (uri, data) => fs.promises.appendFile(uri.fsPath || String(uri), data),
        stat: async (uri) => { const s = await fs.promises.stat(uri.fsPath || String(uri)); return { type: s.isDirectory() ? 1 : 2, size: s.size, ctime: s.ctimeMs, mtime: s.mtimeMs }; },
        delete: (uri, o) => fs.promises.rm(uri.fsPath || String(uri), { recursive: !!(o && o.recursive), force: true }),
        rename: (a, b) => fs.promises.rename(a.fsPath || String(a), b.fsPath || String(b)),
        readDirectory: async (uri) => { const entries = await fs.promises.readdir(uri.fsPath || String(uri), { withFileTypes: true }); return entries.map((e) => [e.name, e.isDirectory() ? 1 : 2]); },
      },
    },
    log: (...a) => console.log(`[ext:${extId}]`, ...a),
  };

  return { ibox };
}

// ── Activation / deactivation ───────────────────────────────────────────────
function deactivate(extId) {
  const rt = runtime.get(extId);
  if (!rt) return;
  const rec = state.extensions[extId];
  for (const d of rt.disposables.splice(0)) { try { d && d.dispose && d.dispose(); } catch {} }
  for (const cmdId of [...rt.commands.keys()]) {
    if (commandRegistry.get(cmdId)?.extId === extId) commandRegistry.delete(cmdId);
  }
  rt.commands.clear();
  rt.views.clear();
  rt.statusItems.clear();
  runtime.delete(extId);
  changed();
}

async function activate(extRec) {
  if (!extRec || extRec.enabled === false) return;
  const mainRel = extRec.main || "extension.js";
  const mainPath = path.join(extRec.dir, mainRel);
  deactivate(extRec.id);
  const rt = ensureRuntime(extRec.id);
  rt.error = null;
  if (!fs.existsSync(mainPath)) {
    rt.error = `main not found: ${mainRel}`;
    state.extensions[extRec.id].error = rt.error;
    persistState();
    changed();
    return;
  }
  const { ibox } = createApis(extRec);
  const storagePath = path.join(rootDir(), ".state", extRec.id);
  const logPath = path.join(storagePath, "logs");
  try { fs.mkdirSync(logPath, { recursive: true }); } catch {}
  // Env-var collection ka minimal stub — extensions `persistent` set karti hain
  const envCollection = () => ({
    persistent: true,
    description: "",
    replace: () => {}, append: () => {}, prepend: () => {}, delete: () => {}, clear: () => {},
    forEach: () => {}, get: () => undefined, getScoped: () => envCollection(), dispose: () => {},
  });
  const extUri = Uri.file(extRec.dir);
  const context = {
    subscriptions: rt.disposables,
    extension: { id: extRec.id, extensionUri: extUri, extensionPath: extRec.dir, packageJSON: loadJson(path.join(extRec.dir, "package.json"), {}) },
    // Purana (pre-1.7x) context fields
    extensionId: extRec.id,
    extensionUri: extUri,
    extensionPath: extRec.dir,
    // Storage fields (1.7x+)
    storagePath,
    storageUri: Uri.file(storagePath),
    globalStoragePath: storagePath,
    globalStorageUri: Uri.file(storagePath),
    logPath,
    logUri: Uri.file(logPath),
    globalState: memento(extRec.id, "globalState"),
    workspaceState: memento(extRec.id, "workspaceState"),
    environmentVariableCollection: envCollection(),
    ibox,
  };
  try { fs.mkdirSync(context.storagePath, { recursive: true }); } catch {}

  let mod;
  try {
    try { delete require.cache[require.resolve(mainPath)]; } catch {}
    try {
      mod = require(mainPath);
    } catch (err) {
      const msg = String((err && err.message) || err);
      // ESM-only dist (require(esm) unavailable) → dynamic import fallback.
      // Thoda ruk kar import taaki require(esm) ka in-flight graph settle ho.
      if (err && (err.code === "ERR_REQUIRE_ESM" || /Cannot use import statement|Unexpected token 'export'/.test(msg))) {
        await new Promise((r) => setTimeout(r, 50));
        mod = await import(pathToFileURL(mainPath).href);
      } else throw err;
    }
  } catch (e) {
    rt.error = String((e && e.message) || e);
    console.warn(`[ext] failed to load ${extRec.id}:`, rt.error);
  }
  if (mod && !rt.error) {
    try {
      const act = typeof mod === "function" ? mod : mod && mod.activate;
      if (typeof act === "function") await act(context);
      if (mod && typeof mod.deactivate === "function") rt.disposables.push(Disposable(() => { try { mod.deactivate(); } catch {} }));
    } catch (e) {
      rt.error = String((e && e.message) || e);
      console.warn(`[ext] activate failed ${extRec.id}:`, rt.error);
    }
  }
  state.extensions[extRec.id].error = rt.error;
  state.extensions[extRec.id].activatedAt = Date.now();
  persistState();
  if (!rt.error) console.log(`[ext] activated ${extRec.id}@${extRec.version} (${rt.commands.size} commands, ${rt.views.size} views)`);
  changed();
}

async function activateAll() {
  const builtinDir = path.join(__dirname, "prettier");
  const manifest = loadJson(path.join(builtinDir, "package.json"), null);
  if (manifest && manifest.name) {
    const builtin = addInstalled({
      id: manifest.name,
      dir: builtinDir,
      manifest,
      source: "builtin",
    });
    builtin.builtIn = true;
    builtin.enabled = true;
    persistState();
  }
  const recs = Object.values(state.extensions);
  console.log(`[ext] activateAll — ${recs.length} installed`);
  for (const rec of recs) {
    if (rec.enabled !== false) await activate(rec);
  }
  changed();
}

// ── Install / uninstall ─────────────────────────────────────────────────────
function addInstalled({ id, dir, manifest, source }) {
  const prev = state.extensions[id] || {};
  const normalized = normalizeManifest(dir, manifest || {});
  const finalId = String(id || normalized.id || path.basename(dir) || "unknown-extension");
  state.extensions[finalId] = {
    ...prev,
    id: finalId,
    dir,
    name: normalized.name,
    rawName: normalized.rawName,
    publisher: normalized.publisher,
    version: normalized.version,
    description: normalized.description,
    main: normalized.main,
    enabled: prev.enabled !== false,
    source: source || "local",
    installedAt: prev.installedAt || Date.now(),
    engines: normalized.engines || "",
    commands: normalized.commands,
    views: normalized.views,
  };
  persistState();
  return state.extensions[finalId];
}

async function installFolderDialog() {
  const r = await dialog.showOpenDialog({ title: "Load unpacked extension folder", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  try {
    const res = folder.installFromFolder(r.filePaths[0], rootDir());
    const rec = addInstalled({ ...res, source: "folder" });
    await activate(rec);
    notify("info", `Loaded ${rec.name}`);
    return { ok: true, id: rec.id };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

async function installFromCommunity(repo, extFolder) {
  try {
    const { tmp, src } = await community.downloadExtension(repo, extFolder);
    try {
      const res = folder.installFromFolder(src, rootDir());
      const rec = addInstalled({ ...res, source: "local" });
      await activate(rec);
      notify("info", `Installed ${rec.name} ${rec.version}`);
      return { ok: true, id: rec.id };
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

async function uninstall(extId) {
  const rec = state.extensions[extId];
  if (!rec) return { ok: false, error: "Not installed" };
  if (rec.builtIn) return { ok: false, error: "Built-in extensions cannot be uninstalled" };
  deactivate(extId);
  try { fs.rmSync(rec.dir, { recursive: true, force: true }); } catch {}
  delete state.extensions[extId];
  persistState();
  changed();
  notify("info", `Removed ${rec.name}`);
  return { ok: true };
}

async function setEnabled(extId, on) {
  const rec = state.extensions[extId];
  if (!rec) return { ok: false, error: "Not installed" };
  if (rec.builtIn && !on) return { ok: false, error: "Built-in extensions cannot be disabled" };
  rec.enabled = !!on;
  persistState();
  if (on) await activate(rec); else deactivate(extId);
  changed();
  return { ok: true };
}

function listInstalled() {
  return Object.values(state.extensions).map((rec) => {
    const rt = runtime.get(rec.id);
    return {
      id: rec.id,
      name: rec.name,
      publisher: rec.publisher,
      version: rec.version,
      description: rec.description,
      builtIn: rec.builtIn === true,
      enabled: rec.enabled !== false,
      source: rec.source,
      engines: rec.engines || "",
      installedAt: rec.installedAt || 0,
      activated: !!rt,
      error: (rt && rt.error) || rec.error || null,
      commandCount: rt ? rt.commands.size : 0,
      formatterCount: rt ? rt.formatters.length : 0,
      views: rt ? [...rt.views.values()].map((v) => ({ viewType: v.viewType, title: v.title })) : [],
      dir: rec.dir,
    };
  });
}

function listCommands() {
  const builtInEntries = [...builtInRegistry.entries()].map(([id, e]) => ({
    id,
    title: e.title,
    category: e.category,
    extId: e.extId,
    extName: "Idiot Box",
  }));
  const customEntries = [...commandRegistry.entries()]
    .filter(([id]) => !builtInRegistry.has(id))
    .map(([id, e]) => {
      const rec = state.extensions[e.extId];
      return {
        id,
        title: e.title,
        category: e.category,
        extId: e.extId,
        extName: rec ? rec.name : e.extId,
        ...(e.editorAction ? { editorAction: e.editorAction } : {}),
      };
    });
  return [...builtInEntries, ...customEntries];
}

function formattingSelectorMatches(selector, languageId) {
  if (!selector) return true;
  const selectors = Array.isArray(selector) ? selector : [selector];
  return selectors.some((item) => {
    if (typeof item === "string") return item === "*" || item === languageId;
    if (!item || typeof item !== "object") return false;
    if (item.language && item.language !== "*" && item.language !== languageId) return false;
    if (item.scheme && item.scheme !== "*" && item.scheme !== "file") return false;
    return true;
  });
}

function makeFormattingDocument(filePath, text, languageId) {
  const lines = text.split(/\r\n|\r|\n/);
  const starts = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    starts.push(offset);
    offset += line.length;
    if (i < lines.length - 1) offset += text.startsWith("\r\n", offset) ? 2 : 1;
  }
  const clampPosition = (position) => {
    const line = Math.max(0, Math.min(Number(position?.line) || 0, lines.length - 1));
    const character = Math.max(0, Math.min(Number(position?.character) || 0, lines[line].length));
    return { line, character };
  };
  const offsetAt = (position) => {
    const p = clampPosition(position);
    return starts[p.line] + p.character;
  };
  const positionAt = (index) => {
    const target = Math.max(0, Math.min(Number(index) || 0, text.length));
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= target) line++;
    return { line, character: Math.min(target - starts[line], lines[line].length) };
  };
  const range = (from, to) => ({ start: positionAt(from), end: positionAt(to) });
  return {
    uri: Uri.file(filePath),
    fileName: filePath,
    languageId,
    version: 1,
    isClosed: false,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    lineCount: lines.length,
    getText: (r) => r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text,
    offsetAt,
    positionAt,
    validateRange: (r) => range(offsetAt(r.start), offsetAt(r.end)),
    lineAt: (lineOrPosition) => {
      const line = typeof lineOrPosition === "number" ? lineOrPosition : lineOrPosition?.line;
      if (!Number.isInteger(line) || line < 0 || line >= lines.length) throw new RangeError("Invalid line number");
      const from = starts[line];
      const to = from + lines[line].length;
      const lineEnd = line + 1 < lines.length ? to + (text.slice(to, to + 2) === "\r\n" ? 2 : 1) : to;
      return {
        lineNumber: line,
        text: lines[line],
        range: range(from, to),
        rangeIncludingLineBreak: range(from, lineEnd),
        firstNonWhitespaceCharacterIndex: Math.max(0, lines[line].search(/\S|$/)),
        isEmptyOrWhitespace: /^\s*$/.test(lines[line]),
      };
    },
  };
}

async function formatDocument(filePath, text, languageId, formatOptions = {}) {
  if (!filePath || typeof text !== "string") return { ok: false, error: "No active text document to format" };
  const requestedLanguageId = String(languageId || "plaintext");
  const documentLanguageId = ({ jsx: "javascriptreact", tsx: "typescriptreact" })[requestedLanguageId] || requestedLanguageId;
  const document = makeFormattingDocument(String(filePath), text, documentLanguageId);
  const token = { isCancellationRequested: false, onCancellationRequested: new Emitter().event };
  const options = {
    tabSize: Number.isInteger(formatOptions.tabSize) && formatOptions.tabSize > 0 ? formatOptions.tabSize : 2,
    insertSpaces: formatOptions.insertSpaces !== false,
  };
  const errors = [];
  for (const [extId, rt] of runtime) {
    const rec = state.extensions[extId];
    if (!rec || rec.enabled === false) continue;
    for (const { selector, provider } of rt.formatters) {
      if (!formattingSelectorMatches(selector, document.languageId)) continue;
      try {
        const edits = await provider.provideDocumentFormattingEdits(document, options, token);
        if (!Array.isArray(edits)) continue;
        if (edits.length === 0) continue;
        const normalized = edits.map((edit) => {
          if (!edit || typeof edit.newText !== "string" || !edit.range?.start || !edit.range?.end) {
            throw new Error("Formatter returned an invalid text edit");
          }
          const from = document.offsetAt(edit.range.start);
          const to = document.offsetAt(edit.range.end);
          if (to < from) throw new Error("Formatter returned an invalid edit range");
          return { from, to, newText: edit.newText };
        }).sort((a, b) => a.from - b.from || a.to - b.to);
        for (let i = 1; i < normalized.length; i++) {
          if (normalized[i].from < normalized[i - 1].to) throw new Error("Formatter returned overlapping edits");
        }
        let formatted = text;
        for (const edit of normalized.reverse()) {
          formatted = formatted.slice(0, edit.from) + edit.newText + formatted.slice(edit.to);
        }
        return { ok: true, text: formatted, extId, extName: rec.name || extId };
      } catch (e) {
        const message = String((e && e.message) || e);
        errors.push(`${rec.name || extId}: ${message}`);
        console.warn(`[ext] formatter failed ${extId}:`, message);
      }
    }
  }
  return {
    ok: false,
    error: errors.length
      ? errors.join("\n")
      : `No active document formatter is available for ${document.languageId}`,
  };
}

// ── Details (README + features) — Installed tab ke details panel ke liye ────
function readReadme(dir) {
  for (const f of ["README.md", "readme.md", "README.markdown", "Readme.md"]) {
    const p = path.join(dir, f);
    try { if (fs.existsSync(p) && fs.statSync(p).isFile()) return { file: f, text: fs.readFileSync(p, "utf8") }; } catch {}
  }
  return null;
}

function extDetails(extId) {
  const rec = state.extensions[extId];
  if (!rec) return { ok: false, error: "Not installed" };
  const rt = runtime.get(extId);
  const readme = readReadme(rec.dir);
  const commands = [...commandRegistry.entries()]
    .filter(([, e]) => e.extId === extId)
    .map(([id, e]) => ({
      id,
      title: e.title,
      category: e.category || "",
      ...(e.editorAction ? { editorAction: e.editorAction } : {}),
    }));
  const views = rt ? [...rt.views.values()].map((v) => ({ viewType: v.viewType, title: v.title })) : [];
  const statusItems = rt
    ? [...rt.statusItems.values()].filter((v) => v.visible && v.text).map((v) => ({ text: v.text, tooltip: v.tooltip || "", command: v.command || null }))
    : [];
  const mf = loadJson(path.join(rec.dir, "package.json"), {});
  return {
    ok: true,
    info: {
      id: rec.id,
      name: rec.name,
      publisher: rec.publisher || "",
      version: rec.version || "",
      description: rec.description || "",
      source: rec.source || "local",
      enabled: rec.enabled !== false,
      activated: !!rt,
      error: (rt && rt.error) || rec.error || null,
      engines: rec.engines || "",
      main: rec.main || "",
      installedAt: rec.installedAt || 0,
      dir: rec.dir,
    },
    contributes: summarizeContributions(mf),
    commands,
    formatterCount: rt ? rt.formatters.length : 0,
    views,
    statusItems,
    readme: readme ? readme.text : "",
    readmeFile: readme ? readme.file : null,
  };
}

// ── Registration (index.js ise call karta hai) ──────────────────────────────
function registerExtensions(deps = {}) {
  console.log("[ext] host registered");
  if (typeof deps.getProjectPath === "function") getProjectPath = deps.getProjectPath;

  ipcMain.handle("ext:installFolder", () => installFolderDialog());
  ipcMain.handle("ext:communityList", async (_e, repo) => {
    try { return { ok: true, ...(await community.listExtensions(repo || "")) }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
  ipcMain.handle("ext:communityInstall", (_e, repo, extFolder) => installFromCommunity(String(repo || ""), String(extFolder || "")));
  ipcMain.handle("ext:communityReadme", async (_e, repo, extFolder) => {
    try {
      const r = await community.readme(String(repo || ""), String(extFolder || ""));
      return { ok: true, readme: r ? r.text : "", file: r ? r.file : null };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  });
  ipcMain.handle("ext:details", (_e, id) => extDetails(String(id || "")));
  ipcMain.handle("ext:uninstall", (_e, id) => uninstall(String(id || "")));
  ipcMain.handle("ext:setEnabled", (_e, id, on) => setEnabled(String(id || ""), !!on));
  ipcMain.handle("ext:list", () => listInstalled());
  ipcMain.handle("ext:commands", () => listCommands());
  ipcMain.handle("ext:invoke", (_e, id) => runCommand(String(id || "")));
  ipcMain.handle("ext:format", (_e, payload = {}) =>
    formatDocument(payload.filePath, payload.text, payload.languageId, payload.options));
  ipcMain.handle("ext:views", () => viewsList());
  ipcMain.handle("ext:viewHtml", (_e, extId, viewType) => getViewHtml(String(extId || ""), String(viewType || "")));
  ipcMain.handle("ext:viewMessage", (_e, extId, viewType, msg) => {
    const rt = runtime.get(String(extId || ""));
    const view = rt && rt.views.get(String(viewType || ""));
    if (!view) return { ok: false, error: "view not found" };
    view.onMessage.fire(msg);
    return { ok: true };
  });
  ipcMain.handle("ext:statusItems", () => statusItemsList());

  app.whenReady().then(() => {
    console.log("[ext] app ready — scheduling activation");
    setTimeout(() => { activateAll().catch((e) => console.warn("[ext] activateAll:", e && e.message)); }, 800);
  });
  app.on("will-quit", () => { for (const id of [...runtime.keys()]) deactivate(id); });
}

module.exports = { registerExtensions, listCommands, runCommand, formatDocument };
