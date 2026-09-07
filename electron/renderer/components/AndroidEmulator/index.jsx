// Android Emulator Panel — SDK rooted at <userData>/.appdata/android
// Lists AVDs (emulator -list-avds), Start/Stop (emulator -avd <name>),
// Create (device + Android version → sdkmanager image → avdmanager),
// Delete, plus first-run Setup SDK (cmdline-tools download → sdkmanager).
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Play, Square, RefreshCw, Plus, Trash2, FolderOpen, Download, ArrowLeft, Home, LayoutGrid, X, Monitor, RotateCw, Camera, Power, Volume1, Volume2, PictureInPicture2, Maximize2, Minimize2, ZoomIn, ZoomOut, Terminal } from "lucide-react";

const FALLBACK_APIS = [
  { api: 35, android: "Android 15" },
  { api: 34, android: "Android 14" },
  { api: 33, android: "Android 13" },
];
const FALLBACK_DEVICES = [
  { id: "pixel_8", label: "Pixel 8" },
  { id: "pixel_7", label: "Pixel 7" },
  { id: "pixel_6", label: "Pixel 6" },
  { id: "pixel_5", label: "Pixel 5" },
];

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", color: "#cccccc", overflow: "hidden", fontFamily: "'Segoe UI',system-ui,sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0, gap: 10 },
  title: { fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#bbb", display: "flex", alignItems: "center", gap: 8 },
  badge: { fontSize: 11, background: "#3a3a3a", color: "#fff", padding: "1px 6px", borderRadius: 10, fontWeight: 700, minWidth: 18, textAlign: "center" },
  btn: { background: "#0e639c", border: "1px solid #0e639c", color: "#fff", borderRadius: 4, padding: "5px 10px", fontSize: 11.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  btnGhost: { background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#ccc", borderRadius: 4, padding: "5px 10px", fontSize: 11.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 },
  iconBtn: { background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#bbb", cursor: "pointer", padding: "4px 8px", borderRadius: 4, fontSize: 12, lineHeight: 1 },
  input: { background: "#252526", border: "1px solid #3a3a3a", color: "#e0e0e0", borderRadius: 4, padding: "6px 8px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" },
  select: { background: "#252526", border: "1px solid #3a3a3a", color: "#e0e0e0", borderRadius: 4, padding: "6px 8px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" },
  row: { display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", fontSize: 12, borderBottom: "1px solid #232323" },
  label: { fontSize: 11, color: "#999", marginBottom: 4, display: "block" },
};

const AndroidEmulatorPanel = () => {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // "setup" | "create" | avdName | null
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [log, setLog] = useState([]);
  const [task, setTask] = useState(null); // active download/install: {op,message,percent,done,total}
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "Pixel_8", device: "pixel_8", api: 35 });
  // Embedded screen viewer: { avd, serial|null, booted } — headless emulator streamed here
  const [view, setView] = useState(null);
  const [full, setFull] = useState(false); // in-panel fullscreen: only screen + controls
  const [gotFrame, setGotFrame] = useState(false);
  const [devSize, setDevSize] = useState(null); // {w,h} device px of current stream
  const [zoomIdx, setZoomIdx] = useState(0); // 0=Fit, 1=1:1, 2=2:1
  const busyRef = useRef(false);
  const logRef = useRef(null);
  const canvasRef = useRef(null);
  const screenBoxRef = useRef(null);
  const keyBufRef = useRef("");
  const keyTimerRef = useRef(null);
  const frameBusyRef = useRef(false);
  const frameFailRef = useRef(0);
  const downPosRef = useRef(null);
  const diagDoneRef = useRef(null);

  const showToast = useCallback((text, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const pushLog = useCallback((line) => {
    // belt & suspenders: sdkmanager ASCII progress bars never belong in the log
    if (/\[=+\s*\]\s*\d+%/.test(line)) return;
    setLog((prev) => {
      if (prev.length && prev[prev.length - 1] === line) return prev; // drop consecutive dupes
      return [...prev.slice(-200), line];
    });
  }, []);

  const pushDiag = useCallback(async (serial, avdName) => {
    try {
      const r = await window.electronAPI?.androidDiagKeyboard?.(serial, avdName);
      if (r?.ok && Array.isArray(r.lines)) {
        pushLog(`[diag] keyboard check for ${avdName}:`);
        for (const ln of r.lines.slice(0, 20)) pushLog(`[diag] ${ln}`);
      } else if (r?.error) pushLog(`[diag:error] ${r.error}`);
    } catch (e) { pushLog(`[diag:error] ${e?.message || e}`); }
  }, [pushLog]);

  // Windowed mode has no viewer — wait for boot in background, then diagnose
  const runDiagWhenReady = useCallback(async (avdName) => {
    try {
      const w = await window.electronAPI?.androidWaitSerial?.(avdName, 150000);
      if (!w?.ok || !w.serial) return;
      for (let i = 0; i < 48; i++) {
        try {
          const b = await window.electronAPI?.androidBootState?.(w.serial);
          if (b?.ok && b.booted) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 2500));
      }
      const key = `${avdName}:diag`;
      if (diagDoneRef.current === key) return;
      diagDoneRef.current = key;
      pushDiag(w.serial, avdName);
    } catch {}
  }, [pushLog, pushDiag]);

  const closeViewer = useCallback(() => {
    setView(null);
    setFull(false);
    setGotFrame(false);
    setDevSize(null);
    setZoomIdx(0);
    frameFailRef.current = 0;
  }, []);

  // Resolve adb serial for an AVD (waits while it boots), then show its screen here
  const openViewer = useCallback(async (avdName, opts = {}) => {
    const stream = opts.stream !== false; // windowed instances: view full-res, don't shrink
    setFull(false);
    setView({ avd: avdName, serial: null, booted: false });
    setGotFrame(false);
    setDevSize(null);
    setZoomIdx(0);
    frameFailRef.current = 0;
    try {
      const r = await window.electronAPI?.androidWaitSerial?.(avdName, 150000);
      if (r?.ok && r.serial) {
        setView((v) => (v && v.avd === avdName ? { ...v, serial: r.serial } : v));
        if (stream) {
          // stream mode: smaller virtual display → much faster frames
          try { await window.electronAPI?.androidDisplay?.(r.serial, "stream"); } catch {}
        } else {
          pushLog(`[view] ${avdName} runs windowed — full-resolution screen, stream shrink skipped.`);
        }
      }
      else { showToast(r?.error || `No adb connection for ${avdName}`, true); setView(null); }
    } catch (e) { showToast(e?.message || String(e), true); setView(null); }
  }, [showToast, pushLog]);

  const sendInput = useCallback(async (serial, action) => {
    if (!serial) return;
    try { await window.electronAPI?.androidInput?.(serial, action); } catch {}
  }, []);

  const takeScreenshot = useCallback(async () => {
    if (!view?.serial) return;
    try {
      const r = await window.electronAPI?.androidScreenshot?.(view.serial, view.avd);
      if (r?.ok) {
        const base = String(r.path || "").split(/[\\/]/).pop() || "screenshot.png";
        showToast(`Screenshot: ${base}`);
        pushLog(`[screenshot] saved ${r.path}`);
      } else showToast(r?.error || "Screenshot failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
  }, [view?.serial, view?.avd, showToast, pushLog]);

  const fetchState = useCallback(async (silent) => {
    if (!window.electronAPI?.androidGetState) {
      if (!silent) { setError("Android bridge not available — rebuild the app (npm run build)."); setLoading(false); }
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (!silent) setLoading(true);
      const st = await window.electronAPI.androidGetState();
      if (st?.ok === false) {
        if (!silent) setError(st.error || "Failed to load Android state");
      } else {
        setState(st);
        setError(null);
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
    if (!window.electronAPI?.onAndroidProgress) return () => {};
    const unsub = window.electronAPI.onAndroidProgress((p) => {
      if (!p) return;
      // Percent-carrying events drive the download card; everything else goes to the log.
      if (typeof p.percent === "number" && p.phase !== "done" && p.phase !== "error") {
        setTask({ op: p.op, message: p.message || "Working…", percent: p.percent, done: p.done ?? null, total: p.total ?? null });
        return;
      }
      const label = `[${p.op || "?"}${p.phase ? ":" + p.phase : ""}] ${p.message || ""}`;
      pushLog(label);
      if (p.phase === "done" || p.phase === "error") {
        setTimeout(() => setTask(null), 4000);
        setTimeout(() => { fetchState(true); }, 800);
      }
    });
    return () => { try { unsub(); } catch {} };
  }, [fetchState, pushLog]);

  useEffect(() => {
    try { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; } catch {}
  }, [log]);

  // Live screen: chained raw-framebuffer loop drawn straight to canvas
  // (no PNG encode/decode — the main cost of the old path). Identical frames
  // skip re-draw via main-side memcmp.
  useEffect(() => {
    const serial = view?.serial;
    if (!serial) return () => {};
    let dead = false;
    let timer = null;
    const draw = (w, h, pixels) => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        setDevSize({ w, h });
      }
      try {
        const ctx = canvas.getContext("2d");
        ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
        return true;
      } catch { return false; }
    };
    const tick = async () => {
      if (dead) return;
      if (!document.hidden && !frameBusyRef.current) {
        frameBusyRef.current = true;
        try {
          const r = await window.electronAPI?.androidFrame?.(serial);
          if (dead) return;
          if (r?.ok) {
            frameFailRef.current = 0;
            if (!r.unchanged && r.pixels) {
              if (draw(r.w, r.h, r.pixels)) setGotFrame(true);
            }
          } else {
            frameFailRef.current += 1;
          }
        } catch { frameFailRef.current += 1; }
        finally { frameBusyRef.current = false; }
        if (frameFailRef.current >= 8 && !dead) {
          showToast(`Lost connection to ${view.avd} — emulator may have stopped`, true);
          closeViewer();
          return;
        }
      }
      if (!dead) timer = setTimeout(tick, 16);
    };
    tick();
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      // release the persistent shell session for this serial
      try { window.electronAPI?.androidFrameStop?.(serial); } catch {}
    };
  }, [view?.serial, view?.avd, showToast, closeViewer]);

  // Keyboard diagnostics once per connected+booted viewer device → setup log
  useEffect(() => {
    const serial = view?.serial;
    if (!serial || !view?.booted || !view?.avd) return () => {};
    const key = `${view.avd}:${serial}`;
    if (diagDoneRef.current === key) return () => {};
    diagDoneRef.current = key;
    pushDiag(serial, view.avd);
    return () => {};
  }, [view?.serial, view?.booted, view?.avd, pushDiag]);

  // Boot probe: show "Booting…" until sys.boot_completed = 1
  useEffect(() => {
    const serial = view?.serial;
    if (!serial || view?.booted) return () => {};
    let dead = false;
    const probe = async () => {
      if (dead || document.hidden) return;
      try {
        const r = await window.electronAPI?.androidBootState?.(serial);
        if (!dead && r?.ok && r.booted) setView((v) => (v && v.serial === serial ? { ...v, booted: true } : v));
      } catch {}
    };
    probe();
    const iv = setInterval(probe, 2500);
    return () => { dead = true; clearInterval(iv); };
  }, [view?.serial, view?.booted]);

  const handleSetup = useCallback(async () => {
    setBusy("setup");
    setLog([]);
    setTask({ op: "setup-sdk", message: "Starting…", percent: 0, done: null, total: null });
    pushLog("[setup-sdk:start] Setting up Android SDK under .appdata/android … (several GB, may take a while)");
    try {
      const r = await window.electronAPI.androidSetupSdk();
      if (r?.ok) { showToast("Android SDK ready"); }
      else { setError(r?.error || "Setup failed"); pushLog(`[setup-sdk:error] ${r?.error || "failed"}`); }
    } catch (e) {
      setError(e?.message || String(e));
      pushLog(`[setup-sdk:error] ${e?.message || e}`);
    } finally {
      setBusy(null);
      fetchState(false);
    }
  }, [fetchState, pushLog, showToast]);

  // Default: separate window (pop-up)
  const handleStart = useCallback(async (avd) => {
    setBusy(avd.name);
    try {
      const r = await window.electronAPI.androidStartAvd(avd.name, { windowed: true });
      if (r?.ok) {
        showToast(`${avd.name} opening in a separate window…`);
        pushLog(`[start] ${avd.name} launched windowed (pid ${r.pid}).`);
        window.dispatchEvent(new CustomEvent("add-emulator-log-panel"));
        runDiagWhenReady(avd.name);
      }
      else showToast(r?.error || "Start failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
    finally { setBusy(null); setTimeout(() => fetchState(true), 2500); }
  }, [fetchState, pushLog, showToast, runDiagWhenReady]);

  // Secondary: headless + embedded screen in the panel
  const handleStartEmbedded = useCallback(async (avd) => {
    setBusy(avd.name);
    try {
      const r = await window.electronAPI.androidStartAvd(avd.name);
      if (r?.ok) {
        showToast(`${avd.name} starting…`);
        pushLog(`[start] ${avd.name} launched headless (pid ${r.pid}). Screen appears in panel…`);
        window.dispatchEvent(new CustomEvent("add-emulator-log-panel"));
        openViewer(avd.name, { stream: true });
      }
      else showToast(r?.error || "Start failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
    finally { setBusy(null); setTimeout(() => fetchState(true), 2500); }
  }, [fetchState, pushLog, showToast, openViewer]);

  // Classic separate OS window instead of the in-panel screen.
  // Already running headless? Headless can't turn windowed live — restart it in a window.
  const handleStartWindowed = useCallback(async (avd) => {
    if (avd.running) {
      const ok = await window.electronAPI.confirmDialog(`"${avd.name}" is running in the panel.\n\nRestart it in a separate window? (It will reboot.)`);
      if (!ok) return;
      setBusy(avd.name);
      try {
        closeViewer();
        pushLog(`[start] Restarting ${avd.name} in a separate window…`);
        const stop = await window.electronAPI.androidStopAvd(avd.name);
        if (!stop?.ok) { showToast(stop?.error || "Stop failed", true); return; }
        const r = await window.electronAPI.androidStartAvd(avd.name, { windowed: true });
        if (r?.ok) {
          showToast(`${avd.name} opening in a separate window…`);
          pushLog(`[start] ${avd.name} launched windowed (pid ${r.pid}).`);
          window.dispatchEvent(new CustomEvent("add-emulator-log-panel"));
          runDiagWhenReady(avd.name);
        }
        else showToast(r?.error || "Start failed", true);
      } catch (e) { showToast(e?.message || String(e), true); }
      finally { setBusy(null); setTimeout(() => fetchState(true), 2500); }
      return;
    }
    setBusy(avd.name);
    try {
      const r = await window.electronAPI.androidStartAvd(avd.name, { windowed: true });
      if (r?.ok) {
        showToast(`${avd.name} opening in a separate window…`);
        pushLog(`[start] ${avd.name} launched windowed (pid ${r.pid}).`);
        window.dispatchEvent(new CustomEvent("add-emulator-log-panel"));
        runDiagWhenReady(avd.name);
      }
      else showToast(r?.error || "Start failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
    finally { setBusy(null); setTimeout(() => fetchState(true), 2500); }
  }, [fetchState, pushLog, showToast, closeViewer, runDiagWhenReady]);

  const handleRotate = useCallback(async () => {
    if (!view?.serial) return;
    try {
      const r = await window.electronAPI?.androidInput?.(view.serial, { type: "rotate" });
      if (r?.ok) {
        showToast("Rotated");
        pushLog(`[rotate] ok via ${r.method || "emulator"}${r.detail ? ` — ${r.detail}` : ""}.`);
      } else {
        showToast(r?.error || "Rotate failed", true);
        pushLog(`[rotate:error] ${r?.error || "failed"}`);
      }
    } catch (e) {
      showToast(e?.message || String(e), true);
      pushLog(`[rotate:error] ${e?.message || e}`);
    }
  }, [view?.serial, showToast, pushLog]);

  const handleStop = useCallback(async (avd) => {
    setBusy(avd.name);
    try {
      const r = await window.electronAPI.androidStopAvd(avd.name);
      if (r?.ok) {
        showToast(`${avd.name} stopped`);
        setView((v) => (v && v.avd === avd.name ? null : v));
        fetchState(true);
      }
      else showToast(r?.error || "Stop failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
    finally { setBusy(null); }
  }, [fetchState, showToast]);

  // Screen touch: click = tap, drag = swipe (coords scaled to device pixels)
  const screenPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    const k = canvas.width / rect.width;
    return {
      x: Math.round((e.clientX - rect.left) * k),
      y: Math.round((e.clientY - rect.top) * k),
    };
  }, []);

  const onScreenDown = useCallback((e) => {
    try { screenBoxRef.current?.focus(); } catch {}
    const p = screenPos(e);
    if (p) downPosRef.current = p;
  }, [screenPos]);

  const onScreenUp = useCallback((e) => {
    const serial = view?.serial;
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!serial || !down) return;
    const up = screenPos(e);
    if (!up) return;
    const dist = Math.hypot(up.x - down.x, up.y - down.y);
    if (dist < 12) sendInput(serial, { type: "tap", x: down.x, y: down.y });
    else sendInput(serial, { type: "swipe", x1: down.x, y1: down.y, x2: up.x, y2: up.y, ms: 300 });
  }, [view?.serial, screenPos, sendInput]);

  // Physical keyboard → device. Printable keys are buffered ~250ms and sent as
  // one `input text` (fast typing); control keys go out as keyevents at once.
  const flushKeyBuf = useCallback(() => {
    const serial = view?.serial;
    const buf = keyBufRef.current;
    keyBufRef.current = "";
    if (keyTimerRef.current) { clearTimeout(keyTimerRef.current); keyTimerRef.current = null; }
    if (serial && buf) sendInput(serial, { type: "text", text: buf });
  }, [view?.serial, sendInput]);

  const queueKeyChar = useCallback((ch) => {
    keyBufRef.current += ch;
    if (keyBufRef.current.length >= 64) { flushKeyBuf(); return; }
    if (keyTimerRef.current) clearTimeout(keyTimerRef.current);
    keyTimerRef.current = setTimeout(flushKeyBuf, 250);
  }, [flushKeyBuf]);

  useEffect(() => () => { if (keyTimerRef.current) clearTimeout(keyTimerRef.current); }, []);

  const onScreenKey = useCallback((e) => {
    const serial = view?.serial;
    if (!serial) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // don't hijack app shortcuts
    const k = e.key;
    const sendKey = (code) => { flushKeyBuf(); sendInput(serial, { type: "key", code }); };
    if (k === "Backspace") { e.preventDefault(); sendKey(67); }
    else if (k === "Enter") { e.preventDefault(); sendKey(66); }
    else if (k === "Tab") { e.preventDefault(); sendKey(61); }
    else if (k === "Escape") { e.preventDefault(); if (full) setFull(false); else sendKey(4); }
    else if (k === "Delete") { e.preventDefault(); sendKey(112); }
    else if (k === "ArrowUp") { e.preventDefault(); sendKey(19); }
    else if (k === "ArrowDown") { e.preventDefault(); sendKey(20); }
    else if (k === "ArrowLeft") { e.preventDefault(); sendKey(21); }
    else if (k === "ArrowRight") { e.preventDefault(); sendKey(22); }
    else if (k && k.length === 1) { queueKeyChar(k); }
    // IME composition (Hindi etc.) arrives via onCompositionEnd below
  }, [view?.serial, sendInput, flushKeyBuf, queueKeyChar, full]);

  const onScreenPaste = useCallback((e) => {
    const serial = view?.serial;
    if (!serial) return;
    try { e.preventDefault(); } catch {}
    const pasted = String(e.clipboardData?.getData("text") || "");
    if (!pasted) return;
    flushKeyBuf();
    // main caps input text at 500 chars — chunk long pastes
    const chunks = pasted.match(/[\s\S]{1,400}/g) || [];
    (async () => {
      for (const c of chunks) await sendInput(serial, { type: "text", text: c });
    })();
  }, [view?.serial, sendInput, flushKeyBuf]);

  const onScreenIme = useCallback((e) => {
    if (e?.data) queueKeyChar(e.data);
  }, [queueKeyChar]);

  const handleDelete = useCallback(async (avd) => {
    const ok = await window.electronAPI.confirmDialog(`Delete emulator "${avd.name}"?\nThis removes its AVD files from .appdata/android/avd.`);
    if (!ok) return;
    setBusy(avd.name);
    try {
      const r = await window.electronAPI.androidDeleteAvd(avd.name);
      if (r?.ok) { showToast(`${avd.name} deleted`); fetchState(false); }
      else showToast(r?.error || "Delete failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
    finally { setBusy(null); }
  }, [fetchState, showToast]);

  const handleCreate = useCallback(async () => {
    const name = String(form.name || "").trim();
    if (!/^[A-Za-z0-9_.\-]+$/.test(name)) { showToast("Name: letters, numbers, _, - and . only", true); return; }
    setBusy("create");
    pushLog(`[create] Creating ${name} (device ${form.device}, API ${form.api}) — downloads image if needed…`);
    try {
      const r = await window.electronAPI.androidCreateAvd({ name, device: form.device, api: parseInt(form.api, 10) });
      if (r?.ok) {
        showToast(`${name} created`);
        pushLog(`[create:done] ${name} ready.`);
        setShowCreate(false);
        fetchState(false);
      } else {
        showToast(r?.error || "Create failed", true);
        pushLog(`[create:error] ${r?.error || "failed"}`);
      }
    } catch (e) {
      showToast(e?.message || String(e), true);
      pushLog(`[create:error] ${e?.message || e}`);
    } finally { setBusy(null); }
  }, [form, fetchState, pushLog, showToast]);

  const apis = state?.apiLevels?.length ? state.apiLevels : FALLBACK_APIS;
  const devices = state?.devices?.length ? state.devices : FALLBACK_DEVICES;
  const avds = state?.avds || [];
  const sdkMissing = state && !state.sdkInstalled;

  return (
    <div style={s.wrap}>
      {!(view && full) && (
      <div style={s.header}>
        <div style={s.title}>Android Emulator <span style={s.badge}>{avds.length}</span></div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => fetchState(false)} title="Refresh" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><RefreshCw size={12} /></button>
          <button onClick={() => window.dispatchEvent(new CustomEvent("add-emulator-log-panel"))} title="Open emulator output in Terminal" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Terminal size={12} /></button>
          <button onClick={() => window.electronAPI?.androidRevealFolder?.()} title="Open .appdata/android folder" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><FolderOpen size={12} /></button>
        </div>
      </div>
      )}

      {error && <div style={{ margin: 8, padding: "8px 10px", background: "#5a1d1d", border: "1px solid #7a2a2a", borderRadius: 4, color: "#ffb3b3", fontSize: 11, whiteSpace: "pre-wrap" }}>{error}</div>}
      {toast && <div style={{ margin: error ? "0 8px 8px" : 8, padding: "6px 10px", background: toast.isError ? "#5a1d1d" : "#1a3a2a", border: "1px solid " + (toast.isError ? "#7a2a2a" : "#2a5a3a"), borderRadius: 4, color: toast.isError ? "#ffb3b3" : "#4ec9b0", fontSize: 11 }}>{toast.text}</div>}

      {/* First-run SDK banner (§2–§4) */}
      {sdkMissing && (
        <div style={{ margin: 8, padding: 12, background: "#252526", border: "1px solid #3a3a3a", borderRadius: 6 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#e0e0e0", marginBottom: 4 }}>Android SDK not installed</div>
          <div style={{ fontSize: 11.5, color: "#999", marginBottom: 8, lineHeight: 1.5 }}>
            Downloads Google command-line tools into <code style={{ color: "#4ec9b0" }}>.appdata/android/sdk</code> and installs platform-tools, emulator + Android 15 image. Needs Java 17+ {state?.java?.ok && (state.java.major || 0) >= 17 ? <span style={{ color: "#4ec9b0" }}>(found: {state.java.version}{state.java.source ? ` via ${state.java.source}` : ""})</span> : <span style={{ color: "#d7ba7d" }}>(system Java {state?.java?.version || "missing"} — Setup auto-downloads a portable JDK 17, system Java untouched)</span>}.
          </div>
          <button onClick={handleSetup} disabled={busy === "setup"} style={{ ...s.btn, opacity: busy === "setup" ? 0.6 : 1 }}>
            <Download size={13} /> {busy === "setup" ? "Setting up…" : "Setup Android SDK"}
          </button>
        </div>
      )}

      {/* Device fullscreen in-panel — while a screen is open the rest of the UI hides */}
      {view ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "#000" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#1e1e1e", flexShrink: 0 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 700, color: "#e0e0e0" }}>{view.avd.replace(/_/g, " ")}</span>
            {!view.serial && <span style={{ fontSize: 10.5, color: "#d7ba7d" }}>Waiting for device…</span>}
            {view.serial && !view.booted && <span style={{ fontSize: 10.5, color: "#d7ba7d" }}>Booting…</span>}
            {!full && <button onClick={() => setFull(true)} title="Fullscreen — only emulator + controls" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Maximize2 size={12} /></button>}
            <button onClick={closeViewer} title="Back to emulator list" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><X size={12} /></button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#1e1e1e", borderTop: "1px solid #2d2d2d", flexShrink: 0, overflowX: "auto" }}>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 4 })} disabled={!view.serial} title="Back" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><ArrowLeft size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 3 })} disabled={!view.serial} title="Home" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Home size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 187 })} disabled={!view.serial} title="Recents" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><LayoutGrid size={12} /></button>
            <button onClick={handleRotate} disabled={!view.serial} title="Rotate portrait / landscape" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><RotateCw size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 25 })} disabled={!view.serial} title="Volume down" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Volume1 size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 24 })} disabled={!view.serial} title="Volume up" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Volume2 size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 26 })} disabled={!view.serial} title="Power" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Power size={12} /></button>
            <button onClick={takeScreenshot} disabled={!view.serial} title="Take screenshot (saved to .appdata/android/downloads)" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Camera size={12} /></button>
            <button onClick={() => handleStop({ name: view.avd })} title="Stop emulator" style={{ ...s.iconBtn, display: "flex", alignItems: "center", color: "#f48771" }}><Square size={12} /></button>
            <span style={{ flex: 1, minWidth: 60, textAlign: "right", fontSize: 10.5, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Screen pe click karo, keyboard se type karo</span>
          </div>
          <div ref={screenBoxRef} tabIndex={0} autoFocus
            onKeyDown={onScreenKey} onPaste={onScreenPaste} onCompositionEnd={onScreenIme}
            style={{
              flex: 1, minHeight: 0, background: "#000", outline: "none", position: "relative",
              display: "flex", alignItems: zoomIdx === 0 ? "center" : "flex-start",
              justifyContent: zoomIdx === 0 ? "center" : "flex-start",
              overflow: zoomIdx === 0 ? "hidden" : "auto",
            }}>
            <canvas ref={canvasRef}
              onMouseDown={onScreenDown} onMouseUp={onScreenUp}
              onContextMenu={(e) => { e.preventDefault(); sendInput(view.serial, { type: "key", code: 4 }); }}
              style={{
                display: gotFrame ? "block" : "none", flexShrink: 0, margin: zoomIdx === 0 ? 0 : "auto",
                cursor: "default", userSelect: "none",
                ...(zoomIdx === 0
                  ? { maxWidth: "100%", maxHeight: "100%" }
                  : { width: devSize ? Math.round(devSize.w * (zoomIdx === 1 ? 1 : 2)) : undefined }),
              }} />
            {!gotFrame && <div style={{ margin: "auto", color: "#666", fontSize: 12 }}>{view.serial ? "First frame…" : "Connecting over adb…"}</div>}
            {full && <button onClick={() => setFull(false)} title="Exit fullscreen (Esc)" style={{ ...s.iconBtn, position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", background: "rgba(37,37,38,0.9)" }}><Minimize2 size={12} /></button>}
            {gotFrame && (
              <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", alignItems: "center", gap: 2, background: "rgba(37,37,38,0.92)", border: "1px solid #3a3a3a", borderRadius: 4, padding: 2 }}>
                <button onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} disabled={zoomIdx === 0} title="Zoom out" style={{ ...s.iconBtn, border: "none", background: "none", display: "flex", alignItems: "center", opacity: zoomIdx === 0 ? 0.4 : 1 }}><ZoomOut size={12} /></button>
                <button onClick={() => setZoomIdx(0)} title="Reset zoom (Fit)" style={{ background: "none", border: "none", color: "#bbb", cursor: "pointer", fontSize: 10.5, minWidth: 30 }}>{["Fit", "1:1", "2:1"][zoomIdx]}</button>
                <button onClick={() => setZoomIdx((z) => Math.min(2, z + 1))} disabled={zoomIdx === 2} title="Zoom in" style={{ ...s.iconBtn, border: "none", background: "none", display: "flex", alignItems: "center", opacity: zoomIdx === 2 ? 0.4 : 1 }}><ZoomIn size={12} /></button>
              </div>
            )}
          </div>
        </div>
      ) : (
      <>

      {/* AVD list (§8) */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 80 }}>
        {loading && avds.length === 0 && !sdkMissing && <div style={{ padding: 20, color: "#666", fontSize: 12, textAlign: "center" }}>Loading emulators…</div>}
        {!loading && avds.length === 0 && !sdkMissing && (
          <div style={{ textAlign: "center", padding: 30, color: "#666", fontSize: 12 }}>
            <div style={{ fontWeight: 700, color: "#999", marginBottom: 6 }}>No emulators yet</div>
            <div style={{ color: "#555", fontSize: 11, marginBottom: 12 }}>Create one — pick a device + Android version.</div>
            <button onClick={() => setShowCreate(true)} style={s.btn}><Plus size={13} /> Create Emulator</button>
          </div>
        )}
        {avds.map((avd) => (
          <div key={avd.name} style={s.row}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: avd.running ? "#4ec9b0" : "#555", flexShrink: 0 }} title={avd.running ? "Running" : "Stopped"} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: "#e0e0e0", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>{(avd.device ? avd.device.replace(/\b\w/g, (c) => c.toUpperCase()) + " " : "") || ""}{avd.name.replace(/_/g, " ")}</div>
              <div style={{ fontSize: 11, color: "#888" }}>{avd.android || "Android"} {avd.running ? <span style={{ color: "#4ec9b0" }}>• running</span> : ""}</div>
            </span>
            {avd.running
              ? <button onClick={() => { const t = state?.tracked?.find((x) => x.avd === avd.name); openViewer(avd.name, { stream: !t || t.headless !== false }); }} title="Show screen in panel" style={{ ...s.iconBtn, display: "flex", alignItems: "center", color: view?.avd === avd.name ? "#4ec9b0" : undefined }}><Monitor size={12} /></button>
              : <button onClick={() => handleStartEmbedded(avd)} disabled={busy === avd.name || !state?.sdkInstalled} title="Start in panel (embedded screen)" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Monitor size={12} /></button>}
            {avd.running
              ? <button onClick={() => handleStop(avd)} disabled={busy === avd.name} title="Stop emulator" style={{ ...s.btnGhost, color: "#f48771" }}><Square size={12} /> Stop</button>
              : <button onClick={() => handleStart(avd)} disabled={busy === avd.name || !state?.sdkInstalled} title="Start in separate window (default)" style={s.btn}><Play size={12} /> {busy === avd.name ? "…" : "Start"}</button>}
            {avd.running && <button onClick={() => handleStartWindowed(avd)} disabled={busy === avd.name || !state?.sdkInstalled} title="Restart in separate window (pop-up)" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><PictureInPicture2 size={12} /></button>}
            <button onClick={() => handleDelete(avd)} disabled={busy === avd.name} title="Delete emulator" style={{ ...s.iconBtn, color: "#f48771", display: "flex", alignItems: "center" }}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ padding: 8, borderTop: "1px solid #2d2d2d", display: "flex", gap: 6, background: "#252526", flexShrink: 0 }}>
        <button onClick={() => setShowCreate((v) => !v)} disabled={!state?.sdkInstalled} title={state?.sdkInstalled ? "Create emulator (device + Android version)" : "Run Setup SDK first"} style={s.btnGhost}><Plus size={12} /> Create Emulator</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, color: "#666", alignSelf: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }} title={state?.sdkRoot || ""}>{state?.sdkRoot ? ".appdata/android/sdk" : ""}</span>
      </div>

      {/* Create form (§9) */}
      {showCreate && (
        <div style={{ padding: 10, borderTop: "1px solid #2d2d2d", background: "#1e1e1e", display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <label style={s.label}>Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Pixel_8" style={s.input} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Device</label>
              <select value={form.device} onChange={(e) => setForm((f) => ({ ...f, device: e.target.value }))} style={s.select}>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Android version</label>
              <select value={form.api} onChange={(e) => setForm((f) => ({ ...f, api: parseInt(e.target.value, 10) }))} style={s.select}>
                {apis.map((a) => <option key={a.api} value={a.api}>{a.android} (API {a.api})</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleCreate} disabled={busy === "create"} style={{ ...s.btn, opacity: busy === "create" ? 0.6 : 1 }}><Plus size={12} /> {busy === "create" ? "Creating… (downloads image)" : "Create"}</button>
            <button onClick={() => setShowCreate(false)} style={s.btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {/* Active download / install — one slim card, no log spam */}
      {task && (
        <div style={{ padding: "8px 10px", borderTop: "1px solid #2d2d2d", background: "#1e1e1e", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <Download size={12} style={{ color: "#4ec9b0", flexShrink: 0, alignSelf: "center" }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, color: "#ccc" }} title={task.message}>{task.message}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#4ec9b0", flexShrink: 0 }}>{Math.round(task.percent)}%</span>
          </div>
          <div style={{ height: 5, background: "#111", borderRadius: 3, marginTop: 6, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, Math.max(0, task.percent))}%`, height: "100%", background: "#0e639c", transition: "width 0.25s" }} />
          </div>
          {typeof task.done === "number" && task.total > 0 && (
            <div style={{ fontSize: 10.5, color: "#777", marginTop: 4 }}>{(task.done / 1048576).toFixed(1)} / {(task.total / 1048576).toFixed(1)} MB</div>
          )}
        </div>
      )}

      {/* Progress log */}
      {log.length > 0 && (
        <div style={{ borderTop: "1px solid #2d2d2d", background: "#111", maxHeight: 130, minHeight: 44, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 10, color: "#777", padding: "4px 10px", textTransform: "uppercase", letterSpacing: 0.4, display: "flex", justifyContent: "space-between" }}>
            <span>Setup log</span>
            <button onClick={() => setLog([])} style={{ background: "none", border: "none", color: "#777", cursor: "pointer", fontSize: 10 }}>clear</button>
          </div>
          <div ref={logRef} style={{ flex: 1, overflowY: "auto", padding: "0 10px 8px", fontFamily: "Consolas,monospace", fontSize: 10.5, color: "#9cdcfe", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};

export default AndroidEmulatorPanel;
