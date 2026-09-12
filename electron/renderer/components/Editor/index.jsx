// Editor panel — plain CodeMirror single-file editor, flexlayout tabs.
// Each open file = one flexlayout tab (component "editor"); this component
// renders exactly ONE file from `config.filePath`. Tab strip, closing and
// dirty ● markers go through flexlayout itself.
//
// Plain by design: file load/save, highlighting, basic editing, AI bridge.
// No LSP, lint, git gutter, vim, snippets merging, formatter, or custom
// find UI — CodeMirror defaults (built-in search panel, indent-Tab).
// Engine details: ./cm/extensions.js, ./cm/languages.js, ./cm/settings.js.
// AI-panel contract: ./cm/bridge.js (getValue/getModel/getSelection/
// getPosition/executeEdits/focus) — shared.js untouched.

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Actions } from "flexlayout-react";
import CodeMirror from "@uiw/react-codemirror";
import {
  undo, redo, selectAll, toggleComment, deleteLine,
  moveLineUp, moveLineDown, copyLineDown, copyLineUp,
} from "@codemirror/commands";
import { openSearchPanel, findNext, findPrevious, gotoLine } from "@codemirror/search";
import NotebookPanel from "../Notebook/index.jsx";
// Shared editor state (dirty flags, AI bridge, settings sync) — engine-agnostic.
import {
  baseNames, dirtyFlags,
  getActiveEditorPath, setActiveEditorPath,
  isAutoSaveEnabled, setAutoSaveEnabled,
  aiEditorTabs, aiNotifyContext,
  updateTabName, setDirty,
  getEditorSettings, settingsListeners,
} from "./shared.js";
import { normalizeCmSettings, DEFAULT_CM_SETTINGS } from "./cm/settings.js";
import { resolveCmLanguage, getLanguageSupport, displayNameFor, CM_LANG_IDS } from "./cm/languages.js";
import { buildCmExtensions } from "./cm/extensions.js";
import { createCmBridge, offsetToPos } from "./cm/bridge.js";

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

const CodeMirrorEditorPanel = ({ config, nodeId }) => {
  const filePath = config?.filePath || null;
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
  const [statusMsg, setStatusMsg] = useState(null);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1, totalLines: 1 });
  const [cmSettings, setCmSettings] = useState(() => ({ ...DEFAULT_CM_SETTINGS }));
  const [autoSave, setAutoSave] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [langQuery, setLangQuery] = useState("");
  const [binaryFile, setBinaryFile] = useState(false);

  const viewRef = useRef(null);
  const editorRef = useRef(null); // AI bridge (bridge object)
  const bridgeRef = useRef(null);
  const pathRef = useRef(filePath);
  const originalRef = useRef("");
  const loadedRef = useRef(false);
  const langRef = useRef("plaintext");
  const docRef = useRef("");
  const saveTimer = useRef(null);
  const lastSelfSaveRef = useRef(0);
  const externalWriteRef = useRef(false);

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

  // ── File load ──
  useEffect(() => {
    if (!filePath || isIpynb) return;
    loadedRef.current = false;
    setBinaryFile(false);
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
      if (text.length > 1024 * 1024) {
        flashStatus(`Large file (${(text.length / 1048576).toFixed(1)} MB)`);
      } else setStatusMsg(null);
      const lang = resolveCmLanguage(filePath);
      baseNames.set(filePath, fileName(filePath));
      originalRef.current = text;
      loadedRef.current = true;
      externalWriteRef.current = true;
      setDoc(text);
      setLanguageId(lang);
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

  // ── Extensions (memo; reconfigure keeps history) ──
  const extensions = useMemo(() => buildCmExtensions({
    settings: cmSettings,
    languageSupport: getLanguageSupport(languageId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cmSettings, languageId]);

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
    setDirty(nodeId, p, value !== originalRef.current);
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

  // ── Save / Save As ──
  const doSave = useCallback(async () => {
    const p = pathRef.current;
    if (!p || isIpynb) return;
    if (!loadedRef.current) { flashStatus("Nothing to save — file was not loaded"); return; }
    const text = viewRef.current ? viewRef.current.state.doc.toString() : docRef.current;
    const result = await window.electronAPI.writeFileText(p, text);
    if (result?.success) {
      lastSelfSaveRef.current = Date.now();
      originalRef.current = text;
      setDirty(nodeId, p, false);
      flashStatus(`Saved: ${fileName(p)}`);
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

  // ── Editor command executor (is tab ke view par) ──
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
        case "copyLineDown": copyLineDown(view); break;
        case "copyLineUp": copyLineUp(view); break;
        case "moveLineUp": moveLineUp(view); break;
        case "moveLineDown": moveLineDown(view); break;
        case "deleteLine": deleteLine(view); break;
        default: break; // format / gotoSymbol retired with the plain editor
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIpynb]);

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

  const tabSize = Number.isFinite(cmSettings.tabSize) ? cmSettings.tabSize : 2;
  const displayName = displayNameFor(languageId);

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
          <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
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
                <span>Spaces: {tabSize}</span>
                <span>UTF-8</span>
                <span
                  onClick={() => { setShowLangMenu((v) => !v); setLangQuery(""); }}
                  title="Change language mode"
                  style={{
                    textTransform: "uppercase", fontWeight: "var(--fw-semibold)", cursor: "pointer",
                    padding: "0 var(--space-5)", borderRadius: "var(--radius-xs)",
                    background: showLangMenu ? "var(--white-a25)" : "transparent",
                  }}
                >
                  {displayName}
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
                {CM_LANG_IDS.filter((id) => (displayNameFor(id) + " " + id).toLowerCase().includes(langQuery.trim().toLowerCase())).map((id) => (
                  <div
                    key={id}
                    onClick={() => { setShowLangMenu(false); setLangQuery(""); if (id) setLanguageId(id); }}
                    style={{
                      fontSize: "var(--fs-body)", padding: "var(--space-3) var(--space-8)", borderRadius: "var(--radius-sm)", cursor: "pointer",
                      color: id === languageId ? "var(--text-inverse)" : "var(--text-bright)",
                      background: id === languageId ? "var(--select-blue)" : "transparent",
                    }}
                  >
                    {displayNameFor(id)}
                    <span style={{ opacity: 0.6, fontSize: "var(--fs-small)" }}> — {id}</span>
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

// Compat alias (koi purana import toota na ho).
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
