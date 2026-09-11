// Editor panel — CodeMirror-based single-file editor backed by flexlayout tabs.
// Each open file = one flexlayout tab (component "editor"); this component
// renders exactly ONE file from `config.filePath`. Tab strip, tab closing and
// tab renaming (dirty ● marker) are handled through flexlayout itself.
//
// Engine: @uiw/react-codemirror with basicSetup={false} — extensions array
// ./cm/extensions.js me granular imports se banta hai (24 setup flags).
// Details: ./cm/*.js (settings/languages/snippets/highlights/whitespace/
// lint/lsp/format/extensions/bridge).

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Actions } from "flexlayout-react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, Decoration, gutter, GutterMarker } from "@codemirror/view";
import { EditorState, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import {
  undo, redo, selectAll, toggleComment, deleteLine,
  moveLineUp, moveLineDown, copyLineDown, copyLineUp,
} from "@codemirror/commands";
import { findNext, findPrevious, gotoLine } from "@codemirror/search";
import { lintGutter } from "@codemirror/lint";
import NotebookPanel from "../Notebook/index.jsx";
import FindReplaceBar from "./FindReplaceBar.jsx";
// Shared editor state (dirty flags, AI bridge, settings sync) — engine-agnostic.
import {
  baseNames, dirtyFlags,
  getActiveEditorPath, setActiveEditorPath,
  isAutoSaveEnabled, setAutoSaveEnabled,
  aiEditorTabs, aiNotifyContext,
  updateTabName, setDirty,
  getEditorSettings, getCachedEditorSettings, settingsListeners,
} from "./shared.js";
import { normalizeCmSettings, DEFAULT_CM_SETTINGS } from "./cm/settings.js";
import { resolveCmLanguage, getLanguageSupport, displayNameFor, CM_LANG_IDS } from "./cm/languages.js";
import { buildCmExtensions } from "./cm/extensions.js";
import { makeCmLinter, diagnosticsToMarkers, publishDiagnostics } from "./cm/lint.js";
import { createCmBridge, offsetToPos } from "./cm/bridge.js";
import { formatCode, isFormattable } from "./cm/format.js";
import {
  autoConnectLspOnce, getLspExtension, getLspStatus, getLspError,
  onLspStatus, retryLsp,
} from "./cm/lsp.js";

// CodeMirror ko async init nahi chahiye — ready turant. Purane consumers
// (koi bacha ho to) ke liye compat: resolved promise + ready events.
if (!window.__ibxEditorReady) window.__ibxEditorReady = Promise.resolve(true);
export const ensureMonacoReady = () => {
  try {
    if (!window.__ibxEditorReady) window.__ibxEditorReady = Promise.resolve(true);
    return window.__ibxEditorReady;
  } catch (err) {
    return Promise.reject(err);
  }
};
try {
  queueMicrotask(() => {
    try { window.dispatchEvent(new CustomEvent("codemirror:ready")); } catch {}
    try { window.dispatchEvent(new CustomEvent("monaco:ready")); } catch {} // compat
  });
} catch {}

const fileName = (p) => { try { return p.split(/[\\/]/).pop(); } catch { return p; } };

// ── Git diff gutter (CodeMirror native) ──────────────────────────────
// Hunk lines -> line backgrounds + gutter bars. StateField stable rehta hai
// (component lifetime), diff aane par effect dispatch hota hai.
const gitSetEffect = StateEffect.define();
class GitMarker extends GutterMarker {
  constructor(kind) { super(); this.kind = kind; }
  eq(other) { return other instanceof GitMarker && other.kind === this.kind; }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-gitgutter-" + this.kind;
    return el;
  }
}
const buildGitDeco = (doc, added, modified) => {
  try {
    const builder = new RangeSetBuilder();
    const marks = [];
    for (const ln of added) {
      if (ln >= 1 && ln <= doc.lines) {
        try { marks.push({ from: doc.line(ln).from, deco: Decoration.line({ class: "cm-git-addedline" }) }); } catch {}
      }
    }
    for (const ln of modified) {
      if (added.has(ln)) continue;
      if (ln >= 1 && ln <= doc.lines) {
        try { marks.push({ from: doc.line(ln).from, deco: Decoration.line({ class: "cm-git-modifiedline" }) }); } catch {}
      }
    }
    marks.sort((a, b) => a.from - b.from);
    for (const m of marks) builder.add(m.from, m.from, m.deco);
    return builder.finish();
  } catch {
    return Decoration.none;
  }
};
const gitField = StateField.define({
  create: () => ({ added: new Set(), modified: new Set(), removed: new Set(), deco: Decoration.none }),
  update: (val, tr) => {
    for (const e of tr.effects) {
      if (e.is(gitSetEffect)) {
        const { added, modified, removed } = e.value;
        return { added, modified, removed, deco: buildGitDeco(tr.state.doc, added, modified) };
      }
    }
    if (tr.docChanged) {
      // Lines shift ho gayin — mapping best-effort: deco map karo, sets
      // re-parse par refresh honge (save / interval / fs event).
      try { return { ...val, deco: val.deco.map(tr.changes) }; } catch { return val; }
    }
    return val;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});
const gitGutterMarkers = (view) => {
  try {
    const f = view.state.field(gitField, false);
    if (!f) return [];
    const out = [];
    const pushLines = (set, kind) => {
      for (const ln of set) {
        if (ln < 1 || ln > view.state.doc.lines) continue;
        try { out.push(new GitMarker(kind).range(view.state.doc.line(ln).from)); } catch {}
      }
    };
    pushLines(f.added, "added");
    pushLines(f.modified, "modified");
    pushLines(f.removed, "removed");
    return out;
  } catch { return []; }
};
const gitGutterExt = gutter({ class: "cm-gitgutter", markers: gitGutterMarkers });

// Hunk header parse: @@ -a[,b] +c[,d] @@ — sirf nayi-file side chahiye.
const parseGitHunks = (diffText) => {
  const added = new Set(), modified = new Set(), removed = new Set();
  try {
    for (const line of String(diffText || "").split("\n")) {
      if (!line.startsWith("@@")) continue;
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (!m) continue;
      const start = parseInt(m[1], 10);
      const count = m[2] ? parseInt(m[2], 10) : 1;
      if (count === 0) removed.add(Math.max(1, start));
      else {
        for (let i = 0; i < count; i++) {
          const ln = start + i;
          if (line.includes("@@ -0,0")) added.add(ln);
          else modified.add(ln);
        }
      }
    }
  } catch {}
  return { added, modified, removed };
};

const CodeMirrorEditorPanel = ({ config, nodeId }) => {
  const filePath = config?.filePath || null;
  // .ipynb yahan nahi — NotebookPanel cell UI dikhata hai (neeche switch me).
  const forceText = config?.forceText === true;
  const isIpynb = !forceText && /\.ipynb$/i.test(filePath || "");

  // ── Project gate ──
  const [hasProject, setHasProject] = useState(!!window.__currentProjectPath);
  useEffect(() => {
    setHasProject(!!window.__currentProjectPath);
    const onOpen = () => setHasProject(true);
    const onClose = () => setHasProject(false);
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    return () => {
      window.removeEventListener("project:opened", onOpen);
      window.removeEventListener("project:closed", onClose);
    };
  }, []);

  const [doc, setDoc] = useState("");
  const [languageId, setLanguageId] = useState("plaintext");
  const [detected, setDetected] = useState(null);
  const [langAuto, setLangAuto] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1, totalLines: 1 });
  const [cmSettings, setCmSettings] = useState(() => ({ ...DEFAULT_CM_SETTINGS }));
  const [autoSave, setAutoSave] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [langQuery, setLangQuery] = useState("");
  const [binaryFile, setBinaryFile] = useState(false);
  const [largeFile, setLargeFile] = useState(false);
  const [lspStatus, setLspStatus] = useState(getLspStatus());
  const [lspTick, setLspTick] = useState(0);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState("");

  const viewRef = useRef(null);
  const bridgeRef = useRef(null);
  const editorRef = useRef(null); // AI bridge ke liye (bridge object)
  const pathRef = useRef(filePath);
  const originalRef = useRef("");
  const loadedRef = useRef(false);
  const langRef = useRef("plaintext");
  const docRef = useRef("");
  const saveTimer = useRef(null);
  const lastSelfSaveRef = useRef(0);
  const externalWriteRef = useRef(false);
  const gitTimer = useRef(null);
  const openFindRef = useRef(null); // keymap (extensions) -> openFind bridge

  pathRef.current = filePath;
  langRef.current = languageId;
  docRef.current = doc;

  const flashStatus = (msg) => {
    setStatusMsg(msg);
    setTimeout(() => { setStatusMsg(null); }, 3000);
  };

  // ── AI bridge registration ──
  useEffect(() => {
    aiEditorTabs.set(nodeId, { filePath, editorRef });
    aiNotifyContext(true);
    return () => { aiEditorTabs.delete(nodeId); aiNotifyContext(true); };
  }, [nodeId, filePath]);

  // ── Settings load + live sync ──
  useEffect(() => {
    getEditorSettings().then((s) => {
      setCmSettings(normalizeCmSettings(s));
      if ("autoSave" in (s || {})) {
        const enabled = s.autoSave === true || s.autoSave === "afterDelay";
        setAutoSaveEnabled(enabled);
        setAutoSave(enabled);
        try { window.dispatchEvent(new CustomEvent("editor:autosave", { detail: { enabled } })); } catch {}
      } else setAutoSave(false);
    }).catch(() => {});
    const handler = (patch) => {
      if (!patch || typeof patch !== "object") return;
      setCmSettings((prev) => normalizeCmSettings({ ...prev, ...patch }));
      if ("autoSave" in patch) {
        const enabled = patch.autoSave === true || patch.autoSave === "afterDelay";
        setAutoSaveEnabled(enabled);
        setAutoSave(enabled);
        try { window.dispatchEvent(new CustomEvent("editor:autosave", { detail: { enabled } })); } catch {}
      }
    };
    settingsListeners.add(handler);
    return () => { settingsListeners.delete(handler); };
  }, []);

  // ── Git gutter CSS (ek baar) ──
  useEffect(() => {
    if (document.getElementById("cm-git-style")) return;
    const style = document.createElement("style");
    style.id = "cm-git-style";
    style.textContent = `
      .cm-gitgutter { width: 5px; }
      .cm-gitgutter-added { border-left: 3px solid var(--git-added); margin-left: 2px; height: 100%; }
      .cm-gitgutter-modified { border-left: 3px solid var(--git-modified); margin-left: 2px; height: 100%; }
      .cm-gitgutter-removed { border-left: 3px solid var(--git-removed); margin-left: 2px; height: 100%; }
      .cm-git-addedline { background: var(--git-added-a15); }
      .cm-git-modifiedline { background: var(--git-modified-a12); }
    `;
    document.head.appendChild(style);
  }, []);

  // ── LSP status subscribe + ek baar auto-connect ──
  useEffect(() => {
    autoConnectLspOnce();
    const unsub = onLspStatus((st) => {
      setLspStatus(st);
      setLspTick((t) => t + 1); // extensions rebuild (online aane par LSP jude)
    });
    const onEv = (e) => {
      setLspStatus(e.detail?.status || getLspStatus());
      setLspTick((t) => t + 1);
    };
    window.addEventListener("lsp:status", onEv);
    return () => { try { unsub(); } catch {} window.removeEventListener("lsp:status", onEv); };
  }, []);

  // ── File load ──
  useEffect(() => {
    if (!filePath || isIpynb) return;
    loadedRef.current = false;
    setBinaryFile(false);
    setLargeFile(false);
    let cancelled = false;
    (async () => {
      const text = await window.electronAPI.readTextFile(filePath);
      if (cancelled) return;
      const isBinaryExt = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".wasm"].some((x) => filePath.toLowerCase().endsWith(x));
      if (text === null || isBinaryExt) {
        setBinaryFile(true);
        flashStatus(`Binary or unreadable file: ${fileName(filePath)}`);
        return;
      }
      const isLarge = text.length > 1024 * 1024;
      const resolved = resolveCmLanguage(filePath, text);
      baseNames.set(filePath, fileName(filePath));
      originalRef.current = text;
      loadedRef.current = true;
      externalWriteRef.current = true;
      setDoc(text);
      setLanguageId(resolved.id);
      setDetected(resolved.auto ? { id: resolved.id, reason: resolved.reason } : null);
      setLangAuto(!!resolved.auto);
      setLargeFile(isLarge);
      if (isLarge) flashStatus(`Large file (${(text.length / 1048576).toFixed(1)} MB) — lint & wrap halka rakha gaya`);
      else if (resolved.auto) flashStatus(`Auto-detected language: ${resolved.id} (${resolved.reason})`);
      else setStatusMsg(null);
      setCursorPos({ line: 1, col: 1, totalLines: text.split("\n").length });
      dirtyFlags.set(filePath, false);
      updateTabName(nodeId, filePath);
      setActiveEditorPath(filePath);
      try {
        window.dispatchEvent(new CustomEvent("editor:fileActivated", { detail: { path: filePath } }));
        window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: filePath, code: text } }));
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, nodeId, hasProject, isIpynb]);

  // ── Language support + lint + LSP + git memo ──
  const languageSupport = useMemo(
    () => getLanguageSupport(languageId, { useSnippets: cmSettings.snippets !== false }),
    [languageId, cmSettings.snippets]
  );

  const lintExt = useMemo(() => {
    if (largeFile || cmSettings.lint === false) return [];
    try {
      const pub = (diags) => {
        try {
          const view = viewRef.current;
          if (!view) return;
          const markers = diagnosticsToMarkers(pathRef.current, diags, view.state.doc);
          publishDiagnostics(pathRef.current, markers);
        } catch {}
      };
      const getLang = () => langRef.current;
      return [makeCmLinter(pathRef.current, getLang, pub)];
    } catch { return []; }
  }, [largeFile, cmSettings.lint, languageId]);

  const lspExt = useMemo(
    () => getLspExtension(filePath, languageId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lspTick, filePath, languageId]
  );

  // 64KB bucket: doc badhne par whitespace-gate fresh rahe, har keystroke
  // par extensions rebuild na ho (reconfigure se bachne ke liye).
  const wsBucket = Math.floor((doc?.length || 0) / 65536);
  const extensions = useMemo(() => {
    const eff = { ...cmSettings };
    if (largeFile) {
      // Badi file: bhari features off (perf) — settings mutate nahi hote.
      eff.lint = false;
      eff.lintGutter = false;
      eff.highlightWhitespace = false;
      eff.highlightSelectionMatches = false;
      eff.lineWrapping = false;
    }
    const list = buildCmExtensions({
      settings: eff,
      languageSupport,
      lspExtension: lspExt,
      docSize: largeFile ? 2 * 1024 * 1024 : wsBucket * 65536,
      onOpenFind: (replaceMode) => openFindRef.current?.(!!replaceMode),
    });
    if (eff.lint !== false) list.push(...lintExt);
    if (eff.lint !== false && eff.lintGutter !== false) {
      try { list.push(lintGutter()); } catch {}
    }
    list.push(gitField, gitGutterExt);
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmSettings, languageSupport, lspExt, lintExt, largeFile, wsBucket]);

  // ── onCreateEditor: view + bridge ──
  const handleCreateEditor = useCallback((view) => {
    viewRef.current = view;
    const bridge = createCmBridge(() => viewRef.current);
    bridgeRef.current = bridge;
    editorRef.current = bridge;
    setActiveEditorPath(pathRef.current);
    aiNotifyContext(true);
    try {
      const pos = view.state.selection.main.head;
      const p = offsetToPos(view.state.doc, pos);
      setCursorPos({ line: p.lineNumber, col: p.column, totalLines: view.state.doc.lines });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── onChange: doc + dirty + autosave + live sync ──
  const handleChange = useCallback((value) => {
    const fromExternal = externalWriteRef.current;
    externalWriteRef.current = false;
    setDoc(value);
    const p = pathRef.current;
    if (!p) return;
    const dirty = value !== originalRef.current;
    setDirty(nodeId, p, dirty);
    if (!fromExternal && isAutoSaveEnabled()) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { doSaveRef.current?.(); }, 800);
    }
    try {
      window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: p, code: value } }));
    } catch {}
    aiNotifyContext(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // ── onUpdate: cursor + focus ──
  const handleUpdate = useCallback((viewUpdate) => {
    try {
      if (viewUpdate.selectionSet || viewUpdate.docChanged) {
        const head = viewUpdate.state.selection.main.head;
        const p = offsetToPos(viewUpdate.state.doc, head);
        setCursorPos({ line: p.lineNumber, col: p.column, totalLines: viewUpdate.state.doc.lines });
      }
      if (viewUpdate.focusChanged && viewUpdate.view.hasFocus) {
        setActiveEditorPath(pathRef.current);
        aiNotifyContext(true);
        try {
          window.dispatchEvent(new CustomEvent("editor:fileActivated", { detail: { path: pathRef.current } }));
        } catch {}
      }
    } catch {}
  }, []);

  // ── Status-bar language switcher ──
  const setEditorLanguage = useCallback((id, isAuto = false) => {
    setShowLangMenu(false);
    setLangQuery("");
    if (!id) return;
    setLanguageId(id);
    setLangAuto(!!isAuto);
    if (!isAuto) setDetected(null);
  }, []);

  const runAutoDetect = useCallback(() => {
    try {
      const v = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
      const resolved = resolveCmLanguage(null, v);
      if (resolved.id && resolved.id !== "plaintext") {
        setDetected({ id: resolved.id, reason: resolved.reason });
        setEditorLanguage(resolved.id, true);
        flashStatus(`Auto-detected language: ${resolved.id} (${resolved.reason})`);
      } else flashStatus("No language detected — pick one below");
    } catch {
      flashStatus("Detection failed — pick a language below");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setEditorLanguage]);

  // ── Save / Save As (+ format on save via prettier) ──
  const doSave = useCallback(async () => {
    const p = pathRef.current;
    if (!p || isIpynb) return;
    if (!loadedRef.current) { flashStatus("Nothing to save — file was not loaded"); return; }
    let text = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
    try {
      const s = getCachedEditorSettings() ?? await getEditorSettings().catch(() => ({}));
      if (s?.formatOnSave === true && isFormattable(langRef.current)) {
        const r = await formatCode(langRef.current, text);
        if (r.ok && typeof r.code === "string" && r.code !== text) {
          text = r.code;
          externalWriteRef.current = true;
          setDoc(text);
        } else if (!r.ok) flashStatus(`Format skipped: ${r.error}`);
      }
    } catch {}
    const result = await window.electronAPI.writeFileText(p, text);
    if (result?.success) {
      lastSelfSaveRef.current = Date.now();
      originalRef.current = text;
      setDirty(nodeId, p, false);
      flashStatus(`Saved: ${fileName(p)}`);
      refreshGitGutter();
    } else {
      await window.electronAPI.showAlert(`Failed to save file:\n${result?.error || "Unknown error"}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, isIpynb]);
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  const doSaveAs = useCallback(async () => {
    const p = pathRef.current;
    if (!p || isIpynb) return;
    if (!loadedRef.current) { flashStatus("Nothing to save — file was not loaded"); return; }
    const text = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
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
      } catch {}
    }
    flashStatus(`Saved as: ${fileName(newPath)}`);
  }, [nodeId, isIpynb]);

  const doFormat = useCallback(async () => {
    const id = langRef.current;
    if (!isFormattable(id)) { flashStatus(`No formatter for "${id}"`); return; }
    const src = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
    const r = await formatCode(id, src);
    if (r.ok && typeof r.code === "string") {
      if (r.code === src) { flashStatus("Already formatted"); return; }
      externalWriteRef.current = true;
      setDoc(r.code);
      const p = pathRef.current;
      if (p) setDirty(nodeId, p, r.code !== originalRef.current);
      flashStatus("Formatted");
    } else flashStatus(`Format failed: ${r.error}`);
  }, [nodeId]);

  // ── Find/replace bar state ──
  const [findOpen, setFindOpen] = useState(false);
  const [findSeed, setFindSeed] = useState("");
  const [findReplaceMode, setFindReplaceMode] = useState(false);
  const [findSession, setFindSession] = useState(0);

  // Custom find bar kholo (selection se seed). Mod-F/Mod-H keymap + menu +
  // command-palette sab yahin aate hain (extensions.js onOpenFind se).
  const openFind = useCallback((replaceMode) => {
    let seed = "";
    try {
      const view = viewRef.current;
      const sel = view?.state.selection.main;
      if (view && sel && !sel.empty) {
        seed = view.state.doc.sliceString(sel.from, Math.min(sel.to, sel.from + 120));
        const nl = seed.indexOf("\n");
        if (nl >= 0) seed = seed.slice(0, nl);
      }
    } catch {}
    setFindSeed(seed);
    setFindReplaceMode(!!replaceMode);
    setFindSession((n) => n + 1);
    setFindOpen(true);
  }, []);
  openFindRef.current = openFind;

  // ── Editor command executor (is tab ke view par; menu + events dono) ──
  const execCommand = useCallback(async (cmd) => {
    const view = viewRef.current;
    if (!view || isIpynb) return;
    try {
      switch (cmd) {
        case "undo": undo(view); break;
        case "redo": redo(view); break;
        case "cut": {
          const sel = view.state.selection.main;
          if (!sel.empty) {
            const text = view.state.doc.sliceString(sel.from, sel.to);
            try { await window.electronAPI.clipboardWrite(text); } catch {}
            view.dispatch({ changes: { from: sel.from, to: sel.to, insert: "" } });
            try { view.focus(); } catch {}
          }
          break;
        }
        case "copy": {
          const sel = view.state.selection.main;
          const text = sel.empty ? view.state.doc.toString() : view.state.doc.sliceString(sel.from, sel.to);
          try { await window.electronAPI.clipboardWrite(text); } catch {}
          break;
        }
        case "paste": {
          try {
            const text = await window.electronAPI.clipboardRead();
            if (typeof text === "string" && text) {
              const sel = view.state.selection.main;
              view.dispatch({
                changes: { from: sel.from, to: sel.to, insert: text },
                selection: { anchor: sel.from + text.length },
                scrollIntoView: true,
              });
              try { view.focus(); } catch {}
            }
          } catch {}
          break;
        }
        case "selectAll": selectAll(view); break;
        case "find": openFind(false); break;
        case "findNext": findNext(view); break;
        case "findPrevious": findPrevious(view); break;
        case "replace": openFind(true); break;
        case "format": doFormat(); break;
        case "gotoLine": gotoLine(view); break;
        case "gotoSymbol": setSymbolQuery(""); setSymbolOpen(true); break;
        case "commentLine": toggleComment(view); break;
        case "copyLineDown": copyLineDown(view); break;
        case "copyLineUp": copyLineUp(view); break;
        case "moveLineUp": moveLineUp(view); break;
        case "moveLineDown": moveLineDown(view); break;
        case "deleteLine": deleteLine(view); break;
        default: break;
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doFormat, isIpynb, openFind]);

  // ── File & Edit menu commands (sirf active tab react kare) ──
  useEffect(() => {
    if (isIpynb) return;
    const onCmd = async (e) => {
      const cmd = e.detail?.cmd;
      if (!cmd) return;
      const p = pathRef.current;
      const target = e.detail?.path ?? getActiveEditorPath();
      const isActive = !target || p === target;
      if (cmd === "save") { if (p && isActive) doSave(); return; }
      if (cmd === "saveAs") { if (p && isActive) doSaveAs(); return; }
      if (!isActive) return;
      await execCommand(cmd);
    };
    window.addEventListener("editor:command", onCmd);
    return () => window.removeEventListener("editor:command", onCmd);
  }, [doSave, doSaveAs, execCommand, isIpynb]);

  // ── Right-click: native editor menu (main process) ──
  const onEditorContextMenu = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await window.electronAPI.showContextMenu("editor", filePath ? [filePath] : []);
      const action = res?.action;
      if (!action) return;
      if (action === "copyPath") {
        try {
          if (filePath) {
            await window.electronAPI.clipboardWrite(filePath);
            flashStatus("Path copied");
          }
        } catch {}
        return;
      }
      if (action === "reveal") {
        try { if (filePath) await window.electronAPI.revealInExplorer(filePath); } catch {}
        return;
      }
      await execCommand(action);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, execCommand]);

  // ── AutoSave toggle ──
  useEffect(() => {
    const onAuto = (e) => {
      const enabled = e.detail?.enabled === true;
      setAutoSaveEnabled(enabled);
      setAutoSave(enabled);
    };
    window.addEventListener("editor:autosave", onAuto);
    return () => window.removeEventListener("editor:autosave", onAuto);
  }, []);
  useEffect(() => () => { clearTimeout(saveTimer.current); }, []);

  // ── Reveal line (SearchPanel / Problems) ──
  useEffect(() => {
    const handler = (e) => {
      const p = e.detail?.path;
      const line = e.detail?.line;
      const col = e.detail?.column || 1;
      if (!p || p !== filePath) return;
      try {
        bridgeRef.current?.setPosition({ lineNumber: line || 1, column: col });
        bridgeRef.current?.revealLineInCenter(line || 1);
        bridgeRef.current?.focus();
      } catch {}
    };
    window.addEventListener("editor:revealLine", handler);
    return () => window.removeEventListener("editor:revealLine", handler);
  }, [filePath]);

  // ── Live reload: external edits -> auto-update (dirty nahi ho to) ──
  useEffect(() => {
    if (!filePath || isIpynb) return;
    let timer = null;
    const unsub = window.electronAPI.onFsChange((_dir, changedPath) => {
      if (changedPath !== filePath) return;
      if (Date.now() - lastSelfSaveRef.current < 1200) return;
      if (dirtyFlags.get(filePath)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const text = await window.electronAPI.readTextFile(filePath);
        if (text === null) return;
        const cur = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
        if (cur === text) return;
        originalRef.current = text;
        externalWriteRef.current = true;
        setDoc(text);
        dirtyFlags.set(filePath, false);
        updateTabName(nodeId, filePath);
        setCursorPos((pr) => ({ ...pr, totalLines: text.split("\n").length }));
        try {
          window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: filePath, code: text } }));
        } catch {}
        flashStatus("File changed on disk — reloaded");
      }, 150);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [filePath, nodeId, isIpynb]);

  // ── Live Edit from Browser ──
  useEffect(() => {
    if (!filePath || isIpynb) return;
    const applyText = async (label) => {
      try {
        const text = await window.electronAPI.readTextFile(filePath);
        if (text === null) return;
        const cur = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
        if (cur === text) return;
        originalRef.current = text;
        externalWriteRef.current = true;
        setDoc(text);
        dirtyFlags.set(filePath, false);
        updateTabName(nodeId, filePath);
        setCursorPos((pr) => ({ ...pr, totalLines: text.split("\n").length }));
        try { window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: filePath, code: text } })); } catch {}
        flashStatus(`Live edit — ${label}`);
      } catch {}
    };
    const handler = async (e) => {
      const p = e.detail?.filePath || e.detail?.path;
      if (!p || p !== filePath) return;
      await applyText(e.detail?.rel || filePath.split(/[\\/]/).pop());
    };
    const handlerMain = async (payload) => {
      if (!payload || payload.filePath !== filePath) return;
      await applyText(payload.rel || "updated");
    };
    window.addEventListener("liveEdit:applied", handler);
    window.addEventListener("liveEdit:fileChanged", handler);
    const unsub = window.electronAPI.onLiveEditFileChanged ? window.electronAPI.onLiveEditFileChanged(handlerMain) : () => {};
    return () => {
      window.removeEventListener("liveEdit:applied", handler);
      window.removeEventListener("liveEdit:fileChanged", handler);
      try { unsub(); } catch {}
    };
  }, [filePath, nodeId, isIpynb]);

  // ── Git diff gutter refresh ──
  const refreshGitGutter = useCallback(async () => {
    const p = pathRef.current;
    const view = viewRef.current;
    if (!p || !view || isIpynb) return;
    try {
      const root = window.__currentProjectPath;
      if (!root) return;
      const diff = await window.electronAPI.gitDiff(root, p);
      const { added, modified, removed } = parseGitHunks(diff);
      view.dispatch({ effects: gitSetEffect.of({ added, modified, removed }) });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIpynb]);
  useEffect(() => {
    if (!filePath || isIpynb) return;
    refreshGitGutter();
    const iv = setInterval(() => { if (!document.hidden) refreshGitGutter(); }, 10000);
    let fsDebounce = null;
    const onFs = () => {
      clearTimeout(fsDebounce);
      fsDebounce = setTimeout(() => { if (!document.hidden) refreshGitGutter(); }, 1200);
    };
    const onVis = () => { if (!document.hidden) refreshGitGutter(); };
    const onProj = () => onFs();
    window.addEventListener("project:opened", onProj);
    document.addEventListener("visibilitychange", onVis);
    const unsub = window.electronAPI.onFsChange(onFs);
    return () => {
      clearInterval(iv);
      clearTimeout(fsDebounce);
      window.removeEventListener("project:opened", onProj);
      document.removeEventListener("visibilitychange", onVis);
      unsub();
    };
  }, [filePath, isIpynb, refreshGitGutter]);

  // ── Unmount: diagnostics clear (Problems panel saaf rahe) ──
  useEffect(() => {
    const p = filePath;
    return () => { try { if (p) publishDiagnostics(p, []); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // ── Go-to-symbol items ──
  const symbolItems = useMemo(() => {
    if (!symbolOpen) return [];
    const items = [];
    try {
      const lines = String(docRef.current || "").split("\n");
      const re = /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|interface\s+([A-Za-z_$][\w$]*)|type\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|async|[^;]*=>)|def\s+([A-Za-z_]\w*)|fn\s+([A-Za-z_]\w*)|(#{1,6})\s+(.+)|<h\d[^>]*>([^<]+))/;
      for (let i = 0; i < lines.length && items.length < 200; i++) {
        const m = lines[i].match(re);
        if (m) {
          const label = m.slice(1).find((x) => x) || lines[i].trim().slice(0, 60);
          items.push({ line: i + 1, label: String(label).slice(0, 80) });
        }
      }
    } catch {}
    const q = symbolQuery.trim().toLowerCase();
    return q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items;
  }, [symbolOpen, symbolQuery, doc]);

  const jumpToSymbol = (line) => {
    setSymbolOpen(false);
    try {
      bridgeRef.current?.setPosition({ lineNumber: line, column: 1 });
      bridgeRef.current?.revealLineInCenter(line);
      bridgeRef.current?.focus();
    } catch {}
  };

  const tabSize = Number.isFinite(cmSettings.tabSize) ? cmSettings.tabSize : 2;
  const displayName = displayNameFor(languageId, filePath);
  const lspLabel = lspStatus === "online" ? "LSP: online" : lspStatus === "connecting" ? "LSP: connecting…" : "LSP: offline";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "var(--bg-surface)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {!hasProject ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", flexDirection: "column", gap: "var(--space-14)",
        }}>
          <svg width="52" height="52" viewBox="0 0 16 16" fill="none">
            <path style={{ fill: "var(--border-light)" }} d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.086a1.5 1.5 0 0 1 1.06.44L7.56 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9Z" />
          </svg>
          <span style={{ color: "var(--text-muted)", fontWeight: "var(--fw-semibold)", fontSize: "var(--fs-title)" }}>No project open</span>
          <span style={{ color: "var(--text-disabled)", fontSize: "var(--fs-small)", textAlign: "center", maxWidth: 220, lineHeight: "var(--lh-doc)" }}>
            Open a project from the <strong style={{ color: "var(--text-placeholder)" }}>File</strong> menu or the Project Panel,
            then select a file to edit.
          </span>
          <button
            onClick={() => window.electronAPI.openFolder()}
            style={{
              marginTop: "var(--space-4)",
              height: 30, padding: "0 var(--space-16)",
              background: "var(--bg-active)", border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)", color: "var(--text-soft)",
              fontSize: "var(--fs-body)", cursor: "pointer",
            }}
          >
            Open Folder…
          </button>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {isIpynb ? (
              <NotebookPanel config={config} nodeId={nodeId} />
            ) : !filePath ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: "100%", color: "var(--text-placeholder)", fontSize: "var(--fs-title)", flexDirection: "column", gap: "var(--space-12)",
              }}>
                <svg style={{ fill: "var(--bg-thumb)" }} width="48" height="48" viewBox="0 0 16 16">
                  <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5.5L9.5 0H4Zm5.5 1.5v3A1.5 1.5 0 0 0 11 6h3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5Z" />
                </svg>
                <span style={{ color: "var(--icon-muted)", fontWeight: "var(--fw-medium)" }}>Editor</span>
                <span style={{ fontSize: "var(--fs-small)", color: "var(--text-disabled)" }}>
                  Single-click any file in Project Panel to edit
                </span>
              </div>
            ) : binaryFile ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--icon)", textAlign: "center", fontSize: "var(--fs-title)", padding: "var(--space-24)" }}>
                Binary or unsupported file type ({fileName(filePath)}).<br />Editing is disabled to prevent corruption.
              </div>
            ) : (
              <div
                style={{ position: "absolute", inset: 0 }}
                onContextMenu={onEditorContextMenu}
              >
                <CodeMirror
                  value={doc}
                  height="100%"
                  basicSetup={false}
                  theme="none"
                  indentWithTab={true}
                  extensions={extensions}
                  onChange={handleChange}
                  onUpdate={handleUpdate}
                  onCreateEditor={handleCreateEditor}
                />
                {findOpen && (
                  <FindReplaceBar
                    key={`find-${findSession}-${findReplaceMode ? "r" : "f"}`}
                    getView={() => viewRef.current}
                    initialFind={findSeed}
                    initialReplaceMode={findReplaceMode}
                    onClose={() => setFindOpen(false)}
                  />
                )}
              </div>
            )}
          </div>

          {filePath && !isIpynb && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "var(--space-2) var(--space-10)",
                background: "var(--accent)",
                color: "var(--text-inverse)",
                fontSize: "var(--fs-small)",
                height: "var(--bar-h-sm)",
                flexShrink: 0,
                userSelect: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
                <span>{statusMsg || `Ln ${cursorPos.line}, Col ${cursorPos.col} (${cursorPos.totalLines} lines)`}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)" }}>
                {(autoSave || isAutoSaveEnabled()) && <span>AutoSave: On</span>}
                <span
                  onClick={() => { if (lspStatus !== "online" && lspStatus !== "connecting") retryLsp(); }}
                  title={lspStatus === "online" ? "Language server connected" : `Language server offline (${getLspError() || "no server"}) — click to retry`}
                  style={{ cursor: lspStatus === "online" ? "default" : "pointer", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <span style={{
                    display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                    background: lspStatus === "online" ? "#4ade80" : lspStatus === "connecting" ? "#facc15" : "#f87171",
                  }} />
                  {lspLabel}{lspStatus === "offline" ? " ↻" : ""}
                </span>
                {isFormattable(languageId) && (
                  <span onClick={doFormat} title="Format document (Prettier)" style={{ cursor: "pointer", fontWeight: "var(--fw-semibold)" }}>
                    Format
                  </span>
                )}
                <span>Spaces: {tabSize}</span>
                <span>UTF-8</span>
                <span
                  onClick={() => { setShowLangMenu((v) => !v); setLangQuery(""); }}
                  title={detected && langAuto ? `Auto-detected: ${detected.reason} — click to change` : "Change language mode"}
                  style={{
                    textTransform: "uppercase", fontWeight: "var(--fw-semibold)", cursor: "pointer",
                    padding: "0 var(--space-5)", borderRadius: "var(--radius-xs)",
                    background: showLangMenu ? "var(--white-a25)" : "transparent",
                  }}
                >
                  {langAuto ? "✨ " : ""}{displayName}
                </span>
              </div>
            </div>
          )}

          {showLangMenu && filePath && !isIpynb && (
            <>
              <div
                onClick={() => setShowLangMenu(false)}
                style={{ position: "absolute", inset: 0, zIndex: "var(--z-menu)" }}
              />
              <div
                style={{
                  position: "absolute", right: 8, bottom: 26, zIndex: "var(--z-menu-top)",
                  background: "var(--bg-vscode)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-pop)",
                  maxHeight: 300, overflowY: "auto", minWidth: 220, padding: "var(--space-4)",
                }}
              >
                <div style={{ fontSize: "var(--fs-tiny)", color: "var(--icon)", padding: "var(--space-4) var(--space-8)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Language mode
                </div>
                <input
                  autoFocus
                  value={langQuery}
                  onChange={(e) => setLangQuery(e.target.value)}
                  placeholder="Search languages…"
                  style={{
                    width: "100%", boxSizing: "border-box", margin: "0 0 var(--space-4)",
                    background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
                    color: "var(--text-hover)", fontSize: "var(--fs-body)", padding: "var(--space-5) var(--space-8)", outline: "none",
                  }}
                />
                {detected && detected.id !== languageId && (
                  <div
                    onClick={() => setEditorLanguage(detected.id, true)}
                    title={`Detected from content: ${detected.reason}`}
                    style={{
                      fontSize: "var(--fs-body)", padding: "var(--space-5) var(--space-8)", borderRadius: "var(--radius-sm)", cursor: "pointer",
                      color: "var(--teal)", background: "var(--teal-a12)",
                      border: "1px solid var(--teal-a35)", marginBottom: "var(--space-4)",
                    }}
                  >
                    ✨ Suggested: {displayNameFor(detected.id, filePath)}
                    <span style={{ color: "var(--icon)", fontSize: "var(--fs-small)" }}> — {detected.reason}</span>
                  </div>
                )}
                <div
                  onClick={runAutoDetect}
                  style={{
                    fontSize: "var(--fs-body)", padding: "var(--space-5) var(--space-8)", borderRadius: "var(--radius-sm)", cursor: "pointer",
                    color: "var(--code-cyan)", marginBottom: "var(--space-4)",
                  }}
                >
                  ↻ Auto-detect from content
                </div>
                {CM_LANG_IDS.filter((id) => (displayNameFor(id, filePath) + " " + id).toLowerCase().includes(langQuery.trim().toLowerCase())).map((id) => (
                  <div
                    key={id}
                    onClick={() => setEditorLanguage(id)}
                    style={{
                      fontSize: "var(--fs-body)", padding: "var(--space-3) var(--space-8)", borderRadius: "var(--radius-sm)", cursor: "pointer",
                      color: id === languageId ? "var(--text-inverse)" : "var(--text-bright)",
                      background: id === languageId ? "var(--select-blue)" : "transparent",
                    }}
                  >
                    {displayNameFor(id, filePath)}
                    <span style={{ opacity: 0.6, fontSize: "var(--fs-small)" }}> — {id}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {symbolOpen && (
            <>
              <div onClick={() => setSymbolOpen(false)} style={{ position: "absolute", inset: 0, zIndex: "var(--z-menu)" }} />
              <div style={{
                position: "absolute", left: "50%", top: 40, transform: "translateX(-50%)",
                zIndex: "var(--z-menu-top)", width: "min(420px, 80%)",
                background: "var(--bg-vscode)", border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop)", padding: "var(--space-4)",
              }}>
                <input
                  autoFocus
                  value={symbolQuery}
                  onChange={(e) => setSymbolQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && symbolItems.length) jumpToSymbol(symbolItems[0].line);
                    if (e.key === "Escape") setSymbolOpen(false);
                  }}
                  placeholder="Go to symbol…"
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
                    color: "var(--text-hover)", fontSize: "var(--fs-body)", padding: "var(--space-5) var(--space-8)", outline: "none",
                  }}
                />
                <div style={{ maxHeight: 240, overflowY: "auto", marginTop: "var(--space-4)" }}>
                  {symbolItems.length === 0 && (
                    <div style={{ padding: "var(--space-8)", color: "var(--text-disabled)", fontSize: "var(--fs-small)" }}>
                      No symbols found
                    </div>
                  )}
                  {symbolItems.slice(0, 60).map((it, i) => (
                    <div
                      key={i}
                      onClick={() => jumpToSymbol(it.line)}
                      style={{
                        fontSize: "var(--fs-body)", padding: "var(--space-3) var(--space-8)",
                        borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text-bright)",
                        display: "flex", justifyContent: "space-between", gap: 8,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-active)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
                      <span style={{ opacity: 0.6 }}>:{it.line}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
      <style>{`.cm-editor { height: 100%; } .cm-scroller { overflow: auto; }`}</style>
    </div>
  );
};

// Compat alias (koi purana import toota na ho).
export { CodeMirrorEditorPanel as MonacoEditorPanel };

// CodeMirror-backed editor factory. Notebook tabs retain their cell UI;
// every source file uses the same CodeMirror stack.
const EditorPanelSwitch = ({ config, nodeId }) => {
  const filePath = config?.filePath || null;
  const forceText = config?.forceText === true;
  const isIpynb = !forceText && /\.ipynb$/i.test(filePath || "");

  if (isIpynb) return <NotebookPanel config={config} nodeId={nodeId} />;
  return <CodeMirrorEditorPanel config={config} nodeId={nodeId} />;
};

export default EditorPanelSwitch;
