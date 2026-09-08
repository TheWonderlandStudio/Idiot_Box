import React, { useEffect, useState, useCallback } from "react";

// ─── ExtensionsPage ───────────────────────────────────────────────────────────
// Manage loaded Chrome extensions: list, enable/disable, remove, load new.
// ─────────────────────────────────────────────────────────────────────────────

const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/";

const ExtensionsPage = () => {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI.listChromeExtensions();
      setList(res || []);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const loadNew = async () => {
    const res = await window.electronAPI.loadChromeExtension();
    if (res?.error) setError(res.error);
    else refresh();
  };

  const openStore = async () => {
    setError("");
    try {
      if (window.electronAPI?.openUrl) await window.electronAPI.openUrl(CHROME_WEB_STORE_URL);
      else window.open(CHROME_WEB_STORE_URL, "_blank", "noopener");
    } catch (e) {
      try { window.open(CHROME_WEB_STORE_URL, "_blank", "noopener"); } catch { setError(String(e)); }
    }
  };

  const toggleEnabled = async (ext) => {
    setBusyId(ext.id);
    setError("");
    const res = await window.electronAPI.setChromeExtensionEnabled(ext.id, !ext.enabled);
    if (res?.error) setError(res.error);
    else refresh();
    setBusyId("");
  };

  const removeExt = async (ext) => {
    setBusyId(ext.id);
    setError("");
    await window.electronAPI.removeChromeExtension(ext.id);
    refresh();
    setBusyId("");
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-12)" }}>
        <span className="sw-row__desc" style={{ margin: 0 }}>
          Chrome extensions loaded into the browser. Installed paths are kept in userData and auto-loaded on startup.
        </span>
        <button className="sw-btn" onClick={loadNew} style={{ marginLeft: "var(--space-12)", flexShrink: 0 }}>
          + Load Extension
        </button>
      </div>

      <div
        className="sw-row"
        style={{ alignItems: "center", border: "1px solid var(--ext-active-border)", background: "var(--teal-a06)", marginBottom: "var(--space-12)" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="sw-row__label" style={{ marginBottom: "var(--space-2)" }}>Get more extensions</span>
          <div className="sw-row__desc" style={{ margin: 0 }}>
            Download extensions from the Chrome Web Store, extract them to a folder, then click &ldquo;Load Extension&rdquo; and pick the unpacked folder (the one with manifest.json).
          </div>
        </div>
        <button className="sw-btn" onClick={openStore} style={{ flexShrink: 0, marginLeft: "var(--space-8)" }}>
          Open Chrome Web Store
        </button>
      </div>

      {error && <div style={{ color: "var(--error-muted)", fontSize: "var(--fs-body)", marginBottom: "var(--space-10)" }}>{error}</div>}

      {loading ? (
        <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-body)" }}>Loading...</div>
      ) : list.length === 0 ? (
        <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-body)", padding: "var(--space-16)", border: "var(--space-1) dashed var(--border)", borderRadius: "var(--radius-lg)" }}>
          No extensions installed. Click "Load Extension" and pick an unpacked extension folder
          (e.g. a folder with manifest.json), or use File &rarr; Load Extension&hellip; from the main window.
        </div>
      ) : (
        list.map((ext) => (
          <div
            key={ext.id}
            className="sw-row"
            style={{ opacity: ext.enabled ? 1 : 0.55, alignItems: "center" }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="sw-row__label" style={{ marginBottom: "var(--space-2)" }}>{ext.name}</span>
              <div className="sw-row__desc" style={{ margin: 0 }}>
                v{ext.version} &middot; {ext.id}
                {ext.description ? ` — ${ext.description.slice(0, 90)}` : ""}
              </div>
              {ext.path && (
                <div className="sw-row__desc" style={{ margin: 0, color: "var(--icon-muted)", fontSize: "var(--fs-tiny)", wordBreak: "break-all" }}>
                  {ext.path}
                </div>
              )}
            </div>

            <label className="sw-toggle-row" style={{ flexShrink: 0 }}>
              <span className="sw-toggle-label" style={{ minWidth: 64 }}>
                {busyId === ext.id ? "..." : ext.enabled ? "Enabled" : "Disabled"}
              </span>
              <button
                className={`sw-toggle-btn${ext.enabled ? " sw-toggle-btn--on" : ""}`}
                onClick={() => toggleEnabled(ext)}
                disabled={busyId === ext.id}
                aria-checked={ext.enabled}
                role="switch"
                aria-label={`Toggle ${ext.name}`}
              >
                <span className="sw-toggle-thumb" />
              </button>
            </label>

            <button
              className="sw-btn sw-btn--danger"
              onClick={() => removeExt(ext)}
              disabled={busyId === ext.id}
              style={{ flexShrink: 0, marginLeft: "var(--space-8)" }}
            >
              Remove
            </button>
          </div>
        ))
      )}
    </div>
  );
};

export default ExtensionsPage;