// cm/settings.js — CodeMirror settings source-of-truth.
//
// Ye JSON hi source-of-truth hai (toggles + Settings page ka JSON box isi se
// sync hote hain). Persist do jagah hota hai:
//   1. settings.json (main process, existing IPC flow — editor live-updates via
//      BroadcastChannel/IPC, Notebook bhi wahi padhta hai).
//   2. localStorage mirror { v, settings } — versioning ke sath, taaki purani
//      cached settings future versions se takrayein nahi.
//
// Compat keys (purane Monaco-IDE settings.json se):
//   wordWrap (bool)  <-> lineWrapping (bool)   — dono sync me rehte hain
//   editorTheme/theme (10 old values) -> theme ("dark" | "light" | "oneDark")
//   fontFamily / autoSave / formatOnSave — passthrough (save pipeline use karta hai)

export const CM_SETTINGS_VERSION = 1;
export const CM_STORAGE_KEY = "ibx.codemirror.settings";

// ── Source-of-truth defaults (spec JSON) ─────────────────────────────
export const DEFAULT_CM_SETTINGS = {
  lineNumbers: true,
  highlightActiveLineGutter: true,
  highlightSpecialChars: true,
  history: true,
  foldGutter: true,
  drawSelection: true,
  dropCursor: true,
  allowMultipleSelections: true,
  indentOnInput: true,
  syntaxHighlighting: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: true,
  rectangularSelection: true,
  crosshairCursor: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  closeBracketsKeymap: true,
  defaultKeymap: true,
  searchKeymap: true,
  historyKeymap: true,
  foldKeymap: true,
  completionKeymap: true,
  lintKeymap: true,
  tabSize: 2,
  indentUnit: "  ",
  lineWrapping: true,
  highlightWhitespace: false,
  lint: true,
  lintGutter: true,
  snippets: true,
  customKeys: true,
  vim: false,
  tabAcceptsCompletion: true,
  theme: "dark",
  fontSize: 14,
  customHighlights: true,
};

const BOOL_KEYS = [
  "lineNumbers", "highlightActiveLineGutter", "highlightSpecialChars",
  "history", "foldGutter", "drawSelection", "dropCursor",
  "allowMultipleSelections", "indentOnInput", "syntaxHighlighting",
  "bracketMatching", "closeBrackets", "autocompletion",
  "rectangularSelection", "crosshairCursor", "highlightActiveLine",
  "highlightSelectionMatches", "closeBracketsKeymap", "defaultKeymap",
  "searchKeymap", "historyKeymap", "foldKeymap", "completionKeymap",
  "lintKeymap", "lineWrapping", "highlightWhitespace", "lint",
  "lintGutter", "snippets", "customKeys", "vim", "tabAcceptsCompletion",
  "customHighlights",
];

const THEME_VALUES = ["dark", "light", "oneDark"];

// Purane 10 Monaco theme values -> naye 3 CodeMirror themes.
export const migrateTheme = (v) => {
  if (THEME_VALUES.includes(v)) return v;
  const s = String(v || "").toLowerCase();
  if (s.includes("light")) return "light";
  return "dark"; // dark/darkPlus/darkModern/dark2026/hcDark/unknown sab -> dark
};

// Kisi bhi object (settings.json / localStorage / JSON box) ko validate +
// normalize karke { settings, errors } do. Unknown keys passthrough (compat:
// minimap, fontFamily, autoSave, formatOnSave, ...).
export const validateCmSettings = (raw) => {
  const errors = [];
  const out = { ...DEFAULT_CM_SETTINGS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { settings: out, errors: ["Settings object nahi hai — defaults use ho rahe hain"] };
  }
  for (const k of BOOL_KEYS) {
    if (k in raw) {
      const v = raw[k];
      if (typeof v === "boolean") out[k] = v;
      else errors.push(`"${k}" boolean hona chahiye (mila: ${typeof v}) — purani value rakhi`);
    }
  }
  if ("tabSize" in raw) {
    const n = Number(raw.tabSize);
    if (Number.isFinite(n) && n >= 1 && n <= 8) out.tabSize = Math.round(n);
    else errors.push(`"tabSize" 1–8 ke beech number hona chahiye — purani value rakhi`);
  }
  if ("indentUnit" in raw) {
    const u = String(raw.indentUnit ?? "");
    if (/^( +|\t+)$/.test(u) && u.length >= 1 && u.length <= 8) out.indentUnit = u;
    else errors.push(`"indentUnit" sirf spaces/tabs (1–8 chars) ho sakta hai — purani value rakhi`);
  }
  if ("fontSize" in raw) {
    const n = Number(raw.fontSize);
    if (Number.isFinite(n) && n >= 8 && n <= 32) out.fontSize = Math.round(n);
    else errors.push(`"fontSize" 8–32 ke beech hona chahiye — purani value rakhi`);
  }
  if ("theme" in raw || "editorTheme" in raw) {
    const v = raw.theme ?? raw.editorTheme;
    if (typeof v === "string") out.theme = migrateTheme(v);
    else errors.push(`"theme" string hona chahiye — purani value rakhi`);
  }
  // ── Compat sync: wordWrap <-> lineWrapping ──
  if ("wordWrap" in raw && !("lineWrapping" in raw)) {
    out.lineWrapping = raw.wordWrap !== false;
  }
  out.wordWrap = out.lineWrapping !== false;
  // Passthrough compat keys (editor save pipeline / notebook inhe padhte hain).
  // NOTE: lineNumbers BOOL_KEYS me validated hai — yahan dobara raw assign
  // mat karo (galat type validated value ko overwrite kar dega).
  for (const k of ["fontFamily", "autoSave", "formatOnSave", "minimap"]) {
    if (k in raw) out[k] = raw[k];
  }
  return { settings: out, errors };
};

// Poora settings.json blob -> normalized cm settings (editor consumption).
export const normalizeCmSettings = (all) => validateCmSettings(all || {}).settings;

// ── localStorage versioned mirror ────────────────────────────────────
export const loadStoredCmSettings = () => {
  try {
    const raw = localStorage.getItem(CM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.v !== CM_SETTINGS_VERSION) return null; // purana version — ignore
    const { settings, errors } = validateCmSettings(parsed.settings);
    if (errors.length) return { settings, errors, stale: false };
    return { settings, errors: [], stale: false };
  } catch {
    return null;
  }
};

export const saveStoredCmSettings = (settings) => {
  try {
    localStorage.setItem(CM_STORAGE_KEY, JSON.stringify({ v: CM_SETTINGS_VERSION, settings }));
    return true;
  } catch {
    return false;
  }
};
