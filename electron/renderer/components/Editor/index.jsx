// Editor panel — plain CodeMirror single-file editor, flexlayout tabs.
// Each open file = one flexlayout tab (component "editor"); this component
// renders exactly ONE file from `config.filePath`. Tab strip, closing and
// dirty ● markers go through flexlayout itself.
//
// Plain by design: file load/save, highlighting, basic editing, formatter bridge, AI bridge.
// No LSP, lint, git gutter, or custom find UI — CodeMirror
// defaults (built-in search panel, indent-Tab). Vim + snippets optional
// (settings flags). Engine: ./cm/extensions.js, ./cm/languages.js,
// ./cm/settings.js, ./cm/snippets.js. AI-panel contract: ./cm/bridge.js
// (getValue/getModel/getSelection/getPosition/executeEdits/focus).

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Actions } from "flexlayout-react";
import CodeMirror from "@uiw/react-codemirror";
import {
  undo, redo, selectAll, toggleComment, deleteLine,
  moveLineUp, moveLineDown, copyLineDown, copyLineUp,
  isolateHistory, addCursorAbove, addCursorBelow,
} from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import { openSearchPanel, findNext, findPrevious, gotoLine } from "@codemirror/search";
import { foldAll, unfoldAll } from "@codemirror/language";
import { unifiedMergeView } from "@codemirror/merge";
import NotebookPanel from "../Notebook/index.jsx";
import { Play, Square } from "lucide-react";
import EditorStatusBar from "./StatusBar.jsx";
import { MarkdownPreview, MdxPreview, CsvPreview, DbPreview } from "./preview.jsx";
import "./editor.css";
// Shared editor state (dirty flags, settings sync) — engine-agnostic.
import {
  baseNames, dirtyFlags,
  getActiveEditorPath, setActiveEditorPath,
  isAutoSaveEnabled, setAutoSaveEnabled,
  updateTabName, setDirty,
  getEditorSettings, settingsListeners,
} from "./shared.js";
import { normalizeCmSettings, DEFAULT_CM_SETTINGS } from "./cm/settings.js";
import { resolveCmLanguage, getLanguageSupport } from "./cm/languages.js";
import { collectSyntaxDiagnostics, publishDiagnostics } from "./cm/diagnostics.js";
import { buildCmExtensions } from "./cm/extensions.js";
import { createCmBridge, offsetToPos } from "./cm/bridge.js";
import { applyGitChanges, parseUnifiedDiff } from "./cm/gitgutter.js";
import { collectSymbols, symbolPathAt } from "./cm/goto.js";
import { toggleBreakpoint } from "./breakpoints.js";

// CodeMirror needs no async init — ready immediately. Compat for any old
// listeners: resolved promise + ready events.
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

// Symbol glyphs for breadcrumbs / outline.
const KIND_ICON = {
  function: "ƒ", method: "ƒ", class: "▤", interface: "◈", type: "◈", enum: "≣",
  struct: "▤", trait: "◈", impl: "▦", module: "▣", variable: "▪", property: "▪",
  rule: "▦", tag: "<>", heading1: "H1", heading2: "H2", heading3: "H3",
  heading4: "H4", heading5: "H5", heading6: "H6",
};
const kindIcon = (k) => KIND_ICON[k] || "•";

const formatRelTime = (t) => {
  if (!t) return "";
  try {
    const d = new Date(t * 1000);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  } catch { return ""; }
};

const CodeMirrorEditorPanel = ({ config, nodeId }) => {
  const filePath = config?.filePath || null;
  const forceText = config?.forceText === true;
  const isIpynb = !forceText && /\.ipynb$/i.test(filePath || "");
  const isDbFile = !forceText && /\.(db|db3|sqlite|sqlite3)$/i.test(filePath || "");
  const isMdFile = !forceText && /\.(md|markdown|mdown|mkd|mkdn)$/i.test(filePath || "");
  const isMdxFile = !forceText && /\.mdx$/i.test(filePath || "");
  const isCsvFile = !forceText && /\.(csv|tsv)$/i.test(filePath || "");

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
  const [statusMsg, setStatusMsg] = useState(null);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1, totalLines: 1 });
  const [cmSettings, setCmSettings] = useState(() => ({ ...DEFAULT_CM_SETTINGS }));
  const [autoSave, setAutoSave] = useState(false);
  const [formatBusy, setFormatBusy] = useState(false);
  const [binaryFile, setBinaryFile] = useState(false);
  // ── Editor chrome state (status bar / breadcrumbs / overlays) ──
  const [eol, setEol] = useState("LF");
  const [encoding, setEncoding] = useState("UTF-8");
  const [problemCount, setProblemCount] = useState(0);
  const [symbols, setSymbols] = useState([]);
  const [crumbs, setCrumbs] = useState([]);
  const [showOutline, setShowOutline] = useState(false);
  const [zen, setZen] = useState(false);
  const [diffOriginal, setDiffOriginal] = useState(null);
  const [blame, setBlame] = useState(null);
  // Gate CodeMirror mount on content load — the view is created WITH the
  // file's text (empty history), so Ctrl+Z can never reach a previous file.
  const [contentReady, setContentReady] = useState(false);
  // Per-file view key — fresh EditorView (fresh undo stack) per file.
  const fileKey = useMemo(
    () => `${filePath || ""}::${forceText ? "text" : "auto"}`,
    [filePath, forceText]
  );

  // ── Side preview (markdown / mdx render / sqlite inspect) ──
  const canPreview = !!filePath && !isIpynb && (isDbFile || isCsvFile || isMdFile || isMdxFile || languageId === "markdown" || languageId === "mdx");
  const previewKind = isCsvFile ? "CSV" : (isMdxFile || languageId === "mdx") ? "MDX" : isDbFile ? "DB" : "";
  const [previewOpen, setPreviewOpen] = useState(false);
  // New file → auto-open for db, closed for the rest.
  useEffect(() => { setPreviewOpen(isDbFile); }, [filePath, isDbFile]);

  const viewRef = useRef(null);
  const editorRef = useRef(null); // AI bridge (bridge object)
  const bridgeRef = useRef(null);
  const pathRef = useRef(filePath);
  const originalRef = useRef("");
  const loadedRef = useRef(false);
  const langRef = useRef("plaintext");
  const docRef = useRef("");
  const blameRef = useRef(false);
  const eolRef = useRef("LF");
  const symbolsRef = useRef([]);
  const markersRef = useRef([]);
  const blameDataRef = useRef(null);
  const gitDescRef = useRef(null);
  const saveTimer = useRef(null);
  const lastSelfSaveRef = useRef(0);
  const externalWriteRef = useRef(false);
  const loadGenRef = useRef(0);

  pathRef.current = filePath;
  langRef.current = languageId;
  docRef.current = doc;
  eolRef.current = eol;
  blameRef.current = cmSettings.gitBlame === true;
  const binaryRef = useRef(false);
  binaryRef.current = binaryFile;

  // ── History-safe external replace (same-file reloads) ──
  // Programmatic content swaps must NOT enter the undo stack — otherwise
  // Ctrl+Z reverts to stale/disk content. Uses addToHistory:false so the
  // change is un-undoable, with isolateHistory so it never merges with
  // the user's own edits. User typing / format / AI edits stay undoable.
  const replaceDocWithoutHistory = useCallback((text) => {
    const next = String(text ?? "").replace(/\r\n?/g, "\n");
    originalRef.current = next;
    const view = viewRef.current;
    if (view) {
      try {
        const cur = view.state.doc.toString();
        if (cur !== next) {
          externalWriteRef.current = true;
          // No explicit selection — CodeMirror maps the existing cursor
          // through the change, so external reloads don't jump to top.
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: next },
            annotations: [
              Transaction.addToHistory.of(false),
              isolateHistory.of("full"),
            ],
          });
          // onChange fires for this dispatch → handleChange consumes the
          // flag and syncs React state; keep value prop in sync as well
          // (equal → @uiw no-ops, no second history entry).
          setDoc(next);
          return;
        }
      } catch {}
    }
    externalWriteRef.current = false;
    setDoc(next);
  }, []);

  // ── Problems panel diagnostics (debounced Lezer syntax check) ──────────
  // The view may belong to an older file (tab switch) — so capture the
  // path at schedule time and match it at fire time; never publish for the wrong file.
  const diagTimer = useRef(null);
  const scheduleDiagnostics = useCallback((delay = 800) => {
    const p = pathRef.current;
    if (!p) return;
    try { clearTimeout(diagTimer.current); } catch {}
    diagTimer.current = setTimeout(() => {
      try {
        if (pathRef.current !== p || binaryRef.current) return;
        const v = viewRef.current;
        if (!v) return;
        const markers = collectSyntaxDiagnostics(v);
        markersRef.current = markers;
        publishDiagnostics(p, markers);
        setProblemCount(markers.length);
        try {
          const syms = collectSymbols(v);
          symbolsRef.current = syms;
          setSymbols(syms);
        } catch {}
      } catch {}
    }, delay);
  }, []);
  // Tab closed → clear its Problems entry (otherwise a dead file's errors stay stuck).
  useEffect(() => () => {
    try { clearTimeout(diagTimer.current); } catch {}
    try {
      const p = pathRef.current;
      if (p) publishDiagnostics(p, []);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flashStatus = (msg) => {
    setStatusMsg(msg);
    setTimeout(() => { setStatusMsg(null); }, 3000);
  };

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

  // ── File load (Ctrl+Z safe) ──
  // Single-click replaces this tab's filePath (same nodeId, same component
  // instance). The old file's text must never enter the new file's undo
  // stack. Strategy: clear synchronously, mount a FRESH view (key=fileKey)
  // only when content is ready, so the view is created WITH the file text
  // (empty history). No value-diff → no undoable file-switch transaction.
  useEffect(() => {
    if (!filePath || isIpynb) return;
    const gen = ++loadGenRef.current;
    loadedRef.current = false;
    setContentReady(false);
    setBinaryFile(false);
    // Drop any pending autosave for the previous file — it must not fire
    // after the switch and save the wrong tab.
    try { clearTimeout(saveTimer.current); } catch {}
    externalWriteRef.current = false;
    originalRef.current = "";
    setDoc("");
    setCursorPos({ line: 1, col: 1, totalLines: 1 });
    setEol("LF");
    setEncoding("UTF-8");
    setProblemCount(0);
    setSymbols([]);
    setBlame(null);
    // Old view is being torn down (key change) — forget it so no programmatic
    // dispatch can hit a destroyed view.
    viewRef.current = null;
    // DB file = binary — do not read it as text (mojibake + cost of a large file);
    // the preview pane is its view.
    if (isDbFile) {
      setBinaryFile(true);
      setDoc("");
      setLanguageId("plaintext");
      setCursorPos({ line: 1, col: 1, totalLines: 1 });
      setContentReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const text = await window.electronAPI.readTextFile(filePath);
      if (cancelled || loadGenRef.current !== gen) return;
      const isBinaryExt = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".wasm"].some((x) => filePath.toLowerCase().endsWith(x));
      if (text === null || isBinaryExt) {
        if (loadGenRef.current !== gen) return;
        setBinaryFile(true);
        setContentReady(true);
        flashStatus(`Binary or unreadable file: ${fileName(filePath)}`);
        return;
      }
      if (text.length > 1024 * 1024) {
        flashStatus(`Large file (${(text.length / 1048576).toFixed(1)} MB)`);
      } else setStatusMsg(null);
      const lang = resolveCmLanguage(filePath);
      // Detect line endings / BOM, then normalize the buffer to LF (CodeMirror
      // works in LF; save converts back to the detected EOL).
      const hasCRLF = text.includes("\r\n");
      const hasBOM = text.charCodeAt(0) === 0xFEFF;
      setEol(hasCRLF ? "CRLF" : "LF");
      setEncoding(hasBOM ? "UTF-8 with BOM" : "UTF-8");
      const normalized = text.replace(/\r\n?/g, "\n");
      baseNames.set(filePath, fileName(filePath));
      originalRef.current = normalized;
      loadedRef.current = true;
      // Fresh mount path: view is null (torn down above) or already the new
      // key's view showing "". Either way setDoc makes the mounted view's
      // initial doc correct with EMPTY history. Do NOT flag as external —
      // @uiw suppresses onChange for this sync, so a stale flag would leak
      // into the next real user edit and break autosave.
      externalWriteRef.current = false;
      setDoc(normalized);
      setContentReady(true);
      setLanguageId(lang);
      setCursorPos({ line: 1, col: 1, totalLines: normalized.split("\n").length });
      dirtyFlags.set(filePath, false);
      updateTabName(nodeId, filePath);
      setActiveEditorPath(filePath);
      try {
        window.dispatchEvent(new CustomEvent("editor:fileActivated", { detail: { path: filePath } }));
        window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: filePath, code: normalized } }));
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, nodeId, hasProject, isIpynb, isDbFile]);

  // ── Extensions (memo; reconfigure keeps history) ──
  const extensions = useMemo(() => {
    const base = buildCmExtensions({
      settings: cmSettings,
      languageSupport: getLanguageSupport(languageId),
      languageId,
      getPath: () => pathRef.current,
    });
    // Inline diff against the last-saved snapshot ("Compare with Saved").
    if (diffOriginal != null) {
      try {
        base.push(unifiedMergeView({
          original: diffOriginal,
          mergeControls: true,
          highlightChanges: true,
          gutter: true,
        }));
      } catch {}
    }
    return base;
  }, [cmSettings, languageId, diffOriginal]);

  // Lint on file load / language-mode change (even when the doc text is unchanged —
  // docChanged does not fire on tab switch; this effect catches it).
  useEffect(() => {
    if (!filePath || isIpynb) return;
    scheduleDiagnostics(600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, languageId, isIpynb]);

  // ── onCreateEditor: view + bridge ──
  const handleCreateEditor = useCallback((view) => {
    viewRef.current = view;
    const bridge = createCmBridge(() => viewRef.current);
    bridgeRef.current = bridge;
    editorRef.current = bridge;
    setActiveEditorPath(pathRef.current);
    try {
      const pos = view.state.selection.main.head;
      const p = offsetToPos(view.state.doc, pos);
      setCursorPos({ line: p.lineNumber, col: p.column, totalLines: view.state.doc.lines });
    } catch {}
    // Fresh view → first lint run (debounced, let parsing finish).
    try { scheduleDiagnostics(500); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── onChange: doc + dirty + autosave + live sync ──
  const handleChange = useCallback((value) => {
    const fromExternal = externalWriteRef.current;
    externalWriteRef.current = false;
    setDoc(value);
    const p = pathRef.current;
    if (!p) return;
    setDirty(nodeId, p, value !== originalRef.current);
    if (!fromExternal && isAutoSaveEnabled()) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { doSaveRef.current?.(); }, 800);
    }
    try {
      window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: p, code: value } }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // ── onUpdate: cursor + focus + lint ──
  const handleUpdate = useCallback((viewUpdate) => {
    try {
      if (viewUpdate.selectionSet || viewUpdate.docChanged) {
        const head = viewUpdate.state.selection.main.head;
        const p = offsetToPos(viewUpdate.state.doc, head);
        setCursorPos({ line: p.lineNumber, col: p.column, totalLines: viewUpdate.state.doc.lines });
        // Breadcrumbs from the current symbol path.
        try { setCrumbs(symbolPathAt(symbolsRef.current, head)); } catch {}
        // Inline blame for the cursor line.
        if (blameRef.current) {
          const bd = blameDataRef.current;
          const rec = bd && bd[p.lineNumber];
          setBlame(rec || null);
        }
      }
      // Re-lint on every edit (debounced) — keeps the Problems panel live.
      if (viewUpdate.docChanged) {
        try { scheduleDiagnostics(); } catch {}
      }
      if (viewUpdate.focusChanged && viewUpdate.view.hasFocus) {
        setActiveEditorPath(pathRef.current);
        try {
          window.dispatchEvent(new CustomEvent("editor:fileActivated", { detail: { path: pathRef.current } }));
        } catch {}
      }
    } catch {}
  }, []);

  // ── Git gutter refresh ──
  const refreshGit = useCallback(async () => {
    const v = viewRef.current;
    const p = pathRef.current;
    const root = window.__currentProjectPath;
    if (!v) return;
    if (cmSettings.gitGutter === false || !p || !root || binaryRef.current) {
      applyGitChanges(v, null);
      gitDescRef.current = null;
      return;
    }
    try {
      const [unstaged, staged] = await Promise.all([
        window.electronAPI.gitDiff(root, p).catch(() => ""),
        window.electronAPI.gitDiffStaged(root, p).catch(() => ""),
      ]);
      const desc = { added: new Set(), modified: new Set(), deleted: new Set() };
      for (const patch of [unstaged, staged]) {
        if (typeof patch !== "string" || !patch) continue;
        const d = parseUnifiedDiff(patch);
        d.added.forEach((n) => desc.added.add(n));
        d.modified.forEach((n) => { desc.added.delete(n); desc.modified.add(n); });
        d.deleted.forEach((n) => desc.deleted.add(n));
      }
      gitDescRef.current = desc;
      if (viewRef.current === v) applyGitChanges(v, desc);
    } catch {}
  }, [cmSettings.gitGutter]);
  const refreshGitRef = useRef(refreshGit);
  refreshGitRef.current = refreshGit;

  // Apply a save-time transformation pipeline (format / trim / final newline).
  const transformForSave = useCallback(async (text) => {
    let out = text;
    if (cmSettings.formatOnSave) {
      try {
        const res = await window.electronAPI?.extFormat?.(pathRef.current, out, langRef.current, {
          tabSize: cmSettings.tabSize,
          insertSpaces: !(cmSettings.indentUnit || "  ").startsWith("\t"),
        });
        if (res?.ok && typeof res.text === "string") out = res.text;
      } catch {}
    }
    if (cmSettings.trimTrailingWhitespace) {
      out = out.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n");
    }
    if (cmSettings.insertFinalNewline && out.length && !out.endsWith("\n")) out += "\n";
    return out;
  }, [cmSettings]);

  // Write transformed text back into the view without polluting undo history,
  // then persist to disk with the detected EOL.
  const commitSave = useCallback(async (p, text) => {
    const view = viewRef.current;
    if (view) {
      try {
        const cur = view.state.doc.toString();
        if (cur !== text) {
          externalWriteRef.current = true;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            annotations: [Transaction.addToHistory.of(false), isolateHistory.of("full")],
          });
          setDoc(text);
        }
      } catch {}
    }
    const diskText = eolRef.current === "CRLF" ? text.replace(/\n/g, "\r\n") : text;
    return window.electronAPI.writeFileText(p, diskText);
  }, []);

  // ── Save / Save As ──
  const doSave = useCallback(async () => {
    const p = pathRef.current;
    if (!p || isIpynb) return;
    if (!loadedRef.current) { flashStatus("Nothing to save — file was not loaded"); return; }
    const raw = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
    const text = await transformForSave(raw);
    const result = await commitSave(p, text);
    if (result?.success) {
      lastSelfSaveRef.current = Date.now();
      originalRef.current = text;
      setDirty(nodeId, p, false);
      flashStatus(`Saved: ${fileName(p)}`);
      refreshGitRef.current?.();
    } else {
      await window.electronAPI.showAlert(`Failed to save file:\n${result?.error || "Unknown error"}`);
    }
  }, [nodeId, isIpynb, transformForSave, commitSave]);
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  const doSaveAs = useCallback(async () => {
    const p = pathRef.current;
    if (!p || isIpynb) return;
    if (!loadedRef.current) { flashStatus("Nothing to save — file was not loaded"); return; }
    const raw = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
    const text = await transformForSave(raw);
    const diskText = eolRef.current === "CRLF" ? text.replace(/\n/g, "\r\n") : text;
    const result = await window.electronAPI.saveFileAs(p, diskText);
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
  }, [nodeId, isIpynb, transformForSave]);

  const formatDocument = useCallback(async () => {
    const view = viewRef.current;
    const p = pathRef.current;
    if (!view || !p || isIpynb || binaryRef.current || formatBusy) return;
    setFormatBusy(true);
    try {
      const original = view.state.doc.toString();
      const indentUnit = cmSettings.indentUnit || "  ";
      const result = await window.electronAPI?.extFormat?.(p, original, langRef.current, {
        tabSize: cmSettings.tabSize,
        insertSpaces: !indentUnit.startsWith("\t"),
      });
      if (!result?.ok) {
        flashStatus(result?.error || "No active document formatter is available");
        return;
      }
      if (typeof result.text !== "string") {
        flashStatus("Formatter returned invalid output");
        return;
      }
      if (result.text !== original) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: result.text },
          scrollIntoView: true,
        });
      }
      flashStatus(result.text === original
        ? `Already formatted${result.extName ? ` · ${result.extName}` : ""}`
        : `Formatted${result.extName ? ` · ${result.extName}` : ""}`);
    } catch (e) {
      flashStatus(`Format failed: ${String((e && e.message) || e)}`);
    } finally {
      setFormatBusy(false);
    }
  }, [cmSettings, isIpynb, formatBusy]);

  // ── Navigate between syntax problems (F8 / Shift+F8) ──
  const gotoProblem = useCallback((dir) => {
    const view = viewRef.current;
    if (!view) return;
    const markers = markersRef.current || [];
    if (!markers.length) { flashStatus("No problems in this file"); return; }
    const cur = view.state.selection.main.head;
    const lines = markers.map((m) => m.startLineNumber || 1);
    let target = null;
    if (dir > 0) {
      target = lines.find((ln) => view.state.doc.line(ln).from > cur);
      if (target == null) target = lines[0];
    } else {
      const before = lines.filter((ln) => view.state.doc.line(ln).from < cur);
      target = before.length ? before[before.length - 1] : lines[lines.length - 1];
    }
    try {
      const off = view.state.doc.line(target).from;
      view.dispatch({ selection: { anchor: off }, scrollIntoView: true });
      view.focus();
    } catch {}
  }, []);

  // ── Inline diff vs last-saved snapshot ──
  const toggleCompare = useCallback(() => {
    setDiffOriginal((prev) => {
      if (prev != null) { flashStatus("Diff closed"); return null; }
      const saved = originalRef.current || "";
      flashStatus("Comparing with saved — accept/reject in the gutter");
      return saved;
    });
  }, []);

  // ── Editor command executor (runs on this tab's view) ──
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
        case "find": openSearchPanel(view); break;
        case "findNext": findNext(view); break;
        case "findPrevious": findPrevious(view); break;
        case "replace": openSearchPanel(view); break;
        case "gotoLine": gotoLine(view); break;
        case "commentLine": toggleComment(view); break;
        case "format": await formatDocument(); break;
        case "copyLineDown": copyLineDown(view); break;
        case "copyLineUp": copyLineUp(view); break;
        case "moveLineUp": moveLineUp(view); break;
        case "moveLineDown": moveLineDown(view); break;
        case "deleteLine": deleteLine(view); break;
        case "addCursorAbove": addCursorAbove(view); break;
        case "addCursorBelow": addCursorBelow(view); break;
        case "foldAll": foldAll(view); break;
        case "unfoldAll": unfoldAll(view); break;
        case "gotoSymbol": setShowOutline(true); break;
        case "nextProblem": gotoProblem(1); break;
        case "prevProblem": gotoProblem(-1); break;
        case "compareWithSaved": toggleCompare(); break;
        case "toggleZen": setZen((v) => !v); break;
        case "toggleBreakpoint": {
          const p = pathRef.current;
          if (p && view) {
            const line = view.state.doc.lineAt(view.state.selection.main.head).number;
            toggleBreakpoint(p, line);
          }
          break;
        }
        default: break;
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIpynb, formatDocument, gotoProblem, toggleCompare]);

  // ── File & Edit menu commands (only the active tab reacts) ──
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

  // ── Live reload: external edits -> auto-update (when not dirty) ──
  // History-safe: disk content must never become an undo step.
  useEffect(() => {
    if (!filePath || isIpynb) return;
    let timer = null;
    const unsub = window.electronAPI.onFsChange((_dir, changedPath) => {
      if (changedPath !== filePath) return;
      if (Date.now() - lastSelfSaveRef.current < 1200) return;
      if (!loadedRef.current) return;
      const wasDirty = !!dirtyFlags.get(filePath);
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const raw = await window.electronAPI.readTextFile(filePath);
        if (raw === null) return;
        if (pathRef.current !== filePath) return;
        const text = raw.replace(/\r\n?/g, "\n");
        const cur = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
        if (cur === text) { refreshGitRef.current?.(); return; }
        // Conflict: the file changed on disk while the buffer has unsaved edits.
        if (wasDirty && viewRef.current && viewRef.current.state.doc.toString() === cur) {
          try {
            const reload = await window.electronAPI.confirmDialog(
              `${fileName(filePath)} changed on disk and you have unsaved changes.\n\nOK = reload from disk (discard your changes)\nCancel = keep your unsaved changes`,
            );
            if (!reload) return;
          } catch { return; }
        }
        replaceDocWithoutHistory(text);
        dirtyFlags.set(filePath, false);
        updateTabName(nodeId, filePath);
        setCursorPos((pr) => ({ ...pr, totalLines: text.split("\n").length }));
        try {
          window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: filePath, code: text } }));
        } catch {}
        flashStatus("File changed on disk — reloaded");
        refreshGitRef.current?.();
      }, 150);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [filePath, nodeId, isIpynb, replaceDocWithoutHistory]);

  // ── Live Edit from Browser (history-safe) ──
  useEffect(() => {
    if (!filePath || isIpynb) return;
    const applyText = async (label) => {
      try {
        const text = await window.electronAPI.readTextFile(filePath);
        if (text === null) return;
        if (pathRef.current !== filePath || !loadedRef.current) return;
        const cur = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
        if (cur === text) return;
        replaceDocWithoutHistory(text);
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

  // ── Git gutter + inline blame refresh ──
  useEffect(() => {
    if (!filePath || isIpynb || binaryFile) {
      try { if (viewRef.current) applyGitChanges(viewRef.current, null); } catch {}
      return;
    }
    let cancelled = false;
    const run = async () => {
      await refreshGitRef.current?.();
      const root = window.__currentProjectPath;
      if (cmSettings.gitBlame && root) {
        try {
          const res = await window.electronAPI.gitBlame?.(root, filePath);
          if (!cancelled) {
            blameDataRef.current = res?.ok ? res.lines : null;
            // Populate blame for the current cursor line immediately.
            const v = viewRef.current;
            if (v && blameDataRef.current) {
              const ln = offsetToPos(v.state.doc, v.state.selection.main.head).lineNumber;
              setBlame(blameDataRef.current[ln] || null);
            }
          }
        } catch { if (!cancelled) blameDataRef.current = null; }
      } else if (!cancelled) {
        blameDataRef.current = null;
        setBlame(null);
      }
    };
    run();
    const t = setTimeout(run, 500);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, isIpynb, binaryFile, contentReady, cmSettings.gitGutter, cmSettings.gitBlame]);

  // ── F8 / Shift+F8 problem navigation ──
  useEffect(() => {
    if (isIpynb) return;
    const onKey = (e) => {
      if (getActiveEditorPath() !== pathRef.current) return;
      if (e.key === "F8") { e.preventDefault(); gotoProblem(e.shiftKey ? -1 : 1); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [gotoProblem, isIpynb]);

  // ── Status-bar mutations (persist to settings.json) ──
  const patchSetting = useCallback(async (patch) => {
    try {
      const cur = (await window.electronAPI.readSettings()) || {};
      await window.electronAPI.writeSettings({ ...cur, ...patch });
    } catch {}
  }, []);

  const changeIndent = useCallback((units) => {
    if (units === "tab") patchSetting({ tabSize: 4, indentUnit: "\t" });
    else patchSetting({ tabSize: units, indentUnit: " ".repeat(units) });
  }, [patchSetting]);

  const tabSize = Number.isFinite(cmSettings.tabSize) ? cmSettings.tabSize : 2;

  return (
    <div
      className="ed-panel"
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
          {!zen && cmSettings.breadcrumbs !== false && filePath && !isIpynb && !binaryFile && !isDbFile && (
            <div className="ed-crumbs">
              <span
                className="ed-crumbs__file"
                onClick={() => setShowOutline((v) => !v)}
                title="Show document outline"
              >
                {fileName(filePath)}
              </span>
              {crumbs.map((c, i) => (
                <React.Fragment key={`${c.from}:${i}`}>
                  <span className="ed-crumbs__sep">›</span>
                  <span
                    className="ed-crumbs__item"
                    title={`${c.kind}: ${c.name}`}
                    onClick={() => {
                      try {
                        const v = viewRef.current;
                        if (v) { v.dispatch({ selection: { anchor: c.from }, scrollIntoView: true }); v.focus(); }
                      } catch {}
                    }}
                  >
                    {kindIcon(c.kind)} {c.name}
                  </span>
                </React.Fragment>
              ))}
              <span style={{ flex: 1 }} />
              <button className="ed-crumbs__btn" title="Outline" onClick={() => setShowOutline((v) => !v)}>☰</button>
              <button className="ed-crumbs__btn" title="Exit Zen Mode (Ctrl+K Z)" onClick={() => setZen(false)}>⤢</button>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", display: previewOpen && canPreview ? "none" : "block" }}>
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
              ) : isDbFile ? (
                <div className="ed-dbhint">
                  <span>SQLite database — {fileName(filePath)}</span>
                  <span style={{ fontSize: "var(--fs-small)", color: "var(--text-disabled)" }}>
                    Browse rows, edit data, run SQL, export tables
                  </span>
                  <button className="ed-dbhint__btn" onClick={() => setPreviewOpen(true)}>
                    Open DB Manager
                  </button>
                </div>
              ) : binaryFile ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--icon)", textAlign: "center", fontSize: "var(--fs-title)", padding: "var(--space-24)" }}>
                  Binary or unsupported file type ({fileName(filePath)}).<br />Editing is disabled to prevent corruption.
                </div>
              ) : (
                <div
                  style={{ position: "absolute", inset: 0 }}
                  onContextMenuCapture={onEditorContextMenu}
                >
                  {!contentReady ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-disabled)", fontSize: "var(--fs-small)" }}>
                      Loading {fileName(filePath)}…
                    </div>
                  ) : (
                    <CodeMirror
                      key={fileKey}
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
                  )}
                </div>
              )}
            </div>

            {canPreview && (
              <button
                className={"ed-prevbtn" + (previewOpen ? " ed-prevbtn--on" : "")}
                title={previewOpen ? "Back to editor" : (previewKind ? `Show ${previewKind} preview` : "Show preview")}
                onClick={() => setPreviewOpen((v) => !v)}
              >
                {previewOpen ? <Square size={11} /> : <Play size={11} />}
              </button>
            )}

            {previewOpen && canPreview && (
              <div className="ed-prev">
                {isDbFile ? (
                  <DbPreview filePath={filePath} />
                ) : isCsvFile ? (
                  <CsvPreview doc={doc} filePath={filePath} />
                ) : (isMdxFile || languageId === "mdx") ? (
                  <MdxPreview doc={doc} filePath={filePath} />
                ) : (
                  <MarkdownPreview doc={doc} />
                )}
              </div>
            )}
          </div>

          {!zen && filePath && !isIpynb && (
            <EditorStatusBar
              cursorPos={cursorPos} statusMsg={statusMsg} database={isDbFile} editable={!isDbFile && !binaryFile}
              problemCount={problemCount} blame={blame && cmSettings.gitBlame ? { ...blame, when: formatRelTime(blame.time) } : null}
              canPreview={canPreview} previewOpen={previewOpen} previewKind={previewKind} formatBusy={formatBusy}
              autoSave={autoSave || isAutoSaveEnabled()} settings={cmSettings} eol={eol} encoding={encoding} languageId={languageId}
              onPreview={() => setPreviewOpen(value => !value)} onFormat={formatDocument} onProblems={() => gotoProblem(1)}
              onIndent={() => changeIndent(cmSettings.indentUnit === "\t" ? 2 : (tabSize === 2 ? 4 : "tab"))}
              onEol={() => { setEol(eol === "CRLF" ? "LF" : "CRLF"); setDirty(nodeId, filePath, true); }}
              onWrap={() => patchSetting({ lineWrapping: cmSettings.lineWrapping === false })}
              onMinimap={() => patchSetting({ minimap: cmSettings.minimap === false })}
              onLanguage={setLanguageId}
            />
          )}
          {showOutline && filePath && !isIpynb && (
            <>
              <div
                onClick={() => setShowOutline(false)}
                style={{ position: "absolute", inset: 0, zIndex: "var(--z-menu)" }}
              />
              <div
                className="ed-outline"
                style={{
                  position: "absolute", left: 8, top: 30, zIndex: "var(--z-menu-top)",
                  background: "var(--bg-vscode)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)",
                  boxShadow: "var(--shadow-pop)",
                  maxHeight: "60%", overflowY: "auto", width: 300, maxWidth: "calc(100% - 16px)", padding: "var(--space-4)",
                }}
              >
                <div style={{ fontSize: "var(--fs-tiny)", color: "var(--icon)", padding: "var(--space-4) var(--space-8)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Outline
                </div>
                {symbols.length === 0 ? (
                  <div style={{ fontSize: "var(--fs-small)", color: "var(--text-placeholder)", padding: "var(--space-6) var(--space-8)" }}>
                    No symbols for this file
                  </div>
                ) : symbols.map((sym, i) => (
                  <div
                    key={`${sym.from}:${i}`}
                    onClick={() => {
                      setShowOutline(false);
                      try {
                        const v = viewRef.current;
                        if (v) { v.dispatch({ selection: { anchor: sym.from }, scrollIntoView: true }); v.focus(); }
                      } catch {}
                    }}
                    title={`${sym.kind}: ${sym.name}`}
                    style={{
                      display: "flex", alignItems: "center", gap: "var(--space-6)",
                      fontSize: "var(--fs-body)", padding: "var(--space-3) var(--space-8)",
                      paddingLeft: `${6 + (sym.depth || 0) * 12}px`,
                      borderRadius: "var(--radius-sm)", cursor: "pointer", color: "var(--text-bright)",
                    }}
                  >
                    <span style={{ opacity: 0.8 }}>{kindIcon(sym.kind)}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sym.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <style>{`
        /* Height chain: @uiw container > .cm-editor > .cm-scroller. */
        .cm-theme-none, .cm-theme, .cm-editor { height: 100%; }
        .cm-scroller { overflow: auto; min-height: 0; scrollbar-width: thin; scrollbar-color: var(--scrollbar) transparent; }
        .cm-scroller::-webkit-scrollbar { width: 10px; height: 10px; }
        .cm-scroller::-webkit-scrollbar-track { background: transparent; }
        .cm-scroller::-webkit-scrollbar-corner { background: transparent; }
        .cm-scroller::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: var(--radius-xs); border: 2px solid transparent; background-clip: content-box; }
        .cm-scroller::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); border: 2px solid transparent; background-clip: content-box; }
      `}</style>
    </div>
  );
};

// Compat alias (so no old import breaks).
export { CodeMirrorEditorPanel as MonacoEditorPanel };

// Plain CodeMirror editor factory. Notebook tabs keep their cell UI.
const EditorPanelSwitch = ({ config, nodeId }) => {
  const filePath = config?.filePath || null;
  const forceText = config?.forceText === true;
  const isIpynb = !forceText && /\.ipynb$/i.test(filePath || "");

  if (isIpynb) return <NotebookPanel config={config} nodeId={nodeId} />;
  return <CodeMirrorEditorPanel config={config} nodeId={nodeId} />;
};

export default EditorPanelSwitch;
