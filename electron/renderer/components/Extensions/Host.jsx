// Extension host ke renderer-side endpoints: status-bar items + notification
// toasts. Dono main process ke ext:changed / ext:notify events se live rehte hain.
import React, { useEffect, useState, useCallback } from "react";

// ── Status bar items (extension ne jo banaye) ──────────────────────────────
export const ExtStatusItems = () => {
  const [items, setItems] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const res = await window.electronAPI?.extStatusItems?.();
      setItems(Array.isArray(res) ? res : []);
    } catch { setItems([]); }
  }, []);

  useEffect(() => {
    refresh();
    const un = window.electronAPI?.onExtChanged?.(refresh);
    return () => { try { un && un(); } catch {} };
  }, [refresh]);

  if (!items.length) return null;
  return (
    <>
      {items.map((it) => (
        <button
          key={it.key}
          title={it.tooltip || it.extName}
          onClick={() => { if (it.command) { try { window.electronAPI.extInvoke(it.command); } catch {} } }}
          style={{
            background: "var(--white-a12)", border: "none", borderRadius: "var(--radius-sm)",
            color: "var(--text-inverse)", fontSize: "var(--fs-mini)", letterSpacing: "0.02em",
            padding: "var(--space-2) var(--space-8)", cursor: it.command ? "pointer" : "default",
            display: "flex", alignItems: "center", gap: "var(--space-4)", maxWidth: 220,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {it.text}
        </button>
      ))}
    </>
  );
};

// ── Notification toasts (ibox.window.showMessage / show*Message) ───────────
const MAX_TOASTS = 4;
const AUTO_DISMISS_MS = 5000;

export const ExtToasts = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const un = window.electronAPI?.onExtNotify?.((payload) => {
      if (!payload || !payload.message) return;
      const id = Date.now() + ":" + Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, type: payload.type || "info", text: payload.message }].slice(-MAX_TOASTS));
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), AUTO_DISMISS_MS);
    });
    return () => { try { un && un(); } catch {} };
  }, []);

  if (!toasts.length) return null;

  const colors = {
    info: { bg: "var(--bg-vscode)", border: "var(--border-light)", fg: "var(--text-bright)" },
    warn: { bg: "var(--bg-vscode)", border: "var(--warn-gold)", fg: "var(--warn-gold)" },
    error: { bg: "var(--error-bg-solid)", border: "var(--error-border-3)", fg: "var(--error-text-soft)" },
  };

  return (
    <div style={{ position: "fixed", right: "var(--space-14)", bottom: 46, zIndex: 9999, display: "flex", flexDirection: "column", gap: "var(--space-8)", pointerEvents: "none", maxWidth: 380 }}>
      {toasts.map((t) => {
        const c = colors[t.type] || colors.info;
        return (
          <div key={t.id} style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.fg, borderRadius: "var(--radius-md)", padding: "var(--space-8) var(--space-12)", fontSize: "var(--fs-small)", boxShadow: "var(--shadow-float)", lineHeight: 1.5 }}>
            {t.text}
          </div>
        );
      })}
    </div>
  );
};
