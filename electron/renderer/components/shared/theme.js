// ─── theme.js — runtime bridge to the CENTRAL token sheet ───────────────────
// variables.css (electron/renderer/variables.css) is the single source of truth
// for every UI value. CSS files + inline styles consume it via var(--token).
//
// Canvas APIs (xterm.js, Excalidraw) need REAL color strings — "var(--x)" does
// NOT resolve there. Use cssVar("--token", "<same-fallback>") so even those
// APIs read from the central sheet. Fallback === current value, isliye UI
// bilkul waisa hi dikhega chahe sheet load na hui ho.
// NOTE: value creation-time par read hoti hai (terminal/excalidraw objects
// bante waqt), isliye theme switch ke baad naya panel kholne par naya value milega.

// Read one token from :root, else return the fallback literal.
export const cssVar = (name, fallback) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  } catch {}
  return fallback;
};
