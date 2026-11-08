// ── EmulatorDisclaimer ──────────────────────────────────────────────────────
// Shared footer for the emulator panels. The one-line summary is always
// visible; the full text expands in place. Keep entries factual — these panels
// drive third-party tools the user installs themselves, so the text has to be
// clear that nothing is bundled and that the vendor's licence applies.
//
// Usage:
//   <EmulatorDisclaimer summary="…" items={["…", "…"]} note="…" />
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from "react";
import { Info, ChevronDown, ChevronUp } from "lucide-react";

const s = {
  wrap: { flexShrink: 0, borderTop: "1px solid var(--bg-active)", background: "var(--bg-vscode)" },
  bar: {
    width: "100%", display: "flex", alignItems: "center", gap: "var(--space-6)",
    padding: "var(--space-5) var(--space-10)", background: "none", border: "none",
    color: "var(--text-muted)", cursor: "pointer", textAlign: "left",
    fontFamily: "var(--font-system)", fontSize: "var(--fs-mini)", lineHeight: 1.45,
  },
  label: { flexShrink: 0, fontWeight: "var(--fw-bold)", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 },
  summary: { flex: 1, minWidth: 0 },
  body: {
    maxHeight: 190, overflowY: "auto", borderTop: "1px solid var(--bg-active)",
    padding: "var(--space-8) var(--space-10)", fontSize: "var(--fs-mini)",
    lineHeight: 1.6, color: "var(--text-secondary)",
  },
  list: { margin: 0, paddingLeft: "var(--space-16, 16px)" },
  item: { marginBottom: "var(--space-4)" },
  note: { marginTop: "var(--space-6)", color: "var(--text-muted)", fontSize: "var(--fs-tiny)" },
};

const EmulatorDisclaimer = ({ label = "Disclaimer", summary, items = [], note }) => {
  const [open, setOpen] = useState(false);
  if (!summary && !items.length) return null;
  return (
    <div style={s.wrap}>
      <button
        type="button"
        style={s.bar}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Hide disclaimer" : "Read the full disclaimer"}
      >
        <Info size={12} style={{ flexShrink: 0 }} />
        <span style={s.label}>{label}</span>
        <span style={s.summary}>{summary}</span>
        {open ? <ChevronUp size={12} style={{ flexShrink: 0 }} /> : <ChevronDown size={12} style={{ flexShrink: 0 }} />}
      </button>
      {open && (
        <div style={s.body} role="region" aria-label={`${label} details`}>
          {items.length > 0 && (
            <ul style={s.list}>
              {items.map((text, i) => <li key={i} style={s.item}>{text}</li>)}
            </ul>
          )}
          {note && <div style={s.note}>{note}</div>}
        </div>
      )}
    </div>
  );
};

export default EmulatorDisclaimer;
