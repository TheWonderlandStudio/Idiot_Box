import React, { useState, useEffect, useMemo, useRef } from "react";
import { RotateCcw, Pencil, Check, X, AlertTriangle } from "lucide-react";
import { COMMANDS as REGISTRY, displayKey, effectiveBinding, eventToKey, isSafeBareKey, normalizeKeyForCompare } from "../../../appCommands.js";

// ─── KeybindingsPage ────────────────────────────────────────────────────────
// Fully editable keyboard shortcuts. Overrides are stored in settings.json
// under "keybindings" as { commandId: "Ctrl+Shift+P" | "" }.
// Native menu accelerators are rebuilt by the main process after saving.
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ["General", "Search", "Testing", "Debug", "Run", "File", "Edit", "Editor", "View", "Terminal", "Git"];

const KeybindingsPage = () => {
  const [filter, setFilter] = useState("");
  const [overrides, setOverrides] = useState({});
  const [recordingId, setRecordingId] = useState(null);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const toastTimer = useRef(null);

  const flash = (msg, kind = "ok") => {
    setToast({ msg, kind });
    try { clearTimeout(toastTimer.current); } catch {}
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  // Load + live-sync from settings.json
  useEffect(() => {
    let alive = true;
    const apply = (data) => {
      if (!alive || !data || typeof data !== "object") return;
      if (!("keybindings" in data)) return;
      setOverrides(data.keybindings && typeof data.keybindings === "object" ? data.keybindings : {});
    };
    (async () => {
      try { apply(await window.electronAPI.readSettings()); } catch {}
    })();
    const off = window.electronAPI?.onSettingsUpdated?.(apply);
    return () => { alive = false; try { off && off(); } catch {} try { clearTimeout(toastTimer.current); } catch {} };
  }, []);

  const persist = async (next) => {
    setOverrides(next);
    setSaving(true);
    try {
      const cur = (await window.electronAPI.readSettings()) || {};
      await window.electronAPI.writeSettings({ ...cur, keybindings: next });
    } catch (e) {
      flash(`Could not save keybindings: ${e?.message || e}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const changeBinding = async (id, key) => {
    const next = { ...overrides };
    const def = REGISTRY.find((c) => c.id === id)?.default || "";
    if (key === null || key === def) delete next[id];
    else next[id] = key;
    await persist(next);
    setRecordingId(null);
    flash(key ? `${REGISTRY.find((c) => c.id === id)?.title || id} → ${displayKey(key)}` : "Shortcut cleared");
  };

  const clearBinding = (id) => changeBinding(id, "");
  const resetOne = (id) => changeBinding(id, null);
  const resetAll = async () => {
    await persist({});
    flash("All shortcuts reset to defaults");
  };

  // Shortcut recorder — capture the next chord anywhere in the window.
  useEffect(() => {
    if (!recordingId) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      if (e.key === "Escape") { setRecordingId(null); return; }
      if (e.key === "Backspace" || e.key === "Delete") { changeBinding(recordingId, ""); return; }
      const key = eventToKey(e);
      if (!key) return;
      const hasMod = /^(Ctrl|Alt)\+/.test(key);
      if (!hasMod && !isSafeBareKey(key.replace(/^Shift\+/, ""))) {
        flash("Use Ctrl/Alt with a letter, or a function key (F1–F12).", "error");
        return;
      }
      changeBinding(recordingId, key);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, overrides]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return REGISTRY
      .filter((c) => !q || `${c.title} ${c.category} ${c.desc || ""} ${effectiveBinding(c.id, overrides)}`.toLowerCase().includes(q))
      .map((c) => ({ ...c, key: effectiveBinding(c.id, overrides), isCustom: Object.prototype.hasOwnProperty.call(overrides, c.id), isDefault: !Object.prototype.hasOwnProperty.call(overrides, c.id) }));
  }, [filter, overrides]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category).push(r);
    }
    return [...map.entries()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0]), bi = CATEGORY_ORDER.indexOf(b[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [rows]);

  const conflicts = useMemo(() => {
    const seen = new Map();
    const bad = new Set();
    for (const r of rows) {
      const k = normalizeKeyForCompare(r.key);
      if (!k) continue;
      if (seen.has(k)) { bad.add(seen.get(k)); bad.add(r.id); }
      else seen.set(k, r.id);
    }
    return bad;
  }, [rows]);

  const customCount = Object.keys(overrides).length;
  const total = REGISTRY.length;
  const shown = rows.length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", marginBottom: "var(--space-8)", flexWrap: "wrap" }}>
        <input
          className="sw-input"
          style={{ flex: 1, minWidth: 220 }}
          placeholder="Filter keybindings…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter keybindings"
        />
        <span style={{ fontSize: "var(--fs-small)", color: "var(--text-placeholder)", whiteSpace: "nowrap" }}>
          {shown} of {total}
        </span>
        <button
          type="button"
          onClick={resetAll}
          disabled={!customCount || saving}
          title="Reset every shortcut to its default"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px",
            border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)",
            background: "var(--bg-button)", color: "var(--text-soft)", fontSize: "var(--fs-small)",
            cursor: customCount && !saving ? "pointer" : "default", opacity: customCount && !saving ? 1 : 0.5,
          }}
        >
          <RotateCcw size={12} /> Reset all
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-16)", fontSize: "var(--fs-small)", color: "var(--text-placeholder)" }}>
        <span>{customCount ? `${customCount} customized` : "All shortcuts are default"}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        <span>Click a shortcut to record a new one. Backspace clears it. Esc cancels.</span>
      </div>

      {toast && (
        <div style={{
          marginBottom: "var(--space-12)", padding: "var(--space-8) var(--space-12)", borderRadius: "var(--radius-md)",
          background: toast.kind === "error" ? "var(--bg-danger-soft)" : "var(--accent-soft-a08)",
          border: `1px solid ${toast.kind === "error" ? "var(--danger-a30)" : "var(--accent-soft-a18)"}`,
          color: toast.kind === "error" ? "var(--danger)" : "var(--text-soft)", fontSize: "var(--fs-body)",
        }}>{toast.msg}</div>
      )}

      {grouped.length === 0 ? (
        <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-body)", padding: "var(--space-16)", textAlign: "center", border: "var(--space-1) dashed var(--border)", borderRadius: "var(--radius-lg)" }}>
          No keybindings match "{filter}"
        </div>
      ) : (
        grouped.map(([category, items]) => (
          <div key={category} style={{ marginBottom: "var(--space-20)" }}>
            <div style={{
              fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", letterSpacing: 0.3,
              textTransform: "uppercase", color: "var(--text-label)",
              marginBottom: "var(--space-8)", paddingBottom: "var(--space-4)", borderBottom: "1px solid var(--bg-subtle)",
            }}>
              {category}
            </div>
            <div className="sw-keybindings-table">
              {items.map((b) => {
                const recording = recordingId === b.id;
                const conflict = conflicts.has(b.id);
                return (
                  <div key={b.id} className="sw-kb-row" style={{ alignItems: "center" }}>
                    <span className="sw-kb-command" title={b.desc || b.title}>
                      {b.title}
                      {b.isCustom && (
                        <span title="Customized" style={{ marginLeft: 6, color: "var(--accent)", fontSize: 9, verticalAlign: "middle" }}>●</span>
                      )}
                    </span>
                    <span className="sw-kb-desc" title={conflict ? "This shortcut is also used by another command" : (b.desc || "")}>
                      {conflict ? <span style={{ color: "var(--warn-gold)", display: "inline-flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} /> Conflict</span> : (b.desc || "")}
                    </span>
                    <span className="sw-kb-key" style={{ display: "inline-flex", alignItems: "center", gap: 4, minWidth: 190, justifyContent: "flex-end" }}>
                      {recording ? (
                        <>
                          <span style={{
                            minWidth: 130, padding: "4px 8px", borderRadius: "var(--radius-sm)",
                            border: "1px solid var(--accent)", background: "var(--accent-soft-a08)",
                            color: "var(--accent)", fontSize: "var(--fs-small)", fontFamily: "var(--font-code)",
                            animation: "pulse 1.4s infinite",
                          }}>Press a shortcut…</span>
                          <button type="button" title="Cancel (Esc)" onClick={() => setRecordingId(null)} style={{ border: 0, background: "transparent", color: "var(--icon)", cursor: "pointer", padding: 2 }}><X size={13} /></button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setRecordingId(b.id)}
                            title={b.key ? `Change “${displayKey(b.key)}”` : "Assign a shortcut"}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 5,
                              border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
                              background: "var(--bg-button)", color: b.key ? "var(--text-hover)" : "var(--text-placeholder)",
                              fontFamily: "var(--font-code)", fontSize: "var(--fs-small)", padding: "4px 8px", cursor: "pointer",
                              minWidth: 96, justifyContent: "center",
                            }}
                          >
                            <Pencil size={10} /> {b.key ? displayKey(b.key) : "Unassigned"}
                          </button>
                          {b.key && (
                            <button type="button" title="Clear shortcut" onClick={() => clearBinding(b.id)} style={{ border: 0, background: "transparent", color: "var(--icon)", cursor: "pointer", padding: 2 }}><X size={12} /></button>
                          )}
                          {b.isCustom && (
                            <button type="button" title="Reset to default" onClick={() => resetOne(b.id)} style={{ border: 0, background: "transparent", color: "var(--icon)", cursor: "pointer", padding: 2 }}><RotateCcw size={12} /></button>
                          )}
                          {b.isCustom && <Check size={11} style={{ color: "var(--success)" }} />}
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      <div style={{ marginTop: "var(--space-8)", padding: "var(--space-10)", background: "var(--accent-soft-a08)", border: "var(--space-1) solid var(--accent-soft-a18)", borderRadius: "var(--radius-md)", fontSize: "var(--fs-small)", color: "var(--text-placeholder)", lineHeight: "var(--lh-code)" }}>
        Shortcuts use <code style={{ background: "var(--bg-hover)", padding: "var(--space-1) var(--space-4)", borderRadius: "var(--radius-sm)", color: "var(--text-soft)" }}>Ctrl</code> on Windows/Linux and <code style={{ background: "var(--bg-hover)", padding: "var(--space-1) var(--space-4)", borderRadius: "var(--radius-sm)", color: "var(--text-soft)" }}>Cmd</code> on macOS. Editor shortcuts are applied by the CodeMirror keymap; app shortcuts rebuild the native menu as soon as you save.
      </div>
    </div>
  );
};

export default KeybindingsPage;
