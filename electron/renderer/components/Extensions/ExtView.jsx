// Extension view panel — extension ka UI sandboxed iframe me render hota hai.
// HTML main process se aata hai (bridge script injected), messages IPC se
// extension tak: iframe → renderer → main → extension (aur ulta).
import React, { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, Puzzle } from "lucide-react";
import { PREVIEW_IFRAME_CSP } from "../shared/previewCsp.js";

const ExtView = ({ config }) => {
  const extId = config?.extId || "";
  const viewType = config?.viewType || "";
  const [html, setHtml] = useState(null);
  const [error, setError] = useState("");
  const frameRef = useRef(null);

  const load = useCallback(async () => {
    if (!extId || !viewType) { setError("Missing extension view"); return; }
    try {
      const res = await window.electronAPI.extViewHtml(extId, viewType);
      if (res === null || res === undefined) setError("View not found — extension may be disabled");
      else { setHtml(res); setError(""); }
    } catch (e) { setError(String((e && e.message) || e)); }
  }, [extId, viewType]);

  useEffect(() => { load(); }, [load]);

  // Extension ne webview.html badla → reload
  useEffect(() => {
    const un = window.electronAPI?.onExtViewHtmlChanged?.((p) => {
      if (p?.extId === extId && p?.viewType === viewType) load();
    });
    return () => { try { un && un(); } catch {} };
  }, [extId, viewType, load]);

  // Main → extension ke messages ko iframe me forward karo
  useEffect(() => {
    const un = window.electronAPI?.onExtViewPush?.((p) => {
      if (p?.extId !== extId || p?.viewType !== viewType) return;
      try { frameRef.current?.contentWindow?.postMessage({ __ibxHost: true, extId, viewType, msg: p.msg }, "*"); } catch {}
    });
    return () => { try { un && un(); } catch {} };
  }, [extId, viewType]);

  // Iframe → main (bridge script ke postMessage)
  useEffect(() => {
    const onMsg = (e) => {
      const frame = frameRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const d = e.data;
      if (!d || d.__ibxExt !== 1 || d.extId !== extId || d.viewType !== viewType) return;
      try { window.electronAPI.extViewMessage(extId, viewType, d.msg); } catch {}
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [extId, viewType]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-8)", padding: "var(--space-4) var(--space-10)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", fontSize: "var(--fs-tiny)", color: "var(--text-soft)", letterSpacing: 0.3, textTransform: "uppercase", fontWeight: "var(--fw-bold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <Puzzle size={11} /> {extId}{viewType ? ` · ${viewType}` : ""}
        </span>
        <button onClick={load} title="Reload view" style={{ display: "flex", alignItems: "center", background: "var(--bg-active)", border: "1px solid var(--border-light)", color: "var(--text-soft)", cursor: "pointer", padding: "var(--space-3) var(--space-6)", borderRadius: "var(--radius-md)" }}>
          <RefreshCw size={11} />
        </button>
      </div>
      {error ? (
        <div style={{ padding: "var(--space-16)", color: "var(--error-text-soft)", fontSize: "var(--fs-body)", background: "var(--error-bg-solid)" }}>{error}</div>
      ) : html === null ? (
        <div style={{ padding: "var(--space-16)", color: "var(--text-muted)", fontSize: "var(--fs-body)" }}>Loading view…</div>
      ) : (
        <iframe
          ref={frameRef}
          title={`${extId} — ${viewType}`}
          // allow-same-origin NAHI — extension page parent DOM tak na pahunche,
          // sab kuch postMessage bridge se (preview se thoda strict).
          sandbox="allow-scripts allow-forms allow-popups"
          csp={PREVIEW_IFRAME_CSP}
          srcDoc={html}
          style={{ flex: 1, width: "100%", border: "none", background: "var(--bg-surface)" }}
        />
      )}
    </div>
  );
};

export default ExtView;
