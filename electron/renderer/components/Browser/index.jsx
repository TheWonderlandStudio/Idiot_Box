import React, { useState, useRef, useCallback, useEffect } from "react";
import { Actions, DockLocation } from "flexlayout-react";
import { ChevronLeft, ChevronRight, RefreshCw, Lock, Unlock, Globe, Eye, Search, ChevronUp, ChevronDown, Pencil, PencilOff, Type } from "lucide-react";

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
  const [popupStyle,   setPopupStyle]   = useState({});
  const [editMode,     setEditMode]     = useState(false);
  const [toast,        setToast]        = useState(null);
  const editModeRef  = useRef(false);
  const toastTimerRef = useRef(null);

  const webviewRef   = useRef(null);
  const attachedRef  = useRef(false);
  const lockRef      = useRef(null);
  const nodeIdRef    = useRef(nodeId);
  const goToUrlRef   = useRef(null);
  const actionListRef = useRef(null);
  const inputRef     = useRef(null);

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

  const showToast = useCallback((msg, type="info") => {
    setToast({ msg, type });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(()=> setToast(null), 2800);
  }, []);

  const handleLiveEdit = useCallback(async (data) => {
    const oldText = String(data?.oldText || "").trim();
    const newText = String(data?.newText || "").trim();
    if (!oldText || !newText || oldText === newText) { showToast("No change", "info"); return; }
    if (!newText) { showToast("Empty text not allowed", "error"); return; }
    try {
      showToast("Updating source…", "info");
      const projectRoot = window.__currentProjectPath || null;
      const url = data?.url || webviewRef.current?.getURL?.() || displayUrl;
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
        showToast(res?.error || "Update failed", "error");
        // revert visually by reloading if possible? Keep DOM as is but notify
        try { webviewRef.current?.executeJavaScript(`(() => { try{ document.title="__IBX_EDIT_REVERT__"; }catch{} return true; })()`); } catch {}
      }
    } catch (e) {
      showToast(e?.message || String(e), "error");
    }
  }, [displayUrl, showToast]);

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
  const iconColor = isLocal ? "#888"     : (isHttps ? "#4ec9b0" : "#e6a23c");

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
    wv.addEventListener("did-navigate",         () => {
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
    const INJECT_SCRIPT = `(() => {
      try {
        var mark = function(b){ try{ document.title="__IBX_NAV__"+b; }catch(e){} };
        try{ window.addEventListener("mouseup", function(e){ try{ if(e.button===3) mark("b"); else if(e.button===4) mark("f"); }catch(e){} }, true); }catch(e){}
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
    // ── Live Edit helper: text-only inline editing with auto detection ──
    const EDIT_HELPER_SCRIPT = `(() => {
      try {
        if (window.__ibxEditHelpersInstalled) return true;
        window.__ibxEditHelpersInstalled = true;
        window.__ibxEditEnabled = !!window.__ibxEditEnabled;
        let hoverEl = null;
        let activeEl = null;
        let styleEl = null;
        let prevTitle = document.title;
        function ensureStyle(){
          if (styleEl) return;
          styleEl = document.createElement('style');
          styleEl.id = '__ibx-edit-style';
          styleEl.textContent = \`
            .__ibx-edit-hover { outline: 2px dashed #4ec9b0 !important; outline-offset: 2px !important; cursor: text !important; background: rgba(78,201,176,0.08) !important; box-shadow: 0 0 0 1px rgba(78,201,176,0.15) inset !important; }
            .__ibx-edit-active { outline: 2px solid #4ec9b0 !important; outline-offset: 2px !important; background: rgba(78,201,176,0.14) !important; box-shadow: 0 0 0 1px rgba(78,201,176,0.25) inset !important; }
            .__ibx-edit-badge { position: absolute; top: -18px; left: 0; background: #4ec9b0; color: #0d0d0d; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 3px; pointer-events: none; font-family: sans-serif; letter-spacing: 0.3px; z-index: 99999; }
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
            // ignore hidden
            const st=window.getComputedStyle(el);
            if(st && (st.display==='none' || st.visibility==='hidden' || parseFloat(st.opacity)===0)) return false;
            return true;
          }catch{ return false; }
        }
        function findEditableTarget(start){
          let el=start;
          let depth=0;
          while(el && el!==document.body && el!==document.documentElement && depth<7){
            if(!isSkippedTag(el) && hasVisibleText(el)) return el;
            el=el.parentElement; depth++;
          }
          return null;
        }
        function clearHover(){ try{ if(hoverEl){ hoverEl.classList.remove('__ibx-edit-hover'); const b=hoverEl.querySelector && hoverEl.querySelector('.__ibx-edit-badge'); if(b) b.remove(); } }catch{} hoverEl=null; }
        function onMouseOver(e){
          if(!window.__ibxEditEnabled || activeEl) return;
          const t=findEditableTarget(e.target);
          if(t===hoverEl) return;
          clearHover();
          if(t){ hoverEl=t; try{ hoverEl.classList.add('__ibx-edit-hover'); if(!hoverEl.querySelector('.__ibx-edit-badge')){ const badge=document.createElement('span'); badge.className='__ibx-edit-badge'; badge.textContent='✎ edit'; hoverEl.style.position = hoverEl.style.position || 'relative'; if(window.getComputedStyle(hoverEl).position==='static') hoverEl.style.position='relative'; hoverEl.appendChild(badge); } }catch{} }
        }
        function onMouseOut(e){
          if(!window.__ibxEditEnabled || activeEl) return;
          try{ const rel=e.relatedTarget; if(hoverEl && rel && hoverEl.contains(rel)) return; }catch{}
          clearHover();
        }
        function cleanupActive(cancel){
          if(!activeEl) return;
          const el=activeEl;
          try{
            el.removeEventListener('keydown', onEditKey);
            el.removeEventListener('blur', onEditBlur);
            el.removeEventListener('input', onEditInput);
            if(cancel){
              if(el.__ibxOldText!=null) el.innerText = el.__ibxOldText;
            }
            el.removeAttribute('contenteditable');
            el.classList.remove('__ibx-edit-active');
            const b=el.querySelector && el.querySelector('.__ibx-edit-badge');
            if(b) b.remove();
            el.style.outline='';
          }catch{}
          activeEl=null;
        }
        function commitEdit(){
          if(!activeEl) return;
          const el=activeEl;
          const oldText=el.__ibxOldText||'';
          let newText='';
          try{ newText=(el.innerText||el.textContent||'').trim(); }catch{}
          // capture outer before cleanup
          let outerSnippet='';
          try{ outerSnippet=String(el.outerHTML||'').slice(0,300); }catch{ outerSnippet=''; }
          const tagName=String(el.tagName||'');
          cleanupActive(false);
          clearHover();
          if(!newText || newText===oldText.trim()){ try{ el.innerText=oldText.trim(); }catch{} return; }
          const payload={ oldText: String(oldText).trim(), newText: String(newText).trim(), outerSnippet: outerSnippet, tagName: tagName, url: location.href };
          const prev=prevTitle;
          try{ prevTitle=document.title; document.title="__IBX_EDIT__"+JSON.stringify(payload); setTimeout(()=>{ try{ if(String(document.title).startsWith("__IBX_EDIT__")) document.title=prev; }catch{} }, 900); }catch{}
        }
        window.__ibxCommitPendingEdit = function(){
          try{ if(activeEl) commitEdit(); return true; }catch(e){ return false; }
        };
        function onEditKey(e){
          if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); cleanupActive(true); clearHover(); }
          else if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); try{ activeEl && activeEl.blur(); }catch{} }
        }
        function onEditBlur(){ setTimeout(()=>{ if(activeEl) commitEdit(); }, 80); }
        function onEditInput(){}
        function onClick(e){
          if(!window.__ibxEditEnabled) return;
          const t=findEditableTarget(e.target);
          if(!t) return;
          // allow clicks inside already active editor
          if(activeEl && activeEl.contains(e.target)) return;
          e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation==='function') try{e.stopImmediatePropagation();}catch{}
          clearHover();
          if(activeEl) cleanupActive(true);
          activeEl=t;
          try{
            activeEl.__ibxOldText = (activeEl.innerText||'').trim();
            activeEl.classList.add('__ibx-edit-active');
            const b=activeEl.querySelector && activeEl.querySelector('.__ibx-edit-badge');
            if(b) b.remove();
            activeEl.setAttribute('contenteditable','true');
            activeEl.focus();
            // select all
            try{
              const range=document.createRange(); range.selectNodeContents(activeEl); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
            }catch{}
            activeEl.addEventListener('keydown', onEditKey);
            activeEl.addEventListener('blur', onEditBlur);
            activeEl.addEventListener('input', onEditInput);
          }catch{}
        }
        window.__ibxSetEditMode = function(enabled){
          window.__ibxEditEnabled = !!enabled;
          if(window.__ibxEditEnabled){
            ensureStyle();
            try{ document.addEventListener('mouseover', onMouseOver, true); }catch{}
            try{ document.addEventListener('mouseout', onMouseOut, true); }catch{}
            try{ document.addEventListener('click', onClick, true); }catch{}
            try{ document.body.style.cursor='text'; }catch{}
            prevTitle=document.title;
          } else {
            try{ document.removeEventListener('mouseover', onMouseOver, true); }catch{}
            try{ document.removeEventListener('mouseout', onMouseOut, true); }catch{}
            try{ document.removeEventListener('click', onClick, true); }catch{}
            // Done pe pending edit ko commit karo, cancel nahi — taaki file me update ho
            try{
              if(activeEl){
                const old=(activeEl.__ibxOldText||'').trim();
                let cur='';
                try{ cur=(activeEl.innerText||'').trim(); }catch{}
                if(cur && cur!==old){ commitEdit(); } else { cleanupActive(true); }
              }
            }catch{ try{ if(activeEl) cleanupActive(true);}catch{} }
            clearHover();
            removeStyle();
            try{ document.body.style.cursor=''; }catch{}
          }
          return true;
        };
        // honor pending state if set before install
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
    wv.addEventListener("dom-ready", () => { injectGuest(1); injectEditHelper(1); });

    wv.addEventListener("page-title-updated", (e) => {
      const t = e.title || "";
      if (t.startsWith("__IBX_EDIT__")) {
        try {
          const payload = JSON.parse(t.slice("__IBX_EDIT__".length));
          handleLiveEdit(payload);
        } catch {}
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
    if (el) { webviewRef.current = el; attachListenersRef.current(el); syncActionTab(); }
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
    if (editMode) showToast("Edit mode ON — click any text to edit (Enter to save, Esc to cancel)", "info");
    else if (attachedRef.current) showToast("Edit mode OFF", "info");
  }, [editMode, showToast]);

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
      // Escape → stop loading
      if (e.key === "Escape" && isLoading) {
        e.preventDefault();
        try { wv.stop(); } catch {}
        return;
      }
      // Ctrl+0 → reset zoom, Ctrl+Plus/Ctrl+Minus → zoom (webview)
      if ((e.ctrlKey || e.metaKey) && (e.key === "0")) {
        e.preventDefault();
        try { wv.setZoomFactor(1); } catch {}
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+" )) {
        e.preventDefault();
        try { const z = wv.getZoomFactor(); wv.setZoomFactor(Math.min(z + 0.1, 3)); } catch {}
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        try { const z = wv.getZoomFactor(); wv.setZoomFactor(Math.max(z - 0.1, 0.2)); } catch {}
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isLoading]);

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

          {/* Edit Mode Toggle — text-only live editing, auto detection html/js/jsx/ts/tsx */}
          <button
            className={`browser__btn${editMode ? " browser__btn--active" : ""}`}
            onClick={async () => {
              if (editMode) {
                try { await webviewRef.current?.executeJavaScript('window.__ibxCommitPendingEdit && window.__ibxCommitPendingEdit()'); } catch {}
                setTimeout(()=> setEditMode(false), 220);
              } else {
                setEditMode(true);
              }
            }}
            title={editMode ? "Done — save pending edit & exit" : "Edit Mode — click any text to edit (live updates source: html/js/jsx/ts/tsx auto)"}
            style={editMode ? { background: "rgba(78,201,176,0.18)", color: "#4ec9b0", border: "1px solid rgba(78,201,176,0.35)" } : undefined}
          >
            {editMode ? <PencilOff size={14} /> : <Pencil size={14} />}
          </button>

          {/* Inspect Element button */}
          <button
            className="browser__btn"
            onClick={() => {
              if (webviewRef.current) {
                try {
                  if (webviewRef.current.isDevToolsOpened()) {
                    webviewRef.current.closeDevTools();
                  } else {
                    webviewRef.current.openDevTools();
                  }
                } catch {}
              }
            }}
            title="Inspect Element / DevTools"
          >
            <Search size={14} />
          </button>

          <button className="browser__btn" onClick={() => setBarHidden(true)} title="Hide toolbar">
            <ChevronUp size={14} />
          </button>

          {/* Extension actions (browser-action-list) */}
          <browser-action-list
            ref={actionListRef}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 2 }}
          />
        </div>
      )}

      {/* Edit Mode Banner */}
      {editMode && !barHidden && (
        <div style={{
          display:"flex", alignItems:"center", gap:8,
          padding:"3px 10px", background:"rgba(78,201,176,0.12)", borderBottom:"1px solid rgba(78,201,176,0.25)",
          color:"#4ec9b0", fontSize:11, fontWeight:600, flexShrink:0, letterSpacing:0.2,
        }}>
          <Type size={12} />
          <span>EDIT MODE ON — Click any text to edit • Enter to save • Esc to cancel • Auto saves to html/js/jsx/ts/tsx</span>
          <span style={{ marginLeft:"auto", background:"rgba(78,201,176,0.22)", padding:"1px 6px", borderRadius:3, fontSize:10, color:"#0d1117", fontWeight:700 }}>LIVE</span>
          <button
            onClick={async ()=>{
              try{ await webviewRef.current?.executeJavaScript('window.__ibxCommitPendingEdit && window.__ibxCommitPendingEdit()'); }catch{}
              setTimeout(()=> setEditMode(false), 220);
            }}
            style={{ marginLeft:4, background:"#4ec9b0", color:"#0d1117", border:"none", borderRadius:3, padding:"2px 8px", fontSize:11, fontWeight:700, cursor:"pointer" }}
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

      {/* Webview */}
      <div className="browser__view-wrap">
        <webview
          className="browser__view"
          ref={webviewRefCb}
          src={navUrl}
          preload={WEBVIEW_PRELOAD}
          // webview is a custom Electron element - use string attrs to avoid React boolean warnings
          allowpopups=""
          allowFullScreen=""
        />
        {/* Edit mode overlay hint when bar hidden */}
        {editMode && barHidden && (
          <div style={{
            position:"absolute", top:8, left:"50%", transform:"translateX(-50%)",
            background:"rgba(78,201,176,0.95)", color:"#0d1117", fontSize:11, fontWeight:700,
            padding:"4px 10px", borderRadius:4, display:"flex", alignItems:"center", gap:6,
            boxShadow:"0 4px 12px rgba(0,0,0,0.3)", zIndex:20, pointerEvents:"none"
          }}>
            <Pencil size={12} /> EDIT MODE ON — click any text
          </div>
        )}
        {/* Toast */}
        {toast && (
          <div style={{
            position:"absolute", bottom:16, left:"50%", transform:"translateX(-50%)",
            background: toast.type==="error" ? "#732222" : toast.type==="success" ? "#1a3a2a" : "#252526",
            color: toast.type==="error" ? "#ff8a8a" : toast.type==="success" ? "#4ec9b0" : "#d4d4d4",
            border: `1px solid ${toast.type==="error" ? "#a33" : toast.type==="success" ? "#2d6a4f" : "#3c3c3c"}`,
            padding:"8px 14px", borderRadius:6, fontSize:12, fontWeight:500,
            boxShadow:"0 6px 18px rgba(0,0,0,0.4)", zIndex:30, maxWidth:"80%", textAlign:"center",
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