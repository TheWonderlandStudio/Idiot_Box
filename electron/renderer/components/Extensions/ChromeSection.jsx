// Browser Extensions — Chrome extensions jo Browser panel ke webviews me load hoti hain.
// Extensions panel ka "Browser" tab: list / enable / remove / install (.crx + unpacked).
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Search, RefreshCw, Plus, Package, Power, Trash2, X, ExternalLink } from "lucide-react";

const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/";

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", color: "var(--text-bright)", overflow: "hidden", fontFamily: "var(--font-system)" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-6) var(--space-10)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0, gap: "var(--space-10)", flexWrap: "wrap" },
  title: { fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-soft)", display: "flex", alignItems: "center", gap: "var(--space-8)" },
  badge: { fontSize: "var(--fs-small)", background: "var(--border-light)", color: "var(--text-inverse)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-pill)", fontWeight: "var(--fw-bold)", minWidth: 18, textAlign: "center" },
  btnGhost: { display: "flex", alignItems: "center", gap: "var(--space-6)", background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-bright)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small)", cursor: "pointer", whiteSpace: "nowrap" },
  btnPrimary: { display: "flex", alignItems: "center", gap: "var(--space-6)", background: "var(--select-blue)", border: "1px solid var(--editor-blue)", color: "var(--text-inverse)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small)", cursor: "pointer", whiteSpace: "nowrap" },
  btnDanger: { display: "flex", alignItems: "center", gap: "var(--space-6)", background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--danger)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small)", cursor: "pointer", whiteSpace: "nowrap" },
  iconBtn: { display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-soft)", cursor: "pointer", padding: "var(--space-4) var(--space-8)", borderRadius: "var(--radius-md)" },
  input: { background: "var(--bg-vscode)", border: "1px solid var(--border-light)", color: "var(--text-input)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-8) var(--space-5) 26px", fontSize: "var(--fs-body)", outline: "none", width: "100%" },
  row: { display: "flex", alignItems: "flex-start", gap: "var(--space-10)", padding: "var(--space-8) var(--space-10)", fontSize: "var(--fs-body)", borderBottom: "var(--space-1) solid var(--border-row)" },
  name: { fontSize: "var(--fs-body)", fontWeight: "var(--fw-bold)", color: "var(--text-bright)" },
  desc: { fontSize: "var(--fs-small)", color: "var(--text-soft)", marginTop: "var(--space-2)", wordBreak: "break-word" },
  meta: { fontSize: "var(--fs-tiny)", color: "var(--icon-muted)", marginTop: "var(--space-2)", wordBreak: "break-all" },
  toggle: { display: "flex", alignItems: "center", gap: "var(--space-6)", fontSize: "var(--fs-small)", color: "var(--text-soft)", cursor: "pointer", userSelect: "none", flexShrink: 0 },
  toggleBtn: { width: 32, height: 18, borderRadius: "var(--radius-pill)", border: "1px solid var(--border-light)", background: "var(--bg-active)", position: "relative", cursor: "pointer", padding: 0, flexShrink: 0, transition: "background 120ms" },
  toggleBtnOn: { background: "var(--editor-blue)", borderColor: "var(--editor-blue)" },
  thumb: { position: "absolute", top: 2, left: 2, width: 12, height: 12, borderRadius: "var(--radius-round)", background: "var(--text-inverse)", transition: "transform 120ms" },
  thumbOn: { transform: "translateX(14px)" },
};

const ChromeSection = () => {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [filter, setFilter] = useState("");

  const showToast = useCallback((text, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const refresh = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      if (!window.electronAPI?.listChromeExtensions) {
        setError("Extensions API not available");
        setList([]);
      } else {
        const res = await window.electronAPI.listChromeExtensions();
        setList(Array.isArray(res) ? res : []);
        setError("");
      }
    } catch (e) {
      setError(String((e && e.message) || e));
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(false); }, [refresh]);

  const loadUnpacked = async () => {
    setError("");
    if (!window.electronAPI?.loadChromeExtension) { setError("Extensions API not available"); return; }
    const res = await window.electronAPI.loadChromeExtension();
    if (res?.error) setError(res.error);
    else if (res?.ok === false) { /* user cancelled */ }
    else showToast("Extension loaded");
    refresh(true);
  };

  const installCrx = async () => {
    setError("");
    setBusyId("crx");
    try {
      const res = window.electronAPI?.loadChromeCrx
        ? await window.electronAPI.loadChromeCrx()
        : { ok: false, error: "Restart the app to enable CRX install" };
      if (res?.error) setError(res.error);
      else if (res?.ok) showToast(`${res.name || "Extension"} installed`);
      else if (res?.ok === false && res.error) setError(res.error);
      refresh(true);
    } catch (e) {
      setError(String((e && e.message) || e));
    }
    setBusyId("");
  };

  const openStore = async () => {
    setError("");
    try {
      if (window.electronAPI?.openUrl) await window.electronAPI.openUrl(CHROME_WEB_STORE_URL);
      else window.open(CHROME_WEB_STORE_URL, "_blank", "noopener");
    } catch {
      try { window.open(CHROME_WEB_STORE_URL, "_blank", "noopener"); } catch (e) { setError(String(e)); }
    }
  };

  const toggleEnabled = async (ext) => {
    setBusyId(ext.id);
    setError("");
    try {
      const res = await window.electronAPI.setChromeExtensionEnabled(ext.id, !ext.enabled);
      if (res?.error) setError(res.error);
      else showToast(`${ext.name} ${ext.enabled ? "disabled" : "enabled"}`);
      refresh(true);
    } catch (e) {
      setError(String((e && e.message) || e));
    }
    setBusyId("");
  };

  const removeExt = async (ext) => {
    const ok = window.electronAPI?.confirmDialog
      ? await window.electronAPI.confirmDialog(`Remove "${ext.name}"?\nIts files stay on disk but it will no longer load.`)
      : true;
    if (!ok) return;
    setBusyId(ext.id);
    setError("");
    try {
      const res = await window.electronAPI.removeChromeExtension(ext.id);
      if (res?.error) setError(res.error);
      else showToast(`${ext.name} removed`);
    } catch (e) {
      setError(String((e && e.message) || e));
    }
    refresh(true);
    setBusyId("");
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) =>
      (e.name || "").toLowerCase().includes(q) ||
      (e.description || "").toLowerCase().includes(q) ||
      (e.id || "").toLowerCase().includes(q)
    );
  }, [list, filter]);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>Chrome <span style={s.badge}>{filtered.length}</span></div>
        <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={openStore} title="Open Chrome Web Store" style={s.btnGhost}>
            <ExternalLink size={12} /> Web Store
          </button>
          <button onClick={installCrx} disabled={busyId === "crx"} title="Pick a .crx file to install" style={s.btnGhost}>
            <Package size={12} /> {busyId === "crx" ? "Installing…" : "Install .CRX"}
          </button>
          <button onClick={loadUnpacked} title="Pick an unpacked extension folder (with manifest.json)" style={s.btnPrimary}>
            <Plus size={12} /> Load Unpacked
          </button>
          <button onClick={() => refresh(false)} title="Refresh" style={s.iconBtn}><RefreshCw size={12} /></button>
        </div>
      </div>

      <div style={{ padding: "var(--space-6) var(--space-8)", borderBottom: "var(--space-1) solid var(--border-row)", display: "flex", gap: "var(--space-6)", background: "var(--bg-surface)" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter extensions" style={s.input} />
        </div>
        {filter && <button onClick={() => setFilter("")} style={{ ...s.iconBtn }}><X size={12} /></button>}
      </div>

      {error && <div style={{ margin: "var(--space-8)", padding: "var(--space-8) var(--space-10)", background: "var(--error-bg-solid)", border: "var(--space-1) solid var(--error-border-3)", borderRadius: "var(--radius-md)", color: "var(--error-text-soft)", fontSize: "var(--fs-small)" }}>{error}</div>}
      {toast && <div style={{ margin: error ? "0 var(--space-8) var(--space-8)" : "var(--space-8)", padding: "var(--space-6) var(--space-10)", background: toast.isError ? "var(--error-bg-solid)" : "var(--success-bg)", border: "var(--space-1) solid " + (toast.isError ? "var(--error-border-3)" : "var(--success-border-2)"), borderRadius: "var(--radius-md)", color: toast.isError ? "var(--error-text-soft)" : "var(--teal)", fontSize: "var(--fs-small)" }}>{toast.text}</div>}

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && list.length === 0 && (
          <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>Loading…</div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: "var(--space-30) var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
            <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-secondary)", marginBottom: "var(--space-6)" }}>
              {filter ? "No matching extensions" : "No extensions installed"}
            </div>
            <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-small)", lineHeight: 1.6 }}>
              {filter
                ? "Clear the filter to see all extensions"
                : "Load an unpacked folder (the one with manifest.json) or install a .crx file. These load into the Browser panel's webviews."}
            </div>
            {!filter && (
              <div style={{ display: "flex", gap: "var(--space-8)", justifyContent: "center", marginTop: "var(--space-12)", flexWrap: "wrap" }}>
                <button onClick={loadUnpacked} style={s.btnPrimary}><Plus size={12} /> Load Unpacked</button>
                <button onClick={openStore} style={s.btnGhost}><ExternalLink size={12} /> Web Store</button>
              </div>
            )}
          </div>
        )}

        {filtered.map((ext) => {
          const busy = busyId === ext.id;
          const on = !!ext.enabled;
          return (
            <div key={ext.id} style={{ ...s.row, opacity: on ? 1 : 0.6 }}>
              <div style={{ flex: "0 0 auto", color: on ? "var(--teal)" : "var(--icon-muted)", marginTop: 2 }}>
                <Package size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.name}>{ext.name || ext.id}</div>
                {ext.description ? <div style={s.desc}>{ext.description}</div> : null}
                <div style={s.meta}>v{ext.version || "?"} &middot; {ext.id}</div>
                {ext.path ? <div style={s.meta}>{ext.path}</div> : null}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0, marginTop: 2 }}>
                <label style={s.toggle} title={on ? "Enabled — click to disable" : "Disabled — click to enable"}>
                  <span style={{ minWidth: 52, textAlign: "right" }}>{busy ? "…" : on ? "Enabled" : "Disabled"}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`Toggle ${ext.name}`}
                    disabled={busy}
                    onClick={() => toggleEnabled(ext)}
                    style={{ ...s.toggleBtn, ...(on ? s.toggleBtnOn : {}) }}
                  >
                    <span style={{ ...s.thumb, ...(on ? s.thumbOn : {}) }} />
                  </button>
                </label>
                <button onClick={() => removeExt(ext)} disabled={busy} title="Remove extension" style={s.btnDanger}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "var(--space-6) var(--space-10)", borderTop: "var(--space-1) solid var(--border-row)", background: "var(--bg-vscode)", fontSize: "var(--fs-tiny)", color: "var(--icon-muted)", flexShrink: 0 }}>
        <Power size={10} style={{ verticalAlign: "middle", marginRight: 6 }} />
        Loaded extensions run inside the Browser panel only. Installed paths persist in userData and auto-load on startup.
      </div>
    </div>
  );
};

export default ChromeSection;
