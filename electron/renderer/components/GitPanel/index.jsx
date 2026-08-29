// GitPanel — full-featured Source Control, production ready
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";

// ── helpers ──────────────────────────────────────────────────────────
function statusColor(st, x, y) {
  if (st === "??") return "#73c991";
  if (x === "U" || y === "U" || (x==="A"&&y==="A") || (x==="D"&&y==="D")) return "#f44747";
  if (st.includes("A")) return "#73c991";
  if (st.includes("D")) return "#f44747";
  if (st.includes("M")) return "#cca700";
  if (st.includes("R") || st.includes("C")) return "#569cd6";
  if (st === "UU") return "#f44747";
  return "#888";
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

// ── styles ───────────────────────────────────────────────────────────
const s = {
  wrap:{ display:"flex", flexDirection:"column", height:"100%", background:"#1e1e1e", color:"#cccccc", overflow:"hidden", fontFamily:"'Segoe UI',system-ui,sans-serif" },
  header:{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 8px", background:"#252526", borderBottom:"1px solid #2d2d2d", flexShrink:0, gap:6, flexWrap:"wrap" },
  branchBtn:{ display:"flex", alignItems:"center", gap:5, background:"#094771", color:"#fff", padding:"4px 9px", borderRadius:4, fontSize:11, fontWeight:700, maxWidth:165, border:"none", cursor:"pointer", minHeight:24 },
  pill:(active)=>({ fontSize:10, background:active?"#0e639c":"#2d2d2d", color:active?"#fff":"#999", padding:"2px 7px", borderRadius:10, fontWeight:700, border:"1px solid #2d2d2d" }),
  btn:{ background:"#0e639c", color:"#fff", border:"1px solid #0e639c", borderRadius:4, padding:"6px 12px", fontSize:11, cursor:"pointer", fontWeight:700, display:"flex", alignItems:"center", gap:4, justifyContent:"center" },
  btnGhost:{ background:"#2d2d2d", border:"1px solid #3a3a3a", color:"#cccccc", borderRadius:4, padding:"5px 10px", fontSize:11, cursor:"pointer", fontWeight:600 },
  iconBtn:{ background:"#2d2d2d", border:"1px solid #3a3a3a", color:"#bbb", cursor:"pointer", padding:"3px 6px", borderRadius:4, fontSize:11, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", minWidth:24, minHeight:22 },
  input:{ width:"100%", background:"#3c3c3c", border:"1px solid #3c3c3c", color:"#e0e0e0", borderRadius:4, padding:"6px 8px", fontSize:12, outline:"none", resize:"none", fontFamily:"inherit" },
  sectionHead:{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 8px", background:"#252526", borderTop:"1px solid #2d2d2d", borderBottom:"1px solid #2d2d2d", fontSize:11, fontWeight:800, letterSpacing:0.35, textTransform:"uppercase", color:"#bbbbbb", cursor:"pointer", userSelect:"none" },
  row:{ display:"flex", alignItems:"center", gap:6, padding:"5px 8px", cursor:"pointer", fontSize:12, borderBottom:"1px solid #232323" },
  statusBox:(c)=>({ minWidth:24, textAlign:"center", fontSize:10, fontWeight:800, color:c, background:"#1e1e1e", border:"1px solid " + c + "33", padding:"2px 4px", borderRadius:3, flexShrink:0, letterSpacing:0.2 }),
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
    const full= projectPath ? `${projectPath}/${rel}`.replace(/\\/g,"/").replace(/\/\//g,"/") : rel;
    const normalized=full.replace(/\//g,"\\");
    window.dispatchEvent(new CustomEvent("open-file-in-editor",{ detail:{ path: normalized }}));
  };
  const copyText=async(t)=>{
    try{ if(window.electronAPI?.clipboardWrite) await window.electronAPI.clipboardWrite(t); else await navigator.clipboard.writeText(t); showToast("Copied"); }catch{ showToast("Copy failed",true); }
  };

  // diff rendering with line numbers, lazy, size guard
  const renderDiff=(text, rel)=>{
    if(text===undefined) return <div style={{padding:"8px 10px",color:"#888",fontSize:11}}>Loading…</div>;
    if(!text || text==="(no diff)" || text==="(error)") return <div style={{padding:"6px 10px",color:"#777",fontSize:11}}>{text||"(no diff)"}</div>;
    if(text==="Binary file — diff not displayed") return <div style={{padding:"8px 10px",color:"#cca700",fontSize:11}}>Binary file — no text diff</div>;
    const str=String(text);
    if(str.length>500000) return <div style={{padding:"8px 10px",color:"#cca700",fontSize:11}}>Diff too large ({(str.length/1000).toFixed(0)} KB) — <button onClick={()=>openFile(rel)} style={s.btnGhost}>Open File</button></div>;
    const lines=str.split("\n").slice(0,700);
    const large = lines.length>500;
    const shown = large ? lines.slice(0,500) : lines;
    return (
      <div style={{ fontFamily:"Consolas, monospace", fontSize:11, lineHeight:"15px" }}>
        {shown.map((l,i)=>{
          let bg="transparent", col="#ccc", prefix=" ";
          if(l.startsWith("+") && !l.startsWith("+++")){ bg="rgba(115,201,145,0.10)"; col="#73c991"; prefix="+"; }
          else if(l.startsWith("-") && !l.startsWith("---")){ bg="rgba(244,71,71,0.09)"; col="#ff7b72"; prefix="-"; }
          else if(l.startsWith("@@")){ bg="rgba(86,156,214,0.10)"; col="#569cd6"; prefix="@"; }
          const isHeader = l.startsWith("diff ")||l.startsWith("index ")||l.startsWith("---")||l.startsWith("+++");
          return <div key={i} style={{ display:"flex", background:bg, color:isHeader?"#888":col, padding:"0 4px", whiteSpace:"pre", overflow:"hidden" }}>
            <span style={{ width:36, flexShrink:0, color:"#555", textAlign:"right", paddingRight:6, userSelect:"none", borderRight:"1px solid #2a2a2a", marginRight:6 }}>{i+1}</span>
            <span style={{ flex:1, overflow:"hidden", textOverflow:"ellipsis" }}>{l || " "}</span>
          </div>;
        })}
        {large && <div style={{padding:"6px 10px",color:"#569cd6",fontSize:11}}>… truncated ({lines.length-500} more lines) — <button onClick={()=>openFile(rel)} style={{...s.btnGhost, padding:"2px 6px"}}>Open file</button></div>}
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
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:"#666", fontSize:12, flexDirection:"column", gap:10, background:"#1e1e1e", padding:20, textAlign:"center" }}>
        <div style={{width:44,height:44,borderRadius:10,background:"#252526",border:"1px solid #2d2d2d",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>⎇</div>
        <div style={{fontWeight:700,color:"#999"}}>No project open</div>
        <div style={{fontSize:11,color:"#666",maxWidth:220}}>Open a folder with a git repository to see changes, branches and commits.</div>
        <div style={{fontSize:11,color:"#555",background:"#252526",padding:"6px 10px",borderRadius:4,border:"1px solid #2d2d2d"}}>File → Open Project…</div>
      </div>
    );
  }
  if(branchInfo && branchInfo.isRepo===false){
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", background:"#1e1e1e", color:"#cccccc" }}>
        <div style={s.header}><div style={{fontSize:12,fontWeight:700}}>Source Control</div><button onClick={()=>doRefresh(true)} style={s.btnGhost} title="Refresh">↻ Refresh</button></div>
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,padding:24,textAlign:"center"}}>
          <div style={{width:48,height:48,borderRadius:12,background:"#252526",border:"1px dashed #3a3a3a",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,color:"#666"}}>∅</div>
          <div style={{fontSize:14,fontWeight:700,color:"#bbb"}}>Not a git repository</div>
          <div style={{fontSize:12,color:"#777",maxWidth:260,wordBreak:"break-all"}}>{projectPath}</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
            <button onClick={doInit} disabled={!!busy} style={{...s.btn, opacity:busy?0.6:1}} title="Run git init">{busy==="init"?"…":"Initialize Repository"}</button>
            <button onClick={()=>doRefresh(true)} style={s.btnGhost}>↻ Refresh</button>
            <button onClick={()=>window.electronAPI?.revealInExplorer?.(projectPath)} style={s.btnGhost}>Reveal folder</button>
          </div>
          {error && <div style={{fontSize:11,color:"#f44747",background:"#3a1d1d",padding:"6px 10px",borderRadius:4,border:"1px solid #5a2a2a",maxWidth:320,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>⚠ {error}</div>}
          <div style={{fontSize:10,color:"#555",background:"#252526",padding:"6px 8px",borderRadius:4,border:"1px solid #2d2d2d"}}>This will run <span style={{fontFamily:"Consolas,monospace"}}>git init</span> in the open folder.</div>
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
        <div style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0}}>
          <button onClick={()=>setBranchPickerOpen(v=>!v)} style={s.branchBtn} title="Branch — click to switch/create" aria-haspopup="menu" aria-expanded={branchPickerOpen}>
            <span style={{fontSize:13}}>⎇</span>
            <span style={{maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{branchInfo.branch||"HEAD"}</span>
            <span style={{fontSize:9,opacity:0.8}}>▾</span>
            {(branchInfo.ahead||branchInfo.behind) ? <span style={{background:"rgba(255,255,255,0.18)",padding:"1px 5px",borderRadius:10,fontSize:10,display:"flex",gap:4}}>{branchInfo.ahead ? "↑" + branchInfo.ahead : ""}{branchInfo.behind ? "↓" + branchInfo.behind : ""}</span>:null}
          </button>
          <span style={s.pill(total>0)} title={String(total) + " changed files"}>{total} • {total===1 ? "change" : "changes"}</span>
          {loading && <span style={{fontSize:10,color:"#4ec9b0",display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,border:"2px solid #4ec9b0",borderTopColor:"transparent",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}}/>syncing</span>}
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center"}}>
          <button onClick={doFetch} disabled={!!busy} title={branchInfo.hasRemote===false?"No remote configured":"Fetch"} style={{...s.iconBtn, opacity:(!busy && branchInfo.hasRemote===false)?0.45:(busy?0.6:1)}}>{busy==="fetch"?"…":"⟳"}</button>
          <button onClick={doPull} disabled={!!busy} title="Pull" style={{...s.iconBtn,opacity:busy?0.6:1}}>{busy==="pull"?"…":"↓"}</button>
          <button onClick={doPush} disabled={!!busy} title="Push" style={{...s.iconBtn,opacity:busy?0.6:1}}>{busy==="push"?"…":"↑"}</button>
          <button onClick={()=>doRefresh(true)} disabled={loading} title={lastRefresh?`Last: ${lastRefresh.toLocaleTimeString()}`:"Refresh"} style={{...s.iconBtn, opacity:loading?0.5:1}}>{loading?"…":"↻"}</button>
          {nodeId && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("close-flex-tab", { detail: { nodeId } }))}
              title="Close Git panel"
              style={{...s.iconBtn, color:"#888", opacity:0.7}}
              onMouseEnter={(e)=>{ e.currentTarget.style.color="#fff"; e.currentTarget.style.opacity="1"; }}
              onMouseLeave={(e)=>{ e.currentTarget.style.color="#888"; e.currentTarget.style.opacity="0.7"; }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* branch picker */}
      {branchPickerOpen && (
        <div style={{background:"#252526",borderBottom:"1px solid #2d2d2d",padding:8,display:"flex",flexDirection:"column",gap:8, flexShrink:0}}>
          <input value={branchFilter} onChange={e=>setBranchFilter(e.target.value)} placeholder="Filter branches…" autoFocus style={{...s.input, padding:"6px 8px", background:"#1e1e1e", border:"1px solid #3a3a3a"}} />
          <div style={{display:"flex",gap:6}}>
            <input value={newBranchName} onChange={e=>setNewBranchName(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") handleCreateBranch(); }} placeholder="New branch name" style={{...s.input, flex:1, padding:"6px 8px", background:"#1e1e1e", border:"1px solid #3a3a3a"}} />
            <button onClick={handleCreateBranch} disabled={!!busy || !newBranchName.trim()} style={{...s.btn, opacity:(!newBranchName.trim()||busy)?0.5:1, padding:"6px 10px"}}>Create</button>
          </div>
          <div style={{maxHeight:160,overflowY:"auto",border:"1px solid #2d2d2d",borderRadius:4,background:"#1e1e1e"}}>
            <div style={{padding:"5px 8px",fontSize:10,color:"#999",fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",borderBottom:"1px solid #2d2d2d"}}>Local ({filteredLocal.length}) {branchInfo.branch ? "• current: " + branchInfo.branch : ""}</div>
            {filteredLocal.length===0 && <div style={{padding:"8px 10px",fontSize:11,color:"#666"}}>No matching branches</div>}
            {filteredLocal.map(b=>(
              <div key={"l:"+b} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",fontSize:11, borderBottom:"1px solid #232323", background: b===branchInfo.branch?"#094771":"transparent", color:b===branchInfo.branch?"#fff":"#ccc"}}>
                <button onClick={()=>handleSwitch(b)} disabled={!!busy || b===branchInfo.branch} style={{flex:1,textAlign:"left",background:"transparent",border:"none",color:"inherit",cursor:b===branchInfo.branch?"default":"pointer",fontWeight:b===branchInfo.branch?700:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={b===branchInfo.branch?"Current":"Switch to "+b}>{b}{b===branchInfo.branch?" • current":""}</button>
                <button onClick={()=>handleRenameBranch(b)} title="Rename" style={{...s.iconBtn,padding:"2px 5px",fontSize:10}}>✎</button>
                <button onClick={()=>handleDeleteBranch(b)} title="Delete" disabled={b===branchInfo.branch} style={{...s.iconBtn,padding:"2px 5px",fontSize:10,opacity:b===branchInfo.branch?0.4:1}}>✕</button>
              </div>
            ))}
            <div style={{padding:"5px 8px",fontSize:10,color:"#999",fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",borderBottom:"1px solid #2d2d2d",borderTop:"1px solid #2d2d2d"}}>Remote ({filteredRemote.length})</div>
            {filteredRemote.length===0 && <div style={{padding:"8px 10px",fontSize:11,color:"#666"}}>No remote branches</div>}
            {filteredRemote.map(b=>(
              <div key={"r:"+b} style={{display:"flex",alignItems:"center",padding:"5px 8px",fontSize:11,borderBottom:"1px solid #232323"}}>
                <button onClick={()=>{
                  // checkout remote => create local tracking
                  const localName=b.replace(/^origin\//,"");
                  handleSwitch(localName);
                }} style={{flex:1,textAlign:"left",background:"transparent",border:"none",color:"#569cd6",cursor:"pointer",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={"Checkout "+b}>{b}</button>
              </div>
            ))}
          </div>
          <div style={{display:"flex",justifyContent:"flex-end"}}><button onClick={()=>setBranchPickerOpen(false)} style={s.btnGhost}>Close</button></div>
        </div>
      )}

      {/* Error + Toast */}
      {error && (
        <div style={{margin:"8px 8px 0",padding:"8px 10px",background:"#5a1d1d",border:"1px solid #7a2a2a",borderRadius:4,color:"#ffb3b3",fontSize:11,display:"flex",justifyContent:"space-between",gap:8,alignItems:"flex-start"}}>
          <span style={{flex:1,wordBreak:"break-word",whiteSpace:"pre-wrap"}}>⚠ {error}</span>
          <button onClick={()=>setError(null)} style={{background:"transparent",border:"none",color:"#ffb3b3",cursor:"pointer",fontSize:16,lineHeight:1}}>×</button>
        </div>
      )}
      {toast && <div style={{margin:error?"6px 8px 0":"8px 8px 0",padding:"7px 10px",background:toast.isError?"#5a1d1d":"#1a3a2a",border:"1px solid " + (toast.isError?"#7a2a2a":"#2a5a3a"),borderRadius:4,color:toast.isError?"#ffb3b3":"#4ec9b0",fontSize:11}}>{toast.text}</div>}

      {/* Sync hints */}
      {branchInfo.hasRemote===false && (
        <div style={{margin:"6px 8px 0",padding:"6px 8px",background:"#2d2d1a",border:"1px solid #4a4a2a",borderRadius:4,color:"#cca700",fontSize:11}}>No remote configured — push/pull will fail. <span style={{color:"#999"}}>Add with: <span style={{fontFamily:"Consolas,monospace"}}>git remote add origin &lt;url&gt;</span></span></div>
      )}

      {/* Commit box */}
      <div style={{padding:10,borderBottom:"1px solid #2d2d2d",background:"#252526",flexShrink:0}}>
        <textarea value={msg} onChange={e=>setMsg(e.target.value)} placeholder={amend?"Amend message — Ctrl+Enter to amend last commit":"Message — Ctrl+Enter to commit staged (Cmd+Enter on Mac)"} rows={2} onKeyDown={e=>{ if((e.ctrlKey||e.metaKey) && e.key==="Enter"){ e.preventDefault(); if(e.shiftKey) doCommitAndPush(); else doCommit(); } }} style={{...s.input, borderColor:msg.trim()?"#0e639c":"#3c3c3c", boxShadow:msg.trim()?"0 0 0 1px rgba(14,99,156,0.25)":"none", minHeight:52}} />
        <div style={{display:"flex",gap:6,marginTop:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>doCommit(false)} disabled={!msg.trim() || !!busy} style={{...s.btn, opacity:(!msg.trim()||busy)?0.5:1, flex:1, minWidth:110}} title="Ctrl+Enter">
            {busy==="commit"?"Committing…": amend ? ("Amend" + (groups.staged.length ? " • " + groups.staged.length + " staged" : "")) : ("Commit" + (groups.staged.length ? " • " + groups.staged.length + " staged" : ""))}
          </button>
          <button onClick={doCommitAndPush} disabled={!msg.trim() || !!busy} style={{...s.btnGhost, opacity:(!msg.trim()||busy)?0.5:1, background:"#0e639c",color:"#fff",borderColor:"#0e639c"}} title="Commit then push (Ctrl+Shift+Enter)">Commit & Push</button>
          <button onClick={doStageAll} disabled={(!groups.changes.length && !groups.untracked.length) || !!busy} style={{...s.btnGhost, opacity:(!groups.changes.length&&!groups.untracked.length)?0.5:1}} title="Stage all">+ All</button>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:10,color:"#777",gap:8,flexWrap:"wrap"}}>
          <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",userSelect:"none"}}>
            <input type="checkbox" checked={amend} onChange={e=>setAmend(e.target.checked)} style={{accentColor:"#0e639c"}} /> Amend last commit
          </label>
          <span style={{display:"flex",gap:8,alignItems:"center"}}>
            <span>{groups.staged.length?String(groups.staged.length)+" staged":"Stage files then commit"}</span>
            <span style={{color:msg.length>72?"#cca700":msg.length>0?"#999":"#555"}}>{String(msg.length)+"/280 "+ (msg.length>72 && msg.length<=280 ? "• wrap at 72" : msg.length>280?"• too long":"")}</span>
          </span>
        </div>
      </div>

      {/* Filter */}
      <div style={{padding:"7px 8px",borderBottom:"1px solid #232323",display:"flex",gap:6,flexShrink:0,background:"#1e1e1e",alignItems:"center"}}>
        <div style={{position:"relative",flex:1}}>
          <span style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",color:"#666",fontSize:12}}>⌕</span>
          <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter by file…" aria-label="Filter files" style={{...s.input, padding:"6px 8px 6px 24px",fontSize:12,background:"#252526",border:"1px solid #3a3a3a"}} />
        </div>
        {filter && <button onClick={()=>setFilter("")} style={s.btnGhost} aria-label="Clear filter">✕</button>}
        <span style={{fontSize:10,color:"#666",whiteSpace:"nowrap"}}>{filtered.length}/{status.length}</span>
      </div>

      {/* Lists */}
      <div ref={listRef} style={{flex:1,overflowY:"auto",overflowX:"hidden"}} role="list" aria-label="Changed files" tabIndex={-1}>
        {total===0 && !loading && !error && (
          <div style={{textAlign:"center",padding:32,color:"#888"}}>
            <div style={{width:40,height:40,borderRadius:10,background:"#252526",border:"1px solid #2d2d2d",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 10px",fontSize:18,color:"#4caf50"}}>✓</div>
            <div style={{fontWeight:700,color:"#bbb",fontSize:13}}>Working tree clean</div>
            <div style={{fontSize:11,color:"#666",marginTop:4}}>No changes detected</div>
            {log.length>0 && <div style={{marginTop:14,fontSize:11,color:"#777",background:"#252526",padding:"8px 10px",borderRadius:4,border:"1px solid #2d2d2d",textAlign:"left"}}><div style={{color:"#999",fontWeight:600,marginBottom:4}}>Last commit</div><div style={{color:"#569cd6",fontFamily:"monospace",fontSize:10}}>{log[0]?.hash}</div><div style={{color:"#ccc",marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{log[0]?.msg}</div><div style={{color:"#777",fontSize:10,marginTop:2}}>{log[0]?.author} • {log[0]?.relTime}</div></div>}
          </div>
        )}
        {loading && total===0 && (
          <div style={{padding:16,display:"flex",flexDirection:"column",gap:8}}>{[1,2,3].map(i=><div key={i} style={{height:14,background:"#252526",borderRadius:4,opacity:0.6}}/>)}</div>
        )}

        {/* Conflicts */}
        {groups.conflicted.length>0 && (
          <div>
            <div style={{...s.sectionHead, background:"#3a1f1f", color:"#ffb3b3", borderColor:"#5a2a2a"}} onClick={()=>setCollapsed(c=>({...c,conflicts:!c.conflicts}))}>
              <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:collapsed.conflicts?"rotate(-90deg)":"none",display:"inline-block",transition:"transform 0.15s",fontSize:10}}>▼</span> Merge Conflicts <span style={{background:"#f44747",color:"#fff",padding:"2px 6px",borderRadius:10,fontSize:10,fontWeight:700}}>{groups.conflicted.length}</span></span>
              <span style={{fontSize:10,color:"#ff9b9b"}}>Resolve → Stage</span>
            </div>
            {!collapsed.conflicts && groups.conflicted.map(it=>(
              <div key={"conf:"+it.rel} style={{borderBottom:"1px solid #232323", background:"#2a1e1e"}}>
                <div style={{...s.row, background: focusIdx>=0 && flatVisible[focusIdx]?.rel===it.rel ? "#3a2a2a":"transparent"}}
                  onClick={()=>openFile(it.rel)} title={it.rel + " — conflicted — click to open — double-click to diff"} onDoubleClick={()=>toggleDiff(it.rel)}
                  onMouseEnter={e=>e.currentTarget.style.background="#3a2a2a"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  onContextMenu={e=>{ e.preventDefault(); e.stopPropagation(); setCtxMenu({x:e.clientX,y:e.clientY, rel:it.rel}); }}>
                  <span style={s.statusBox("#f44747")}>U</span>
                  <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={it.rel}>{it.rel}</span>
                  <span style={{fontSize:10,color:"#f44747",background:"#1e1e1e",padding:"1px 5px",borderRadius:3,border:"1px solid #5a2a2a"}}>Conflicted</span>
                  <span style={{display:"flex",gap:3,flexShrink:0}}>
                    <button onClick={e=>{ e.stopPropagation(); openFile(it.rel); }} title="Open" style={s.iconBtn}>↗</button>
                    <button onClick={e=>{ e.stopPropagation(); toggleDiff(it.rel); }} title={openDiff===it.rel?"Hide diff":"Show diff"} style={{...s.iconBtn, background:openDiff===it.rel?"#7a2a2a":"#2d2d2d", color:openDiff===it.rel?"#fff":"#bbb"}}>{openDiff===it.rel?"−":"◈"}</button>
                    <button onClick={e=>{ e.stopPropagation(); markResolved(it.rel); }} title="Mark as resolved (stage)" style={{...s.iconBtn, background:"#264f78",color:"#fff",borderColor:"#0e639c"}}>✓</button>
                  </span>
                </div>
                {openDiff===it.rel && (
                  <div style={{background:"#111",borderTop:"1px solid #232323",maxHeight:220,overflow:"auto",padding:"6px 0"}}>
                    {diffMap[it.rel]===undefined ? <div style={{padding:"8px 10px",color:"#888",fontSize:11}}>Loading diff…</div> : renderDiff(diffMap[it.rel], it.rel)}
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
              <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:collapsed.staged?"rotate(-90deg)":"none",display:"inline-block",transition:"transform 0.15s",fontSize:10}}>▼</span> Staged Changes <span style={{background:"#0e639c",color:"#fff",padding:"2px 6px",borderRadius:10,fontSize:10,fontWeight:700}}>{groups.staged.length}</span></span>
              <span style={{display:"flex",gap:4}}>
                <button onClick={e=>{ e.stopPropagation(); doUnstageAll(); }} disabled={!!busy} title="Unstage all" style={s.iconBtn}>— Unstage All</button>
              </span>
            </div>
            {!collapsed.staged && groups.staged.map(it=>(
              <div key={"staged:"+it.rel} style={{borderBottom:"1px solid #232323"}}>
                <div style={{...s.row, background: focusIdx>=0 && flatVisible[focusIdx]?.rel===it.rel ? "#2a2d2e":"transparent"}} onClick={()=>openFile(it.rel)} onDoubleClick={()=>toggleDiff(it.rel)} title={(it.rel + (it.origRel ? " — renamed from " + it.origRel : "") + " — " + statusLabel(it.status,it.x,it.y,it) + " — single-click open, double-click diff")} onMouseEnter={e=>e.currentTarget.style.background="#2a2d2e"} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onContextMenu={e=>{ e.preventDefault(); e.stopPropagation(); setCtxMenu({x:e.clientX,y:e.clientY, rel:it.rel}); }}>
                  <span style={s.statusBox(statusColor(it.status,it.x,it.y))}>{it.status.trim()||"S"}</span>
                  <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={it.origRel ? (it.origRel + " → " + it.rel) : it.rel}>{it.rel}{it.origRel? <span style={{color:"#569cd6",fontSize:10}}> • from {it.origRel.split("/").pop()}</span>:null}</span>
                  {it.partiallyStaged && <span title="Both staged and unstaged changes" style={{fontSize:10, color:"#cca700", background:"#2d2d1a", padding:"1px 5px", borderRadius:3, border:"1px solid #4a4a2a", flexShrink:0}}>Partial</span>}
                  {!it.partiallyStaged && <span style={{fontSize:10,color:statusColor(it.status,it.x,it.y),flexShrink:0,background:"#1e1e1e",padding:"1px 5px",borderRadius:3,border:"1px solid " + statusColor(it.status,it.x,it.y) + "33"}}>{statusLabel(it.status,it.x,it.y,it)}</span>}
                  <span style={{display:"flex",gap:3}}>
                    <button onClick={e=>{ e.stopPropagation(); toggleDiff(it.rel); }} title={openDiff===it.rel?"Hide diff":"Show diff"} style={{...s.iconBtn, background:openDiff===it.rel?"#094771":"#2d2d2d", color:openDiff===it.rel?"#fff":"#bbb"}}>{openDiff===it.rel?"−":"◈"}</button>
                    <button onClick={e=>{ e.stopPropagation(); doUnstage(it.rel); }} disabled={busy.includes(it.rel)} title="Unstage" style={{...s.iconBtn, opacity:busy.includes(it.rel)?0.5:1}}>−</button>
                  </span>
                </div>
                {openDiff===it.rel && (
                  <div style={{margin:0,background:"#111",borderTop:"1px solid #232323",borderBottom:"1px solid #232323",maxHeight:260,overflow:"auto",padding:"6px 0"}}>
                    {diffMap[it.rel]===undefined ? <div style={{padding:"8px 10px",color:"#888",fontSize:11}}>Loading diff…</div> : renderDiff(diffMap[it.rel], it.rel)}
                    <div style={{display:"flex",gap:6,padding:"6px 8px",borderTop:"1px solid #232323",background:"#1a1a1a"}}>
                      <button onClick={()=>openFile(it.rel)} style={s.btnGhost}>Open File</button>
                      <button onClick={()=>copyText(it.rel)} style={s.btnGhost}>Copy Path</button>
                      <button onClick={()=> window.electronAPI?.revealInExplorer?.(projectPath+"\\"+it.rel.replace(/\//g,"\\"))} style={s.btnGhost}>Reveal</button>
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
              <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:collapsed.changes?"rotate(-90deg)":"none",display:"inline-block",transition:"transform 0.15s",fontSize:10}}>▼</span> Changes <span style={{background:"#3a3a3a",color:"#ccc",padding:"2px 6px",borderRadius:10,fontSize:10}}>{groups.changes.length}</span></span>
              <span style={{display:"flex",gap:4}}>
                <button onClick={e=>{ e.stopPropagation(); doStageAll(); }} disabled={!!busy} title="Stage all changes" style={s.iconBtn}>+ All</button>
                <button onClick={e=>{ e.stopPropagation(); if(window.confirm("Discard ALL unstaged changes? This cannot be undone.")){ groups.changes.forEach(f=>window.electronAPI.gitDiscard(projectPath,f.rel)); setTimeout(()=>doRefresh(true),600); } }} title="Discard all changes" style={s.iconBtn}>↺</button>
              </span>
            </div>
            {!collapsed.changes && groups.changes.map(it=>(
              <div key={"chg:"+it.rel} style={{borderBottom:"1px solid #232323"}}>
                <div style={{...s.row, background: focusIdx>=0 && flatVisible[focusIdx]?.rel===it.rel ? "#2a2d2e":"transparent"}} onClick={()=>openFile(it.rel)} onDoubleClick={()=>toggleDiff(it.rel)} title={it.rel + " — double-click for diff"} onMouseEnter={e=>e.currentTarget.style.background="#2a2d2e"} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onContextMenu={e=>{ e.preventDefault(); e.stopPropagation(); setCtxMenu({x:e.clientX,y:e.clientY, rel:it.rel}); }}>
                  <span style={s.statusBox(statusColor(it.status,it.x,it.y))}>{it.status.trim()||"M"}</span>
                  <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={it.rel}>{it.rel}</span>
                  <span style={{fontSize:10,color:statusColor(it.status,it.x,it.y),flexShrink:0,background:"#1e1e1e",padding:"1px 5px",borderRadius:3,border:"1px solid " + statusColor(it.status,it.x,it.y) + "33"}}>{statusLabel(it.status,it.x,it.y,it)}</span>
                  <span style={{display:"flex",gap:3,flexShrink:0}}>
                    <button onClick={e=>{ e.stopPropagation(); toggleDiff(it.rel); }} title="Diff" style={{...s.iconBtn, background:openDiff===it.rel?"#094771":"#2d2d2d", color:openDiff===it.rel?"#fff":"#bbb"}}>{openDiff===it.rel?"−":"◈"}</button>
                    <button onClick={e=>{ e.stopPropagation(); doStage(it.rel); }} disabled={busy.includes(it.rel)} title="Stage" style={s.iconBtn}>+</button>
                    <button onClick={e=>{ e.stopPropagation(); doDiscard(it.rel); }} disabled={busy.includes(it.rel)} title="Discard" style={s.iconBtn}>↺</button>
                  </span>
                </div>
                {openDiff===it.rel && (
                  <div style={{background:"#111",borderTop:"1px solid #232323",maxHeight:260,overflow:"auto",padding:"6px 0"}}>
                    {diffMap[it.rel]===undefined ? <div style={{padding:"8px 10px",color:"#888",fontSize:11}}>Loading diff…</div> : renderDiff(diffMap[it.rel], it.rel)}
                    <div style={{display:"flex",gap:6,padding:"6px 8px",borderTop:"1px solid #232323",background:"#1a1a1a"}}>
                      <button onClick={()=>openFile(it.rel)} style={s.btnGhost}>Open File</button>
                      <button onClick={()=>copyText(it.rel)} style={s.btnGhost}>Copy Path</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!collapsed.changes && groups.changes.length===0 && total>0 && <div style={{padding:"10px 12px",fontSize:11,color:"#666",fontStyle:"italic"}}>No unstaged changes</div>}
          </div>
        )}

        {/* Untracked */}
        {groups.untracked.length>0 && (
          <div>
            <div style={s.sectionHead} onClick={()=>setCollapsed(c=>({...c,untracked:!c.untracked}))}>
              <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:collapsed.untracked?"rotate(-90deg)":"none",display:"inline-block",transition:"transform 0.15s",fontSize:10}}>▼</span> Untracked <span style={{background:"#2d5a2a",color:"#73c991",padding:"2px 6px",borderRadius:10,fontSize:10,border:"1px solid #3a7a3a"}}>{groups.untracked.length}</span></span>
              <span><button onClick={e=>{ e.stopPropagation(); doStageAll(); }} disabled={!!busy} title="Stage all untracked" style={s.iconBtn}>+ All</button></span>
            </div>
            {!collapsed.untracked && groups.untracked.map(it=>(
              <div key={"unt:"+it.rel} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",cursor:"pointer",fontSize:12,borderBottom:"1px solid #232323", background: focusIdx>=0 && flatVisible[focusIdx]?.rel===it.rel ? "#2a2d2e":"transparent"}} onClick={()=>openFile(it.rel)} title={it.rel} onMouseEnter={e=>e.currentTarget.style.background="#2a2d2e"} onMouseLeave={e=>e.currentTarget.style.background="transparent"} onContextMenu={e=>{ e.preventDefault(); e.stopPropagation(); setCtxMenu({x:e.clientX,y:e.clientY, rel:it.rel}); }}>
                <span style={s.statusBox("#73c991")}>U</span>
                <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={it.rel}>{it.rel}</span>
                <span style={{fontSize:10,color:"#73c991",background:"#1a2a1a",padding:"1px 5px",borderRadius:3,border:"1px solid #2a5a2a"}}>Untracked</span>
                <span style={{display:"flex",gap:3}}>
                  <button onClick={e=>{ e.stopPropagation(); doStage(it.rel); }} disabled={busy.includes(it.rel)} title="Stage" style={s.iconBtn}>+</button>
                  <button onClick={e=>{ e.stopPropagation(); doDiscard(it.rel); }} title="Delete file — requires confirmation" style={{...s.iconBtn, color:"#ff9b9b", borderColor:"#5a2a2a"}}>✕</button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Commits */}
        <div style={{borderTop:"1px solid #2d2d2d",marginTop:4}}>
          <div style={{...s.sectionHead, background:"#1e1e1e"}} onClick={()=>setShowLog(v=>!v)}>
            <span style={{display:"flex",gap:7,alignItems:"center"}}><span style={{transform:showLog?"none":"rotate(-90deg)",display:"inline-block",transition:"transform 0.15s",fontSize:10}}>▼</span> Recent Commits</span>
            <span style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:10,color:"#666",background:"#252526",padding:"2px 6px",borderRadius:10,border:"1px solid #2d2d2d"}}>{filteredLog.length || 0}{logQuery ? "/" + log.length : ""}</span>
            </span>
          </div>
          {showLog && (
            <div>
              <div style={{padding:"6px 8px",display:"flex",gap:6,background:"#1e1e1e",borderBottom:"1px solid #232323"}}>
                <input value={logQuery} onChange={e=>setLogQuery(e.target.value)} placeholder="Search commits (hash, message, author)…" style={{...s.input, padding:"6px 8px",background:"#252526",border:"1px solid #3a3a3a",fontSize:11}} />
                {logQuery && <button onClick={()=>setLogQuery("")} style={s.btnGhost}>✕</button>}
              </div>
              {filteredLog.length===0 && <div style={{padding:14,fontSize:11,color:"#666",textAlign:"center"}}>{log.length===0 ? "No commits yet — make your first commit above" : "No matching commits"}</div>}
              {filteredLog.map(c=>(
                <div key={c.fullHash} style={{padding:"8px 10px",borderBottom:"1px solid #232323",fontSize:11,background:"#181818"}} title={c.fullHash + "\n" + c.author + " <" + c.email + ">\n" + (c.refs||"")}>
                  <div style={{display:"flex",gap:7,alignItems:"center"}}>
                    <button onClick={()=>copyHash(c.fullHash)} title="Copy full hash" style={{color:"#569cd6",fontFamily:"Consolas,monospace",fontSize:10,background:"#252526",padding:"2px 5px",borderRadius:3,border:"1px solid #2d2d2d",cursor:"pointer"}}>{c.hash}</button>
                    <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#e0e0e0",fontWeight:600}} title={c.msg}>{c.msg}</span>
                    {c.refs && <span style={{fontSize:10,color:"#cca700",background:"#2d2d2d",padding:"1px 5px",borderRadius:3}}>{c.refs}</span>}
                  </div>
                  <div style={{fontSize:10,color:"#888",marginTop:4,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                    <span>{c.author} • {c.relTime}</span>
                    <span style={{marginLeft:"auto",display:"flex",gap:4}}>
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
        <div style={{position:"absolute", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:20, padding:12}} onClick={()=>setShowCommitDetail(null)}>
          <div onClick={e=>e.stopPropagation()} style={{width:"100%",maxWidth:720,maxHeight:"88%",background:"#1e1e1e",border:"1px solid #3a3a3a",borderRadius:6,overflow:"hidden",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"8px 10px",background:"#252526",borderBottom:"1px solid #2d2d2d",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <span style={{fontSize:12,fontWeight:700}}>Commit {showCommitDetail.hash} <span style={{fontWeight:400,color:"#888",fontFamily:"Consolas,monospace",fontSize:10}}>{showCommitDetail.fullHash}</span></span>
              <span style={{display:"flex",gap:6}}>
                <button onClick={()=>copyText(showCommitDetail.fullHash)} style={s.btnGhost}>Copy Hash</button>
                <button onClick={()=>setShowCommitDetail(null)} style={s.btnGhost}>✕ Close</button>
              </span>
            </div>
            <div style={{flex:1,overflow:"auto",padding:0}}>
              {showCommitDetail.loading ? <div style={{padding:20,color:"#888",textAlign:"center"}}>Loading…</div> : (
                <>
                  {showCommitDetail.stat && <pre style={{margin:0,padding:"8px 10px",background:"#181818",borderBottom:"1px solid #2d2d2d",fontFamily:"Consolas,monospace",fontSize:11,whiteSpace:"pre-wrap",wordBreak:"break-word",color:"#ccc"}}>{showCommitDetail.stat}</pre>}
                  <div style={{maxHeight:420,overflow:"auto",background:"#111",padding:"6px 0"}}>
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
        <div style={{position:"fixed", left:Math.min(ctxMenu.x, window.innerWidth-220), top:Math.min(ctxMenu.y, window.innerHeight-240), background:"#252526", border:"1px solid #3a3a3a", borderRadius:6, boxShadow:"0 8px 24px rgba(0,0,0,0.5)", zIndex:30, minWidth:180, overflow:"hidden", fontSize:12}} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>{ setCtxMenu(null); openFile(ctxMenu.rel); }} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 12px",background:"transparent",border:"none",color:"#ccc",cursor:"pointer",borderBottom:"1px solid #2d2d2d"}}>Open</button>
          <button onClick={()=>{ setCtxMenu(null); toggleDiff(ctxMenu.rel); }} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 12px",background:"transparent",border:"none",color:"#ccc",cursor:"pointer"}}>Open Changes (Diff)</button>
          <div style={{height:1,background:"#2d2d2d"}}/>
          <button onClick={()=>{ const r=ctxMenu.rel; setCtxMenu(null); const it=status.find(x=>x.rel===r); const isStaged= it && it.x!==" " && it.x!=="?" ; if(isStaged) doUnstage(r); else doStage(r); }} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 12px",background:"transparent",border:"none",color:"#ccc",cursor:"pointer"}}>{(()=>{
            const it=status.find(x=>x.rel===ctxMenu.rel);
            return (it && it.x!==" " && it.x!=="?" && it.x!=="U") ? "Unstage" : "Stage";
          })()}</button>
          <button onClick={()=>{ const r=ctxMenu.rel; setCtxMenu(null); doDiscard(r); }} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 12px",background:"transparent",border:"none",color:"#ff9b9b",cursor:"pointer"}}>Discard Changes</button>
          <div style={{height:1,background:"#2d2d2d"}}/>
          <button onClick={()=>{ copyText(ctxMenu.rel); setCtxMenu(null); }} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 12px",background:"transparent",border:"none",color:"#ccc",cursor:"pointer"}}>Copy Relative Path</button>
          <button onClick={()=>{ window.electronAPI?.revealInExplorer?.(projectPath+"\\"+ctxMenu.rel.replace(/\//g,"\\")); setCtxMenu(null); }} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 12px",background:"transparent",border:"none",color:"#ccc",cursor:"pointer"}}>Reveal in Explorer</button>
        </div>
      )}

      {/* footer */}
      <div style={{padding:"6px 10px",fontSize:10,color:"#777",borderTop:"1px solid #2d2d2d",display:"flex",justifyContent:"space-between",flexShrink:0,background:"#252526",alignItems:"center"}}>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:6,height:6,borderRadius:"50%",background: groups.conflicted.length?"#f44747": total?"#cca700":"#4caf50",display:"inline-block"}}/>
           {projectPath.split(/[\\/]/).pop()} {groups.conflicted.length ? "• " + groups.conflicted.length + " conflicts" : ""}
        </span>
        <span style={{display:"flex",gap:6,alignItems:"center"}}>
          {lastRefresh && <span style={{color:"#555"}}>{lastRefresh.toLocaleTimeString()}</span>}
          <span style={{background:"#1e1e1e",padding:"1px 6px",borderRadius:10,border:"1px solid #2d2d2d"}}>{branchInfo.branch ? "⎇ " + branchInfo.branch : "no branch"} • {total}</span>
        </span>
      </div>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
