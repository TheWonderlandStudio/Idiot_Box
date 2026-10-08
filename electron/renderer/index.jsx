import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { createPortal } from "react-dom";
import { Play, ChevronDown, Bug, PlayCircle, Settings2, Home, FolderPlus, FolderOpen, Search } from "lucide-react";
import { Layout, Model, Actions, DockLocation } from "flexlayout-react";
import "./variables.css";
import "flexlayout-react/style/dark.css";
import "./layout.css";
import "./responsive.css";
import "./components/shared/titlebarA11y.js"; // titlebar menu Tab access (CET tabindex fix)

import MediaViewer from "./components/MediaViewer/index.jsx";
import { isMediaFile } from "./components/MediaViewer/mediaTypes.js";
import BrowserPanel from "./components/Browser/index.jsx";
import ProjectPanel from "./components/Project/index.jsx";
import ProjectHub from "./components/Project/Hub.jsx";
import EditorPanel from "./components/Editor/index.jsx";
import NotebookPanel from "./components/Notebook/index.jsx";
import TerminalPanel from "./components/Terminal/index.jsx";
import BlankPanel, { bumpPanelUsage } from "./components/Blank/index.jsx";
import ComponentPreview from "./components/ComponentPreview/index.jsx";
import CommunityPanel from "./components/CommunityPanel/index.jsx";
import CanvasPanel from "./components/Canvas/index.jsx";
import OpenPencilPanel from "./components/OpenPencil/index.jsx";
import CommandPalette from "./components/CommandPalette/index.jsx";
import OnboardingPage from "./components/Onboarding/index.jsx";
import SearchPanel from "./components/SearchPanel/index.jsx";
import ProblemsPanel from "./components/Problems/index.jsx";
import RunPanel from "./components/RunPanel/index.jsx";
import OutputPanel, { OutputIcon } from "./components/Output/index.jsx";
import GitPanel from "./components/GitPanel/index.jsx";
import PortsPanel from "./components/Ports/index.jsx";
import AndroidEmulatorPanel from "./components/AndroidEmulator/index.jsx";
import AIAgentPanel from "./components/OpenCodePanel/index.jsx";
import UpdaterBanner from "./components/UpdaterBanner/index.jsx";

const DEFAULT_JSON = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    tabEnableDrag: true,
    tabEnablePopout: true,
    tabEnablePopoutIcon: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrop: true,
    tabSetHeaderShown: true,
    tabSetTabStripHeight: 26,
    splitterSize: 6,
    splitterExtra: 8,
    tabSetMinWidth: 100,
    tabSetMinHeight: 80,
    borderMinSize: 80,
    enableUseVisibility: true,
  },
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "row", weight: 75,
        children: [
          {
            type: "row", weight: 65,
            children: [
              { type: "tabset", weight: 30, children: [{ type: "tab", name: "Media Viewer", component: "mediaViewer" }] },
              { type: "tabset", weight: 70, children: [{ type: "tab", name: "Browser", component: "panel3", config: { type: "browser", title: "Browser" } }] },
            ],
          },
          {
            type: "tabset", weight: 35,
            children: [
              { type: "tab", name: "Project", component: "projectPanel" },
              { type: "tab", name: "Terminal", component: "terminal", id: "terminal-tab" },
              { type: "tab", name: "Ports", component: "ports" },
              { type: "tab", name: "Problems", component: "problems" },
              { type: "tab", name: "Output", component: "output" },
              { type: "tab", name: "Run & Debug", component: "runDebug" },
            ],
          },
        ],
      },
      {
        type: "tabset", weight: 25, id: "editor-tabset",
        children: [
          { type: "tab", name: "Editor", component: "editor" },
        ],
      },
      
    ],
  },
};

// Blank workspace layout (Create Project → "Blank workspace"): sirf ek blank
// panel — user khud panels kholta hai. tabs.json ka `layout: "blank"` isko trigger karta hai.
const BLANK_JSON = {
  global: { ...DEFAULT_JSON.global },
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "tabset",
        weight: 100,
        children: [{ type: "tab", name: "New Panel", component: "blank" }],
      },
    ],
  },
};

// Panel content by tab-JSON — factory (tab node ke JSON attributes) isse
// render karta hai: component + config + nodeId ek jagah se.
const renderPanelContent = (json) => {
  const config = json?.config || {};
  const nodeId = json?.id;
  switch (json?.component) {
    case "mediaViewer":       return <MediaViewer />;
    case "panel3":            return <BrowserPanel config={config} nodeId={nodeId} />;
    case "projectPanel":      return <ProjectPanel />;
    case "projectHub":      return <ProjectHub />;
    case "editor":            return <EditorPanel config={config} nodeId={nodeId} />;
    case "notebook":          return <NotebookPanel config={config} nodeId={nodeId} />;
    case "terminal":          return <TerminalPanel config={config} nodeId={nodeId} />;
    case "blank":             return <BlankPanel config={config} nodeId={nodeId} />;
    case "componentPreview":  return <ComponentPreview config={config} nodeId={nodeId} />;
    case "community":         return <CommunityPanel config={config} nodeId={nodeId} />;
    case "canvas":            return <CanvasPanel config={config} nodeId={nodeId} />;
    case "openPencil":        return <OpenPencilPanel config={config} nodeId={nodeId} />;
    case "problems":          return <ProblemsPanel />;
    case "runDebug":          return <RunPanel />;
    case "output":            return <OutputPanel />;
    case "gitPanel":          return <GitPanel nodeId={nodeId} />;
    case "ports":             return <PortsPanel />;
    case "androidEmulator":   return <AndroidEmulatorPanel />;
    case "aiAgent":           return <AIAgentPanel />;
    default:                  return null;
  }
};

const factory = (node) => {
  try {
    return (
      <CrashSafeWrapper cid={node.getId()}>
        {renderPanelContent({ component: node.getComponent(), config: node.getConfig(), id: node.getId() })}
      </CrashSafeWrapper>
    );
  } catch (e) {
    return (
      <div style={{ padding: 16, color: "var(--ink-muted)", fontFamily: "inherit", fontSize: 12 }}>
        <div style={{ fontWeight: 700, color: "var(--danger)", marginBottom: 6 }}>Panel Load Failed</div>
        <div style={{ whiteSpace: "pre-wrap", opacity: 0.85 }}>{String(e?.stack || e?.message || e)}</div>
      </div>
    );
  }
};

// ── Crash-safe wrapper: har tab ka root iske andar chalta hai.
// Popout / normal cases me kisi bhi panel ke throw hone se
// poore FlexLayout tree ko crash hone se bachata hai.
class CrashSafeWrapper extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    try { console.error(`[CrashSafeWrapper:${this.props.cid || "?"}]`, err, info); } catch {}
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 16, color: "var(--ink-muted)", fontFamily: "inherit", fontSize: 12, background: "var(--bg-danger-soft)", height: "100%", boxSizing: "border-box", overflow: "auto" }}>
          <div style={{ fontWeight: 700, color: "var(--danger)", marginBottom: 8, fontSize: 13 }}>Something went wrong while loading this panel.</div>
          <button onClick={() => this.setState({ err: null })} style={{ marginBottom: 10, padding: "6px 12px", fontSize: 12, cursor: "pointer", background: "var(--bg-button)", color: "var(--ink)", border: "1px solid var(--border-strong)", borderRadius: 6 }}>Retry</button>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 11, opacity: 0.9 }}>{String(this.state.err?.stack || this.state.err?.message || this.state.err)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Updater nav button — bottom bar with proper cycle & progress bar ──
const UpdaterNavButton = () => {
  const [state, setState] = React.useState("idle");
  const [info, setInfo] = React.useState(null);
  const [progress, setProgress] = React.useState(null);
  React.useEffect(() => {
    const unsubs = [];
    if (window.electronAPI?.onUpdaterAvailable) unsubs.push(window.electronAPI.onUpdaterAvailable((i)=>{ setInfo(i); setState("available"); setProgress(null); }));
    if (window.electronAPI?.onUpdaterChecking) unsubs.push(window.electronAPI.onUpdaterChecking(()=> setState(prev=> prev==="available"||prev==="downloaded"||prev==="downloading"?prev:"checking")));
    if (window.electronAPI?.onUpdaterNotAvailable) unsubs.push(window.electronAPI.onUpdaterNotAvailable(()=> setState(prev=> prev==="available"||prev==="downloading"||prev==="downloaded"?prev:"idle")));
    if (window.electronAPI?.onUpdaterDownloaded) unsubs.push(window.electronAPI.onUpdaterDownloaded((i)=>{ setInfo(i); setState("downloaded"); setProgress(null); }));
    if (window.electronAPI?.onUpdaterProgress) unsubs.push(window.electronAPI.onUpdaterProgress((p)=>{ setProgress(p); setState("downloading"); }));
    if (window.electronAPI?.onUpdaterError) unsubs.push(window.electronAPI.onUpdaterError(()=> { setState("idle"); setProgress(null); }));
    return ()=> unsubs.forEach(u=>{try{u()}catch{}});
  }, []);
  if (state === "checking") return <span title="Checking for updates…" style={{background:"var(--info-blue-a12)", color:"var(--info-blue)", border:"1px solid var(--info-blue-a18)", fontSize:"var(--fs-mini)", padding:"var(--space-2) var(--space-8)", borderRadius:"var(--radius-sm)", display:"flex", alignItems:"center", gap:"var(--space-4)"}}>↻ Checking…</span>;
  if (state === "downloading") {
    const pct = Math.round(progress?.percent || 0);
    const mb = progress?.transferred ? `${(progress.transferred/1024/1024).toFixed(1)} MB` : "";
    return (
      <span title={`Downloading v${info?.version||""} ${pct}% ${mb} • ${progress?.bytesPerSecond ? (progress.bytesPerSecond/1024/1024).toFixed(1)+' MB/s' : ''}`} style={{background:"var(--grad-teal-soft)", color:"var(--teal)", border:"1px solid var(--teal-border-soft)", fontSize:"var(--fs-mini)", padding:"var(--space-3) var(--space-8)", borderRadius:"var(--radius-md)", display:"flex", alignItems:"center", gap:"var(--space-6)", minWidth:120, position:"relative", overflow:"hidden"}}>
        <span style={{position:"absolute", left:0, top:0, bottom:0, width:`${pct}%`, background:"var(--teal-a22)", transition:"width var(--t-progress)", borderRadius:"var(--radius-sm)"}} />
        <span style={{position:"relative", display:"flex", alignItems:"center", gap:"var(--space-4)", fontWeight:"var(--fw-bold)"}}><span style={{display:"inline-block", width:8, height:8, border:"1.5px solid var(--teal)", borderTopColor:"transparent", borderRadius:"var(--radius-round)", animation:"spin 0.9s linear infinite"}} /> {pct}%</span>
        <span style={{position:"relative", opacity:0.8, fontSize:"var(--fs-tiny)"}}>{mb}</span>
      </span>
    );
  }
  if (state === "downloaded") return <button onClick={()=>{ try{window.electronAPI.updaterInstall()}catch{} }} title="Restart to install update" style={{background:"var(--grad-teal)", color:"var(--ink-on-teal)", fontWeight:"var(--fw-extrabold)", border:"none", borderRadius:"var(--radius-md)", fontSize:"var(--fs-mini)", padding:"var(--space-3) var(--space-10)", cursor:"pointer", boxShadow:"0 var(--space-2) var(--space-8) var(--teal-a30)"}}>↻ Restart v{info?.version||""}</button>;
  if (state !== "available") return null;
  return <button onClick={async()=>{ try{ await window.electronAPI.updaterDownload(); }catch{ try{window.electronAPI.openUrl("https://github.com/TheWonderlandStudio/Idiot_Box/releases/latest")}catch{} } }} title={`Update available v${info?.version||""} — click to download`} style={{background:"var(--grad-teal)", color:"var(--ink-on-teal)", fontWeight:"var(--fw-extrabold)", border:"none", borderRadius:"var(--radius-md)", fontSize:"var(--fs-mini)", padding:"var(--space-3) var(--space-10)", cursor:"pointer", display:"flex", alignItems:"center", gap:"var(--space-4)", animation:"pulse 1.5s infinite", boxShadow:"0 var(--space-2) var(--space-8) var(--teal-a32)"}}>⬇ Update v{info?.version||"new"}</button>;
};

// ── Run status-bar button — visual replacement for the menu-bar Run menu ──
// Main click → project auto-command first (npm run dev / ...), else open file.
// Dropdown caret → ALL run options (Auto, Current File, npm scripts, customs)
// Run panel se `run:options` par aate hain; click → panel kholo + chalao.
const RunStatusButton = () => {
  const [open, setOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [runLabel, setRunLabel] = React.useState("");
  const [hovered, setHovered] = React.useState(false);
  const [runOptions, setRunOptions] = React.useState([]);
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    const onStatus = (event) => {
      const detail = event?.detail || {};
      setRunning(!!detail.running);
      setRunLabel(detail.label || "");
    };
    const onOptions = (event) => {
      try {
        const list = event?.detail?.options;
        if (Array.isArray(list)) setRunOptions(list);
      } catch {}
    };
    window.addEventListener("run:status", onStatus);
    window.addEventListener("run:options", onOptions);
    return () => {
      window.removeEventListener("run:status", onStatus);
      window.removeEventListener("run:options", onOptions);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      try { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); } catch {}
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Koi option chuni → panel kholo (mount) + poll ke liye pending rakho.
  // Run panel 700ms poll me use utha kar chalata hai (mount-race safe).
  const runOption = (id) => {
    setOpen(false);
    try {
      window.__pendingRunOption = { id };
      window.dispatchEvent(new CustomEvent("add-run-panel"));
    } catch {}
  };

  const dispatch = (channel) => {
    setOpen(false);
    try {
      if (channel === "runAuto") {
        if (running) {
          window.dispatchEvent(new CustomEvent("run:stopCurrent"));
          return;
        }
        window.__pendingAutoRun = { auto: true };
        window.dispatchEvent(new CustomEvent("add-run-panel"));
        window.dispatchEvent(new CustomEvent("run:request"));
        return;
      }
      window.dispatchEvent(new CustomEvent(channel));
    } catch {}
  };

  const base = {
    background: hovered ? "linear-gradient(180deg, #43c35b, #2fa349)" : "linear-gradient(180deg, #3cb454, #2f9e44)",
    border: "1px solid rgba(255, 255, 255, 0.16)", color: "#fff", fontSize: 12, letterSpacing: 0.01,
    fontFamily: "inherit", fontWeight: 600,
    height: 26, boxSizing: "border-box", cursor: "pointer", WebkitAppRegion: "no-drag",
    transition: "background 140ms ease, box-shadow 140ms ease, border-color 140ms ease",
    boxShadow: hovered
      ? "0 6px 16px rgba(47, 158, 68, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.22)"
      : "0 3px 10px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.14)",
  };
  const stopBase = running ? {
    ...base,
    background: hovered ? "linear-gradient(180deg, #ef5f57, #cf3535)" : "linear-gradient(180deg, #e5534b, #c92a2a)",
    boxShadow: hovered
      ? "0 6px 16px rgba(201, 42, 42, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.2)"
      : "0 3px 10px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
  } : base;
  const menuItem = {
    height: 34, display: "flex", alignItems: "center", gap: 10, width: "100%",
    padding: "0 10px", border: 0, borderRadius: 6, background: "transparent",
    color: "#c9c9d4", fontSize: 12.5, textAlign: "left", cursor: "pointer",
    fontFamily: "inherit", WebkitAppRegion: "no-drag",
  };

  return (
    <span ref={wrapRef} style={{ position: "absolute", left: "50%", top: 2, transform: "translateX(-50%)", display: "inline-flex", zIndex: 100, borderRadius: 5 }}>
      <button
        onClick={() => dispatch("runAuto")}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={running ? `Stop ${runLabel || "current run"}` : "Run — project command first (npm run dev …), else open file. ▾ = all options"}
        aria-label={running ? "Stop current run" : "Run project or open file"}
        style={{
          ...stopBase,
          borderTopLeftRadius: 5, borderBottomLeftRadius: 5, borderRight: "none",
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "0 11px",
        }}
      >
        {running ? <span style={{ width: 11, height: 11, background: "currentColor", borderRadius: 2 }} /> : <Play size={12} strokeWidth={2.4} fill="currentColor" />}
        {running ? "Stop" : "Run"}
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title="Run menu — every run option, one click"
        aria-label="Run options"
        style={{
          ...stopBase,
          borderTopRightRadius: 5, borderBottomRightRadius: 5,
          borderLeft: "1px solid rgba(255, 255, 255, 0.18)",
          display: "inline-flex", alignItems: "center", padding: "0 7px",
        }}
      >
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 7px)", right: 0, zIndex: "var(--z-menu)",
          background: "#1b1b1b", border: "1px solid #343434", borderRadius: 6,
          boxShadow: "0 12px 35px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.25)",
          minWidth: 250, maxWidth: 340, padding: 5, overflow: "hidden", display: "flex", flexDirection: "column",
        }}>
          <button
            onClick={() => dispatch("runAuto")}
            style={menuItem}
            title={running ? `Stop ${runLabel || "current run"}` : "Run — project command first, else open file"}
          >
            <Play size={15} strokeWidth={1.8} fill="currentColor" /> <span>{running ? "Stop" : "Run"}</span>
          </button>
          {runOptions.length > 0 && (
            <div style={{ height: 1, background: "#303030", margin: "5px 4px" }} />
          )}
          {runOptions.map((o) => (
            <button
              key={o.id}
              onClick={() => { if (!o.disabled) runOption(o.id); }}
              disabled={!!o.disabled}
              style={{
                ...menuItem,
                height: "auto", minHeight: 36, padding: "6px 10px",
                opacity: o.disabled ? 0.45 : 1,
                cursor: o.disabled ? "default" : "pointer",
              }}
              title={o.disabled ? `${o.name} — ${o.hint || "unavailable"}` : (o.hint || o.name)}
            >
              <Play size={13} strokeWidth={1.8} fill="currentColor" style={{ flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                {o.name}
              </span>
            </button>
          ))}
          {runOptions.length === 0 && (
            <div style={{ fontSize: 12, color: "#8a8a8a", padding: "6px 10px" }}>
              Open Run &amp; Debug once — options appear here
            </div>
          )}
          <div style={{ height: 1, background: "#303030", margin: "5px 4px" }} />
          <button onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("add-run-panel")); }} style={menuItem} title="Run Configuration">
            <Settings2 size={15} strokeWidth={1.8} /> <span>Run Configuration</span>
          </button>
        </div>
      )}
    </span>
  );
};

// ── Title bar right: Layouts box — saved panel layouts dropdown ────────────
// (Pehle ye box sirf hub par wapas bhejta tha — ab uska link dropdown ke
// footer me hai; primary kaam = current layout save/apply karna.)
const layoutWhen = (ts) => {
  try {
    const diff = Date.now() - Number(ts || 0);
    if (diff < 60000) return "now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return ""; }
};

// Built-in defaults — dropdown me hamesha top par 2 rows: Normal (default)
// aur Blank. Ye saved presets nahi hain, isliye delete option nahi hota.
const BUILTIN_LAYOUTS = [
  { id: "__builtin_default", name: "Default layout", panels: DEFAULT_JSON, layout: "normal" },
  { id: "__builtin_blank", name: "Blank layout", panels: BLANK_JSON, layout: "blank" },
];

const LayoutsMenu = ({ hasProject, getSnapshot, onApply }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [appliedId, setAppliedId] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    (async () => {
      try {
        const list = await window.electronAPI.layoutList();
        if (!dead && Array.isArray(list)) setItems(list);
      } catch {}
    })();
    const onDoc = (e) => {
      try {
        if (btnRef.current && btnRef.current.contains(e.target)) return;
        if (menuRef.current && menuRef.current.contains(e.target)) return;
        setOpen(false);
      } catch {}
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      dead = true;
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const saveCurrent = async () => {
    const snap = getSnapshot();
    if (!snap || busy) return;
    setBusy(true);
    try {
      const list = await window.electronAPI.layoutSave(name.trim(), snap.panels, snap.layout);
      if (Array.isArray(list)) setItems(list);
      setName("");
    } catch {} finally { setBusy(false); }
  };

  const apply = (p) => {
    if (!hasProject) return;
    try {
      if (onApply(p) === false) return;
      setAppliedId(p.id);
      setTimeout(() => { setOpen(false); setAppliedId(null); }, 450);
    } catch {}
  };

  const remove = async (e, id) => {
    e.stopPropagation();
    try {
      const list = await window.electronAPI.layoutDelete(id);
      if (Array.isArray(list)) setItems(list);
    } catch {}
  };

  const btn = (
    <button ref={btnRef} className="tb-workspaces" onClick={() => setOpen((o) => !o)} title="Panel layouts" aria-label="Layouts">
      <span>Layouts</span>
    </button>
  );
  if (!open) return btn;

  const r = btnRef.current?.getBoundingClientRect?.();
  const pos = {
    position: "fixed",
    top: r ? r.bottom + 6 : 40,
    right: r ? Math.max(8, window.innerWidth - r.right) : 8,
    zIndex: 100000,
  };

  const rowFor = (p, builtin) => (
    <div
      key={p.id}
      className={"tb-layouts-row" + (appliedId === p.id ? " is-applied" : "")}
      onClick={() => apply(p)}
      title={hasProject ? "Apply layout" : "Open a project to apply"}
    >
      <span className="tb-layouts-dot" />
      <span className="tb-layouts-name">{p.name}</span>
      {builtin
        ? <span className="tb-layouts-badge">default</span>
        : <span className="tb-layouts-when">{layoutWhen(p.savedAt)}</span>}
      {!builtin && (
        <button className="tb-layouts-del" onClick={(e) => remove(e, p.id)} title="Delete layout">×</button>
      )}
    </div>
  );

  return (
    <>
      {btn}
      {createPortal(
        <div className="tb-layouts-menu" style={pos} ref={menuRef} onMouseDown={(e) => e.stopPropagation()}>
          <div className="tb-layouts-title">Panel layouts</div>
          <div className="tb-layouts-save">
            <input
              className="tb-layouts-input"
              value={name}
              disabled={!hasProject}
              placeholder={hasProject ? "Layout name" : "Open a project first"}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveCurrent(); }}
            />
            <button className="tb-layouts-savebtn" onClick={saveCurrent} disabled={!hasProject || busy} title={hasProject ? "Save current panel layout" : "Open a project first"}>
              Save
            </button>
          </div>
          <div className="tb-layouts-list">
            <div className="tb-layouts-group">Default layouts</div>
            {BUILTIN_LAYOUTS.map((p) => rowFor(p, true))}
            <div className="tb-layouts-group">Saved layouts</div>
            {!items.length && <div className="tb-layouts-empty">No saved layouts yet</div>}
            {items.map((p) => rowFor(p, false))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// ── Recents normalize (Hub wala shape: {path, lastOpened}) ─────────────────
const normalizeRecentList = (list) => {
  if (!Array.isArray(list)) return [];
  return list.map((e) => {
    if (typeof e === "string") return { path: e, lastOpened: null };
    if (e && typeof e.path === "string") return { path: e.path, lastOpened: e.lastOpened || null };
    return null;
  }).filter(Boolean);
};
const recentBaseName = (p) => {
  const s = typeof p === "string" ? p : (p?.path || "");
  return s.replace(/^.*[\\/]/, "") || s;
};
const recentParentDir = (p) => {
  const s = typeof p === "string" ? p : (p?.path || "");
  return s.replace(/[\\/][^\\/]*$/, "") || s;
};

// ── Title bar left: logo dropdown — Back to Hub, Recents, quick actions ────
// Trigger koi naya button nahi: CET ka existing `.cet-icon` (favicon image,
// titlebar me File menu se pehle) yahan clickable banaya jata hai.
const TitlebarLogoMenu = ({ hasProject }) => {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const [iconEl, setIconEl] = useState(null);
  const iconRef = useRef(null);
  const menuRef = useRef(null);

  // Existing CET logo dhoondho (titlebar DOM banne me time leta hai)
  useEffect(() => {
    let attempts = 0;
    let timer = null;
    const findIcon = () => {
      const el = document.querySelector(".cet-titlebar .cet-icon");
      if (el) { setIconEl(el); return; }
      if (attempts++ < 40) timer = setTimeout(findIcon, 50);
    };
    findIcon();
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  // Logo → trigger bana do (click / Enter / Space toggle, dblclick ignore)
  useEffect(() => {
    if (!iconEl) return;
    iconRef.current = iconEl;
    const prevTab = iconEl.getAttribute("tabindex");
    iconEl.classList.add("tb-logo");
    iconEl.setAttribute("tabindex", "0");
    iconEl.setAttribute("role", "button");
    iconEl.setAttribute("aria-haspopup", "menu");
    iconEl.setAttribute("aria-label", "Idiot Box menu");
    iconEl.title = "Idiot Box menu";
    const onClick = (e) => { e.stopPropagation(); setOpen((o) => !o); };
    const onDbl = (e) => { e.stopPropagation(); };
    const onKey = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); }
    };
    iconEl.addEventListener("click", onClick);
    iconEl.addEventListener("dblclick", onDbl);
    iconEl.addEventListener("keydown", onKey);
    return () => {
      iconEl.removeEventListener("click", onClick);
      iconEl.removeEventListener("dblclick", onDbl);
      iconEl.removeEventListener("keydown", onKey);
      iconEl.classList.remove("tb-logo", "is-open");
      iconEl.removeAttribute("role");
      iconEl.removeAttribute("aria-haspopup");
      iconEl.removeAttribute("aria-label");
      if (prevTab === null) iconEl.removeAttribute("tabindex"); else iconEl.setAttribute("tabindex", prevTab);
      if (iconRef.current === iconEl) iconRef.current = null;
    };
  }, [iconEl]);

  // Open → logo highlight + recents load + outside-click / Escape close
  useEffect(() => {
    if (!iconEl) return;
    iconEl.classList.toggle("is-open", open);
    iconEl.setAttribute("aria-expanded", String(open));
    if (!open) return;
    let dead = false;
    (async () => {
      try {
        const r = await window.electronAPI.projectLoadRecent();
        if (!dead && r?.ok) setRecent(normalizeRecentList(r.recent));
      } catch {}
    })();
    let unsub;
    try { unsub = window.electronAPI.onProjectRecentUpdated(({ recent: list }) => setRecent(normalizeRecentList(list))); } catch {}
    const onDoc = (e) => {
      try {
        if (iconRef.current && iconRef.current.contains(e.target)) return;
        if (menuRef.current && menuRef.current.contains(e.target)) return;
        setOpen(false);
      } catch {}
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      dead = true;
      try { unsub?.(); } catch {}
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, iconEl]);

  const closeMenu = () => setOpen(false);

  const backToHub = () => {
    closeMenu();
    try { window.__ibxCloseProject?.(); } catch {}
  };

  const newProject = async () => {
    closeMenu();
    try {
      const p = await window.electronAPI.browseFolder({ title: "Select folder for new project" });
      if (p) await window.electronAPI.menuNewProject(p);
    } catch {}
  };

  const openProject = async () => {
    closeMenu();
    try { await window.electronAPI.openFolder(); } catch {}
  };

  // Recent click → current project save+close, clicked project open.
  // Confirm tab hi hamesha (jaisa user ne chaha); hub par seedha open.
  const openRecent = async (p) => {
    if (p.path === window.__currentProjectPath) { closeMenu(); return; }
    if (hasProject) {
      try {
        const ok = await window.electronAPI.confirmDialog(
          `Switch to "${recentBaseName(p)}"?\n\nCurrent project will be saved and closed.`
        );
        if (!ok) return;
      } catch { return; }
    }
    closeMenu();
    try { await window.electronAPI.menuOpenProject(p.path); } catch {}
  };

  const openPalette = () => {
    closeMenu();
    try { window.dispatchEvent(new CustomEvent("command-palette:open")); } catch {}
  };

  const openSettings = () => {
    closeMenu();
    try { window.electronAPI.openSettingsWindow(); } catch {}
  };

  if (!open) return null;

  const r = iconRef.current?.getBoundingClientRect?.();
  const pos = {
    position: "fixed",
    top: r ? r.bottom + 6 : 36,
    left: r ? Math.max(8, Math.min(r.left, window.innerWidth - 316)) : 8,
    zIndex: 100000,
  };
  const currentPath = hasProject ? window.__currentProjectPath : null;

  return createPortal(
    <div className="tb-logo-menu" style={pos} ref={menuRef} onMouseDown={(e) => e.stopPropagation()}>
      <div className="tb-logo-head">
        <img className="tb-logo-head-img" src="assets/idot_box.png" alt="" />
        <div className="tb-logo-head-txt">
          <span className="tb-logo-head-name">Idiot Box</span>
          <span className="tb-logo-head-sub">{currentPath ? recentBaseName(currentPath) : "Project Hub"}</span>
        </div>
      </div>

      {hasProject && (
        <button className="tb-logo-item tb-logo-item--primary" onClick={backToHub} title="Save this project and go back to the Hub">
          <Home size={14} strokeWidth={1.8} /> <span>Back to Hub</span>
        </button>
      )}
      <div className="tb-logo-sep" />

      <button className="tb-logo-item" onClick={newProject} title="Create a project in a new folder">
        <FolderPlus size={14} strokeWidth={1.8} /> <span>New Project…</span>
      </button>
      <button className="tb-logo-item" onClick={openProject} title="Open an existing folder as project">
        <FolderOpen size={14} strokeWidth={1.8} /> <span>Open Project…</span>
      </button>

      <div className="tb-logo-sep" />
      <div className="tb-logo-group">Recent Projects</div>
      {!recent.length && <div className="tb-logo-empty">No recent projects yet</div>}
      {recent.slice(0, 8).map((p) => {
        const isCurrent = !!currentPath && p.path === currentPath;
        return (
          <button
            key={p.path}
            className={"tb-logo-recent" + (isCurrent ? " is-current" : "")}
            onClick={() => openRecent(p)}
            title={p.path}
          >
            <span className="tb-logo-recent-name">{recentBaseName(p)}</span>
            <span className="tb-logo-recent-meta">
              <span className="tb-logo-recent-path">{recentParentDir(p)}</span>
              <span className="tb-logo-when">{p.lastOpened ? layoutWhen(p.lastOpened) : ""}</span>
            </span>
          </button>
        );
      })}

      <div className="tb-logo-sep" />
      <button className="tb-logo-item" onClick={openPalette} title="Command Palette (Ctrl+Shift+P / F1) · Quick Open (Ctrl+P)">
        <Search size={14} strokeWidth={1.8} /> <span>Command Palette</span>
      </button>
      <button className="tb-logo-item" onClick={openSettings} title="Preferences and app settings">
        <Settings2 size={14} strokeWidth={1.8} /> <span>Settings</span>
      </button>
    </div>,
    document.body
  );
};

// ── Helpers to walk the flex model tree ────────────────────────────────────
// NOTE: no isNotebookPath helper here on purpose — .ipynb files open as
// plain editor tabs (EditorPanel embeds the notebook cell UI itself), so all
// tab helpers treat them exactly like normal files.
const collectEditorTabs = (node, result = []) => {
  if (node.getType?.() === "tab" && (node.getComponent?.() === "editor" || node.getComponent?.() === "notebook")) {
    const fp = node.getConfig?.()?.filePath;
    // .excalidraw drawings live in Canvas tabs now — never persist as editor tabs.
    if (fp && !/\.excalidraw(\.json)?$/i.test(fp)) result.push(fp);
  }
  node.getChildren?.()?.forEach((c) => collectEditorTabs(c, result));
  return result;
};

const findTabByFilePath = (node, filePath) => {
  // separator-insensitive: Windows tabs store `\` paths, Linux `/`, GitPanel sends `/`
  // Matches editor tabs (which host .ipynb notebooks too) plus legacy
  // standalone "notebook" tabs from interim builds, so an already-open file
  // is activated instead of opened twice.
  const norm = (p) => { try { return String(p || "").replace(/\\/g, "/"); } catch { return p; } };
  const want = norm(filePath);
  if (node.getType?.() === "tab" && (node.getComponent?.() === "editor" || node.getComponent?.() === "notebook")) {
    if (norm(node.getConfig?.()?.filePath) === want) return node;
  }
  const children = node.getChildren?.();
  if (children) for (const c of children) { const r = findTabByFilePath(c, filePath); if (r) return r; }
  return null;
};

const findEmptyEditorTab = (node) => {
  if (node.getType?.() === "tab" && node.getComponent?.() === "editor" && !node.getConfig?.()?.filePath) return node;
  const children = node.getChildren?.();
  if (children) for (const c of children) { const r = findEmptyEditorTab(c); if (r) return r; }
  return null;
};

const findEditorTabset = (node) => {
  if (node.getType?.() === "tabset") {
    const children = node.getChildren?.();
    if (children && children.some((c) => c.getType() === "tab" && (c.getComponent() === "editor" || c.getComponent() === "notebook"))) return node;
  }
  const children = node.getChildren?.();
  if (children) for (const c of children) { const r = findEditorTabset(c); if (r) return r; }
  return null;
};

// Blank layout me editor tabset nahi hota — files kholne ke liye
// kisi bhi tabset (blank panel wala) ko target banate hain.
const findAnyTabset = (node) => {
  if (node.getType?.() === "tabset") return node;
  const children = node.getChildren?.();
  if (children) for (const c of children) { const r = findAnyTabset(c); if (r) return r; }
  return null;
};

// ── Per-project panel layout sanitize (tabs.json → panels) ─────────────────
// Saved layout kisi aur version me bana ho to unknown components blank me
// badal do — factory me nahi to empty/crash tab milega.
const PROJECT_PANEL_COMPONENTS = new Set([
  "mediaViewer", "panel3", "projectPanel", "editor", "notebook", "terminal",
  "blank", "componentPreview", "community", "canvas", "problems", "output",
  "runDebug", "gitPanel", "ports", "androidEmulator", "openPencil", "aiAgent",
]);
const sanitizeProjectPanels = (json) => {
  try {
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "tab") {
        // .ipynb ab editor tabs me render hote hain (session migration jaisa)
        if (node.component === "notebook") node.component = "editor";
        if (!PROJECT_PANEL_COMPONENTS.has(node.component)) {
          node.component = "blank";
          node.name = "New Panel";
          node.config = {};
        }
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    if (json?.layout) walk(json.layout);
    if (Array.isArray(json?.borders)) json.borders.forEach(walk);
    // Popout windows (FlexLayout multi-window) bhi sanitise karo - unke
    // andar ke tabs bhi isi model JSON me save hote hain.
    if (json?.popouts && typeof json.popouts === "object") {
      Object.values(json.popouts).forEach((p) => walk(p?.layout));
    }
  } catch {}
  return json;
};

// Purane saved sessions me tabEnablePopout false saved hota hai - popout
// feature on karne ke liye hamesha force-enable karo (default + saved dono).
const enablePopouts = (json) => {
  try {
    if (!json.global || typeof json.global !== "object") json.global = {};
    json.global.tabEnablePopout = true;
    json.global.tabEnablePopoutIcon = true;
  } catch {}
  return json;
};

const forceLayoutRedraw = (m) => {
  try {
    [...m.getwindowsMap().values()].forEach((lw) => lw?.layout?.redraw?.("force"));
  } catch { /* ignore */ }
};

const App = () => {
  const modelRef          = useRef(null);
  const readyRef          = useRef(false);
  const currentProjectRef = useRef(null);
  const saveTabsTimer     = useRef(null);
  const lastBrowserTabsetRef = useRef(null);
  const [hasProject, setHasProject] = useState(false);
  // Current project ka layout mode — "blank" (Create Project ke 2 buttons me se)
  const projectLayoutRef = useRef(null);
  const [tick, setTick] = useState(0);
  const [titlebarMenuHost, setTitlebarMenuHost] = useState(null);
  const [titlebarHost, setTitlebarHost] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── Onboarding check — sirf first launch (ya data remove hone par) ──────
  // Poora page hai (components/Onboarding), modal nahi. Save/Skip wahi
  // handle karta hai; yahan sirf show/hide + username cache.
  useEffect(() => {
    (async () => {
      try {
        const s = await window.electronAPI.readSettings().catch(() => ({}));
        try { window.__githubUsername = s?.githubUsername || null; } catch {}
        if (!s?.githubUsername && !s?.githubOnboardingDismissed) setShowOnboarding(true);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    let attempts = 0;
    let timer = null;
    const findTitlebarMenu = () => {
      const tb = document.querySelector(".cet-titlebar");
      if (tb) setTitlebarHost(tb);
      const host = document.querySelector(".cet-titlebar .cet-menubar");
      if (host && tb) { setTitlebarMenuHost(host); return; }
      if (attempts++ < 40) timer = setTimeout(findTitlebarMenu, 50);
    };
    findTitlebarMenu();
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  // ── Theme handling (default dark) ──────────────────────────────────────
  useEffect(() => {
    const apply = (th) => {
      const isLight = th === "light" || th === "lightPlus" || th === "lightModern" || th === "light2026"
        || th === "Visual Studio Light" || th === "Light+" || th === "Light Modern" || th === "Light 2026";
      document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    };
    // initial load
    try {
      window.electronAPI.readSettings().then((s) => {
        const th = s?.theme || s?.editorTheme || "dark";
        apply(th);
      });
    } catch {}
    // listen to changes from Settings window
    let bc, bc2;
    try {
      bc = new BroadcastChannel("app-settings");
      bc.onmessage = (e) => { if (e.data?.theme) apply(e.data.theme); if (e.data?.editorTheme) apply(e.data.editorTheme); };
    } catch {}
    try {
      bc2 = new BroadcastChannel("editor-settings");
      bc2.onmessage = (e) => { if (e.data?.theme) apply(e.data.theme); if (e.data?.editorTheme) apply(e.data.editorTheme); };
    } catch {}
    return () => { try { bc?.close(); } catch {} try { bc2?.close(); } catch {} };
  }, []);

  // Telemetry live (was dead — no consumer) — now at least wired
  useEffect(() => {
    window.electronAPI.readSettings().then((s)=> { window.__telemetryEnabled = s.telemetryEnabled !== false; }).catch(()=>{});
    const h = (patch)=>{ if(patch && "telemetryEnabled" in patch) window.__telemetryEnabled = patch.telemetryEnabled !== false; };
    let bc;
    try{ bc=new BroadcastChannel("app-settings"); bc.onmessage=(e)=> h(e.data); }catch{}
    let unsub;
    try{ unsub=window.electronAPI.onSettingsUpdated(h); }catch{}
    return ()=>{ try{bc?.close()}catch{}; try{unsub?.()}catch{} };
  }, []);

  // Find the biggest tabset (largest area, fallback to most tabs) for fallback when no Browser yet
  const getBiggestTabsetId = useCallback((m) => {
    let biggest = null;
    let maxArea = -1;
    let maxTabs = -1;
    const walk = (node) => {
      if (node.getType() === "tabset") {
        let area = 0;
        try { const r = node.getRect(); if (r) area = r.width * r.height; } catch {}
        const cnt = node.getChildren()?.length || 0;
        if (area > 0) {
          if (area > maxArea) { maxArea = area; biggest = node.getId(); }
        } else if (cnt > maxTabs) {
          maxTabs = cnt; biggest = node.getId();
        }
        if (!biggest) biggest = node.getId();
      }
      node.getChildren()?.forEach(walk);
    };
    try { walk(m.getRoot()); } catch {}
    return biggest;
  }, []);

  // Expose layout JSON for main process to grab on close, and model for BrowserPanel to update tabs
  useEffect(() => {
    window.__flexModel = modelRef;
    window.__getLayoutJSON = () => modelRef.current ? modelRef.current.toJson() : null;
    return () => { delete window.__flexModel; delete window.__getLayoutJSON; };
  }, []);

  // ── Save current open editor tabs per project ──────────────────────────
  // Har project ki apni tabs.json (uske store folder me) — koi shared config nahi.
  // Sirf us project ke ANDAR ki files save hoti hain (doosre project ki leak nahi).
  const pathInsideRoot = (filePath, rootPath) => {
    try {
      const r = String(rootPath || "").replace(/[\\/]+$/, "");
      const f = String(filePath || "");
      if (!r || !f) return false;
      const rl = r.toLowerCase().replace(/\//g, "\\");
      const fl = f.toLowerCase().replace(/\//g, "\\");
      return fl === rl || fl.startsWith(rl + "\\");
    } catch { return false; }
  };
  const doSaveProjectTabs = () => {
    const rootPath = currentProjectRef.current;
    if (!rootPath) return;
    const m = modelRef.current;
    if (!m) return;
    const tabs = collectEditorTabs(m.getRoot()).filter((t) => pathInsideRoot(t, rootPath));
    // layout mode ("blank") preserve — warna har save par preference udd jati
    const payload = { tabs };
    if (projectLayoutRef.current === "blank") payload.layout = "blank";
    // Poora panel layout (kaunse panels khule the, unki arrangement) — project
    // dobara khulte par waisa hi restore ho.
    try { payload.panels = m.toJson(); } catch {}
    window.electronAPI.writeProjectTabs(rootPath, payload).catch(() => {});
  };

  // ── Per-project isolation: purane project ke processes/activity roko ───
  // Layout khud save/load hota hai (doSaveProjectTabs/loadProjectLayout) —
  // isliye tabs delete NAHI karte, sirf: terminal PTY kill, chalti run stop,
  // output reset. Git/Output/Problems/Ports panels REHTE hain — wo current
  // project se khud rebind hote hain.
  const closeProjectTabs = useCallback((oldRoot) => {
    // Terminal PTYs: sirf purane root wale kill (emulator mirror bachte hain)
    try { window.dispatchEvent(new CustomEvent("terminals:killAll", { detail: { root: oldRoot || null } })); } catch {}
    // Chalti run roko (RunPanel sunta hai)
    try { window.dispatchEvent(new CustomEvent("run:stopCurrent")); } catch {}
    // Output reset — saare channels khaali
    try {
      if (window.__outputBuffer) {
        for (const k of Object.keys(window.__outputBuffer)) window.__outputBuffer[k] = [];
      }
      window.dispatchEvent(new CustomEvent("output:log", { detail: { channel: "App" } }));
    } catch {}
  }, []);

  const scheduleSaveProjectTabs = () => {
    clearTimeout(saveTabsTimer.current);
    saveTabsTimer.current = setTimeout(doSaveProjectTabs, 600);
  };

  // Window band hone par current project ka layout/tab data turant save
  // (debounce 600ms ka best-effort backup).
  useEffect(() => {
    const save = () => { try { doSaveProjectTabs(); } catch {} };
    window.addEventListener("beforeunload", save);
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("beforeunload", save);
      window.removeEventListener("pagehide", save);
    };
  }, []);

  // ── Restore editor tabs from .project_config/tabs.json ───────────────────
  const restoreProjectTabs = async (rootPath) => {
    if (!rootPath) return;
    // Respect General → Restore Previous Session (was dead — always restored)
    try {
      const s = await window.electronAPI.readSettings().catch(()=> ({}));
      if (s.restoreTabs === false) return;
    } catch {}
    let data = null;
    try { data = await window.electronAPI.readProjectTabs(rootPath); } catch {}
    // Sirf is project ke andar ki files (purani mixed entries bahar)
    const tabs = (Array.isArray(data?.tabs) ? data.tabs.filter(Boolean) : [])
      .filter((t) => pathInsideRoot(t, rootPath));
    if (!tabs.length) return;

    const m = modelRef.current;
    if (!m) return;

    for (const filePath of tabs) {
      // .excalidraw drawings now live in the Canvas panel, not the editor.
      if (typeof filePath === "string" && /\.excalidraw(\.json)?$/i.test(filePath)) {
        try {
          window.dispatchEvent(new CustomEvent("add-canvas-panel", { detail: { filePath } }));
        } catch {}
        continue;
      }
      // NOTE: .ipynb notebooks render INSIDE editor tabs (EditorPanel embeds
      // the cell UI), so no special-casing here — plain editor flow below.
      if (findTabByFilePath(m.getRoot(), filePath)) continue; // already open

      const name = filePath.replace(/.*[\\/]/, "") || filePath;
      const empty = findEmptyEditorTab(m.getRoot());
      if (empty) {
        m.doAction(Actions.updateNodeAttributes(empty.getId(), { name, config: { filePath } }));
        m.doAction(Actions.selectTab(empty.getId()));
        forceLayoutRedraw(m);
      } else {
        const tabset = findEditorTabset(m.getRoot()) || findAnyTabset(m.getRoot());
        const parentId = tabset ? tabset.getId() : m.getRoot().getId();
        m.doAction(Actions.addNode({
          type: "tab", component: "editor", name, enableClose: true,
          id: "editor-tab-" + Date.now() + "-" + Math.random().toString(36).slice(2),
          config: { filePath },
        }, parentId, DockLocation.CENTER, -1, true));
      }
    }
    setTick((t) => t + 1);
  };

  // Load session → create model → render (respects General → Restore Previous Session)
  useEffect(() => {
    (async () => {
      let session = null;
      try { session = await window.electronAPI.loadSession(); } catch {}
      try {
        const s = await window.electronAPI.readSettings().catch(()=> ({}));
        if (s.restoreTabs === false) session = null;
      } catch {}
      const json = (session && session.layout) ? JSON.parse(JSON.stringify(session.layout)) : DEFAULT_JSON;
      enablePopouts(json);
      // Migrate old component names
      if (session && session.layout) {
        (function migrate(node) {
          if (node.type === "tab") {
            if (node.component === "panel1") node.component = "mediaViewer";
            if (node.name === "panel1") node.name = "Media Viewer";
            if (node.component === "panel5") node.component = "editor";
            if (node.name === "panel5") node.name = "Editor";
            // Migrate any removed/unknown components to blank (keep builder/docs for cleanup below).
            // "notebook" stays allowed as a compat shim (interim builds saved
            // such tabs); they render the same cell UI. .ipynb files always
            // open as plain editor tabs now (cell UI embedded in EditorPanel).
            const allowed = new Set(["mediaViewer","panel3","projectPanel","editor","notebook","terminal","blank","componentPreview","community","canvas","problems","output","runDebug","gitPanel","ports","androidEmulator","builder","docs","openPencil","aiAgent"]);
            if (!allowed.has(node.component)) {
              node.component = "blank";
              node.name = "Blank";
            } else if (node.component === "notebook") {
              node.component = "editor";
            }
          }
          if (node.children) node.children.forEach(migrate);
        })(json);
        // Auto-inject Ports panel for existing sessions that predate it
        const hasPorts = ((n) => {
          const walk = (x) => {
            if (x.type === "tab" && x.component === "ports") return true;
            if (x.children && x.children.some(walk)) return true;
            return false;
          };
          return walk(n);
        })(json);
        if (!hasPorts) {
          try {
            const rootRow = json.layout;
            // find bottom row that holds Problems/Git
            let bottom = null;
            const findBottom = (node) => {
              if (!node || !node.children) return;
              for (const ch of node.children) {
                if (ch.type === "row" && ch.children && ch.children.some((ts) => ts.children && ts.children.some((t) => t.component === "problems" || t.component === "gitPanel"))) {
                  bottom = ch;
                  return;
                }
                findBottom(ch);
              }
            };
            findBottom(rootRow);
            if (bottom && Array.isArray(bottom.children)) {
              bottom.children.push({ type: "tabset", weight: 34, children: [{ type: "tab", name: "Ports", component: "ports" }] });
              // rebalance first two to 33 each if they were 50
              if (bottom.children.length === 3) {
                bottom.children[0].weight = 33;
                bottom.children[1].weight = 33;
                bottom.children[2].weight = 34;
              }
            } else if (rootRow && rootRow.children) {
              rootRow.children.push({ type: "tabset", weight: 15, children: [{ type: "tab", name: "Ports", component: "ports" }] });
            }
          } catch {}
        }
        // Cleanup: remove Builder/Docs (visual editor) from old sessions
        (() => {
          const remove = (node) => {
            if (!node || !node.children) return;
            node.children = node.children.filter((ch) => !(ch.type === "tab" && (ch.component === "builder" || ch.component === "docs")));
            node.children.forEach(remove);
          };
          try { remove(json.layout || json); } catch {}
        })();
      }
      // ── Deduplicate Ports tabs — fix for saved session with 2 Ports tabs on startup
      (() => {
        const seen = new Set();
        const dedup = (node) => {
          if (!node || !node.children) return;
          node.children = node.children.filter((child) => {
            if (child.type === "tab" && (child.component === "ports" || child.component === "problems" || child.component === "output" || child.component === "runDebug")) {
              if (!seen.has(child.component)) { seen.add(child.component); return true; }
              return false;
            }
            return true;
          });
          node.children.forEach(dedup);
        };
        try { dedup(json.layout || json); } catch {}
        const cleanEmpty = (node) => {
          if (!node || !node.children) return;
          node.children.forEach(cleanEmpty);
          node.children = node.children.filter(
            (ch) => !(ch.type === "tabset" && (!ch.children || ch.children.length === 0))
          );
          node.children = node.children.filter(
            (ch) => !(ch.type === "row" && (!ch.children || ch.children.length === 0))
          );
        };
        try { cleanEmpty(json.layout || json); } catch {}
      })();
      // ── Move Ports + Problems into Project/Terminal group (default layout change)
      (() => {
        try {
          let target = null;
          const findTarget = (node) => {
            if (node.type === "tabset" && node.children && node.children.some((c) => c.component === "projectPanel" || c.component === "terminal")) {
              target = node; return true;
            }
            if (node.children) for (const ch of node.children) if (findTarget(ch)) return true;
            return false;
          };
          findTarget(json.layout);
          if (!target) return;
          for (const comp of ["ports", "problems", "output", "runDebug"]) {
            const inTarget = target.children.some((c) => c.component === comp);
            if (inTarget) {
              const removeOutside = (node) => {
                if (!node.children) return;
                node.children = node.children.filter((ch) => !(ch.type === "tab" && ch.component === comp && node !== target));
                node.children.forEach(removeOutside);
              };
              removeOutside(json.layout);
              continue;
            }
            let found = null, foundParent = null;
            const findTab = (node) => {
              if (!node.children) return false;
              for (const ch of node.children) if (ch.type === "tab" && ch.component === comp) { found = ch; foundParent = node; return true; }
              for (const ch of node.children) if (findTab(ch)) return true;
              return false;
            };
            findTab(json.layout);
            if (found && foundParent) {
              foundParent.children = foundParent.children.filter((c) => c !== found);
              target.children.push(found);
            } else {
              const name = comp === "ports" ? "Ports" : comp === "output" ? "Output" : comp === "runDebug" ? "Run & Debug" : "Problems";
              target.children.push({ type: "tab", name, component: comp });
            }
          }
          const order = { projectPanel: 0, terminal: 1, ports: 2, problems: 3, output: 4, runDebug: 5 };
          target.children.sort((a, b) => {
            const ao = order[a.component] !== undefined ? order[a.component] : 99;
            const bo = order[b.component] !== undefined ? order[b.component] : 99;
            return ao - bo;
          });
          const cleanEmpty2 = (node) => {
            if (!node.children) return;
            node.children.forEach(cleanEmpty2);
            node.children = node.children.filter((ch) => !(ch.type === "tabset" && (!ch.children || ch.children.length === 0)));
            node.children = node.children.filter((ch) => !(ch.type === "row" && (!ch.children || ch.children.length === 0)));
          };
          cleanEmpty2(json.layout);
        } catch {}
      })();
      // NOTE: AI panel removed — purane saved sessions me agar aiPanel tab hai to blank render hoga.
      modelRef.current = Model.fromJson(json);
      readyRef.current = true;
      setTick((t) => t + 1);
      // OS "Open With Idiot Box" (argv / second-instance / open-file): model
      // ready hai → main ko batao; wo pending files ka ping bhejega aur
      // onOsFilesPending listener unhe tabs me khol dega.
      try { window.electronAPI.notifyEditorReady?.().catch(() => {}); } catch {}
    })();
  }, []);

  // ── Project open / close → save & restore tabs ───────────────────────────
  useEffect(() => {
    const handleOpen = async (folderPath) => {
      // Save tabs for whatever project was open before switching
      doSaveProjectTabs();
      // Purane project ke panels/process/output yahin khatm — naya project clean slate
      closeProjectTabs(currentProjectRef.current);
      currentProjectRef.current = folderPath;
      window.__currentProjectPath = folderPath;
      // Project data padho: layout mode ("blank") + saved panel layout
      let saved = null;
      try { saved = await window.electronAPI.readProjectTabs(folderPath); } catch {}
      projectLayoutRef.current = saved?.layout === "blank" ? "blank" : null;
      // Saved panels (jaise user ne chhoda tha) — sirf jab tak session
      // restore ON hai (General → Restore Previous Session).
      let savedPanels = saved?.panels && typeof saved.panels === "object" && saved.panels.layout ? saved.panels : null;
      if (savedPanels) {
        try {
          const st = await window.electronAPI.readSettings().catch(() => ({}));
          if (st?.restoreTabs === false) savedPanels = null;
        } catch {}
      }
      setHasProject(true);
      // Notify editor panels
      window.dispatchEvent(new CustomEvent("project:opened", { detail: { path: folderPath } }));
      // Saved panel layout → waisa hi restore; nahi to default/blank layout.
      let restored = false;
      if (savedPanels) {
        try {
          const json = enablePopouts(sanitizeProjectPanels(JSON.parse(JSON.stringify(savedPanels))));
          modelRef.current = Model.fromJson(json);
          restored = true;
        } catch {}
      }
      if (!restored) {
        try {
          modelRef.current = Model.fromJson(projectLayoutRef.current === "blank" ? BLANK_JSON : DEFAULT_JSON);
        } catch {}
      }
      try {
        setTick((t) => t + 1);
        try { forceLayoutRedraw(modelRef.current); } catch {}
      } catch {}
      // Panels restore ho chuke hain to editor tabs usi me maujood hain
      if (!restored) await restoreProjectTabs(folderPath);
    };

    const handleClose = () => {
      doSaveProjectTabs();
      closeProjectTabs(currentProjectRef.current);
      currentProjectRef.current = null;
      projectLayoutRef.current = null;
      window.__currentProjectPath = null;
      setHasProject(false);
      // Notify editor panels
      window.dispatchEvent(new CustomEvent("project:closed"));
    };

    const u1 = window.electronAPI.onMenuEvent("menu:openProject", handleOpen);
    const u2 = window.electronAPI.onMenuEvent("menu:newProject",  handleOpen);
    const u3 = window.electronAPI.onMenuEvent("menu:closeProject", handleClose);
    const u4 = window.electronAPI.onMenuEvent("menu:loadExtension", () => {
      window.electronAPI.loadChromeExtension();
    });
    // Title bar ka Workspaces box isse hub par wapas bhejta hai
    window.__ibxCloseProject = handleClose;
    // ── Unified palette (`CommandPalette`) ke commands → yahan handle hote hain ──
    const onPaletteAction = async (e) => {
      const c = e?.detail?.cmd;
      try {
        if (c === "newProject") {
          const p = await window.electronAPI.browseFolder({ title: "Select folder for new project" });
          if (p) await window.electronAPI.menuNewProject(p);
        } else if (c === "saveProject") {
          doSaveProjectTabs();
        } else if (c === "closeProject") {
          handleClose();
        } else if (c === "resetLayout") {
          modelRef.current = Model.fromJson(projectLayoutRef.current === "blank" ? BLANK_JSON : DEFAULT_JSON);
          setTick((t) => t + 1);
        } else if (c === "toggleAutoSave") {
          const s = (await window.electronAPI.readSettings().catch(() => null)) || {};
          const next = !(s.autoSave === true || s.autoSave === "afterDelay");
          await window.electronAPI.writeSettings({ ...s, autoSave: next });
        }
      } catch { /* palette action best-effort */ }
    };
    window.addEventListener("menu:action", onPaletteAction);
    return () => {
      u1(); u2(); u3(); u4(); delete window.__ibxCloseProject;
      window.removeEventListener("menu:action", onPaletteAction);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chrome extension tabs (chrome.tabs.create) ─────────────────────────
  useEffect(() => {
    const unsub = window.electronAPI.onChromeCreateTab((url) => {
      const m = modelRef.current;
      if (!m) return;
      let tabsetId = null;
      // 1) Last Browser group
      const lastId = lastBrowserTabsetRef.current || window.__lastBrowserTabsetId;
      if (lastId) {
        try {
          const n = m.getNodeById(lastId);
          if (n && n.getType() === "tabset") tabsetId = lastId;
        } catch {}
      }
      // 2) Biggest window
      if (!tabsetId) tabsetId = getBiggestTabsetId(m);
      // 3) Fallback: first Browser tabset
      if (!tabsetId) {
        const nodes = m.getRoot().getChildren();
        outer: for (const row of nodes) {
          for (const child of row.getChildren()) {
            if (child.getType() !== "tabset") continue;
            for (const tab of child.getChildren()) {
              const cfg = tab.getConfig();
              if (cfg?.type === "browser") { tabsetId = child.getId(); break outer; }
            }
          }
        }
      }
      if (!tabsetId) {
        const first = m.getRoot().getChildren().find((n) => n.getType() === "tabset");
        tabsetId = first?.getId();
      }
      if (!tabsetId) return;
      lastBrowserTabsetRef.current = tabsetId;
      try { window.__lastBrowserTabsetId = tabsetId; } catch {}
      m.doAction(Actions.addNode({
        type: "tab", component: "panel3", name: "New Tab", enableClose: true,
        config: { type: "browser", title: "New Tab", url: url || "https://www.google.com" },
      }, tabsetId, DockLocation.CENTER, -1, true));
      scheduleSaveProjectTabs();
    });
    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Menu events from main process ───────────────────────────────────────
  useEffect(() => {
    const handlers = [
      window.electronAPI.onMenuEvent("menu:undo", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "undo" } }))),
      window.electronAPI.onMenuEvent("menu:redo", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "redo" } }))),
      window.electronAPI.onMenuEvent("menu:cut", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "cut" } }))),
      window.electronAPI.onMenuEvent("menu:copy", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "copy" } }))),
      window.electronAPI.onMenuEvent("menu:paste", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "paste" } }))),
      window.electronAPI.onMenuEvent("menu:selectAll", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "selectAll" } }))),
      window.electronAPI.onMenuEvent("menu:find", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "find" } }))),
      window.electronAPI.onMenuEvent("menu:formatDocument", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "format" } }))),
      window.electronAPI.onMenuEvent("menu:commentLine", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "commentLine" } }))),
      window.electronAPI.onMenuEvent("menu:copyLineDown", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "copyLineDown" } }))),
      window.electronAPI.onMenuEvent("menu:moveLineUp", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "moveLineUp" } }))),
      window.electronAPI.onMenuEvent("menu:moveLineDown", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "moveLineDown" } }))),
      window.electronAPI.onMenuEvent("menu:gotoLine", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "gotoLine" } }))),
      window.electronAPI.onMenuEvent("menu:gotoSymbol", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "gotoSymbol" } }))),
      window.electronAPI.onMenuEvent("menu:findNext", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "findNext" } }))),
      window.electronAPI.onMenuEvent("menu:findPrevious", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "findPrevious" } }))),
      window.electronAPI.onMenuEvent("menu:replace", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "replace" } }))),
      window.electronAPI.onMenuEvent("menu:fullscreen", () => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
      }),
      window.electronAPI.onMenuEvent("menu:newTerminal", () => {
        const m = modelRef.current;
        if (!m) return;
        // Find any existing terminal tab — if found, just highlight/select it
        const findTerminalTab = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "terminal") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findTerminalTab(c); if (r) return r; }
          return null;
        };
        const existing = findTerminalTab(m.getRoot());
        if (existing) {
          try { m.doAction(Actions.selectTab(existing.getId())); } catch {}
          // Focus the terminal's xterm as well
          try { window.dispatchEvent(new CustomEvent("terminal:focus", { detail: { tabId: existing.getId() } })); } catch {}
          // Visual highlight flash
          try { window.dispatchEvent(new CustomEvent("terminal:highlight")); } catch {}
        } else {
          window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { location: "BOTTOM" } }));
        }
      }),
      window.electronAPI.onMenuEvent("menu:splitTerminalRight", () => window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { location: "RIGHT" } }))),
      window.electronAPI.onMenuEvent("menu:splitTerminalDown", () => window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { location: "BOTTOM" } }))),
      window.electronAPI.onMenuEvent("menu:clearTerminal", () => window.dispatchEvent(new CustomEvent("terminal:command", { detail: { cmd: "clear" } }))),
      window.electronAPI.onMenuEvent("menu:killTerminal", () => window.dispatchEvent(new CustomEvent("terminal:command", { detail: { cmd: "kill" } }))),
    ];
    return () => handlers.forEach((u) => u());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => {
      try {
        const m = modelRef.current;
        if (!m) return;
        const findTab = (n) => {
          if (n.getType?.() === "tab" && n.getComponent?.() === "terminal") return n;
          const ch = n.getChildren?.();
          if (ch) for (const c of ch) { const r = findTab(c); if (r) return r; }
          return null;
        };
        const tab = findTab(m.getRoot());
        if (!tab) return;
        m.doAction(Actions.selectTab(tab.getId()));
      } catch {}
    };
    window.addEventListener("focus-terminal-tab", handler);
    return () => window.removeEventListener("focus-terminal-tab", handler);
  }, []);

  // Open URL in default browser
  useEffect(() => {
    const handler = (e) => {
      const url = e.detail?.url;
      if (!url) return;
      window.dispatchEvent(new CustomEvent("open-in-browser", { detail: { url } }));
    };
    window.addEventListener("open-in-browser", handler);
    return () => window.removeEventListener("open-in-browser", handler);
  }, []);

  // Add/Split terminal panel in flexlayout
  useEffect(() => {
    const handler = (e) => {
      const m = modelRef.current;
      if (!m) return;
      const targetNodeId = e.detail?.nodeId;
      const locationName = e.detail?.location || "CENTER";
      let location = DockLocation.CENTER;
      if (locationName === "RIGHT") location = DockLocation.RIGHT;
      if (locationName === "BOTTOM") location = DockLocation.BOTTOM;
      if (locationName === "LEFT") location = DockLocation.LEFT;
      if (locationName === "TOP") location = DockLocation.TOP;

      let targetNode = targetNodeId ? m.getNodeById(targetNodeId) : null;
      let parentId = null;

      // Actions.addNode requires the target to be a TabSetNode (or Row/Border).
      // If the target is a tab, use the tabset that contains it — flexlayout then
      // splits that tabset in the requested direction for RIGHT/BOTTOM/LEFT/TOP.
      if (targetNode) {
        if (targetNode.getType() === "tab") parentId = targetNode.getParent()?.getId();
        else parentId = targetNode.getId();
      }
      if (!parentId) {
        const terminalNode = m.getNodeById("terminal-tab");
        parentId = terminalNode?.getParent()?.getId();
      }
      if (!parentId) {
        parentId = m.getRoot()?.getId();
      }

      if (parentId) {
        m.doAction(Actions.addNode({
          type: "tab",
          component: "terminal",
          name: "Terminal",
          enableClose: true,
        }, parentId, location, -1, true));
      }
    };
    window.addEventListener("add-terminal-panel", handler);
    return () => window.removeEventListener("add-terminal-panel", handler);
  }, []);

  // Add Browser / Component Preview panel in flexlayout
  useEffect(() => {
    const addPanel = (component, name, config) => {
      const m = modelRef.current;
      if (!m) return;
      bumpPanelUsage(component);
      let parentId = null;
      if (component === "panel3") {
        // Browser: open in same group as last Browser, else biggest window
        const lastId = lastBrowserTabsetRef.current || window.__lastBrowserTabsetId;
        if (lastId) {
          try {
            const n = m.getNodeById(lastId);
            if (n && n.getType() === "tabset") parentId = lastId;
          } catch {}
        }
        if (!parentId) parentId = getBiggestTabsetId(m);
        if (!parentId) {
          const activeTabset = m.getActiveTabset?.();
          parentId = activeTabset ? activeTabset.getId() : m.getRoot().getId();
        }
        lastBrowserTabsetRef.current = parentId;
        try { window.__lastBrowserTabsetId = parentId; } catch {}
      } else {
        const activeTabset = m.getActiveTabset?.();
        parentId = activeTabset ? activeTabset.getId() : m.getRoot().getId();
      }
      m.doAction(Actions.addNode({
        type: "tab", component, name, enableClose: true, config,
      }, parentId, DockLocation.CENTER, -1, true));
    };
    const onBrowser = (e) => addPanel("panel3", "Browser", e.detail?.config || { type: "browser", title: "Browser", url: e.detail?.url || "https://www.google.com" });
    const onPreview = () => addPanel("componentPreview", "Component Preview", {});
    const onCommunity = () => {
      const m = modelRef.current;
      if (m) {
        const findCommunity = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "community") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findCommunity(c); if (r) return r; }
          return null;
        };
        const existing = findCommunity(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("community", "Community", {});
    };
    // Canvas (Excalidraw): optional detail { filePath } opens a file-backed
    // drawing; otherwise opens the per-project scratch drawing. Reuses an
    // existing canvas tab for the same file instead of duplicating it.
    const onCanvas = (e) => {
      const filePath = e?.detail?.filePath || e?.detail?.path || null;
      const m = modelRef.current;
      if (filePath && m) {
        try {
          const norm = (p) => String(p || "").replace(/\\/g, "/");
          const want = norm(filePath);
          const findCanvas = (node) => {
            if (node.getType?.() === "tab" && node.getComponent?.() === "canvas") {
              const cfg = node.getConfig?.() || {};
              if (norm(cfg.filePath) === want) return node;
            }
            const ch = node.getChildren?.();
            if (ch) for (const c of ch) { const r = findCanvas(c); if (r) return r; }
            return null;
          };
          const existing = findCanvas(m.getRoot());
          if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
        } catch {}
      }
      const name = filePath ? String(filePath).replace(/.*[\\/]/, "") : "Canvas";
      addPanel("canvas", name, filePath ? { filePath } : {});
    };
    const onPorts = () => {
      const m = modelRef.current;
      if (m) {
        const findPorts = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "ports") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findPorts(c); if (r) return r; }
          return null;
        };
        const existing = findPorts(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("ports", "Ports", {});
    };
    const onOutput = (e) => {
      const m = modelRef.current;
      // Jisne panel khola usne channel manga ho (Run panel → "Run") to use
      // Output panel me select karwao — chahe panel pehle se khula ho ya ab bane.
      const want = e?.detail?.channel;
      if (want) {
        try { window.__outputWantChannel = want; } catch {}
        try { window.dispatchEvent(new CustomEvent("output:switchChannel", { detail: { channel: want } })); } catch {}
      }
      // Prefer the bottom group (Terminal/Problems/Ports/Output/Run) so Output docks there
      const findBottom = (node) => {
        if (node.getType?.() === "tabset" && node.getChildren?.()?.some?.((c) => ["terminal", "problems", "ports", "output", "runDebug"].includes(c.getComponent?.()))) return node;
        const ch = node.getChildren?.();
        if (ch) for (const c of ch) { const r = findBottom(c); if (r) return r; }
        return null;
      };
      if (m) {
        const findOutput = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "output") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findOutput(c); if (r) return r; }
          return null;
        };
        const existing = findOutput(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
        const bottom = findBottom(m.getRoot());
        if (bottom) {
          try { m.doAction(Actions.addNode({ type: "tab", component: "output", name: "Output", enableClose: true }, bottom.getId(), DockLocation.CENTER, -1, true)); } catch {}
          return;
        }
      }
      addPanel("output", "Output", {});
    };
    const onRunDebug = (e) => {
      const m = modelRef.current;
      const findBottom = (node) => {
        if (node.getType?.() === "tabset" && node.getChildren?.()?.some?.((c) => ["terminal", "problems", "ports", "output", "runDebug"].includes(c.getComponent?.()))) return node;
        const ch = node.getChildren?.();
        if (ch) for (const c of ch) { const r = findBottom(c); if (r) return r; }
        return null;
      };
      if (m) {
        const findRun = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "runDebug") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findRun(c); if (r) return r; }
          return null;
        };
        const existing = findRun(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
        const bottom = findBottom(m.getRoot());
        if (bottom) {
          try { m.doAction(Actions.addNode({ type: "tab", component: "runDebug", name: "Run & Debug", enableClose: true }, bottom.getId(), DockLocation.CENTER, -1, true)); } catch {}
          return;
        }
      }
      addPanel("runDebug", "Run & Debug", {});
    };
    const onGit = () => {
      const m = modelRef.current;
      if (m) {
        const findGit = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "gitPanel") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findGit(c); if (r) return r; }
          return null;
        };
        const existing = findGit(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("gitPanel", "Git", {});
    };
    const onAndroid = () => {
      const m = modelRef.current;
      if (m) {
        const findAndroid = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "androidEmulator") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findAndroid(c); if (r) return r; }
          return null;
        };
        const existing = findAndroid(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("androidEmulator", "Android Emulator", {});
    };
    // Emulator log: a Terminal tab in mirror mode (no PTY — shows emulator stdout).
    // Tab id must match EMULATOR_LOG_TAB in electron/main/android.js.
    const onEmulatorLog = () => {
      const mirrorId = "android-emulator-log";
      const m = modelRef.current;
      if (m) {
        const findLog = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "terminal" && node.getConfig?.()?.mirrorTabId === mirrorId) return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findLog(c); if (r) return r; }
          return null;
        };
        const existing = findLog(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("terminal", "Emulator", { mirrorTabId: mirrorId });
    };
    const onAiAgent = () => {
      const m = modelRef.current;
      if (m) {
        const findAgent = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "aiAgent") return node;
          const children = node.getChildren?.();
          if (children) for (const child of children) { const found = findAgent(child); if (found) return found; }
          return null;
        };
        const existing = findAgent(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("aiAgent", "AI Agent", {});
    };
    window.addEventListener("add-browser-panel", onBrowser);
    window.addEventListener("add-ai-agent-panel", onAiAgent);
    window.addEventListener("add-component-preview-panel", onPreview);
    window.addEventListener("add-community-panel", onCommunity);
    window.addEventListener("add-canvas-panel", onCanvas);
    window.addEventListener("add-ports-panel", onPorts);
    window.addEventListener("add-output-panel", onOutput);
    window.addEventListener("add-run-panel", onRunDebug);
    window.addEventListener("add-git-panel", onGit);
    window.addEventListener("add-android-panel", onAndroid);
    return () => {
      window.removeEventListener("add-browser-panel", onBrowser);
      window.removeEventListener("add-ai-agent-panel", onAiAgent);
      window.removeEventListener("add-component-preview-panel", onPreview);
      window.removeEventListener("add-community-panel", onCommunity);
      window.removeEventListener("add-canvas-panel", onCanvas);
      window.removeEventListener("add-ports-panel", onPorts);
      window.removeEventListener("add-output-panel", onOutput);
      window.removeEventListener("add-run-panel", onRunDebug);
      window.removeEventListener("add-git-panel", onGit);
      window.removeEventListener("add-android-panel", onAndroid);
    };
  }, []);

  // ── Toggle full screen ───────────────────────────────────────────────────
  useEffect(() => {
    const onFs = () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    };
    window.addEventListener("app:fullscreen", onFs);
    return () => window.removeEventListener("app:fullscreen", onFs);
  }, []);

  // Close flex tab by ID
  useEffect(() => {
    const handler = (e) => {
      const m = modelRef.current;
      const nodeId = e.detail?.nodeId;
      if (m && nodeId) {
        try { m.doAction(Actions.deleteTab(nodeId)); } catch {}
      }
    };
    window.addEventListener("close-flex-tab", handler);
    return () => window.removeEventListener("close-flex-tab", handler);
  }, []);

  // Reset panels to default layout (blank project par bhi blank layout)
  useEffect(() => {
    const unsub = window.electronAPI.onMenuEvent("menu:resetLayout", () => {
      modelRef.current = Model.fromJson(projectLayoutRef.current === "blank" ? BLANK_JSON : DEFAULT_JSON);
      setTick((t) => t + 1);
    });
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = window.electronAPI.onMenuEvent("menu:openPorts", () => {
      window.dispatchEvent(new CustomEvent("add-ports-panel"));
    });
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = window.electronAPI.onMenuEvent("menu:openAndroid", () => {
      window.dispatchEvent(new CustomEvent("add-android-panel"));
    });
    return unsub;
  }, []);
  // ── Native Run menu (title bar ke neeche) → Run panel actions ───────────
  useEffect(() => {
    const unsubs = [];
    unsubs.push(window.electronAPI.onMenuEvent("menu:runAuto", () => {
      try { window.__pendingAutoRun = { auto: true }; } catch {}
      window.dispatchEvent(new CustomEvent("add-run-panel"));
    }));
    unsubs.push(window.electronAPI.onMenuEvent("menu:runStop", () => {
      window.dispatchEvent(new CustomEvent("run:stopCurrent"));
    }));
    unsubs.push(window.electronAPI.onMenuEvent("menu:openRunPanel", () => {
      window.dispatchEvent(new CustomEvent("add-run-panel"));
    }));
    return () => unsubs.forEach((u) => { try { u(); } catch {} });
  }, []);
  // ── Split Editor Right — clone the active editor tab to the right ────────
  // Both tabs share the same file:// Monaco model, so edits sync live.
  useEffect(() => {
    const onSplitRight = () => {
      const m = modelRef.current;
      if (!m) return;
      let src = null;
      try {
        const tabset = m.getActiveTabset();
        const sel = tabset?.getSelectedNode?.();
        if (sel?.getType() === "tab" && sel.getComponent() === "editor") src = sel;
      } catch {}
      if (!src) return;
      const srcCfg = src.getConfig?.() || {};
      const filePath = srcCfg.filePath;
      if (!filePath) return;
      let parentId = null;
      try { parentId = src.getParent?.()?.getId(); } catch {}
      if (!parentId) return;
      let name = filePath;
      try { name = src.getName?.() || filePath.replace(/.*[\\/]/, ""); } catch {}
      m.doAction(Actions.addNode({
        type: "tab", component: "editor", name, enableClose: true,
        id: "editor-tab-" + Date.now() + "-" + Math.random().toString(36).slice(2),
        config: srcCfg.forceText ? { filePath, forceText: true } : { filePath },
      }, parentId, DockLocation.RIGHT, -1, true));
    };
    const unsub = window.electronAPI.onMenuEvent("menu:splitEditorRight", onSplitRight);
    // Palette command "Split Editor Right" isi callback ko trigger karta hai
    window.addEventListener("editor:splitRight", onSplitRight);
    return () => { unsub(); window.removeEventListener("editor:splitRight", onSplitRight); };
  }, []);
  useEffect(() => {
    const unsub = window.electronAPI.onMenuEvent("menu:openGit", () => {
      window.dispatchEvent(new CustomEvent("add-git-panel"));
    });
    return unsub;
  }, []);
  // Open settings window when browser panel requests it
  useEffect(() => {
    const handler = (e) => {
      try {
        window.electronAPI.openSettingsWindow?.(e.detail?.page);
      } catch {}
    };
    window.addEventListener("browser:openSettings", handler);
    return () => window.removeEventListener("browser:openSettings", handler);
  }, []);

  // Handle window maximize/restore/resize — force flexlayout to reflow (fixes restore-down crash/black)
  // + responsive class for small windows
  useEffect(() => {
    const updateResponsive = () => {
      const w = window.innerWidth;
      const root = document.documentElement;
      root.classList.toggle("is-compact", w <= 900);
      root.classList.toggle("is-narrow", w <= 700);
      root.classList.toggle("is-tiny", w <= 560);
      root.dataset.winW = String(w);
    };
    updateResponsive();
    const doRedraw = () => {
      const m = modelRef.current;
      if (!m) return;
      try { forceLayoutRedraw(m); } catch {}
      // Extra tick to let flexlayout recalc after DOM settles
      setTimeout(() => { try { forceLayoutRedraw(m); } catch {} }, 80);
    };
    const onWinState = window.electronAPI?.onWindowStateChanged
      ? window.electronAPI.onWindowStateChanged(() => { updateResponsive(); setTimeout(doRedraw, 40); })
      : () => {};
    const onResize = () => { updateResponsive(); doRedraw(); };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      try { onWinState(); } catch {}
    };
  }, []);

  // ── Navigation isolation: main window never navigates ──────────────────────
  // All link clicks / history pushes / redirects stay in Browser panel or iframe.
  useEffect(() => {
    const clickHandler = (e) => {
      const a = e.target.closest?.("a[href]");
      if (!a) return;
      if (a.closest("webview") || a.closest("iframe")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("file://") || href.startsWith("data:")) return;
      const url = a.href;
      // treat localhost / ip / domain / http(s) as external -> Browser panel
      if (/^https?:\/\//i.test(url) || url.includes("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(href) || /^[^\s]+\.[^\s]+/.test(href)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url, config: { type: "browser", title: "Browser", url } } }));
      }
    };
    document.addEventListener("click", clickHandler, true);

    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    const shouldIntercept = (url) => {
      if (!url || typeof url !== "string") return false;
      try {
        const u = new URL(url, window.location.href);
        if (u.protocol === "http:" || u.protocol === "https:" || u.protocol === "ibx-file:") return true;
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return true;
      } catch {}
      return false;
    };
    history.pushState = function(...args) {
      const url = args[2];
      if (shouldIntercept(url)) {
        const abs = (()=>{ try{ return new URL(String(url), window.location.href).href; } catch{ return String(url); }})() ;
        window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: abs, config: { type: "browser", title: "Browser", url: abs } } }));
        return;
      }
      return origPush(...args);
    };
    history.replaceState = function(...args) {
      const url = args[2];
      if (shouldIntercept(url)) {
        const abs = (()=>{ try{ return new URL(String(url), window.location.href).href; } catch{ return String(url); }})() ;
        window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: abs, config: { type: "browser", title: "Browser", url: abs } } }));
        return;
      }
      return origReplace(...args);
    };

    const origOpen = window.open;
    window.open = function(url, target, features) {
      if (url) {
        const str = String(url);
        // FlexLayout popout window - browser panel me mat bhejo, native
        // window.open hi chahiye (main process allow karta hai).
        if (str.includes("popout.html")) {
          return origOpen ? origOpen.call(window, url, target, features) : null;
        }
        if (/^https?:\/\//i.test(str) || str.includes("localhost") || /^[^\s]+\.[^\s]+/.test(str)) {
          window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: str, config: { type: "browser", title: "Browser", url: str } } }));
          return null;
        }
      }
      return origOpen ? origOpen.call(window, url, target, features) : null;
    };

    return () => {
      document.removeEventListener("click", clickHandler, true);
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.open = origOpen;
    };
  }, []);

  // ── Fix Ctrl+W: only close project, never close window/app ───
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "w" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") try { e.stopImmediatePropagation(); } catch {}
        try {
          // Mimic handleClose: clear current project and notify
          currentProjectRef.current = null;
          window.__currentProjectPath = null;
          setHasProject(false);
          window.dispatchEvent(new CustomEvent("project:closed"));
        } catch {}
        return false;
      }
    };
    window.addEventListener("keydown", handler, true);
    document.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
      document.removeEventListener("keydown", handler, true);
    };
  }, []);

  // ── UI Size — View → Ctrl + + / Ctrl + - / Ctrl + 0 / Ctrl + Scroll + overlay ──
  // Main process handles accelerators + before-input-event, but Monaco/webview can
  // swallow them. This renderer fallback ensures Ctrl+=/Plus/Minus/0/wheel still zoom.
  // Ctrl+Wheel zooms the whole UI — except inside components with their own
  // Ctrl+wheel zoom ([data-zoom="local"] = MediaViewer, .excalidraw = Canvas).
  useEffect(() => {
    let toastTimer = null;
    let overlayEl = null;
    const ensureOverlay = () => {
      if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
      overlayEl = document.getElementById("zoom-overlay");
      if (!overlayEl) {
        overlayEl = document.createElement("div");
        overlayEl.id = "zoom-overlay";
        overlayEl.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--spotlight-veil);color:var(--updater-title);border:1px solid var(--border-strong);border-radius:var(--radius-xl);padding:var(--space-10) 22px;font-family:system-ui,Segoe UI,sans-serif;font-size:var(--fs-22);font-weight:var(--fw-semibold);letter-spacing:0.3px;z-index:99999;pointer-events:none;opacity:0;transition:opacity var(--t-toggle) ease;box-shadow:0 8px 28px var(--overlay-a45);";
        document.body.appendChild(overlayEl);
      }
      return overlayEl;
    };
    const showToast = (factor) => {
      try {
        const el = ensureOverlay();
        const pct = Math.round(factor * 100);
        el.textContent = `${pct}%`;
        el.style.opacity = "1";
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { try { el.style.opacity = "0"; } catch {} }, 1100);
      } catch {}
    };
    // listen to main-process zoom changes (for toast + menu already rebuilt)
    let unsubZoom = null;
    try { unsubZoom = window.electronAPI?.onZoomChanged?.((factor) => showToast(factor)); } catch {}
    // also handle initial zoom fetch for consistency
    try { window.electronAPI?.getZoom?.().then(()=>{}).catch(()=>{}); } catch {}

    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // ignore when typing in terminal xterm? let terminal handle itself, but still allow UI zoom
      const k = String(e.key || "").toLowerCase();
      const code = String(e.code || "").toLowerCase();
      const isPlus = k === "+" || k === "=" || code === "equal" || code === "numpadadd" || code === "numpad_add" || code === "plus";
      const isMinus = k === "-" || k === "_" || code === "minus" || code === "numpadsubtract" || code === "numpad_subtract" || k === "minus";
      const isZero = k === "0" || code === "digit0" || code === "numpad0" || code === "numpad_0";
      // For "=" we must allow Shift (Shift+= gives +)
      // For "-" and "0" we require no Shift to avoid false positives
      if (isPlus && !e.altKey) {
        // avoid hijacking editor's Ctrl+Shift+=? still zoom
        e.preventDefault(); e.stopPropagation(); try{ e.stopImmediatePropagation(); }catch{}
        try { window.electronAPI?.zoomIn?.().then((f)=>{ if(f) showToast(f); }).catch(()=>{}); } catch {}
        return false;
      }
      if (isMinus && !e.altKey) {
        e.preventDefault(); e.stopPropagation(); try{ e.stopImmediatePropagation(); }catch{}
        try { window.electronAPI?.zoomOut?.().then((f)=>{ if(f) showToast(f); }).catch(()=>{}); } catch {}
        return false;
      }
      if (isZero && !e.altKey && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation(); try{ e.stopImmediatePropagation(); }catch{}
        try { window.electronAPI?.zoomReset?.().then((f)=>{ showToast(1); }).catch(()=>{}); } catch {}
        return false;
      }
    };
    // Ctrl+Scroll → UI zoom (throttled; local-zoom components excluded).
    let lastWheelZoom = 0;
    const onWheel = (e) => {
      try {
        if (!(e.ctrlKey || e.metaKey)) return;
        const t = e.target;
        if (t && t.closest) {
          if (t.closest('[data-zoom="local"], .excalidraw, webview')) return;
        }
        e.preventDefault(); e.stopPropagation();
        const now = Date.now();
        if (now - lastWheelZoom < 120) return;
        lastWheelZoom = now;
        // deltaY > 0 (scroll down) = zoom out, < 0 = zoom in; normalize line-mode
        let dy = e.deltaY || 0;
        if (e.deltaMode === 1) dy *= 16;
        if (dy === 0) return;
        const api = dy < 0 ? window.electronAPI?.zoomIn : window.electronAPI?.zoomOut;
        try { api?.().then((f) => { if (f) showToast(f); }).catch(() => {}); } catch {}
      } catch {}
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onWheel, { capture: true });
      try { unsubZoom?.(); } catch {}
      clearTimeout(toastTimer);
    };
  }, []);

  // ── Open files in the Editor as flexlayout tabs ──────────────────────────
  useEffect(() => {
    // Settings cache for Media Viewer auto-open (General → Auto Open Media Viewer, default true).
    // openFileInEditor is sync, so we keep a live cache instead of awaiting readSettings per click.
    const mediaSettingsRef = { autoOpen: true };
    try {
      window.electronAPI.readSettings().then((s) => {
        if (s && typeof s === "object" && "autoOpenMediaViewer" in s) {
          mediaSettingsRef.autoOpen = s.autoOpenMediaViewer !== false;
        }
        try { window.__autoOpenMediaViewer = mediaSettingsRef.autoOpen; } catch {}
      }).catch(() => {});
    } catch {}
    const applyMediaPatch = (patch) => {
      if (patch && typeof patch === "object" && "autoOpenMediaViewer" in patch) {
        mediaSettingsRef.autoOpen = patch.autoOpenMediaViewer !== false;
        try { window.__autoOpenMediaViewer = mediaSettingsRef.autoOpen; } catch {}
      }
    };
    let bcMedia = null;
    try { bcMedia = new BroadcastChannel("app-settings"); bcMedia.onmessage = (e) => applyMediaPatch(e.data); } catch {}
    let unsubMedia = null;
    try { unsubMedia = window.electronAPI?.onSettingsUpdated?.(applyMediaPatch); } catch {}

    // Bring the Media Viewer tab to front so auto-opened files are actually visible.
    const focusMediaViewerTab = () => {
      const m = modelRef.current;
      if (!m) return;
      try {
        const findMedia = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "mediaViewer") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findMedia(c); if (r) return r; }
          return null;
        };
        const tab = findMedia(m.getRoot());
        if (tab) { try { m.doAction(Actions.selectTab(tab.getId())); } catch {} forceLayoutRedraw(m); }
      } catch {}
    };

    const openInMediaViewer = (filePath) => {
      focusMediaViewerTab();
      window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: filePath } }));
    };

    // Find the currently active/selected editor tab node
    const findActiveEditorTab = (m) => {
      try {
        const tabset = m.getActiveTabset();
        if (tabset) {
          const node = tabset.getSelectedNode?.();
          if (node?.getType() === "tab" && node.getComponent() === "editor") return node;
        }
      } catch {}
      // Fallback: find any selected editor tab across all tabsets
      const findSelected = (node) => {
        if (node.getType?.() === "tab" && node.getComponent?.() === "editor") {
          const parent = node.getParent?.();
          if (parent?.getSelectedNode?.() === node) return node;
        }
        const children = node.getChildren?.();
        if (children) for (const c of children) { const r = findSelected(c); if (r) return r; }
        return null;
      };
      return findSelected(m.getRoot());
    };

    // .excalidraw drawings open in the Canvas panel, not the text editor.
    const isExcalidrawFile = (p) => typeof p === "string" && /\.excalidraw(\.json)?$/i.test(p);
    const openInCanvas = (filePath) => {
      window.dispatchEvent(new CustomEvent("add-canvas-panel", { detail: { filePath } }));
    };

    // Single-click: replace the active editor tab (VS Code preview-mode style).
    // If the file is already open somewhere, switch to it.
    // If no editor tab exists yet, create one.
    // (.ipynb included — EditorPanel embeds the notebook cell UI itself.)
    const openFileInEditor = (filePath) => {
      const m = modelRef.current;
      if (!m || !filePath) return;
      // Project-panel click on a media file → auto-open in Media Viewer (if enabled).
      if (isMediaFile(filePath) && mediaSettingsRef.autoOpen !== false) {
        openInMediaViewer(filePath);
        return;
      }
      // .excalidraw / .excalidraw.json → Canvas (Excalidraw drawing surface).
      if (isExcalidrawFile(filePath)) {
        openInCanvas(filePath);
        return;
      }

      // If already open, just activate that tab
      const existing = findTabByFilePath(m.getRoot(), filePath);
      if (existing) { m.doAction(Actions.selectTab(existing.getId())); return; }

      const name = filePath.replace(/.*[\\/]/, "") || filePath;

      // Replace the currently active editor tab
      const active = findActiveEditorTab(m);
      if (active) {
        m.doAction(Actions.updateNodeAttributes(active.getId(), { name, config: { filePath } }));
        m.doAction(Actions.selectTab(active.getId()));
        forceLayoutRedraw(m);
        scheduleSaveProjectTabs();
        return;
      }

      // Fallback: reuse any empty editor tab
      const empty = findEmptyEditorTab(m.getRoot());
      if (empty) {
        m.doAction(Actions.updateNodeAttributes(empty.getId(), { name, config: { filePath } }));
        m.doAction(Actions.selectTab(empty.getId()));
        forceLayoutRedraw(m);
        scheduleSaveProjectTabs();
        return;
      }

      // No editor tab at all — create one
      const tabset = findEditorTabset(m.getRoot());
      const parentId = tabset ? tabset.getId() : m.getRoot().getId();
      m.doAction(Actions.addNode({
        type: "tab", component: "editor", name, enableClose: true,
        id: "editor-tab-" + Date.now(),
        config: { filePath },
      }, parentId, DockLocation.CENTER, -1, true));
      scheduleSaveProjectTabs();
    };

    // Force new tab — always adds alongside existing tabs (right-click / drag-drop).
    // opts.forceText bypasses the already-open check so the same file can be
    // opened a second time as raw text (used for .ipynb "Open as JSON").
    const openFileInNewTab = (filePath, opts) => {
      const m = modelRef.current;
      if (!m || !filePath) return;
      if (isMediaFile(filePath) && mediaSettingsRef.autoOpen !== false) {
        openInMediaViewer(filePath);
        return;
      }
      if (isExcalidrawFile(filePath)) {
        openInCanvas(filePath);
        return;
      }

      const name = filePath.replace(/.*[\\/]/, "") || filePath;
      const tabset = findEditorTabset(m.getRoot());
      const parentId = tabset ? tabset.getId() : m.getRoot().getId();
      const forceText = !!(opts && opts.forceText);
      if (!forceText) {
        const existing = findTabByFilePath(m.getRoot(), filePath);
        if (existing) { m.doAction(Actions.selectTab(existing.getId())); return; }
      }
      m.doAction(Actions.addNode({
        type: "tab", component: "editor", name, enableClose: true,
        id: "editor-tab-" + Date.now(),
        config: forceText ? { filePath, forceText: true } : { filePath },
      }, parentId, DockLocation.CENTER, -1, true));
      forceLayoutRedraw(m);
      scheduleSaveProjectTabs();
    };

    // ── OS "Open With Idiot Box" (argv / second-instance / open-file) ───────
    // Har file ko alag tab me kholta hai (multi-select → multiple tabs).
    // Khali editor tab ho to reuse (VS Code jaisa), warna naya tab — kabhi
    // existing tab overwrite nahi (unsaved edits safe rehte hain).
    const openFilesFromOs = (paths) => {
      const m = modelRef.current;
      const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && p);
      if (!m || !list.length) return;
      let lastTabId = null;
      for (const filePath of list) {
        // Media / Excalidraw files → unke dedicated panels me hi khulte hain
        // (project panel click ke jaisa routing).
        if (isMediaFile(filePath) && mediaSettingsRef.autoOpen !== false) {
          openInMediaViewer(filePath);
          continue;
        }
        if (isExcalidrawFile(filePath)) {
          openInCanvas(filePath);
          continue;
        }
        const existing = findTabByFilePath(m.getRoot(), filePath);
        if (existing) { lastTabId = existing.getId(); continue; }
        const name = filePath.replace(/.*[\\/]/, "") || filePath;
        const empty = findEmptyEditorTab(m.getRoot());
        if (empty) {
          m.doAction(Actions.updateNodeAttributes(empty.getId(), { name, config: { filePath } }));
          lastTabId = empty.getId();
          continue;
        }
        const tabset = findEditorTabset(m.getRoot());
        const parentId = tabset ? tabset.getId() : m.getRoot().getId();
        const tabId = "editor-tab-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        m.doAction(Actions.addNode({
          type: "tab", component: "editor", name, enableClose: true,
          id: tabId,
          config: { filePath },
        }, parentId, DockLocation.CENTER, -1, true));
        lastTabId = tabId;
      }
      if (lastTabId) { try { m.doAction(Actions.selectTab(lastTabId)); } catch {} }
      forceLayoutRedraw(m);
      scheduleSaveProjectTabs();
    };

    // Main ping karta hai → pending OS files pull karke khol do.
    const onOsFilesPending = window.electronAPI.onOsFilesPending?.(() => {
      try {
        window.electronAPI.takePendingOsFiles?.().then((paths) => {
          if (Array.isArray(paths) && paths.length) openFilesFromOs(paths);
        }).catch(() => {});
      } catch {}
    });

    const onIpc    = window.electronAPI.onOpenFileInEditor?.(({ filePath }) => openFileInEditor(filePath));
    const onCustom = (e) => { const p = e.detail?.path ?? e.detail?.filePath; if (p) openFileInEditor(p); };
    const onNewTab = (e) => { const p = e.detail?.path ?? e.detail?.filePath; if (p) openFileInNewTab(p, { forceText: e.detail?.forceText === true }); };
    // Any direct "media-viewer:open" (context menu, drag-drop, AI panel) should also front the tab.
    const onMediaOpen = () => focusMediaViewerTab();

    window.addEventListener("open-file-in-editor",         onCustom);
    window.addEventListener("open-file-in-new-editor-tab", onNewTab);
    window.addEventListener("media-viewer:open",           onMediaOpen);
    return () => {
      onIpc?.();
      onOsFilesPending?.();
      window.removeEventListener("open-file-in-editor",         onCustom);
      window.removeEventListener("open-file-in-new-editor-tab", onNewTab);
      window.removeEventListener("media-viewer:open",           onMediaOpen);
      try { bcMedia?.close(); } catch {}
      try { unsubMedia?.(); } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── File menu → editor commands (Save / Save As / AutoSave) ──────────────
  // Notebook tabs share the same Save pipeline via `editor:command`.
  useEffect(() => {
    const activeEditorPath = () => {
      const m = modelRef.current;
      if (!m) return null;
      try {
        const tabset = m.getActiveTabset();
        const node = tabset?.getSelectedNode?.();
        if (node?.getType() === "tab" && (node.getComponent() === "editor" || node.getComponent() === "notebook")) {
          return node.getConfig()?.filePath || null;
        }
      } catch { /* ignore */ }
      return null;
    };
    const dispatch = (cmd) => {
      const path = activeEditorPath();
      if (!path) return;
      window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd, path } }));
    };
    const unsubs = [
      window.electronAPI.onMenuEvent("menu:saveFile", () => dispatch("save")),
      window.electronAPI.onMenuEvent("menu:saveFileAs", () => dispatch("saveAs")),
      window.electronAPI.onMenuEvent("menu:toggleAutoSave", (enabled) =>
        window.dispatchEvent(new CustomEvent("editor:autosave", { detail: { enabled } }))),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // ── Guard: agar 0 panel open hain to seedha "New Panel" picker khol do ────
  // Aakhri panel close karne par FlexLayout ek khaali tabset chhod jata hai
  // (content area blank, sirf "+" header). Yahan tab count karke 0 ho to
  // wahi blank picker tab addNode kar dete hain — jo "+" button bhi kholta hai.
  // Model swap (project open / reset / preset) change-listener nahi chalata,
  // isliye tick/hasProject effect uska safety-net hai.
  const ensureNewPanelIfEmpty = () => {
    try {
      const m = modelRef.current;
      if (!m || !hasProject || !readyRef.current || showOnboarding) return;
      let tabs = 0;
      m.visitNodes((n) => { try { if (n.getType && n.getType() === "tab") tabs++; } catch {} });
      if (tabs > 0) return;
      const ts = m.getActiveTabset() || m.getFirstTabSet();
      if (!ts || !ts.getId()) return;
      m.doAction(Actions.addNode({
        type: "tab", component: "blank", name: "New Panel", enableClose: true,
      }, ts.getId(), DockLocation.CENTER, -1, true));
      scheduleSaveProjectTabs(); // model.doAction onAction bypass karta hai — save yahan khud
    } catch { /* best-effort — layout ko kabhi break mat karo */ }
  };
  useEffect(() => { ensureNewPanelIfEmpty(); }, [tick, hasProject, showOnboarding]);

  // Onboarding poora page hai — hub/layout ki jagah render hota hai
  if (showOnboarding) {
    return <OnboardingPage onDone={() => setShowOnboarding(false)} />;
  }

  if (!readyRef.current) return null;

  // ── Guard: veto closing dirty editor/notebook tabs (Save / Don't Save / Cancel)
  // Returning undefined from onAction cancels the close; after the async
  // dialog resolves we re-issue the close directly on the model (which
  // bypasses onAction, so no loop).
  const handleLayoutAction = (action) => {
    try {
      if (action && action.type === Actions.DELETE_TAB) {
        const nodeId = action.data?.node;
        const m = modelRef.current;
        let node = null;
        try { node = nodeId && m ? m.getNodeById(nodeId) : null; } catch {}
        if (node && node.getType() === "tab" && (node.getComponent() === "editor" || node.getComponent() === "notebook")) {
          const fp = node.getConfig?.()?.filePath;
          // Editor tabs may host an embedded notebook (.ipynb renders its cell
          // UI inside EditorPanel), so check BOTH dirty maps.
          const isDirty = window.__ibxIsDirty?.(fp) || window.__ibxIsNotebookDirty?.(fp);
          if (fp && isDirty) {
            (async () => {
              const base = String(fp).split(/[\\/]/).pop() || fp;
              let choice = "cancel";
              try {
                if (window.electronAPI?.confirmSaveDialog) {
                  choice = await window.electronAPI.confirmSaveDialog(base);
                } else {
                  choice = (await window.electronAPI.confirmDialog(`"${base}" has unsaved changes.\nClose without saving?`)) ? "dontSave" : "cancel";
                }
              } catch { choice = "cancel"; }
              const mm = modelRef.current;
              if (!mm) return;
              const isNbTab = node.getComponent() === "notebook" || /\.ipynb$/i.test(fp || "");
              const isClean = () => !window.__ibxIsDirty?.(fp) && !window.__ibxIsNotebookDirty?.(fp);
              const forget = () => { try { window.__ibxForgetDirty?.(fp); } catch {} try { window.__ibxForgetNotebookDirty?.(fp); } catch {} };
              if (choice === "save") {
                window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "save", path: fp } }));
                // Close once the save lands and the dirty flag clears.
                // Notebooks save synchronously-ish; give them a longer window.
                setTimeout(() => {
                  try {
                    if (isClean()) {
                      forget();
                      mm.doAction(Actions.deleteTab(nodeId));
                    }
                  } catch {}
                }, isNbTab ? 1200 : 500);
              } else if (choice === "dontSave") {
                try { forget(); } catch {}
                try { mm.doAction(Actions.deleteTab(nodeId)); } catch {}
              }
            })();
            return undefined; // veto — async dialog decides
          }
        }
      }
    } catch {}
    // Panel close/add/move/split — koi bhi layout change save karo (debounced).
    // Tab select jaise non-layout actions chhod dete hain.
    try {
      if (!action || action.type !== Actions.SELECT_TAB) scheduleSaveProjectTabs();
    } catch {}
    return action;
  };

  // Layouts dropdown: current panel arrangement ka deep-copy snapshot.
  const getLayoutSnapshot = () => {
    try {
      const m = modelRef.current;
      if (!m) return null;
      return { panels: JSON.parse(JSON.stringify(m.toJson())), layout: projectLayoutRef.current };
    } catch { return null; }
  };

  // Saved layout apply: naya model + project tabs.json me persist (merge —
  // writeTabs poora file replace karta hai, isliye cur tabs wapas jodte hain).
  const applyLayoutPreset = (preset) => {
    try {
      if (!preset || !preset.panels || !preset.panels.layout || !currentProjectRef.current) return false;
      const json = enablePopouts(sanitizeProjectPanels(JSON.parse(JSON.stringify(preset.panels))));
      modelRef.current = Model.fromJson(json);
      projectLayoutRef.current = preset.layout === "blank" ? "blank" : null;
      setTick((t) => t + 1);
      try { forceLayoutRedraw(modelRef.current); } catch {}
      const root = currentProjectRef.current;
      (async () => {
        try {
          const cur = (await window.electronAPI.readProjectTabs(root)) || {};
          const payload = { ...cur, tabs: Array.isArray(cur.tabs) ? cur.tabs : [], panels: json };
          if (preset.layout === "blank") payload.layout = "blank"; else delete payload.layout;
          await window.electronAPI.writeProjectTabs(root, payload);
        } catch {}
      })();
      return true;
    } catch { return false; }
  };

  if (!hasProject) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "var(--bg-app)" }}>
        <UpdaterBanner />
        <TitlebarLogoMenu hasProject={false} />
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <ProjectHub />
        </div>
        <CommandPalette />
        <SearchPanel />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "var(--bg-app)" }}>
      <UpdaterBanner />
      <TitlebarLogoMenu hasProject={hasProject} />
      {titlebarMenuHost && createPortal(<RunStatusButton />, titlebarMenuHost)}
      {titlebarHost && createPortal(
        <LayoutsMenu hasProject={hasProject} getSnapshot={getLayoutSnapshot} onApply={applyLayoutPreset} />,
        titlebarHost
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <Layout
      model={modelRef.current}
      factory={factory}
      onAction={handleLayoutAction}
      onModelChange={(m, action) => {
        // Post-mutation hook — yahan tab count sahi hota hai (onAction se
        // pehle wala count stale hota hai). SELECT_TAB me count ki zarurat nahi.
        try {
          if (!action || action.type === Actions.SELECT_TAB) return;
          ensureNewPanelIfEmpty();
        } catch {}
      }}
      supportsPopout
      popoutURL="popout.html"
      popoutWindowName="Idiot Box"
      onDrop={(node, e) => {
        // Intercept file drops from the Project Panel onto any tabset.
        // window.__ibxDragPaths is set by ContentArea/SidebarTree dragStart.
        const paths = window.__ibxDragPaths;
        if (!paths?.length) return;
        window.__ibxDragPaths = null;

        const m = modelRef.current;
        if (!m) return;

        // Find the editor tabset that was dropped onto
        let targetTabsetId = null;
        if (node?.getType?.() === "tabset") targetTabsetId = node.getId();
        else if (node?.getType?.() === "tab") targetTabsetId = node.getParent?.()?.getId();
        if (!targetTabsetId) {
          const ts = findEditorTabset(m.getRoot());
          targetTabsetId = ts ? ts.getId() : m.getRoot().getId();
        }

        for (const filePath of paths) {
          if (!filePath) continue;
          // Drag-drop respects the same flag (default ON). When OFF, drop falls through to editor.
          let autoOpen = true;
          try { if (typeof window.__autoOpenMediaViewer === "boolean") autoOpen = window.__autoOpenMediaViewer; } catch {}
          if (autoOpen && isMediaFile(filePath)) {
            window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: filePath } }));
            continue;
          }
          // If already open, just switch to it
          const existing = findTabByFilePath(m.getRoot(), filePath);
          if (existing) { m.doAction(Actions.selectTab(existing.getId())); continue; }

          // Plain editor flow — .ipynb renders its cell UI inside the tab.
          const name = filePath.replace(/.*[\\/]/, "") || filePath;
          m.doAction(Actions.addNode({
            type: "tab", component: "editor", name, enableClose: true,
            id: "editor-tab-" + Date.now() + "-" + Math.random().toString(36).slice(2),
            config: { filePath },
          }, targetTabsetId, DockLocation.CENTER, -1, true));
        }
        scheduleSaveProjectTabs();
      }}
      onRenderTab={(node, renderValues) => {
        const cfg = node.getConfig();
        const isBrowser = cfg?.type === "browser" || node.getComponent() === "panel3";
        const isOpenPencil = node.getComponent() === "openPencil";
        const tabId = node.getId();
        const filePath = cfg?.filePath || null;
        const duplicateable = node.getComponent() === "editor" || node.getComponent() === "notebook" || isBrowser;
        const runTabAction = async (action) => {
          const m = modelRef.current;
          if (!m) return;
          const current = m.getNodeById(tabId);
          if (!current) return;
          const parent = current.getParent?.();
          const tabs = parent?.getChildren?.() || [];
          try {
            if (action === "close") m.doAction(Actions.deleteTab(tabId));
            else if (action === "closeOthers") tabs.filter((tab) => tab.getId() !== tabId).forEach((tab) => m.doAction(Actions.deleteTab(tab.getId())));
            else if (action === "closeAll") tabs.forEach((tab) => m.doAction(Actions.deleteTab(tab.getId())));
            else if (action === "duplicate" && duplicateable && parent) {
              m.doAction(Actions.addNode({
                type: "tab", component: current.getComponent(), name: current.getName(), enableClose: true,
                config: { ...(current.getConfig?.() || {}) },
              }, parent.getId(), DockLocation.CENTER, -1, true));
            } else if (action === "splitRight" && parent) {
              m.doAction(Actions.addNode({
                type: "tab", component: current.getComponent(), name: current.getName(), enableClose: true,
                config: { ...(current.getConfig?.() || {}) },
              }, parent.getId(), DockLocation.RIGHT, -1, true));
            }
            else if (action === "popout") m.doAction(Actions.popoutTab(tabId));
            else if (action === "copyPath" && filePath) window.electronAPI?.clipboardWrite?.(filePath);
            else if (action === "reveal" && filePath) window.electronAPI?.revealInExplorer?.(filePath);
            scheduleSaveProjectTabs();
          } catch {}
        };
        const onTabContextMenu = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            const result = await window.electronAPI?.showTabContextMenu?.({
              canClose: node.getEnableClose?.() !== false,
              canDuplicate: duplicateable,
              isBrowser,
              canRefresh: isBrowser || isOpenPencil,
              canPopout: node.isEnablePopout?.() !== false,
              filePath,
            });
            if (result?.action === "refresh") {
              const evt = isOpenPencil ? "openpencil:refresh" : "browser:refresh";
              window.dispatchEvent(new CustomEvent(evt, { detail: { nodeId: tabId } }));
            }
            else if (result?.action === "settings") window.dispatchEvent(new CustomEvent("browser:openSettings"));
            else if (result?.action) await runTabAction(result.action);
          } catch {}
        };
        if (isBrowser) {
          const title = cfg?.title || "Browser";
          const favicon = cfg?.favicon;
          const nId = node.getId();
          renderValues.content = (
            <div
              style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", overflow: "hidden" }}
              onContextMenu={onTabContextMenu}
            >
              {favicon ? (
                <img src={favicon} width={14} height={14} style={{ flexShrink: 0 }}
                  onError={(e) => { e.target.style.display = "none"; }} />
              ) : (
                <svg width={14} height={14} viewBox="0 0 16 16" style={{ flexShrink: 0, fill: "var(--icon)" }}>
                  <circle cx="8" cy="8" r="7" />
                </svg>
              )}
              <span title={title} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--fs-body)" }}>{title.length > 14 ? title.slice(0, 12) + "…" : title}</span>
            </div>
          );
        } else {
          renderValues.content = (
            <span onContextMenu={onTabContextMenu} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.getName()}
            </span>
          );
        }
      }}
      onRenderTabSet={(node, renderValues) => {
        const openPanelAddMenu = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const m = modelRef.current;
          if (!m) return;
          try {
            if (!window.electronAPI?.showPanelAddMenu) {
              m.doAction(Actions.addNode({
                type: "tab", component: "blank", name: "New Panel", enableClose: true,
              }, node.getId(), DockLocation.CENTER, -1, true));
              return;
            }
            const res = await window.electronAPI.showPanelAddMenu();
            const action = res?.action;
            if (action === "browser") window.dispatchEvent(new CustomEvent("add-browser-panel"));
            else if (action === "terminal") window.dispatchEvent(new CustomEvent("add-terminal-panel"));
            else if (action === "output") window.dispatchEvent(new CustomEvent("add-output-panel"));
            else if (action === "runDebug") window.dispatchEvent(new CustomEvent("add-run-panel"));
            else if (action === "aiAgent") window.dispatchEvent(new CustomEvent("add-ai-agent-panel"));
            else if (action === "android") window.dispatchEvent(new CustomEvent("add-android-panel"));
            else if (action === "community") window.dispatchEvent(new CustomEvent("add-community-panel"));
          } catch (error) {
            console.error("[panel:addMenu] Could not open panel menu:", error);
          }
        };
        const addBlankPanel = () => {
          const m = modelRef.current;
          if (!m) return;
          try {
            m.doAction(Actions.addNode({
              type: "tab", component: "blank", name: "New Panel", enableClose: true,
            }, node.getId(), DockLocation.CENTER, -1, true));
          } catch {}
        };
        renderValues.buttons.push(
          <button key="add" className="flexlayout__tab_toolbar_button"
            onClick={addBlankPanel}
            onContextMenu={openPanelAddMenu}
            title="Add Panel"
          >
            <svg style={{ fill: "var(--text-inverse)" }} width="12" height="12" viewBox="0 0 16 16">
              <rect x="7" y="1" width="2" height="14" rx="1"/>
              <rect x="1" y="7" width="14" height="2" rx="1"/>
            </svg>
          </button>
        );
      }}
        />
      </div>

      {/* ── IDE status bar ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: "var(--space-14)",
          padding: "var(--space-1) var(--space-10)", background: "var(--accent)", color: "var(--text-inverse)",
          fontSize: "var(--fs-small)", height: "var(--bar-h-sm)", flexShrink: 0, userSelect: "none",
          overflow: "hidden", whiteSpace: "nowrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)", flex: 1, minWidth: 0, overflow: "hidden" }}>
          <span id="pw-hostbar-left" style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", minWidth: 0, overflow: "hidden" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
          <div id="pw-hostbar-right" style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }} />
          <UpdaterNavButton />
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("add-ports-panel"))}
            title="Open Ports — forwarded & running dev servers"
            style={{
              background: "var(--white-a12)", border: "none", borderRadius: "var(--radius-sm)",
              color: "var(--text-inverse)", fontSize: "var(--fs-mini)", letterSpacing: "0.02em", padding: "var(--space-2) var(--space-8)", cursor: "pointer",
            }}
          >
            Ports
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("add-output-panel"))}
            title="Open Output — Git, Updater & Live Server logs"
            style={{
              background: "var(--white-a12)", border: "none", borderRadius: "var(--radius-sm)",
              color: "var(--text-inverse)", fontSize: "var(--fs-mini)", letterSpacing: "0.02em", padding: "var(--space-2) var(--space-8)", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "var(--space-4)",
            }}
          >
            <OutputIcon size={12} />
            Output
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("add-android-panel"))}
            title="Open Android Emulator — SDK in .appdata/android"
            style={{
              background: "var(--white-a12)", border: "none", borderRadius: "var(--radius-sm)",
              color: "var(--text-inverse)", fontSize: "var(--fs-mini)", letterSpacing: "0.02em", padding: "var(--space-2) var(--space-8)", cursor: "pointer",
            }}
          >
            Emulator
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("add-canvas-panel"))}
            title="Open Canvas — visual project map of every page & component"
            style={{
              background: "var(--white-a12)", border: "none", borderRadius: "var(--radius-sm)",
              color: "var(--text-inverse)", fontSize: "var(--fs-mini)", letterSpacing: "0.02em", padding: "var(--space-2) var(--space-8)", cursor: "pointer",
            }}
          >
            Canvas
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("command-palette:open"))}
            title="Command Palette (Ctrl+Shift+P / F1) · Quick Open (Ctrl+P)"
            style={{
              background: "var(--white-a12)", border: "none", borderRadius: "var(--radius-sm)",
              color: "var(--text-inverse)", fontSize: "var(--fs-mini)", letterSpacing: "0.02em", padding: "var(--space-2) var(--space-8)", cursor: "pointer",
            }}
          >
            Palette
          </button>
        </div>
      </div>

      <CommandPalette />
      <SearchPanel />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
