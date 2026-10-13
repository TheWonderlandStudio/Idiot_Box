// ─── theme.js — runtime bridge to the CENTRAL token sheet ───────────────────
// variables.css (electron/renderer/variables.css) is the single source of truth
// for every UI value. CSS files + inline styles consume it via var(--token).
//
// Canvas APIs (xterm.js, Excalidraw) need REAL color strings — "var(--x)" does
// NOT resolve there. Use cssVar("--token", "<same-fallback>") so even those
// APIs read from the central sheet. The fallback equals the current value, so the UI
// looks exactly the same even if the sheet has not loaded.
// NOTE: the value is read at creation time (when terminal/excalidraw objects
// are created), so a new panel opened after a theme switch gets the new value.

// Read one token from :root, else return the fallback literal.
export const cssVar = (name, fallback) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  } catch {}
  return fallback;
};
