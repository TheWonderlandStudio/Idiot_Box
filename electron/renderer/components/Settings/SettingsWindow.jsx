import React, { useState, useEffect, useMemo } from "react";
import { Settings2, LayoutGrid, CodeXml, Terminal, GitBranch, Palette, Bot, Keyboard, Blocks, Search } from "lucide-react";
import useSettings from "../shared/useSettings.jsx";
import GeneralPage     from "./pages/GeneralPage.jsx";
import HubPage         from "./pages/HubPage.jsx";
import EditorPage      from "./pages/EditorPage.jsx";
import TerminalPage    from "./pages/TerminalPage.jsx";
import GitPage         from "./pages/GitPage.jsx";
import CanvasPage      from "./pages/CanvasPage.jsx";
import AIPage          from "./pages/AIPage.jsx";
import KeybindingsPage from "./pages/KeybindingsPage.jsx";
import ExtensionsPage  from "./pages/ExtensionsPage.jsx";
import "../../variables.css";
import "./settings.css";

// ─── Navigation — grouped, fragments Sidebar pattern ────────────────────────
const NAV_GROUPS = ["Preferences", "Workspace", "System"];
const NAV = [
  { id: "general",     label: "General",     desc: "Appearance, startup behaviour and general preferences.", group: "Preferences", icon: Settings2 },
  { id: "hub",         label: "Hub",         desc: "Project Hub, contribution heatmap and app-data management.", group: "Preferences", icon: LayoutGrid },
  { id: "editor",      label: "Editor",      desc: "Font, wrapping and editing behaviour.", group: "Preferences", icon: CodeXml },
  { id: "terminal",    label: "Terminal",    desc: "Font, cursor, scrollback and shell preferences.", group: "Preferences", icon: Terminal },
  { id: "git",         label: "Git",         desc: "Commit, fetch and gutter preferences.", group: "Workspace", icon: GitBranch },
  { id: "canvas",      label: "Canvas",      desc: "Drawing surface and preview preferences.", group: "Workspace", icon: Palette },
  { id: "ai",          label: "AI",          desc: "Providers, models and API keys.", group: "Workspace", icon: Bot },
  { id: "keybindings", label: "Keybindings", desc: "Keyboard shortcuts.", group: "System", icon: Keyboard },
  { id: "extensions",  label: "Extensions",  desc: "Manage installed extensions.", group: "System", icon: Blocks },
];

// ─── SettingsWindow ───────────────────────────────────────────────────────────
// Standalone root component rendered inside the settings BrowserWindow.
// OBS-style layout: fixed left sidebar + scrollable right content.
// ─────────────────────────────────────────────────────────────────────────────

const SettingsWindow = () => {
  const [activePage, setActivePage] = useState(() => {
    // Deep-link: settings.html?page=extensions → open directly on that page
    try {
      const p = new URLSearchParams(window.location.search).get("page");
      if (p && NAV.some((n) => n.id === p)) return p;
    } catch {}
    return "general";
  });
  const [settings, updateSettings, loading] = useSettings();
  const [navQuery, setNavQuery] = useState("");

  const visibleNav = useMemo(() => {
    const q = String(navQuery || "").trim().toLowerCase();
    if (!q) return NAV;
    return NAV.filter((n) => n.label.toLowerCase().includes(q) || n.id.includes(q));
  }, [navQuery]);

  // Main window se navigate request (e.g. Browser ⋮ → Manage extensions)
  useEffect(() => {
    const unsub = window.electronAPI?.onSettingsNavigate?.((page) => {
      if (page && NAV.some((n) => n.id === page)) setActivePage(page);
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  // Apply theme to settings window itself (default dark)
  useEffect(() => {
    if (loading) return;
    const th = settings.theme || settings.editorTheme || "dark";
    const isLight = th === "light" || th === "lightPlus" || th === "lightModern" || th === "light2026" || th === "Visual Studio Light" || th === "Light+" || th === "Light Modern" || th === "Light 2026";
    document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
  }, [settings.theme, settings.editorTheme, loading]);

  // Also listen to cross-window theme changes (e.g., from main window)
  useEffect(() => {
    const applyTheme = (th) => {
      if (!th) return;
      const isLight = th === "light" || th === "lightPlus" || th === "lightModern" || th === "light2026" || th === "Visual Studio Light" || th === "Light+" || th === "Light Modern" || th === "Light 2026";
      document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    };
    let bc, bc2;
    try {
      bc = new BroadcastChannel("app-settings");
      bc.onmessage = (e) => {
        const th = e.data?.theme || e.data?.editorTheme;
        if (th) applyTheme(th);
      };
    } catch {}
    try {
      bc2 = new BroadcastChannel("editor-settings");
      bc2.onmessage = (e) => {
        const th = e.data?.theme || e.data?.editorTheme;
        if (th) applyTheme(th);
      };
    } catch {}
    return () => { try { bc?.close(); } catch {} try { bc2?.close(); } catch {} };
  }, []);

  const renderPage = () => {
    if (loading) return <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-body)" }}>Loading...</div>;
    switch (activePage) {
      case "general":     return <GeneralPage settings={settings} onSave={updateSettings} />;
      case "hub":         return <HubPage settings={settings} onSave={updateSettings} />;
      case "editor":      return <EditorPage settings={settings} onSave={updateSettings} />;
      case "terminal":    return <TerminalPage settings={settings} onSave={updateSettings} />;
      case "git":         return <GitPage settings={settings} onSave={updateSettings} />;
      case "canvas":      return <CanvasPage settings={settings} onSave={updateSettings} />;
      case "ai":          return <AIPage settings={settings} onSave={updateSettings} />;
      case "keybindings": return <KeybindingsPage />;
      case "extensions":  return <ExtensionsPage />;
      default:            return null;
    }
  };

  const pageTitle = NAV.find((n) => n.id === activePage)?.label ?? "";
  const pageDesc = NAV.find((n) => n.id === activePage)?.desc ?? "";

  return (
    <div className="sw-shell">
      {/* Sidebar */}
      <div className="sw-sidebar">
        <div className="sw-sidebar__title">Settings</div>
        <div className="sw-search">
          <Search size={13} />
          <input
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {NAV_GROUPS.map((g) => {
          const items = visibleNav.filter((n) => n.group === g);
          if (!items.length) return null;
          return (
            <React.Fragment key={g}>
              <div className="sw-nav-group">{g}</div>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.id}
                    className={`sw-nav-item${activePage === item.id ? " sw-nav-item--active" : ""}`}
                    onClick={() => setActivePage(item.id)}
                    title={item.desc}
                  >
                    {Icon ? <Icon size={15} /> : null}
                    {item.label}
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
        {!visibleNav.length && <div className="sw-nav-empty">No matches</div>}
      </div>

      {/* Content */}
      <div className="sw-content">
        <div className="sw-content__header">
          <span className="sw-content__title">{pageTitle}</span>
          {pageDesc ? <span className="sw-content__desc">{pageDesc}</span> : null}
        </div>
        <div className="sw-content__body" key={activePage}>
          {renderPage()}
        </div>
      </div>
    </div>
  );
};

export default SettingsWindow;
