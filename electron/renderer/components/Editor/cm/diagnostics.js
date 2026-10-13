// cm/diagnostics.js — Lezer syntax errors → Problems panel markers.
//
// No LSP or lint package: every language package already ships a Lezer
// parser, which produces ⚠ (isError) nodes on invalid code. We pick up
// those nodes and publish them on the `codemirror:diagnostics` event —
// the Problems panel listens on this contract:
//   { path, markers: [{ path, message, severity:8, startLineNumber, startColumn, source }] }
// Empty markers = clear that file's entry. No new npm dep needed:
// syntaxTree comes from @codemirror/language, and iteration is Tree's own method.

import { syntaxTree } from "@codemirror/language";

const MAX_MARKERS = 50;
const MAX_DOC = 600000; // larger files → skip lint (perf)

export const collectSyntaxDiagnostics = (view) => {
  const markers = [];
  try {
    if (!view?.state) return markers;
    const doc = view.state.doc;
    if (!doc || doc.length === 0 || doc.length > MAX_DOC) return markers;
    let tree = null;
    try { tree = syntaxTree(view.state); } catch { return markers; }
    if (!tree) return markers;
    const errs = [];
    try {
      tree.iterate({
        enter(n) {
          try {
            if (n?.type?.isError && errs.length < 200) {
              errs.push({ from: n.from, to: n.to });
            }
          } catch {}
        },
      });
    } catch { return markers; }
    if (!errs.length) return markers;
    // Keep only the outermost nested error nodes (less spam on half-typed lines).
    const outer = errs.filter(
      (e, i) => !errs.some((o, j) => j !== i && o.from <= e.from && o.to >= e.to && (o.from < e.from || o.to > e.to)),
    );
    for (const e of outer.slice(0, MAX_MARKERS)) {
      try {
        const at = Math.max(0, Math.min(e.from, doc.length));
        const line = doc.lineAt(at);
        const col = at - line.from + 1;
        const snippet = String(line.text || "").trim().slice(0, 80);
        markers.push({
          message: snippet ? `Syntax error near '${snippet}'` : "Syntax error",
          severity: 8,
          startLineNumber: line.number,
          startColumn: Math.max(1, col),
          source: "syntax",
        });
      } catch {}
    }
  } catch {}
  return markers;
};

// Send to the Problems panel (path is also on the marker — the panel reads both).
export const publishDiagnostics = (path, markers) => {
  try {
    if (!path) return;
    const list = (Array.isArray(markers) ? markers : []).map((m) => ({ ...m, path }));
    window.dispatchEvent(new CustomEvent("codemirror:diagnostics", { detail: { path, markers: list } }));
  } catch {}
};
