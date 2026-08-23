// Git Panel — VS Code style: branch, commit box, staged/changes/untracked, diff, log
import React, { useEffect, useState, useCallback, useMemo } from "react";

const s = {
  wrap: { display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", color: "#cccccc", overflow: "hidden", fontFamily: "'Segoe UI',system-ui,sans-serif" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0, gap: 8 },
  headerLeft: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  branchBadge: { display: "flex", alignItems: "center", gap: 6, background: "#094771", color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 },
  countPill: (active) => ({ fontSize: 10, background: active ? "#0e639c" : "#2d2d2d", color: active ? "#fff" : "#888", padding: "2px 6px", borderRadius: 10, fontWeight: 600 }),
  btn: { background: "#0e639c", color: "#fff", border: "none", borderRadius: 3, padding: "5px 10px", fontSize: 11, cursor: "pointer", fontWeight: 600 },
  btnGhost: { background: "transparent", border: "1px solid #3a3a3a", color: "#cccccc", borderRadius: 3, padding: "4px 8px", fontSize: 11, cursor: "pointer" },
  iconBtn: { background: "transparent", border: "none", color: "#888", cursor: "pointer", padding: "3px 5px", borderRadius: 3, fontSize: 13, lineHeight: 1 },
  input: { width: "100%", background: "#3c3c3c", border: "1px solid #3c3c3c", color: "#cccccc", borderRadius: 3, padding: "6px 8px", fontSize: 12, outline: "none", resize: "none", fontFamily: "inherit" },
  sectionHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", background: "#252526", borderTop: "1px solid #2d2d2d", borderBottom: "1px solid #2d2d2d", fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "#bbbbbb", cursor: "pointer", userSelect: "none" },
  row: { display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid #232323" },
  statusBox: (c) => ({ width: 20, textAlign: "center", fontSize: 10, fontWeight: 800, color: c, background: "#2d2d2d", padding: "2px 3px", borderRadius: 2, flexShrink: 0, letterSpacing: 0.3 }),
};

function StatusColor(st) {
  if (st === "??") return "#73c991";
  if (st.includes("A")) return "#73c991";
  if (st.includes("D")) return "#f44747";
  if (st.includes("M")) return "#cca700";
  if (st.includes("R")) return "#569cd6";
  if (st.trim() === "U") return "#f15050";
  return "#888";
}
function StatusLabel(st, x, y) {
  if (st === "??") return "Untracked";
  if (x === "A" || y === "A") return "Added";
  if (x === "D" || y === "D") return "Deleted";
  if (x === "R" || y === "R") return "Renamed";
  if (st.trim() === "M" || st === "MM") return "Modified";
  if (x !== " " && x !== "?" && x !== "!") return "Staged";
  return st.trim() || "Changed";
}

const GitPanel = () => {
  const [projectPath, setProjectPath] = useState(window.__currentProjectPath || null);
  const [status, setStatus] = useState([]);
  const [branchInfo, setBranchInfo] = useState({ branch: "", isRepo: true, ahead: 0, behind: 0 });
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("");
  const [diffMap, setDiffMap] = useState({}); // rel -> diff text or null
  const [openDiff, setOpenDiff] = useState(null); // rel currently expanded
  const [busy, setBusy] = useState(""); // action key
  const [showLog, setShowLog] = useState(false);
  const [collapsed, setCollapsed] = useState({ staged: false, changes: false, untracked: false });

  // project path watcher
  useEffect(() => {
    const onOpen = (e) => setProjectPath(e.detail?.path || window.__currentProjectPath || null);
    const onClose = () => setProjectPath(null);
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    const iv = setInterval(() => {
      const cur = window.__currentProjectPath || null;
      setProjectPath((prev) => (prev !== cur ? cur : prev));
    }, 1000);
    const onRefresh = () => refresh();
    window.addEventListener("git:refresh", onRefresh);
    return () => {
      window.removeEventListener("project:opened", onOpen);
      window.removeEventListener("project:closed", onClose);
      window.removeEventListener("git:refresh", onRefresh);
      clearInterval(iv);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!projectPath) { setStatus([]); setBranchInfo({ branch: "", isRepo: true }); setLog([]); return; }
    setLoading(true);
    try {
      const [st, br, lg] = await Promise.all([
        window.electronAPI.gitStatus(projectPath).catch(() => []),
        window.electronAPI.gitBranch(projectPath).catch(() => ({ branch: "", isRepo: false })),
        window.electronAPI.gitLog(projectPath, 7).catch(() => []),
      ]);
      setStatus(Array.isArray(st) ? st : []);
      setBranchInfo(br || { branch: "", isRepo: true });
      setLog(Array.isArray(lg) ? lg : []);
    } catch {
      setStatus([]);
    } finally { setLoading(false); }
  }, [projectPath]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 7000);
    return () => clearInterval(iv);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return status;
    return status.filter((it) => it.rel.toLowerCase().includes(q));
  }, [status, filter]);

  // group by staged / changes / untracked
  const groups = useMemo(() => {
    const staged = [], changes = [], untracked = [];
    for (const it of filtered) {
      const st = it.status;
      const x = it.x ?? st[0], y = it.y ?? st[1];
      if (st === "??") untracked.push(it);
      else if (x && x !== " " && x !== "?" && x !== "!") staged.push(it);
      else if (y && y !== " " ) changes.push(it);
      else if (st.trim() === "") changes.push(it);
      else changes.push(it);
    }
    // also: files that are both staged and unstaged (MM) should appear in both? For simplicity show in Changes if y != ' '
    // Re-bucket MM where x staged and y unstaged -> show in both lists by duplicate? Instead prioritize staged list for x, changes for y duplication
    // We handle duplication: if MM, add to changes as well (second copy)
    const extraChanges = [];
    for (const it of filtered) {
      if (it.status === "MM" && !changes.includes(it) && !untracked.includes(it)) {
        // already in staged, also push a view in changes with marker
      }
    }
    return { staged, changes, untracked };
  }, [filtered]);

  const openFile = (rel) => {
    const full = projectPath ? `${projectPath}/${rel}`.replace(/\\/g, "/").replace(/\/\//g, "/") : rel;
    const normalized = full.replace(/\//g, "\\");
    window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: normalized } }));
  };

  const toggleDiff = async (rel) => {
    if (openDiff === rel) { setOpenDiff(null); return; }
    setOpenDiff(rel);
    if (diffMap[rel] !== undefined) return;
    try {
      const fullPath = projectPath ? `${projectPath}/${rel}`.replace(/\\/g, "/") : rel;
      const txt = await window.electronAPI.gitDiff(projectPath, fullPath);
      setDiffMap((m) => ({ ...m, [rel]: txt || "(no diff)" }));
    } catch { setDiffMap((m) => ({ ...m, [rel]: "(error)" })); }
  };

  const doStage = async (rel) => { setBusy(rel+":stage"); await window.electronAPI.gitStage(projectPath, rel); await refresh(); setBusy(""); };
  const doUnstage = async (rel) => { setBusy(rel+":unstage"); await window.electronAPI.gitUnstage(projectPath, rel); await refresh(); setBusy(""); };
  const doDiscard = async (rel) => {
    if (!confirm(`Discard changes in "${rel}"?`)) return;
    setBusy(rel+":discard"); await window.electronAPI.gitDiscard(projectPath, rel); await refresh(); setBusy("");
  };
  const doStageAll = async () => { setBusy("stageAll"); await window.electronAPI.gitStageAll(projectPath); await refresh(); setBusy(""); };
  const doUnstageAll = async () => { setBusy("unstageAll"); await window.electronAPI.gitUnstageAll(projectPath); await refresh(); setBusy(""); };
  const doCommit = async () => {
    if (!msg.trim()) return;
    setBusy("commit"); const r = await window.electronAPI.gitCommit(projectPath, msg.trim());
    if (r?.ok) { setMsg(""); await refresh(); } else { alert(r?.error || "Commit failed"); }
    setBusy("");
  };
  const doPush = async () => { setBusy("push"); await window.electronAPI.gitPush(projectPath); setBusy(""); refresh(); };
  const doPull = async () => { setBusy("pull"); await window.electronAPI.gitPull(projectPath); setBusy(""); refresh(); };
  const doFetch = async () => { setBusy("fetch"); await window.electronAPI.gitFetch(projectPath); setBusy(""); refresh(); };

  if (!projectPath) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666", fontSize: 12, flexDirection: "column", gap: 8, background: "#1e1e1e" }}>
        <span style={{ fontSize: 22 }}>⎇</span>
        <span>No project open</span>
        <span style={{ fontSize: 11, color: "#555" }}>Open a folder to see Git status</span>
      </div>
    );
  }
  if (branchInfo && branchInfo.isRepo === false) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", color: "#cccccc" }}>
        <div style={s.header}>
          <div style={s.headerLeft}><span style={{ fontSize: 12, fontWeight: 700 }}>Source Control</span></div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10, padding: 20, textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "#999" }}>Not a git repository</div>
          <div style={{ fontSize: 11, color: "#666" }}>{projectPath}</div>
          <button onClick={refresh} style={s.btnGhost}>Refresh</button>
        </div>
      </div>
    );
  }

  const total = status.length;

  return (
    <div style={s.wrap}>
      {/* Header: branch + sync */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.branchBadge} title={branchInfo.branch || "branch"}>
            <span style={{ fontSize: 12 }}>⎇</span>
            <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{branchInfo.branch || "HEAD"}</span>
            {(branchInfo.ahead || branchInfo.behind) ? <span style={{ background: "rgba(255,255,255,0.18)", padding: "0 5px", borderRadius: 8, fontSize: 10 }}>{branchInfo.ahead ? `↑${branchInfo.ahead}` : ""} {branchInfo.behind ? `↓${branchInfo.behind}` : ""}</span> : null}
          </div>
          <span style={s.countPill(total > 0)}>{total} changes</span>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button onClick={doFetch} disabled={!!busy} title="Fetch" style={s.iconBtn}>⟳</button>
          <button onClick={doPull} disabled={!!busy} title="Pull" style={s.iconBtn}>↓</button>
          <button onClick={doPush} disabled={!!busy} title="Push" style={s.iconBtn}>↑</button>
          <button onClick={refresh} disabled={loading} title="Refresh" style={{ ...s.iconBtn, opacity: loading ? 0.5 : 1 }}>{loading ? "…" : "↻"}</button>
        </div>
      </div>

      {/* Commit box */}
      <div style={{ padding: 10, borderBottom: "1px solid #2d2d2d", background: "#252526", flexShrink: 0 }}>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Message (Ctrl+Enter to commit)"
          rows={2}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doCommit(); } }}
          style={s.input}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
          <button onClick={doCommit} disabled={!msg.trim() || !!busy} style={{ ...s.btn, opacity: !msg.trim() ? 0.5 : 1, flex: 1 }}>
            {busy === "commit" ? "Committing…" : `Commit${groups.staged.length ? ` (${groups.staged.length})` : ""}`}
          </button>
          <button onClick={doStageAll} disabled={!groups.changes.length && !groups.untracked.length} style={s.btnGhost} title="Stage all changes">+ All</button>
        </div>
        {groups.staged.length > 0 && <div style={{ fontSize: 10, color: "#888", marginTop: 6 }}>{groups.staged.length} staged — will be included in commit</div>}
      </div>

      {/* Filter */}
      <div style={{ padding: "6px 8px", borderBottom: "1px solid #232323", display: "flex", gap: 6, flexShrink: 0 }}>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter changes…" style={{ ...s.input, padding: "4px 7px", fontSize: 11 }} />
        {filter && <button onClick={() => setFilter("")} style={s.btnGhost}>✕</button>}
      </div>

      {/* File lists */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {total === 0 && !loading && (
          <div style={{ textAlign: "center", padding: 28, color: "#666", fontSize: 12 }}>
            <div style={{ fontSize: 22, marginBottom: 8, color: "#4caf50" }}>✓</div>
            No changes<br />
            <span style={{ fontSize: 11, color: "#555" }}>Working tree clean</span>
            {log.length > 0 && <div style={{ marginTop: 14, fontSize: 11, color: "#777" }}>Last commit: {log[0]?.msg?.slice(0, 60)}</div>}
          </div>
        )}

        {/* Staged */}
        {groups.staged.length > 0 && (
          <div>
            <div style={s.sectionHead} onClick={() => setCollapsed((c) => ({ ...c, staged: !c.staged }))}>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ transform: collapsed.staged ? "rotate(-90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.15s" }}>▼</span> Staged Changes <span style={{ background: "#0e639c", color: "#fff", padding: "1px 5px", borderRadius: 10, fontSize: 10 }}>{groups.staged.length}</span></span>
              <span style={{ display: "flex", gap: 4 }}>
                <button onClick={(e) => { e.stopPropagation(); doUnstageAll(); }} title="Unstage all" style={s.iconBtn}>—</button>
              </span>
            </div>
            {!collapsed.staged && groups.staged.map((it) => (
              <div key={"staged:"+it.rel}>
                <div style={s.row} onClick={() => openFile(it.rel)} title={it.rel} onMouseEnter={(e) => e.currentTarget.style.background = "#2a2d2e"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <span style={s.statusBox(StatusColor(it.status))}>{it.status.trim() || "S"}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.rel}</span>
                  <span style={{ display: "flex", gap: 2 }}>
                    <button onClick={(e) => { e.stopPropagation(); toggleDiff(it.rel); }} title="Diff" style={s.iconBtn}>◈</button>
                    <button onClick={(e) => { e.stopPropagation(); doUnstage(it.rel); }} disabled={busy.includes(it.rel)} title="Unstage" style={s.iconBtn}>−</button>
                  </span>
                </div>
                {openDiff === it.rel && (
                  <pre style={{ margin: 0, padding: "6px 8px", background: "#111", color: "#ccc", fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 160, overflow: "auto", borderBottom: "1px solid #232323" }}>{diffMap[it.rel] || "Loading…"}</pre>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Changes (unstaged) */}
        {(groups.changes.length > 0 || (total > 0 && groups.staged.length === 0)) && (
          <div>
            <div style={s.sectionHead} onClick={() => setCollapsed((c) => ({ ...c, changes: !c.changes }))}>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ transform: collapsed.changes ? "rotate(-90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.15s" }}>▼</span> Changes <span style={{ background: "#333", color: "#ccc", padding: "1px 5px", borderRadius: 10, fontSize: 10 }}>{groups.changes.length}</span></span>
              <span style={{ display: "flex", gap: 4 }}>
                <button onClick={(e) => { e.stopPropagation(); doStageAll(); }} title="Stage all" style={s.iconBtn}>+</button>
                <button onClick={(e) => { e.stopPropagation(); if (confirm("Discard all changes?")) { groups.changes.forEach((f) => window.electronAPI.gitDiscard(projectPath, f.rel)); setTimeout(refresh, 400); } }} title="Discard all" style={s.iconBtn}>↺</button>
              </span>
            </div>
            {!collapsed.changes && groups.changes.map((it) => (
              <div key={"chg:"+it.rel}>
                <div style={s.row} onClick={() => openFile(it.rel)} title={it.rel} onMouseEnter={(e) => e.currentTarget.style.background = "#2a2d2e"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <span style={s.statusBox(StatusColor(it.status))}>{it.status.trim() || "M"}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.rel}</span>
                  <span style={{ fontSize: 10, color: StatusColor(it.status), flexShrink: 0 }}>{StatusLabel(it.status, it.x, it.y)}</span>
                  <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <button onClick={(e) => { e.stopPropagation(); toggleDiff(it.rel); }} title="Diff" style={s.iconBtn}>◈</button>
                    <button onClick={(e) => { e.stopPropagation(); doStage(it.rel); }} title="Stage" style={s.iconBtn}>+</button>
                    <button onClick={(e) => { e.stopPropagation(); doDiscard(it.rel); }} title="Discard" style={s.iconBtn}>↺</button>
                  </span>
                </div>
                {openDiff === it.rel && (
                  <pre style={{ margin: 0, padding: "6px 8px", background: "#111", color: "#ccc", fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 160, overflow: "auto", borderBottom: "1px solid #232323" }}>{diffMap[it.rel] || "Loading…"}</pre>
                )}
              </div>
            ))}
            {!collapsed.changes && groups.changes.length === 0 && total > 0 && <div style={{ padding: "8px 12px", fontSize: 11, color: "#666" }}>No unstaged changes</div>}
          </div>
        )}

        {/* Untracked */}
        {groups.untracked.length > 0 && (
          <div>
            <div style={s.sectionHead} onClick={() => setCollapsed((c) => ({ ...c, untracked: !c.untracked }))}>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ transform: collapsed.untracked ? "rotate(-90deg)" : "rotate(0deg)", display: "inline-block", transition: "transform 0.15s" }}>▼</span> Untracked <span style={{ background: "#333", color: "#ccc", padding: "1px 5px", borderRadius: 10, fontSize: 10 }}>{groups.untracked.length}</span></span>
              <span><button onClick={(e) => { e.stopPropagation(); doStageAll(); }} title="Stage all untracked" style={s.iconBtn}>+</button></span>
            </div>
            {!collapsed.untracked && groups.untracked.map((it) => (
              <div key={"unt:"+it.rel} style={s.row} onClick={() => openFile(it.rel)} title={it.rel} onMouseEnter={(e) => e.currentTarget.style.background = "#2a2d2e"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                <span style={s.statusBox("#73c991")}>?</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.rel}</span>
                <span style={{ fontSize: 10, color: "#73c991" }}>Untracked</span>
                <span style={{ display: "flex", gap: 2 }}>
                  <button onClick={(e) => { e.stopPropagation(); doStage(it.rel); }} title="Stage" style={s.iconBtn}>+</button>
                  <button onClick={(e) => { e.stopPropagation(); doDiscard(it.rel); }} title="Delete / discard" style={s.iconBtn}>✕</button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Recent commits */}
        <div style={{ borderTop: "1px solid #2d2d2d", marginTop: 4 }}>
          <div style={{ ...s.sectionHead, background: "#1e1e1e" }} onClick={() => setShowLog((v) => !v)}>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}><span style={{ transform: showLog ? "rotate(0deg)" : "rotate(-90deg)", display: "inline-block", transition: "transform 0.15s" }}>▼</span> Recent Commits</span>
            <span style={{ fontSize: 10, color: "#666" }}>{log.length ? `${log.length}` : ""}</span>
          </div>
          {showLog && (
            <div>
              {log.length === 0 && <div style={{ padding: 12, fontSize: 11, color: "#666" }}>No commits yet</div>}
              {log.map((c) => (
                <div key={c.fullHash} style={{ padding: "6px 8px", borderBottom: "1px solid #232323", fontSize: 11 }} title={c.fullHash}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ color: "#569cd6", fontFamily: "monospace", fontSize: 10 }}>{c.hash}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#cccccc" }}>{c.msg}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#777", marginTop: 2 }}>{c.author} • {c.relTime}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* footer */}
      <div style={{ padding: "5px 10px", fontSize: 10, color: "#666", borderTop: "1px solid #2d2d2d", display: "flex", justifyContent: "space-between", flexShrink: 0, background: "#252526" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectPath.split(/[\\/]/).pop()}</span>
        <span>{branchInfo.branch ? `⎇ ${branchInfo.branch}` : ""} • {total} changes</span>
      </div>
    </div>
  );
};

export default GitPanel;
