// Editor panel — VS Code-style single-file editor backed by flexlayout tabs.
// Each open file = one flexlayout tab (component "editor"); this component
// renders exactly ONE file from `config.filePath`. Tab strip, tab closing and
// tab renaming (dirty ● marker) are handled through flexlayout itself.
//
// Minimap and Word Wrap are controlled via Settings (not toolbar buttons).

// The extension host treats any non-"en" language as localized and tries to
// fetch a translation bundle via a main-thread RPC ($fetchBuiltInBundleUri)
// that the standalone API does not implement — which hangs extension loading.
// Pin the NLS language to the default so localization is skipped entirely.
globalThis._VSCODE_NLS_LANGUAGE = "en";

// Single-name font picks (e.g. "Consolas") get a monospace tail so a missing
// font on stock Linux can't silently switch Monaco to a proportional grid.
const withMonoFallback = (f) => {
  const s = String(f || "").trim();
  if (!s) return s;
  return /monospace/i.test(s) ? s : `${s}, monospace`;
};

// ── Side-effect imports: default VSCode extensions (grammars + themes) MUST be
//    loaded before `initialize()` is called ─────────────────────────────────────
import "@codingame/monaco-vscode-theme-defaults-default-extension";
import "@codingame/monaco-vscode-typescript-basics-default-extension";
import "@codingame/monaco-vscode-javascript-default-extension";
import "@codingame/monaco-vscode-json-default-extension";
import "@codingame/monaco-vscode-css-default-extension";
import "@codingame/monaco-vscode-html-default-extension";
import "@codingame/monaco-vscode-markdown-basics-default-extension";
import "@codingame/monaco-vscode-python-default-extension";
import "@codingame/monaco-vscode-yaml-default-extension";
import "@codingame/monaco-vscode-php-default-extension";
import "@codingame/monaco-vscode-rust-default-extension";
import "@codingame/monaco-vscode-go-default-extension";
import "@codingame/monaco-vscode-java-default-extension";
import "@codingame/monaco-vscode-cpp-default-extension";
import "@codingame/monaco-vscode-csharp-default-extension";
import "@codingame/monaco-vscode-ruby-default-extension";
import "@codingame/monaco-vscode-xml-default-extension";
import "@codingame/monaco-vscode-sql-default-extension";
import "@codingame/monaco-vscode-bat-default-extension";
import "@codingame/monaco-vscode-powershell-default-extension";
import "@codingame/monaco-vscode-shellscript-default-extension";
import "@codingame/monaco-vscode-scss-default-extension";
import "@codingame/monaco-vscode-less-default-extension";
import "@codingame/monaco-vscode-ini-default-extension";
import "@codingame/monaco-vscode-coffeescript-default-extension";
import "@codingame/monaco-vscode-dart-default-extension";
import "@codingame/monaco-vscode-fsharp-default-extension";
import "@codingame/monaco-vscode-groovy-default-extension";
import "@codingame/monaco-vscode-handlebars-default-extension";
import "@codingame/monaco-vscode-julia-default-extension";
import "@codingame/monaco-vscode-lua-default-extension";
import "@codingame/monaco-vscode-objective-c-default-extension";
import "@codingame/monaco-vscode-perl-default-extension";
import "@codingame/monaco-vscode-r-default-extension";
import "@codingame/monaco-vscode-razor-default-extension";
import "@codingame/monaco-vscode-swift-default-extension";
import "@codingame/monaco-vscode-vb-default-extension";
import "@codingame/monaco-vscode-clojure-default-extension";
import "@codingame/monaco-vscode-pug-default-extension";
import "@codingame/monaco-vscode-diff-default-extension";
import "@codingame/monaco-vscode-shaderlab-default-extension";
import "@codingame/monaco-vscode-markdown-math-default-extension";
import "@codingame/monaco-vscode-docker-default-extension";
import "@codingame/monaco-vscode-make-default-extension";
import "@codingame/monaco-vscode-log-default-extension";
import "@codingame/monaco-vscode-restructuredtext-default-extension";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Actions } from "flexlayout-react";
import NotebookPanel from "../Notebook/index.jsx";
import { initialize, getService, IThemeService, ILanguageService, ICommandService, IExtensionService } from "@codingame/monaco-vscode-api";
import { createConfiguredEditor } from "@codingame/monaco-vscode-api/monaco";
// NOTE: "@codingame/monaco-vscode-api/monaco" does NOT export `Uri` or `editor`
// (verified: it only exports createConfiguredEditor/createModelReference/etc).
// The previous code did `import * as monaco ...` then used monaco.Uri /
// monaco.editor — both undefined — while creating the editor with value:"",
// so the file:// model swap was silently skipped and the editor stayed EMPTY
// (data load nahi ho raha). We share models via the editor instance itself
// (same vscode instance, no Uri lookup needed) and always create with
// value:text so content loads even if sharing fails.
import getTextMateServiceOverride from "@codingame/monaco-vscode-textmate-service-override";
import getThemeServiceOverride from "@codingame/monaco-vscode-theme-service-override";
import getLanguagesServiceOverride from "@codingame/monaco-vscode-languages-service-override";
import getFileServiceOverride from "@codingame/monaco-vscode-files-service-override";
import getExtensionsServiceOverride from "@codingame/monaco-vscode-extensions-service-override";
import { registerExtension, ExtensionHostKind } from "@codingame/monaco-vscode-api/extensions";

// ── Worker setup (bundled separately by esbuild) ───────────────────────────
window.MonacoEnvironment = {
  getWorker: (_moduleId, label) => {
    if (label === "TextMateWorker") return new Worker("./textmate.worker.js");
    if (label === "typescript" || label === "javascript") return new Worker("./ts.worker.js");
    if (label === "json") return new Worker("./json.worker.js");
    if (label === "html" || label === "handlebars" || label === "razor") return new Worker("./html.worker.js");
    if (label === "css" || label === "scss" || label === "less") return new Worker("./css.worker.js");
    return new Worker("./editor.worker.js");
  },
  getWorkerUrl: (_moduleId, label) => {
    if (label === "webWorkerExtensionHostIframe") return "./worker/webWorkerExtensionHostIframe.html";
    if (label === "extensionHostWorkerMain") {
      return "ibx-file://" + window.location.pathname.slice(0, window.location.pathname.lastIndexOf("/")) + "/extensionHost.worker.js";
    }
    return undefined;
  },
  getWorkerOptions: (_moduleId, label) => {
    if (label === "extensionHostWorkerMain") return { type: "module" };
    return undefined;
  },
};

// ── Demo extension (proves the extension host pipeline) ────────────────────
const demoExtension = registerExtension(
  {
    name: "demo-extension",
    displayName: "Demo Extension",
    description: "Test extension proving the extension host works",
    version: "1.0.0",
    publisher: "idiot-box",
    license: "MIT",
    engines: { vscode: "*" },
    categories: ["Other"],
    activationEvents: ["*"],
    main: "./extension.js",
    contributes: {
      commands: [
        { command: "demo.hello", title: "Demo: Hello from Extension", category: "Demo" },
      ],
    },
  },
  ExtensionHostKind.LocalWebWorker
);
const ibxExtRoot = "ibx-file://" + window.location.pathname.slice(0, window.location.pathname.lastIndexOf("/")) + "/extensions/demo-extension";
demoExtension.registerFileUrl("/package.json", ibxExtRoot + "/package.json");
demoExtension.registerFileUrl("/extension.js", ibxExtRoot + "/extension.js");

// ── VS Code services init (once) ───────────────────────────────────────────
let initPromise;
const ensureEditorReady = () => {
  if (!initPromise) {
    initPromise = initialize(
      {
        ...getTextMateServiceOverride(),
        ...getThemeServiceOverride(),
        ...getLanguagesServiceOverride(),
        ...getFileServiceOverride(),
        ...getExtensionsServiceOverride({ enableWorkerExtensionHost: true }),
      },
      document.body
    ).then(async () => {
      try {
        const themeService = await getService(IThemeService);
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            themeService.setTheme("Dark+");
            let applied = null;
            try {
              if (typeof themeService.getTheme === "function") applied = themeService.getTheme();
              else if (typeof themeService.getColorTheme === "function") applied = themeService.getColorTheme();
            } catch {}
            if (applied && /dark/i.test(applied.id || applied.label || "")) break;
            if (!applied) break; // setTheme succeeded, no verification available
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch {}
    }).catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
};

// Shared with Notebook cells: per-cell Monaco editors use the same
// createConfiguredEditor + services, so expose the singleton init promise
// here instead of calling initialize() a second time (re-init conflicts).
// Rejected when services fail — consumers must fall back (plain textarea).
try { window.__ibxEditorReady = ensureEditorReady(); } catch {}

const ext = (p) => { try { return p.slice(p.lastIndexOf(".")).toLowerCase(); } catch { return ""; } };
const fileName = (p) => { try { return p.split(/[\\/]/).pop(); } catch { return p; } };

// Language ids + content-based auto-detection live in languageDetect.mjs
// (pure ESM, unit-tested via languageDetect.test.mjs).
import { LANG_OPTIONS, detectLanguageFromContent, sniffCHeader } from "./languageDetect.mjs";

window.__ibxProbes = [];
window.addEventListener("message", (e) => {
  if (e.data && e.data.probeType === "if") {
    window.__ibxProbes.push(e.data);
    if (window.__ibxProbes.length > 60) window.__ibxProbes.shift();
  }
});

// Self-check hook: run the demo extension's command over the ext-host RPC.
ensureEditorReady()
  .then(() => {
window.__ibxExtCheck = async () => {
      const body = async () => {
        let info = {};
        const mark = (s) => { info.step = s; window.__ibxDbg = { ...info }; };
        mark("proto");
        try {
          const u = window.location.pathname.slice(0, window.location.pathname.lastIndexOf("/")) + "/extensions/demo-extension/extension.js";
          const res = await fetch("ibx-file://" + u);
          info.protoStatus = res.status;
          info.protoText = (await res.text()).slice(0, 60);
        } catch (e) { info.protoErr = String(e); }
        mark("protoWorker");
        try {
          const url = "ibx-file://" + window.location.pathname.slice(0, window.location.pathname.lastIndexOf("/")) + "/extensions/demo-extension/extension.js";
          info.protoWorker = await new Promise((resolve) => {
            try {
              const blob = new Blob([`fetch(${JSON.stringify(url)}).then(r => { self.postMessage({ status: r.status }); return r.text(); }).then(t => self.postMessage({ text: String(t).slice(0, 40) })).catch(e => self.postMessage({ err: String(e) }));`], { type: "application/javascript" });
              const w = new Worker(URL.createObjectURL(blob), { type: "module" });
              const to = setTimeout(() => { resolve({ timeout: true }); try { w.terminate(); } catch {} }, 6000);
              w.onmessage = (e) => { clearTimeout(to); resolve(e.data); w.terminate(); };
              w.onerror = (e) => { clearTimeout(to); resolve({ workerErr: e.message }); };
            } catch (e) { resolve({ createErr: String(e) }); }
          });
        } catch (e) { info.protoWorkerErr = String(e); }
        mark("blobTest");
        try {
          const wb = window.location.pathname.slice(0, window.location.pathname.lastIndexOf("/"));
          info.blobTest = await new Promise(async (resolve) => {
            const results = {};
            for (const [tag, workerUrl] of [["file", "file://" + wb + "/extensionHost.worker.js"], ["ibx", "ibx-file://" + wb + "/extensionHost.worker.js"]]) {
              results[tag] = await new Promise((r2) => {
                try {
                  const blob = new Blob([`await import(${JSON.stringify(workerUrl)});`], { type: "application/javascript" });
                  const w = new Worker(URL.createObjectURL(blob), { type: "module", name: "t" + tag });
                  const to = setTimeout(() => { r2({ timeout: true }); try { w.terminate(); } catch {} }, 8000);
                  w.onmessage = (e) => { clearTimeout(to); r2({ msg: typeof e.data === "string" ? e.data.slice(0, 60) : "non-string" }); w.terminate(); };
                  w.onerror = (e) => { clearTimeout(to); r2({ err: e.message }); };
                } catch (e) { r2({ createErr: String(e) }); }
              });
            }
            resolve(results);
          });
        } catch (e) { info.blobTestErr = String(e); }
        mark("iframe");
        try {
          const f = document.querySelector('iframe[src*=webWorkerExtensionHostIframe]');
          if (f) {
            info.iframeInfo = { readyState: f.contentDocument && f.contentDocument.readyState, href: f.contentWindow ? String(f.contentWindow.location.href).slice(0, 120) : null, cw: !!f.contentWindow };
            if (f.contentWindow) {
              try {
                f.contentWindow.eval("window.parent.postMessage({probeType:'if', step:'eval-injected'}, '*')");
                info.iframeInfo.evalInjected = true;
              } catch (e) { info.iframeInfo.evalErr = String(e); }
              try {
                const d = f.contentDocument;
                const s = d.querySelector('script').textContent;
                const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
                const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                const meta = d.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
                info.iframeInfo.scriptHash = 'sha256-' + b64;
                info.iframeInfo.hashMatches = meta.includes('sha256-' + b64);
              } catch (e) { info.iframeInfo.hashErr = String(e); }
            }
          } else {
            info.iframeInfo = { notFound: true };
          }
        } catch (e) { info.iframeInfo = { err: String(e) }; }
        try {
          mark("svc");
          const extSvc = await getService(IExtensionService);
          mark("exts");
          info.extNames = (extSvc.extensions || []).map((e) => e.name);
          info.extIds = (extSvc.extensions || []).map((e) => e.identifier?.value ?? e.id);
          try {
            mark("installed");
            info.installed = await Promise.race([
              extSvc.whenInstalledExtensionsRegistered(),
              new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 2000)),
            ]);
          } catch (err) {
            info.installedErr = err?.message || String(err);
          }
          try {
            mark("status");
            const status = extSvc.getExtensionsStatus();
            const d = status["idiot-box.demo-extension"] || status["ibx.demo-extension"];
            info.demoStatus = d && {
              activationErrors: d.activationErrors?.map((e) => e.message),
              activationTimes: d.activationTimes,
              kind: d.extensionHostKind,
              messages: d.messages?.map((m) => m.type + ":" + (m.message || "").slice(0, 200)),
            };
          } catch (err) {
            info.statusErr = err?.message || String(err);
          }
        } catch (err) {
          info.extSvcError = err?.message || String(err);
        }
        mark("cmd");
        const commandService = await getService(ICommandService);
        let lastErr = null;
        for (let i = 0; i < 30; i++) {
          try {
            const result = await commandService.executeCommand("demo.hello");
            if (result !== undefined) return { ...info, commandResult: result };
          } catch (err) {
            lastErr = err?.message || String(err);
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        return { ...info, commandResult: null, timeout: true, lastErr };
      };
      return await Promise.race([
        body(),
        new Promise((resolve) => setTimeout(() => resolve({ outerTimeout: true, dbg: window.__ibxDbg || null, probes: window.__ibxProbes || [] }), 9000)),
      ]);
    };
  })
  .catch(() => {});

// Resolve the Monaco language for a file via the VS Code language service
// (fed by the default-extension grammars), with a built-in fallback map.
let _languageService = null;
const getLanguageService = async () => {
  if (!_languageService) {
    try { _languageService = await getService(ILanguageService); } catch { _languageService = null; }
  }
  return _languageService;
};

const getMonacoLanguage = async (filePath, text) => {
  const e = ext(filePath);
  const base = fileName(filePath);
  try {
    const ls = await getLanguageService();
    if (ls) {
      const ids = ls.getRegisteredLanguageIds();
      for (const id of ids) {
        if (ls.getExtensions(id).some((x) => x && x.toLowerCase() === e)) return id;
        if (ls.getFilenames(id).some((f) => f && f.toLowerCase() === base)) return id;
      }
    }
  } catch { /* service unavailable — fall back */ }
  // Extension-less well-known filenames (Dockerfile, Makefile, Jenkinsfile…).
  const lowerBase = (base || "").toLowerCase();
  if (lowerBase === "dockerfile" || lowerBase.startsWith("dockerfile.")) return "dockerfile";
  if (lowerBase === "containerfile" || lowerBase.startsWith("containerfile.")) return "dockerfile";
  if (lowerBase === "makefile" || lowerBase === "gnumakefile") return "makefile";
  if (lowerBase === "jenkinsfile") return "groovy";
  if (lowerBase === "vagrantfile" || lowerBase === "gemfile" || lowerBase === "rakefile" || lowerBase === "brewfile") return "ruby";
  switch (e) {
    case ".js": case ".mjs": case ".cjs": return "javascript";
    case ".jsx": return "javascriptreact";
    case ".ts": return "typescript";
    case ".tsx": return "typescriptreact";
    case ".html": case ".htm": return "html";
    case ".vue": case ".svelte": return "html";
    case ".css": return "css";
    case ".scss": case ".sass": return "scss";
    case ".less": return "less";
    case ".json": case ".jsonc": return "json";
    case ".ipynb": return "json"; // raw "Open as JSON" view (cell UI is default)
    case ".md": case ".markdown": case ".mdown": return "markdown";
    case ".rst": return "restructuredtext";
    case ".log": return "log";
    case ".diff": case ".patch": case ".rej": return "diff";
    case ".py": return "python";
    case ".rs": return "rust";
    case ".go": return "go";
    case ".c": return "c";
    case ".h": return sniffCHeader(text);
    case ".cpp": case ".hpp": case ".cc": return "cpp";
    case ".cs": return "csharp";
    case ".java": return "java";
    case ".sql": return "sql";
    case ".sh": case ".bash": return "shellscript";
    case ".dockerfile": case ".containerfile": return "dockerfile";
    case ".mk": case ".mak": return "makefile";
    case ".coffee": case ".cson": case ".iced": return "coffeescript";
    case ".dart": return "dart";
    case ".fs": case ".fsi": case ".fsx": return "fsharp";
    case ".groovy": case ".gvy": case ".gradle": return "groovy";
    case ".hbs": case ".handlebars": return "handlebars";
    case ".jl": return "julia";
    case ".jmd": return "juliamarkdown";
    case ".lua": return "lua";
    case ".m": return "objective-c";
    case ".mm": return "objective-cpp";
    case ".pl": case ".pm": case ".pod": case ".t": return "perl";
    case ".raku": case ".p6": case ".pm6": return "raku";
    case ".r": return "r";
    case ".cshtml": case ".razor": return "razor";
    case ".swift": return "swift";
    case ".vb": case ".vbs": case ".bas": return "vb";
    case ".clj": case ".cljs": case ".cljc": case ".edn": return "clojure";
    case ".pug": case ".jade": return "jade";
    case ".shader": return "shaderlab";
    case ".yaml": case ".yml": return "yaml";
    case ".xml": case ".xsl": return "xml";
    case ".php": return "php";
    case ".rb": return "ruby";
    case ".bat": case ".cmd": return "bat";
    case ".ps1": return "powershell";
    case ".ini": case ".cfg": case ".toml": return "ini";
    case ".properties": return "properties";
    case ".conf": case ".editorconfig": case ".gitattributes": case ".gitconfig": case ".gitmodules": return "ini";
    default: return "plaintext";
  }
};

// ── Shared editor state (all editor tabs in the app) ───────────────────────
let activeEditorPath = null;
let autoSaveEnabled  = false;
const baseNames  = new Map();   // filePath -> tab base name
const dirtyFlags = new Map();   // filePath -> dirty boolean
// Shared Monaco models (same vscode instance, no Uri lookup): filePath -> { model, refcount }.
// Lets split-tabs / duplicate tabs edit the SAME text live. Falls back to
// per-tab models if sharing fails — content still loads either way.
const sharedModels = new Map();

// Exposed for the layout close-guard (index.jsx onAction): veto closing dirty tabs.
window.__ibxIsDirty = (p) => { try { return !!dirtyFlags.get(p); } catch { return false; } };
window.__ibxForgetDirty = (p) => { try { dirtyFlags.delete(p); baseNames.delete(p); } catch {} };

// ── AI panel bridge (Vercel AI SDK chat) ───────────────────────────────────
// Tracks live editor tabs so the AI panel can attach the current file /
// selection as context (window.__aiGetEditorContext) and insert generated
// code at the cursor ("ai:insert-code" event).
const aiEditorTabs = new Map(); // nodeId -> { filePath, editorRef }
let aiLastNotify = 0;
const aiNotifyContext = (immediate) => {
  try {
    const now = Date.now();
    if (!immediate && now - aiLastNotify < 2000) return;
    aiLastNotify = now;
    window.dispatchEvent(new CustomEvent("ai:context-changed"));
  } catch { /* ignore */ }
};
window.__aiGetEditorContext = () => {
  try {
    // Prefer the focused/active editor, fall back to any live editor tab.
    let entry = null;
    if (activeEditorPath) {
      for (const e of aiEditorTabs.values()) {
        if (e.filePath === activeEditorPath && e.editorRef?.current) { entry = e; break; }
      }
    }
    if (!entry) {
      for (const e of aiEditorTabs.values()) {
        if (e.filePath && e.editorRef?.current) { entry = e; break; }
      }
    }
    if (!entry) return null;
    const ed = entry.editorRef.current;
    const model = ed.getModel?.();
    const full = model?.getValue?.() ?? ed.getValue?.() ?? "";
    let selection = null, startLine = null, endLine = null;
    try {
      const sel = ed.getSelection?.();
      if (sel && sel.startLineNumber && sel.isEmpty?.() === false) {
        selection = model?.getValueInRange?.(sel) ?? "";
        startLine = sel.startLineNumber;
        endLine = sel.endLineNumber;
        if (selection && selection.length > 12000) {
          selection = selection.slice(0, 12000) + "\n… (truncated)";
        }
      }
    } catch { /* no selection */ }
    const fp = entry.filePath;
    return {
      filePath: fp,
      fileName: String(fp).split(/[\\/]/).pop() || fp,
      selection: selection || null,
      startLine,
      endLine,
      content: String(full || "").slice(0, 60000),
    };
  } catch { return null; }
};
if (!window.__aiInsertInstalled) {
  window.__aiInsertInstalled = true;
  window.addEventListener("ai:insert-code", (e) => {
    const code = String(e.detail?.code ?? "");
    if (!code) return;
    try {
      let ed = null;
      if (activeEditorPath) {
        for (const en of aiEditorTabs.values()) {
          if (en.filePath === activeEditorPath && en.editorRef?.current) { ed = en.editorRef.current; break; }
        }
      }
      if (!ed) {
        for (const en of aiEditorTabs.values()) {
          if (en.editorRef?.current) { ed = en.editorRef.current; break; }
        }
      }
      if (!ed || typeof ed.executeEdits !== "function") return;
      let range = null;
      try {
        const sel = ed.getSelection?.();
        if (sel && sel.startLineNumber) {
          range = sel.isEmpty?.() === false
            ? sel
            : { startLineNumber: sel.startLineNumber, startColumn: sel.startColumn, endLineNumber: sel.startLineNumber, endColumn: sel.startColumn };
        }
      } catch { /* ignore */ }
      if (!range) {
        const pos = ed.getPosition?.() || { lineNumber: 1, column: 1 };
        range = { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column };
      }
      ed.executeEdits("ai-panel", [{ range, text: code, forceMoveMarkers: true }]);
      try { ed.focus?.(); } catch {}
      try { ed.revealLineInCenter?.(range.startLineNumber); } catch {}
    } catch { /* ignore */ }
  });
}

const updateTabName = (nodeId, path) => {
  const m = window.__flexModel?.current;
  if (!m) return;
  const base = baseNames.get(path) || fileName(path) || path;
  const dirty = !!dirtyFlags.get(path);
  try {
    m.doAction(Actions.updateNodeAttributes(nodeId, { name: dirty ? base + " ●" : base }));
  } catch { /* node may be gone */ }
};

const setDirty = (nodeId, path, dirty) => {
  dirtyFlags.set(path, dirty);
  updateTabName(nodeId, path);
};

// ── Read initial editor settings (minimap / wordWrap) ─────────────────────
// Defaults: minimap=true, wordWrap=true
let _cachedEditorSettings = null;
const getEditorSettings = async () => {
  if (!_cachedEditorSettings) {
    try {
      const s = await window.electronAPI.readSettings();
      _cachedEditorSettings = s ?? {};
    } catch {
      _cachedEditorSettings = {};
    }
  }
  return _cachedEditorSettings;
};

// ── BroadcastChannel for live settings updates ────────────────────────────
// Settings window and main window are separate BrowserWindows; we use a
// BroadcastChannel so toggle changes in Settings propagate here instantly.
const settingsListeners = new Set();
const _broadcastHandler = (e) => {
  if (e.data && typeof e.data === "object") {
    // Merge into cached settings
    _cachedEditorSettings = { ...(_cachedEditorSettings ?? {}), ...e.data };
    settingsListeners.forEach((fn) => fn(e.data));
  }
};
try {
  const bc = new BroadcastChannel("editor-settings");
  bc.onmessage = _broadcastHandler;
} catch { /* BroadcastChannel unavailable */ }
try {
  const bc2 = new BroadcastChannel("app-settings");
  bc2.onmessage = _broadcastHandler;
} catch { /* BroadcastChannel unavailable */ }
// Note: DO NOT listen to terminal/git/canvas channels here.
// Terminal fontSize patches use {fontSize} on "terminal-settings" — if editor
// listened there it would incorrectly apply terminal size to the Monaco editor
// (bug: settings menu terminal slider changed editor size). Editor only cares
// about "editor-settings" / "app-settings".
// IPC fallback for settings sync across windows (file:// origins don't share BroadcastChannel)
try {
  window.electronAPI?.onSettingsUpdated?.((data) => {
    if (data && typeof data === "object") {
      _cachedEditorSettings = { ...(_cachedEditorSettings ?? {}), ...data };
      settingsListeners.forEach((fn) => fn(data));
    }
  });
} catch {}

const EditorPanel = ({ config, nodeId }) => {
  const filePath = config?.filePath || null;
  // .ipynb renders the notebook cell UI INSIDE this editor tab (like a normal
  // file tab) instead of a Monaco text editor. config.forceText bypasses this
  // ("Open as JSON" opens the raw notebook source as text).
  const forceText = config?.forceText === true;
  const isIpynb = !forceText && /\.ipynb$/i.test(filePath || "");

  // ── Project gate: editor is only usable when a project is open ───────────
  const [hasProject, setHasProject] = useState(!!window.__currentProjectPath);

  useEffect(() => {
    // Sync with current state immediately
    setHasProject(!!window.__currentProjectPath);

    const onOpen  = () => setHasProject(true);
    const onClose = () => setHasProject(false);
    window.addEventListener("project:opened",  onOpen);
    window.addEventListener("project:closed",  onClose);
    return () => {
      window.removeEventListener("project:opened",  onOpen);
      window.removeEventListener("project:closed",  onClose);
    };
  }, []);

  // ── AI bridge registration (current-file / selection context + insert) ──
  useEffect(() => {
    aiEditorTabs.set(nodeId, { filePath, editorRef });
    aiNotifyContext(true);
    return () => { aiEditorTabs.delete(nodeId); aiNotifyContext(true); };
  }, [nodeId, filePath]);

  const [content,         setContent]         = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [language,        setLanguage]        = useState("plaintext");
  const [statusMsg,       setStatusMsg]       = useState(null);
  const [cursorPos,       setCursorPos]       = useState({ line: 1, col: 1, totalLines: 1 });
  const [ready,           setReady]           = useState(false);
  const [initError,       setInitError]       = useState(null);
  // minimap & wordWrap come from settings, not local toggle buttons
  const [minimap,         setMinimap]         = useState(true);
  const [wordWrap,        setWordWrap]        = useState("on");
  const [lineNumbers,     setLineNumbers]     = useState("on");
  const [fontSize,        setFontSize]        = useState(13);
  const [fontFamily,      setFontFamily]      = useState('Consolas, "Courier New", monospace');
  const [tabSize,         setTabSize]         = useState(2);
  const [editorTheme,     setEditorTheme]     = useState("dark"); // default dark
  const [autoSave,        setAutoSave]        = useState(false);
  const [showLangMenu,    setShowLangMenu]    = useState(false);
  const [langQuery,       setLangQuery]       = useState("");
  const [detected,        setDetected]        = useState(null);  // { id, confidence, reason } from content sniffing
  const [langAuto,        setLangAuto]        = useState(false); // true while the active mode came from auto-detection

  const editorRef   = useRef(null);
  const hostRef     = useRef(null);
  const pathRef     = useRef(filePath);
  const originalRef = useRef("");
  const loadedRef   = useRef(false);
  const largeFileRef = useRef(false);
  const saveTimer   = useRef(null);
  const lastSelfSaveRef = useRef(0);

  pathRef.current = filePath;

  const flashStatus = (msg) => {
    setStatusMsg(msg);
    setTimeout(() => { setStatusMsg(null); }, 3000);
  };

  // ── Status-bar language switcher ─────────────────────────────────────────
  const setEditorLanguage = useCallback((id, isAuto = false) => {
    setShowLangMenu(false);
    setLangQuery("");
    if (!id) return;
    setLanguage(id);
    setLangAuto(!!isAuto);
    try {
      const model = editorRef.current?.getModel?.();
      if (!model) return;
      // Preferred: global monaco API (if a compatible instance is exposed).
      if (window.monaco?.editor?.setModelLanguage) {
        window.monaco.editor.setModelLanguage(model, id);
        return;
      }
      // Fallback: vscode ITextModel exposes setLanguage directly.
      if (typeof model.setLanguage === "function") {
        model.setLanguage(id);
        return;
      }
    } catch {}
  }, []);

  // ── Re-run content detection on the live buffer (picker "Auto-detect") ───
  // Useful after pasting a shebang / converting a plaintext scratch buffer.
  const runAutoDetect = useCallback(() => {
    try {
      const v = editorRef.current?.getValue?.() ?? "";
      const hit = detectLanguageFromContent(v);
      if (hit && hit.id && hit.id !== "plaintext") {
        setDetected(hit);
        setEditorLanguage(hit.id, true);
        flashStatus(`Auto-detected language: ${hit.id} (${hit.reason})`);
      } else {
        flashStatus("No language detected — pick one below");
      }
    } catch {
      flashStatus("Detection failed — pick a language below");
    }
  }, [setEditorLanguage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load editor settings on mount ────────────────────────────────────────
  useEffect(() => {
    getEditorSettings().then((s) => {
      setMinimap(s.minimap !== false);
      setWordWrap(s.wordWrap !== false ? "on" : "off");
      setLineNumbers(s.lineNumbers !== false ? "on" : "off");
      if (Number.isFinite(s.fontSize)) setFontSize(Math.min(32, Math.max(8, s.fontSize)));
      // single-name picks (e.g. "Consolas") get a monospace tail so a missing
      // font (stock Linux) can't switch Monaco to a proportional grid
      if (s.fontFamily) setFontFamily(withMonoFallback(s.fontFamily));
      if (Number.isFinite(s.tabSize)) setTabSize(s.tabSize);
      const th = s.editorTheme || s.theme || "dark";
      setEditorTheme(th);
      if ("autoSave" in s) {
        const enabled = s.autoSave === true || s.autoSave === "afterDelay";
        autoSaveEnabled = enabled;
        setAutoSave(enabled);
        try { window.dispatchEvent(new CustomEvent("editor:autosave", { detail: { enabled } })); } catch {}
      } else {
        setAutoSave(false);
      }
    });

    // Listen for live changes from the Settings window
    const handler = (patch) => {
      if ("minimap"  in patch) setMinimap(patch.minimap !== false);
      if ("wordWrap" in patch) setWordWrap(patch.wordWrap !== false ? "on" : "off");
      if ("lineNumbers" in patch) setLineNumbers(patch.lineNumbers !== false ? "on" : "off");
      if ("fontSize" in patch && Number.isFinite(patch.fontSize)) setFontSize(Math.min(32, Math.max(8, patch.fontSize)));
      if ("fontFamily" in patch && patch.fontFamily) setFontFamily(withMonoFallback(patch.fontFamily));
      if ("tabSize" in patch && Number.isFinite(patch.tabSize)) setTabSize(patch.tabSize);
      if ("editorTheme" in patch || "theme" in patch) {
        const th = patch.editorTheme || patch.theme;
        if (th) setEditorTheme(th);
      }
      if ("autoSave" in patch) {
        const enabled = patch.autoSave === true || patch.autoSave === "afterDelay";
        autoSaveEnabled = enabled;
        setAutoSave(enabled);
        try { window.dispatchEvent(new CustomEvent("editor:autosave", { detail: { enabled } })); } catch {}
      }
    };
    settingsListeners.add(handler);
    // Also listen via IPC (BroadcastChannel doesn't work across file:// origins)
    let unsubIpc = null;
    try { unsubIpc = window.electronAPI?.onSettingsUpdated?.((data) => {
      if (data && typeof data === "object") {
        _cachedEditorSettings = { ...(_cachedEditorSettings ?? {}), ...data };
        handler(data);
      }
    }); } catch {}
    return () => { settingsListeners.delete(handler); try { unsubIpc?.(); } catch {} };
  }, []);

  // ── Git diff gutter CSS ──────────────────────────────────────────────────
  useEffect(() => {
    if (document.getElementById("git-diff-style")) return;
    const style = document.createElement("style");
    style.id = "git-diff-style";
    style.textContent = `
      .git-diff-added { background: rgba(115,201,145,0.15) !important; }
      .git-diff-added-glyph { border-left: 3px solid #73c991 !important; margin-left: 3px; }
      .git-diff-modified { background: rgba(204,167,0,0.12) !important; }
      .git-diff-modified-glyph { border-left: 3px solid #cca700 !important; margin-left: 3px; }
      .git-diff-removed { background: rgba(244,71,71,0.12) !important; }
    `;
    document.head.appendChild(style);
  }, []);

  // ── Bootstrap VS Code services once ──────────────────────────────────────
  useEffect(() => {
    ensureEditorReady()
      .then(() => {
        setReady(true);
        // Notify Problems panel etc. that the editor stack is ready.
        // NOTE: we deliberately do NOT set window.monaco to the
        // "@codingame/monaco-vscode-api/monaco" wrapper — it has no
        // `editor`/`Uri` namespace, and assigning it broke setModelLanguage
        // / getModelMarkers consumers. Problems stays event-driven and will
        // use whatever compatible monaco instance is available, if any.
        try {
          window.dispatchEvent(new CustomEvent("monaco:ready"));
        } catch {}
      })
      .catch((err) => setInitError(err?.message || String(err)));
  }, []);

  // ── Apply editor theme from settings (default dark) ───────────────────────
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const map = {
        dark: "Visual Studio Dark",
        darkPlus: "Dark+",
        darkModern: "Dark Modern",
        dark2026: "Dark 2026",
        light: "Visual Studio Light",
        lightPlus: "Light+",
        lightModern: "Light Modern",
        light2026: "Light 2026",
        hcDark: "Default High Contrast",
        hcLight: "Default High Contrast Light",
        "Visual Studio Dark": "Visual Studio Dark",
        "Visual Studio Light": "Visual Studio Light",
        "Dark+": "Dark+",
        "Dark Modern": "Dark Modern",
        "Dark 2026": "Dark 2026",
        "Light+": "Light+",
        "Light Modern": "Light Modern",
        "Light 2026": "Light 2026",
      };
      const target = map[editorTheme] || map.dark;
      // Retry loop — theme service may need a tick after initialize
      for (let attempt = 0; attempt < 8; attempt++) {
        if (cancelled) return;
        try {
          const ts = await getService(IThemeService);
          if (!ts) throw new Error("theme service not ready");
          if (typeof ts.setTheme !== "function") throw new Error("setTheme not available");
          ts.setTheme(target);
          await new Promise((r) => setTimeout(r, 80));
          let applied = null;
          try {
            if (typeof ts.getTheme === "function") applied = ts.getTheme();
            else if (typeof ts.getColorTheme === "function") applied = ts.getColorTheme();
            else if (typeof ts.getThemeId === "function") applied = { id: ts.getThemeId() };
          } catch {}
          const id = applied?.id || applied?.label || target;
          console.log(`[editor] theme ${editorTheme} -> ${target} applied: ${id} (attempt ${attempt+1})`);
          if (id && target.toLowerCase() === id.toLowerCase()) break;
          if (id && id.toLowerCase().includes(target.split(" ")[0].toLowerCase())) break;
          if (applied && !/visual studio dark|dark\+|dark modern|dark 2026/i.test(id) && /dark/i.test(target)) {
            try { ts.setTheme("Visual Studio Dark"); } catch {}
          } else if (applied && !/visual studio light|light\+|light modern|light 2026/i.test(id) && /light/i.test(target)) {
            try { ts.setTheme("Visual Studio Light"); } catch {}
          }
          break;
        } catch (e) {
          console.warn(`[editor] theme set failed attempt ${attempt+1}:`, e.message);
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      // Note: monaco theme is managed via themeService, no direct monaco call needed
    })();
    return () => { cancelled = true; };
  }, [ready, editorTheme]);

  // ── Live apply settings via editor.updateOptions (no recreation) ──────────
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    try {
      ed.updateOptions({
        minimap: { enabled: minimap && !largeFileRef.current },
        wordWrap: largeFileRef.current ? "off" : wordWrap,
        lineNumbers: lineNumbers,
        fontSize: fontSize,
        fontFamily: fontFamily,
        tabSize: tabSize,
        detectIndentation: true,
        glyphMargin: false,
        lineDecorationsWidth: 12,
        lineNumbersMinChars: 4,
        folding: true,
        foldingHighlight: true,
        showFoldingControls: "mouseover",
        stickyScroll: { enabled: !largeFileRef.current },
        bracketPairColorization: { enabled: true },
        guides: {
          bracketPairs: true,
          bracketPairsHorizontal: true,
          highlightActiveBracketPair: true,
          highlightActiveIndentation: true,
        },
        mouseWheelZoom: true,
        renderWhitespace: "selection",
        padding: { top: 8 },
        cursorSmoothCaretAnimation: "on",
        renderLineHighlight: "all",
      });
    } catch {}
  }, [minimap, wordWrap, lineNumbers, fontSize, fontFamily, tabSize]);

  // ── Create / swap the configured editor when the file changes ──────────────
  // Skipped for .ipynb (NotebookPanel owns the tab content instead).
  useEffect(() => {
    if (!ready || !filePath || !hostRef.current || isIpynb) return;
    loadedRef.current = false;
    largeFileRef.current = false;
    let cancelled = false;
    let disposed = false;
    const fp = filePath;
    let cleanup = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(saveTimer.current);
      window.removeEventListener("resize", onWinResize);
      ro?.disconnect();
      contentSub?.dispose();
      cursorSub?.dispose();
      focusSub?.dispose();
      try { editor?.dispose(); } catch {}
      if (editorRef.current === editor) editorRef.current = null;
      // Release the shared model when the last tab for this file closes
      // (otherwise models leak forever). Shared models all come from the
      // same vscode instance via editor.getModel(), so plain dispose is enough.
      try {
        const entry = sharedModels.get(fp);
        if (entry) {
          entry.refcount -= 1;
          if (entry.refcount <= 0) {
            sharedModels.delete(fp);
            // If this editor still holds the shared model, editor.dispose()
            // above already detached it; dispose the model itself now — but
            // only if no other live editor is still using it.
            try {
              const stillUsed = entry.model && editorRef.current?.getModel?.() === entry.model;
              if (!stillUsed) entry.model?.dispose?.();
            } catch {}
          }
        }
      } catch {}
    };
    let editor = null, ro = null, contentSub = null, cursorSub = null, focusSub = null, onWinResize = null;

    (async () => {
      const text = await window.electronAPI.readTextFile(filePath);
      if (cancelled || disposed || !hostRef.current) return;
      const isBinaryExt = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".wasm"].some(ext => filePath.toLowerCase().endsWith(ext));
      if (text === null || isBinaryExt) {
        loadedRef.current = false;
        flashStatus(`Binary or unreadable file: ${fileName(filePath)}`);
        const host = hostRef.current;
        if (host) {
          host.innerHTML = `<div style="padding:24px; color:#888; text-align:center; font-family:sans-serif; font-size:13px;">Binary or unsupported file type (${fileName(filePath)}).<br/>Editing is disabled to prevent corruption.</div>`;
        }
        return;
      }

      loadedRef.current = true;
      baseNames.set(filePath, fileName(filePath));

      const lang = await getMonacoLanguage(filePath, text);
      // ── Content-based auto-detection ───────────────────────────────────
      // Filename said "plaintext" (unknown/missing extension) → sniff the text
      // for shebangs, modelines and syntax fingerprints instead of leaving
      // the file unhighlighted.
      let finalLang = lang;
      let detectedInfo = null;
      if (lang === "plaintext") {
        try {
          const hit = detectLanguageFromContent(text);
          if (hit && hit.id && hit.id !== "plaintext") {
            finalLang = hit.id;
            detectedInfo = hit;
          }
        } catch { /* detection never breaks file open */ }
      }
      // ── Large-file guard: >1MB → minimap/wordWrap/sticky off (perf) ──────
      const isLargeFile = text.length > 1024 * 1024;
      largeFileRef.current = isLargeFile;
      if (isLargeFile) {
        flashStatus(`Large file (${(text.length / 1048576).toFixed(1)} MB) — minimap & word wrap off for performance`);
      } else if (detectedInfo) {
        flashStatus(`Auto-detected language: ${detectedInfo.id} (${detectedInfo.reason})`);
      }
      setCursorPos({ line: 1, col: 1, totalLines: text.split("\n").length });

      const host = hostRef.current;
      host.innerHTML = "";

      try {
        editor = createConfiguredEditor(host, {
          value: text,
          language: finalLang,
          automaticLayout: true,
          minimap: { enabled: minimap && !isLargeFile },
          wordWrap: isLargeFile ? "off" : wordWrap,
          lineNumbers: lineNumbers,
          fontSize: fontSize,
          fontFamily: fontFamily,
          smoothScrolling: true,
          cursorBlink: "smooth",
          cursorSmoothCaretAnimation: "on",
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
          tabSize: tabSize,
          detectIndentation: true,
          glyphMargin: false,
          lineDecorationsWidth: 12,
          lineNumbersMinChars: 4,
          folding: true,
          foldingHighlight: true,
          showFoldingControls: "mouseover",
          stickyScroll: { enabled: !isLargeFile },
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            bracketPairsHorizontal: true,
            highlightActiveBracketPair: true,
            highlightActiveIndentation: true,
          },
          mouseWheelZoom: true,
          renderWhitespace: "selection",
          padding: { top: 8 },
        });
      } catch (err) {
        setInitError(err?.message || String(err));
        return;
      }
      if (cancelled || disposed) { try { editor.dispose(); } catch {} return; }

      // ── Share one Monaco model across tabs of the same file ──────────────
      // Same vscode instance via editor.getModel()/setModel() — no Uri lookup
      // needed (the old monaco.Uri/monaco.editor path was undefined and left
      // the editor empty). Another tab may hold unsaved edits — adopt those.
      let finalValue = text;
      try {
        const freshModel = editor.getModel?.() || null;
        const existing = sharedModels.get(filePath);
        const existingAlive = existing?.model && (typeof existing.model.isDisposed !== "function" || !existing.model.isDisposed());
        if (existingAlive) {
          try { finalValue = existing.model.getValue(); } catch { finalValue = text; }
          if (freshModel && freshModel !== existing.model) {
            try { editor.setModel(existing.model); } catch {}
            try { freshModel.dispose?.(); } catch {}
          }
          existing.refcount += 1;
        } else if (freshModel) {
          if (existing) sharedModels.delete(filePath);
          sharedModels.set(filePath, { model: freshModel, refcount: 1 });
        }
      } catch { /* keep per-tab model with text — content still loads */ }

      setContent(finalValue);
      setOriginalContent(text);
      setLanguage(finalLang);
      setDetected(detectedInfo);
      setLangAuto(!!detectedInfo);
      originalRef.current = text;
      const isDirty = finalValue !== text;
      dirtyFlags.set(filePath, isDirty);
      updateTabName(nodeId, filePath);

      editorRef.current = editor;
      activeEditorPath = filePath;

      // Live sync with component/preview panels: announce the active editor
      // file and push its current source so previews update without a save.
      try {
        window.dispatchEvent(new CustomEvent("editor:fileActivated", { detail: { path: filePath } }));
        window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: filePath, code: text } }));
      } catch { /* ignore */ }

      const layout = () => {
        try {
          // Pass the host's real size explicitly — using no args keeps Monaco's
          // own (stuck 5x5) size when the editor was created in a hidden tab.
          const rect = host.getBoundingClientRect();
          editor.layout({
            width: Math.max(Math.round(rect.width), 1),
            height: Math.max(Math.round(rect.height), 1),
          });
        } catch { /* noop */ }
      };
      const rafId = requestAnimationFrame(layout);
      const t1 = setTimeout(layout, 120);
      const t2 = setTimeout(layout, 600);
      onWinResize = layout;
      window.addEventListener("resize", onWinResize);
      try {
        ro = new ResizeObserver(layout);
        ro.observe(host);
      } catch { /* ResizeObserver unavailable */ }

      // Self-healing size check: ResizeObserver/rAF can be missed when the tab
      // mounts while hidden (e.g. restored from session) or the page is
      // backgrounded, which leaves monaco stuck at 5x5. Every 500ms compare the
      // host's real size to the editor's and re-layout when they differ.
      let lastW = 0, lastH = 0;
      const sizeCheck = () => {
        try {
          const r = host.getBoundingClientRect();
          const w = Math.max(Math.round(r.width), 1);
          const h = Math.max(Math.round(r.height), 1);
          if (w === lastW && h === lastH) return;
          lastW = w; lastH = h;
          const li = editor.getLayoutInfo();
          if (li.width !== w || li.height !== h) editor.layout({ width: w, height: h });
        } catch { /* noop */ }
      };
      const sizeIv = setInterval(sizeCheck, 500);

      contentSub = editor.onDidChangeModelContent(() => {
        const v = editor.getValue();
        setContent(v);
        const p = pathRef.current;
        if (p) {
          setDirty(nodeId, p, v !== originalRef.current);
          if (autoSaveEnabled) {
            clearTimeout(saveTimer.current);
            saveTimer.current = setTimeout(() => { doSave(); }, 800);
          }
          // Live sync: push the in-memory source to component preview panels.
          try {
            window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: p, code: v } }));
          } catch { /* ignore */ }
          aiNotifyContext(false);
        }
      });
      cursorSub = editor.onDidChangeCursorPosition((e) => {
        setCursorPos({
          line: e.position.lineNumber,
          col: e.position.column,
          totalLines: editor.getModel()?.getLineCount() || 1,
        });
      });
      focusSub = editor.onDidFocusEditorText(() => {
        activeEditorPath = pathRef.current;
        aiNotifyContext(true);
        try {
          window.dispatchEvent(new CustomEvent("editor:fileActivated", { detail: { path: pathRef.current } }));
        } catch { /* ignore */ }
      });

      const done = (fn) => () => {
        cancelAnimationFrame(rafId);
        clearTimeout(t1);
        clearTimeout(t2);
        clearInterval(sizeIv);
        fn?.();
      };
      const originalCleanup = cleanup;
      cleanup = done(originalCleanup);
    })();

    return () => { cancelled = true; cleanup(); };
  }, [ready, filePath, nodeId, hasProject, isIpynb]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live reload: external edits (other apps / git / build tools) → auto-update
  // Skipped for .ipynb (NotebookPanel watches the file itself).
  useEffect(() => {
    if (!filePath || isIpynb) return;
    let timer = null;
    const unsub = window.electronAPI.onFsChange((_dir, changedPath) => {
      if (changedPath !== filePath) return;
      if (Date.now() - lastSelfSaveRef.current < 1200) return; // our own save
      if (dirtyFlags.get(filePath)) return; // unsaved local edits win
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const text = await window.electronAPI.readTextFile(filePath);
        if (text === null) return;
        const ed = editorRef.current;
        if (!ed) return;
        const model = ed.getModel();
        const cur = model?.getValue() ?? "";
        if (cur === text) return;
        if (model) model.setValue(text);
        originalRef.current = text;
        setOriginalContent(text);
        dirtyFlags.set(filePath, false);
        updateTabName(nodeId, filePath);
        setCursorPos((p) => ({ ...p, totalLines: text.split("\n").length }));
        try {
          window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: filePath, code: text } }));
        } catch { /* ignore */ }
        flashStatus("File changed on disk — reloaded");
      }, 150);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [filePath, nodeId, isIpynb]);

  // ── Live Edit from Browser (text-only) ───────────────────────────────────
  // Skipped for .ipynb (cell UI is not a text buffer).
  useEffect(() => {
    if (!filePath || isIpynb) return;
    const handler = async (e) => {
      const p = e.detail?.filePath || e.detail?.path;
      if (!p || p !== filePath) return;
      try {
        const text = await window.electronAPI.readTextFile(filePath);
        if (text === null) return;
        const ed = editorRef.current;
        if (!ed) {
          // no editor yet, just update refs
          originalRef.current = text;
          setOriginalContent(text);
          setContent(text);
          return;
        }
        const model = ed.getModel();
        const cur = model?.getValue() ?? "";
        if (cur === text) return;
        // Preserve cursor/selection
        let sel = null;
        try { sel = ed.getSelection(); } catch {}
        if (model) model.setValue(text);
        originalRef.current = text;
        setOriginalContent(text);
        // mark dirty = false since disk is source of truth after live edit (unless user had unsaved changes, we still sync but keep dirty? prefer resync)
        dirtyFlags.set(filePath, false);
        updateTabName(nodeId, filePath);
        setCursorPos((pr) => ({ ...pr, totalLines: text.split("\n").length }));
        if (sel) try { ed.setSelection(sel); ed.revealLineInCenter(sel.positionLineNumber || 1); } catch {}
        try { window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: filePath, code: text } })); } catch {}
        flashStatus(`Live edit — updated from Browser (${e.detail?.rel || filePath.split(/[\\/]/).pop()})`);
      } catch {}
    };
    const handlerMain = async (payload) => {
      const p = payload?.filePath;
      if (!p || p !== filePath) return;
      // reuse same logic
      try {
        const text = await window.electronAPI.readTextFile(filePath);
        if (text === null) return;
        const ed = editorRef.current;
        if (!ed) return;
        const model = ed.getModel();
        const cur = model?.getValue() ?? "";
        if (cur === text) return;
        let sel = null; try { sel = ed.getSelection(); }catch{}
        if (model) model.setValue(text);
        originalRef.current = text; setOriginalContent(text);
        dirtyFlags.set(filePath, false); updateTabName(nodeId, filePath);
        setCursorPos((pr)=> ({...pr, totalLines: text.split("\n").length}));
        if(sel) try{ ed.setSelection(sel);}catch{}
        try{ window.dispatchEvent(new CustomEvent("component:sourceChanged",{detail:{path:filePath,code:text}}));}catch{}
        flashStatus(`Live edit — ${payload?.rel || "updated"}`);
      } catch {}
    };
    window.addEventListener("liveEdit:applied", handler);
    window.addEventListener("liveEdit:fileChanged", handler);
    const unsub = window.electronAPI.onLiveEditFileChanged ? window.electronAPI.onLiveEditFileChanged(handlerMain) : () => {};
    return () => {
      window.removeEventListener("liveEdit:applied", handler);
      window.removeEventListener("liveEdit:fileChanged", handler);
      try{ unsub(); }catch{}
    };
  }, [filePath, nodeId, isIpynb]);

  // ── Reveal line (from SearchPanel / Problems) ──────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const p = e.detail?.path;
      const line = e.detail?.line;
      const col = e.detail?.column || 1;
      if (!p || p !== filePath) return;
      const ed = editorRef.current;
      if (!ed) return;
      try {
        ed.revealLineInCenter(line || 1);
        ed.setPosition({ lineNumber: line || 1, column: col });
        ed.focus();
      } catch {}
    };
    window.addEventListener("editor:revealLine", handler);
    return () => window.removeEventListener("editor:revealLine", handler);
  }, [filePath]);

  // ── Git diff gutter ────────────────────────────────────────────────────────
  // Skipped for .ipynb (no Monaco model to decorate).
  useEffect(() => {
    if (!filePath || !hasProject || isIpynb) return;
    let cancelled = false;
    let decorationIds = [];
    const updateDiff = async () => {
      if (document.hidden) return;
      const ed = editorRef.current;
      if (!ed || cancelled) return;
      try {
        const root = window.__currentProjectPath;
        if (!root) return;
        // Respect Git → Show Git Gutter (was dead — always showed)
        try {
          const s = await window.electronAPI.readSettings().catch(()=> ({}));
          const g = s.git || {};
          const showGutter = g.showGutter !== false && s.gitShowGutter !== false && g.enableGutter !== false && s.gitEnableGutter !== false;
          if (!showGutter) {
            try { decorationIds = ed.deltaDecorations(decorationIds, []); } catch {}
            return;
          }
        } catch {}
        const diff = await window.electronAPI.gitDiff(root, filePath);
        if (cancelled || !ed) return;
        const model = ed.getModel();
        if (!model) return;
        // Parse unified diff with --unified=0 to get changed lines
        const added = new Set();
        const modified = new Set();
        const removed = new Set();
        for (const line of String(diff || "").split("\n")) {
          if (line.startsWith("@@")) {
            const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
            if (m) {
              const start = parseInt(m[1], 10);
              const count = m[2] ? parseInt(m[2], 10) : 1;
              if (count === 0) {
                // Deletion
                removed.add(start);
              } else {
                for (let i = 0; i < count; i++) {
                  const ln = start + i;
                  // Simple heuristic: if original had 0 lines, it's added
                  if (line.includes("@@ -0,0")) added.add(ln);
                  else modified.add(ln);
                }
              }
            }
          }
        }
        // Fallback: if diff is non-empty but parsing failed, mark all as modified
        if (!added.size && !modified.size && !removed.size && String(diff).trim()) {
          // Try to get changed lines via git diff --name-only and mark whole file?
        }
        const decorations = [];
        for (const ln of added) {
          decorations.push({ range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: "git-diff-added", glyphMarginClassName: "git-diff-added-glyph" } });
        }
        for (const ln of modified) {
          if (!added.has(ln)) decorations.push({ range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: "git-diff-modified", glyphMarginClassName: "git-diff-modified-glyph" } });
        }
        for (const ln of removed) {
          decorations.push({ range: { startLineNumber: ln, startColumn: 1, endLineNumber: ln, endColumn: 1 }, options: { isWholeLine: true, linesDecorationsClassName: "git-diff-removed" } });
        }
        // Apply decorations (monaco API)
        try {
          decorationIds = ed.deltaDecorations(decorationIds, decorations);
        } catch {
          try { decorationIds = model.deltaDecorations(decorationIds, decorations); } catch {}
        }
      } catch {}
    };
    updateDiff();
    // Live gutter toggle
    let bc;
    try { bc = new BroadcastChannel("git-settings"); bc.onmessage = () => updateDiff(); } catch {}
    let unsubSettings;
    try { unsubSettings = window.electronAPI.onSettingsUpdated((patch)=>{ if(patch && (patch.git||"gitShowGutter" in patch||"gitEnableGutter" in patch||"showGutter" in patch||"enableGutter" in patch)) updateDiff(); }); } catch {}
    const iv = setInterval(() => { if (!document.hidden) updateDiff(); }, 10000);
    let fsDebounce = null;
    const onFs = () => {
      clearTimeout(fsDebounce);
      fsDebounce = setTimeout(() => { if (!document.hidden) updateDiff(); }, 1200);
    };
    const onVis = () => { if (!document.hidden) updateDiff(); };
    window.addEventListener("project:opened", onFs);
    document.addEventListener("visibilitychange", onVis);
    const unsub = window.electronAPI.onFsChange(onFs);
    return () => {
      cancelled = true;
      try{ bc?.close(); }catch{}
      try{ unsubSettings?.(); }catch{}
      clearInterval(iv);
      clearTimeout(fsDebounce);
      window.removeEventListener("project:opened", onFs);
      document.removeEventListener("visibilitychange", onVis);
      unsub();
      try {
        const ed = editorRef.current;
        if (ed && decorationIds.length) {
          try { ed.deltaDecorations(decorationIds, []); } catch {}
        }
      } catch {}
    };
  }, [filePath, hasProject, content, isIpynb]);

  // ── Save / Save As ───────────────────────────────────────────────────────
  // No-ops for .ipynb — NotebookPanel owns saving (it listens to the same
  // editor:command events with the same path).
  const doSave = useCallback(async () => {
    const p = pathRef.current;
    if (!p || isIpynb) return;
    if (!loadedRef.current) { flashStatus("Nothing to save — file was not loaded"); return; }
    // Format on Save (Settings → Editor → Format On Save, default off).
    // No-op when the language has no formatter registered.
    try {
      const s = _cachedEditorSettings ?? await getEditorSettings().catch(() => ({}));
      if (s?.formatOnSave === true && editorRef.current) {
        try { await editorRef.current.getAction("editor.action.formatDocument")?.run(); } catch {}
      }
    } catch {}
    const text = editorRef.current?.getValue() ?? content;
    const result = await window.electronAPI.writeFileText(p, text);
    if (result?.success) {
      lastSelfSaveRef.current = Date.now();
      originalRef.current = text;
      setOriginalContent(text);
      setDirty(nodeId, p, false);
      flashStatus(`Saved: ${fileName(p)}`);
    } else {
      await window.electronAPI.showAlert(`Failed to save file:\n${result?.error || "Unknown error"}`);
    }
  }, [nodeId, content, isIpynb]);

  const doSaveAs = useCallback(async () => {
    const p = pathRef.current;
    if (!p || isIpynb) return;
    if (!loadedRef.current) { flashStatus("Nothing to save — file was not loaded"); return; }
    const text = editorRef.current?.getValue() ?? content;
    const result = await window.electronAPI.saveFileAs(p, text);
    if (result?.canceled) return;
    if (result?.error) { await window.electronAPI.showAlert(`Save As failed:\n${result.error}`); return; }
    const newPath = result.path;
    baseNames.delete(p);
    dirtyFlags.delete(p);
    baseNames.set(newPath, fileName(newPath));
    dirtyFlags.set(newPath, false);
    const m = window.__flexModel?.current;
    if (m) {
      try {
        m.doAction(Actions.updateNodeAttributes(nodeId, { name: fileName(newPath), config: { filePath: newPath } }));
      } catch { /* node may be gone */ }
    }
    flashStatus(`Saved as: ${fileName(newPath)}`);
  }, [nodeId, content, isIpynb]);

  // ── File & Edit menu commands ────────────────────────────────────────────
  // .ipynb tabs ignore everything here — the embedded NotebookPanel handles
  // save itself (same event, same path) and has no Monaco instance.
  useEffect(() => {
    if (isIpynb) return;
    const onCmd = async (e) => {
      const cmd = e.detail?.cmd;
      if (!cmd) return;

      const p = pathRef.current;
      // For save/saveAs the file must be loaded; for editor actions we just
      // need the editor to be the active one (path matches or no path given).
      const target = e.detail?.path ?? activeEditorPath;
      const isActive = !target || p === target;

      // ── Save commands (require a loaded file) ──────────────────────────
      if (cmd === "save")   { if (p && isActive) doSave();   return; }
      if (cmd === "saveAs") { if (p && isActive) doSaveAs(); return; }

      // ── Monaco editor actions (no file required, but must be active) ───
      if (!isActive) return;
      const ed = editorRef.current;
      if (!ed) return;

      try {
        switch (cmd) {
          case "undo":         ed.trigger("menu", "undo",                    {}); break;
          case "redo":         ed.trigger("menu", "redo",                    {}); break;
          case "cut":          ed.trigger("menu", "editor.action.clipboardCutAction",   {}); break;
          case "copy":         ed.trigger("menu", "editor.action.clipboardCopyAction",  {}); break;
          case "paste":        ed.trigger("menu", "editor.action.clipboardPasteAction", {}); break;
          case "selectAll":    ed.trigger("menu", "editor.action.selectAll",  {}); break;
          case "find":         ed.trigger("menu", "actions.find",             {}); break;
          case "findNext":     ed.trigger("menu", "editor.action.nextMatchFindAction",     {}); break;
          case "findPrevious": ed.trigger("menu", "editor.action.previousMatchFindAction", {}); break;
          case "replace":      ed.trigger("menu", "editor.action.startFindReplaceAction", {}); break;
          case "format":       try { await ed.getAction("editor.action.formatDocument")?.run(); } catch {} break;
          case "gotoLine":     try { await ed.getAction("editor.action.gotoLine")?.run(); } catch {} break;
          case "gotoSymbol":   try { await ed.getAction("editor.action.quickOutline")?.run(); } catch {} break;
          case "commentLine":  try { await ed.getAction("editor.action.commentLine")?.run(); } catch {} break;
          case "copyLineDown": try { await ed.getAction("editor.action.copyLinesDownAction")?.run(); } catch {} break;
          case "copyLineUp":   try { await ed.getAction("editor.action.copyLinesUpAction")?.run(); } catch {} break;
          case "moveLineUp":   try { await ed.getAction("editor.action.moveLinesUpAction")?.run(); } catch {} break;
          case "moveLineDown": try { await ed.getAction("editor.action.moveLinesDownAction")?.run(); } catch {} break;
          default: break;
        }
      } catch { /* ignore if editor not ready */ }
    };
    window.addEventListener("editor:command", onCmd);
    return () => window.removeEventListener("editor:command", onCmd);
  }, [doSave, doSaveAs, isIpynb]);

  // ── AutoSave toggle ──────────────────────────────────────────────────────
  useEffect(() => {
    const onAuto = (e) => {
      const enabled = e.detail?.enabled === true;
      autoSaveEnabled = enabled;
      setAutoSave(enabled);
    };
    window.addEventListener("editor:autosave", onAuto);
    return () => window.removeEventListener("editor:autosave", onAuto);
  }, []);

  useEffect(() => () => { clearTimeout(saveTimer.current); }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "#1e1e1e",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── No project gate ──────────────────────────────────────────────── */}
      {!hasProject ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", flexDirection: "column", gap: 14,
        }}>
          <svg width="52" height="52" viewBox="0 0 16 16" fill="none">
            <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.086a1.5 1.5 0 0 1 1.06.44L7.56 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9Z" fill="#3a3a3a"/>
          </svg>
          <span style={{ color: "#666", fontWeight: 600, fontSize: 13 }}>No project open</span>
          <span style={{ color: "#444", fontSize: 11, textAlign: "center", maxWidth: 220, lineHeight: 1.6 }}>
            Open a project from the <strong style={{ color: "#555" }}>File</strong> menu or the Project Panel,
            then select a file to edit.
          </span>
          <button
            onClick={() => window.electronAPI.openFolder()}
            style={{
              marginTop: 4,
              height: 30, padding: "0 16px",
              background: "#2d2d2d", border: "1px solid #3c3c3c",
              borderRadius: 3, color: "#bbb",
              fontSize: 12, cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#383838"; e.currentTarget.style.borderColor = "#5a9fd4"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#2d2d2d"; e.currentTarget.style.borderColor = "#3c3c3c"; }}
          >
            Open Folder…
          </button>
        </div>
      ) : (
        <>
          {/* ── Editor Canvas ──────────────────────────────────────────────── */}
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {isIpynb ? (
              // .ipynb opens in this editor tab like a normal file, but shows
              // the notebook cell UI instead of a Monaco text editor.
              <NotebookPanel config={config} nodeId={nodeId} />
            ) : !ready ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: "100%", color: "#777", fontSize: 13, flexDirection: "column", gap: 12,
              }}>
                <span style={{ color: "#aaa", fontWeight: 500 }}>Initializing VS Code editor…</span>
              </div>
            ) : initError ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: "100%", color: "#f44747", fontSize: 13, padding: 20, textAlign: "center",
              }}>
                Editor init error: {initError}
              </div>
            ) : !filePath ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: "100%", color: "#555", fontSize: 13, flexDirection: "column", gap: 12,
              }}>
                <svg width="48" height="48" viewBox="0 0 16 16" fill="#333">
                  <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5.5L9.5 0H4Zm5.5 1.5v3A1.5 1.5 0 0 0 11 6h3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5Z"/>
                </svg>
                <span style={{ color: "#777", fontWeight: 500 }}>Editor</span>
                <span style={{ fontSize: 11, color: "#444" }}>
                  Single-click any file in Project Panel to edit
                </span>
              </div>
            ) : (
              <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
            )}
          </div>

          {/* ── Bottom Status Bar (text files only — notebooks have their own toolbar) ── */}
          {filePath && !isIpynb && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "2px 10px",
                background: "#007acc",
                color: "#ffffff",
                fontSize: 11,
                height: 22,
                flexShrink: 0,
                userSelect: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span>{statusMsg || `Ln ${cursorPos.line}, Col ${cursorPos.col} (${cursorPos.totalLines} lines)`}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {(autoSave || autoSaveEnabled) && <span>AutoSave: On</span>}
                <span>Spaces: {tabSize}</span>
                <span>UTF-8</span>
                <span
                  onClick={() => { setShowLangMenu((v) => !v); setLangQuery(""); }}
                  title={detected && langAuto ? `Auto-detected: ${detected.reason} — click to change` : "Change language mode"}
                  style={{
                    textTransform: "uppercase", fontWeight: 600, cursor: "pointer",
                    padding: "0 5px", borderRadius: 2,
                    background: showLangMenu ? "rgba(255,255,255,0.25)" : "transparent",
                  }}
                >
                  {langAuto ? "✨ " : ""}{language}
                </span>
              </div>
            </div>
          )}

          {/* ── Language picker popup (text files only) ──────────────────────── */}
          {showLangMenu && filePath && !isIpynb && (
            <>
              <div
                onClick={() => setShowLangMenu(false)}
                style={{ position: "absolute", inset: 0, zIndex: 40 }}
              />
              <div
                style={{
                  position: "absolute", right: 8, bottom: 26, zIndex: 41,
                  background: "#252526", border: "1px solid #3c3c3c", borderRadius: 4,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                  maxHeight: 300, overflowY: "auto", minWidth: 220, padding: 4,
                }}
              >
                <div style={{ fontSize: 10, color: "#888", padding: "4px 8px", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Language mode
                </div>
                <input
                  autoFocus
                  value={langQuery}
                  onChange={(e) => setLangQuery(e.target.value)}
                  placeholder="Search languages…"
                  style={{
                    width: "100%", boxSizing: "border-box", margin: "0 0 4px",
                    background: "#1e1e1e", border: "1px solid #3c3c3c", borderRadius: 3,
                    color: "#ddd", fontSize: 12, padding: "5px 8px", outline: "none",
                  }}
                />
                {detected && detected.id !== language && (
                  <div
                    onClick={() => setEditorLanguage(detected.id, true)}
                    title={`Detected from content: ${detected.reason}`}
                    style={{
                      fontSize: 12, padding: "5px 8px", borderRadius: 3, cursor: "pointer",
                      color: "#4ec9b0", background: "rgba(78,201,176,0.12)",
                      border: "1px solid rgba(78,201,176,0.35)", marginBottom: 4,
                    }}
                  >
                    ✨ Suggested: {detected.id}
                    <span style={{ color: "#888", fontSize: 11 }}> — {detected.reason}</span>
                  </div>
                )}
                <div
                  onClick={runAutoDetect}
                  style={{
                    fontSize: 12, padding: "5px 8px", borderRadius: 3, cursor: "pointer",
                    color: "#9cdcfe", marginBottom: 4,
                  }}
                >
                  ↻ Auto-detect from content
                </div>
                {LANG_OPTIONS.filter((id) => id.toLowerCase().includes(langQuery.trim().toLowerCase())).map((id) => (
                  <div
                    key={id}
                    onClick={() => setEditorLanguage(id)}
                    style={{
                      fontSize: 12, padding: "3px 8px", borderRadius: 3, cursor: "pointer",
                      color: id === language ? "#ffffff" : "#cccccc",
                      background: id === language ? "#094771" : "transparent",
                    }}
                  >
                    {id}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default EditorPanel;