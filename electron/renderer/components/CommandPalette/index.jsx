// Unified palette — ek hi overlay for files + saare app commands.
//   Ctrl+P          → files + commands (files pehle)
//   Ctrl+Shift+P/F1 → commands only (query ">" se shuru, VS Code style)
// QuickOpen isme merge hai — alag overlay nahi rakha jata.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { NAV } from "../Settings/nav.js";
import { SETTINGS_INDEX } from "../Settings/searchIndex.js";

const ed = (c) => () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: c } }));
const act = (c) => () => window.dispatchEvent(new CustomEvent("menu:action", { detail: { cmd: c } }));
const ev = (n, d) => () => window.dispatchEvent(new CustomEvent(n, { detail: d }));

const COMMANDS = [
  // ── File ──
  { id: "open-project",    group: "File", title: "Open Project…",           run: () => window.electronAPI.openFolder() },
  { id: "new-project",     group: "File", title: "New Project…",            run: act("newProject") },
  { id: "save-project",    group: "File", title: "Save Project Layout",     run: act("saveProject") },
  { id: "close-project",   group: "File", title: "Close Project",           run: act("closeProject") },
  { id: "save-file",       group: "File", title: "Save File",               run: ed("save") },
  { id: "save-file-as",    group: "File", title: "Save File As…",           run: ed("saveAs") },
  { id: "toggle-autosave", group: "File", title: "Toggle Auto Save",        run: act("toggleAutoSave") },
  // ── View ──
  { id: "search-files",    group: "View", title: "Search: Find in Files",   run: ev("search:open") },
  { id: "split-editor",    group: "View", title: "Split Editor Right",      run: ev("editor:splitRight") },
  { id: "toggle-fullscreen", group: "View", title: "Toggle Full Screen",    run: ev("app:fullscreen") },
  { id: "reset-layout",    group: "View", title: "Reset Window Layout",     run: act("resetLayout") },
  // ── Panels ──
  { id: "focus-terminal",  group: "Panels", title: "Focus Terminal",        run: ev("focus-terminal-tab") },
  { id: "add-ai-agent",    group: "Panels", title: "Add AI Agent Panel",    run: ev("add-ai-agent-panel") },
  { id: "add-browser",     group: "Panels", title: "Add Browser Panel",     run: ev("add-browser-panel") },
  { id: "add-preview",     group: "Panels", title: "Add Component Preview", run: ev("add-component-preview-panel") },
  { id: "add-canvas",      group: "Panels", title: "Add Canvas Panel",      run: ev("add-canvas-panel") },
  { id: "add-ports",       group: "Panels", title: "Add Ports Panel",       run: ev("add-ports-panel") },
  { id: "add-output",      group: "Panels", title: "Show Output Panel",     run: ev("add-output-panel") },
  { id: "add-run",         group: "Panels", title: "Show Run & Debug",      run: ev("add-run-panel") },
  { id: "add-android",     group: "Panels", title: "Open Android Emulator", run: ev("add-android-panel") },
  { id: "add-git",         group: "Panels", title: "Add Git Panel",         run: ev("add-git-panel") },
  { id: "add-community",   group: "Panels", title: "Add Community Panel",   run: ev("add-community-panel") },
  // ── Edit ──
  { id: "undo",            group: "Edit", title: "Undo",                    run: ed("undo") },
  { id: "redo",            group: "Edit", title: "Redo",                    run: ed("redo") },
  { id: "cut",             group: "Edit", title: "Cut",                     run: ed("cut") },
  { id: "copy",            group: "Edit", title: "Copy",                    run: ed("copy") },
  { id: "paste",           group: "Edit", title: "Paste",                   run: ed("paste") },
  { id: "select-all",      group: "Edit", title: "Select All",              run: ed("selectAll") },
  { id: "find",            group: "Edit", title: "Find",                    run: ed("find") },
  { id: "find-next",       group: "Edit", title: "Find Next",               run: ed("findNext") },
  { id: "find-previous",   group: "Edit", title: "Find Previous",           run: ed("findPrevious") },
  { id: "replace",         group: "Edit", title: "Replace",                 run: ed("replace") },
  { id: "goto-line",       group: "Edit", title: "Go to Line…",             run: ed("gotoLine") },
  { id: "comment-line",    group: "Edit", title: "Toggle Line Comment",     run: ed("commentLine") },
  // ── Terminal ──
  { id: "term-new",        group: "Terminal", title: "New Terminal Panel",  run: ev("add-terminal-panel", { location: "BOTTOM" }) },
  { id: "term-split-right", group: "Terminal", title: "Split Terminal Right", run: ev("add-terminal-panel", { location: "RIGHT" }) },
  { id: "term-split-down", group: "Terminal", title: "Split Terminal Down", run: ev("add-terminal-panel", { location: "BOTTOM" }) },
  { id: "term-clear",      group: "Terminal", title: "Clear Terminal",      run: ev("terminal:command", { cmd: "clear" }) },
  { id: "term-kill",       group: "Terminal", title: "Kill Terminal",       run: ev("terminal:command", { cmd: "kill" }) },
  // ── App ──
  { id: "settings",        group: "App", title: "Settings",                 run: () => window.electronAPI.openSettingsWindow() },
];

// Settings pages + individual settings rows — palette se directly open/jump.
const SETTINGS_CMDS = NAV.map((n) => ({
  id: "settings:" + n.id,
  group: "Settings",
  title: "Settings: " + n.label,
  kw: `${n.desc} ${n.keywords || ""}`,
  run: () => window.electronAPI.openSettingsWindow(n.id),
}));

const settingsRowCmd = (e) => ({
  id: "setting:" + e.page + ":" + e.label,
  group: "Settings",
  meta: NAV.find((n) => n.id === e.page)?.label || e.page,
  title: e.label,
  kw: `${e.desc} ${e.kw || ""}`,
  run: () => window.electronAPI.openSettingsWindow(e.page, e.label),
});

const headStyle = {
  padding: "var(--space-6) var(--space-12) var(--space-4)",
  fontSize: "var(--fs-tiny)",
  fontWeight: "var(--fw-semibold)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--icon-muted)",
  background: "var(--bg-vscode)",
  borderBottom: "1px solid var(--bg-active)",
  userSelect: "none",
};

const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const debounceRef = useRef(null);

  const raw = query.trim();
  const cmdOnly = raw.startsWith(">");
  const q = (cmdOnly ? raw.slice(1) : raw).trim().toLowerCase();

  // ── Files (IPC fuzzy search; ">" mode me band) ──
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (cmdOnly) { setFiles([]); return; }
    debounceRef.current = setTimeout(async () => {
      const root = window.__currentProjectPath;
      if (!root) { setFiles([]); return; }
      setLoading(true);
      try {
        const res = await window.electronAPI.findFiles(root, q, 30);
        setFiles(Array.isArray(res) ? res : []);
      } catch { setFiles([]); } finally { setLoading(false); }
    }, q ? 120 : 60);
    return () => clearTimeout(debounceRef.current);
  }, [q, open, cmdOnly]);

  // ── Commands (local fuzzy) + Settings (pages + rows) ──
  const cmds = useMemo(() => {
    const match = (c) => !q || `${c.title} ${c.group} ${c.kw || ""}`.toLowerCase().includes(q);
    const out = COMMANDS.filter(match);
    SETTINGS_CMDS.forEach((c) => { if (match(c)) out.push(c); });
    if (q) SETTINGS_INDEX.forEach((e) => {
      if (e.kind === "page") return;
      const c = settingsRowCmd(e);
      if (match(c)) out.push(c);
    });
    return out;
  }, [q]);

  // ── Rows: Files section + grouped Commands (heads selectable nahi) ──
  const rows = useMemo(() => {
    const out = [];
    if (files.length) {
      out.push({ type: "head", key: "h-files", label: "Files" });
      files.forEach((f) => out.push({ type: "file", key: f.path, f }));
    }
    let g = null;
    cmds.forEach((c) => {
      if (c.group !== g) { g = c.group; out.push({ type: "head", key: "h-" + g, label: c.group }); }
      out.push({ type: "cmd", key: c.id, c });
    });
    let ai = 0;
    out.forEach((r) => { r.ai = r.type === "head" ? -1 : ai++; });
    return out;
  }, [files, cmds]);

  const total = rows.length ? rows[rows.length - 1].ai + 1 : 0;
  const sel = total ? rows.find((r) => r.ai === Math.min(idx, total - 1)) : null;
  const hasProject = !!window.__currentProjectPath;

  const show = (commandsMode) => {
    setQuery(commandsMode ? ">" : "");
    setIdx(0);
    setFiles([]);
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "p") return;
      e.preventDefault();
      e.stopPropagation();
      show(e.shiftKey); // Shift → commands mode
    };
    const onF1 = (e) => {
      if (e.key === "F1" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); show(true); }
    };
    const u1 = window.electronAPI.onMenuEvent?.("menu:commandPalette", () => show(true)) || (() => {});
    const u2 = window.electronAPI.onMenuEvent?.("menu:quickOpen", () => show(false)) || (() => {});
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keydown", onF1);
    window.addEventListener("command-palette:open", onShowAll);
    window.addEventListener("quickopen:open", onShowFiles);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keydown", onF1);
      window.removeEventListener("command-palette:open", onShowAll);
      window.removeEventListener("quickopen:open", onShowFiles);
      u1(); u2();
    };
  }, []);

  const onShowAll = () => show(false);
  const onShowFiles = () => show(false);

  useEffect(() => {
    if (open) { setIdx(0); inputRef.current?.focus(); }
  }, [open]);

  // Arrow key selection kabhi viewport se bahar na jaye
  useEffect(() => {
    if (!open) return;
    try { listRef.current?.querySelector(`[data-ai="${Math.min(idx, Math.max(total - 1, 0))}"]`)?.scrollIntoView({ block: "nearest" }); } catch {}
  }, [idx, open, total]);

  const runRow = (r) => {
    if (!r) return;
    setOpen(false);
    try {
      if (r.type === "file") window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: r.f.path } }));
      else r.c.run();
    } catch {}
  };

  if (!open) return null;

  return (
    <>
      <div
        className="ui-scrim"
        style={{ position: "fixed", inset: 0, zIndex: "var(--z-palette)", background: "var(--overlay)" }}
        onClick={() => setOpen(false)}
      />
      <div
        className="ui-pop"
        style={{
          position: "fixed", top: "12%", left: "50%", transform: "translateX(-50%)",
          width: 640, maxWidth: "92vw", zIndex: "var(--z-palette-top)",
          background: "var(--bg-vscode)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-float)", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-8) var(--space-12)", background: "var(--bg-surface)", borderBottom: "1px solid var(--border-light)" }}>
          <svg style={{ stroke: "var(--icon)", flexShrink: 0 }} width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2H9L12 5V13H4V2Z" strokeWidth="1.2" /><path d="M9 2V5H12" strokeWidth="1.2" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, Math.max(total - 1, 0))); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); runRow(sel); }
              else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
            }}
            placeholder={cmdOnly ? "Type a command…  (Ctrl+Shift+P)" : "Type a file name or command…  (Ctrl+P)"}
            spellCheck={false}
            style={{
              flex: 1, minWidth: 0, background: "transparent", border: "none",
              color: "var(--text-hover)", fontSize: "var(--fs-title)", outline: "none",
            }}
          />
          {loading && <span style={{ fontSize: "var(--fs-small)", color: "var(--text-muted)" }}>…</span>}
        </div>

        <div ref={listRef} style={{ maxHeight: 380, overflowY: "auto" }}>
          {total === 0 && (
            <div style={{ padding: "var(--space-16)", fontSize: "var(--fs-body)", color: "var(--text-muted)", textAlign: "center" }}>
              {cmdOnly ? "No matching commands." : "No matching files or commands."}
            </div>
          )}
          {rows.map((r) => {
            if (r.type === "head") {
              return <div key={r.key} style={headStyle}>{r.label}</div>;
            }
            const on = r.ai === Math.min(idx, Math.max(total - 1, 0));
            const base = {
              display: "flex", alignItems: "center", gap: "var(--space-10)",
              padding: "var(--space-6) var(--space-12)", cursor: "pointer",
              fontSize: "var(--fs-body-plus)",
              background: on ? "var(--select-blue)" : "transparent",
              color: on ? "var(--text-inverse)" : "var(--text-bright)",
              borderBottom: "1px solid var(--bg-active)",
            };
            return (
              <div
                key={r.key}
                data-ai={r.ai}
                onClick={() => runRow(r)}
                onMouseEnter={() => setIdx(r.ai)}
                style={base}
              >
                {r.type === "file" ? (
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ fontWeight: "var(--fw-semibold)" }}>{r.f.name}</span>
                    <span style={{ color: on ? "var(--text-soft)" : "var(--icon-muted)", marginLeft: "var(--space-8)" }}>{r.f.rel}</span>
                  </span>
                ) : (
                  <>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.c.title}</span>
                    <span style={{ flexShrink: 0, fontSize: "var(--fs-tiny)", opacity: on ? 0.85 : 0.6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{r.c.meta || r.c.group}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: "var(--space-4) var(--space-12)", fontSize: "var(--fs-tiny)", color: "var(--text-muted)", borderTop: "1px solid var(--bg-active)", display: "flex", justifyContent: "space-between", gap: "var(--space-10)" }}>
          <span>↑↓ Navigate • Enter Open • Esc Close • &gt; = commands only</span>
          <span style={{ flexShrink: 0 }}>
            {files.length} files • {cmds.length} commands
            {!hasProject && !cmdOnly ? "  ·  open a project to search files" : ""}
          </span>
        </div>
      </div>
    </>
  );
};

export default CommandPalette;
