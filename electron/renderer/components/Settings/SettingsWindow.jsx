import React, { useState, useEffect } from "react";
import useSettings from "../shared/useSettings.jsx";
import GeneralPage     from "./pages/GeneralPage.jsx";
import EditorPage      from "./pages/EditorPage.jsx";
import TerminalPage    from "./pages/TerminalPage.jsx";
import GitPage         from "./pages/GitPage.jsx";
import CanvasPage      from "./pages/CanvasPage.jsx";
import KeybindingsPage from "./pages/KeybindingsPage.jsx";
import ExtensionsPage  from "./pages/ExtensionsPage.jsx";
import "../../variables.css";
import "./settings.css";

// ─── Navigation items ─────────────────────────────────────────────────────────
const NAV = [
  { id: "general",     label: "General" },
  { id: "editor",      label: "Editor" },
  { id: "terminal",    label: "Terminal" },
  { id: "git",         label: "Git" },
  { id: "canvas",      label: "Canvas" },
  { id: "keybindings", label: "Keybindings" },
  { id: "extensions",  label: "Extensions" },
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
    if (loading) return <div style={{ color: "#555", fontSize: 12 }}>Loading...</div>;
    switch (activePage) {
      case "general":     return <GeneralPage settings={settings} onSave={updateSettings} />;
      case "editor":      return <EditorPage settings={settings} onSave={updateSettings} />;
      case "terminal":    return <TerminalPage settings={settings} onSave={updateSettings} />;
      case "git":         return <GitPage settings={settings} onSave={updateSettings} />;
      case "canvas":      return <CanvasPage settings={settings} onSave={updateSettings} />;
      case "keybindings": return <KeybindingsPage />;
      case "extensions":  return <ExtensionsPage />;
      default:            return null;
    }
  };

  const pageTitle = NAV.find((n) => n.id === activePage)?.label ?? "";

  return (
    <div className="sw-shell">
      {/* Sidebar */}
      <div className="sw-sidebar">
        <div className="sw-sidebar__title">Settings</div>
        {NAV.map((item) => (
          <div
            key={item.id}
            className={`sw-nav-item${activePage === item.id ? " sw-nav-item--active" : ""}`}
            onClick={() => setActivePage(item.id)}
          >
            {item.label}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="sw-content">
        <div className="sw-content__header">
          <span className="sw-content__title">{pageTitle}</span>
        </div>
        <div className="sw-content__body">
          {renderPage()}
        </div>
      </div>
    </div>
  );
};

export default SettingsWindow;
