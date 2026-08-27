// Docs Panel — Craft.js docs as-is (https://craft.js.org/docs/)
import React, { useRef, useEffect, useCallback } from "react";
import { BookOpen, RefreshCw, ExternalLink } from "lucide-react";

const DOCS_URL = "https://craft.js.org/docs/";

const DocsPanel = () => {
  const webviewRef = useRef(null);
  const containerRef = useRef(null);

  const reload = useCallback(() => {
    try { webviewRef.current?.reload?.(); } catch {}
  }, []);

  const openExternal = useCallback(() => {
    try { window.electronAPI?.openUrl?.(DOCS_URL); } catch {}
    try { window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: DOCS_URL, config: { type: "browser", title: "Craft.js Docs", url: DOCS_URL } } })); } catch {}
  }, []);

  // Attach webview listeners for parity with Browser panel (optional)
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onDomReady = () => {
      try { wv.focus(); } catch {}
    };
    wv.addEventListener?.("dom-ready", onDomReady);
    return () => { try { wv.removeEventListener?.("dom-ready", onDomReady); } catch {} };
  }, []);

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", height: "100%", background: "#1e1e1e", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: "#252526", borderBottom: "1px solid #2d2d2d", flexShrink: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#bbb", letterSpacing: 0.4, textTransform: "uppercase" }}>
          <BookOpen size={14} style={{ color: "#4ec9b0" }} /> Craft.js Docs
          <span style={{ fontSize: 10, color: "#666", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— craft.js.org/docs</span>
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={reload} title="Refresh" style={{ background: "#2d2d2d", border: "1px solid #3a3a3a", color: "#bbb", borderRadius: 4, padding: "4px 8px", cursor: "pointer", display: "flex", alignItems: "center" }}>
          <RefreshCw size={12} />
        </button>
        <button onClick={openExternal} title="Open in Browser panel" style={{ background: "#094771", border: "1px solid #0e639c", color: "#fff", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          <ExternalLink size={12} /> Open
        </button>
      </div>
      <div style={{ flex: 1, overflow: "hidden", background: "#fff", position: "relative" }}>
        <webview
          ref={(el) => { webviewRef.current = el; }}
          src={DOCS_URL}
          style={{ width: "100%", height: "100%", border: "none", display: "flex" }}
          allowpopups="true"
        />
      </div>
      <div style={{ padding: "3px 8px", fontSize: 10, color: "#666", background: "#252526", borderTop: "1px solid #2d2d2d", display: "flex", justifyContent: "space-between" }}>
        <span>Docs as-is — craft.js.org</span>
        <span style={{ color: "#4ec9b0" }}>https://craft.js.org/docs/</span>
      </div>
    </div>
  );
};

export default DocsPanel;
