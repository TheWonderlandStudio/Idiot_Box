// ─── App extension host ──────────────────────────────────────────────────────
// OpenVSX se install hue (aur local unpacked) extensions ko load karke unhe
// ek VS Code-jaisa API surface deta hai. Sab kuch main process me chalta hai,
// renderer sirf IPC bridge hai (commands → palette, views → iframe tabs,
// status items → status bar, messages → toasts).
//
//   require("vscode")  → shim (commands/window/workspace/env/storage/…)
//   context.ibox       → hamara asli API (same cheezein, terse names)
//   activate(context)  → extension entry (function export bhi chalega)
"use strict";

const { app, ipcMain, BrowserWindow, dialog, shell, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const openvsx = require("./openvsx");

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

let state = loadJson(stateFile(), { extensions: {} });
if (!state.extensions || typeof state.extensions !== "object") state.extensions = {};
let kvStore = loadJson(storeFile(), {});

const persistState = () => saveJson(stateFile(), state);
const persistStore = () => saveJson(storeFile(), kvStore);

// ── Runtime registries (activation ke waqt bante hain) ──────────────────────
// extId → { disposables:[], commands:Map, views:Map, statusItems:Map, error }
const runtime = new Map();
const commandRegistry = new Map();   // commandId → { extId, title, category }
let statusSeq = 0;

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
  if (!rt) { rt = { disposables: [], commands: new Map(), views: new Map(), statusItems: new Map(), error: null }; runtime.set(extId, rt); }
  return rt;
}

function registerCommand(extId, commandId, fn, title, category) {
  const rt = ensureRuntime(extId);
  const id = String(commandId || "");
  if (!id || typeof fn !== "function") return Disposable(() => {});
  if (commandRegistry.has(id) && commandRegistry.get(id).extId !== extId) {
    console.warn(`[ext] command id collision: ${id} (${commandRegistry.get(id).extId} vs ${extId})`);
  }
  commandRegistry.set(id, { extId, title: title || id, category: category || "" });
  rt.commands.set(id, fn);
  changed();
  return Disposable(() => {
    if (commandRegistry.get(id)?.extId === extId) commandRegistry.delete(id);
    rt.commands.delete(id);
    changed();
  });
}

function runCommand(commandId) {
  const entry = commandRegistry.get(commandId);
  if (!entry) return { ok: false, error: `Unknown command: ${commandId}` };
  try {
    const rt = runtime.get(entry.extId);
    const fn = rt && rt.commands.get(commandId);
    if (!fn) return { ok: false, error: `Command not active: ${commandId}` };
    const r = fn();
    if (r && typeof r.then === "function") {
      r.then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
      return { ok: true };
    }
    return { ok: true };
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

// Iframe ke andar chhota bridge: extension code `ibx.post()` / `acquireVsCodeApi()`
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
window.ibx={post:post,on:function(fn){LISTENERS.push(fn);return{dispose:function(){var i=LISTENERS.indexOf(fn);if(i>=0)LISTENERS.splice(i,1);}};}};
window.addEventListener("message",function(e){var d=e.data;if(d&&d.__ibxHost&&d.extId===EXT&&d.viewType===VIEW)deliver(d.msg);});
var _state={};
window.acquireVsCodeApi=function(){return{postMessage:post,getState:function(){return _state;},setState:function(v){_state=v;}};};
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

// ── vscode shim + ibox API ──────────────────────────────────────────────────
function createApis(extRec) {
  const extId = extRec.id;
  const rt = ensureRuntime(extId);
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
  }
  class Rng {
    constructor(a, b, c, d) {
      if (typeof a === "number") { this.start = new Pos(a, b); this.end = new Pos(c, d); }
      else { this.start = a; this.end = b; }
    }
    contains() { return false; }
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

  const vsCode = {
    version: "1.94.0",
    Uri, Disposable, Emitter,
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    commands: {
      registerCommand: (id, fn, meta) => registerCommand(extId, id, fn, (meta && meta.title) || String(id).split(".").pop(), meta && meta.category),
      executeCommand: (id, ...args) => { const r = runCommand(id); return r.ok ? Promise.resolve() : Promise.reject(new Error(r.error)); },
      getCommands: () => Promise.resolve([...commandRegistry.keys()]),
    },
    window: {
      showInformationMessage: (...a) => showMessage(0, ...a),
      showWarningMessage: (...a) => showMessage(1, ...a),
      showErrorMessage: (...a) => showMessage(2, ...a),
      createStatusBarItem: (idOrOpts, alignment, priority) => {
        const opts = typeof idOrOpts === "object" && idOrOpts ? idOrOpts : { id: idOrOpts, alignment, priority };
        return createStatusItem(extId, opts);
      },
      createWebviewPanel: (viewType, title, opts) => createWebviewPanel(extId, viewType, title, opts),
      onDidChangeActiveTextEditor: new Emitter().event,
      onDidChangeVisibleTextEditors: new Emitter().event,
      onDidChangeWindowState: new Emitter().event,
      activeTextEditor: undefined,
      visibleTextEditors: [],
      withProgress: (_opts, task) => Promise.resolve(task({ report: () => {} })),
      createOutputChannel: (name) => ({
        name, appendLine: (l) => console.log(`[${extId}:${name}]`, l), append: (l) => process.stdout.write(String(l)), clear: () => {}, show: () => {}, dispose: () => {},
      }),
      createQuickPick: () => { throw new Error("createQuickPick not supported yet"); },
      setStatusBarMessage: (text) => createStatusItem(extId, { id: `spm-${++statusSeq}`, text: String(text || "") }),
      registerWebviewViewProvider: () => Disposable(() => {}),
    },
    workspace: {
      workspaceFolders: workspaceFolders(),
      getConfiguration: (section) => {
        const prefix = section ? `${section}.` : "";
        return {
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
      },
      onDidChangeConfiguration: new Emitter().event,
      onDidOpenTextDocument: new Emitter().event,
      onDidSaveTextDocument: new Emitter().event,
      onDidCloseTextDocument: new Emitter().event,
      onDidChangeWorkspaceFolders: new Emitter().event,
      textDocuments: [],
      openTextDocument: () => Promise.reject(new Error("openTextDocument not supported yet")),
      findFiles: () => Promise.resolve([]),
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
    env: {
      appName: "Idiot Box",
      appRoot: app.getAppPath(),
      language: "en",
      machineId: "idiotbox",
      sessionId: String(process.pid),
      clipboard: { writeText: (t) => { clipboard.writeText(String(t || "")); return Promise.resolve(); }, readText: () => Promise.resolve(String(clipboard.readText() || "")) },
      openExternal: (uri) => shell.openExternal(typeof uri === "string" ? uri : uri.toString()),
      uriScheme: "idiotbox",
      isTelemetryEnabled: false,
    },
    extensions: {
      getExtension: (id) => {
        const rec = state.extensions[id];
        if (!rec) return undefined;
        return { id, extensionUri: Uri.file(rec.dir), extensionPath: rec.dir, isActive: runtime.has(id), packageJSON: loadJson(path.join(rec.dir, "package.json"), {}), activate: () => Promise.resolve() };
      },
      all: () => Object.keys(state.extensions).map((id) => vsCode.extensions.getExtension(id)).filter(Boolean),
    },
    languages: {
      registerHoverProvider: () => Disposable(() => {}),
      registerCompletionItemProvider: () => Disposable(() => {}),
      registerCodeActionProvider: () => Disposable(() => {}),
      registerDefinitionProvider: () => Disposable(() => {}),
      registerDocumentSymbolProvider: () => Disposable(() => {}),
      registerDocumentFormattingEditProvider: () => Disposable(() => {}),
      registerSignatureHelpProvider: () => Disposable(() => {}),
      registerRenameProvider: () => Disposable(() => {}),
      registerSemanticTokensProvider: () => Disposable(() => {}),
      registerCodeLensProvider: () => Disposable(() => {}),
      registerLinkProvider: () => Disposable(() => {}),
      registerDocumentHighlightProvider: () => Disposable(() => {}),
      registerInlineCompletionItemProvider: () => Disposable(() => {}),
    },
    // Class-level helpers jo bohot se extensions import karti hain
    Position: Pos,
    Range: Rng,
    Selection: Sel,
    Location: Loc,
    ThemeColor,
    MarkdownString,
    CancellationTokenSource,
    EventEmitter: Emitter,
    Disposable: { from: (...ds) => ({ dispose: () => ds.forEach((d) => d && d.dispose && d.dispose()) }), create: Disposable },
  };

  // ── ibox: hamara asli API (chhota, seedha) ──────────────────────────────
  const ibox = {
    extension: { id: extId, name: extRec.name, version: extRec.version, dir: extRec.dir },
    commands: {
      registerCommand: (id, fn, title, category) => registerCommand(extId, id, fn, title, category),
      executeCommand: (id, ...args) => runCommand(id, ...args),
    },
    window: {
      showMessage: (msg, type) => { notify(type || "info", msg); return Promise.resolve(); },
      createStatusBarItem: (opts) => createStatusItem(extId, opts || {}),
      createPanel: (opts) => createWebviewPanel(extId, (opts && (opts.id || opts.viewType)) || "view", (opts && opts.title) || extRec.name, opts),
    },
    panels: {
      register: (opts) => {
        const p = createWebviewPanel(extId, opts.id || opts.viewType, opts.title || extRec.name, opts);
        if (opts.html) p.webview.html = opts.html;
        return p;
      },
    },
    storage: { globalState: memento(extId, "globalState"), workspaceState: memento(extId, "workspaceState") },
    env: vsCode.env,
    workspace: { getProjectPath: () => getProjectPath(), getConfiguration: vsCode.workspace.getConfiguration },
    log: (...a) => console.log(`[ext:${extId}]`, ...a),
  };

  return { vsCode, ibox };
}

// ── Activation / deactivation ───────────────────────────────────────────────
function deactivate(extId) {
  const rt = runtime.get(extId);
  if (!rt) return;
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
  const { vsCode, ibox } = createApis(extRec);
  const context = {
    subscriptions: rt.disposables,
    extension: { id: extRec.id, extensionUri: Uri.file(extRec.dir), extensionPath: extRec.dir, packageJSON: loadJson(path.join(extRec.dir, "package.json"), {}) },
    ibox,
    storagePath: path.join(rootDir(), ".state", extRec.id),
  };
  try { fs.mkdirSync(context.storagePath, { recursive: true }); } catch {}

  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === "vscode") return vsCode;
    return origLoad.apply(this, arguments);
  };
  let mod;
  try {
    try { delete require.cache[require.resolve(mainPath)]; } catch {}
    mod = require(mainPath);
  } catch (e) {
    rt.error = String((e && e.message) || e);
    console.warn(`[ext] failed to load ${extRec.id}:`, rt.error);
  } finally {
    Module._load = origLoad;
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
  state.extensions[id] = {
    ...prev,
    id,
    dir,
    name: manifest.displayName || manifest.name || id,
    rawName: manifest.name || id,
    publisher: manifest.publisher || (id.split(".")[0] || ""),
    version: manifest.version || "0.0.0",
    description: String((manifest.description || "").slice(0, 400)),
    main: manifest.main || manifest.browser || "extension.js",
    enabled: prev.enabled !== false,
    source: source || "vsx",
    installedAt: prev.installedAt || Date.now(),
    engines: manifest.engines && manifest.engines.vscode ? manifest.engines.vscode : "",
  };
  persistState();
  return state.extensions[id];
}

async function installFromRegistry(payload = {}) {
  const { namespace, name, version, vsix } = payload;
  if (!namespace || !name) return { ok: false, error: "namespace + name required" };
  const r = await openvsx.installFromRegistry(rootDir(), { namespace, name, version, vsix });
  const rec = addInstalled(r);
  await activate(rec);
  notify("info", `Installed ${rec.name} ${rec.version}`);
  return { ok: true, id: rec.id };
}

async function installFolderDialog() {
  const r = await dialog.showOpenDialog({ title: "Load unpacked extension folder", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  try {
    const res = openvsx.installFromFolder(r.filePaths[0], rootDir());
    const rec = addInstalled({ ...res, source: "folder" });
    await activate(rec);
    notify("info", `Loaded ${rec.name}`);
    return { ok: true, id: rec.id };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

async function installVsixDialog() {
  const r = await dialog.showOpenDialog({
    title: "Install extension (.vsix)",
    properties: ["openFile"],
    filters: [{ name: "VSIX extension", extensions: ["vsix"] }],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  try {
    const buf = fs.readFileSync(r.filePaths[0]);
    const res = await openvsx.installFromBuffer(buf, rootDir());
    const rec = addInstalled({ ...res, source: "vsix" });
    await activate(rec);
    notify("info", `Installed ${rec.name} ${rec.version}`);
    return { ok: true, id: rec.id };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

async function uninstall(extId) {
  const rec = state.extensions[extId];
  if (!rec) return { ok: false, error: "Not installed" };
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
      enabled: rec.enabled !== false,
      source: rec.source,
      engines: rec.engines || "",
      installedAt: rec.installedAt || 0,
      activated: !!rt,
      error: (rt && rt.error) || rec.error || null,
      commandCount: rt ? rt.commands.size : 0,
      views: rt ? [...rt.views.values()].map((v) => ({ viewType: v.viewType, title: v.title })) : [],
      dir: rec.dir,
    };
  });
}

function listCommands() {
  return [...commandRegistry.entries()].map(([id, e]) => {
    const rec = state.extensions[e.extId];
    return { id, title: e.title, category: e.category, extId: e.extId, extName: rec ? rec.name : e.extId };
  });
}

// ── Registration (index.js ise call karta hai) ──────────────────────────────
function registerExtensions(deps = {}) {
  console.log("[ext] host registered");
  if (typeof deps.getProjectPath === "function") getProjectPath = deps.getProjectPath;

  ipcMain.handle("ext:search", async (_e, q, opts) => {
    try { return await openvsx.search(q, opts || {}); }
    catch (e) { return { total: 0, items: [], error: String((e && e.message) || e) }; }
  });
  ipcMain.handle("ext:install", (_e, payload) => installFromRegistry(payload || {}));
  ipcMain.handle("ext:installFolder", () => installFolderDialog());
  ipcMain.handle("ext:installVsix", () => installVsixDialog());
  ipcMain.handle("ext:uninstall", (_e, id) => uninstall(String(id || "")));
  ipcMain.handle("ext:setEnabled", (_e, id, on) => setEnabled(String(id || ""), !!on));
  ipcMain.handle("ext:list", () => listInstalled());
  ipcMain.handle("ext:commands", () => listCommands());
  ipcMain.handle("ext:invoke", (_e, id) => runCommand(String(id || "")));
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

module.exports = { registerExtensions };
