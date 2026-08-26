import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { Layout, Model, Actions, DockLocation } from "flexlayout-react";
import "./variables.css";
import "flexlayout-react/style/dark.css";
import "./layout.css";
import "./responsive.css";

import MediaViewer from "./components/MediaViewer/index.jsx";
import BrowserPanel from "./components/Browser/index.jsx";
import ProjectPanel from "./components/Project/index.jsx";
import EditorPanel from "./components/Editor/index.jsx";
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
            ],
          },
        ],
      },
      {
        type: "tabset", weight: 25, id: "editor-tabset",
        children: [{ type: "tab", name: "Editor", component: "editor" }],
      },
      {
        type: "row", weight: 20,
        children: [
          { type: "tabset", weight: 33, children: [{ type: "tab", name: "Problems", component: "problems" }] },
          { type: "tabset", weight: 33, children: [{ type: "tab", name: "Git", component: "gitPanel" }] },
          { type: "tabset", weight: 34, children: [{ type: "tab", name: "Ports", component: "ports" }] },
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
    case "terminal":          return <TerminalPanel config={node.getConfig()} nodeId={node.getId()} />;
    case "blank":             return <BlankPanel config={node.getConfig()} nodeId={node.getId()} />;
    case "componentPreview":  return <ComponentPreview config={node.getConfig()} nodeId={node.getId()} />;
    case "canvas":            return <CanvasPanel config={node.getConfig()} nodeId={node.getId()} />;
  case "problems":          return <ProblemsPanel />;
  case "gitPanel":          return <GitPanel />;
  case "ports":             return <PortsPanel />;
  default:                  return null;
  }
};

// ── Helpers to walk the flex model tree ────────────────────────────────────
const collectEditorTabs = (node, result = []) => {
  if (node.getType?.() === "tab" && node.getComponent?.() === "editor") {
    const fp = node.getConfig?.()?.filePath;
    if (fp) result.push(fp);
  }
  node.getChildren?.()?.forEach((c) => collectEditorTabs(c, result));
  return result;
};

const findTabByFilePath = (node, filePath) => {
  if (node.getType?.() === "tab" && node.getComponent?.() === "editor") {
    if (node.getConfig?.()?.filePath === filePath) return node;
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
    if (children && children.some((c) => c.getType() === "tab" && c.getComponent() === "editor")) return node;
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
    let data = null;
    try { data = await window.electronAPI.readProjectTabs(rootPath); } catch {}
    const tabs = Array.isArray(data?.tabs) ? data.tabs.filter(Boolean) : [];
    if (!tabs.length) return;

    const m = modelRef.current;
    if (!m) return;

    for (const filePath of tabs) {
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

  // Load session → create model → render
  useEffect(() => {
    window.electronAPI.loadSession().then((session) => {
      const json = (session && session.layout) ? JSON.parse(JSON.stringify(session.layout)) : DEFAULT_JSON;
      // Migrate old component names
      if (session && session.layout) {
        (function migrate(node) {
          if (node.type === "tab") {
            if (node.component === "panel1") node.component = "mediaViewer";
            if (node.name === "panel1") node.name = "Media Viewer";
            if (node.component === "panel5") node.component = "editor";
            if (node.name === "panel5") node.name = "Editor";
            // Migrate any removed/unknown components to blank
            const allowed = new Set(["mediaViewer","panel3","projectPanel","editor","terminal","blank","componentPreview","canvas","problems","gitPanel","ports"]);
            if (!allowed.has(node.component)) {
              node.component = "blank";
              node.name = "Blank";
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
      }
      // ── Deduplicate Ports tabs — fix for saved session with 2 Ports tabs on startup
      (() => {
        let seen = false;
        const dedup = (node) => {
          if (!node || !node.children) return;
          node.children = node.children.filter((child) => {
            if (child.type === "tab" && child.component === "ports") {
              if (!seen) { seen = true; return true; }
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
      modelRef.current = Model.fromJson(json);
      readyRef.current = true;
      setTick((t) => t + 1);
    });
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
      window.electronAPI.onMenuEvent("menu:findNext", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "findNext" } }))),
      window.electronAPI.onMenuEvent("menu:findPrevious", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "findPrevious" } }))),
      window.electronAPI.onMenuEvent("menu:replace", () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "replace" } }))),
      window.electronAPI.onMenuEvent("menu:fullscreen", () => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
      }),
      window.electronAPI.onMenuEvent("menu:newTerminal", () => window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { location: "BOTTOM" } }))),
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
    const onCanvas = () => addPanel("canvas", "Canvas", {});
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
    window.addEventListener("add-browser-panel", onBrowser);
    window.addEventListener("add-component-preview-panel", onPreview);
    window.addEventListener("add-canvas-panel", onCanvas);
    window.addEventListener("add-ports-panel", onPorts);
    return () => {
      window.removeEventListener("add-browser-panel", onBrowser);
      window.removeEventListener("add-component-preview-panel", onPreview);
      window.removeEventListener("add-canvas-panel", onCanvas);
      window.removeEventListener("add-ports-panel", onPorts);
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

  // Open settings window when browser panel requests it
  useEffect(() => {
    const handler = () => {
      try {
        window.electronAPI.openSettingsWindow?.();
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

  // ── Open files in the Editor as flexlayout tabs ──────────────────────────
  useEffect(() => {
    const IMAGE_VIDEO_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".mp4", ".webm"];

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

    // Single-click: replace the active editor tab (VS Code preview-mode style).
    // If the file is already open somewhere, switch to it.
    // If no editor tab exists yet, create one.
    const openFileInEditor = (filePath) => {
      const m = modelRef.current;
      if (!m || !filePath) return;
      const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      if (IMAGE_VIDEO_EXTS.includes(ext)) {
        window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: filePath } }));
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

    // Force new tab — always adds alongside existing tabs (right-click / drag-drop)
    const openFileInNewTab = (filePath) => {
      const m = modelRef.current;
      if (!m || !filePath) return;
      const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      if (IMAGE_VIDEO_EXTS.includes(ext)) {
        window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: filePath } }));
        return;
      }

      const name = filePath.replace(/.*[\\/]/, "") || filePath;
      const tabset = findEditorTabset(m.getRoot());
      const parentId = tabset ? tabset.getId() : m.getRoot().getId();
      m.doAction(Actions.addNode({
        type: "tab", component: "editor", name, enableClose: true,
        id: "editor-tab-" + Date.now(),
        config: { filePath },
      }, parentId, DockLocation.CENTER, -1, true));
      forceLayoutRedraw(m);
      scheduleSaveProjectTabs();
    };

    const onIpc    = window.electronAPI.onOpenFileInEditor?.(({ filePath }) => openFileInEditor(filePath));
    const onCustom = (e) => { const p = e.detail?.path ?? e.detail?.filePath; if (p) openFileInEditor(p); };
    const onNewTab = (e) => { const p = e.detail?.path ?? e.detail?.filePath; if (p) openFileInNewTab(p); };

    window.addEventListener("open-file-in-editor",         onCustom);
    window.addEventListener("open-file-in-new-editor-tab", onNewTab);
    return () => {
      onIpc?.();
      window.removeEventListener("open-file-in-editor",         onCustom);
      window.removeEventListener("open-file-in-new-editor-tab", onNewTab);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── File menu → editor commands (Save / Save As / AutoSave) ──────────────
  useEffect(() => {
    const activeEditorPath = () => {
      const m = modelRef.current;
      if (!m) return null;
      try {
        const tabset = m.getActiveTabset();
        const node = tabset?.getSelectedNode?.();
        if (node?.getType() === "tab" && node.getComponent() === "editor") {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "#0d0d0d" }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Layout
      model={modelRef.current}
      factory={factory}
      onDrop={(node, e) => {
        // Intercept file drops from the Project Panel onto any tabset.
        // window.__ibxDragPaths is set by ContentArea/SidebarTree dragStart.
        const paths = window.__ibxDragPaths;
        if (!paths?.length) return;
        window.__ibxDragPaths = null;

        const IMAGE_VIDEO_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".mp4", ".webm"];
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
          const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
          if (IMAGE_VIDEO_EXTS.includes(ext)) {
            window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: filePath } }));
            continue;
          }
          // If already open, just switch to it
          const existing = findTabByFilePath(m.getRoot(), filePath);
          if (existing) { m.doAction(Actions.selectTab(existing.getId())); continue; }

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
              style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}
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
                <svg width={14} height={14} viewBox="0 0 16 16" fill="#888" style={{ flexShrink: 0 }}>
                  <circle cx="8" cy="8" r="7" />
                </svg>
              )}
              <span title={title} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{title.length > 14 ? title.slice(0, 12) + "…" : title}</span>
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
            <svg width="12" height="12" viewBox="0 0 16 16" fill="#fff">
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
          display: "flex", alignItems: "center", gap: 14,
          padding: "1px 10px", background: "#007acc", color: "#ffffff",
          fontSize: 11, height: 22, flexShrink: 0, userSelect: "none",
          overflow: "hidden", whiteSpace: "nowrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0, overflow: "hidden" }}>
          <span style={{ opacity: 0.9 }}>Idiot Box</span>
          <span id="pw-hostbar-left" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, overflow: "hidden" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div id="pw-hostbar-right" style={{ display: "flex", alignItems: "center", gap: 10 }} />
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("add-ports-panel"))}
            title="Open Ports — forwarded & running dev servers"
            style={{
              background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 3,
              color: "#ffffff", fontSize: 10.5, padding: "2px 8px", cursor: "pointer",
            }}
          >
            Ports
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("add-canvas-panel"))}
            title="Open Canvas — visual project map of every page & component"
            style={{
              background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 3,
              color: "#ffffff", fontSize: 10.5, padding: "2px 8px", cursor: "pointer",
            }}
          >
            Canvas
          </button>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("command-palette:open"))}
            title="Command Palette (Ctrl+Shift+P)"
            style={{
              background: "rgba(255,255,255,0.12)", border: "none", borderRadius: 3,
              color: "#ffffff", fontSize: 10.5, padding: "2px 8px", cursor: "pointer",
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
