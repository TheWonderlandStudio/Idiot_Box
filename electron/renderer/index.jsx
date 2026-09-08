import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { Layout, Model, Actions, DockLocation } from "flexlayout-react";
import "./variables.css";
import "flexlayout-react/style/dark.css";
import "./layout.css";
import "./responsive.css";

import MediaViewer from "./components/MediaViewer/index.jsx";
import { isMediaFile } from "./components/MediaViewer/mediaTypes.js";
import BrowserPanel from "./components/Browser/index.jsx";
import ProjectPanel from "./components/Project/index.jsx";
import EditorPanel from "./components/Editor/index.jsx";
import NotebookPanel from "./components/Notebook/index.jsx";
import TerminalPanel from "./components/Terminal/index.jsx";
import BlankPanel from "./components/Blank/index.jsx";
import ComponentPreview from "./components/ComponentPreview/index.jsx";
import CanvasPanel from "./components/Canvas/index.jsx";
import CommandPalette from "./components/CommandPalette/index.jsx";
import QuickOpen from "./components/QuickOpen/index.jsx";
import SearchPanel from "./components/SearchPanel/index.jsx";
import ProblemsPanel from "./components/Problems/index.jsx";
import GitPanel from "./components/GitPanel/index.jsx";
import PortsPanel from "./components/Ports/index.jsx";
import AndroidEmulatorPanel from "./components/AndroidEmulator/index.jsx";
import AIPanel from "./components/AIPanel/index.jsx";
import UpdaterBanner from "./components/UpdaterBanner/index.jsx";

const DEFAULT_JSON = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    tabEnableDrag: true,
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

const factory = (node) => {
  switch (node.getComponent()) {
    case "mediaViewer":       return <MediaViewer />;
    case "panel3":            return <BrowserPanel config={node.getConfig()} nodeId={node.getId()} />;
    case "projectPanel":      return <ProjectPanel />;
    case "editor":            return <EditorPanel config={node.getConfig()} nodeId={node.getId()} />;
    case "notebook":          return <NotebookPanel config={node.getConfig()} nodeId={node.getId()} />;
    case "terminal":          return <TerminalPanel config={node.getConfig()} nodeId={node.getId()} />;
    case "blank":             return <BlankPanel config={node.getConfig()} nodeId={node.getId()} />;
    case "componentPreview":  return <ComponentPreview config={node.getConfig()} nodeId={node.getId()} />;
    case "canvas":            return <CanvasPanel config={node.getConfig()} nodeId={node.getId()} />;
  case "problems":          return <ProblemsPanel />;
  case "gitPanel":          return <GitPanel nodeId={node.getId()} />;
  case "ports":             return <PortsPanel />;
  case "androidEmulator":   return <AndroidEmulatorPanel />;
  case "aiPanel":           return <AIPanel nodeId={node.getId()} />;
  default:                  return null;
  }
};

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

const forceLayoutRedraw = (m) => {
  try {
    [...m.getwindowsMap().values()].forEach((lw) => lw?.layout?.redraw?.("force"));
  } catch { /* ignore */ }
};

const App = () => {
  const modelRef          = useRef(null);
  const readyRef          = useRef(false);
  const currentProjectRef = useRef(null);  // currently open project root path
  const saveTabsTimer     = useRef(null);
  const lastBrowserTabsetRef = useRef(null); // last group where a Browser was opened
  const [, setTick] = useState(0);

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
    window.electronAPI.readSettings().then((s)=> { window.__telemetryEnabled = s.telemetryEnabled === true; }).catch(()=>{});
    const h = (patch)=>{ if(patch && "telemetryEnabled" in patch) window.__telemetryEnabled = !!patch.telemetryEnabled; };
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

  // ── Save current open editor tabs to .project_config/tabs.json ────────────
  const doSaveProjectTabs = () => {
    const rootPath = currentProjectRef.current;
    if (!rootPath) return;
    const m = modelRef.current;
    if (!m) return;
    const tabs = collectEditorTabs(m.getRoot());
    window.electronAPI.writeProjectTabs(rootPath, { tabs }).catch(() => {});
  };

  const scheduleSaveProjectTabs = () => {
    clearTimeout(saveTabsTimer.current);
    saveTabsTimer.current = setTimeout(doSaveProjectTabs, 600);
  };

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
    const tabs = Array.isArray(data?.tabs) ? data.tabs.filter(Boolean) : [];
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
        const tabset = findEditorTabset(m.getRoot());
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
            const allowed = new Set(["mediaViewer","panel3","projectPanel","editor","notebook","terminal","blank","componentPreview","canvas","problems","gitPanel","ports","androidEmulator","aiPanel","builder","docs"]);
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
            if (child.type === "tab" && (child.component === "ports" || child.component === "problems")) {
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
          for (const comp of ["ports", "problems"]) {
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
              const name = comp === "ports" ? "Ports" : "Problems";
              target.children.push({ type: "tab", name, component: comp });
            }
          }
          const order = { projectPanel: 0, terminal: 1, ports: 2, problems: 3 };
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
      // NOTE: AI panel default layout me nahi hai (user choice) — purane saved
      // sessions me agar aiPanel tab hai to wahi render hoga, naya inject nahi hota.
      // AI kholo via: New Panel launcher, status-bar AI button, Ctrl+Shift+A.
      modelRef.current = Model.fromJson(json);
      readyRef.current = true;
      setTick((t) => t + 1);
    })();
  }, []);

  // ── Project open / close → save & restore tabs ───────────────────────────
  useEffect(() => {
    const handleOpen = async (folderPath) => {
      // Save tabs for whatever project was open before switching
      doSaveProjectTabs();
      currentProjectRef.current = folderPath;
      window.__currentProjectPath = folderPath;
      // Notify editor panels
      window.dispatchEvent(new CustomEvent("project:opened", { detail: { path: folderPath } }));
      await restoreProjectTabs(folderPath);
    };

    const handleClose = () => {
      doSaveProjectTabs();
      currentProjectRef.current = null;
      window.__currentProjectPath = null;
      // Notify editor panels
      window.dispatchEvent(new CustomEvent("project:closed"));
    };

    const u1 = window.electronAPI.onMenuEvent("menu:openProject", handleOpen);
    const u2 = window.electronAPI.onMenuEvent("menu:newProject",  handleOpen);
    const u3 = window.electronAPI.onMenuEvent("menu:closeProject", handleClose);
    const u4 = window.electronAPI.onMenuEvent("menu:loadExtension", () => {
      window.electronAPI.loadChromeExtension();
    });
    return () => { u1(); u2(); u3(); u4(); };
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
    const handler = () => { if (modelRef.current) modelRef.current.doAction(Actions.selectTab("terminal-tab")); };
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
    const onAI = () => {
      const m = modelRef.current;
      if (m) {
        const findAI = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "aiPanel") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findAI(c); if (r) return r; }
          return null;
        };
        const existing = findAI(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("aiPanel", "AI", {});
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
    window.addEventListener("add-browser-panel", onBrowser);
    window.addEventListener("add-component-preview-panel", onPreview);
    window.addEventListener("add-canvas-panel", onCanvas);
    window.addEventListener("add-ports-panel", onPorts);
    window.addEventListener("add-git-panel", onGit);
    window.addEventListener("add-ai-panel", onAI);
    window.addEventListener("add-android-panel", onAndroid);
    return () => {
      window.removeEventListener("add-browser-panel", onBrowser);
      window.removeEventListener("add-component-preview-panel", onPreview);
      window.removeEventListener("add-canvas-panel", onCanvas);
      window.removeEventListener("add-ports-panel", onPorts);
      window.removeEventListener("add-git-panel", onGit);
      window.removeEventListener("add-ai-panel", onAI);
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

  // Reset panels to default layout
  useEffect(() => {
    const unsub = window.electronAPI.onMenuEvent("menu:resetLayout", () => {
      modelRef.current = Model.fromJson(DEFAULT_JSON);
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
  // ── Split Editor Right — clone the active editor tab to the right ────────
  // Both tabs share the same file:// Monaco model, so edits sync live.
  useEffect(() => {
    const unsub = window.electronAPI.onMenuEvent("menu:splitEditorRight", () => {
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
    });
    return unsub;
  }, []);
  useEffect(() => {
    const unsub = window.electronAPI.onMenuEvent("menu:openGit", () => {
      window.dispatchEvent(new CustomEvent("add-git-panel"));
    });
    return unsub;
  }, []);
  // ── AI panel: View → AI Panel (Ctrl+Shift+A) + renderer fallback ──────
  // Monaco can swallow the native accelerator, so also listen here (capture).
  useEffect(() => {
    const unsub = window.electronAPI.onMenuEvent("menu:openAI", () => {
      window.dispatchEvent(new CustomEvent("add-ai-panel"));
    });
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey &&
          String(e.key || "").toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        try { e.stopImmediatePropagation(); } catch {}
        window.dispatchEvent(new CustomEvent("add-ai-panel"));
        return false;
      }
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      try { unsub(); } catch {}
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onKey, true);
    };
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

  // ── UI Size — View → Ctrl + + / Ctrl + - / Ctrl + 0 fallback + overlay ──
  // Main process handles accelerators + before-input-event, but Monaco/webview can
  // swallow them. This renderer fallback ensures Ctrl+=/Plus/Minus/0 still zoom.
  // NOTE: Ctrl+Scroll zoom is intentionally disabled — only Ctrl +/-/0 keys zoom UI.
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
    // Ctrl+Scroll zoom disabled — do nothing on wheel, even with Ctrl held.
    // (Previously this zoomed the whole UI and fought Canvas/Explorer/Media zoom.)
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
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
    return action;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "var(--bg-app)" }}>
      <UpdaterBanner />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Layout
      model={modelRef.current}
      factory={factory}
      onAction={handleLayoutAction}
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
        if (isBrowser) {
          const title = cfg?.title || "Browser";
          const favicon = cfg?.favicon;
          const nId = node.getId();
          renderValues.content = (
            <div
              style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", overflow: "hidden" }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent("browser:tabContextMenu", { detail: { nodeId: nId } }));
              }}
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
        }
      }}
      onRenderTabSet={(node, renderValues) => {
        renderValues.buttons.push(
          <button key="add" className="flexlayout__tab_toolbar_button"
            onClick={() => {
              const m = modelRef.current;
              if (m) {
                m.doAction(Actions.addNode({
                  type: "tab", component: "blank", name: "New Panel", enableClose: true,
                }, node.getId(), DockLocation.CENTER, -1, true));
              }
            }}
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
          <span style={{ opacity: 0.92, fontWeight: "var(--fw-semibold)", letterSpacing: "0.02em" }}>Idiot Box</span>
          <span id="pw-hostbar-left" style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", minWidth: 0, overflow: "hidden" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-14)" }}>
          <div id="pw-hostbar-right" style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }} />
          <UpdaterNavButton />
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("add-ai-panel"))}
            title="Open AI Panel (Ctrl+Shift+A) — chat assistant powered by the Vercel AI SDK"
            style={{
              background: "var(--white-a12)", border: "none", borderRadius: "var(--radius-sm)",
              color: "var(--text-inverse)", fontSize: "var(--fs-mini)", letterSpacing: "0.02em", padding: "var(--space-2) var(--space-8)", cursor: "pointer",
            }}
          >
            AI
          </button>
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
            title="Command Palette (Ctrl+Shift+P)"
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
      <QuickOpen />
      <SearchPanel />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
