import React from "react";

// ─── CanvasPage ─────────────────────────────────────────────────────────────
// Excalidraw drawing canvas settings.
// ─────────────────────────────────────────────────────────────────────────────

const CanvasPage = ({ settings, onSave }) => {
  const c = settings.canvas || {};
  const pick = (key, flatKey, fallback) => {
    if (c[key] !== undefined) return c[key];
    if (settings[flatKey] !== undefined) return settings[flatKey];
    return fallback;
  };
  const theme = pick("theme", "canvasTheme", "auto"); // auto | dark | light
  const autosave = pick("autosave", "canvasAutosave", true) !== false; // default true
  // Background: black | white | grid (purana gridMode toggle migrate: true -> grid).
  let bgMode = pick("bgMode", "canvasBgMode", null);
  if (!["black", "white", "grid"].includes(bgMode)) {
    bgMode = pick("gridMode", "canvasGridMode", false) === true ? "grid" : "white";
  }

  const updateCanvas = async (patch) => {
    const nextCanvas = { ...c, ...patch };
    const flat = {};
    if ("theme" in patch) flat.canvasTheme = patch.theme;
    if ("autosave" in patch) flat.canvasAutosave = patch.autosave;
    if ("gridMode" in patch) flat.canvasGridMode = patch.gridMode;
    if ("bgMode" in patch) flat.canvasBgMode = patch.bgMode;
    await onSave({ canvas: nextCanvas, ...flat });
    try {
      const bc = new BroadcastChannel("canvas-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
  };

  return (
    <div>
      {/* ── Theme ──────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Canvas Theme</span>
        <span className="sw-row__desc">
          Drawing canvas appearance. Auto follows the app theme (light/dark).
        </span>
        <select
          className="sw-select"
          value={theme}
          onChange={(e) => updateCanvas({ theme: e.target.value })}
          aria-label="Canvas theme"
        >
          <option value="auto">Auto (follow app)</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>

      {/* ── Autosave ───────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Autosave</span>
        <span className="sw-row__desc">
          Automatically save the drawing (.excalidraw JSON) after each change. Disable to save manually with the Save button.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{autosave ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${autosave ? " sw-toggle-btn--on" : ""}`}
            onClick={() => updateCanvas({ autosave: !autosave })}
            aria-checked={autosave}
            role="switch"
            aria-label="Toggle canvas autosave"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Background ─────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Background</span>
        <span className="sw-row__desc">
          Drawing canvas background: solid black, solid white, or grid. Toolbar me bhi badal sakte ho.
        </span>
        <select
          className="sw-select"
          value={bgMode}
          onChange={(e) => updateCanvas({ bgMode: e.target.value })}
          aria-label="Canvas background"
        >
          <option value="black">Black</option>
          <option value="white">White</option>
          <option value="grid">Grid</option>
        </select>
      </div>

      {/* ── Storage note ───────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Storage</span>
        <span className="sw-row__desc">
          The scratch drawing saves per-project (drawing.excalidraw). Any .excalidraw file in your project opens in the Canvas when clicked.
        </span>
      </div>
    </div>
  );
};

export default CanvasPage;
