import React, { useState, useEffect, useCallback } from "react";

// ─── HubPage ────────────────────────────────────────────────────────────────
// Project Hub options (heatmap, onboarding) + app-data management
// (recent projects, storage reveal/clear).
// ─────────────────────────────────────────────────────────────────────────────

const HubPage = ({ settings, onSave }) => {
  const showHeatmap = settings.hubShowHeatmap !== false; // default true
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
    flash("Onboarding reset — restart par phir puchega");
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
    if (!window.confirm("Clear data for ALL projects? (pins, tabs, canvas, trash — project files safe)")) return;
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
          Hub me contribution heatmap ke liye. Onboarding me bhi manga jata hai.
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

      {/* ── Reset Onboarding ─────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Reset Onboarding</span>
        <span className="sw-row__desc">
          Welcome page dobara dikhao (username bhool jayega).
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
