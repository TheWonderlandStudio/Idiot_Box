// cm/settings.js — editor settings (defaults + validation).
//
// Keys live in settings.json (existing IPC flow). Extra/unknown keys from old
// settings.json files are tolerated; wrong types fall back to the
// default (fail-open). Old Monaco-era values are migrated:
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
  // ── Visual ──
  minimap: true,
  indentGuides: true,
  bracketPairColorization: true,
  fontLigatures: false,
  lineHeight: 1.5,
  fontWeight: 400,
  stickyScroll: false,
  // ── Editing behaviour ──
  formatOnSave: false,
  trimTrailingWhitespace: false,
  insertFinalNewline: false,
  // ── Integrations ──
  gitGutter: true,
  gitBlame: false,
  breadcrumbs: true,
  emmet: true,
  colorDecorators: true,
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
  "minimap", "indentGuides", "bracketPairColorization", "fontLigatures",
  "stickyScroll", "formatOnSave", "trimTrailingWhitespace",
  "insertFinalNewline", "gitGutter", "gitBlame", "breadcrumbs", "emmet",
  "colorDecorators",
];

const THEME_VALUES = ["dark", "light", "oneDark"];

// Old 10 Monaco theme values -> new 3 CodeMirror themes.
export const migrateTheme = (v) => {
  if (THEME_VALUES.includes(v)) return v;
  const s = String(v || "").toLowerCase();
  if (s.includes("light")) return "light";
  return "dark";
};

// Validate + normalize any object into settings.
// Unknown keys passthrough (compat: fontFamily, autoSave, formatOnSave, ...).
export const validateCmSettings = (raw) => {
  const errors = [];
  const out = { ...DEFAULT_CM_SETTINGS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { settings: out, errors: ["Settings is not an object — using defaults"] };
  }
  for (const k of BOOL_KEYS) {
    if (k in raw) {
      const v = raw[k];
      if (typeof v === "boolean") out[k] = v;
      else errors.push(`"${k}" must be a boolean (got: ${typeof v}) — kept previous value`);
    }
  }
  if ("tabSize" in raw) {
    const n = Number(raw.tabSize);
    if (Number.isFinite(n) && n >= 1 && n <= 8) out.tabSize = Math.round(n);
    else errors.push(`"tabSize" must be a number between 1–8 — kept previous value`);
  }
  if ("indentUnit" in raw) {
    const u = String(raw.indentUnit ?? "");
    if (/^( +|\t+)$/.test(u) && u.length >= 1 && u.length <= 8) out.indentUnit = u;
      else errors.push(`"indentUnit" must be spaces/tabs only (1–8 chars) — kept previous value`);
  }
  if ("fontSize" in raw) {
    const n = Number(raw.fontSize);
    if (Number.isFinite(n) && n >= 8 && n <= 32) out.fontSize = Math.round(n);
    else errors.push(`"fontSize" must be between 8–32 — kept previous value`);
  }
  if ("lineHeight" in raw) {
    const n = Number(raw.lineHeight);
    if (Number.isFinite(n) && n >= 1 && n <= 3) out.lineHeight = Math.round(n * 100) / 100;
    else errors.push(`"lineHeight" must be between 1.0–3.0 — kept previous value`);
  }
  if ("fontWeight" in raw) {
    const n = Number(raw.fontWeight);
    if ([300, 400, 500, 600, 700].includes(n)) out.fontWeight = n;
    else errors.push(`"fontWeight" must be 300/400/500/600/700 — kept previous value`);
  }
  if ("theme" in raw || "editorTheme" in raw) {
    const v = raw.theme ?? raw.editorTheme;
    if (typeof v === "string") out.theme = migrateTheme(v);
    else errors.push(`"theme" must be a string — kept previous value`);
  }
  // ── Compat sync: wordWrap <-> lineWrapping ──
  if ("wordWrap" in raw && !("lineWrapping" in raw)) {
    out.lineWrapping = raw.wordWrap !== false;
  }
  out.wordWrap = out.lineWrapping !== false;
  // Passthrough compat keys (read by the save pipeline / notebook)
  for (const k of ["fontFamily", "autoSave", "keybindings"]) {
    if (k in raw) out[k] = raw[k];
  }
  return { settings: out, errors };
};

// Whole settings.json blob -> normalized cm settings (for editor consumption).
export const normalizeCmSettings = (all) => validateCmSettings(all || {}).settings;
