import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { createPortal } from "react-dom";
import { Play, ChevronDown, Bug, PlayCircle, Settings2, Home, FolderPlus, FolderOpen, Search } from "lucide-react";
import VscodeIcon from "./components/shared/VscodeIcon.jsx";
import { Layout, Model, Actions, DockLocation } from "flexlayout-react";
// flexlayout-react 0.11 compat: getRoot() -> getRootRow(), getwindowsMap() -> getLayouts().
// Old saved code calls m.getRoot() everywhere — keep it working via alias.
try {
  if (Model && Model.prototype && !Model.prototype.getRoot && Model.prototype.getRootRow) {
    Model.prototype.getRoot = function (...a) { return this.getRootRow(...a); };
  }
  if (Model && Model.prototype && !Model.prototype.getwindowsMap && Model.prototype.getLayouts) {
    Model.prototype.getwindowsMap = function (...a) { return this.getLayouts(...a); };
  }
} catch {}
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
import OutputPanel from "./components/Output/index.jsx";
import GitPanel from "./components/GitPanel/index.jsx";
import PortsPanel from "./components/Ports/index.jsx";
import AndroidEmulatorPanel from "./components/AndroidEmulator/index.jsx";
import AIAgentPanel from "./components/OpenCodePanel/index.jsx";
import ExtensionsPanel from "./components/Extensions/index.jsx";
import ExtView from "./components/Extensions/ExtView.jsx";
import LocalHistoryPanel from "./components/LocalHistory/index.jsx";
import TestExplorer from "./components/TestExplorer/index.jsx";
import DebuggerPanel from "./components/Debugger/index.jsx";
import { getActiveEditorPath } from "./components/Editor/shared.js";
import { createClosedEditorHistory, closedEditorSnapshot, relativeProjectPath, findOpenEditor } from "./components/shared/editorTabs.cjs";
import { ExtToasts } from "./components/Extensions/Host.jsx";
import UpdaterBanner from "./components/UpdaterBanner/index.jsx";
import {
  COMMANDS, effectiveBinding, eventToKey, isSafeBareKey,
  normalizeKeyForCompare, runAppCommand,
} from "./appCommands.js";

// Edge borders (left / right / top / bottom) — empty + auto-hidden until
// a tab is dragged to a window edge. Drag-to-edge docking needs them present.
const defaultBorders = () => (["left", "right", "top", "bottom"].map((location) => ({
  type: "border", location, size: 240, selected: -1, show: true, enableAutoHide: true,
})));
// Old saved layouts predate borders — inject any missing ones (idempotent).
const ensureBorders = (json) => {
  try {
    if (!json || typeof json !== "object") return json;
    if (!Array.isArray(json.borders)) json.borders = [];
    const have = new Set(json.borders.map((b) => b && b.location));
    defaultBorders().forEach((b) => { if (!have.has(b.location)) json.borders.push(b); });
  } catch {}
  return json;
};

const DEFAULT_JSON = {
  global: {
    tabEnableClose: false,
    tabEnableRename: false,
    tabEnableDrag: true,
    tabEnablePopout: true,
    tabEnablePopoutIcon: true,
    // 0.9+ built-in float: floating panels inside the main window
    // (safe for <webview> tabs — no cross-window re-parent).
    tabEnableFloat: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrop: true,
    tabSetHeaderShown: true,
    tabSetTabStripHeight: 26,
    // 0.9+: splitterSize/splitterExtra globals removed — now CSS vars
    // (--flexlayout-splitter-size / --flexlayout-splitter-active-size in layout.css).
    tabSetMinWidth: 100,
    tabSetMinHeight: 80,
    borderMinSize: 80,
    enableUseVisibility: true,
  },
  borders: defaultBorders(),
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "row", weight: 75,
        children: [
          { type: "tabset", weight: 65, children: [{ type: "tab", name: "Browser", component: "panel3", enablePopout: false, config: { type: "browser", title: "Browser" } }] },
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

// Blank workspace layout (Create Project → "Blank workspace"): just one blank
// panel — the user opens panels manually. tabs.json `layout: "blank"` triggers it.
const BLANK_JSON = {
  global: { ...DEFAULT_JSON.global },
  borders: defaultBorders(),
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

// Temp single-file layout (OS "Open With" → temp project): only one editor
// panel — not the full IDE layout. Tabs (multi-file) open in this same tabset.
// It is transient and never persisted.
const SINGLE_FILE_JSON = {
  global: { ...DEFAULT_JSON.global },
  borders: defaultBorders(),
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "tabset",
        weight: 100,
        children: [{ type: "tab", name: "Editor", component: "editor" }],
      },
    ],
  },
};

// Extra built-in presets (Layouts dropdown). Same shape as DEFAULT_JSON so
// they pass through sanitize/enable/disable helpers unchanged.
const makeBuiltinLayout = (children) => ({
  global: { ...DEFAULT_JSON.global },
  borders: defaultBorders(),
  layout: { type: "row", weight: 100, children },
});

const browserTab = { type: "tab", name: "Browser", component: "panel3", enablePopout: false, config: { type: "browser", title: "Browser" } };
const editorTab = { type: "tab", name: "Editor", component: "editor" };
const terminalTab = { type: "tab", name: "Terminal", component: "terminal", id: "terminal-tab" };

const VSCODE_JSON = makeBuiltinLayout([
  {
    type: "tabset", weight: 18,
    children: [
      { type: "tab", name: "Project", component: "projectPanel" },
      { type: "tab", name: "Git", component: "gitPanel" },
    ],
  },
  {
    type: "row", weight: 57,
    children: [
      {
        type: "tabset", weight: 68, id: "editor-tabset",
        children: [editorTab],
      },
      {
        type: "tabset", weight: 32,
        children: [
          terminalTab,
          { type: "tab", name: "Problems", component: "problems" },
          { type: "tab", name: "Output", component: "output" },
          { type: "tab", name: "Ports", component: "ports" },
        ],
      },
    ],
  },
  {
    type: "tabset", weight: 25,
    children: [
      browserTab,
      { type: "tab", name: "Preview", component: "componentPreview" },
    ],
  },
]);

const WEBDEV_JSON = makeBuiltinLayout([
  {
    type: "row", weight: 60,
    children: [
      {
        type: "tabset", weight: 72,
        children: [
          browserTab,
          { type: "tab", name: "Preview", component: "componentPreview" },
        ],
      },
      {
        type: "tabset", weight: 28,
        children: [
          terminalTab,
          { type: "tab", name: "Problems", component: "problems" },
          { type: "tab", name: "Output", component: "output" },
        ],
      },
    ],
  },
  {
    type: "tabset", weight: 40, id: "editor-tabset",
    children: [
      editorTab,
      { type: "tab", name: "Project", component: "projectPanel" },
      { type: "tab", name: "Git", component: "gitPanel" },
    ],
  },
]);

const DEBUG_JSON = makeBuiltinLayout([
  {
    type: "tabset", weight: 16,
    children: [{ type: "tab", name: "Project", component: "projectPanel" }],
  },
  {
    type: "row", weight: 59,
    children: [
      {
        type: "tabset", weight: 62, id: "editor-tabset",
        children: [editorTab],
      },
      {
        type: "tabset", weight: 38,
        children: [
          terminalTab,
          { type: "tab", name: "Output", component: "output" },
        ],
      },
    ],
  },
  {
    type: "tabset", weight: 25,
    children: [
      { type: "tab", name: "Run & Debug", component: "runDebug" },
      { type: "tab", name: "Problems", component: "problems" },
    ],
  },
]);

const FOCUS_JSON = makeBuiltinLayout([
  {
    type: "tabset", weight: 16,
    children: [{ type: "tab", name: "Project", component: "projectPanel" }],
  },
  {
    type: "tabset", weight: 84, id: "editor-tabset",
    children: [editorTab],
  },
]);
// Panel content by tab-JSON — the factory renders it from the tab node's
// JSON attributes: component + config + nodeId in one place.
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
    case "aiPanel":           return <AIAgentPanel />;   // legacy saved tab → OpenCode AI Agent
    case "androidEmulator":   return <AndroidEmulatorPanel />;
    case "aiAgent":           return <AIAgentPanel />;
    case "extensions":        return <ExtensionsPanel />;
    case "extView":           return <ExtView config={config} nodeId={nodeId} />;
    case "localHistory":      return <LocalHistoryPanel config={config} nodeId={nodeId} />;
    case "testExplorer":      return <TestExplorer config={config} nodeId={nodeId} />;
    case "debugPanel":       return <DebuggerPanel config={config} nodeId={nodeId} />;
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

// ── Crash-safe wrapper: every tab root runs inside it.
// If any panel throws in popout / normal cases, this keeps
// the whole FlexLayout tree from crashing.
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

// Stop the current run no matter where it was started. The Run panel (when
// mounted) handles run:stopCurrent; if it is closed/hidden — or was just
// reopened and lost its runs map — fall back to the newest PTY from main.
const stopCurrentRunGlobal = async () => {
  let before = [];
  try { before = (await window.electronAPI?.runList?.()) || []; } catch {}
  try { window.dispatchEvent(new CustomEvent("run:stopCurrent")); } catch {}
  if (!before.length) return;
  // Give the panel's stop IPC a moment to land before deciding it did nothing.
  await new Promise((resolve) => setTimeout(resolve, 350));
  let after = [];
  try { after = (await window.electronAPI?.runList?.()) || []; } catch {}
  if (after.length >= before.length) {
    const newest = [...before].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
    if (newest?.runId) {
      try { await window.electronAPI?.runStop?.(newest.runId); } catch {}
    }
  }
};

// ── Run status-bar button — visual replacement for the menu-bar Run menu ──
// Main click → project auto-command first (npm run dev / ...), else open file.
// Dropdown caret → ALL run options (Auto, Current File, npm scripts, customs)
// Arrives from the Run panel via `run:options`; click → open the panel + run.
const RunStatusButton = () => {
  const [open, setOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [runLabel, setRunLabel] = React.useState("");
  const [hovered, setHovered] = React.useState(false);
  const [runOptions, setRunOptions] = React.useState([]);
  const wrapRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const lastStatusAtRef = React.useRef(0);

  // Authoritative status straight from main — works even when the Run panel is
  // unmounted (FlexLayout removes hidden tabs, so its run:status broadcasts stop).
  const refreshStatus = React.useCallback(async (force) => {
    try {
      const list = await window.electronAPI?.runList?.();
      if (!Array.isArray(list)) return;
      if (list.length) {
        const newest = [...list].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
        setRunning(true);
        setRunLabel(newest?.label || `${list.length} running`);
      } else if (force || Date.now() - lastStatusAtRef.current > 2500) {
        // Don't race a just-started run: addRun fires run:status before the
        // run:start IPC has registered the PTY in main.
        setRunning(false);
        setRunLabel("");
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    let dead = false;
    const tick = async () => {
      if (dead) return;
      await refreshStatus();
    };
    tick();
    const iv = setInterval(tick, 1500);
    return () => { dead = true; clearInterval(iv); };
  }, [refreshStatus]);

  React.useEffect(() => {
    const onStatus = (event) => {
      const detail = event?.detail || {};
      lastStatusAtRef.current = Date.now();
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
      try {
        if (wrapRef.current?.contains(e.target)) return;
        if (menuRef.current?.contains(e.target)) return;
        setOpen(false);
      } catch {}
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onBlur = () => { setOpen(false); };
    window.addEventListener("pointerdown", onDoc, true);
    window.addEventListener("mousedown", onDoc, true);
    window.addEventListener("click", onDoc, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDoc, true);
      window.removeEventListener("mousedown", onDoc, true);
      window.removeEventListener("click", onDoc, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  // When an option is picked → open the panel (mount) + keep it pending for polling.
  // The Run panel picks it up on its 700ms poll (mount-race safe).
  const runOption = (id) => {
    setOpen(false);
    try {
      window.__pendingRunOption = { id };
      window.dispatchEvent(new CustomEvent("add-run-panel"));
    } catch {}
  };

  const dispatch = async (channel) => {
    setOpen(false);
    try {
      if (channel === "runAuto") {
        // Fresh check — the button state can lag behind main when the Run
        // panel is closed (no run:status events reach us).
        let active = running;
        try {
          const list = await window.electronAPI?.runList?.();
          if (Array.isArray(list)) active = list.length > 0;
        } catch {}
        if (active) {
          await stopCurrentRunGlobal();
          refreshStatus(true);
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
    border: "1px solid rgba(255, 255, 255, 0.16)", color: "#fff", fontSize: 11.5, letterSpacing: 0.01,
    fontFamily: "inherit", fontWeight: 600,
    height: 22, boxSizing: "border-box", cursor: "pointer", WebkitAppRegion: "no-drag",
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
    color: "var(--text-primary)", fontSize: 12.5, textAlign: "left", cursor: "pointer",
    fontFamily: "inherit", WebkitAppRegion: "no-drag",
  };

  const menuPos = (() => {
    const r = wrapRef.current?.getBoundingClientRect?.();
    if (!r) return { position: "fixed", top: 36, left: 12 };
    return {
      position: "fixed",
      top: r.bottom + 6,
      left: Math.max(8, Math.min(r.right - 250, window.innerWidth - 258)),
    };
  })();

  return (
    <span ref={wrapRef} className="tb-run">
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
          padding: "0 9px",
        }}
      >
        {running ? <span style={{ width: 9, height: 9, background: "currentColor", borderRadius: 2 }} /> : <Play size={11} strokeWidth={2.4} fill="currentColor" />}
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
          display: "inline-flex", alignItems: "center", padding: "0 6px",
        }}
      >
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && createPortal(
        <div ref={menuRef} style={{
          ...menuPos, zIndex: 100000,
          background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6,
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
            <div style={{ height: 1, background: "var(--border-subtle)", margin: "5px 4px" }} />
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
            <div style={{ fontSize: 12, color: "var(--icon)", padding: "6px 10px" }}>
              Open Run &amp; Debug once — options appear here
            </div>
          )}
          <div style={{ height: 1, background: "var(--border-subtle)", margin: "5px 4px" }} />
          <button onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent("add-run-panel")); }} style={menuItem} title="Run Configuration">
            <Settings2 size={15} strokeWidth={1.8} /> <span>Run Configuration</span>
          </button>
        </div>,
        document.body
      )}
    </span>
  );
};

// ── Title bar right: Layouts box — saved panel layouts dropdown ────────────
// (Previously this box only sent the user back to the Hub — its link is now in the
// dropdown footer; its primary job is saving/applying the current layout.)
const layoutWhen = (ts) => {
  try {
    const diff = Date.now() - Number(ts || 0);
    if (diff < 60000) return "now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h";
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return ""; }
};

// Built-in defaults — always 2 rows at the top of the dropdown: Normal (default)
// and Blank. These are not saved presets, so they have no delete option.
const BUILTIN_LAYOUTS = [
  { id: "__builtin_default", name: "Default layout", panels: DEFAULT_JSON, layout: "normal" },
  { id: "__builtin_vscode", name: "VS Code layout", panels: VSCODE_JSON, layout: "normal" },
  { id: "__builtin_webdev", name: "Web Dev layout", panels: WEBDEV_JSON, layout: "normal" },
  { id: "__builtin_debug", name: "Debug layout", panels: DEBUG_JSON, layout: "normal" },
  { id: "__builtin_focus", name: "Focus (editor) layout", panels: FOCUS_JSON, layout: "normal" },
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
    const onBlur = () => { setOpen(false); };
    window.addEventListener("pointerdown", onDoc, true);
    window.addEventListener("mousedown", onDoc, true);
    window.addEventListener("click", onDoc, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      dead = true;
      window.removeEventListener("pointerdown", onDoc, true);
      window.removeEventListener("mousedown", onDoc, true);
      window.removeEventListener("click", onDoc, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
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

// ── Recents normalize (Hub-style shape: {path, lastOpened}) ─────────────────
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
// No new trigger button: CET's existing `.cet-icon` (favicon image,
// before the File menu in the titlebar) is made clickable here.
const TitlebarLogoMenu = ({ hasProject }) => {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const [iconEl, setIconEl] = useState(null);
  const iconRef = useRef(null);
  const menuRef = useRef(null);

  // Find the existing CET logo (the titlebar DOM takes time to build)
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

  // Turn the logo into a trigger (click / Enter / Space toggle, ignore dblclick)
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
    const onBlur = () => { setOpen(false); };
    window.addEventListener("pointerdown", onDoc, true);
    window.addEventListener("mousedown", onDoc, true);
    window.addEventListener("click", onDoc, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
    return () => {
      dead = true;
      try { unsub?.(); } catch {}
      window.removeEventListener("pointerdown", onDoc, true);
      window.removeEventListener("mousedown", onDoc, true);
      window.removeEventListener("click", onDoc, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onBlur);
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
  // Always show the confirm tab (as the user requested); open directly on the Hub.
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
        <img className="tb-logo-head-img" src="./assets/idot_box.png" alt="" />
        <div className="tb-logo-head-txt">
          <span className="tb-logo-head-name">Idiot Box</span>
          <span className="tb-logo-head-sub">{currentPath ? recentBaseName(currentPath) : "Project Hub"}{currentPath && window.__ibxTransientProject ? " (temp — layout not saved)" : ""}</span>
        </div>
      </div>

      {hasProject && (
        <button className="tb-logo-item tb-logo-item--primary" onClick={backToHub} title={window.__ibxTransientProject ? "Close temp view and go back to the Hub (layout is not saved)" : "Save this project and go back to the Hub"}>
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

// Blank layouts have no editor tabset — target any tabset (the blank-panel one)
// to open files.
const findAnyTabset = (node) => {
  if (node.getType?.() === "tabset") return node;
  const children = node.getChildren?.();
  if (children) for (const c of children) { const r = findAnyTabset(c); if (r) return r; }
  return null;
};

// ── Per-project panel layout sanitize (tabs.json → panels) ─────────────────
// If a saved layout was made in another version, map unknown components to blank —
// otherwise the factory would produce an empty/crashing tab.
const PROJECT_PANEL_COMPONENTS = new Set([
  "mediaViewer", "panel3", "projectPanel", "editor", "notebook", "terminal",
  "blank", "componentPreview", "community", "canvas", "problems", "output",
  "runDebug", "gitPanel", "ports", "androidEmulator", "openPencil", "aiAgent",
  "extensions", "extView", "localHistory", "testExplorer", "debugPanel",
]);
const sanitizeProjectPanels = (json) => {
  try {
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "tab") {
        // Migrate old saved AI panel tabs (component "aiPanel") to the OpenCode-powered AI Agent tab
        // so pre-0.1.29 saved sessions render the AI Agent instead of a blank panel.
        if (node.component === "aiPanel") { node.component = "aiAgent"; node.name = "AI Agent"; node.config = node.config || {}; }
        // .ipynb files now render in editor tabs (like a session migration)
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
    // Also sanitize popout windows (FlexLayout multi-window) — their
    // inner tabs are saved in the same model JSON.
    // 0.9+: `popouts` renamed to `subLayouts` (old sessions still load) — walk both.
    const sub = json?.subLayouts && typeof json.subLayouts === "object" ? Object.values(json.subLayouts) : [];
    const pops = json?.popouts && typeof json.popouts === "object" ? Object.values(json.popouts) : [];
    [...sub, ...pops].forEach((p) => walk(p?.layout));
  } catch {}
  return json;
};

// Old saved sessions may have tabEnablePopout saved as false — always
// force-enable the popout + float features (both default + saved).
// Float stays in the main window, so it is safe for <webview> tabs too.
const enablePopouts = (json) => {
  try {
    if (!json.global || typeof json.global !== "object") json.global = {};
    json.global.tabEnablePopout = true;
    json.global.tabEnablePopoutIcon = true;
    json.global.tabEnableFloat = true;
  } catch {}
  return json;
};

// ── Webview panels must NEVER pop out ──────────────────────────────────────
// Electron <webview> guests are bound to their embedder WebContents — moving
// the tab into a FlexLayout popout window (popout.html, a separate
// BrowserWindow) detaches/re-parents the guest and crashes the whole app.
// This affects Browser, Community, OpenPencil and AI Agent (all host <webview>).
// Fix: per-tab enablePopout=false (hides the header popout icon + context
// menu entry) AND a runtime veto in handleLayoutAction (covers drag-out,
// programmatic popoutTab and old saved layouts that lack the flag).
const WEBVIEW_NO_POPOUT_COMPONENTS = new Set(["panel3", "community", "openPencil", "aiAgent"]);
const isWebviewTabJson = (tabJson) => {
  try {
    if (!tabJson || tabJson.type !== "tab") return false;
    if (WEBVIEW_NO_POPOUT_COMPONENTS.has(tabJson.component)) return true;
    if (tabJson.config && tabJson.config.type === "browser") return true;
  } catch {}
  return false;
};
// Force enablePopout=false on every saved/default webview tab (idempotent).
const disableWebviewPopouts = (json) => {
  try {
    const walk = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "tab" && isWebviewTabJson(node)) {
        node.enablePopout = false;
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    if (json?.layout) walk(json.layout);
    if (Array.isArray(json?.borders)) json.borders.forEach(walk);
    // 0.9+: subLayouts (popouts deprecated) — walk both for old sessions.
    const sub2 = json?.subLayouts && typeof json.subLayouts === "object" ? Object.values(json.subLayouts) : [];
    const pops2 = json?.popouts && typeof json.popouts === "object" ? Object.values(json.popouts) : [];
    [...sub2, ...pops2].forEach((p) => walk(p?.layout));
  } catch {}
  return json;
};
// New tabs: single place that builds tab JSON with the correct popout flag.
const makeTabJson = (component, name, config, extra) => {
  const json = { type: "tab", component, name, enableClose: true, config, ...(extra || {}) };
  if (isWebviewTabJson(json)) json.enablePopout = false;
  return json;
};
// Runtime check on live model nodes (for the onAction veto).
const isWebviewModelNode = (node) => {
  try {
    if (!node || node.getType?.() !== "tab") return false;
    const c = node.getComponent?.();
    if (c && WEBVIEW_NO_POPOUT_COMPONENTS.has(c)) return true;
    const cfg = node.getConfig?.();
    if (cfg && cfg.type === "browser") return true;
  } catch {}
  return false;
};
// Small transient notice — FlexLayout gives no callback when onAction vetoes,
// so tell the user why nothing happened (instead of silent confusion).
const showPopoutBlockedToast = () => {
  try {
    let el = document.getElementById("ibx-popout-blocked-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ibx-popout-blocked-toast";
      el.style.cssText = "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);max-width:min(520px,90vw);background:var(--bg-vscode,#1e1e1e);color:var(--text-hover,#ddd);border:1px solid var(--border-strong,#444);border-radius:8px;padding:10px 16px;font-size:12px;font-family:inherit;box-shadow:0 8px 28px rgba(0,0,0,.5);z-index:99999;opacity:0;transition:opacity .2s;pointer-events:none;text-align:center;";
      document.body.appendChild(el);
    }
    el.textContent = "Browser / webview panels can't be popped out — the embedded page must stay in the main window.";
    el.style.opacity = "1";
    clearTimeout(el._hideT);
    el._hideT = setTimeout(() => { try { el.style.opacity = "0"; } catch {} }, 2800);
  } catch {}
};
// Generic transient notice for layout ops (move-to-border failures, etc.).
const showLayoutToast = (msg) => {
  try {
    let el = document.getElementById("ibx-layout-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "ibx-layout-toast";
      el.style.cssText = "position:fixed;bottom:28px;left:50%;transform:translateX(-50%);max-width:min(520px,90vw);background:var(--bg-vscode,#1e1e1e);color:var(--text-hover,#ddd);border:1px solid var(--border-strong,#444);border-radius:8px;padding:10px 16px;font-size:12px;font-family:inherit;box-shadow:0 8px 28px rgba(0,0,0,.5);z-index:99999;opacity:0;transition:opacity .2s;pointer-events:none;text-align:center;";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el._hideT);
    el._hideT = setTimeout(() => { try { el.style.opacity = "0"; } catch {} }, 3200);
  } catch {}
};

const forceLayoutRedraw = (m) => {
  try {
    const map = m?.getLayouts?.() ?? m?.getwindowsMap?.();
    if (map) [...map.values()].forEach((lw) => {
      // FlexLayout memoises tab CONTENT (TabContentRenderer). An in-place
      // attribute change (e.g. replacing a tab's filePath) updates the header
      // but not the content unless the controller bumps its revision. On
      // flexlayout 0.11 the only reliable way is redrawLayoutAndTabContent().
      try { lw?.getController?.()?.redrawLayoutAndTabContent?.(); } catch {}
      try { lw?.layout?.redraw?.("force"); } catch {}
      try { lw?.redraw?.("force"); } catch {}
    });
  } catch { /* ignore */ }
  // Main layout ref fallback (e.g. transient/edge models without controllers).
  try { window.__flexLayoutApi?.current?.redraw?.(); } catch { /* ignore */ }
};

const App = () => {
  const modelRef          = useRef(null);
  const layoutRef         = useRef(null); // ILayoutApi (0.9+: Layout is functional)
  const readyRef          = useRef(false);
  const currentProjectRef = useRef(null);
  const saveTabsTimer     = useRef(null);
  const lastBrowserTabsetRef = useRef(null);
  const closedEditorsRef = useRef(createClosedEditorHistory());
  const reopeningEditorRef = useRef(false);
  const requestEditorCloseRef = useRef(null);
  const [hasProject, setHasProject] = useState(false);
  // Current project's layout mode — "blank" (one of Create Project's 2 buttons)
  const projectLayoutRef = useRef(null);
  // Temp project (OS "Open With" file → parent folder as workspace): layout/tabs
  // are NOT persisted — only file content is edited + saved.
  const transientProjectRef = useRef(false);
  const [tick, setTick] = useState(0);
  const [titlebarHost, setTitlebarHost] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // ── Onboarding check — only on first launch (or after data is cleared) ──────
  // It is a full page (components/Onboarding), not a modal. Save/Skip is handled
  // there; here only show/hide + username cache.
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
    const findTitlebar = () => {
      const tb = document.querySelector(".cet-titlebar");
      if (tb) { setTitlebarHost(tb); return; }
      if (attempts++ < 40) timer = setTimeout(findTitlebar, 50);
    };
    findTitlebar();
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
    window.__flexActions = Actions;
    window.__flexDockLocation = DockLocation;
    window.__flexLayoutApi = layoutRef;
    window.__getLayoutJSON = () => modelRef.current ? modelRef.current.toJson() : null;
    return () => {
      delete window.__flexModel;
      delete window.__flexActions;
      delete window.__flexDockLocation;
      delete window.__flexLayoutApi;
      delete window.__getLayoutJSON;
    };
  }, []);

  // ── Save current open editor tabs per project ──────────────────────────
  // Each project has its own tabs.json (in its store folder) — no shared config.
  // Only files INSIDE that project are saved (no leakage from other projects).
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
    // Temp project: do not persist layout/tabs at all.
    if (transientProjectRef.current) return;
    const rootPath = currentProjectRef.current;
    if (!rootPath) return;
    const m = modelRef.current;
    if (!m) return;
    const tabs = collectEditorTabs(m.getRoot()).filter((t) => pathInsideRoot(t, rootPath));
    // Preserve the layout mode ("blank") — otherwise the preference is lost on every save
    const payload = { tabs };
    if (projectLayoutRef.current === "blank") payload.layout = "blank";
    // Full panel layout (which panels were open, their arrangement) — restored
    // as-is when the project reopens.
    try { payload.panels = m.toJson(); } catch {}
    window.electronAPI.writeProjectTabs(rootPath, payload).catch(() => {});
  };

  // ── Per-project isolation: stop the old project's processes/activity ───
  // The layout itself is saved/loaded (doSaveProjectTabs/loadProjectLayout) —
  // so do NOT delete tabs, only: kill terminal PTYs, stop the running run,
  // reset output. Git/Output/Problems/Ports panels STAY — they rebind to the
  // current project on their own.
  const closeProjectTabs = useCallback((oldRoot) => {
    // Terminal PTYs: kill only the old root's (emulator mirrors are spared)
    try { window.dispatchEvent(new CustomEvent("terminals:killAll", { detail: { root: oldRoot || null } })); } catch {}
    // Stop the running run (RunPanel listens; global fallback kills the PTY)
    try { stopCurrentRunGlobal(); } catch {}
    // Output reset — clear all channels
    try {
      if (window.__outputBuffer) {
        for (const k of Object.keys(window.__outputBuffer)) window.__outputBuffer[k] = [];
      }
      window.dispatchEvent(new CustomEvent("output:log", { detail: { channel: "App" } }));
    } catch {}
  }, []);

  const scheduleSaveProjectTabs = () => {
    if (transientProjectRef.current) return;
    clearTimeout(saveTabsTimer.current);
    saveTabsTimer.current = setTimeout(doSaveProjectTabs, 600);
  };

  // Observe actual deletions, including context-menu closes. A cancelled
  // close never removes a model node and must never enter the recovery history.
  useEffect(() => {
    const root = currentProjectRef.current;
    const history = closedEditorsRef.current;
    history.setProject(root);
    const m = modelRef.current;
    if (!m || !hasProject) return;
    const pending = new Map();
    const listener = {
      onBeforeAction(action) {
        if (action.type !== Actions.DELETE_TAB) return;
        const snapshot = closedEditorSnapshot(m.getNodeById(action.data.node));
        if (snapshot) pending.set(action, snapshot);
      },
      onAfterAction(action) {
        const snapshot = pending.get(action);
        pending.delete(action);
        if (snapshot && currentProjectRef.current === root && !m.getNodeById(action.data.node)) {
          history.remember(snapshot);
          scheduleSaveProjectTabs();
        }
      },
    };
    m.addChangeListener(listener);
    return () => m.removeChangeListener(listener);
  }, [tick, hasProject]);

  useEffect(() => {
    const reopen = async () => {
      if (reopeningEditorRef.current) return;
      const m = modelRef.current;
      const root = currentProjectRef.current;
      const history = closedEditorsRef.current;
      const entry = history.peek();
      if (!root || !m || !entry) { showLayoutToast("No recently closed editors in this project."); return; }
      reopeningEditorRef.current = true;
      try {
        const filePath = entry.tab.config.filePath;
        const stat = await window.electronAPI.stat(filePath);
        // A project switch while stat is pending must not open a tab there.
        if (modelRef.current !== m || currentProjectRef.current !== root) return;
        if (!stat?.exists || stat.isDir) {
          history.remove(entry);
          showLayoutToast("The closed file is no longer available.");
          return;
        }
        const existing = findOpenEditor(m, filePath);
        if (existing) m.doAction(Actions.selectTab(existing.getId()));
        else {
          const previous = m.getNodeById(entry.parentId);
          const parent = ["tabset", "border"].includes(previous?.getType?.())
            ? previous : findEditorTabset(m.getRoot()) || m.getActiveTabset() || m.getFirstTabSet();
          if (!parent) return;
          const tab = m.doAction(Actions.addNode(entry.tab, parent.getId(), DockLocation.CENTER, entry.index, true));
          if (!tab) return;
        }
        history.remove(entry);
        forceLayoutRedraw(m);
        scheduleSaveProjectTabs();
      } catch { showLayoutToast("Could not reopen the closed editor."); }
      finally { reopeningEditorRef.current = false; }
    };
    const off = window.electronAPI.onMenuEvent("menu:reopenClosedEditor", reopen);
    window.addEventListener("editor:reopenClosed", reopen);
    return () => { off(); window.removeEventListener("editor:reopenClosed", reopen); };
  }, []);

  // Save the current project's layout/tab data immediately when the window closes
  // (the 600ms debounce is a best-effort backup).
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
    // Only files inside this project (exclude stale mixed entries)
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
      disableWebviewPopouts(enablePopouts(ensureBorders(json)));
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
            const allowed = new Set(["mediaViewer","panel3","projectPanel","editor","notebook","terminal","blank","componentPreview","community","canvas","problems","output","runDebug","gitPanel","ports","androidEmulator","builder","docs","openPencil","aiAgent","extensions","extView","localHistory","testExplorer","debugPanel"]);
            // Migrate old saved AI panel tabs (component "aiPanel") to the OpenCode-powered AI Agent tab
            // so pre-0.1.29 saved sessions render the AI Agent instead of a blank panel.
            if (node.component === "aiPanel") { node.component = "aiAgent"; node.name = "AI Agent"; node.config = node.config || {}; }
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
      // NOTE: AI panel removed — old saved sessions with an aiPanel tab will render blank.
      modelRef.current = Model.fromJson(json);
      readyRef.current = true;
      setTick((t) => t + 1);
      // OS "Open With Idiot Box" (argv / second-instance / open-file): the model
      // is ready → notify main; it will ping for pending files and the
      // onOsFilesPending listener will open them in tabs.
      try { window.electronAPI.notifyEditorReady?.().catch(() => {}); } catch {}
    })();
  }, []);

  // ── Project open / close → save & restore tabs ───────────────────────────
  useEffect(() => {
    const handleOpen = async (folderPath) => {
      // Save tabs for whatever project was open before switching
      doSaveProjectTabs();
      // End the old project's panels/process/output here — new project starts clean
      closeProjectTabs(currentProjectRef.current);
      currentProjectRef.current = folderPath;
      window.__currentProjectPath = folderPath;
      // Real project — temp mode off
      transientProjectRef.current = false;
      try { window.__ibxTransientProject = false; } catch {}
      // Read project data: layout mode ("blank") + saved panel layout
      let saved = null;
      try { saved = await window.electronAPI.readProjectTabs(folderPath); } catch {}
      projectLayoutRef.current = saved?.layout === "blank" ? "blank" : null;
      // Saved panels (as the user left them) — only while session
      // restore is ON (General → Restore Previous Session).
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
      // Saved panel layout → restore as-is; otherwise the default/blank layout.
      let restored = false;
      if (savedPanels) {
        try {
          const json = disableWebviewPopouts(enablePopouts(ensureBorders(sanitizeProjectPanels(JSON.parse(JSON.stringify(savedPanels))))));
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
      // If panels are already restored, the editor tabs are already in them
      if (!restored) await restoreProjectTabs(folderPath);
    };

    const handleClose = () => {
      doSaveProjectTabs();
      closeProjectTabs(currentProjectRef.current);
      currentProjectRef.current = null;
      projectLayoutRef.current = null;
      transientProjectRef.current = false;
      window.__currentProjectPath = null;
      try { window.__ibxTransientProject = false; } catch {}
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
    // The title bar's Workspaces box uses this to send the user back to the Hub
    window.__ibxCloseProject = handleClose;
    // ── Unified palette (`CommandPalette`) commands are handled here ──
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
      m.doAction(Actions.addNode(
        makeTabJson("panel3", "New Tab", { type: "browser", title: "New Tab", url: url || "https://www.google.com" }),
      tabsetId, DockLocation.CENTER, -1, true));
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
      window.electronAPI.onMenuEvent("menu:localHistory", () => window.dispatchEvent(new CustomEvent("local-history:open"))),
      window.electronAPI.onMenuEvent("menu:testExplorer", () => window.dispatchEvent(new CustomEvent("add-test-explorer-panel"))),
      window.electronAPI.onMenuEvent("menu:debugPanel", () => window.dispatchEvent(new CustomEvent("add-debug-panel"))),
      window.electronAPI.onMenuEvent("menu:debugCurrent", () => {
        const detail = {
          requestId: `dbgcur_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          path: getActiveEditorPath() || "",
        };
        try { window.__pendingDebugFile = detail; } catch {}
        window.dispatchEvent(new CustomEvent("add-debug-panel"));
        setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent("debug:currentFile", { detail })); } catch {}
        }, 150);
      }),
    ];
    return () => handlers.forEach((u) => u());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Editable global shortcuts (settings.keybindings) ────────────────────
  // Native menu commands are handled by Electron accelerators; editor
  // commands by the CodeMirror keymap. This listener covers renderer-level
  // commands (Find in Files, Local History, Debugger, Test Explorer, …).
  useEffect(() => {
    let bindings = {};
    let alive = true;
    const nativeOrEditor = new Set(
      COMMANDS.filter((c) => c.native || c.scope === "editor").map((c) => c.id)
    );
    const applySettings = (s) => {
      if (!alive) return;
      bindings = s && typeof s === "object" && s.keybindings && typeof s.keybindings === "object"
        ? s.keybindings
        : {};
    };
    window.electronAPI.readSettings().then(applySettings).catch(() => {});
    let off = null;
    try { off = window.electronAPI.onSettingsUpdated(applySettings); } catch {}

    const commandForKey = (key) => {
      const k = normalizeKeyForCompare(key);
      if (!k) return null;
      for (const c of COMMANDS) {
        if (nativeOrEditor.has(c.id)) continue;
        const wants = effectiveBinding(c.id, bindings);
        if (wants && normalizeKeyForCompare(wants) === k) return c.id;
      }
      return null;
    };

    const onKey = (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      const key = eventToKey(e);
      if (!key) return;
      const hasMod = /^(Ctrl|Alt)\+/.test(key);
      if (!hasMod && !isSafeBareKey(key.replace(/^Shift\+/, ""))) return;
      const id = commandForKey(key);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      runAppCommand(id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      alive = false;
      try { off && off(); } catch {}
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

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
      m.doAction(Actions.addNode(
        makeTabJson(component, name, config),
      parentId, DockLocation.CENTER, -1, true));
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
      // If the opener requested a channel (Run panel → "Run"), select it
      // in the Output panel — whether it is already open or just created.
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
    const onExtensions = () => {
      const m = modelRef.current;
      if (m) {
        const findExtensions = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "extensions") return node;
          const children = node.getChildren?.();
          if (children) for (const child of children) { const found = findExtensions(child); if (found) return found; }
          return null;
        };
        const existing = findExtensions(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("extensions", "Extensions", {});
    };
    // Extension views: one tab per (extId, viewType) — on a repeat
    // open request just select that tab.
    const onExtView = (e) => {
      const d = e?.detail || {};
      const extId = d.extId, viewType = d.viewType;
      if (!extId || !viewType) return;
      const m = modelRef.current;
      if (m) {
        const findView = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "extView") {
            const cfg = node.getConfig?.() || {};
            if (cfg.extId === extId && cfg.viewType === viewType) return node;
          }
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findView(c); if (r) return r; }
          return null;
        };
        const existing = findView(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("extView", d.title || `${extId}`, { extId, viewType });
    };
    const unExtFocus = window.electronAPI?.onExtViewFocus?.((p) => {
      if (!p?.extId || !p?.viewType) return;
      window.dispatchEvent(new CustomEvent("add-ext-view-panel", {
        detail: { extId: p.extId, viewType: p.viewType, title: p.title },
      }));
    });
    const onProblems = () => {
      const m = modelRef.current;
      if (m) {
        const findProblems = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "problems") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findProblems(c); if (r) return r; }
          return null;
        };
        const existing = findProblems(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("problems", "Problems", {});
    };
    const onOpenPencil = () => {
      const m = modelRef.current;
      if (m) {
        const findPencil = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "openPencil") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findPencil(c); if (r) return r; }
          return null;
        };
        const existing = findPencil(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("openPencil", "OpenPencil", {});
    };
    const onTestExplorer = () => {
      const m = modelRef.current;
      if (m) {
        const findTests = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "testExplorer") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findTests(c); if (r) return r; }
          return null;
        };
        const existing = findTests(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("testExplorer", "Tests", {});
    };
    const onLocalHistory = (e) => {
      const filePath = e?.detail?.filePath || getActiveEditorPath() || "";
      const m = modelRef.current;
      if (m) {
        const findHistory = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "localHistory") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findHistory(c); if (r) return r; }
          return null;
        };
        const existing = findHistory(m.getRoot());
        if (existing) {
          try { m.doAction(Actions.selectTab(existing.getId())); } catch {}
          try { window.dispatchEvent(new CustomEvent("local-history:focus", { detail: { filePath } })); } catch {}
          return;
        }
      }
      addPanel("localHistory", "Local History", filePath ? { filePath } : {});
    };
    const onDebugPanel = () => {
      const m = modelRef.current;
      if (m) {
        const findDebug = (node) => {
          if (node.getType?.() === "tab" && node.getComponent?.() === "debugPanel") return node;
          const ch = node.getChildren?.();
          if (ch) for (const c of ch) { const r = findDebug(c); if (r) return r; }
          return null;
        };
        const existing = findDebug(m.getRoot());
        if (existing) { try { m.doAction(Actions.selectTab(existing.getId())); } catch {} return; }
      }
      addPanel("debugPanel", "Debugger", {});
    };

    window.addEventListener("add-browser-panel", onBrowser);
    window.addEventListener("add-ai-agent-panel", onAiAgent);
    window.addEventListener("add-extensions-panel", onExtensions);
    window.addEventListener("add-ext-view-panel", onExtView);
    window.addEventListener("add-component-preview-panel", onPreview);
    window.addEventListener("add-community-panel", onCommunity);
    window.addEventListener("add-canvas-panel", onCanvas);
    window.addEventListener("add-ports-panel", onPorts);
    window.addEventListener("add-problems-panel", onProblems);
    window.addEventListener("add-open-pencil-panel", onOpenPencil);
    window.addEventListener("add-output-panel", onOutput);
    window.addEventListener("add-run-panel", onRunDebug);
    window.addEventListener("add-git-panel", onGit);
    window.addEventListener("add-android-panel", onAndroid);
    window.addEventListener("add-local-history-panel", onLocalHistory);
    window.addEventListener("local-history:open", onLocalHistory);
    window.addEventListener("add-test-explorer-panel", onTestExplorer);
    window.addEventListener("add-debug-panel", onDebugPanel);
    return () => {
      window.removeEventListener("add-browser-panel", onBrowser);
      window.removeEventListener("add-ai-agent-panel", onAiAgent);
      window.removeEventListener("add-extensions-panel", onExtensions);
      window.removeEventListener("add-ext-view-panel", onExtView);
      window.removeEventListener("add-component-preview-panel", onPreview);
      window.removeEventListener("add-community-panel", onCommunity);
      window.removeEventListener("add-canvas-panel", onCanvas);
      window.removeEventListener("add-ports-panel", onPorts);
      window.removeEventListener("add-problems-panel", onProblems);
      window.removeEventListener("add-open-pencil-panel", onOpenPencil);
      window.removeEventListener("add-output-panel", onOutput);
      window.removeEventListener("add-run-panel", onRunDebug);
      window.removeEventListener("add-git-panel", onGit);
      window.removeEventListener("add-android-panel", onAndroid);
      window.removeEventListener("add-local-history-panel", onLocalHistory);
      window.removeEventListener("local-history:open", onLocalHistory);
      window.removeEventListener("add-test-explorer-panel", onTestExplorer);
      window.removeEventListener("add-debug-panel", onDebugPanel);
      try { unExtFocus && unExtFocus(); } catch {}
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
        // Defer to avoid crash when closing a focused webview (same issue as Ctrl+W)
        setTimeout(() => {
          try { m.doAction(Actions.deleteTab(nodeId)); } catch {}
        }, 50);
      }
    };
    window.addEventListener("close-flex-tab", handler);
    return () => window.removeEventListener("close-flex-tab", handler);
  }, []);

  // Reset panels to the default layout (blank layout for blank projects too)
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
  useEffect(() => {
    const unsub = window.electronAPI.onMenuEvent("menu:openExtensions", () => {
      window.dispatchEvent(new CustomEvent("add-extensions-panel"));
    });
    return unsub;
  }, []);
  // ── Native Run menu (below the title bar) → Run panel actions ───────────
  useEffect(() => {
    const unsubs = [];
    unsubs.push(window.electronAPI.onMenuEvent("menu:runAuto", () => {
      try { window.__pendingAutoRun = { auto: true }; } catch {}
      window.dispatchEvent(new CustomEvent("add-run-panel"));
    }));
    unsubs.push(window.electronAPI.onMenuEvent("menu:runStop", () => {
      try { stopCurrentRunGlobal(); } catch {}
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
    // The palette command "Split Editor Right" triggers this same callback
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
        // FlexLayout popout window — do not send to the Browser panel, keep
        // native window.open (allowed by the main process).
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

  // Global tab commands: Ctrl+T opens a tab, Ctrl+W closes the active tab.
  // The renderer keybinding dispatcher filters the shortcut (so user overrides
  // win); the native menu accelerator is the fallback when a webview has focus.
  useEffect(() => {
    // The renderer-level keybinding dispatcher (Ctrl+W / Ctrl+T) and the
    // native accelerator can both deliver the same chord on some platforms.
    // Ignore the second delivery of one physical key press.
    let lastCloseAt = 0;
    let lastNewAt = 0;
    const closeActiveTab = () => {
      try {
        const now = Date.now();
        if (now - lastCloseAt < 150) return;
        lastCloseAt = now;
        // Defer the actual tab removal so the keydown / IPC event fully
        // completes before a focused <webview> (Browser panel etc.) is torn
        // down. Removing a focused webview synchronously crashes Electron's
        // renderer process — this is why closing a browser panel with
        // Ctrl+W used to kill the whole app.
        setTimeout(() => {
          try {
            const m = modelRef.current;
            const tab = m?.getActiveTabset?.()?.getSelectedNode?.();
            if (tab?.getId) requestEditorCloseRef.current?.(tab.getId());
          } catch {}
        }, 50);
      } catch {}
    };
    const newTab = () => {
      try {
        const now = Date.now();
        if (now - lastNewAt < 150) return;
        lastNewAt = now;
        const m = modelRef.current;
        if (!m || !currentProjectRef.current) return;
        const activeTabset = m.getActiveTabset?.();
        const activeTab = activeTabset?.getSelectedNode?.();
        const isEditorTab = activeTab && ["editor", "notebook"].includes(activeTab.getComponent?.());
        const tabset = (isEditorTab ? activeTabset : null)
          || findEditorTabset(m.getRoot()) || activeTabset || findAnyTabset(m.getRoot());
        if (!tabset) return;
        const used = new Set();
        try { m.visitNodes((n) => { if (n.getType?.() === "tab") used.add(n.getName?.()); }); } catch {}
        let n = 1;
        while (used.has(`Untitled-${n}`)) n++;
        m.doAction(Actions.addNode({
          type: "tab", component: "editor", name: `Untitled-${n}`, enableClose: true,
          id: "editor-tab-" + Date.now() + "-" + Math.random().toString(36).slice(2),
          config: {},
        }, tabset.getId(), DockLocation.CENTER, -1, true));
        forceLayoutRedraw(m);
        scheduleSaveProjectTabs();
      } catch {}
    };
    const offClose = window.electronAPI.onMenuEvent("menu:closeEditor", closeActiveTab);
    const offNew = window.electronAPI.onMenuEvent("menu:newTab", newTab);
    window.addEventListener("editor:closeTab", closeActiveTab);
    window.addEventListener("editor:newTab", newTab);

    // Ctrl+W at the renderer level (capture phase): close the active tab and
    // stop the chord from leaking through to any window-close path. The native
    // menu accelerator (CmdOrCtrl+W) is kept as the fallback for webview focus,
    // where this host-level listener cannot reach. The 150ms dedup inside
    // closeActiveTab prevents double execution when both fire for one press.
    // e.defaultPrevented is respected so terminals/editors can still use
    // Ctrl+W for their own purposes (e.g. delete word).
    const closeTabKeydown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (String(e.key || "").toLowerCase() !== "w") return;
      if (e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") {
        try { e.stopImmediatePropagation(); } catch {}
      }
      closeActiveTab();
    };
    window.addEventListener("keydown", closeTabKeydown, true);
    document.addEventListener("keydown", closeTabKeydown, true);
    return () => {
      offClose();
      offNew();
      window.removeEventListener("editor:closeTab", closeActiveTab);
      window.removeEventListener("editor:newTab", newTab);
      window.removeEventListener("keydown", closeTabKeydown, true);
      document.removeEventListener("keydown", closeTabKeydown, true);
    };
  }, []);

  // ── Ctrl+PageUp / Ctrl+PageDown: prev / next tab in the active tabset ──
  // VS Code style tab cycling — works from editor, terminal, or any panel
  // (capture phase so CodeMirror/xterm don't swallow it). Wraps around.
  useEffect(() => {
    const cycle = (dir) => {
      const m = modelRef.current;
      if (!m) return;
      try {
        const ts = m.getActiveTabset?.();
        if (!ts) return;
        const kids = (ts.getChildren?.() || []).filter((n) => {
          try { return n.getType() === "tab"; } catch { return false; }
        });
        if (kids.length < 2) return;
        const sel = ts.getSelectedNode?.();
        let idx = -1;
        try {
          const selId = sel?.getId?.();
          idx = kids.findIndex((k) => { try { return k.getId() === selId; } catch { return false; } });
        } catch {}
        if (idx < 0) idx = dir > 0 ? -1 : 0;
        const next = kids[(idx + dir + kids.length) % kids.length];
        if (next) {
          try { m.doAction(Actions.selectTab(next.getId())); } catch {}
          try { forceLayoutRedraw(m); } catch {}
        }
      } catch {}
    };
    const handler = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const k = e.key;
      if (k !== "PageUp" && k !== "PageDown") return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") try { e.stopImmediatePropagation(); } catch {}
      cycle(k === "PageUp" ? -1 : 1);
      return false;
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
      // In the single-editor temp layout the Media Viewer tab may or may not exist — if
      // missing, create it, then send the file after mount (otherwise the event goes nowhere).
      let hasViewer = false;
      try {
        const m = modelRef.current;
        if (m) {
          const findMedia = (node) => {
            if (node.getType?.() === "tab" && node.getComponent?.() === "mediaViewer") return node;
            const ch = node.getChildren?.();
            if (ch) for (const c of ch) { const r = findMedia(c); if (r) return r; }
            return null;
          };
          hasViewer = !!findMedia(m.getRoot());
        }
      } catch {}
      if (!hasViewer) {
        try {
          const m = modelRef.current;
          if (m) {
            const ts = m.getActiveTabset?.() || m.getFirstTabSet?.();
            const parentId = ts ? ts.getId() : m.getRoot().getId();
            m.doAction(Actions.addNode({
              type: "tab", component: "mediaViewer", name: "Media Viewer", enableClose: true,
            }, parentId, DockLocation.CENTER, -1, true));
            forceLayoutRedraw(m);
          }
        } catch {}
        setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: filePath } })); } catch {}
        }, 150);
        return;
      }
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

    // Temp project: no project open and a file arrived from outside (Open With /
    // double-click / IPC) → use the file's parent folder as the workspace.
    // Layout/tabs are NOT persisted (transient) — file content is edited + saved.
    const ensureTransientProjectForFile = (filePath) => {
      try {
        if (currentProjectRef.current || !filePath || typeof filePath !== "string") return;
        let dir = String(filePath).replace(/[\\/][^\\/]*$/, "");
        if (!dir || dir === filePath) return;
        currentProjectRef.current = dir;
        try { window.__currentProjectPath = dir; } catch {}
        transientProjectRef.current = true;
        try { window.__ibxTransientProject = true; } catch {}
        projectLayoutRef.current = null;
        try {
          modelRef.current = Model.fromJson(JSON.parse(JSON.stringify(SINGLE_FILE_JSON)));
        } catch {}
        setHasProject(true);
        try { window.dispatchEvent(new CustomEvent("project:opened", { detail: { path: dir, transient: true } })); } catch {}
        try { setTick((t) => t + 1); } catch {}
        try { forceLayoutRedraw(modelRef.current); } catch {}
      } catch {}
    };

    // Single-click: replace the active editor tab (VS Code preview-mode style).
    // If the file is already open somewhere, switch to it.
    // If no editor tab exists yet, create one.
    // (.ipynb included — EditorPanel embeds the notebook cell UI itself.)
    const openFileInEditor = (filePath) => {
      ensureTransientProjectForFile(filePath);
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
      ensureTransientProjectForFile(filePath);
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
    // Opens each file in its own tab (multi-select → multiple tabs).
    // Reuses an empty editor tab if there is one (VS Code style), otherwise a new tab — never
    // overwrites an existing tab (unsaved edits stay safe).
    const openFilesFromOs = (paths) => {
      const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && p);
      if (!list.length) return;
      // No project open → create a temp project in the first file's folder.
      if (!currentProjectRef.current) ensureTransientProjectForFile(list[0]);
      const m = modelRef.current;
      if (!m) return;
      let lastTabId = null;
      for (const filePath of list) {
        // Media / Excalidraw files → always open in their dedicated panels
        // (same routing as a Project panel click).
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

    // Main pings → pull pending OS files and open them.
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

  // ── Guard: if 0 panels are open, open the "New Panel" picker directly ────
  // Closing the last panel leaves FlexLayout with an empty tabset
  // (blank content area, only a "+" header). If the tab count is 0 here,
  // add the same blank picker tab that the "+" button opens.
  // Model swaps (project open / reset / preset) don't fire the change listener,
  // so the tick/hasProject effect is its safety net.
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
      scheduleSaveProjectTabs(); // model.doAction bypasses onAction — save explicitly here
    } catch { /* best-effort — never break the layout */ }
  };
  useEffect(() => { ensureNewPanelIfEmpty(); }, [tick, hasProject, showOnboarding]);

  // Onboarding is a full page — it renders in place of the hub/layout
  if (showOnboarding) {
    return <OnboardingPage onDone={() => setShowOnboarding(false)} />;
  }

  if (!readyRef.current) return null;

  // ── Guard: veto closing dirty editor/notebook tabs (Save / Don't Save / Cancel)
  // Returning undefined from onAction cancels the close; after the async
  // dialog resolves we re-issue the close directly on the model (which
  // bypasses onAction, so no loop).
  const handleLayoutAction = (action) => {
    // ── Crash guard: never let a <webview> tab leave the main window ──────
    // Popping out Browser/Community/OpenPencil/AI-Agent re-parents the guest
    // across BrowserWindows and crashes the app. Veto + toast instead.
    // NOTE: "float" popouts stay inside the main window — always allowed
    // (this is the webview-safe way to float Browser/AI panels).
    try {
      if (action && (action.type === Actions.POPOUT_TAB || action.type === Actions.POPOUT_TABSET)
        && action.data?.type !== "float") {
        const m = modelRef.current;
        let blocked = false;
        try {
          if (action.type === Actions.POPOUT_TAB) {
            const n = action.data?.node && m ? m.getNodeById(action.data.node) : null;
            blocked = isWebviewModelNode(n);
          } else if (action.type === Actions.POPOUT_TABSET) {
            const ts = action.data?.node && m ? m.getNodeById(action.data.node) : null;
            const kids = ts?.getChildren?.() || [];
            blocked = kids.some(isWebviewModelNode);
            // Tabset popout via drag can also carry the tabset's selected tab
            // only — walk one level deeper to be safe.
            if (!blocked) {
              try {
                const walk = (node) => {
                  if (!node) return false;
                  if (node.getType?.() === "tab" && isWebviewModelNode(node)) return true;
                  const ch = node.getChildren?.() || [];
                  for (const c of ch) if (walk(c)) return true;
                  return false;
                };
                blocked = walk(ts);
              } catch {}
            }
          }
        } catch {}
        if (blocked) {
          try { showPopoutBlockedToast(); } catch {}
          return undefined; // veto — keeps the webview in the main window
        }
      }
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
                // Defer to avoid crash when closing a focused webview (same issue as Ctrl+W)
                setTimeout(() => {
                  try { mm.doAction(Actions.deleteTab(nodeId)); } catch {}
                }, 50);
              }
            })();
            return undefined; // veto — async dialog decides
          }
        }
      }
    } catch {}
    // Panel close/add/move/split — save any layout change (debounced).
    // Skip non-layout actions like tab selection.
    try {
      if (!action || action.type !== Actions.SELECT_TAB) scheduleSaveProjectTabs();
    } catch {}
    return action;
  };

  requestEditorCloseRef.current = (nodeId) => {
    const action = handleLayoutAction(Actions.deleteTab(nodeId));
    if (action) modelRef.current?.doAction(action);
  };

  // Layouts dropdown: deep-copy snapshot of the current panel arrangement.
  const getLayoutSnapshot = () => {
    try {
      const m = modelRef.current;
      if (!m) return null;
      return { panels: JSON.parse(JSON.stringify(m.toJson())), layout: projectLayoutRef.current };
    } catch { return null; }
  };

  // Saved layout apply: new model + persist to project tabs.json (merge —
  // writeTabs replaces the whole file, so re-attach the current tabs).
  const applyLayoutPreset = (preset) => {
    try {
      if (!preset || !preset.panels || !preset.panels.layout || !currentProjectRef.current) return false;
      const json = disableWebviewPopouts(enablePopouts(ensureBorders(sanitizeProjectPanels(JSON.parse(JSON.stringify(preset.panels))))));
      modelRef.current = Model.fromJson(json);
      projectLayoutRef.current = preset.layout === "blank" ? "blank" : null;
      setTick((t) => t + 1);
      try { forceLayoutRedraw(modelRef.current); } catch {}
      const root = currentProjectRef.current;
      // Temp project: layout may apply visually, but is never persisted.
      if (transientProjectRef.current) return true;
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
      <div className="app-shell">
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
    <div className="app-shell">
      <UpdaterBanner />
      <TitlebarLogoMenu hasProject={hasProject} />
      {titlebarHost && createPortal(
        <>
          <RunStatusButton />
          <LayoutsMenu hasProject={hasProject} getSnapshot={getLayoutSnapshot} onApply={applyLayoutPreset} />
        </>,
        titlebarHost
      )}

      <div className="app-workspace">
        <Layout
      ref={layoutRef}
      model={modelRef.current}
      factory={factory}
      onAction={handleLayoutAction}
      onModelChange={(m, action) => {
        // Post-mutation hook — the tab count is correct here (the pre-onAction
        // count is stale). No count needed for SELECT_TAB.
        try {
          if (!action || action.type === Actions.SELECT_TAB) return;
          ensureNewPanelIfEmpty();
        } catch {}
      }}
      supportsPopout
      popoutURL="popout.html"
      popoutWindowName="Idiot Box"
      // Keep floating panels inside the main window (0.9+ built-in float).
      constrainFloatPanels
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
            // Defer to avoid crash when closing a focused webview (same issue as Ctrl+W)
            if (action === "close") {
              setTimeout(() => { try { m.doAction(Actions.deleteTab(tabId)); } catch {} }, 50);
            }
            else if (action === "closeOthers") {
              setTimeout(() => {
                tabs.filter((tab) => tab.getId() !== tabId).forEach((tab) => m.doAction(Actions.deleteTab(tab.getId())));
              }, 50);
            }
            else if (action === "closeAll") {
              setTimeout(() => {
                tabs.forEach((tab) => m.doAction(Actions.deleteTab(tab.getId())));
              }, 50);
            }
            else if (action === "duplicate" && duplicateable && parent) {
              m.doAction(Actions.addNode(
                makeTabJson(current.getComponent(), current.getName(), { ...(current.getConfig?.() || {}) }),
              parent.getId(), DockLocation.CENTER, -1, true));
            } else if (action === "splitRight" && parent) {
              m.doAction(Actions.addNode(
                makeTabJson(current.getComponent(), current.getName(), { ...(current.getConfig?.() || {}) }),
              parent.getId(), DockLocation.RIGHT, -1, true));
            }
            else if (action === "popout") {
              // Webview tabs are vetoed in handleLayoutAction too — fast-path
              // here so the user gets the toast immediately.
              try { if (isWebviewModelNode(current)) { showPopoutBlockedToast(); } else m.doAction(Actions.popoutTab(tabId)); } catch { try { m.doAction(Actions.popoutTab(tabId)); } catch {} }
            }
            else if (action === "float") {
              // Built-in float (0.9+): panel floats inside the main window.
              // Safe for <webview> tabs — no cross-window re-parent.
              try { m.doAction(Actions.popoutTab(tabId, "float")); } catch {}
            }
            else if (action === "copyPath" && filePath) window.electronAPI?.clipboardWrite?.(filePath);
            else if (action === "copyRelativePath" && filePath) {
              const relative = relativeProjectPath(filePath, currentProjectRef.current);
              if (relative) window.electronAPI?.clipboardWrite?.(relative);
            }
            else if (action === "reveal" && filePath) window.electronAPI?.revealInExplorer?.(filePath);
            else if (action === "moveCenter") {
              // Border tab → back into the main layout (editor tabset).
              try {
                const ts = findEditorTabset(m.getRoot()) || findAnyTabset(m.getRoot());
                const targetId = ts ? ts.getId() : m.getRoot().getId();
                m.doAction(Actions.moveNode(tabId, targetId, DockLocation.CENTER, -1, true));
              } catch {}
            }
            else if (typeof action === "string" && action.startsWith("moveBorder:")) {
              // Main tab → edge border (deterministic; no drag precision needed).
              const loc = action.split(":")[1];
              try {
                const borders = m.getBorderSet?.().getBorders?.() || [];
                const b = borders.find((x) => {
                  try {
                    const l = x.getLocation?.();
                    const name = (l && l.getName ? l.getName() : l);
                    return String(name).toLowerCase() === String(loc).toLowerCase();
                  } catch { return false; }
                });
                const countOf = (bx) => { try { return bx.getTabNodes?.().length ?? bx.getChildren?.().length ?? -1; } catch { return -1; } };
                if (!b) {
                  try { console.error("[border] no border node for location:", loc, "have:", borders.length); } catch {}
                  showLayoutToast("Border nahi mila (" + loc + ") — project dobara kholo");
                } else {
                  const before = countOf(b);
                  m.doAction(Actions.moveNode(tabId, b.getId(), DockLocation.CENTER, -1, true));
                  const parentId = m.getNodeById(tabId)?.getParent?.()?.getId?.();
                  const after = countOf(m.getNodeById(b.getId()) || b);
                  try { console.debug("[border] move", tabId, "→", loc, "before:", before, "after:", after, "parent:", parentId); } catch {}
                  if (parentId !== b.getId()) {
                    // Retry via canonical border id, then report visibly.
                    try {
                      const b2 = m.getNodeById("border_" + String(loc).toLowerCase());
                      if (b2) m.doAction(Actions.moveNode(tabId, b2.getId(), DockLocation.CENTER, -1, true));
                    } catch {}
                    const p2 = m.getNodeById(tabId)?.getParent?.()?.getId?.();
                    if (p2 !== b.getId() && p2 !== "border_" + String(loc).toLowerCase()) {
                      try { console.error("[border] move failed:", { tabId, loc, parentId: p2 }); } catch {}
                      showLayoutToast("Border me move nahi ho paya — DevTools console dekho");
                    }
                  }
                }
              } catch (err) {
                try { console.error("[border] move threw:", err); } catch {}
              }
            }
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
              canFloat: node.isEnableFloat?.() !== false,
              inBorder: node.getParent?.()?.getType?.() === "border",
              filePath,
              canCopyRelativePath: !!relativeProjectPath(filePath, currentProjectRef.current),
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
          const isEditor = node.getComponent() === "editor" || node.getComponent() === "notebook";
          // Reuse the same VscodeIcon file icons as the Project Panel for UI consistency.
          const fileName = filePath ? filePath.replace(/.*[\\/]/, "") : null;
          renderValues.leading = isEditor && fileName ? <VscodeIcon name={fileName} size={10} /> : null;
          renderValues.content = (
            <span onContextMenu={onTabContextMenu} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.getName()}
            </span>
          );
        }
      }}
      onRenderTabSet={(node, renderValues) => {
        // Border strips get no toolbar buttons (no room on the edge strip).
        if (node.getType?.() === "border") return;
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
            else if (action === "extensions") window.dispatchEvent(new CustomEvent("add-extensions-panel"));
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
            <svg width="12" height="12" viewBox="0 0 16 16">
              <rect x="7" y="1" width="2" height="14" rx="1"/>
              <rect x="1" y="7" width="14" height="2" rx="1"/>
            </svg>
          </button>
        );
        // Float icon next to + — floats this tabset's selected tab as a
        // main-window floating panel (0.9+ built-in, webview-safe).
        renderValues.buttons.push(
          <button key="float" className="flexlayout__tab_toolbar_button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const m = modelRef.current;
              if (!m) return;
              try {
                const sel = node.getSelectedNode?.() || null;
                const id = sel?.getId?.();
                if (!id) return;
                if (sel?.isEnableFloat?.() === false) return;
                m.doAction(Actions.popoutTab(id, "float"));
              } catch {}
            }}
            title="Float Tab — open as floating panel"
          >
            <svg width="12" height="12" viewBox="0 0 16 16">
              <path d="M6 2h8v8h-2V4H6V2z"/>
              <path d="M2 6h8v8H2V6zm2 2v4h4V8H4z"/>
            </svg>
          </button>
        );
      }}
        />
      </div>

      <CommandPalette />
      <SearchPanel />
      <ExtToasts />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
