import React from "react";

// ─── EditorPage (plain CodeMirror) ──────────────────────────────────────────
// Sirf zaroori settings: theme, font, tab, line numbers, word wrap,
// autocompletion, auto save. Editor fixed sensible setup par chalta hai.
// ─────────────────────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  "Consolas",
  "Cascadia Code",
  "Fira Code",
  "JetBrains Mono",
  "Courier New",
  "monospace",
];

const THEME_OPTIONS = [
  { value: "dark", label: "Dark (VS Code Dark)" },
  { value: "light", label: "Light (VS Code Light)" },
  { value: "oneDark", label: "One Dark" },
];

const INDENT_OPTIONS = [
  { value: "  ", label: "2 spaces" },
  { value: "    ", label: "4 spaces" },
  { value: "\t", label: "Tab" },
];

const broadcast = (patch) => {
  try {
    window.opener?.dispatchEvent(new CustomEvent("editor:settings-changed", { detail: patch }));
  } catch {}
  try {
    const bc = new BroadcastChannel("editor-settings");
    bc.postMessage(patch);
    bc.close();
  } catch {}
};

const EditorPage = ({ settings, onSave }) => {
  const s = settings || {};
  const lineNumbers = s.lineNumbers !== false; // default true
  const lineWrapping = (s.lineWrapping !== undefined ? s.lineWrapping : s.wordWrap) !== false; // default true
  const autocompletion = s.autocompletion !== false; // default true
  const tabAcceptsCompletion = s.tabAcceptsCompletion !== false; // default true
  const autoSave = s.autoSave === true || s.autoSave === "afterDelay"; // default false
  const fontSize = Number.isFinite(s.fontSize) ? s.fontSize : 14;
  const fontFamily = s.fontFamily || "Consolas";
  const tabSize = Number.isFinite(s.tabSize) ? s.tabSize : 2;
  const indentUnit = typeof s.indentUnit === "string" && s.indentUnit ? s.indentUnit : "  ";
  const theme = s.theme || s.editorTheme || "dark";

  const save = async (patch) => {
    const full = { ...patch };
    // Compat mirrors (notebook / purane readers ke liye)
    if ("lineWrapping" in full) full.wordWrap = full.lineWrapping !== false;
    if ("theme" in full) full.editorTheme = full.theme;
    await onSave(full);
    broadcast(full);
  };

  const toggle = (key, currentVal) => save({ [key]: !currentVal });

  const ToggleRow = ({ flagKey, on, label, desc }) => (
    <div className="sw-row">
      <span className="sw-row__label">{label}</span>
      <span className="sw-row__desc">{desc}</span>
      <label className="sw-toggle-row">
        <span className="sw-toggle-label">{on ? "Enabled" : "Disabled"}</span>
        <button
          className={`sw-toggle-btn${on ? " sw-toggle-btn--on" : ""}`}
          onClick={() => toggle(flagKey, on)}
          aria-checked={on}
          role="switch"
          aria-label={`Toggle ${label}`}
        >
          <span className="sw-toggle-thumb" />
        </button>
      </label>
    </div>
  );

  return (
    <div>
      <ToggleRow flagKey="lineNumbers" on={lineNumbers} label="Line Numbers" desc="Gutter me line numbers dikhao." />
      <ToggleRow flagKey="lineWrapping" on={lineWrapping} label="Word Wrap" desc="Lambi lines wrap karo (horizontal scroll nahi)." />
      <ToggleRow flagKey="autocompletion" on={autocompletion} label="Autocompletion" desc="Suggest popup (Ctrl+Space)." />
      <ToggleRow flagKey="tabAcceptsCompletion" on={tabAcceptsCompletion} label="Tab Accepts Suggestion" desc="Tab: suggestion khula ho to accept, band ho to normal indent." />

      {/* ── Theme ── */}
      <div className="sw-row">
        <span className="sw-row__label">Theme</span>
        <span className="sw-row__desc">vscodeDark / vscodeLight / oneDark. Turant apply hota hai.</span>
        <select
          className="sw-select"
          value={["dark", "light", "oneDark"].includes(theme) ? theme : "dark"}
          onChange={(e) => save({ theme: e.target.value })}
          aria-label="Editor theme"
        >
          {THEME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Font Family ── */}
      <div className="sw-row">
        <span className="sw-row__label">Font Family</span>
        <span className="sw-row__desc">Editor font. Missing font par monospace fallback lagta hai.</span>
        <select
          className="sw-select"
          value={fontFamily}
          onChange={(e) => save({ fontFamily: e.target.value })}
          aria-label="Font family"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* ── Font Size ── */}
      <div className="sw-row">
        <span className="sw-row__label">Font Size</span>
        <span className="sw-row__desc">Pixels me. Range 8–32.</span>
        <div className="sw-inline-row">
          <input
            type="range"
            className="sw-range"
            min={8}
            max={32}
            step={1}
            value={fontSize}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) save({ fontSize: Math.min(32, Math.max(8, v)) });
            }}
            aria-label="Font size"
          />
          <input
            type="number"
            className="sw-input sw-input--small"
            min={8}
            max={32}
            value={fontSize}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) save({ fontSize: Math.min(32, Math.max(8, v)) });
            }}
            aria-label="Font size number"
          />
          <span className="sw-inline-label">px</span>
        </div>
      </div>

      {/* ── Tab Size + Indent Unit ── */}
      <div className="sw-row">
        <span className="sw-row__label">Tab Size</span>
        <span className="sw-row__desc">Tab stop width (1–8).</span>
        <select
          className="sw-select"
          value={tabSize}
          onChange={(e) => save({ tabSize: parseInt(e.target.value, 10) })}
          aria-label="Tab size"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>{n} spaces</option>
          ))}
        </select>
      </div>
      <div className="sw-row">
        <span className="sw-row__label">Indent Unit</span>
        <span className="sw-row__desc">Nayi indent me kya insert ho.</span>
        <select
          className="sw-select"
          value={indentUnit}
          onChange={(e) => save({ indentUnit: e.target.value })}
          aria-label="Indent unit"
        >
          {INDENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Auto Save ── */}
      <div className="sw-row">
        <span className="sw-row__label">Auto Save</span>
        <span className="sw-row__desc">Rukne par thodi der me auto-save. Band ho to Ctrl+S dabao.</span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{autoSave ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${autoSave ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("autoSave", autoSave)}
            aria-checked={autoSave}
            role="switch"
            aria-label="Toggle auto save"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>
    </div>
  );
};

export default EditorPage;
