// Problems Panel — editor lint + runtime errors.
//
// Sources:
//  - Editor har lint run par `codemirror:diagnostics` bhejta hai
//    { path, markers } — Lezer syntax errors (cm/diagnostics.js).
//  - Run panel fail run par { path, markers, origin: "runtime" } bhejta hai
//    (Python traceback / Node stack se nikle markers, source Python/Node/Java).
// Dono alag buckets me rehte hain taaki editor ka agla lint run runtime
// errors na mitaye (aur vice versa). Empty markers = sirf apni bucket clear.
// Severity: 8=Error, 4=Warning, 2=Info, 1=Hint.
// Click -> open-file-in-editor + editor:revealLine.
import React, { useEffect, useState } from "react";

const fileBase = (p) => String(p || "unknown").split(/[\\/]/).pop() || String(p || "unknown");

const ProblemsPanel = () => {
  const [markers, setMarkers] = useState([]);
  const [filter, setFilter] = useState("all"); // all | error | warning
  const [svcError, setSvcError] = useState(null);

  useEffect(() => {
    const byFile = new Map(); // path -> { editor: [], runtime: [] }
    const rebuild = () => {
      try {
        const seen = new Set();
        const all = [];
        for (const buckets of byFile.values()) {
          const list = [...(buckets.editor || []), ...(buckets.runtime || [])];
          for (const m of list) {
            const k = `${m.path}:${m.startLineNumber}:${m.startColumn}:${m.message}`;
            if (seen.has(k)) continue;
            seen.add(k);
            all.push(m);
          }
        }
        all.sort((a, b) => {
          if (a.severity !== b.severity) return b.severity - a.severity;
          return (a.path || "").localeCompare(b.path || "");
        });
        setMarkers(all);
        setSvcError(null);
      } catch (e) {
        setSvcError(e?.message || String(e));
      }
    };
    const onDiags = (e) => {
      try {
        const { path, markers: list, origin } = e.detail || {};
        if (!path) return;
        const bucket = origin === "runtime" ? "runtime" : "editor";
        const cur = byFile.get(path) || { editor: [], runtime: [] };
        cur[bucket] = Array.isArray(list) && list.length ? list : [];
        if (!cur.editor.length && !cur.runtime.length) byFile.delete(path);
        else byFile.set(path, cur);
        rebuild();
      } catch {}
    };
    window.addEventListener("codemirror:diagnostics", onDiags);
    return () => {
      window.removeEventListener("codemirror:diagnostics", onDiags);
    };
  }, []);

  const filtered = markers.filter((m) => {
    if (filter === "error") return m.severity === 8;
    if (filter === "warning") return m.severity === 4 || m.severity === 2 || m.severity === 1;
    return true;
  });

  const openMarker = (m) => {
    try {
      const raw = m.fsPath || m.path || "";
      // Convert vscode URI path to file path
      let filePath = raw;
      if (filePath && filePath.startsWith("/")) {
        // On Windows, path may be like /C:/Users/...
        if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
      }
      // Try to dispatch open
      if (filePath) {
        window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: filePath } }));
        // Also try to reveal line
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("editor:revealLine", { detail: { path: filePath, line: m.startLineNumber, column: m.startColumn } }));
        }, 300);
      }
    } catch {}
  };

  const getSeverityIcon = (sev) => {
    if (sev === 8) return "✖"; // Error
    if (sev === 4) return "⚠"; // Warning
    if (sev === 2) return "ℹ"; // Info
    return "•";
  };
  const getSeverityColor = (sev) => {
    if (sev === 8) return "var(--danger)";
    if (sev === 4) return "var(--git-modified)";
    if (sev === 2) return "var(--link-blue)";
    return "var(--icon)";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", color: "var(--text-bright)", fontFamily: "sans-serif", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-6) var(--space-12)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)" }}>
          <span style={{ fontSize: "var(--fs-body)", fontWeight: "var(--fw-semibold)" }}>Problems</span>
          <span style={{ fontSize: "var(--fs-tiny)", background: markers.filter((m) => m.severity === 8).length ? "var(--error-bg-solid)" : "var(--bg-active)", color: markers.filter((m) => m.severity === 8).length ? "var(--danger)" : "var(--icon)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-sm)" }}>
            {markers.filter((m) => m.severity === 8).length} errors
          </span>
          <span style={{ fontSize: "var(--fs-tiny)", background: "var(--bg-active)", color: "var(--icon)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-sm)" }}>{filtered.length}/{markers.length}</span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-4)" }}>
          {["all", "error", "warning"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? "var(--select-blue)" : "transparent",
                border: "1px solid var(--border-light)",
                color: filter === f ? "var(--text-inverse)" : "var(--icon)",
                padding: "var(--space-2) var(--space-8)", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: "var(--fs-small)", textTransform: "capitalize",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)" }}>
        {svcError && (
          <div style={{ padding: "var(--space-8)", color: "var(--danger)", fontSize: "var(--fs-small)" }}>Diagnostics error: {svcError}</div>
        )}
        {filtered.length === 0 && !svcError && (
          <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
            {markers.length === 0 ? "No problems — all good" : `No ${filter} problems`}
            <div style={{ fontSize: "var(--fs-small)", marginTop: "var(--space-8)", color: "var(--text-placeholder)" }}>Editor syntax errors &amp; failed-run errors appear here — click to jump</div>
          </div>
        )}
        {filtered.map((m, i) => (
          <div
            key={`${m.path}:${m.startLineNumber}:${m.startColumn}:${i}`}
            onClick={() => openMarker(m)}
            style={{
              display: "flex", gap: "var(--space-8)", padding: "var(--space-6) var(--space-8)", cursor: "pointer",
              borderBottom: "1px solid var(--bg-active)", alignItems: "flex-start",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover-strong)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <span style={{ color: getSeverityColor(m.severity), fontSize: "var(--fs-body)", flexShrink: 0, marginTop: "var(--space-1)" }}>{getSeverityIcon(m.severity)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--fs-body)", color: "var(--text-bright)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.message}</div>
              <div style={{ fontSize: "var(--fs-small)", color: "var(--icon)", display: "flex", gap: "var(--space-8)" }}>
                <span style={{ fontFamily: "var(--font-code)" }} title={m.path}>{fileBase(m.path)}:{m.startLineNumber}:{m.startColumn}</span>
                <span style={{ color: "var(--text-placeholder)" }}>{m.source || ""}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProblemsPanel;
