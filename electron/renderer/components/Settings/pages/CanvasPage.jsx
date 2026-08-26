import React from "react";

// ─── CanvasPage ─────────────────────────────────────────────────────────────
// Visual project map (Canvas) settings.
// ─────────────────────────────────────────────────────────────────────────────

const CanvasPage = ({ settings, onSave }) => {
  const c = settings.canvas || {};
  const autoLayout   = c.autoLayout !== false && settings.canvasAutoLayout !== false; // default true
  const showPreview  = c.showPreview !== false && settings.canvasShowPreview !== false; // default true
  const gridSnap     = c.gridSnap === true || settings.canvasGridSnap === true; // default false
  const showMinimap  = c.showMinimap !== false && settings.canvasShowMinimap !== false; // default true
  const maxCols      = Number.isFinite(c.maxCols) ? c.maxCols : Number.isFinite(settings.canvasMaxCols) ? settings.canvasMaxCols : 4;
  const cardWidth    = Number.isFinite(c.cardWidth) ? c.cardWidth : Number.isFinite(settings.canvasCardWidth) ? settings.canvasCardWidth : 280;
  const cardHeight   = Number.isFinite(c.cardHeight) ? c.cardHeight : Number.isFinite(settings.canvasCardHeight) ? settings.canvasCardHeight : 200;

  const updateCanvas = async (patch) => {
    const nextCanvas = { ...c, ...patch };
    const flat = {};
    if ("autoLayout" in patch) flat.canvasAutoLayout = patch.autoLayout;
    if ("showPreview" in patch) flat.canvasShowPreview = patch.showPreview;
    if ("gridSnap" in patch) flat.canvasGridSnap = patch.gridSnap;
    if ("showMinimap" in patch) flat.canvasShowMinimap = patch.showMinimap;
    if ("maxCols" in patch) flat.canvasMaxCols = patch.maxCols;
    if ("cardWidth" in patch) flat.canvasCardWidth = patch.cardWidth;
    if ("cardHeight" in patch) flat.canvasCardHeight = patch.cardHeight;
    await onSave({ canvas: nextCanvas, ...flat });
    try {
      const bc = new BroadcastChannel("canvas-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
  };

  const toggle = (key, current) => updateCanvas({ [key]: !current });

  return (
    <div>
      {/* ── Auto Layout ────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Auto Layout</span>
        <span className="sw-row__desc">
          Automatically arrange groups and cards when the project is scanned. Disable to keep manual positions only.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{autoLayout ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${autoLayout ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("autoLayout", autoLayout)}
            aria-checked={autoLayout}
            role="switch"
            aria-label="Toggle auto layout"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Show Preview ───────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Live Preview</span>
        <span className="sw-row__desc">
          Render a live preview of each component inside its card. Disable to show file names only for faster loading.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{showPreview ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${showPreview ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("showPreview", showPreview)}
            aria-checked={showPreview}
            role="switch"
            aria-label="Toggle show preview"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Grid Snap ──────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Snap to Grid</span>
        <span className="sw-row__desc">
          Snap cards and groups to a grid when dragging.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{gridSnap ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${gridSnap ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("gridSnap", gridSnap)}
            aria-checked={gridSnap}
            role="switch"
            aria-label="Toggle grid snap"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Show Minimap ───────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Show Minimap</span>
        <span className="sw-row__desc">
          Show a minimap/overview of the canvas for quick navigation.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{showMinimap ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${showMinimap ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("showMinimap", showMinimap)}
            aria-checked={showMinimap}
            role="switch"
            aria-label="Toggle canvas minimap"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Max Columns ────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Max Columns</span>
        <span className="sw-row__desc">
          Maximum number of cards per row when auto layout is enabled.
        </span>
        <select
          className="sw-select"
          value={maxCols}
          onChange={(e) => updateCanvas({ maxCols: parseInt(e.target.value, 10) })}
          aria-label="Max columns"
        >
          <option value={2}>2 columns</option>
          <option value={3}>3 columns</option>
          <option value={4}>4 columns</option>
          <option value={6}>6 columns</option>
        </select>
      </div>

      {/* ── Card Size ──────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Default Card Size</span>
        <span className="sw-row__desc">
          Default width and height for new canvas cards. Existing cards keep their manual size.
        </span>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-label)" }}>
            W
            <input
              type="number"
              className="sw-input sw-input--small"
              min={180}
              max={600}
              step={10}
              value={cardWidth}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v)) updateCanvas({ cardWidth: Math.min(600, Math.max(180, v)) });
              }}
              aria-label="Card width"
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-label)" }}>
            H
            <input
              type="number"
              className="sw-input sw-input--small"
              min={140}
              max={500}
              step={10}
              value={cardHeight}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v)) updateCanvas({ cardHeight: Math.min(500, Math.max(140, v)) });
              }}
              aria-label="Card height"
            />
          </label>
          <span className="sw-inline-label">px</span>
        </div>
      </div>
    </div>
  );
};

export default CanvasPage;
