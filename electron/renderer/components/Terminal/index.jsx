// Terminal Panel — Flexlayout integrated standalone terminal component
// Multi-session: ek panel me multiple PTY + dropdown se switch + top toolbar.
import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef, useSyncExternalStore } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { cssVar } from "../shared/theme.js";

let nextTerminalId = 1;
const genSessionId = () => {
  const rand = Math.random().toString(36).slice(2, 7);
  return `term_g_${Date.now().toString(36)}_${rand}`;
};

// ─── Global terminal registry: saare panels ek hi dropdown/list dekhte hain ─
// Sessions panel-level nahi, app-level hain — naya terminal tab kholo to wahi
// list + wahi shells dikhenge. PTY main-process me tabId se keyed hai aur
// `terminal:open` bina forceRestart ke reuse karta hai, isliye multiple views
// (panels) ek hi PTY ko mirror kar sakte hain. PTY sirf explicit kill par
// close hota hai (view unmount par nahi), taaki panel switch/close par shell
// zinda rahe.
const GlobalTerms = {
  sessions: [{ id: genSessionId(), n: 1 }],
  activeId: null,
  cwdMap: {},
  counter: 1,
  version: 0,
  cachedSnap: null,
  listeners: new Set(),
  snapshot() {
    // useSyncExternalStore: same reference until data changes, warna infinite loop
    if (!this.cachedSnap || this.cachedSnap.v !== this.version) {
      this.cachedSnap = {
        v: this.version,
        sessions: this.sessions,
        activeId: this.activeId || (this.sessions[0] && this.sessions[0].id) || null,
        cwdMap: this.cwdMap,
      };
    }
    return this.cachedSnap;
  },
  emit() { this.version += 1; for (const l of [...this.listeners]) { try { l(); } catch {} } },
  subscribe(fn) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; },
  add() {
    this.counter += 1;
    const s = { id: genSessionId(), n: this.counter };
    this.sessions = [...this.sessions, s];
    this.activeId = s.id;
    this.emit();
    return s.id;
  },
  kill(id) {
    const target = id || this.activeId || (this.sessions[0] && this.sessions[0].id);
    if (!target) return;
    try { window.electronAPI.closeTerminal(target); } catch {}
    const next = this.sessions.filter((s) => s.id !== target);
    const { [target]: _drop, ...restCwd } = this.cwdMap;
    this.cwdMap = restCwd;
    if (!next.length) {
      this.counter += 1;
      const s = { id: genSessionId(), n: this.counter };
      this.sessions = [s];
      this.activeId = s.id;
    } else {
      this.sessions = next;
      if (this.activeId === target) this.activeId = next[0].id;
    }
    this.emit();
  },
  setActive(id) {
    if (!id || !this.sessions.some((s) => s.id === id)) return;
    if (this.activeId !== id) { this.activeId = id; this.emit(); }
  },
  setCwd(id, cwd) {
    if (this.cwdMap[id] === cwd) return;
    this.cwdMap = { ...this.cwdMap, [id]: cwd };
    this.emit();
  },
};
const useGlobalTerms = () => useSyncExternalStore(
  (fn) => GlobalTerms.subscribe(fn),
  () => GlobalTerms.snapshot(),
  () => GlobalTerms.snapshot()
);

// ── Project switch/close: purane root ke PTY sessions kill ──────────────
// index.jsx `terminals:killAll` dispatch karta hai (detail.root = old root).
// cwd root ke andar ho tabhi kill — emulator mirror jaise bahari sessions
// bachte hain. Store me fresh session, taaki naya project clean shell paye.
if (typeof window !== "undefined" && !window.__termsKillHooked) {
  window.__termsKillHooked = true;
  window.addEventListener("terminals:killAll", (e) => {
    try {
      const norm = (p) => String(p || "").replace(/[\\/]+$/, "").toLowerCase();
      const root = e?.detail?.root ? norm(e.detail.root) : null;
      const snap = GlobalTerms.snapshot();
      const killed = new Set();
      for (const s of [...(snap.sessions || [])]) {
        const cwd = GlobalTerms.cwdMap[s.id];
        // cwd null = kabhi start hi nahi hua (PTY nahi) → reset list me jayega
        const match = !root || !cwd || norm(cwd).startsWith(root);
        if (!match) continue;
        killed.add(s.id);
        if (cwd) {
          try { window.electronAPI.closeTerminal(s.id); } catch {}
        }
      }
      const kept = (snap.sessions || []).filter((s) => !killed.has(s.id));
      const restCwd = {};
      for (const [k, v] of Object.entries(GlobalTerms.cwdMap || {})) {
        if (!killed.has(k)) restCwd[k] = v;
      }
      GlobalTerms.cwdMap = restCwd;
      if (!kept.length) {
        GlobalTerms.counter += 1;
        const fresh = { id: genSessionId(), n: GlobalTerms.counter };
        GlobalTerms.sessions = [fresh];
        GlobalTerms.activeId = fresh.id;
      } else {
        GlobalTerms.sessions = kept;
        if (!kept.some((s) => s.id === GlobalTerms.activeId)) {
          GlobalTerms.activeId = kept[0].id;
        }
      }
      GlobalTerms.emit();
    } catch {}
  });
}

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
.xterm { height: 100%; padding: 0 !important; background: var(--bg-surface) !important; }
.xterm-viewport { scrollbar-width: thin; background: var(--bg-surface) !important; }
.xterm-viewport::-webkit-scrollbar { width: 6px; }
.xterm-viewport::-webkit-scrollbar-track { background: transparent; }
.xterm-viewport::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: var(--radius-sm); }
.xterm-viewport::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); }
.xterm-cursor { outline: none !important; }
.xterm-cursor-block { background: var(--text-highlight) !important; opacity: 0.9; }
.xterm-cursor-blink { animation: xterm-cursor-blink 1s step-end infinite; }
@keyframes xterm-cursor-blink { 50% { opacity: 0; } }
.xterm-selection div { background: var(--selection) !important; opacity: 0.5; }
.xterm-rows { font-variant-ligatures: none; letter-spacing: normal; }
.term-xterm { padding: var(--space-4) var(--space-6); box-sizing: border-box; background: var(--bg-surface); height: 100%; width: 100%; overflow: hidden; }
.term-xterm .xterm { pointer-events: auto; }
.term-xterm .xterm-viewport { pointer-events: auto; }
.xterm-screen { background: var(--bg-surface) !important; }
`;

const TERMINAL_PANEL_CSS = `
.term-panel { display:flex; flex-direction:column; height:100%; width:100%; background:var(--bg-surface); position:relative; overflow:hidden; }
.term-content { flex:1; position:relative; overflow:hidden; z-index:var(--z-base); background:var(--bg-surface); display:flex; flex-direction:column; min-height:0; }
.term-empty { display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-muted); font-size:var(--fs-title); background:var(--bg-surface); }
.term-status { display:flex; align-items:center; gap:var(--space-6); padding:var(--space-3) var(--space-10); background:var(--bg-raised); border-top:1px solid var(--border); font-size:var(--fs-small); color:var(--text-muted); flex-shrink:0; user-select:none; }
.term-status-icon { flex-shrink:0; }
.term-status-path { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
.term-status-actions { display:flex; align-items:center; gap:var(--space-4); }
.term-status-btn { background:transparent; border:none; color:var(--icon); cursor:pointer; padding:var(--space-2) var(--space-4); border-radius:var(--radius-xs); font-size:var(--fs-small); }
.term-status-btn:hover { background:var(--bg-thumb); color:var(--text-inverse); }
.term-toolbar { display:flex; align-items:center; gap:var(--space-6); padding:var(--space-4) var(--space-8); background:var(--bg-vscode); border-bottom:1px solid var(--bg-active); flex-shrink:0; user-select:none; }
.term-dd { position:relative; flex-shrink:1; min-width:0; }
.term-dd-btn { background:var(--bg-surface); color:var(--text-bright); border:1px solid var(--border-light); border-radius:var(--radius-sm); font-size:var(--fs-small); padding:var(--space-2) var(--space-8); outline:none; cursor:pointer; max-width:230px; min-width:130px; display:inline-flex; align-items:center; gap:var(--space-6); overflow:hidden; }
.term-dd-btn:hover { border-color:var(--accent); }
.term-dd-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; text-align:left; }
.term-dd-chev { opacity:0.7; font-size:var(--fs-tiny); flex-shrink:0; }
.term-dd-menu { position:absolute; top:calc(100% + 4px); left:0; min-width:230px; max-width:300px; max-height:260px; overflow-y:auto; background:var(--bg-raised); border:1px solid var(--border-strong); border-radius:var(--radius-md); box-shadow:0 8px 24px var(--overlay-dark); z-index:var(--z-menu); padding:var(--space-4); display:flex; flex-direction:column; gap:2px; }
.term-dd-item { display:flex; align-items:center; gap:var(--space-6); width:100%; padding:var(--space-4) var(--space-8); border:0; border-radius:var(--radius-sm); background:transparent; color:var(--text-bright); font-size:var(--fs-small); cursor:pointer; text-align:left; }
.term-dd-item:hover { background:var(--bg-hover); }
.term-dd-item--active { background:var(--select-blue); color:var(--text-inverse); }
.term-dd-item--active:hover { background:var(--select-blue); }
.term-dd-item-name { font-weight:var(--fw-semibold); white-space:nowrap; flex-shrink:0; }
.term-dd-item-cwd { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; opacity:0.75; font-size:var(--fs-tiny); }
.term-dd-item-x { flex-shrink:0; background:transparent; border:none; color:inherit; opacity:0.6; cursor:pointer; padding:0 var(--space-2); border-radius:var(--radius-xs); font-size:var(--fs-small); line-height:1; }
.term-dd-item-x:hover { opacity:1; background:var(--error-bg-solid); color:var(--text-inverse); }
.term-dd-new { display:flex; align-items:center; justify-content:center; gap:var(--space-4); width:100%; margin-top:var(--space-2); padding:var(--space-4); border:1px dashed var(--border-light); border-radius:var(--radius-sm); background:transparent; color:var(--teal); font-size:var(--fs-small); cursor:pointer; }
.term-dd-new:hover { background:var(--teal-a12); border-color:var(--teal); }
.term-tool-btn { background:var(--bg-active); border:1px solid var(--border-light); color:var(--text-soft); cursor:pointer; padding:var(--space-2) var(--space-8); border-radius:var(--radius-sm); font-size:var(--fs-small); line-height:1; display:inline-flex; align-items:center; justify-content:center; min-width:26px; min-height:24px; flex-shrink:0; }
.term-tool-btn:hover { background:var(--bg-thumb); color:var(--text-inverse); }
.term-tool-btn:disabled { opacity:0.4; cursor:default; }
.term-tool-btn--danger:hover { background:var(--error-bg-solid); color:var(--text-inverse); border-color:var(--error-border-3); }
.term-toolbar-count { font-size:var(--fs-tiny); color:var(--text-muted); flex-shrink:0; }
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
  const fontFamily = withMonoFallback(t.fontFamily || settings.terminalFontFamily || "Consolas, 'Courier New', Courier, monospace");
  const cursorStyle = t.cursorStyle || settings.terminalCursorStyle || "block";
  const cursorBlink = t.cursorBlink !== undefined ? !!t.cursorBlink : settings.terminalCursorBlink !== undefined ? !!settings.terminalCursorBlink : true;
  const scrollback = Number.isFinite(t.scrollback) ? t.scrollback : Number.isFinite(settings.terminalScrollback) ? settings.terminalScrollback : 1000;
  const copyOnSelect = t.copyOnSelect === true || settings.terminalCopyOnSelect === true;
  return { fontSize: Math.min(32, Math.max(8, fontSize)), fontFamily, cursorStyle, cursorBlink, scrollback, copyOnSelect };
};

// ─── Single PTY session (one xterm + one pty) ─────────────────────────────
// Parent keeps these mounted (hidden when inactive) so buffer survives switch.
const TerminalSession = forwardRef(({ tabId, nodeId, config, active, onCwd }, ref) => {
  const elRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const initTerminalRef = useRef(null);

  const [initError, setInitError] = useState(null);
  const [cwd, setCwd] = useState(null);

  const mirrorTabId = config?.mirrorTabId || null;
  const listenId = mirrorTabId || tabId;

  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);

  // notify parent of cwd changes (for dropdown labels + status bar)
  useEffect(() => { try { onCwd && onCwd(tabId, cwd); } catch {} }, [cwd, tabId, onCwd]);

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
        if (mirrorTabId) { term?.clear(); break; } // mirror has no PTY — just clear
        const dir = cwdRef.current ?? cwd;
        if (!dir) return;
        window.electronAPI.openTerminal(tabId, dir, true); // force restart
        break;
      }
      case "close":
        window.dispatchEvent(new CustomEvent("close-flex-tab", { detail: { nodeId } }));
        break;
    }
  }, [tabId, cwd, nodeId, mirrorTabId]);

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

      setCwd(mirrorTabId ? null : targetCwd);

      // Load terminal settings (fontSize, fontFamily, cursor, scrollback) — previously hardcoded to 13px,
      // so Settings → Terminal → Font Size never affected the terminal and instead leaked to editor.
      let termOpts = getTerminalOpts({});
      try {
        const s = await window.electronAPI.readSettings();
        if (s) termOpts = getTerminalOpts(s);
      } catch {}
      if (disposed) return;
      term = new Terminal({
        cursorBlink: termOpts.cursorBlink,
        cursorStyle: termOpts.cursorStyle,
        fontFamily: termOpts.fontFamily,
        fontSize: termOpts.fontSize,
        scrollback: termOpts.scrollback,
        lineHeight: 1.15,
        letterSpacing: 0,
        allowTransparency: false,
        // Palette xterm canvas par paint hota hai — var() yahan resolve nahi
        // hota, isliye CENTRAL sheet se runtime par read karo (cssVar).
        // Fallbacks == pehle wale hardcoded values (koi visual change nahi).
        theme: {
          background: cssVar("--bg-surface", "#1e1e1e"),
          foreground: cssVar("--text-bright", "#cccccc"),
          cursor: cssVar("--text-primary", "#c8c8c8"),
          cursorAccent: cssVar("--bg-surface", "#1e1e1e"),
          selectionBackground: cssVar("--term-selection", "#2c4f6e"),
          selectionInactiveBackground: cssVar("--selection", "#264f78"),
          black: cssVar("--border", "#333333"),
          red: cssVar("--danger", "#f44747"),
          green: cssVar("--teal", "#4ec9b0"),
          yellow: cssVar("--code-yellow", "#dcdcaa"),
          blue: cssVar("--code-blue", "#569cd6"),
          magenta: cssVar("--code-magenta", "#c586c0"),
          cyan: cssVar("--code-cyan", "#9cdcfe"),
          white: cssVar("--text-highlight", "#d4d4d4"),
          brightBlack: cssVar("--term-bright-black", "#767676"),
          brightRed: cssVar("--danger", "#f44747"),
          brightGreen: cssVar("--teal", "#4ec9b0"),
          brightYellow: cssVar("--code-yellow", "#dcdcaa"),
          brightBlue: cssVar("--code-blue", "#569cd6"),
          brightMagenta: cssVar("--code-magenta", "#c586c0"),
          brightCyan: cssVar("--code-cyan", "#9cdcfe"),
          brightWhite: cssVar("--text-inverse", "#ffffff"),
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
      // Hidden (inactive) sessions have 0 size — wait until visible/active.
      el = elRef.current;
      if (!el) {
        // UI element never appeared (component unmounted or stuck) — abort
        // before spawning a PTY that would have no visible output.
        try { term.dispose(); } catch {}
        return;
      }
      if (el.offsetWidth === 0 || el.offsetHeight === 0) {
        // Session created while hidden (background tab) — dispose xterm shell,
        // retry when activated (parent calls api.start() via initTerminalRef).
        try { term.dispose(); } catch {}
        term = null;
        return;
      }
      el.innerHTML = "";
      term.open(el);

      if (!mirrorTabId) {
        term.onData((data) => {
          window.electronAPI.writeToTerminal(tabId, data);
        });
      }

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
          if (!mirrorTabId && term.cols > 0 && term.rows > 0) {
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

      if (!mirrorTabId) await window.electronAPI.openTerminal(tabId, targetCwd || cwdRef.current);
    };

    initTerminalRef.current = startTerminal;

    (async () => {
      try {
        // Mirror tabs need no project/cwd — show the stream immediately
        if (mirrorTabId) {
          await startTerminal("__mirror__");
          return;
        }
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
      // NOTE: PTY close nahi karte — sessions global hain, view unmount
      // (panel switch/close) par shell zinda rehta hai. Kill sirf 🗑 se.
      if (term) { try { term.dispose(); } catch {} }
      termRef.current = null;
      fitRef.current = null;
      if (ro && el) ro.disconnect();
    };
  }, [tabId]); // ← cwd removed: tab switch / cwd update will NOT kill the PTY

  // ── Listen for shell output / exit ────────────────────────────────────────
  useEffect(() => {
    const unsubData = window.electronAPI.onTerminalData(({ tabId: tId, data }) => {
      if (tId === listenId && termRef.current) {
        try { termRef.current.write(data); } catch {}
      }
    });

    const unsubExit = window.electronAPI.onTerminalExit(({ tabId: tId, code }) => {
      if (tId === listenId && termRef.current) {
        try { termRef.current.write(`\x1b[33m\r\n[Process exited with code ${code}]\x1b[0m\r\n`); } catch {}
      }
    });

    return () => { unsubData(); unsubExit(); };
  }, [tabId, mirrorTabId, listenId]);

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
  // Multi-session: only the ACTIVE session handles it (warna saare cd ho jate).
  useEffect(() => {
    const handler = (e) => {
      if (!activeRef.current) return;
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
  }, [tabId, nodeId, chdirTerminal]);

  // ── Focus/highlight terminal on Ctrl+` (target highlight, not new terminal) ─
  useEffect(() => {
    const onFocus = (e) => {
      const tId = e.detail?.tabId;
      // Only focus this instance if it matches the target tab or no specific target
      if (tId && tId !== tabId && tId !== nodeId) return;
      if (!tId && !activeRef.current) return; // untargeted focus → active session only
      try { termRef.current?.focus(); } catch {}
      // Visual highlight flash on the panel
      try {
        const el = elRef.current?.closest?.(".term-panel");
        if (el) {
          el.style.outline = "2px solid var(--accent)";
          el.style.outlineOffset = "-2px";
          setTimeout(() => { try { el.style.outline = ""; } catch {} }, 600);
        }
      } catch {}
    };
    const onHighlight = () => {
      try {
        const el = elRef.current?.closest?.(".term-panel");
        if (el) {
          el.style.outline = "2px solid var(--accent)";
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
  }, [tabId, chdirTerminal]);

  // Parent API: focus / clear / fit / restart / ensureStarted
  const ensureStarted = useCallback(async () => {
    if (termRef.current || mirrorTabId) {
      try { fitRef.current?.fit(); } catch {}
      return;
    }
    const starter = initTerminalRef.current;
    if (!starter) return;
    let dir = cwdRef.current || window.__currentProjectPath;
    if (!dir) {
      try { dir = await window.electronAPI.getProjectPath(); } catch {}
    }
    if (dir) { try { await starter(dir); } catch {} }
  }, [mirrorTabId]);
  useImperativeHandle(ref, () => ({
    focus: () => { try { termRef.current?.focus(); } catch {} },
    clear: () => { try { termRef.current?.clear(); } catch {} },
    fit: () => { try { fitRef.current?.fit(); } catch {} },
    ensureStarted,
    restart: (dir) => {
      const d = dir || cwdRef.current;
      if (!d || mirrorTabId) return;
      try { window.electronAPI.openTerminal(tabId, d, true); } catch {}
    },
    get tabId() { return tabId; },
  }), [tabId, mirrorTabId, ensureStarted]);

  // Activated (dropdown switch / tab visible) → start if needed, fit + focus
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const boot = async () => {
      // hidden mount par xterm bana hi nahi hoga — ab visible hai to start karo
      if (!termRef.current && initTerminalRef.current && !mirrorTabId) {
        let dir = cwdRef.current || window.__currentProjectPath;
        if (!dir) { try { dir = await window.electronAPI.getProjectPath(); } catch {} }
        if (cancelled) return;
        if (dir) { try { await initTerminalRef.current(dir); } catch {} }
      }
      if (!cancelled) { try { fitRef.current?.fit(); } catch {} }
    };
    const t1 = setTimeout(boot, 30);
    const t2 = setTimeout(() => { try { fitRef.current?.fit(); } catch {} }, 250);
    return () => { cancelled = true; clearTimeout(t1); clearTimeout(t2); };
  }, [active, mirrorTabId]);

  if (initError) {
    return (
      <div style={{ display: active ? "flex" : "none", alignItems: "center", justifyContent: "center", height: "100%", width: "100%", color: "var(--danger)", fontSize: "var(--fs-body)", padding: "var(--space-20)", textAlign: "center" }}>
        Terminal init error: {initError}
      </div>
    );
  }
  return (
    <div
      ref={elRef}
      className="term-xterm"
      onContextMenu={handleContextMenu}
      style={{ flex: 1, minHeight: 0, overflow: "hidden", display: active ? "flex" : "none", flexDirection: "column" }}
    />
  );
});

// ─── Multi-session panel: GLOBAL toolbar (dropdown + actions) + sessions ────
// Saare terminal panels ek hi GlobalTerms store se render hote hain — naya
// tab/panel kholo to wahi dropdown, wahi shells. Har panel har session ka
// mirror view mount karta hai (PTY shared, open reuse karta hai).
const TerminalPanel = ({ nodeId, config }) => {
  const mirrorTabId = config?.mirrorTabId || null;

  const { sessions, activeId, cwdMap } = useGlobalTerms();
  const sessionApis = useRef(new Map());
  const [panelCwd, setPanelCwd] = useState(null);
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef(null);

  // track project root for status fallback
  useEffect(() => {
    const sync = () => { try { setPanelCwd(window.__currentProjectPath || null); } catch {} };
    sync();
    const onOpen = (e) => { if (e?.detail?.path) setPanelCwd(e.detail.path); else sync(); };
    const onClose = () => setPanelCwd(null);
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    return () => {
      window.removeEventListener("project:opened", onOpen);
      window.removeEventListener("project:closed", onClose);
    };
  }, []);

  // dropdown bahar click / Escape → band
  useEffect(() => {
    if (!ddOpen) return;
    const onDoc = (e) => { try { if (ddRef.current && !ddRef.current.contains(e.target)) setDdOpen(false); } catch {} };
    const onKey = (e) => { if (e.key === "Escape") setDdOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [ddOpen]);

  const onSessionCwd = useCallback((id, cwd) => {
    GlobalTerms.setCwd(id, cwd);
  }, []);

  const setApi = useCallback((id) => (api) => {
    if (api) sessionApis.current.set(id, api);
    else sessionApis.current.delete(id);
  }, []);

  const focusActive = useCallback(() => {
    const id = GlobalTerms.snapshot().activeId;
    const api = sessionApis.current.get(id);
    try { api?.focus(); } catch {}
  }, []);

  // active switch → session start (hidden mount fix) + fit
  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => {
      const api = sessionApis.current.get(activeId);
      try { api?.ensureStarted?.(); } catch {}
      try { api?.fit?.(); } catch {}
    }, 60);
    return () => clearTimeout(t);
  }, [activeId]);

  const addSession = useCallback(() => {
    GlobalTerms.add();
    setDdOpen(false);
    setTimeout(focusActive, 150);
  }, [focusActive]);

  const killSession = useCallback((id) => {
    GlobalTerms.kill(id);
    setDdOpen(false);
    setTimeout(focusActive, 150);
  }, [focusActive]);

  const switchSession = useCallback((id) => {
    GlobalTerms.setActive(id);
    setDdOpen(false);
    setTimeout(focusActive, 80);
  }, [focusActive]);

  const clearActive = useCallback(() => {
    const api = sessionApis.current.get(activeId);
    try { api?.clear(); } catch {}
    focusActive();
  }, [activeId, focusActive]);

  const restartActive = useCallback(() => {
    const api = sessionApis.current.get(activeId);
    const dir = cwdMap[activeId] || panelCwd;
    try { api?.restart(dir); } catch {}
  }, [activeId, cwdMap, panelCwd]);

  const activeCwd = cwdMap[activeId] || null;
  const activeIdx = Math.max(0, sessions.findIndex((s) => s.id === activeId));
  const activeSession = sessions.find((s) => s.id === activeId) || sessions[0];
  const dirBase = (p) => {
    if (!p) return null;
    try { return String(p).replace(/[\\/]$/, "").split(/[\\/]/).pop() || p; } catch { return p; }
  };
  const dirName = mirrorTabId ? "Emulator" : (dirBase(activeCwd) || dirBase(panelCwd) || "Terminal");
  const activeLabel = activeSession
    ? `Terminal ${activeSession.n}${dirBase(activeCwd) ? ` — ${dirBase(activeCwd)}` : ""}`
    : "Terminal";

  // ── Mirror mode: single read-only stream, no toolbar (old behavior) ──────
  if (mirrorTabId) {
    return (
      <div className="term-panel" onClick={focusActive}>
        <TerminalStyle />
        <div className="term-content">
          <TerminalSession
            ref={setApi("mirror")}
            tabId={mirrorTabId}
            nodeId={nodeId}
            config={config}
            active={true}
            onCwd={onSessionCwd}
          />
        </div>
        <div className="term-status">
          <span className="term-status-path">Emulator</span>
        </div>
      </div>
    );
  }

  return (
    <div className="term-panel" onClick={focusActive}>
      <TerminalStyle />

      {/* ── Top toolbar: GLOBAL dropdown + new/kill/clear + splits ───────── */}
      <div className="term-toolbar">
        <div className="term-dd" ref={ddRef}>
          <button
            className="term-dd-btn"
            title="Switch terminal (global)"
            onClick={(e) => { e.stopPropagation(); setDdOpen((v) => !v); }}
          >
            <span className="term-dd-label">{activeLabel}</span>
            <span className="term-dd-chev">{ddOpen ? "▴" : "▾"}</span>
          </button>
          {ddOpen && (
            <div className="term-dd-menu" onClick={(e) => e.stopPropagation()}>
              {sessions.map((s) => {
                const base = dirBase(cwdMap[s.id]);
                const isActive = s.id === activeId;
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <button
                      className={isActive ? "term-dd-item term-dd-item--active" : "term-dd-item"}
                      onClick={() => switchSession(s.id)}
                      title={cwdMap[s.id] || `Terminal ${s.n}`}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <span className="term-dd-item-name">{isActive ? "● " : "○ "}Terminal {s.n}</span>
                      <span className="term-dd-item-cwd">{base || "no project"}</span>
                    </button>
                    <button
                      className="term-dd-item-x"
                      title={`Kill Terminal ${s.n}`}
                      onClick={(e) => { e.stopPropagation(); killSession(s.id); }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button className="term-dd-new" onClick={addSession}>+ New terminal</button>
            </div>
          )}
        </div>
        <span className="term-toolbar-count">{activeIdx + 1}/{sessions.length}</span>
      </div>

      <div className="term-content">
        {sessions.map((s) => (
          <TerminalSession
            key={s.id}
            ref={setApi(s.id)}
            tabId={s.id}
            nodeId={nodeId}
            config={config}
            active={s.id === activeId}
            onCwd={onSessionCwd}
          />
        ))}
      </div>

      {!(activeCwd || panelCwd) && (
        <div style={{
          position: "absolute", top: 33, left: 0, right: 0, bottom: 25, zIndex: "var(--z-raised)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          color: "var(--text-muted)", fontSize: "var(--fs-title)", background: "var(--bg-surface)", gap: "var(--space-12)", userSelect: "none",
        }}>
          <svg width="40" height="40" viewBox="0 0 16 16" fill="none">
            <rect style={{ stroke: "var(--text-disabled)" }} x="2" y="3" width="12" height="10" rx="1" strokeWidth="1.2" fill="none" />
            <path style={{ stroke: "var(--text-disabled)" }} d="M5 7L7 9L5 11" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            <path style={{ stroke: "var(--text-disabled)" }} d="M9 11H11" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span>Open a project to use the terminal</span>
        </div>
      )}

      <div className="term-status">
        <svg className="term-status-icon" width="11" height="11" viewBox="0 0 16 16" fill="none">
          <rect style={{ stroke: "var(--icon-muted)" }} x="2" y="3" width="12" height="10" rx="1" strokeWidth="1.2" fill="none" />
          <path style={{ stroke: "var(--icon-muted)" }} d="M5 7L7 9L5 11" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path style={{ stroke: "var(--icon-muted)" }} d="M9 7L11 9L9 11" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="term-status-path">{dirName}</span>

        <div className="term-status-actions">
          <button
            className="term-status-btn"
            title="New terminal"
            onClick={addSession}
          >
            + New
          </button>
          <button
            className="term-status-btn"
            title="Kill active terminal"
            onClick={() => killSession(activeId)}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--error-text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = ""; }}
          >
            🗑 Kill
          </button>
          <button
            className="term-status-btn"
            title="Clear active terminal"
            onClick={clearActive}
          >
            ∿ Clear
          </button>
          <button
            className="term-status-btn"
            title="Restart active terminal"
            onClick={restartActive}
          >
            ↻ Restart
          </button>
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
