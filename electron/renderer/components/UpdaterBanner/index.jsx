import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Download, RefreshCw, X, Rocket, AlertCircle, CheckCircle2, Clock, Zap, ExternalLink, Sparkles } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────
const fmtBytes = (b) => {
  if (!Number.isFinite(b) || b <= 0) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
const fmtSpeed = (bps) => {
  if (!Number.isFinite(bps) || bps <= 0) return "—";
  return `${fmtBytes(bps)}/s`;
};
const fmtETA = (p) => {
  if (!p || !Number.isFinite(p.bytesPerSecond) || p.bytesPerSecond <= 0) return "—";
  const total = p.total || 0;
  const transferred = p.transferred || 0;
  const remain = Math.max(0, total - transferred);
  if (remain <= 0 || !Number.isFinite(remain)) return "—";
  const sec = remain / p.bytesPerSecond;
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.ceil(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.ceil(sec % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
};

// ── Proper Update Cycle ──────────────────────────────────────────────────
// idle → checking → available → downloading (progress) → downloaded → installing → idle
//                              ↘ not-available / error → idle
// Manual check shows center modal; auto checks only show banner when available.

export default function UpdaterBanner() {
  const [state, setState] = useState("idle"); // idle | checking | available | downloading | downloaded | error | not-available
  const [info, setInfo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [currentVersion, setCurrentVersion] = useState("");
  const autoInstallRef = React.useRef(false);
  const [manualModal, setManualModal] = useState(null); // null | "available" | "not-available"

  useEffect(() => {
    window.electronAPI?.updaterGetVersion?.().then((r) => {
      if (r?.version) setCurrentVersion(r.version);
    }).catch(() => {});
    // Restore proper cycle state after reload (e.g., if download was in progress)
    window.electronAPI?.updaterGetState?.().then((s) => {
      if (!s || !s.state) return;
      if (s.state !== "idle") {
        setState(s.state);
        if (s.info) setInfo(s.info);
        if (s.progress) setProgress(s.progress);
      }
    }).catch(() => {});
  }, []);

  const isManualRef = React.useRef(false);
  useEffect(() => {
    const unsubs = [];
    if (window.electronAPI?.onUpdaterManualCheck) unsubs.push(window.electronAPI.onUpdaterManualCheck(() => { isManualRef.current = true; }));
    if (window.electronAPI?.onUpdaterChecking) unsubs.push(window.electronAPI.onUpdaterChecking(() => { setState("checking"); setError(null); autoInstallRef.current = false; setProgress(null); }));
    if (window.electronAPI?.onUpdaterAvailable) unsubs.push(window.electronAPI.onUpdaterAvailable((i) => {
      const wasManual = isManualRef.current;
      setInfo(i); setState("available"); setProgress(null);
      if (wasManual) setManualModal("available");
      isManualRef.current = false;
    }));
    if (window.electronAPI?.onUpdaterNotAvailable) unsubs.push(window.electronAPI.onUpdaterNotAvailable((inf) => {
      if (isManualRef.current) {
        setInfo(inf); setState("not-available");
        setManualModal("not-available");
        isManualRef.current = false;
        setTimeout(() => setState(cur => cur === "not-available" ? "idle" : cur), 4000);
        setTimeout(() => setManualModal(cur => cur === "not-available" ? null : cur), 4000);
      } else {
        setState(prev => {
          if (prev === "available" || prev === "downloading" || prev === "downloaded") return prev;
          return "idle";
        });
      }
    }));
    if (window.electronAPI?.onUpdaterError) unsubs.push(window.electronAPI.onUpdaterError((e) => { setError(e); setState("error"); autoInstallRef.current = false; isManualRef.current = false; setManualModal(null); setProgress(null); }));
    if (window.electronAPI?.onUpdaterProgress) unsubs.push(window.electronAPI.onUpdaterProgress((p) => { setProgress(p); setState("downloading"); }));
    if (window.electronAPI?.onUpdaterDownloaded) unsubs.push(window.electronAPI.onUpdaterDownloaded((i) => {
      setInfo(i); setState("downloaded"); setProgress(null);
      isManualRef.current = false;
      setManualModal(null);
      if (autoInstallRef.current) {
        setTimeout(() => { try { window.electronAPI?.updaterInstall?.(); } catch {} }, 1200);
      }
    }));
    if (window.electronAPI?.onUpdaterState) unsubs.push(window.electronAPI.onUpdaterState((s) => {
      if (!s || !s.state) return;
      // Sync state from main (e.g., after reload, proper cycle)
      setState(s.state);
      if (s.info) setInfo(s.info);
      if (s.progress) setProgress(s.progress);
      if (s.state === "error" && s.error) setError(s.error);
    }));
    return () => unsubs.forEach((u) => { try { u(); } catch {} });
  }, []);

  const handleCheck = useCallback(async () => {
    isManualRef.current = true;
    setState("checking");
    setError(null);
    try {
      const r = await window.electronAPI?.updaterCheck?.();
      if (r?.error) { setError(r.error); setState("error"); isManualRef.current = false; }
    } catch (e) { setError(e.message); setState("error"); isManualRef.current = false; }
  }, []);

  const handleDownload = useCallback(async () => {
    autoInstallRef.current = true;
    setState("downloading");
    setProgress({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    try {
      const r = await window.electronAPI?.updaterDownload?.();
      if (r?.manual) {
        // not packaged — opened releases page, stay in available
        setState("available");
        autoInstallRef.current = false;
        return;
      }
      if (r?.error) { setError(r.error); setState("error"); autoInstallRef.current = false; }
    } catch (e) { setError(e.message); setState("error"); autoInstallRef.current = false; }
  }, []);

  const handleInstall = useCallback(async () => {
    try { await window.electronAPI?.updaterInstall?.(); } catch (e) { setError(e.message); }
  }, []);

  const handleViewRelease = useCallback(() => {
    const url = info?.releaseUrl || info?.releaseNotesUrl || "https://github.com/TheWonderlandStudio/Idiot_Box/releases/latest";
    try { window.electronAPI?.openUrl?.(url); } catch { window.open(url, "_blank"); }
  }, [info]);

  // ── Derived progress values ────────────────────────────────────────────
  const pct = Math.min(100, Math.max(0, Math.round(progress?.percent || 0)));
  const transferred = progress?.transferred || 0;
  const total = progress?.total || 0;
  const speed = progress?.bytesPerSecond || 0;
  const eta = useMemo(() => fmtETA(progress), [progress]);

  const bannerStyle = {
    display:"flex", alignItems:"center", gap:10,
    padding:"8px 12px", fontSize:12, flexShrink:0, borderBottom:"1px solid #2d2d2d",
    position:"relative", overflow:"hidden",
  };

  // ── Center modal for manual checks (available / up-to-date) ────────────
  const manualModalEl = manualModal ? (
    <div onClick={() => setManualModal(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.58)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999, animation:"fadeIn 0.18s ease" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"linear-gradient(180deg,#2a2a2e 0%,#252526 100%)", border:"1px solid #3c3c3c", borderRadius:10, padding:"22px 22px 16px", minWidth:380, maxWidth:460, boxShadow:"0 16px 48px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset", display:"flex", flexDirection:"column", gap:14 }}>
        {manualModal === "available" ? (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:10, color:"#4ec9b0", fontSize:15, fontWeight:800, letterSpacing:0.2 }}>
              <span style={{ width:30, height:30, borderRadius:8, background:"rgba(78,201,176,0.14)", border:"1px solid rgba(78,201,176,0.28)", display:"flex", alignItems:"center", justifyContent:"center" }}><Rocket size={16} style={{color:"#4ec9b0"}} /></span>
              Update available — v{info?.version}
              <span style={{ marginLeft:"auto", fontSize:11, fontWeight:600, color:"#9ae6b4", background:"rgba(78,201,176,0.12)", border:"1px solid rgba(78,201,176,0.22)", padding:"2px 7px", borderRadius:20 }}>NEW</span>
            </div>
            <div style={{ fontSize:12.5, color:"#d4d4d4", lineHeight:1.6, background:"#1e1e1e", border:"1px solid #2d2d2d", borderRadius:8, padding:"10px 12px" }}>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, color:"#cccccc", fontSize:11, fontWeight:700, letterSpacing:0.4, textTransform:"uppercase", opacity:0.9 }}><Sparkles size={12} /> Release notes</div>
              <div style={{ maxHeight:110, overflow:"auto", whiteSpace:"pre-wrap", wordBreak:"break-word", color:"#bbbbbb", fontSize:12, lineHeight:1.55 }}>
                {info?.releaseNotes ? String(info.releaseNotes).slice(0, 900) + (String(info.releaseNotes).length > 900 ? "…" : "") : `A new version is available.\nCurrent: v${currentVersion} → Latest: v${info?.version}\nClick Update & Restart to download and install.`}
              </div>
              <button onClick={handleViewRelease} style={{ marginTop:8, display:"inline-flex", alignItems:"center", gap:4, background:"transparent", border:"none", color:"#4ec9b0", fontSize:11, cursor:"pointer", padding:0 }}>View on GitHub <ExternalLink size={11} /></button>
            </div>
            {/* Cycle stepper */}
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, color:"#8a8a8a" }}>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:"#4ec9b0", fontWeight:700 }}><CheckCircle2 size={12} /> Check</span>
              <span style={{ opacity:0.4 }}>—</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:"#4ec9b0", fontWeight:700 }}><Download size={12} /> Download</span>
              <span style={{ opacity:0.4 }}>—</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4, opacity:0.6 }}><RefreshCw size={12} /> Restart</span>
              <span style={{ marginLeft:"auto", fontSize:10, opacity:0.5 }}>v{currentVersion} → v{info?.version}</span>
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:2 }}>
              <button onClick={() => setManualModal(null)} style={{ ...btnStyle, background:"#2d2d2d", border:"1px solid #3c3c3c" }}>Later</button>
              <button onClick={() => { setManualModal(null); handleDownload(); }} style={{ ...btnStyle, background:"linear-gradient(180deg,#4ec9b0 0%,#3da58a 100%)", color:"#0d1117", fontWeight:800, boxShadow:"0 2px 10px rgba(78,201,176,0.35)" }}><Download size={14} /> Update & Restart</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:10, color:"#8fbf8f", fontSize:14, fontWeight:800 }}>
              <span style={{ width:30, height:30, borderRadius:8, background:"rgba(143,191,143,0.14)", border:"1px solid rgba(143,191,143,0.22)", display:"flex", alignItems:"center", justifyContent:"center" }}><CheckCircle2 size={16} style={{color:"#8fbf8f"}} /></span>
              You're up to date
            </div>
            <div style={{ fontSize:12.5, color:"#cccccc", lineHeight:1.6, background:"#1e1e1e", border:"1px solid #2d2d2d", borderRadius:8, padding:"12px" }}>
              <div style={{ fontWeight:700, color:"#d4d4d4" }}>v{currentVersion} is the latest version.</div>
              <div style={{ opacity:0.75, marginTop:4 }}>No update available. We'll check again automatically every 6 hours.</div>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:2 }}>
              <button onClick={() => setManualModal(null)} style={{ ...btnStyle, background:"#0e639c", color:"#fff", fontWeight:700, minWidth:72, justifyContent:"center" }}>OK</button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  // ── Downloading modal overlay (polished, centered, with progress bar) ──
  const downloadingModalEl = state === "downloading" ? (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.58)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9998, animation:"fadeIn 0.2s ease" }}>
      <div style={{ background:"linear-gradient(180deg,#2b2b30 0%,#1e1e22 100%)", border:"1px solid #3a3a3e", borderRadius:12, padding:"20px 22px 18px", width:440, maxWidth:"92vw", boxShadow:"0 20px 60px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.08) inset", display:"flex", flexDirection:"column", gap:14 }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(180deg,#1a3a5a 0%,#122a42 100%)", border:"1px solid #2a4a6a", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 10px rgba(0,0,0,0.25)" }}>
            <RefreshCw size={18} style={{ color:"#7eb8f7", animation:"spin 1s linear infinite" }} />
          </span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:800, color:"#e8e8e8", letterSpacing:0.2, display:"flex", alignItems:"center", gap:8 }}>
              Downloading update
              <span style={{ fontSize:11, fontWeight:700, color:"#7eb8f7", background:"rgba(126,184,247,0.12)", border:"1px solid rgba(126,184,247,0.22)", padding:"1px 7px", borderRadius:20 }}>v{info?.version || "…"}</span>
            </div>
            <div style={{ fontSize:11, color:"#9a9a9a", marginTop:2, display:"flex", alignItems:"center", gap:6 }}>
              <span>Proper update cycle</span>
              <span style={{ opacity:0.3 }}>•</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}><CheckCircle2 size={11} style={{color:"#4ec9b0"}} /> Check</span>
              <span style={{ opacity:0.3 }}>→</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:3, color:"#7eb8f7", fontWeight:700 }}><Download size={11} /> Download</span>
              <span style={{ opacity:0.3 }}>→</span>
              <span style={{ opacity:0.5, display:"inline-flex", alignItems:"center", gap:3 }}><RefreshCw size={11} /> Install</span>
            </div>
          </div>
          <span style={{ fontSize:18, fontWeight:800, color:"#7eb8f7", minWidth:44, textAlign:"right" }}>{pct}%</span>
        </div>

        {/* Big progress bar */}
        <div style={{ position:"relative", height:12, background:"linear-gradient(180deg,#0f1926 0%,#0d1420 100%)", border:"1px solid #1e2e4a", borderRadius:8, overflow:"hidden", boxShadow:"inset 0 1px 2px rgba(0,0,0,0.4)" }}>
          <div style={{
            width:`${pct}%`,
            height:"100%",
            background:"linear-gradient(90deg,#4ec9b0 0%,#3fb49c 50%,#2ea68a 100%)",
            borderRadius:8,
            transition:"width 0.35s cubic-bezier(0.22,1,0.36,1)",
            position:"relative",
            overflow:"hidden",
            boxShadow:"0 0 12px rgba(78,201,176,0.45)"
          }}>
            {/* shimmer */}
            <div style={{
              position:"absolute", inset:0,
              background:"linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.22) 50%, transparent 100%)",
              transform:"translateX(-100%)",
              animation:"shimmer 1.2s infinite",
            }} />
          </div>
          {/* tick marks */}
          <div style={{ position:"absolute", inset:0, display:"flex", justifyContent:"space-between", padding:"0 1px", pointerEvents:"none" }}>
            {Array.from({length:10}).map((_,i)=><div key={i} style={{ width:1, background:"rgba(255,255,255,0.06)", height:"100%" }} />)}
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          <div style={statCardStyle}>
            <div style={statLabelStyle}><Download size={11} /> Transferred</div>
            <div style={statValueStyle}>{fmtBytes(transferred)} <span style={{ opacity:0.5, fontWeight:500 }}>/</span> {fmtBytes(total)}</div>
            <div style={statSubStyle}>{pct}% completed</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}><Zap size={11} /> Speed</div>
            <div style={statValueStyle}>{fmtSpeed(speed)}</div>
            <div style={statSubStyle}>{speed > 0 ? "downloading" : "calculating…"}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}><Clock size={11} /> ETA</div>
            <div style={statValueStyle}>{eta}</div>
            <div style={statSubStyle}>remaining</div>
          </div>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color:"#8a8a8a", background:"#1e1e1e", border:"1px solid #2d2d2d", borderRadius:8, padding:"8px 10px" }}>
          <span style={{ width:6, height:6, borderRadius:"50%", background:"#4ec9b0", boxShadow:"0 0 6px #4ec9b0", animation:"pulse 1.4s infinite" }} />
          Downloading from GitHub Releases — keep the app open. Will auto-install on restart after {pct}% .
          <span style={{ marginLeft:"auto", opacity:0.6 }}>{total ? `${fmtBytes(total)} total` : ""}</span>
        </div>

        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={() => { /* keep downloading in background, just hide modal? But keep banner */ }} style={{ ...btnStyle, background:"transparent", border:"1px solid #3a3a3e", color:"#9a9a9a" }} title="Keep downloading in background (banner stays)">Background</button>
          <button onClick={handleViewRelease} style={{ ...btnStyle, background:"#2d2d2d", border:"1px solid #3c3c3c", color:"#cccccc" }}><ExternalLink size={12} /> Release</button>
        </div>
      </div>
      <style>{`
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.92); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  ) : null;

  if (state === "idle") return manualModalEl;

  if (state === "checking") {
    return (
      <>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 12px", background:"linear-gradient(90deg,#12233a 0%,#1a2a3a 100%)", borderBottom:"1px solid #2a4a6a", color:"#7eb8f7", fontSize:12, flexShrink:0 }}>
          <span style={{ width:22, height:22, borderRadius:6, background:"rgba(126,184,247,0.14)", border:"1px solid rgba(126,184,247,0.22)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <RefreshCw size={13} style={{ animation:"spin 1s linear infinite" }} />
          </span>
          <span style={{ fontWeight:700, letterSpacing:0.2 }}>Checking for updates…</span>
          <span style={{ opacity:0.7, fontSize:11 }}>Proper cycle: Check → Download → Install</span>
          {currentVersion && <span style={{ marginLeft:"auto", opacity:0.6, fontSize:11, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.08)", padding:"1px 6px", borderRadius:20 }}>v{currentVersion}</span>}
        </div>
        {manualModalEl}
        <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
      </>
    );
  }
  if (state === "not-available") {
    return (
      <>
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,#1a2a1e 0%,#1e2a1e 100%)", color:"#8fbf8f", borderBottomColor:"#2d4a2d", justifyContent:"space-between" }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap:8 }}><CheckCircle2 size={14} style={{color:"#8fbf8f"}} /> You're up to date — <b>v{currentVersion}</b> is the latest</span>
          <button onClick={() => setState("idle")} title="Dismiss" style={{ ...btnStyle, background:"transparent", border:"1px solid #2d4a2d", color:"#8fbf8f", padding:"4px 8px" }}><X size={14} /></button>
        </div>
        {manualModalEl}
      </>
    );
  }

  if (state === "error") {
    return (
      <>
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,#2a1a1a 0%,#3a1f1f 100%)", color:"#ff9a9a", borderBottomColor:"#5a2a2a" }}>
          <AlertCircle size={14} />
          <span style={{ fontWeight:600 }}>Update check failed:</span>
          <span style={{ opacity:0.9, maxWidth:420, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{String(error).slice(0,140)}</span>
          <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            <button onClick={handleCheck} style={{ ...btnStyle, background:"#ff9a9a", color:"#1a0f0f", fontWeight:700 }}><RefreshCw size={12} /> Retry</button>
            <button onClick={() => setState("idle")} style={{ ...btnStyle, background:"transparent", border:"1px solid #5a2a2a", color:"#ff9a9a" }}><X size={12} /></button>
          </div>
        </div>
        {manualModalEl}
      </>
    );
  }

  if (state === "available") {
    return (
      <>
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,#0f2a1e 0%,#1a2e1a 100%)", color:"#9ae6b4", borderBottomColor:"#2d5a2d" }}>
          <span style={{ width:24, height:24, borderRadius:7, background:"rgba(78,201,176,0.14)", border:"1px solid rgba(78,201,176,0.22)", display:"flex", alignItems:"center", justifyContent:"center" }}><Rocket size={14} style={{ color:"#4ec9b0" }} /></span>
          <span>Update available: <strong style={{ color:"#4ec9b0" }}>v{info?.version || "new"}</strong> {currentVersion ? <span style={{ opacity:0.7 }}>(current v{currentVersion})</span> : ""}</span>
          <span style={{ opacity:0.6, fontSize:11, marginLeft:4, display:"none" }}>{info?.releaseNotes ? "" : ""}</span>
          <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
            <button onClick={handleViewRelease} title="View release on GitHub" style={{ ...btnStyle, background:"transparent", border:"1px solid rgba(154,230,180,0.22)", color:"#9ae6b4", padding:"4px 8px" }}><ExternalLink size={12} /> Notes</button>
            <button onClick={handleDownload} style={{ ...btnStyle, background:"linear-gradient(180deg,#4ec9b0 0%,#3da58a 100%)", color:"#0d1117", fontWeight:800, boxShadow:"0 2px 10px rgba(78,201,176,0.32)" }}>
              <Download size={14} /> Download — {info?.version ? `v${info.version}` : ""}
            </button>
            <button onClick={() => { setState("idle"); setManualModal(null); }} title="Dismiss" style={{ ...btnStyle, background:"transparent", border:"1px solid rgba(45,90,45,0.6)", color:"#9ae6b4" }}>
              <X size={14} />
            </button>
          </div>
        </div>
        {manualModalEl}
      </>
    );
  }

  if (state === "downloading") {
    const subText = total ? `${fmtBytes(transferred)} / ${fmtBytes(total)} • ${fmtSpeed(speed)} • ETA ${eta}` : `${fmtBytes(transferred)} • ${fmtSpeed(speed)}`;
    return (
      <>
        {/* Top banner with progress */}
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,#101f36 0%,#1a2a3a 100%)", color:"#7eb8f7", borderBottomColor:"#2a4a6a", flexDirection:"column", alignItems:"stretch", gap:0, padding:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px" }}>
            <span style={{ width:24, height:24, borderRadius:7, background:"rgba(126,184,247,0.14)", border:"1px solid rgba(126,184,247,0.22)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <RefreshCw size={14} style={{ color:"#7eb8f7", animation:"spin 1s linear infinite" }} />
            </span>
            <span style={{ fontWeight:700, letterSpacing:0.2 }}>Downloading update {info?.version ? `v${info.version} ` : ""}</span>
            <span style={{ fontWeight:800, color:"#7eb8f7" }}>{pct}%</span>
            <span style={{ opacity:0.7, fontSize:11, display:"none" }}>{subText}</span>
            <span style={{ marginLeft:"auto", fontSize:11, opacity:0.85, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><Zap size={11} /> {fmtSpeed(speed)}</span>
              <span style={{ opacity:0.5 }}>•</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><Clock size={11} /> {eta}</span>
              <span style={{ opacity:0.5 }}>•</span>
              <span>{fmtBytes(transferred)}{total ? ` / ${fmtBytes(total)}` : ""}</span>
            </span>
          </div>
          {/* Full-width progress bar */}
          <div style={{ height:4, background:"rgba(13,26,42,0.9)", borderTop:"1px solid rgba(42,74,106,0.5)", position:"relative", overflow:"hidden" }}>
            <div style={{
              width:`${pct}%`,
              height:"100%",
              background:"linear-gradient(90deg,#4ec9b0 0%,#6ee7c7 50%,#4ec9b0 100%)",
              transition:"width 0.35s cubic-bezier(0.22,1,0.36,1)",
              position:"relative",
              overflow:"hidden",
              boxShadow:"0 0 8px rgba(78,201,176,0.5)",
            }}>
              <div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.24) 50%, transparent 100%)", transform:"translateX(-100%)", animation:"shimmer 1.1s infinite" }} />
            </div>
          </div>
        </div>
        {downloadingModalEl}
        {manualModalEl}
        <style>{`
          @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }
          @keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
          @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.55; } }
          @keyframes fadeIn { from { opacity:0; transform: translateY(4px);} to { opacity:1; transform: translateY(0);} }
        `}</style>
      </>
    );
  }

  if (state === "downloaded") {
    return (
      <>
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,#0f2e28 0%,#1a3a2e 100%)", color:"#9ae6b4", borderBottomColor:"#2d6a4f" }}>
          <span style={{ width:26, height:26, borderRadius:8, background:"linear-gradient(180deg,#4ec9b0 0%,#3da58a 100%)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 10px rgba(78,201,176,0.35)" }}><Download size={14} style={{ color:"#0d1117" }} /></span>
          <span>Update <strong style={{ color:"#4ec9b0" }}>v{info?.version || ""}</strong> downloaded — restart to install</span>
          <span style={{ opacity:0.6, fontSize:11, marginLeft:6, display:"none" }}>Proper cycle: Downloaded → Install</span>
          <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
            <button onClick={handleInstall} style={{ ...btnStyle, background:"linear-gradient(180deg,#4ec9b0 0%,#3da58a 100%)", color:"#0d1117", fontWeight:800, boxShadow:"0 2px 10px rgba(78,201,176,0.32)" }}>
              <RefreshCw size={14} /> Restart Now
            </button>
            <button onClick={() => { setState("idle"); setManualModal(null); }} title="Later (installs on quit)" style={{ ...btnStyle, background:"transparent", border:"1px solid rgba(45,106,79,0.6)", color:"#9ae6b4" }}>
              Later
            </button>
          </div>
        </div>
        {/* Success modal */}
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9997, animation:"fadeIn 0.18s ease" }}>
          <div style={{ background:"linear-gradient(180deg,#2a2a2e 0%,#202023 100%)", border:"1px solid #3c3c3c", borderRadius:12, padding:"20px 22px", width:400, maxWidth:"92vw", boxShadow:"0 16px 48px rgba(0,0,0,0.55)", display:"flex", flexDirection:"column", gap:12, animation:"fadeIn 0.2s ease" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, color:"#4ec9b0", fontSize:15, fontWeight:800 }}>
              <span style={{ width:32, height:32, borderRadius:9, background:"linear-gradient(180deg,#4ec9b0 0%,#3da58a 100%)", display:"flex", alignItems:"center", justifyContent:"center" }}><CheckCircle2 size={18} style={{color:"#0d1117"}} /></span>
              Update ready — v{info?.version}
            </div>
            <div style={{ fontSize:12.5, color:"#d4d4d4", lineHeight:1.6, background:"#1e1e1e", border:"1px solid #2d2d2d", borderRadius:8, padding:"12px" }}>
              <div style={{ fontWeight:700, color:"#e8e8e8" }}>Download complete ✓</div>
              <div style={{ opacity:0.8, marginTop:4 }}>Restart now to install <b>v{info?.version}</b> (current v{currentVersion}). Or close the app — it will auto-install on quit.</div>
              <div style={{ marginTop:8, display:"flex", gap:6, fontSize:11, color:"#8a8a8a" }}>
                <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}><CheckCircle2 size={11} style={{color:"#4ec9b0"}} /> Downloaded</span>
                <span>→</span>
                <span style={{ display:"inline-flex", alignItems:"center", gap:4, color:"#4ec9b0", fontWeight:700 }}><RefreshCw size={11} /> Restart</span>
              </div>
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={() => setState("idle")} style={{ ...btnStyle, background:"#2d2d2d", border:"1px solid #3c3c3c" }}>Later</button>
              <button onClick={handleInstall} style={{ ...btnStyle, background:"linear-gradient(180deg,#4ec9b0 0%,#3da58a 100%)", color:"#0d1117", fontWeight:800, boxShadow:"0 2px 10px rgba(78,201,176,0.35)" }}><RefreshCw size={14} /> Restart Now</button>
            </div>
          </div>
        </div>
        {manualModalEl}
      </>
    );
  }

  return manualModalEl;
}

const btnStyle = {
  display:"flex", alignItems:"center", gap:6,
  padding:"6px 12px", borderRadius:7, border:"none",
  fontSize:12, cursor:"pointer",
  background:"#252526", color:"#cccccc",
  fontWeight:600, letterSpacing:0.1,
  transition:"transform 0.12s, box-shadow 0.12s, background 0.12s",
};

const statCardStyle = {
  background:"linear-gradient(180deg,#1e1e20 0%,#18181a 100%)",
  border:"1px solid #2d2d2d",
  borderRadius:8,
  padding:"10px 11px",
  display:"flex", flexDirection:"column", gap:4,
};

const statLabelStyle = {
  fontSize:10, fontWeight:700, letterSpacing:0.5, textTransform:"uppercase",
  color:"#8a8a8a", display:"flex", alignItems:"center", gap:4,
};

const statValueStyle = {
  fontSize:13, fontWeight:800, color:"#e8e8e8", letterSpacing:0.2,
  display:"flex", alignItems:"center", gap:4,
};

const statSubStyle = {
  fontSize:10, color:"#7a7a7a", fontWeight:500,
};
