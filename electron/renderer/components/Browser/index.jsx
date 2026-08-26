import React, { useState, useRef, useCallback, useEffect } from "react";
import { Actions, DockLocation } from "flexlayout-react";
import { ChevronLeft, ChevronRight, RefreshCw, Lock, Unlock, Globe, Eye, Search, ChevronUp, ChevronDown } from "lucide-react";

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

  const webviewRef   = useRef(null);
  const attachedRef  = useRef(false);
  const lockRef      = useRef(null);
  const nodeIdRef    = useRef(nodeId);
  const goToUrlRef   = useRef(null);
  const actionListRef = useRef(null);

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
    wv.addEventListener("dom-ready", () => injectGuest(1));

    wv.addEventListener("page-title-updated", (e) => {
      const t = e.title || "";
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
              className="browser__url"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              onFocus={() => setFocused(true)}
              onBlur={() => { setFocused(false); setLockOpen(false); }}
            />
          </div>

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
      </div>
    </div>
  );
};

export default BrowserPanel;