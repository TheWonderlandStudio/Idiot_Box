// ── EmulatorDisclaimer ──────────────────────────────────────────────────────
// Modal disclaimer shown when an emulator panel opens. These panels drive
// third-party tools the user installs themselves, so the text has to be clear
// that nothing is bundled and that the vendor's licence applies.
//
// Usage:
//   <EmulatorDisclaimer storageKey="…" title="…" summary="…" items={[…]} note="…" />
//
// Opening the panel shows the popup until the user ticks "Don't show again".
// Dispatch a window event to reopen it from a panel header button:
//   window.dispatchEvent(new CustomEvent("show-emulator-disclaimer", { detail: { key } }))
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";

const s = {
  overlay: {
    position: "fixed", inset: 0, zIndex: "var(--z-dialog, 10000)",
    background: "var(--overlay, rgba(0,0,0,.6))",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "var(--space-20, 20px)",
  },
  box: {
    background: "var(--bg-raised, #252525)",
    border: "1px solid var(--border-light, #3a3a3a)",
    borderRadius: "var(--radius-lg, 8px)",
    boxShadow: "var(--shadow-modal, 0 20px 60px rgba(0,0,0,.55))",
    width: "100%", maxWidth: 600, maxHeight: "84vh",
    display: "flex", flexDirection: "column", overflow: "hidden",
    fontFamily: "var(--font-system)", color: "var(--text-bright, #ccc)",
  },
  head: {
    display: "flex", alignItems: "center", gap: "var(--space-8)",
    padding: "var(--space-14, 14px) var(--space-16, 16px)",
    borderBottom: "1px solid var(--border-row, #232323)", flexShrink: 0,
  },
  title: { flex: 1, minWidth: 0, fontSize: "var(--fs-body-plus, 14px)", fontWeight: "var(--fw-bold, 700)", color: "var(--text-input, #e0e0e0)" },
  iconBtn: { background: "none", border: "none", color: "var(--text-secondary, #999)", cursor: "pointer", padding: 2, display: "flex" },
  body: {
    flex: 1, minHeight: 0, overflowY: "auto",
    padding: "var(--space-14, 14px) var(--space-16, 16px)",
    fontSize: "var(--fs-small-plus, 13px)", lineHeight: 1.65,
    color: "var(--text-secondary, #999)",
  },
  summary: { marginBottom: "var(--space-10, 10px)", color: "var(--text-primary, #c8c8c8)", fontSize: "var(--fs-body, 13px)", lineHeight: 1.6 },
  list: { margin: 0, paddingLeft: 18 },
  item: { marginBottom: "var(--space-6, 6px)" },
  note: { marginTop: "var(--space-10, 10px)", color: "var(--text-muted, #666)", fontSize: "var(--fs-mini, 11px)", lineHeight: 1.5 },
  foot: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-10, 10px)",
    padding: "var(--space-10, 10px) var(--space-16, 16px)",
    borderTop: "1px solid var(--border-row, #232323)", flexShrink: 0,
  },
  check: { display: "flex", alignItems: "center", gap: "var(--space-6, 6px)", fontSize: "var(--fs-small, 12px)", color: "var(--text-secondary, #999)", cursor: "pointer", userSelect: "none" },
  ack: {
    background: "var(--editor-blue, #0e639c)", border: "1px solid var(--editor-blue, #0e639c)",
    color: "var(--text-inverse, #fff)", borderRadius: "var(--radius-md, 6px)",
    padding: "var(--space-6, 6px) var(--space-16, 16px)", fontSize: "var(--fs-small-plus, 13px)",
    fontWeight: "var(--fw-bold, 700)", cursor: "pointer", flexShrink: 0,
  },
};

const EmulatorDisclaimer = ({ storageKey, title = "Disclaimer", summary, items = [], note }) => {
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    let acknowledged = false;
    try { acknowledged = !!storageKey && localStorage.getItem(storageKey) === "1"; } catch {}
    setOpen(!acknowledged);
  }, [storageKey]);

  // Panel header "Disclaimer" buttons reopen the popup through this event.
  useEffect(() => {
    const onShow = (e) => {
      const key = e?.detail?.key;
      if (!key || !storageKey || key === storageKey) { setDontShowAgain(false); setOpen(true); }
    };
    window.addEventListener("show-emulator-disclaimer", onShow);
    return () => window.removeEventListener("show-emulator-disclaimer", onShow);
  }, [storageKey]);

  const close = useCallback(() => {
    if (dontShowAgain && storageKey) {
      try { localStorage.setItem(storageKey, "1"); } catch {}
    }
    setOpen(false);
  }, [dontShowAgain, storageKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open) return null;
  return createPortal(
    <div style={s.overlay} role="presentation">
      <div style={s.box} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div style={s.head}>
          <Info size={15} style={{ flexShrink: 0, color: "var(--warn-gold, #d7ba7d)" }} />
          <div style={s.title}>{title}</div>
          <button type="button" style={s.iconBtn} title="Close" aria-label="Close disclaimer" onClick={close}><X size={15} /></button>
        </div>
        <div style={s.body}>
          {summary && <div style={s.summary}>{summary}</div>}
          {items.length > 0 && (
            <ul style={s.list}>
              {items.map((text, i) => <li key={i} style={s.item}>{text}</li>)}
            </ul>
          )}
          {note && <div style={s.note}>{note}</div>}
        </div>
        <div style={s.foot}>
          <label style={s.check}>
            <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
            Don't show again
          </label>
          <button type="button" style={s.ack} onClick={close}>I understand</button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default EmulatorDisclaimer;
