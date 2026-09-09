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
    // Restore AFTER subscribing — beech me aaya event miss na ho (startup race).
    // (e.g., download chal raha tha, ya check pehle complete ho chuka tha)
    window.electronAPI?.updaterGetVersion?.().then((r) => {
      if (r?.version) setCurrentVersion(r.version);
    }).catch(() => {});
    window.electronAPI?.updaterGetState?.().then((s) => {
      if (!s || !s.state) return;
      if (s.state !== "idle") {
        setState(s.state);
        if (s.info) setInfo(s.info);
        if (s.progress) setProgress(s.progress);
      }
    }).catch(() => {});
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
    display:"flex", alignItems:"center", gap:"var(--space-10)",
    padding:"var(--space-8) var(--space-12)", fontSize:"var(--fs-body)", flexShrink:0, borderBottom:"var(--space-1) solid var(--bg-active)",
    position:"relative", overflow:"hidden",
  };

  // ── Center modal for manual checks (available / up-to-date) ────────────
  const manualModalEl = manualModal ? (
    <div onClick={() => setManualModal(null)} style={{ position:"fixed", inset:0, background:"var(--overlay-a58)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:"var(--z-dialog)", animation:"fadeIn 0.18s ease" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"linear-gradient(180deg,var(--updater-dark-row) 0%,var(--bg-vscode) 100%)", border:"1px solid var(--border-strong)", borderRadius:"var(--radius-pill)", padding:"22px 22px var(--space-16)", minWidth:380, maxWidth:460, boxShadow:"0 var(--space-16) 48px var(--overlay-a55), 0 var(--space-1) 0 var(--white-a06) inset", display:"flex", flexDirection:"column", gap:"var(--space-14)" }}>
        {manualModal === "available" ? (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:"var(--space-10)", color:"var(--teal)", fontSize:"var(--fs-15)", fontWeight:"var(--fw-extrabold)", letterSpacing:0.2 }}>
              <span style={{ width:30, height:30, borderRadius:"var(--radius-xl)", background:"var(--teal-a14)", border:"1px solid var(--teal-a28)", display:"flex", alignItems:"center", justifyContent:"center" }}><Rocket size={16} style={{color:"var(--teal)"}} /></span>
              Update available — v{info?.version}
              <span style={{ marginLeft:"auto", fontSize:"var(--fs-small)", fontWeight:"var(--fw-semibold)", color:"var(--code-green-soft)", background:"var(--teal-a12)", border:"1px solid var(--teal-a22)", padding:"var(--space-2) 7px", borderRadius:"var(--radius-2xl)" }}>NEW</span>
            </div>
            <div style={{ fontSize:"var(--fs-body-plus)", color:"var(--text-highlight)", lineHeight:"var(--lh-doc)", background:"var(--bg-surface)", border:"1px solid var(--bg-active)", borderRadius:"var(--radius-xl)", padding:"var(--space-10) var(--space-12)" }}>
              <div style={{ display:"flex", gap:"var(--space-8)", alignItems:"center", marginBottom:"var(--space-6)", color:"var(--text-bright)", fontSize:"var(--fs-small)", fontWeight:"var(--fw-bold)", letterSpacing:0.4, textTransform:"uppercase", opacity:0.9 }}><Sparkles size={12} /> Release notes</div>
              <div style={{ maxHeight:110, overflow:"auto", whiteSpace:"pre-wrap", wordBreak:"break-word", color:"var(--text-soft)", fontSize:"var(--fs-body)", lineHeight:"var(--lh-md)" }}>
                {info?.releaseNotes ? String(info.releaseNotes).slice(0, 900) + (String(info.releaseNotes).length > 900 ? "…" : "") : `A new version is available.\nCurrent: v${currentVersion} → Latest: v${info?.version}\nClick Update & Restart to download and install.`}
              </div>
              <button onClick={handleViewRelease} style={{ marginTop:"var(--space-8)", display:"inline-flex", alignItems:"center", gap:"var(--space-4)", background:"transparent", border:"none", color:"var(--teal)", fontSize:"var(--fs-small)", cursor:"pointer", padding:0 }}>View on GitHub <ExternalLink size={11} /></button>
            </div>
            {/* Cycle stepper */}
            <div style={{ display:"flex", alignItems:"center", gap:"var(--space-6)", fontSize:"var(--fs-small)", color:"var(--updater-faint)" }}>
              <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-4)", color:"var(--teal)", fontWeight:"var(--fw-bold)" }}><CheckCircle2 size={12} /> Check</span>
              <span style={{ opacity:0.4 }}>—</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-4)", color:"var(--teal)", fontWeight:"var(--fw-bold)" }}><Download size={12} /> Download</span>
              <span style={{ opacity:0.4 }}>—</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-4)", opacity:0.6 }}><RefreshCw size={12} /> Restart</span>
              <span style={{ marginLeft:"auto", fontSize:"var(--fs-tiny)", opacity:0.5 }}>v{currentVersion} → v{info?.version}</span>
            </div>
            <div style={{ display:"flex", gap:"var(--space-8)", justifyContent:"flex-end", marginTop:"var(--space-2)" }}>
              <button onClick={() => setManualModal(null)} style={{ ...btnStyle, background:"var(--bg-active)", border:"1px solid var(--border-strong)" }}>Later</button>
              <button onClick={() => { setManualModal(null); handleDownload(); }} style={{ ...btnStyle, background:"var(--grad-teal)", color:"var(--ink-on-teal)", fontWeight:"var(--fw-extrabold)", boxShadow:"0 2px 10px var(--teal-a35)" }}><Download size={14} /> Update & Restart</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display:"flex", alignItems:"center", gap:"var(--space-10)", color:"var(--updater-ok)", fontSize:"var(--fs-large)", fontWeight:"var(--fw-extrabold)" }}>
              <span style={{ width:30, height:30, borderRadius:"var(--radius-xl)", background:"var(--term-green-a14)", border:"1px solid var(--term-green-a22)", display:"flex", alignItems:"center", justifyContent:"center" }}><CheckCircle2 size={16} style={{color:"var(--updater-ok)"}} /></span>
              You're up to date
            </div>
            <div style={{ fontSize:"var(--fs-body-plus)", color:"var(--text-bright)", lineHeight:"var(--lh-doc)", background:"var(--bg-surface)", border:"1px solid var(--bg-active)", borderRadius:"var(--radius-xl)", padding:"var(--space-12)" }}>
              <div style={{ fontWeight:"var(--fw-bold)", color:"var(--text-highlight)" }}>v{currentVersion} is the latest version.</div>
              <div style={{ opacity:0.75, marginTop:"var(--space-4)" }}>No update available. We'll check again automatically every 6 hours.</div>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"var(--space-2)" }}>
              <button onClick={() => setManualModal(null)} style={{ ...btnStyle, background:"var(--editor-blue)", color:"var(--text-inverse)", fontWeight:"var(--fw-bold)", minWidth:72, justifyContent:"center" }}>OK</button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  // ── Downloading modal overlay (polished, centered, with progress bar) ──
  const downloadingModalEl = state === "downloading" ? (
    <div style={{ position:"fixed", inset:0, background:"var(--overlay-a58)", backdropFilter:"blur(8px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:"var(--z-updater-top)", animation:"fadeIn 0.2s ease" }}>
      <div style={{ background:"var(--grad-modal)", border:"1px solid var(--updater-modal-border)", borderRadius:"var(--radius-3xl)", padding:"var(--space-20) 22px var(--space-18)", width:440, maxWidth:"92vw", boxShadow:"0 var(--space-20) 60px var(--overlay-dark), 0 var(--space-1) 0 var(--white-a08) inset", display:"flex", flexDirection:"column", gap:"var(--space-14)" }}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:"var(--space-12)" }}>
          <span style={{ width:36, height:36, borderRadius:"var(--radius-pill)", background:"var(--grad-icon)", border:"1px solid var(--updater-icon-border)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 10px var(--overlay-a25)" }}>
            <RefreshCw size={18} style={{ color:"var(--info-blue)", animation:"spin 1s linear infinite" }} />
          </span>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:"var(--fs-large)", fontWeight:"var(--fw-extrabold)", color:"var(--updater-title)", letterSpacing:0.2, display:"flex", alignItems:"center", gap:"var(--space-8)" }}>
              Downloading update
              <span style={{ fontSize:"var(--fs-small)", fontWeight:"var(--fw-bold)", color:"var(--info-blue)", background:"var(--info-blue-a12)", border:"1px solid var(--info-blue-a22)", padding:"var(--space-1) 7px", borderRadius:"var(--radius-2xl)" }}>v{info?.version || "…"}</span>
            </div>
            <div style={{ fontSize:"var(--fs-small)", color:"var(--updater-subtle)", marginTop:"var(--space-2)", display:"flex", alignItems:"center", gap:"var(--space-6)" }}>
              <span>Proper update cycle</span>
              <span style={{ opacity:0.3 }}>•</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-3)" }}><CheckCircle2 size={11} style={{color:"var(--teal)"}} /> Check</span>
              <span style={{ opacity:0.3 }}>→</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-3)", color:"var(--info-blue)", fontWeight:"var(--fw-bold)" }}><Download size={11} /> Download</span>
              <span style={{ opacity:0.3 }}>→</span>
              <span style={{ opacity:0.5, display:"inline-flex", alignItems:"center", gap:"var(--space-3)" }}><RefreshCw size={11} /> Install</span>
            </div>
          </div>
          <span style={{ fontSize:"var(--fs-18)", fontWeight:"var(--fw-extrabold)", color:"var(--info-blue)", minWidth:44, textAlign:"right" }}>{pct}%</span>
        </div>

        {/* Big progress bar */}
        <div style={{ position:"relative", height:12, background:"var(--grad-track)", border:"1px solid var(--updater-track-border)", borderRadius:"var(--radius-xl)", overflow:"hidden", boxShadow:"inset 0 1px 2px var(--overlay-a40)" }}>
          <div style={{
            width:`${pct}%`,
            height:"100%",
            background:"var(--grad-progress)",
            borderRadius:"var(--radius-xl)",
            transition:"width 0.35s cubic-bezier(0.22,1,0.36,1)",
            position:"relative",
            overflow:"hidden",
            boxShadow:"0 0 12px var(--teal-a45)"
          }}>
            {/* shimmer */}
            <div style={{
              position:"absolute", inset:0,
              background:"var(--grad-shimmer)",
              transform:"translateX(-100%)",
              animation:"shimmer 1.2s infinite",
            }} />
          </div>
          {/* tick marks */}
          <div style={{ position:"absolute", inset:0, display:"flex", justifyContent:"space-between", padding:"0 var(--space-1)", pointerEvents:"none" }}>
            {Array.from({length:10}).map((_,i)=><div key={i} style={{ width:1, background:"var(--white-a06)", height:"100%" }} />)}
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"var(--space-8)" }}>
          <div style={statCardStyle}>
            <div style={statLabelStyle}><Download size={11} /> Transferred</div>
            <div style={statValueStyle}>{fmtBytes(transferred)} <span style={{ opacity:0.5, fontWeight:"var(--fw-medium)" }}>/</span> {fmtBytes(total)}</div>
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

        <div style={{ display:"flex", alignItems:"center", gap:"var(--space-8)", fontSize:"var(--fs-small)", color:"var(--updater-faint)", background:"var(--bg-surface)", border:"var(--space-1) solid var(--bg-active)", borderRadius:"var(--radius-xl)", padding:"var(--space-8) var(--space-10)" }}>
          <span style={{ width:6, height:6, borderRadius:"var(--radius-round)", background:"var(--teal)", boxShadow:"0 0 6px var(--teal)", animation:"pulse 1.4s infinite" }} />
          Downloading from GitHub Releases — keep the app open. Will auto-install on restart after {pct}% .
          <span style={{ marginLeft:"auto", opacity:0.6 }}>{total ? `${fmtBytes(total)} total` : ""}</span>
        </div>

        <div style={{ display:"flex", gap:"var(--space-8)", justifyContent:"flex-end" }}>
          <button onClick={() => { /* keep downloading in background, just hide modal? But keep banner */ }} style={{ ...btnStyle, background:"transparent", border:"1px solid var(--updater-modal-border)", color:"var(--updater-subtle)" }} title="Keep downloading in background (banner stays)">Background</button>
          <button onClick={handleViewRelease} style={{ ...btnStyle, background:"var(--bg-active)", border:"1px solid var(--border-strong)", color:"var(--text-bright)" }}><ExternalLink size={12} /> Release</button>
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
        <div style={{ display:"flex", alignItems:"center", gap:"var(--space-10)", padding:"7px var(--space-12)", background:"var(--grad-info)", borderBottom:"var(--space-1) solid var(--updater-icon-border)", color:"var(--info-blue)", fontSize:"var(--fs-body)", flexShrink:0 }}>
          <span style={{ width:22, height:"var(--bar-h-sm)", borderRadius:"var(--radius-lg)", background:"var(--info-blue-a14)", border:"1px solid var(--info-blue-a22)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <RefreshCw size={13} style={{ animation:"spin 1s linear infinite" }} />
          </span>
          <span style={{ fontWeight:"var(--fw-bold)", letterSpacing:0.2 }}>Checking for updates…</span>
          <span style={{ opacity:0.7, fontSize:"var(--fs-small)" }}>Proper cycle: Check → Download → Install</span>
          {currentVersion && <span style={{ marginLeft:"auto", opacity:0.6, fontSize:"var(--fs-small)", background:"var(--white-a06)", border:"1px solid var(--white-a08)", padding:"var(--space-1) var(--space-6)", borderRadius:"var(--radius-2xl)" }}>v{currentVersion}</span>}
        </div>
        {manualModalEl}
        <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
      </>
    );
  }
  if (state === "not-available") {
    return (
      <>
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,var(--success-bg-2) 0%,var(--success-bg-3) 100%)", color:"var(--updater-ok)", borderBottomColor:"var(--updater-ok-border)", justifyContent:"space-between" }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-8)" }}><CheckCircle2 size={14} style={{color:"var(--updater-ok)"}} /> You're up to date — <b>v{currentVersion}</b> is the latest</span>
          <button onClick={() => setState("idle")} title="Dismiss" style={{ ...btnStyle, background:"transparent", border:"1px solid var(--updater-ok-border)", color:"var(--updater-ok)", padding:"var(--space-4) var(--space-8)" }}><X size={14} /></button>
        </div>
        {manualModalEl}
      </>
    );
  }

  if (state === "error") {
    return (
      <>
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,var(--updater-error-1) 0%,var(--error-bg-red) 100%)", color:"var(--error-text-pale-2)", borderBottomColor:"var(--error-border-2)" }}>
          <AlertCircle size={14} />
          <span style={{ fontWeight:"var(--fw-semibold)" }}>Update check failed:</span>
          <span style={{ opacity:0.9, maxWidth:420, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{String(error).slice(0,140)}</span>
          <div style={{ marginLeft:"auto", display:"flex", gap:"var(--space-8)" }}>
            <button onClick={handleCheck} style={{ ...btnStyle, background:"var(--error-text-pale-2)", color:"var(--error-bg-deep)", fontWeight:"var(--fw-bold)" }}><RefreshCw size={12} /> Retry</button>
            <button onClick={() => setState("idle")} style={{ ...btnStyle, background:"transparent", border:"1px solid var(--error-border-2)", color:"var(--error-text-pale-2)" }}><X size={12} /></button>
          </div>
        </div>
        {manualModalEl}
      </>
    );
  }

  if (state === "available") {
    return (
      <>
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,var(--success-bg-deep) 0%,var(--success-bg-4) 100%)", color:"var(--code-green-soft)", borderBottomColor:"var(--success-border-4)" }}>
          <span style={{ width:24, height:24, borderRadius:"var(--radius-7)", background:"var(--teal-a14)", border:"1px solid var(--teal-a22)", display:"flex", alignItems:"center", justifyContent:"center" }}><Rocket size={14} style={{ color:"var(--teal)" }} /></span>
          <span>Update available: <strong style={{ color:"var(--teal)" }}>v{info?.version || "new"}</strong> {currentVersion ? <span style={{ opacity:0.7 }}>(current v{currentVersion})</span> : ""}</span>
          <span style={{ opacity:0.6, fontSize:"var(--fs-small)", marginLeft:"var(--space-4)", display:"none" }}>{info?.releaseNotes ? "" : ""}</span>
          <div style={{ marginLeft:"auto", display:"flex", gap:"var(--space-8)", alignItems:"center" }}>
            <button onClick={handleViewRelease} title="View release on GitHub" style={{ ...btnStyle, background:"transparent", border:"1px solid var(--updater-ok-a22)", color:"var(--code-green-soft)", padding:"var(--space-4) var(--space-8)" }}><ExternalLink size={12} /> Notes</button>
            <button onClick={handleDownload} style={{ ...btnStyle, background:"var(--grad-teal)", color:"var(--ink-on-teal)", fontWeight:"var(--fw-extrabold)", boxShadow:"0 2px 10px var(--teal-a32)" }}>
              <Download size={14} /> Download — {info?.version ? `v${info.version}` : ""}
            </button>
            <button onClick={() => { setState("idle"); setManualModal(null); }} title="Dismiss" style={{ ...btnStyle, background:"transparent", border:"1px solid var(--updater-ok-dim)", color:"var(--code-green-soft)" }}>
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
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,var(--updater-info-0) 0%,var(--updater-info-2) 100%)", color:"var(--info-blue)", borderBottomColor:"var(--updater-icon-border)", flexDirection:"column", alignItems:"stretch", gap:0, padding:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:"var(--space-10)", padding:"var(--space-8) var(--space-12)" }}>
            <span style={{ width:24, height:24, borderRadius:"var(--radius-7)", background:"var(--info-blue-a14)", border:"1px solid var(--info-blue-a22)", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <RefreshCw size={14} style={{ color:"var(--info-blue)", animation:"spin 1s linear infinite" }} />
            </span>
            <span style={{ fontWeight:"var(--fw-bold)", letterSpacing:0.2 }}>Downloading update {info?.version ? `v${info.version} ` : ""}</span>
            <span style={{ fontWeight:"var(--fw-extrabold)", color:"var(--info-blue)" }}>{pct}%</span>
            <span style={{ opacity:0.7, fontSize:"var(--fs-small)", display:"none" }}>{subText}</span>
            <span style={{ marginLeft:"auto", fontSize:"var(--fs-small)", opacity:0.85, display:"flex", alignItems:"center", gap:"var(--space-8)" }}>
              <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-4)" }}><Zap size={11} /> {fmtSpeed(speed)}</span>
              <span style={{ opacity:0.5 }}>•</span>
              <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-4)" }}><Clock size={11} /> {eta}</span>
              <span style={{ opacity:0.5 }}>•</span>
              <span>{fmtBytes(transferred)}{total ? ` / ${fmtBytes(total)}` : ""}</span>
            </span>
          </div>
          {/* Full-width progress bar */}
          <div style={{ height:4, background:"var(--updater-track-fill)", borderTop:"1px solid var(--updater-track-line)", position:"relative", overflow:"hidden" }}>
            <div style={{
              width:`${pct}%`,
              height:"100%",
              background:"linear-gradient(90deg,var(--teal) 0%,var(--teal-pale) 50%,var(--teal) 100%)",
              transition:"width 0.35s cubic-bezier(0.22,1,0.36,1)",
              position:"relative",
              overflow:"hidden",
              boxShadow:"0 0 8px var(--teal-a50)",
            }}>
              <div style={{ position:"absolute", inset:0, background:"linear-gradient(90deg, transparent 0%, var(--white-a24) 50%, transparent 100%)", transform:"translateX(-100%)", animation:"shimmer 1.1s infinite" }} />
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
        <div style={{ ...bannerStyle, background:"linear-gradient(90deg,var(--updater-teal-1) 0%,var(--updater-teal-2) 100%)", color:"var(--code-green-soft)", borderBottomColor:"var(--success-border)" }}>
          <span style={{ width:26, height:"var(--bar-h)", borderRadius:"var(--radius-xl)", background:"var(--grad-teal)", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 10px var(--teal-a35)" }}><Download size={14} style={{ color:"var(--ink-on-teal)" }} /></span>
          <span>Update <strong style={{ color:"var(--teal)" }}>v{info?.version || ""}</strong> downloaded — restart to install</span>
          <span style={{ opacity:0.6, fontSize:"var(--fs-small)", marginLeft:"var(--space-6)", display:"none" }}>Proper cycle: Downloaded → Install</span>
          <div style={{ marginLeft:"auto", display:"flex", gap:"var(--space-8)" }}>
            <button onClick={handleInstall} style={{ ...btnStyle, background:"var(--grad-teal)", color:"var(--ink-on-teal)", fontWeight:"var(--fw-extrabold)", boxShadow:"0 2px 10px var(--teal-a32)" }}>
              <RefreshCw size={14} /> Restart Now
            </button>
            <button onClick={() => { setState("idle"); setManualModal(null); }} title="Later (installs on quit)" style={{ ...btnStyle, background:"transparent", border:"1px solid var(--updater-teal-dim)", color:"var(--code-green-soft)" }}>
              Later
            </button>
          </div>
        </div>
        {/* Success modal */}
        <div style={{ position:"fixed", inset:0, background:"var(--overlay-a55)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:"var(--z-updater)", animation:"fadeIn 0.18s ease" }}>
          <div style={{ background:"linear-gradient(180deg,var(--updater-dark-row) 0%,var(--updater-dark-2) 100%)", border:"1px solid var(--border-strong)", borderRadius:"var(--radius-3xl)", padding:"var(--space-20) 22px", width:400, maxWidth:"92vw", boxShadow:"0 var(--space-16) 48px var(--overlay-a55)", display:"flex", flexDirection:"column", gap:"var(--space-12)", animation:"fadeIn 0.2s ease" }}>
            <div style={{ display:"flex", alignItems:"center", gap:"var(--space-10)", color:"var(--teal)", fontSize:"var(--fs-15)", fontWeight:"var(--fw-extrabold)" }}>
              <span style={{ width:32, height:"var(--bar-h-lg)", borderRadius:"var(--radius-9)", background:"var(--grad-teal)", display:"flex", alignItems:"center", justifyContent:"center" }}><CheckCircle2 size={18} style={{color:"var(--ink-on-teal)"}} /></span>
              Update ready — v{info?.version}
            </div>
            <div style={{ fontSize:"var(--fs-body-plus)", color:"var(--text-highlight)", lineHeight:"var(--lh-doc)", background:"var(--bg-surface)", border:"1px solid var(--bg-active)", borderRadius:"var(--radius-xl)", padding:"var(--space-12)" }}>
              <div style={{ fontWeight:"var(--fw-bold)", color:"var(--updater-title)" }}>Download complete ✓</div>
              <div style={{ opacity:0.8, marginTop:"var(--space-4)" }}>Restart now to install <b>v{info?.version}</b> (current v{currentVersion}). Or close the app — it will auto-install on quit.</div>
              <div style={{ marginTop:"var(--space-8)", display:"flex", gap:"var(--space-6)", fontSize:"var(--fs-small)", color:"var(--updater-faint)" }}>
                <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-4)" }}><CheckCircle2 size={11} style={{color:"var(--teal)"}} /> Downloaded</span>
                <span>→</span>
                <span style={{ display:"inline-flex", alignItems:"center", gap:"var(--space-4)", color:"var(--teal)", fontWeight:"var(--fw-bold)" }}><RefreshCw size={11} /> Restart</span>
              </div>
            </div>
            <div style={{ display:"flex", gap:"var(--space-8)", justifyContent:"flex-end" }}>
              <button onClick={() => setState("idle")} style={{ ...btnStyle, background:"var(--bg-active)", border:"1px solid var(--border-strong)" }}>Later</button>
              <button onClick={handleInstall} style={{ ...btnStyle, background:"var(--grad-teal)", color:"var(--ink-on-teal)", fontWeight:"var(--fw-extrabold)", boxShadow:"0 2px 10px var(--teal-a35)" }}><RefreshCw size={14} /> Restart Now</button>
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
  display:"flex", alignItems:"center", gap:"var(--space-6)",
  padding:"var(--space-6) var(--space-12)", borderRadius:"var(--radius-7)", border:"none",
  fontSize:"var(--fs-body)", cursor:"pointer",
  background:"var(--bg-vscode)", color:"var(--text-bright)",
  fontWeight:"var(--fw-semibold)", letterSpacing:0.1,
  transition:"transform var(--t-med), box-shadow var(--t-med), background var(--t-med)",
};

const statCardStyle = {
  background:"linear-gradient(180deg,var(--modal-deep-1) 0%,var(--modal-deep-2) 100%)",
  border:"1px solid var(--bg-active)",
  borderRadius:"var(--radius-xl)",
  padding:"var(--space-10) 11px",
  display:"flex", flexDirection:"column", gap:"var(--space-4)",
};

const statLabelStyle = {
  fontSize:"var(--fs-tiny)", fontWeight:"var(--fw-bold)", letterSpacing:0.5, textTransform:"uppercase",
  color:"var(--updater-faint)", display:"flex", alignItems:"center", gap:"var(--space-4)",
};

const statValueStyle = {
  fontSize:"var(--fs-title)", fontWeight:"var(--fw-extrabold)", color:"var(--updater-title)", letterSpacing:0.2,
  display:"flex", alignItems:"center", gap:"var(--space-4)",
};

const statSubStyle = {
  fontSize:"var(--fs-tiny)", color:"var(--updater-mute)", fontWeight:"var(--fw-medium)",
};
