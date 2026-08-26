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

    // lightweight: event-driven, fallback poll only when visible
    pollMarkers();
    interval = setInterval(() => { if (!document.hidden) pollMarkers(); }, 5000);
    try {
      const monaco = window.monaco;
      if (monaco && monaco.editor && monaco.editor.onDidChangeMarkers) {
        dispose = monaco.editor.onDidChangeMarkers(() => { if (!document.hidden) pollMarkers(); });
      }
    } catch {}

    return () => {
      if (interval) clearInterval(interval);
      if (dispose) try { dispose.dispose(); } catch {}
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
    if (sev === 8) return "#f44747";
    if (sev === 4) return "#cca700";
    if (sev === 2) return "#3794ff";
    return "#888";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", color: "#cccccc", fontFamily: "sans-serif", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Problems</span>
          <span style={{ fontSize: 10, background: markers.filter((m) => m.severity === 8).length ? "#5a1d1d" : "#2d2d2d", color: markers.filter((m) => m.severity === 8).length ? "#f44747" : "#888", padding: "1px 6px", borderRadius: 3 }}>
            {markers.filter((m) => m.severity === 8).length} errors
          </span>
          <span style={{ fontSize: 10, background: "#2d2d2d", color: "#888", padding: "1px 6px", borderRadius: 3 }}>{filtered.length}/{markers.length}</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["all", "error", "warning"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? "#094771" : "transparent",
                border: "1px solid #3a3a3a",
                color: filter === f ? "#fff" : "#888",
                padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontSize: 11, textTransform: "capitalize",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 32, color: "#666", fontSize: 12 }}>
            {markers.length === 0 ? "No problems — all good" : `No ${filter} problems`}
            <div style={{ fontSize: 11, marginTop: 8, color: "#555" }}>Diagnostics from Monaco (TS/JS) will appear here</div>
          </div>
        )}
        {filtered.map((m, i) => (
          <div
            key={`${m.resource?.path}:${m.startLineNumber}:${m.startColumn}:${i}`}
            onClick={() => openMarker(m)}
            style={{
              display: "flex", gap: 8, padding: "6px 8px", cursor: "pointer",
              borderBottom: "1px solid #2d2d2d", alignItems: "flex-start",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "#2a2d2e"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            <span style={{ color: getSeverityColor(m.severity), fontSize: 12, flexShrink: 0, marginTop: 1 }}>{getSeverityIcon(m.severity)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#cccccc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.message}</div>
              <div style={{ fontSize: 11, color: "#888", display: "flex", gap: 8 }}>
                <span style={{ fontFamily: "Consolas, monospace" }}>{m.resource?.path?.split("/").pop() || "unknown"}:{m.startLineNumber}:{m.startColumn}</span>
                <span style={{ color: "#555" }}>{m.source || ""}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProblemsPanel;
