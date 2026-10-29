// Unified palette — a single overlay for files + all app commands.
//   Ctrl+P          → files + commands (files first)
//   Ctrl+Shift+P/F1 → commands only (query starts with ">", VS Code style)
// QuickOpen is merged into this — no separate overlay is kept.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { NAV } from "../Settings/nav.js";
import { SETTINGS_INDEX } from "../Settings/searchIndex.js";
import useDialogFocus from "../shared/useDialogFocus.js";
import { readRecentFiles, updateRecentFiles, mergeRecentFiles } from "./recentFiles.cjs";

const ed = (c) => () => window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: c } }));
const act = (c) => () => window.dispatchEvent(new CustomEvent("menu:action", { detail: { cmd: c } }));
const ev = (n, d) => () => window.dispatchEvent(new CustomEvent(n, { detail: d }));

const COMMANDS = [
  // ── File ──
  { id: "open-project",    group: "File", title: "Open Project…",           run: () => window.electronAPI.openFolder() },
  { id: "new-project",     group: "File", title: "New Project…",            run: act("newProject") },
  { id: "save-project",    group: "File", title: "Save Project Layout",     run: act("saveProject") },
  { id: "close-project",   group: "File", title: "Close Project",           run: act("closeProject") },
  { id: "reopen-closed-editor", group: "File", title: "Reopen Closed Editor", run: ev("editor:reopenClosed") },
  { id: "save-file",       group: "File", title: "Save File",               run: ed("save") },
  { id: "save-file-as",    group: "File", title: "Save File As…",           run: ed("saveAs") },
  { id: "toggle-autosave", group: "File", title: "Toggle Auto Save",        run: act("toggleAutoSave") },
  // ── View ──
  { id: "search-files",    group: "View", title: "Search: Find in Files",   run: ev("search:open") },
  { id: "replace-files",   group: "View", title: "Search: Replace in Files", run: ev("search:open", { mode: "replace" }) },
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
  { id: "add-extensions",  group: "Panels", title: "Add Extensions Panel",  run: ev("add-extensions-panel") },
  { id: "add-debugger",    group: "Panels", title: "Show Debugger",         kw: "debug breakpoints call stack variables node python", run: ev("add-debug-panel") },
  { id: "add-tests",       group: "Panels", title: "Show Test Explorer",    kw: "test jest vitest mocha pytest unittest", run: ev("add-test-explorer-panel") },
  { id: "add-history",     group: "Panels", title: "Show Local History",    kw: "history snapshots revisions restore", run: ev("local-history:open") },
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

// Settings pages + individual settings rows — open/jump directly from the palette.
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
  const [error, setError] = useState("");
  const [project, setProject] = useState(() => window.__currentProjectPath || "");
  const [recent, setRecent] = useState(() => readRecentFiles(localStorage, window.__currentProjectPath));
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const listRef = useRef(null);
  const debounceRef = useRef(null);
  const requestRef = useRef(0);
  const openRef = useRef(open);
  const restoreFocusRef = useRef(true);
  openRef.current = open;
  const close = () => { requestRef.current++; setOpen(false); };
  useDialogFocus(open, dialogRef, inputRef, close, restoreFocusRef);

  useEffect(() => {
    const changed = () => {
      requestRef.current++;
      const root = window.__currentProjectPath || "";
      setProject(root); setFiles([]); setRecent(readRecentFiles(localStorage, root)); setError("");
    };
    const activated = (event) => {
      const root = window.__currentProjectPath;
      if (root && event.detail?.path) setRecent(updateRecentFiles(localStorage, root, event.detail.path));
    };
    window.addEventListener("project:opened", changed);
    window.addEventListener("project:closed", changed);
    window.addEventListener("editor:fileActivated", activated);
    return () => {
      window.removeEventListener("project:opened", changed);
      window.removeEventListener("project:closed", changed);
      window.removeEventListener("editor:fileActivated", activated);
    };
  }, []);

  // ── App extension commands (live from the host) ──
  const [extCmds, setExtCmds] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await window.electronAPI?.extCommands?.();
        if (alive) setExtCmds(Array.isArray(res) ? res : []);
      } catch { if (alive) setExtCmds([]); }
    };
    load();
    const un = window.electronAPI?.onExtChanged?.(load);
    return () => { alive = false; try { un && un(); } catch {} };
  }, []);

  const raw = query.trim();
  const cmdOnly = raw.startsWith(">");
  const q = (cmdOnly ? raw.slice(1) : raw).trim().toLowerCase();

  // ── Files (IPC fuzzy search; off in ">" mode) ──
  useEffect(() => {
    const request = ++requestRef.current;
    clearTimeout(debounceRef.current);
    setFiles([]); setError(""); setLoading(false);
    if (!open || cmdOnly || !project) return;
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const current = () => request === requestRef.current && openRef.current && project === window.__currentProjectPath;
      try {
        const res = await window.electronAPI.findFiles(project, q, 30);
        if (current()) setFiles(Array.isArray(res) ? res : []);
      } catch { if (current()) setError("Could not load files. Try searching again."); }
      finally { if (current()) setLoading(false); }
    }, q ? 120 : 60);
    return () => { clearTimeout(debounceRef.current); requestRef.current++; };
  }, [q, open, cmdOnly, project]);

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
    extCmds.forEach((c) => {
      const row = {
        id: "ext:" + c.id,
        group: c.category || "Extensions",
        title: c.title,
        meta: c.extName || c.extId || "Extension",
        kw: `${c.extName || ""} ${c.extId || ""} extension`,
        run: () => {
          if (c.editorAction) {
            window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: c.editorAction } }));
            return;
          }
          try { window.electronAPI?.extInvoke?.(c.id); } catch {}
        },
      };
      if (match(row)) out.push(row);
    });
    return out;
  }, [q, extCmds]);

  // ── Rows: Files section + grouped Commands (heads are not selectable) ──
  const rows = useMemo(() => {
    const out = [];
    const visibleFiles = cmdOnly ? [] : q ? files : mergeRecentFiles(recent, files);
    for (const [label, group] of [["Recent files", visibleFiles.filter((f) => f.recent)], ["Files", visibleFiles.filter((f) => !f.recent)]]) {
      if (!group.length) continue;
      out.push({ type: "head", key: "h-" + label, label });
      group.forEach((f) => out.push({ type: "file", key: f.path, f }));
    }
    const groups = new Map();
    cmds.forEach((c) => {
      if (!groups.has(c.group)) groups.set(c.group, []);
      groups.get(c.group).push(c);
    });
    groups.forEach((commands, group) => {
      out.push({ type: "head", key: "h-command-" + group, label: group });
      commands.forEach((c) => out.push({ type: "cmd", key: c.id, c }));
    });
    let ai = 0;
    out.forEach((r) => { r.ai = r.type === "head" ? -1 : ai++; });
    return out;
  }, [files, cmds, recent, cmdOnly, q]);

  const total = rows.length ? rows[rows.length - 1].ai + 1 : 0;
  const sel = total ? rows.find((r) => r.ai === Math.min(idx, total - 1)) : null;
  const hasProject = !!window.__currentProjectPath;

  const show = (commandsMode) => {
    if (!openRef.current) restoreFocusRef.current = true;
    requestRef.current++;
    const root = window.__currentProjectPath || "";
    setProject(root); setRecent(readRecentFiles(localStorage, root));
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

  // Keep the arrow-key selection inside the viewport
  useEffect(() => {
    if (!open) return;
    try { listRef.current?.querySelector(`[data-ai="${Math.min(idx, Math.max(total - 1, 0))}"]`)?.scrollIntoView({ block: "nearest" }); } catch {}
  }, [idx, open, total]);

  const runRow = async (r) => {
    if (!r || (loading && !cmdOnly && !r.f?.recent)) return;
    const root = window.__currentProjectPath;
    const request = requestRef.current;
    try {
      if (r.type === "file") {
        const stat = await window.electronAPI.stat(r.f.path);
        if (request !== requestRef.current || root !== window.__currentProjectPath || !openRef.current) return;
        if (!stat?.exists || stat.isDir) {
          setRecent(updateRecentFiles(localStorage, root, r.f.path, true));
          setFiles((items) => items.filter((item) => item.path !== r.f.path));
          setError("That file is no longer available. Choose another result.");
          inputRef.current?.focus();
          return;
        }
        restoreFocusRef.current = false; close();
        window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: r.f.path } }));
      } else { restoreFocusRef.current = false; close(); r.c.run(); }
    } catch { setError("Could not open that file. Try again."); }
  };

  if (!open) return null;

  return (
    <>
      <div
        className="ui-scrim"
        style={{ position: "fixed", inset: 0, zIndex: "var(--z-palette)", background: "var(--overlay)" }}
        onClick={close}
      />
      <div
        className="ui-pop"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={cmdOnly ? "Command Palette" : "Quick Open"}
        style={{
          position: "fixed", top: "12%", left: "50%", transform: "translateX(-50%)",
          width: 640, maxWidth: "92vw", zIndex: "var(--z-palette-top)",
          background: "var(--bg-vscode)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-float)", overflow: "hidden",
          display: "flex", flexDirection: "column",
          maxHeight: "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-8) var(--space-12)", background: "var(--bg-surface)", borderBottom: "1px solid var(--border-light)" }}>
          <svg style={{ stroke: "var(--icon)", flexShrink: 0 }} width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2H9L12 5V13H4V2Z" strokeWidth="1.2" /><path d="M9 2V5H12" strokeWidth="1.2" /></svg>
          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-label="File or command"
            aria-expanded="true"
            aria-controls="quick-open-results"
            aria-activedescendant={sel ? `quick-open-option-${sel.ai}` : undefined}
            onChange={(e) => { requestRef.current++; setFiles([]); setQuery(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, Math.max(total - 1, 0))); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); runRow(sel); }
              else if (e.key === "Escape") { e.preventDefault(); close(); }
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

        <div id="quick-open-results" role="listbox" aria-label="Files and commands" aria-busy={loading && !cmdOnly} ref={listRef} style={{ maxHeight: "min(380px,55vh)", minHeight: 0, overflowY: "auto" }}>
          {total === 0 && (
            <div style={{ padding: "var(--space-16)", fontSize: "var(--fs-body)", color: "var(--text-muted)", textAlign: "center" }}>
              {loading ? "Searching files…" : cmdOnly ? "No matching commands." : "No matching files or commands."}
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
                id={`quick-open-option-${r.ai}`}
                role="option"
                aria-selected={on}
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

        <div style={{ padding: "var(--space-4) var(--space-12)", fontSize: "var(--fs-tiny)", color: "var(--text-muted)", borderTop: "1px solid var(--bg-active)", display: "flex", justifyContent: "space-between", gap: "var(--space-10)", flexShrink: 0, flexWrap: "wrap" }}>
          <span role={error ? "alert" : undefined}>{error || "↑↓ Navigate • Enter Open • Esc Close • > = commands only"}</span>
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
