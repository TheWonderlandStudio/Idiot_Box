// cm/goto.js — navigation helpers.
//
//   • Ctrl/Cmd+click on a URL opens it in the system browser.
//   • Lezer-based document symbols → breadcrumbs + outline menu.
//
// No LSP involved: out of the box the language packages already ship a Lezer
// parser, so we derive a useful symbol tree from it.

import {
  EditorView, Decoration, ViewPlugin,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// ── Clickable links ────────────────────────────────────────────────────────
const URL_RE = /\bhttps?:\/\/[^\s"'`)\]}<>]+/g;
const linkMark = Decoration.mark({ class: "ibx-link" });

const linkPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view) {
    const builder = new RangeSetBuilder();
    try {
      const { from, to } = view.viewport;
      const text = view.state.doc.sliceString(from, to);
      let m;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(text)) !== null) {
        builder.add(from + m.index, from + m.index + m[0].length, linkMark);
      }
    } catch {}
    return builder.finish();
  }
}, { decorations: (v) => v.decorations });

const linkClickHandlers = EditorView.domEventHandlers({
  mousedown: (e, view) => {
    if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
    try {
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos == null) return false;
      const line = view.state.doc.lineAt(pos);
      URL_RE.lastIndex = 0;
      let m;
      while ((m = URL_RE.exec(line.text)) !== null) {
        const s = line.from + m.index;
        const en = s + m[0].length;
        if (pos >= s && pos <= en) {
          e.preventDefault();
          try { window.electronAPI?.openExternal?.(m[0]); } catch {}
          return true;
        }
      }
    } catch {}
    return false;
  },
});

export const linksExtension = () => [linkPlugin, linkClickHandlers];

// ── Document symbols (outline) ─────────────────────────────────────────────
const KIND_BY_NODE = {
  FunctionDeclaration: "function", FunctionExpression: "function", ArrowFunction: "function",
  GeneratorDeclaration: "function", MethodDefinition: "method", FunctionDefinition: "function",
  FunctionDef: "function", FunctionItem: "function",
  ClassDeclaration: "class", ClassDefinition: "class", ClassDef: "class", ClassExpression: "class",
  InterfaceDeclaration: "interface", TypeAliasDeclaration: "type", EnumDeclaration: "enum",
  EnumItem: "enum", StructItem: "struct", TraitItem: "trait", ImplItem: "impl", ModItem: "module",
  VariableDeclaration: "variable", LexicalDeclaration: "variable",
  PropertyDefinition: "property", Property: "property", PropertyName: "property",
  ImportDeclaration: "module", ExportDeclaration: "module",
  RuleSet: "rule", ATXHeading1: "heading1", ATXHeading2: "heading2", ATXHeading3: "heading3",
  ATXHeading4: "heading4", ATXHeading5: "heading5", ATXHeading6: "heading6",
  SetextHeading1: "heading1", SetextHeading2: "heading2",
  TagName: "tag", Element: "tag",
};

const NAME_NODES = new Set([
  "Identifier", "PropertyName", "VariableName", "VariableDefinition",
  "TypeIdentifier", "Definition", "Name",
]);

const firstLineOf = (state, node) => {
  try { return state.doc.lineAt(node.from).text.trim(); } catch { return ""; }
};

const symbolName = (state, node) => {
  // Headings → the heading text.
  if (node.name.startsWith("ATXHeading") || node.name.startsWith("SetextHeading")) {
    try { return state.doc.sliceString(node.from, node.to).replace(/^#+\s*/, "").trim(); } catch { return ""; }
  }
  let name = "";
  try {
    let cur = node.firstChild;
    while (cur) {
      if (NAME_NODES.has(cur.name)) {
        const t = state.doc.sliceString(cur.from, cur.to).trim();
        if (t) { name = t; break; }
      }
      // one level deeper (e.g. FunctionDeclaration -> Identifier)
      let child = cur.firstChild;
      while (child) {
        if (NAME_NODES.has(child.name)) {
          const t = state.doc.sliceString(child.from, child.to).trim();
          if (t) { name = t; break; }
        }
        child = child.nextSibling;
      }
      if (name) break;
      cur = cur.nextSibling;
    }
  } catch {}
  if (!name) name = firstLineOf(state, node).slice(0, 60);
  return name;
};

export const collectSymbols = (view) => {
  const out = [];
  try {
    if (!view?.state) return out;
    if (view.state.doc.length > 600000) return out;
    let tree = null;
    try { tree = syntaxTree(view.state); } catch { return out; }
    if (!tree) return out;
    const seen = [];
    tree.iterate({
      enter: (node) => {
        const kind = KIND_BY_NODE[node.name];
        if (!kind) return;
        if (out.length >= 400) return false;
        const name = symbolName(view.state, node);
        if (!name) return;
        out.push({ name, kind, from: node.from, to: node.to });
        seen.push(node.to);
      },
    });
  } catch {}
  // Sort by position and compute nesting depth for indent in the menu.
  out.sort((a, b) => a.from - b.from);
  let depth = 0;
  let last = 0;
  for (const s of out) {
    if (s.from >= last) { depth = 0; }
    s.depth = depth;
    depth = Math.min(depth + 1, 4);
    last = s.to;
  }
  return out;
};

export const symbolPathAt = (symbols, pos) => {
  const path = [];
  for (const s of symbols) {
    if (s.from <= pos && pos <= s.to) path.push(s);
  }
  // Keep innermost few for the breadcrumb.
  return path.slice(-4);
};
