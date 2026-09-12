// cm/settings.js — editor settings (defaults + validation).
//
// Keys settings.json me rehte hain (existing IPC flow). Purani settings.json
// files se aane wali extra/unknown keys tolerate hoti hain; galat types par
// default lagta hai (fail-open). Purane Monaco-era values migrate hote hain:
// 10 theme values -> dark/light/oneDark, wordWrap <-> lineWrapping sync.

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
  return "dark";
};

// Kisi bhi object ko validate + normalize karke settings do.
// Unknown keys passthrough (compat: fontFamily, autoSave, formatOnSave, ...).
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
  // Passthrough compat keys (save pipeline / notebook inhe padhte hain)
  for (const k of ["fontFamily", "autoSave", "formatOnSave", "minimap"]) {
    if (k in raw) out[k] = raw[k];
  }
  return { settings: out, errors };
};

// Poora settings.json blob -> normalized cm settings (editor consumption).
export const normalizeCmSettings = (all) => validateCmSettings(all || {}).settings;
