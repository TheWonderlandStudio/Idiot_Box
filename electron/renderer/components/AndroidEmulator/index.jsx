// Android Emulator Panel — SDK rooted at <userData>/.appdata/android
// Lists AVDs (emulator -list-avds), Start/Stop (emulator -avd <name>),
// Create (device + Android version → sdkmanager image → avdmanager),
// Delete, plus first-run Setup SDK (cmdline-tools download → sdkmanager).
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Play, Square, RefreshCw, Plus, Trash2, FolderOpen, Download, Smartphone } from "lucide-react";

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
  const busyRef = useRef(false);
  const logRef = useRef(null);

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

  const handleStart = useCallback(async (avd) => {
    setBusy(avd.name);
    try {
      const r = await window.electronAPI.androidStartAvd(avd.name);
      if (r?.ok) { showToast(`${avd.name} starting…`); pushLog(`[start] ${avd.name} launched (pid ${r.pid}). First boot can take 1–3 min.`); }
      else showToast(r?.error || "Start failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
    finally { setBusy(null); setTimeout(() => fetchState(true), 2500); }
  }, [fetchState, pushLog, showToast]);

  const handleStop = useCallback(async (avd) => {
    setBusy(avd.name);
    try {
      const r = await window.electronAPI.androidStopAvd(avd.name);
      if (r?.ok) { showToast(`${avd.name} stopped`); fetchState(true); }
      else showToast(r?.error || "Stop failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
    finally { setBusy(null); }
  }, [fetchState, showToast]);

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
      <div style={s.header}>
        <div style={s.title}><Smartphone size={13} /> Android Emulator <span style={s.badge}>{avds.length}</span></div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => fetchState(false)} title="Refresh" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><RefreshCw size={12} /></button>
          <button onClick={() => window.electronAPI?.androidRevealFolder?.()} title="Open .appdata/android folder" style={{ ...s.iconBtn, display: "flex", alignItems: "center" }}><FolderOpen size={12} /></button>
        </div>
      </div>

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
              ? <button onClick={() => handleStop(avd)} disabled={busy === avd.name} title="Stop emulator" style={{ ...s.btnGhost, color: "#f48771" }}><Square size={12} /> Stop</button>
              : <button onClick={() => handleStart(avd)} disabled={busy === avd.name || !state?.sdkInstalled} title="Start emulator (emulator -avd …)" style={s.btn}><Play size={12} /> {busy === avd.name ? "…" : "Start"}</button>}
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
    </div>
  );
};

export default AndroidEmulatorPanel;
