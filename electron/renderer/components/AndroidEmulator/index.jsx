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
        <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "center" }}>
          <button onClick={() => fetchState(false)} title="Refresh" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><RefreshCw size={12} /></button>
          <button onClick={() => window.dispatchEvent(new CustomEvent("add-emulator-log-panel"))} title="Open emulator output in Terminal" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Terminal size={12} /></button>
          <button onClick={() => window.electronAPI?.androidRevealFolder?.()} title="Open .appdata/android folder" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><FolderOpen size={12} /></button>
        </div>
      </div>
      )}

      {error && <div style={{ margin: "var(--space-8)", padding: "var(--space-8) var(--space-10)", background: "var(--error-bg-solid)", border: "var(--space-1) solid var(--error-border-3)", borderRadius: "var(--radius-md)", color: "var(--error-text-soft)", fontSize: "var(--fs-small)", whiteSpace: "pre-wrap" }}>{error}</div>}
      {toast && <div style={{ margin: error ? "0 var(--space-8) var(--space-8)" : 8, padding: "var(--space-6) var(--space-10)", background: toast.isError ? "var(--error-bg-solid)" : "var(--success-bg)", border: "var(--space-1) solid " + (toast.isError ? "var(--error-border-3)" : "var(--success-border-2)"), borderRadius: "var(--radius-md)", color: toast.isError ? "var(--error-text-soft)" : "var(--teal)", fontSize: "var(--fs-small)" }}>{toast.text}</div>}

      {/* First-run SDK banner (§2–§4) */}
      {sdkMissing && (
        <div style={{ margin: "var(--space-8)", padding: "var(--space-12)", background: "var(--bg-vscode)", border: "var(--space-1) solid var(--border-light)", borderRadius: "var(--radius-lg)" }}>
          <div style={{ fontSize: "var(--fs-body-plus)", fontWeight: "var(--fw-bold)", color: "var(--text-input)", marginBottom: "var(--space-4)" }}>Android SDK not installed</div>
          <div style={{ fontSize: "var(--fs-small-plus)", color: "var(--text-secondary)", marginBottom: "var(--space-8)", lineHeight: "var(--lh-code)" }}>
            Downloads Google command-line tools into <code style={{ color: "var(--teal)" }}>.appdata/android/sdk</code> and installs platform-tools, emulator + Android 15 image. Needs Java 17+ {state?.java?.ok && (state.java.major || 0) >= 17 ? <span style={{ color: "var(--teal)" }}>(found: {state.java.version}{state.java.source ? ` via ${state.java.source}` : ""})</span> : <span style={{ color: "var(--code-tan)" }}>(system Java {state?.java?.version || "missing"} — Setup auto-downloads a portable JDK 17, system Java untouched)</span>}.
          </div>
          <button onClick={handleSetup} disabled={busy === "setup"} style={{ ...s.btn, opacity: busy === "setup" ? 0.6 : 1 }}>
            <Download size={13} /> {busy === "setup" ? "Setting up…" : "Setup Android SDK"}
          </button>
        </div>
      )}

      {/* Device fullscreen in-panel — while a screen is open the rest of the UI hides */}
      {view ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, background: "var(--black)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", padding: "var(--space-6) var(--space-10)", background: "var(--bg-surface)", flexShrink: 0 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--fs-small-plus)", fontWeight: "var(--fw-bold)", color: "var(--text-input)" }}>{view.avd.replace(/_/g, " ")}</span>
            {!view.serial && <span style={{ fontSize: "var(--fs-mini)", color: "var(--code-tan)" }}>Waiting for device…</span>}
            {view.serial && !view.booted && <span style={{ fontSize: "var(--fs-mini)", color: "var(--code-tan)" }}>Booting…</span>}
            {!full && <button onClick={() => setFull(true)} title="Fullscreen — only emulator + controls" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Maximize2 size={12} /></button>}
            <button onClick={closeViewer} title="Back to emulator list" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><X size={12} /></button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", padding: "var(--space-6) var(--space-10)", background: "var(--bg-surface)", borderTop: "var(--space-1) solid var(--bg-active)", flexShrink: 0, overflowX: "auto" }}>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 4 })} disabled={!view.serial} title="Back" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><ArrowLeft size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 3 })} disabled={!view.serial} title="Home" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Home size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 187 })} disabled={!view.serial} title="Recents" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><LayoutGrid size={12} /></button>
            <button onClick={handleRotate} disabled={!view.serial} title="Rotate portrait / landscape" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><RotateCw size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 25 })} disabled={!view.serial} title="Volume down" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Volume1 size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 24 })} disabled={!view.serial} title="Volume up" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Volume2 size={12} /></button>
            <button onClick={() => sendInput(view.serial, { type: "key", code: 26 })} disabled={!view.serial} title="Power" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Power size={12} /></button>
            <button onClick={takeScreenshot} disabled={!view.serial} title="Take screenshot (saved to .appdata/android/downloads)" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Camera size={12} /></button>
            <button onClick={() => handleStop({ name: view.avd })} title="Stop emulator" style={{ ...s.iconBtn, display: "flex", alignItems: "center", color: "var(--error-soft)" }}><Square size={12} /></button>
            <span style={{ flex: 1, minWidth: 60, textAlign: "right", fontSize: "var(--fs-mini)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Screen pe click karo, keyboard se type karo</span>
          </div>
          <div ref={screenBoxRef} tabIndex={0} autoFocus
            onKeyDown={onScreenKey} onPaste={onScreenPaste} onCompositionEnd={onScreenIme}
            style={{
              flex: 1, minHeight: 0, background: "var(--black)", outline: "none", position: "relative",
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
            {!gotFrame && <div style={{ margin: "auto", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>{view.serial ? "First frame…" : "Connecting over adb…"}</div>}
            {full && <button onClick={() => setFull(false)} title="Exit fullscreen (Esc)" style={{ ...s.iconBtn, position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", background: "var(--emu-veil)" }}><Minimize2 size={12} /></button>}
            {gotFrame && (
              <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", alignItems: "center", gap: "var(--space-2)", background: "var(--emu-veil-strong)", border: "var(--space-1) solid var(--border-light)", borderRadius: "var(--radius-md)", padding: "var(--space-2)" }}>
                <button onClick={() => setZoomIdx((z) => Math.max(0, z - 1))} disabled={zoomIdx === 0} title="Zoom out" style={{ ...s.iconBtn, border: "none", background: "none", display: "flex", alignItems: "center", opacity: zoomIdx === 0 ? 0.4 : 1 }}><ZoomOut size={12} /></button>
                <button onClick={() => setZoomIdx(0)} title="Reset zoom (Fit)" style={{ background: "none", border: "none", color: "var(--text-soft)", cursor: "pointer", fontSize: "var(--fs-mini)", minWidth: 30 }}>{["Fit", "1:1", "2:1"][zoomIdx]}</button>
                <button onClick={() => setZoomIdx((z) => Math.min(2, z + 1))} disabled={zoomIdx === 2} title="Zoom in" style={{ ...s.iconBtn, border: "none", background: "none", display: "flex", alignItems: "center", opacity: zoomIdx === 2 ? 0.4 : 1 }}><ZoomIn size={12} /></button>
              </div>
            )}
          </div>
        </div>
      ) : (
      <>

      {/* AVD list (§8) */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 80 }}>
        {loading && avds.length === 0 && !sdkMissing && <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>Loading emulators…</div>}
        {!loading && avds.length === 0 && !sdkMissing && (
          <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
            <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-secondary)", marginBottom: "var(--space-6)" }}>No emulators yet</div>
            <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-small)", marginBottom: "var(--space-12)" }}>Create one — pick a device + Android version.</div>
            <button onClick={() => setShowCreate(true)} style={s.btn}><Plus size={13} /> Create Emulator</button>
          </div>
        )}
        {avds.map((avd) => (
          <div key={avd.name} style={s.row}>
            <span style={{ width: 8, height: 8, borderRadius: "var(--radius-round)", background: avd.running ? "var(--teal)" : "var(--text-placeholder)", flexShrink: 0 }} title={avd.running ? "Running" : "Stopped"} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-input)", fontSize: "var(--fs-body-plus)", overflow: "hidden", textOverflow: "ellipsis" }}>{(avd.device ? avd.device.replace(/\b\w/g, (c) => c.toUpperCase()) + " " : "") || ""}{avd.name.replace(/_/g, " ")}</div>
              <div style={{ fontSize: "var(--fs-small)", color: "var(--icon)" }}>{avd.android || "Android"} {avd.running ? <span style={{ color: "var(--teal)" }}>• running</span> : ""}</div>
            </span>
            {avd.running
              ? <button onClick={() => { const t = state?.tracked?.find((x) => x.avd === avd.name); openViewer(avd.name, { stream: !t || t.headless !== false }); }} title="Show screen in panel" style={{ ...s.iconBtn, display: "flex", alignItems: "center", color: view?.avd === avd.name ? "var(--teal)" : undefined }}><Monitor size={12} /></button>
              : <button onClick={() => handleStartEmbedded(avd)} disabled={busy === avd.name || !state?.sdkInstalled} title="Start in panel (embedded screen)" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><Monitor size={12} /></button>}
            {avd.running
              ? <button onClick={() => handleStop(avd)} disabled={busy === avd.name} title="Stop emulator" style={{ ...s.btnGhost, color: "var(--error-soft)" }}><Square size={12} /> Stop</button>
              : <button onClick={() => handleStart(avd)} disabled={busy === avd.name || !state?.sdkInstalled} title="Start in separate window (default)" style={s.btn}><Play size={12} /> {busy === avd.name ? "…" : "Start"}</button>}
            {avd.running && <button onClick={() => handleStartWindowed(avd)} disabled={busy === avd.name || !state?.sdkInstalled} title="Restart in separate window (pop-up)" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><PictureInPicture2 size={12} /></button>}
            <button onClick={() => handleDelete(avd)} disabled={busy === avd.name} title="Delete emulator" style={{ ...s.iconBtn, color: "var(--error-soft)", display: "flex", alignItems: "center" }}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ padding: "var(--space-8)", borderTop: "var(--space-1) solid var(--bg-active)", display: "flex", gap: "var(--space-6)", background: "var(--bg-vscode)", flexShrink: 0 }}>
        <button onClick={() => setShowCreate((v) => !v)} disabled={!state?.sdkInstalled} title={state?.sdkInstalled ? "Create emulator (device + Android version)" : "Run Setup SDK first"} style={s.btnGhost}><Plus size={12} /> Create Emulator</button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: "var(--fs-mini)", color: "var(--text-muted)", alignSelf: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }} title={state?.sdkRoot || ""}>{state?.sdkRoot ? ".appdata/android/sdk" : ""}</span>
      </div>

      {/* Create form (§9) */}
      {showCreate && (
        <div style={{ padding: "var(--space-10)", borderTop: "var(--space-1) solid var(--bg-active)", background: "var(--bg-surface)", display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
          <div>
            <label style={s.label}>Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Pixel_8" style={s.input} />
          </div>
          <div style={{ display: "flex", gap: "var(--space-8)" }}>
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
          <div style={{ display: "flex", gap: "var(--space-6)" }}>
            <button onClick={handleCreate} disabled={busy === "create"} style={{ ...s.btn, opacity: busy === "create" ? 0.6 : 1 }}><Plus size={12} /> {busy === "create" ? "Creating… (downloads image)" : "Create"}</button>
            <button onClick={() => setShowCreate(false)} style={s.btnGhost}>Cancel</button>
          </div>
        </div>
      )}

      {/* Active download / install — one slim card, no log spam */}
      {task && (
        <div style={{ padding: "var(--space-8) var(--space-10)", borderTop: "var(--space-1) solid var(--bg-active)", background: "var(--bg-surface)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-8)" }}>
            <Download size={12} style={{ color: "var(--teal)", flexShrink: 0, alignSelf: "center" }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--fs-small-plus)", color: "var(--text-bright)" }} title={task.message}>{task.message}</span>
            <span style={{ fontSize: "var(--fs-small-plus)", fontWeight: "var(--fw-bold)", color: "var(--teal)", flexShrink: 0 }}>{Math.round(task.percent)}%</span>
          </div>
          <div style={{ height: 5, background: "var(--bg-panel)", borderRadius: "var(--radius-sm)", marginTop: "var(--space-6)", overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, Math.max(0, task.percent))}%`, height: "100%", background: "var(--editor-blue)", transition: "width 0.25s" }} />
          </div>
          {typeof task.done === "number" && task.total > 0 && (
            <div style={{ fontSize: "var(--fs-mini)", color: "var(--icon-muted)", marginTop: "var(--space-4)" }}>{(task.done / 1048576).toFixed(1)} / {(task.total / 1048576).toFixed(1)} MB</div>
          )}
        </div>
      )}

      {/* Progress log */}
      {log.length > 0 && (
        <div style={{ borderTop: "1px solid var(--bg-active)", background: "var(--bg-panel)", maxHeight: 130, minHeight: 44, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: "var(--fs-tiny)", color: "var(--icon-muted)", padding: "var(--space-4) var(--space-10)", textTransform: "uppercase", letterSpacing: 0.4, display: "flex", justifyContent: "space-between" }}>
            <span>Setup log</span>
            <button onClick={() => setLog([])} style={{ background: "none", border: "none", color: "var(--icon-muted)", cursor: "pointer", fontSize: "var(--fs-tiny)" }}>clear</button>
          </div>
          <div ref={logRef} style={{ flex: 1, overflowY: "auto", padding: "0 var(--space-10) var(--space-8)", fontFamily: "var(--font-code)", fontSize: "var(--fs-mini)", color: "var(--code-cyan)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
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
