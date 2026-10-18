// cm/colors.js — CSS color decorators (swatch next to hex colors).
//
// Lightweight: scans the visible lines of a CSS/SCSS/LESS document for
// #rgb / #rrggbb / #rrggbbaa tokens and renders a small colour swatch.

import {
  Decoration, ViewPlugin, WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

class SwatchWidget extends WidgetType {
  constructor(color) { super(); this.color = color; }
  eq(other) { return other.color === this.color; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "ibx-color-swatch";
    span.style.background = this.color;
    span.title = this.color;
    return span;
  }
  ignoreEvent() { return true; }
}

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

const colorPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
  }
  build(view) {
    const builder = new RangeSetBuilder();
    try {
      const { from, to } = view.viewport;
      const text = view.state.doc.sliceString(from, to);
      // Only swatch lines that look like CSS declarations to reduce noise.
      let m;
      HEX_RE.lastIndex = 0;
      while ((m = HEX_RE.exec(text)) !== null) {
        const at = from + m.index + m[0].length;
        builder.add(
          from + m.index + m[0].length,
          from + m.index + m[0].length,
          Decoration.widget({ widget: new SwatchWidget(m[0]), side: 1 }),
        );
        void at;
      }
    } catch {}
    return builder.finish();
  }
}, { decorations: (v) => v.decorations });

export const colorDecoratorExtension = () => colorPlugin;
