import React, { useState, useRef, useCallback, useEffect } from "react";
import { Actions, DockLocation } from "flexlayout-react";
import { ChevronLeft, ChevronRight, RefreshCw, Lock, Unlock, Globe, Eye, Search, ChevronUp, ChevronDown, Pencil, PencilOff, Type, MoreVertical, Puzzle, Maximize2, ZoomIn, ZoomOut } from "lucide-react";

// ── SVG icon paths ─────────────────────────────────────────────────────────────
const LOCK_ICON   = "M8 1a4 4 0 0 0-4 4v2H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 6V5a2 2 0 1 1 4 0v2H6z";
const UNLOCK_ICON = "M8 1a4 4 0 0 1 4 4v1h-1V5a3 3 0 0 0-5.7-1.37l-.78-.62A4 4 0 0 1 8 1zm-5.65.09l12 14-.7.6L1.65 1.7zM6 7.49l-1.82.01a1 1 0 0 0-.18 0v3.85L2.35 9.7l-.7.6L4 13.2V14a1 1 0 0 0 1 1h6.15l-1-1H5v-4.5l1.85.01zm4.56-.57A1 1 0 0 1 12 7.5V8h1a1 1 0 0 1 1 1v3.15l-1-1V9h-1.44z";
const LOCAL_ICON  = "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-1 12.93A6 6 0 0 1 2 8c0-.33.03-.66.07-1H4v1h2v1H5v1h1v2l1 1zm5.1-3.83A4.9 4.9 0 0 0 13 8c0-2.5-1.83-4.55-4.2-4.96L9 4v1H7V4h-.44l3.55 5.1zm-9.4.14A5 5 0 0 1 2 8c0 1.72.87 3.23 2.2 4.14l.83-1.04z";

// ── BrowserPanel ───────────────────────────────────────────────────────────────
const WEBVIEW_PRELOAD = typeof window !== "undefined" && window.electronAPI?.getWebviewPreload
  ? window.electronAPI.getWebviewPreload() : undefined;

const BrowserPanel = (props) => {
  const { nodeId, config } = props || {};
  const initialUrl = config?.url || "https://www.google.com";

  const [navUrl,       setNavUrl]       = useState(initialUrl);
  const [inputValue,   setInputValue]   = useState(initialUrl);
  const [displayUrl,   setDisplayUrl]   = useState(initialUrl);
  const [canGoBack,    setCanGoBack]    = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading,    setIsLoading]    = useState(false);
  const [focused,      setFocused]      = useState(false);
  const [lockOpen,     setLockOpen]     = useState(false);
  const [barHidden,    setBarHidden]    = useState(false);
  const [moreOpen,     setMoreOpen]     = useState(false);
  const [popupStyle,   setPopupStyle]   = useState({});
  const [editMode,     setEditMode]     = useState(false);
  const [toast,        setToast]        = useState(null);
  // ── Find in page (webview.findInPage) ──
  const [findOpen,     setFindOpen]     = useState(false);
  const [findText,     setFindText]     = useState("");
  const [findActive,   setFindActive]   = useState(0);
  const [findMatches,  setFindMatches]  = useState(0);
  const [findMatchCase, setFindMatchCase] = useState(false);
  const findInputRef   = useRef(null);
  const findDebounceRef = useRef(null);
  const closeFindRef   = useRef(null);
  const [hasProject,   setHasProject]   = useState(() => { try { return !!window.__currentProjectPath; } catch { return false; } });

  const viewWrapRef = useRef(null);
  const editModeRef  = useRef(false);
  const toastTimerRef = useRef(null);

  const webviewRef   = useRef(null);
  const attachedRef  = useRef(false);
  const lockRef      = useRef(null);
  const moreWrapRef  = useRef(null);
  const moreBtnRef   = useRef(null);
  const nodeIdRef    = useRef(nodeId);
  const goToUrlRef   = useRef(null);
  const actionListRef = useRef(null);
  const inputRef     = useRef(null);

  // ── Page zoom (Ctrl+Scroll / Ctrl+Plus/Minus/0 — webview content zoom) ───
  // Actual page content zoom hai (webview.setZoomFactor). 25%–300%, step 10%.
  const [zoomFactor, setZoomFactor] = useState(1);
  const zoomRef = useRef(1);
  const bumpZoomRef = useRef(null);
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 3;
  const setZoomExact = useCallback((next) => {
    const wv = webviewRef.current;
    let n = Number(next);
    if (!Number.isFinite(n)) return zoomRef.current;
    n = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(n * 100) / 100));
    zoomRef.current = n;
    setZoomFactor(n);
    try { wv?.setZoomFactor?.(n); } catch {}
    return n;
  }, []);
  const bumpZoom = useCallback((dir) => {
    const cur = Number.isFinite(zoomRef.current) ? zoomRef.current : 1;
    const next = dir === "in" ? cur + 0.1 : cur - 0.1;
    return setZoomExact(next);
  }, [setZoomExact]);
  bumpZoomRef.current = bumpZoom;

  // ── Find in page helpers (Electron webview.findInPage) ────────────────
  const runFind = useCallback((text, { forward = true, findNext = false, matchCase = findMatchCase } = {}) => {
    const wv = webviewRef.current;
    if (!wv || !text) return;
    try {
      const r = wv.findInPage(text, { forward, findNext, matchCase });
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findMatchCase]);
  const closeFind = useCallback(() => {
    try { webviewRef.current?.stopFindInPage("clearSelection"); } catch {}
    setFindOpen(false); setFindText(""); setFindActive(0); setFindMatches(0);
  }, []);
  closeFindRef.current = closeFind;
  const openFind = useCallback(() => {
    setFindOpen(true);
    setTimeout(() => { try { findInputRef.current?.focus(); findInputRef.current?.select(); } catch {} }, 60);
  }, []);
  const onFindChange = useCallback((text) => {
    setFindText(text);
    setFindActive(0); setFindMatches(0);
    clearTimeout(findDebounceRef.current);
    if (!text) {
      try { webviewRef.current?.stopFindInPage("clearSelection"); } catch {}
      return;
    }
    findDebounceRef.current = setTimeout(() => runFind(text, { forward: true, findNext: false }), 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFind]);

  const syncActionTab = useCallback(() => {
    try {
      const id = webviewRef.current?.getWebContentsId();
      if (typeof id === "number" && actionListRef.current) {
        actionListRef.current.setAttribute("tab", String(id));
      }
    } catch {}
  }, []);

  // Keep nodeIdRef current (nodeId itself doesn't change but keep defensive)
  useEffect(() => { nodeIdRef.current = nodeId; }, [nodeId]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);

  // ── Host Ctrl+Wheel zoom (view-wrap fallback) ─────────────────────────────
  // Page ke ANDAR ka Ctrl+Wheel guest script pakadta hai (INJECT_SCRIPT →
  // "__IBX_ZOOM__" title marker). Ye host listener wrap par wheel ko pakadta
  // hai. passive:false zaroori hai taaki preventDefault kaam kare.
  useEffect(() => {
    const el = viewWrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      try {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        e.stopPropagation();
        const dir = e.deltaY < 0 ? "in" : "out";
        try { bumpZoomRef.current?.(dir); } catch {}
      } catch {}
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { try { el.removeEventListener("wheel", onWheel); } catch {} };
  }, []);

  // Track project open/close so banner can show VISUAL ONLY when unsavable
  useEffect(() => {
    const sync = () => { try { setHasProject(!!window.__currentProjectPath); } catch {} };
    const onOpen = (e) => { try { setHasProject(!!(e?.detail?.path || window.__currentProjectPath)); } catch { sync(); } };
    const onClose = () => setHasProject(false);
    sync();
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    const iv = setInterval(sync, 3000);
    return () => { window.removeEventListener("project:opened", onOpen); window.removeEventListener("project:closed", onClose); clearInterval(iv); };
  }, []);

  const showToast = useCallback((msg, type="info") => {
    setToast({ msg, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(()=> setToast(null), 2800);
  }, []);

  const revertActiveInGuest = useCallback(async () => {
    try { await webviewRef.current?.executeJavaScript(`(() => { try{ if(window.__ibxRevertActive) return window.__ibxRevertActive(); if(window.__ibxCancelEdit) return window.__ibxCancelEdit(); }catch{} return false; })()`); } catch {}
  }, []);

  const isSavableUrl = useCallback((u) => {
    try {
      const s = String(u || "");
      return s.startsWith("ibx-file://") || s.startsWith("file://");
    } catch { return false; }
  }, []);

  const handleLiveEdit = useCallback(async (data) => {
    const oldText = String(data?.oldText || "").trim();
    const newText = String(data?.newText || "").trim();
    if (!oldText || !newText || oldText === newText) { await revertActiveInGuest(); showToast("No change — reverted", "info"); return; }
    if (!newText) { await revertActiveInGuest(); showToast("Empty text not allowed — reverted", "error"); return; }
    if (newText.length > 2000) { await revertActiveInGuest(); showToast("Text too long (2000 max) — reverted", "error"); return; }
    try {
      const projectRoot = window.__currentProjectPath || null;
      const url = data?.url || webviewRef.current?.getURL?.() || displayUrl;
      // Visual-only when there is nowhere to save: no project + not a local file URL.
      // Revert immediately so the page never stays in a broken/flattened state.
      if (!projectRoot && !isSavableUrl(url)) {
        await revertActiveInGuest();
        showToast("Visual only — open a project or local file to save (reverted)", "error");
        return;
      }
      showToast("Updating source…", "info");
      const res = await window.electronAPI.liveEditApply({
        projectRoot,
        url,
        oldText,
        newText,
        outerSnippet: String(data?.outerSnippet || "").slice(0, 800),
        tagName: String(data?.tagName || ""),
      });
      if (res?.ok) {
        const rel = res.rel || res.filePath?.split(/[\\/]/).pop() || "file";
        showToast(`✓ Updated ${rel} (${res.ext||""})`, "success");
        try { window.dispatchEvent(new CustomEvent("liveEdit:applied", { detail: { filePath: res.filePath, oldText, newText, rel } })); } catch {}
        // live code refresh: if ibx-file, reload webview after short delay
        try {
          const cur = webviewRef.current?.getURL?.() || "";
          if (cur.startsWith("ibx-file://") && res.filePath && cur.includes(encodeURI(res.filePath.replace(/\\/g,"/")).slice(-40))) {
            setTimeout(()=> { try { webviewRef.current?.reload(); } catch {} }, 400);
          }
        } catch {}
        // also trigger fs watcher friendly toast for Monaco
        try { window.dispatchEvent(new CustomEvent("component:sourceChanged", { detail: { path: res.filePath, code: await window.electronAPI.readTextFile(res.filePath) } })); } catch {}
      } else {
        // Revert DOM so a failed save never leaves the page broken.
        await revertActiveInGuest();
        showToast(`${res?.error || "Update failed"} — reverted`, "error");
      }
    } catch (e) {
      try { await revertActiveInGuest(); } catch {}
      showToast(`${e?.message || String(e)} — reverted`, "error");
    }
  }, [displayUrl, showToast, revertActiveInGuest, isSavableUrl]);

  // Track last Browser group — so links from terminal/port/preview open in same group
  useEffect(() => {
    try {
      const m = window.__flexModel?.current;
      if (m && nodeId) {
        const tabNode = m.getNodeById(nodeId);
        const tabset = tabNode?.getParent();
        if (tabset) {
          const id = tabset.getId();
          window.__lastBrowserTabsetId = id;
          // Also try to sync with main's ref if available (via global)
          if (window.__flexModel) {
            // no direct access to lastBrowserTabsetRef, but global is enough
          }
        }
      }
    } catch {}
  }, [nodeId]);

  // ── Security display ────────────────────────────────────────────────────────
  let hostname = "", protocol = "";
  try { const u = new URL(displayUrl); hostname = u.hostname; protocol = u.protocol; } catch {}
  const isLocal  = !hostname || hostname === "localhost" || hostname === "127.0.0.1"
    || hostname === "0.0.0.0" || hostname.startsWith("192.168.") || hostname.startsWith("10.");
  const isHttps  = protocol === "https:";
  const iconPath  = isLocal ? LOCAL_ICON : (isHttps ? LOCK_ICON : UNLOCK_ICON);
  const iconColor = isLocal ? "var(--icon)"     : (isHttps ? "var(--teal)" : "var(--warning)");

  // ── Navigation ──────────────────────────────────────────────────────────────
  const goToUrl = useCallback((u) => {
    let fixed = u.trim();
    if (!fixed) return;
    if (/^https?:\/\//i.test(fixed)) {
      // already has scheme
    } else if (fixed.startsWith("localhost") || fixed.startsWith("127.0.0.1") || /^\d+\.\d+\.\d+\.\d+/.test(fixed)) {
      fixed = "http://" + fixed;
    } else if (/^[^\s]+\.[^\s]+/.test(fixed)) {
      fixed = "https://" + fixed;
    } else {
      fixed = "https://www.google.com/search?q=" + encodeURIComponent(fixed);
    }
    setNavUrl(fixed); setInputValue(fixed); setDisplayUrl(fixed); setLockOpen(false);
    if (webviewRef.current) {
      try { const p = webviewRef.current.loadURL(fixed); if (p && p.catch) p.catch(() => {}); } catch {}
    }
  }, []);

  goToUrlRef.current = goToUrl;

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") goToUrl(inputValue);
  }, [inputValue, goToUrl]);

  // ── Webview event listeners ──────────────────────────────────────────────────
  const attachListenersRef = useRef(null);
  attachListenersRef.current = (wv) => {
    if (attachedRef.current) return;
    attachedRef.current = true;

    wv.addEventListener("did-start-loading",    () => setIsLoading(true));
    wv.addEventListener("did-stop-loading",     () => setIsLoading(false));
    wv.addEventListener("did-fail-load", (e) => {
      setIsLoading(false);
      // -3 = ERR_ABORTED (e.g. localhost dev server not running or navigation cancelled) — ignore silently
      if (e.isMainFrame && e.errorCode !== -3) {
        const validatedUrl = wv.getURL() || navUrl;
        if (validatedUrl.startsWith("https://localhost") || validatedUrl.startsWith("https://127.0.0.1")) {
          const httpUrl = validatedUrl.replace("https://", "http://");
          try { const p = wv.loadURL(httpUrl); if (p && p.catch) p.catch(() => {}); } catch {}
        }
      }
    });
    // Find matches → count badge (request se nahi, event se aata hai)
    wv.addEventListener("found-in-page", (e) => {
      try {
        const r = e.result || {};
        if (typeof r.activeMatchOrdinal === "number") setFindActive(r.activeMatchOrdinal);
        if (typeof r.matches === "number") setFindMatches(r.matches);
      } catch {}
    });
    wv.addEventListener("did-navigate",         () => {
      // Naya page → find bar band (hash-jump did-navigate-in-page par khula rehta hai)
      try { closeFindRef.current?.(); } catch {}
      const cur = wv.getURL();
      setInputValue(cur); setDisplayUrl(cur);
      try { setCanGoBack(wv.canGoBack()); setCanGoForward(wv.canGoForward()); } catch {}
      syncActionTab();
      try {
        const m = window.__flexModel?.current;
        const nid = nodeIdRef.current;
        if (m && nid) {
          const tabNode = m.getNodeById(nid);
          const tabset = tabNode?.getParent();
          if (tabset) window.__lastBrowserTabsetId = tabset.getId();
        }
      } catch {}
    });
    wv.addEventListener("did-navigate-in-page", () => {
      const cur = wv.getURL();
      setInputValue(cur); setDisplayUrl(cur);
      try { setCanGoBack(wv.canGoBack()); setCanGoForward(wv.canGoForward()); } catch {}
      try {
        const m = window.__flexModel?.current;
        const nid = nodeIdRef.current;
        if (m && nid) {
          const tabNode = m.getNodeById(nid);
          const tabset = tabNode?.getParent();
          if (tabset) window.__lastBrowserTabsetId = tabset.getId();
        }
      } catch {}
    });
    // Keep last Browser group up to date when webview gains focus
    try {
      wv.addEventListener("focus", () => {
        try {
          const m = window.__flexModel?.current;
          const nid = nodeIdRef.current;
          if (m && nid) {
            const tabNode = m.getNodeById(nid);
            const tabset = tabNode?.getParent();
            if (tabset) window.__lastBrowserTabsetId = tabset.getId();
          }
        } catch {}
      });
    } catch {}

    // Mouse back/forward buttons (XButtons) inside the page → navigation.
    // The guest page cannot reach us directly, so we relay via a title marker
    // ("__IBX_NAV__b"/"__IBX_NAV__f") caught below in page-title-updated.
    // HTML file drag-and-drop → "__IBX_DROP__<path>" marker → opened via ibx-file://
    // Ctrl+Wheel zoom → "__IBX_ZOOM__in/out:<ts>" marker → host bumpZoom().
    // (webview wheel events host tak bubble NAHI hote, isliye guest me hi
    //  pakadna padta hai. Marker me timestamp taaki har tick par
    //  page-title-updated fire ho; turant prev title restore taaki page ka
    //  asli title kharab na ho.)
    const INJECT_SCRIPT = `(() => {
      try {
        var mark = function(b){ try{ document.title="__IBX_NAV__"+b; }catch(e){} };
        try{ window.addEventListener("mouseup", function(e){ try{ if(e.button===3) mark("b"); else if(e.button===4) mark("f"); }catch(e){} }, true); }catch(e){}
        try{
          if(!window.__ibxZoomWheelInstalled){
            window.__ibxZoomWheelInstalled = true;
            window.__ibxLastZoomMark = 0;
            window.addEventListener("wheel", function(e){
              try{
                if(!(e.ctrlKey || e.metaKey)) return;
                try{ e.preventDefault(); }catch(err){}
                try{ if(typeof e.stopPropagation==="function") e.stopPropagation(); }catch(err){}
                var now = Date.now();
                if(now - window.__ibxLastZoomMark < 60) return;
                window.__ibxLastZoomMark = now;
                var dir = e.deltaY < 0 ? "in" : "out";
                var prev = document.title;
                try{ document.title="__IBX_ZOOM__"+dir+":"+now; }catch(err){}
                setTimeout(function(){ try{ if(String(document.title).indexOf("__IBX_ZOOM__")===0) document.title=prev; }catch(err){} }, 350);
              }catch(err){}
            }, {passive:false, capture:true});
          }
        }catch(e){}
        try{
          window.addEventListener("dragover", function(e){ try{ e.preventDefault(); }catch(e){} }, true);
          window.addEventListener("drop", function(e){
            try{ e.preventDefault(); }catch(e){}
            var p=""; try{
              var dt=e.dataTransfer;
              if(dt){
                var uri=""; try{ uri=dt.getData("text/uri-list"); }catch(e){}
                var m=uri && uri.match(/^file:\\/\\/\\/([^\\r\\n]+)/m);
                if(m) p=decodeURIComponent(m[1]);
                else if(dt.files && dt.files[0] && dt.files[0].path) p=dt.files[0].path;
              }
            }catch(e){}
            if(p){ try{ document.title="__IBX_DROP__"+p; }catch(e){} }
          }, true);
        }catch(e){}
        return true;
      } catch(e){ return true; }
    })()`;
    // ── Live Edit helper: leaf-only, non-destructive inline editing ──
    // Do NOT insert badge nodes into the page and do NOT touch position styles.
    // Snapshot original outerHTML so cancel / failed save can fully restore markup.
    const EDIT_HELPER_SCRIPT = `(() => {
      try {
        if (window.__ibxEditHelpersInstalled) return true;
        window.__ibxEditHelpersInstalled = true;
        window.__ibxEditEnabled = !!window.__ibxEditEnabled;
        let hoverEl = null;
        let activeEl = null;
        let styleEl = null;
        let prevTitle = document.title;
        let committing = false;
        function ensureStyle(){
          if (styleEl) return;
          styleEl = document.createElement('style');
          styleEl.id = '__ibx-edit-style';
          // NOTE: ye CSS *bahar ki website* me inject hota hai — wahan app ke
          // var(--tokens) resolve NAHI hote, isliye literals rakhe hain.
          // Values CENTRAL sheet ke barabar hain: --teal (#4ec9b0),
          // --teal-a08, --teal-a14. Token badle to yahan bhi badlo.
          styleEl.textContent = \`
            .__ibx-edit-hover { outline: 2px dashed #4ec9b0 !important; outline-offset: 2px !important; cursor: text !important; background: rgba(78,201,176,0.08) !important; }
            .__ibx-edit-active { outline: 2px solid #4ec9b0 !important; outline-offset: 2px !important; background: rgba(78,201,176,0.14) !important; }
          \`;
          (document.head||document.documentElement).appendChild(styleEl);
        }
        function removeStyle(){ try{ if(styleEl) styleEl.remove(); }catch{} styleEl=null; try{ if(hoverEl) hoverEl.classList.remove('__ibx-edit-hover'); }catch{} hoverEl=null; }
        function isSkippedTag(el){
          if(!el || !el.tagName) return true;
          const t=el.tagName.toLowerCase();
          return ['script','style','noscript','iframe','canvas','svg','path','head','meta','link','input','textarea','select','button','video','audio','img','br','hr'].indexOf(t)!==-1 || el.isContentEditable;
        }
        function hasVisibleText(el){
          try{
            const txt=(el.innerText||'').trim();
            if(!txt) return false;
            if(txt.length>600) return false;
            const st=window.getComputedStyle(el);
            if(st && (st.display==='none' || st.visibility==='hidden' || parseFloat(st.opacity)===0)) return false;
            return true;
          }catch{ return false; }
        }
        function isLeafEditable(el){
          if(!el || el.nodeType!==1 || !el.tagName) return false;
          const t=el.tagName.toLowerCase();
          const allowed=['p','h1','h2','h3','h4','h5','h6','span','a','li','td','th','label','strong','em','b','i','u','small','code','pre','blockquote','div','dt','dd','caption','figcaption'];
          if(allowed.indexOf(t)===-1) return false;
          if(isSkippedTag(el)) return false;
          if(!hasVisibleText(el)) return false;
          try{
            const kids=el.children||[];
            if(kids.length===0) return true;
            if(kids.length===1 && kids[0].tagName && String(kids[0].tagName).toLowerCase()==='br') return true;
            return false;
          }catch{ return false; }
        }
        function findEditableTarget(start){
          let el=start;
          if(el && el.nodeType===3) el=el.parentElement;
          let depth=0;
          while(el && el!==document.body && el!==document.documentElement && depth<4){
            if(el.nodeType===1 && isLeafEditable(el)) return el;
            el=el.parentElement; depth++;
          }
          return null;
        }
        function clearHover(){ try{ if(hoverEl) hoverEl.classList.remove('__ibx-edit-hover'); }catch{} hoverEl=null; }
        function onMouseOver(e){
          if(!window.__ibxEditEnabled || activeEl) return;
          let t=null; try{ t=findEditableTarget(e.target); }catch{}
          if(t===hoverEl) return;
          clearHover();
          if(t){ hoverEl=t; try{ hoverEl.classList.add('__ibx-edit-hover'); }catch{} }
        }
        function onMouseOut(e){
          if(!window.__ibxEditEnabled || activeEl) return;
          try{ const rel=e.relatedTarget; if(hoverEl && rel && hoverEl.contains(rel)) return; }catch{}
          clearHover();
        }
        function snapshot(el){
          try{
            if(el.__ibxOrigHTML==null) el.__ibxOrigHTML=String(el.outerHTML||'');
            if(el.__ibxOldText==null) el.__ibxOldText=(el.innerText||'').trim();
          }catch{}
        }
        function detachActiveListeners(el){
          try{ el.removeEventListener('keydown', onEditKey); }catch{}
          try{ el.removeEventListener('blur', onEditBlur); }catch{}
        }
        function restoreOriginal(el){
          try{
            const html=el.__ibxOrigHTML;
            if(html!=null){ el.outerHTML=html; return true; }
          }catch{}
          return false;
        }
        function cleanupActive(cancel){
          if(!activeEl) return;
          const el=activeEl;
          activeEl=null; committing=false;
          detachActiveListeners(el);
          try{
            if(cancel){
              restoreOriginal(el);
            } else {
              el.removeAttribute('contenteditable');
              el.classList.remove('__ibx-edit-active');
              el.style.outline='';
            }
          }catch{}
        }
        function commitEdit(){
          if(!activeEl || committing) return;
          committing=true;
          const el=activeEl;
          const oldText=String(el.__ibxOldText||'');
          let newText='';
          try{ newText=String(el.innerText||el.textContent||'').trim(); }catch{}
          // Use ORIGINAL outerHTML for file matching (not the edited DOM)
          let outerSnippet='';
          try{ outerSnippet=String(el.__ibxOrigHTML||el.outerHTML||'').slice(0,300); }catch{ outerSnippet=''; }
          const tagName=String(el.tagName||'');
          if(!newText || newText===oldText.trim()){
            // No change: restore original markup to undo any contenteditable damage
            const r=el; activeEl=null; committing=false;
            detachActiveListeners(r);
            restoreOriginal(r);
            clearHover();
            return;
          }
          const payload={ oldText: String(oldText).trim(), newText: String(newText).trim(), outerSnippet: outerSnippet, tagName: tagName, url: location.href };
          // Leave edited DOM in place; host reverts on failure via __ibxRevertActive.
          // Detach without restoring so text stays visible while saving.
          try{
            detachActiveListeners(el);
            el.removeAttribute('contenteditable');
            el.classList.remove('__ibx-edit-active');
            el.style.outline='';
          }catch{}
          activeEl=null; committing=false;
          clearHover();
          const prev=prevTitle;
          try{ prevTitle=document.title; document.title="__IBX_EDIT__"+JSON.stringify(payload); setTimeout(()=>{ try{ if(String(document.title).startsWith("__IBX_EDIT__")) document.title=prevTitle; }catch{} }, 900); }catch{}
          void prev;
        }
        window.__ibxCommitPendingEdit = function(){
          try{ if(activeEl && !committing) commitEdit(); return true; }catch(e){ return false; }
        };
        window.__ibxRevertActive = function(){
          try{
            if(!activeEl) return true;
            const el=activeEl; activeEl=null; committing=false;
            detachActiveListeners(el);
            restoreOriginal(el);
            clearHover();
            return true;
          }catch(e){ return false; }
        };
        window.__ibxCancelEdit = function(){
          try{
            if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); restoreOriginal(el); }
            clearHover();
            return true;
          }catch(e){ return false; }
        };
        window.__ibxIsEditing = function(){ try{ return !!activeEl; }catch{ return false; } };
        function onEditKey(e){
          if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation==='function') try{e.stopImmediatePropagation();}catch{} cleanupActive(true); clearHover(); }
          else if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation==='function') try{e.stopImmediatePropagation();}catch{} try{ activeEl && activeEl.blur(); }catch{} }
        }
        function onEditBlur(){ setTimeout(()=>{ try{ if(activeEl && !committing) commitEdit(); }catch{} }, 80); }
        function onClick(e){
          if(!window.__ibxEditEnabled) return;
          const t=findEditableTarget(e.target);
          if(!t) return;
          if(activeEl && activeEl.contains(e.target)) return;
          e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation==='function') try{e.stopImmediatePropagation();}catch{}
          clearHover();
          if(activeEl) cleanupActive(true);
          activeEl=t;
          try{
            snapshot(activeEl);
            activeEl.classList.add('__ibx-edit-active');
            activeEl.setAttribute('contenteditable','true');
            try{ activeEl.setAttribute('spellcheck','false'); }catch{}
            activeEl.focus();
            try{
              const range=document.createRange(); range.selectNodeContents(activeEl); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
            }catch{}
            activeEl.addEventListener('keydown', onEditKey);
            activeEl.addEventListener('blur', onEditBlur);
          }catch{}
        }
        function onPageHide(){ try{ if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); } }catch{} try{ clearHover(); }catch{} }
        window.__ibxSetEditMode = function(enabled){
          window.__ibxEditEnabled = !!enabled;
          if(window.__ibxEditEnabled){
            ensureStyle();
            try{ document.addEventListener('mouseover', onMouseOver, true); }catch{}
            try{ document.addEventListener('mouseout', onMouseOut, true); }catch{}
            try{ document.addEventListener('click', onClick, true); }catch{}
            try{ window.addEventListener('pagehide', onPageHide); }catch{}
            try{ if(document.body) document.body.style.cursor='text'; }catch{}
            try{ prevTitle=document.title; }catch{}
          } else {
            try{ document.removeEventListener('mouseover', onMouseOver, true); }catch{}
            try{ document.removeEventListener('mouseout', onMouseOut, true); }catch{}
            try{ document.removeEventListener('click', onClick, true); }catch{}
            try{ window.removeEventListener('pagehide', onPageHide); }catch{}
            // Host already commits via __ibxCommitPendingEdit before disabling.
            // Any leftover active edit here is stale — restore to avoid broken UI.
            try{ if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); restoreOriginal(el); } }catch{}
            clearHover();
            removeStyle();
            try{ if(document.body) document.body.style.cursor=''; }catch{}
          }
          return true;
        };
        if(window.__ibxPendingEditMode) window.__ibxSetEditMode(true);
        return true;
      } catch(e){ return false; }
    })()`;
    const injectGuest = (attempt) => {
      if (attempt > 3) return;
      try {
        wv.executeJavaScript(INJECT_SCRIPT)
          .then((ok) => { if (!ok && attempt < 3) setTimeout(() => injectGuest(attempt + 1), 250); })
          .catch(() => { setTimeout(() => injectGuest(attempt + 1), 250); });
      } catch {
        setTimeout(() => injectGuest(attempt + 1), 250);
      }
    };
    const injectEditHelper = (attempt) => {
      if (attempt > 3) return;
      try {
        wv.executeJavaScript(EDIT_HELPER_SCRIPT)
          .then((ok)=>{
            if (!ok && attempt < 3) setTimeout(()=> injectEditHelper(attempt+1), 250);
            else if (editModeRef.current) {
              setTimeout(()=> { try{ wv.executeJavaScript('window.__ibxSetEditMode && window.__ibxSetEditMode(true)'); }catch{} }, 120);
            }
          })
          .catch(()=> setTimeout(()=> injectEditHelper(attempt+1), 250));
      } catch { setTimeout(()=> injectEditHelper(attempt+1), 250); }
    };
    wv.addEventListener("dom-ready", () => {
      injectGuest(1); injectEditHelper(1);
      // Zoom persist rakho — navigation par WebContents zoom na khoye.
      try { if (Number.isFinite(zoomRef.current) && zoomRef.current !== 1) wv.setZoomFactor(zoomRef.current); } catch {}
      try {
        const z = wv.getZoomFactor?.();
        if (Number.isFinite(z) && z !== zoomRef.current) { zoomRef.current = z; setZoomFactor(z); }
      } catch {}
    });

    wv.addEventListener("page-title-updated", (e) => {
      const t = e.title || "";
      if (t.startsWith("__IBX_EDIT__")) {
        try {
          const payload = JSON.parse(t.slice("__IBX_EDIT__".length));
          handleLiveEdit(payload);
        } catch {}
        return;
      }
      // Ctrl+Wheel page zoom (guest INJECT_SCRIPT se) — title restore guest
      // khud karta hai, yahan sirf zoom step lagao, tab title mat badlo.
      if (t.startsWith("__IBX_ZOOM__in")) {
        try { bumpZoomRef.current?.("in"); } catch {}
        return;
      }
      if (t.startsWith("__IBX_ZOOM__out")) {
        try { bumpZoomRef.current?.("out"); } catch {}
        return;
      }
      if (t.startsWith("__IBX_NAV__")) {
        if (t === "__IBX_NAV__b") { try { wv.goBack(); } catch {} }
        else if (t === "__IBX_NAV__f") { try { wv.goForward(); } catch {} }
        return;
      }
      if (t.startsWith("__IBX_DROP__")) {
        const p = t.slice("__IBX_DROP__".length);
        if (/\.html?$/i.test(p)) {
          const url = "ibx-file://file/" + encodeURI(p.replace(/\\/g, "/")).replace(/#/g, "%23");
          goToUrlRef.current(url);
        }
        return;
      }
      const nid = nodeIdRef.current;
      const m = window.__flexModel?.current;
      if (m) {
        const tabNode = m.getNodeById(nid);
        if (tabNode) {
          m.doAction(Actions.updateNodeAttributes(nid, {
            config: { ...(tabNode.getConfig() || {}), title: e.title }, name: e.title,
          }));
        }
      }
    });
    wv.addEventListener("page-favicon-updated", (e) => {
      if (e.favicons?.length) {
        const nid = nodeIdRef.current;
        const m = window.__flexModel?.current;
        if (m) {
          const tabNode = m.getNodeById(nid);
          if (tabNode) {
            m.doAction(Actions.updateNodeAttributes(nid, {
              config: { ...(tabNode.getConfig() || {}), favicon: e.favicons[0] },
            }));
          }
        }
      }
    });

    // ── Webview right-click context menu ──────────────────────────────────────
    wv.addEventListener("context-menu", async (e) => {
      e.preventDefault();
      const params = {
        hasSelection: !!(e.params?.selectionText),
        selectionText: e.params?.selectionText || "",
        linkURL:    e.params?.linkURL    || "",
        srcURL:     e.params?.srcURL     || "",
        isEditable: !!e.params?.isEditable,
        pageURL:    wv.getURL(),
        x:          Math.round(e.params?.x || 0),
        y:          Math.round(e.params?.y || 0),
        webContentsId: wv.getWebContentsId ? wv.getWebContentsId() : undefined,
      };
      const result = await window.electronAPI.showBrowserWebviewContextMenu(params);
      if (!result) return;
      const nid = nodeIdRef.current;
      switch (result.action) {
        case "back":        try { wv.goBack();    } catch {} break;
        case "forward":     try { wv.goForward(); } catch {} break;
        case "reload":      wv.reload();     break;
        case "copy":        wv.copy();       break;
        case "paste":       wv.paste();      break;
        case "cut":         wv.cut();        break;
        case "selectAll":   wv.selectAll();  break;
        case "inspect":
          if (typeof result.data?.x === "number" && typeof result.data?.y === "number") {
            try { wv.inspectElement(result.data.x, result.data.y); } catch { wv.openDevTools(); }
          } else {
            wv.openDevTools();
          }
          break;
        case "print":       wv.print?.();    break;
        case "saveAs":      wv.downloadURL?.(wv.getURL()); break;
        case "viewSource":  goToUrlRef.current("view-source:" + (result.data?.url || wv.getURL())); break;
        case "copyLink":    window.electronAPI.clipboardWrite(result.data?.url || ""); break;
        case "copyLinkText": window.electronAPI.clipboardWrite(result.data?.text || result.data?.url || ""); break;
        case "copyImageURL":window.electronAPI.clipboardWrite(result.data?.url || ""); break;
        case "copyImage": {
          // Try to copy image to clipboard via webview
          try { wv.copyImageAt?.(result.data?.x, result.data?.y); } catch {}
          // Fallback to copying URL
          window.electronAPI.clipboardWrite(result.data?.url || "");
          break;
        }
        case "saveLinkAs":   try { wv.downloadURL?.(result.data?.url || wv.getURL()); } catch {} break;
        case "saveImageAs":  try { wv.downloadURL?.(result.data?.url || ""); } catch {} break;
        case "undo":         try { wv.undo(); } catch { try { document.execCommand("undo"); } catch {} } break;
        case "redo":         try { wv.redo(); } catch { try { document.execCommand("redo"); } catch {} } break;
        case "delete":       try { wv.delete?.(); } catch { try { wv.cut(); wv.paste(); } catch {} } break;
        case "openLinkNewTab": {
          const m = window.__flexModel?.current;
          if (m) {
            const tabset = m.getNodeById(nid)?.getParent();
            if (tabset) {
              m.doAction(Actions.addNode({
                type:"tab",component:"panel3",name:"New Tab",enableClose:true,
                config:{ type:"browser",title:"New Tab",url:result.data?.url },
              }, tabset.getId(), DockLocation.CENTER));
            }
          }
          break;
        }
        case "openLinkNewWindow": {
          // Open in a new Browser tab (we don't create a new OS window, keep inside IDE)
          const m = window.__flexModel?.current;
          if (m) {
            const tabset = m.getNodeById(nid)?.getParent();
            if (tabset) {
              m.doAction(Actions.addNode({
                type:"tab",component:"panel3",name:"New Tab",enableClose:true,
                config:{ type:"browser",title:"New Tab",url:result.data?.url },
              }, tabset.getId(), DockLocation.CENTER));
            }
          } else {
            try { window.open(result.data?.url, "_blank"); } catch {}
          }
          break;
        }
        case "openImageNewTab": {
          const m = window.__flexModel?.current;
          if (m) {
            const tabset = m.getNodeById(nid)?.getParent();
            if (tabset) {
              m.doAction(Actions.addNode({
                type:"tab",component:"panel3",name:"Image",enableClose:true,
                config:{ type:"browser",title:"Image",url:result.data?.url },
              }, tabset.getId(), DockLocation.CENTER));
            }
          }
          break;
        }
        case "searchSelection": {
          goToUrlRef.current("https://www.google.com/search?q=" + encodeURIComponent(result.data?.text || ""));
          break;
        }
        default: break;
      }
    });

    // ── Navigation isolation: keep all popups / _blank / window.open inside app ──
    // Without this, target="_blank" and window.open would create a new Electron
    // BrowserWindow or navigate the main window; we intercept and open as a new
    // flexlayout Browser tab (panel3) staying inside the IDE.
    const openInNewTab = (url) => {
      if (!url) return;
      try {
        const m = window.__flexModel?.current;
        if (m) {
          let targetTabsetId = null;
          // 1) Last Browser group (global)
          const lastId = window.__lastBrowserTabsetId;
          if (lastId) {
            try {
              const n = m.getNodeById(lastId);
              if (n && n.getType() === "tabset") targetTabsetId = lastId;
            } catch {}
          }
          // 2) Biggest window fallback
          if (!targetTabsetId) {
            try {
              let biggest = null;
              let maxArea = -1;
              const walk = (node) => {
                if (node.getType() === "tabset") {
                  let area = 0;
                  try { const r = node.getRect(); if (r) area = r.width * r.height; } catch {}
                  const cnt = node.getChildren()?.length || 0;
                  if (area > 0) {
                    if (area > maxArea) { maxArea = area; biggest = node.getId(); }
                  } else if (cnt > 0 && !biggest) {
                    biggest = node.getId();
                  }
                  if (!biggest) biggest = node.getId();
                }
                node.getChildren()?.forEach(walk);
              };
              walk(m.getRoot());
              targetTabsetId = biggest;
            } catch {}
          }
          // 3) Fallback to current Browser's parent
          if (!targetTabsetId) {
            const nid = nodeIdRef.current;
            const tabNode = m.getNodeById(nid);
            const tabset = tabNode?.getParent();
            if (tabset) targetTabsetId = tabset.getId();
          }
          if (targetTabsetId) {
            try { window.__lastBrowserTabsetId = targetTabsetId; } catch {}
            m.doAction(Actions.addNode({
              type: "tab", component: "panel3", name: "New Tab", enableClose: true,
              config: { type: "browser", title: "New Tab", url },
            }, targetTabsetId, DockLocation.CENTER));
            return;
          }
        }
      } catch {}
      // fallback: navigate current webview if flexlayout not available
      try { wv.loadURL(url); } catch {}
    };

    const handleNewWindow = (e) => {
      try { e.preventDefault(); } catch {}
      const url = e.url || e.params?.url || "";
      if (url) openInNewTab(url);
    };

    // Electron <webview> fires "new-window" for target="_blank" and window.open
    // Newer versions may fire "did-create-window" — handle both.
    try { wv.addEventListener("new-window", handleNewWindow); } catch {}
    try { wv.addEventListener("did-create-window", handleNewWindow); } catch {}

    // Fallback: some webview implementations use window-open with details
    // Add a JS-level guard inside guest to catch redirects that try to use
    // window.location = external URL via top navigation. The main process
    // will-navigate guard (electron/main/index.js) also blocks top-level nav.
    try {
      wv.addEventListener("will-navigate", (e) => {
        const url = e.url || "";
        // Allow navigation inside webview for http/https and ibx-file/view-source
        if (/^(https?:|ibx-file:|view-source:|data:|blob:|about:)/i.test(url)) return;
        // Block exotic top-navigation attempts
      });
    } catch {}

    setIsLoading(false);
  };

  // Stable ref-callback — created ONCE so webview never remounts on re-render
  const webviewRefCb = useCallback((el) => {
    if (el) {
      webviewRef.current = el; attachListenersRef.current(el); syncActionTab();
      // Mount par existing page zoom wapas lagao (remount edge-case)
      try { if (Number.isFinite(zoomRef.current) && zoomRef.current !== 1) el.setZoomFactor(zoomRef.current); } catch {}
    }
    else    { attachedRef.current = false; webviewRef.current = null; }
  }, [syncActionTab]);

  // ── Edit mode toggle → inject into webview ─────────────────────────────────
  useEffect(() => {
    const wv = webviewRef.current;
    const js = `window.__ibxSetEditMode && window.__ibxSetEditMode(${editMode ? "true" : "false"})`;
    if (wv) {
      try { wv.executeJavaScript(js).catch(()=>{}); } catch {}
      // also store pending flag for next navigation if helpers not yet installed
      try { wv.executeJavaScript(`window.__ibxPendingEditMode=${editMode?"true":"false"}`).catch(()=>{}); } catch {}
    }
    if (editMode) showToast("Edit mode ON — click a single line of text (Enter to save, Esc to cancel)", "info");
    else if (attachedRef.current) showToast("Edit mode OFF", "info");
  }, [editMode, showToast]);

  const isVisualOnlyUrl = (() => {
    try {
      const s = String(displayUrl || "");
      if (s.startsWith("ibx-file://") || s.startsWith("file://")) return false;
      return !hasProject;
    } catch { return false; }
  })();

  // ── Listen for liveEdit file changes from main to show in UI (optional) ────
  useEffect(()=>{
    const unsub = window.electronAPI.onLiveEditFileChanged?.((payload)=>{
      // handled via handleLiveEdit already; just could show extra toast if from other Browser
    });
    return ()=> { try{ unsub?.(); }catch{} };
  }, []);

  // ── Browser shortcuts (F5, Ctrl+R, etc.) — only when this tab is active ──
  useEffect(() => {
    const isActiveBrowser = () => {
      try {
        const m = window.__flexModel?.current;
        if (!m) return false;
        const active = m.getActiveTabset()?.getSelectedNode();
        return active && active.getId() === nodeIdRef.current;
      } catch { return false; }
    };
    const handler = (e) => {
      if (!isActiveBrowser()) return;
      const wv = webviewRef.current;
      if (!wv) return;
      // F5 or Ctrl+R → reload
      if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        try { wv.reload(); } catch {}
        return;
      }
      // Ctrl+Shift+R / Ctrl+F5 → hard reload
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") || (e.ctrlKey && e.key === "F5")) {
        e.preventDefault();
        try { if (wv.reloadIgnoringCache) wv.reloadIgnoringCache(); else wv.reload(); } catch { try { wv.reload(); } catch {} }
        return;
      }
      // Alt+Left → back, Alt+Right → forward
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        try { if (wv.canGoBack()) wv.goBack(); } catch {}
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        try { if (wv.canGoForward()) wv.goForward(); } catch {}
        return;
      }
      // Ctrl+L / Alt+D → focus URL bar
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l" || (e.altKey && e.key.toLowerCase() === "d")) {
        e.preventDefault();
        try { inputRef.current?.focus(); inputRef.current?.select(); } catch {}
        return;
      }
      // Escape → stop loading (skip while edit mode is on so guest Esc-cancel wins)
      if (e.key === "Escape" && isLoading && !editModeRef.current) {
        e.preventDefault();
        try { wv.stop(); } catch {}
        return;
      }
      // Ctrl+0 → reset zoom, Ctrl+Plus/Ctrl+Minus → zoom (webview)
      // (Ctrl+Scroll zoom guest INJECT_SCRIPT + host wheel listener se hota hai)
      if ((e.ctrlKey || e.metaKey) && (e.key === "0")) {
        e.preventDefault();
        try { bumpZoomRef.current ? setZoomExact(1) : wv.setZoomFactor(1); } catch { try { wv.setZoomFactor(1); } catch {} }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+" )) {
        e.preventDefault();
        try { bumpZoomRef.current?.("in"); } catch { try { const z = wv.getZoomFactor(); wv.setZoomFactor(Math.min(z + 0.1, 3)); } catch {} }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        try { bumpZoomRef.current?.("out"); } catch { try { const z = wv.getZoomFactor(); wv.setZoomFactor(Math.max(z - 0.1, 0.2)); } catch {} }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isLoading, setZoomExact]);

  // ── Lock popup ─────────────────────────────────────────────────────────────
  const handleLockClick = useCallback((e) => {
    e.stopPropagation();
    const next = !lockOpen;
    setLockOpen(next);
    if (next && lockRef.current) {
      const r = lockRef.current.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - 300);
      setPopupStyle({ left: Math.min(Math.max(8, r.left - 10), maxLeft), top: r.bottom + 6 });
    }
  }, [lockOpen]);

  // ── ⋮ More menu — outside click / Escape se band karo
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e) => {
      try {
        if (moreWrapRef.current && !moreWrapRef.current.contains(e.target)) setMoreOpen(false);
      } catch {}
    };
    const onKey = (e) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const handleToggleEditMode = useCallback(async () => {
    if (editMode) {
      try { await webviewRef.current?.executeJavaScript('window.__ibxCommitPendingEdit && window.__ibxCommitPendingEdit()'); } catch {}
      // Give page-title-updated a beat to deliver the payload before helpers detach
      setTimeout(()=> setEditMode(false), 350);
    } else {
      setEditMode(true);
    }
    setMoreOpen(false);
  }, [editMode]);

  const handleCancelEditMode = useCallback(async () => {
    try { await webviewRef.current?.executeJavaScript('window.__ibxCancelEdit && window.__ibxCancelEdit()'); } catch {}
    setEditMode(false);
    setMoreOpen(false);
  }, []);

  const handleToggleDevTools = useCallback(() => {
    if (webviewRef.current) {
      try {
        if (webviewRef.current.isDevToolsOpened()) webviewRef.current.closeDevTools();
        else webviewRef.current.openDevTools();
      } catch {}
    }
    setMoreOpen(false);
  }, []);

  const handleHideBar = useCallback(() => {
    setMoreOpen(false);
    setBarHidden(true);
  }, []);

  const handleManageExtensions = useCallback(() => {
    setMoreOpen(false);
    try {
      if (window.electronAPI?.openSettingsWindow) window.electronAPI.openSettingsWindow("extensions");
      else window.dispatchEvent(new CustomEvent("browser:openSettings", { detail: { page: "extensions" } }));
    } catch {
      try { window.dispatchEvent(new CustomEvent("browser:openSettings", { detail: { page: "extensions" } })); } catch {}
    }
  }, []);

  // ── Host Ctrl+F → find bar (sirf is panel ke host UI me) ──────────────
  // Guest page ke keys host tak aate hi nahi, aur dusre panels (editor) apna
  // Ctrl+F khud handle karte hain — target check se koi clash nahi.
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.shiftKey || e.altKey) return;
      if (String(e.key || "").toLowerCase() !== "f") return;
      try {
        const root = viewWrapRef.current?.closest?.(".browser");
        if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return;
      } catch { return; }
      e.preventDefault();
      e.stopPropagation();
      openFind();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openFind]);

  // ── Unmount: pending find roko ──
  useEffect(() => () => {
    clearTimeout(findDebounceRef.current);
    try { webviewRef.current?.stopFindInPage("clearSelection"); } catch {}
  }, []);

  // ── Tab right-click ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = async (e) => {
      if (e.detail?.nodeId !== nodeId) return;
      const result = await window.electronAPI.showBrowserTabContextMenu();
      if (!result) return;
      switch (result.action) {
        case "settings":         window.dispatchEvent(new CustomEvent("browser:openSettings")); break;
        case "refresh":          webviewRef.current?.reload(); break;
        default: break;
      }
    };
    window.addEventListener("browser:tabContextMenu", handler);
    return () => window.removeEventListener("browser:tabContextMenu", handler);
  }, [nodeId]);

  // ── Render ──────────────────────────────────────────────────────────────────
  const handleHostDrop = useCallback((e) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt) return;
    let p = "";
    try { if (dt.files && dt.files[0] && window.electronAPI.getPathForFile) p = window.electronAPI.getPathForFile(dt.files[0]); } catch {}
    if (!p) {
      try {
        const m = dt.getData("text/uri-list").match(/^file:\/\/\/([^\r\n]+)/m);
        if (m) p = decodeURIComponent(m[1]).replace(/\//g, "\\");
      } catch {}
    }
    if (p && /\.html?$/i.test(p)) {
      const url = "ibx-file://file/" + encodeURI(p.replace(/\\/g, "/")).replace(/#/g, "%23");
      goToUrlRef.current(url);
    }
  }, []);

  return (
    <div className="browser"
      onDragOver={(e) => { e.preventDefault(); }}
      onDrop={handleHostDrop}
    >

      {/* Toolbar */}
      {!barHidden && (
        <div className="browser__bar">
          <button className="browser__btn" disabled={!canGoBack}
            onClick={() => webviewRef.current?.goBack()} title="Back">
            <ChevronLeft size={14} />
          </button>
          <button className="browser__btn" disabled={!canGoForward}
            onClick={() => webviewRef.current?.goForward()} title="Forward">
            <ChevronRight size={14} />
          </button>
          <button className="browser__btn" onClick={() => webviewRef.current?.reload()} title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button className="browser__btn" onClick={openFind} title="Find in page (Ctrl+F)">
            <Search size={14} />
          </button>

          {/* URL bar */}
          <div className={`browser__url-wrap${focused ? " browser__url-wrap--focused" : ""}`}>
            {isLoading && <div className="browser__spinner" />}
            <span ref={lockRef} className="browser__lock" onClick={handleLockClick} style={{ color: iconColor, display: "flex", alignItems: "center", cursor: "pointer" }}>
              {isLocal ? <Globe size={14} /> : isHttps ? <Lock size={14} /> : <Unlock size={14} />}
            </span>
            <input
              ref={inputRef}
              className="browser__url"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              onFocus={() => setFocused(true)}
              onBlur={() => { setFocused(false); setLockOpen(false); }}
            />
          </div>

          {/* ⋮ More options — zoom yahin hai (toolbar me nahi) */}
          <div ref={moreWrapRef} style={{ position: "relative", display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              ref={moreBtnRef}
              className={`browser__btn${moreOpen || editMode ? " browser__btn--active" : ""}`}
              onClick={(e) => { e.stopPropagation(); setMoreOpen((v) => !v); }}
              title="More options"
              style={editMode && !moreOpen ? { background: "var(--teal-a18)", color: "var(--teal)", border: "1px solid var(--teal-a35)" } : undefined}
            >
              <MoreVertical size={15} />
              {editMode && (
                <span style={{ position: "absolute", top: 3, right: 3, width: 6, height: 6, borderRadius: "var(--radius-round)", background: "var(--teal)", pointerEvents: "none" }} />
              )}
            </button>
            {moreOpen && (
              <div className="browser__more-menu" onClick={(e) => e.stopPropagation()}>
                <button className="browser__more-item" onClick={handleToggleEditMode} title={editMode ? "Done — save pending edit & exit" : "Edit Mode — click any text to edit"}>
                  <span className="browser__more-icon" style={editMode ? { color: "var(--teal)" } : undefined}>
                    {editMode ? <PencilOff size={14} /> : <Pencil size={14} />}
                  </span>
                  <span className="browser__more-label">{editMode ? "Done — exit edit mode" : "Edit mode"}</span>
                  {editMode && <span className="browser__more-badge">ON</span>}
                </button>
                {/* Page zoom — Ctrl+Scroll alternative */}
                <button className="browser__more-item" onClick={() => { bumpZoom("in"); }} title="Zoom in (Ctrl++ / Ctrl+Scroll up)">
                  <span className="browser__more-icon"><ZoomIn size={14} /></span>
                  <span className="browser__more-label">Zoom in</span>
                  <span className="browser__more-hint">{Math.round(zoomFactor * 100)}%</span>
                </button>
                <button className="browser__more-item" onClick={() => { bumpZoom("out"); }} title="Zoom out (Ctrl+- / Ctrl+Scroll down)">
                  <span className="browser__more-icon"><ZoomOut size={14} /></span>
                  <span className="browser__more-label">Zoom out</span>
                </button>
                <button className="browser__more-item" onClick={() => { setZoomExact(1); setMoreOpen(false); }} title="Reset zoom to 100% (Ctrl+0)">
                  <span className="browser__more-icon"><Maximize2 size={14} /></span>
                  <span className="browser__more-label">Reset zoom (100%)</span>
                </button>
                <button className="browser__more-item" onClick={handleToggleDevTools} title="Inspect Element / DevTools">
                  <span className="browser__more-icon"><Search size={14} /></span>
                  <span className="browser__more-label">Inspect element</span>
                </button>
                <button className="browser__more-item" onClick={() => { setMoreOpen(false); openFind(); }} title="Find in page (Ctrl+F)">
                  <span className="browser__more-icon"><Search size={14} /></span>
                  <span className="browser__more-label">Find in page</span>
                  <span className="browser__more-hint">Ctrl+F</span>
                </button>
                <button className="browser__more-item" onClick={handleManageExtensions} title="Manage extensions">
                  <span className="browser__more-icon"><Puzzle size={14} /></span>
                  <span className="browser__more-label">Manage extensions</span>
                </button>
                <div className="browser__more-sep" />
                <button className="browser__more-item" onClick={handleHideBar} title="Hide toolbar">
                  <span className="browser__more-icon"><ChevronUp size={14} /></span>
                  <span className="browser__more-label">Hide toolbar</span>
                </button>
              </div>
            )}
          </div>

          {/* Extension actions (browser-action-list) — alag rakha hai, ⋮ me nahi */}
          <browser-action-list
            ref={actionListRef}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-2)" }}
          />
        </div>
      )}

      {/* Edit Mode Banner */}
      {editMode && !barHidden && (
        <div style={{
          display:"flex", alignItems:"center", gap:"var(--space-8)",
          padding:"var(--space-3) var(--space-10)",
          background: isVisualOnlyUrl ? "var(--warn-tint-a12)" : "var(--teal-a12)",
          borderBottom: isVisualOnlyUrl ? "1px solid var(--warn-tint-a30)" : "1px solid var(--teal-a25)",
          color: isVisualOnlyUrl ? "var(--warning)" : "var(--teal)", fontSize:"var(--fs-small)", fontWeight:"var(--fw-semibold)", flexShrink:0, letterSpacing:0.2,
        }}>
          <Type size={12} />
          <span>{isVisualOnlyUrl
            ? "EDIT MODE — VISUAL ONLY (no project open, saves revert) • Click a single line • Enter applies visually • Esc cancels"
            : "EDIT MODE ON — Click a single line of text • Enter to save • Esc to cancel • Saves to html/js/jsx/ts/tsx"}</span>
          <span style={{ marginLeft:"auto", background: isVisualOnlyUrl ? "var(--warn-tint-a25)" : "var(--teal-a22)", padding:"var(--space-1) var(--space-6)", borderRadius:"var(--radius-sm)", fontSize:"var(--fs-tiny)", color:"var(--ink-on-teal)", fontWeight:"var(--fw-bold)" }}>{isVisualOnlyUrl ? "VISUAL" : "LIVE"}</span>
          <button
            onClick={handleCancelEditMode}
            title="Cancel edit and revert"
            style={{ marginLeft:"var(--space-4)", background:"transparent", color: isVisualOnlyUrl ? "var(--warning)" : "var(--teal)", border:`1px solid ${isVisualOnlyUrl ? "var(--warn-tint-a50)" : "var(--teal-a50)"}`, borderRadius:"var(--radius-sm)", padding:"var(--space-2) var(--space-8)", fontSize:"var(--fs-small)", fontWeight:"var(--fw-bold)", cursor:"pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={async ()=>{
              try{ await webviewRef.current?.executeJavaScript('window.__ibxCommitPendingEdit && window.__ibxCommitPendingEdit()'); }catch{}
              setTimeout(()=> setEditMode(false), 350);
            }}
            style={{ marginLeft:"var(--space-4)", background: isVisualOnlyUrl ? "var(--warning)" : "var(--teal)", color:"var(--ink-on-teal)", border:"none", borderRadius:"var(--radius-sm)", padding:"var(--space-2) var(--space-8)", fontSize:"var(--fs-small)", fontWeight:"var(--fw-bold)", cursor:"pointer" }}
          >
            Done
          </button>
        </div>
      )}

      {barHidden && (
        <button className="browser__show-btn" onClick={() => setBarHidden(false)} title="Show toolbar">
          <ChevronDown size={14} />
        </button>
      )}

      {/* Lock / security popup */}
      {lockOpen && (
        <>
          <div className="browser__lock-overlay" onClick={() => setLockOpen(false)} />
          <div className="browser__lock-popup" style={popupStyle} onClick={(e) => e.stopPropagation()}>
            <div className="browser__lock-popup-item">
              <span className="browser__lock-popup-label">Connection</span>
              <span className="browser__lock-popup-value" style={{ color: iconColor }}>
                {isLocal ? "Local" : isHttps ? "Secure" : "Not secure"}{" "}
                ({isLocal ? (hostname || "local") : isHttps ? "HTTPS" : "HTTP"})
              </span>
            </div>
            <div className="browser__lock-popup-item">
              <span className="browser__lock-popup-label">URL</span>
              <span className="browser__lock-popup-value" style={{ wordBreak:"break-all" }}>{displayUrl}</span>
            </div>
            {hostname && (
              <div className="browser__lock-popup-item">
                <span className="browser__lock-popup-label">Domain</span>
                <span className="browser__lock-popup-value">{hostname}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* Webview — hamesha SAME element (no remount, no reload) */}
      <div ref={viewWrapRef} className="browser__view-wrap">
        <webview
          key="browser-webview"
          className="browser__view"
          ref={webviewRefCb}
          src={navUrl}
          preload={WEBVIEW_PRELOAD}
          // webview is a custom Electron element - use string attrs to avoid React boolean warnings
          allowpopups=""
          allowFullScreen=""
        />
        {/* Find in page bar */}
        {findOpen && (
          <div
            style={{
              position: "absolute", top: 8, right: 12, zIndex: "var(--z-toast)",
              display: "flex", alignItems: "center", gap: 4,
              background: "var(--bg-vscode)", border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop)",
              padding: "4px 6px", maxWidth: "min(360px, 80%)",
            }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeFind(); } }}
          >
            <input
              ref={findInputRef}
              value={findText}
              onChange={(e) => onFindChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); runFind(findText, { forward: !e.shiftKey, findNext: true }); }
              }}
              placeholder="Find in page"
              spellCheck={false}
              style={{
                flex: 1, minWidth: 0,
                background: "var(--bg-surface)", border: "1px solid var(--border-strong)",
                borderRadius: "var(--radius-sm)", color: "var(--text-hover)",
                fontSize: "var(--fs-body)", padding: "4px 8px", outline: "none",
              }}
              aria-label="Find in page"
            />
            <span style={{ fontSize: "var(--fs-small)", color: "var(--text-disabled)", minWidth: 40, textAlign: "right", userSelect: "none" }}>
              {findText ? `${findActive}/${findMatches}` : ""}
            </span>
            <button
              className="browser__btn" title={findMatchCase ? "Match case: on" : "Match case: off"}
              onClick={() => {
                const next = !findMatchCase;
                setFindMatchCase(next);
                if (findText) runFind(findText, { forward: true, findNext: false, matchCase: next });
              }}
              style={findMatchCase ? { background: "var(--select-blue)", color: "var(--text-inverse)" } : undefined}
            >
              <span style={{ fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)" }}>Aa</span>
            </button>
            <button className="browser__btn" title="Previous (Shift+Enter)" onClick={() => runFind(findText, { forward: false, findNext: true })}>
              <ChevronUp size={14} />
            </button>
            <button className="browser__btn" title="Next (Enter)" onClick={() => runFind(findText, { forward: true, findNext: true })}>
              <ChevronDown size={14} />
            </button>
            <button className="browser__btn" title="Close (Esc)" onClick={closeFind}>✕</button>
          </div>
        )}
        {/* Edit mode overlay hint when bar hidden */}
        {editMode && barHidden && (
          <div style={{
            position:"absolute", top:8, left:"50%", transform:"translateX(-50%)",
            background:"var(--teal-a95)", color:"var(--ink-on-teal)", fontSize:"var(--fs-small)", fontWeight:"var(--fw-bold)",
            padding:"var(--space-4) var(--space-10)", borderRadius:"var(--radius-md)", display:"flex", alignItems:"center", gap:"var(--space-6)",
            boxShadow:"0 4px 12px var(--overlay-a30)", zIndex:"var(--z-toast)", pointerEvents:"none"
          }}>
            <Pencil size={12} /> EDIT MODE ON — click any text
          </div>
        )}
        {/* Toast */}
        {toast && (
          <div style={{
            position:"absolute", bottom:16, left:"50%", transform:"translateX(-50%)",
            background: toast.type==="error" ? "var(--error-border)" : toast.type==="success" ? "var(--success-bg)" : "var(--bg-vscode)",
            color: toast.type==="error" ? "var(--error-text)" : toast.type==="success" ? "var(--teal)" : "var(--text-highlight)",
            border: `1px solid ${toast.type==="error" ? "var(--error-border-short)" : toast.type==="success" ? "var(--success-border)" : "var(--border-strong)"}`,
            padding:"var(--space-8) var(--space-14)", borderRadius:"var(--radius-lg)", fontSize:"var(--fs-body)", fontWeight:"var(--fw-medium)",
            boxShadow:"var(--shadow-toast)", zIndex:"var(--z-toast-top)", maxWidth:"80%", textAlign:"center",
            display:"flex", alignItems:"center", gap:8
          }}>
            {toast.type==="success" ? "✓" : toast.type==="error" ? "✕" : "•"} <span>{toast.msg}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default BrowserPanel;