// cm/extensions.js — @uiw/react-codemirror ke liye extensions array.
//
// basicSetup={false} rakho — ye array khud banao. `codemirror` package ka
// basicSetup use NAHI hota; 24 setup flags granular imports se bante hain:
//   view         -> lineNumbers / highlightActiveLineGutter /
//                   highlightSpecialChars / drawSelection / dropCursor /
//                   rectangularSelection / crosshairCursor / highlightActiveLine
//   state        -> EditorState.allowMultipleSelections (+ tabSize facet)
//   commands     -> history (+ historyKeymap / defaultKeymap)
//   language     -> indentOnInput / syntaxHighlighting (defaultHighlightStyle +
//                   fallback) / bracketMatching / foldGutter (+ foldKeymap,
//                   indentUnit)
//   autocomplete -> autocompletion / closeBrackets (+ closeBracketsKeymap /
//                   completionKeymap)
//   search       -> highlightSelectionMatches (VIEW me NAHI hai — gotcha) +
//                   searchKeymap
//   lint         -> lintKeymap
// Keymaps keymap.of([...flat]) me jodte hain. Tab-accept Prec.high me lapete
// hain (warna default indent keymap jeet jata hai); acceptCompletion false
// return kare to indent par fall-through hota hai.

import { EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  keymap,
} from "@codemirror/view";
import {
  history,
  historyKeymap,
  defaultKeymap,
  toggleComment,
  deleteLine,
  moveLineUp,
  moveLineDown,
} from "@codemirror/commands";
import {
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentUnit,
} from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  acceptCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { oneDark } from "@codemirror/theme-one-dark";
import { vim } from "@replit/codemirror-vim";
import { customHighlightsFor } from "./highlights.js";
import { whitespaceDots } from "./whitespace.js";

export const themeExtensionFor = (theme) => {
  if (theme === "light") return vscodeLight;
  if (theme === "oneDark") return oneDark;
  return vscodeDark; // "dark" default
};

const withMonoFallback = (f) => {
  const s = String(f || "").trim();
  if (!s) return s;
  return /monospace/i.test(s) ? s : `${s}, monospace`;
};

// Custom keys: Tab=autocomplete (accept-or-open), Mod-/=comment,
// Mod-D=deleteLine, Alt-Up/Down=moveLine, Mod-F/Mod-H=custom find/replace bar.
// (customKeys flag se gated; Tab alag se tabAcceptsCompletion flag se —
// Prec.high me, warna indent jeet jata hai. Tab khula completion accept karta
// hai, band ho to popup kholta hai, aur aage (indent/focus) nahi badhta.
// acceptCompletion false par startCompletion true deta hai, isliye hamesha
// yahin rukta hai. Mod-F bhi Prec.high me taaki searchKeymap ka default panel
// na khule — hum apna FindReplaceBar kholte hain.)
const tabAutocomplete = (view) => {
  try {
    if (acceptCompletion(view)) return true; // khula hai -> accept
  } catch {}
  try {
    return startCompletion(view); // band hai -> kholo (true milta hai)
  } catch {}
  return false;
};
const customKeymap = (tabAccepts, onOpenFind) => {
  const bindings = [
    { key: "Mod-/", run: toggleComment },
    { key: "Mod-D", run: deleteLine },
    { key: "Alt-ArrowUp", run: moveLineUp },
    { key: "Alt-ArrowDown", run: moveLineDown },
  ];
  const out = [];
  if (tabAccepts) {
    out.push(Prec.high(keymap.of([{ key: "Tab", run: tabAutocomplete }])));
  }
  if (typeof onOpenFind === "function") {
    out.push(Prec.high(keymap.of([
      { key: "Mod-f", run: () => { onOpenFind(false); return true; } },
      { key: "Mod-h", run: () => { onOpenFind(true); return true; } },
    ])));
  }
  out.push(keymap.of(bindings));
  return out;
};

export const buildCmExtensions = ({
  settings,
  languageSupport = [],
  lspExtension = [],
  docSize = 0,
  onOpenFind = null,
}) => {
  const s = settings || {};
  const ext = [];

  // ── Theme + font (font theme BAAD me taaki font jeete) ──
  ext.push(themeExtensionFor(s.theme));
  try {
    const fs = Number.isFinite(s.fontSize) ? Math.min(32, Math.max(8, s.fontSize)) : 14;
    const ff = withMonoFallback(s.fontFamily || 'Consolas, "Courier New", monospace');
    ext.push(EditorView.theme({
      "&": { fontSize: `${fs}px` },
      ".cm-content, .cm-gutters": { fontFamily: ff },
      ".cm-scroller": { fontFamily: ff },
    }));
  } catch {}

  // ── Tab size + indent unit ──
  try {
    const ts = Number.isFinite(s.tabSize) ? Math.min(8, Math.max(1, s.tabSize)) : 2;
    ext.push(EditorState.tabSize.of(ts));
  } catch {}
  try {
    ext.push(indentUnit.of(typeof s.indentUnit === "string" && s.indentUnit ? s.indentUnit : "  "));
  } catch {}

  // ── Language support (grammar + merged snippets) ──
  if (Array.isArray(languageSupport) && languageSupport.length) ext.push(...languageSupport);

  // ── view flags ──
  if (s.lineNumbers !== false) ext.push(lineNumbers());
  if (s.highlightActiveLineGutter !== false) ext.push(highlightActiveLineGutter());
  if (s.highlightSpecialChars !== false) ext.push(highlightSpecialChars());
  if (s.drawSelection !== false) ext.push(drawSelection());
  if (s.dropCursor !== false) ext.push(dropCursor());
  if (s.rectangularSelection !== false) ext.push(rectangularSelection());
  if (s.crosshairCursor !== false) ext.push(crosshairCursor());
  if (s.highlightActiveLine !== false) ext.push(highlightActiveLine());
  // highlightSelectionMatches @codemirror/search me hai (view me NAHI).
  if (s.highlightSelectionMatches !== false) {
    try { ext.push(highlightSelectionMatches()); } catch {}
  }

  // ── state flags ──
  if (s.allowMultipleSelections !== false) {
    try { ext.push(EditorState.allowMultipleSelections.of(true)); } catch {}
  }

  // ── language flags ──
  if (s.indentOnInput !== false) ext.push(indentOnInput());
  if (s.syntaxHighlighting !== false) {
    if (s.customHighlights !== false) ext.push(customHighlightsFor(s.theme));
    else {
      try { ext.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true })); }
      catch { ext.push(syntaxHighlighting(defaultHighlightStyle)); }
    }
  }
  if (s.bracketMatching !== false) ext.push(bracketMatching());
  if (s.foldGutter !== false) ext.push(foldGutter());

  // ── autocomplete flags ──
  if (s.autocompletion !== false) ext.push(autocompletion());
  if (s.closeBrackets !== false) ext.push(closeBrackets());

  // ── commands flags ──
  if (s.history !== false) ext.push(history());

  // ── Wrapping ──
  if (s.lineWrapping !== false) ext.push(EditorView.lineWrapping);

  // ── Whitespace dots (custom all-spaces; stock highlightWhitespace NAHI) ──
  ext.push(...whitespaceDots(s.highlightWhitespace === true, docSize));

  // ── Base search: match highlighting + F3/gotoLine state. Default panel
  // kabhi nahi khulta (openSearchPanel call hi nahi hota) — find UI apna
  // FindReplaceBar hai. Hamesha loaded (halka: state field + highlighter).
  try { ext.push(search()); } catch {}

  // ── Keymaps: sab ek keymap.of([...flat]) me ──
  const keys = [];
  if (s.defaultKeymap !== false) keys.push(...defaultKeymap);
  if (s.searchKeymap !== false) keys.push(...searchKeymap);
  if (s.historyKeymap !== false) keys.push(...historyKeymap);
  if (s.foldKeymap !== false) keys.push(...foldKeymap);
  if (s.completionKeymap !== false) keys.push(...completionKeymap);
  if (s.lintKeymap !== false) keys.push(...lintKeymap);
  if (s.closeBracketsKeymap !== false) keys.push(...closeBracketsKeymap);
  if (keys.length) ext.push(keymap.of(keys));

  // ── Custom keys (Tab accept + Mod-F/Mod-H Prec.high me) ──
  if (s.customKeys !== false) ext.push(...customKeymap(s.tabAcceptsCompletion !== false, onOpenFind));

  // ── Vim (toggleable, sabse end me) ──
  if (s.vim === true) {
    try { ext.push(vim()); } catch {}
  }

  // ── LSP (online ho tabhi aata hai, warna [] — offline local completions) ──
  if (Array.isArray(lspExtension) && lspExtension.length) ext.push(...lspExtension);

  return ext;
};
