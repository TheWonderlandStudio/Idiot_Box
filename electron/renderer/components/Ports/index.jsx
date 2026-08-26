// Ports Panel — VS Code-style PORTS manager
// Detects listening ports (netstat / lsof / ss), shows process, allows open in browser, kill, forward.
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useInputDialog } from "../shared/InputDialog.jsx";

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", color: "#cccccc", overflow: "hidden", fontFamily: "'Segoe UI',system-ui,sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0, gap: 8 },
  title: { fontSize: 12, fontWeight: 700, letterSpacing: 0.35, textTransform: "uppercase", color: "#bbbbbb", display: "flex", alignItems: "center", gap: 7 },
  badge: (active) => ({ fontSize: 11, background: active ? "#0e639c" : "#3a3a3a", color: "#fff", padding: "2px 7px", borderRadius: 10, fontWeight: 700, minWidth: 18, textAlign: "center" }),
  btn: { background: "#0e639c", color: "#fff", border: "1px solid #0e639c", borderRadius: 4, padding: "5px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 },
  btnGhost: { background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#cccccc", borderRadius: 4, padding: "5px 8px", fontSize: 11, cursor: "pointer", fontWeight: 600 },
  iconBtn: { background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#bbb", cursor: "pointer", padding: "4px 7px", borderRadius: 4, fontSize: 11, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", minWidth: 26, minHeight: 22 },
  input: { background: "#3c3c3c", border: "1px solid #3c3c3c", color: "#e0e0e0", borderRadius: 4, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "inherit" },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 12, borderBottom: "1px solid #232323", cursor: "default" },
  th: { fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#888", padding: "6px 10px", borderBottom: "1px solid #2d2d2d", background: "#252526", display: "flex", alignItems: "center", gap: 8 },
};

function stateColor(state, source) {
  if (source === "forwarded" || state === "FORWARDED") return "#cca700";
  if (state === "DETECTED") return "#569cd6";
  if (state === "LISTEN") return "#4ec9b0";
  return "#888";
}
function stateLabel(p) {
  if (p.forwarded) return "Forwarded";
  if (p.source === "forwarded" || p.state === "FORWARDED") return "Forwarded";
  if (p.state === "DETECTED") return "Detected";
  if (p.source === "liveServer") return "Live Server";
  if (p.source === "terminal") return "Terminal";
  return "Running";
}

const PortsPanel = () => {
  const [ports, setPorts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showProjectOnly, setShowProjectOnly] = useState(() => {
    try { return localStorage.getItem("ports:projectOnly") !== "false"; } catch { return true; }
  });
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(null); // port number
  const { dialog, ask } = useInputDialog();
  const prevPortsRef = useRef(new Set());
  const busyRef = useRef(false);

  const showToast = useCallback((text, isError = false) => { setToast({ text, isError }); setTimeout(() => setToast(null), 2800); }, []);

  const fetchPorts = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (!window.electronAPI?.getPorts) { setError("Port Manager not available — rebuild app"); if (!silent) setLoading(false); busyRef.current = false; return; }
      const list = await window.electronAPI.getPorts();
      const arr = Array.isArray(list) ? list : [];
      setPorts(arr);
      setError(null);
      // toast on new ports
      const curSet = new Set(arr.map((p) => String(p.port)));
      const prev = prevPortsRef.current;
      if (prev.size && curSet.size > prev.size) {
        const added = [...curSet].filter((x) => !prev.has(x));
        if (added.length) showToast(`+ Port ${added.join(", ")} detected`);
      }
      prevPortsRef.current = curSet;
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      busyRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    try { localStorage.setItem("ports:projectOnly", String(showProjectOnly)); } catch {}
  }, [showProjectOnly]);

  useEffect(() => {
    fetchPorts(false);
    // initial polling
    const iv = setInterval(() => {
      if (autoRefresh && !document.hidden) fetchPorts(true);
    }, 2500);
    const onVis = () => { if (!document.hidden && autoRefresh) fetchPorts(true); };
    document.addEventListener("visibilitychange", onVis);
    const onFocus = () => { if (autoRefresh) fetchPorts(true); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onFocus); };
  }, [fetchPorts, autoRefresh]);

  const isProjectPort = useCallback((p) => {
    if (p.forwarded || p.source === "forwarded" || p.source === "liveServer" || p.source === "terminal" || p.state === "FORWARDED" || p.state === "DETECTED") return true;
    const devRe = /(node|npm|yarn|pnpm|bun|deno|vite|next|nuxt|remix|svelte|astro|webpack|parcel|esbuild|turbo|ts-node|nodemon|python|python3|uvicorn|gunicorn|flask|django|java|mvn|gradle|spring|go|php|ruby|rails|cargo|rustc|dotnet|electron)/i;
    const name = (p.process || "").replace(/\.exe$/i, "");
    if (devRe.test(name)) return true;
    if (p.command && devRe.test(p.command)) return true;
    // project-path aware: if command line contains current project path / basename, treat as project
    try {
      const proj = window.__currentProjectPath;
      if (proj && p.command) {
        const lowCmd = p.command.toLowerCase();
        const lowProj = proj.toLowerCase().replace(/\\/g, "/");
        if (lowCmd.includes(lowProj) || lowCmd.includes(lowProj.replace(/\//g, "\\"))) return true;
        const base = proj.split(/[\\/]/).pop()?.toLowerCase();
        if (base && base.length >= 3 && lowCmd.includes(base)) {
          // extra guard: base must be not too generic (app, src, project) — require 4+ chars and devRe already matched? but we already returned if devRe, so this is for non-dev processes that still contain project name
          if (base.length >= 4 || devRe.test(p.command)) return true;
        }
      }
    } catch {}
    return false;
  }, []);

  const projectTotal = useMemo(() => ports.filter(isProjectPort).length, [ports, isProjectPort]);

  const filtered = useMemo(() => {
    let list = ports;
    if (showProjectOnly) list = list.filter(isProjectPort);
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      String(p.port).includes(q) ||
      (p.process || "").toLowerCase().includes(q) ||
      (p.address || "").toLowerCase().includes(q) ||
      (p.source || "").toLowerCase().includes(q) ||
      (p.command || "").toLowerCase().includes(q)
    );
  }, [ports, filter, showProjectOnly, isProjectPort]);

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
    if (!p.pid) { showToast("No PID — cannot kill forwarded/detected port", true); return; }
    const name = p.process || `PID ${p.pid}`;
    const ok = await window.electronAPI.confirmDialog(`Stop process on port ${p.port}?\n\n${name} (PID ${p.pid})\nThis will terminate the process.`);
    if (!ok) return;
    try {
      const r = await window.electronAPI.killPort(p.pid);
      if (r?.ok) { showToast(`✓ Stopped :${p.port} (PID ${p.pid})`); setTimeout(() => fetchPorts(true), 800); }
      else showToast(r?.error || "Kill failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
  }, [fetchPorts, showToast]);

  const handleForward = useCallback(async () => {
    const portStr = await ask("Forward port number:", "");
    if (portStr === null) return;
    const port = parseInt(String(portStr).trim(), 10);
    if (!port || port < 1 || port > 65535) { showToast("Invalid port (1–65535)", true); return; }
    const label = await ask("Label (optional):", `Port ${port}`);
    if (label === null && portStr !== null) {
      // user cancelled label — use default
    }
    const finalLabel = (label && label.trim()) ? label.trim() : `Port ${port}`;
    try {
      const r = await window.electronAPI.forwardPort(port, finalLabel);
      if (r?.ok) { showToast(`✓ Forwarded :${port}`); fetchPorts(true); }
      else showToast(r?.error || "Forward failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
  }, [ask, fetchPorts, showToast]);

  const handleUnforward = useCallback(async (p) => {
    try {
      const r = await window.electronAPI.unforwardPort(p.port);
      if (r?.ok) { showToast(`Removed :${p.port}`); fetchPorts(true); }
      else showToast(r?.error || "Remove failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
  }, [fetchPorts, showToast]);

  const handleCheck = useCallback(async (p) => {
    try {
      const r = await window.electronAPI.checkPort(p.port);
      if (r?.ok) showToast(r.open ? `✓ :${p.port} is open` : `○ :${p.port} not responding`);
      else showToast(r?.error || "Check failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
  }, [showToast]);

  return (
    <div style={s.wrap}>
      {dialog}
      {/* Header */}
      <div style={s.header}>
        <div style={s.title}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="#4ec9b0" strokeWidth="1.2" fill="none" />
            <circle cx="5.5" cy="6.5" r="1" fill="#4ec9b0" />
            <circle cx="8" cy="6.5" r="1" fill="#4ec9b0" />
            <circle cx="10.5" cy="6.5" r="1" fill="#4ec9b0" />
            <path d="M4 9.5H12" stroke="#4ec9b0" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
          </svg>
          Ports
          <span style={s.badge(filtered.length > 0)}>{filtered.length}</span>
          {autoRefresh && <span style={{ fontSize: 10, color: "#4ec9b0", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ec9b0", display: "inline-block", boxShadow: "0 0 6px #4ec9b0" }} /> live</span>}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button
            onClick={() => setShowProjectOnly((v) => !v)}
            title={showProjectOnly ? "Showing project ports only (dev servers, forwarded, live server) — click to show all system ports" : "Showing all system ports — click to show project only"}
            style={{ ...s.iconBtn, background: showProjectOnly ? "#094771" : "#2d2d2d", color: showProjectOnly ? "#fff" : "#bbb", borderColor: showProjectOnly ? "#0e639c" : "#3a3a3a", minWidth: 70 }}
          >
            {showProjectOnly ? "◉ Project" : "○ All"}
          </button>
          <button onClick={() => fetchPorts(false)} title="Refresh (polls OS for LISTEN ports)" style={s.iconBtn}>{loading ? "…" : "↻"}</button>
          <button onClick={() => setAutoRefresh((v) => !v)} title={autoRefresh ? "Auto-refresh ON (every 2.5s)" : "Auto-refresh OFF"} style={{ ...s.iconBtn, background: autoRefresh ? "#094771" : "#2d2d2d", color: autoRefresh ? "#fff" : "#bbb", borderColor: autoRefresh ? "#0e639c" : "#3a3a3a" }}>{autoRefresh ? "●" : "○"} Auto</button>
          <button onClick={handleForward} style={s.btn} title="Forward a port (show even if not listening)">+ Forward</button>
        </div>
      </div>

      {/* Filter */}
      <div style={{ padding: "6px 8px", borderBottom: "1px solid #232323", display: "flex", gap: 6, flexShrink: 0, background: "#1e1e1e", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", color: "#666", fontSize: 12 }}>⌕</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by port, process…" style={{ ...s.input, width: "100%", padding: "5px 8px 5px 24px", fontSize: 12, background: "#252526", border: "1px solid #3a3a3a" }} />
        </div>
        {filter && <button onClick={() => setFilter("")} style={s.btnGhost}>✕</button>}
        <span
          style={{ fontSize: 10, color: "#666", whiteSpace: "nowrap" }}
          title={showProjectOnly ? `Project ports: ${projectTotal} of ${ports.length} total (${ports.length - projectTotal} system ports hidden)` : `All ports: ${ports.length}`}
        >
          {showProjectOnly ? `${filtered.length}/${projectTotal} • ${ports.length} total` : `${filtered.length}/${ports.length}`}
        </span>
      </div>

      {error && (
        <div style={{ margin: "8px 8px 0", padding: "8px 10px", background: "#5a1d1d", border: "1px solid #7a2a2a", borderRadius: 4, color: "#ffb3b3", fontSize: 11, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ flex: 1, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>⚠ {error}</span>
          <button onClick={() => setError(null)} style={{ background: "transparent", border: "none", color: "#ffb3b3", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}
      {toast && <div style={{ margin: error ? "6px 8px 0" : "8px 8px 0", padding: "7px 10px", background: toast.isError ? "#5a1d1d" : "#1a3a2a", border: "1px solid " + (toast.isError ? "#7a2a2a" : "#2a5a3a"), borderRadius: 4, color: toast.isError ? "#ffb3b3" : "#4ec9b0", fontSize: 11 }}>{toast.text}</div>}

      {/* Table header */}
      <div style={s.th}>
        <span style={{ flex: "0 0 68px" }}>Port</span>
        <span style={{ flex: "0 0 110px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Address</span>
        <span style={{ flex: 1, minWidth: 90 }}>Process</span>
        <span style={{ flex: "0 0 52px", textAlign: "right" }}>PID</span>
        <span style={{ flex: "0 0 88px", textAlign: "center" }}>State</span>
        <span style={{ flex: "0 0 150px", textAlign: "right" }}>Actions</span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {loading && filtered.length === 0 && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {[1, 2, 3].map((i) => <div key={i} style={{ height: 14, background: "#252526", borderRadius: 4, opacity: 0.6 }} />)}
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: 28, color: "#666", fontSize: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: "#252526", border: "1px solid #2d2d2d", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", fontSize: 18 }}>◌</div>
            <div style={{ fontWeight: 700, color: "#999" }}>
              {ports.length === 0 ? "No forwarded ports" : showProjectOnly && projectTotal === 0 ? "No project ports" : filter.trim() ? "No matching ports" : "No ports"}
            </div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 6, maxWidth: 300, marginInline: "auto", lineHeight: 1.4 }}>
              {ports.length === 0
                ? "When you run a dev server (vite, next, react, python http.server, etc.), its port appears here. Click + Forward to add a port manually."
                : showProjectOnly && projectTotal === 0
                  ? `No dev servers for this project — ${ports.length} system port${ports.length === 1 ? "" : "s"} hidden. Switch to "All" to see everything.`
                  : filter.trim()
                    ? `No ports match “${filter}”.`
                    : "No project ports — run a dev server then refresh."}
            </div>
            {ports.length === 0 ? (
              <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={handleForward} style={s.btn}>+ Forward a Port</button>
                <button onClick={() => fetchPorts(false)} style={s.btnGhost}>↻ Refresh</button>
                <button onClick={() => window.electronAPI?.clearAutoDetectedPorts && window.electronAPI.clearAutoDetectedPorts().then(() => fetchPorts(true))} style={s.btnGhost} title="Clear terminal-detected ports">Clear Detected</button>
              </div>
            ) : showProjectOnly && projectTotal === 0 ? (
              <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={() => setShowProjectOnly(false)} style={s.btn}>Show All ({ports.length})</button>
                <button onClick={handleForward} style={s.btnGhost}>+ Forward a Port</button>
                <button onClick={() => fetchPorts(false)} style={s.btnGhost}>↻ Refresh</button>
              </div>
            ) : filter.trim() ? (
              <div style={{ marginTop: 14 }}>
                <button onClick={() => setFilter("")} style={s.btnGhost}>Clear filter</button>
              </div>
            ) : (
              <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={handleForward} style={s.btn}>+ Forward a Port</button>
                <button onClick={() => fetchPorts(false)} style={s.btnGhost}>↻ Refresh</button>
              </div>
            )}
            <div style={{ marginTop: 14, fontSize: 10, color: "#444", background: "#252526", padding: "6px 8px", borderRadius: 4, border: "1px solid #2d2d2d", display: "inline-block", fontFamily: "Consolas, monospace" }}>
              Tip: run <span style={{ color: "#4ec9b0" }}>npm run dev</span> / <span style={{ color: "#4ec9b0" }}>python -m http.server</span> then refresh
            </div>
          </div>
        )}
        {filtered.map((p) => {
          const isSel = selected === p.port;
          const col = stateColor(p.state, p.source);
          return (
            <div
              key={String(p.port) + ":" + String(p.pid || "") + ":" + (p.source || "")}
              onClick={() => setSelected(p.port)}
              onDoubleClick={() => openInBrowser(p.port)}
              title={`${p.url} — ${p.process}${p.pid ? " (PID " + p.pid + ")" : ""} — ${p.address} — ${stateLabel(p)} — double-click to open in Browser`}
              style={{
                ...s.row,
                background: isSel ? "#2a2d2e" : "transparent",
                cursor: "pointer",
                borderLeft: `3px solid ${isSel ? col : "transparent"}`,
                paddingLeft: isSel ? "7px" : "10px",
              }}
              onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "#2a2d2e"; }}
              onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ flex: "0 0 68px", fontFamily: "Consolas, monospace", fontWeight: 700, color: "#4ec9b0", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: p.state === "FORWARDED" ? "#cca700" : p.state === "DETECTED" ? "#569cd6" : "#4ec9b0", boxShadow: `0 0 5px ${col}`, flexShrink: 0, display: "inline-block" }} />
                :{p.port}
              </span>
              <span style={{ flex: "0 0 110px", fontSize: 11, color: "#999", fontFamily: "Consolas, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.address}>{p.address}</span>
              <span style={{ flex: 1, minWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }} title={p.process}>{p.process || "—"}</span>
              <span style={{ flex: "0 0 52px", textAlign: "right", fontFamily: "Consolas, monospace", fontSize: 11, color: p.pid ? "#bbb" : "#555" }}>{p.pid || "—"}</span>
              <span style={{ flex: "0 0 88px", textAlign: "center" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: col, background: "#111", border: `1px solid ${col}33`, padding: "2px 6px", borderRadius: 10, whiteSpace: "nowrap" }}>{stateLabel(p)}</span>
              </span>
              <span style={{ flex: "0 0 150px", display: "flex", gap: 4, justifyContent: "flex-end", flexShrink: 0 }}>
                <button onClick={(e) => { e.stopPropagation(); openInBrowser(p.port); }} title="Open in Browser (inside Idiot Box)" style={{ ...s.iconBtn, background: "#094771", color: "#fff", borderColor: "#0e639c" }}>↗ Browser</button>
                <button onClick={(e) => { e.stopPropagation(); copyUrl(p.port); }} title="Copy http://localhost:port" style={s.iconBtn}>⧉</button>
                {p.forwarded || p.source === "forwarded" || p.state === "FORWARDED" ? (
                  <button onClick={(e) => { e.stopPropagation(); handleUnforward(p); }} title="Remove forwarded port" style={{ ...s.iconBtn, color: "#cca700", borderColor: "#4a4a2a", background: "#2d2d1a" }}>✕</button>
                ) : p.pid ? (
                  <button onClick={(e) => { e.stopPropagation(); handleKill(p); }} title={`Stop process PID ${p.pid}`} style={{ ...s.iconBtn, color: "#f44747", borderColor: "#5a2a2a", background: "#2a1a1a" }}>■</button>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); handleCheck(p); }} title="Check if port responds" style={s.iconBtn}>◎</button>
                )}
              </span>
            </div>
          );
        })}
        {filtered.length > 0 && (
          <div style={{ padding: "8px 10px", fontSize: 10, color: "#555", borderTop: "1px solid #232323", background: "#1a1a1a", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span>Double-click a row to open in Browser</span>
            <span style={{ fontFamily: "Consolas, monospace" }}>{filtered.length} port{filtered.length !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PortsPanel;
