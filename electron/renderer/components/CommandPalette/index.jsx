// Command Palette — Ctrl+Shift+P / F1 overlay with built-in IDE commands.
import React, { useState, useEffect, useRef } from "react";

const COMMANDS = [
  { id: "open-project",   title: "Open Project…",          run: () => window.electronAPI.openFolder() },
  { id: "new-project",    title: "New Project…",           run: () => window.dispatchEvent(new CustomEvent("menu:action", { detail: { cmd: "newProject" } })) },
  { id: "save-project",   title: "Save Project",           run: () => window.dispatchEvent(new CustomEvent("menu:action", { detail: { cmd: "saveProject" } })) },
  { id: "close-project",  title: "Close Project",          run: () => window.dispatchEvent(new CustomEvent("menu:action", { detail: { cmd: "closeProject" } })) },
  { id: "save-file",      title: "Save File",              run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "save" } })) },
  { id: "save-file-as",   title: "Save File As…",          run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "saveAs" } })) },
  { id: "toggle-autosave", title: "Toggle Auto Save",      run: () => window.dispatchEvent(new CustomEvent("menu:action", { detail: { cmd: "toggleAutoSave" } })) },
  { type: "separator" },
  { id: "toggle-terminal",title: "Focus Terminal",         run: () => window.dispatchEvent(new CustomEvent("focus-terminal-tab")) },
  { id: "add-terminal",   title: "Add Terminal Panel",     run: () => window.dispatchEvent(new CustomEvent("add-terminal-panel")) },
  { id: "add-browser",    title: "Add Browser Panel",      run: () => window.dispatchEvent(new CustomEvent("add-browser-panel")) },
  { id: "add-preview",    title: "Add Component Preview",  run: () => window.dispatchEvent(new CustomEvent("add-component-preview-panel")) },
  { id: "add-canvas",     title: "Add Canvas Panel",       run: () => window.dispatchEvent(new CustomEvent("add-canvas-panel")) },
  { id: "add-ports",      title: "Add Ports Panel",        run: () => window.dispatchEvent(new CustomEvent("add-ports-panel")) },
  { type: "separator" },
  { id: "reset-layout",   title: "Reset Window Layout",    run: () => window.dispatchEvent(new CustomEvent("menu:action", { detail: { cmd: "resetLayout" } })) },
  { id: "toggle-fullscreen", title: "Toggle Full Screen",  run: () => window.dispatchEvent(new CustomEvent("app:fullscreen")) },
  { type: "separator" },
  { id: "settings",       title: "Settings",               run: () => window.electronAPI.openSettingsWindow() },
  { type: "separator" },
  { id: "undo",           title: "Undo",                   run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "undo" } })) },
  { id: "redo",           title: "Redo",                   run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "redo" } })) },
  { id: "cut",            title: "Cut",                    run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "cut" } })) },
  { id: "copy",           title: "Copy",                   run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "copy" } })) },
  { id: "paste",          title: "Paste",                  run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "paste" } })) },
  { id: "select-all",     title: "Select All",             run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "selectAll" } })) },
  { id: "find",           title: "Find",                   run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "find" } })) },
  { id: "find-next",      title: "Find Next",              run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "findNext" } })) },
  { id: "find-previous",  title: "Find Previous",          run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "findPrevious" } })) },
  { id: "replace",        title: "Replace",                run: () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "replace" } })) },
];

const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    const show = () => {
      setQuery("");
      setIdx(0);
      setOpen(true);
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        show();
      } else if (e.key === "F1" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        show();
      }
    };
    const unsub = window.electronAPI.onMenuEvent("menu:commandPalette", show);
    window.addEventListener("keydown", onKey);
    window.addEventListener("command-palette:open", show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("command-palette:open", show);
      unsub();
    };
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const run = (item) => {
    setOpen(false);
    if (!item) return;
    try { item.run(); } catch {}
  };

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? COMMANDS.filter((i) => i && i.title && i.title.toLowerCase().includes(q))
    : COMMANDS;

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 900 }} onClick={() => setOpen(false)} />
      <div
        style={{
          position: "fixed", top: "12%", left: "50%", transform: "translateX(-50%)",
          width: 560, maxWidth: "90vw", zIndex: 901,
          background: "#252526", border: "1px solid #3a3a3a", borderRadius: 6,
          boxShadow: "0 12px 48px rgba(0,0,0,0.65)", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); run(filtered[idx]); }
            else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          }}
          placeholder="Type a command…"
          style={{
            width: "100%", boxSizing: "border-box", padding: "10px 12px",
            background: "#1e1e1e", border: "none", borderBottom: "1px solid #3a3a3a",
            color: "#dddddd", fontSize: 13, outline: "none",
          }}
        />
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: "#666", textAlign: "center" }}>No matching commands.</div>
          )}
          {filtered.map((item, i) => (
            <div
              key={item.id}
              onClick={() => run(item)}
              onMouseEnter={() => setIdx(i)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
                cursor: "pointer", fontSize: 12.5,
                background: i === idx ? "#094771" : "transparent", color: i === idx ? "#ffffff" : "#cccccc",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                {item.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default CommandPalette;