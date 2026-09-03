import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import * as ReactDOMPkg from "react-dom";
import * as ReactJSXRuntime from "react/jsx-runtime";
import VscodeIcon from "../shared/VscodeIcon.jsx";
import { PreviewIcon } from "../Project/window/ContentArea.jsx";

const CARD_W = 280;
const CARD_H = 200;
const CARD_GAP = 16;
const GROUP_PAD = 16;
const GROUP_HEADER = 34;
const GROUP_GAP = 30;
const NESTED_GAP = 20;
const MAX_COLS = 4;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const DOT_SIZE = 24;
const MIN_CARD_W = 180, MAX_CARD_W = 1200;
const MIN_CARD_H = 140, MAX_CARD_H = 900;
const MIN_GROUP_W = 80, MIN_GROUP_H = GROUP_HEADER + 10, MAX_GROUP = 4000;
const DRAG_MOVE_THRESHOLD = 4;
const DRAG_RESIZE_THRESHOLD = 2;

// ── Canvas settings helpers ───────────────────────────────────────────────
// Previously CanvasPage saved settings (autoLayout, showPreview, gridSnap, etc.)
// but CanvasPanel never read them — dead settings. Now wired via getCanvasOpts
// + live BroadcastChannel("canvas-settings") + IPC onSettingsUpdated fallback.
const getCanvasOpts = (settings = {}) => {
  const c = settings.canvas || {};
  return {
    autoLayout: c.autoLayout !== false && settings.canvasAutoLayout !== false,
    showPreview: c.showPreview !== false && settings.canvasShowPreview !== false,
    gridSnap: c.gridSnap === true || settings.canvasGridSnap === true,
    showMinimap: c.showMinimap !== false && settings.canvasShowMinimap !== false,
    maxCols: Number.isFinite(c.maxCols) ? c.maxCols : Number.isFinite(settings.canvasMaxCols) ? settings.canvasMaxCols : 4,
    cardWidth: Number.isFinite(c.cardWidth) ? c.cardWidth : Number.isFinite(settings.canvasCardWidth) ? settings.canvasCardWidth : 280,
    cardHeight: Number.isFinite(c.cardHeight) ? c.cardHeight : Number.isFinite(settings.canvasCardHeight) ? settings.canvasCardHeight : 200,
  };
};

const FW_LABEL = { next: "Next.js", react: "React", vue: "Vue", svelte: "Svelte", solid: "SolidJS", preact: "Preact", angular: "Angular", unknown: "" };

const KIND_META = {
  pages: { color: "#4ec9b0", label: "Page" },
  components: { color: "#569cd6", label: "Component" },
  views: { color: "#c586c0", label: "View" },
  widgets: { color: "#dcdcaa", label: "Widget" },
  features: { color: "#ce9178", label: "Feature" },
  ui: { color: "#9cdcfe", label: "UI" },
};
const DEFAULT_KIND = { color: "#888", label: "Module" };

const GROUP_HANDLES = [
  { edge: "n", pos: { left: 10, right: 10, top: -4 }, w: 0, h: 8, cursor: "ns-resize" },
  { edge: "s", pos: { left: 10, right: 10, bottom: -4 }, w: 0, h: 8, cursor: "ns-resize" },
  { edge: "e", pos: { top: 10, bottom: 10, right: -4 }, w: 8, h: 0, cursor: "ew-resize" },
  { edge: "w", pos: { top: 10, bottom: 10, left: -4 }, w: 8, h: 0, cursor: "ew-resize" },
  { edge: "ne", pos: { top: -4, right: -4 }, w: 12, h: 12, cursor: "nesw-resize" },
  { edge: "nw", pos: { top: -4, left: -4 }, w: 12, h: 12, cursor: "nwse-resize" },
  { edge: "se", pos: { bottom: -4, right: -4 }, w: 12, h: 12, cursor: "nwse-resize" },
  { edge: "sw", pos: { bottom: -4, left: -4 }, w: 12, h: 12, cursor: "nesw-resize" },
];

const kindMeta = (relPath) => {
  const parts = (relPath || "").split("/");
  const folder = parts[0] || "";
  const base = folder.replace(/s$/, "");
  return KIND_META[base] || KIND_META[parts[parts.length - 2]] || DEFAULT_KIND;
};

const countNested = (node) => {
  let n = 0;
  const walk = (g) => { n += g.children.length; g.groups.forEach(walk); };
  node.groups.forEach(walk);
  return n;
};

// ── Layout engine: folder tree → world-space rects ────────────────────────────
// Expand a group frame around a child rect, keeping the group's other edges
// fixed: only edges the child pushes past move, and only in that direction.
function expandForChild(g, cx, cy, cw, ch, pad) {
  let { x, y, w, h } = g;
  const left = cx - pad, top = cy - pad, right = cx + cw + pad, bottom = cy + ch + pad;
  if (left < x) { w += x - left; x = left; }
  if (top < y) { h += y - top; y = top; }
  if (right > x + w) w = right - x;
  if (bottom > y + h) h = bottom - y;
  return { x, y, w, h };
}

// Card chrome around the preview: 6px padding each side + 30px header.
const CARD_PAD_X = 12;
const CARD_PAD_Y = 42;

function layoutGroup(node, originX, originY, out, parentRel, naturalSizes, opts) {
  const cardW = opts?.cardWidth ?? CARD_W;
  const cardH = opts?.cardHeight ?? CARD_H;
  const maxCols = opts?.maxCols ?? MAX_COLS;
  out.parent.set(node.relPath, parentRel);
  let y = originY + GROUP_HEADER + GROUP_PAD;
  const count = node.children.length;
  const cols = count ? Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(count)))) : 1;
  let contentW = 240;
  const gridW = count ? cols * cardW + (cols - 1) * CARD_GAP : 0;
  contentW = Math.max(contentW, gridW);
  const cardSize = (c) => {
    const nat = naturalSizes?.[c.relPath];
    return nat ? { w: nat.w + CARD_PAD_X, h: nat.h + CARD_PAD_Y } : { w: cardW, h: cardH };
  };
  // Flow cards row by row; each row advances by its tallest card so cards
  // never overlap when previews have different natural heights.
  let rowY = y, rowH = 0;
  node.children.forEach((c, i) => {
    if (i > 0 && i % cols === 0) { rowY += rowH + CARD_GAP; rowH = 0; }
    const s = cardSize(c);
    rowH = Math.max(rowH, s.h);
    out.cards.set(c.relPath, {
      x: originX + GROUP_PAD + (i % cols) * (cardW + CARD_GAP),
      y: rowY,
      w: s.w, h: s.h,
      file: c, owner: node.relPath,
    });
  });
  if (count) y = rowY + rowH;
  for (const g of node.groups) {
    if (!g.children.length && !g.groups.length) continue;
    y += NESTED_GAP;
    const child = layoutGroup(g, originX + GROUP_PAD, y, out, node.relPath, naturalSizes, opts);
    y += child.h;
    contentW = Math.max(contentW, child.w);
  }
  const w = contentW + GROUP_PAD * 2;
  const h = y - originY + GROUP_PAD;
  out.groups.set(node.relPath, { x: originX, y: originY, w, h });
  return { w, h };
}

function computeLayout(roots, manual, naturalSizes, opts) {
  const out = { cards: new Map(), groups: new Map(), parent: new Map(), total: { w: 0, h: 0 } };
  let y = 0;
  for (const root of roots || []) {
    const { w, h } = layoutGroup(root, 0, y, out, null, naturalSizes, opts);
    y += h + GROUP_GAP;
    out.total.w = Math.max(out.total.w, w);
  }
  out.total.h = Math.max(0, y - GROUP_GAP);

  // Auto-placed cards shift by the combined move delta of manually moved
  // ancestor groups (groups store the pure translation as dx/dy; legacy
  // entries without it fall back to their position delta vs the auto layout).
  const deltas = new Map();
  for (const [rel, g] of out.groups) {
    const m = manual.groups?.[rel];
    if (!m) { deltas.set(rel, { dx: 0, dy: 0 }); continue; }
    if (m.dx != null && m.dy != null) { deltas.set(rel, { dx: m.dx, dy: m.dy }); continue; }
    deltas.set(rel, { dx: m.x - g.x, dy: m.y - g.y });
  }
  for (const [rel, c] of out.cards) {
    const nat = naturalSizes?.[rel];
    const natW = nat ? nat.w + CARD_PAD_X : (opts?.cardWidth ?? CARD_W);
    const natH = nat ? nat.h + CARD_PAD_Y : (opts?.cardHeight ?? CARD_H);
    const m = manual.cards?.[rel];
    if (m) {
      c.x = m.x ?? c.x; c.y = m.y ?? c.y;
      c.w = m.w ?? natW; c.h = m.h ?? natH;
      continue;
    }
    c.w = natW; c.h = natH;
    let node = c.owner, dx = 0, dy = 0;
    while (node) {
      const d = deltas.get(node);
      if (d) { dx += d.dx; dy += d.dy; }
      node = out.parent.get(node);
    }
    c.x += dx; c.y += dy;
  }

  for (const [rel, g] of out.groups) {
    const m = manual.groups?.[rel];
    if (m) {
      g.x = m.x; g.y = m.y;
      if (m.w) g.w = m.w;
      if (m.h) g.h = m.h;
    }
  }

  // Groups keep their position; they only expand on the side(s) a child
  // pushes past the border. Manual group rects stay as committed.
  const bounds = new Map();
  for (const [rel, c] of out.cards) {
    const b = bounds.get(c.owner) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    b.minX = Math.min(b.minX, c.x); b.minY = Math.min(b.minY, c.y);
    b.maxX = Math.max(b.maxX, c.x + c.w); b.maxY = Math.max(b.maxY, c.y + c.h);
    bounds.set(c.owner, b);
  }
  for (const [rel, g] of out.groups) {
    const b = bounds.get(rel);
    if (!b || !isFinite(b.minX)) continue;
    const r = expandForChild(g, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY, GROUP_PAD);
    g.x = r.x; g.y = r.y;
    g.w = Math.max(r.w, MIN_GROUP_W);
    g.h = Math.max(r.h, GROUP_HEADER + GROUP_PAD * 2);
  }
  return out;
}

// ── Per-card live preview (shadow DOM + transpileJsx) ────────────────────────
// Cap concurrent transpile requests so a large canvas loads in waves instead
// of flooding IPC and janking the UI.
const TRANSPILE_POOL = 5;
const transpileQueue = [];
let transpileActive = 0;
const transpilePooled = (fn) => new Promise((resolve, reject) => {
  const run = () => {
    transpileActive++;
    fn().then(
      (r) => { transpileActive--; next(); resolve(r); },
      (e) => { transpileActive--; next(); reject(e); }
    );
  };
  const next = () => {
    while (transpileActive < TRANSPILE_POOL && transpileQueue.length) transpileQueue.shift()();
  };
  transpileQueue.push(run);
  next();
});
class CardErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error) { console.error("Canvas Card Preview Error:", error); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 10, background: "#2a1717", border: "1px solid #732222", borderRadius: 2, color: "#f44747", fontSize: 11, fontFamily: "Consolas, monospace", lineHeight: 1.4, wordBreak: "break-all" }}>
          {this.state.error?.message || String(this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

// Panel-level safety net: if anything in the canvas render throws, show the
// real message with a working Retry instead of the workbench's dead-end
// "Error rendering component" overlay. Retry remounts the whole panel.
class PanelErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, attempt: 0 }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { console.error("Canvas Panel Error:", error); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "#181818", color: "#f48771", fontSize: 12, padding: 20 }}>
          <div style={{ fontWeight: 600 }}>Canvas error</div>
          <div style={{ color: "#e8a8a0", fontFamily: "Consolas, monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxWidth: 700, maxHeight: 200, overflow: "auto" }}>
            {this.state.error?.message || String(this.state.error)}
          </div>
          <button
            onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}
            style={{ background: "#007acc", border: "none", color: "#fff", borderRadius: 2, padding: "5px 14px", fontSize: 12, cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return <div key={this.state.attempt} style={{ display: "contents" }}>{this.props.children}</div>;
  }
}

const resolvePath = (baseFile, relativePath) => {
  if (!baseFile || !relativePath) return null;
  const parts = baseFile.replace(/\\/g, "/").split("/");
  parts.pop();
  for (const p of relativePath.replace(/\\/g, "/").split("/")) {
    if (p === "." || p === "") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return parts.join("/");
};

const CardPreview = React.memo(function CardPreview({ file, rel, liveSourcesRef, onLive, onNatural, canvasZoom, showPreview = true }) {
  const hostRef = useRef(null);
  const timerRef = useRef(null);
  const rootRef = useRef(null);
  const scaledRef = useRef(null);
  const innerRef = useRef(null);
  const iframeRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [comp, setComp] = useState(null);
  const [html, setHtml] = useState(null);

  const isHtml = /\.html$/i.test(file.name);

  const injectCss = useCallback((cssKey, cssContent) => {
    const host = hostRef.current;
    if (!host || !host.shadowRoot || !cssKey) return;
    const stylesHost = host.__stylesHost;
    if (!stylesHost) return;
    const styleId = `cv-css-${cssKey.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    let el = stylesHost.querySelector(`#${styleId}`);
    if (!el) {
      el = document.createElement("style");
      el.id = styleId;
      stylesHost.appendChild(el);
    }
    el.textContent = cssContent || "";
  }, []);

  const loadAssociatedCss = useCallback(async (path, source) => {
    const cssImportRegex = /(?:import|require)\s*\(?['"]([^'"]+\.(?:css|scss|less|pcss))['"\)]/gi;
    let match;
    while ((match = cssImportRegex.exec(source)) !== null) {
      const fullCssPath = resolvePath(path, match[1]);
      if (fullCssPath) {
        try {
          const cssContent = await window.electronAPI.readTextFile(fullCssPath);
          if (cssContent !== null) injectCss(fullCssPath, cssContent);
        } catch {}
      }
    }
    const sameNameCss = path.replace(/\.(jsx|tsx|js|ts|vue|svelte)$/i, ".css");
    if (sameNameCss !== path) {
      try {
        const cssContent = await window.electronAPI.readTextFile(sameNameCss);
        if (cssContent !== null) injectCss(sameNameCss, cssContent);
      } catch {}
    }
  }, [injectCss]);

  // Fit the component into the card area with a "cover" fit: the preview is
  // scaled uniformly (aspect ratio always preserved — no stretching when the
  // card is resized) and centered, filling the card completely. Overflow is
  // cropped evenly. The wrapper is re-scaled imperatively (no re-render, no
  // remount); the preview re-flows only when the card grows past its natural
  // size so text stays crisp.
  //
  // Canvas zoom: the whole canvas is scaled by view.z, so to keep the preview
  // sharp the content is laid out z× bigger and counter-scaled by 1/z — the
  // browser rasterizes it at the zoomed resolution (crisp) instead of
  // upscaling a 1:1 render (blurry).
  const measureAndFit = useCallback(() => {
    const host = hostRef.current;
    if (!host || !host.shadowRoot || isHtml) return;
    const rootEl = rootRef.current, scaled = scaledRef.current, inner = innerRef.current;
    if (!rootEl || !scaled || !inner) return;
    const z = canvasZoom || 1;
    const fw = Math.max(1, rootEl.clientWidth);
    const fh = Math.max(1, rootEl.clientHeight);
    let nat = host.__nat;
    if (!nat || fw > nat.w || fh > nat.h) {
      inner.style.display = "inline-block";
      inner.style.minWidth = "100%";
      inner.style.minHeight = "100%";
      inner.style.width = "";
      inner.style.height = "";
      inner.style.transform = `scale(${1 / z})`;
      scaled.style.width = "100%";
      scaled.style.height = "100%";
      scaled.style.marginLeft = "0";
      scaled.style.marginTop = "0";
      const r = inner.getBoundingClientRect();
      nat = { w: Math.max(1, Math.ceil(r.width * z)), h: Math.max(1, Math.ceil(r.height * z)) };
      host.__nat = nat;
      const reported = host.__reportedNat;
      if (!reported || reported.w !== nat.w || reported.h !== nat.h) {
        host.__reportedNat = nat;
        onNatural(rel, nat);
      }
    }
    const fit = Math.max(fw / nat.w, fh / nat.h);
    const layout = fit * z;
    scaled.style.width = `${nat.w * fit}px`;
    scaled.style.height = `${nat.h * fit}px`;
    scaled.style.marginLeft = `${(fw - nat.w * fit) / 2}px`;
    scaled.style.marginTop = `${(fh - nat.h * fit) / 2}px`;
    inner.style.display = "";
    inner.style.minWidth = "";
    inner.style.minHeight = "";
    inner.style.width = `${nat.w * layout}px`;
    inner.style.height = `${nat.h * layout}px`;
    inner.style.transform = `scale(${1 / z})`;
  }, [isHtml, onNatural, rel, canvasZoom]);

  // HTML previews: the card auto-sizes to the page's natural size (reported
  // like components). The iframe re-flows with its width (crisp, no scaling);
  // when the card is smaller than the page the preview scrolls.
  const measureHtml = useCallback(() => {
    const host = hostRef.current;
    if (!host || !host.shadowRoot) return;
    const rootEl = rootRef.current, iframe = iframeRef.current;
    if (!rootEl || !iframe) return;
    let doc = null;
    try { doc = iframe.contentDocument || iframe.contentWindow?.document; } catch {}
    if (!doc || !doc.documentElement) return;
    const de = doc.documentElement, b = doc.body;
    const w = Math.max(1, Math.ceil(Math.max(de.scrollWidth, b ? b.scrollWidth : 0)));
    const h = Math.max(1, Math.ceil(Math.max(de.scrollHeight, b ? b.scrollHeight : 0)));
    const nat = { w, h };
    host.__nat = nat;
    const reported = host.__reportedNat;
    if (!reported || reported.w !== nat.w || reported.h !== nat.h) {
      host.__reportedNat = nat;
      onNatural(rel, nat);
    }
    const fw = Math.max(1, rootEl.clientWidth);
    const fh = Math.max(1, rootEl.clientHeight);
    rootEl.style.overflow = fw < nat.w || fh < nat.h ? "auto" : "hidden";
  }, [onNatural, rel]);

  const load = useCallback(async (sourceOverride) => {
    const host = hostRef.current;
    if (!host || !host.shadowRoot) return;
    host.__nat = null;
    host.__reportedNat = null;
    setError(null);
    setStatus("loading");
    setComp(null);
    setHtml(null);
    let source = sourceOverride;
    if (source == null) source = liveSourcesRef.current.get(file.absPath);
    if (source == null) source = await window.electronAPI.readTextFile(file.absPath);
    if (source === null) {
      setStatus("error");
      setError(`Could not read ${file.name}`);
      return;
    }
    if (isHtml) {
      setHtml(source);
      setStatus("ready");
      return;
    }
    await loadAssociatedCss(file.absPath, source);
    let codeToTranspile = source;
    if (!/export\s+default|function|const|class/i.test(source) && /^\s*</.test(source.trim())) {
      codeToTranspile = `export default function PreviewSnippet() { return (\n${source}\n); }`;
    }
    if (!window.electronAPI?.bundleComponent) {
      setStatus("error");
      setError("Preview bundler not available — restart the app after `npm install`");
      return;
    }
    let res;
    try {
      res = await transpilePooled(() =>
        window.electronAPI.bundleComponent(codeToTranspile, file.absPath, window.__currentProjectPath)
      );
    } catch (e) {
      setStatus("error");
      setError(e?.message || String(e) || "Bundling failed");
      return;
    }
    if (!res?.ok) {
      setStatus("error");
      setError(res?.error || "Bundling failed");
      return;
    }
    try {
      const exportsObj = {};
      const moduleObj = { exports: exportsObj };
      const sandboxRequire = (id) => {
        if (id === "react") return React;
        if (id === "react-dom") return ReactDOMPkg;
        if (id === "react-dom/client") return ReactDOM;
        if (id === "react/jsx-runtime" || id === "react/jsx-dev-runtime") return ReactJSXRuntime;
        return null;
      };
      const runner = new Function(
        "React", "require", "exports", "module",
        `${res.code};\nconst exp = module.exports.default || exports.default || module.exports;\nif (typeof exp === 'function') return exp;\nif (exp && typeof exp === 'object') {\n  for (const k of Object.keys(exp)) {\n    const v = exp[k];\n    if (typeof v === 'function') return v;\n  }\n}\nreturn (typeof App !== 'undefined' ? App : null) || (typeof Component !== 'undefined' ? Component : null);`
      );
      const evaluated = runner(React, sandboxRequire, exportsObj, moduleObj);
      if (!evaluated) {
        setStatus("error");
        setError("No default export or component found");
        return;
      }
      setComp(() => evaluated);
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err?.message || String(err));
    }
  }, [file.absPath, file.name, liveSourcesRef, loadAssociatedCss, isHtml]);

  // Single, stable tree: the component always lives in the same divs, only
  // their styles change (via measureAndFit). No branch switching, ever.
  const renderShadow = useCallback(() => {
    const host = hostRef.current;
    if (!host || !host.shadowRoot) return;
    if (!host.__root) host.__root = ReactDOM.createRoot(host.__mount);
    const compEl = comp ? (React.isValidElement(comp) ? comp : React.createElement(comp)) : null;
    host.__root.render(
      <CardErrorBoundary>
        <div ref={rootRef} style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
          {isHtml ? (
            <iframe
              ref={iframeRef}
              srcDoc={html || ""}
              onLoad={measureHtml}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: "100%", height: "100%", border: 0, background: "#fff", display: "block" }}
            />
          ) : compEl ? (
            <div ref={scaledRef} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
              <div ref={innerRef} style={{ width: "100%", height: "100%", transformOrigin: "0 0" }}>
                {compEl}
              </div>
            </div>
          ) : (
            <div style={{ color: "#666", fontSize: 11 }}>…</div>
          )}
        </div>
      </CardErrorBoundary>
    );
  }, [comp, html, isHtml]);

  useEffect(() => { renderShadow(); }, [renderShadow]);

  // Measure + fit after the component is first rendered.
  useEffect(() => {
    if (!comp || isHtml) return;
    const raf = requestAnimationFrame(() => measureAndFit());
    return () => cancelAnimationFrame(raf);
  }, [comp, isHtml, measureAndFit]);

  // Re-fit when the card area changes size (resize) — without any re-render.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      if (isHtml) measureHtml();
      else measureAndFit();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [isHtml, measureAndFit, measureHtml]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.shadowRoot) return;
    const sr = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    mount.style.width = "100%";
    mount.style.minHeight = "100%";
    mount.style.boxSizing = "border-box";
    sr.appendChild(mount);
    const stylesHost = document.createElement("div");
    stylesHost.style.display = "none";
    sr.appendChild(stylesHost);
    host.__mount = mount;
    host.__stylesHost = stylesHost;
    load();
    return () => {
      const root = host.__root;
      host.__root = null;
      if (root) {
        // Deferred: unmounting the shadow root synchronously while the parent
        // is mid-render (cards culled during a layout recompute) corrupts
        // React's internal state and takes down the whole panel. Let the
        // current render finish first.
        setTimeout(() => { try { root.unmount(); } catch {} }, 0);
      }
    };
  }, [load]);

  useEffect(() => {
    const schedule = (fn) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fn, 300);
    };
    const onSourceChanged = (e) => {
      const { path, code } = e.detail || {};
      if (path !== file.absPath || typeof code !== "string") return;
      liveSourcesRef.current.set(path, code);
      onLive(rel, true);
      schedule(() => load(code));
    };
    window.addEventListener("component:sourceChanged", onSourceChanged);
    const unsub = window.electronAPI.onFsChange(() => {
      if (!liveSourcesRef.current.has(file.absPath)) {
        onLive(rel, true);
        schedule(() => load());
      }
    });
    return () => {
      window.removeEventListener("component:sourceChanged", onSourceChanged);
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [file.absPath, load, liveSourcesRef, onLive, rel]);

  if (!showPreview) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#141414", color: "#888", fontSize: 12, padding: 10, textAlign: "center", borderRadius: 2 }}>
        <span style={{ wordBreak: "break-all" }}>{file.name}</span>
      </div>
    );
  }
  const isError = status === "error" || !!error;
  return (
    <div style={{ width: "100%", height: "100%", background: "#141414", borderRadius: 2, overflow: "hidden", position: "relative" }}>
      <div ref={hostRef} style={{ width: "100%", height: "100%", overflow: "hidden" }} />
      {status === "loading" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 11, pointerEvents: "none" }}>
          Loading preview…
        </div>
      )}
      {isError && (
        <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: 10, background: "#2a1717", color: "#f44747", fontSize: 11, fontFamily: "Consolas, monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.4 }}>
          {error}
        </div>
      )}
    </div>
  );
});

// ── Context menu items ───────────────────────────────────────────────────────
const CtxItem = ({ label, onClick, onClose, danger }) => {
  const [hov, setHov] = useState(false);
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); onClose(); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ padding: "4px 10px", fontSize: 12, color: danger ? "#f48771" : "#d4d4d4", cursor: "pointer", borderRadius: 2, background: hov ? "#2a2d2e" : "transparent", whiteSpace: "nowrap" }}
    >
      {label}
    </div>
  );
};
const CtxSep = () => <div style={{ height: 1, background: "#3c3c3c", margin: "4px 8px" }} />;

// ── Main Canvas panel ────────────────────────────────────────────────────────
const CanvasPanel = ({ nodeId, config }) => {
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState({ cards: {}, groups: {} });
  const [drag, setDrag] = useState(null);
  const [view, setView] = useState({ x: 60, y: 40, z: 1 });
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const [query, setQuery] = useState("");
  const [livePaths, setLivePaths] = useState(new Set());
  const [selectedRel, setSelectedRel] = useState(null);
  const [naturalSizes, setNaturalSizes] = useState({});
  const [menu, setMenu] = useState(null);
  const [scanError, setScanError] = useState(null);
  const [canvasOpts, setCanvasOpts] = useState(() => getCanvasOpts({}));

  const viewportRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const manualRef = useRef(manual);
  manualRef.current = manual;
  const liveSourcesRef = useRef(new Map());
  const saveTimerRef = useRef(null);
  const panRef = useRef(null);
  const spaceRef = useRef(false);
  const fittedRef = useRef(false);
  const pendingNatRef = useRef({});
  const natFlushRef = useRef(null);
  const livePathsRef = useRef(livePaths);
  livePathsRef.current = livePaths;

  const rootPath = window.__currentProjectPath || null;

  // ── Canvas settings live sync (was dead) ─────────────────────────────────
  useEffect(() => {
    window.electronAPI.readSettings().then((s) => setCanvasOpts(getCanvasOpts(s || {})));
    const apply = (patch) => {
      if (!patch || typeof patch !== "object") return;
      const hasKey = ["autoLayout","showPreview","gridSnap","showMinimap","maxCols","cardWidth","cardHeight","canvas","canvasAutoLayout","canvasShowPreview","canvasGridSnap","canvasShowMinimap","canvasMaxCols","canvasCardWidth","canvasCardHeight"].some(k=> k in patch);
      if (!hasKey) return;
      window.electronAPI.readSettings().then((s) => setCanvasOpts(getCanvasOpts(s || {})));
    };
    let bc;
    try { bc = new BroadcastChannel("canvas-settings"); bc.onmessage = (e)=> apply(e.data); } catch {}
    let unsub;
    try { unsub = window.electronAPI.onSettingsUpdated(apply); } catch {}
    return () => { try{bc?.close()}catch{}; try{unsub?.()}catch{} };
  }, []);

  const snap = useCallback((v) => canvasOpts.gridSnap ? Math.round(v / 20) * 20 : Math.round(v), [canvasOpts.gridSnap]);

  const setLiveState = useCallback((relPath, on) => {
    setLivePaths((prev) => {
      const next = new Set(prev);
      if (on) {
        next.clear();
        next.add(relPath);
      } else {
        next.delete(relPath);
      }
      return next;
    });
  }, []);
  const onCardLive = useCallback((relPath, on) => setLiveState(relPath, on), [setLiveState]);
  const onCardNatural = useCallback((relPath, size) => {
    pendingNatRef.current[relPath] = { w: size.w, h: size.h };
    if (natFlushRef.current) return;
    natFlushRef.current = requestAnimationFrame(() => {
      natFlushRef.current = null;
      setNaturalSizes((prev) => {
        const p = pendingNatRef.current;
        pendingNatRef.current = {};
        let changed = false;
        const next = { ...prev };
        for (const [k, v] of Object.entries(p)) {
          const cur = prev[k];
          if (!cur || cur.w !== v.w || cur.h !== v.h) { next[k] = v; changed = true; }
        }
        return changed ? next : prev;
      });
    });
  }, []);

  const refreshScan = useCallback(async () => {
    const root = window.__currentProjectPath;
    if (!root) { setScan(null); setScanError(null); return; }
    setScanning(true);
    setScanError(null);
    try {
      const data = await window.electronAPI.scanCanvas(root);
      if (data?.error) {
        setScanError(data.error);
      } else if (data) {
        setScan(data);
      }
    } catch (err) {
      setScanError(err?.message || String(err));
    } finally {
      setScanning(false);
    }
  }, []);

  const persistLayout = useCallback((data) => {
    if (!window.__currentProjectPath) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const payload = { version: 2, cards: data?.cards || {}, groups: data?.groups || {} };
    saveTimerRef.current = setTimeout(() => {
      window.electronAPI.saveCanvasLayout(window.__currentProjectPath, payload).catch(() => {});
    }, 400);
  }, []);

  useEffect(() => {
    if (!window.__currentProjectPath) return;
    window.electronAPI.loadCanvasLayout(window.__currentProjectPath).then((data) => {
      setManual({ cards: data?.cards || {}, groups: data?.groups || {} });
    }).catch(() => {});
    return () => {
      if (natFlushRef.current) cancelAnimationFrame(natFlushRef.current);
      natFlushRef.current = null;
    };
  }, [rootPath]);

  useEffect(() => { refreshScan(); }, [refreshScan]);

  useEffect(() => {
    const onOpen = () => refreshScan();
    const onClose = () => { setScan(null); setManual({ cards: {}, groups: {} }); };
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    return () => {
      window.removeEventListener("project:opened", onOpen);
      window.removeEventListener("project:closed", onClose);
    };
  }, [refreshScan]);

  useEffect(() => {
    let timer = null;
    const unsub = window.electronAPI.onFsChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refreshScan, 2000);
    });
    return () => { unsub(); if (timer) clearTimeout(timer); };
  }, [refreshScan]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setVw(el.clientWidth);
      setVh(el.clientHeight);
    });
    ro.observe(el);
    setVw(el.clientWidth);
    setVh(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Folders with previewable files become groups (flat tree, no nested frames)
  const flatGroups = useMemo(() => {
    const out = [];
    const walk = (node) => {
      if (node.children.length) out.push(node);
      node.groups.forEach(walk);
    };
    (scan?.roots || []).forEach(walk);
    return out;
  }, [scan]);

  const scanRootsByRel = useMemo(() => {
    const m = new Map();
    const walk = (n) => { m.set(n.relPath, n); n.groups.forEach(walk); };
    (scan?.roots || []).forEach(walk);
    return m;
  }, [scan]);

  const layout = useMemo(() => {
    try {
      return computeLayout(flatGroups, manual, naturalSizes, canvasOpts);
    } catch (e) {
      console.error("[Canvas] layout error:", e);
      return { cards: new Map(), groups: new Map(), parent: new Map(), total: { w: 800, h: 600 } };
    }
  }, [flatGroups, manual, naturalSizes]);

  // Manual drags never run the auto-layout engine: while a pointer is down we
  // overlay a transient position/size on top of the computed layout, and only
  // commit to `manual` (one layout recompute) on release.
  const commitManual = useCallback((updater) => {
    const next = updater(manualRef.current);
    manualRef.current = next;
    setManual(next);
    return next;
  }, []);

  const openMenu = useCallback((e, kind, rel) => {
    e.preventDefault();
    e.stopPropagation();
    if (rel) setSelectedRel(rel);
    const vp = viewportRef.current;
    const r = vp ? vp.getBoundingClientRect() : null;
    const w = 190;
    const h = kind === "card" ? 220 : kind === "group" ? 100 : 210;
    const x = Math.max(r?.left || 0, Math.min(e.clientX, (r?.right || e.clientX) - w));
    const y = Math.max(r?.top || 0, Math.min(e.clientY, (r?.bottom || e.clientY) - h));
    setMenu({ x, y, kind, rel: rel || null });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const resetCardSize = useCallback((rel) => {
    const next = commitManual((m) => {
      const c = m.cards[rel];
      if (!c) return m;
      const { w, h, ...rest } = c;
      return { ...m, cards: { ...m.cards, [rel]: rest } };
    });
    persistLayout(next);
  }, [commitManual, persistLayout]);

  const resetGroupPos = useCallback((rel) => {
    const next = commitManual((m) => {
      const g = { ...m.groups };
      delete g[rel];
      return { ...m, groups: g };
    });
    persistLayout(next);
  }, [commitManual, persistLayout]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e) => {
      if (e.target && e.target.closest && e.target.closest(".cv-ctx")) return;
      setMenu(null);
    };
    const onKey = (e) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const effCards = useMemo(() => {
    const d = drag;
    if (!d) return layout.cards;
    if (d.type === "cardMove" || d.type === "cardResize") {
      const m = new Map(layout.cards);
      const cur = layout.cards.get(d.rel);
      if (cur) m.set(d.rel, { ...cur, x: d.x, y: d.y, w: d.w, h: d.h });
      return m;
    }
    if (d.type === "groupMove") {
      const m = new Map(layout.cards);
      for (const [crel, s] of d.subCards) {
        m.set(crel, { ...s, x: s.x + d.dx, y: s.y + d.dy });
      }
      return m;
    }
    return layout.cards;
  }, [layout, drag]);

  const effGroups = useMemo(() => {
    const d = drag;
    if (!d) return layout.groups;
    const m = new Map(layout.groups);
    if ((d.type === "cardMove" || d.type === "cardResize") && d.group) {
      m.set(d.owner, expandForChild(d.group, d.x, d.y, d.w, d.h, GROUP_PAD));
    } else if (d.type === "groupMove") {
      m.set(d.rel, { ...d.group, x: d.group.x + d.dx, y: d.group.y + d.dy });
      for (const [grel, s] of d.subGroups) {
        m.set(grel, { ...s, x: s.x + d.dx, y: s.y + d.dy });
      }
    } else if (d.type === "groupResize") {
      m.set(d.rel, d.rect);
    }
    return m;
  }, [layout, drag]);

  const collectSubtree = useCallback((rel) => {
    const cards = [], groups = [];
    const walk = (node) => {
      node.children.forEach((c) => cards.push(c.relPath));
      node.groups.forEach((g) => { groups.push(g.relPath); walk(g); });
    };
    const root = scanRootsByRel.get(rel);
    if (root) walk(root);
    return { cards, groups };
  }, [scanRootsByRel]);

  const visibleCards = useMemo(() => {
    const set = new Set();
    const { x, y, z } = view;
    const wx0 = -x / z - 400, wy0 = -y / z - 400;
    const ww = vw / z + 800, wh = vh / z + 800;
    for (const [rel, c] of effCards) {
      if (c.x + c.w >= wx0 && c.x <= wx0 + ww && c.y + c.h >= wy0 && c.y <= wy0 + wh) set.add(rel);
    }
    return set;
  }, [view, vw, vh, effCards]);

  const visibleGroups = useMemo(() => {
    const set = new Set();
    const { x, y, z } = view;
    const wx0 = -x / z - 200, wy0 = -y / z - 200;
    const ww = vw / z + 400, wh = vh / z + 400;
    for (const [rel, g] of effGroups) {
      if (g.x + g.w >= wx0 && g.x <= wx0 + ww && g.y + g.h >= wy0 && g.y <= wy0 + wh) set.add(rel);
    }
    return set;
  }, [view, vw, vh, effGroups]);

  const zoomAt = useCallback((cx, cy, factor) => {
    setView((v) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.z * factor));
      const k = z / v.z;
      return { x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, z };
    });
  }, []);

  const fitView = useCallback(() => {
    const { total } = layout;
    if (!vw || !vh || !total.w || !total.h) return;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(vw / total.w, vh / total.h) * 0.92));
    setView({ x: (vw - total.w * z) / 2, y: (vh - total.h * z) / 2, z });
  }, [layout, vw, vh]);

  useEffect(() => {
    if (scan && vw > 0 && vh > 0 && !fittedRef.current) {
      fittedRef.current = true;
      const t = setTimeout(fitView, 60);
      return () => clearTimeout(t);
    }
  }, [scan, vw, vh, fitView]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onNativeWheel = (e) => {
      // Ctrl+Scroll zoom disabled — treat Ctrl+wheel like a normal pan
      // so Ctrl+Scroll never zooms (use toolbar +/- buttons instead).
      e.preventDefault();
      if (e.shiftKey) {
        setView((v) => ({ ...v, x: v.x - e.deltaY }));
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => el.removeEventListener("wheel", onNativeWheel);
  }, [zoomAt]);

  useEffect(() => {
    const down = (e) => { if (e.code === "Space" && !e.repeat && e.target === document.body) { spaceRef.current = true; e.preventDefault(); } };
    const up = (e) => { if (e.code === "Space") spaceRef.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const startPan = useCallback((e) => {
    const panAllowed = e.button === 1 || e.button === 2 || (e.button === 0 && (spaceRef.current || e.shiftKey));
    if (!panAllowed) return;
    e.preventDefault();
    panRef.current = { startX: e.clientX, startY: e.clientY, x: viewRef.current.x, y: viewRef.current.y, button: e.button, moved: false };
    const move = (ev) => {
      const p = panRef.current;
      if (!p) return;
      if (!p.moved && Math.abs(ev.clientX - p.startX) + Math.abs(ev.clientY - p.startY) > DRAG_MOVE_THRESHOLD) {
        p.moved = true;
        if (p.button === 2) setMenu(null);
      }
      if (!p.moved) return;
      setView((v) => ({ ...v, x: p.x + (ev.clientX - p.startX), y: p.y + (ev.clientY - p.startY) }));
    };
    const up = () => {
      panRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);

  const startGroupMove = useCallback((e, rel) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const g = layout.groups.get(rel);
    if (!g) return;
    const startX = e.clientX, startY = e.clientY;
    const groupSnap = { x: g.x, y: g.y, w: g.w, h: g.h };
    const subCards = new Map();
    const subGroups = new Map();
    const { cards: subCardRels, groups: subGroupRels } = collectSubtree(rel);
    for (const c of subCardRels) {
      const cur = layout.cards.get(c);
      if (cur) subCards.set(c, { ...cur });
    }
    for (const gc of subGroupRels) {
      const cur = layout.groups.get(gc);
      if (cur) subGroups.set(gc, { ...cur });
    }
    const last = { dx: 0, dy: 0 };
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > DRAG_MOVE_THRESHOLD) moved = true;
      if (!moved) return;
      last.dx = snap((ev.clientX - startX) / viewRef.current.z);
      last.dy = snap((ev.clientY - startY) / viewRef.current.z);
      setDrag({ type: "groupMove", rel, dx: last.dx, dy: last.dy, group: groupSnap, subCards, subGroups });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!moved) return;
      const next = commitManual((m) => {
        const cards = { ...m.cards };
        const groups = { ...m.groups };
        const prevG = m.groups[rel];
        groups[rel] = {
          x: groupSnap.x + last.dx, y: groupSnap.y + last.dy, w: groupSnap.w, h: groupSnap.h,
          ...(prevG?.dx != null && prevG?.dy != null ? { dx: prevG.dx + last.dx, dy: prevG.dy + last.dy } : { dx: last.dx, dy: last.dy }),
        };
        for (const [c, s] of subCards) {
          if (m.cards[c]) cards[c] = { ...(m.cards[c] || {}), x: s.x + last.dx, y: s.y + last.dy };
        }
        for (const [gc, s] of subGroups) {
          if (m.groups[gc]) groups[gc] = { ...(m.groups[gc] || {}), x: s.x + last.dx, y: s.y + last.dy };
        }
        return { ...m, cards, groups };
      });
      persistLayout(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [layout, persistLayout, collectSubtree, commitManual, snap]);

  const startCardMove = useCallback((e, rel) => {
    const card = layout.cards.get(rel);
    if (!card) return;
    if (e.button !== 0) return;
    // Shift+drag: move the card together with its parent group
    if (e.shiftKey && card.owner) {
      startGroupMove(e, card.owner);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const orig = { x: card.x, y: card.y, w: card.w, h: card.h };
    const group = layout.groups.get(card.owner);
    const groupSnap = group ? { x: group.x, y: group.y, w: group.w, h: group.h } : null;
    const last = { ...orig };
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > DRAG_MOVE_THRESHOLD) moved = true;
      if (!moved) return;
      const dx = (ev.clientX - startX) / viewRef.current.z;
      const dy = (ev.clientY - startY) / viewRef.current.z;
      last.x = snap(orig.x + dx);
      last.y = snap(orig.y + dy);
      setDrag({ type: "cardMove", rel, owner: card.owner, x: last.x, y: last.y, w: orig.w, h: orig.h, group: groupSnap });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (moved) {
        const next = commitManual((m) => {
          let groups = m.groups;
          if (groupSnap) {
            const ex = expandForChild(groupSnap, last.x, last.y, last.w, last.h, GROUP_PAD);
            if (ex.x !== groupSnap.x || ex.y !== groupSnap.y || ex.w !== groupSnap.w || ex.h !== groupSnap.h) {
              const prev = m.groups[card.owner];
              groups = { ...groups, [card.owner]: { x: ex.x, y: ex.y, w: ex.w, h: ex.h, ...(prev?.dx != null && prev?.dy != null ? { dx: prev.dx, dy: prev.dy } : prev ? {} : { dx: 0, dy: 0 }) } };
            }
          }
          return { ...m, cards: { ...m.cards, [rel]: { ...(m.cards[rel] || {}), x: last.x, y: last.y, w: last.w, h: last.h } }, groups };
        });
        persistLayout(next);
      } else {
        const f = layout.cards.get(rel);
        if (f) window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { filePath: f.file.absPath } }));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [layout, persistLayout, startGroupMove, commitManual, snap]);

  const startCardResize = useCallback((e, rel) => {
    const card = layout.cards.get(rel);
    if (!card) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const orig = { x: card.x, y: card.y, w: card.w, h: card.h };
    const group = layout.groups.get(card.owner);
    const groupSnap = group ? { x: group.x, y: group.y, w: group.w, h: group.h } : null;
    const last = { ...orig };
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > DRAG_RESIZE_THRESHOLD) moved = true;
      if (!moved) return;
      const nw = Math.min(MAX_CARD_W, Math.max(MIN_CARD_W, Math.round(orig.w + (ev.clientX - startX) / viewRef.current.z)));
      const nh = Math.min(MAX_CARD_H, Math.max(MIN_CARD_H, Math.round(orig.h + (ev.clientY - startY) / viewRef.current.z)));
      last.w = nw;
      last.h = nh;
      setDrag({ type: "cardResize", rel, owner: card.owner, x: orig.x, y: orig.y, w: nw, h: nh, group: groupSnap });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!moved) return;
      const next = commitManual((m) => {
        let groups = m.groups;
        if (groupSnap) {
          const ex = expandForChild(groupSnap, last.x, last.y, last.w, last.h, GROUP_PAD);
          if (ex.x !== groupSnap.x || ex.y !== groupSnap.y || ex.w !== groupSnap.w || ex.h !== groupSnap.h) {
            const prev = m.groups[card.owner];
            groups = { ...groups, [card.owner]: { x: ex.x, y: ex.y, w: ex.w, h: ex.h, ...(prev?.dx != null && prev?.dy != null ? { dx: prev.dx, dy: prev.dy } : prev ? {} : { dx: 0, dy: 0 }) } };
          }
        }
        return { ...m, cards: { ...m.cards, [rel]: { ...(m.cards[rel] || {}), x: last.x, y: last.y, w: last.w, h: last.h } }, groups };
      });
      persistLayout(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [layout, persistLayout, commitManual]);

  const startGroupResize = useCallback((e, rel, edge) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const g = layout.groups.get(rel);
    if (!g) return;
    const startX = e.clientX, startY = e.clientY;
    const orig = { x: g.x, y: g.y, w: g.w, h: g.h };
    const last = { ...orig };
    let moved = false;
    const move = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > DRAG_RESIZE_THRESHOLD) moved = true;
      if (!moved) return;
      const dx = Math.round((ev.clientX - startX) / viewRef.current.z);
      const dy = Math.round((ev.clientY - startY) / viewRef.current.z);
      let x = orig.x, y = orig.y, w = orig.w, h = orig.h;
      if (edge.includes("e")) w = orig.w + dx;
      if (edge.includes("s")) h = orig.h + dy;
      if (edge.includes("w")) { x = orig.x + dx; w = orig.w - dx; }
      if (edge.includes("n")) { y = orig.y + dy; h = orig.h - dy; }
      w = Math.min(MAX_GROUP, Math.max(MIN_GROUP_W, w));
      h = Math.min(MAX_GROUP, Math.max(MIN_GROUP_H, h));
      if (edge.includes("w")) x = orig.x + orig.w - w;
      if (edge.includes("n")) y = orig.y + orig.h - h;
      Object.assign(last, { x, y, w, h });
      setDrag({ type: "groupResize", rel, rect: { x, y, w, h } });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!moved) return;
      const next = commitManual((m) => {
        const prev = m.groups[rel];
        return { ...m, groups: { ...m.groups, [rel]: { x: last.x, y: last.y, w: last.w, h: last.h, ...(prev?.dx != null && prev?.dy != null ? { dx: prev.dx, dy: prev.dy } : prev ? {} : { dx: 0, dy: 0 }) } } };
      });
      persistLayout(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, [layout, persistLayout, commitManual]);

  const resetLayout = useCallback(() => {
    setManual({ cards: {}, groups: {} });
    setSelectedRel(null);
    setMenu(null);
    setQuery("");
    if (window.__currentProjectPath) {
      window.electronAPI.saveCanvasLayout(window.__currentProjectPath, { version: 2, cards: {}, groups: {} }).catch(() => {});
    }
    // Refit after the auto layout lands so the freshly laid-out canvas is in view.
    requestAnimationFrame(() => requestAnimationFrame(() => fitView()));
  }, [fitView]);

  const q = query.trim().toLowerCase();
  const rootName = scan?.root ? scan.root.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : null;
  const menuFile = menu?.kind === "card" ? (effCards.get(menu.rel) || layout.cards.get(menu.rel))?.file : null;
  const menuNode = menu?.kind === "group" ? scanRootsByRel.get(menu.rel) : null;

  return (
    <PanelErrorBoundary>
      <div onContextMenu={(e) => e.preventDefault()} style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "#181818", position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: "#252526", borderBottom: "1px solid #2d2d2d", fontSize: 12, color: "#ccc", flexShrink: 0 }}>
        <span style={{ fontWeight: 600, color: "#4ec9b0", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="#4ec9b0" strokeWidth="1.2" />
            <circle cx="5.5" cy="5.5" r="1.2" fill="#4ec9b0" />
            <circle cx="10.5" cy="5.5" r="1.2" fill="#4ec9b0" />
            <circle cx="5.5" cy="10.5" r="1.2" fill="#4ec9b0" />
            <circle cx="10.5" cy="10.5" r="1.2" fill="#4ec9b0" />
          </svg>
          Canvas
        </span>
        {rootName && <span style={{ color: "#d0d0d0", flexShrink: 0 }}>{rootName}</span>}
        {scan?.framework && FW_LABEL[scan.framework] && (
          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "rgba(78,201,176,.12)", color: "#4ec9b0", border: "1px solid #4ec9b033", flexShrink: 0 }}>
            {FW_LABEL[scan.framework]}
          </span>
        )}
        {scan && (
          <span style={{ color: "#888", fontSize: 11, flexShrink: 0 }}>
            {scan.count} item{scan.count === 1 ? "" : "s"} · {layout.groups.size} group{layout.groups.size === 1 ? "" : "s"}
          </span>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search files…"
          style={{ flex: 1, minWidth: 120, maxWidth: 240, background: "#1e1e1e", color: "#d0d0d0", border: "1px solid #3c3c3c", borderRadius: 2, fontSize: 11, padding: "2px 8px", outline: "none" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button onClick={() => zoomAt(vw / 2, vh / 2, 0.8)} title="Zoom out" style={{ background: "#1e1e1e", border: "1px solid #3c3c3c", borderRadius: 2, color: "#ccc", cursor: "pointer", width: 22, height: 20, fontSize: 12, lineHeight: 1 }}>−</button>
          <span style={{ fontSize: 11, color: "#aaa", minWidth: 38, textAlign: "center" }}>{Math.round(view.z * 100)}%</span>
          <button onClick={() => zoomAt(vw / 2, vh / 2, 1.25)} title="Zoom in" style={{ background: "#1e1e1e", border: "1px solid #3c3c3c", borderRadius: 2, color: "#ccc", cursor: "pointer", width: 22, height: 20, fontSize: 12, lineHeight: 1 }}>+</button>
          <button onClick={fitView} title="Fit all" style={{ background: "#1e1e1e", border: "1px solid #3c3c3c", borderRadius: 2, color: "#ccc", cursor: "pointer", padding: "1px 8px", fontSize: 11 }}>Fit</button>
          <button onClick={() => setView({ x: 60, y: 40, z: 1 })} title="Reset zoom" style={{ background: "#1e1e1e", border: "1px solid #3c3c3c", borderRadius: 2, color: "#ccc", cursor: "pointer", padding: "1px 8px", fontSize: 11 }}>100%</button>
          <button onClick={resetLayout} title="Reset card positions to auto layout" style={{ background: "#1e1e1e", border: "1px solid #3c3c3c", borderRadius: 2, color: "#ccc", cursor: "pointer", padding: "1px 8px", fontSize: 11 }}>Reset Layout</button>
          <button onClick={refreshScan} title="Rescan project" style={{ background: "#1e1e1e", border: "1px solid #3c3c3c", borderRadius: 2, color: "#ccc", cursor: "pointer", padding: "1px 8px", fontSize: 11 }}>⟳ Scan</button>
        </div>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={startPan}
        onContextMenu={(e) => openMenu(e, "canvas")}
        style={{
          flex: 1, overflow: "hidden", position: "relative", cursor: "default", userSelect: "none", touchAction: "none",
          background: "#181818",
          backgroundImage: "radial-gradient(circle, #232323 1px, transparent 1.2px)",
          backgroundSize: `${DOT_SIZE * view.z}px ${DOT_SIZE * view.z}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div
          style={{
            position: "absolute", left: 0, top: 0, transformOrigin: "0 0",
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
            width: 0, height: 0,
          }}
        >
          {[...effGroups.entries()].map(([rel, g]) => {
            if (!visibleGroups.has(rel)) return null;
            const node = scanRootsByRel.get(rel);
            if (!node) return null;
            const k = kindMeta(rel);
            const selected = selectedRel === rel;
            return (
              <div key={rel} onContextMenu={(e) => openMenu(e, "group", rel)} style={{ position: "absolute", left: g.x, top: g.y, width: g.w, height: g.h, border: `1px dashed ${selected ? "#4ec9b0" : "#333"}`, borderRadius: 4, background: "rgba(255,255,255,0.02)", pointerEvents: "auto" }}>
                <div
                  onPointerDown={(e) => { setSelectedRel(rel); startGroupMove(e, rel); }}
                  title={`${node.name} — drag to move`}
                  style={{ display: "flex", alignItems: "center", gap: 6, height: GROUP_HEADER, padding: "0 12px", borderBottom: "1px dashed #2b2b2b", color: "#bdbdbd", fontSize: 12, fontWeight: 600, cursor: "grab", pointerEvents: "auto", userSelect: "none" }}
                >
                  <VscodeIcon name={node.name} isDir={true} isOpen={false} size={14} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
                  <span style={{ color: "#666", fontSize: 10, fontWeight: 400 }}>{node.children.length + countNested(node)}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: k.color, fontWeight: 400, flexShrink: 0 }}>{k.label}</span>
                </div>
                {GROUP_HANDLES.map((h) => (
                  <div
                    key={h.edge}
                    onPointerDown={(e) => startGroupResize(e, rel, h.edge)}
                    title={`Resize ${h.edge.toUpperCase()}`}
                    style={{ position: "absolute", ...h.pos, width: h.w, height: h.h, cursor: h.cursor, pointerEvents: "auto" }}
                  />
                ))}
                <div
                  onPointerDown={(e) => startGroupResize(e, rel, "se")}
                  title="Drag to resize group"
                  style={{ position: "absolute", right: 0, bottom: 0, width: 18, height: 18, cursor: "nwse-resize", pointerEvents: "auto", display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: 3 }}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M12.5 3.5L3.5 12.5M12.5 8L8 12.5" stroke="#555" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            );
          })}

          {[...effCards.entries()].map(([rel, c]) => {
            if (!visibleCards.has(rel)) return null;
            const dim = q && !rel.toLowerCase().includes(q);
            const selected = selectedRel === rel;
            const k = kindMeta(rel);
            return (
              <div
                key={rel}
                onPointerDown={(e) => { setSelectedRel(rel); startCardMove(e, rel); }}
                onContextMenu={(e) => openMenu(e, "card", rel)}
                title={rel}
                style={{
                  position: "absolute", left: c.x, top: c.y, width: c.w, height: c.h,
                  background: "#1f1f1f", border: `1px solid ${selected ? "#4ec9b0" : "#333"}`, borderRadius: 3,
                  boxShadow: "0 4px 14px rgba(0,0,0,.4)", cursor: "pointer",
                  opacity: dim ? 0.22 : 1, display: "flex", flexDirection: "column", overflow: "hidden",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 8px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0 }}>
                  <PreviewIcon entry={{ ...c.file, path: c.file.absPath, isDir: false }} showPreview={true} size={14} />
                  <span style={{ fontSize: 11.5, color: "#e8e8e8", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.file.name}</span>
                  <span style={{ marginLeft: "auto", fontSize: 9.5, color: k.color, background: `${k.color}1a`, border: `1px solid ${k.color}33`, borderRadius: 3, padding: "0 6px", flexShrink: 0 }}>{k.label}</span>
                </div>
                <div style={{ flex: 1, minHeight: 0, padding: 6 }}>
                  <CardPreview file={c.file} rel={rel} liveSourcesRef={liveSourcesRef} onLive={onCardLive} onNatural={onCardNatural} canvasZoom={view.z} showPreview={canvasOpts.showPreview} />
                </div>
                <div
                  onPointerDown={(e) => startCardResize(e, rel)}
                  title="Drag to resize card"
                  style={{ position: "absolute", right: 0, bottom: 0, width: 20, height: 20, cursor: "nwse-resize", display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: 4 }}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                    <path d="M12.5 3.5L3.5 12.5M12.5 8L8 12.5" stroke="#777" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>

        {!rootPath && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#666", fontSize: 13, background: "rgba(24,24,24,.85)" }}>
            <svg width="46" height="46" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="#3c3c3c" strokeWidth="1.2" />
              <circle cx="5.5" cy="5.5" r="1.2" fill="#3c3c3c" />
              <circle cx="10.5" cy="5.5" r="1.2" fill="#3c3c3c" />
              <circle cx="5.5" cy="10.5" r="1.2" fill="#3c3c3c" />
              <circle cx="10.5" cy="10.5" r="1.2" fill="#3c3c3c" />
            </svg>
            <span>No project open</span>
            <button
              onClick={() => window.electronAPI.openFolder()}
              style={{ background: "#007acc", border: "none", color: "#fff", borderRadius: 2, padding: "6px 16px", fontSize: 12, cursor: "pointer" }}
            >
              Open Project
            </button>
            <span style={{ fontSize: 11, color: "#555" }}>The Canvas maps every page &amp; component of your project</span>
          </div>
        )}
        {rootPath && !scanning && scan && scan.roots.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#666", fontSize: 13 }}>
            No previewable files found. Looked in: pages/, components/, views/, widgets/, features/, ui/ (src/ first).
          </div>
        )}
        {scanning && (
          <div style={{ position: "absolute", top: 10, right: 10, color: "#888", fontSize: 11, background: "#1e1e1e", border: "1px solid #333", borderRadius: 2, padding: "3px 8px" }}>
            Scanning…
          </div>
        )}
        {scanError && (
          <div style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 10, background: "#3a1d1d", border: "1px solid #6e2b2b", color: "#f48771", fontSize: 11, borderRadius: 2, padding: "5px 10px", zIndex: 5, maxWidth: "70%" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Scan failed: {scanError}</span>
            <button onClick={() => refreshScan()} style={{ background: "#f48771", color: "#1c1c1c", border: "none", borderRadius: 2, padding: "2px 8px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>Retry</button>
            <button onClick={() => setScanError(null)} style={{ background: "transparent", border: "none", color: "#f48771", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>✕</button>
          </div>
        )}
      </div>

      {menu && (
        <div className="cv-ctx" style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 1000, minWidth: 180, background: "#252526", border: "1px solid #454545", borderRadius: 3, padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}>
          {menu.kind === "card" && menuFile && (
            <>
              <CtxItem label="Open in Editor" onClose={closeMenu} onClick={() => window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { filePath: menuFile.absPath } }))} />
              <CtxItem label="Open in New Editor Tab" onClose={closeMenu} onClick={() => window.dispatchEvent(new CustomEvent("open-file-in-new-editor-tab", { detail: { path: menuFile.absPath } }))} />
              <CtxItem label="Open in System App" onClose={closeMenu} onClick={() => window.electronAPI.openFile(menuFile.absPath, "system")} />
              <CtxItem label="Open Terminal Here" onClose={closeMenu} onClick={() => window.dispatchEvent(new CustomEvent("open-terminal", { detail: { dir: menuFile.absPath.replace(/[\\/][^\\/]*$/, "") } }))} />
              <CtxSep />
              <CtxItem label="Reset Card Size" onClose={closeMenu} onClick={() => resetCardSize(menu.rel)} />
              <CtxSep />
              <CtxItem label="Refresh Scan" onClose={closeMenu} onClick={() => refreshScan()} />
            </>
          )}
          {menu.kind === "group" && menuNode && (
            <>
              <CtxItem label="Open in Terminal" onClose={closeMenu} onClick={() => window.dispatchEvent(new CustomEvent("open-terminal", { detail: { dir: menuNode.absPath } }))} />
              <CtxSep />
              <CtxItem label="Reset Position" onClose={closeMenu} onClick={() => resetGroupPos(menu.rel)} />
            </>
          )}
          {menu.kind === "canvas" && (
            <>
              <CtxItem label="Rescan Project" onClose={closeMenu} onClick={() => refreshScan()} />
              <CtxItem label="Fit All" onClose={closeMenu} onClick={() => fitView()} />
              <CtxSep />
              <CtxItem label="Zoom In" onClose={closeMenu} onClick={() => zoomAt(vw / 2, vh / 2, 1.25)} />
              <CtxItem label="Zoom Out" onClose={closeMenu} onClick={() => zoomAt(vw / 2, vh / 2, 0.8)} />
              <CtxItem label="Reset Zoom (100%)" onClose={closeMenu} onClick={() => setView({ x: 60, y: 40, z: 1 })} />
              <CtxSep />
              <CtxItem label="Reset Layout" danger onClose={closeMenu} onClick={() => resetLayout()} />
            </>
          )}
        </div>
      )}

      <div style={{ padding: "2px 10px", background: "#1c1c1c", borderTop: "1px solid #2a2a2a", color: "#666", fontSize: 10.5, flexShrink: 0 }}>
        Scroll: pan · Shift+Scroll: pan horizontal · Middle-drag/Shift+drag: pan · Drag card: move (push parent edge to expand) · Shift+drag card: move card+group · Drag group header: move · Drag group edge/corner: resize · Click card: open in editor · Right-click: context menu
      </div>
      </div>
    </PanelErrorBoundary>
  );
};

export default CanvasPanel;
