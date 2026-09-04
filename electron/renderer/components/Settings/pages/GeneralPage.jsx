import React from "react";

// ─── GeneralPage ────────────────────────────────────────────────────────────
// General application settings: theme, zoom, restore behaviour, confirmations.
// ─────────────────────────────────────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: "dark",  label: "Dark (default)" },
  { value: "darkPlus", label: "Dark+" },
  { value: "light", label: "Light" },
];

const GeneralPage = ({ settings, onSave }) => {
  const theme            = settings.theme || "dark";
  const zoom             = Number.isFinite(settings.zoom) ? settings.zoom : 100;
  const restoreTabs      = settings.restoreTabs !== false; // default true
  const confirmDelete    = settings.confirmDelete !== false; // default true
  const showHiddenFiles  = settings.showHiddenFiles === true; // default false
  const autoOpenMediaViewer = settings.autoOpenMediaViewer !== false; // default true
  const telemetryEnabled = settings.telemetryEnabled === true; // default false

  const update = async (patch) => {
    await onSave(patch);
    try {
      const bc = new BroadcastChannel("app-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
  };

  const toggle = async (key, current) => update({ [key]: !current });

  return (
    <div>
      {/* ── Theme ──────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Theme</span>
        <span className="sw-row__desc">
          Color theme for the workbench. Restart may be required for some elements.
        </span>
        <select
          className="sw-select"
          value={theme}
          onChange={(e) => update({ theme: e.target.value })}
          aria-label="Theme"
        >
          {THEME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Zoom Level ─────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Zoom Level</span>
        <span className="sw-row__desc">
          Adjust the overall UI scale. 100% is the default.
        </span>
        <div className="sw-inline-row">
          <input
            type="range"
            className="sw-range"
            min={50}
            max={200}
            step={10}
            value={zoom}
            onChange={(e) => update({ zoom: parseInt(e.target.value, 10) })}
            aria-label="Zoom level"
          />
          <input
            type="number"
            className="sw-input sw-input--small"
            min={50}
            max={200}
            step={10}
            value={zoom}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) update({ zoom: Math.min(200, Math.max(50, v)) });
            }}
            aria-label="Zoom level number"
          />
          <span className="sw-inline-label">%</span>
        </div>
      </div>

      {/* ── Restore Tabs ───────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Restore Previous Session</span>
        <span className="sw-row__desc">
          Reopen editors and layout from the last session when the app starts.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{restoreTabs ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${restoreTabs ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("restoreTabs", restoreTabs)}
            aria-checked={restoreTabs}
            role="switch"
            aria-label="Toggle restore tabs"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Show Hidden Files ──────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Show Hidden Files</span>
        <span className="sw-row__desc">
          Show dotfiles and hidden folders in the Project explorer.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{showHiddenFiles ? "Visible" : "Hidden"}</span>
          <button
            className={`sw-toggle-btn${showHiddenFiles ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("showHiddenFiles", showHiddenFiles)}
            aria-checked={showHiddenFiles}
            role="switch"
            aria-label="Toggle show hidden files"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Auto Open Media Viewer ─────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Auto Open Media Viewer</span>
        <span className="sw-row__desc">
          Automatically open images, videos, PDFs and audio in the Media Viewer when clicked in the Project explorer.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{autoOpenMediaViewer ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${autoOpenMediaViewer ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("autoOpenMediaViewer", autoOpenMediaViewer)}
            aria-checked={autoOpenMediaViewer}
            role="switch"
            aria-label="Toggle auto open media viewer"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Confirm Delete ─────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Confirm Before Delete</span>
        <span className="sw-row__desc">
          Show a confirmation dialog when deleting files or folders.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{confirmDelete ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${confirmDelete ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("confirmDelete", confirmDelete)}
            aria-checked={confirmDelete}
            role="switch"
            aria-label="Toggle confirm delete"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Telemetry ──────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Telemetry</span>
        <span className="sw-row__desc">
          Allow anonymous usage data to help improve the product. No personal data is collected.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{telemetryEnabled ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${telemetryEnabled ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("telemetryEnabled", telemetryEnabled)}
            aria-checked={telemetryEnabled}
            role="switch"
            aria-label="Toggle telemetry"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>
    </div>
  );
};

export default GeneralPage;
