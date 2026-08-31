import React from "react";

// ─── EditorPage ───────────────────────────────────────────────────────────────
// Editor-specific settings: Minimap, Word Wrap, Font, Tab Size, Line Numbers, Auto Save.
// ─────────────────────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  "Consolas",
  "Cascadia Code",
  "Fira Code",
  "JetBrains Mono",
  "Courier New",
  "monospace",
];

const TAB_OPTIONS = [2, 4, 6, 8];

const THEME_OPTIONS = [
  { value: "dark",       label: "Dark (Visual Studio Dark)" },
  { value: "darkPlus",   label: "Dark+" },
  { value: "darkModern", label: "Dark Modern" },
  { value: "dark2026",   label: "Dark 2026" },
  { value: "light",      label: "Light (Visual Studio Light)" },
  { value: "lightPlus",  label: "Light+" },
  { value: "lightModern",label: "Light Modern" },
  { value: "light2026",  label: "Light 2026" },
  { value: "hcDark",     label: "High Contrast Dark" },
  { value: "hcLight",    label: "High Contrast Light" },
];

const EditorPage = ({ settings, onSave }) => {
  const minimap     = settings.minimap  !== false; // default true
  const wordWrap    = settings.wordWrap !== false; // default true ("on")
  const lineNumbers = settings.lineNumbers !== false; // default true (on)
  const autoSave    = settings.autoSave === true || settings.autoSave === "afterDelay"; // default false
  const fontSize    = Number.isFinite(settings.fontSize) ? settings.fontSize : 13;
  const fontFamily  = settings.fontFamily || "Consolas";
  const tabSize     = Number.isFinite(settings.tabSize) ? settings.tabSize : 2;
  const editorTheme = settings.editorTheme || settings.theme || "dark"; // default dark

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

  const toggle = async (key, currentVal) => {
    const next = !currentVal;
    await onSave({ [key]: next });
    broadcast({ [key]: next });
  };

  const updateValue = async (key, value) => {
    await onSave({ [key]: value });
    broadcast({ [key]: value });
  };

  const handleFontSizeChange = async (e) => {
    let v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) return;
    v = Math.min(32, Math.max(8, v));
    await updateValue("fontSize", v);
  };

  const handleFontFamilyChange = async (e) => {
    await updateValue("fontFamily", e.target.value);
  };

  const handleTabSizeChange = async (e) => {
    const v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) return;
    await updateValue("tabSize", v);
  };

  return (
    <div>
      {/* ── Minimap ──────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Minimap</span>
        <span className="sw-row__desc">
          Show the minimap scrollbar overview on the right side of the editor.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{minimap ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${minimap ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("minimap", minimap)}
            aria-checked={minimap}
            role="switch"
            aria-label="Toggle minimap"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Word Wrap ─────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Word Wrap</span>
        <span className="sw-row__desc">
          Wrap long lines in the editor instead of scrolling horizontally.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{wordWrap ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${wordWrap ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("wordWrap", wordWrap)}
            aria-checked={wordWrap}
            role="switch"
            aria-label="Toggle word wrap"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Line Numbers ─────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Line Numbers</span>
        <span className="sw-row__desc">
          Show line numbers in the gutter. Disable to maximize horizontal space.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{lineNumbers ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${lineNumbers ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("lineNumbers", lineNumbers)}
            aria-checked={lineNumbers}
            role="switch"
            aria-label="Toggle line numbers"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Auto Save ────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Auto Save</span>
        <span className="sw-row__desc">
          Automatically save files after a short delay when you stop typing. When disabled, use Ctrl+S to save.
        </span>
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

      {/* ── Theme ──────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Theme</span>
        <span className="sw-row__desc">
          Color theme for the editor. Default is Dark. Changes apply instantly.
        </span>
        <select
          className="sw-select"
          value={editorTheme}
          onChange={(e) => updateValue("editorTheme", e.target.value)}
          aria-label="Editor theme"
        >
          {THEME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Font Family ──────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Font Family</span>
        <span className="sw-row__desc">
          Font used in the editor. Falls back to monospace if not available.
        </span>
        <select
          className="sw-select"
          value={fontFamily}
          onChange={handleFontFamilyChange}
          aria-label="Font family"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* ── Font Size ────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Font Size</span>
        <span className="sw-row__desc">
          Font size in pixels for the editor. Range 8–32.
        </span>
        <div className="sw-inline-row">
          <input
            type="range"
            className="sw-range"
            min={8}
            max={32}
            step={1}
            value={fontSize}
            onChange={handleFontSizeChange}
            aria-label="Font size"
          />
          <input
            type="number"
            className="sw-input sw-input--small"
            min={8}
            max={32}
            value={fontSize}
            onChange={handleFontSizeChange}
            aria-label="Font size number"
          />
          <span className="sw-inline-label">px</span>
        </div>
      </div>

      {/* ── Tab Size ─────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Tab Size</span>
        <span className="sw-row__desc">
          Number of spaces used for indentation when Tab is pressed.
        </span>
        <select
          className="sw-select"
          value={tabSize}
          onChange={handleTabSizeChange}
          aria-label="Tab size"
        >
          {TAB_OPTIONS.map((n) => (
            <option key={n} value={n}>{n} spaces</option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default EditorPage;
