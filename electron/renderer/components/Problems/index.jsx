// Problems Panel - VS Code diagnostics via monaco-vscode-api IMarkerService.
// (window.monaco kabhi set nahi hota — Editor sirf monaco:ready dispatch karta
// hai — isliye markers seedha service se padhte hain. Severity numbers monaco
// jaisi hi hain: 8=Error, 4=Warning, 2=Info, 1=Hint.)
import React, { useEffect, useState } from "react";
import { getService, IMarkerService } from "@codingame/monaco-vscode-api";

const toPlainMarker = (m) => {
  let path = "", fsPath = "";
  try {
    const r = m?.resource;
    if (typeof r === "string") { path = r; }
    else if (r) { path = r.path || ""; fsPath = r.fsPath || ""; }
  } catch {}
  let code = "";
  try { code = (m?.code && typeof m.code === "object") ? String(m.code.value ?? "") : String(m?.code ?? ""); } catch {}
  return {
    message: String(m?.message || ""),
    severity: Number(m?.severity || 0),
    source: m?.source ? String(m.source) : "",
    code,
    path,
    fsPath,
    startLineNumber: m?.startLineNumber || 1,
    startColumn: m?.startColumn || 1,
    endLineNumber: m?.endLineNumber || 1,
    endColumn: m?.endColumn || 1,
  };
};

const ProblemsPanel = () => {
  const [markers, setMarkers] = useState([]);
  const [filter, setFilter] = useState("all"); // all | error | warning
  const [svcError, setSvcError] = useState(null);

  useEffect(() => {
    let dead = false;
    let disp = null;
    let interval = null;

    const pollMarkers = async () => {
      try {
        // getService init ka wait khud karta hai — kabhi bhi call karo.
        const svc = await getService(IMarkerService);
        if (dead || !svc) return;
        let all = [];
        try { all = svc.read() || []; } catch (e) { if (!dead) setSvcError(e?.message || String(e)); return; }
        if (dead) return;
        setSvcError(null);
        // Deduplicate and sort by severity then file
        const seen = new Set();
        const sorted = [...all]
          .map(toPlainMarker)
          .filter((m) => {
            const k = `${m.path}:${m.startLineNumber}:${m.startColumn}:${m.message}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .sort((a, b) => {
            if (a.severity !== b.severity) return b.severity - a.severity;
            return (a.path || "").localeCompare(b.path || "");
          });
        setMarkers(sorted);
        // Subscribe once — aage markers badalne par event aayega
        if (!disp) {
          try { disp = svc.onMarkerChanged(() => { if (!document.hidden) pollMarkers(); }); } catch {}
        }
      } catch {}
    };

    pollMarkers();
    // Editor ready / TS worker late init ho tab dobara
    const onMonacoReady = () => { pollMarkers(); };
    window.addEventListener("monaco:ready", onMonacoReady);
    // Fallback poll — sirf visible tab me
    interval = setInterval(() => { if (!document.hidden) pollMarkers(); }, 5000);

    return () => {
      dead = true;
      if (interval) clearInterval(interval);
      window.removeEventListener("monaco:ready", onMonacoReady);
      try { disp?.dispose?.(); } catch {}
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
            <div style={{ fontSize: "var(--fs-small)", marginTop: "var(--space-8)", color: "var(--text-placeholder)" }}>Diagnostics from the editor (TS/JS) appear here</div>
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
                <span style={{ fontFamily: "var(--font-code)" }}>{(m.path || "unknown").split("/").pop()}:{m.startLineNumber}:{m.startColumn}</span>
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
