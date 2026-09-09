// ─── Code-OSS editor shared state ─────────────────────────────────────────────
// Dirty flags, tab names, AI bridge and settings sync live here so the
// surrounding Electron UI stays independent of the editor workbench.
//
// NOTE: is module me koi engine import nahi hai (koi local import bhi nahi),
// isliye dono engine files yahan se import kar sakte hain bina cycle ke.
import { Actions } from "flexlayout-react";

const fileName = (p) => { try { return p.split(/[\\/]/).pop(); } catch { return p; } };

// ── Shared editor state (all editor tabs in the app) ───────────────────────
let activeEditorPath = null;
let autoSaveEnabled  = false;
export const getActiveEditorPath = () => activeEditorPath;
export const setActiveEditorPath = (p) => { activeEditorPath = p; };
export const isAutoSaveEnabled   = () => autoSaveEnabled;
export const setAutoSaveEnabled  = (v) => { autoSaveEnabled = !!v; };

export const baseNames  = new Map();   // filePath -> tab base name
export const dirtyFlags = new Map();   // filePath -> dirty boolean

// Exposed for the layout close-guard (index.jsx onAction): veto closing dirty tabs.
if (typeof window !== "undefined") {
  window.__ibxIsDirty = (p) => { try { return !!dirtyFlags.get(p); } catch { return false; } };
  window.__ibxForgetDirty = (p) => { try { dirtyFlags.delete(p); baseNames.delete(p); } catch {} };
}

// ── AI panel bridge (Vercel AI SDK chat) ───────────────────────────────────
// Tracks live editor tabs so the AI panel can attach the current file /
// selection as context (window.__aiGetEditorContext) and insert generated
// code at the cursor ("ai:insert-code" event).
// NOTE: editorRef.current exposes the methods below to the AI panel:
// getValue(), getModel() -> { getValue(), getValueInRange(range), getLineCount() },
// getSelection() -> { startLineNumber, startColumn, endLineNumber, endColumn, isEmpty() },
// getPosition(), executeEdits(source, edits[]), focus().
export const aiEditorTabs = new Map(); // nodeId -> { filePath, editorRef }
let aiLastNotify = 0;
export const aiNotifyContext = (immediate) => {
  try {
    const now = Date.now();
    if (!immediate && now - aiLastNotify < 2000) return;
    aiLastNotify = now;
    window.dispatchEvent(new CustomEvent("ai:context-changed"));
  } catch { /* ignore */ }
};
if (typeof window !== "undefined") {
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
}

export const updateTabName = (nodeId, path) => {
  const m = window.__flexModel?.current;
  if (!m) return;
  const base = baseNames.get(path) || fileName(path) || path;
  const dirty = !!dirtyFlags.get(path);
  try {
    m.doAction(Actions.updateNodeAttributes(nodeId, { name: dirty ? base + " ●" : base }));
  } catch { /* node may be gone */ }
};

export const setDirty = (nodeId, path, dirty) => {
  dirtyFlags.set(path, dirty);
  updateTabName(nodeId, path);
};

// ── Read initial editor settings ───────────────────────────────────────────
// Defaults: minimap=true, wordWrap=true.
let _cachedEditorSettings = null;
export const getEditorSettings = async () => {
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
export const getCachedEditorSettings = () => _cachedEditorSettings;
export const setCachedEditorSettings = (s) => { _cachedEditorSettings = s ?? {}; };

// ── BroadcastChannel for live settings updates ────────────────────────────
// Settings window and main window are separate BrowserWindows; we use a
// BroadcastChannel so toggle changes in Settings propagate here instantly.
export const settingsListeners = new Set();
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
// listened there it would incorrectly apply terminal size to the editor
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

