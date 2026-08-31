import React, { useState, useEffect, useCallback } from "react";
import { Download, RefreshCw, X, Rocket, AlertCircle } from "lucide-react";

export default function UpdaterBanner() {
  const [state, setState] = useState("idle"); // idle | checking | available | downloading | downloaded | error | not-available
  const [info, setInfo] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [currentVersion, setCurrentVersion] = useState("");
  const autoInstallRef = React.useRef(false);

  useEffect(() => {
    window.electronAPI?.updaterGetVersion?.().then((r) => {
      if (r?.version) setCurrentVersion(r.version);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const unsubs = [];
    if (window.electronAPI?.onUpdaterChecking) unsubs.push(window.electronAPI.onUpdaterChecking(() => { setState("checking"); setError(null); autoInstallRef.current = false; }));
    if (window.electronAPI?.onUpdaterAvailable) unsubs.push(window.electronAPI.onUpdaterAvailable((i) => { setInfo(i); setState("available"); setProgress(null); }));
    if (window.electronAPI?.onUpdaterNotAvailable) unsubs.push(window.electronAPI.onUpdaterNotAvailable(() => { setState("not-available"); setTimeout(() => setState("idle"), 3000); }));
    if (window.electronAPI?.onUpdaterError) unsubs.push(window.electronAPI.onUpdaterError((e) => { setError(e); setState("error"); autoInstallRef.current = false; }));
    if (window.electronAPI?.onUpdaterProgress) unsubs.push(window.electronAPI.onUpdaterProgress((p) => { setProgress(p); setState("downloading"); }));
    if (window.electronAPI?.onUpdaterDownloaded) unsubs.push(window.electronAPI.onUpdaterDownloaded((i) => {
      setInfo(i); setState("downloaded"); setProgress(null);
      // If user clicked "Update & Restart", auto-restart after short delay
      if (autoInstallRef.current) {
        setTimeout(() => { try { window.electronAPI?.updaterInstall?.(); } catch {} }, 1200);
      }
    }));
    return () => unsubs.forEach((u) => { try { u(); } catch {} });
  }, []);

  const handleCheck = useCallback(async () => {
    setState("checking");
    setError(null);
    try {
      const r = await window.electronAPI?.updaterCheck?.();
      if (r?.error) { setError(r.error); setState("error"); }
    } catch (e) { setError(e.message); setState("error"); }
  }, []);

  const handleDownload = useCallback(async () => {
    autoInstallRef.current = true;
    setState("downloading");
    setProgress({ percent: 0 });
    try {
      const r = await window.electronAPI?.updaterDownload?.();
      if (r?.error) { setError(r.error); setState("error"); autoInstallRef.current = false; }
      // download will trigger 'downloaded' event -> autoInstallRef will cause restart
    } catch (e) { setError(e.message); setState("error"); autoInstallRef.current = false; }
  }, []);

  const handleInstall = useCallback(async () => {
    try { await window.electronAPI?.updaterInstall?.(); } catch (e) { setError(e.message); }
  }, []);

  // Don't show banner in idle/not-available unless user manually checks? But spec says show update button if new releases available -> so only show when available/downloading/downloaded/error
  if (state === "idle" || state === "checking" || state === "not-available") {
    // Show subtle checking indicator? For now hide unless error
    if (state === "checking") {
      return (
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 12px", background:"#1a2a3a", borderBottom:"1px solid #2a4a6a", color:"#7eb8f7", fontSize:12, flexShrink:0 }}>
          <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }} />
          <span>Checking for updates...</span>
          {currentVersion && <span style={{ marginLeft:"auto", opacity:0.6, fontSize:11 }}>v{currentVersion}</span>}
        </div>
      );
    }
    return null;
  }

  const bannerStyle = {
    display:"flex", alignItems:"center", gap:10,
    padding:"8px 12px", fontSize:12, flexShrink:0, borderBottom:"1px solid #2d2d2d",
  };

  if (state === "error") {
    return (
      <div style={{ ...bannerStyle, background:"#3a1f1f", color:"#ff9a9a", borderBottomColor:"#5a2a2a" }}>
        <AlertCircle size={14} />
        <span>Update check failed: {String(error).slice(0,120)}</span>
        <button onClick={handleCheck} style={btnStyle}>Retry</button>
        <button onClick={() => setState("idle")} style={{ ...btnStyle, background:"transparent", border:"1px solid #5a2a2a", color:"#ff9a9a" }}><X size={12} /></button>
      </div>
    );
  }

  if (state === "available") {
    return (
      <div style={{ ...bannerStyle, background:"#1a2e1a", color:"#9ae6b4", borderBottomColor:"#2d5a2d" }}>
        <Rocket size={16} style={{ color:"#4ec9b0" }} />
        <span>Update available: <strong>v{info?.version || "new"}</strong> {currentVersion ? `(current v${currentVersion})` : ""}</span>
        <span style={{ opacity:0.7, fontSize:11, marginLeft:4 }}>{info?.releaseNotes ? "" : ""}</span>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          <button onClick={handleDownload} style={{ ...btnStyle, background:"#4ec9b0", color:"#0d1117", fontWeight:700 }}>
            <Download size={14} /> Update & Restart
          </button>
          <button onClick={() => setState("idle")} title="Dismiss" style={{ ...btnStyle, background:"transparent", border:"1px solid #2d5a2d", color:"#9ae6b4" }}>
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (state === "downloading") {
    const pct = Math.round(progress?.percent || 0);
    return (
      <div style={{ ...bannerStyle, background:"#1a2a3a", color:"#7eb8f7", borderBottomColor:"#2a4a6a" }}>
        <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }} />
        <span>Downloading update {info?.version ? `v${info.version} ` : ""}... {pct}%</span>
        <div style={{ flex:1, maxWidth:200, height:6, background:"#0d1a2a", borderRadius:3, overflow:"hidden", margin:"0 8px" }}>
          <div style={{ width:`${pct}%`, height:"100%", background:"#4ec9b0", transition:"width 0.3s" }} />
        </div>
        <span style={{ fontSize:11, opacity:0.7 }}>{progress?.transferred ? `${(progress.transferred/1024/1024).toFixed(1)} MB` : ""}</span>
      </div>
    );
  }

  if (state === "downloaded") {
    return (
      <div style={{ ...bannerStyle, background:"#1a3a2e", color:"#9ae6b4", borderBottomColor:"#2d6a4f" }}>
        <Download size={16} style={{ color:"#4ec9b0" }} />
        <span>Update <strong>v{info?.version || ""}</strong> ready — restart to install</span>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          <button onClick={handleInstall} style={{ ...btnStyle, background:"#4ec9b0", color:"#0d1117", fontWeight:700 }}>
            <RefreshCw size={14} /> Restart Now
          </button>
          <button onClick={() => setState("idle")} title="Later" style={{ ...btnStyle, background:"transparent", border:"1px solid #2d6a4f", color:"#9ae6b4" }}>
            Later
          </button>
        </div>
      </div>
    );
  }

  return null;
}

const btnStyle = {
  display:"flex", alignItems:"center", gap:6,
  padding:"4px 10px", borderRadius:4, border:"none",
  fontSize:12, cursor:"pointer",
  background:"#252526", color:"#cccccc",
};
