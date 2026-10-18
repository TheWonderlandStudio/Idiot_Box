import React from "react";

// ─── EditorPage (plain CodeMirror) ──────────────────────────────────────────
// Only the essential settings: theme, font, tab, line numbers, word wrap,
// autocompletion, auto save. The editor runs on a fixed sensible setup.
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
  const vimMode = s.vim === true; // default false (disabled)
  const snippets = s.snippets !== false; // default true
  const fontSize = Number.isFinite(s.fontSize) ? s.fontSize : 14;
  const fontFamily = s.fontFamily || "Consolas";
  const tabSize = Number.isFinite(s.tabSize) ? s.tabSize : 2;
  const indentUnit = typeof s.indentUnit === "string" && s.indentUnit ? s.indentUnit : "  ";
  const theme = s.theme || s.editorTheme || "dark";
  // ── Visual / UX flags ──
  const minimap = s.minimap !== false;
  const indentGuides = s.indentGuides !== false;
  const bracketPairColorization = s.bracketPairColorization !== false;
  const highlightWhitespace = s.highlightWhitespace === true;
  const fontLigatures = s.fontLigatures === true;
  const lineHeight = Number.isFinite(s.lineHeight) ? s.lineHeight : 1.5;
  const fontWeight = [300, 400, 500, 600, 700].includes(s.fontWeight) ? s.fontWeight : 400;
  const formatOnSave = s.formatOnSave === true;
  const trimTrailingWhitespace = s.trimTrailingWhitespace === true;
  const insertFinalNewline = s.insertFinalNewline === true;
  const gitGutter = s.gitGutter !== false;
  const gitBlame = s.gitBlame === true;
  const breadcrumbs = s.breadcrumbs !== false;
  const emmet = s.emmet !== false;
  const colorDecorators = s.colorDecorators !== false;

  const save = async (patch) => {
    const full = { ...patch };
    // Compat mirrors (for notebook / old readers)
    if ("lineWrapping" in full) full.wordWrap = full.lineWrapping !== false;
    if ("theme" in full) full.editorTheme = full.theme;
    if ("vim" in full) full.vim = !!full.vim; // normalize: store as boolean (do NOT negate - toggle already inverted it)
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
      <section className="sw-frame">
      <div className="sw-section-title">Editing</div>
      <ToggleRow className="sw-row" flagKey="lineNumbers" on={lineNumbers} label="Line Numbers" desc="Show line numbers in the gutter." />
      <ToggleRow className="sw-row" flagKey="lineWrapping" on={lineWrapping} label="Word Wrap" desc="Wrap long lines (no horizontal scroll)." />
      <ToggleRow className="sw-row" flagKey="autocompletion" on={autocompletion} label="Autocompletion" desc="Suggest popup (Ctrl+Space)." />
      <ToggleRow className="sw-row" flagKey="tabAcceptsCompletion" on={tabAcceptsCompletion} label="Tab Accepts Suggestion" desc="Tab accepts an open suggestion, otherwise normal indent." />
      <ToggleRow className="sw-row" flagKey="formatOnSave" on={formatOnSave} label="Format on Save" desc="Run the formatter automatically before each save." />
      <ToggleRow className="sw-row" flagKey="trimTrailingWhitespace" on={trimTrailingWhitespace} label="Trim Trailing Whitespace" desc="Remove trailing spaces/tabs on save." />
      <ToggleRow className="sw-row" flagKey="insertFinalNewline" on={insertFinalNewline} label="Insert Final Newline" desc="Ensure the file ends with a newline on save." />
      </section>

      {/* ── Theme ── */}
      <section className="sw-frame">
      <div className="sw-section-title">Appearance</div>
      <div className="sw-row">
        <span className="sw-row__label">Theme</span>
        <span className="sw-row__desc">          vscodeDark / vscodeLight / oneDark. Applies instantly.</span>
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
        <span className="sw-row__desc">Editor font. Falls back to monospace if the font is missing.</span>
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
        <span className="sw-row__desc">In pixels. Range 8–32.</span>
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

      {/* ── Line Height ── */}
      <div className="sw-row">
        <span className="sw-row__label">Line Height</span>
        <span className="sw-row__desc">Line spacing multiplier (1.0–3.0).</span>
        <div className="sw-inline-row">
          <input
            type="range" className="sw-range" min={1} max={3} step={0.1}
            value={lineHeight}
            onChange={(e) => save({ lineHeight: Math.round(parseFloat(e.target.value) * 100) / 100 })}
            aria-label="Line height"
          />
          <span className="sw-inline-label">{lineHeight.toFixed(1)}</span>
        </div>
      </div>

      {/* ── Font Weight ── */}
      <div className="sw-row">
        <span className="sw-row__label">Font Weight</span>
        <span className="sw-row__desc">Editor text weight.</span>
        <select
          className="sw-select" value={fontWeight}
          onChange={(e) => save({ fontWeight: parseInt(e.target.value, 10) })}
          aria-label="Font weight"
        >
          {[300, 400, 500, 600, 700].map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </div>

      <ToggleRow className="sw-row" flagKey="minimap" on={minimap} label="Minimap" desc="Show the code minimap on the right edge." />
      <ToggleRow className="sw-row" flagKey="indentGuides" on={indentGuides} label="Indentation Guides" desc="Show vertical indent guide lines." />
      <ToggleRow className="sw-row" flagKey="bracketPairColorization" on={bracketPairColorization} label="Bracket Pair Colorization" desc="Color matching brackets by nesting depth." />
      <ToggleRow className="sw-row" flagKey="highlightWhitespace" on={highlightWhitespace} label="Render Whitespace" desc="Show a dot for every space and arrow for tabs." />
      <ToggleRow className="sw-row" flagKey="fontLigatures" on={fontLigatures} label="Font Ligatures" desc="Enable programming ligatures (needs a ligature font)." />
      <ToggleRow className="sw-row" flagKey="colorDecorators" on={colorDecorators} label="Color Decorators" desc="Show a colour swatch next to CSS colour values." />
      </section>

      {/* ── Tab Size + Indent Unit ── */}
      <section className="sw-frame">
      <div className="sw-section-title">Indentation</div>
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
        <span className="sw-row__desc">What to insert for a new indent.</span>
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
      </section>

      {/* ── Auto Save ── */}
      <section className="sw-frame">
      <div className="sw-section-title">Saving &amp; Advanced</div>
      <div className="sw-row">
        <span className="sw-row__label">Auto Save</span>
        <span className="sw-row__desc">Auto-saves after a short pause. If it is off, press Ctrl+S.</span>
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

      {/* ── Snippets ── */}
      <ToggleRow className="sw-row" flagKey="snippets" on={snippets} label="Snippets" desc="Code snippets in autocomplete (for, if, class, etc.)" />
      <ToggleRow className="sw-row" flagKey="emmet" on={emmet} label="Emmet" desc="Expand HTML/CSS abbreviations with Tab (e.g. div>ul>li)." />
      <ToggleRow className="sw-row" flagKey="breadcrumbs" on={breadcrumbs} label="Breadcrumbs" desc="Show the symbol path bar above the editor." />
      <ToggleRow className="sw-row" flagKey="gitGutter" on={gitGutter} label="Source Control Gutter" desc="Colour added/modified/deleted lines from Git." />
      <ToggleRow className="sw-row" flagKey="gitBlame" on={gitBlame} label="Inline Git Blame" desc="Show the last commit author for the cursor line." />

      {/* ── Vim Mode ── */}
      <div className="sw-row">
        <span className="sw-row__label">Vim Mode</span>
        <span className="sw-row__desc">Enable Vim keybindings (Esc, h/j/k/l, etc.)</span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{vimMode ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${vimMode ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("vim", vimMode)}
            aria-checked={vimMode}
            role="switch"
            aria-label="Toggle vim mode"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>
      </section>
    </div>
  );
};

export default EditorPage;
