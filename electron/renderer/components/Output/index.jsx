// Output Panel — VS Code-style log sink with channels (App / Git / Updater /
// Live Server). Any renderer code can log via window.__outputLog(channel,
// message, level). Main-process logs arrive via preload onOutputLog bridge.
// Lines are buffered in-memory (cap per channel) so early logs survive.
import React, { useEffect, useState, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { cssVar } from "../shared/theme.js";

// ── User-supplied Output icon (branch/flow glyph, 20×20, currentColor) ────
export const OutputIcon = ({ size = 14, style } = {}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 20"
    style={{ flexShrink: 0, ...(style || {}) }}
    aria-hidden="true"
  >
    <path
      fill="currentColor"
      d="M16.78 1.97a.75.75 0 1 0-1.06 1.06l1.72 1.72h-3.69A4.75 4.75 0 0 0 9 9.5v1a3.25 3.25 0 0 1-3.25 3.25h-3a.75.75 0 0 0 0 1.5h3a4.75 4.75 0 0 0 4.75-4.75v-1a3.25 3.25 0 0 1 3.25-3.25h3.69l-1.72 1.72a.75.75 0 0 0 1.06 1.06l3-3a.75.75 0 0 0 0-1.06zM13.25 3.5A5.75 5.75 0 0 0 7.5 9.25v1a2.25 2.25 0 0 1-2.25 2.25h-2.5a.75.75 0 0 1 0-1.5h2.5a.75.75 0 0 0 .75-.75v-1A7.25 7.25 0 0 1 13.25 2h.5a.75.75 0 0 1 0 1.5zm.914 4.001c-.244.485-.3 1.03-.17 1.544a.75.75 0 0 0-.494.705v1A7.25 7.25 0 0 1 6.25 18h-.5a.75.75 0 0 1 0-1.5h.5A5.75 5.75 0 0 0 12 10.75v-1a2.25 2.25 0 0 1 2.164-2.25"
    />
  </svg>
);

export const OUTPUT_CHANNELS = ["App", "Git", "Updater", "Live Server", "Run"];
const MAX_LINES = 1000;
const BUFFER_CAP = 500;

// ── Module-level install (once): global log fn + pre-mount buffer ─────────
if (typeof window !== "undefined" && !window.__outputLog) {
  window.__outputBuffer = window.__outputBuffer || {};
  window.__outputSeq = window.__outputSeq || 0;
  window.__outputLog = (channel, message, level = "info") => {
    try {
      const ch = OUTPUT_CHANNELS.includes(channel) ? channel : "App";
      const buf = window.__outputBuffer;
      buf[ch] = buf[ch] || [];
      buf[ch].push({
        id: ++window.__outputSeq,
        ts: Date.now(),
        level: level === "warn" || level === "error" ? level : "info",
        msg: String(message ?? ""),
      });
      if (buf[ch].length > BUFFER_CAP) buf[ch] = buf[ch].slice(-BUFFER_CAP);
      window.dispatchEvent(new CustomEvent("output:log", { detail: { channel: ch } }));
    } catch {}
  };
  // Renderer runtime errors → App channel (rate-limited: max 1 per second)
  const hookErrors = () => {
    try {
      let last = 0;
      const push = (msg) => {
        const now = Date.now();
        if (now - last < 1000) return;
        last = now;
        try { window.__outputLog("App", msg, "error"); } catch {}
      };
      window.addEventListener("error", (e) => {
        try { push(`Uncaught: ${e?.message || "unknown"} @ ${(e?.filename || "").split(/[\\/]/).pop()}:${e?.lineno || "?"}`); } catch {}
      });
      window.addEventListener("unhandledrejection", (e) => {
        try {
          const r = e?.reason;
          const stack = String(r?.stack || "").split("\n").slice(0, 4).join(" | ").slice(0, 400);
          const base = `Unhandled rejection: ${r?.message || String(r ?? "unknown")}`.slice(0, 300);
          push(stack ? `${base} — ${stack}` : base);
        } catch {}
      });
    } catch {}
  };
  hookErrors();
}

const fmtTime = (ts) => {
  try {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  } catch { return ""; }
};

// ── xterm theme (Terminal panel wali palette — cssVar runtime resolve) ──
const makeXtermTheme = () => {
  const bg = cssVar("--bg-surface", "#1e1e1e");
  return {
    background: bg,
    foreground: cssVar("--text-bright", "#cccccc"),
    cursor: bg, // log view me cursor invisible
    cursorAccent: bg,
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
  };
};

// ANSI hata kar visible length (same-line overwrite ki padding ke liye)
const visibleLen = (s) => {
  try {
    return String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").length;
  } catch { return String(s).length; }
};
// Trailing-\r pieces (progress bars, spinners — same line overwrite) newline
// ke BINA likhe jate hain taaki agli write usi line par overwrite kare.
// Har row: { text, newline }.
const formatLine = (l) => {
  const ts = fmtTime(l.ts);
  const lvl = l.level === "error" ? "\x1b[31merror\x1b[0m"
    : l.level === "warn" ? "\x1b[33mwarn\x1b[0m"
    : "\x1b[90minfo\x1b[0m";
  const head = `\x1b[90m${ts}\x1b[0m ${lvl} `;
  const body = l.level === "error" ? `\x1b[31m${l.msg}\x1b[0m` : String(l.msg ?? "");
  // multi-line message → alag-alag rows (staircase se bachne ke liye)
  const rows = String(head + body).split(/\r?\n/);
  // final "\n" se bana khaali tail hatado (warna har message ke baad blank line)
  if (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
  return rows.map((row) => {
    const cr = /\r$/.test(row);
    return { text: cr ? row.slice(0, -1) : row, newline: !cr };
  });
};

const OutputPanel = () => {
  const [channel, setChannel] = useState("App");
  const [lines, setLines] = useState(() => {
    try { return [...(window.__outputBuffer?.["App"] || [])]; } catch { return []; }
  });
  const [stick, setStick] = useState(true); // autoscroll lock
  const channelRef = useRef(channel);
  useEffect(() => { channelRef.current = channel; }, [channel]);
  // ── xterm refs ──
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const xtermElRef = useRef(null);
  const stickRef = useRef(true);
  const renderedRef = useRef({ channel: null, lastId: 0, crLen: 0 });
  useEffect(() => { stickRef.current = stick; }, [stick]);

  const pullChannel = useCallback((ch) => {
    try { setLines([...(window.__outputBuffer?.[ch] || [])]); } catch { setLines([]); }
  }, []);

  // Drain buffer on mount + live updates (local event + main bridge)
  useEffect(() => {
    // Run panel jaise openers channel maangte hain (add-output-panel detail /
    // output:switchChannel) — mount par pending wish poori karo.
    try {
      const want = window.__outputWantChannel;
      if (want && OUTPUT_CHANNELS.includes(want) && channelRef.current !== want) {
        channelRef.current = want;
        setChannel(want);
        setStick(true);
        setLines([...(window.__outputBuffer?.[want] || [])]);
      } else {
        pullChannel(channelRef.current);
      }
      // Mount ne wish poori kar li — clear taaki agli manual open App par rahe.
      try { window.__outputWantChannel = null; } catch {}
    } catch { pullChannel(channelRef.current); }
    const onSwitch = (e) => {
      try {
        const want = e?.detail?.channel;
        if (want && OUTPUT_CHANNELS.includes(want)) {
          window.__outputWantChannel = want;
          channelRef.current = want;
          setChannel(want);
          setStick(true);
          setLines([...(window.__outputBuffer?.[want] || [])]);
        }
      } catch {}
    };
    // add-output-panel seedha bhi aa sakta hai (index.jsx hamesha forward karta hai,
    // par belt-and-suspenders: detail.channel yahan bhi suno).
    const onAdd = (e) => {
      try {
        const want = e?.detail?.channel;
        if (want && OUTPUT_CHANNELS.includes(want)) onSwitch({ detail: { channel: want } });
      } catch {}
    };
    const refresh = () => {
      try { setLines([...(window.__outputBuffer?.[channelRef.current] || [])]); } catch {}
    };
    window.addEventListener("output:log", refresh);
    window.addEventListener("output:switchChannel", onSwitch);
    window.addEventListener("add-output-panel", onAdd);
    let unsub = null;
    try {
      unsub = window.electronAPI?.onOutputLog?.((entry) => {
        try {
          if (entry && entry.channel && typeof entry.message !== "undefined") {
            window.__outputLog(entry.channel, entry.message, entry.level || "info");
          }
        } catch {}
      });
    } catch {}
    return () => {
      window.removeEventListener("output:log", refresh);
      window.removeEventListener("output:switchChannel", onSwitch);
      window.removeEventListener("add-output-panel", onAdd);
      try { unsub?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── xterm lifecycle (read-only log view — koi input nahi) ──
  useEffect(() => {
    let term = null;
    let fit = null;
    let ro = null;
    let rafId = 0;
    let disposed = false;
    try {
      term = new Terminal({
        cursorBlink: false,
        fontFamily: "Consolas, 'Courier New', Courier, monospace",
        fontSize: 12,
        lineHeight: 1.2,
        letterSpacing: 0,
        scrollback: 2000,
        allowTransparency: false,
        theme: makeXtermTheme(),
      });
    } catch { return undefined; }
    fit = new FitAddon();
    try { term.loadAddon(fit); } catch {}
    try {
      term.loadAddon(new WebLinksAddon((_event, uri) => {
        try {
          if (/^https?:\/\//i.test(uri) || uri.includes("localhost") || uri.includes("127.0.0.1") || /^\d+\.\d+\.\d+\.\d+/.test(uri)) {
            window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: uri, config: { type: "browser", title: "Browser", url: uri } } }));
          } else {
            window.electronAPI?.openUrl?.(uri);
          }
        } catch {
          try { window.electronAPI?.openUrl?.(uri); } catch {}
        }
      }));
    } catch {}
    const el = xtermElRef.current;
    if (!el) { try { term.dispose(); } catch {} return undefined; }
    try {
      el.innerHTML = "";
      term.open(el);
    } catch { try { term.dispose(); } catch {} return undefined; }
    termRef.current = term;
    fitRef.current = fit;
    // user ne upar scroll kiya → follow todo (neeche aaya → follow wapas)
    try {
      term.onScroll(() => {
        try {
          const buf = term.buffer.active;
          const atBottom = buf.viewportY >= buf.baseY;
          if (stickRef.current !== atBottom) {
            stickRef.current = atBottom;
            setStick(atBottom);
          }
        } catch {}
      });
    } catch {}
    // select-to-copy (log view me copy hi main interaction hai)
    try {
      term.onSelectionChange(() => {
        try {
          const sel = term.getSelection();
          if (sel) {
            try { window.electronAPI?.clipboardWrite?.(sel); } catch {}
            try { navigator.clipboard.writeText(sel); } catch {}
          }
        } catch {}
      });
    } catch {}
    const safeFit = () => {
      if (disposed || !fit || !term || !el) return;
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
      try { fit.fit(); } catch {}
    };
    try {
      ro = new ResizeObserver(() => safeFit());
      ro.observe(el);
    } catch {}
    rafId = requestAnimationFrame(() => {
      if (disposed) return;
      safeFit();
      setTimeout(safeFit, 100);
      setTimeout(safeFit, 300);
    });
    // app theme badla → xterm palette refresh
    let bc = null;
    let unsubSettings = null;
    const refreshTheme = () => {
      try { if (termRef.current) termRef.current.options.theme = makeXtermTheme(); } catch {}
    };
    try {
      bc = new BroadcastChannel("app-settings");
      bc.onmessage = () => refreshTheme();
    } catch {}
    try {
      unsubSettings = window.electronAPI?.onSettingsUpdated?.(() => refreshTheme());
    } catch {}
    return () => {
      disposed = true;
      try { cancelAnimationFrame(rafId); } catch {}
      try { ro?.disconnect(); } catch {}
      try { bc?.close(); } catch {}
      try { unsubSettings?.(); } catch {}
      try { term.dispose(); } catch {}
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── buffer → xterm sync (incremental; channel switch par full rewrite) ──
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    try {
      const r = renderedRef.current;
      const list = lines.slice(-MAX_LINES);
      if (r.channel !== channel) {
        try { term.clear(); } catch {}
        r.channel = channel;
        r.lastId = 0;
        r.crLen = 0;
      }
      for (const l of list) {
        if (!l || typeof l.id !== "number" || l.id <= r.lastId) continue;
        for (const row of formatLine(l)) {
          try {
            if (row.newline) {
              term.writeln(row.text);
              r.crLen = 0;
            } else {
              // same-line update: pichli \r-write se chhota ho to tail
              // spaces se dhako, phir cursor wapas line-start par.
              const pad = Math.max(0, (r.crLen || 0) - visibleLen(row.text));
              term.write(row.text + (pad ? " ".repeat(pad) : "") + "\r");
              r.crLen = visibleLen(row.text);
            }
          } catch {}
        }
        r.lastId = l.id;
      }
      if (stickRef.current) {
        try { term.scrollToBottom(); } catch {}
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, channel]);

  const switchChannel = useCallback((ch) => {
    setChannel(ch);
    setStick(true);
    try { setLines([...(window.__outputBuffer?.[ch] || [])]); } catch { setLines([]); }
  }, []);

  const clearChannel = useCallback(() => {
    try {
      if (window.__outputBuffer) window.__outputBuffer[channel] = [];
      setLines([]);
      renderedRef.current = { channel, lastId: 0, crLen: 0 };
      try { termRef.current?.clear(); } catch {}
    } catch {}
  }, [channel]);

  const errCount = lines.filter((l) => l.level === "error").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", color: "var(--text-bright)", fontFamily: "sans-serif", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-6) var(--space-12)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0 }}>
        <span style={{ display: "flex", alignItems: "center", color: "var(--icon)" }}>
          <OutputIcon size={14} />
        </span>
        <span style={{ fontSize: "var(--fs-body)", fontWeight: "var(--fw-semibold)" }}>Output</span>
        <select
          className="output-panel-select"
          value={channel}
          onChange={(e) => switchChannel(e.target.value)}
          title="Channel"
          style={{
            background: "var(--bg-surface)", color: "var(--text-bright)",
            border: "1px solid var(--border-light)", borderRadius: "var(--radius-sm)",
            fontSize: "var(--fs-small)", padding: "var(--space-2) var(--space-6)", cursor: "pointer",
            maxWidth: 140,
          }}
        >
          {OUTPUT_CHANNELS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {errCount > 0 && (
          <span style={{ fontSize: "var(--fs-tiny)", background: "var(--error-bg-solid)", color: "var(--danger)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-sm)" }}>
            {errCount} errors
          </span>
        )}
        <span style={{ fontSize: "var(--fs-tiny)", background: "var(--bg-active)", color: "var(--icon)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-sm)" }}>
          {lines.length}{lines.length >= MAX_LINES ? "+" : ""}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-4)" }}>
          <button
            onClick={() => setStick((v) => !v)}
            title={stick ? "Autoscroll on — click to lock" : "Autoscroll off — click to follow"}
            style={{
              background: stick ? "var(--select-blue)" : "transparent",
              border: "1px solid var(--border-light)",
              color: stick ? "var(--text-inverse)" : "var(--icon)",
              padding: "var(--space-2) var(--space-8)", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: "var(--fs-small)",
            }}
          >
            Follow
          </button>
          <button
            onClick={clearChannel}
            title={`Clear ${channel} output`}
            style={{
              background: "transparent", border: "1px solid var(--border-light)", color: "var(--icon)",
              padding: "var(--space-2) var(--space-8)", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: "var(--fs-small)",
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Body — xterm.js log view */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "var(--bg-surface)" }}>
        <div ref={xtermElRef} style={{ position: "absolute", inset: 0, padding: "var(--space-6) var(--space-8)" }} />
        {lines.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 32, color: "var(--text-muted)", fontFamily: "sans-serif", pointerEvents: "none" }}>
            <div>
              No output yet
              <div style={{ fontSize: "var(--fs-small)", marginTop: "var(--space-8)", color: "var(--text-placeholder)" }}>
                Git, Updater, Live Server &amp; Run logs appear here — or log from anywhere via window.__outputLog
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OutputPanel;
