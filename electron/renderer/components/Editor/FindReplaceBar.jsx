// FindReplaceBar — custom find/replace UI (VS Code-style top-right bar).
//
// @codemirror/search ka default panel use NAHI hota (openSearchPanel kabhi
// call nahi hota); base `search()` extension sirf match highlighting + F3 /
// gotoLine dialog ke liye loaded hai. Ye bar seedha SearchQuery state chalata
// hai: setSearchQuery + findNext/findPrevious + replaceNext/replaceAll +
// closeSearchPanel.

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  SearchQuery, setSearchQuery, getSearchQuery,
  findNext, findPrevious, replaceNext, replaceAll, closeSearchPanel,
} from "@codemirror/search";

const BTN = {
  minWidth: 26, height: 24, padding: "0 6px",
  background: "transparent", border: "1px solid transparent",
  borderRadius: "var(--radius-sm)", color: "var(--text-soft)",
  fontSize: "var(--fs-body)", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};
const BTN_ON = { background: "var(--select-blue)", color: "var(--text-inverse)", borderColor: "var(--select-blue)" };

const INPUT = {
  flex: 1, minWidth: 0,
  background: "var(--bg-surface)", border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)", color: "var(--text-hover)",
  fontSize: "var(--fs-body)", padding: "4px 8px", outline: "none",
  fontFamily: "var(--font-code)",
};

const countMatches = (view, query) => {
  try {
    if (!view || !query || !query.valid) return 0;
    const cursor = query.getCursor(view.state);
    let n = 0;
    while (!cursor.done) {
      n += 1;
      if (n >= 1000) return 1000; // cap — "1000+" dikhega
      cursor.next();
    }
    return n;
  } catch {
    return 0;
  }
};

const FindReplaceBar = ({ getView, initialFind = "", initialReplaceMode = false, onClose }) => {
  const [find, setFind] = useState(initialFind);
  const [replace, setReplace] = useState("");
  const [replaceMode, setReplaceMode] = useState(!!initialReplaceMode);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [regexError, setRegexError] = useState("");
  const findInputRef = useRef(null);
  const queryRef = useRef(null);

  const viewOf = () => { try { return getView?.() || null; } catch { return null; } };

  // ── Query apply (type karte hi live highlight) ──
  useEffect(() => {
    const view = viewOf();
    if (!view) return;
    if (!find) {
      try { view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) }); } catch {}
      queryRef.current = null;
      setMatchCount(0);
      setRegexError("");
      return;
    }
    let q = null;
    try {
      q = new SearchQuery({ search: find, replace, caseSensitive, regexp, wholeWord });
    } catch (e) {
      setRegexError("Invalid regex: " + (e?.message || e));
      return;
    }
    if (!q.valid) {
      setRegexError(regexp ? "Invalid regular expression" : "");
      // Invalid rehne par purani highlight mat chhedo.
      if (regexp) return;
    } else {
      setRegexError("");
    }
    queryRef.current = q;
    try { view.dispatch({ effects: setSearchQuery.of(q) }); } catch {}
    setMatchCount(countMatches(view, q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find, replace, caseSensitive, regexp, wholeWord]);

  // ── Open: focus + select-all + pehle match par jump ──
  useEffect(() => {
    try {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    } catch {}
    if (initialFind) {
      const t = setTimeout(() => {
        try {
          const view = viewOf();
          if (view && getSearchQuery(view.state)?.valid) findNext(view);
        } catch {}
      }, 60);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    try {
      const view = viewOf();
      if (view) {
        closeSearchPanel(view);
        view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "" })) });
        try { view.focus(); } catch {}
      }
    } catch {}
    try { onClose?.(); } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const doNext = useCallback(() => { try { const v = viewOf(); if (v) findNext(v); } catch {} }, []);
  const doPrev = useCallback(() => { try { const v = viewOf(); if (v) findPrevious(v); } catch {} }, []);
  const doReplaceOne = useCallback(() => {
    try {
      const v = viewOf();
      if (!v) return;
      replaceNext(v);
      const q = getSearchQuery(v.state);
      setMatchCount(countMatches(v, q));
    } catch {}
  }, []);
  const doReplaceAll = useCallback(() => {
    try {
      const v = viewOf();
      if (!v) return;
      replaceAll(v);
      const q = getSearchQuery(v.state);
      setMatchCount(countMatches(v, q));
    } catch {}
  }, []);

  const toggleBtn = (on, title, label, onClick) => (
    <button
      style={{ ...BTN, ...(on ? BTN_ON : null) }}
      title={title}
      onClick={onClick}
      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--bg-active)"; }}
      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: "absolute", top: 8, right: 12, zIndex: "var(--z-menu-top)",
        width: "min(400px, 70%)",
        background: "var(--bg-vscode)", border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-pop)",
        padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)",
      }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          style={BTN} title={replaceMode ? "Replace mode band karo" : "Replace mode (Ctrl+H)"}
          onClick={() => setReplaceMode((v) => !v)}
        >
          {replaceMode ? "⌃" : "⌄"}
        </button>
        <input
          ref={findInputRef}
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (e.shiftKey) doPrev(); else doNext(); }
          }}
          placeholder="Find"
          spellCheck={false}
          style={{ ...INPUT, ...(regexError ? { borderColor: "var(--danger)" } : null) }}
          aria-label="Find"
        />
        <span style={{ fontSize: "var(--fs-small)", color: "var(--text-disabled)", minWidth: 44, textAlign: "right" }}>
          {find && !regexError ? (matchCount >= 1000 ? "1000+" : String(matchCount)) : ""}
        </span>
        <button style={BTN} title="Previous (Shift+Enter)" onClick={doPrev}>▲</button>
        <button style={BTN} title="Next (Enter)" onClick={doNext}>▼</button>
        <button style={BTN} title="Close (Esc)" onClick={close}>✕</button>
      </div>
      {replaceMode && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: 30 }}>
          <input
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); if (e.shiftKey || e.ctrlKey) doReplaceAll(); else doReplaceOne(); }
            }}
            placeholder="Replace"
            spellCheck={false}
            style={INPUT}
            aria-label="Replace"
          />
          <button style={BTN} title="Replace next (Enter)" onClick={doReplaceOne}>⇄</button>
          <button style={BTN} title="Replace all (Ctrl+Shift+Enter)" onClick={doReplaceAll}>⇄⇄</button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 2, paddingLeft: 30 }}>
        {toggleBtn(caseSensitive, "Match case", "Aa", () => setCaseSensitive((v) => !v))}
        {toggleBtn(regexp, "Regular expression", ".*", () => setRegexp((v) => !v))}
        {toggleBtn(wholeWord, "Whole word", '"ab"', () => setWholeWord((v) => !v))}
        {regexError && (
          <span style={{ fontSize: "var(--fs-small)", color: "var(--danger)", marginLeft: 6 }}>{regexError}</span>
        )}
      </div>
    </div>
  );
};

export default FindReplaceBar;
