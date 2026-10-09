import React, { useState, useRef, useCallback, useEffect } from "react";
import { Actions, DockLocation } from "flexlayout-react";
import { EDIT_HELPER_SOURCE } from "./editHelper.js";
import {
  ChevronLeft, ChevronRight, RefreshCw, X, Lock, Unlock, Globe, FileCode,
  Search, ChevronUp, ChevronDown,   Pencil, PencilOff, MoreVertical,
  Puzzle, Maximize2, ZoomIn, ZoomOut, Unplug, RotateCw, ExternalLink,
  Undo2, Check, ArrowUp, ArrowDown, Trash2, Copy, Link2, Code, Info,
  GripVertical
} from "lucide-react";

// ── SVG icon paths ─────────────────────────────────────────────────────────────
const LOCK_ICON   = "M8 1a4 4 0 0 0-4 4v2H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1V5a4 4 0 0 0-4-4zm-2 6V5a2 2 0 1 1 4 0v2H6z";
const UNLOCK_ICON = "M8 1a4 4 0 0 1 4 4v1h-1V5a3 3 0 0 0-5.7-1.37l-.78-.62A4 4 0 0 1 8 1zm-5.65.09l12 14-.7.6L1.65 1.7zM6 7.49l-1.82.01a1 1 0 0 0-.18 0v3.85L2.35 9.7l-.7.6L4 13.2V14a1 1 0 0 0 1 1h6.15l-1-1H5v-4.5l1.85.01zm4.56-.57A1 1 0 0 1 12 7.5V8h1a1 1 0 0 1 1 1v3.15l-1-1V9h-1.44z";
const LOCAL_ICON  = "M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-1 12.93A6 6 0 0 1 2 8c0-.33.03-.66.07-1H4v1h2v1H5v1h1v2l1 1zm5.1-3.83A4.9 4.9 0 0 0 13 8c0-2.5-1.83-4.55-4.2-4.96L9 4v1H7V4h-.44l3.55 5.1zm-9.4.14A5 5 0 0 1 2 8c0 1.72.87 3.23 2.2 4.14l.83-1.04z";

// ── Chrome-style minimal error pages ──────────────────────────────────────────
const getErrorInfo = (code, url) => {
  const c = Number(code);
  let host = "";
  try {
    const u = new URL(url);
    host = u.host || u.hostname;
  } catch {
    host = String(url || "").replace(/^https?:\/\//i, "").split("/")[0] || "";
  }
  const cleanHost = String(host || "the server").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (c === -105 || c === -109) {
    return {
      title: "This site can’t be reached",
      lines: [
        `Check if there is a typo in ${cleanHost}.`,
        `If spelling is correct, try checking your network connection.`
      ],
      code: c === -109 ? "ERR_ADDRESS_UNREACHABLE" : "ERR_NAME_NOT_RESOLVED"
    };
  }

  if (c === -102) {
    return {
      title: "This site can’t be reached",
      lines: [
        `<strong>${cleanHost}</strong> refused to connect.`,
        `Try checking the connection or verifying that your server is running.`
      ],
      code: "ERR_CONNECTION_REFUSED"
    };
  }

  if (c === -100 || c === -101) {
    return {
      title: "This site can’t be reached",
      lines: [
        `The connection was reset.`,
        `Try checking the connection or reloading the page.`
      ],
      code: c === -100 ? "ERR_CONNECTION_CLOSED" : "ERR_CONNECTION_RESET"
    };
  }

  if (c === -7 || c === -110 || c === -118) {
    return {
      title: "This site can’t be reached",
      lines: [
        `<strong>${cleanHost}</strong> took too long to respond.`,
        `Try checking the connection or proxy settings.`
      ],
      code: c === -7 ? "ERR_TIMED_OUT" : "ERR_CONNECTION_TIMED_OUT"
    };
  }

  if (c === -107 || c === -200 || c === -201 || c === -202 || c === -501) {
    return {
      title: "Your connection is not private",
      lines: [
        `Attackers might be trying to steal your information from <strong>${cleanHost}</strong> (for example, passwords, messages, or credit cards).`,
        `If developing locally, try using http:// instead of https://.`
      ],
      code: c === -107 ? "ERR_SSL_PROTOCOL_ERROR" : "ERR_CERT_COMMON_NAME_INVALID"
    };
  }

  if (c === -106) {
    return {
      title: "No internet",
      lines: [
        `Try checking the network cables, modem, and router or reconnecting to Wi-Fi.`
      ],
      code: "ERR_INTERNET_DISCONNECTED"
    };
  }

  if (c === -6) {
    return {
      title: "Your file couldn’t be accessed",
      lines: [
        `It may have been moved, edited, or deleted.`,
        `Check if the file exists at the specified path.`
      ],
      code: "ERR_FILE_NOT_FOUND"
    };
  }

  if (c === -10 || c === -20 || c === -21) {
    return {
      title: "This request was blocked",
      lines: [
        `An extension or security policy blocked access to this page.`
      ],
      code: "ERR_BLOCKED_BY_CLIENT"
    };
  }

  return {
    title: "This page couldn’t be loaded",
    lines: [
      `An unexpected error occurred while loading this page.`
    ],
    code: "ERR_FAILED"
  };
};

const buildErrorHtml = (info) => {
  const linesHtml = (info.lines || []).map((l) => `<p class="ln">${l}</p>`).join("");
  const dark = typeof document !== "undefined"
    ? !(/\b(light|theme-light)\b/i.test(document.documentElement?.className || "") || window.__ibxLightTheme)
    : true;

  const bg   = dark ? "#1a1a1a" : "#fafafa";
  const fg   = dark ? "#d4d4d4" : "#1a1a1a";
  const sub  = dark ? "#6b6b6b" : "#888";
  const btn  = dark ? "#2a2a2a" : "#ebebeb";
  const bord = dark ? "#333"    : "#d8d8d8";

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>${info.title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:${bg};color:${fg};font-family:system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
body{display:flex;align-items:center;justify-content:center;padding:32px 24px}
.w{max-width:420px;width:100%}
h1{font-size:18px;font-weight:500;margin-bottom:10px;line-height:1.4}
.ln{font-size:13px;line-height:1.6;color:${sub};margin-bottom:4px}
.ln strong{color:${fg};font-weight:500}
.ec{font-size:11px;color:${sub};font-family:monospace;margin-top:16px;margin-bottom:20px;opacity:.7}
button{background:${btn};color:${fg};border:1px solid ${bord};border-radius:6px;padding:6px 16px;font-size:12px;font-family:inherit;cursor:pointer;transition:opacity .15s}
button:hover{opacity:.7}
</style></head>
<body><div class="w">
<h1>${info.title}</h1>
${linesHtml}
<div class="ec">${info.code}</div>
<button id="r">Reload</button>
</div>
<script>document.addEventListener("click",function(e){var b=e.target.closest("button");if(b&&b.id==="r")document.title="__IBX_ERR__r:"+Date.now()});</script>
</body></html>`;
};

// ── BrowserPanel ───────────────────────────────────────────────────────────────
const WEBVIEW_PRELOAD = typeof window !== "undefined" && window.electronAPI?.getWebviewPreload
  ? window.electronAPI.getWebviewPreload() : undefined;

// Guest base64 payloads decode karo (document.title whitespace collapse karta
// hai — plain JSON me double-space/tabs/newlines toot jate). TextDecoder path
// taaki unicode bhi sahi aaye.
const decodeB64 = (b) => {
  try {
    const bin = atob(String(b || ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
};

// Edit-mode shortcut hints (confirm bar + tooltip dono me)
const EDIT_HINTS = "Click text · Enter saves · Esc cancels · Tab next · Ctrl+E edit HTML · Ctrl+Z undo last save · Alt+click attributes · Alt+↑/↓ move · Del remove · Ctrl+D duplicate · Ctrl+K wrap link · Shift+click inspect";

// Sidebar ke shortcut list (chhote kbd chips)
const EDIT_SHORTCUTS = [
  ["Click", "edit text"],
  ["Enter", "apply"],
  ["Esc", "cancel"],
  ["Tab", "next element"],
  ["Del", "remove element"],
  ["Ctrl+D", "duplicate"],
  ["Ctrl+K", "wrap as link"],
  ["Ctrl+E", "raw HTML editor"],
  ["Ctrl+Z", "undo last save"],
  ["Alt+click", "attributes"],
  ["Alt+↑ ↓", "move element"],
  ["Shift+click", "inspect"],
  ["Ctrl+click", "follow link"],
];

// Sidebar style tiles ke chhote labels
const ALIGN_ABBR = { left: "L", center: "C", right: "R", justify: "J" };
const TT_ABBR = { none: "TT", uppercase: "AA", lowercase: "aa", capitalize: "Aa" };

// Visual controls ke options (Cursor-style property panel)
const JC_OPTS = [
  ["", "auto"], ["flex-start", "start"], ["center", "center"],
  ["flex-end", "end"], ["space-between", "between"],
  ["space-around", "around"], ["space-evenly", "evenly"],
];
const AI_OPTS = [
  ["", "auto"], ["flex-start", "start"], ["center", "center"],
  ["flex-end", "end"], ["stretch", "stretch"], ["baseline", "baseline"],
];
// Generic families pehle order me — computed fontFamily me yahi milte hain
const FF_OPTS = [
  ["system-ui", "System"], ["sans-serif", "Sans"], ["serif", "Serif"],
  ["monospace", "Mono"], ["cursive", "Cursive"],
];
const FW_OPTS = [300, 400, 500, 600, 700, 800];
const PALETTE = [
  "#000000", "#ffffff", "#ef4444", "#f97316", "#eab308",
  "#22c55e", "#14b8a6", "#3b82f6", "#a855f7", "#6b7280",
];

// Ek line ka slider row (label + range + live value)
function EbSlider({ label, val, min, max, step, unit, display, disabled, onChange }) {
  return (
    <div className="eb-slider">
      <span className="eb-slider-label">{label}</span>
      <input
        type="range" min={min} max={max} step={step || 1} value={val}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="eb-slider-val">{display != null ? display : `${val}${unit || ""}`}</span>
    </div>
  );
}

// Ek tree row (DOM node) — recursion se children render hote hain.
// DnD: row drag → target row ke before/after/inside (Y-position se).
function EbTreeRow({ node, depth, expanded, sel, row, onToggle, onSel, onHover, onDropRow, onDragStartRow, onDragEndRow, setRow }) {
  const kids = node.k || null;
  const hasKids = !!(kids && kids.length);
  const open = !!expanded[node.i];
  const isSel = sel === node.i;
  const isDrop = !!(row && row.id === node.i);
  const onDragOver = (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const y = (e.clientY - r.top) / Math.max(1, r.height);
      const pos = y < 0.3 ? "before" : (y > 0.7 ? "after" : "inside");
      if (!row || row.id !== node.i || row.pos !== pos) setRow({ id: node.i, pos });
    } catch {}
  };
  const onDrop = (e) => {
    try { e.preventDefault(); e.stopPropagation(); } catch {}
    const target = node.i;
    const pos = row && row.id === node.i ? row.pos : "after";
    setRow(null);
    onDropRow(target, pos);
  };
  return (
    <div className="eb-tree__node">
      <div
        className={
          "eb-tree__row" +
          (isSel ? " eb-tree__row--sel" : "") +
          (isDrop ? " eb-tree__row--drop-" + row.pos : "") +
          (node.h ? " eb-tree__row--muted" : "")
        }
        style={{ paddingLeft: 6 + depth * 12 }}
        draggable
        onDragStart={(e) => { try { e.dataTransfer.setData("text/plain", String(node.i)); e.dataTransfer.effectAllowed = "move"; } catch {} setRow(null); onDragStartRow(node.i); }}
        onDragOver={onDragOver}
        onDragLeave={() => { if (isDrop) setRow(null); }}
        onDrop={onDrop}
        onDragEnd={() => { setRow(null); onDragEndRow(); }}
        onClick={() => onSel(node.i)}
        onMouseEnter={() => onHover(node.i)}
        title={(node.tx || node.c || "") + (node.t ? " <" + node.t + ">" : "")}
      >
        <span
          className={"eb-tree__chev" + (hasKids ? "" : " eb-tree__chev--leaf") + (open ? " eb-tree__chev--open" : "")}
          onClick={(e) => { e.stopPropagation(); if (hasKids) onToggle(node.i); }}
        >
          {hasKids ? (open ? "▾" : "▸") : "·"}
        </span>
        <span className="eb-tree__tag">{node.t}</span>
        {node.x ? <span className="eb-tree__id">#{node.x}</span> : null}
        {node.c ? <span className="eb-tree__cls">.{String(node.c).split(" ")[0]}</span> : null}
        {node.tx ? <span className="eb-tree__tx">{node.tx}</span> : null}
      </div>
      {hasKids && open && (
        <div className="eb-tree__kids">
          {kids.map((k) => (
            <EbTreeRow
              key={k.i} node={k} depth={depth + 1} expanded={expanded} sel={sel} row={row}
              onToggle={onToggle} onSel={onSel} onHover={onHover} onDropRow={onDropRow}
              onDragStartRow={onDragStartRow} onDragEndRow={onDragEndRow} setRow={setRow}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Text input row — poll ke rerender par focus/value na hile, Enter/blur par commit.
function EbTextRow({ label, value, placeholder, onCommit }) {
  const [v, setV] = useState(value || "");
  const focusedRef = useRef(false);
  useEffect(() => { if (!focusedRef.current) setV(value || ""); }, [value]);
  const commit = () => { const nv = String(v || ""); if (nv !== String(value || "")) onCommit(nv); };
  return (
    <div className="eb-srow">
      <span title={label}>{label}</span>
      <input
        className="eb-input"
        value={v}
        placeholder={placeholder || ""}
        spellCheck={false}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => { focusedRef.current = false; commit(); }}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      />
    </div>
  );
}

const BrowserPanel = (props) => {
  const { nodeId, config } = props || {};
  const initialUrl = config?.url || "https://www.google.com";

  const [navUrl,       setNavUrl]       = useState(initialUrl);
  const [inputValue,   setInputValue]   = useState(initialUrl);
  const [displayUrl,   setDisplayUrl]   = useState(initialUrl);
  const [canGoBack,    setCanGoBack]    = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading,    setIsLoading]    = useState(false);
  const [loadError,    setLoadError]    = useState(null);
  const [crashed,      setCrashed]      = useState(false);
  const [focused,      setFocused]      = useState(false);
  const [lockOpen,     setLockOpen]     = useState(false);
  const [barHidden,    setBarHidden]    = useState(false);
  const [moreOpen,     setMoreOpen]     = useState(false);
  const [popupStyle,   setPopupStyle]   = useState({});
  const [editMode,     setEditMode]     = useState(false);
  // Edit sidebar — edit mode ke saare controls yahan hote hain
  const [editSidebarOpen, setEditSidebarOpen] = useState(true);
  const [editStyle,    setEditStyle]    = useState({ active: false });
  const [toast,        setToast]        = useState(null);
  // ── v7: DOM tree panel (Cursor-style elements tree) ──
  const [treeData,     setTreeData]     = useState({ on: false, nodes: [] });
  const [treeSel,      setTreeSel]      = useState(0);
  const [treeRow,      setTreeRow]      = useState(null); // drag indicator { id, pos }
  const [treeExpanded, setTreeExpanded] = useState({});
  const treeDragRef    = useRef(0);   // drag session ka source id (poll skip ke liye bhi)
  // ── v7: properties panel (attrs + source locate) ──
  const [propState,    setPropState]    = useState({ active: false });
  const [propLoc,      setPropLoc]      = useState(null);
  // ── v7: design tokens (project palette) ──
  const [tokens,       setTokens]       = useState([]);
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
  const handleReloadRef = useRef(null);
  const actionListRef = useRef(null);
  const inputRef     = useRef(null);
  const errorUrlRef  = useRef(null);
  const errorCodeRef = useRef(null);
  const errorDescRef = useRef(null);
  const httpsFallbackAttemptedRef = useRef(false);
  const editTitleRef = useRef({ t: "", at: 0 });

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

  // ── Shortcut actions (guest IPC + host keys dono yahin aate hain) ───
  const runBrowserAction = useCallback((action) => {
    const wv = webviewRef.current;
    switch (action) {
      case "reload":   if (handleReloadRef.current) handleReloadRef.current(); else { try { wv?.reload(); } catch {} } break;
      case "find":     openFind(); break;
      case "focusUrl":
        try { inputRef.current?.focus(); inputRef.current?.select(); } catch {}
        break;
      case "back":     try { if (wv?.canGoBack()) wv.goBack(); } catch {} break;
      case "forward":  try { if (wv?.canGoForward()) wv.goForward(); } catch {} break;
      case "newTab":
        try {
          const url = "https://www.google.com";
          window.dispatchEvent(new CustomEvent("add-browser-panel", {
            detail: { url, config: { type: "browser", title: "New Tab", url } },
          }));
        } catch {}
        break;
      default: break;
    }
  }, [openFind]);

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

  // ── Sidebar → guest controls (edit tools + style panel) ──────────────────
  const runGuest = useCallback((js) => {
    try {
      const p = webviewRef.current?.executeJavaScript(js, false);
      if (p && typeof p.catch === "function") p.catch(() => {});
      return p || null;
    } catch { return null; }
  }, []);
  const guestTool = useCallback((name) => {
    runGuest(`window.__ibxEditAction && window.__ibxEditAction(${JSON.stringify(name)})`);
  }, [runGuest]);
  const refreshStyleState = useCallback(() => {
    const p = runGuest("window.__ibxStyleState ? window.__ibxStyleState() : ({active:false})");
    if (p && typeof p.then === "function") {
      p.then((s) => { try { setEditStyle(s && typeof s === "object" ? s : { active: false }); } catch {} }).catch(() => {});
    }
  }, [runGuest]);
  const guestStyle = useCallback((name, val) => {
    const arg = val == null ? "" : "," + JSON.stringify(String(val));
    runGuest(`window.__ibxStyleAction && window.__ibxStyleAction(${JSON.stringify(name)}${arg})`);
    // Turant refresh + poll bhi chalega hi (naye apply ke baad highlight sahi aaye)
    setTimeout(refreshStyleState, 120);
  }, [runGuest, refreshStyleState]);

  // ── v7: tree / properties / tokens helpers ────────────────────────────────
  const refreshTree = useCallback(() => {
    const p = runGuest("window.__ibxTreeState ? window.__ibxTreeState() : ({on:false,nodes:[]})");
    if (p && typeof p.then === "function") {
      p.then((s) => { try { setTreeData(s && typeof s === "object" && s.nodes ? s : { on: false, nodes: [] }); } catch {} }).catch(() => {});
    }
  }, [runGuest]);
  const refreshProps = useCallback(() => {
    const p = runGuest("window.__ibxPropState ? window.__ibxPropState() : ({active:false})");
    if (p && typeof p.then === "function") {
      p.then((s) => { try { setPropState(s && typeof s === "object" ? s : { active: false }); } catch {} }).catch(() => {});
    }
  }, [runGuest]);
  const selectTreeRow = useCallback((id) => {
    const n = Number(id) || 0;
    setTreeSel(n);
    runGuest(`window.__ibxTreeSelect && window.__ibxTreeSelect(${n})`);
    setTimeout(() => { refreshTree(); refreshStyleState(); refreshProps(); }, 140);
  }, [runGuest, refreshTree, refreshStyleState, refreshProps]);
  const hoverTreeRow = useCallback((id) => {
    runGuest(`window.__ibxTreeHover && window.__ibxTreeHover(${Number(id) || 0})`);
  }, [runGuest]);
  const toggleTree = useCallback((id) => {
    setTreeExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);
  const clearTreeSel = useCallback(() => {
    setTreeSel(0);
    runGuest("window.__ibxTreeClear && window.__ibxTreeClear()");
    setTimeout(() => { refreshTree(); refreshStyleState(); refreshProps(); }, 140);
  }, [runGuest, refreshTree, refreshStyleState, refreshProps]);
  const moveTreeRow = useCallback(async (srcId, refId, pos) => {
    const p = runGuest(`window.__ibxTreeMove ? window.__ibxTreeMove(${Number(srcId) || 0}, ${Number(refId) || 0}, ${JSON.stringify(String(pos))}) : false`);
    if (p && typeof p.then === "function") { try { await p; } catch {} }
    refreshTree(); refreshStyleState(); refreshProps();
  }, [runGuest, refreshTree, refreshStyleState, refreshProps]);
  // HTML5 DnD drop → src (drag session se) + target row + position
  const dropTreeRow = useCallback((targetId, pos) => {
    const src = treeDragRef.current;
    treeDragRef.current = 0;
    setTreeRow(null);
    if (!src || !targetId || src === targetId) return;
    moveTreeRow(src, targetId, pos);
  }, [moveTreeRow]);
  const propSet = useCallback((name, val) => {
    runGuest(`window.__ibxPropSet && window.__ibxPropSet(${JSON.stringify(String(name))}, ${JSON.stringify(String(val == null ? "" : val))})`);
    setTimeout(() => { refreshProps(); refreshStyleState(); }, 180);
  }, [runGuest, refreshProps, refreshStyleState]);

  // ── v7: design tokens (project-scope palette) ─────────────────────────────
  const loadTokens = useCallback(() => {
    try {
      const root = window.__currentProjectPath || null;
      if (!root) { setTokens([]); return; }
      const p = window.electronAPI.readVisualTokens(root);
      if (p && typeof p.then === "function") p.then((t) => { if (Array.isArray(t)) setTokens(t); }).catch(() => {});
    } catch {}
  }, []);
  const saveTokens = useCallback((next) => {
    setTokens(next);
    try {
      const root = window.__currentProjectPath || null;
      if (root) { const p = window.electronAPI.writeVisualTokens(root, next); if (p && p.catch) p.catch(() => {}); }
    } catch {}
  }, []);
  const addToken = useCallback(() => {
    const c = String(editStyle.color || "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(c)) { showToast("Element select karke text color set karo pehle", "info"); return; }
    if (tokens.indexOf(c) !== -1) { showToast(`${c} pehle se token me hai`, "info"); return; }
    saveTokens([...tokens, c]);
    showToast(`Token ${c} saved (project)`, "success");
  }, [editStyle.color, tokens, saveTokens, showToast]);
  const removeToken = useCallback((c) => {
    saveTokens(tokens.filter((x) => x !== c));
  }, [tokens, saveTokens]);

  // ── Sidebar = docked panel → webview apne aap shrink hota hai, isliye
  //    guest ko kabhi sidebar-width subtract nahi karni (vw() = innerWidth).
  const editSidebarRef    = useRef(null);
  const syncSbWidthRef    = useRef(() => {});
  const syncSidebarWidth  = useCallback(() => {
    runGuest("window.__ibxSidebarW=0");
  }, [runGuest]);
  useEffect(() => { syncSbWidthRef.current = syncSidebarWidth; }, [syncSidebarWidth]);
  useEffect(() => { syncSidebarWidth(); }, [editMode, editSidebarOpen, syncSidebarWidth]);

  const isSavableUrl = useCallback((u) => {
    try {
      const s = String(u || "");
      return s.startsWith("ibx-file://") || s.startsWith("file://");
    } catch { return false; }
  }, []);

  // ── Live-edit undo stack (is panel se applied edits; cap 20) ─────────
  const undoStackRef = useRef([]);
  const [undoCount, setUndoCount] = useState(0);
  const pushUndo = useCallback((entry) => {
    try {
      undoStackRef.current.push(entry);
      if (undoStackRef.current.length > 20) undoStackRef.current.shift();
      setUndoCount(undoStackRef.current.length);
    } catch {}
  }, []);
  const undoLiveEdit = useCallback(async () => {
    const top = undoStackRef.current[undoStackRef.current.length - 1];
    if (!top) { showToast("Nothing to undo", "info"); return false; }
    try {
      const res = await window.electronAPI.liveEditRevert({
        filePath: top.filePath,
        appliedText: top.appliedText,
        originalText: top.originalText,
      });
      if (res?.ok) {
        undoStackRef.current.pop();
        setUndoCount(undoStackRef.current.length);
        showToast(`Undone — ${top.rel}`, "success");
        return true;
      } else {
        showToast(`Undo failed: ${res?.error || "unknown"}`, "error");
        return false;
      }
    } catch { showToast("Undo failed", "error"); return false; }
  }, [showToast]);

  const handleLiveEdit = useCallback(async (data) => {
    const rawMode = String(data?.mode || "");
    const mode = rawMode === "html" || rawMode === "undo" || rawMode === "notice" ? rawMode : "text";
    // ── Guest se chhoti notice (sidebar tool bina target ke, wagairah) ──
    if (mode === "notice") {
      showToast(String(data?.msg || "Nothing selected").slice(0, 160), "info");
      return;
    }
    // ── Ctrl+Z (guest): last saved edit revert karo — file + DOM dono ──
    if (mode === "undo") {
      const ok = await undoLiveEdit();
      if (ok) {
        try { await webviewRef.current?.executeJavaScript('window.__ibxUndoLastVisual && window.__ibxUndoLastVisual()'); } catch {}
      }
      return;
    }
    // ── Validate per mode ──
    let oldText = "", newText = "", oldHtml = "", newHtml = "";
    if (mode === "html") {
      oldHtml = String(data?.oldHtml || "");
      newHtml = String(data?.newHtml || "");
      if (!oldHtml.trim() || !newHtml.trim() || oldHtml === newHtml) { await revertActiveInGuest(); showToast("No change — reverted", "info"); return; }
      if (newHtml.length > 20000) { await revertActiveInGuest(); showToast("Element too large — reverted", "error"); return; }
    } else {
      oldText = String(data?.oldText || "").trim();
      newText = String(data?.newText || "").trim();
      if (!oldText || !newText || oldText === newText) { await revertActiveInGuest(); showToast("No change — reverted", "info"); return; }
      if (!newText) { await revertActiveInGuest(); showToast("Empty text not allowed — reverted", "error"); return; }
      if (newText.length > 2000) { await revertActiveInGuest(); showToast("Text too long (2000 max) — reverted", "error"); return; }
    }
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
      const res = mode === "html"
        ? await window.electronAPI.liveEditApplyHtml({
            projectRoot,
            url,
            oldHtml,
            newHtml,
            tagName: String(data?.tagName || ""),
          })
        : await window.electronAPI.liveEditApply({
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
        // Undo ke liye exact strings (main `replaced` bhejta hai — whitespace-safe).
        try {
          const applied = mode === "html" ? String(newHtml).trim() : newText;
          const original = (typeof res.replaced === "string" && res.replaced) ? res.replaced : (mode === "html" ? String(oldHtml).trim() : oldText);
          if (applied && original && applied !== original) {
            pushUndo({ filePath: res.filePath, rel, appliedText: applied, originalText: original });
          }
        } catch {}
        try { window.dispatchEvent(new CustomEvent("liveEdit:applied", { detail: { filePath: res.filePath, oldText: mode === "html" ? oldHtml.slice(0, 120) : oldText, newText: mode === "html" ? newHtml.slice(0, 120) : newText, rel } })); } catch {}
        // NOTE: webview reload NAHI — guest DOM pehle se updated hai (wahi
        // mutation save hui hai). Reload karne se tree selection/highlight/
        // drag state wipe ho jata tha aur har button click "selection lost"
        // jaisa lagta tha.
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
  }, [displayUrl, showToast, revertActiveInGuest, isSavableUrl, undoLiveEdit]);

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
  const isFile   = protocol === "file:" || protocol === "ibx-file:";
  const iconPath  = isFile ? LOCAL_ICON : isLocal ? LOCAL_ICON : (isHttps ? LOCK_ICON : UNLOCK_ICON);
  const iconColor = isFile ? "var(--teal)" : isLocal ? "var(--icon)" : (isHttps ? "var(--teal)" : "var(--warning)");

  // Error-card button style (inline — toolbars/empty states don't apply here)
  const errBtnStyle = {
    display: "flex", alignItems: "center", gap: 6, minHeight: 28, padding: "6px 14px",
    border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
    background: "var(--bg-surface)", color: "var(--text-hover)", fontSize: "var(--fs-small)",
    fontWeight: "var(--fw-semibold)", cursor: "pointer", fontFamily: "inherit", transition: "background var(--t-normal)",
  };

  // ── Navigation ──────────────────────────────────────────────────────────────
  const goToUrl = useCallback((u) => {
    let fixed = u.trim();
    if (!fixed) return;
    if (/^https?:\/\//i.test(fixed) || fixed.startsWith("ibx-file://") || fixed.startsWith("file://") || fixed.startsWith("view-source:")) {
      // already has scheme
    } else if (fixed.startsWith("localhost") || fixed.startsWith("127.0.0.1") || /^\d+\.\d+\.\d+\.\d+/.test(fixed)) {
      fixed = "http://" + fixed;
    } else if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(:\d+)?(\/.*)?$/.test(fixed) || /^[^\s]+\.[^\s]+/.test(fixed)) {
      fixed = "https://" + fixed;
    } else {
      fixed = "https://www.google.com/search?q=" + encodeURIComponent(fixed);
    }
    setNavUrl(fixed); setInputValue(fixed); setDisplayUrl(fixed); setLockOpen(false);
    setLoadError(null); setCrashed(false);
    httpsFallbackAttemptedRef.current = false;
    if (webviewRef.current) {
      try { const p = webviewRef.current.loadURL(fixed); if (p && p.catch) p.catch(() => {}); } catch {}
    }
  }, []);

  goToUrlRef.current = goToUrl;

  const handleReload = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const cur = wv.getURL?.() || "";
    if ((cur.startsWith("data:text/html") || loadError) && errorUrlRef.current) {
      goToUrl(errorUrlRef.current);
    } else {
      try { wv.reload(); } catch {}
    }
  }, [goToUrl, loadError]);
  handleReloadRef.current = handleReload;

  const handleHardReload = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const cur = wv.getURL?.() || "";
    if ((cur.startsWith("data:text/html") || loadError) && errorUrlRef.current) {
      goToUrl(errorUrlRef.current);
    } else {
      try {
        if (wv.reloadIgnoringCache) wv.reloadIgnoringCache();
        else wv.reload();
      } catch {
        try { wv.reload(); } catch {}
      }
    }
  }, [goToUrl, loadError]);

  const handleRecoverFromCrash = useCallback(() => {
    setCrashed(false);
    const target = errorUrlRef.current || displayUrl || navUrl;
    if (target) {
      goToUrl(target);
    }
  }, [goToUrl, displayUrl, navUrl]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") {
      goToUrl(inputValue);
    } else if (e.key === "Escape") {
      setInputValue(displayUrl);
      inputRef.current?.blur();
    }
  }, [inputValue, displayUrl, goToUrl]);

  // ── Webview event listeners ──────────────────────────────────────────────────
  const attachListenersRef = useRef(null);
  attachListenersRef.current = (wv) => {
    if (attachedRef.current) return;
    attachedRef.current = true;

    wv.addEventListener("did-start-loading", () => {
      setIsLoading(true);
      setCrashed(false);
    });

    wv.addEventListener("did-stop-loading", () => {
      setIsLoading(false);
      try { setCanGoBack(wv.canGoBack()); setCanGoForward(wv.canGoForward()); } catch {}
    });

    wv.addEventListener("did-finish-load", () => {
      setIsLoading(false);
      const cur = wv.getURL() || "";
      if (!cur.startsWith("data:text/html")) {
        setLoadError(null);
        setCrashed(false);
      }
      try { setCanGoBack(wv.canGoBack()); setCanGoForward(wv.canGoForward()); } catch {}
    });

    wv.addEventListener("did-fail-load", (e) => {
      setIsLoading(false);
      // Sub-frame failure → page ka content quietly ignore
      if (!e.isMainFrame) return;
      // -3 = ERR_ABORTED (navigation cancelled / user stopped) — ignore silently
      if (e.errorCode === -3) return;

      const validatedUrl = wv.getURL() || navUrl;

      // Smart fallback: https://localhost -> http://localhost (try once)
      if (!httpsFallbackAttemptedRef.current && (validatedUrl.startsWith("https://localhost") || validatedUrl.startsWith("https://127.0.0.1"))) {
        httpsFallbackAttemptedRef.current = true;
        const httpUrl = validatedUrl.replace("https://", "http://");
        try { const p = wv.loadURL(httpUrl); if (p && p.catch) p.catch(() => {}); } catch {}
        return;
      }

      // Real load failure → rich custom error page in webview
      errorUrlRef.current = validatedUrl;
      errorCodeRef.current = e.errorCode;
      errorDescRef.current = e.errorDescription || "";
      setLoadError({ code: e.errorCode, description: e.errorDescription, url: validatedUrl });
      setCrashed(false);

      const errInfo = getErrorInfo(e.errorCode, validatedUrl);
      // Update FlexLayout tab title
      try {
        const m = window.__flexModel?.current;
        const nid = nodeIdRef.current;
        if (m && nid) {
          const tabNode = m.getNodeById(nid);
          if (tabNode) {
            m.doAction(Actions.updateNodeAttributes(nid, {
              config: { ...(tabNode.getConfig() || {}), title: errInfo.title },
              name: errInfo.title,
            }));
          }
        }
      } catch {}

      const errHtml = buildErrorHtml(errInfo);
      try {
        const p = wv.loadURL("data:text/html;charset=UTF-8," + encodeURIComponent(errHtml));
        if (p && p.catch) p.catch(() => {});
      } catch {}
      setIsLoading(false);
    });

    // Renderer crash / process gone / OOM
    const showCrash = () => {
      setIsLoading(false);
      setLoadError(null);
      setCrashed(true);
      try { closeFindRef.current?.(); } catch {}
      try {
        const m = window.__flexModel?.current;
        const nid = nodeIdRef.current;
        if (m && nid) {
          const tabNode = m.getNodeById(nid);
          if (tabNode) {
            m.doAction(Actions.updateNodeAttributes(nid, {
              config: { ...(tabNode.getConfig() || {}), title: "Aw, Snap! Page crashed" },
              name: "Aw, Snap!",
            }));
          }
        }
      } catch {}
    };

    wv.addEventListener("did-crash", showCrash);
    wv.addEventListener("render-process-gone", (e) => {
      if (e?.details?.reason === "clean-exit") return;
      showCrash();
    });
    wv.addEventListener("plugin-crashed", showCrash);

    // Find matches → count badge (request se nahi, event se aata hai)
    wv.addEventListener("found-in-page", (e) => {
      try {
        const r = e.result || {};
        if (typeof r.activeMatchOrdinal === "number") setFindActive(r.activeMatchOrdinal);
        if (typeof r.matches === "number") setFindMatches(r.matches);
      } catch {}
    });

    wv.addEventListener("did-navigate", () => {
      try { closeFindRef.current?.(); } catch {}
      const cur = wv.getURL();
      if (cur && !cur.startsWith("data:text/html")) {
        setInputValue(cur);
        setDisplayUrl(cur);
        setLoadError(null);
        setCrashed(false);
        errorUrlRef.current = null;
        httpsFallbackAttemptedRef.current = false;
      }
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
      if (cur && !cur.startsWith("data:text/html")) {
        setInputValue(cur);
        setDisplayUrl(cur);
        setLoadError(null);
        setCrashed(false);
        errorUrlRef.current = null;
      }
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
    // ── Live Edit helper (guest script — see ./editHelper.js) ──
    const EDIT_HELPER_SCRIPT = EDIT_HELPER_SOURCE;
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
              setTimeout(()=> {
                try{ wv.executeJavaScript('window.__ibxSetEditMode && window.__ibxSetEditMode(true)'); }catch{}
                // Navigation = naya guest window → sidebar width var gayab
                try{ syncSbWidthRef.current && syncSbWidthRef.current(); }catch{}
              }, 120);
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
      // Guest payloads base64 me aate hain (document.title whitespace collapse
      // karta hai — plain JSON me "a  b"/tabs/newlines toot jate). Legacy
      // plain-JSON markers bhi padhe jate hain (purana injected script ho to).
      if (t.startsWith("__IBX_EDIT__B64__")) {
        try {
          const now = Date.now();
          if (editTitleRef.current && editTitleRef.current.t === t && now - editTitleRef.current.at < 5000) return;
          editTitleRef.current = { t, at: now };
          const json = decodeB64(t.slice("__IBX_EDIT__B64__".length));
          if (json) handleLiveEdit(JSON.parse(json));
        } catch {}
        return;
      }
      if (t.startsWith("__IBX_EDIT__")) {
        try {
          const payload = JSON.parse(t.slice("__IBX_EDIT__".length));
          handleLiveEdit(payload);
        } catch {}
        return;
      }
      // Hover locate ping: `__IBX_LOCATE64__<id> <b64>` → file guess badge.
      // Host kabhi block nahi hota (async), stale replies guest khud ignore karta hai.
      const handleLocatePayload = (id, payload) => {
        if (!Number.isFinite(id) || !payload || !payload.t) return;
        (async () => {
          try {
            const projectRoot = window.__currentProjectPath || null;
            const url = webviewRef.current?.getURL?.() || "";
            const res = await window.electronAPI.liveEditLocate({
              projectRoot, url,
              oldText: String(payload.t || ""),
              outerSnippet: String(payload.h || ""),
              tagName: String(payload.tag || ""),
            });
            const label = res?.ok && res.filePath
              ? (res.rel + (res.candidates > 1 ? ` (+${res.candidates - 1})` : ""))
              : "";
            try { await webviewRef.current?.executeJavaScript(`window.__ibxHintResult && window.__ibxHintResult(${id}, ${JSON.stringify(label)})`); } catch {}
          } catch {}
        })();
      };
      if (t.startsWith("__IBX_LOCATE64__")) {
        try {
          const rest = t.slice("__IBX_LOCATE64__".length);
          const sp = rest.indexOf(" ");
          const id = parseInt(rest.slice(0, sp), 10);
          const json = decodeB64(rest.slice(sp + 1));
          if (json) handleLocatePayload(id, JSON.parse(json));
        } catch {}
        return;
      }
      if (t.startsWith("__IBX_LOCATE__")) {
        try {
          const rest = t.slice("__IBX_LOCATE__".length);
          const sp = rest.indexOf(" ");
          const id = parseInt(rest.slice(0, sp), 10);
          handleLocatePayload(id, JSON.parse(rest.slice(sp + 1)));
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
      if (t.startsWith("__IBX_ERR__r")) {
        const target = errorUrlRef.current || displayUrl || navUrl;
        if (target) goToUrlRef.current(target);
        return;
      }
      if (t.startsWith("__IBX_ERR__ext:")) {
        const extUrl = decodeURIComponent(t.slice("__IBX_ERR__ext:".length));
        if (extUrl) {
          try {
            if (window.electronAPI?.openExternal) window.electronAPI.openExternal(extUrl);
            else window.open(extUrl, "_blank");
          } catch {
            try { window.open(extUrl, "_blank"); } catch {}
          }
        }
        return;
      }
      if (t.startsWith("__IBX_COPY__")) {
        const text = decodeURIComponent(t.slice("__IBX_COPY__".length));
        if (text) {
          try {
            if (window.electronAPI?.clipboardWrite) window.electronAPI.clipboardWrite(text);
            showToast("Diagnostics copied to clipboard", "success");
          } catch {}
        }
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
    if (editMode) showToast("Edit mode ON — " + EDIT_HINTS, "info");
    else if (attachedRef.current) showToast("Edit mode OFF", "info");
  }, [editMode, showToast]);

  // Edit mode on → sidebar khul jaye; poll taaki style panel ka state sahi rahe
  useEffect(() => {
    if (editMode) setEditSidebarOpen(true);
  }, [editMode]);
  useEffect(() => {
    if (!editMode || !editSidebarOpen) return;
    refreshStyleState();
    refreshTree();
    refreshProps();
    const iv = setInterval(() => {
      refreshStyleState();
      refreshProps();
      // Tree tabhi refresh karo jab DnD chal na raha ho (warna row hat
      // jaati aur drop target stale ho jata)
      if (!treeDragRef.current) refreshTree();
    }, 800);
    return () => clearInterval(iv);
  }, [editMode, editSidebarOpen, refreshStyleState, refreshTree, refreshProps]);

  // Edit mode off → saara v7 panel state reset (guest khud clear karta hai)
  useEffect(() => {
    if (editMode) return;
    setTreeData({ on: false, nodes: [] });
    setTreeSel(0);
    setTreeRow(null);
    setTreeExpanded({});
    setPropState({ active: false });
    setPropLoc(null);
    treeDragRef.current = 0;
  }, [editMode]);

  // Edit mode on → project ke design tokens load
  useEffect(() => { if (editMode) loadTokens(); }, [editMode, hasProject, loadTokens]);

  // Tree auto-expand: top 2 levels hamesha + target path (page se click
  // kiya ho to us row tak khul jaye)
  useEffect(() => {
    if (!treeData || !treeData.on) return;
    setTreeExpanded((prev) => {
      const next = { ...prev };
      let changed = false;
      const walkInit = (n, d) => {
        try {
          if (!n) return;
          if (d < 2 && n.k && n.k.length && !next[n.i]) { next[n.i] = true; changed = true; }
          if (n.k) for (let i = 0; i < n.k.length; i++) walkInit(n.k[i], d + 1);
        } catch {}
      };
      const nodes = treeData.nodes || [];
      for (let i = 0; i < nodes.length; i++) walkInit(nodes[i], 0);
      const path = treeData.tgtPath || [];
      for (let i = 0; i < path.length - 1; i++) {
        if (!next[path[i]]) { next[path[i]] = true; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [treeData]);

  // Properties → source file guess (hover badge wali hi liveEditLocate call).
  // Deps primitives hain — poll me same element par same values → no re-run.
  useEffect(() => {
    if (!propState.active || !propState.text) { setPropLoc(null); return; }
    let dead = false;
    (async () => {
      try {
        const res = await window.electronAPI.liveEditLocate({
          projectRoot: window.__currentProjectPath || null,
          url: webviewRef.current?.getURL?.() || "",
          oldText: String(propState.text || ""),
          outerSnippet: String(propState.outer || ""),
          tagName: String(propState.tag || ""),
        });
        if (!dead) setPropLoc(res && res.ok ? res : null);
      } catch { if (!dead) setPropLoc(null); }
    })();
    return () => { dead = true; };
  }, [propState.active, propState.text, propState.outer, propState.tag]);

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
      // F5 or Ctrl+R → reload (or retry failed URL if error page)
      if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "r")) {
        e.preventDefault();
        handleReload();
        return;
      }
      // Ctrl+Shift+R / Ctrl+F5 → hard reload
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "r") || (e.ctrlKey && e.key === "F5")) {
        e.preventDefault();
        handleHardReload();
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
  }, [isLoading, setZoomExact, handleReload, handleHardReload]);

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

  // Done: pending edit save karke edit mode band (Cancel ka opposite)
  const handleDoneEditMode = useCallback(async () => {
    try { await webviewRef.current?.executeJavaScript('window.__ibxCommitPendingEdit && window.__ibxCommitPendingEdit()'); } catch {}
    // Give page-title-updated a beat to deliver the payload before helpers detach
    setTimeout(()=> setEditMode(false), 350);
  }, []);

  const handleToggleEditMode = useCallback(async () => {
    if (editMode) {
      await handleDoneEditMode();
    } else {
      setEditMode(true);
    }
    setMoreOpen(false);
  }, [editMode, handleDoneEditMode]);

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

  // ── Guest shortcuts (main forwards webview keys via IPC) ─────────────
  // wcId match → sirf usi tab me chalo (baki tabs ignore). Fallback:
  // focused guest ka activeElement webview element hota hai.
  useEffect(() => {
    const unsub = window.electronAPI?.onBrowserShortcut?.((payload) => {
      const { action, wcId } = payload || {};
      if (!action) return;
      let mine = false;
      try {
        const wv = webviewRef.current;
        if (wv && typeof wcId === "number" && typeof wv.getWebContentsId === "function") {
          try { mine = wv.getWebContentsId() === wcId; } catch {}
        } else if (wv && document.activeElement) {
          mine = document.activeElement === wv;
        }
      } catch {}
      if (mine) runBrowserAction(action);
    });
    return () => { try { unsub?.(); } catch {} };
  }, [runBrowserAction]);

  // ── Host shortcuts (address bar / panel chrome me focus ho tab) ───────
  // Guest page ke keys host tak aate hi nahi (wo IPC path se aate hain), aur
  // dusre panels apne shortcuts khud handle karte hain — target check se clash nahi.
  // Zoom keys yahan NAHI (View menu accelerators + page content-zoom se double-step).
  useEffect(() => {
    const inPanel = (e) => {
      try {
        const root = viewWrapRef.current?.closest?.(".browser");
        return !!(root && e.target instanceof Node && root.contains(e.target));
      } catch { return false; }
    };
    const onKey = (e) => {
      if (!inPanel(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = String(e.key || "").toLowerCase();
      let action = null;
      if (key === "f5" && !mod && !e.shiftKey && !e.altKey) action = "reload";
      else if (mod && !e.shiftKey && !e.altKey) {
        if (key === "r") action = "reload";
        else if (key === "f") action = "find";
        else if (key === "l") action = "focusUrl";
        else if (key === "t") action = "newTab";
      } else if (!mod && !e.shiftKey && e.altKey) {
        if (key === "arrowleft") action = "back";
        else if (key === "arrowright") action = "forward";
      }
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      runBrowserAction(action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [runBrowserAction]);

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
    const refreshHandler = (e) => {
      if (e.detail?.nodeId === nodeId) webviewRef.current?.reload();
    };
    window.addEventListener("browser:tabContextMenu", handler);
    window.addEventListener("browser:refresh", refreshHandler);
    return () => {
      window.removeEventListener("browser:tabContextMenu", handler);
      window.removeEventListener("browser:refresh", refreshHandler);
    };
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
            onClick={() => webviewRef.current?.goBack()} title="Back (Alt+Left)">
            <ChevronLeft size={14} />
          </button>
          <button className="browser__btn" disabled={!canGoForward}
            onClick={() => webviewRef.current?.goForward()} title="Forward (Alt+Right)">
            <ChevronRight size={14} />
          </button>
          <button
            className="browser__btn"
            onClick={isLoading ? () => { try { webviewRef.current?.stop(); } catch {} } : handleReload}
            title={isLoading ? "Stop loading (Esc)" : "Refresh (Ctrl+R)"}
          >
            {isLoading ? <X size={14} /> : <RefreshCw size={14} />}
          </button>
          {/* URL bar */}
          <div className={`browser__url-wrap${focused ? " browser__url-wrap--focused" : ""}`}>
            {isLoading && <div className="browser__spinner" />}
            <span ref={lockRef} className="browser__lock" onClick={handleLockClick} style={{ color: iconColor, display: "flex", alignItems: "center", cursor: "pointer" }} title={isFile ? "Local file" : isLocal ? "Local address" : isHttps ? "Secure connection" : "Not secure"}>
              {isFile ? <FileCode size={14} /> : isLocal ? <Globe size={14} /> : isHttps ? <Lock size={14} /> : <Unlock size={14} />}
            </span>
            <input
              ref={inputRef}
              className="browser__url"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              onFocus={(e) => {
                setFocused(true);
                try { e.target.select(); } catch {}
              }}
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
                <button className="browser__more-item" onClick={handleToggleEditMode} title={editMode ? "Done — save pending edit & exit" : "Edit Mode — click text to edit · Ctrl+E raw HTML · Ctrl+Z undo · Alt+↑/↓ move"}>
                  <span className="browser__more-icon" style={editMode ? { color: "var(--teal)" } : undefined}>
                    {editMode ? <PencilOff size={14} /> : <Pencil size={14} />}
                  </span>
                  <span className="browser__more-label">{editMode ? "Done — exit edit mode" : "Edit mode"}</span>
                  {editMode && <span className="browser__more-badge">ON</span>}
                </button>
                {editMode && (
                  <button
                    className="browser__more-item"
                    onClick={() => { setEditSidebarOpen((v) => !v); setMoreOpen(false); }}
                    title="Show/hide the edit sidebar (all edit controls)"
                  >
                    <span className="browser__more-icon">
                      {editSidebarOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                    </span>
                    <span className="browser__more-label">{editSidebarOpen ? "Hide edit sidebar" : "Show edit sidebar"}</span>
                  </button>
                )}
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
                <button className="browser__more-item" onClick={() => { setMoreOpen(false); runBrowserAction("newTab"); }} title="New browser tab (Ctrl+T)">
                  <span className="browser__more-icon"><span style={{ fontSize: 14, fontWeight: "bold" }}>+</span></span>
                  <span className="browser__more-label">New tab</span>
                  <span className="browser__more-hint">Ctrl+T</span>
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

      {/* Row: webview (flex:1) + docked edit sidebar (fixed width) */}
      <div className="browser__main">
      {/* Webview — hamesha SAME element (no remount, no reload) */}
      <div
        ref={viewWrapRef}
        className="browser__view-wrap"
      >
        {isLoading && <div className="browser__progress-bar" />}
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
        {crashed && (
          <div className="browser__crash-overlay">
            <div className="browser__crash-icon">
              <Unplug size={32} />
            </div>
            <div className="browser__crash-title">Aw, Snap!</div>
            <div className="browser__crash-desc">
              Something went wrong while displaying this webpage. The renderer process terminated unexpectedly.
            </div>
            <div className="browser__crash-actions">
              <button
                style={errBtnStyle}
                onClick={handleRecoverFromCrash}
              >
                <RefreshCw size={14} /> Reload Tab
              </button>
              <button
                style={{ ...errBtnStyle, background: "transparent", borderColor: "var(--border)" }}
                onClick={() => goToUrl("https://www.google.com")}
              >
                Open New Page
              </button>
            </div>
          </div>
        )}
        {/* Find in page bar */}
        {findOpen && (
          <div
            className="browser__findbar"
            style={{
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
          <div
            className={`browser__edit-pill${isVisualOnlyUrl ? " browser__edit-pill--warn" : ""}`}
            title={isVisualOnlyUrl ? "VISUAL ONLY — " + EDIT_HINTS : EDIT_HINTS}
          >
            <Pencil size={12} />
            {isVisualOnlyUrl ? "EDIT MODE — VISUAL" : "EDIT MODE ON"}
            <span className="browser__edit-pill-hints">· Ctrl+E HTML · Ctrl+Z undo · Del removes · Ctrl+D duplicates</span>
          </div>
        )}
        {/* Sidebar collapsed → floating open button */}
        {editMode && !editSidebarOpen && (
          <button
            className="browser__edit-open"
            style={{ right: findOpen ? 384 : 12 }}
            onClick={() => setEditSidebarOpen(true)}
            title="Show edit sidebar (all edit controls)"
          >
            <Pencil size={12} /> Edit panel
          </button>
        )}
        {/* Toast */}
        {toast && (
          <div className="browser__toast" style={{
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
      </div>{/* /.browser__view-wrap */}

        {/* ── Edit sidebar — docked panel, edit mode ke saare controls ── */}
        {editMode && editSidebarOpen && (
          <aside ref={editSidebarRef} className={`browser__edit-sidebar${isVisualOnlyUrl ? " browser__edit-sidebar--warn" : ""}`}>
            <div className="eb-head">
              <span className="eb-head-title"><Pencil size={12} /> EDIT MODE</span>
              <span className={`eb-chip${isVisualOnlyUrl ? " eb-chip--warn" : ""}`}>{isVisualOnlyUrl ? "VISUAL" : "LIVE"}</span>
              <button className="eb-iconbtn" onClick={() => setEditSidebarOpen(false)} title="Collapse sidebar">
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="eb-actions">
              <button className="eb-btn eb-btn--primary" onClick={handleDoneEditMode} title="Save pending edit and exit edit mode">
                <Check size={13} /> Done
              </button>
              <button className="eb-btn" onClick={handleCancelEditMode} title="Cancel edit and revert the page">
                <X size={13} /> Cancel
              </button>
              <button
                className="eb-btn"
                disabled={!undoCount}
                onClick={undoLiveEdit}
                title={undoCount ? `Undo last save (${undoCount} in stack) — Ctrl+Z inside page` : "Nothing to undo — Ctrl+Z inside page"}
              >
                <Undo2 size={13} />{undoCount > 1 ? ` Undo (${undoCount})` : " Undo"}
              </button>
            </div>

            <div className="eb-body">
              <div className="eb-section">
                <div className="eb-label">Navigate</div>
                <div className="eb-grid eb-grid--3">
                  <button className="eb-tbtn" disabled={!canGoBack} onClick={() => webviewRef.current?.goBack()} title="Back (Alt+←)">
                    <ChevronLeft size={14} /><span>Back</span>
                  </button>
                  <button className="eb-tbtn" disabled={!canGoForward} onClick={() => webviewRef.current?.goForward()} title="Forward (Alt+→)">
                    <ChevronRight size={14} /><span>Fwd</span>
                  </button>
                  <button
                    className="eb-tbtn"
                    onClick={isLoading ? () => { try { webviewRef.current?.stop(); } catch {} } : handleReload}
                    title={isLoading ? "Stop loading (Esc)" : "Reload (Ctrl+R)"}
                  >
                    {isLoading ? <X size={14} /> : <RefreshCw size={14} />}<span>{isLoading ? "Stop" : "Reload"}</span>
                  </button>
                  <button className="eb-tbtn" onClick={openFind} title="Find in page (Ctrl+F)">
                    <Search size={14} /><span>Find</span>
                  </button>
                  <button className="eb-tbtn" onClick={handleToggleDevTools} title="Inspect element / DevTools">
                    <Info size={14} /><span>DevTools</span>
                  </button>
                  <button
                    className="eb-tbtn"
                    onClick={() => { try { inputRef.current?.focus(); inputRef.current?.select(); } catch {} }}
                    title="Edit address (Ctrl+L)"
                  >
                    <Globe size={14} /><span>Address</span>
                  </button>
                </div>
              </div>

              {/* ── DOM tree (Cursor-style elements panel) ── */}
              <div className="eb-section">
                <div className="eb-label">
                  Elements
                  <span className="eb-label-actions">
                    <button className="eb-mini" onClick={refreshTree} title="Refresh tree">
                      <RefreshCw size={11} />
                    </button>
                    <button className="eb-mini" disabled={!treeSel} onClick={clearTreeSel} title="Clear selection">
                      <X size={11} />
                    </button>
                  </span>
                </div>
                <div className="eb-hint">Click = select · drag row = reorder · hover = page me highlight</div>
                <div className="eb-tree">
                  {treeData && treeData.on && treeData.nodes.length ? (
                    treeData.nodes.map((n) => (
                      <EbTreeRow
                        key={n.i} node={n} depth={0} expanded={treeExpanded}
                        sel={treeData.tgt || treeSel} row={treeRow}
                        onToggle={toggleTree} onSel={selectTreeRow} onHover={hoverTreeRow}
                        onDropRow={dropTreeRow}
                        onDragStartRow={(id) => { treeDragRef.current = id; }}
                        onDragEndRow={() => { treeDragRef.current = 0; setTreeRow(null); }}
                        setRow={setTreeRow}
                      />
                    ))
                  ) : (
                    <div className="eb-hint">Page load hone do…</div>
                  )}
                  {treeData && treeData.trunc && <div className="eb-hint">… truncated (bade page ka hissa)</div>}
                </div>
              </div>

              <div className="eb-section">
                <div className="eb-label">Element tools</div>
                <div className="eb-hint">Target: the element you last pointed at</div>
                <div className="eb-grid eb-grid--3">
                  <button className="eb-tbtn" onClick={() => guestTool("edit")} title="Edit text of the target element">
                    <Pencil size={14} /><span>Edit</span>
                  </button>
                  <button className="eb-tbtn" onClick={() => guestTool("delete")} title="Remove element (Del)">
                    <Trash2 size={14} /><span>Delete</span>
                  </button>
                  <button className="eb-tbtn" onClick={() => guestTool("duplicate")} title="Duplicate element (Ctrl+D)">
                    <Copy size={14} /><span>Duplicate</span>
                  </button>
                  <button className="eb-tbtn" onClick={() => guestTool("link")} title="Wrap target as link (Ctrl+K)">
                    <Link2 size={14} /><span>Link</span>
                  </button>
                  <button className="eb-tbtn" onClick={() => guestTool("html")} title="Edit element as raw HTML (Ctrl+E)">
                    <Code size={14} /><span>HTML</span>
                  </button>
                  <button className="eb-tbtn" onClick={() => guestTool("inspect")} title="Inspect element details (Shift+click)">
                    <Info size={14} /><span>Details</span>
                  </button>
                  <button className="eb-tbtn" onClick={() => guestTool("moveUp")} title="Move element up (Alt+↑)">
                    <ArrowUp size={14} /><span>Move ↑</span>
                  </button>
                  <button className="eb-tbtn" onClick={() => guestTool("moveDown")} title="Move element down (Alt+↓)">
                    <ArrowDown size={14} /><span>Move ↓</span>
                  </button>
                  <button
                    className={`eb-tbtn${editStyle.drag ? " eb-tbtn--on" : ""}`}
                    onClick={() => { guestTool("dragToggle"); setTimeout(refreshStyleState, 150); }}
                    title="Drag-to-reorder mode — drag elements in the page onto each other"
                  >
                    <GripVertical size={14} /><span>Drag</span>
                  </button>
                </div>
              </div>

              <div className="eb-section">
                <div className="eb-label">Style {editStyle.active && editStyle.tag ? `· <${editStyle.tag}>` : ""}</div>
                {!editStyle.active && <div className="eb-hint">Click text in the page to style it</div>}
                <div className="eb-grid eb-grid--4">
                  <button className={`eb-tbtn${editStyle.bold ? " eb-tbtn--on" : ""}`} disabled={!editStyle.active} onClick={() => guestStyle("bold")} title="Bold"><b>B</b></button>
                  <button className={`eb-tbtn${editStyle.italic ? " eb-tbtn--on" : ""}`} disabled={!editStyle.active} onClick={() => guestStyle("italic")} title="Italic"><i>I</i></button>
                  <button className={`eb-tbtn${editStyle.underline ? " eb-tbtn--on" : ""}`} disabled={!editStyle.active} onClick={() => guestStyle("underline")} title="Underline"><span style={{ textDecoration: "underline" }}>U</span></button>
                  <button className={`eb-tbtn${editStyle.strike ? " eb-tbtn--on" : ""}`} disabled={!editStyle.active} onClick={() => guestStyle("strike")} title="Strikethrough"><span style={{ textDecoration: "line-through" }}>S</span></button>
                  <button className="eb-tbtn" disabled={!editStyle.active} onClick={() => guestStyle("size+")} title="Bigger text (+2px)">A+</button>
                  <button className="eb-tbtn" disabled={!editStyle.active} onClick={() => guestStyle("size-")} title="Smaller text (−2px)">A−</button>
                  <button className="eb-tbtn" disabled={!editStyle.active} onClick={() => guestStyle("align")} title={`Text align — now: ${editStyle.align || "left"}`}>{ALIGN_ABBR[editStyle.align] || "L"}</button>
                  <button className="eb-tbtn" disabled={!editStyle.active} onClick={() => guestStyle("tt")} title={`Text transform — now: ${editStyle.tt || "none"}`}>{TT_ABBR[editStyle.tt] || "TT"}</button>
                  <input className="eb-color" type="color" title="Text color" disabled={!editStyle.active} value={editStyle.color || "#000000"} onChange={(e) => guestStyle("color", e.target.value)} />
                  <input className="eb-color" type="color" title="Background color" disabled={!editStyle.active} value={editStyle.bg || "#ffffff"} onChange={(e) => guestStyle("bg", e.target.value)} />
                  <button className="eb-tbtn" disabled={!editStyle.active} onClick={() => guestStyle("clear")} title="Clear inline styles">✕</button>
                </div>
              </div>

              {/* TODO(React component props panel — phase 2): neeche "Component"
                  section hoga. Flow: guest se target outerHTML + hover-locate
                  payload (`__IBX_LOCATE64__`) → host `liveEditLocate` se source
                  file → JSX/TSX parse karke component ke props/defaults →
                  sidebar me props/variant list (bool/enum/number) → edit par
                  file write (`liveEdit:applyTextChange`) → `component:sourceChanged`
                  se preview reload. Mapping approximate (tag+class+text
                  fingerprint) — exact React fiber mapping kabhi nahi. */}
              <div className="eb-section">
                <div className="eb-label">Visual controls</div>
                {!editStyle.active && (
                  <div className="eb-hint">Point at an element in the page, then click it</div>
                )}

                <div className="eb-sub">Layout</div>
                <div className="eb-grid eb-grid--4">
                  <button
                    className={`eb-tbtn${editStyle.disp === "flex" && (editStyle.dir || "").indexOf("row") === 0 ? " eb-tbtn--on" : ""}`}
                    disabled={!editStyle.active} onClick={() => guestStyle("dir", "row")}
                    title="display: flex — row"
                  ><span>Row</span></button>
                  <button
                    className={`eb-tbtn${editStyle.disp === "flex" && (editStyle.dir || "").indexOf("column") === 0 ? " eb-tbtn--on" : ""}`}
                    disabled={!editStyle.active} onClick={() => guestStyle("dir", "col")}
                    title="display: flex — column"
                  ><span>Col</span></button>
                  <button
                    className={`eb-tbtn${editStyle.disp === "grid" ? " eb-tbtn--on" : ""}`}
                    disabled={!editStyle.active} onClick={() => guestStyle("grid")}
                    title="display: grid (dobara click = remove)"
                  ><span>Grid</span></button>
                  <button
                    className={`eb-tbtn${editStyle.disp && editStyle.disp !== "flex" && editStyle.disp !== "grid" ? " eb-tbtn--on" : ""}`}
                    disabled={!editStyle.active} onClick={() => guestStyle("dir", "off")}
                    title="Remove display override"
                  ><span>Off</span></button>
                </div>
                {editStyle.disp === "grid" && (
                  <>
                    <EbTextRow label="Cols" value={editStyle.gcols || ""} placeholder="3 ya repeat(3, 1fr)"
                      onCommit={(v) => guestStyle("gcols", v)} />
                    <EbTextRow label="Rows" value={editStyle.grows || ""} placeholder="auto"
                      onCommit={(v) => guestStyle("grows", v)} />
                  </>
                )}
                <div className="eb-srow">
                  <span>Justify</span>
                  <select className="eb-select" value={editStyle.jc || ""} disabled={!editStyle.active}
                    onChange={(e) => guestStyle("jc", e.target.value)}>
                    {JC_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </div>
                <div className="eb-srow">
                  <span>Align</span>
                  <select className="eb-select" value={editStyle.ai || ""} disabled={!editStyle.active}
                    onChange={(e) => guestStyle("ai", e.target.value)}>
                    {AI_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </div>
                <div className="eb-srow">
                  <span>Wrap</span>
                  <select className="eb-select" value={editStyle.wrap || ""} disabled={!editStyle.active}
                    onChange={(e) => guestStyle("wrap", e.target.value)}
                    title="flex-wrap — items ko next line me wrap karo">
                    <option value="">auto</option>
                    <option value="nowrap">nowrap</option>
                    <option value="wrap">wrap</option>
                  </select>
                </div>
                <EbSlider label="Gap" val={editStyle.gap ?? 0} min={0} max={96} unit="px"
                  disabled={!editStyle.active} onChange={(v) => guestStyle("gap", v)} />

                <div className="eb-sub">Type</div>
                <EbSlider label="Size" val={editStyle.fs ?? 16} min={8} max={96} unit="px"
                  disabled={!editStyle.active} onChange={(v) => guestStyle("fs", v)} />
                <EbSlider label="Line-h" val={Math.round((editStyle.lh ?? 1.2) * 100)} min={50} max={300} step={5}
                  display={(editStyle.lh ?? 1.2).toFixed(1)}
                  disabled={!editStyle.active} onChange={(v) => guestStyle("lh", String(Number(v) / 100))} />
                <EbSlider label="Letter" val={editStyle.ls ?? 0} min={-5} max={20} step={0.5} unit="px"
                  disabled={!editStyle.active} onChange={(v) => guestStyle("ls", v)} />
                <div className="eb-srow">
                  <span>Weight</span>
                  <select className="eb-select"
                    value={FW_OPTS.indexOf(editStyle.fw) !== -1 ? String(editStyle.fw) : ""}
                    disabled={!editStyle.active}
                    onChange={(e) => { if (e.target.value) guestStyle("fw", e.target.value); }}>
                    <option value="">auto</option>
                    {FW_OPTS.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
                <div className="eb-srow">
                  <span>Font</span>
                  <select className="eb-select"
                    value={(function () {
                      const ff = String(editStyle.ff || "").toLowerCase();
                      if (!ff || !editStyle.active) return "";
                      const m = FF_OPTS.find(([tok]) => ff.indexOf(tok) !== -1);
                      return m ? m[0] : "";
                    })()}
                    disabled={!editStyle.active}
                    onChange={(e) => { if (e.target.value) guestStyle("ff", e.target.value); }}>
                    <option value="">auto</option>
                    {FF_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </div>

                <div className="eb-sub">Space &amp; shape</div>
                <EbSlider label="Pad" val={editStyle.pad ?? 0} min={0} max={96} unit="px"
                  disabled={!editStyle.active} onChange={(v) => guestStyle("pad", v)} />
                <EbSlider label="Margin" val={editStyle.mg ?? 0} min={0} max={96} unit="px"
                  disabled={!editStyle.active} onChange={(v) => guestStyle("mg", v)} />
                <EbSlider label="Radius" val={editStyle.rad ?? 0} min={0} max={96} unit="px"
                  disabled={!editStyle.active} onChange={(v) => guestStyle("rad", v)} />
                <EbSlider label="Opacity" val={editStyle.op ?? 100} min={0} max={100} unit="%"
                  disabled={!editStyle.active} onChange={(v) => guestStyle("op", v)} />

                <div className="eb-sub">Palette</div>
                <div className="eb-swatches">
                  {tokens.map((c) => (
                    <button key={"tok-" + c} className="eb-swatch eb-swatch--tok" style={{ background: c }}
                      disabled={!editStyle.active}
                      onClick={(e) => { if (e.altKey || e.shiftKey) guestStyle("bg", c); else guestStyle("color", c); }}
                      onContextMenu={(e) => { e.preventDefault(); removeToken(c); }}
                      title={`Project token ${c} — click: text color · Alt+click: background · right-click: remove`} />
                  ))}
                  {PALETTE.map((c) => (
                    <button key={c} className="eb-swatch" style={{ background: c }}
                      disabled={!editStyle.active}
                      onClick={(e) => { if (e.altKey || e.shiftKey) guestStyle("bg", c); else guestStyle("color", c); }}
                      title={`Text color ${c} (Alt+click = background)`} />
                  ))}
                  <button className="eb-swatch eb-swatch--add" disabled={!editStyle.active} onClick={addToken}
                    title="Current text color ko project token me save karo (+)">
                    +
                  </button>
                </div>
                {!tokens.length && (
                  <div className="eb-hint">+ se color project me save hoga (right-click se remove)</div>
                )}
              </div>

              {/* ── Properties: selected element ke attributes + source ── */}
              <div className="eb-section">
                <div className="eb-label">
                  Properties{propState.active && propState.tag ? ` · <${propState.tag}>` : ""}
                </div>
                {!propState.active && (
                  <div className="eb-hint">Page ya tree me element select karo</div>
                )}
                {propState.active && (
                  <>
                    <EbTextRow label="ID" value={propState.id || ""} placeholder="—"
                      onCommit={(v) => propSet("id", v)} />
                    <EbTextRow label="Class" value={propState.cls || ""} placeholder="—"
                      onCommit={(v) => propSet("class", v)} />
                    {(propState.attrs || [])
                      .filter((a) => a.n !== "id" && a.n !== "class")
                      .map((a) => (
                        <EbTextRow key={a.n} label={a.n} value={a.v} placeholder=""
                          onCommit={(v) => propSet(a.n, v)} />
                      ))}
                    <div className="eb-sub">Source</div>
                    {propLoc && propLoc.ok ? (
                      <div className="eb-srow">
                        <span className="eb-src" title={String(propLoc.filePath || "")}>
                          {propLoc.rel}{propLoc.candidates > 1 ? ` (+${propLoc.candidates - 1})` : ""}
                        </span>
                        <button
                          className="eb-mini"
                          title="Open in editor"
                          onClick={() => {
                            try {
                              window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: propLoc.filePath } }));
                            } catch {}
                          }}
                        >
                          <ExternalLink size={11} />
                        </button>
                      </div>
                    ) : (
                      <div className="eb-hint">
                        {propState.text ? "Source file nahi mila" : "Text wale element par source match hota hai"}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="eb-section">
                <div className="eb-label">Shortcuts</div>
                <div className="eb-keys">
                  {EDIT_SHORTCUTS.map(([k, t]) => (
                    <div className="eb-key" key={k}><kbd>{k}</kbd><span>{t}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};

export default BrowserPanel;