// Extensions Panel — app extensions + Browser (Chrome) ke liye
// teen tabs: Installed · Community · Browser.
// App extensions main process host me activate hote hain (vscode-shim).
import React, { useEffect, useState, useCallback, useMemo } from "react";
import { RefreshCw, Trash2, FolderOpen, Puzzle, ExternalLink, Download, Info, Play, ArrowLeft } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import ChromeSection from "./ChromeSection.jsx";

// README (remote/community content) — marked se HTML, DOMPurify se sanitize.
marked.setOptions({ gfm: true, breaks: false });
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noreferrer noopener");
  }
});
const renderReadmeMd = (src) => {
  const raw = marked.parse(String(src || ""), { async: false });
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["target"] });
};

const TABS = [
  { id: "installed", label: "Installed" },
  { id: "community", label: "Community" },
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

// ── Details panel ke chhote tukde ───────────────────────────────────────────
const Section = ({ title, children }) => (
  <div style={{ padding: "var(--space-10) var(--space-10)", borderBottom: "var(--space-1) solid var(--border-row)" }}>
    <div style={{ fontSize: "var(--fs-tiny)", fontWeight: "var(--fw-bold)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-soft)", marginBottom: "var(--space-8)" }}>{title}</div>
    {children}
  </div>
);

const FeatureRow = ({ main, sub, action }) => (
  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-4) 0", fontSize: "var(--fs-small)" }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ color: "var(--text-bright)", fontWeight: "var(--fw-semibold)", wordBreak: "break-word" }}>{main}</div>
      {sub ? <div style={{ fontSize: "var(--fs-tiny)", color: "var(--icon-muted)", wordBreak: "break-all" }}>{sub}</div> : null}
    </div>
    {action}
  </div>
);

// Features: runtime ke commands/views/status + package.json contributes se
// pata chalta hai ki extension kis panel/menu me kaam karta hai.
const FeaturesBlock = ({ commands = [], formatterCount = 0, views = [], statusItems = [], contributes = {}, onRun, running, onOpenView }) => {
  const c = contributes || {};
  const has =
    commands.length || formatterCount || views.length || statusItems.length ||
    (c.menus && c.menus.length) || (c.views && c.views.length) ||
    (c.viewContainers && c.viewContainers.length) || (c.keybindings && c.keybindings.length);
  if (!has) {
    return (
      <Section title="Features">
        <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-small)" }}>
          Is extension ne koi command/panel register nahi kiya — README dekh kar use karein.
        </div>
      </Section>
    );
  }
  return (
    <>
      {commands.length > 0 && (
        <Section title={`Commands (${commands.length})`}>
          {commands.map((cmd) => (
            <FeatureRow
              key={cmd.id}
              main={cmd.title || cmd.id}
              sub={`${cmd.id}${cmd.category ? ` · ${cmd.category}` : ""}`}
              action={onRun ? (
                <button onClick={() => onRun(cmd.id)} disabled={running === cmd.id} style={{ ...s.btn, padding: "var(--space-3) var(--space-8)" }}>
                  <Play size={11} /> {running === cmd.id ? "…" : "Run"}
                </button>
              ) : null}
            />
          ))}
        </Section>
      )}
      {formatterCount > 0 && (
        <Section title="Formatting">
          <FeatureRow main="Document formatter" sub="Available from the editor Format button and right-click menu." />
        </Section>
      )}
      {views.length > 0 && (
        <Section title={`Panels / Views (${views.length})`}>
          {views.map((v) => (
            <FeatureRow
              key={v.viewType}
              main={v.title || v.viewType}
              sub={`view: ${v.viewType}`}
              action={onOpenView ? (
                <button onClick={() => onOpenView(v)} style={{ ...s.btn, padding: "var(--space-3) var(--space-8)" }}>
                  <ExternalLink size={11} /> Open
                </button>
              ) : null}
            />
          ))}
        </Section>
      )}
      {statusItems.length > 0 && (
        <Section title={`Status Bar (${statusItems.length})`}>
          {statusItems.map((it, i) => (
            <FeatureRow key={i} main={it.text} sub={it.tooltip || (it.command ? `command: ${it.command}` : "")} />
          ))}
        </Section>
      )}
      {((c.menus && c.menus.length) || (c.viewContainers && c.viewContainers.length) || (c.keybindings && c.keybindings.length) || (c.views && c.views.length)) ? (
        <Section title="Yeh kahan dikhta hai">
          {(c.viewContainers || []).map((vc) => (
            <FeatureRow key={`vc-${vc.id}`} main={vc.title} sub={`sidebar container: ${vc.id}`} />
          ))}
          {(c.views || []).map((v, i) => (
            <FeatureRow key={`v-${i}`} main={v.name || v.id} sub={`view: ${v.container}.${v.id}`} />
          ))}
          {(c.menus || []).map((m) => (
            <FeatureRow key={`m-${m.menu}`} main={m.menu} sub={`${m.count} menu item${m.count > 1 ? "s" : ""}`} />
          ))}
          {(c.keybindings || []).map((k, i) => (
            <FeatureRow key={`k-${i}`} main={k.command} sub={`shortcut: ${k.key || "—"}`} />
          ))}
          {(c.configuration || 0) > 0 && (
            <FeatureRow main="Settings" sub={`${c.configuration} configuration section${c.configuration > 1 ? "s" : ""} — Settings me search karein`} />
          )}
        </Section>
      ) : null}
    </>
  );
};

// ── Installed extension details — README + features + how to use ────────────
const ExtDetails = ({ extId, onBack }) => {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState("");
  const html = useMemo(() => (d && d.readme ? renderReadmeMd(d.readme) : ""), [d]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const api = window.electronAPI;
        if (!api?.extDetails) { setError("Extension host not available"); return; }
        const res = await api.extDetails(extId);
        if (dead) return;
        if (res?.ok) { setD(res); setError(""); } else setError(res?.error || "Failed to load details");
      } catch (e) { if (!dead) setError(String((e && e.message) || e)); }
    })();
    return () => { dead = true; };
  }, [extId]);

  const run = async (cmdId) => {
    if (cmdId === "prettier.formatDocument") {
      window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: "format" } }));
      return;
    }
    setRunning(cmdId);
    try { await window.electronAPI?.extInvoke?.(cmdId); } catch {}
    setRunning("");
  };

  const info = d && d.info;
  return (
    <div style={s.scroll}>
      <div style={{ padding: "var(--space-8) var(--space-10)", borderBottom: "var(--space-1) solid var(--border-row)", display: "flex", alignItems: "center", gap: "var(--space-8)", flexWrap: "wrap" }}>
        <button onClick={onBack} style={s.btn}><ArrowLeft size={12} /> Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexWrap: "wrap" }}>
            <span style={s.name}>{(info && info.name) || extId}</span>
            {info && info.version && <span style={s.chip}>v{info.version}</span>}
            {info && info.activated && <span style={{ ...s.chip, color: "var(--teal)" }}>active</span>}
            {info && !info.enabled && <span style={s.chip}>disabled</span>}
          </div>
          {info && info.description ? <div style={s.desc}>{info.description}</div> : null}
          {info ? (
            <div style={s.meta}>
              {info.id}{info.publisher ? ` · by ${info.publisher}` : ""}{info.engines ? ` · VS Code ${info.engines}` : ""}{info.main ? ` · main: ${info.main}` : ""}
            </div>
          ) : null}
          {info && info.error ? <div style={{ ...s.meta, color: "var(--danger)" }}>activation error: {info.error}</div> : null}
        </div>
      </div>

      {error && <div style={s.err}>{error}</div>}
      {!d && !error && <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>Loading…</div>}
      {d && (
        <>
          <FeaturesBlock
            commands={d.commands} formatterCount={d.formatterCount} views={d.views} statusItems={d.statusItems} contributes={d.contributes}
            running={running} onRun={run} onOpenView={(v) => openView(extId, v.viewType, v.title)}
          />
          <Section title={d.readmeFile ? `README (${d.readmeFile}) — How to use` : "README / How to use"}>
            {d.readme
              ? <div className="nb-md-view" style={{ overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: html }} />
              : <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-small)", lineHeight: 1.6 }}>
                  Is extension ka README nahi mila. Upar listed commands/panels se features chala sakte hain — Run button commands ko invoke karta hai.
                </div>}
          </Section>
        </>
      )}
    </div>
  );
};

// ── Community extension details — metadata + features + remote README ───────
const CommunityDetails = ({ item, repo, installed, installing, onBack, onInstall }) => {
  const [readme, setReadme] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const html = useMemo(() => (readme ? renderReadmeMd(readme) : ""), [readme]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await window.electronAPI?.extCommunityReadme?.(repo.trim(), item.rawName);
        if (dead) return;
        if (r?.ok) { setReadme(r.readme || ""); setFile(r.file || null); setError(""); }
        else setError(r?.error || "");
      } catch (e) { if (!dead) setError(String((e && e.message) || e)); }
    })();
    return () => { dead = true; };
  }, [repo, item.rawName]);

  return (
    <div style={s.scroll}>
      <div style={{ padding: "var(--space-8) var(--space-10)", borderBottom: "var(--space-1) solid var(--border-row)", display: "flex", alignItems: "center", gap: "var(--space-8)", flexWrap: "wrap" }}>
        <button onClick={onBack} style={s.btn}><ArrowLeft size={12} /> Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexWrap: "wrap" }}>
            <span style={s.name}>{item.name}</span>
            <span style={s.chip}>v{item.version}</span>
            {installed && <span style={{ ...s.chip, color: "var(--teal)" }}>Installed</span>}
          </div>
          {item.description ? <div style={s.desc}>{item.description}</div> : null}
          <div style={s.meta}>{item.id}{item.publisher ? ` · by ${item.publisher}` : ""}{item.engines ? ` · VS Code ${item.engines}` : ""}{item.path ? ` · ${item.path}` : ""}</div>
        </div>
        <div style={{ flexShrink: 0 }}>
          {installed ? (
            <span style={{ ...s.chip, color: "var(--teal)" }}>Installed</span>
          ) : (
            <button onClick={onInstall} disabled={installing} style={s.btnPrimary}>
              <Download size={12} /> {installing ? "Installing…" : "Install"}
            </button>
          )}
        </div>
      </div>

      <FeaturesBlock commands={[]} views={[]} statusItems={[]} contributes={item.features} />
      <Section title={file ? `README (${file}) — How to use` : "README / How to use"}>
        {error && <div style={{ ...s.meta, color: "var(--danger)" }}>{error}</div>}
        {readme
          ? <div className="nb-md-view" style={{ overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: html }} />
          : !error && (
            <div style={{ color: "var(--text-muted)", fontSize: "var(--fs-small)", lineHeight: 1.6 }}>
              README nahi mila. Install karne ke baad iske commands/panels Installed tab ke details me dikhenge.
            </div>
          )}
      </Section>
    </div>
  );
};

// ── Installed tab ───────────────────────────────────────────────────────────
const InstalledTab = ({ onChanged }) => {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");

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
      {selected && <ExtDetails extId={selected} onBack={() => setSelected("")} />}
      {!selected && (
      <>
      {error && <div style={s.err}>{error}</div>}
      {loading && list.length === 0 && <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>Loading…</div>}
      {!loading && list.length === 0 && !error && (
        <div style={{ textAlign: "center", padding: "var(--space-30) var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
          <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-secondary)", marginBottom: "var(--space-6)" }}>No app extensions installed</div>
            <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-small)", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
              Load an unpacked extension folder for development.
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
              <span style={{ ...s.name, cursor: "pointer", textDecoration: "underline", textDecorationColor: "var(--border-light)" }} onClick={() => setSelected(ext.id)} title="Details, features & README">{ext.name}</span>
              <span style={s.chip}>v{ext.version}</span>
              {ext.builtIn
                ? <span style={{ ...s.chip, color: "var(--teal)" }}>Built-in</span>
                : (ext.source === "folder" || !ext.source || ext.source === "local") && <span style={s.chip}>Local</span>}
              {ext.activated && <span style={{ ...s.chip, color: "var(--teal)" }}>active</span>}
            </div>
            {ext.description ? <div style={s.desc}>{ext.description}</div> : null}
            <div style={s.meta}>{ext.id}{ext.publisher ? ` · by ${ext.publisher}` : ""}{ext.commandCount ? ` · ${ext.commandCount} command${ext.commandCount > 1 ? "s" : ""}` : ""}{ext.formatterCount ? " · document formatter" : ""}</div>
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
            {!ext.builtIn && (
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
            )}
            <button onClick={() => setSelected(ext.id)} title="Details, features & README" style={s.iconBtn}><Info size={12} /></button>
            {!ext.builtIn && <button onClick={() => remove(ext)} disabled={busyId === ext.id} title="Uninstall" style={s.btnDanger}><Trash2 size={12} /></button>}
          </div>
        </div>
      ))}
      </>
      )}
    </>
  );
};

// ── Community tab — GitHub repo ke extensions ka list + Install ─────────────
// Repo me `extensions/<publisher>.<name>/` folder structure hona chahiye.
const CommunityTab = ({ onInstalled }) => {
  const [repo, setRepo] = useState(() => {
    try { return localStorage.getItem("ibx:communityRepo") || ""; } catch { return ""; }
  });
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [installedIds, setInstalledIds] = useState(() => new Set());
  const [sel, setSel] = useState(null);

  const refreshInstalled = useCallback(async () => {
    try {
      const list = await window.electronAPI?.extList?.();
      setInstalledIds(new Set((Array.isArray(list) ? list : []).map((e) => e.id)));
    } catch {}
  }, []);
  useEffect(() => { refreshInstalled(); }, [refreshInstalled]);

  useEffect(() => { try { localStorage.setItem("ibx:communityRepo", repo); } catch {} }, [repo]);

  const load = useCallback(async () => {
    const api = window.electronAPI;
    const url = repo.trim();
    if (!api?.extCommunityList) { setError("Extension host not available"); return; }
    if (!url) { setError("Enter a GitHub repo — jaise `owner/repo`"); setItems([]); setMeta(null); return; }
    setLoading(true);
    try {
      const res = await api.extCommunityList(url);
      if (res?.ok) { setItems(Array.isArray(res.items) ? res.items : []); setMeta(res); setError(""); }
      else { setItems([]); setMeta(null); setError(res?.error || "Failed to load repo"); }
    } catch (e) { setError(String((e && e.message) || e)); }
    setLoading(false);
  }, [repo]);

  const install = async (it) => {
    setBusy(it.rawName || it.id);
    setError("");
    try {
      const r = await window.electronAPI.extCommunityInstall(repo.trim(), it.rawName);
      if (r?.error) setError(`${it.name}: ${r.error}`);
      else if (r?.ok) { await refreshInstalled(); onInstalled?.(); }
    } catch (e) { setError(String((e && e.message) || e)); }
    setBusy("");
  };

  if (sel) {
    return (
      <CommunityDetails
        item={sel}
        repo={repo}
        installed={installedIds.has(sel.id)}
        installing={busy === (sel.rawName || sel.id)}
        onBack={() => setSel(null)}
        onInstall={() => install(sel)}
      />
    );
  }

  return (
    <>
      <div style={{ padding: "var(--space-6) var(--space-8)", borderBottom: "var(--space-1) solid var(--border-row)", display: "flex", gap: "var(--space-6)", background: "var(--bg-surface)" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            value={repo} onChange={(e) => setRepo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            placeholder="GitHub repo — owner/repo (extensions/ folder ke saath)"
            style={{ ...s.input, paddingLeft: "var(--space-8)" }} spellCheck={false}
          />
        </div>
        <button onClick={load} disabled={loading} style={s.btnPrimary}>
          {loading ? "Loading…" : "Load"}
        </button>
      </div>

      {error && <div style={s.err}>{error}</div>}

      <div style={s.scroll}>
        {!meta && !loading && !error && (
          <div style={{ textAlign: "center", padding: "var(--space-30) var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
            <Download size={22} style={{ marginBottom: "var(--space-8)", opacity: 0.6 }} />
            <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-secondary)", marginBottom: "var(--space-6)" }}>Community extensions</div>
            <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-small)", lineHeight: 1.6, maxWidth: 480, margin: "0 auto" }}>
              Apna GitHub repo daalo jisme <b>extensions/</b> folder ho — app uske sare extensions load karega.
              Har extension ka apna <b>package.json</b> + entry file honi chahiye.
            </div>
          </div>
        )}
        {meta && !loading && items.length === 0 && !error && (
          <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>
            {meta.repo}/{meta.subfolder}/ me koi extension nahi mili.
          </div>
        )}
        {meta && items.length > 0 && (
          <div style={{ padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-tiny)", color: "var(--icon-muted)", borderBottom: "var(--space-1) solid var(--border-row)" }}>
            {meta.repo} · {meta.branch} · {meta.subfolder}/ · {items.length} extension{items.length > 1 ? "s" : ""}
          </div>
        )}
        {items.map((it) => {
          const installed = installedIds.has(it.id);
          return (
            <div key={it.id} style={s.row}>
              <div style={{ flex: "0 0 auto", color: "var(--icon-muted)", marginTop: 2 }}>
                <Puzzle size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexWrap: "wrap" }}>
                  <span style={{ ...s.name, cursor: "pointer", textDecoration: "underline", textDecorationColor: "var(--border-light)" }} onClick={() => setSel(it)} title="Details, features & README">{it.name}</span>
                  <span style={s.chip}>v{it.version}</span>
                  {installed && <span style={{ ...s.chip, color: "var(--teal)" }}>Installed</span>}
                </div>
                {it.description ? <div style={s.desc}>{it.description}</div> : null}
                <div style={s.meta}>{it.id}{it.publisher ? ` · by ${it.publisher}` : ""}{it.path ? ` · ${it.path}` : ""}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexShrink: 0, marginTop: 2 }}>
                <button onClick={() => setSel(it)} title="Details, features & README" style={s.iconBtn}><Info size={12} /></button>
                {installed ? (
                  <span style={{ ...s.chip, color: "var(--teal)" }}>Installed</span>
                ) : (
                  <button onClick={() => install(it)} disabled={busy === (it.rawName || it.id)} style={s.btnPrimary}>
                    <Download size={12} /> {busy === (it.rawName || it.id) ? "Installing…" : "Install"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

// ── Panel with tabs ─────────────────────────────────────────────────────────
const ExtensionsPanel = () => {
  const [tab, setTab] = useState(() => {
    try {
      const t = localStorage.getItem("ibx:extensionsTab") || "installed";
      return TABS.some((x) => x.id === t) ? t : "installed";
    } catch { return "installed"; }
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

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>Extensions <span style={s.badge}>{count}</span></div>
        <div style={{ display: "flex", gap: "var(--space-6)", alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={loadFolder} disabled={busy === "folder"} title="Load an unpacked extension folder (development)" style={s.btn}>
            <FolderOpen size={12} /> Load Folder
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
      {tab === "community" && <CommunityTab onInstalled={refreshCount} />}
      {tab === "browser" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ChromeSection />
        </div>
      )}
    </div>
  );
};

export default ExtensionsPanel;
