// ─── theme.js — runtime bridge to the CENTRAL token sheet ───────────────────
// variables.css (electron/renderer/variables.css) is the single source of truth
// for every UI value. CSS files + inline styles consume it via var(--token).
//
// Canvas APIs (xterm.js, Excalidraw) need REAL color strings — "var(--x)" does
// NOT resolve there. Use cssVar("--token", "<same-fallback>") so even those
// APIs read from the central sheet. The fallback equals the current value, so the UI
// looks exactly the same even if the sheet has not loaded.
// NOTE: the value is read at creation time (when terminal/excalidraw objects
// are created), so a new panel opened after a theme switch gets the new value.

// Read one token from :root, else return the fallback literal.
export const cssVar = (name, fallback = "") => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  } catch {}
  return fallback;
};

// ── Theme mode ───────────────────────────────────────────────────────────────
// One list of light-theme names, shared by the main window, the Settings window
// and the popout shell. Keep it in sync with the Theme <select> options.
export const LIGHT_THEME_NAMES = new Set([
  "light",
  "lightPlus",
  "lightModern",
  "light2026",
  "Visual Studio Light",
  "Light+",
  "Light Modern",
  "Light 2026",
]);

export const isLightTheme = (name) => LIGHT_THEME_NAMES.has(String(name || ""));

export const themeMode = (settings) =>
  isLightTheme(settings?.theme || settings?.editorTheme) ? "light" : "dark";

// ── User overrides ──────────────────────────────────────────────────────────
// settings.customTheme = { dark: { "--token": "#hex" }, light: { ... } }
// Values are applied as inline custom properties on <html> so they win over
// both :root blocks in variables.css and stay live for every panel/window.
const appliedKeys = new Set();

export function clearThemeVars() {
  const root = document.documentElement;
  for (const key of appliedKeys) {
    try { root.style.removeProperty(key); } catch {}
  }
  appliedKeys.clear();
}

export function setThemeVar(key, value) {
  if (!key || typeof key !== "string" || !key.startsWith("--")) return;
  const root = document.documentElement;
  if (value == null || String(value).trim() === "") {
    root.style.removeProperty(key);
    appliedKeys.delete(key);
    return;
  }
  root.style.setProperty(key, String(value).trim());
  appliedKeys.add(key);
}

/**
 * Apply a settings object to the current document: theme mode (light/dark)
 * plus every saved override for that mode. Safe to call repeatedly.
 */
export function applyThemeSettings(settings) {
  const mode = themeMode(settings);
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);
  clearThemeVars();
  const overrides = settings?.customTheme?.[mode];
  if (overrides && typeof overrides === "object") {
    for (const [key, value] of Object.entries(overrides)) setThemeVar(key, value);
  }
  return mode;
}

/**
 * Build the override object for the *other* mode so callers can switch theme
 * without dropping custom colors.
 */
export function getThemeOverrides(settings, mode) {
  const map = settings?.customTheme?.[mode];
  return map && typeof map === "object" ? map : {};
}
