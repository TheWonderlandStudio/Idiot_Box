// Onboarding — 2 minimal screens: 1) "idiot box" 2) github username input.
import React, { useState, useCallback } from "react";
import CustomCursor from "../shared/CustomCursor.jsx";

const ONBOARD_CSS = `
.ob-page { position:fixed; inset:0; z-index:10000; display:flex; align-items:center; justify-content:center;
  background:var(--bg-app); font-family:var(--font-ui); cursor:pointer; }
.ob-page, .ob-page * { cursor:none !important; }
.ob-wrap { display:flex; flex-direction:column; align-items:center; text-align:center; animation:ob-step-in 0.32s ease both; }
@keyframes ob-step-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
.ob-brand { animation:ob-brand-in 0.45s ease both; }
@keyframes ob-brand-in { from { opacity:0; letter-spacing:0.1em; } to { opacity:1; } }
.ob-brand { font-size:34px; font-weight:800; color:var(--text-highlight); letter-spacing:0.28em; text-indent:0.28em; }
.ob-logo { width:96px; height:96px; border-radius:22px; object-fit:cover; margin-bottom:18px;
  box-shadow:0 8px 32px rgba(0,0,0,0.45); }
.ob-hint { margin-top:14px; font-size:12px; color:var(--text-placeholder); }
.ob-label { font-size:13px; color:var(--text-secondary); }
.ob-input { width:220px; height:34px; margin-top:12px; background:transparent; border:1px solid var(--border-strong);
  border-radius:4px; padding:0 10px; color:var(--text-input); font-family:var(--font-ui); font-size:13px;
  outline:none; box-sizing:border-box; text-align:center; }
.ob-input:focus { border-color:var(--accent); }
.ob-input::placeholder { color:var(--text-placeholder); }
.ob-skip { margin-top:12px; background:none; border:none; color:var(--text-placeholder); font-family:var(--font-ui);
  font-size:12px; cursor:pointer; }
.ob-skip:hover { color:var(--text-hover); }
`;

const OnboardingPage = ({ onDone }) => {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const saveSettings = useCallback(async (username) => {
    try {
      const s = await window.electronAPI.readSettings().catch(() => ({}));
      const next = { ...(s || {}) };
      if (username) {
        next.githubUsername = username;
        delete next.githubOnboardingDismissed;
      } else {
        next.githubOnboardingDismissed = true;
      }
      await window.electronAPI.writeSettings(next);
      try { window.__githubUsername = next.githubUsername || null; } catch {}
    } catch {}
  }, []);

  const finish = useCallback(async (username) => {
    if (saving) return;
    setSaving(true);
    await saveSettings(username);
    setSaving(false);
    try { onDone && onDone(); } catch {}
  }, [saving, saveSettings, onDone]);

  const clean = String(name || "").trim();

  if (step === 0) {
    return (
      <div className="ob-page" onClick={() => setStep(1)}>
        <style>{ONBOARD_CSS}</style>
        <CustomCursor scope=".ob-page" />
        <div className="ob-wrap" key="s0">
          <img className="ob-logo" src="assets/idot_box.png" alt="Idiot Box logo" width={96} height={96} />
          <div className="ob-brand">idiot box</div>
          <div className="ob-hint">click anywhere to continue</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-page">
      <style>{ONBOARD_CSS}</style>
      <CustomCursor scope=".ob-page" />
      <div className="ob-wrap" key="s1" onClick={(e) => e.stopPropagation()}>
        <div className="ob-label">enter your github username</div>
        <input
          className="ob-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && clean) finish(clean); }}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          disabled={saving}
        />
        <button className="ob-skip" onClick={() => finish(null)} disabled={saving}>skip</button>
      </div>
    </div>
  );
};

export default OnboardingPage;
