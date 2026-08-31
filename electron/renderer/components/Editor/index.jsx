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

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Actions } from "flexlayout-react";
import { initialize, getService, IThemeService, ILanguageService, ICommandService, IExtensionService } from "@codingame/monaco-vscode-api";
import { createConfiguredEditor } from "@codingame/monaco-vscode-api/monaco";
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

const ext = (p) => { try { return p.slice(p.lastIndexOf(".")).toLowerCase(); } catch { return ""; } };
const fileName = (p) => { try { return p.split(/[\\/]/).pop(); } catch { return p; } };

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

const getMonacoLanguage = async (filePath) => {
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
  switch (e) {
    case ".js": case ".mjs": case ".cjs": return "javascript";
    case ".jsx": return "javascriptreact";
    case ".ts": return "typescript";
    case ".tsx": return "typescriptreact";
    case ".html": case ".htm": return "html";
    case ".vue": case ".svelte": return "html";
    case ".css": return "css";
    case ".scss": return "scss";
    case ".less": return "less";
    case ".json": case ".jsonc": return "json";
    case ".py": return "python";
    case ".rs": return "rust";
    case ".go": return "go";
    case ".c": case ".h": return "c";
    case ".cpp": case ".hpp": case ".cc": return "cpp";
    case ".cs": return "csharp";
    case ".java": return "java";
    case ".md": return "markdown";
    case ".sql": return "sql";
    case ".sh": case ".bash": return "shellscript";
    case ".yaml": case ".yml": return "yaml";
    case ".xml": case ".xsl": return "xml";
    case ".php": return "php";
    case ".rb": return "ruby";
    case ".bat": case ".cmd": return "bat";
    case ".ps1": return "powershell";
    case ".ini": case ".cfg": case ".toml": return "ini";
    default: return "plaintext";
  }
};

// ── Shared editor state (all editor tabs in the app) ───────────────────────
let activeEditorPath = null;
let autoSaveEnabled  = false;
const baseNames  = new Map();   // filePath -> tab base name
const dirtyFlags = new Map();   // filePath -> dirty boolean

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
try {
  const bc3 = new BroadcastChannel("terminal-settings");
  bc3.onmessage = _broadcastHandler;
} catch {}
try {
  const bc4 = new BroadcastChannel("git-settings");
  bc4.onmessage = _broadcastHandler;
} catch {}
try {
  const bc5 = new BroadcastChannel("canvas-settings");
  bc5.onmessage = _broadcastHandler;
} catch {}
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

  const editorRef   = useRef(null);
  const hostRef     = useRef(null);
  const pathRef     = useRef(filePath);
  const originalRef = useRef("");
  const loadedRef   = useRef(false);
  const saveTimer   = useRef(null);
  const lastSelfSaveRef = useRef(0);

  pathRef.current = filePath;

  const flashStatus = (msg) => {
    setStatusMsg(msg);
    setTimeout(() => { setStatusMsg(null); }, 3000);
  };

  // ── Load editor settings on mount ────────────────────────────────────────
  useEffect(() => {
    getEditorSettings().then((s) => {
      setMinimap(s.minimap !== false);
      setWordWrap(s.wordWrap !== false ? "on" : "off");
      setLineNumbers(s.lineNumbers !== false ? "on" : "off");
      if (Number.isFinite(s.fontSize)) setFontSize(Math.min(32, Math.max(8, s.fontSize)));
      if (s.fontFamily) setFontFamily(s.fontFamily);
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
      if ("fontFamily" in patch && patch.fontFamily) setFontFamily(patch.fontFamily);
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
      .then(() => setReady(true))
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
        minimap: { enabled: minimap },
        wordWrap: wordWrap,
        lineNumbers: lineNumbers,
        fontSize: fontSize,
        fontFamily: fontFamily,
        tabSize: tabSize,
        glyphMargin: false,
        lineDecorationsWidth: 12,
        lineNumbersMinChars: 4,
        folding: false,
        renderLineHighlight: "all",
      });
    } catch {}
  }, [minimap, wordWrap, lineNumbers, fontSize, fontFamily, tabSize]);

  // ── Create / swap the configured editor when the file changes ──────────────
  useEffect(() => {
    if (!ready || !filePath || !hostRef.current) return;
    loadedRef.current = false;
    let cancelled = false;
    let disposed = false;
    let cleanup = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(saveTimer.current);
      window.removeEventListener("resize", onWinResize);
      ro?.disconnect();
      contentSub?.dispose();
      cursorSub?.dispose();
      focusSub?.dispose();
      editor?.dispose();
      if (editorRef.current === editor) editorRef.current = null;
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
      dirtyFlags.set(filePath, false);
      updateTabName(nodeId, filePath);

      const lang = await getMonacoLanguage(filePath);
      setContent(text);
      setOriginalContent(text);
      originalRef.current = text;
      setLanguage(lang);
      setCursorPos({ line: 1, col: 1, totalLines: text.split("\n").length });

      const host = hostRef.current;
      host.innerHTML = "";

      try {
        editor = createConfiguredEditor(host, {
          value: text,
          language: lang,
          automaticLayout: true,
          minimap: { enabled: minimap },
          wordWrap: wordWrap,
          lineNumbers: lineNumbers,
          fontSize: fontSize,
          fontFamily: fontFamily,
          smoothScrolling: true,
          cursorBlink: "smooth",
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
          tabSize: tabSize,
          glyphMargin: false,
          lineDecorationsWidth: 12,
          lineNumbersMinChars: 4,
          folding: false,
        });
      } catch (err) {
        setInitError(err?.message || String(err));
        return;
      }
      if (cancelled || disposed) { editor.dispose(); return; }

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
  }, [ready, filePath, nodeId, hasProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Live reload: external edits (other apps / git / build tools) → auto-update
  useEffect(() => {
    if (!filePath) return;
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
  }, [filePath, nodeId]);

  // ── Live Edit from Browser (text-only) ───────────────────────────────────
  useEffect(() => {
    if (!filePath) return;
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
  }, [filePath, nodeId]);

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
  useEffect(() => {
    if (!filePath || !hasProject) return;
    let cancelled = false;
    let decorationIds = [];
    const updateDiff = async () => {
      if (document.hidden) return;
      const ed = editorRef.current;
      if (!ed || cancelled) return;
      try {
        const root = window.__currentProjectPath;
        if (!root) return;
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
  }, [filePath, hasProject, content]);

  // ── Save / Save As ───────────────────────────────────────────────────────
  const doSave = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
    if (!loadedRef.current) { flashStatus("Nothing to save — file was not loaded"); return; }
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
  }, [nodeId, content]);

  const doSaveAs = useCallback(async () => {
    const p = pathRef.current;
    if (!p) return;
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
  }, [nodeId, content]);

  // ── File & Edit menu commands ────────────────────────────────────────────
  useEffect(() => {
    const onCmd = (e) => {
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
          default: break;
        }
      } catch { /* ignore if editor not ready */ }
    };
    window.addEventListener("editor:command", onCmd);
    return () => window.removeEventListener("editor:command", onCmd);
  }, [doSave, doSaveAs]);

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
            {!ready ? (
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

          {/* ── Bottom Status Bar ────────────────────────────────────────────── */}
          {filePath && (
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
                <span style={{ textTransform: "uppercase", fontWeight: 600 }}>{language}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default EditorPanel;