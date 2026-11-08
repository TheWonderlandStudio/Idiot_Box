// Desktop Emulator Panel — QEMU VMs rooted at <userData>/.appdata/qemu
// Mirrors the Android Emulator panel: list VMs, Create (arch/RAM/CPU/disk/ISO),
// Start/Stop headless, and a live guest screen streamed into the panel via
// HMP `screendump` (PPM frames drawn on a canvas). Click = guest mouse click,
// the key box sends QEMU `sendkey` chords.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Play, Square, RefreshCw, Plus, Trash2, FolderOpen, ArrowLeft, Monitor, Download, Terminal, X } from "lucide-react";

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
  const [form, setForm] = useState({ name: "linux-x64", arch: "x86_64", memoryMb: 2048, cpus: 2, diskGb: 20, iso: "" });
  const [view, setView] = useState(null); // { name }
  const [keyText, setKeyText] = useState("");
  const busyRef = useRef(false);
  const canvasRef = useRef(null);
  const screenBoxRef = useRef(null);
  const frameSizeRef = useRef(null); // { w, h } guest px of latest frame
  const moveAtRef = useRef(0);

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
      else { setState(st); setError(null); }
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

  // ── Frame polling while the viewer is open ──────────────────────────────
  useEffect(() => {
    if (!view) return;
    let alive = true;
    const draw = async () => {
      if (!alive || document.hidden) return;
      try {
        const r = await window.electronAPI?.qemuFrame?.(view.name);
        if (!alive) return;
        if (r?.ok && !r.unchanged && r.rgb && canvasRef.current) {
          const bin = atob(r.rgb);
          const rgb = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) rgb[i] = bin.charCodeAt(i);
          frameSizeRef.current = { w: r.w, h: r.h };
          const cv = canvasRef.current;
          if (cv.width !== r.w || cv.height !== r.h) { cv.width = r.w; cv.height = r.h; }
          const ctx = cv.getContext("2d");
          const img = ctx.createImageData(r.w, r.h);
          const d = img.data;
          for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
            d[j] = rgb[i]; d[j + 1] = rgb[i + 1]; d[j + 2] = rgb[i + 2]; d[j + 3] = 255;
          }
          ctx.putImageData(img, 0, 0);
        }
      } catch {}
    };
    draw();
    const iv = setInterval(draw, 600);
    // Focus the screen so the keyboard reaches the guest without an extra click.
    setTimeout(() => { try { screenBoxRef.current?.focus(); } catch {} }, 80);
    return () => { alive = false; clearInterval(iv); };
  }, [view]);

  // Map canvas pixels → QMP absolute pointer range (0..32767).
  const ABS_MAX = 32767;
  const canvasToGuest = (e) => {
    const cv = canvasRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * ABS_MAX),
      y: Math.round(((e.clientY - rect.top) / rect.height) * ABS_MAX),
    };
  };

  const onCanvasClick = async (e) => {
    if (!view) return;
    const p = canvasToGuest(e);
    if (!p) return;
    await window.electronAPI?.qemuInput?.(view.name, { type: "click", ...p, button: e.button === 2 ? "right" : e.button === 1 ? "middle" : "left" });
  };

  const onCanvasWheel = async (e) => {
    if (!view) return;
    const p = canvasToGuest(e);
    if (!p) return;
    await window.electronAPI?.qemuInput?.(view.name, { type: "wheel", ...p, delta: e.deltaY });
  };
  const onCanvasMove = (e) => {
    if (!view) return;
    const now = Date.now();
    if (now - moveAtRef.current < 60) return; // ~16 moves/sec is plenty for an absolute pointer
    moveAtRef.current = now;
    const p = canvasToGuest(e);
    if (p) window.electronAPI?.qemuInput?.(view.name, { type: "move", ...p });
  };

  // Real keyboard: every keydown/keyup goes straight to the guest.
  const onCanvasKey = async (e, down) => {
    if (!view) return;
    // Let the app keep its own window-level shortcuts, but swallow everything
    // else so typing reaches the guest instead of triggering IDE commands.
    if (down && (e.key === "F11" || e.key === "F12")) return;
    e.preventDefault();
    e.stopPropagation();
    const r = await window.electronAPI?.qemuInput?.(view.name, { type: down ? "keydown" : "keyup", key: e.key });
    if (down && r?.ok === false && r.error && !/Unsupported key/.test(r.error)) showToast(r.error, true);
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

  const doStart = async (name) => {
    setBusy(name);
    pushLog(`[start] ${name}…`);
    try {
      const r = await window.electronAPI.qemuStartVm(name);
      if (r?.ok) { setView({ name }); pushLog(`[start] ${name} booting (pid ${r.pid})`); }
      else { showToast(r?.error || "Start failed", true); pushLog(`[start:error] ${r?.error}`); }
    } catch (e) { showToast(e?.message || String(e), true); }
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
  const openLog = () => window.dispatchEvent(new CustomEvent("add-qemu-log-panel"));
  const downloadPng = () => {
    const cv = canvasRef.current;
    if (!cv || !view) return;
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png");
    a.download = `${view.name}-${Date.now()}.png`;
    a.click();
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
          <button style={s.iconBtn} title="Open QEMU log (Terminal)" onClick={openLog}><Terminal size={14} /></button>
          <button style={s.iconBtn} title="Reveal .appdata/qemu folder" onClick={() => window.electronAPI?.qemuRevealFolder?.()}><FolderOpen size={14} /></button>
          <button style={s.iconBtn} title="Refresh" onClick={() => fetchState(false)}><RefreshCw size={14} /></button>
        </div>
      </div>

      {toast && (
        <div style={{ padding: "var(--space-6) var(--space-10)", background: toast.isError ? "var(--danger-bg, #3a1d1d)" : "var(--success-bg, #1d3a24)", fontSize: "var(--fs-small-plus)" }}>
          {toast.text}
        </div>
      )}

      {view ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-6) var(--space-10)" }}>
            <button style={s.iconBtn} title="Back to VM list" onClick={() => setView(null)}><ArrowLeft size={14} /></button>
            <strong style={{ fontSize: "var(--fs-body)" }}>{view.name}</strong>
            <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-6)" }}>
              <button style={s.btnGhost} onClick={downloadPng}><Download size={13} /> PNG</button>
              <button style={s.btnGhost} onClick={() => doStop(view.name)}><Square size={13} /> Stop</button>
            </div>
          </div>
          <div
            ref={screenBoxRef}
            tabIndex={0}
            onKeyDown={(e) => onCanvasKey(e, true)}
            onKeyUp={(e) => onCanvasKey(e, false)}
            onMouseDown={() => { try { screenBoxRef.current?.focus(); } catch {} }}
            onMouseMove={onCanvasMove}
            onWheel={onCanvasWheel}
            style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#000", overflow: "hidden", outline: "none" }}
          >
            <canvas
              ref={canvasRef}
              onClick={onCanvasClick}
              onContextMenu={(e) => { e.preventDefault(); onCanvasClick(e); }}
              style={{ maxWidth: "100%", maxHeight: "100%", imageRendering: "pixelated", cursor: "crosshair" }}
            />
          </div>
          <div style={{ display: "flex", gap: "var(--space-6)", padding: "var(--space-6) var(--space-10)", flexWrap: "wrap", alignItems: "center" }}>
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
          {error && <div style={{ padding: 16, color: "var(--danger)" }}>{error}</div>}

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
                </div>
              </div>
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
                </div>
              </div>
              {vm.running ? (
                <>
                  <button style={s.btn} onClick={() => setView({ name: vm.name })}><Monitor size={13} /> View</button>
                  <button style={s.btnGhost} disabled={busy === vm.name} onClick={() => doStop(vm.name)}><Square size={13} /> Stop</button>
                </>
              ) : (
                <button style={s.btn} disabled={busy === vm.name || !qemu.found} onClick={() => doStart(vm.name)}><Play size={13} /> Start</button>
              )}
              <button style={s.iconBtn} title="Delete VM" disabled={busy === vm.name} onClick={() => doDelete(vm.name)}><Trash2 size={13} /></button>
            </div>
          ))}

          {log.length > 0 && (
            <div style={{ margin: "var(--space-10)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
              <div style={{ padding: "var(--space-6) var(--space-10)", fontSize: "var(--fs-small)", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}>
                <span>Log</span>
                <span>
                  <button style={s.iconBtn} title="Full QEMU log in Terminal" onClick={openLog}><Terminal size={12} /></button>{" "}
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
    </div>
  );
};

export default DesktopEmulatorPanel;
