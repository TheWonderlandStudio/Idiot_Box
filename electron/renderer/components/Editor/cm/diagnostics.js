// cm/diagnostics.js — Lezer syntax errors → Problems panel markers.
//
// Koi LSP ya lint package nahi: har language package me wese bhi Lezer
// parser hota hai, jo galat code par ⚠ (isError) nodes banata hai. Wahi
// nodes utha kar `codemirror:diagnostics` event par publish karte hain —
// Problems panel isi contract par sunta hai:
//   { path, markers: [{ path, message, severity:8, startLineNumber, startColumn, source }] }
// Empty markers = us file ki entry clear. Koi naya npm dep nahi chahiye:
// syntaxTree @codemirror/language se, iterate Tree ka apna method hai.

import { syntaxTree } from "@codemirror/language";

const MAX_MARKERS = 50;
const MAX_DOC = 600000; // isse badi file → lint skip (perf)

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
    // Nested error nodes me sirf outermost rakho (aadhi-likhi line par spam kam).
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

// Problems panel ko bhejo (path marker me bhi — panel dono dekhta hai).
export const publishDiagnostics = (path, markers) => {
  try {
    if (!path) return;
    const list = (Array.isArray(markers) ? markers : []).map((m) => ({ ...m, path }));
    window.dispatchEvent(new CustomEvent("codemirror:diagnostics", { detail: { path, markers: list } }));
  } catch {}
};
