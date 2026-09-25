import React, { useState, useEffect, useCallback } from "react";

// ─── HubPage ────────────────────────────────────────────────────────────────
// Project Hub options (heatmap, onboarding) + app-data management
// (recent projects, storage reveal/clear).
// ─────────────────────────────────────────────────────────────────────────────

const HubPage = ({ settings, onSave }) => {
  const showHeatmap = settings.hubShowHeatmap !== false; // default true
  const customCursor = settings.hubCustomCursor !== false; // default true (smart cursor)
  const clickSound = settings.hubClickSound !== false; // default true
  const wallOpacity = Number(settings.hubWallpaperOpacity ?? 94);
  const [username, setUsername] = useState(settings.githubUsername || "");
  const [recentCount, setRecentCount] = useState(null);
  const [storedCount, setStoredCount] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  // settings load hone ke baad input sync (pehle render me {} hota hai)
  useEffect(() => {
    if (settings.githubUsername !== undefined) setUsername(settings.githubUsername || "");
  }, [settings.githubUsername]);

  const update = async (patch) => {
    await onSave(patch);
    try {
      const bc = new BroadcastChannel("app-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
  };

  const refreshCounts = useCallback(async () => {
    try {
      const r = await window.electronAPI.projectLoadRecent().catch(() => null);
      if (r && r.ok) setRecentCount((r.recent || []).length);
    } catch {}
    try {
      const list = await window.electronAPI.listAllProjectStorages().catch(() => null);
      if (Array.isArray(list)) setStoredCount(list.length);
    } catch {}
  }, []);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  const flash = (text, isError) => {
    setMsg({ text, isError: !!isError });
    setTimeout(() => setMsg(null), 3500);
  };

  const saveUsername = async () => {
    const v = String(username || "").trim();
    await update({ githubUsername: v });
    try { window.__githubUsername = v || null; } catch {}
    flash(v ? `GitHub username saved: ${v}` : "GitHub username cleared");
  };

  const resetOnboarding = async () => {
    // keys null → Hub dobara onboarding dikhayega (falsy check)
    await update({ githubUsername: null, githubOnboardingDismissed: null });
    try { window.__githubUsername = null; } catch {}
    setUsername("");
    flash("Onboarding reset — it will ask again on restart");
  };

  const clearRecents = async () => {
    let list = [];
    try {
      const r = await window.electronAPI.projectLoadRecent();
      if (r && r.ok) list = (r.recent || []).map((e) => (typeof e === "string" ? e : e?.path)).filter(Boolean);
    } catch {}
    if (!list.length) { flash("Recent list already empty"); return; }
    if (!window.confirm(`Clear ${list.length} recent project(s)?`)) return;
    setBusy("recents");
    try {
      for (const p of list) {
        try { await window.electronAPI.projectRemoveRecent(p); } catch {}
      }
      flash(`Cleared ${list.length} recent project(s)`);
    } catch {
      flash("Failed to clear recents", true);
    } finally {
      setBusy(null);
      refreshCounts();
    }
  };

  const revealStorage = async () => {
    try {
      const r = await window.electronAPI.revealAllStorages();
      if (r?.ok === false) flash(r.error || "Failed to open folder", true);
    } catch (e) {
      flash(e?.message || "Failed to open folder", true);
    }
  };

  const clearAllStorage = async () => {
    if (!window.confirm("Clear data for ALL projects? (pins, tabs, canvas — project files safe)")) return;
    setBusy("storage");
    try {
      const r = await window.electronAPI.clearAllProjectsStorage();
      if (r?.ok === false) throw new Error(r.error);
      flash("All projects storage cleared");
    } catch (e) {
      flash(e?.message || "Failed to clear storage", true);
    } finally {
      setBusy(null);
      refreshCounts();
    }
  };

  return (
    <div>
      {/* ── GitHub Username ──────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">GitHub Username</span>
        <span className="sw-row__desc">
          For the contribution heatmap in Hub. Also asked during onboarding.
        </span>
        <div className="sw-inline-row">
          <input
            type="text"
            className="sw-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveUsername(); }}
            placeholder="e.g. torvalds"
            autoComplete="off"
            spellCheck={false}
            aria-label="GitHub username"
          />
          <button className="sw-btn" onClick={saveUsername}>Save</button>
        </div>
      </div>

      {/* ── Show Heatmap ─────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Contribution Heatmap</span>
        <span className="sw-row__desc">
          Project Hub me GitHub contribution graph dikhao.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{showHeatmap ? "Visible" : "Hidden"}</span>
          <button
            className={`sw-toggle-btn${showHeatmap ? " sw-toggle-btn--on" : ""}`}
            onClick={() => update({ hubShowHeatmap: !showHeatmap })}
            aria-checked={showHeatmap}
            role="switch"
            aria-label="Toggle heatmap"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Custom Cursor ────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Custom Cursor</span>
        <span className="sw-row__desc">
          Smart custom cursor in Hub. Turn off for the normal OS cursor.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{customCursor ? "Custom" : "Default OS"}</span>
          <button
            className={`sw-toggle-btn${customCursor ? " sw-toggle-btn--on" : ""}`}
            onClick={() => update({ hubCustomCursor: !customCursor })}
            aria-checked={customCursor}
            role="switch"
            aria-label="Toggle custom cursor"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Click Sounds ─────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Click Sounds</span>
        <span className="sw-row__desc">
          Soft click sound on Hub buttons. Turn off to stay silent.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{clickSound ? "On" : "Off"}</span>
          <button
            className={`sw-toggle-btn${clickSound ? " sw-toggle-btn--on" : ""}`}
            onClick={() => update({ hubClickSound: !clickSound })}
            aria-checked={clickSound}
            role="switch"
            aria-label="Toggle click sounds"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Wallpaper Opacity ──────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Wallpaper Opacity</span>
        <span className="sw-row__desc">
          How solid Hub panels stay when a wallpaper is set (100 = fully solid, lower = more transparent).
        </span>
        <div className="sw-inline-row">
          <input
            type="range"
            className="sw-range"
            min={20}
            max={100}
            step={1}
            value={Number.isFinite(wallOpacity) ? wallOpacity : 94}
            onChange={(e) => update({ hubWallpaperOpacity: parseInt(e.target.value, 10) })}
            aria-label="Wallpaper opacity"
          />
          <input
            type="number"
            className="sw-input sw-input--small"
            min={20}
            max={100}
            step={1}
            value={Number.isFinite(wallOpacity) ? wallOpacity : 94}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) update({ hubWallpaperOpacity: Math.min(100, Math.max(20, v)) });
            }}
            aria-label="Wallpaper opacity number"
          />
        </div>
      </div>

      {/* ── Reset Onboarding ─────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Reset Onboarding</span>
        <span className="sw-row__desc">
          Show the welcome page again (forgets the username).
        </span>
        <button className="sw-btn" onClick={resetOnboarding}>Reset</button>
      </div>

      {/* ── Recent Projects ──────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Recent Projects</span>
        <span className="sw-row__desc">
          {recentCount === null ? "Hub ki recent list." : `${recentCount} project(s) in recent list.`}
        </span>
        <button
          className="sw-btn sw-btn--danger"
          onClick={clearRecents}
          disabled={busy === "recents" || recentCount === 0}
        >
          {busy === "recents" ? "Clearing…" : "Clear Recents"}
        </button>
      </div>

      {/* ── App Storage ──────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Main Storage Folder</span>
        <span className="sw-row__desc">
          {storedCount === null
            ? "Saare projects ka app data (userData/projects)."
            : `${storedCount} project(s) ka data stored hai.`}
        </span>
        <div className="sw-inline-row">
          <button className="sw-btn" onClick={revealStorage}>Open Folder</button>
          <button
            className="sw-btn sw-btn--danger"
            onClick={clearAllStorage}
            disabled={busy === "storage"}
          >
            {busy === "storage" ? "Clearing…" : "Clear All Data"}
          </button>
        </div>
      </div>

      {msg && (
        <div style={{
          marginTop: "var(--space-8)", padding: "7px var(--space-10)",
          background: msg.isError ? "var(--error-bg-solid)" : "var(--success-bg)",
          border: "1px solid " + (msg.isError ? "var(--error-border-3)" : "var(--success-border-2)"),
          borderRadius: "var(--radius-md)",
          color: msg.isError ? "var(--error-text-soft)" : "var(--teal)",
          fontSize: "var(--fs-small)",
        }}>
          {msg.text}
        </div>
      )}
    </div>
  );
};

export default HubPage;
