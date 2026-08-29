import React from "react";
import { Actions } from "flexlayout-react";

const PANEL_TYPES = [
  {
    id: "canvas",
    name: "Canvas",
    component: "canvas",
    description: "Visual project map — every page & component as live preview cards",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="#4ec9b0" strokeWidth="1.2" />
        <circle cx="5.5" cy="5.5" r="1.2" fill="#4ec9b0" />
        <circle cx="10.5" cy="5.5" r="1.2" fill="#4ec9b0" />
        <circle cx="5.5" cy="10.5" r="1.2" fill="#4ec9b0" />
        <circle cx="10.5" cy="10.5" r="1.2" fill="#4ec9b0" />
      </svg>
    ),
    config: {},
  },
  {
    id: "terminal",
    name: "Terminal",
    component: "terminal",
    description: "Integrated command line terminal shell",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="#4ec9b0" strokeWidth="1.2" fill="none" />
        <path d="M4.5 6.5L7 8.5L4.5 10.5" stroke="#4ec9b0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.5 10.5H11.5" stroke="#4ec9b0" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    config: {},
  },
  {
    id: "browser",
    name: "Browser",
    component: "panel3",
    description: "Internal web browser and previewer",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6" stroke="#569cd6" strokeWidth="1.2" />
        <path d="M2 8H14M8 2C9.8 4 10.5 6 10.5 8C10.5 10 9.8 12 8 14C6.2 12 5.5 10 5.5 8C5.5 6 6.2 4 8 2Z" stroke="#569cd6" strokeWidth="1" />
      </svg>
    ),
    config: { type: "browser", title: "Browser", url: "https://www.google.com" },
  },
  {
    id: "project",
    name: "Project Explorer",
    component: "projectPanel",
    description: "File tree and workspace file navigator",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.086a1.5 1.5 0 0 1 1.06.44L8.56 3.5H13a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V3.5Z" fill="#dcdcaa" opacity="0.85" />
      </svg>
    ),
    config: {},
  },
  {
    id: "editor",
    name: "Code Editor",
    component: "editor",
    description: "Monaco code editor with syntax highlighting",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <path d="M4 2.5L1.5 8L4 13.5M12 2.5L14.5 8L12 13.5M9.5 2L6.5 14" stroke="#9cdcfe" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    config: {},
  },
  {
    id: "mediaViewer",
    name: "Media Viewer",
    component: "mediaViewer",
    description: "Preview images, videos, and media assets",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="#c586c0" strokeWidth="1.2" />
        <circle cx="5.5" cy="6" r="1.25" fill="#c586c0" />
        <path d="M2.5 12L6 8L8.5 10.5L11 7.5L13.5 12" stroke="#c586c0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    config: {},
  },
  {
    id: "componentPreview",
    name: "Component Preview",
    component: "componentPreview",
    description: "Live interactive JSX / TSX React component preview",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="2" width="13" height="12" rx="1.5" stroke="#4ec9b0" strokeWidth="1.2" fill="none" />
        <path d="M5 6L8 9L11 6" stroke="#4ec9b0" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="8" cy="11.5" r="0.75" fill="#4ec9b0" />
      </svg>
    ),
    config: {},
  },
  {
    id: "problems",
    name: "Problems",
    component: "problems",
    description: "Errors and warnings from TypeScript and linter",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5" stroke="#f44747" strokeWidth="1.2" fill="none" />
        <path d="M8 5V9" stroke="#f44747" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="0.7" fill="#f44747" />
      </svg>
    ),
    config: {},
  },
  {
    id: "git",
    name: "Git",
    component: "gitPanel",
    description: "Git status, diff and file changes",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2H5L7 4.5H13.5A1.5 1.5 0 0 1 15 6V12.5A1.5 1.5 0 0 1 13.5 14H3.5A1.5 1.5 0 0 1 2 12.5V3.5Z" fill="#f14e32" opacity="0.9" />
        <path d="M6 7L8 9L10 7" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    config: {},
  },
  {
    id: "ports",
    name: "Ports",
    component: "ports",
    description: "Forwarded ports & running dev servers",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="#4ec9b0" strokeWidth="1.2" fill="none" />
        <circle cx="5.2" cy="6.5" r="1" fill="#4ec9b0" />
        <circle cx="8" cy="6.5" r="1" fill="#4ec9b0" />
        <circle cx="10.8" cy="6.5" r="1" fill="#4ec9b0" />
        <path d="M4 9.5H12" stroke="#4ec9b0" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
        <path d="M8 9.5V12" stroke="#4ec9b0" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
      </svg>
    ),
    config: {},
  },
  {
    id: "ai",
    name: "AI Assistant",
    component: "aiPanel",
    description: "OpenCode AI — full app control, file ops, git, terminal, search",
    icon: (
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="#4ec9b0" strokeWidth="1.5" />
        <path d="M6 8L8 10L11 6" stroke="#4ec9b0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="5" cy="5" r="1" fill="#4ec9b0" />
        <circle cx="11" cy="11" r="1" fill="#4ec9b0" />
      </svg>
    ),
    config: {},
  },
];

const BlankPanel = ({ nodeId, config }) => {
  const handleSelect = (panelItem) => {
    const m = window.__flexModel?.current;
    if (m && nodeId) {
      try {
        m.doAction(
          Actions.updateNodeAttributes(nodeId, {
            component: panelItem.component,
            name: panelItem.name,
            config: panelItem.config || {},
          })
        );
        // Flexlayout memoizes tab content (SizeTracker) and won't re-render it
        // for attribute-only changes — force a redraw so the new component mounts.
        try {
          [...m.getwindowsMap().values()].forEach((lw) => lw?.layout?.redraw?.("force"));
        } catch {}
      } catch (err) {
        console.error("Failed to set panel component:", err);
      }
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        background: "#1e1e1e",
        color: "#cccccc",
        padding: 24,
        boxSizing: "border-box",
        overflowY: "auto",
        userSelect: "none",
      }}
    >
      <div style={{ maxWidth: 640, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#e0e0e0", marginBottom: 6 }}>
          New Panel
        </div>
        <div style={{ fontSize: 12, color: "#888888", marginBottom: 24 }}>
          Select a tool or view to open in this panel
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            justifyContent: "center",
          }}
        >
          {PANEL_TYPES.map((panel) => (
            <button
              key={panel.id}
              onClick={() => handleSelect(panel)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                padding: "16px 14px",
                background: "#252526",
                border: "1px solid #2d2d2d",
                borderRadius: 4,
                cursor: "pointer",
                outline: "none",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#2a2d2e";
                e.currentTarget.style.borderColor = "#007acc";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#252526";
                e.currentTarget.style.borderColor = "#2d2d2d";
                e.currentTarget.style.transform = "none";
              }}
            >
              <div style={{ marginBottom: 10 }}>{panel.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#dddddd", marginBottom: 4 }}>
                {panel.name}
              </div>
              <div style={{ fontSize: 11, color: "#777777", lineHeight: 1.35 }}>
                {panel.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BlankPanel;