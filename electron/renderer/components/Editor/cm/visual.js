// cm/visual.js — visual-only CodeMirror extensions.
//
// Minimap, indentation guides, bracket-pair colorization, whitespace dots and
// typography (line-height / ligatures / weight). Every helper is a no-op when
// its setting is off, so buildCmExtensions can append them unconditionally.

import { EditorView, Decoration, ViewPlugin } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { showMinimap } from "@replit/codemirror-minimap";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";

// ── Minimap ────────────────────────────────────────────────────────────────
export const minimapExtension = () =>
  showMinimap.compute(["doc"], () => ({
    create: () => {
      const dom = document.createElement("div");
      dom.className = "ibx-minimap";
      return { dom };
    },
    displayText: "blocks",
    showOverlay: "always",
  }));

// ── Indentation guides ─────────────────────────────────────────────────────
export const indentGuidesExtension = () =>
  indentationMarkers({
    highlightActiveBlock: true,
    hideFirstIndent: false,
    markerType: "codeOnly",
    thickness: 1,
    activeThickness: 1,
  });

// ── Bracket pair colorization ──────────────────────────────────────────────
const OPEN_BR = { "(": ")", "[": "]", "{": "}" };
const CLOSE_BR = { ")": "(", "]": "[", "}": "{" };
const BR_LEVELS = 6;

const bracketColorPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view) {
    const builder = new RangeSetBuilder();
    try {
      const { from, to } = view.viewport;
      const text = view.state.doc.sliceString(from, to);
      const stack = [];
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const open = OPEN_BR[ch];
        const close = CLOSE_BR[ch];
        if (open) {
          const depth = stack.length;
          const cls = "ibx-br" + (depth % BR_LEVELS);
          builder.add(from + i, from + i + 1, Decoration.mark({ class: cls }));
          stack.push({ ch, i });
        } else if (close) {
          // Pop to the matching opener; if none, color as depth 0.
          let depth = 0;
          for (let k = stack.length - 1; k >= 0; k--) {
            if (OPEN_BR[stack[k].ch] === ch) { depth = k; stack.length = k; break; }
          }
          const cls = "ibx-br" + (depth % BR_LEVELS);
          builder.add(from + i, from + i + 1, Decoration.mark({ class: cls }));
        }
      }
    } catch {}
    return builder.finish();
  }
}, { decorations: (v) => v.decorations });

export const bracketColorExtension = () => bracketColorPlugin;

// ── Whitespace dots ────────────────────────────────────────────────────────
const wsDot = Decoration.mark({ class: "ibx-ws" });
const wsTab = Decoration.mark({ class: "ibx-ws ibx-ws-tab" });

const whitespacePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view) {
    const builder = new RangeSetBuilder();
    try {
      const { from, to } = view.viewport;
      const text = view.state.doc.sliceString(from, to);
      let count = 0;
      for (let i = 0; i < text.length && count < 8000; i++) {
        const ch = text[i];
        if (ch === " ") {
          // Only show trailing/multiple spaces the way editors do — show all.
          builder.add(from + i, from + i + 1, wsDot);
          count++;
        } else if (ch === "\t") {
          builder.add(from + i, from + i + 1, wsTab);
          count++;
        }
      }
    } catch {}
    return builder.finish();
  }
}, { decorations: (v) => v.decorations });

export const whitespaceExtension = () => whitespacePlugin;

// ── Typography (line-height, ligatures, weight) ────────────────────────────
export const typographyExtension = (settings) => {
  const s = settings || {};
  const lh = Number.isFinite(s.lineHeight) ? Math.min(3, Math.max(1, s.lineHeight)) : 1.5;
  const weight = [300, 400, 500, 600, 700].includes(s.fontWeight) ? s.fontWeight : 400;
  const ligatures = s.fontLigatures === true;
  return EditorView.theme({
    ".cm-content, .cm-gutters": {
      lineHeight: String(lh),
      fontWeight: String(weight),
      fontVariantLigatures: ligatures ? "contextual" : "none",
      fontFeatureSettings: ligatures ? '"liga" 1, "calt" 1' : '"liga" 0, "calt" 0',
    },
  });
};
