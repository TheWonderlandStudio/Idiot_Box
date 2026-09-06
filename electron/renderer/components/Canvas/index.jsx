import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
import * as ReactDOMPkg from "react-dom";
import * as ReactJSXRuntime from "react/jsx-runtime";
import { Excalidraw } from "@excalidraw/excalidraw";
// NOTE: "./index.css" only exposes development/production export conditions,
// so build-renderer.cjs sets conditions: ["production", ...] for it to resolve.
import "@excalidraw/excalidraw/index.css";
import "./canvas.css";

// ── Canvas (Excalidraw drawing surface) ─────────────────────────────────────
// Replaces the old project-map canvas. Drawings persist as JSON / .excalidraw:
//
//  - File mode:  config.filePath points at a .excalidraw / .json file inside
//    the project. Loaded via fs:readTextFile, saved via fs:writeFile.
//  - Project mode (default): per-project scratch drawing stored through
//    dedicated Electron IPC (canvas:saveDrawing / canvas:loadDrawing) in the
//    app's project storage (userData/projects/<hash>/drawing.excalidraw).
//
// External edits are picked up through the existing chokidar file watcher
// (window.electronAPI.onFsChange) and surface a Reload banner. The live
// drawing lives in refs + React state (dirty / save status / theme).

const SAVE_DEBOUNCE_MS = 800;
const EXCALIDRAW_FILE_RE = /\.excalidraw(\.json)?$|\.excalidraw$/i;

const isExcalidrawFile = (p) => typeof p === "string" && EXCALIDRAW_FILE_RE.test(p);

const normPath = (p) => {
  try {
    return String(p || "").replace(/\\/g, "/");
  } catch {
    return p;
  }
};

const baseName = (p) => {
  try {
    return String(p || "").split(/[\\/]/).pop() || p;
  } catch {
    return p;
  }
};

// Parse .excalidraw JSON into Excalidraw initialData. Tolerates plain
// { elements, appState, files } as well as the full file envelope
// { type: "excalidraw", version, elements, appState, files }.
const parseDrawing = (text) => {
  if (text == null || text === "") return { elements: [], appState: undefined, files: undefined };
  const data = typeof text === "string" ? JSON.parse(text) : text;
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  const appState = data?.appState && typeof data.appState === "object" ? data.appState : undefined;
  const files = data?.files && typeof data.files === "object" ? data.files : undefined;
  return { elements, appState, files };
};

const serializeDrawing = (elements, appState, files) => {
  // Keep only the bits Excalidraw needs; drop collaborators/viewport noise.
  let safeAppState;
  try {
    if (appState && typeof appState === "object") {
      const { collaborators, ...rest } = appState;
      safeAppState = rest;
    }
  } catch {
    safeAppState = undefined;
  }
  return JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "idiot-box-canvas",
      elements: elements || [],
      appState: safeAppState,
      files: files || {},
    },
    null,
    2
  );
};

// ── Project components → live UI embeds ─────────────────────────────────────
// scanCanvas (main process) finds previewable files under pages/components/
// views/widgets/features/ui. Any file can be inserted as an EMBEDDABLE
// element whose overlay (renderEmbeddable) mounts the real bundled component
// — i.e. the actual UI, live on the drawing. The link encodes the rel path
// and customData carries rel+abs, so embeds survive .excalidraw save/load.
const COMP_GROUP_COLORS = {
  pages: "#4ec9b0",
  components: "#569cd6",
  views: "#c586c0",
  widgets: "#dcdcaa",
  features: "#ce9178",
  ui: "#9cdcfe",
};

const flattenScan = (scan) => {
  const out = [];
  const walk = (node, top) => {
    (node.children || []).forEach((c) => out.push({ ...c, top }));
    (node.groups || []).forEach((g) => walk(g, top));
  };
  (scan?.roots || []).forEach((r) => walk(r, r.name || "other"));
  return out;
};

const randId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const randInt = () => Math.floor(Math.random() * 2147483646) + 1;

const EMBED_W = 360;
const EMBED_H = 260;
const EMBED_LINK_ORIGIN = "https://idiotbox.local";

const embedLinkFor = (relPath) => `${EMBED_LINK_ORIGIN}/component/${encodeURIComponent(relPath || "")}`;

const relFromEmbedLink = (link) => {
  try {
    const u = new URL(String(link || ""));
    if (u.origin !== EMBED_LINK_ORIGIN || !u.pathname.startsWith("/component/")) return null;
    return decodeURIComponent(u.pathname.slice("/component/".length));
  } catch {
    return null;
  }
};

// Embeddable element carrying a live project component. The link encodes the
// rel path (and customData carries rel+abs) so it survives .excalidraw
// save/load; renderEmbeddable turns it back into a live preview.
// Missing `index` is repaired by Excalidraw (syncInvalidIndices in updateScene).
const buildComponentEmbed = (file, cx, cy) => {
  const now = Date.now();
  return {
    id: randId("emb"), type: "embeddable",
    x: Math.round(cx - EMBED_W / 2), y: Math.round(cy - EMBED_H / 2),
    width: EMBED_W, height: EMBED_H, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent",
    fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
    roughness: 1, opacity: 100, groupIds: [], frameId: null, index: null,
    roundness: { type: 3 }, boundElements: [],
    link: embedLinkFor(file.relPath), locked: false,
    customData: { source: "idiot-box-component", relPath: file.relPath, absPath: file.absPath },
    updated: now, seed: randInt(), version: 1, versionNonce: randInt(),
  };
};

const resolveEmbedPath = (baseFile, relativePath) => {
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

const runBundledComponent = (code) => {
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
    `${code};\nconst exp = module.exports.default || exports.default || module.exports;\nif (typeof exp === 'function') return exp;\nif (exp && typeof exp === 'object') {\n  for (const k of Object.keys(exp)) {\n    const v = exp[k];\n    if (typeof v === 'function') return v;\n  }\n}\nreturn (typeof App !== 'undefined' ? App : null) || (typeof Component !== 'undefined' ? Component : null);`
  );
  return runner(React, sandboxRequire, exportsObj, moduleObj);
};

class EmbedErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("Canvas embed preview error:", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="comp-embed__error">
          {this.state.error?.message || String(this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

// Live UI preview of one project component, rendered by Excalidraw as the
// overlay for an embeddable element (renderEmbeddable). Bundles the real
// source through main-process esbuild (component:bundle) and mounts it in a
// shadow root so the component's CSS can't leak into the app (or vice versa).
function ComponentEmbed({ element }) {
  const custom = element?.customData || {};
  const relPath = custom.relPath || relFromEmbedLink(element?.link);
  const hostRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [Comp, setComp] = useState(null);
  const [html, setHtml] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const name = relPath ? baseName(relPath) : "component";
  const absPath = useMemo(() => {
    if (custom.absPath) return custom.absPath;
    if (relPath && window.__currentProjectPath) {
      return `${String(window.__currentProjectPath).replace(/\\/g, "/")}/${relPath}`;
    }
    return null;
  }, [custom.absPath, relPath]);

  const isHtml = /\.html$/i.test(absPath || relPath || "");

  // Shadow DOM shell (once per mount) for CSS isolation.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.shadowRoot) return;
    const sr = host.attachShadow({ mode: "open" });
    const mount = document.createElement("div");
    mount.style.width = "100%";
    mount.style.height = "100%";
    mount.style.overflow = "auto";
    mount.style.boxSizing = "border-box";
    mount.style.background = "#fff";
    sr.appendChild(mount);
    const stylesHost = document.createElement("div");
    stylesHost.style.display = "none";
    sr.appendChild(stylesHost);
    host.__mount = mount;
    host.__stylesHost = stylesHost;
    return () => {
      host.__mount = null;
      host.__stylesHost = null;
    };
  }, []);

  // Bundle the component source (or load raw HTML).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      setError(null);
      setComp(null);
      setHtml(null);
      if (!absPath) {
        if (!cancelled) {
          setStatus("error");
          setError(`Cannot resolve path for ${relPath || "component"}`);
        }
        return;
      }
      let source = null;
      try {
        source = await window.electronAPI.readTextFile(absPath);
      } catch {}
      if (cancelled) return;
      if (source == null) {
        setStatus("error");
        setError(`Could not read ${name}`);
        return;
      }
      if (isHtml) {
        setHtml(source);
        setStatus("ready");
        return;
      }
      // Associated CSS: same-name file + imported css files.
      try {
        const host = hostRef.current;
        const inject = (key, css) => {
          if (!host?.shadowRoot || !host.__stylesHost || !key) return;
          const id = `ce-${key.replace(/[^a-zA-Z0-9_]/g, "_")}`;
          let el = host.__stylesHost.querySelector(`#${id}`);
          if (!el) {
            el = document.createElement("style");
            el.id = id;
            host.__stylesHost.appendChild(el);
          }
          el.textContent = css || "";
        };
        const cssImportRe = /(?:import|require)\s*\(?['"]([^'"]+\.(?:css|scss|less|pcss))['"\)]/gi;
        let m;
        while ((m = cssImportRe.exec(source)) !== null) {
          const full = resolveEmbedPath(absPath, m[1]);
          if (full) {
            try {
              const css = await window.electronAPI.readTextFile(full);
              if (cancelled) return;
              if (css != null) inject(full, css);
            } catch {}
          }
        }
        const sameName = absPath.replace(/\.(jsx|tsx|js|ts|vue|svelte)$/i, ".css");
        if (sameName !== absPath) {
          try {
            const css = await window.electronAPI.readTextFile(sameName);
            if (cancelled) return;
            if (css != null) inject(sameName, css);
          } catch {}
        }
      } catch {}
      if (cancelled) return;
      let codeToBundle = source;
      if (!/export\s+default|function|const|class/i.test(source) && /^\s*</.test(source.trim())) {
        codeToBundle = `export default function PreviewSnippet() { return (\n${source}\n); }`;
      }
      if (!window.electronAPI?.bundleComponent) {
        setStatus("error");
        setError("Preview bundler not available — restart the app after `npm install`");
        return;
      }
      let res;
      try {
        res = await window.electronAPI.bundleComponent(codeToBundle, absPath, window.__currentProjectPath);
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(e?.message || String(e) || "Bundling failed");
        }
        return;
      }
      if (cancelled) return;
      if (!res?.ok) {
        setStatus("error");
        setError(res?.error || "Bundling failed");
        return;
      }
      try {
        const evaluated = runBundledComponent(res.code);
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
    })();
    return () => {
      cancelled = true;
    };
  }, [absPath, isHtml, name, relPath, reloadKey]);

  // Mount the bundled component into the shadow root (stable node, no remount).
  // Teardown happens only in the unmount effect below — never here, so a
  // reload can't unmount the live root mid-render.
  useEffect(() => {
    const host = hostRef.current;
    if (!host?.__mount) return;
    if (!host.__root) {
      try {
        host.__root = ReactDOM.createRoot(host.__mount);
      } catch {
        return;
      }
    }
    try {
      if (html != null) {
        host.__root.render(
          <iframe
            srcDoc={html}
            sandbox="allow-scripts allow-same-origin"
            style={{ width: "100%", height: "100%", border: 0, background: "#fff", display: "block" }}
          />
        );
      } else if (Comp) {
        const El = Comp;
        host.__root.render(
          <EmbedErrorBoundary key={`${absPath}:${reloadKey}`}>
            {React.isValidElement(El) ? El : <El />}
          </EmbedErrorBoundary>
        );
      } else {
        host.__root.render(null);
      }
    } catch {}
  }, [Comp, html, absPath, reloadKey]);

  // Full cleanup when the element is deleted from the scene.
  useEffect(() => () => {
    const host = hostRef.current;
    const root = host?.__root;
    if (host) host.__root = null;
    if (root) setTimeout(() => {
      try { root.unmount(); } catch {}
    }, 0);
  }, []);

  const openInEditor = () => {
    if (absPath) {
      window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { filePath: absPath } }));
    }
  };

  return (
    <div className="comp-embed">
      <div className="comp-embed__bar">
        <span className="comp-embed__bar-name" title={relPath || name}>{name}</span>
        <button className="comp-embed__bar-btn" onClick={openInEditor} title={`Open ${relPath || name} in editor`}>
          ↗
        </button>
        <button className="comp-embed__bar-btn" onClick={() => setReloadKey((k) => k + 1)} title="Reload preview">
          ⟳
        </button>
      </div>
      <div className="comp-embed__view">
        <div ref={hostRef} className="comp-embed__shadow" />
        {status === "loading" && <div className="comp-embed__status">Loading {name}…</div>}
        {status === "error" && <div className="comp-embed__error">{error}</div>}
      </div>
    </div>
  );
}

const getCanvasSettings = (settings = {}) => {
  const c = settings.canvas || {};
  const pick = (key, flatKey, fallback) => {
    if (c[key] !== undefined) return c[key];
    if (settings[flatKey] !== undefined) return settings[flatKey];
    return fallback;
  };
  return {
    // "auto" follows the app theme (documentElement data-theme), else forced.
    theme: pick("theme", "canvasTheme", "auto"),
    autosave: pick("autosave", "canvasAutosave", true) !== false,
    gridMode: pick("gridMode", "canvasGridMode", false) === true,
  };
};

const resolveTheme = (themeSetting) => {
  if (themeSetting === "dark") return "dark";
  if (themeSetting === "light") return "light";
  try {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

class CanvasErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    console.error("Canvas (Excalidraw) error:", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="excalidraw-error">
          <div style={{ fontWeight: 600 }}>Canvas error</div>
          <div style={{ fontFamily: "Consolas, monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxWidth: 700 }}>
            {this.state.error?.message || String(this.state.error)}
          </div>
          <button
            className="excalidraw-overlay__btn"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const CanvasPanel = ({ config }) => {
  const filePath = config?.filePath || null;
  const fileMode = isExcalidrawFile(filePath);

  // ── React state: current canvas status ──────────────────────────────────
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const [sceneKey, setSceneKey] = useState(0);
  const [initialData, setInitialData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const [opts, setOpts] = useState(() => getCanvasSettings({}));
  const [theme, setTheme] = useState(() => resolveTheme(getCanvasSettings({}).theme));
  const [rootPath, setRootPath] = useState(() => window.__currentProjectPath || null);
  // ── Project components sidebar ──────────────────────────────────────────
  const [compScan, setCompScan] = useState(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compQuery, setCompQuery] = useState("");
  const [showComps, setShowComps] = useState(true);
  const insertCountRef = useRef(0);

  // Live drawing lives in refs (updated on every stroke without re-render).
  const elementsRef = useRef([]);
  const appStateRef = useRef(null);
  const filesRef = useRef({});
  const saveTimerRef = useRef(null);
  const lastSaveAtRef = useRef(0);
  const suppressSaveRef = useRef(true);
  const mountedRef = useRef(true);
  const stateRef = useRef({ filePath, fileMode, rootPath, autosave: true });
  stateRef.current = { filePath, fileMode, rootPath, autosave: opts.autosave !== false };

  const displayName = fileMode ? baseName(filePath) : rootPath ? `drawing.excalidraw · ${baseName(rootPath)}` : "drawing.excalidraw";

  // ── Settings + theme live sync ──────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    const applyThemeSetting = (s) => {
      const next = getCanvasSettings(s || {});
      setOpts(next);
      setTheme(resolveTheme(next.theme));
    };
    window.electronAPI.readSettings().then(applyThemeSetting).catch(() => {});
    const onPatch = (patch) => {
      if (!patch || typeof patch !== "object") return;
      if (!["canvas", "theme", "canvasTheme", "canvasAutosave", "canvasGridMode", "autosave", "gridMode", "editorTheme"].some((k) => k in patch)) return;
      window.electronAPI.readSettings().then(applyThemeSetting).catch(() => {});
    };
    let bc;
    try {
      bc = new BroadcastChannel("canvas-settings");
      bc.onmessage = (e) => onPatch(e.data);
    } catch {}
    let bcApp;
    try {
      bcApp = new BroadcastChannel("app-settings");
      bcApp.onmessage = (e) => {
        if (e.data?.theme || e.data?.editorTheme) setTheme((t) => resolveTheme(getCanvasSettings({}).theme) || t);
      };
    } catch {}
    let unsub;
    try {
      unsub = window.electronAPI.onSettingsUpdated(onPatch);
    } catch {}
    // App theme flips (light/dark) should re-resolve "auto".
    const obs = new MutationObserver(() => {
      window.electronAPI.readSettings().then((s) => {
        const next = getCanvasSettings(s || {});
        if (next.theme === "auto") setTheme(resolveTheme("auto"));
      }).catch(() => {});
    });
    try {
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    } catch {}
    return () => {
      mountedRef.current = false;
      try { bc?.close(); } catch {}
      try { bcApp?.close(); } catch {}
      try { unsub?.(); } catch {}
      try { obs.disconnect(); } catch {}
    };
  }, []);

  // ── Track project open/close ────────────────────────────────────────────
  useEffect(() => {
    const onOpen = (e) => {
      const p = e.detail?.path || window.__currentProjectPath || null;
      setRootPath(p);
    };
    const onClose = () => setRootPath(null);
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    return () => {
      window.removeEventListener("project:opened", onOpen);
      window.removeEventListener("project:closed", onClose);
    };
  }, []);

  // ── Project components list (insert-into-canvas source) ─────────────────
  const refreshComponents = useCallback(async () => {
    const rp = stateRef.current.rootPath || window.__currentProjectPath || null;
    if (!rp) {
      if (mountedRef.current) setCompScan(null);
      return;
    }
    if (mountedRef.current) setCompLoading(true);
    try {
      const data = await window.electronAPI.scanCanvas(rp);
      if (mountedRef.current && data && !data.error) setCompScan(data);
    } catch {}
    finally {
      if (mountedRef.current) setCompLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshComponents();
  }, [refreshComponents, rootPath]);

  useEffect(() => {
    let timer = null;
    const unsub = window.electronAPI.onFsChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refreshComponents, 2500);
    });
    return () => {
      try { unsub?.(); } catch {}
      if (timer) clearTimeout(timer);
    };
  }, [refreshComponents]);

  const compGroups = useMemo(() => {
    const files = flattenScan(compScan);
    const q = compQuery.trim().toLowerCase();
    const filtered = q
      ? files.filter(
          (f) =>
            (f.relPath || "").toLowerCase().includes(q) ||
            (f.name || "").toLowerCase().includes(q)
        )
      : files;
    const groups = [];
    const map = new Map();
    filtered.forEach((f) => {
      const k = f.top || "other";
      if (!map.has(k)) {
        map.set(k, []);
        groups.push([k, map.get(k)]);
      }
      map.get(k).push(f);
    });
    return { groups, total: files.length };
  }, [compScan, compQuery]);

  // ── Load drawing (file mode or per-project IPC) ─────────────────────────
  const loadDrawing = useCallback(async () => {
    const { filePath: fp, fileMode: fm, rootPath: rp } = stateRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setError(null);
      setExternalChange(false);
    }
    suppressSaveRef.current = true;
    try {
      let text = null;
      if (fm && fp) {
        text = await window.electronAPI.readTextFile(fp);
        if (text == null) {
          // New file that doesn't exist yet — start blank, save on first edit.
          if (mountedRef.current) {
            setInitialData({ elements: [], appState: undefined, files: {} });
            setSceneKey((k) => k + 1);
          }
          elementsRef.current = [];
          appStateRef.current = null;
          filesRef.current = {};
          return;
        }
      } else if (rp) {
        if (typeof window.electronAPI.loadDrawing === "function") {
          const res = await window.electronAPI.loadDrawing(rp);
          text = res?.content ?? res ?? null;
        } else if (typeof window.electronAPI.loadCanvasLayout === "function") {
          // Back-compat fallback — old layout is not a drawing, ignore shape.
          text = null;
        }
      } else {
        text = null;
      }
      const parsed = parseDrawing(text);
      elementsRef.current = parsed.elements || [];
      appStateRef.current = parsed.appState || null;
      filesRef.current = parsed.files || {};
      if (mountedRef.current) {
        setInitialData({
          elements: parsed.elements,
          appState: parsed.appState,
          files: parsed.files,
          scrollToContent: (parsed.elements || []).length > 0,
        });
        setSceneKey((k) => k + 1);
        setDirty(false);
      }
    } catch (err) {
      console.error("[Canvas] load failed:", err);
      if (mountedRef.current) setError(err?.message || String(err));
    } finally {
      if (mountedRef.current) setLoading(false);
      // Let Excalidraw mount + fire its initial onChange before saving.
      setTimeout(() => {
        suppressSaveRef.current = false;
      }, 600);
    }
  }, []);

  useEffect(() => {
    loadDrawing();
  }, [loadDrawing, filePath, rootPath]);

  // ── Save drawing (debounced + manual) ───────────────────────────────────
  const doSave = useCallback(async () => {
    const { filePath: fp, fileMode: fm, rootPath: rp } = stateRef.current;
    if (!fm && !rp) return;
    if (suppressSaveRef.current) return;
    setSaving(true);
    try {
      const payload = serializeDrawing(elementsRef.current, appStateRef.current, filesRef.current);
      if (fm && fp) {
        const res = await window.electronAPI.writeFileText(fp, payload);
        if (res && res.success === false) throw new Error(res.error || "Write failed");
      } else if (rp) {
        if (typeof window.electronAPI.saveDrawing === "function") {
          const res = await window.electronAPI.saveDrawing(rp, payload);
          if (res && res.ok === false) throw new Error(res.error || "Save failed");
        } else {
          await window.electronAPI.saveCanvasLayout(rp, { version: 2, drawing: payload });
        }
      }
      lastSaveAtRef.current = Date.now();
      if (mountedRef.current) {
        setDirty(false);
        setError(null);
      }
    } catch (err) {
      console.error("[Canvas] save failed:", err);
      if (mountedRef.current) setError(err?.message || String(err));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (!stateRef.current.autosave) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(doSave, SAVE_DEBOUNCE_MS);
  }, [doSave]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  // Excalidraw onChange → React state (dirty flag) + refs + autosave.
  const handleChange = useCallback(
    (elements, appState, files) => {
      if (suppressSaveRef.current) {
        elementsRef.current = elements || [];
        appStateRef.current = appState || null;
        filesRef.current = files || {};
        return;
      }
      elementsRef.current = elements || [];
      appStateRef.current = appState || null;
      filesRef.current = files || {};
      setDirty(true);
      scheduleSave();
    },
    [scheduleSave]
  );

  // ── File watcher: external changes reload (with guard for own saves) ────
  useEffect(() => {
    const unsub = window.electronAPI.onFsChange((_affectedDir, changedPath) => {
      try {
        const { filePath: fp, fileMode: fm, rootPath: rp } = stateRef.current;
        const changed = normPath(changedPath);
        if (fm && fp) {
          if (changed === normPath(fp) || changed.endsWith("/" + baseName(fp))) {
            if (Date.now() - lastSaveAtRef.current < 1500) return;
            // Don't clobber unsaved strokes — show a banner instead.
            if (elementsRef.current?.length || dirty) setExternalChange(true);
            else loadDrawing();
          }
          return;
        }
        if (!fm && rp) {
          // Per-project drawing lives in app storage, not the watched tree,
          // but a project-level drawing.excalidraw (if the user keeps one in
          // the project) changing on disk should still surface.
          if (changed.endsWith(".excalidraw") || changed.endsWith(".excalidraw.json")) {
            if (Date.now() - lastSaveAtRef.current < 1500) return;
            setExternalChange(true);
          }
        }
      } catch {}
    });
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, [loadDrawing, dirty]);

  const handleClear = useCallback(() => {
    try {
      excalidrawAPI?.updateScene({ elements: [], appState: { viewBackgroundColor: "#ffffff" } });
    } catch {}
    elementsRef.current = [];
    filesRef.current = {};
    setDirty(true);
    scheduleSave();
  }, [excalidrawAPI, scheduleSave]);

  // Custom overlay for our component embeds. Anything else (e.g. a pasted
  // YouTube link) returns null so Excalidraw falls back to its iframe.
  const renderEmbed = useCallback((element) => {
    const custom = element?.customData || {};
    if (custom.source === "idiot-box-component" || relFromEmbedLink(element?.link)) {
      return <ComponentEmbed key={element.id} element={element} />;
    }
    return null;
  }, []);

  // Insert a project component as a LIVE UI embed at the viewport center.
  // updateScene repairs missing fractional indices and fires onChange,
  // so the insert is autosaved and lands in one undo step (IMMEDIATELY).
  const insertComponentEmbed = useCallback((file) => {
    if (!file || !excalidrawAPI) return;
    try {
      const els = excalidrawAPI.getSceneElements() || [];
      const st = excalidrawAPI.getAppState() || {};
      const zoom = st.zoom?.value || 1;
      const vw = st.width || 800;
      const vh = st.height || 600;
      const n = insertCountRef.current++;
      const stagger = (n % 8) * 28;
      const cx = vw / 2 / zoom - (st.scrollX || 0) + stagger;
      const cy = vh / 2 / zoom - (st.scrollY || 0) + stagger;
      const emb = buildComponentEmbed(file, cx, cy);
      excalidrawAPI.updateScene({
        elements: [...els, emb],
        appState: { selectedElementIds: { [emb.id]: true } },
        captureUpdate: "IMMEDIATELY",
      });
    } catch (err) {
      console.error("[Canvas] insert failed:", err);
    }
  }, [excalidrawAPI]);

  const statusText = loading ? "Loading…" : saving ? "Saving…" : dirty ? "● Unsaved" : "Saved";
  const statusColor = loading || saving ? "#888" : dirty ? "#e6a23c" : "#4ec9b0";

  return (
    <div className="excalidraw-panel">
      <div className="excalidraw-toolbar">
        <span className="excalidraw-toolbar__title">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="#4ec9b0" strokeWidth="1.2" />
            <path d="M4 12L12 4" stroke="#4ec9b0" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Canvas
        </span>
        <span className="excalidraw-toolbar__file" title={fileMode ? filePath : rootPath || ""}>
          {displayName}
        </span>
        <span className="excalidraw-toolbar__status" style={{ color: statusColor }}>
          {statusText}
        </span>
        <span className="excalidraw-toolbar__spacer" />
        <button className="excalidraw-toolbar__btn" onClick={() => setShowComps((s) => !s)} title="Show/hide project components sidebar">
          {showComps ? "Hide Components" : "Components"}
        </button>
        <button className="excalidraw-toolbar__btn" onClick={doSave} disabled={loading || saving || (!fileMode && !rootPath)} title="Save drawing now">
          Save
        </button>
        <button className="excalidraw-toolbar__btn" onClick={loadDrawing} disabled={loading} title="Reload drawing from disk">
          Reload
        </button>
        <button className="excalidraw-toolbar__btn" onClick={handleClear} disabled={loading} title="Clear the canvas">
          Clear
        </button>
      </div>

      <div className="excalidraw-body">
        {showComps && (
          <div className="excalidraw-comps">
            <div className="excalidraw-comps__head">
              <span>Components{compGroups.total ? ` · ${compGroups.total}` : ""}</span>
              <button className="excalidraw-comps__refresh" onClick={refreshComponents} title="Rescan project">
                ⟳
              </button>
            </div>
            <input
              className="excalidraw-comps__search"
              value={compQuery}
              onChange={(e) => setCompQuery(e.target.value)}
              placeholder="Search components…"
            />
            <div className="excalidraw-comps__list">
              {!rootPath && (
                <div className="excalidraw-comps__empty">Open a project to list its components.</div>
              )}
              {rootPath && compLoading && compGroups.total === 0 && (
                <div className="excalidraw-comps__empty">Scanning…</div>
              )}
              {rootPath && !compLoading && compGroups.total === 0 && (
                <div className="excalidraw-comps__empty">
                  No components found in pages/, components/, views/, widgets/, features/, ui/.
                </div>
              )}
              {compGroups.groups.map(([group, files]) => {
                const color = COMP_GROUP_COLORS[group] || COMP_GROUP_COLORS[group.replace(/s$/, "")] || "#888";
                return (
                  <React.Fragment key={group}>
                    <div className="excalidraw-comps__group">{group}</div>
                    {files.map((f) => (
                      <div className="excalidraw-comps__item" key={f.relPath} title={`${f.relPath} — click name to open, + to insert`}>
                        <span className="excalidraw-comps__dot" style={{ background: color }} />
                        <span
                          className="excalidraw-comps__name"
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent("open-file-in-editor", { detail: { filePath: f.absPath } })
                            )
                          }
                        >
                          {f.name}
                        </span>
                        <button
                          className="excalidraw-comps__add"
                          onClick={() => insertComponentEmbed(f)}
                          disabled={!excalidrawAPI || loading}
                          title="Insert live preview on canvas"
                        >
                          +
                        </button>
                      </div>
                    ))}
                  </React.Fragment>
                );
              })}
              {rootPath && compGroups.total > 0 && compGroups.groups.length === 0 && (
                <div className="excalidraw-comps__empty">No match.</div>
              )}
            </div>
            <div className="excalidraw-comps__hint">+ inserts a live UI preview on the canvas</div>
          </div>
        )}
        <div className="excalidraw-host">
        <div className="excalidraw-host__inner">
          <CanvasErrorBoundary>
            {!loading && initialData && (
              <Excalidraw
                key={sceneKey}
                excalidrawAPI={(api) => setExcalidrawAPI(api)}
                initialData={initialData}
                onChange={handleChange}
                theme={theme}
                gridModeEnabled={opts.gridMode === true}
                autoFocus
                validateEmbeddable
                renderEmbeddable={renderEmbed}
                UIOptions={{ canvasActions: { loadScene: false } }}
              />
            )}
          </CanvasErrorBoundary>
        </div>

        {!fileMode && !rootPath && (
          <div className="excalidraw-overlay">
            <span>No project open</span>
            <button className="excalidraw-overlay__btn" onClick={() => window.electronAPI.openFolder()}>
              Open Project
            </button>
            <span style={{ fontSize: 11, color: "#555" }}>Drawings save per-project as .excalidraw JSON</span>
          </div>
        )}

        {loading && (
          <div className="excalidraw-overlay">
            <span>Loading drawing…</span>
          </div>
        )}

        {error && !loading && (
          <div className="excalidraw-banner" style={{ background: "#3a1d1d", borderColor: "#6e2b2b", color: "#f48771" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{error}</span>
            <button className="excalidraw-banner__btn" onClick={loadDrawing}>
              Retry
            </button>
            <button className="excalidraw-banner__btn" onClick={() => setError(null)} style={{ background: "transparent", color: "#f48771" }}>
              ✕
            </button>
          </div>
        )}

        {externalChange && !loading && (
          <div className="excalidraw-banner">
            <span>Drawing changed on disk</span>
            <button
              className="excalidraw-banner__btn"
              onClick={() => {
                setExternalChange(false);
                loadDrawing();
              }}
            >
              Reload
            </button>
            <button className="excalidraw-banner__btn" onClick={() => setExternalChange(false)} style={{ background: "transparent", color: "#e6c65c" }}>
              Dismiss
            </button>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default CanvasPanel;
