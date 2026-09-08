// SearchPanel — Ctrl+Shift+F project-wide text search (lucide)
import React, { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";

const SearchPanel = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const doSearch = async (q) => {
    const root = window.__currentProjectPath;
    if (!root || !q || q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await window.electronAPI.searchText(root, q, 200);
      setResults(Array.isArray(res) ? res : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const show = () => {
      setOpen(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        show();
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("search:open", show);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("search:open", show);
    };
  }, [open]);

  const openResult = (r) => {
    window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: r.path } }));
    // Also reveal the line — we can send a command to editor to go to line
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("editor:revealLine", { detail: { path: r.path, line: r.line } }));
    }, 300);
  };

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: "var(--z-search)", display: "flex", flexDirection: "column",
      background: "var(--overlay)",
    }} onClick={() => setOpen(false)}>
      <div
        style={{
          margin: "8% auto 0", width: 720, maxWidth: "90vw", maxHeight: "70vh",
          background: "var(--bg-vscode)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-float)", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-10) var(--space-12)", background: "var(--bg-surface)", borderBottom: "var(--space-1) solid var(--border-light)" }}>
          <Search size={14} style={{ color: "var(--icon)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch(query);
              else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search in project… (Ctrl+Shift+F)"
            style={{ flex: 1, background: "var(--bg-vscode)", border: "1px solid var(--border-light)", borderRadius: "var(--radius-sm)", padding: "var(--space-6) var(--space-8)", color: "var(--text-hover)", fontSize: "var(--fs-title)", outline: "none" }}
          />
          <button
            onClick={() => doSearch(query)}
            disabled={!query.trim()}
            style={{ background: query.trim() ? "var(--editor-blue)" : "var(--bg-active)", border: "none", color: query.trim() ? "var(--text-inverse)" : "var(--icon)", padding: "var(--space-6) var(--space-14)", borderRadius: "var(--radius-sm)", cursor: query.trim() ? "pointer" : "default", fontSize: "var(--fs-body)" }}
          >
            Search
          </button>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "var(--icon)", cursor: "pointer", fontSize: "var(--fs-xl)", padding: "0 var(--space-4)" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 200, maxHeight: 400 }}>
          {loading && <div style={{ padding: "var(--space-20)", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>Searching…</div>}
          {!loading && !window.__currentProjectPath && <div style={{ padding: "var(--space-20)", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>Open a project first</div>}
          {!loading && window.__currentProjectPath && query && results.length === 0 && <div style={{ padding: "var(--space-20)", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>No results for "{query}"</div>}
          {!loading && !query && <div style={{ padding: "var(--space-20)", textAlign: "center", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>Type to search across files</div>}
          {results.map((r, i) => (
            <div
              key={`${r.path}:${r.line}:${i}`}
              onClick={() => openResult(r)}
              style={{
                display: "flex", flexDirection: "column", gap: "var(--space-2)", padding: "var(--space-6) var(--space-12)",
                cursor: "pointer", borderBottom: "1px solid var(--bg-active)",
                background: "transparent",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover-strong)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", fontSize: "var(--fs-body)" }}>
                <span style={{ color: "var(--code-blue)", fontFamily: "var(--font-code)" }}>{r.rel}</span>
                <span style={{ color: "var(--icon)", fontSize: "var(--fs-small)" }}>:{r.line}</span>
              </div>
              <div style={{ fontSize: "var(--fs-small)", color: "var(--text-bright)", fontFamily: "var(--font-code)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: "var(--bg-surface)", padding: "var(--space-2) var(--space-6)", borderRadius: "var(--radius-xs)" }}>
                {r.preview || r.text}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "var(--space-6) var(--space-12)", fontSize: "var(--fs-tiny)", color: "var(--text-muted)", borderTop: "var(--space-1) solid var(--bg-active)", display: "flex", justifyContent: "space-between" }}>
          <span>Enter Search • Click to open • Esc Close</span>
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
};

export default SearchPanel;
