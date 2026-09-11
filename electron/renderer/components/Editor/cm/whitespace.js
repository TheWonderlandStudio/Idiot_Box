// cm/whitespace.js — custom all-spaces whitespace dots.
//
// Stock highlightWhitespace() mat use karna: wo sirf boundary spaces par
// faint dots lagata hai. Ye MatchDecorator + ViewPlugin se HAR space/tab run
// par dots lagata hai — Decoration.mark + repeating radial-gradient se, taaki
// text untouched rahe (copy/paste, cursor, selection sab safe; koi widget
// nahi). Bade docs (>500KB) par auto-skip (perf).

import { Decoration, MatchDecorator, ViewPlugin } from "@codemirror/view";

const WS_CSS = `
.cm-ws-run {
  background-image: radial-gradient(circle, var(--icon-muted, #6e7681) 1px, transparent 1.2px);
  background-size: 0.62ch 0.9em;
  background-repeat: repeat-x;
  background-position: left center;
  opacity: 0.75;
}
.cm-ws-tabrun {
  background-image: radial-gradient(circle, var(--icon-muted, #6e7681) 1px, transparent 1.2px);
  background-size: 1.2ch 0.9em;
  background-repeat: repeat-x;
  background-position: left center;
  opacity: 0.75;
}
`;

let cssInjected = false;
const ensureCss = () => {
  if (cssInjected) return;
  cssInjected = true;
  try {
    if (document.getElementById("cm-ws-style")) return;
    const el = document.createElement("style");
    el.id = "cm-ws-style";
    el.textContent = WS_CSS;
    document.head.appendChild(el);
  } catch {}
};

// Run-wise marks (per-char nahi — bade docs par bhi sasta).
const matcher = new MatchDecorator({
  regexp: /[ \t]+/g,
  decoration: (match) => {
    const t = match[0];
    if (t.includes("\t")) return Decoration.mark({ class: "cm-ws-tabrun" });
    return Decoration.mark({ class: "cm-ws-run" });
  },
});

const wsPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = matcher.createDeco(view); }
    update(u) { this.decorations = matcher.updateDeco(u, this.decorations); }
  },
  { decorations: (v) => v.decorations }
);

export const MAX_WS_DOC = 500 * 1024;

// enabled flag on + chhota doc -> [plugin], warna [].
export const whitespaceDots = (enabled, docSize) => {
  if (!enabled) return [];
  if (Number.isFinite(docSize) && docSize > MAX_WS_DOC) return [];
  try { ensureCss(); } catch {}
  return [wsPlugin];
};
