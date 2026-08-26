// Ports Panel — Minimal, current-project filter only
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", color: "#cccccc", overflow: "hidden", fontFamily: "'Segoe UI',system-ui,sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0, gap: 10 },
  title: { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#bbb", display: "flex", alignItems: "center", gap: 8 },
  badge: { fontSize: 11, background: "#3a3a3a", color: "#fff", padding: "1px 6px", borderRadius: 10, fontWeight: 700, minWidth: 18, textAlign: "center" },
  btnGhost: { background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#ccc", borderRadius: 4, padding: "5px 10px", fontSize: 11, cursor: "pointer" },
  iconBtn: { background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#bbb", cursor: "pointer", padding: "4px 8px", borderRadius: 4, fontSize: 12, lineHeight: 1 },
  input: { background: "#252526", border: "1px solid #3a3a3a", color: "#e0e0e0", borderRadius: 4, padding: "5px 8px 5px 26px", fontSize: 12, outline: "none", width: "100%" },
  th: { fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#888", padding: "6px 10px", borderBottom: "1px solid #2d2d2d", background: "#252526", display: "flex", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 12, borderBottom: "1px solid #232323" },
};

function stateColor(p) {
  if (p.state === "DETECTED") return "#569cd6";
  return "#4ec9b0";
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
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#bbb", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={showProjectOnly} onChange={(e) => setShowProjectOnly(e.target.checked)} style={{ accentColor: "#0e639c" }} />
            Current project only
          </label>
          <button onClick={() => fetchPorts(false)} title="Refresh" style={s.iconBtn}>↻</button>
        </div>
      </div>

      <div style={{ padding: "6px 8px", borderBottom: "1px solid #232323", display: "flex", gap: 6, background: "#1e1e1e" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#666" }}>⌕</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" style={s.input} />
        </div>
        {filter && <button onClick={() => setFilter("")} style={s.btnGhost}>✕</button>}
      </div>

      {error && <div style={{ margin: "8px", padding: "8px 10px", background: "#5a1d1d", border: "1px solid #7a2a2a", borderRadius: 4, color: "#ffb3b3", fontSize: 11 }}>{error}</div>}
      {toast && <div style={{ margin: error ? "0 8px 8px" : "8px", padding: "6px 10px", background: toast.isError ? "#5a1d1d" : "#1a3a2a", border: "1px solid " + (toast.isError ? "#7a2a2a" : "#2a5a3a"), borderRadius: 4, color: toast.isError ? "#ffb3b3" : "#4ec9b0", fontSize: 11 }}>{toast.text}</div>}

      <div style={s.th}>
        <span style={{ flex: "0 0 80px" }}>Port</span>
        <span style={{ flex: 1 }}>Process</span>
        <span style={{ flex: "0 0 110px", textAlign: "right" }}>Action</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && filtered.length === 0 && <div style={{ padding: 20, color: "#666", fontSize: 12, textAlign: "center" }}>Loading…</div>}
        {!loading && filtered.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: 30, color: "#666", fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: "#999", marginBottom: 6 }}>{showProjectOnly && projectPath ? "No project ports" : "No ports"}</div>
            <div style={{ color: "#555", fontSize: 11 }}>{showProjectOnly && projectPath ? "No ports for current project" : "No ports detected"}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
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
              style={{ ...s.row, background: isSel ? "#2a2d2e" : "transparent", cursor: "pointer", borderLeft: `3px solid ${isSel ? col : "transparent"}`, paddingLeft: isSel ? "7px" : "10px" }}
            >
              <span style={{ flex: "0 0 80px", fontFamily: "Consolas, monospace", fontWeight: 700, color: "#4ec9b0", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: col, flexShrink: 0 }} />:{p.port}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={p.process}>{p.process || "—"}</span>
              <span style={{ flex: "0 0 110px", display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button onClick={(e) => { e.stopPropagation(); openInBrowser(p.port); }} style={{ ...s.iconBtn, background: "#094771", color: "#fff", borderColor: "#0e639c" }}>↗</button>
                <button onClick={(e) => { e.stopPropagation(); copyUrl(p.port); }} style={s.iconBtn}>⧉</button>
                {p.pid ? <button onClick={(e) => { e.stopPropagation(); handleKill(p); }} style={{ ...s.iconBtn, color: "#f44747" }}>■</button> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PortsPanel;
