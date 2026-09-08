// Problems Panel — shows Monaco diagnostics (errors/warnings)
import React, { useEffect, useState } from "react";

const ProblemsPanel = () => {
  const [markers, setMarkers] = useState([]);
  const [filter, setFilter] = useState("all"); // all | error | warning

  useEffect(() => {
    let dispose = null;
    let interval = null;

    const pollMarkers = () => {
      try {
        // Try to get monaco from global
        const monaco = window.monaco;
        if (!monaco || !monaco.editor) return;
        const all = monaco.editor.getModelMarkers({});
        // Deduplicate and sort by severity then file
        const sorted = [...all].sort((a, b) => {
          if (a.severity !== b.severity) return b.severity - a.severity;
          return (a.resource?.path || "").localeCompare(b.resource?.path || "");
        });
        setMarkers(sorted);
      } catch {}
    };

    const subscribe = () => {
      try { dispose?.dispose?.(); } catch {}
      dispose = null;
      try {
        const monaco = window.monaco;
        if (monaco && monaco.editor && monaco.editor.onDidChangeMarkers) {
          dispose = monaco.editor.onDidChangeMarkers(() => { if (!document.hidden) pollMarkers(); });
        }
      } catch {}
    };

    // lightweight: event-driven, fallback poll only when visible
    pollMarkers();
    subscribe();
    interval = setInterval(() => { if (!document.hidden) pollMarkers(); }, 5000);
    // Editor exposes window.monaco asynchronously — (re)subscribe when ready.
    const onMonacoReady = () => { pollMarkers(); subscribe(); };
    window.addEventListener("monaco:ready", onMonacoReady);

    return () => {
      if (interval) clearInterval(interval);
      try { dispose?.dispose?.(); } catch {}
      window.removeEventListener("monaco:ready", onMonacoReady);
    };
  }, []);

  const filtered = markers.filter((m) => {
    if (filter === "error") return m.severity === 8;
    if (filter === "warning") return m.severity === 4 || m.severity === 2 || m.severity === 1;
    return true;
  });

  const openMarker = (m) => {
    try {
      const path = m.resource?.path || m.resource?.fsPath;
      // Convert vscode URI path to file path
      let filePath = path;
      if (filePath && filePath.startsWith("/")) {
        // On Windows, path may be like /C:/Users/...
        if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.slice(1);
      }
      // Try to dispatch open
      if (filePath) {
        // Find the original file path from marker (may need to map)
        const rel = filePath.replace(/\\/g, "/");
        // Try to find matching file in project
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
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
            {markers.length === 0 ? "No problems — all good" : `No ${filter} problems`}
            <div style={{ fontSize: "var(--fs-small)", marginTop: "var(--space-8)", color: "var(--text-placeholder)" }}>Diagnostics from Monaco (TS/JS) will appear here</div>
          </div>
        )}
        {filtered.map((m, i) => (
          <div
            key={`${m.resource?.path}:${m.startLineNumber}:${m.startColumn}:${i}`}
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
                <span style={{ fontFamily: "var(--font-code)" }}>{m.resource?.path?.split("/").pop() || "unknown"}:{m.startLineNumber}:{m.startColumn}</span>
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
