// GitPanel — full-featured Source Control, production ready
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";

// ── helpers ──────────────────────────────────────────────────────────
function statusColor(st, x, y) {
  if (st === "??") return "var(--git-added)";
  if (x === "U" || y === "U" || (x==="A"&&y==="A") || (x==="D"&&y==="D")) return "var(--danger)";
  if (st.includes("A")) return "var(--git-added)";
  if (st.includes("D")) return "var(--danger)";
  if (st.includes("M")) return "var(--git-modified)";
  if (st.includes("R") || st.includes("C")) return "var(--code-blue)";
  if (st === "UU") return "var(--danger)";
  return "var(--icon)";
}
function statusLabel(st, x, y, it) {
  if (it?.conflicted) return "Conflicted";
  if (it?.partiallyStaged) return "Partially Staged";
  if (st === "??") return "Untracked";
  if (x==="R"||y==="R") return "Renamed";
  if (x==="C"||y==="C") return "Copied";
  if (x==="A"||y==="A") return "Added";
  if (x==="D"||y==="D") return "Deleted";
  if (st.trim()==="M" || st==="MM" || st==="AM") return "Modified";
  if (x!==" " && x!=="?" && x!=="!" && x!=="U") return "Staged";
  return st.trim() || "Changed";
}
function humanBranchError(m){
  if(!m) return "Git error";
  const s=String(m).toLowerCase();
  if(s.includes("would be overwritten")) return "Uncommitted changes would be overwritten — commit or stash first.";
  if(s.includes("already exists")) return "Branch already exists.";
  if(s.includes("not a valid branch")) return "Invalid branch name.";
  if(s.includes("cannot lock")) return "Git is busy — try again.";
  if(s.includes("branch not found")) return "Branch not found.";
  return m.slice(0,260);
}

// ── Git settings helper (was dead) ───────────────────────────────────────
const getGitOpts = (settings = {}) => {
  const g = settings.git || {};
  return {
    autoFetch: g.autoFetch === true || settings.gitAutoFetch === true,
    showGutter: g.showGutter !== false && settings.gitShowGutter !== false && g.enableGutter !== false && settings.gitEnableGutter !== false,
    confirmCommit: g.confirmCommit !== false && settings.gitConfirmCommit !== false,
    autoStash: g.autoStash === true || settings.gitAutoStash === true,
    showInlineBlame: g.showInlineBlame === true || settings.gitShowInlineBlame === true,
  };
};

// ── styles ───────────────────────────────────────────────────────────
const s = {
  wrap:{ display:"flex", flexDirection:"column", height:"100%", background:"var(--bg-surface)", color:"var(--text-bright)", overflow:"hidden", fontFamily:"var(--font-system)" },
  header:{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"var(--space-6) var(--space-8)", background:"var(--bg-vscode)", borderBottom:"var(--space-1) solid var(--bg-active)", flexShrink:0, gap:"var(--space-6)", flexWrap:"wrap" },
  branchBtn:{ display:"flex", alignItems:"center", gap:"var(--space-5)", background:"var(--select-blue)", color:"var(--text-inverse)", padding:"var(--space-4) 9px", borderRadius:"var(--radius-md)", fontSize:"var(--fs-small)", fontWeight:"var(--fw-bold)", maxWidth:165, border:"none", cursor:"pointer", minHeight:24 },
  pill:(active)=>({ fontSize:"var(--fs-tiny)", background:active?"var(--editor-blue)":"var(--bg-active)", color:active?"var(--text-inverse)":"var(--text-secondary)", padding:"var(--space-2) 7px", borderRadius:"var(--radius-pill)", fontWeight:"var(--fw-bold)", border:"var(--space-1) solid var(--bg-active)" }),
  btn:{ background:"var(--editor-blue)", color:"var(--text-inverse)", border:"1px solid var(--editor-blue)", borderRadius:"var(--radius-md)", padding:"var(--space-6) var(--space-12)", fontSize:"var(--fs-small)", cursor:"pointer", fontWeight:"var(--fw-bold)", display:"flex", alignItems:"center", gap:"var(--space-4)", justifyContent:"center" },
  btnGhost:{ background:"var(--bg-active)", border:"1px solid var(--border-light)", color:"var(--text-bright)", borderRadius:"var(--radius-md)", padding:"var(--space-5) var(--space-10)", fontSize:"var(--fs-small)", cursor:"pointer", fontWeight:"var(--fw-semibold)" },
  iconBtn:{ background:"var(--bg-active)", border:"1px solid var(--border-light)", color:"var(--text-soft)", cursor:"pointer", padding:"var(--space-3) var(--space-6)", borderRadius:"var(--radius-md)", fontSize:"var(--fs-small)", lineHeight:"var(--lh-flat)", display:"flex", alignItems:"center", justifyContent:"center", minWidth:24, minHeight:"var(--bar-h-sm)" },
  input:{ width:"100%", background:"var(--bg-input-strong)", border:"1px solid var(--border-strong)", color:"var(--text-input)", borderRadius:"var(--radius-md)", padding:"var(--space-6) var(--space-8)", fontSize:"var(--fs-body)", outline:"none", resize:"none", fontFamily:"inherit" },
  sectionHead:{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"var(--space-6) var(--space-8)", background:"var(--bg-vscode)", borderTop:"var(--space-1) solid var(--bg-active)", borderBottom:"var(--space-1) solid var(--bg-active)", fontSize:"var(--fs-small)", fontWeight:"var(--fw-extrabold)", letterSpacing:0.35, textTransform:"uppercase", color:"var(--text-soft)", cursor:"pointer", userSelect:"none" },
  row:{ display:"flex", alignItems:"center", gap:"var(--space-6)", padding:"var(--space-5) var(--space-8)", cursor:"pointer", fontSize:"var(--fs-body)", borderBottom:"var(--space-1) solid var(--border-row)" },
  statusBox:(c)=>({ minWidth:24, textAlign:"center", fontSize:"var(--fs-tiny)", fontWeight:"var(--fw-extrabold)", color:c, background:"var(--bg-surface)", border:"1px solid color-mix(in srgb, " + c + " 20%, transparent)", padding:"var(--space-2) var(--space-4)", borderRadius:"var(--radius-sm)", flexShrink:0, letterSpacing:0.2 }),
};

// ── commit context menu ───────────────────────────────────────────────
export default function GitPanel({ nodeId }){
  const [projectPath,setProjectPath]=useState(window.__currentProjectPath||null);
  const [status,setStatus]=useState([]);
  const [branchInfo,setBranchInfo]=useState({ branch:"", isRepo:true, ahead:0, behind:0, hasRemote:true });
  const [branches,setBranches]=useState({ local:[], remote:[], current:"" });
  const [conflicts,setConflicts]=useState([]);
  const [log,setLog]=useState([]);
  const [logQuery,setLogQuery]=useState("");
  const [filteredLog,setFilteredLog]=useState([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [toast,setToast]=useState(null);
  const [msg,setMsg]=useState("");
  const [filter,setFilter]=useState("");
  const [diffMap,setDiffMap]=useState({});
  const [openDiff,setOpenDiff]=useState(null);
  const [busy,setBusy]=useState("");
  const [showLog,setShowLog]=useState(false);
  const [showCommitDetail,setShowCommitDetail]=useState(null); // {hash,diff,stat,loading}
  const [collapsed,setCollapsed]=useState({ staged:false, changes:false, untracked:false, conflicts:false });
  const [lastRefresh,setLastRefresh]=useState(null);
  const [amend,setAmend]=useState(false);
  const [branchPickerOpen,setBranchPickerOpen]=useState(false);
  const [branchFilter,setBranchFilter]=useState("");
  const [newBranchName,setNewBranchName]=useState("");
  const [focusIdx,setFocusIdx]=useState(-1);
  const [ctxMenu,setCtxMenu]=useState(null); // {x,y, rel}
  const [gitOpts,setGitOpts]=useState(()=> getGitOpts({}));
  const refreshRef=useRef(0);
  const diffCacheRef=useRef(new Map());
  const listRef=useRef(null);

  const showToast=useCallback((text,isError=false)=>{ setToast({text,isError}); setTimeout(()=>setToast(null),3600); },[]);

  // project open/close tracking
  useEffect(()=>{
    const onOpen=(e)=>setProjectPath(e.detail?.path||window.__currentProjectPath||null);
    const onClose=()=>setProjectPath(null);
    window.addEventListener("project:opened",onOpen);
    window.addEventListener("project:closed",onClose);
    const iv=setInterval(()=>{ if(document.hidden) return; const cur=window.__currentProjectPath||null; setProjectPath(p=>p!==cur?cur:p); },4000);
    const onVis=()=>{ if(!document.hidden) doRefresh(); };
    let fsDebounce=null;
    const unsubFs=window.electronAPI?.onFsChange ? window.electronAPI.onFsChange(()=>{ clearTimeout(fsDebounce); fsDebounce=setTimeout(()=>{ if(!document.hidden) doRefresh(); },1300); }) : ()=>{};
    window.addEventListener("git:refresh", onVis);
    document.addEventListener("visibilitychange", onVis);
    const onEsc=(e)=>{ if(e.key==="Escape"){ setBranchPickerOpen(false); setCtxMenu(null); setShowCommitDetail(null);} };
    window.addEventListener("keydown", onEsc);
    const onClick=()=> setCtxMenu(null);
    window.addEventListener("click", onClick);
    return ()=>{ window.removeEventListener("project:opened",onOpen); window.removeEventListener("project:closed",onClose); window.removeEventListener("git:refresh",onVis); document.removeEventListener("visibilitychange",onVis); window.removeEventListener("keydown",onEsc); window.removeEventListener("click",onClick); clearInterval(iv); clearTimeout(fsDebounce); try{unsubFs();}catch{} };
  },[]);

  // ── Git settings live sync (was dead) ────────────────────────────────
  useEffect(()=>{
    window.electronAPI.readSettings().then((s)=> setGitOpts(getGitOpts(s||{}))).catch(()=>{});
    const apply=(patch)=>{
      if(!patch||typeof patch!=="object") return;
      const has = ["git","gitAutoFetch","gitShowGutter","gitEnableGutter","gitConfirmCommit","gitAutoStash","gitShowInlineBlame","autoFetch","showGutter","enableGutter","confirmCommit","autoStash","showInlineBlame"].some(k=>k in patch);
      if(!has) return;
      window.electronAPI.readSettings().then((s)=> setGitOpts(getGitOpts(s||{}))).catch(()=>{});
    };
    let bc;
    try{ bc=new BroadcastChannel("git-settings"); bc.onmessage=(e)=> apply(e.data); }catch{}
    let unsub;
    try{ unsub=window.electronAPI.onSettingsUpdated(apply); }catch{}
    return ()=>{ try{bc?.close();}catch{} try{unsub?.();}catch{} };
  },[]);

  const doRefresh=useCallback(async(force)=>{
    if(!projectPath){ setStatus([]); setBranchInfo({branch:"",isRepo:true}); setLog([]); setConflicts([]); setBranches({local:[],remote:[],current:""}); setError(null); return; }
    if(document.hidden && !force) return;
    if(refreshRef.current) return;
    refreshRef.current=1;
    setLoading(true); if(force) setError(null);
    try{
      const [st,br,lg, blist, conf] = await Promise.all([
        window.electronAPI.gitStatus(projectPath).catch((e)=>{ throw new Error("status: "+(e?.message||e)); }),
        window.electronAPI.gitBranch(projectPath).catch(()=>({branch:"",isRepo:false})),
        window.electronAPI.gitLog(projectPath, 30).catch(()=>[]),
        (window.electronAPI.gitBranches?window.electronAPI.gitBranches(projectPath).catch(()=>({local:[],remote:[],current:""})) : Promise.resolve({local:[],remote:[],current:""})),
        (window.electronAPI.gitConflicts?window.electronAPI.gitConflicts(projectPath).catch(()=>[]):Promise.resolve([])),
      ]);
      setStatus(Array.isArray(st)?st:[]);
      setBranchInfo(br||{branch:"",isRepo:true});
      setLog(Array.isArray(lg)?lg:[]);
      setBranches(blist||{local:[],remote:[],current:""});
      setConflicts(Array.isArray(conf)?conf:[]);
      // invalidate diff cache for files that disappeared
      const still = new Set((st||[]).map(x=>x.rel));
      for(const k of [...diffCacheRef.current.keys()]) if(!still.has(k)) diffCacheRef.current.delete(k);
      setDiffMap(prev=>{ const n={}; for(const k of Object.keys(prev)) if(still.has(k)) n[k]=prev[k]; return n; });
      setLastRefresh(new Date());
      setError(null);
    }catch(e){
      const m=e?.message||String(e);
      if(m.includes("status:")) setError("Git status failed — is git installed? "+m);
      else setError(m);
    } finally{ setLoading(false); refreshRef.current=0; }
  },[projectPath]);

  useEffect(()=>{ doRefresh(); const iv=setInterval(()=>{ if(!document.hidden) doRefresh(); },15000); return ()=>clearInterval(iv); },[doRefresh]);

  // autoFetch live — previously dead (no consumer)
  useEffect(()=>{
    if(!projectPath || !gitOpts.autoFetch) return;
    const iv=setInterval(()=>{ if(document.hidden) return; window.electronAPI.gitFetch(projectPath).then(()=> doRefresh(true)).catch(()=>{}); }, 5*60*1000);
    return ()=> clearInterval(iv);
  },[projectPath, gitOpts.autoFetch, doRefresh]);

  // log filtering
  useEffect(()=>{
    const q=logQuery.trim().toLowerCase();
    if(!q) setFilteredLog(log);
    else setFilteredLog(log.filter(c=> (c.msg||"").toLowerCase().includes(q) || (c.hash||"").toLowerCase().includes(q) || (c.author||"").toLowerCase().includes(q) || (c.fullHash||"").toLowerCase().includes(q)));
  },[log,logQuery]);

  // derived groups
  const filtered = useMemo(()=>{
    const q=filter.trim().toLowerCase();
    if(!q) return status;
    return status.filter(it=> it.rel.toLowerCase().includes(q) || (it.origRel||"").toLowerCase().includes(q));
  },[status,filter]);

  const groups = useMemo(()=>{
    const staged=[], changes=[], untracked=[], conflicted=[];
    for(const it of filtered){
      if(it.conflicted) { conflicted.push(it); continue; }
      const st=it.status; const x=it.x, y=it.y;
      if(it.partiallyStaged){
        // show in both? we show as staged + indicator, but also treat as staged grouping
        staged.push(it);
        // also keep visible in changes? No — single entry with dual badge
        continue;
      }
      if(st==="??") untracked.push(it);
      else if(x && x!==" " && x!=="?" && x!=="!" && x!=="U") staged.push(it);
      else if(y && y!==" ") changes.push(it);
      else changes.push(it);
    }
    // also merge conflicts from dedicated API if not already present
    for(const c of conflicts){
      if(!filtered.some(x=>x.rel===c.rel) && !conflicted.some(x=>x.rel===c.rel)){
        // if filter matches
        if(!filter || c.rel.toLowerCase().includes(filter.toLowerCase())) conflicted.push({ rel:c.rel, path:c.path, status:"UU", x:"U", y:"U", conflicted:true });
      }
    }
    return { staged, changes, untracked, conflicted };
  },[filtered, conflicts, filter]);

  const flatVisible = useMemo(()=>{
    const a=[];
    if(groups.conflicted.length) a.push(...groups.conflicted.map(x=>({...x,_group:"conflict"})));
    if(groups.staged.length) a.push(...groups.staged.map(x=>({...x,_group:"staged"})));
    if(groups.changes.length) a.push(...groups.changes.map(x=>({...x,_group:"changes"})));
    if(groups.untracked.length) a.push(...groups.untracked.map(x=>({...x,_group:"untracked"})));
    return a;
  },[groups]);

  const openFile=(rel)=>{
    // forward-slash form works on both OSes (tab matching is separator-insensitive)
    const full= projectPath ? `${projectPath}/${rel}`.replace(/\\/g,"/").replace(/\/\//g,"/") : rel;
    window.dispatchEvent(new CustomEvent("open-file-in-editor",{ detail:{ path: full }}));
  };
  const copyText=async(t)=>{
    try{ if(window.electronAPI?.clipboardWrite) await window.electronAPI.clipboardWrite(t); else await navigator.clipboard.writeText(t); showToast("Copied"); }catch{ showToast("Copy failed",true); }
  };

  // diff rendering with line numbers, lazy, size guard
  const renderDiff=(text, rel)=>{
    if(text===undefined) return <div style={{padding:"var(--space-8) var(--space-10)",color:"var(--icon)",fontSize:"var(--fs-small)"}}>Loading…</div>;
    if(!text || text==="(no diff)" || text==="(error)") return <div style={{padding:"var(--space-6) var(--space-10)",color:"var(--icon-muted)",fontSize:"var(--fs-small)"}}>{text||"(no diff)"}</div>;
    if(text==="Binary file — diff not displayed") return <div style={{padding:"var(--space-8) var(--space-10)",color:"var(--git-modified)",fontSize:"var(--fs-small)"}}>Binary file — no text diff</div>;
    const str=String(text);
    if(str.length>500000) return <div style={{padding:"var(--space-8) var(--space-10)",color:"var(--git-modified)",fontSize:"var(--fs-small)"}}>Diff too large ({(str.length/1000).toFixed(0)} KB) — <button onClick={()=>openFile(rel)} style={s.btnGhost}>Open File</button></div>;
    const lines=str.split("\n").slice(0,700);
    const large = lines.length>500;
    const shown = large ? lines.slice(0,500) : lines;
    return (
      <div style={{ fontFamily:"var(--font-code)", fontSize:"var(--fs-small)", lineHeight:"15px" }}>
        {shown.map((l,i)=>{
          let bg="transparent", col="var(--text-bright)", prefix=" ";
          if(l.startsWith("+") && !l.startsWith("+++")){ bg="var(--git-added-a10)"; col="var(--git-added)"; prefix="+"; }
          else if(l.startsWith("-") && !l.startsWith("---")){ bg="var(--error-tint-a09)"; col="var(--diff-del-text)"; prefix="-"; }
          else if(l.startsWith("@@")){ bg="var(--diff-hunk-a10)"; col="var(--code-blue)"; prefix="@"; }
          const isHeader = l.startsWith("diff ")||l.startsWith("index ")||l.startsWith("---")||l.startsWith("+++");
          return <div key={i} style={{ display:"flex", background:bg, color:isHeader?"var(--icon)":col, padding:"0 var(--space-4)", whiteSpace:"pre", overflow:"hidden" }}>
            <span style={{ width:36, flexShrink:0, color:"var(--text-placeholder)", textAlign:"right", paddingRight:"var(--space-6)", userSelect:"none", borderRight:"1px solid var(--bg-hover)", marginRight:"var(--space-6)" }}>{i+1}</span>
            <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis" }}>{l || " "}</span>
          </div>;
        })}
        {large && <div style={{padding:"var(--space-6) var(--space-10)",color:"var(--code-blue)",fontSize:"var(--fs-small)"}}>… truncated ({lines.length-500} more lines) — <button onClick={()=>openFile(rel)} style={{...s.btnGhost, padding:"var(--space-2) var(--space-6)"}}>Open file</button></div>}
      </div>
    );
  };

  const toggleDiff=async(rel)=>{
    if(openDiff===rel){ setOpenDiff(null); return; }
    setOpenDiff(rel);
    if(diffMap[rel]!==undefined || diffCacheRef.current.has(rel)) return;
    // cache check
    if(diffCacheRef.current.has(rel)){ setDiffMap(m=>({...m,[rel]:diffCacheRef.current.get(rel)})); return; }
    try{
      const fullPath= projectPath ? `${projectPath}/${rel}`.replace(/\\/g,"/") : rel;
      const txt= await window.electronAPI.gitDiff(projectPath, fullPath);
      const v= txt || "(no diff)";
      diffCacheRef.current.set(rel, v);
      setDiffMap(m=>({...m,[rel]:v}));
    }catch(e){ const v="(error) "+(e?.message||e); diffCacheRef.current.set(rel, v); setDiffMap(m=>({...m,[rel]:v})); }
  };

  const wrapAction=async(key, fn)=>{
    setBusy(key); setError(null);
    try{ await fn(); await doRefresh(true); }
    catch(e){ const m=humanBranchError(e?.message||String(e)); setError(m); showToast(m,true); }
    finally{ setBusy(""); }
  };

  const doStage=(rel)=>wrapAction(rel+":stage", ()=> window.electronAPI.gitStage(projectPath, rel).then(r=>{ if(r?.ok===false) throw new Error(r.error); }));
  const doUnstage=(rel)=>wrapAction(rel+":unstage", ()=> window.electronAPI.gitUnstage(projectPath, rel).then(r=>{ if(r?.ok===false) throw new Error(r.error); }));
  const doDiscard=async(rel)=>{
    const isUntracked= groups.untracked.some(x=>x.rel===rel) || status.find(x=>x.rel===rel)?.status==="??";
    const msg = isUntracked ? `Delete untracked file "${rel}"?\nThis cannot be undone.` : `Discard changes in "${rel}"?\nThis cannot be undone.`;
    const ok = window.confirm ? window.confirm(msg) : true;
    if(!ok) return;
    await wrapAction(rel+":discard", ()=> window.electronAPI.gitDiscard(projectPath, rel).then(r=>{ if(r?.ok===false) throw new Error(r.error); }));
  };
  const doStageAll=()=>wrapAction("stageAll", ()=> window.electronAPI.gitStageAll(projectPath).then(r=>{ if(r?.ok===false) throw new Error(r.error); }));
  const doUnstageAll=()=>wrapAction("unstageAll", ()=> window.electronAPI.gitUnstageAll(projectPath).then(r=>{ if(r?.ok===false) throw new Error(r.error); }));
  const doCommit=async(pushAfter)=>{
    if(!msg.trim()){ showToast("Write a commit message",true); return; }
    if(msg.trim().length<3){ showToast("Commit message too short",true); return; }
    const stagedCount=groups.staged.length;
    if(!stagedCount && !amend){ showToast("Nothing staged — stage files first",true); setError("Nothing staged — stage files first or enable Amend."); return; }
    setBusy("commit");
    try{
      const r= amend
        ? await (window.electronAPI.gitCommitAmend ? window.electronAPI.gitCommitAmend(projectPath, msg.trim()) : window.electronAPI.gitCommit(projectPath, msg.trim(), {amend:true}))
        : await window.electronAPI.gitCommit(projectPath, msg.trim());
      if(r?.ok){ setMsg(""); showToast(amend?"✓ Amended":"✓ Committed"); await doRefresh(true); if(pushAfter) await doPushInternal(); }
      else throw new Error(r?.error||"Commit failed");
    }catch(e){ const m=humanBranchError(e.message); setError(m); showToast(m,true); }
    finally{ setBusy(""); }
  };
  const doCommitAndPush=()=>doCommit(true);
  const doPushInternal=async()=>{
    const r=await window.electronAPI.gitPush(projectPath);
    if(r?.ok===false) throw new Error(r.error);
    showToast("✓ Pushed");
  };
  const doPush=()=>wrapAction("push", doPushInternal);
  const doPull=()=>wrapAction("pull", ()=> window.electronAPI.gitPull(projectPath).then(r=>{ if(r?.ok===false) throw new Error(r.error); showToast("✓ Pulled"); return r; }));
  const doFetch=()=>wrapAction("fetch", ()=> window.electronAPI.gitFetch(projectPath).then(r=>{ if(r?.ok===false) throw new Error(r.error); showToast("✓ Fetched"); return r; }));
  const doInit=()=>wrapAction("init", async()=>{
    if(!window.electronAPI.gitInit) throw new Error("git init not supported");
    const r=await window.electronAPI.gitInit(projectPath);
    if(r?.ok===false) throw new Error(r.error);
    showToast("✓ Repository initialized");
  });

  // branch actions
  const handleSwitch=async(name)=>{
    if(!name) return;
    const dirty = status.length>0;
    if(dirty){
      const ok = window.confirm ? window.confirm(`Switch to "${name}"?\nYou have uncommitted changes that might be overwritten. Continue?`) : true;
      if(!ok) return;
    }
    setBranchPickerOpen(false);
    await wrapAction("switch:"+name, async()=>{
      const r= await window.electronAPI.gitSwitchBranch(projectPath, name);
      if(r?.ok===false) throw new Error(r.error);
      showToast(`Switched to ${name}`);
    });
  };
  const handleCreateBranch=async()=>{
    const n=newBranchName.trim();
    if(!n){ showToast("Enter branch name",true); return; }
    if(/[\s~^:?*\[\\]/.test(n) || n.includes("..")){ showToast("Invalid branch name",true); return; }
    await wrapAction("createBranch", async()=>{
      const r=await window.electronAPI.gitCreateBranch(projectPath, n);
      if(r?.ok===false) throw new Error(r.error);
      setNewBranchName(""); setBranchPickerOpen(false); showToast(`Created ${n}`);
    });
  };
  const handleDeleteBranch=async(name)=>{
    if(!name) return;
    if(name===branchInfo.branch){ showToast("Cannot delete current branch",true); return; }
    const ok= window.confirm? window.confirm(`Delete branch "${name}"?`):true;
    if(!ok) return;
    await wrapAction("deleteBranch:"+name, async()=>{
      const r=await window.electronAPI.gitDeleteBranch(projectPath, name, false);
      if(r?.ok===false){
        // try force if suggestion
        if(/not fully merged/i.test(r.error)){
          const forceOk= window.confirm ? window.confirm(`Branch "${name}" not fully merged. Force delete?`) : false;
          if(forceOk){
            const r2=await window.electronAPI.gitDeleteBranch(projectPath, name, true);
            if(r2?.ok===false) throw new Error(r2.error);
          } else throw new Error(r.error);
        } else throw new Error(r.error);
      }
      showToast(`Deleted ${name}`);
    });
  };
  const handleRenameBranch=async(oldName)=>{
    const nn= window.prompt ? window.prompt(`Rename branch "${oldName}" to:`, oldName) : null;
    if(!nn || nn.trim()===oldName) return;
    if(!nn.trim()) return;
    await wrapAction("rename:"+oldName, async()=>{
      const r=await window.electronAPI.gitRenameBranch(projectPath, oldName, nn.trim());
      if(r?.ok===false) throw new Error(r.error);
      showToast(`Renamed to ${nn.trim()}`);
    });
  };
  const markResolved=async(rel)=>{
    await wrapAction("resolve:"+rel, async()=>{
      const r=await window.electronAPI.gitMarkResolved(projectPath, rel);
      if(r?.ok===false) throw new Error(r.error);
      showToast(`Marked ${rel} as resolved`);
    });
  };

  // log actions
  const copyHash=async(h)=> copyText(h);
  const viewCommit=async(c)=>{
    setShowCommitDetail({ hash:c.hash, fullHash:c.fullHash, loading:true, stat:"", diff:"" });
    try{
      const [stat,diff]=await Promise.all([
        (window.electronAPI.gitCommitShow?window.electronAPI.gitCommitShow(projectPath,c.fullHash):Promise.resolve("")),
        (window.electronAPI.gitCommitDiff?window.electronAPI.gitCommitDiff(projectPath,c.fullHash):Promise.resolve("")),
      ]);
      setShowCommitDetail({ hash:c.hash, fullHash:c.fullHash, loading:false, stat:stat||"", diff:diff||"" });
    }catch(e){
      setShowCommitDetail({ hash:c.hash, fullHash:c.fullHash, loading:false, stat:"", diff:"Error: "+(e?.message||e) });
    }
  };

  // keyboard nav for file list
  const onListKeyDown=(e)=>{
    if(!flatVisible.length) return;
    if(e.key==="ArrowDown"){ e.preventDefault(); setFocusIdx(i=> Math.min(flatVisible.length-1, i+1)); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); setFocusIdx(i=> Math.max(0, i-1)); }
    else if(e.key==="Enter"){
      if(focusIdx>=0 && flatVisible[focusIdx]) { e.preventDefault(); openFile(flatVisible[focusIdx].rel); }
    } else if(e.key===" "){
      if(focusIdx>=0){
        e.preventDefault();
        const it=flatVisible[focusIdx];
        if(it._group==="staged") doUnstage(it.rel);
        else if(it._group==="untracked"||it._group==="changes") doStage(it.rel);
      }
    }
  };
  useEffect(()=>{ setFocusIdx(-1); },[status.length, filter]);

  if(!projectPath){
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:"var(--text-muted)", fontSize:"var(--fs-body)", flexDirection:"column", gap:"var(--space-10)", background:"var(--bg-surface)", padding:"var(--space-20)", textAlign:"center" }}>
        <div style={{width:44,height:44,borderRadius:"var(--radius-pill)",background:"var(--bg-vscode)",border:"1px solid var(--bg-active)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"var(--fs-hero)"}}>⎇</div>
        <div style={{fontWeight:"var(--fw-bold)",color:"var(--text-secondary)"}}>No project open</div>
        <div style={{fontSize:"var(--fs-small)",color:"var(--text-muted)",maxWidth:220}}>Open a folder with a git repository to see changes, branches and commits.</div>
        <div style={{fontSize:"var(--fs-small)",color:"var(--text-placeholder)",background:"var(--bg-vscode)",padding:"var(--space-6) var(--space-10)",borderRadius:"var(--radius-md)",border:"var(--space-1) solid var(--bg-active)"}}>File → Open Project…</div>
      </div>
    );
  }
  if(branchInfo && branchInfo.isRepo===false){
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"var(--bg-surface)", color:"var(--text-bright)" }}>
        <div style={s.header}><div style={{fontSize:"var(--fs-body)",fontWeight:"var(--fw-bold)"}}>Source Control</div><button onClick={()=>doRefresh(true)} style={s.btnGhost} title="Refresh">↻ Refresh</button></div>
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:"var(--space-12)",padding:"var(--space-24)",textAlign:"center"}}>
          <div style={{width:48,height:48,borderRadius:"var(--radius-3xl)",background:"var(--bg-vscode)",border:"1px dashed var(--border-light)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"var(--fs-22)",color:"var(--text-muted)"}}>∅</div>
          <div style={{fontSize:"var(--fs-large)",fontWeight:"var(--fw-bold)",color:"var(--text-soft)"}}>Not a git repository</div>
          <div style={{fontSize:"var(--fs-body)",color:"var(--icon-muted)",maxWidth:260,wordBreak:"break-all"}}>{projectPath}</div>
          <div style={{display:"flex",gap:"var(--space-8)",flexWrap:"wrap",justifyContent:"center"}}>
            <button onClick={doInit} disabled={!!busy} style={{...s.btn, opacity:busy?0.6:1}} title="Run git init">{busy==="init"?"…":"Initialize Repository"}</button>
            <button onClick={()=>doRefresh(true)} style={s.btnGhost}>↻ Refresh</button>
            <button onClick={()=>window.electronAPI?.revealInExplorer?.(projectPath)} style={s.btnGhost}>Reveal folder</button>
          </div>
          {error && <div style={{fontSize:"var(--fs-small)",color:"var(--danger)",background:"var(--error-bg-strong)",padding:"var(--space-6) var(--space-10)",borderRadius:"var(--radius-md)",border:"var(--space-1) solid var(--error-border-2)",maxWidth:320,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>⚠ {error}</div>}
          <div style={{fontSize:"var(--fs-tiny)",color:"var(--text-placeholder)",background:"var(--bg-vscode)",padding:"var(--space-6) var(--space-8)",borderRadius:"var(--radius-md)",border:"var(--space-1) solid var(--bg-active)"}}>This will run <span style={{fontFamily:"var(--font-code)"}}>git init</span> in the open folder.</div>
        </div>
      </div>
    );
  }

  const total=status.length;

  // branch picker filter
  const bf=branchFilter.trim().toLowerCase();
  const filteredLocal = branches.local.filter(b=>!bf || b.toLowerCase().includes(bf));
  const filteredRemote = branches.remote.filter(b=>!bf || b.toLowerCase().includes(bf));

  return (
    <div style={s.wrap} onKeyDown={onListKeyDown} tabIndex={0} onContextMenu={(e)=> e.preventDefault()}>
      {/* Header */}
      <div style={s.header}>
        <div style={{display:"flex",alignItems:"center",gap:"var(--space-6)",flex:1,minWidth:0}}>
          <button onClick={()=>setBranchPickerOpen(v=>!v)} style={s.branchBtn} title="Branch — click to switch/create" aria-haspopup="menu" aria-expanded={branchPickerOpen}>
            <span style={{fontSize:"var(--fs-title)"}}>⎇</span>
            <span style={{maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{branchInfo.branch||"HEAD"}</span>
            <span style={{fontSize:"var(--fs-micro)",opacity:0.8}}>▾</span>
            {(branchInfo.ahead||branchInfo.behind) ? <span style={{background:"var(--white-a18)",padding:"var(--space-1) var(--space-5)",borderRadius:"var(--radius-pill)",fontSize:"var(--fs-tiny)",display:"flex",gap:"var(--space-4)"}}>{branchInfo.ahead ? "↑" + branchInfo.ahead : ""}{branchInfo.behind ? "↓" + branchInfo.behind : ""}</span>:null}
          </button>
          <span style={s.pill(total>0)} title={String(total) + " changed files"}>{total} • {total===1 ? "change" : "changes"}</span>
          {loading && <span style={{fontSize:"var(--fs-tiny)",color:"var(--teal)",display:"flex",alignItems:"center",gap:"var(--space-4)"}}><span style={{width:10,height:10,border:"2px solid var(--teal)",borderTopColor:"transparent",borderRadius:"var(--radius-round)",display:"inline-block",animation:"spin 0.7s linear infinite"}}/>syncing</span>}
        </div>
        <div style={{display:"flex",gap:"var(--space-4)",alignItems:"center"}}>
          <button onClick={doFetch} disabled={!!busy} title={branchInfo.hasRemote===false?"No remote configured":"Fetch"} style={{...s.iconBtn, opacity:(!busy && branchInfo.hasRemote===false)?0.45:(busy?0.6:1)}}>{busy==="fetch"?"…":"⟳"}</button>
          <button onClick={doPull} disabled={!!busy} title="Pull" style={{...s.iconBtn,opacity:busy?0.6:1}}>{busy==="pull"?"…":"↓"}</button>
          <button onClick={doPush} disabled={!!busy} title="Push" style={{...s.iconBtn,opacity:busy?0.6:1}}>{busy==="push"?"…":"↑"}</button>
          <button onClick={()=>doRefresh(true)} disabled={loading} title={lastRefresh?`Last: ${lastRefresh.toLocaleTimeString()}`:"Refresh"} style={{...s.iconBtn, opacity:loading?0.5:1}}>{loading?"…":"↻"}</button>
          {nodeId && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("close-flex-tab", { detail: { nodeId } }))}
              title="Close Git panel"
              style={{...s.iconBtn, color:"var(--icon)", opacity:0.7}}
              onMouseEnter={(e)=>{ e.currentTarget.style.color="var(--text-inverse)"; e.currentTarget.style.opacity="1"; }}
              onMouseLeave={(e)=>{ e.currentTarget.style.color="var(--icon)"; e.currentTarget.style.opacity="0.7"; }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* branch picker */}
      {branchPickerOpen && (
        <div style={{background:"var(--bg-vscode)",borderBottom:"1px solid var(--bg-active)",padding:"var(--space-8)",display:"flex",flexDirection:"column",gap:"var(--space-8)", flexShrink:0}}>
          <input value={branchFilter} onChange={e=>setBranchFilter(e.target.value)} placeholder="Filter branches…" autoFocus style={{...s.input, padding:"var(--space-6) var(--space-8)", background:"var(--bg-surface)", border:"var(--space-1) solid var(--border-light)"}} />
          <div style={{display:"flex",gap:"var(--space-6)"}}>
            <input value={newBranchName} onChange={e=>setNewBranchName(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") handleCreateBranch(); }} placeholder="New branch name" style={{...s.input, flex:1, padding:"var(--space-6) var(--space-8)", background:"var(--bg-surface)", border:"var(--space-1) solid var(--border-light)"}} />
            <button onClick={handleCreateBranch} disabled={!!busy || !newBranchName.trim()} style={{...s.btn, opacity:(!newBranchName.trim()||busy)?0.5:1, padding:"var(--space-6) var(--space-10)"}}>Create</button>
          </div>
          <div style={{maxHeight:160,overflowY:"auto",border:"1px solid var(--bg-active)",borderRadius:"var(--radius-md)",background:"var(--bg-surface)"}}>
            <div style={{padding:"var(--space-5) var(--space-8)",fontSize:"var(--fs-tiny)",color:"var(--text-secondary)",fontWeight:"var(--fw-bold)",letterSpacing:0.4,textTransform:"uppercase",borderBottom:"var(--space-1) solid var(--bg-active)"}}>Local ({filteredLocal.length}) {branchInfo.branch ? "• current: " + branchInfo.branch : ""}</div>
            {filteredLocal.length===0 && <div style={{padding:"var(--space-8) var(--space-10)",fontSize:"var(--fs-small)",color:"var(--text-muted)"}}>No matching branches</div>}
            {filteredLocal.map(b=>(
              <div key={"l:"+b} style={{display:"flex",alignItems:"center",gap:"var(--space-6)",padding:"var(--space-5) var(--space-8)",fontSize:"var(--fs-small)", borderBottom:"var(--space-1) solid var(--border-row)", background: b===branchInfo.branch?"var(--select-blue)":"transparent", color:b===branchInfo.branch?"var(--text-inverse)":"var(--text-bright)"}}>
                <button onClick={()=>handleSwitch(b)} disabled={!!busy || b===branchInfo.branch} style={{flex:1,textAlign:"left",background:"transparent",border:"none",color:"inherit",cursor:b===branchInfo.branch?"default":"pointer",fontWeight:b===branchInfo.branch?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={b===branchInfo.branch?"Current":"Switch to "+b}>{b}{b===branchInfo.branch?" • current":""}</button>
                <button onClick={()=>handleRenameBranch(b)} title="Rename" style={{...s.iconBtn,padding:"var(--space-2) var(--space-5)",fontSize:"var(--fs-tiny)"}}>✎</button>
                <button onClick={()=>handleDeleteBranch(b)} title="Delete" disabled={b===branchInfo.branch} style={{...s.iconBtn,padding:"var(--space-2) var(--space-5)",fontSize:"var(--fs-tiny)",opacity:b===branchInfo.branch?0.4:1}}>✕</button>
              </div>
            ))}
            <div style={{padding:"var(--space-5) var(--space-8)",fontSize:"var(--fs-tiny)",color:"var(--text-secondary)",fontWeight:"var(--fw-bold)",letterSpacing:0.4,textTransform:"uppercase",borderBottom:"var(--space-1) solid var(--bg-active)",borderTop:"var(--space-1) solid var(--bg-active)"}}>Remote ({filteredRemote.length})</div>
            {filteredRemote.length===0 && <div style={{padding:"var(--space-8) var(--space-10)",fontSize:"var(--fs-small)",color:"var(--text-muted)"}}>No remote branches</div>}
            {filteredRemote.map(b=>(
              <div key={"r:"+b} style={{display:"flex",alignItems:"center",padding:"var(--space-5) var(--space-8)",fontSize:"var(--fs-small)",borderBottom:"var(--space-1) solid var(--border-row)"}}>
                <button onClick={()=>{
                  // checkout remote => create local tracking
                  const localName=b.replace(/^origin\//,"");
                  handleSwitch(localName);
                }} style={{flex:1,textAlign:"left",background:"transparent",border:"none",color:"var(--code-blue)",cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={"Checkout "+b}>{b}</button>
              </div>
            ))}
          </div>
          <div style={{display:"flex",justifyContent:"flex-end"}}><button onClick={()=>setBranchPickerOpen(false)} style={s.btnGhost}>Close</button></div>
        </div>
      )}

      {/* Error + Toast */}
      {error && (
        <div style={{margin:"var(--space-8) var(--space-8) 0",padding:"var(--space-8) var(--space-10)",background:"var(--error-bg-solid)",border:"var(--space-1) solid var(--error-border-3)",borderRadius:"var(--radius-md)",color:"var(--error-text-soft)",fontSize:"var(--fs-small)",display:"flex",justifyContent:"space-between",gap:"var(--space-8)",alignItems:"flex-start"}}>
          <span style={{flex:1,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>⚠ {error}</span>
          <button onClick={()=>setError(null)} style={{background:"transparent",border:"none",color:"var(--error-text-soft)",cursor:"pointer",fontSize:"var(--fs-xl)",lineHeight:"var(--lh-flat)"}}>×</button>
        </div>
      )}
      {toast && <div style={{margin:error?"var(--space-6) var(--space-8) 0":"var(--space-8) var(--space-8) 0",padding:"7px var(--space-10)",background:toast.isError?"var(--error-bg-solid)":"var(--success-bg)",border:"var(--space-1) solid " + (toast.isError?"var(--error-border-3)":"var(--success-border-2)"),borderRadius:"var(--radius-md)",color:toast.isError?"var(--error-text-soft)":"var(--teal)",fontSize:"var(--fs-small)"}}>{toast.text}</div>}

      {/* Sync hints */}
      {branchInfo.hasRemote===false && (
        <div style={{margin:"var(--space-6) var(--space-8) 0",padding:"var(--space-6) var(--space-8)",background:"var(--warn-bg-olive)",border:"var(--space-1) solid var(--warn-border-olive)",borderRadius:"var(--radius-md)",color:"var(--git-modified)",fontSize:"var(--fs-small)"}}>No remote configured — push/pull will fail. <span style={{color:"var(--text-secondary)"}}>Add with: <span style={{fontFamily:"var(--font-code)"}}>git remote add origin &lt;url&gt;</span></span></div>
      )}

      {/* Commit box */}
      <div style={{padding:"var(--space-10)",borderBottom:"var(--space-1) solid var(--bg-active)",background:"var(--bg-vscode)",flexShrink:0}}>
        <textarea value={msg} onChange={e=>setMsg(e.target.value)} placeholder={amend?"Amend message — Ctrl+Enter to amend last commit":"Message — Ctrl+Enter to commit staged (Cmd+Enter on Mac)"} rows={2} onKeyDown={e=>{ if((e.ctrlKey||e.metaKey) && e.key==="Enter"){ e.preventDefault(); if(e.shiftKey) doCommitAndPush(); else doCommit(); } }} style={{...s.input, borderColor:msg.trim()?"var(--editor-blue)":"var(--border-strong)", boxShadow:msg.trim()?"0 0 0 1px var(--accent-deep-a25)":"none", minHeight:52}} />
        <div style={{display:"flex",gap:"var(--space-6)",marginTop:"var(--space-8)",alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>doCommit(false)} disabled={!msg.trim() || !!busy} style={{...s.btn, opacity:(!msg.trim()||busy)?0.5:1, flex:1, minWidth:110}} title="Ctrl+Enter">
            {busy==="commit"?"Committing…": amend ? ("Amend" + (groups.staged.length ? " • " + groups.staged.length + " staged" : "")) : ("Commit" + (groups.staged.length ? " • " + groups.staged.length + " staged" : ""))}
          </button>
          <button onClick={doCommitAndPush} disabled={!msg.trim() || !!busy} style={{...s.btnGhost, opacity:(!msg.trim()||busy)?0.5:1, background:"var(--editor-blue)",color:"var(--text-inverse)",borderColor:"var(--editor-blue)"}} title="Commit then push (Ctrl+Shift+Enter)">Commit & Push</button>
          <button onClick={doStageAll} disabled={(!groups.changes.length && !groups.untracked.length) || !!busy} style={{...s.btnGhost, opacity:(!groups.changes.length&&!groups.untracked.length)?0.5:1}} title="Stage all">+ All</button>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:"var(--space-6)",fontSize:"var(--fs-tiny)",color:"var(--icon-muted)",gap:"var(--space-8)",flexWrap:"wrap"}}>
          <label style={{display:"flex",alignItems:"center",gap:"var(--space-6)",cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={amend} onChange={e=>setAmend(e.target.checked)} style={{accentColor:"var(--editor-blue)"}} /> Amend last commit
          </label>
          <span style={{display:"flex",gap:"var(--space-8)",alignItems:"center"}}>
            <span>{groups.staged.length?String(groups.staged.length)+" staged":"Stage files then commit"}</span>
            <span style={{color:msg.length>72?"var(--git-modified)":msg.length>0?"var(--text-secondary)":"var(--text-placeholder)"}}>{String(msg.length)+"/280 "+ (msg.length>72 && msg.length<=280 ? "• wrap at 72" : msg.length>280?"• too long":"")}</span>
          </span>
        </div>
      </div>

      {/* Filter */}
      <div style={{padding:"7px var(--space-8)",borderBottom:"var(--space-1) solid var(--border-row)",display:"flex",gap:"var(--space-6)",flexShrink:0,background:"var(--bg-surface)",alignItems:"center"}}>
        <div style={{position:"relative",flex:1}}>
          <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",color:"var(--text-muted)",fontSize:"var(--fs-body)"}}>⌕</span>
          <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter by file…" aria-label="Filter files" style={{...s.input, padding:"var(--space-6) var(--space-8) var(--space-6) var(--space-24)",fontSize:"var(--fs-body)",background:"var(--bg-vscode)",border:"var(--space-1) solid var(--border-light)"}} />
        </div>
        {filter && <button onClick={()=>setFilter("")} style={s.btnGhost} aria-label="Clear filter">✕</button>}
        <span style={{fontSize:"var(--fs-tiny)",color:"var(--text-muted)",whiteSpace:"nowrap"}}>{filtered.length}/{status.length}</span>
      </div>

      {/* Lists */}
      <div ref={listRef} style={{flex:1,overflowY:"auto",overflowX:"hidden"}} role="list" aria-label="Changed files" tabIndex={-1}>
        {total===0 && !loading && !error && (
          <div style={{textAlign:"center",padding:32,color:"var(--icon)"}}>
            <div style={{width:40,height:40,borderRadius:"var(--radius-pill)",background:"var(--bg-vscode)",border:"1px solid var(--bg-active)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto var(--space-10)",fontSize:"var(--fs-18)",color:"var(--success)"}}>✓</div>
            <div style={{fontWeight:"var(--fw-bold)",color:"var(--text-soft)",fontSize:"var(--fs-title)"}}>Working tree clean</div>
            <div style={{fontSize:"var(--fs-small)",color:"var(--text-muted)",marginTop:"var(--space-4)"}}>No changes detected</div>
            {log.length>0 && <div style={{marginTop:"var(--space-14)",fontSize:"var(--fs-small)",color:"var(--icon-muted)",background:"var(--bg-vscode)",padding:"var(--space-8) var(--space-10)",borderRadius:"var(--radius-md)",border:"var(--space-1) solid var(--bg-active)",textAlign:"left"}}><div style={{color:"var(--text-secondary)",fontWeight:"var(--fw-semibold)",marginBottom:"var(--space-4)"}}>Last commit</div><div style={{color:"var(--code-blue)",fontFamily:"monospace",fontSize:"var(--fs-tiny)"}}>{log[0]?.hash}</div><div style={{color:"var(--text-bright)",marginTop:"var(--space-2)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{log[0]?.msg}</div><div style={{color:"var(--icon-muted)",fontSize:"var(--fs-tiny)",marginTop:"var(--space-2)"}}>{log[0]?.author} • {log[0]?.relTime}</div></div>}
          </div>
        )}
        {loading && total===0 && (
          <div style={{padding:"var(--space-16)",display:"flex",flexDirection:"column",gap:"var(--space-8)"}}>{[1,2,3].map(i=><div key={i} style={{height:14,background:"var(--bg-vscode)",borderRadius:"var(--radius-md)",opacity:0.6}}/>)}</div>
        )}

        {/* Conflicts */}
        {groups.conflicted.length>0 && (
          <div>
            <div style={{...s.sectionHead, background:"var(--error-bg-red)", color:"var(--error-text-soft)", borderColor:"var(--error-border-2)"}} onClick={()=>setCollapsed(c=>({...c,conflicts:!c.conflicts}))}>
              <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:collapsed.conflicts?"rotate(-90deg)":"none",display:"inline-block",transition:"transform var(--t-slow)",fontSize:"var(--fs-tiny)"}}>▼</span> Merge Conflicts <span style={{background:"var(--danger)",color:"var(--text-inverse)",padding:"var(--space-2) var(--space-6)",borderRadius:"var(--radius-pill)",fontSize:"var(--fs-tiny)",fontWeight:"var(--fw-bold)"}}>{groups.conflicted.length}</span></span>
              <span style={{fontSize:"var(--fs-tiny)",color:"var(--error-text-pale)"}}>Resolve → Stage</span>
            </div>
            {!collapsed.conflicts && groups.conflicted.map(it=>(
              <div key={"conf:"+it.rel} style={{borderBottom:"1px solid var(--border-row)", background:"var(--error-bg-2)"}}>
                <div style={{...s.row, background: focusIdx>=0 && flatVisible[focusIdx]?.rel===it.rel ? "var(--error-border-faint)":"transparent"}}
                  onClick={()=>openFile(it.rel)} title={it.rel + " — conflicted — click to open — double-click to diff"} onDoubleClick={()=>toggleDiff(it.rel)}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--error-border-faint)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  onContextMenu={e=>{ e.preventDefault(); e.stopPropagation(); setCtxMenu({x:e.clientX,y:e.clientY, rel:it.rel}); }}>
                  <span style={s.statusBox("var(--danger)")}>U</span>
                  <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={it.rel}>{it.rel}</span>
                  <span style={{fontSize:"var(--fs-tiny)",color:"var(--danger)",background:"var(--bg-surface)",padding:"var(--space-1) var(--space-5)",borderRadius:"var(--radius-sm)",border:"var(--space-1) solid var(--error-border-2)"}}>Conflicted</span>
                  <span style={{display:"flex",gap:"var(--space-3)",flexShrink:0}}>
                    <button onClick={e=>{ e.stopPropagation(); openFile(it.rel); }} title="Open" style={s.iconBtn}>↗</button>
                    <button onClick={e=>{ e.stopPropagation(); toggleDiff(it.rel); }} title={openDiff===it.rel?"Hide diff":"Show diff"} style={{...s.iconBtn, background:openDiff===it.rel?"var(--error-border-3)":"var(--bg-active)", color:openDiff===it.rel?"var(--text-inverse)":"var(--text-soft)"}}>{openDiff===it.rel?"−":"◈"}</button>
                    <button onClick={e=>{ e.stopPropagation(); markResolved(it.rel); }} title="Mark as resolved (stage)" style={{...s.iconBtn, background:"var(--selection)",color:"var(--text-inverse)",borderColor:"var(--editor-blue)"}}>✓</button>
                  </span>
                </div>
                {openDiff===it.rel && (
                  <div style={{background:"var(--bg-panel)",borderTop:"1px solid var(--border-row)",maxHeight:220,overflow:"auto",padding:"var(--space-6) 0"}}>
                    {diffMap[it.rel]===undefined ? <div style={{padding:"var(--space-8) var(--space-10)",color:"var(--icon)",fontSize:"var(--fs-small)"}}>Loading diff…</div> : renderDiff(diffMap[it.rel], it.rel)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Staged */}
        {groups.staged.length>0 && (
          <div>
            <div style={s.sectionHead} onClick={()=>setCollapsed(c=>({...c,staged:!c.staged}))}>
              <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:collapsed.staged?"rotate(-90deg)":"none",display:"inline-block",transition:"transform var(--t-slow)",fontSize:"var(--fs-tiny)"}}>▼</span> Staged Changes <span style={{background:"var(--editor-blue)",color:"var(--text-inverse)",padding:"var(--space-2) var(--space-6)",borderRadius:"var(--radius-pill)",fontSize:"var(--fs-tiny)",fontWeight:"var(--fw-bold)"}}>{groups.staged.length}</span></span>
              <span style={{display:"flex",gap:"var(--space-4)"}}>
                <button onClick={e=>{ e.stopPropagation(); doUnstageAll(); }} disabled={!!busy} title="Unstage all" style={s.iconBtn}>— Unstage All</button>
              </span>
            </div>
            {!collapsed.staged && groups.staged.map(it=>(
              <div key={"staged:"+it.rel} style={{borderBottom:"1px solid var(--border-row)"}}>
                <div style={{...s.row, background: focusIdx>=0 && flatVisible[focusIdx]?.rel===it.rel ? "var(--bg-hover-strong)":"transparent"}} onClick={()=>openFile(it.rel)} onDoubleClick={()=>toggleDiff(it.rel)} title={(it.rel + (it.origRel ? " — renamed from " + it.origRel : "") + " — " + statusLabel(it.status,it.x,it.y,it) + " — single-click open, double-click diff")} onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover-strong)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onContextMenu={e=>{ e.preventDefault(); e.stopPropagation(); setCtxMenu({x:e.clientX,y:e.clientY, rel:it.rel}); }}>
                  <span style={s.statusBox(statusColor(it.status,it.x,it.y))}>{it.status.trim()||"S"}</span>
                  <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={it.origRel ? (it.origRel + " → " + it.rel) : it.rel}>{it.rel}{it.origRel? <span style={{color:"var(--code-blue)",fontSize:"var(--fs-tiny)"}}> • from {it.origRel.split("/").pop()}</span>:null}</span>
                  {it.partiallyStaged && <span title="Both staged and unstaged changes" style={{fontSize:"var(--fs-tiny)", color:"var(--git-modified)", background:"var(--warn-bg-olive)", padding:"var(--space-1) var(--space-5)", borderRadius:"var(--radius-sm)", border:"var(--space-1) solid var(--warn-border-olive)", flexShrink:0}}>Partial</span>}
                  {!it.partiallyStaged && <span style={{fontSize:"var(--fs-tiny)",color:statusColor(it.status,it.x,it.y),flexShrink:0,background:"var(--bg-surface)",padding:"var(--space-1) var(--space-5)",borderRadius:"var(--radius-sm)",border:"var(--space-1) solid color-mix(in srgb, " + statusColor(it.status,it.x,it.y) + " 20%, transparent)"}}>{statusLabel(it.status,it.x,it.y,it)}</span>}
                  <span style={{display:"flex",gap:"var(--space-3)"}}>
                    <button onClick={e=>{ e.stopPropagation(); toggleDiff(it.rel); }} title={openDiff===it.rel?"Hide diff":"Show diff"} style={{...s.iconBtn, background:openDiff===it.rel?"var(--select-blue)":"var(--bg-active)", color:openDiff===it.rel?"var(--text-inverse)":"var(--text-soft)"}}>{openDiff===it.rel?"−":"◈"}</button>
                    <button onClick={e=>{ e.stopPropagation(); doUnstage(it.rel); }} disabled={busy.includes(it.rel)} title="Unstage" style={{...s.iconBtn, opacity:busy.includes(it.rel)?0.5:1}}>−</button>
                  </span>
                </div>
                {openDiff===it.rel && (
                  <div style={{margin:0,background:"var(--bg-panel)",borderTop:"var(--space-1) solid var(--border-row)",borderBottom:"var(--space-1) solid var(--border-row)",maxHeight:260,overflow:"auto",padding:"var(--space-6) 0"}}>
                    {diffMap[it.rel]===undefined ? <div style={{padding:"var(--space-8) var(--space-10)",color:"var(--icon)",fontSize:"var(--fs-small)"}}>Loading diff…</div> : renderDiff(diffMap[it.rel], it.rel)}
                    <div style={{display:"flex",gap:"var(--space-6)",padding:"var(--space-6) var(--space-8)",borderTop:"var(--space-1) solid var(--border-row)",background:"var(--bg-header)"}}>
                      <button onClick={()=>openFile(it.rel)} style={s.btnGhost}>Open File</button>
                      <button onClick={()=>copyText(it.rel)} style={s.btnGhost}>Copy Path</button>
                      <button onClick={()=> window.electronAPI?.revealInExplorer?.(`${projectPath}/${it.rel}`)} style={s.btnGhost}>Reveal</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Changes */}
        {(groups.changes.length>0 || (total>0 && groups.staged.length===0 && groups.conflicted.length===0)) && (
          <div>
            <div style={s.sectionHead} onClick={()=>setCollapsed(c=>({...c,changes:!c.changes}))}>
              <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:collapsed.changes?"rotate(-90deg)":"none",display:"inline-block",transition:"transform var(--t-slow)",fontSize:"var(--fs-tiny)"}}>▼</span> Changes <span style={{background:"var(--border-light)",color:"var(--text-bright)",padding:"var(--space-2) var(--space-6)",borderRadius:"var(--radius-pill)",fontSize:"var(--fs-tiny)"}}>{groups.changes.length}</span></span>
              <span style={{display:"flex",gap:"var(--space-4)"}}>
                <button onClick={e=>{ e.stopPropagation(); doStageAll(); }} disabled={!!busy} title="Stage all changes" style={s.iconBtn}>+ All</button>
                <button onClick={e=>{ e.stopPropagation(); if(window.confirm("Discard ALL unstaged changes? This cannot be undone.")){ groups.changes.forEach(f=>window.electronAPI.gitDiscard(projectPath,f.rel)); setTimeout(()=>doRefresh(true),600); } }} title="Discard all changes" style={s.iconBtn}>↺</button>
              </span>
            </div>
            {!collapsed.changes && groups.changes.map(it=>(
              <div key={"chg:"+it.rel} style={{borderBottom:"1px solid var(--border-row)"}}>
                <div style={{...s.row, background: focusIdx>=0 && flatVisible[focusIdx]?.rel===it.rel ? "var(--bg-hover-strong)":"transparent"}} onClick={()=>openFile(it.rel)} onDoubleClick={()=>toggleDiff(it.rel)} title={it.rel + " — double-click for diff"} onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover-strong)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onContextMenu={e=>{ e.preventDefault(); e.stopPropagation(); setCtxMenu({x:e.clientX,y:e.clientY, rel:it.rel}); }}>
                  <span style={s.statusBox(statusColor(it.status,it.x,it.y))}>{it.status.trim()||"M"}</span>
                  <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={it.rel}>{it.rel}</span>
                  <span style={{fontSize:"var(--fs-tiny)",color:statusColor(it.status,it.x,it.y),flexShrink:0,background:"var(--bg-surface)",padding:"var(--space-1) var(--space-5)",borderRadius:"var(--radius-sm)",border:"var(--space-1) solid color-mix(in srgb, " + statusColor(it.status,it.x,it.y) + " 20%, transparent)"}}>{statusLabel(it.status,it.x,it.y,it)}</span>
                  <span style={{display:"flex",gap:"var(--space-3)",flexShrink:0}}>
                    <button onClick={e=>{ e.stopPropagation(); toggleDiff(it.rel); }} title="Diff" style={{...s.iconBtn, background:openDiff===it.rel?"var(--select-blue)":"var(--bg-active)", color:openDiff===it.rel?"var(--text-inverse)":"var(--text-soft)"}}>{openDiff===it.rel?"−":"◈"}</button>
                    <button onClick={e=>{ e.stopPropagation(); doStage(it.rel); }} disabled={busy.includes(it.rel)} title="Stage" style={s.iconBtn}>+</button>
                    <button onClick={e=>{ e.stopPropagation(); doDiscard(it.rel); }} disabled={busy.includes(it.rel)} title="Discard" style={s.iconBtn}>↺</button>
                  </span>
                </div>
                {openDiff===it.rel && (
                  <div style={{background:"var(--bg-panel)",borderTop:"1px solid var(--border-row)",maxHeight:260,overflow:"auto",padding:"var(--space-6) 0"}}>
                    {diffMap[it.rel]===undefined ? <div style={{padding:"var(--space-8) var(--space-10)",color:"var(--icon)",fontSize:"var(--fs-small)"}}>Loading diff…</div> : renderDiff(diffMap[it.rel], it.rel)}
                    <div style={{display:"flex",gap:"var(--space-6)",padding:"var(--space-6) var(--space-8)",borderTop:"var(--space-1) solid var(--border-row)",background:"var(--bg-header)"}}>
                      <button onClick={()=>openFile(it.rel)} style={s.btnGhost}>Open File</button>
                      <button onClick={()=>copyText(it.rel)} style={s.btnGhost}>Copy Path</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!collapsed.changes && groups.changes.length===0 && total>0 && <div style={{padding:"var(--space-10) var(--space-12)",fontSize:"var(--fs-small)",color:"var(--text-muted)",fontStyle:"italic"}}>No unstaged changes</div>}
          </div>
        )}

        {/* Untracked */}
        {groups.untracked.length>0 && (
          <div>
            <div style={s.sectionHead} onClick={()=>setCollapsed(c=>({...c,untracked:!c.untracked}))}>
              <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:collapsed.untracked?"rotate(-90deg)":"none",display:"inline-block",transition:"transform var(--t-slow)",fontSize:"var(--fs-tiny)"}}>▼</span> Untracked <span style={{background:"var(--success-badge-bg)",color:"var(--git-added)",padding:"var(--space-2) var(--space-6)",borderRadius:"var(--radius-pill)",fontSize:"var(--fs-tiny)",border:"var(--space-1) solid var(--success-badge-border)"}}>{groups.untracked.length}</span></span>
              <span><button onClick={e=>{ e.stopPropagation(); doStageAll(); }} disabled={!!busy} title="Stage all untracked" style={s.iconBtn}>+ All</button></span>
            </div>
            {!collapsed.untracked && groups.untracked.map(it=>(
              <div key={"unt:"+it.rel} style={{display:"flex",alignItems:"center",gap:"var(--space-6)",padding:"var(--space-5) var(--space-8)",cursor:"pointer",fontSize:"var(--fs-body)",borderBottom:"var(--space-1) solid var(--border-row)", background: focusIdx>=0 && flatVisible[focusIdx]?.rel===it.rel ? "var(--bg-hover-strong)":"transparent"}} onClick={()=>openFile(it.rel)} title={it.rel} onMouseEnter={e=>e.currentTarget.style.background="var(--bg-hover-strong)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onContextMenu={e=>{ e.preventDefault(); e.stopPropagation(); setCtxMenu({x:e.clientX,y:e.clientY, rel:it.rel}); }}>
                <span style={s.statusBox("var(--git-added)")}>U</span>
                <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={it.rel}>{it.rel}</span>
                <span style={{fontSize:"var(--fs-tiny)",color:"var(--git-added)",background:"var(--success-tint-bg)",padding:"var(--space-1) var(--space-5)",borderRadius:"var(--radius-sm)",border:"var(--space-1) solid var(--success-border-3)"}}>Untracked</span>
                <span style={{display:"flex",gap:"var(--space-3)"}}>
                  <button onClick={e=>{ e.stopPropagation(); doStage(it.rel); }} disabled={busy.includes(it.rel)} title="Stage" style={s.iconBtn}>+</button>
                  <button onClick={e=>{ e.stopPropagation(); doDiscard(it.rel); }} title="Delete file — requires confirmation" style={{...s.iconBtn, color:"var(--error-text-pale)", borderColor:"var(--error-border-2)"}}>✕</button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Commits */}
        <div style={{borderTop:"1px solid var(--bg-active)",marginTop:"var(--space-4)"}}>
          <div style={{...s.sectionHead, background:"var(--bg-surface)"}} onClick={()=>setShowLog(v=>!v)}>
            <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:showLog?"none":"rotate(-90deg)",display:"inline-block",transition:"transform var(--t-slow)",fontSize:"var(--fs-tiny)"}}>▼</span> Recent Commits</span>
            <span style={{display:"flex",gap:"var(--space-6)",alignItems:"center"}}>
              <span style={{fontSize:"var(--fs-tiny)",color:"var(--text-muted)",background:"var(--bg-vscode)",padding:"var(--space-2) var(--space-6)",borderRadius:"var(--radius-pill)",border:"var(--space-1) solid var(--bg-active)"}}>{filteredLog.length || 0}{logQuery ? "/" + log.length : ""}</span>
            </span>
          </div>
          {showLog && (
            <div>
              <div style={{padding:"var(--space-6) var(--space-8)",display:"flex",gap:"var(--space-6)",background:"var(--bg-surface)",borderBottom:"var(--space-1) solid var(--border-row)"}}>
                <input value={logQuery} onChange={e=>setLogQuery(e.target.value)} placeholder="Search commits (hash, message, author)…" style={{...s.input, padding:"var(--space-6) var(--space-8)",background:"var(--bg-vscode)",border:"var(--space-1) solid var(--border-light)",fontSize:"var(--fs-small)"}} />
                {logQuery && <button onClick={()=>setLogQuery("")} style={s.btnGhost}>✕</button>}
              </div>
              {filteredLog.length===0 && <div style={{padding:"var(--space-14)",fontSize:"var(--fs-small)",color:"var(--text-muted)",textAlign:"center"}}>{log.length===0 ? "No commits yet — make your first commit above" : "No matching commits"}</div>}
              {filteredLog.map(c=>(
                <div key={c.fullHash} style={{padding:"var(--space-8) var(--space-10)",borderBottom:"var(--space-1) solid var(--border-row)",fontSize:"var(--fs-small)",background:"var(--bg-deep)"}} title={c.fullHash + "\n" + c.author + " <" + c.email + ">\n" + (c.refs||"")}>
                  <div style={{display:"flex",gap:7,alignItems:"center"}}>
                    <button onClick={()=>copyHash(c.fullHash)} title="Copy full hash" style={{color:"var(--code-blue)",fontFamily:"var(--font-code)",fontSize:"var(--fs-tiny)",background:"var(--bg-vscode)",padding:"var(--space-2) var(--space-5)",borderRadius:"var(--radius-sm)",border:"var(--space-1) solid var(--bg-active)",cursor:"pointer"}}>{c.hash}</button>
                    <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"var(--text-input)",fontWeight:"var(--fw-semibold)"}} title={c.msg}>{c.msg}</span>
                    {c.refs && <span style={{fontSize:"var(--fs-tiny)",color:"var(--git-modified)",background:"var(--bg-active)",padding:"var(--space-1) var(--space-5)",borderRadius:"var(--radius-sm)"}}>{c.refs}</span>}
                  </div>
                  <div style={{fontSize:"var(--fs-tiny)",color:"var(--icon)",marginTop:"var(--space-4)",display:"flex",gap:"var(--space-6)",alignItems:"center",flexWrap:"wrap"}}>
                    <span>{c.author} • {c.relTime}</span>
                    <span style={{marginLeft:"auto",display:"flex",gap:"var(--space-4)"}}>
                      <button onClick={()=>copyHash(c.fullHash)} style={s.iconBtn} title="Copy hash">⎘</button>
                      <button onClick={()=>viewCommit(c)} style={s.iconBtn} title="View diff">◈ Diff</button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* commit detail modal */}
      {showCommitDetail && (
        <div style={{position:"absolute", inset:0, background:"var(--overlay-a55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:"var(--z-toast)", padding:"var(--space-12)"}} onClick={()=>setShowCommitDetail(null)}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:720,maxHeight:"88%",background:"var(--bg-surface)",border:"1px solid var(--border-light)",borderRadius:"var(--radius-lg)",overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"var(--space-8) var(--space-10)",background:"var(--bg-vscode)",borderBottom:"var(--space-1) solid var(--bg-active)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:"var(--space-8)"}}>
              <span style={{fontSize:"var(--fs-body)",fontWeight:"var(--fw-bold)"}}>Commit {showCommitDetail.hash} <span style={{fontWeight:"var(--fw-regular)",color:"var(--icon)",fontFamily:"var(--font-code)",fontSize:"var(--fs-tiny)"}}>{showCommitDetail.fullHash}</span></span>
              <span style={{display:"flex",gap:"var(--space-6)"}}>
                <button onClick={()=>copyText(showCommitDetail.fullHash)} style={s.btnGhost}>Copy Hash</button>
                <button onClick={()=>setShowCommitDetail(null)} style={s.btnGhost}>✕ Close</button>
              </span>
            </div>
            <div style={{flex:1,overflow:"auto",padding:0}}>
              {showCommitDetail.loading ? <div style={{padding:"var(--space-20)",color:"var(--icon)",textAlign:"center"}}>Loading…</div> : (
                <>
                  {showCommitDetail.stat && <pre style={{margin:0,padding:"var(--space-8) var(--space-10)",background:"var(--bg-deep)",borderBottom:"var(--space-1) solid var(--bg-active)",fontFamily:"var(--font-code)",fontSize:"var(--fs-small)",whiteSpace:"pre-wrap",wordBreak:"break-word",color:"var(--text-bright)"}}>{showCommitDetail.stat}</pre>}
                  <div style={{maxHeight:420,overflow:"auto",background:"var(--bg-panel)",padding:"var(--space-6) 0"}}>
                    {renderDiff(showCommitDetail.diff, showCommitDetail.fullHash)}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* context menu */}
      {ctxMenu && (
        <div style={{position:"fixed", left:Math.min(ctxMenu.x, window.innerWidth-220), top:Math.min(ctxMenu.y, window.innerHeight-240), background:"var(--bg-vscode)", border:"1px solid var(--border-light)", borderRadius:"var(--radius-lg)", boxShadow:"var(--shadow-pop)", zIndex:"var(--z-toast-top)", minWidth:180, overflow:"hidden", fontSize:"var(--fs-body)"}} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>{ setCtxMenu(null); openFile(ctxMenu.rel); }} style={{display:"block",width:"100%",textAlign:"left",padding:"var(--space-8) var(--space-12)",background:"transparent",border:"none",color:"var(--text-bright)",cursor:"pointer",borderBottom:"var(--space-1) solid var(--bg-active)"}}>Open</button>
          <button onClick={()=>{ setCtxMenu(null); toggleDiff(ctxMenu.rel); }} style={{display:"block",width:"100%",textAlign:"left",padding:"var(--space-8) var(--space-12)",background:"transparent",border:"none",color:"var(--text-bright)",cursor:"pointer"}}>Open Changes (Diff)</button>
          <div style={{height:1,background:"var(--bg-active)"}}/>
          <button onClick={()=>{ const r=ctxMenu.rel; setCtxMenu(null); const it=status.find(x=>x.rel===r); const isStaged= it && it.x!==" " && it.x!=="?" ; if(isStaged) doUnstage(r); else doStage(r); }} style={{display:"block",width:"100%",textAlign:"left",padding:"var(--space-8) var(--space-12)",background:"transparent",border:"none",color:"var(--text-bright)",cursor:"pointer"}}>{(()=>{
            const it=status.find(x=>x.rel===ctxMenu.rel);
            return (it && it.x!==" " && it.x!=="?" && it.x!=="U") ? "Unstage" : "Stage";
          })()}</button>
          <button onClick={()=>{ const r=ctxMenu.rel; setCtxMenu(null); doDiscard(r); }} style={{display:"block",width:"100%",textAlign:"left",padding:"var(--space-8) var(--space-12)",background:"transparent",border:"none",color:"var(--error-text-pale)",cursor:"pointer"}}>Discard Changes</button>
          <div style={{height:1,background:"var(--bg-active)"}}/>
          <button onClick={()=>{ copyText(ctxMenu.rel); setCtxMenu(null); }} style={{display:"block",width:"100%",textAlign:"left",padding:"var(--space-8) var(--space-12)",background:"transparent",border:"none",color:"var(--text-bright)",cursor:"pointer"}}>Copy Relative Path</button>
          <button onClick={()=>{ window.electronAPI?.revealInExplorer?.(`${projectPath}/${ctxMenu.rel}`); setCtxMenu(null); }} style={{display:"block",width:"100%",textAlign:"left",padding:"var(--space-8) var(--space-12)",background:"transparent",border:"none",color:"var(--text-bright)",cursor:"pointer"}}>Reveal in Explorer</button>
        </div>
      )}

      {/* footer */}
      <div style={{padding:"var(--space-6) var(--space-10)",fontSize:"var(--fs-tiny)",color:"var(--icon-muted)",borderTop:"var(--space-1) solid var(--bg-active)",display:"flex",justifyContent:"space-between",flexShrink:0,background:"var(--bg-vscode)",alignItems:"center"}}>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:"var(--space-6)"}}>
          <span style={{width:6,height:6,borderRadius:"var(--radius-round)",background: groups.conflicted.length?"var(--danger)": total?"var(--git-modified)":"var(--success)",display:"inline-block"}}/>
           {projectPath.split(/[\\/]/).pop()} {groups.conflicted.length ? "• " + groups.conflicted.length + " conflicts" : ""}
        </span>
        <span style={{display:"flex",gap:"var(--space-6)",alignItems:"center"}}>
          {lastRefresh && <span style={{color:"var(--text-placeholder)"}}>{lastRefresh.toLocaleTimeString()}</span>}
          <span style={{background:"var(--bg-surface)",padding:"var(--space-1) var(--space-6)",borderRadius:"var(--radius-pill)",border:"var(--space-1) solid var(--bg-active)"}}>{branchInfo.branch ? "⎇ " + branchInfo.branch : "no branch"} • {total}</span>
        </span>
      </div>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
