// SearchPanel — project-wide search & replace.
//
// Opens as an overlay (Ctrl+Shift+F / Ctrl+Shift+H). Results are grouped by
// file, and replace operations are snapshotted into Local History with an
// in-panel Undo action.
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search, Replace, X, ChevronDown, ChevronRight, CaseSensitive, WholeWord,
  Regex, AlertTriangle, Loader2, Undo2, SlidersHorizontal,
} from "lucide-react";
import "./search.css";

const OPTIONS_KEY = "ibx.search.options";

const loadOptions = () => {
  const base = { caseSensitive: false, wholeWord: false, regex: false, include: "", exclude: "" };
  try {
    const raw = JSON.parse(localStorage.getItem(OPTIONS_KEY) || "null");
    if (raw && typeof raw === "object") return { ...base, ...raw };
  } catch {}
  return base;
};

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const previewRegex = (query, options) => {
  if (!query) return null;
  try {
    let src = options.regex ? query : escapeRegExp(query);
    if (options.wholeWord) src = `(?<![\\w$])(?:${src})(?![\\w$])`;
    return new RegExp(src, "g" + (options.caseSensitive ? "" : "i"));
  } catch {
    return null;
  }
};

const splitRel = (rel) => {
  const i = String(rel || "").lastIndexOf("/");
  if (i === -1) return { name: rel, dir: "" };
  return { name: rel.slice(i + 1), dir: rel.slice(0, i) };
};

const SearchPanel = () => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("search");
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState(loadOptions);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [engine, setEngine] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [undoToken, setUndoToken] = useState(null);
  const [notice, setNotice] = useState(null);

  const inputRef = useRef(null);
  const replaceRef = useRef(null);
  const reqRef = useRef(0);
  const debounceRef = useRef(null);

  const root = () => window.__currentProjectPath || "";

  useEffect(() => {
    try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)); } catch {}
  }, [options]);

  const runSearch = useCallback(async (q, opts, requestRoot) => {
    const projectRoot = requestRoot || root();
    const my = ++reqRef.current;
    if (!projectRoot || !q || q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      setTruncated(false);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const res = await window.electronAPI.projectSearch({
        rootPath: projectRoot,
        query: q,
        options: { ...opts, maxResults: 2000 },
      });
      if (my !== reqRef.current) return;
      if (res?.ok) {
        setResults(Array.isArray(res.results) ? res.results : []);
        setTruncated(!!res.truncated);
        setEngine(res.engine || "");
      } else {
        setResults([]);
        setNotice({ kind: "error", text: res?.error || "Search failed" });
      }
    } catch (err) {
      if (my !== reqRef.current) return;
      setResults([]);
      setNotice({ kind: "error", text: err?.message || "Search failed" });
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, []);

  // Debounced live search.
  useEffect(() => {
    if (!open) return;
    try { clearTimeout(debounceRef.current); } catch {}
    if (!query.trim()) {
      reqRef.current++;
      setResults([]);
      setLoading(false);
      setTruncated(false);
      setNotice(null);
      return;
    }
    debounceRef.current = setTimeout(() => { runSearch(query, options); }, 320);
    return () => { try { clearTimeout(debounceRef.current); } catch {} };
  }, [open, query, options, runSearch]);

  // Open/close wiring. Ctrl+Shift+F / Ctrl+Shift+H arrive from the global
  // keybinding manager as `search:open` with a mode.
  useEffect(() => {
    const show = (e) => {
      const nextMode = e?.detail?.mode === "replace" ? "replace" : "search";
      setMode(nextMode);
      setOpen(true);
      setTimeout(() => {
        if (nextMode === "replace" && replaceRef.current) replaceRef.current.focus();
        else inputRef.current?.focus();
      }, 40);
    };
    window.addEventListener("search:open", show);
    return () => window.removeEventListener("search:open", show);
  }, []);

  // Esc closes; Ctrl+Enter replaces all while in replace mode.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const totalMatches = useMemo(
    () => results.reduce((n, f) => n + (f.matches?.length || 0), 0),
    [results]
  );

  const openResult = (file, match) => {
    setOpen(false);
    try {
      window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: file.path } }));
    } catch {}
    setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent("editor:revealLine", {
          detail: { path: file.path, line: match.line, column: (match.column || 0) + 1 },
        }));
      } catch {}
    }, 320);
  };

  const toggleCollapsed = (path) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const submit = () => {
    if (!query.trim()) return;
    runSearch(query, options);
  };

  const switchMode = (next) => {
    setMode(next);
    if (next === "replace") setTimeout(() => replaceRef.current?.focus(), 30);
    else setTimeout(() => inputRef.current?.focus(), 30);
  };

  const doReplace = async () => {
    if (busy) return;
    if (!root()) { setNotice({ kind: "error", text: "Open a project folder first." }); return; }
    if (!query.trim()) { setNotice({ kind: "error", text: "Enter something to replace." }); return; }
    if (!results.length) { setNotice({ kind: "error", text: "Nothing to replace — run a search first." }); return; }
    const count = totalMatches;
    const fileCount = results.length;
    const message = `Replace ${count} match${count === 1 ? "" : "es"} in ${fileCount} file${fileCount === 1 ? "" : "s"}?\n\nA snapshot of each file is saved to Local History first.`;
    let ok = true;
    try {
      ok = window.electronAPI?.confirmDialog ? await window.electronAPI.confirmDialog(message) : window.confirm(message);
    } catch { ok = false; }
    if (!ok) return;

    setBusy(true);
    setNotice(null);
    try {
      const res = await window.electronAPI.projectReplace({
        rootPath: root(),
        query,
        replacement,
        options,
        files: results.map((f) => f.path),
      });
      if (!res?.ok) {
        setNotice({ kind: "error", text: res?.error || "Replace failed" });
      } else {
        setUndoToken(res.undoToken || null);
        setNotice({
          kind: "ok",
          text: `Replaced ${res.replaced} match${res.replaced === 1 ? "" : "es"} in ${res.fileCount} file${res.fileCount === 1 ? "" : "s"}${res.skipped ? ` · ${res.skipped} skipped` : ""}.`,
        });
        runSearch(query, options);
      }
    } catch (err) {
      setNotice({ kind: "error", text: err?.message || "Replace failed" });
    } finally {
      setBusy(false);
    }
  };

  const undoReplace = async () => {
    if (!undoToken || busy) return;
    setBusy(true);
    try {
      const res = await window.electronAPI.projectReplaceUndo({ token: undoToken });
      if (!res?.ok) {
        setNotice({ kind: "error", text: res?.error || "Undo failed" });
      } else {
        setUndoToken(null);
        setNotice({ kind: "ok", text: `Restored ${res.restored} file${res.restored === 1 ? "" : "s"}.` });
        runSearch(query, options);
      }
    } catch (err) {
      setNotice({ kind: "error", text: err?.message || "Undo failed" });
    } finally {
      setBusy(false);
    }
  };

  const toggleOption = (key) => setOptions((o) => ({ ...o, [key]: !o[key] }));

  if (!open) return null;

  const projectRoot = root();
  const re = previewRegex(query, options);
  const showReplace = mode === "replace";

  return (
    <div className="ibx-search-overlay" onClick={() => setOpen(false)}>
      <div
        className="ibx-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search in project"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ibx-search-head">
          <Search size={15} style={{ color: "var(--icon)" }} />
          <span className="ibx-search-title">Search in Files</span>
          <button
            className="ibx-search-option"
            data-on={showReplace || undefined}
            title={showReplace ? "Hide replace" : "Show replace"}
            aria-label="Toggle replace"
            onClick={() => switchMode(showReplace ? "search" : "replace")}
          >
            <Replace size={14} />
          </button>
          <button className="ibx-search-close" onClick={() => setOpen(false)} title="Close (Esc)" aria-label="Close search">
            <X size={16} />
          </button>
        </div>

        <div className="ibx-search-rows">
          <div className="ibx-search-row">
            <input
              ref={inputRef}
              className="ibx-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); submit(); }
              }}
              placeholder="Search in project…"
              aria-label="Search query"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              className="ibx-search-option"
              data-on={options.caseSensitive || undefined}
              title="Match case"
              aria-label="Match case"
              aria-pressed={options.caseSensitive}
              onClick={() => toggleOption("caseSensitive")}
            >
              <CaseSensitive size={15} />
            </button>
            <button
              className="ibx-search-option"
              data-on={options.wholeWord || undefined}
              title="Match whole word"
              aria-label="Match whole word"
              aria-pressed={options.wholeWord}
              onClick={() => toggleOption("wholeWord")}
            >
              <WholeWord size={15} />
            </button>
            <button
              className="ibx-search-option"
              data-on={options.regex || undefined}
              title="Use regular expression"
              aria-label="Use regular expression"
              aria-pressed={options.regex}
              onClick={() => toggleOption("regex")}
            >
              <Regex size={15} />
            </button>
            <button className="ibx-search-primary" onClick={submit} disabled={!query.trim() || loading}>
              {loading ? <Loader2 size={13} className="spin" /> : <Search size={13} />} Search
            </button>
          </div>

          {showReplace && (
            <div className="ibx-search-row">
              <input
                ref={replaceRef}
                className="ibx-search-input"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doReplace(); }
                  else if (e.key === "Enter") { e.preventDefault(); doReplace(); }
                  else if (e.key === "Escape") setOpen(false);
                }}
                placeholder="Replace with…"
                aria-label="Replacement text"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="ibx-search-primary"
                data-tone="accent"
                onClick={doReplace}
                disabled={!query.trim() || !results.length || busy}
                title="Replace all matches in the listed files (Ctrl+Enter)"
              >
                {busy ? <Loader2 size={13} className="spin" /> : <Replace size={13} />} Replace All
              </button>
            </div>
          )}

          <button
            className="ibx-search-filters-toggle"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            {filtersOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <SlidersHorizontal size={11} />
            Files to include / exclude
            {(options.include || options.exclude) && <span className="ibx-search-badge">!</span>}
          </button>

          {filtersOpen && (
            <div className="ibx-search-filters">
              <label htmlFor="ibx-search-include">files to include</label>
              <input
                id="ibx-search-include"
                value={options.include}
                onChange={(e) => setOptions((o) => ({ ...o, include: e.target.value }))}
                placeholder="e.g. src/**/*.js, *.tsx (comma separated)"
                spellCheck={false}
              />
              <label htmlFor="ibx-search-exclude">files to exclude</label>
              <input
                id="ibx-search-exclude"
                value={options.exclude}
                onChange={(e) => setOptions((o) => ({ ...o, exclude: e.target.value }))}
                placeholder="e.g. dist/**, *.min.js"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        <div className="ibx-search-results">
          {loading && <div className="ibx-search-empty"><Loader2 size={16} className="spin" /> Searching…</div>}
          {!loading && !projectRoot && <div className="ibx-search-empty">Open a project folder to search its files.</div>}
          {!loading && projectRoot && !query.trim() && (
            <div className="ibx-search-empty">Type at least 2 characters. Results update as you type.</div>
          )}
          {!loading && projectRoot && query.trim() && results.length === 0 && (
            <div className="ibx-search-empty">
              No results for <strong>{query}</strong>
              {options.include ? ` in ${options.include}` : ""}.
            </div>
          )}
          {!loading && results.map((file) => {
            const isCollapsed = collapsed.has(file.path);
            const { name, dir } = splitRel(file.rel);
            return (
              <div className="ibx-search-file" key={file.path}>
                <button
                  className="ibx-search-file-head"
                  onClick={() => toggleCollapsed(file.path)}
                  title={file.rel}
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span className="ibx-search-file-name">{name}</span>
                  {dir && <span className="ibx-search-file-dir">{dir}</span>}
                  <span className="ibx-search-badge">{file.matches.length}</span>
                </button>
                {!isCollapsed && file.matches.map((m, i) => (
                  <button
                    className="ibx-search-match"
                    key={`${file.path}:${m.line}:${m.column}:${i}`}
                    onClick={() => openResult(file, m)}
                    title={`${file.rel}:${m.line}:${(m.column || 0) + 1}`}
                  >
                    <span className="ibx-search-line-no">{m.line}</span>
                    <span className="ibx-search-match-text">{renderHighlight(m.lineText || "", re)}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        <div className="ibx-search-foot">
          <span>
            {loading
              ? "Searching…"
              : results.length
                ? `${totalMatches} match${totalMatches === 1 ? "" : "es"} in ${results.length} file${results.length === 1 ? "" : "s"} · ${engine === "rg" ? "ripgrep" : "index"}`
                : "Enter Search · Click a result to open · Esc to close"}
            {truncated && <span className="ibx-search-note" style={{ marginLeft: 8 }}><AlertTriangle size={11} /> showing the first 2000 matches</span>}
          </span>
          <span className="ibx-search-foot-actions">
            {notice && (
              <span className="ibx-search-note" style={{ color: notice.kind === "error" ? "var(--danger)" : "var(--success)" }}>
                {notice.text}
              </span>
            )}
            {undoToken && (
              <button className="ibx-search-primary" onClick={undoReplace} disabled={busy} title="Undo the last Replace All">
                <Undo2 size={12} /> Undo replace
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

function renderHighlight(text, re) {
  if (!re || !text) return text;
  const out = [];
  let last = 0;
  let guard = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null && guard++ < 100) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out.push(<mark className="ibx-search-hit" key={`${m.index}-${out.length}`}>{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : text;
}

export default SearchPanel;
