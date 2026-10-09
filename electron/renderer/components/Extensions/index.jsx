// Extensions Panel — app extensions (OpenVSX) + Browser (Chrome) ke liye
// teen tabs: Installed · Browse (open-vsx.org) · Browser.
// App extensions main process host me activate hote hain (vscode-shim).
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Search, RefreshCw, Trash2, X, FolderOpen, FileArchive, Puzzle, Download, Star, ExternalLink } from "lucide-react";
import ChromeSection from "./ChromeSection.jsx";

const TABS = [
  { id: "installed", label: "Installed" },
  { id: "browse", label: "Browse" },
  { id: "browser", label: "Browser" },
];

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", color: "var(--text-bright)", overflow: "hidden", fontFamily: "var(--font-system)" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-6) var(--space-10)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0, gap: "var(--space-10)", flexWrap: "wrap" },
  title: { fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-soft)", display: "flex", alignItems: "center", gap: "var(--space-8)" },
  badge: { fontSize: "var(--fs-small)", background: "var(--border-light)", color: "var(--text-inverse)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-pill)", fontWeight: "var(--fw-bold)", minWidth: 18, textAlign: "center" },
  tabs: { display: "flex", gap: "var(--space-2)", padding: "var(--space-4) var(--space-8) 0", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0 },
  tab: { background: "transparent", border: "none", borderBottom: "2px solid transparent", color: "var(--text-soft)", fontSize: "var(--fs-small)", fontWeight: "var(--fw-semibold)", padding: "var(--space-5) var(--space-12)", cursor: "pointer" },
  tabOn: { color: "var(--text-bright)", borderBottomColor: "var(--editor-blue)" },
  btn: { display: "flex", alignItems: "center", gap: "var(--space-6)", background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-bright)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small)", cursor: "pointer", whiteSpace: "nowrap" },
  btnPrimary: { display: "flex", alignItems: "center", gap: "var(--space-6)", background: "var(--select-blue)", border: "1px solid var(--editor-blue)", color: "var(--text-inverse)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small)", cursor: "pointer", whiteSpace: "nowrap" },
  btnDanger: { display: "flex", alignItems: "center", gap: "var(--space-6)", background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--danger)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small)", cursor: "pointer", whiteSpace: "nowrap" },
  iconBtn: { display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-soft)", cursor: "pointer", padding: "var(--space-4) var(--space-8)", borderRadius: "var(--radius-md)" },
  input: { background: "var(--bg-vscode)", border: "1px solid var(--border-light)", color: "var(--text-input)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-8) var(--space-5) 26px", fontSize: "var(--fs-body)", outline: "none", width: "100%" },
  row: { display: "flex", alignItems: "flex-start", gap: "var(--space-10)", padding: "var(--space-8) var(--space-10)", fontSize: "var(--fs-body)", borderBottom: "var(--space-1) solid var(--border-row)" },
  name: { fontSize: "var(--fs-body)", fontWeight: "var(--fw-bold)", color: "var(--text-bright)" },
  desc: { fontSize: "var(--fs-small)", color: "var(--text-soft)", marginTop: "var(--space-2)", wordBreak: "break-word" },
  meta: { fontSize: "var(--fs-tiny)", color: "var(--icon-muted)", marginTop: "var(--space-2)", wordBreak: "break-all" },
  chip: { fontSize: "var(--fs-tiny)", background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-soft)", padding: "1px 6px", borderRadius: "var(--radius-sm)", fontWeight: "var(--fw-semibold)" },
  toggle: { display: "flex", alignItems: "center", gap: "var(--space-6)", fontSize: "var(--fs-small)", color: "var(--text-soft)", cursor: "pointer", userSelect: "none", flexShrink: 0 },
  toggleBtn: { width: 32, height: 18, borderRadius: "var(--radius-pill)", border: "1px solid var(--border-light)", background: "var(--bg-active)", position: "relative", cursor: "pointer", padding: 0, flexShrink: 0, transition: "background 120ms" },
  toggleBtnOn: { background: "var(--editor-blue)", borderColor: "var(--editor-blue)" },
  thumb: { position: "absolute", top: 2, left: 2, width: 12, height: 12, borderRadius: "var(--radius-round)", background: "var(--text-inverse)", transition: "transform 120ms" },
  thumbOn: { transform: "translateX(14px)" },
  err: { margin: "var(--space-8)", padding: "var(--space-8) var(--space-10)", background: "var(--error-bg-solid)", border: "var(--space-1) solid var(--error-border-3)", borderRadius: "var(--radius-md)", color: "var(--error-text-soft)", fontSize: "var(--fs-small)", whiteSpace: "pre-wrap" },
  toast: { margin: "var(--space-8)", padding: "var(--space-6) var(--space-10)", borderRadius: "var(--radius-md)", fontSize: "var(--fs-small)", border: "var(--space-1) solid var(--success-border-2)", background: "var(--success-bg)", color: "var(--teal)" },
  scroll: { flex: 1, overflowY: "auto" },
};

const openView = (extId, viewType, title) => {
  window.dispatchEvent(new CustomEvent("add-ext-view-panel", { detail: { extId, viewType, title } }));
};

// ── Installed tab ───────────────────────────────────────────────────────────
const InstalledTab = ({ onChanged }) => {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const api = window.electronAPI;
      if (!api?.extList) { setError("Extension host not available"); setList([]); return; }
      const res = await api.extList();
      setList(Array.isArray(res) ? res : []);
      setError("");
    } catch (e) { setError(String((e && e.message) || e)); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const un = window.electronAPI?.onExtChanged?.(() => { refresh(); onChanged?.(); });
    return () => { try { un && un(); } catch {} };
  }, [refresh, onChanged]);

  const toggle = async (ext) => {
    setBusyId(ext.id);
    try {
      const r = await window.electronAPI.extSetEnabled(ext.id, !ext.enabled);
      if (r?.error) setError(r.error);
      await refresh(); onChanged?.();
    } catch (e) { setError(String((e && e.message) || e)); }
    setBusyId("");
  };

  const remove = async (ext) => {
    const ok = window.electronAPI?.confirmDialog
      ? await window.electronAPI.confirmDialog(`Uninstall "${ext.name}" ${ext.version}?\nIts files will be deleted.`)
      : true;
    if (!ok) return;
    setBusyId(ext.id);
    try {
      const r = await window.electronAPI.extUninstall(ext.id);
      if (r?.error) setError(r.error);
      await refresh(); onChanged?.();
    } catch (e) { setError(String((e && e.message) || e)); }
    setBusyId("");
  };

  return (
    <>
      {error && <div style={s.err}>{error}</div>}
      {loading && list.length === 0 && <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>Loading…</div>}
      {!loading && list.length === 0 && !error && (
        <div style={{ textAlign: "center", padding: "var(--space-30) var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
          <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-secondary)", marginBottom: "var(--space-6)" }}>No app extensions installed</div>
          <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-small)", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
            Browse <b>open-vsx.org</b> (VS Code-compatible extensions) and install with one click — or load an unpacked folder for development.
          </div>
        </div>
      )}
      {list.map((ext) => (
        <div key={ext.id} style={{ ...s.row, opacity: ext.enabled ? 1 : 0.6 }}>
          <div style={{ flex: "0 0 auto", color: ext.enabled ? "var(--teal)" : "var(--icon-muted)", marginTop: 2 }}>
            <Puzzle size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexWrap: "wrap" }}>
              <span style={s.name}>{ext.name}</span>
              <span style={s.chip}>v{ext.version}</span>
              <span style={s.chip}>{ext.source === "vsx" ? "OpenVSX" : ext.source === "vsix" ? "VSIX" : "Local"}</span>
              {ext.activated && <span style={{ ...s.chip, color: "var(--teal)" }}>active</span>}
            </div>
            {ext.description ? <div style={s.desc}>{ext.description}</div> : null}
            <div style={s.meta}>{ext.id}{ext.publisher ? ` · by ${ext.publisher}` : ""}{ext.commandCount ? ` · ${ext.commandCount} command${ext.commandCount > 1 ? "s" : ""}` : ""}</div>
            {ext.error ? <div style={{ ...s.meta, color: "var(--danger)" }}>activation error: {ext.error}</div> : null}

            {ext.views && ext.views.length > 0 && (
              <div style={{ display: "flex", gap: "var(--space-6)", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
                {ext.views.map((v) => (
                  <button key={v.viewType} onClick={() => openView(ext.id, v.viewType, v.title)} style={{ ...s.btn, padding: "var(--space-3) var(--space-8)" }}>
                    <ExternalLink size={11} /> {v.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0, marginTop: 2 }}>
            <label style={s.toggle} title={ext.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}>
              <span style={{ minWidth: 52, textAlign: "right" }}>{busyId === ext.id ? "…" : ext.enabled ? "Enabled" : "Disabled"}</span>
              <button
                type="button" role="switch" aria-checked={ext.enabled} disabled={busyId === ext.id}
                onClick={() => toggle(ext)} aria-label={`Toggle ${ext.name}`}
                style={{ ...s.toggleBtn, ...(ext.enabled ? s.toggleBtnOn : {}) }}
              >
                <span style={{ ...s.thumb, ...(ext.enabled ? s.thumbOn : {}) }} />
              </button>
            </label>
            <button onClick={() => remove(ext)} disabled={busyId === ext.id} title="Uninstall" style={s.btnDanger}><Trash2 size={12} /></button>
          </div>
        </div>
      ))}
    </>
  );
};

// ── Browse tab (open-vsx.org) ───────────────────────────────────────────────
const BrowseTab = () => {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const debRef = useRef(null);
  const seqRef = useRef(0);

  const run = useCallback(async (q) => {
    const api = window.electronAPI;
    if (!api?.extSearch) { setError("Extension host not available"); return; }
    const seq = ++seqRef.current;
    if (!q.trim()) { setItems([]); setTotal(0); setError(""); return; }
    setLoading(true);
    try {
      const res = await api.extSearch(q, { size: 25 });
      if (seq !== seqRef.current) return;
      setItems(Array.isArray(res?.items) ? res.items : []);
      setTotal(res?.total || 0);
      setError(res?.error || "");
    } catch (e) { if (seq === seqRef.current) setError(String((e && e.message) || e)); }
    if (seq === seqRef.current) setLoading(false);
  }, []);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => run(query), 350);
    return () => clearTimeout(debRef.current);
  }, [query, run]);

  const install = async (it) => {
    setBusy(it.id);
    setError("");
    try {
      const r = await window.electronAPI.extInstall({ namespace: it.namespace, name: it.name, version: it.version, vsix: it.vsix });
      if (r?.error) setError(`${it.displayName || it.name}: ${r.error}`);
      else if (r?.ok) setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, installed: true } : x)));
    } catch (e) { setError(String((e && e.message) || e)); }
    setBusy("");
  };

  const suggestions = ["prettier", "eslint", "git", "markdown", "python"];

  return (
    <>
      <div style={{ padding: "var(--space-6) var(--space-8)", borderBottom: "var(--space-1) solid var(--border-row)", display: "flex", gap: "var(--space-6)", background: "var(--bg-surface)" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search open-vsx.org…" style={s.input} spellCheck={false} />
        </div>
        {query && <button onClick={() => setQuery("")} style={s.iconBtn}><X size={12} /></button>}
        <a href="https://open-vsx.org/" target="_blank" rel="noreferrer noopener" style={{ ...s.btn, textDecoration: "none", alignItems: "center" }} title="Open open-vsx.org">
          <ExternalLink size={12} /> open-vsx.org
        </a>
      </div>

      {error && <div style={s.err}>{error}</div>}

      <div style={s.scroll}>
        {!query.trim() && (
          <div style={{ textAlign: "center", padding: "var(--space-30) var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
            <Download size={22} style={{ marginBottom: "var(--space-8)", opacity: 0.6 }} />
            <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-secondary)", marginBottom: "var(--space-6)" }}>Search the Open VSX Registry</div>
            <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-small)", marginBottom: "var(--space-12)" }}>
              VS Code-compatible extensions, no account needed.
            </div>
            <div style={{ display: "flex", gap: "var(--space-6)", justifyContent: "center", flexWrap: "wrap" }}>
              {suggestions.map((q) => (
                <button key={q} onClick={() => setQuery(q)} style={s.btn}>{q}</button>
              ))}
            </div>
          </div>
        )}
        {loading && <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>Searching…</div>}
        {query.trim() && !loading && items.length === 0 && !error && (
          <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>No extensions found for “{query}”.</div>
        )}
        {items.map((it) => (
          <div key={it.id} style={s.row}>
            <div style={{ flex: "0 0 auto", width: 32, height: 32, borderRadius: "var(--radius-md)", background: "var(--bg-active)", border: "1px solid var(--border-light)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", color: "var(--icon-muted)" }}>
              {it.icon
                ? <img src={it.icon} alt="" width={32} height={32} style={{ objectFit: "contain" }} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                : <Puzzle size={16} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexWrap: "wrap" }}>
                <span style={s.name}>{it.displayName || it.name}</span>
                <span style={s.chip}>v{it.version}</span>
                <span style={{ ...s.meta, marginTop: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Download size={10} /> {(it.downloads || 0).toLocaleString()}
                </span>
                {it.rating > 0 && (
                  <span style={{ ...s.meta, marginTop: 0, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Star size={10} /> {Number(it.rating).toFixed(1)}
                  </span>
                )}
              </div>
              {it.description ? <div style={s.desc}>{it.description}</div> : null}
              <div style={s.meta}>{it.namespace ? `${it.namespace} · ` : ""}{it.id}</div>
            </div>
            <div style={{ flexShrink: 0, marginTop: 2 }}>
              {it.installed ? (
                <span style={{ ...s.chip, color: "var(--teal)" }}>Installed</span>
              ) : (
                <button onClick={() => install(it)} disabled={busy === it.id} style={s.btnPrimary}>
                  <Download size={12} /> {busy === it.id ? "Installing…" : "Install"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

// ── Panel with tabs ─────────────────────────────────────────────────────────
const ExtensionsPanel = () => {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem("ibx:extensionsTab") || "installed"; } catch { return "installed"; }
  });
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState(null);

  useEffect(() => { try { localStorage.setItem("ibx:extensionsTab", tab); } catch {} }, [tab]);

  const refreshCount = useCallback(async () => {
    try {
      const list = await window.electronAPI?.extList?.();
      setCount(Array.isArray(list) ? list.length : 0);
    } catch { setCount(0); }
  }, []);

  useEffect(() => { refreshCount(); }, [refreshCount]);

  const showToast = (text) => { setToast(text); setTimeout(() => setToast(null), 2500); };

  const loadFolder = async () => {
    setBusy("folder");
    try {
      const r = await window.electronAPI.extInstallFolder();
      if (r?.error) showToast(r.error);
      else if (r?.ok) { showToast("Extension loaded"); refreshCount(); }
    } finally { setBusy(""); }
  };
  const installVsix = async () => {
    setBusy("vsix");
    try {
      const r = await window.electronAPI.extInstallVsix();
      if (r?.error) showToast(r.error);
      else if (r?.ok) { showToast("VSIX installed"); refreshCount(); }
    } finally { setBusy(""); }
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>Extensions <span style={s.badge}>{count}</span></div>
        <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={loadFolder} disabled={busy === "folder"} title="Load an unpacked extension folder (development)" style={s.btn}>
            <FolderOpen size={12} /> Load Folder
          </button>
          <button onClick={installVsix} disabled={busy === "vsix"} title="Install a .vsix file" style={s.btn}>
            <FileArchive size={12} /> {busy === "vsix" ? "Installing…" : "Install .VSIX"}
          </button>
          <button onClick={refreshCount} title="Refresh" style={s.iconBtn}><RefreshCw size={12} /></button>
        </div>
      </div>

      <div style={s.tabs}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ ...s.tab, ...(tab === t.id ? s.tabOn : {}) }}>
            {t.label}{t.id === "installed" && count ? ` (${count})` : ""}
          </button>
        ))}
      </div>

      {toast && <div style={s.toast}>{toast}</div>}

      {tab === "installed" && <InstalledTab onChanged={refreshCount} />}
      {tab === "browse" && <BrowseTab />}
      {tab === "browser" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ChromeSection />
        </div>
      )}
    </div>
  );
};

export default ExtensionsPanel;
