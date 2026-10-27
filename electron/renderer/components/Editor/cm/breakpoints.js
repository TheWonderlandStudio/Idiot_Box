// Debug breakpoint gutter for CodeMirror 6.
//
// Red dot = enabled breakpoint, hollow dot = disabled. Click toggles a line;
// F9 is also wired through the editable command registry (toggleBreakpoint).
import { gutter, GutterMarker, ViewPlugin, keymap } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import {
  getBreakpointAt, subscribeBreakpoints, toggleBreakpoint,
} from "../breakpoints.js";

const refreshBreakpoints = StateEffect.define();

const breakpointField = StateField.define({
  create: () => 0,
  update(value, tr) {
    let next = value;
    for (const effect of tr.effects) {
      if (effect.is(refreshBreakpoints)) next++;
    }
    return next;
  },
});

class BreakpointMarker extends GutterMarker {
  constructor(marker) {
    super();
    this.marker = marker || null;
  }

  eq(other) {
    return (this.marker?.line || 0) === (other.marker?.line || 0) &&
      (this.marker?.enabled !== false) === (other.marker?.enabled !== false);
  }

  toDOM() {
    const el = document.createElement("div");
    if (!this.marker) {
      el.className = "cm-bp-spacer";
      return el;
    }
    el.className = `cm-bp-marker${this.marker.enabled === false ? " cm-bp-marker--disabled" : ""}`;
    el.title = this.marker.enabled === false ? "Breakpoint disabled" : "Breakpoint — click to remove";
    return el;
  }
}

const EMPTY_MARKER = new BreakpointMarker(null);

/**
 * @param {() => string|null} getPath returns the file path of this editor.
 */
export const breakpointGutterExtension = (getPath) => {
  const refreshPlugin = ViewPlugin.fromClass(class {
    constructor(view) {
      this.unsub = subscribeBreakpoints((path) => {
        if (!path || path !== getPath?.()) return;
        try { view.dispatch({ effects: refreshBreakpoints.of(null) }); } catch {}
      });
    }

    destroy() {
      try { this.unsub?.(); } catch {}
    }
  });

  return [
    breakpointField,
    gutter({
      class: "cm-breakpoint-gutter",
      lineMarker: (view, block) => {
        const path = getPath?.();
        if (!path) return null;
        const line = view.state.doc.lineAt(block.from).number;
        const bp = getBreakpointAt(path, line);
        return bp ? new BreakpointMarker(bp) : null;
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshBreakpoints))),
      initialSpacer: () => EMPTY_MARKER,
      domEventHandlers: {
        mousedown(view, block, event) {
          if (event.button !== 0) return false;
          const path = getPath?.();
          if (!path) return false;
          event.preventDefault();
          const line = view.state.doc.lineAt(block.from).number;
          toggleBreakpoint(path, line);
          return true;
        },
      },
    }),
    refreshPlugin,
    keymap.of([
      {
        key: "F9",
        run: (view) => {
          const path = getPath?.();
          if (!path) return false;
          const line = view.state.doc.lineAt(view.state.selection.main.head).number;
          toggleBreakpoint(path, line);
          return true;
        },
      },
    ]),
  ];
};
