// Ports Panel — Minimal, current-project filter only (lucide icons)
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Search, RefreshCw, ExternalLink, Copy, Square, X } from "lucide-react";

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", color: "var(--text-bright)", overflow: "hidden", fontFamily: "var(--font-system)" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-6) var(--space-10)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0, gap: "var(--space-10)" },
  title: { fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-soft)", display: "flex", alignItems: "center", gap: "var(--space-8)" },
  badge: { fontSize: "var(--fs-small)", background: "var(--border-light)", color: "var(--text-inverse)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-pill)", fontWeight: "var(--fw-bold)", minWidth: 18, textAlign: "center" },
  btnGhost: { background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-bright)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small)", cursor: "pointer" },
  iconBtn: { background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-soft)", cursor: "pointer", padding: "var(--space-4) var(--space-8)", borderRadius: "var(--radius-md)", fontSize: "var(--fs-body)", lineHeight: "var(--lh-flat)" },
  input: { background: "var(--bg-vscode)", border: "1px solid var(--border-light)", color: "var(--text-input)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-8) var(--space-5) 26px", fontSize: "var(--fs-body)", outline: "none", width: "100%" },
  th: { fontSize: "var(--fs-tiny)", fontWeight: "var(--fw-bold)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--icon)", padding: "var(--space-6) var(--space-10)", borderBottom: "var(--space-1) solid var(--bg-active)", background: "var(--bg-vscode)", display: "flex", gap: "var(--space-8)" },
  row: { display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-6) var(--space-10)", fontSize: "var(--fs-body)", borderBottom: "var(--space-1) solid var(--border-row)" },
};

function stateColor(p) {
  if (p.state === "DETECTED") return "var(--code-blue)";
  return "var(--teal)";
}

const PortsPanel = () => {
  const [ports, setPorts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(null);
  const [showProjectOnly, setShowProjectOnly] = useState(() => {
    try { const v = localStorage.getItem("ports:projectOnly"); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const [projectPath, setProjectPath] = useState(() => {
    try { return window.__currentProjectPath || null; } catch { return null; }
  });
  const busyRef = useRef(false);

  const showToast = useCallback((text, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const fetchPorts = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (!window.electronAPI?.getPorts) { setError("Port Manager not available"); if (!silent) setLoading(false); busyRef.current = false; return; }
      const list = await window.electronAPI.getPorts();
      setPorts(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      busyRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    try { localStorage.setItem("ports:projectOnly", String(showProjectOnly)); } catch {}
  }, [showProjectOnly]);

  useEffect(() => {
    const onOpened = (e) => setProjectPath(e.detail?.path || window.__currentProjectPath || null);
    const onClosed = () => setProjectPath(null);
    window.addEventListener("project:opened", onOpened);
    window.addEventListener("project:closed", onClosed);
    const u1 = window.electronAPI?.onMenuEvent ? window.electronAPI.onMenuEvent("menu:openProject", (p) => setProjectPath(p)) : () => {};
    const u2 = window.electronAPI?.onMenuEvent ? window.electronAPI.onMenuEvent("menu:closeProject", () => setProjectPath(null)) : () => {};
    return () => {
      window.removeEventListener("project:opened", onOpened);
      window.removeEventListener("project:closed", onClosed);
      try { u1(); } catch {}
      try { u2(); } catch {}
    };
  }, []);

  useEffect(() => {
    fetchPorts(false);
    const iv = setInterval(() => { if (!document.hidden) fetchPorts(true); }, 2500);
    const onVis = () => { if (!document.hidden) fetchPorts(true); };
    document.addEventListener("visibilitychange", onVis);
    const onFocus = () => fetchPorts(true);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onFocus); };
  }, [fetchPorts]);

  const isProjectPort = useCallback((p) => {
    if (!showProjectOnly) return true;
    if (!projectPath) return true;
    // liveServer / terminal / forwarded — treat as project if toggle on? But forwarding removed, keep liveServer/terminal as project
    if (p.source === "liveServer" || p.source === "terminal") return true;
    const devRe = /(node|npm|yarn|pnpm|bun|deno|vite|next|nuxt|remix|svelte|astro|webpack|parcel|esbuild|turbo|ts-node|nodemon|python|python3|uvicorn|gunicorn|flask|django|java|mvn|gradle|spring|go|php|ruby|rails|cargo|rustc|dotnet|electron)/i;
    const name = (p.process || "").replace(/\.exe$/i, "");
    if (devRe.test(name)) return true;
    if (p.command && devRe.test(p.command)) return true;
    try {
      const proj = projectPath;
      if (proj && p.command) {
        const lowCmd = p.command.toLowerCase();
        const lowProj = proj.toLowerCase().replace(/\\/g, "/");
        if (lowCmd.includes(lowProj)) return true;
        const base = proj.split(/[\\/]/).pop()?.toLowerCase();
        if (base && base.length >= 4 && lowCmd.includes(base)) return true;
      }
    } catch {}
    // fallback: if we have a project but port didn't match dev pattern, hide it when toggle is on
    // This makes toggle meaningful: only project-related ports visible
    return false;
  }, [showProjectOnly, projectPath]);

  const filtered = useMemo(() => {
    let list = ports;
    if (showProjectOnly) list = list.filter(isProjectPort);
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => String(p.port).includes(q) || (p.process || "").toLowerCase().includes(q));
  }, [ports, filter, isProjectPort, showProjectOnly]);

  const openInBrowser = useCallback((port) => {
    const url = `http://localhost:${port}`;
    window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url, config: { type: "browser", title: `localhost:${port}`, url } } }));
  }, []);

  const copyUrl = useCallback(async (port) => {
    const url = `http://localhost:${port}`;
    try {
      if (window.electronAPI?.clipboardWrite) await window.electronAPI.clipboardWrite(url);
      else await navigator.clipboard.writeText(url);
      showToast(`Copied ${url}`);
    } catch { showToast("Copy failed", true); }
  }, [showToast]);

  const handleKill = useCallback(async (p) => {
    if (!p.pid) { showToast("No PID", true); return; }
    const ok = await window.electronAPI.confirmDialog(`Stop process on port ${p.port}?\n${p.process || ""} (PID ${p.pid})`);
    if (!ok) return;
    try {
      const r = await window.electronAPI.killPort(p.pid);
      if (r?.ok) { showToast(`Stopped :${p.port}`); setTimeout(() => fetchPorts(true), 700); }
      else showToast(r?.error || "Kill failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
  }, [fetchPorts, showToast]);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>Ports <span style={s.badge}>{filtered.length}</span></div>
        <div style={{ display: "flex", gap: "var(--space-8)", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", fontSize: "var(--fs-small)", color: "var(--text-soft)", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={showProjectOnly} onChange={(e) => setShowProjectOnly(e.target.checked)} style={{ accentColor: "var(--editor-blue)" }} />
            Current project only
          </label>
          <button onClick={() => fetchPorts(false)} title="Refresh" style={{ ...s.iconBtn, display: "flex", alignItems: "center", justifyContent: "center" }}><RefreshCw size={12} /></button>
        </div>
      </div>

      <div style={{ padding: "var(--space-6) var(--space-8)", borderBottom: "var(--space-1) solid var(--border-row)", display: "flex", gap: "var(--space-6)", background: "var(--bg-surface)" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" style={s.input} />
        </div>
        {filter && <button onClick={() => setFilter("")} style={{ ...s.btnGhost, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={12} /></button>}
      </div>

      {error && <div style={{ margin: "var(--space-8)", padding: "var(--space-8) var(--space-10)", background: "var(--error-bg-solid)", border: "var(--space-1) solid var(--error-border-3)", borderRadius: "var(--radius-md)", color: "var(--error-text-soft)", fontSize: "var(--fs-small)" }}>{error}</div>}
      {toast && <div style={{ margin: error ? "0 var(--space-8) var(--space-8)" : "var(--space-8)", padding: "var(--space-6) var(--space-10)", background: toast.isError ? "var(--error-bg-solid)" : "var(--success-bg)", border: "var(--space-1) solid " + (toast.isError ? "var(--error-border-3)" : "var(--success-border-2)"), borderRadius: "var(--radius-md)", color: toast.isError ? "var(--error-text-soft)" : "var(--teal)", fontSize: "var(--fs-small)" }}>{toast.text}</div>}

      <div style={s.th}>
        <span style={{ flex: "0 0 80px" }}>Port</span>
        <span style={{ flex: 1 }}>Process</span>
        <span style={{ flex: "0 0 110px", textAlign: "right" }}>Action</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && filtered.length === 0 && <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>Loading…</div>}
        {!loading && filtered.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
            <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-secondary)", marginBottom: "var(--space-6)" }}>{showProjectOnly && projectPath ? "No project ports" : "No ports"}</div>
            <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-small)" }}>{showProjectOnly && projectPath ? "No ports for current project" : "No ports detected"}</div>
            <div style={{ display: "flex", gap: "var(--space-8)", justifyContent: "center", marginTop: "var(--space-12)" }}>
              <button onClick={() => fetchPorts(false)} style={s.btnGhost}>Refresh</button>
            </div>
          </div>
        )}
        {filtered.map((p) => {
          const isSel = selected === p.port;
          const col = stateColor(p);
          return (
            <div
              key={String(p.port) + ":" + String(p.pid || "")}
              onClick={() => setSelected(p.port)}
              onDoubleClick={() => openInBrowser(p.port)}
              style={{ ...s.row, background: isSel ? "var(--bg-hover-strong)" : "transparent", cursor: "pointer", borderLeft: `3px solid ${isSel ? col : "transparent"}`, paddingLeft: isSel ? "7px" : "10px" }}
            >
              <span style={{ flex: "0 0 80px", fontFamily: "var(--font-code)", fontWeight: "var(--fw-bold)", color: "var(--teal)", display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
                <span style={{ width: 7, height: 7, borderRadius: "var(--radius-round)", background: col, flexShrink: 0 }} />:{p.port}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-bright)" }} title={p.process}>{p.process || "—"}</span>
              <span style={{ flex: "0 0 110px", display: "flex", gap: "var(--space-4)", justifyContent: "flex-end" }}>
                <button onClick={(e) => { e.stopPropagation(); openInBrowser(p.port); }} title="Open in Browser" style={{ ...s.iconBtn, background: "var(--select-blue)", color: "var(--text-inverse)", borderColor: "var(--editor-blue)", display: "flex", alignItems: "center", justifyContent: "center" }}><ExternalLink size={12} /></button>
                <button onClick={(e) => { e.stopPropagation(); copyUrl(p.port); }} title="Copy URL" style={{ ...s.iconBtn, display: "flex", alignItems: "center", justifyContent: "center" }}><Copy size={12} /></button>
                {p.pid ? <button onClick={(e) => { e.stopPropagation(); handleKill(p); }} title="Stop process" style={{ ...s.iconBtn, color: "var(--danger)", display: "flex", alignItems: "center", justifyContent: "center" }}><Square size={10} fill="currentColor" /></button> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PortsPanel;
