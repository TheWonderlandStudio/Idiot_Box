// cm/lint.js — linter() + lintGutter() + Problems-panel bridge.
//
// Checks: JSON.parse validation (sirf json language me) + trailing-whitespace
// (warning) + TODO/FIXME markers (info). Problems panel CodeMirror lint se
// chalta hai: har lint run par `codemirror:diagnostics` window event dispatch
// hota hai { path, markers: [{ message, severity(8/4/2/1), startLine,
// startColumn, endLine, endColumn, source }] }.

import { linter } from "@codemirror/lint";

const SEV_TO_NUM = { error: 8, warning: 4, info: 2, hint: 1 };

// view param isliye taaki diagnostics publish ho saken (Problems panel).
export const makeCmLinter = (getPath, getLanguageId, publish) =>
  linter((view) => {
    const diags = [];
    try {
      const doc = view.state.doc;
      const text = doc.toString();
      if (text.length > 1024 * 1024) return []; // badi file — lint skip
      const langId = getLanguageId?.();
      // ── JSON validation ──
      if (langId === "json" && text.trim()) {
        try {
          JSON.parse(text);
        } catch (e) {
          const m = String(e?.message || "Invalid JSON");
          // "position N" nikaal kar offset banao, warna doc start.
          let pos = 0;
          const pm = m.match(/position\s+(\d+)/i);
          if (pm) pos = Math.min(doc.length, Math.max(0, parseInt(pm[1], 10)));
          diags.push({ from: pos, to: Math.min(doc.length, pos + 1), severity: "error", message: m });
        }
      }
      // ── Trailing whitespace + TODO (line-wise, cap 2000 lines) ──
      const maxLines = Math.min(doc.lines, 2000);
      for (let ln = 1; ln <= maxLines; ln++) {
        let line = null;
        try { line = doc.line(ln); } catch { continue; }
        const t = line.text;
        const trail = t.match(/[ \t]+$/);
        if (trail && trail[0].length) {
          diags.push({
            from: line.from + t.length - trail[0].length,
            to: line.to,
            severity: "warning",
            message: "Trailing whitespace",
          });
        }
        const todoIdx = t.search(/\b(TODO|FIXME)\b/);
        if (todoIdx >= 0) {
          const word = t.match(/\b(TODO|FIXME)\b/)[0];
          diags.push({
            from: line.from + todoIdx,
            to: line.from + todoIdx + word.length,
            severity: "info",
            message: `${word} marker`,
          });
        }
        if (diags.length > 200) break;
      }
    } catch {}
    try { publish?.(diags); } catch {}
    return diags;
  });

// CodeMirror diagnostic -> Problems marker (monaco-style severity numbers).
export const diagnosticsToMarkers = (filePath, diags, doc) => {
  const out = [];
  try {
    for (const d of diags || []) {
      let startLine = 1, startColumn = 1, endLine = 1, endColumn = 1;
      try {
        const a = doc.lineAt(Math.min(Math.max(0, d.from || 0), doc.length));
        const b = doc.lineAt(Math.min(Math.max(0, d.to ?? d.from ?? 0), doc.length));
        startLine = a.number; startColumn = a.from != null ? (d.from - a.from + 1) : 1;
        endLine = b.number; endColumn = (d.to ?? d.from ?? 0) - b.from + 1;
      } catch {}
      out.push({
        message: String(d.message || ""),
        severity: SEV_TO_NUM[d.severity] || 4,
        source: "codemirror",
        code: "",
        path: filePath,
        fsPath: filePath,
        startLineNumber: startLine,
        startColumn: Math.max(1, startColumn),
        endLineNumber: endLine,
        endColumn: Math.max(1, endColumn),
      });
    }
  } catch {}
  return out;
};

// Problems panel ko batayo (debounce caller ki zimmedari nahi — lint khud
// debounced hai; yahan seedha dispatch).
export const publishDiagnostics = (filePath, markers) => {
  try {
    window.dispatchEvent(new CustomEvent("codemirror:diagnostics", {
      detail: { path: filePath, markers: markers || [] },
    }));
  } catch {}
};
