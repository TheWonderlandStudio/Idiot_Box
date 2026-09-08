import React, { useState, useMemo } from "react";

// ─── KeybindingsPage ────────────────────────────────────────────────────────
// Read-only reference of keyboard shortcuts. Filterable.
// ─────────────────────────────────────────────────────────────────────────────

const KEYBINDINGS = [
  { category: "General", bindings: [
    { command: "Command Palette", key: "Ctrl+Shift+P", desc: "Open command palette" },
    { command: "Quick Open", key: "Ctrl+P", desc: "Quick open file" },
    { command: "Settings", key: "Ctrl+,", desc: "Open settings window" },
    { command: "Toggle Fullscreen", key: "F11", desc: "Toggle fullscreen" },
  ]},
  { category: "File", bindings: [
    { command: "Open Project", key: "Ctrl+O", desc: "Open a project folder" },
    { command: "Open File", key: "Ctrl+Shift+O", desc: "Open a single file" },
    { command: "New Project", key: "Ctrl+N", desc: "Create / select new project folder" },
    { command: "Save", key: "Ctrl+S", desc: "Save current file" },
    { command: "Save As", key: "Ctrl+Shift+S", desc: "Save current file as…" },
    { command: "Save All", key: "Ctrl+Alt+S", desc: "Save all dirty files" },
    { command: "Close Project", key: "Ctrl+W", desc: "Close current project (not window)" },
    { command: "New Window", key: "Ctrl+Shift+N", desc: "Open a new Idiot Box window" },
  ]},
  { category: "Edit", bindings: [
    { command: "Undo", key: "Ctrl+Z", desc: "Undo last change" },
    { command: "Redo", key: "Ctrl+Y", desc: "Redo last undo" },
    { command: "Redo (Alt)", key: "Ctrl+Shift+Z", desc: "Redo — alternative" },
    { command: "Cut", key: "Ctrl+X", desc: "Cut selection" },
    { command: "Copy", key: "Ctrl+C", desc: "Copy selection" },
    { command: "Paste", key: "Ctrl+V", desc: "Paste clipboard" },
    { command: "Select All", key: "Ctrl+A", desc: "Select all text" },
    { command: "Find", key: "Ctrl+F", desc: "Find in file" },
    { command: "Replace", key: "Ctrl+H", desc: "Find and replace" },
    { command: "Find Next", key: "F3", desc: "Find next occurrence" },
    { command: "Find Previous", key: "Shift+F3", desc: "Find previous occurrence" },
  ]},
  { category: "View", bindings: [
    { command: "Zoom In", key: "Ctrl+Plus / Ctrl+=", desc: "Zoom in" },
    { command: "Zoom Out", key: "Ctrl+-", desc: "Zoom out" },
    { command: "Actual Size", key: "Ctrl+0", desc: "Reset zoom to 100%" },
    { command: "Reset Layout", key: "Ctrl+Alt+R", desc: "Reset window layout to defaults" },
    { command: "Toggle DevTools", key: "Ctrl+Shift+I", desc: "Toggle developer tools" },
    { command: "Add Panel", key: "—", desc: "Add a new blank panel to the current tabset" },
  ]},
  { category: "Terminal", bindings: [
    { command: "New Terminal", key: "Ctrl+`", desc: "Open a new integrated terminal" },
    { command: "Split Terminal Right", key: "Ctrl+Shift+5", desc: "Split terminal to the right" },
    { command: "Split Terminal Down", key: "Ctrl+Shift+\\", desc: "Split terminal down" },
    { command: "Clear Terminal", key: "Ctrl+K", desc: "Clear terminal buffer" },
    { command: "Copy (Terminal)", key: "Ctrl+C (with selection)", desc: "Copy selected terminal text" },
    { command: "Paste (Terminal)", key: "Ctrl+V", desc: "Paste into terminal" },
  ]},
  { category: "Git", bindings: [
    { command: "Refresh Git Status", key: "Ctrl+Shift+G", desc: "Refresh source control status" },
    { command: "Commit (when commit box focused)", key: "Ctrl+Enter", desc: "Commit staged changes" },
  ]},
  { category: "Project Explorer", bindings: [
    { command: "Rename", key: "F2", desc: "Rename selected file/folder" },
    { command: "Delete", key: "Delete", desc: "Delete selected items" },
    { command: "New File", key: "Ctrl+N (in explorer empty space)", desc: "Create new file" },
    { command: "New Folder", key: "Ctrl+Shift+N", desc: "Create new folder" },
    { command: "Copy Path", key: "Ctrl+Shift+C", desc: "Copy absolute path" },
    { command: "Reveal in Explorer", key: "Ctrl+Shift+R", desc: "Reveal in file explorer" },
    { command: "Refresh", key: "F5", desc: "Refresh project tree" },
  ]},
  { category: "Editor", bindings: [
    { command: "Go to Line", key: "Ctrl+G", desc: "Go to line number (Monaco)" },
    { command: "Comment Line", key: "Ctrl+/", desc: "Toggle line comment" },
    { command: "Format Document", key: "Shift+Alt+F", desc: "Format document (if formatter available)" },
    { command: "Quick Fix", key: "Ctrl+.", desc: "Show quick fixes" },
    { command: "Reveal Line", key: "—", desc: "Click search result to reveal line in editor" },
  ]},
  { category: "Canvas", bindings: [
    { command: "Pan Canvas", key: "Space + Drag / Middle-drag / Right-drag", desc: "Pan the canvas" },
    { command: "Zoom", key: "Ctrl+Wheel", desc: "Zoom at cursor" },
    { command: "Shift+Drag Card", key: "Shift+Drag", desc: "Move card together with its parent group" },
    { command: "Fit View", key: "Fit button", desc: "Fit all groups/cards in view" },
  ]},
];

const KeybindingsPage = () => {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return KEYBINDINGS;
    return KEYBINDINGS.map((cat) => ({
      ...cat,
      bindings: cat.bindings.filter(
        (b) => b.command.toLowerCase().includes(q) || b.key.toLowerCase().includes(q) || b.desc.toLowerCase().includes(q)
      ),
    })).filter((cat) => cat.bindings.length > 0);
  }, [filter]);

  const total = useMemo(() => KEYBINDINGS.reduce((n, c) => n + c.bindings.length, 0), []);
  const shown = useMemo(() => filtered.reduce((n, c) => n + c.bindings.length, 0), [filtered]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "var(--space-16)" }}>
        <input
          className="sw-input"
          style={{ flex: 1 }}
          placeholder="Filter keybindings…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter keybindings"
        />
        <span style={{ fontSize: "var(--fs-small)", color: "var(--text-placeholder)", whiteSpace: "nowrap" }}>
          {shown} of {total}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-body)", padding: "var(--space-16)", textAlign: "center", border: "var(--space-1) dashed var(--border)", borderRadius: "var(--radius-lg)" }}>
          No keybindings match "{filter}"
        </div>
      ) : (
        filtered.map((cat) => (
          <div key={cat.category} style={{ marginBottom: "var(--space-20)" }}>
            <div style={{
              fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", letterSpacing: 0.3,
              textTransform: "uppercase", color: "var(--text-label)",
              marginBottom: "var(--space-8)", paddingBottom: "var(--space-4)", borderBottom: "1px solid var(--bg-subtle)"
            }}>
              {cat.category}
            </div>
            <div className="sw-keybindings-table">
              {cat.bindings.map((b) => (
                <div key={`${cat.category}:${b.command}`} className="sw-kb-row">
                  <span className="sw-kb-command">{b.command}</span>
                  <span className="sw-kb-desc">{b.desc}</span>
                  <span className="sw-kb-key">{b.key}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <div style={{ marginTop: "var(--space-8)", padding: "var(--space-10)", background: "var(--accent-soft-a08)", border: "var(--space-1) solid var(--accent-soft-a18)", borderRadius: "var(--radius-md)", fontSize: "var(--fs-small)", color: "var(--text-placeholder)", lineHeight: "var(--lh-code)" }}>
        Tip: Most shortcuts use <code style={{ background: "var(--bg-hover)", padding: "var(--space-1) var(--space-4)", borderRadius: "var(--radius-sm)", color: "var(--text-soft)" }}>Ctrl</code> on Windows/Linux and <code style={{ background: "var(--bg-hover)", padding: "var(--space-1) var(--space-4)", borderRadius: "var(--radius-sm)", color: "var(--text-soft)" }}>Cmd</code> on macOS. You can also open the Command Palette with <code style={{ background: "var(--bg-hover)", padding: "var(--space-1) var(--space-4)", borderRadius: "var(--radius-sm)", color: "var(--text-soft)" }}>Ctrl+Shift+P</code> to search for any command.
      </div>
    </div>
  );
};

export default KeybindingsPage;
