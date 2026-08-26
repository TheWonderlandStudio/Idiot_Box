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
      position: "fixed", inset: 0, zIndex: 940, display: "flex", flexDirection: "column",
      background: "rgba(0,0,0,0.5)",
    }} onClick={() => setOpen(false)}>
      <div
        style={{
          margin: "8% auto 0", width: 720, maxWidth: "90vw", maxHeight: "70vh",
          background: "#252526", border: "1px solid #3a3a3a", borderRadius: 6,
          boxShadow: "0 12px 48px rgba(0,0,0,0.65)", overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#1e1e1e", borderBottom: "1px solid #3a3a3a" }}>
          <Search size={14} style={{ color: "#888" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch(query);
              else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search in project… (Ctrl+Shift+F)"
            style={{ flex: 1, background: "#252526", border: "1px solid #3a3a3a", borderRadius: 3, padding: "6px 8px", color: "#ddd", fontSize: 13, outline: "none" }}
          />
          <button
            onClick={() => doSearch(query)}
            disabled={!query.trim()}
            style={{ background: query.trim() ? "#0e639c" : "#2d2d2d", border: "none", color: query.trim() ? "#fff" : "#888", padding: "6px 14px", borderRadius: 3, cursor: query.trim() ? "pointer" : "default", fontSize: 12 }}
          >
            Search
          </button>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", minHeight: 200, maxHeight: 400 }}>
          {loading && <div style={{ padding: 20, textAlign: "center", color: "#666", fontSize: 12 }}>Searching…</div>}
          {!loading && !window.__currentProjectPath && <div style={{ padding: 20, textAlign: "center", color: "#666", fontSize: 12 }}>Open a project first</div>}
          {!loading && window.__currentProjectPath && query && results.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#666", fontSize: 12 }}>No results for "{query}"</div>}
          {!loading && !query && <div style={{ padding: 20, textAlign: "center", color: "#666", fontSize: 12 }}>Type to search across files</div>}
          {results.map((r, i) => (
            <div
              key={`${r.path}:${r.line}:${i}`}
              onClick={() => openResult(r)}
              style={{
                display: "flex", flexDirection: "column", gap: 2, padding: "6px 12px",
                cursor: "pointer", borderBottom: "1px solid #2d2d2d",
                background: "transparent",
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#2a2d2e"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ color: "#569cd6", fontFamily: "Consolas, monospace" }}>{r.rel}</span>
                <span style={{ color: "#888", fontSize: 11 }}>:{r.line}</span>
              </div>
              <div style={{ fontSize: 11, color: "#cccccc", fontFamily: "Consolas, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: "#1e1e1e", padding: "2px 6px", borderRadius: 2 }}>
                {r.preview || r.text}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: "6px 12px", fontSize: 10, color: "#666", borderTop: "1px solid #2d2d2d", display: "flex", justifyContent: "space-between" }}>
          <span>Enter Search • Click to open • Esc Close</span>
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
};

export default SearchPanel;
