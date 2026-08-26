import React from "react";

// ─── GitPage ────────────────────────────────────────────────────────────────
// Source control settings: auto fetch, gutter, confirmations, etc.
// ─────────────────────────────────────────────────────────────────────────────

const GitPage = ({ settings, onSave }) => {
  const g = settings.git || {};
  const autoFetch      = g.autoFetch === true || settings.gitAutoFetch === true; // default false
  const showGutter     = g.showGutter !== false && settings.gitShowGutter !== false; // default true
  const confirmCommit  = g.confirmCommit !== false && settings.gitConfirmCommit !== false; // default true
  const enableGutter   = g.enableGutter !== false && settings.gitEnableGutter !== false; // alias for showGutter
  const autoStash      = g.autoStash === true || settings.gitAutoStash === true; // default false
  const showInlineBlame= g.showInlineBlame === true || settings.gitShowInlineBlame === true; // default false

  const updateGit = async (patch) => {
    const nextGit = { ...g, ...patch };
    const flat = {};
    if ("autoFetch" in patch) flat.gitAutoFetch = patch.autoFetch;
    if ("showGutter" in patch) flat.gitShowGutter = patch.showGutter;
    if ("enableGutter" in patch) flat.gitEnableGutter = patch.enableGutter;
    if ("confirmCommit" in patch) flat.gitConfirmCommit = patch.confirmCommit;
    if ("autoStash" in patch) flat.gitAutoStash = patch.autoStash;
    if ("showInlineBlame" in patch) flat.gitShowInlineBlame = patch.showInlineBlame;
    await onSave({ git: nextGit, ...flat });
    try {
      const bc = new BroadcastChannel("git-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
  };

  const toggle = (key, current) => updateGit({ [key]: !current });

  return (
    <div>
      {/* ── Auto Fetch ─────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Auto Fetch</span>
        <span className="sw-row__desc">
          Automatically fetch from remotes in the background every few minutes.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{autoFetch ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${autoFetch ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("autoFetch", autoFetch)}
            aria-checked={autoFetch}
            role="switch"
            aria-label="Toggle auto fetch"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Show Git Gutter ────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Show Git Gutter</span>
        <span className="sw-row__desc">
          Show added/modified/deleted indicators in the editor gutter.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{showGutter && enableGutter ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${(showGutter && enableGutter) ? " sw-toggle-btn--on" : ""}`}
            onClick={() => {
              const next = !(showGutter && enableGutter);
              updateGit({ showGutter: next, enableGutter: next });
            }}
            aria-checked={showGutter && enableGutter}
            role="switch"
            aria-label="Toggle git gutter"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Confirm Commit ─────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Confirm Before Commit</span>
        <span className="sw-row__desc">
          Require confirmation when committing without a message or with no staged changes.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{confirmCommit ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${confirmCommit ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("confirmCommit", confirmCommit)}
            aria-checked={confirmCommit}
            role="switch"
            aria-label="Toggle confirm commit"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Auto Stash ─────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Auto Stash on Pull</span>
        <span className="sw-row__desc">
          Automatically stash and reapply local changes when pulling.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{autoStash ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${autoStash ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("autoStash", autoStash)}
            aria-checked={autoStash}
            role="switch"
            aria-label="Toggle auto stash"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Inline Blame ───────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Inline Blame</span>
        <span className="sw-row__desc">
          Show the last commit author and message inline at the end of the current line.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{showInlineBlame ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${showInlineBlame ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle("showInlineBlame", showInlineBlame)}
            aria-checked={showInlineBlame}
            role="switch"
            aria-label="Toggle inline blame"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Info ───────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">About Git Integration</span>
        <span className="sw-row__desc">
          Idiot Box uses your system Git installation. Ensure <code style={{ background: "#2a2a2a", padding: "1px 4px", borderRadius: 3 }}>git</code> is available on PATH for full functionality.
        </span>
      </div>
    </div>
  );
};

export default GitPage;
