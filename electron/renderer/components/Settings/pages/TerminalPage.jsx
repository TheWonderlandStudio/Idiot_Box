import React from "react";

// ─── TerminalPage ───────────────────────────────────────────────────────────
// Terminal appearance and behaviour settings.
// ─────────────────────────────────────────────────────────────────────────────

const CURSOR_STYLES = [
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
  { value: "bar", label: "Bar" },
];

const FONT_OPTIONS = [
  "Courier New",
  "Consolas",
  "Cascadia Code",
  "Fira Code",
  "JetBrains Mono",
  "monospace",
];

const TerminalPage = ({ settings, onSave }) => {
  const t = settings.terminal || {};
  const fontSize     = Number.isFinite(t.fontSize) ? t.fontSize : Number.isFinite(settings.terminalFontSize) ? settings.terminalFontSize : 13;
  const fontFamily   = t.fontFamily || settings.terminalFontFamily || "Courier New";
  const cursorStyle  = t.cursorStyle || settings.terminalCursorStyle || "block";
  const cursorBlink  = t.cursorBlink !== false && settings.terminalCursorBlink !== false; // default true
  const scrollback   = Number.isFinite(t.scrollback) ? t.scrollback : Number.isFinite(settings.terminalScrollback) ? settings.terminalScrollback : 1000;
  const copyOnSelect = t.copyOnSelect === true || settings.terminalCopyOnSelect === true; // default false

  const updateTerminal = async (patch) => {
    const nextTerminal = { ...t, ...patch };
    // Keep both nested and flat for backward compatibility
    const flat = {};
    if ("fontSize" in patch) flat.terminalFontSize = patch.fontSize;
    if ("fontFamily" in patch) flat.terminalFontFamily = patch.fontFamily;
    if ("cursorStyle" in patch) flat.terminalCursorStyle = patch.cursorStyle;
    if ("cursorBlink" in patch) flat.terminalCursorBlink = patch.cursorBlink;
    if ("scrollback" in patch) flat.terminalScrollback = patch.scrollback;
    if ("copyOnSelect" in patch) flat.terminalCopyOnSelect = patch.copyOnSelect;
    await onSave({ terminal: nextTerminal, ...flat });
    try {
      const bc = new BroadcastChannel("terminal-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
  };

  const setFontSize = async (v) => {
    let n = parseInt(v, 10);
    if (!Number.isFinite(n)) return;
    n = Math.min(32, Math.max(8, n));
    await updateTerminal({ fontSize: n });
  };

  return (
    <div>
      {/* ── Font Family ────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Font Family</span>
        <span className="sw-row__desc">Monospace font used in the integrated terminal.</span>
        <select
          className="sw-select"
          value={fontFamily}
          onChange={(e) => updateTerminal({ fontFamily: e.target.value })}
          aria-label="Terminal font family"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* ── Font Size ──────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Font Size</span>
        <span className="sw-row__desc">Terminal font size in pixels. Range 8–32.</span>
        <div className="sw-inline-row">
          <input
            type="range"
            className="sw-range"
            min={8}
            max={32}
            step={1}
            value={fontSize}
            onChange={(e) => setFontSize(e.target.value)}
            aria-label="Terminal font size"
          />
          <input
            type="number"
            className="sw-input sw-input--small"
            min={8}
            max={32}
            value={fontSize}
            onChange={(e) => setFontSize(e.target.value)}
            aria-label="Terminal font size number"
          />
          <span className="sw-inline-label">px</span>
        </div>
      </div>

      {/* ── Cursor Style ───────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Cursor Style</span>
        <span className="sw-row__desc">Shape of the terminal cursor.</span>
        <select
          className="sw-select"
          value={cursorStyle}
          onChange={(e) => updateTerminal({ cursorStyle: e.target.value })}
          aria-label="Cursor style"
        >
          {CURSOR_STYLES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Cursor Blink ───────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Cursor Blink</span>
        <span className="sw-row__desc">Whether the cursor blinks.</span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{cursorBlink ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${cursorBlink ? " sw-toggle-btn--on" : ""}`}
            onClick={() => updateTerminal({ cursorBlink: !cursorBlink })}
            aria-checked={cursorBlink}
            role="switch"
            aria-label="Toggle cursor blink"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Scrollback ─────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Scrollback</span>
        <span className="sw-row__desc">Number of lines to keep in the terminal buffer. Higher values use more memory.</span>
        <select
          className="sw-select"
          value={scrollback}
          onChange={(e) => updateTerminal({ scrollback: parseInt(e.target.value, 10) })}
          aria-label="Scrollback"
        >
          <option value={500}>500 lines</option>
          <option value={1000}>1000 lines</option>
          <option value={5000}>5000 lines</option>
          <option value={10000}>10000 lines</option>
        </select>
      </div>

      {/* ── Copy on Select ─────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Copy on Select</span>
        <span className="sw-row__desc">Automatically copy selected text to the clipboard.</span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{copyOnSelect ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${copyOnSelect ? " sw-toggle-btn--on" : ""}`}
            onClick={() => updateTerminal({ copyOnSelect: !copyOnSelect })}
            aria-checked={copyOnSelect}
            role="switch"
            aria-label="Toggle copy on select"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>
    </div>
  );
};

export default TerminalPage;
