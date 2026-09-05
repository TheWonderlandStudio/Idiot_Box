// Terminal Panel — Flexlayout integrated standalone terminal component
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

let nextTerminalId = 1;

// ─── Custom xterm CSS overrides (injected once) ────────────────────────────
// IMPORTANT: the app's global `* { font-family: 'Fredoka' }` rule applies to
// every element INCLUDING xterm's glyph spans (an explicit rule beats
// inheritance), which breaks the monospace grid and produces negative
// letter-spacing corrections in xterm's DOM renderer.
// NOTE: font-family is NOT forced here with !important — it is controlled via
// term.options.fontFamily so Settings → Terminal → Font Family/Size works.
// Previously this was `font-family: "Courier New"... !important` which blocked
// dynamic updates and caused the Settings bug where terminal size changed editor size instead.
const XTERM_CUSTOM_CSS = `
.xterm, .xterm * { font-kerning: none; }
/* Fix character/cell sizing: the app's global '* { font-family: Fredoka }'
   rule matches xterm's inner spans directly, which beats inheritance from
   xterm's own font settings (rows container + measure container). That made
   glyphs render/measure in a proportional font while xterm's grid assumed
   monospace metrics, producing a bogus letter-spacing correction and wide
   gaps (e.g. 'PS D:\\idiot>'). Force inner spans to inherit so they use the
   monospace font xterm sets from term.options.fontFamily (keeps Settings →
   Terminal → Font Family dynamic — no hardcoded font here). */
.xterm-rows span,
.xterm-char-measure-element,
.xterm-width-cache-measure-container,
.xterm-width-cache-measure-container span { font-family: inherit; }
.xterm { height: 100%; padding: 0 !important; background: #1e1e1e !important; }
.xterm-viewport { scrollbar-width: thin; background: #1e1e1e !important; }
.xterm-viewport::-webkit-scrollbar { width: 6px; }
.xterm-viewport::-webkit-scrollbar-track { background: transparent; }
.xterm-viewport::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 3px; }
.xterm-viewport::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); }
.xterm-cursor { outline: none !important; }
.xterm-cursor-block { background: var(--text-highlight) !important; opacity: 0.9; }
.xterm-cursor-blink { animation: xterm-cursor-blink 1s step-end infinite; }
@keyframes xterm-cursor-blink { 50% { opacity: 0; } }
.xterm-selection div { background: var(--selection) !important; opacity: 0.5; }
.xterm-rows { font-variant-ligatures: none; letter-spacing: normal; }
.term-xterm { padding: 4px 6px; box-sizing: border-box; background: #1e1e1e; height: 100%; width: 100%; overflow: hidden; }
.term-xterm .xterm { pointer-events: auto; }
.term-xterm .xterm-viewport { pointer-events: auto; }
.xterm-screen { background: #1e1e1e !important; }
`;

const TERMINAL_PANEL_CSS = `
.term-panel { display:flex; flex-direction:column; height:100%; width:100%; background:#1e1e1e; position:relative; overflow:hidden; }
.term-content { flex:1; position:relative; overflow:hidden; z-index:1; background:#1e1e1e; display:flex; flex-direction:column; min-height:0; }
.term-empty { display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-muted); font-size:13px; background:var(--bg-surface); }
.term-status { display:flex; align-items:center; gap:6px; padding:3px 10px; background:var(--bg-raised); border-top:1px solid var(--border); font-size:11px; color:var(--text-muted); flex-shrink:0; user-select:none; }
.term-status-icon { flex-shrink:0; }
.term-status-path { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
.term-status-actions { display:flex; align-items:center; gap:4px; }
.term-status-btn { background:transparent; border:none; color:#888; cursor:pointer; padding:2px 4px; border-radius:2px; font-size:11px; }
.term-status-btn:hover { background:#333; color:#fff; }
`;

const TerminalStyle = () => <style>{XTERM_CUSTOM_CSS}{TERMINAL_PANEL_CSS}</style>;

// ─── Terminal settings helpers ────────────────────────────────────────────
// withMonoFallback: single-name picks (e.g. "Consolas") get a monospace tail
// so a missing font can't silently switch the xterm cell grid to proportional.
const withMonoFallback = (f) => {
  const s = String(f || "").trim();
  if (!s) return s;
  return /monospace/i.test(s) ? s : `${s}, monospace`;
};
const getTerminalOpts = (settings = {}) => {
  const t = settings.terminal || {};
  const fontSize = Number.isFinite(t.fontSize) ? t.fontSize : Number.isFinite(settings.terminalFontSize) ? settings.terminalFontSize : 13;
  const fontFamily = withMonoFallback(t.fontFamily || settings.terminalFontFamily || "Courier New, Courier, monospace");
  const cursorStyle = t.cursorStyle || settings.terminalCursorStyle || "block";
  const cursorBlink = t.cursorBlink !== undefined ? !!t.cursorBlink : settings.terminalCursorBlink !== undefined ? !!settings.terminalCursorBlink : true;
  const scrollback = Number.isFinite(t.scrollback) ? t.scrollback : Number.isFinite(settings.terminalScrollback) ? settings.terminalScrollback : 1000;
  const copyOnSelect = t.copyOnSelect === true || settings.terminalCopyOnSelect === true;
  return { fontSize: Math.min(32, Math.max(8, fontSize)), fontFamily, cursorStyle, cursorBlink, scrollback, copyOnSelect };
};

const TerminalPanel = ({ nodeId, config }) => {
  const elRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const tabIdRef = useRef(null);
  const initTerminalRef = useRef(null); // startTerminal, usable after mount
  
  const [initError, setInitError] = useState(null);
  const [cwd, setCwd] = useState(null);

  // Generate unique tabId per terminal instance
  if (!tabIdRef.current) {
    const safeNodeId = nodeId ? String(nodeId).replace(/[^a-zA-Z0-9_]/g, "_") : `term_${nextTerminalId++}`;
    const rand = Math.random().toString(36).slice(2, 7);
    tabIdRef.current = `term_${safeNodeId}_${rand}`;
  }
  const tabId = tabIdRef.current;

  // ── Context menu (Right Click anywhere inside terminal) ────────────────────
  const handleContextMenu = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const term = termRef.current;
    let selText = term?.getSelection() || "";
    if (!selText) {
      try {
        const ds = document.getSelection()?.toString();
        if (ds) selText = ds;
      } catch {}
    }
    const hasSelection = !!selText;

    const result = await window.electronAPI.showTerminalContextMenu(hasSelection);
    if (!result) return;

    switch (result.action) {
      case "copy":
        if (selText) {
          try { window.electronAPI.clipboardWrite(selText); }
          catch { try { navigator.clipboard.writeText(selText); } catch {} }
        }
        break;
      case "paste": {
        const text = window.electronAPI.clipboardRead();
        if (text) window.electronAPI.writeToTerminal(tabId, text);
        break;
      }
      case "addPanel":
        window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { nodeId, location: "CENTER" } }));
        break;
      case "splitRight":
        window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { nodeId, location: "RIGHT" } }));
        break;
      case "splitDown":
        window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { nodeId, location: "BOTTOM" } }));
        break;
      case "clear":
        term?.clear();
        window.electronAPI.writeToTerminal(tabId, "\x1bc");
        break;
      case "restart": {
        const dir = cwdRef.current ?? cwd;
        if (!dir) return;
        window.electronAPI.openTerminal(tabId, dir, true); // force restart
        break;
      }
      case "close":
        window.dispatchEvent(new CustomEvent("close-flex-tab", { detail: { nodeId } }));
        break;
    }
  }, [tabId, cwd, nodeId]);

  const handleFocus = useCallback(() => {
    if (termRef.current) {
      try { termRef.current.focus(); } catch {}
    }
  }, []);

  // Shell-aware chdir via main (cmd.exe needs `cd /d` for drive switches).
  // Falls back to a raw `cd` write when the new IPC is unavailable or reports no PTY.
  const chdirTerminal = useCallback((id, dir) => {
    const raw = () => { try { window.electronAPI.writeToTerminal(id, `cd "${String(dir).replace(/"/g, '\\"')}"\r`); } catch {} };
    try {
      if (!window.electronAPI.cdTerminal) { raw(); return; }
      Promise.resolve(window.electronAPI.cdTerminal(id, dir)).then((r) => { if (!r || r.ok === false) raw(); }).catch(raw);
    } catch { raw(); }
  }, []);

  // cwdRef keeps latest cwd accessible inside effects without re-triggering them
  const cwdRef = useRef(cwd);
  useEffect(() => { cwdRef.current = cwd; }, [cwd]);
  const copyOnSelectRef = useRef(false);

  // ── Initialize xterm + PTY ────────────────────────────────────────────────
  // Depends ONLY on tabId — cwd change should NOT kill/restart the terminal.
  // Project open/close events handle cd-ing via a separate effect below.
  // If no project is open at mount time, the creation is deferred: cdTo()
  // can call initTerminalRef.current(cwd) later to build the xterm UI.
  useEffect(() => {
    let term;
    let fit;
    let ro;
    let el;
    let rafId;
    let fitIv;
    let disposed = false;

    const startTerminal = async (targetCwd) => {
      if (disposed || termRef.current || !targetCwd) return;

      setCwd(targetCwd);

      // Load terminal settings (fontSize, fontFamily, cursor, scrollback) — previously hardcoded to 13px,
      // so Settings → Terminal → Font Size never affected the terminal and instead leaked to editor.
      let termOpts = getTerminalOpts({});
      try {
        const s = await window.electronAPI.readSettings();
        if (s) termOpts = getTerminalOpts(s);
      } catch {}
      term = new Terminal({
        cursorBlink: termOpts.cursorBlink,
        cursorStyle: termOpts.cursorStyle,
        fontFamily: termOpts.fontFamily,
        fontSize: termOpts.fontSize,
        scrollback: termOpts.scrollback,
        lineHeight: 1.15,
        letterSpacing: 0,
        allowTransparency: false,
        theme: {
          background: "#1e1e1e",
          foreground: "#cccccc",
          cursor: "#c8c8c8",
          cursorAccent: "#1e1e1e",
          selectionBackground: "#2c4f6e",
          selectionInactiveBackground: "#264f78",
          black: "#333333", red: "#f44747", green: "#4ec9b0", yellow: "#dcdcaa",
          blue: "#569cd6", magenta: "#c586c0", cyan: "#9cdcfe", white: "#d4d4d4",
          brightBlack: "#767676", brightRed: "#f44747", brightGreen: "#4ec9b0",
          brightYellow: "#dcdcaa", brightBlue: "#569cd6", brightMagenta: "#c586c0",
          brightCyan: "#9cdcfe", brightWhite: "#ffffff",
        },
      });

      fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon((event, uri) => {
        // Open localhost links inside the app's Browser panel, external links in OS browser
        try {
          if (uri.includes("localhost") || uri.includes("127.0.0.1") || uri.match(/^\d+\.\d+\.\d+\.\d+/)) {
            window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: uri, config: { type: "browser", title: "Browser", url: uri } } }));
          } else if (/^https?:\/\//i.test(uri)) {
            // For http(s) links, also open inside Browser panel to keep navigation isolated
            window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: uri, config: { type: "browser", title: "Browser", url: uri } } }));
          } else {
            window.electronAPI.openUrl(uri);
          }
        } catch {
          try { window.electronAPI.openUrl(uri); } catch {}
        }
      }));

      // elRef div is ALWAYS rendered (placeholder is an overlay), so it is
      // available from the first commit — no waiting required.
      el = elRef.current;
      if (!el) {
        // UI element never appeared (component unmounted or stuck) — abort
        // before spawning a PTY that would have no visible output.
        try { term.dispose(); } catch {}
        return;
      }
      el.innerHTML = "";
      term.open(el);
      term.focus();

      term.onData((data) => {
        window.electronAPI.writeToTerminal(tabId, data);
      });

      termRef.current = term;
      fitRef.current = fit;
      copyOnSelectRef.current = termOpts.copyOnSelect;
      // copyOnSelect was dead — wire selection → clipboard
      try {
        term.onSelectionChange(() => {
          if (!copyOnSelectRef.current) return;
          const sel = term.getSelection();
          if (sel) {
            try { window.electronAPI.clipboardWrite(sel); } catch {}
            try { navigator.clipboard.writeText(sel); } catch {}
          }
        });
      } catch {}

      const safeFit = () => {
        if (!fit || !term || !el) return;
        if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
        try {
          fit.fit();
          if (term.cols > 0 && term.rows > 0) {
            window.electronAPI.resizeTerminal(tabId, term.cols, term.rows);
          }
        } catch {}
      };

      ro = new ResizeObserver(() => {
        safeFit();
      });
      if (el) ro.observe(el);

      rafId = requestAnimationFrame(() => {
        if (!disposed) {
          safeFit();
          setTimeout(safeFit, 100);
          setTimeout(safeFit, 300);
        }
      });

      // Self-healing fit: when this window is covered or minimized, Chromium
      // pauses rAF/ResizeObserver and throttles timers, so the initial fits
      // can run against a stale container size. Poll the size and re-fit
      // whenever it changes; interval throttling while hidden is fine (a
      // single re-fit on the next visible tick is enough).
      let lastFitW = 0, lastFitH = 0;
      fitIv = setInterval(() => {
        if (disposed || !el) return;
        const w = el.offsetWidth, h = el.offsetHeight;
        if (w === lastFitW && h === lastFitH) return;
        lastFitW = w; lastFitH = h;
        safeFit();
      }, 500);

      await window.electronAPI.openTerminal(tabId, targetCwd || cwdRef.current);
    };

    initTerminalRef.current = startTerminal;

    (async () => {
      try {
        // Resolve project working directory
        let targetCwd = config?.cwd || window.__currentProjectPath;
        if (!targetCwd) {
          try { targetCwd = await window.electronAPI.getProjectPath(); } catch {}
        }
        if (!targetCwd) targetCwd = window.__currentProjectPath || null;

        // If no project is open, don't spawn a PTY — show placeholder instead
        if (!targetCwd) {
          if (!disposed) setCwd(null);
          return;
        }

        await startTerminal(targetCwd);
      } catch (err) {
        if (!disposed) setInitError(err?.message || String(err));
      }
    })();

    return () => {
      disposed = true;
      initTerminalRef.current = null;
      if (rafId !== undefined) cancelAnimationFrame(rafId);
      if (fitIv !== undefined) clearInterval(fitIv);
      window.electronAPI.closeTerminal(tabId);
      if (term) { try { term.dispose(); } catch {} }
      termRef.current = null;
      fitRef.current = null;
      if (ro && el) ro.disconnect();
    };
  }, [tabId]); // ← cwd removed: tab switch / cwd update will NOT kill the PTY

  // ── Listen for shell output / exit ────────────────────────────────────────
  useEffect(() => {
    const unsubData = window.electronAPI.onTerminalData(({ tabId: tId, data }) => {
      if (tId === tabId && termRef.current) {
        try { termRef.current.write(data); } catch {}
      }
    });

    const unsubExit = window.electronAPI.onTerminalExit(({ tabId: tId, code }) => {
      if (tId === tabId && termRef.current) {
        try { termRef.current.write(`\x1b[33m\r\n[Process exited with code ${code}]\x1b[0m\r\n`); } catch {}
      }
    });

    return () => { unsubData(); unsubExit(); };
  }, [tabId]);

  // ── Live terminal settings (fontSize, fontFamily, cursor, scrollback, copyOnSelect) ───────
  // Previously only fontSize was partially wired and leaked to editor; now all terminal
  // keys are isolated and live. copyOnSelect was dead — now wired via copyOnSelectRef.
  useEffect(() => {
    const applyPatch = (patch) => {
      const term = termRef.current;
      if (!term) return;
      // patch may be {fontSize} from terminal-settings channel OR {terminal:{...}, terminalFontSize} from IPC
      let opts = null;
      if (patch && typeof patch === "object" && ("terminal" in patch || "terminalFontSize" in patch || "terminalFontFamily" in patch || "terminalCursorStyle" in patch || "terminalCursorBlink" in patch || "terminalScrollback" in patch || "terminalCopyOnSelect" in patch)) {
        // full settings object (from onSettingsUpdated) — re-derive
        try {
          const s = { ...(window.__termLastSettings || {}), ...patch };
          window.__termLastSettings = s;
          opts = getTerminalOpts(s);
        } catch {}
      } else if (patch && typeof patch === "object" && ("fontSize" in patch || "fontFamily" in patch || "cursorStyle" in patch || "cursorBlink" in patch || "scrollback" in patch || "copyOnSelect" in patch)) {
        // direct terminal-settings patch like {fontSize: 16}
        try {
          const last = window.__termLastSettings || {};
          const t = last.terminal || {};
          const nextT = { ...t, ...patch };
          const s = { ...last, terminal: nextT };
          // also handle flat aliases for consistency
          if ("fontSize" in patch) s.terminalFontSize = patch.fontSize;
          if ("fontFamily" in patch) s.terminalFontFamily = patch.fontFamily;
          if ("cursorStyle" in patch) s.terminalCursorStyle = patch.cursorStyle;
          if ("cursorBlink" in patch) s.terminalCursorBlink = patch.cursorBlink;
          if ("scrollback" in patch) s.terminalScrollback = patch.scrollback;
          if ("copyOnSelect" in patch) s.terminalCopyOnSelect = patch.copyOnSelect;
          window.__termLastSettings = s;
          opts = getTerminalOpts(s);
        } catch {}
      }
      if (!opts) return;
      try { term.options.fontSize = opts.fontSize; } catch {}
      try { term.options.fontFamily = opts.fontFamily; } catch {}
      try { term.options.cursorStyle = opts.cursorStyle; } catch {}
      try { term.options.cursorBlink = opts.cursorBlink; } catch {}
      try { term.options.scrollback = opts.scrollback; } catch {}
      copyOnSelectRef.current = !!opts.copyOnSelect;
      try { fitRef.current?.fit(); } catch {}
      try { window.electronAPI.resizeTerminal(tabId, term.cols, term.rows); } catch {}
    };
    // init cache
    try { window.electronAPI.readSettings().then((s)=>{ if(s) window.__termLastSettings = s; }).catch(()=>{}); } catch {}
    let bc;
    try {
      bc = new BroadcastChannel("terminal-settings");
      bc.onmessage = (e) => applyPatch(e.data);
    } catch {}
    let unsubIpc = null;
    try {
      unsubIpc = window.electronAPI.onSettingsUpdated((data) => {
        // only react if terminal keys changed (was incomplete — missed blink/scrollback/copy)
        if (data && (data.terminal || "terminalFontSize" in data || "terminalFontFamily" in data || "terminalCursorStyle" in data || "terminalCursorBlink" in data || "terminalScrollback" in data || "terminalCopyOnSelect" in data)) {
          applyPatch(data);
        }
      });
    } catch {}
    return () => { try { bc?.close(); } catch {} try { unsubIpc?.(); } catch {} };
  }, [tabId]);

  // ── Listen for "Open in Terminal" from file explorer ──────────────────────
  useEffect(() => {
    const handler = (e) => {
      const dir = e.detail?.dir;
      if (!dir) return;
      setCwd(dir);
      const ensureTerminal = () => {
        if (termRef.current) {
          try {
            chdirTerminal(tabId, dir);
            try { termRef.current.focus(); } catch {}
            try { window.dispatchEvent(new CustomEvent("focus-terminal-tab")); } catch {}
          } catch {}
        } else if (initTerminalRef.current) {
          initTerminalRef.current(dir);
        } else {
          window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { nodeId, location: "BOTTOM" } }));
          setTimeout(() => {
            if (initTerminalRef.current) initTerminalRef.current(dir);
            else window.dispatchEvent(new CustomEvent("open-terminal", { detail: { dir } }));
          }, 400);
        }
      };
      ensureTerminal();
    };
    window.addEventListener("open-terminal", handler);
    return () => window.removeEventListener("open-terminal", handler);
  }, [tabId, nodeId]);

  // ── Focus/highlight terminal on Ctrl+` (target highlight, not new terminal) ─
  useEffect(() => {
    const onFocus = (e) => {
      const tId = e.detail?.tabId;
      // Only focus this instance if it matches the target tab or no specific target
      if (tId && tId !== tabId && tId !== nodeId) return;
      try { termRef.current?.focus(); } catch {}
      // Visual highlight flash on the panel
      try {
        const el = elRef.current?.closest?.(".term-panel");
        if (el) {
          el.style.outline = "2px solid #007acc";
          el.style.outlineOffset = "-2px";
          setTimeout(() => { try { el.style.outline = ""; } catch {} }, 600);
        }
      } catch {}
    };
    const onHighlight = () => {
      try {
        const el = elRef.current?.closest?.(".term-panel");
        if (el) {
          el.style.outline = "2px solid #007acc";
          el.style.outlineOffset = "-2px";
          setTimeout(() => { try { el.style.outline = ""; } catch {} }, 600);
        }
      } catch {}
    };
    window.addEventListener("terminal:focus", onFocus);
    window.addEventListener("terminal:highlight", onHighlight);
    return () => {
      window.removeEventListener("terminal:focus", onFocus);
      window.removeEventListener("terminal:highlight", onHighlight);
    };
  }, [tabId, nodeId]);

  // ── Menu & Custom events (Open/Close Project) ──────────────────────────────
  // When project opens and terminal has no PTY yet, spawn one.
  useEffect(() => {
    const cdTo = (p) => {
      if (!p) return;
      setCwd(p);
      if (termRef.current) {
        // PTY may have been killed by project close — openTerminal reuses the
        // live one or spawns a fresh shell in the main process, then cd in.
        window.electronAPI.openTerminal(tabId, p);
        chdirTerminal(tabId, p);
      } else if (initTerminalRef.current) {
        // No PTY yet — spawn one now that we have a project path (creates
        // the xterm UI too; before this fix only the PTY was spawned, leaving
        // the panel blank)
        initTerminalRef.current(p);
      }
    };

    const handleProjectOpen = (e) => {
      const p = e.detail?.path;
      if (p) cdTo(p);
    };

    window.addEventListener("project:opened", handleProjectOpen);
    const u1 = window.electronAPI.onMenuEvent("menu:openProject", (p) => { if (p) cdTo(p); });
    const u2 = window.electronAPI.onMenuEvent("menu:newProject",  (p) => { if (p) cdTo(p); });
    const u3 = window.electronAPI.onMenuEvent("menu:closeProject", () => {
      setCwd(null);
      // No project open → kill the shell so the terminal stops working
      window.electronAPI.closeTerminal(tabId);
    });

    return () => {
      window.removeEventListener("project:opened", handleProjectOpen);
      u1(); u2(); u3();
    };
  }, [tabId]);

  const dirName = cwd ? cwd.replace(/[\\/]$/, "").split(/[\\/]/).pop() || cwd : "Terminal";

  return (
    <div className="term-panel" onClick={handleFocus}>
      <TerminalStyle />

      <div className="term-content" onContextMenu={handleContextMenu}>
        {initError ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#f44747", fontSize: 12, padding: 20, textAlign: "center" }}>
            Terminal init error: {initError}
          </div>
        ) : (
          <div ref={elRef} className="term-xterm" style={{ flex: 1, minHeight: 0, overflow: "hidden" }} />
        )}
      </div>

      {!cwd && !initError && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 2,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          color: "#666", fontSize: 13, background: "#1e1e1e", gap: 12, userSelect: "none",
        }}>
          <svg width="40" height="40" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="3" width="12" height="10" rx="1" stroke="#444" strokeWidth="1.2" fill="none" />
            <path d="M5 7L7 9L5 11" stroke="#444" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 11H11" stroke="#444" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span>Open a project to use the terminal</span>
        </div>
      )}

      <div className="term-status">
        <svg className="term-status-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="3" width="12" height="10" rx="1" stroke="#777" strokeWidth="1.2" fill="none" />
          <path d="M5 7L7 9L5 11" stroke="#777" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 7L11 9L9 11" stroke="#777" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="term-status-path">{dirName}</span>

        <div className="term-status-actions">
          <button
            className="term-status-btn"
            title="Split Right"
            onClick={() => window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { nodeId, location: "RIGHT" } }))}
          >
            ⧉ Right
          </button>
          <button
            className="term-status-btn"
            title="Split Down"
            onClick={() => window.dispatchEvent(new CustomEvent("add-terminal-panel", { detail: { nodeId, location: "BOTTOM" } }))}
          >
            ⧉ Down
          </button>
        </div>
      </div>
    </div>
  );
};

export default TerminalPanel;

