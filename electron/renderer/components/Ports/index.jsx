// Ports Panel — listening ports + Microsoft Dev Tunnels forwarding
import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Search, RefreshCw, ExternalLink, Copy, Square, X,
  Cloud, CloudOff, Globe, Loader2, ShieldCheck, LogOut, Check, RadioTower,
} from "lucide-react";

const s = {
  wrap: { position: "relative", display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", color: "var(--text-bright)", overflow: "hidden", fontFamily: "var(--font-system)" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-6) var(--space-10)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0, gap: "var(--space-10)" },
  title: { fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-soft)", display: "flex", alignItems: "center", gap: "var(--space-8)" },
  badge: { fontSize: "var(--fs-small)", background: "var(--border-light)", color: "var(--text-inverse)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-pill)", fontWeight: "var(--fw-bold)", minWidth: 18, textAlign: "center" },
  btnGhost: { background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-bright)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-10)", fontSize: "var(--fs-small)", cursor: "pointer" },
  iconBtn: { background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-soft)", cursor: "pointer", padding: "var(--space-4) var(--space-8)", borderRadius: "var(--radius-md)", fontSize: "var(--fs-body)", lineHeight: "var(--lh-flat)" },
  input: { background: "var(--bg-vscode)", border: "1px solid var(--border-light)", color: "var(--text-input)", borderRadius: "var(--radius-md)", padding: "var(--space-5) var(--space-8) var(--space-5) 26px", fontSize: "var(--fs-body)", outline: "none", width: "100%" },
  th: { fontSize: "var(--fs-tiny)", fontWeight: "var(--fw-bold)", letterSpacing: 0.4, textTransform: "uppercase", color: "var(--icon)", padding: "var(--space-6) var(--space-10)", borderBottom: "var(--space-1) solid var(--bg-active)", background: "var(--bg-vscode)", display: "flex", gap: "var(--space-8)" },
  row: { display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-6) var(--space-10)", fontSize: "var(--fs-body)", borderBottom: "var(--space-1) solid var(--border-row)" },
  act: (color, bg, border) => ({ width: 22, height: 22, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: bg || "var(--bg-active)", border: "1px solid " + (border || "var(--border-light)"), borderRadius: 4, color: color || "var(--text-soft)", cursor: "pointer", flexShrink: 0 }),
  chip: { display: "flex", alignItems: "center", gap: 5, background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-soft)", borderRadius: "var(--radius-md)", padding: "3px 7px", fontSize: "var(--fs-small)", cursor: "pointer" },
  pop: { position: "absolute", top: 36, right: 8, width: 330, maxWidth: "calc(100% - 16px)", maxHeight: "calc(100% - 44px)", background: "var(--bg-raised)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-lg)", boxShadow: "0 18px 50px rgba(0,0,0,.55)", zIndex: 40, display: "flex", flexDirection: "column", overflow: "hidden" },
  popHead: { display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border-row)", fontSize: "var(--fs-small-plus, 12px)", fontWeight: 700, color: "var(--text-bright)", flexShrink: 0 },
  popBody: { padding: 10, display: "flex", flexDirection: "column", gap: 10, flex: "1 1 auto", minHeight: 0, overflowY: "auto" },
  sec: { fontSize: "var(--fs-tiny)", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 },
  box: { border: "1px solid var(--border-row)", borderRadius: "var(--radius-md)", padding: 8, background: "var(--bg-vscode)", display: "flex", flexDirection: "column", gap: 6 },
  small: { fontSize: "var(--fs-tiny)", color: "var(--text-muted)", lineHeight: 1.45 },
  primary: { display: "flex", alignItems: "center", justifyContent: "center", gap: 5, background: "var(--editor-blue)", border: "1px solid var(--editor-blue)", color: "var(--text-inverse)", borderRadius: "var(--radius-md)", padding: "5px 8px", fontSize: "var(--fs-small)", cursor: "pointer", fontWeight: 600 },
  mono: { fontFamily: "var(--font-code)", fontSize: "var(--fs-tiny)", background: "var(--bg-surface)", border: "1px solid var(--border-row)", borderRadius: 4, padding: "5px 6px", color: "var(--text-soft)", wordBreak: "break-all", userSelect: "all" },
  tunnelRow: { display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", border: "1px solid var(--border-row)", borderRadius: 4, background: "var(--bg-surface)" },
  link: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-code)", fontSize: "var(--fs-tiny)", color: "var(--teal)", cursor: "pointer" },
};

function stateColor(p) {
  if (p.state === "DETECTED") return "var(--code-blue)";
  return "var(--teal)";
}

const DEFAULT_TUN = { cli: null, user: null, tunnels: [], loginInProgress: false };

const PortsPanel = () => {
  const [ports, setPorts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tun, setTun] = useState(DEFAULT_TUN);
  const [tunOpen, setTunOpen] = useState(false);
  const [tunBusy, setTunBusy] = useState({});
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginPrompt, setLoginPrompt] = useState(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [manualPort, setManualPort] = useState("");
  const [publicAccess, setPublicAccess] = useState(() => {
    try { return localStorage.getItem("ports:tunnelPublic") === "true"; } catch { return false; }
  });
  const [showProjectOnly, setShowProjectOnly] = useState(() => {
    try { const v = localStorage.getItem("ports:projectOnly"); return v === null ? true : v !== "false"; } catch { return true; }
  });
  const [projectPath, setProjectPath] = useState(() => {
    try { return window.__currentProjectPath || null; } catch { return null; }
  });
  const busyRef = useRef(false);

  const showToast = useCallback((text, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 2600);
  }, []);

  const fetchPorts = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (!window.electronAPI?.getPorts) { setError("Port Manager not available"); if (!silent) setLoading(false); busyRef.current = false; return; }
      const list = await window.electronAPI.getPorts();
      setPorts(Array.isArray(list) ? list : []);
      setError(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      busyRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  const refreshTunnels = useCallback(async () => {
    if (!window.electronAPI?.devTunnelsStatus) return;
    try {
      const st = await window.electronAPI.devTunnelsStatus();
      if (st) setTun({ ...DEFAULT_TUN, ...st });
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("ports:projectOnly", String(showProjectOnly)); } catch {}
  }, [showProjectOnly]);

  useEffect(() => {
    try { localStorage.setItem("ports:tunnelPublic", String(publicAccess)); } catch {}
  }, [publicAccess]);

  useEffect(() => {
    const onOpened = (e) => setProjectPath(e.detail?.path || window.__currentProjectPath || null);
    const onClosed = () => setProjectPath(null);
    window.addEventListener("project:opened", onOpened);
    window.addEventListener("project:closed", onClosed);
    const u1 = window.electronAPI?.onMenuEvent ? window.electronAPI.onMenuEvent("menu:openProject", (p) => setProjectPath(p)) : () => {};
    const u2 = window.electronAPI?.onMenuEvent ? window.electronAPI.onMenuEvent("menu:closeProject", () => setProjectPath(null)) : () => {};
    return () => {
      window.removeEventListener("project:opened", onOpened);
      window.removeEventListener("project:closed", onClosed);
      try { u1(); } catch {}
      try { u2(); } catch {}
    };
  }, []);

  useEffect(() => {
    fetchPorts(false);
    const iv = setInterval(() => { if (!document.hidden) fetchPorts(true); }, 2500);
    const onVis = () => { if (!document.hidden) fetchPorts(true); };
    document.addEventListener("visibilitychange", onVis);
    const onFocus = () => fetchPorts(true);
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onFocus); };
  }, [fetchPorts]);

  useEffect(() => {
    refreshTunnels();
    const iv = setInterval(() => { if (!document.hidden) refreshTunnels(); }, 5000);
    return () => clearInterval(iv);
  }, [refreshTunnels]);

  useEffect(() => {
    if (!window.electronAPI?.onDevTunnelsEvent) return;
    const off = window.electronAPI.onDevTunnelsEvent((evt) => {
      if (!evt) return;
      if (evt.type === "login-prompt") {
        setLoginPrompt(evt);
      } else if (evt.type === "login-done") {
        setLoginPrompt(null);
        setLoginBusy(false);
        showToast("Signed in to Microsoft Dev Tunnels");
        refreshTunnels();
      } else if (evt.type === "login-error") {
        setLoginPrompt(null);
        setLoginBusy(false);
        showToast(evt.message || "Sign-in failed", true);
        refreshTunnels();
      } else if (evt.type === "user") {
        refreshTunnels();
      } else if (evt.type === "host-started" || evt.type === "host-exit" || evt.type === "stopped") {
        refreshTunnels();
      }
    });
    return () => { try { off(); } catch {} };
  }, [refreshTunnels, showToast]);

  const tunnelByPort = useMemo(() => {
    const m = new Map();
    for (const t of tun.tunnels || []) m.set(t.port, t);
    return m;
  }, [tun.tunnels]);
  const signedIn = !!tun.user?.signedIn;
  const cliInstalled = !!tun.cli?.installed;

  const isProjectPort = useCallback((p) => {
    if (!showProjectOnly) return true;
    if (!projectPath) return true;
    if (p.source === "liveServer" || p.source === "terminal") return true;
    const devRe = /(node|npm|yarn|pnpm|bun|deno|vite|next|nuxt|remix|svelte|astro|webpack|parcel|esbuild|turbo|ts-node|nodemon|python|python3|uvicorn|gunicorn|flask|django|java|mvn|gradle|spring|go|php|ruby|rails|cargo|rustc|dotnet|electron)/i;
    const name = (p.process || "").replace(/\.exe$/i, "");
    if (devRe.test(name)) return true;
    if (p.command && devRe.test(p.command)) return true;
    try {
      const proj = projectPath;
      if (proj && p.command) {
        const lowCmd = p.command.toLowerCase();
        const lowProj = proj.toLowerCase().replace(/\\/g, "/");
        if (lowCmd.includes(lowProj)) return true;
        const base = proj.split(/[\\/]/).pop()?.toLowerCase();
        if (base && base.length >= 4 && lowCmd.includes(base)) return true;
      }
    } catch {}
    return false;
  }, [showProjectOnly, projectPath]);

  const filtered = useMemo(() => {
    let list = ports;
    if (showProjectOnly) list = list.filter(isProjectPort);
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => String(p.port).includes(q) || (p.process || "").toLowerCase().includes(q) || tunnelByPort.has(p.port));
  }, [ports, filter, isProjectPort, showProjectOnly, tunnelByPort]);

  const openInBrowser = useCallback((port, url) => {
    const target = url || `http://localhost:${port}`;
    window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: target, config: { type: "browser", title: url ? `tunnel:${port}` : `localhost:${port}`, url: target } } }));
  }, []);

  const copyText = useCallback(async (text) => {
    try {
      if (window.electronAPI?.clipboardWrite) await window.electronAPI.clipboardWrite(text);
      else await navigator.clipboard.writeText(text);
      showToast(`Copied ${text}`);
    } catch { showToast("Copy failed", true); }
  }, [showToast]);

  const copyUrl = useCallback((port) => {
    const t = tunnelByPort.get(port);
    copyText(t?.url || `http://localhost:${port}`);
  }, [copyText, tunnelByPort]);

  const handleKill = useCallback(async (p) => {
    if (!p.pid) { showToast("No PID", true); return; }
    const ok = await window.electronAPI.confirmDialog(`Stop process on port ${p.port}?\n${p.process || ""} (PID ${p.pid})`);
    if (!ok) return;
    try {
      const r = await window.electronAPI.killPort(p.pid);
      if (r?.ok) { showToast(`Stopped :${p.port}`); setTimeout(() => fetchPorts(true), 700); }
      else showToast(r?.error || "Kill failed", true);
    } catch (e) { showToast(e?.message || String(e), true); }
  }, [fetchPorts, showToast]);

  const startTunnel = useCallback(async (port) => {
    const api = window.electronAPI;
    if (!api?.devTunnelsStart) { showToast("Dev Tunnels bridge unavailable — rebuild the app", true); return; }
    if (!cliInstalled) {
      setTunOpen(true);
      showToast("Install the Microsoft Dev Tunnels CLI first", true);
      return;
    }
    if (!signedIn) {
      setTunOpen(true);
      showToast("Sign in to Microsoft Dev Tunnels first", true);
      return;
    }
    if (publicAccess) {
      const ok = await api.confirmDialog(`Expose localhost:${port} to the internet?\n\nAnyone who gets the tunnel link can reach your local server until the tunnel is stopped.`);
      if (!ok) return;
    }
    setTunBusy((b) => ({ ...b, [port]: true }));
    try {
      const r = await api.devTunnelsStart(port, { anonymous: publicAccess });
      if (r?.ok && r.url) showToast(`Tunnel ready :${port}`);
      else if (r?.error === "cli-missing") { setTunOpen(true); showToast("Dev Tunnels CLI not found", true); }
      else if (r?.error === "not-signed-in") { setTunOpen(true); showToast("Sign in to Microsoft Dev Tunnels first", true); }
      else showToast(r?.error || "Tunnel failed to start", true);
    } catch (e) {
      showToast(e?.message || String(e), true);
    } finally {
      setTunBusy((b) => { const n = { ...b }; delete n[port]; return n; });
      refreshTunnels();
    }
  }, [cliInstalled, publicAccess, refreshTunnels, showToast, signedIn]);

  const stopTunnel = useCallback(async (port) => {
    try {
      await window.electronAPI.devTunnelsStop(port);
      showToast(`Tunnel stopped :${port}`);
    } catch (e) {
      showToast(e?.message || String(e), true);
    }
    refreshTunnels();
  }, [refreshTunnels, showToast]);

  const toggleTunnel = useCallback((port) => {
    if (tunnelByPort.has(port)) return stopTunnel(port);
    return startTunnel(port);
  }, [startTunnel, stopTunnel, tunnelByPort]);

  const handleLogin = useCallback(async (provider) => {
    if (!window.electronAPI?.devTunnelsLogin) return;
    setLoginPrompt(null);
    const r = await window.electronAPI.devTunnelsLogin(provider);
    if (!r?.ok) {
      showToast(r?.error === "cli-missing" ? "Install the devtunnel CLI first" : (r?.error || "Could not start sign-in"), true);
      return;
    }
    setLoginBusy(true);
  }, [showToast]);

  const handleLogout = useCallback(async () => {
    const ok = await window.electronAPI.confirmDialog("Sign out of Microsoft Dev Tunnels?\nAll active tunnels will stop.");
    if (!ok) return;
    setLoginBusy(false);
    setLoginPrompt(null);
    const r = await window.electronAPI.devTunnelsLogout();
    if (r?.ok) showToast("Signed out");
    else showToast(r?.error || "Sign out failed", true);
    refreshTunnels();
  }, [refreshTunnels, showToast]);

  const handleInstall = useCallback(async () => {
    if (!window.electronAPI?.devTunnelsInstall) return;
    setInstallBusy(true);
    try {
      const r = await window.electronAPI.devTunnelsInstall();
      if (r?.cli?.installed) showToast(`Dev Tunnels CLI installed${r.cli.version ? " — " + r.cli.version : ""}`);
      else showToast(r?.error || "Install failed", true);
    } catch (e) {
      showToast(e?.message || String(e), true);
    } finally {
      setInstallBusy(false);
      refreshTunnels();
    }
  }, [refreshTunnels, showToast]);

  const forwardManual = useCallback(() => {
    const n = parseInt(manualPort, 10);
    if (!n || n < 1 || n > 65535) { showToast("Enter a port between 1 and 65535", true); return; }
    setManualPort("");
    if (tunnelByPort.has(n)) stopTunnel(n);
    else startTunnel(n);
  }, [manualPort, showToast, startTunnel, stopTunnel, tunnelByPort]);

  const activeCount = (tun.tunnels || []).length;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>Ports <span style={s.badge}>{filtered.length}</span></div>
        <div style={{ display: "flex", gap: "var(--space-8)", alignItems: "center" }}>
          <button
            onClick={() => setTunOpen((v) => !v)}
            title="Microsoft Dev Tunnels — forward local ports publicly"
            style={{ ...s.chip, color: tunOpen ? "var(--text-bright)" : undefined, borderColor: activeCount ? "var(--teal)" : undefined }}
          >
            {cliInstalled ? <Cloud size={12} style={{ color: activeCount ? "var(--teal)" : "var(--text-soft)" }} /> : <CloudOff size={12} style={{ color: "var(--warning)" }} />}
            <span>Dev Tunnels</span>
            {activeCount > 0 && (
              <span style={{ background: "var(--teal)", color: "var(--text-inverse)", borderRadius: "var(--radius-pill)", padding: "0 5px", fontSize: "var(--fs-tiny)", fontWeight: 700 }}>{activeCount}</span>
            )}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", fontSize: "var(--fs-small)", color: "var(--text-soft)", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={showProjectOnly} onChange={(e) => setShowProjectOnly(e.target.checked)} style={{ accentColor: "var(--editor-blue)" }} />
            Current project only
          </label>
          <button onClick={() => { fetchPorts(false); refreshTunnels(); }} title="Refresh" style={{ ...s.iconBtn, display: "flex", alignItems: "center", justifyContent: "center" }}><RefreshCw size={12} /></button>
        </div>
      </div>

      {tunOpen && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onMouseDown={() => setTunOpen(false)} />
          <div style={s.pop} role="dialog" aria-label="Microsoft Dev Tunnels">
            <div style={s.popHead}>
              <Cloud size={13} style={{ color: "var(--teal)" }} />
              <span style={{ flex: 1 }}>Microsoft Dev Tunnels</span>
              <button onClick={() => setTunOpen(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2, display: "flex" }} title="Close"><X size={13} /></button>
            </div>
            <div style={s.popBody}>
              {!cliInstalled ? (
                <div style={{ ...s.box, borderColor: "var(--warning)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-small)", color: "var(--text-bright)", fontWeight: 600 }}>
                    <CloudOff size={13} style={{ color: "var(--warning)" }} /> Dev Tunnels CLI not installed
                  </div>
                  <div style={s.small}>Install Microsoft's official CLI, then sign in from this panel. No keys or tokens are handled by Idiot Box.</div>
                  <div style={s.mono}>{tun.cli?.install?.command || "winget install --id Microsoft.devtunnel -e"}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {window.electronAPI?.devTunnelsInstall && /win/i.test(navigator.platform) && (
                      <button onClick={handleInstall} disabled={installBusy} style={{ ...s.primary, flex: 1, opacity: installBusy ? 0.7 : 1 }}>
                        {installBusy ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={12} />}
                        {installBusy ? "Installing…" : "Install with winget"}
                      </button>
                    )}
                    <button
                      onClick={() => window.electronAPI?.openUrl?.(tun.cli?.install?.docs || "https://learn.microsoft.com/azure/developer/dev-tunnels/get-started")}
                      style={{ ...s.btnGhost, flex: 1 }}
                    >Docs</button>
                  </div>
                </div>
              ) : (
                <div style={s.box}>
                  <div style={s.sec}>Account</div>
                  {signedIn ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <ShieldCheck size={13} style={{ color: "var(--teal)", flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--fs-small)", color: "var(--text-bright)" }} title={tun.user?.username || ""}>
                        {tun.user?.username || "Signed in"}
                      </span>
                      <button onClick={handleLogout} title="Sign out" style={s.act("var(--text-soft)")}><LogOut size={12} /></button>
                    </div>
                  ) : loginBusy ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-small)", color: "var(--text-soft)" }}>
                      <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Waiting for sign-in in your browser…
                    </div>
                  ) : (
                    <>
                      <div style={s.small}>Sign in with your own account. The CLI handles the device-code flow — Idiot Box never stores credentials.</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => handleLogin("microsoft")} style={{ ...s.primary, flex: 1 }}>Microsoft</button>
                        <button onClick={() => handleLogin("github")} style={{ ...s.btnGhost, flex: 1 }}>GitHub</button>
                      </div>
                    </>
                  )}
                  {loginPrompt && (
                    <div style={{ ...s.box, borderColor: "var(--teal)", background: "var(--bg-surface)" }}>
                      <div style={s.small}>Enter this code on the sign-in page:</div>
                      <div style={{ fontFamily: "var(--font-code)", fontSize: 18, letterSpacing: 2, fontWeight: 700, color: "var(--teal)" }}>{loginPrompt.code || "…"}</div>
                      <button
                        onClick={() => window.electronAPI?.openUrl?.(loginPrompt.url || "https://microsoft.com/devicelogin")}
                        style={s.primary}
                      >
                        <ExternalLink size={12} /> Open sign-in page
                      </button>
                      {loginPrompt.url && <div style={s.mono}>{loginPrompt.url}</div>}
                    </div>
                  )}
                  <div style={{ ...s.small, display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: "var(--text-disabled)" }}>CLI</span>
                    <span style={{ fontFamily: "var(--font-code)" }}>{tun.cli?.version || "devtunnel"}</span>
                  </div>
                </div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-small)", color: "var(--text-soft)", cursor: "pointer", userSelect: "none" }}>
                <input type="checkbox" checked={publicAccess} onChange={(e) => setPublicAccess(e.target.checked)} style={{ accentColor: "var(--editor-blue)" }} />
                Public access (anonymous)
                <span style={s.small}>(anyone with the link)</span>
              </label>

              {cliInstalled && (
                <div>
                  <div style={s.sec}>Forward a port</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={manualPort}
                      onChange={(e) => setManualPort(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
                      onKeyDown={(e) => { if (e.key === "Enter") forwardManual(); }}
                      placeholder="e.g. 3000"
                      inputMode="numeric"
                      style={{ ...s.input, padding: "5px 8px", fontFamily: "var(--font-code)", flex: 1 }}
                    />
                    <button onClick={forwardManual} style={{ ...s.primary, flexShrink: 0 }}><Globe size={12} /> Forward</button>
                  </div>
                </div>
              )}

              <div>
                <div style={s.sec}>Active tunnels</div>
                {activeCount === 0 ? (
                  <div style={s.small}>No tunnels running. Use the globe button on a port row.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {(tun.tunnels || []).map((t) => (
                      <div key={t.port} style={s.tunnelRow}>
                        <RadioTower size={11} style={{ color: "var(--teal)", flexShrink: 0 }} />
                        <span style={{ fontFamily: "var(--font-code)", fontSize: "var(--fs-tiny)", color: "var(--text-soft)", flexShrink: 0 }}>:{t.port}</span>
                        <span style={s.link} title={t.url} onClick={() => copyText(t.url)}>{t.url.replace(/^https?:\/\//, "")}</span>
                        {t.anonymous && <span style={{ ...s.small, color: "var(--warning)", flexShrink: 0 }}>public</span>}
                        <button onClick={() => copyText(t.url)} title="Copy public URL" style={s.act()}><Copy size={11} /></button>
                        <button onClick={() => openInBrowser(t.port, t.url)} title="Open in Browser" style={s.act("var(--text-inverse)", "var(--select-blue)", "var(--editor-blue)")}><ExternalLink size={11} /></button>
                        <button onClick={() => stopTunnel(t.port)} title="Stop tunnel" style={s.act("var(--danger)")}><Square size={9} fill="currentColor" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ ...s.small, borderTop: "1px solid var(--border-row)", paddingTop: 8 }}>
                Auth is handled by the official devtunnel CLI in your browser. Idiot Box never sees or stores your account credentials.
              </div>
            </div>
          </div>
        </>
      )}

      <div style={{ padding: "var(--space-6) var(--space-8)", borderBottom: "var(--space-1) solid var(--border-row)", display: "flex", gap: "var(--space-6)", background: "var(--bg-surface)" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={12} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" style={s.input} />
        </div>
        {filter && <button onClick={() => setFilter("")} style={{ ...s.btnGhost, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={12} /></button>}
      </div>

      {error && <div style={{ margin: "var(--space-8)", padding: "var(--space-8) var(--space-10)", background: "var(--error-bg-solid)", border: "var(--space-1) solid var(--error-border-3)", borderRadius: "var(--radius-md)", color: "var(--error-text-soft)", fontSize: "var(--fs-small)" }}>{error}</div>}
      {toast && <div style={{ margin: error ? "0 var(--space-8) var(--space-8)" : "var(--space-8)", padding: "var(--space-6) var(--space-10)", background: toast.isError ? "var(--error-bg-solid)" : "var(--success-bg)", border: "var(--space-1) solid " + (toast.isError ? "var(--error-border-3)" : "var(--success-border-2)"), borderRadius: "var(--radius-md)", color: toast.isError ? "var(--error-text-soft)" : "var(--teal)", fontSize: "var(--fs-small)" }}>{toast.text}</div>}

      <div style={s.th}>
        <span style={{ flex: "0 0 80px" }}>Port</span>
        <span style={{ flex: 1 }}>Process</span>
        <span style={{ flex: "0 0 110px", textAlign: "right" }}>Actions</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && filtered.length === 0 && <div style={{ padding: "var(--space-20)", color: "var(--text-muted)", fontSize: "var(--fs-body)", textAlign: "center" }}>Loading…</div>}
        {!loading && filtered.length === 0 && !error && (
          <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>
            <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-secondary)", marginBottom: "var(--space-6)" }}>{showProjectOnly && projectPath ? "No project ports" : "No ports"}</div>
            <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-small)" }}>{showProjectOnly && projectPath ? "No ports for current project" : "No ports detected"}</div>
            <div style={{ display: "flex", gap: "var(--space-8)", justifyContent: "center", marginTop: "var(--space-12)" }}>
              <button onClick={() => fetchPorts(false)} style={s.btnGhost}>Refresh</button>
              <button onClick={() => setTunOpen(true)} style={{ ...s.btnGhost, display: "flex", alignItems: "center", gap: 5 }}><Globe size={12} /> Forward a port</button>
            </div>
          </div>
        )}
        {filtered.map((p) => {
          const isSel = selected === p.port;
          const col = stateColor(p);
          const t = tunnelByPort.get(p.port);
          const busy = !!tunBusy[p.port];
          return (
            <React.Fragment key={String(p.port) + ":" + String(p.pid || "")}>
              <div
                onClick={() => setSelected(p.port)}
                onDoubleClick={() => openInBrowser(p.port, t?.url)}
                style={{ ...s.row, background: isSel ? "var(--bg-hover-strong)" : "transparent", cursor: "pointer", borderLeft: `3px solid ${isSel ? col : "transparent"}`, paddingLeft: isSel ? "7px" : "10px" }}
              >
                <span style={{ flex: "0 0 80px", fontFamily: "var(--font-code)", fontWeight: "var(--fw-bold)", color: "var(--teal)", display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
                  <span style={{ width: 7, height: 7, borderRadius: "var(--radius-round)", background: col, flexShrink: 0 }} />:{p.port}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-bright)" }} title={p.process}>{p.process || "—"}</span>
                <span style={{ flex: "0 0 110px", display: "flex", gap: "var(--space-4)", justifyContent: "flex-end" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleTunnel(p.port); }}
                    title={t ? `Stop tunnel :${p.port}` : "Forward with Microsoft Dev Tunnels"}
                    style={s.act(t ? "var(--teal)" : "var(--text-soft)", t ? "rgba(20,184,166,0.14)" : undefined, t ? "var(--teal)" : undefined)}
                  >
                    {busy ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : t ? <RadioTower size={11} /> : <Globe size={11} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openInBrowser(p.port, t?.url); }} title={t ? "Open tunnel URL" : "Open in Browser"} style={s.act("var(--text-inverse)", "var(--select-blue)", "var(--editor-blue)")}><ExternalLink size={11} /></button>
                  <button onClick={(e) => { e.stopPropagation(); copyUrl(p.port); }} title={t ? "Copy tunnel URL" : "Copy URL"} style={s.act()}><Copy size={11} /></button>
                  {p.pid ? <button onClick={(e) => { e.stopPropagation(); handleKill(p); }} title="Stop process" style={s.act("var(--danger)")}><Square size={9} fill="currentColor" /></button> : null}
                </span>
              </div>
              {t && (
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", padding: "3px 10px 5px 93px", borderBottom: "var(--space-1) solid var(--border-row)", background: "rgba(20,184,166,0.07)" }}>
                  <RadioTower size={10} style={{ color: "var(--teal)", flexShrink: 0 }} />
                  <span
                    onClick={(e) => { e.stopPropagation(); copyText(t.url); }}
                    title="Click to copy the public URL"
                    style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--font-code)", fontSize: "var(--fs-tiny)", color: "var(--teal)", cursor: "pointer" }}
                  >{t.url.replace(/^https?:\/\//, "")}</span>
                  <span style={{ fontSize: "var(--fs-tiny)", color: t.anonymous ? "var(--warning)" : "var(--text-muted)", flexShrink: 0 }}>{t.anonymous ? "public" : "private"}</span>
                  <button onClick={(e) => { e.stopPropagation(); copyText(t.url); }} title="Copy public URL" style={{ ...s.act(), width: 20, height: 20 }}><Copy size={10} /></button>
                  <button onClick={(e) => { e.stopPropagation(); stopTunnel(t.port); }} title="Stop tunnel" style={{ ...s.act("var(--danger)"), width: 20, height: 20 }}><Square size={8} fill="currentColor" /></button>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default PortsPanel;
