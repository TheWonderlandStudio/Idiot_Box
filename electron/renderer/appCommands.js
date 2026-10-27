// Shared renderer-side command registry helpers.
// The metadata (titles/defaults) lives in electron/shared/keybindings.json so
// the renderer and the Electron menu can agree on the same command ids.
import KEYBINDINGS from "../shared/keybindings.json";

export const COMMANDS = Array.isArray(KEYBINDINGS) ? KEYBINDINGS : [];
export const COMMANDS_BY_ID = Object.fromEntries(COMMANDS.map((c) => [c.id, c]));

export const isMac = () => {
  try { return /mac/i.test(navigator.platform || "") || /Mac/i.test(navigator.userAgent || ""); } catch { return false; }
};

// Stored bindings always use "Ctrl" (also when the user pressed Cmd on macOS).
export const displayKey = (key) => {
  const s = String(key || "").trim();
  if (!s) return "Unassigned";
  if (!isMac()) return s;
  return s.replace(/\bCtrl\b/g, "Cmd").replace(/\bAlt\b/g, "Option");
};

export const effectiveBinding = (id, overrides) => {
  const o = overrides && typeof overrides === "object" ? overrides : {};
  if (Object.prototype.hasOwnProperty.call(o, id)) return String(o[id] || "");
  return String(COMMANDS_BY_ID[id]?.default || "");
};

export const effectiveBindings = (overrides) => {
  const out = {};
  for (const c of COMMANDS) out[c.id] = effectiveBinding(c.id, overrides);
  return out;
};

const KEY_ALIASES = {
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  Escape: "Esc", " ": "Space", Spacebar: "Space", Del: "Delete",
};

/** Convert a keyboard event to our storage format (Ctrl+Shift+F). */
export const eventToKey = (e) => {
  if (!e) return "";
  const k = e.key;
  if (!k || ["Control", "Meta", "Alt", "Shift", "CapsLock", "NumLock", "ScrollLock"].includes(k)) return "";
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey && !/^F\d{1,2}$/.test(k)) mods.push("Shift");
  let key = KEY_ALIASES[k] || k;
  if (key.length === 1) key = key.toUpperCase();
  return [...mods, key].join("+");
};

/** Keys that are safe to bind without a modifier. */
export const isSafeBareKey = (key) => /^(F\d{1,2}|Esc|Delete|Insert|Home|End|PageUp|PageDown|PrintScreen|Pause|Space)$/i.test(String(key || ""));

export const normalizeKeyForCompare = (key) => String(key || "").replace(/\s+/g, "").toLowerCase();

/**
 * Run a renderer-level command. Native menu commands are handled by the main
 * process; this table covers the commands that only exist in the renderer.
 */
export const runAppCommand = (id) => {
  const ev = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined)); } catch {} };
  switch (id) {
    case "searchInFiles":  ev("search:open", { mode: "search" }); return true;
    case "replaceInFiles": ev("search:open", { mode: "replace" }); return true;
    case "localHistory":   ev("local-history:open"); return true;
    case "testExplorer":   ev("add-test-explorer-panel"); return true;
    case "debugPanel":     ev("add-debug-panel"); return true;
    case "runAuto":
      try { window.__pendingAutoRun = { auto: true }; } catch {}
      ev("add-run-panel");
      return true;
    case "runStop":
      ev("run:stopCurrent");
      return true;
    case "nextProblem":
    case "prevProblem":
    case "toggleBreakpoint":
    case "formatDocument":
    case "commentLine":
    case "gotoLine":
    case "deleteLine":
    case "copyLineDown":
    case "moveLineUp":
    case "moveLineDown":
    case "addCursorAbove":
    case "addCursorBelow":
      ev("editor:command", { cmd: id });
      return true;
    case "openProject":
      try { window.electronAPI?.openFolder?.(); } catch {}
      return true;
    case "newProject":
      ev("editor:command", { cmd: "__noop" });
      try { window.electronAPI?.openFolder?.(); } catch {}
      return true;
    case "settings":
      try { window.electronAPI?.openSettingsWindow?.(); } catch {}
      return true;
    case "toggleFullscreen":
      ev("app:fullscreen");
      return true;
    default:
      return false;
  }
};

/** 1-based physical line under the cursor, used by debug/test panels. */
export const activeEditorPath = () => {
  try { return window.__ibxActiveEditorPath || null; } catch { return null; }
};
