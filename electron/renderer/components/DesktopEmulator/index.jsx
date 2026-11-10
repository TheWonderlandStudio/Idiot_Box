// Desktop Emulator Panel — QEMU VMs rooted at <userData>/.appdata/qemu
// Mirrors the Android Emulator panel: list VMs, Create (arch/RAM/CPU/disk/ISO),
// Start/Stop QEMU VMs and render their live VNC display inside the app.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Play, Square, RefreshCw, Plus, Trash2, FolderOpen, ArrowLeft, Monitor, Download, Terminal, X, Info, Maximize2, Minimize2 } from "lucide-react";
import RFB from "@novnc/novnc/core/rfb.js";
import EmulatorDisclaimer from "../shared/EmulatorDisclaimer.jsx";

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", color: "var(--text-bright)", overflow: "hidden", fontFamily: "var(--font-system)" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-6) var(--space-10)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0, gap: "var(--space-10)" },
  title: { fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-soft)", display: "flex", alignItems: "center", gap: "var(--space-8)" },
  badge: { fontSize: "var(--fs-small)", background: "var(--border-light)", color: "var(--text-inverse)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-pill)", fontWeight: "var(--fw-bold)", minWidth: 18, textAlign: "center" },
  btn: { background: "var(--editor-blue)", border: "1px solid var(--editor-blue)", color: "var(--text-inverse)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small-plus)", cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--space-6)" },
  btnGhost: { background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-bright)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small-plus)", cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--space-6)" },
  iconBtn: { background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-soft)", cursor: "pointer", padding: "var(--space-4) var(--space-8)", borderRadius: "var(--radius-md)", fontSize: "var(--fs-body)", lineHeight: "var(--lh-flat)" },
  input: { background: "var(--bg-vscode)", border: "1px solid var(--border-light)", color: "var(--text-input)", borderRadius: "var(--radius-md)", padding: "var(--space-6) var(--space-8)", fontSize: "var(--fs-body)", outline: "none", width: "100%", boxSizing: "border-box" },
  select: { background: "var(--bg-vscode)", border: "1px solid var(--border-light)", color: "var(--text-input)", borderRadius: "var(--radius-md)", padding: "var(--space-6) var(--space-8)", fontSize: "var(--fs-body)", outline: "none", width: "100%", boxSizing: "border-box" },
  row: { display: "flex", alignItems: "center", gap: "var(--space-10)", padding: "var(--space-8) var(--space-10)", fontSize: "var(--fs-body)", borderBottom: "var(--space-1) solid var(--border-row)" },
  label: { fontSize: "var(--fs-small)", color: "var(--text-secondary)", marginBottom: "var(--space-4)", display: "block" },
  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },
};

const fmtBytes = (n) => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
};

const DesktopEmulatorPanel = () => {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [log, setLog] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showIsoList, setShowIsoList] = useState(false);
  const [form, setForm] = useState({ name: "linux-x64", arch: "x86_64", memoryMb: 2048, cpus: 2, diskGb: 20, iso: "" });
  const [view, setView] = useState(null); // { name }
  const [displayStatus, setDisplayStatus] = useState({ state: "connecting", error: null });
  const [qemuLog, setQemuLog] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenUiVisible, setFullscreenUiVisible] = useState(true);
  const [keyText, setKeyText] = useState("");
  const busyRef = useRef(false);
  const screenRef = useRef(null);
  const viewerRef = useRef(null);
  const fullscreenUiTimerRef = useRef(null);

  const showToast = useCallback((text, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const pushLog = useCallback((line) => {
    setLog((prev) => (prev.length && prev[prev.length - 1] === line ? prev : [...prev.slice(-200), line]));
  }, []);

  const fetchState = useCallback(async (silent) => {
    if (!window.electronAPI?.qemuGetState) {
      if (!silent) { setError("Desktop emulator bridge not available — rebuild the app (npm run build)."); setLoading(false); }
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (!silent) setLoading(true);
      const st = await window.electronAPI.qemuGetState();
      if (st?.ok === false) { if (!silent) setError(st.error || "Failed to load QEMU state"); }
      else {
        setState(st);
        if (!silent) setError(null);
      }
    } catch (e) {
      if (!silent) setError(e?.message || String(e));
    } finally {
      busyRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState(false);
    const iv = setInterval(() => { if (!document.hidden && !showCreate) fetchState(true); }, 5000);
    const onVis = () => { if (!document.hidden) fetchState(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [fetchState, showCreate]);

  useEffect(() => {
    if (!window.electronAPI?.onQemuProgress) return;
    const unsub = window.electronAPI.onQemuProgress((p) => {
      const line = `[${p.op}${p.vm ? `:${p.vm}` : ""}] ${p.message}`;
      pushLog(line);
      if (p.phase === "error") showToast(p.message, true);
      fetchState(true);
    });
    return unsub;
  }, [pushLog, showToast, fetchState]);

  useEffect(() => {
    if (!view || !screenRef.current) return;
    let active = true;
    if (!view.websocketPort) {
      setDisplayStatus({ state: "disconnected", error: "No in-app display stream is available. Stop and restart this VM." });
      return () => { active = false; };
    }
    setDisplayStatus({ state: "connecting", error: null });
    const rfb = new RFB(screenRef.current, `ws://127.0.0.1:${view.websocketPort}`);
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
    rfb.focusOnClick = true;
    const onConnect = () => {
      if (active) setDisplayStatus({ state: "connected", error: null });
    };
    const onDisconnect = (event) => {
      if (!active) return;
      setDisplayStatus({
        state: "disconnected",
        error: event.detail?.clean ? "The display stream disconnected." : "Could not connect to the VM display.",
      });
    };
    const onSecurityFailure = (event) => {
      if (active) setDisplayStatus({ state: "disconnected", error: event.detail?.reason || "VNC security negotiation failed." });
    };
    rfb.addEventListener("connect", onConnect);
    rfb.addEventListener("disconnect", onDisconnect);
    rfb.addEventListener("securityfailure", onSecurityFailure);
    return () => {
      active = false;
      rfb.removeEventListener("connect", onConnect);
      rfb.removeEventListener("disconnect", onDisconnect);
      rfb.removeEventListener("securityfailure", onSecurityFailure);
      rfb.disconnect();
      screenRef.current?.replaceChildren();
    };
  }, [view]);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    if (!isFullscreen) {
      clearTimeout(fullscreenUiTimerRef.current);
      setFullscreenUiVisible(true);
      return undefined;
    }
    setFullscreenUiVisible(true);
    fullscreenUiTimerRef.current = setTimeout(() => setFullscreenUiVisible(false), 2200);
    return () => clearTimeout(fullscreenUiTimerRef.current);
  }, [isFullscreen]);

  useEffect(() => () => clearTimeout(fullscreenUiTimerRef.current), []);

  const revealFullscreenUi = () => {
    if (!isFullscreen) return;
    if (!fullscreenUiVisible) setFullscreenUiVisible(true);
    clearTimeout(fullscreenUiTimerRef.current);
    fullscreenUiTimerRef.current = setTimeout(() => setFullscreenUiVisible(false), 2200);
  };

  const sendKey = async (keys) => {
    if (!view) return;
    const r = await window.electronAPI?.qemuInput?.(view.name, { type: "key", keys });
    if (r?.ok === false) showToast(r.error || "Key failed", true);
  };
  const sendText = async () => {
    if (!view || !keyText) return;
    const r = await window.electronAPI?.qemuInput?.(view.name, { type: "text", text: keyText });
    if (r?.ok === false) showToast(r.error || "Type failed", true);
    else setKeyText("");
  };
  const toggleFullscreen = async () => {
    try {
      setFullscreenUiVisible(true);
      if (document.fullscreenElement === viewerRef.current) await document.exitFullscreen();
      else await viewerRef.current?.requestFullscreen();
    } catch (e) {
      showToast(e?.message || "Could not toggle emulator fullscreen.", true);
    }
  };

  const openLog = async (name = view?.name || state?.vms?.find((vm) => vm.running)?.name || state?.vms?.[0]?.name) => {
    if (!name) {
      showToast("Create or select a VM before opening its log.", true);
      return;
    }
    try {
      const result = await window.electronAPI?.qemuGetLog?.(name);
      if (result?.ok === false) throw new Error(result.error || "Failed to read QEMU log.");
      setQemuLog({ name, text: result?.text || "", truncated: !!result?.truncated });
    } catch (e) {
      showToast(e?.message || String(e), true);
    }
  };

  const doStart = async (name) => {
    setBusy(name);
    pushLog(`[start] ${name}…`);
    try {
      const r = await window.electronAPI.qemuStartVm(name);
      if (r?.ok) {
        setView({ name, websocketPort: r.websocketPort });
        setError(null);
        pushLog(`[start] ${name} booting (pid ${r.pid})`);
      }
      else {
        const message = r?.error || "Start failed";
        showToast(message, true);
        pushLog(`[start:error] ${message}`);
        setError(`${name}: ${message}`);
        openLog(name);
      }
    } catch (e) {
      const message = e?.message || String(e);
      showToast(message, true);
      pushLog(`[start:error] ${message}`);
      setError(`${name}: ${message}`);
      openLog(name);
    }
    setBusy(null); fetchState(true);
  };
  const doStop = async (name) => {
    setBusy(name);
    try {
      const r = await window.electronAPI.qemuStopVm(name);
      if (r?.ok) { if (view?.name === name) setView(null); pushLog(`[stop] ${name} stopped`); }
      else showToast(r?.error || "Stop failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
    setBusy(null); fetchState(true);
  };
  const doDelete = async (name) => {
    const ok = await window.electronAPI?.confirmDialog?.(`Delete VM "${name}" and its disk?`);
    if (ok === false) return;
    setBusy(name);
    try {
      const r = await window.electronAPI.qemuDeleteVm(name);
      if (r?.ok) { if (view?.name === name) setView(null); pushLog(`[delete] ${name} deleted`); }
      else showToast(r?.error || "Delete failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
    setBusy(null); fetchState(true);
  };
  const doCreate = async () => {
    setBusy("create");
    pushLog(`[create] ${form.name} (${form.arch}, ${form.memoryMb} MB, ${form.cpus} CPU, ${form.diskGb} GB)…`);
    try {
      const r = await window.electronAPI.qemuCreateVm({ ...form, iso: form.iso || null });
      if (r?.ok) { setShowCreate(false); pushLog(`[create] ${form.name} created`); showToast(`VM "${form.name}" created`); }
      else { showToast(r?.error || "Create failed", true); pushLog(`[create:error] ${r?.error}`); }
    } catch (e) { showToast(e?.message || String(e), true); }
    setBusy(null); fetchState(true);
  };
  const pickIso = async () => {
    const p = await window.electronAPI?.qemuPickIso?.();
    if (p) setForm((f) => ({ ...f, iso: p }));
  };
  // Official ISO links open in the system browser (http/https allowlisted).
  const openLink = (url) => {
    if (!url) return;
    window.electronAPI?.openExternal?.(url);
    pushLog(`[iso] opened ${url}`);
  };
  const setCustomBin = async () => {
    const r = await window.electronAPI?.qemuSetCustomBinDir?.();
    if (r?.ok) { pushLog(`[qemu] custom QEMU folder: ${r.qemuBinDir}`); fetchState(true); }
  };
  const [downloading, setDownloading] = useState(false);
  const doDownload = async () => {
    setDownloading(true);
    pushLog("[download] fetching the official QEMU installer…");
    try {
      const r = await window.electronAPI?.qemuDownload?.();
      if (r?.ok) {
        if (r.kind === "installer") pushLog(`[download] installer launched: ${r.installer} — finish it, then Refresh.`);
        else pushLog(`[download] opened the download page — install with: ${r.command}`);
      } else {
        showToast(r?.error || "Download failed", true);
        pushLog(`[download:error] ${r?.error}`);
      }
    } catch (e) { showToast(e?.message || String(e), true); }
    setDownloading(false);
    fetchState(true);
  };
  const qemu = state?.qemu || {};
  const vms = state?.vms || [];

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>
          <Monitor size={14} /> Desktop Emulator
          <span style={s.badge}>{vms.length}</span>
          <span style={{ ...s.badge, background: qemu.found ? "var(--success)" : "var(--danger)" }}>
            {qemu.found ? `QEMU ${qemu.version || "found"}` : "QEMU missing"}
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-6)" }}>
          <button style={s.iconBtn} title="Disclaimer" onClick={() => window.dispatchEvent(new CustomEvent("show-emulator-disclaimer", { detail: { key: "idiotbox.disclaimer.desktop" } }))}><Info size={14} /></button>
          <button style={s.iconBtn} title="Open QEMU log" onClick={() => openLog()}><Terminal size={14} /></button>
          <button style={s.iconBtn} title="Reveal .appdata/qemu folder" onClick={() => window.electronAPI?.qemuRevealFolder?.()}><FolderOpen size={14} /></button>
          <button style={s.iconBtn} title="Refresh" onClick={() => fetchState(false)}><RefreshCw size={14} /></button>
        </div>
      </div>

      {toast && (
        <div style={{ padding: "var(--space-6) var(--space-10)", background: toast.isError ? "var(--danger-bg, #3a1d1d)" : "var(--success-bg, #1d3a24)", fontSize: "var(--fs-small-plus)" }}>
          {toast.text}
        </div>
      )}
      {error && <div style={{ padding: "var(--space-6) var(--space-10)", background: "var(--danger-bg, #3a1d1d)", color: "var(--danger)", fontSize: "var(--fs-small-plus)" }}>{error}</div>}

      {view ? (
        <div
          ref={viewerRef}
          onMouseMove={revealFullscreenUi}
          style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, background: "#000", ...(isFullscreen ? { position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 9999, overflow: "hidden" } : {}) }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-6) var(--space-10)", ...(isFullscreen ? { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, background: "linear-gradient(#000b, transparent)", opacity: fullscreenUiVisible ? 1 : 0, transform: fullscreenUiVisible ? "translateY(0)" : "translateY(-100%)", transition: "opacity 180ms ease, transform 180ms ease", pointerEvents: fullscreenUiVisible ? "auto" : "none" } : {}) }}>
            <button style={s.iconBtn} title="Back to VM list" onClick={() => setView(null)}><ArrowLeft size={14} /></button>
            <strong style={{ fontSize: "var(--fs-body)" }}>{view.name}</strong>
            <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-6)" }}>
              <button style={s.iconBtn} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
              <button style={s.btnGhost} onClick={() => doStop(view.name)}><Square size={13} /> Stop</button>
            </div>
          </div>
          <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: "#000", ...(isFullscreen ? { position: "absolute", inset: 0 } : {}) }}>
            <div ref={screenRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />
            {displayStatus.state !== "connected" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-10)", padding: "var(--space-20)", background: "rgba(0, 0, 0, 0.88)", textAlign: "center" }}>
                <Monitor size={28} />
                <strong>{displayStatus.state === "connecting" ? "Connecting to VM display…" : "VM display disconnected"}</strong>
                {displayStatus.error && <span style={{ maxWidth: 520, color: "var(--text-secondary)", fontSize: "var(--fs-small-plus)" }}>{displayStatus.error}</span>}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "var(--space-6)", padding: "var(--space-6) var(--space-10)", flexWrap: "wrap", alignItems: "center", ...(isFullscreen ? { position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 2, background: "linear-gradient(transparent, #000b)", opacity: fullscreenUiVisible ? 1 : 0, transform: fullscreenUiVisible ? "translateY(0)" : "translateY(100%)", transition: "opacity 180ms ease, transform 180ms ease", pointerEvents: fullscreenUiVisible ? "auto" : "none" } : {}) }}>
            <input style={{ ...s.input, flex: "1 1 160px" }} placeholder="Type text + Enter to send…" value={keyText}
              onChange={(e) => setKeyText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendText(); }} />
            <button style={s.btn} onClick={sendText}>Type</button>
            {["enter", "esc", "tab", "backspace", "f1", "f12", "ctrl-alt-f1", "ctrl-alt-delete"].map((k) => (
              <button key={k} style={s.btnGhost} onClick={() => sendKey(k)}>{k}</button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {loading && <div style={{ padding: 16, color: "var(--text-secondary)" }}>Loading QEMU state…</div>}
          {!loading && !qemu.found && (
            <div style={{ margin: "var(--space-10)", padding: "var(--space-10)", border: "1px solid var(--danger)", borderRadius: "var(--radius-md)" }}>
              <strong>QEMU is not installed or not found.</strong>
              <div style={{ marginTop: 8, fontSize: "var(--fs-small-plus)", lineHeight: 1.6, color: "var(--text-secondary)" }}>
                <div>Windows: <code>{state?.installHelp?.windows}</code></div>
                <div>macOS: <code>{state?.installHelp?.macos}</code></div>
                <div>Linux: <code>{state?.installHelp?.linux}</code></div>
                <div style={{ marginTop: 6 }}>Already installed? Point the panel at its folder (the one containing <code>qemu-system-x86_64</code>).</div>
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: "var(--space-8)", flexWrap: "wrap" }}>
                <button style={s.btn} disabled={downloading} onClick={doDownload}>
                  <Download size={13} /> {downloading ? "Downloading…" : "Download QEMU"}
                </button>
                <button style={s.btnGhost} onClick={setCustomBin}>Custom QEMU folder…</button>
              </div>
              <div style={{ marginTop: 6, fontSize: "var(--fs-small)", color: "var(--text-secondary)" }}>
                Download QEMU fetches the official installer (not bundled) and runs it in its own window — you can cancel or pick the install location.
              </div>
            </div>
          )}

          {qemu.found && (
            <div style={{ padding: "var(--space-6) var(--space-10)", display: "flex", gap: "var(--space-8)", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: "var(--fs-small)", color: "var(--text-secondary)" }}>
                {qemu.bin} · qemu-img: {qemu.qemuImg ? "found" : "not found (raw disks)"}
                {state?.customBinDir ? ` · custom dir: ${state.customBinDir}` : ""}
              </span>
              <button style={s.btnGhost} onClick={setCustomBin}>Custom QEMU folder…</button>
              <button style={{ ...s.btn, marginLeft: "auto" }} disabled={!qemu.found} onClick={() => setShowCreate((v) => !v)}>
                <Plus size={13} /> New VM
              </button>
            </div>
          )}

          {showCreate && (
            <div style={{ margin: "0 var(--space-10) var(--space-10)", padding: "var(--space-10)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-md)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-8)" }}>
              <div>
                <label style={s.label}>Name</label>
                <input style={s.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label style={s.label}>Architecture</label>
                <select style={s.select} value={form.arch} onChange={(e) => setForm({ ...form, arch: e.target.value })}>
                  {(state?.arches || []).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>RAM</label>
                <select style={s.select} value={form.memoryMb} onChange={(e) => setForm({ ...form, memoryMb: parseInt(e.target.value, 10) })}>
                  {[512, 1024, 2048, 4096, 8192, 16384].map((m) => <option key={m} value={m}>{m >= 1024 ? `${m / 1024} GB` : `${m} MB`}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>CPUs</label>
                <select style={s.select} value={form.cpus} onChange={(e) => setForm({ ...form, cpus: parseInt(e.target.value, 10) })}>
                  {[1, 2, 4, 8, 16].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={s.label}>Disk size (GB)</label>
                <input style={s.input} type="number" min="1" max="512" value={form.diskGb} onChange={(e) => setForm({ ...form, diskGb: parseInt(e.target.value, 10) || 1 })} />
              </div>
              <div>
                <label style={s.label}>Boot ISO (optional)</label>
                <div style={{ display: "flex", gap: "var(--space-6)" }}>
                  <input style={s.input} placeholder="No ISO — installs later" value={form.iso} onChange={(e) => setForm({ ...form, iso: e.target.value })} />
                  <button style={s.btnGhost} onClick={pickIso}>Browse…</button>
                  <button style={s.btnGhost} title="Official ISO download links" onClick={() => setShowIsoList((v) => !v)}>
                    <Download size={13} /> ISOs
                  </button>
                </div>
              </div>

              {showIsoList && (
                <div style={{ gridColumn: "1 / -1", border: "1px solid var(--border-light)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                  <div style={{ padding: "var(--space-6) var(--space-10)", fontSize: "var(--fs-small)", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between", gap: "var(--space-8)" }}>
                    <span>Official ISO download pages — opens in your browser, nothing is downloaded by the app.</span>
                    <button style={s.iconBtn} title="Close" onClick={() => setShowIsoList(false)}><X size={12} /></button>
                  </div>
                  <div style={{ maxHeight: 240, overflowY: "auto" }}>
                    {(state?.isoCatalog || []).map((e) => (
                      <div key={e.id} style={{ ...s.row, borderBottom: "1px solid var(--border-row)" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{e.name}</div>
                          <div style={{ fontSize: "var(--fs-small)", color: "var(--text-secondary)" }}>
                            {e.arch} · {e.note}
                          </div>
                        </div>
                        {e.iso && (
                          <button style={s.btn} onClick={() => openLink(e.iso)} title={e.iso}>
                            <Download size={13} /> ISO
                          </button>
                        )}
                        <button style={s.btnGhost} onClick={() => openLink(e.page)} title={e.page}>Page</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: "var(--space-6) var(--space-10)", fontSize: "var(--fs-small)", color: "var(--text-secondary)" }}>
                    After downloading, click Browse… and pick the .iso from your Downloads folder.
                  </div>
                </div>
              )}

              <div style={{ gridColumn: "1 / -1", display: "flex", gap: "var(--space-8)" }}>
                <button style={s.btn} disabled={busy === "create"} onClick={doCreate}>{busy === "create" ? "Creating…" : "Create VM"}</button>
                <button style={s.btnGhost} onClick={() => setShowCreate(false)}><X size={13} /> Cancel</button>
              </div>
            </div>
          )}

          {vms.length === 0 && !loading && (
            <div style={{ padding: 24, color: "var(--text-secondary)", fontSize: "var(--fs-body)" }}>
              No VMs yet. {!qemu.found ? "Install QEMU first (above), then create a VM and boot any ISO." : "Click “New VM”, pick an ISO (e.g. Linux or Windows), and Start it — the guest screen appears right here."}
            </div>
          )}

          {vms.map((vm) => (
            <div key={vm.name} style={s.row}>
              <span style={{ ...s.dot, background: vm.running ? "var(--success)" : "var(--text-secondary)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{vm.name}</div>
                <div style={{ fontSize: "var(--fs-small)", color: "var(--text-secondary)" }}>
                  {vm.arch} · {vm.memoryMb >= 1024 ? `${vm.memoryMb / 1024} GB` : `${vm.memoryMb} MB`} RAM · {vm.cpus} CPU · disk {fmtBytes(vm.diskBytes)}
                  {vm.iso ? ` · ISO: ${String(vm.iso).split(/[\\/]/).pop()}` : ""}
                  {vm.recoveryError ? ` · Recovery: ${vm.recoveryError}` : ""}
                </div>
              </div>
              {vm.running ? (
                <>
                  <button style={s.btn} onClick={() => setView({ name: vm.name, websocketPort: vm.websocketPort })}><Monitor size={13} /> View</button>
                  <button style={s.btnGhost} disabled={busy === vm.name} onClick={() => doStop(vm.name)}><Square size={13} /> Stop</button>
                </>
              ) : (
                <button style={s.btn} disabled={busy === vm.name || !qemu.found} onClick={() => doStart(vm.name)}><Play size={13} /> Start</button>
              )}
              <button style={s.iconBtn} title={`Open ${vm.name} QEMU log`} onClick={() => openLog(vm.name)}><Terminal size={13} /></button>
              <button style={s.iconBtn} title="Delete VM" disabled={busy === vm.name} onClick={() => doDelete(vm.name)}><Trash2 size={13} /></button>
            </div>
          ))}

          {log.length > 0 && (
            <div style={{ margin: "var(--space-10)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
              <div style={{ padding: "var(--space-6) var(--space-10)", fontSize: "var(--fs-small)", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}>
                <span>Log</span>
                <span>
                  <button style={s.iconBtn} title="Open QEMU log" onClick={() => openLog()}><Terminal size={12} /></button>{" "}
                  <button style={s.iconBtn} title="Clear log" onClick={() => setLog([])}><X size={12} /></button>
                </span>
              </div>
              <div style={{ maxHeight: 180, overflowY: "auto", padding: "var(--space-6) var(--space-10)", fontFamily: "var(--font-mono, monospace)", fontSize: "var(--fs-small)", whiteSpace: "pre-wrap", color: "var(--text-secondary)" }}>
                {log.join("\n")}
              </div>
            </div>
          )}
        </div>
      )}

      {qemuLog && (
        <section style={{ flex: "0 0 auto", maxHeight: 240, margin: "var(--space-8) var(--space-10)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-6) var(--space-10)", borderBottom: "1px solid var(--border-row)" }}>
            <strong style={{ fontSize: "var(--fs-small-plus)" }}>QEMU log · {qemuLog.name}</strong>
            <div style={{ display: "flex", gap: "var(--space-6)" }}>
              <button style={s.iconBtn} title="Refresh log" onClick={() => openLog(qemuLog.name)}><RefreshCw size={12} /></button>
              <button style={s.iconBtn} title="Close log" onClick={() => setQemuLog(null)}><X size={12} /></button>
            </div>
          </div>
          <pre style={{ maxHeight: 190, overflow: "auto", margin: 0, padding: "var(--space-8) var(--space-10)", fontFamily: "var(--font-mono, monospace)", fontSize: "var(--fs-small)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--text-secondary)" }}>
            {qemuLog.truncated ? "[Earlier output omitted]\n" : ""}
            {qemuLog.text || "No QEMU output has been recorded for this VM yet."}
          </pre>
        </section>
      )}

      <EmulatorDisclaimer
        storageKey="idiotbox.disclaimer.desktop"
        title="Desktop Emulator — Disclaimer"
        summary="Unofficial panel — not affiliated with, endorsed by or sponsored by the QEMU project. QEMU is third-party free software (GPL-2.0) that you install and license separately."
        items={[
          "This app does not bundle, download or redistribute QEMU or any operating-system image. \"Download QEMU\" only fetches the official installer (or opens the official page) and hands control to it — the installer runs separately under its own licence.",
          "ISO buttons open the vendor's official download page or file in your system browser. Nothing is downloaded, cached or redistributed by Idiot Box.",
          "Each guest operating system remains under its own licence and terms. Windows requires a valid Microsoft licence; Linux and BSD images carry their distribution's terms. You are responsible for complying with them.",
          "Virtual machines and disks are stored locally as ordinary files under .appdata/qemu. Deleting a VM deletes its disk, so back up anything you need first.",
          "Hardware virtualisation (WHPX, Hypervisor.framework or KVM) is used when available. Performance and device support depend on your host, firmware settings and the QEMU build you installed.",
          "Running untrusted or unlicensed images is at your own risk. This panel is provided \"as is\", without warranty of any kind. Idiot Box itself is free software under GPL-3.0.",
        ]}
        note="QEMU is a trademark of its respective owners. This panel is not a QEMU project product."
      />
    </div>
  );
};

export default DesktopEmulatorPanel;
