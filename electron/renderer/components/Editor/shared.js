// ─── Code-OSS editor shared state ─────────────────────────────────────────────
// Dirty flags, tab names and settings sync live here so the surrounding
// Electron UI stays independent of the editor workbench.
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

