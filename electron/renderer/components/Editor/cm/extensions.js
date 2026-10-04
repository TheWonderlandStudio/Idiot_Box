// cm/extensions.js — plain CodeMirror extensions (@uiw basicSetup={false}).
//
// Fixed sensible set; sirf chand flags settings se aate hain (theme, font,
// tabSize, indentUnit, lineNumbers, lineWrapping, autocompletion,
// tabAcceptsCompletion, vim, snippets). Koi LSP, lint, custom highlights,
// ya whitespace-dots nahi — language package jo deta hai wahi milta hai.
// Find = CodeMirror ka built-in search panel (openSearchPanel);
// Tab = suggestion accept (khula ho to), warna indent.

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

  // ── Gutter / view (lineNumbers + wrapping settings se, baaki fixed on) ──
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
    // Snippets language package ke completions ke saath add hote hain —
    // `override` mat lagao, wo languageData ke sources ko replace kar deta
    // hai (console. / import completions tab gayab ho jati thin).
    const snippetSource = s.snippets ? getSnippetCompletionSource(languageId) : null;
    if (snippetSource) ext.push(EditorState.languageData.of(() => [{ autocomplete: snippetSource }]));
  }
  if (s.vim) ext.push(vim());
  ext.push(closeBrackets());
  ext.push(history());
  if (s.lineWrapping !== false) ext.push(EditorView.lineWrapping);

  // ── Base search (built-in panel + F3 + gotoLine state) ──
  try { ext.push(search()); } catch {}

  // ── Keymaps, ek me flat ──
  ext.push(keymap.of([
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...closeBracketsKeymap,
  ]));

  // ── Tab: suggestion khula ho to accept, warna false return karke normal
  // indent par fall through — dono kaam ek key par. Prec.high zaroori hai,
  // warna default indent keymap jeet jata hai. (tabAcceptsCompletion flag se
  // on/off. NOTE: seedha acceptCompletion — koi wrapper mat lagao; wrapper
  // interaction-timestamp reset karke accept ko fail karta hai.)
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
