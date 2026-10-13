// cm/extensions.js — plain CodeMirror extensions (@uiw basicSetup={false}).
//
// Fixed sensible set; only a few flags come from settings (theme, font,
// tabSize, indentUnit, lineNumbers, lineWrapping, autocompletion,
// tabAcceptsCompletion, vim, snippets). No LSP, lint, custom highlights,
// or whitespace-dots — you get whatever the language package provides.
// Find = CodeMirror's built-in search panel (openSearchPanel);
// Tab = accept suggestion (when open), otherwise indent.

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
} from "@codemirror/autocomplete";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { vim } from "@replit/codemirror-vim";
import { vscodeDark, vscodeLight } from "@uiw/codemirror-theme-vscode";
import { oneDark } from "@codemirror/theme-one-dark";
import { getSnippetCompletionSource } from "./snippets.js";

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

export const buildCmExtensions = ({ settings, languageSupport = [], languageId = "plaintext" }) => {
  const s = settings || {};
  const ext = [];

  // ── Theme + font ──
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

  // ── Language ──
  if (Array.isArray(languageSupport) && languageSupport.length) ext.push(...languageSupport);

  // ── Gutter / view (lineNumbers + wrapping from settings, rest fixed on) ──
  if (s.lineNumbers !== false) ext.push(lineNumbers());
  ext.push(highlightActiveLineGutter());
  ext.push(highlightSpecialChars());
  ext.push(drawSelection());
  ext.push(dropCursor());
  ext.push(rectangularSelection());
  ext.push(crosshairCursor());
  ext.push(highlightActiveLine());
  try { ext.push(highlightSelectionMatches()); } catch {}

  // ── Editing ──
  ext.push(EditorState.allowMultipleSelections.of(true));
  ext.push(indentOnInput());
  try { ext.push(syntaxHighlighting(defaultHighlightStyle, { fallback: true })); }
  catch { ext.push(syntaxHighlighting(defaultHighlightStyle)); }
  ext.push(bracketMatching());
  ext.push(foldGutter());
  if (s.autocompletion !== false) {
    ext.push(autocompletion());
    // Snippets are added alongside the language package's completions —
    // do NOT use `override`; it replaces the languageData sources
    // (console./import completions then disappeared).
    const snippetSource = s.snippets ? getSnippetCompletionSource(languageId) : null;
    if (snippetSource) ext.push(EditorState.languageData.of(() => [{ autocomplete: snippetSource }]));
  }
  if (s.vim) ext.push(vim());
  ext.push(closeBrackets());
  ext.push(history());
  if (s.lineWrapping !== false) ext.push(EditorView.lineWrapping);

  // ── Base search (built-in panel + F3 + gotoLine state) ──
  try { ext.push(search()); } catch {}

  // ── Keymaps, flattened into one ──
  ext.push(keymap.of([
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...closeBracketsKeymap,
  ]));

  // ── Tab: accept when a suggestion is open, else return false and fall through to
  // normal indent — both jobs on one key. Prec.high is required,
  // otherwise the default indent keymap wins. (Toggled via the tabAcceptsCompletion
  // flag. NOTE: call acceptCompletion directly — do not add a wrapper; a wrapper
  // resets the interaction timestamp and makes accept fail.)
  if (s.tabAcceptsCompletion !== false) {
    ext.push(Prec.high(keymap.of([{ key: "Tab", run: acceptCompletion }])));
  }

  // ── Custom keys (comment / delete-line / move-line) ──
  ext.push(keymap.of([
    { key: "Mod-/", run: toggleComment },
    { key: "Mod-D", run: deleteLine },
    { key: "Alt-ArrowUp", run: moveLineUp },
    { key: "Alt-ArrowDown", run: moveLineDown },
  ]));

  return ext;
};
