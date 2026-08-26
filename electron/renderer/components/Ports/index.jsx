// Ports Panel — Minimal
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useInputDialog } from "../shared/InputDialog.jsx";

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", color: "#cccccc", overflow: "hidden", fontFamily: "'Segoe UI',system-ui,sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0 },
  title: { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#bbb", display: "flex", alignItems: "center", gap: 8 },
  badge: { fontSize: 11, background: "#3a3a3a", color: "#fff", padding: "1px 6px", borderRadius: 10, fontWeight: 700, minWidth: 18, textAlign: "center" },
  btn: { background: "#0e639c", color: "#fff", border: "1px solid #0e639c", borderRadius: 4, padding: "5px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 },
  btnGhost: { background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#ccc", borderRadius: 4, padding: "5px 10px", fontSize: 11, cursor: "pointer" },
  iconBtn: { background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#bbb", cursor: "pointer", padding: "4px 8px", borderRadius: 4, fontSize: 12, lineHeight: 1 },
  input: { background: "#252526", border: "1px solid #3a3a3a", color: "#e0e0e0", borderRadius: 4, padding: "5px 8px 5px 26px", fontSize: 12, outline: "none", width: "100%" },
  th: { fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#888", padding: "6px 10px", borderBottom: "1px solid #2d2d2d", background: "#252526", display: "flex", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 12, borderBottom: "1px solid #232323" },
};

function stateColor(p) {
  if (p.forwarded || p.source === "forwarded" || p.state === "FORWARDED") return "#cca700";
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
  const { dialog, ask } = useInputDialog();
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
    fetchPorts(false);
    const iv = setInterval(() => { if (!document.hidden) fetchPorts(true); }, 2500);
    const onVis = () => { if (!document.hidden) fetchPorts(true); };
    document.addEventListener("visibilitychange", onVis);
    const onFocus = () => fetchPorts(true);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onFocus); };
  }, [fetchPorts]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ports;
    return ports.filter((p) =>
      String(p.port).includes(q) || (p.process || "").toLowerCase().includes(q)
    );
  }, [ports, filter]);

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

  const handleForward = useCallback(async () => {
    const portStr = await ask("Port number:", "");
    if (portStr === null) return;
    const port = parseInt(String(portStr).trim(), 10);
    if (!port || port < 1 || port > 65535) { showToast("Invalid port", true); return; }
    const label = await ask("Label (optional):", `Port ${port}`);
    const finalLabel = (label && label.trim()) ? label.trim() : `Port ${port}`;
    try {
      const r = await window.electronAPI.forwardPort(port, finalLabel);
      if (r?.ok) { showToast(`Forwarded :${port}`); fetchPorts(true); }
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

  return (
    <div style={s.wrap}>
      {dialog}
      <div style={s.header}>
        <div style={s.title}>Ports <span style={s.badge}>{filtered.length}</span></div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => fetchPorts(false)} title="Refresh" style={s.iconBtn}>↻</button>
          <button onClick={handleForward} style={s.btn}>+ Forward</button>
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
        <span style={{ flex: "0 0 130px", textAlign: "right" }}>Action</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && filtered.length === 0 && <div style={{ padding: 20, color: "#666", fontSize: 12, textAlign: "center" }}>Loading…</div>}
        {!loading && filtered.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: 30, color: "#666", fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: "#999", marginBottom: 6 }}>No ports</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
              <button onClick={handleForward} style={s.btn}>+ Forward</button>
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
              <span style={{ flex: "0 0 130px", display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button onClick={(e) => { e.stopPropagation(); openInBrowser(p.port); }} style={{ ...s.iconBtn, background: "#094771", color: "#fff", borderColor: "#0e639c" }}>↗</button>
                <button onClick={(e) => { e.stopPropagation(); copyUrl(p.port); }} style={s.iconBtn}>⧉</button>
                {p.forwarded || p.source === "forwarded" || p.state === "FORWARDED" ? (
                  <button onClick={(e) => { e.stopPropagation(); handleUnforward(p); }} style={{ ...s.iconBtn, color: "#cca700" }}>✕</button>
                ) : p.pid ? (
                  <button onClick={(e) => { e.stopPropagation(); handleKill(p); }} style={{ ...s.iconBtn, color: "#f44747" }}>■</button>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PortsPanel;
