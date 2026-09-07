// Notebook panel — Jupyter-like cell UI for .ipynb files.
// No jupyter dependency: execution goes through main-process IPC
// (notebook:execute) backed by a persistent per-file Python process,
// so variables/imports survive across cells until Restart.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Actions } from "flexlayout-react";
import { createConfiguredEditor } from "@codingame/monaco-vscode-api/monaco";
import "./notebook.css";

const uid = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fileName = (p) => { try { return String(p || "").split(/[\\/]/).pop() || p; } catch { return p; } };
const MAX_OUT_CHARS = 100000;

// ipynb `source` / output `text` may be a string or an array of strings.
const toStr = (v) => (Array.isArray(v) ? v.join("") : (v == null ? "" : String(v)));
const toSourceArray = (text) => {
  const s = String(text ?? "");
  if (!s) return [];
  const parts = s.split("\n");
  return parts.map((ln, i) => (i < parts.length - 1 ? ln + "\n" : ln)).filter((ln, i, a) => !(ln === "" && i === a.length - 1));
};

const parseNotebook = (text) => {
  // Empty / brand-new .ipynb (created via New File) → blank notebook, not an error.
  if (text == null || String(text).trim() === "") {
    return { cells: [{ cell_type: "code", metadata: {}, source: "", outputs: [], execution_count: null }], metadata: {}, nbformat: 4, nbformat_minor: 5, fresh: true };
  }
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error("Not valid JSON: " + (e?.message || e)); }
  if (data == null || typeof data !== "object" || !Array.isArray(data.cells)) {
    throw new Error("Not a notebook (missing `cells` array).");
  }
  const cells = data.cells.map((c) => ({
    cell_type: c?.cell_type === "markdown" ? "markdown" : c?.cell_type === "raw" ? "raw" : "code",
    metadata: (c?.metadata && typeof c.metadata === "object") ? c.metadata : {},
    source: toStr(c?.source),
    outputs: Array.isArray(c?.outputs) ? c.outputs : [],
    execution_count: typeof c?.execution_count === "number" ? c.execution_count : null,
  }));
  if (!cells.length) cells.push({ cell_type: "code", metadata: {}, source: "", outputs: [], execution_count: null });
  return {
    cells,
    metadata: (data.metadata && typeof data.metadata === "object") ? data.metadata : {},
    nbformat: data.nbformat || 4,
    nbformat_minor: data.nbformat_minor ?? 5,
    fresh: false,
  };
};

// ── Minimal markdown → HTML (no new deps; file content is the user's own) ──
const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inlineMd = (s) => {
  let h = escapeHtml(s);
  h = h.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2"/>');
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  h = h.replace(/\*([^*\n]+)\*/g, "<em>$1</em>").replace(/(^|\W)_([^_\n]+)_/g, "$1<em>$2</em>");
  h = h.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  h = h.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  return h;
};
const renderMarkdown = (src) => {
  const text = String(src ?? "");
  if (!text.trim()) return '<p style="color:#666">Empty markdown — click to edit.</p>';
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let html = "", i = 0, inCode = false, codeLang = "", codeBuf = [];
  const flushCode = () => { html += "<pre><code>" + escapeHtml(codeBuf.join("\n")) + "</code></pre>"; codeBuf = []; };
  while (i < lines.length) {
    const ln = lines[i];
    const fence = ln.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) { flushCode(); inCode = false; } else { inCode = true; codeLang = fence[1] || ""; }
      i++; continue;
    }
    if (inCode) { codeBuf.push(ln); i++; continue; }
    if (/^\s*$/.test(ln)) { i++; continue; }
    let m;
    if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { html += `<h${m[1].length}>${inlineMd(m[2])}</h${m[1].length}>`; i++; continue; }
    if (/^---+\s*$/.test(ln) || /^\*\*\*+\s*$/.test(ln)) { html += "<hr/>"; i++; continue; }
    if ((m = ln.match(/^&gt;|^\s*>\s?(.*)$/)) && /^\s*>/.test(ln)) { html += `<blockquote>${inlineMd(ln.replace(/^\s*>\s?/, ""))}</blockquote>`; i++; continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(ln)) {
      const ordered = /^\s*\d+[.)]\s+/.test(ln);
      html += ordered ? "<ol>" : "<ul>";
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        html += `<li>${inlineMd(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""))}</li>`; i++;
      }
      html += ordered ? "</ol>" : "</ul>"; continue;
    }
    // table: header row + --- row
    if (ln.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const splitRow = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      html += "<table><thead><tr>" + splitRow(ln).map((c) => `<th>${inlineMd(c)}</th>`).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        html += "<tr>" + splitRow(lines[i]).map((c) => `<td>${inlineMd(c)}</td>`).join("") + "</tr>"; i++;
      }
      html += "</tbody></table>"; continue;
    }
    // paragraph (merge soft-wrapped lines)
    let para = ln;
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*+]|\d+[.)])\s+|\s*>|---+\s*$)/.test(lines[i])) { para += " " + lines[i].trim(); i++; }
    html += `<p>${inlineMd(para)}</p>`;
  }
  if (inCode) flushCode();
  return html;
};

// Kernel result → nbformat outputs (also what we render + save).
const kernelToOutputs = (res) => {
  const outs = [];
  if (res?.stdout) outs.push({ output_type: "stream", name: "stdout", text: toSourceArray(res.stdout) });
  if (res?.stderr) outs.push({ output_type: "stream", name: "stderr", text: toSourceArray(res.stderr) });
  if (res?.status === "error" && res?.error) {
    outs.push({ output_type: "error", ename: res.error.ename || "Error", evalue: res.error.evalue || "", traceback: res.error.traceback || [] });
  } else if (res?.result != null) {
    outs.push({ output_type: "execute_result", execution_count: res.execution_count ?? null, data: { "text/plain": toSourceArray(res.result) }, metadata: {} });
  }
  for (const d of res?.displays || []) {
    const data = {};
    if (d["image/png"]) data["image/png"] = d["image/png"];
    if (d["image/svg+xml"]) data["image/svg+xml"] = d["image/svg+xml"];
    if (d["text/html"]) data["text/html"] = d["text/html"];
    if (d["text/plain"] && !data["text/html"]) data["text/plain"] = d["text/plain"];
    if (Object.keys(data).length) outs.push({ output_type: "display_data", data, metadata: {} });
  }
  return outs;
};

if (!window.__ibxNotebookDirty) window.__ibxNotebookDirty = new Map();
window.__ibxIsNotebookDirty = (p) => { try { return !!window.__ibxNotebookDirty.get(p); } catch { return false; } };
window.__ibxForgetNotebookDirty = (p) => { try { window.__ibxNotebookDirty.delete(p); } catch {} };

// ── Per-cell Monaco (python) ─────────────────────────────────────────────
// Cells reuse the SAME vscode services + python grammar as the main Editor
// (window.__ibxEditorReady from Editor/index.jsx) — no second initialize(),
// no CDN loader. If services never become ready, cells fall back to a plain
// textarea so the notebook stays usable.
if (!window.MonacoEnvironment) {
  window.MonacoEnvironment = {
    getWorker: (_moduleId, label) => {
      if (label === "TextMateWorker") return new Worker("./textmate.worker.js");
      if (label === "typescript" || label === "javascript") return new Worker("./ts.worker.js");
      if (label === "json") return new Worker("./json.worker.js");
      if (label === "html" || label === "handlebars" || label === "razor") return new Worker("./html.worker.js");
      if (label === "css" || label === "scss" || label === "less") return new Worker("./css.worker.js");
      return new Worker("./editor.worker.js");
    },
    getWorkerUrl: (_moduleId, label) => {
      if (label === "webWorkerExtensionHostIframe") return "./worker/webWorkerExtensionHostIframe.html";
      return undefined;
    },
  };
}

const awaitEditorReady = (timeoutMs) =>
  new Promise((resolve, reject) => {
    const p = window.__ibxEditorReady;
    const timer = setTimeout(() => reject(new Error("editor init timeout")), timeoutMs || 20000);
    const done = () => { clearTimeout(timer); resolve(true); };
    if (p && typeof p.then === "function") {
      p.then(done, () => { clearTimeout(timer); reject(new Error("editor init failed")); });
    } else {
      // Editor module not evaluated yet — wait for its ready broadcast.
      window.addEventListener("monaco:ready", done, { once: true });
    }
  });

const nbWithMonoFallback = (f) => {
  const s = String(f || "").trim();
  if (!s) return s;
  return /monospace/i.test(s) ? s : `${s}, monospace`;
};

// Mirror of the main Editor's font settings (live-synced). Theme itself flows
// through the shared theme service, so cells always match the Editor theme.
const useNbEditorSettings = () => {
  const [s, setS] = useState({
    fontSize: 13,
    fontFamily: 'Consolas, "Courier New", monospace',
    tabSize: 4,
    wordWrap: "on",
    lineNumbers: "on",
  });
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.readSettings().then((all) => {
      if (cancelled || !all) return;
      setS({
        fontSize: Number.isFinite(all.fontSize) ? Math.min(32, Math.max(8, all.fontSize)) : 13,
        fontFamily: all.fontFamily ? nbWithMonoFallback(all.fontFamily) : 'Consolas, "Courier New", monospace',
        tabSize: Number.isFinite(all.tabSize) ? all.tabSize : 4,
        wordWrap: all.wordWrap !== false ? "on" : "off",
        lineNumbers: all.lineNumbers !== false ? "on" : "off",
      });
    }).catch(() => {});
    const h = (patch) => {
      if (!patch || typeof patch !== "object") return;
      if (!["fontSize", "fontFamily", "tabSize", "wordWrap", "lineNumbers", "minimap"].some((k) => k in patch)) return;
      setS((prev) => {
        const next = { ...prev };
        if ("fontSize" in patch && Number.isFinite(patch.fontSize)) next.fontSize = Math.min(32, Math.max(8, patch.fontSize));
        if ("fontFamily" in patch && patch.fontFamily) next.fontFamily = nbWithMonoFallback(patch.fontFamily);
        if ("tabSize" in patch && Number.isFinite(patch.tabSize)) next.tabSize = patch.tabSize;
        if ("wordWrap" in patch) next.wordWrap = patch.wordWrap !== false ? "on" : "off";
        if ("lineNumbers" in patch) next.lineNumbers = patch.lineNumbers !== false ? "on" : "off";
        return next;
      });
    };
    let bc1 = null, bc2 = null, unsub = null;
    try { bc1 = new BroadcastChannel("editor-settings"); bc1.onmessage = (e) => h(e.data); } catch {}
    try { bc2 = new BroadcastChannel("app-settings"); bc2.onmessage = (e) => h(e.data); } catch {}
    try { unsub = window.electronAPI?.onSettingsUpdated?.(h); } catch {}
    return () => { cancelled = true; try { bc1?.close(); } catch {} try { bc2?.close(); } catch {} try { unsub?.(); } catch {} };
  }, []);
  return s;
};

const NB_MONACO_MAX_H = 480;
const NB_MONACO_MIN_H = 46;

// One Monaco instance per code cell. Created once (keyed by cell.id upstream);
// value/settings sync via effects, never recreation. Reports text changes up;
// Shift/Ctrl/Alt+Enter are intercepted by the wrapper (capture phase) so no
// monaco keybinding constants are needed.
const CodeCellEditor = ({ cellId, value, settings, onChange, onRunKey, onMonacoFailed, registerEditor, onFocusCell }) => {
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRunKeyRef = useRef(onRunKey);
  onRunKeyRef.current = onRunKey;
  const onFailedRef = useRef(onMonacoFailed);
  onFailedRef.current = onMonacoFailed;

  // create once
  useEffect(() => {
    let cancelled = false;
    let editor = null;
    let contentSub = null, sizeSub = null;
    let t1 = null, t2 = null;
    const host = hostRef.current;
    if (!host) return undefined;
    const layoutToContent = () => {
      try {
        if (!editor || cancelled) return;
        const h = Math.min(NB_MONACO_MAX_H, Math.max(NB_MONACO_MIN_H, editor.getContentHeight()));
        host.style.height = h + "px";
        editor.layout({ width: Math.max(host.clientWidth, 1), height: h });
      } catch {}
    };
    (async () => {
      try {
        await awaitEditorReady(20000);
      } catch {
        if (!cancelled) { try { onFailedRef.current?.(); } catch {} }
        return;
      }
      if (cancelled || !hostRef.current) return;
      try {
        editor = createConfiguredEditor(hostRef.current, {
          value: value ?? "",
          language: "python",
          automaticLayout: true,
          minimap: { enabled: false },
          wordWrap: settings.wordWrap || "on",
          lineNumbers: settings.lineNumbers || "on",
          fontSize: settings.fontSize || 13,
          fontFamily: settings.fontFamily || 'Consolas, "Courier New", monospace',
          tabSize: settings.tabSize || 4,
          insertSpaces: true,
          detectIndentation: false,
          scrollBeyondLastLine: false,
          scrollbar: { vertical: "auto", horizontal: "auto", useShadows: false },
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          glyphMargin: false,
          folding: true,
          lineDecorationsWidth: 4,
          lineNumbersMinChars: 3,
          padding: { top: 6, bottom: 6 },
          renderLineHighlight: "none",
          smoothScrolling: true,
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          stickyScroll: { enabled: false },
          fixedOverflowWidgets: true,
        });
      } catch {
        if (!cancelled) { try { onFailedRef.current?.(); } catch {} }
        return;
      }
      if (cancelled) { try { editor.dispose(); } catch {} return; }
      editorRef.current = editor;
      try { registerEditor?.(cellId, editor); } catch {}
      contentSub = editor.onDidChangeModelContent(() => {
        try { onChangeRef.current?.(editor.getValue()); } catch {}
      });
      try { sizeSub = editor.onDidContentSizeChange(() => layoutToContent()); } catch {}
      layoutToContent();
      t1 = setTimeout(layoutToContent, 120);
      t2 = setTimeout(layoutToContent, 500);
    })();
    return () => {
      cancelled = true;
      try { clearTimeout(t1); } catch {}
      try { clearTimeout(t2); } catch {}
      try { contentSub?.dispose(); } catch {}
      try { sizeSub?.dispose(); } catch {}
      try { registerEditor?.(cellId, null); } catch {}
      try {
        const m = editor?.getModel?.();
        try { editor?.dispose(); } catch {}
        try { m?.dispose?.(); } catch {}
      } catch {}
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellId]);

  // external value sync (disk reload) — no-op for own keystrokes (equal strings)
  useEffect(() => {
    try {
      const ed = editorRef.current;
      if (ed && value !== undefined && ed.getValue() !== value) ed.setValue(value ?? "");
    } catch {}
  }, [value]);

  // live settings sync (no recreation)
  useEffect(() => {
    try {
      editorRef.current?.updateOptions?.({
        wordWrap: settings.wordWrap || "on",
        lineNumbers: settings.lineNumbers || "on",
        fontSize: settings.fontSize || 13,
        fontFamily: settings.fontFamily || 'Consolas, "Courier New", monospace',
        tabSize: settings.tabSize || 4,
      });
    } catch {}
  }, [settings]);

  return (
    <div
      className="nb-codewrap"
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.altKey) && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          try { onFocusCell?.(); } catch {}
          try { onRunKeyRef.current?.(e.altKey ? "alt" : e.shiftKey ? "shift" : "ctrl"); } catch {}
        }
      }}
    >
      <div className="nb-codewrap__gutter" />
      <div ref={hostRef} className="nb-monaco" style={{ height: NB_MONACO_MIN_H }} />
    </div>
  );
};

const NotebookPanel = ({ config, nodeId }) => {
  const filePath = config?.filePath || null;
  const [hasProject, setHasProject] = useState(!!window.__currentProjectPath);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [cells, setCells] = useState([]);
  const [nbMeta, setNbMeta] = useState({ metadata: {}, nbformat: 4, nbformat_minor: 5 });
  const [dirty, setDirty] = useState(false);
  const [kernel, setKernel] = useState({ status: "starting", python: "", version: "" });
  const [statusMsg, setStatusMsg] = useState(null);
  const [isErrMsg, setIsErrMsg] = useState(false);
  const [mdEditing, setMdEditing] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [externalChange, setExternalChange] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [monacoFailed, setMonacoFailed] = useState(false);
  const edSettings = useNbEditorSettings();

  const cellsRef = useRef([]);
  const originalRef = useRef("");
  const loadedRef = useRef(false);
  const lastSelfSaveRef = useRef(0);
  const saveTimer = useRef(null);
  const autoSaveRef = useRef(false);
  const taRefs = useRef(new Map());
  const editorRefs = useRef(new Map());
  const pathRef = useRef(filePath);
  pathRef.current = filePath;
  cellsRef.current = cells;

  // Focus a cell's editor (Monaco first, textarea fallback).
  const focusCellById = useCallback((id) => {
    if (!id) return;
    try { const ed = editorRefs.current.get(id); if (ed) { ed.focus?.(); return; } } catch {}
    try { taRefs.current.get(id)?.focus?.(); } catch {}
  }, []);

  const flash = (msg, isErr) => {
    setStatusMsg(msg); setIsErrMsg(!!isErr);
    setTimeout(() => setStatusMsg(null), 3500);
  };

  const markDirty = useCallback((isDirty, nextCells) => {
    const p = pathRef.current;
    setDirty(isDirty);
    try {
      if (!p) return;
      if (isDirty) window.__ibxNotebookDirty.set(p, true);
      else window.__ibxNotebookDirty.delete(p);
      const m = window.__flexModel?.current;
      if (m && nodeId) {
        const base = fileName(p);
        try { m.doAction(Actions.updateNodeAttributes(nodeId, { name: isDirty ? base + " ●" : base })); } catch {}
      }
    } catch {}
  }, [nodeId]);

  const mutateCells = useCallback((fn, mark = true) => {
    setCells((prev) => {
      const next = fn(prev.map((c) => ({ ...c, outputs: [...(c.outputs || [])] })));
      if (mark) setTimeout(() => markDirty(true, next), 0);
      return next;
    });
  }, [markDirty]);

  // ── Project gate ──
  useEffect(() => {
    setHasProject(!!window.__currentProjectPath);
    const onOpen = () => setHasProject(true);
    const onClose = () => setHasProject(false);
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    return () => { window.removeEventListener("project:opened", onOpen); window.removeEventListener("project:closed", onClose); };
  }, []);

  // ── Autosize plain textareas (Monaco cells size themselves) ──
  const autosizeAll = useCallback(() => {
    try {
      for (const ta of taRefs.current.values()) {
        if (!ta || !ta.isConnected || ta.tagName !== "TEXTAREA") continue;
        ta.style.height = "auto";
        ta.style.height = Math.max(44, ta.scrollHeight) + "px";
      }
    } catch {}
  }, []);
  useEffect(() => { const t = setTimeout(autosizeAll, 30); return () => clearTimeout(t); }, [cells, autosizeAll]);

  // ── Load notebook ──
  const loadNotebook = useCallback(async (quiet) => {
    const fp = pathRef.current;
    if (!fp) { setLoading(false); return; }
    if (!quiet) { setLoading(true); setLoadError(null); }
    try {
      const text = await window.electronAPI.readTextFile(fp);
      if (text === null) { setLoadError("Could not read file (missing or binary)."); setLoading(false); return; }
      const parsed = parseNotebook(text);
      const withIds = parsed.cells.map((c) => ({ ...c, id: uid(), running: false }));
      setCells(withIds);
      setNbMeta({ metadata: parsed.metadata, nbformat: parsed.nbformat, nbformat_minor: parsed.nbformat_minor });
      originalRef.current = parsed.fresh ? "" : text;
      loadedRef.current = true;
      markDirty(!!parsed.fresh, withIds);
      setExternalChange(false);
      if (parsed.fresh) flash("New notebook — add cells and press Save (Ctrl+S).");
    } catch (e) {
      setLoadError(e?.message || String(e));
      loadedRef.current = false;
    } finally {
      setLoading(false);
      setTimeout(autosizeAll, 50);
    }
  }, [markDirty, autosizeAll]);

  useEffect(() => { loadNotebook(); }, [filePath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Kernel info ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setKernel((k) => ({ ...k, status: "starting" }));
      try {
        const info = await window.electronAPI.notebookCheckPython?.();
        if (cancelled) return;
        if (info?.ok) setKernel({ status: "idle", python: info.python, version: info.version });
        else setKernel({ status: "error", python: "", version: info?.error || "Python not found" });
      } catch (e) {
        if (!cancelled) setKernel({ status: "error", python: "", version: String(e?.message || e) });
      }
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  // ── Settings: autosave ──
  useEffect(() => {
    window.electronAPI.readSettings().then((s) => {
      const enabled = s?.autoSave === true || s?.autoSave === "afterDelay";
      autoSaveRef.current = enabled; setAutoSave(enabled);
    }).catch(() => {});
    const h = (patch) => {
      if (patch && typeof patch === "object" && "autoSave" in patch) {
        const enabled = patch.autoSave === true || patch.autoSave === "afterDelay";
        autoSaveRef.current = enabled; setAutoSave(enabled);
      }
    };
    let unsub = null;
    try { unsub = window.electronAPI?.onSettingsUpdated?.(h); } catch {}
    return () => { try { unsub?.(); } catch {} };
  }, []);

  // ── External changes ──
  useEffect(() => {
    if (!filePath) return;
    const unsub = window.electronAPI.onFsChange((_dir, changedPath) => {
      if (changedPath !== filePath) return;
      if (Date.now() - lastSelfSaveRef.current < 1500) return;
      if (window.__ibxNotebookDirty.get(filePath)) { setExternalChange(true); return; }
      loadNotebook(true);
      flash("File changed on disk — reloaded.");
    });
    return () => { try { unsub(); } catch {} };
  }, [filePath, loadNotebook]);

  // ── Serialize + save ──
  const nbMetaRef = useRef(nbMeta);
  nbMetaRef.current = nbMeta;
  const serialize = useCallback((list, meta) => {
    const obj = {
      cells: (list || cellsRef.current).map((c) => {
        if (c.cell_type === "code") {
          return { cell_type: "code", metadata: c.metadata || {}, source: toSourceArray(c.source), outputs: c.outputs || [], execution_count: c.execution_count ?? null };
        }
        return { cell_type: c.cell_type, metadata: c.metadata || {}, source: toSourceArray(c.source) };
      }),
      metadata: (meta || nbMetaRef.current).metadata || {},
      nbformat: (meta || nbMetaRef.current).nbformat || 4,
      nbformat_minor: (meta || nbMetaRef.current).nbformat_minor ?? 5,
    };
    // Jupyter default kernelspec when missing (so GitHub/nbviewer render python).
    if (!obj.metadata.kernelspec) obj.metadata.kernelspec = { display_name: "Python 3", language: "python", name: "python3" };
    if (!obj.metadata.language_info) obj.metadata.language_info = { name: "python", version: kernel.version || "3" };
    return JSON.stringify(obj, null, 1) + "\n";
  }, [kernel.version]);

  const doSave = useCallback(async () => {
    const p = pathRef.current;
    if (!p || !loadedRef.current) return;
    try {
      const text = serialize();
      const res = await window.electronAPI.writeFileText(p, text);
      if (res?.success) {
        lastSelfSaveRef.current = Date.now();
        originalRef.current = text;
        markDirty(false);
        setExternalChange(false);
        flash("Saved: " + fileName(p));
      } else {
        flash("Save failed: " + (res?.error || "unknown"), true);
      }
    } catch (e) { flash("Save failed: " + (e?.message || e), true); }
  }, [markDirty, serialize]);

  const scheduleAutosave = useCallback(() => {
    if (!autoSaveRef.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { doSave(); }, 1500);
  }, [doSave]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Ctrl+S + menu Save dispatch
  useEffect(() => {
    const onCmd = (e) => {
      const cmd = e.detail?.cmd;
      if ((cmd === "save" || cmd === "saveAs") && (e.detail?.path ?? null) === pathRef.current) {
        if (cmd === "save") doSave();
        else flash("Use File → Save As from the text editor for a copy; notebook saves in place.", false);
      }
    };
    window.addEventListener("editor:command", onCmd);
    return () => window.removeEventListener("editor:command", onCmd);
  }, [doSave]);

  // ── Run ──
  const runCell = useCallback(async (index) => {
    const list = cellsRef.current;
    const cell = list[index];
    if (!cell || cell.cell_type !== "code" || cell.running) return;
    if (kernel.status === "error") { flash("Python not found — install Python 3 and restart the app.", true); return; }
    mutateCells((prev) => prev.map((c, i) => (i === index ? { ...c, running: true } : c)), false);
    setKernel((k) => ({ ...k, status: "busy" }));
    try {
      const res = await window.electronAPI.notebookExecute({ filePath: pathRef.current, code: cell.source });
      if (!res || res.ok === false) {
        const msg = res?.error || "Execution failed";
        mutateCells((prev) => prev.map((c, i) => (i === index ? {
          ...c, running: false,
          outputs: [{ output_type: "error", ename: "KernelError", evalue: msg, traceback: [] }],
        } : c)));
        flash(msg, true);
        if (/restart/i.test(msg)) setKernel((k) => ({ ...k, status: "idle" }));
        return;
      }
      const outs = kernelToOutputs(res);
      mutateCells((prev) => prev.map((c, i) => (i === index ? {
        ...c, running: false, outputs: outs,
        execution_count: typeof res.execution_count === "number" ? res.execution_count : c.execution_count,
      } : c)));
      setKernel((k) => ({ ...k, status: "idle" }));
      scheduleAutosave();
    } catch (e) {
      mutateCells((prev) => prev.map((c, i) => (i === index ? { ...c, running: false } : c)), false);
      flash("Run failed: " + (e?.message || e), true);
    } finally {
      setKernel((k) => (cellsRef.current.some((c) => c.running) ? k : { ...k, status: k.status === "error" ? "error" : "idle" }));
    }
  }, [kernel.status, mutateCells, scheduleAutosave]);

  const runAll = useCallback(async () => {
    for (let i = 0; i < cellsRef.current.length; i++) {
      if (cellsRef.current[i]?.cell_type === "code") await runCell(i);
    }
  }, [runCell]);

  const restartKernel = useCallback(async (clear) => {
    try {
      await window.electronAPI.notebookRestart({ filePath: pathRef.current });
      if (clear) {
        mutateCells((prev) => prev.map((c) => ({ ...c, outputs: [], execution_count: null, running: false })));
      } else {
        mutateCells((prev) => prev.map((c) => ({ ...c, running: false })), false);
      }
      setKernel((k) => ({ ...k, status: "idle" }));
      flash(clear ? "Kernel restarted — outputs cleared." : "Kernel restarted — variables cleared.");
    } catch (e) { flash("Restart failed: " + (e?.message || e), true); }
  }, [mutateCells]);

  const clearAllOutputs = useCallback(() => {
    mutateCells((prev) => prev.map((c) => ({ ...c, outputs: [], execution_count: null })));
    scheduleAutosave();
  }, [mutateCells, scheduleAutosave]);

  // ── Cell ops ──
  const insertCell = useCallback((at, type) => {
    const nc = { id: uid(), cell_type: type, metadata: {}, source: "", outputs: [], execution_count: null, running: false };
    setCells((prev) => { const next = [...prev]; next.splice(Math.max(0, Math.min(at, next.length)), 0, nc); return next; });
    setTimeout(() => markDirty(true), 0);
    if (type === "markdown") setMdEditing((m) => ({ ...m, [nc.id]: true }));
    scheduleAutosave();
  }, [markDirty, scheduleAutosave]);

  const deleteCell = useCallback((index) => {
    setCells((prev) => {
      if (prev.length <= 1) return [{ id: uid(), cell_type: "code", metadata: {}, source: "", outputs: [], execution_count: null, running: false }];
      return prev.filter((_, i) => i !== index);
    });
    setTimeout(() => markDirty(true), 0);
    scheduleAutosave();
  }, [markDirty, scheduleAutosave]);

  const moveCell = useCallback((index, dir) => {
    setCells((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev]; const [c] = next.splice(index, 1); next.splice(j, 0, c);
      return next;
    });
    setTimeout(() => markDirty(true), 0);
    scheduleAutosave();
  }, [markDirty, scheduleAutosave]);

  const setCellType = useCallback((index, type) => {
    mutateCells((prev) => prev.map((c, i) => (i === index ? { ...c, cell_type: type, outputs: type === "code" ? c.outputs : [], execution_count: type === "code" ? c.execution_count : null } : c)));
    scheduleAutosave();
  }, [mutateCells, scheduleAutosave]);

  const setCellSource = useCallback((index, source) => {
    setCells((prev) => prev.map((c, i) => (i === index ? { ...c, source } : c)));
    setTimeout(() => markDirty(true), 0);
    scheduleAutosave();
    // grow the edited plain textarea immediately (Monaco sizes itself)
    requestAnimationFrame(() => {
      try {
        const list = cellsRef.current;
        const id = list[index]?.id;
        const el = id && taRefs.current.get(id);
        if (el && el.tagName === "TEXTAREA") { el.style.height = "auto"; el.style.height = Math.max(44, el.scrollHeight) + "px"; }
      } catch {}
    });
  }, [markDirty, scheduleAutosave]);

  // Shared run-key behavior for Monaco cells AND the textarea fallback:
  // shift = run + advance (creates a cell at the end), ctrl = run in place,
  // alt = run + insert below.
  const handleCellRunKey = useCallback((index, mode) => {
    if (mode === "ctrl") { runCell(index); return; }
    runCell(index).then(() => {
      if (mode === "shift") {
        const nextIdx = index + 1;
        if (nextIdx < cellsRef.current.length) {
          setSelectedId(cellsRef.current[nextIdx].id);
          focusCellById(cellsRef.current[nextIdx].id);
        } else {
          insertCell(nextIdx, "code");
          setTimeout(() => {
            try {
              const l = cellsRef.current;
              const last = l[l.length - 1];
              if (last) { setSelectedId(last.id); focusCellById(last.id); }
            } catch {}
          }, 80);
        }
      } else if (mode === "alt") {
        insertCell(index + 1, "code");
        setTimeout(() => {
          try {
            const l = cellsRef.current;
            const nc = l[index + 1];
            if (nc) { setSelectedId(nc.id); focusCellById(nc.id); }
          } catch {}
        }, 80);
      }
    });
  }, [runCell, insertCell, focusCellById]);

  const onCodeKeyDown = (e, index) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: en, value } = el;
      const next = value.slice(0, s) + "    " + value.slice(en);
      setCellSource(index, next);
      requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = s + 4; } catch {} });
    } else if (e.key === "Enter" && (e.shiftKey || e.ctrlKey) && !e.altKey) {
      e.preventDefault();
      handleCellRunKey(index, e.shiftKey ? "shift" : "ctrl");
    } else if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      handleCellRunKey(index, "alt");
    }
  };

  const renderOutput = (out, key) => {
    const txt = toStr(out.text ?? out.data?.["text/plain"] ?? "");
    const capped = txt.length > MAX_OUT_CHARS;
    const shown = capped ? txt.slice(0, MAX_OUT_CHARS) : txt;
    if (out.output_type === "stream") {
      const isErr = out.name === "stderr";
      return (
        <div key={key} className={"nb-out " + (isErr ? "nb-out--stderr" : "nb-out--stdout")}>
          <span className="nb-out__label">{isErr ? "err" : "out"}</span>{shown}
          {capped && <div className="nb-truncated">… truncated ({((txt.length - MAX_OUT_CHARS) / 1024).toFixed(0)} KB more — output kept in file)</div>}
        </div>
      );
    }
    if (out.output_type === "error") {
      const tb = [...(out.traceback || [])].join("");
      return (
        <div key={key} className="nb-out nb-out--error">
          <span className="nb-out__label">err</span>{(tb || `${out.ename || ""}: ${out.evalue || ""}`).slice(0, MAX_OUT_CHARS)}
        </div>
      );
    }
    if (out.output_type === "execute_result") {
      return (
        <div key={key} className="nb-out nb-out--result">
          <span className="nb-out__label">Out[{out.execution_count ?? " "}]</span>{shown}
        </div>
      );
    }
    if (out.output_type === "display_data" || out.output_type === "update_display_data") {
      const data = out.data || {};
      if (data["image/png"]) return (<div key={key} className="nb-out"><img alt="" src={"data:image/png;base64," + data["image/png"]} /></div>);
      if (data["image/svg+xml"]) return (<div key={key} className="nb-out"><img alt="" src={"data:image/svg+xml;utf8," + encodeURIComponent(toStr(data["image/svg+xml"]))} /></div>);
      if (data["text/html"]) return (<div key={key} className="nb-out"><iframe title="html output" sandbox="allow-same-origin" srcDoc={toStr(data["text/html"])} /></div>);
      if (data["text/plain"]) return (<div key={key} className="nb-out nb-out--stdout">{toStr(data["text/plain"]).slice(0, MAX_OUT_CHARS)}</div>);
      return null;
    }
    return null;
  };

  if (!hasProject) {
    return (
      <div className="nb-panel" style={{ alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#666", fontWeight: 600, fontSize: 13 }}>No project open</span>
        <span style={{ color: "#444", fontSize: 11 }}>Open a project, then select a .ipynb file.</span>
        <button className="nb-btn" onClick={() => window.electronAPI.openFolder()}>Open Folder…</button>
      </div>
    );
  }

  if (!filePath) {
    return (<div className="nb-panel"><div className="nb-empty">Select a .ipynb file in the Project panel.</div></div>);
  }

  return (
    <div className="nb-panel" onKeyDownCapture={(e) => {
      // Capture (not bubble): a focused Monaco cell would otherwise consume
      // Ctrl+S before it reaches us.
      if ((e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "s") { e.preventDefault(); e.stopPropagation(); doSave(); }
    }}>
      {/* toolbar */}
      <div className="nb-toolbar">
        <span className="nb-toolbar__title" title={filePath}>▦ {fileName(filePath)}{dirty ? " ●" : ""}</span>
        <span className="nb-kernel" title={kernel.python ? `${kernel.python} ${kernel.version}` : kernel.version}>
          <span className={"nb-kernel__dot " + (kernel.status === "idle" ? "nb-kernel__dot--idle" : kernel.status === "busy" ? "nb-kernel__dot--busy" : kernel.status === "starting" ? "nb-kernel__dot--starting" : "nb-kernel__dot--error")} />
          {kernel.status === "idle" ? `Python ${kernel.version || ""}`.trim() : kernel.status === "busy" ? "Running…" : kernel.status === "starting" ? "Starting…" : "No Python"}
        </span>
        <span className="nb-toolbar__spacer" />
        <button className="nb-btn nb-btn--primary" onClick={doSave} title="Save notebook (Ctrl+S)">Save</button>
        <button className="nb-btn" onClick={runAll} title="Run all cells top to bottom">▶ Run All</button>
        <button className="nb-btn" onClick={() => restartKernel(false)} title="Restart kernel (clear variables, keep outputs)">↻ Restart</button>
        <button className="nb-btn" onClick={() => restartKernel(true)} title="Restart kernel + clear all outputs">↻+Clear</button>
        <button className="nb-btn nb-btn--danger" onClick={clearAllOutputs} title="Clear all outputs">Clear</button>
        <button className="nb-btn" onClick={() => insertCell(cells.length, "code")} title="Add code cell at end">+ Code</button>
        <button className="nb-btn" onClick={() => insertCell(cells.length, "markdown")} title="Add markdown cell at end">+ Text</button>
      </div>
      {statusMsg && <div className="nb-status" style={{ padding: "2px 12px", color: isErrMsg ? "#f48771" : "#4ec9b0" }}>{statusMsg}</div>}
      {kernel.status === "error" && (
        <div className="nb-banner nb-banner--error">
          <span style={{ flex: 1 }}>{kernel.version || "Python 3 not found on PATH — cells can't run. Install Python, then restart the app."}</span>
        </div>
      )}
      {loadError ? (
        <div className="nb-banner nb-banner--error">
          <span style={{ flex: 1 }}>Couldn't parse as notebook: {loadError}</span>
          <button className="nb-btn" onClick={() => window.dispatchEvent(new CustomEvent("open-file-in-new-editor-tab", { detail: { path: filePath, forceText: true } }))}>Open as JSON</button>
          <button className="nb-btn" onClick={() => loadNotebook()}>Retry</button>
        </div>
      ) : null}
      {externalChange && (
        <div className="nb-banner">
          <span style={{ flex: 1 }}>Changed on disk.</span>
          <button className="nb-btn" onClick={() => loadNotebook()}>Reload</button>
          <button className="nb-btn" onClick={() => setExternalChange(false)}>Keep mine</button>
        </div>
      )}
      {!autoSave && dirty && (
        <div className="nb-banner nb-banner--info"><span style={{ flex: 1 }}>Unsaved changes ● — Ctrl+S to save.</span></div>
      )}

      {/* cells */}
      <div className="nb-cells">
        {loading ? (
          <div className="nb-empty">Loading notebook…</div>
        ) : cells.map((cell, i) => {
          const actualCode = cell.cell_type === "code";
          return (
            <React.Fragment key={cell.id}>
              <div
                className={"nb-cell" + (selectedId === cell.id ? " nb-cell--selected" : "") + (cell.running ? " nb-cell--running" : "")}
                onClick={() => setSelectedId(cell.id)}
              >
                <div className="nb-cell__bar">
                  <span className={"nb-cell__prompt" + (actualCode ? "" : " nb-cell__prompt--md")}>
                    {actualCode ? (cell.running ? "In [*]:" : cell.execution_count != null ? `In [${cell.execution_count}]:` : "In [ ]:") : "❝ text"}
                  </span>
                  <select className="nb-cell__type" value={cell.cell_type} onChange={(e) => setCellType(i, e.target.value)} title="Cell type">
                    <option value="code">code</option>
                    <option value="markdown">markdown</option>
                    <option value="raw">raw</option>
                  </select>
                  <span className="nb-cell__actions">
                    {actualCode && (
                      <button className="nb-iconbtn nb-iconbtn--run" disabled={cell.running || kernel.status === "error"} onClick={() => runCell(i)} title="Run cell (Shift+Enter)">
                        {cell.running ? "●" : "▶"}
                      </button>
                    )}
                    {!actualCode && cell.cell_type === "markdown" && (
                      <button className="nb-iconbtn" onClick={() => setMdEditing((m) => ({ ...m, [cell.id]: !m[cell.id] }))} title={mdEditing[cell.id] ? "Preview" : "Edit"}>
                        {mdEditing[cell.id] ? "👁" : "✎"}
                      </button>
                    )}
                    <button className="nb-iconbtn" onClick={() => insertCell(i, "code")} title="Insert code cell above">+C↑</button>
                    <button className="nb-iconbtn" onClick={() => moveCell(i, -1)} title="Move up">↑</button>
                    <button className="nb-iconbtn" onClick={() => moveCell(i, 1)} title="Move down">↓</button>
                    {actualCode && !!cell.outputs?.length && (
                      <button className="nb-iconbtn" onClick={() => { mutateCells((prev) => prev.map((c, k) => (k === i ? { ...c, outputs: [] } : c))); scheduleAutosave(); }} title="Clear outputs">⌫</button>
                    )}
                    <button className="nb-iconbtn" onClick={() => deleteCell(i)} title="Delete cell">✕</button>
                  </span>
                </div>

                {actualCode ? (
                  !monacoFailed ? (
                    <CodeCellEditor
                      key={cell.id}
                      cellId={cell.id}
                      value={cell.source}
                      settings={edSettings}
                      onChange={(v) => setCellSource(i, v)}
                      onRunKey={(mode) => handleCellRunKey(i, mode)}
                      onMonacoFailed={() => setMonacoFailed(true)}
                      registerEditor={(id, ed) => {
                        try {
                          if (ed) editorRefs.current.set(id, ed);
                          else editorRefs.current.delete(id);
                        } catch {}
                      }}
                      onFocusCell={() => setSelectedId(cell.id)}
                    />
                  ) : (
                    <div className="nb-codewrap">
                      <div className="nb-codewrap__gutter" />
                      <textarea
                        ref={(el) => { if (el) taRefs.current.set(cell.id, el); else taRefs.current.delete(cell.id); }}
                        className="nb-textarea"
                        value={cell.source}
                        spellCheck={false}
                        placeholder="# python code — Shift+Enter to run"
                        onChange={(e) => setCellSource(i, e.target.value)}
                        onKeyDown={(e) => onCodeKeyDown(e, i)}
                        onFocus={() => setSelectedId(cell.id)}
                      />
                    </div>
                  )
                ) : cell.cell_type === "markdown" ? (
                  mdEditing[cell.id] ? (
                    <div className="nb-codewrap">
                      <div className="nb-codewrap__gutter" style={{ background: "#4ec9b0" }} />
                      <textarea
                        ref={(el) => { if (el) taRefs.current.set(cell.id, el); else taRefs.current.delete(cell.id); }}
                        className="nb-textarea"
                        value={cell.source}
                        spellCheck={false}
                        placeholder="# markdown — headings, **bold**, `code`, lists…"
                        onChange={(e) => setCellSource(i, e.target.value)}
                        onFocus={() => setSelectedId(cell.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.shiftKey || e.ctrlKey)) { e.preventDefault(); setMdEditing((m) => ({ ...m, [cell.id]: false })); }
                          if (e.key === "Escape") setMdEditing((m) => ({ ...m, [cell.id]: false }));
                        }}
                        onBlur={() => setMdEditing((m) => ({ ...m, [cell.id]: false }))}
                      />
                    </div>
                  ) : (
                    <div className="nb-md-view" onDoubleClick={() => setMdEditing((m) => ({ ...m, [cell.id]: true }))} onClick={() => setSelectedId(cell.id)} title="Double-click to edit" dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.source) }} />
                  )
                ) : (
                  <div className="nb-codewrap">
                    <div className="nb-codewrap__gutter" style={{ background: "#666" }} />
                    <textarea
                      ref={(el) => { if (el) taRefs.current.set(cell.id, el); else taRefs.current.delete(cell.id); }}
                      className="nb-textarea"
                      value={cell.source}
                      spellCheck={false}
                      placeholder="raw text (not executed)"
                      onChange={(e) => setCellSource(i, e.target.value)}
                      onFocus={() => setSelectedId(cell.id)}
                    />
                  </div>
                )}

                {actualCode && cell.outputs?.length > 0 && (
                  <div className="nb-outputs">{cell.outputs.map((o, k) => renderOutput(o, cell.id + ":" + k))}</div>
                )}
              </div>
              <div className="nb-addrow">
                <button className="nb-btn" onClick={() => insertCell(i + 1, "code")}>+ Code</button>
                <button className="nb-btn" onClick={() => insertCell(i + 1, "markdown")}>+ Text</button>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default NotebookPanel;
