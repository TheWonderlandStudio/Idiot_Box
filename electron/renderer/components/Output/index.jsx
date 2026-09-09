// Output Panel — VS Code-style log sink with channels (App / Git / Updater /
// Live Server). Any renderer code can log via window.__outputLog(channel,
// message, level). Main-process logs arrive via preload onOutputLog bridge.
// Lines are buffered in-memory (cap per channel) so early logs survive.
import React, { useEffect, useState, useRef, useCallback } from "react";

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

export const OUTPUT_CHANNELS = ["App", "Git", "Updater", "Live Server"];
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
          push(`Unhandled rejection: ${r?.message || String(r ?? "unknown")}`.slice(0, 300));
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

const levelColor = (level) => {
  if (level === "error") return "var(--danger)";
  if (level === "warn") return "var(--git-modified)";
  return "var(--text-muted)";
};

const OutputPanel = () => {
  const [channel, setChannel] = useState("App");
  const [lines, setLines] = useState(() => {
    try { return [...(window.__outputBuffer?.["App"] || [])]; } catch { return []; }
  });
  const [stick, setStick] = useState(true); // autoscroll lock
  const bodyRef = useRef(null);
  const channelRef = useRef(channel);
  useEffect(() => { channelRef.current = channel; }, [channel]);

  const pullChannel = useCallback((ch) => {
    try { setLines([...(window.__outputBuffer?.[ch] || [])]); } catch { setLines([]); }
  }, []);

  // Drain buffer on mount + live updates (local event + main bridge)
  useEffect(() => {
    pullChannel(channelRef.current);
    const refresh = () => {
      try { setLines([...(window.__outputBuffer?.[channelRef.current] || [])]); } catch {}
    };
    window.addEventListener("output:log", refresh);
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
      try { unsub?.(); } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autoscroll when locked
  useEffect(() => {
    if (!stick) return;
    try {
      const el = bodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }, [lines, stick]);

  const onScroll = useCallback(() => {
    try {
      const el = bodyRef.current;
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      setStick(atBottom);
    } catch {}
  }, []);

  const switchChannel = useCallback((ch) => {
    setChannel(ch);
    setStick(true);
    try { setLines([...(window.__outputBuffer?.[ch] || [])]); } catch { setLines([]); }
  }, []);

  const clearChannel = useCallback(() => {
    try {
      if (window.__outputBuffer) window.__outputBuffer[channel] = [];
      setLines([]);
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

      {/* Body */}
      <div
        ref={bodyRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: "auto", padding: "var(--space-6) var(--space-8)", fontFamily: "var(--font-code)", fontSize: "var(--fs-body)" }}
      >
        {lines.length === 0 && (
          <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontFamily: "sans-serif" }}>
            No output yet
            <div style={{ fontSize: "var(--fs-small)", marginTop: "var(--space-8)", color: "var(--text-placeholder)" }}>
              Git, Updater &amp; Live Server logs appear here — or log from anywhere via window.__outputLog
            </div>
          </div>
        )}
        {lines.slice(-MAX_LINES).map((l) => (
          <div key={l.id} style={{ display: "flex", gap: "var(--space-8)", padding: "1px var(--space-4)", lineHeight: "var(--lh-md)", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
            <span style={{ color: "var(--text-placeholder)", flexShrink: 0, userSelect: "none" }}>{fmtTime(l.ts)}</span>
            <span style={{ color: levelColor(l.level), flexShrink: 0, userSelect: "none", width: 38 }}>
              {l.level === "error" ? "error" : l.level === "warn" ? "warn" : "info"}
            </span>
            <span style={{ color: l.level === "error" ? "var(--error-text)" : "var(--text-bright)", flex: 1, minWidth: 0 }}>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default OutputPanel;
