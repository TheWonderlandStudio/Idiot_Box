import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom/client";
import * as ReactDOMPkg from "react-dom";
import * as ReactJSXRuntime from "react/jsx-runtime";

// Error Boundary to catch runtime errors inside previewed user components
class PreviewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Component Preview Runtime Error:", error, errorInfo);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "var(--space-16)",
          background: "var(--error-bg)",
          border: "1px solid var(--error-border)",
          borderRadius: "var(--radius-lg)",
          color: "var(--danger)",
          fontSize: "var(--fs-body)",
          fontFamily: "var(--font-code)",
          maxWidth: 600,
          margin: "var(--space-16)",
        }}>
          <div style={{ fontWeight: "var(--fw-semibold)", marginBottom: "var(--space-6)" }}>Runtime Error in Component</div>
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error?.message || String(this.state.error)}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Built-in sample component shown with temp data ──────────────────────────
const SAMPLE_TEMP_DATA = [
  { id: 1, name: "Alice Kumar", role: "UI Designer",    status: "Active",  color: "var(--teal)" },
  { id: 2, name: "Bob Sharma",  role: "Full-stack Dev", status: "Active",  color: "var(--code-blue)" },
  { id: 3, name: "Charlie Rao", role: "Project Lead",   status: "Away",    color: "var(--code-yellow)" },
  { id: 4, name: "Diana Singh", role: "QA Engineer",    status: "Offline", color: "var(--code-magenta)" },
];

const SampleComponent = () => {
  const total = SAMPLE_TEMP_DATA.length;
  const active = SAMPLE_TEMP_DATA.filter((d) => d.status === "Active").length;
  return (
    <div style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-vscode)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: "var(--space-20)", color: "var(--text-highlight)", fontFamily: "var(--font-system)" }}>
      <div style={{ fontSize: "var(--fs-xl)", fontWeight: "var(--fw-semibold)", marginBottom: "var(--space-4)" }}>Team Overview</div>
      <div style={{ fontSize: "var(--fs-body)", color: "var(--icon)", marginBottom: "var(--space-16)" }}>Sample component rendered with temp data</div>
      <div style={{ display: "flex", gap: "var(--space-10)", marginBottom: "var(--space-16)" }}>
        <div style={{ flex: 1, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-10) var(--space-12)" }}>
          <div style={{ fontSize: "var(--fs-hero)", fontWeight: "var(--fw-bold)", color: "var(--teal)" }}>{total}</div>
          <div style={{ fontSize: "var(--fs-small)", color: "var(--icon)" }}>Total members</div>
        </div>
        <div style={{ flex: 1, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-10) var(--space-12)" }}>
          <div style={{ fontSize: "var(--fs-hero)", fontWeight: "var(--fw-bold)", color: "var(--code-blue)" }}>{active}</div>
          <div style={{ fontSize: "var(--fs-small)", color: "var(--icon)" }}>Active now</div>
        </div>
      </div>
      {SAMPLE_TEMP_DATA.map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", padding: "var(--space-8) var(--space-6)", borderBottom: "var(--space-1) solid var(--bg-active)" }}>
          <div style={{ width: 28, height: 28, borderRadius: "var(--radius-round)", background: d.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", color: "var(--bg-panel)", flexShrink: 0 }}>
            {d.name.split(" ").map((w) => w[0]).join("")}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "var(--fs-body)", fontWeight: "var(--fw-semibold)" }}>{d.name}</div>
            <div style={{ fontSize: "var(--fs-small)", color: "var(--icon)" }}>{d.role}</div>
          </div>
          <span style={{ fontSize: "var(--fs-tiny)", padding: "var(--space-2) var(--space-8)", borderRadius: "var(--radius-pill)", background: d.status === "Active" ? "var(--teal-a15)" : d.status === "Away" ? "var(--away-a15)" : "var(--offline-a15)", color: d.status === "Active" ? "var(--teal)" : d.status === "Away" ? "var(--code-yellow)" : "var(--code-magenta)", border: `var(--space-1) solid color-mix(in srgb, ${d.color} 20%, transparent)` }}>{d.status}</span>
        </div>
      ))}
    </div>
  );
};

// NOTE: IFRAME_HTML alag document me render hota hai — wahan app ke
// var(--tokens) resolve NAHI hote, isliye literals rakhe hain.
// Values CENTRAL sheet ke barabar hain: --error-bg (#2a1717),
// --error-border (#732222), --danger (#f44747), --border (#333).
// Token badle to yahan bhi badlo.
const IFRAME_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;height:100%;overflow:auto;background:transparent;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}#preview_mount{width:100%;min-height:100%;box-sizing:border-box;padding:0;}#preview_error{display:none;white-space:pre-wrap;word-break:break-all;padding:16px;background:#2a1717;border:1px solid #732222;border-radius:6px;color:#f44747;font-size:12px;font-family:Consolas,monospace;max-width:600px;margin:16px;}::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:#333;border-radius:4px}</style></head><body><div id="preview_mount"></div><div id="preview_error"></div>
<script>
(function(){
  const forwardNav = (url, target) => {
    if(!url) return;
    const href = String(url);
    if(href.startsWith('#') || href.startsWith('javascript:')) return;
    try { window.parent.postMessage({__previewNav:true, url:href, target}, '*'); } catch {}
    try { if(window.parent && window.parent!==window) window.parent.dispatchEvent(new CustomEvent('add-browser-panel',{detail:{url:href, config:{type:'browser',title:'Browser',url:href}} })); } catch {}
  };
  document.addEventListener('click', (e)=>{
    const a = e.target.closest && e.target.closest('a[href]');
    if(!a) return;
    const href = a.getAttribute('href');
    if(!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const url = a.href; const target = a.getAttribute('target');
    if(target==='_blank'){ forwardNav(url,target); return; }
    // localhost / external -> Browser, hash stays inside
    if(/^https?:\\/\\//i.test(url) || url.includes('localhost') || /^\\d+\\.\\d+\\.\\d+\\.\\d+/.test(href) || /^[^\\s]+\\.[^\\s]+/.test(href)){
      if(!url.startsWith(window.location.href.split('#')[0])){ forwardNav(url,target); return; }
    }
  }, true);
  document.addEventListener('submit', (e)=>{
    const f=e.target; if(f && f.tagName==='FORM'){ e.preventDefault(); e.stopPropagation(); forwardNav(f.action||location.href, f.target); }
  }, true);
  try{ const o=window.open; window.open=(u,t)=>{ if(u) forwardNav(String(u),t||'_blank'); return null; }; }catch{}
  try{
    const op=history.pushState; history.pushState=function(...a){
      const u=a[2]; if(u){ const s=String(u); if(/^https?:\\/\\//i.test(s)||s.includes('localhost')||s.includes('.')){ try{forwardNav(new URL(s,location.href).href);}catch{forwardNav(s);} return; } }
      return op.apply(this,a);
    };
    const or=history.replaceState; history.replaceState=function(...a){
      const u=a[2]; if(u){ const s=String(u); if(/^https?:\\/\\//i.test(s)||s.includes('localhost')||s.includes('.')){ try{forwardNav(new URL(s,location.href).href);}catch{forwardNav(s);} return; } }
      return or.apply(this,a);
    };
  }catch{}
  try{ const oa=location.assign.bind(location); const ore=location.replace.bind(location); location.assign=(u)=>forwardNav(String(u)); location.replace=(u)=>forwardNav(String(u)); }catch{}
  try{
    new MutationObserver((ms)=>{
      for(const m of ms){ for(const n of m.addedNodes){ if(n.tagName==='META'&&n.httpEquiv&&n.httpEquiv.toLowerCase()==='refresh'){ const c=n.getAttribute('content')||''; const mm=c.match(/url\\s*=\\s*(.+)/i); if(mm){ n.remove(); forwardNav(mm[1].trim().replace(/^['\"]|['\"]$/g,'')); } } } }
    }).observe(document.documentElement,{childList:true,subtree:true});
  }catch{}
  let last=location.href;
  setInterval(()=>{
    try{
      const cur=location.href;
      if(cur!==last && cur!=='about:srcdoc' && cur!=='about:blank' && !cur.startsWith('about:srcdoc')){
        last=cur;
        if(/^https?:\\/\\//i.test(cur)||cur.includes('localhost')){
          forwardNav(cur);
          try{ window.stop(); document.open(); document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;height:100%;overflow:auto;background:transparent;}</style></head><body><div id="preview_mount"></div><div id="preview_error"></div></body></html>'); document.close(); }catch{}
        }
      }
    }catch{}
  },500);
  // Independent mount API — runs inside iframe's realm, never touches parent's React root
  let reactRoot=null;
  let currentZoom=1;
  function getMount(){ return document.getElementById('preview_mount'); }
  function getErrEl(){ return document.getElementById('preview_error'); }
  function showError(msg){
    const m=getMount(); const e=getErrEl();
    if(m) m.style.display='none';
    if(e){ e.textContent=msg; e.style.display='block'; }
    try{ window.parent.postMessage({__previewError:true, error:msg},'*'); }catch{}
  }
  function clearError(){
    const m=getMount(); const e=getErrEl();
    if(m) m.style.display='block';
    if(e) e.style.display='none';
  }
  function ensureRoot(){
    const m=getMount();
    if(!m) return null;
    if(!reactRoot){
      if(!window.React || !window.ReactDOM){ return null; }
      try{ reactRoot=window.ReactDOM.createRoot(m); }catch(e){ showError(String(e)); return null; }
    }
    return reactRoot;
  }
  // Sample data for sampleMode (duplicated inside iframe for isolation)
  const SAMPLE_DATA=[
    {id:1,name:"Alice Kumar",role:"UI Designer",status:"Active",color:"var(--teal)"},
    {id:2,name:"Bob Sharma",role:"Full-stack Dev",status:"Active",color:"var(--code-blue)"},
    {id:3,name:"Charlie Rao",role:"Project Lead",status:"Away",color:"var(--code-yellow)"},
    {id:4,name:"Diana Singh",role:"QA Engineer",status:"Offline",color:"var(--code-magenta)"}
  ];
  function SampleComponent(){
    const R=window.React;
    const total=SAMPLE_DATA.length;
    const active=SAMPLE_DATA.filter(d=>d.status==="Active").length;
    return R.createElement('div',{style:{width:'100%',boxSizing:'border-box',background:'var(--bg-vscode)',border:'1px solid var(--border)',borderRadius:"var(--radius-xl)",padding:"var(--space-20)",color:'var(--text-highlight)',fontFamily:"var(--font-system)"}},
      R.createElement('div',{style:{fontSize:"var(--fs-xl)",fontWeight:"var(--fw-semibold)",marginBottom:"var(--space-4)"}},'Team Overview'),
      R.createElement('div',{style:{fontSize:"var(--fs-body)",color:'var(--icon)',marginBottom:"var(--space-16)"}},'Sample component rendered with temp data'),
      R.createElement('div',{style:{display:'flex',gap:"var(--space-10)",marginBottom:"var(--space-16)"}},
        R.createElement('div',{style:{flex:1,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:"var(--radius-lg)",padding:'var(--space-10) var(--space-12)'}},
          R.createElement('div',{style:{fontSize:"var(--fs-hero)",fontWeight:"var(--fw-bold)",color:'var(--teal)'}}, total),
          R.createElement('div',{style:{fontSize:"var(--fs-small)",color:'var(--icon)'}},'Total members')
        ),
        R.createElement('div',{style:{flex:1,background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:"var(--radius-lg)",padding:'var(--space-10) var(--space-12)'}},
          R.createElement('div',{style:{fontSize:"var(--fs-hero)",fontWeight:"var(--fw-bold)",color:'var(--code-blue)'}}, active),
          R.createElement('div',{style:{fontSize:"var(--fs-small)",color:'var(--icon)'}},'Active now')
        )
      ),
      ...SAMPLE_DATA.map(d=> R.createElement('div',{key:d.id, style:{display:'flex',alignItems:'center',gap:"var(--space-10)",padding:'var(--space-8) var(--space-6)',borderBottom:'var(--space-1) solid var(--bg-active)'}},
        R.createElement('div',{style:{width:28,height:28,borderRadius:'var(--radius-round)',background:d.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:"var(--fs-small)",fontWeight:"var(--fw-bold)",color:'var(--bg-panel)',flexShrink:0}}, d.name.split(' ').map(w=>w[0]).join('')),
        R.createElement('div',{style:{flex:1,minWidth:0}},
          R.createElement('div',{style:{fontSize:"var(--fs-body)",fontWeight:"var(--fw-semibold)"}}, d.name),
          R.createElement('div',{style:{fontSize:"var(--fs-small)",color:'var(--icon)'}}, d.role)
        ),
        R.createElement('span',{style:{fontSize:"var(--fs-tiny)",padding:'var(--space-2) var(--space-8)',borderRadius:"var(--radius-pill)",background:d.status==='Active'?'var(--teal-a15)':d.status==='Away'?'var(--away-a15)':'var(--offline-a15)',color:d.status==='Active'?'var(--teal)':d.status==='Away'?'var(--code-yellow)':'var(--code-magenta)',border:'var(--space-1) solid color-mix(in srgb, '+d.color+' 20%, transparent)'}}, d.status)
      ))
    );
  }
  window.__previewMount = function(opts){
    try{
      opts=opts||{};
      const zoom=opts.zoom||1;
      currentZoom=zoom;
      const mount=getMount();
      if(mount){ mount.style.transform='scale('+zoom+')'; mount.style.transformOrigin='top left'; mount.style.transition='transform 0.1s ease'; }
      if(opts.transpileError){
        showError('JSX Transpilation Error\\n'+opts.transpileError);
        return;
      }
      if(!window.React || !window.ReactDOM){
        setTimeout(()=>window.__previewMount(opts), 50);
        return;
      }
      clearError();
      if(opts.sampleMode){
        const root=ensureRoot(); if(!root) return;
        try{
          const R=window.React;
          const content=R.createElement(R.Fragment,null,
            R.createElement('div',{style:{width:'100%',minHeight:'100%',transform:'scale('+zoom+')',transformOrigin:'top left',transition:'transform var(--t-normal) ease'}},
              R.createElement(SampleComponent,null)
            )
          );
          root.render(content);
        }catch(e){ showError(e.message||String(e)); }
        return;
      }
      if(!opts.filePath){
        const root=ensureRoot(); if(!root) return;
        try{
          const R=window.React;
          root.render(R.createElement('div',{style:{display:'flex',flexDirection:'column',alignItems:'center',gap:"var(--space-10)",color:'var(--text-muted)',fontSize:"var(--fs-title)"}}, R.createElement('div',null,'Select a .jsx or .tsx file to render live preview')));
        }catch(e){ showError(String(e)); }
        return;
      }
      if(!opts.code){
        const root=ensureRoot(); if(!root) return;
        try{
          const R=window.React;
          root.render(R.createElement('div',{style:{color:'var(--icon-muted)',fontSize:"var(--fs-body)"}},'Loading preview…'));
        }catch(e){ showError(String(e)); }
        return;
      }
      // Evaluate component code inside iframe's realm (stronger isolation)
      let Comp=null;
      try{
        const exportsObj={}; const moduleObj={exports:exportsObj};
        const require=(id)=>{
          if(id==='react') return window.React;
          if(id==='react-dom') return window.ReactDOM;
          if(id==='react-dom/client') return window.ReactDOMClient||window.ReactDOM;
          if(id==='react/jsx-runtime'||id==='react/jsx-dev-runtime') return window.ReactJSXRuntime;
          return null;
        };
        // Use iframe's Function to ensure window is iframe's
        const runner=new window.Function('React','require','exports','module', opts.code + "\\nconst exp = module.exports.default || exports.default || module.exports;\\nif (typeof exp === 'function') return exp;\\nif (exp && typeof exp === 'object') { for (const k of Object.keys(exp)) { const v=exp[k]; if (typeof v === 'function') return v; } }\\nreturn (typeof App !== 'undefined' ? App : null) || (typeof Component !== 'undefined' ? Component : null);");
        Comp=runner(window.React, require, exportsObj, moduleObj);
      }catch(e){
        showError(e.message||String(e));
        return;
      }
      if(!Comp){
        showError('No default export or React component found in file');
        return;
      }
      const root=ensureRoot(); if(!root) return;
      try{
        const R=window.React;
        const el = R.isValidElement(Comp) ? Comp : R.createElement(Comp);
        const wrapper=R.createElement('div',{style:{width:'100%',minHeight:'100%',transform:'scale('+zoom+')',transformOrigin:'top left',transition:'transform var(--t-normal) ease'}}, el);
        // Simple error boundary via try/catch around render — runtime errors during render will be caught by window.onerror
        root.render(wrapper);
      }catch(e){ showError(e.message||String(e)); }
    }catch(e){ 
      try{ showError(String(e)); }catch{}
    }
  };
  window.__previewUnmount = function(){ try{ if(reactRoot){ reactRoot.unmount(); reactRoot=null; } }catch{} };
  window.__previewReady=true;
  try{ window.parent.postMessage({__previewReady:true},'*'); }catch{}
  // Global error handler inside iframe — catch runtime errors and show inside iframe, never bubble to parent
  window.addEventListener('error', (e)=>{
    try{
      const msg=e.message||String(e.error||e);
      showError('Runtime Error\\n'+msg);
      e.preventDefault();
    }catch{}
  });
  window.addEventListener('unhandledrejection', (e)=>{
    try{
      const msg=e.reason? (e.reason.message||String(e.reason)) : 'Unhandled rejection';
      showError('Runtime Error\\n'+msg);
      e.preventDefault();
    }catch{}
  });
})();
<\/script>
</body></html>`;

const ComponentPreview = ({ nodeId, config }) => {
  const [filePath, setFilePath] = useState(config?.filePath || null);
  const [projectFiles, setProjectFiles] = useState([]);
  const [bgMode, setBgMode] = useState("dark"); // "dark" | "light" | "grid"
  const [zoom, setZoom] = useState(1.0);
  const [transpileError, setTranspileError] = useState(null);
  const [previewCode, setPreviewCode] = useState(null);
  const [ComponentToRender, setComponentToRender] = useState(null); // legacy, not used in iframe isolated mode
  const [lastUpdateKey, setLastUpdateKey] = useState(0);
  const [sampleMode, setSampleMode] = useState(false);

  // Iframe sandbox — full isolation from main window navigation (allow-scripts + allow-same-origin + allow-forms, but NO allow-top-navigation / allow-popups)
  const iframeRef = useRef(null);
  const reactRootRef = useRef(null);
  const iframeReadyRef = useRef(false);

  // Live-edit sync: latest in-memory sources pushed by the code editor
  // (path -> code). Used by loadAndTranspile before falling back to disk so
  // the preview reflects unsaved keystrokes.
  const liveSourcesRef = useRef(new Map());
  const liveReloadTimerRef = useRef(null);
  const fsReloadTimerRef = useRef(null);
  const loadSeqRef = useRef(0); // stale bundle results discard karne ke liye
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  const getIframeDoc = useCallback(() => {
    try { return iframeRef.current?.contentDocument || iframeRef.current?.contentWindow?.document || null; } catch { return null; }
  }, []);

  const getIframeWin = useCallback(() => {
    try { return iframeRef.current?.contentWindow || null; } catch { return null; }
  }, []);

  const getMount = useCallback(() => {
    const doc = getIframeDoc();
    if (!doc) return null;
    return doc.getElementById("preview_mount");
  }, [getIframeDoc]);

  // ── Setup iframe isolation: inject React runtime for independent mounting ──
  // Stronger origin isolation: component code runs inside iframe's window (via iframe's Function),
  // not parent's. Parent's React root never unmounts. Navigation guards are inside iframe HTML.
  const setupIframeGuard = useCallback(() => {
    const doc = getIframeDoc();
    const win = getIframeWin();
    if (!doc || !win) return;
    // Inject React runtime into iframe for independent mounting (parent -> iframe)
    try {
      win.React = React;
      win.ReactDOM = ReactDOM;
      win.ReactDOMClient = ReactDOM;
      win.ReactJSXRuntime = ReactJSXRuntime;
    } catch {}
    if (doc.__previewGuardInstalled) return;
    doc.__previewGuardInstalled = true;
    // Navigation guards are already inside iframe's srcDoc script; no need to duplicate here.
    // Keep a lightweight poll cleanup handle for location changes that escape iframe's guard
    if (!doc.__previewPoll) {
      try {
        let lastHref = win.location.href;
        const poll = setInterval(() => {
          try {
            const cur = win.location.href;
            if (cur !== lastHref && cur !== "about:srcdoc" && cur !== "about:blank" && !cur.startsWith("about:srcdoc")) {
              lastHref = cur;
              if (/^https?:\/\//i.test(cur) || cur.includes("localhost") || /^\d+\.\d+\.\d+\.\d+/.test(cur)) {
                try { window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: cur, config: { type: "browser", title: "Browser", url: cur } } })); } catch {}
                try { win.stop(); } catch {}
              }
            }
          } catch {}
        }, 700);
        doc.__previewPoll = poll;
      } catch {}
    }
  }, [getIframeDoc, getIframeWin]);

  // ── Preview CSS store (iframe reloads wipe <head>, so re-apply) ──────────
  const [loadedCssFiles, setLoadedCssFiles] = useState([]);
  const loadedCssRef = useRef(new Map()); // cssKey -> cssContent
  const tailwindNeededRef = useRef(false);
  const projectCssCacheRef = useRef({ root: null, globals: [], hasTailwind: false });

  const TAILWIND_CDN = "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4";

  const isTailwindCss = useCallback((css) => {
    if (!css || typeof css !== "string") return false;
    return /@tailwind\b|@import\s+["']tailwindcss["']|@apply\b|@theme\b|@custom-variant\b|@config\b/i.test(css);
  }, []);

  // Tailwind browser build compiles <style type="text/tailwindcss"> live.
  // Plain <style> me @tailwind/@apply dead rehte hain — isliye type switch.
  const ensureTailwindScript = useCallback((doc) => {
    if (!doc || !doc.head) return;
    try {
      if (doc.head.querySelector('script[data-tailwind-browser]')) return;
      const s = doc.createElement("script");
      s.src = TAILWIND_CDN;
      s.setAttribute("data-tailwind-browser", "1");
      s.async = true;
      doc.head.appendChild(s);
    } catch {}
  }, []);

  // ── Helper to inject CSS into the iframe's document head ───────────────────
  // Equality guard: same content dobara likhne se Tailwind browser build har
  // baar recompile karta hai (MutationObserver storm) — CPU/OOM se app band
  // ho sakti hai. Isliye badla hua ho tabhi DOM touch karo.
  const injectPreviewCss = useCallback((cssKey, cssContent, opts = {}) => {
    if (!cssKey) return;
    const next = cssContent || "";
    const prev = loadedCssRef.current.get(cssKey);
    loadedCssRef.current.set(cssKey, next);
    const needsTw = opts.tailwind ?? isTailwindCss(next);
    if (needsTw) tailwindNeededRef.current = true;
    const doc = getIframeDoc();
    if (!doc) return;
    const head = doc.head;
    if (!head) return;
    if (tailwindNeededRef.current) ensureTailwindScript(doc);
    const styleId = `preview-css-${String(cssKey).replace(/[^a-zA-Z0-9_]/g, "_").slice(-120)}`;
    let el = null;
    try { el = head.querySelector(`#${CSS.escape ? CSS.escape(styleId) : styleId}`); } catch { el = head.querySelector(`[data-preview-css="${String(cssKey).slice(-80)}"]`); }
    if (!el) {
      el = doc.createElement("style");
      el.id = styleId;
      el.setAttribute("data-preview-css", String(cssKey).slice(-160));
      head.appendChild(el);
    }
    const wantType = needsTw ? "text/tailwindcss" : null;
    const hasType = el.getAttribute("type");
    if (prev === next && (hasType === wantType || (!hasType && !wantType))) return; // kuch nahi badla
    if (needsTw) el.setAttribute("type", "text/tailwindcss");
    else el.removeAttribute("type");
    el.textContent = next;
  }, [getIframeDoc, isTailwindCss, ensureTailwindScript]);

  // Re-apply cached styles after srcDoc reload (head wipe ho jata hai).
  const reapplyPreviewCss = useCallback(() => {
    const doc = getIframeDoc();
    if (!doc || !doc.head) return;
    if (tailwindNeededRef.current) ensureTailwindScript(doc);
    for (const [key, content] of loadedCssRef.current.entries()) {
      try {
        const styleId = `preview-css-${String(key).replace(/[^a-zA-Z0-9_]/g, "_").slice(-120)}`;
        let el = null;
        try { el = doc.head.querySelector(`#${CSS.escape ? CSS.escape(styleId) : styleId}`); } catch { el = null; }
        if (!el) {
          el = doc.createElement("style");
          el.id = styleId;
          el.setAttribute("data-preview-css", String(key).slice(-160));
          doc.head.appendChild(el);
        }
        const wantTw = isTailwindCss(content);
        const wantType = wantTw ? "text/tailwindcss" : null;
        if (el.textContent === (content || "") && el.getAttribute("type") === wantType) continue;
        if (wantTw) el.setAttribute("type", "text/tailwindcss");
        else el.removeAttribute("type");
        el.textContent = content || "";
      } catch {}
    }
  }, [getIframeDoc, ensureTailwindScript, isTailwindCss]);

  // Drop all styles injected for a previously previewed component.
  const clearPreviewCss = useCallback((onlyBundle = false) => {
    if (onlyBundle) {
      for (const k of [...loadedCssRef.current.keys()]) {
        if (String(k).startsWith("__bundle__")) loadedCssRef.current.delete(k);
      }
    } else {
      loadedCssRef.current.clear();
      tailwindNeededRef.current = false;
    }
    const doc = getIframeDoc();
    if (!doc || !doc.head) return;
    try {
      doc.head.querySelectorAll("style[data-preview-css]").forEach((el) => {
        if (!onlyBundle) { el.remove(); return; }
        // bundle key ka styleId `preview-css-__bundle__...` se shuru hota hai
        if ((el.id || "").includes("__bundle__")) el.remove();
      });
    } catch {}
  }, [getIframeDoc]);

  // ── Find all .jsx / .tsx files in current project ─────────────────────────
  const scanProjectFiles = useCallback(async (dir) => {
    if (!dir) return [];
    try {
      const entries = await window.electronAPI.readDirAll(dir);
      let results = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist" || entry.name === "build" || entry.name === ".git" || entry.name === "out" || entry.name === ".next") continue;
        if (entry.isDir) {
          const sub = await scanProjectFiles(entry.path);
          results = results.concat(sub);
          if (results.length > 400) break; // cap to avoid huge lists
        } else if (/\.(jsx|tsx|js|ts)$/i.test(entry.name)) {
          // only keep js/ts that likely contain JSX/component (quick peek: contains < or React)
          if (/\.(jsx|tsx)$/i.test(entry.name)) {
            results.push(entry.path);
          } else {
            // for .js/.ts, peek first 4k for jsx-ish content to avoid flooding list with non-components
            try {
              const head = await window.electronAPI.readTextFile(entry.path).then(t => (t||"").slice(0, 4000));
              if (/<[A-Za-z]/.test(head) || /React|export\s+default|function\s+[A-Z]/.test(head)) results.push(entry.path);
            } catch { results.push(entry.path); }
          }
        }
      }
      return results.slice(0, 400);
    } catch {
      return [];
    }
  }, []);

  const refreshFileList = useCallback(async () => {
    const root = window.__currentProjectPath;
    if (root) {
      const files = await scanProjectFiles(root);
      // ensure currently selected file stays in list
      if (filePath && !files.includes(filePath) && /\.(jsx|tsx|js|ts)$/i.test(filePath)) {
        files.unshift(filePath);
      }
      setProjectFiles(files);
      if (!filePath && files.length > 0) {
        setFilePath(files[0]);
      }
      if (files.length === 0 && filePath) {
        // keep current file even if scan empty
      }
    } else {
      setProjectFiles([]);
    }
  }, [scanProjectFiles, filePath]);

  useEffect(() => {
    refreshFileList();
  }, [refreshFileList]);

  // Listen for project open/close events
  useEffect(() => {
    const onOpen = () => {
      projectCssCacheRef.current = { root: null, globals: [], hasTailwind: false };
      refreshFileList();
    };
    const onClose = () => {
      setSampleMode(false); setFilePath(null); setProjectFiles([]);
      setComponentToRender(null); setPreviewCode(null);
      setLoadedCssFiles([]);
      loadedCssRef.current.clear();
      tailwindNeededRef.current = false;
      projectCssCacheRef.current = { root: null, globals: [], hasTailwind: false };
    };
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    return () => {
      window.removeEventListener("project:opened", onOpen);
      window.removeEventListener("project:closed", onClose);
    };
  }, [refreshFileList]);

  // Listen for file changes / active editor file
  useEffect(() => {
    const onOpenFile = (e) => {
      const path = e.detail?.path || e.detail?.filePath;
      if (path && /\.(jsx|tsx)$/i.test(path)) {
        setSampleMode(false);
        setFilePath(path);
      }
    };
    window.addEventListener("open-file-in-editor", onOpenFile);
    return () => window.removeEventListener("open-file-in-editor", onOpenFile);
  }, []);

  // ── Project-aware CSS auto-detect ─────────────────────────────────────────
  // NOTE: component ke import kiye CSS (relative / package / @import chain)
  // bundler khud resolve karke `res.css` me deta hai (neeche inject hota hai).
  // Yahan GLOBAL stylesheets auto-detect hoti hain jo import me nahi hain —
  // project structure ke hisaab se:
  //  1. sibling same-name (App.jsx -> App.css / App.module.css)
  //  2. component dir se project root tak walk-up (index.css, globals.css…)
  //  3. root conventions (src/index.css, app/globals.css, output.css…)
  //  4. entry files (main/index/App) ke `import './x.css'`
  //  5. index.html ke <link rel=stylesheet>
  //  6. framework dist (bootstrap/bulma) + tailwind browser fallback
  const toPosix = (p) => String(p || "").replace(/\\/g, "/");
  const posixNorm = (p) => {
    const parts = toPosix(p).split("/");
    const out = [];
    for (const seg of parts) {
      if (!seg || seg === ".") continue;
      if (seg === "..") { if (out.length && out[out.length - 1] !== ".." && !/^[A-Za-z]:$/.test(out[out.length - 1])) out.pop(); else out.push(seg); }
      else out.push(seg);
    }
    let s = out.join("/");
    if (/^[A-Za-z]:/.test(toPosix(p).slice(0, 2)) && !/^[A-Za-z]:\//.test(s)) s = s.replace(/^([A-Za-z]:)/, "$1/");
    if (toPosix(p).startsWith("/") && !s.startsWith("/")) s = "/" + s;
    return s;
  };
  const posixDir = (p) => { const s = toPosix(p); const i = s.lastIndexOf("/"); return i <= 0 ? s.slice(0, i + 1) : s.slice(0, i); };
  const stripRoot = (root, p) => {
    const r = toPosix(root).replace(/\/$/, "");
    const s = toPosix(p);
    if (s === r) return ".";
    if (s.startsWith(r + "/")) return s.slice(r.length + 1);
    return null;
  };

  const tryRead = async (p) => {
    try {
      const t = await window.electronAPI?.readTextFile(p);
      return typeof t === "string" ? t : null;
    } catch { return null; }
  };

  // Global CSS ke @import "..." ko inline resolve karo (relative chain).
  // "tailwindcss" / http / package imports ko chhodo — bundler/CDN sambhalega.
  const resolveCssImports = useCallback(async (css, baseDirPosix, seen = new Set(), depth = 0) => {
    if (!css || depth > 4) return css;
    const re = /@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])\s*[^;]*;/g;
    let out = css;
    let m;
    const jobs = [];
    while ((m = re.exec(css))) {
      const raw = (m[1] || m[2] || "").trim();
      if (!raw || raw.startsWith("http") || raw.startsWith("data:") || raw.startsWith("blob:") || raw === "tailwindcss") continue;
      const clean = raw.split("?")[0].split("#")[0];
      if (!/\.css$/i.test(clean)) continue;
      let abs = null;
      if (clean.startsWith("./") || clean.startsWith("../") || !clean.includes(":") && !clean.startsWith("@") && !clean.startsWith("~")) {
        abs = posixNorm(`${baseDirPosix}/${clean}`);
      } else if (clean.startsWith("~/")) {
        continue;
      } else continue;
      if (!abs || seen.has(abs.toLowerCase())) continue;
      seen.add(abs.toLowerCase());
      jobs.push({ full: m[0], abs });
    }
    for (const j of jobs) {
      const inner = await tryRead(j.abs);
      if (inner == null) continue;
      const resolved = await resolveCssImports(inner, posixDir(j.abs), seen, depth + 1);
      out = out.split(j.full).join(`/* @import ${j.abs} */\n${resolved}`);
    }
    return out;
  }, []);

  const readPackageInfo = useCallback(async (rootPosix) => {
    try {
      const raw = await tryRead(`${rootPosix}/package.json`);
      if (!raw) return null;
      const pkg = JSON.parse(raw);
      return pkg || null;
    } catch { return null; }
  }, []);

  const loadAssociatedCss = useCallback(async (targetFilePath, opts = {}) => {
    if (!targetFilePath) return;
    const { force = false, isLive = false } = opts || {};
    const targetPosix = toPosix(targetFilePath);
    const rootRaw = window.__currentProjectPath || null;
    const rootPosix = rootRaw ? toPosix(rootRaw).replace(/\/$/, "") : posixDir(targetPosix);

    // Live typing (har keystroke) par disk rescan mat karo — cache reuse.
    const cache = projectCssCacheRef.current;
    if (isLive && !force && cache.root === rootPosix && cache.globals?.length) {
      clearPreviewCss(true); // sirf purana bundle css hatao, globals re-apply
      for (const g of cache.globals) injectPreviewCss(g.key, g.content);
      setLoadedCssFiles(cache.globals.map((g) => g.key));
      return;
    }

    const seen = new Set(); // lowercased abs -> dedupe
    const orderedKeys = [];
    const contents = new Map(); // key -> raw css
    const mark = (key) => {
      const k = posixNorm(key);
      const lk = k.toLowerCase();
      if (seen.has(lk)) return null;
      seen.add(lk);
      orderedKeys.push(k);
      return k;
    };

    // ── 1. sibling same-name ──
    const siblingBase = targetPosix.replace(/\.(jsx|tsx|js|ts)$/i, "");
    for (const cand of [`${siblingBase}.css`, `${siblingBase}.module.css`]) {
      if (cand === targetPosix) continue;
      mark(cand);
    }

    // ── 2. walk-up: component dir -> root ──
    const COMMON = ["index.css", "styles.css", "style.css", "globals.css", "global.css", "main.css", "app.css", "App.css", "output.css"];
    try {
      let dir = posixDir(targetPosix);
      let guard = 0;
      while (dir && guard++ < 10) {
        for (const n of COMMON) mark(`${dir}/${n}`);
        if (toPosix(dir).toLowerCase() === rootPosix.toLowerCase()) break;
        if (!stripRoot(rootPosix, dir) && toPosix(dir).toLowerCase() !== rootPosix.toLowerCase()) {
          // root ke bahar nikal gaye (target root ke bahar?) — ek level aur bas
          if (guard > 3 && !toPosix(dir).startsWith(rootPosix.slice(0, 3))) break;
        }
        const parent = posixDir(dir);
        if (!parent || parent === dir) break;
        dir = parent;
        if (dir.length < rootPosix.length - 1 && !rootPosix.toLowerCase().startsWith(dir.toLowerCase())) break;
      }
    } catch {}

    // ── 3. root conventions (framework-agnostic) ──
    const ROOT_CANDS = [
      "src/index.css", "src/globals.css", "src/global.css", "src/styles.css",
      "src/style.css", "src/main.css", "src/App.css", "src/output.css",
      "src/index.tailwind.css", "app/globals.css", "styles/globals.css",
      "styles/global.css", "styles/main.css", "public/styles.css",
      "public/global.css", "assets/style.css", "renderer/globals.css",
    ];
    for (const rel of ROOT_CANDS) mark(`${rootPosix}/${rel}`);

    // ── package.json (framework detect) ──
    let pkg = null;
    try { pkg = await readPackageInfo(rootPosix); } catch {}
    const deps = { ...((pkg && pkg.dependencies) || {}), ...((pkg && pkg.devDependencies) || {}) };
    const hasTailwind = !!deps.tailwindcss || !!deps["@tailwindcss/vite"] || !!deps["@tailwindcss/postcss"];
    let hasTwConfig = false;
    if (hasTailwind) {
      for (const f of [`${rootPosix}/tailwind.config.js`, `${rootPosix}/tailwind.config.ts`, `${rootPosix}/tailwind.config.cjs`]) {
        const t = await tryRead(f);
        if (t != null) { hasTwConfig = true; break; }
      }
    }
    if (hasTailwind && !hasTwConfig) {
      // tailwind v4 (CSS-based, bina config) — globals me @import "tailwindcss" hi kaafi
      hasTwConfig = true;
    }

    // ── 4. entry files ke css imports ──
    const ENTRIES = ["src/main.jsx", "src/main.tsx", "src/main.js", "src/main.ts", "src/index.jsx", "src/index.tsx", "src/index.js", "src/index.ts", "src/App.jsx", "src/App.tsx", "src/App.js", "src/App.ts"];
    const importRe = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+\.css(?:\?[^'"]*)?)['"]|require\s*\(\s*['"]([^'"]+\.css(?:\?[^'"]*)?)['"]\s*\)/g;
    for (const rel of ENTRIES) {
      const abs = `${rootPosix}/${rel}`;
      let text = null;
      try { text = await tryRead(abs); } catch {}
      if (!text) continue;
      let im;
      importRe.lastIndex = 0;
      while ((im = importRe.exec(text))) {
        let imp = (im[1] || im[2] || "").split("?")[0];
        if (!imp) continue;
        if (imp.startsWith("http") || imp.startsWith("data:")) continue;
        let resolved = null;
        if (imp.startsWith("@/")) resolved = posixNorm(`${rootPosix}/src/${imp.slice(2)}`);
        else if (imp.startsWith("~/")) resolved = posixNorm(`${rootPosix}/${imp.slice(2)}`);
        else if (imp.startsWith("/") && !imp.startsWith("//")) resolved = posixNorm(`${rootPosix}${imp}`);
        else if (imp.startsWith(".")) resolved = posixNorm(`${posixDir(abs)}/${imp}`);
        else resolved = posixNorm(`${rootPosix}/node_modules/${imp}`); // bare package css
        mark(resolved);
      }
    }

    // ── 5. index.html <link rel=stylesheet> ──
    for (const hrel of ["index.html", "public/index.html", "src/index.html"]) {
      const habs = `${rootPosix}/${hrel}`;
      let html = null;
      try { html = await tryRead(habs); } catch {}
      if (!html) continue;
      const linkRe = /<link\b[^>]*href\s*=\s*["']([^"']+\.css[^"']*)["'][^>]*>/gi;
      let lm;
      while ((lm = linkRe.exec(html))) {
        let href = (lm[1] || "").split("?")[0].split("#")[0].trim();
        if (!href || href.startsWith("http") || href.startsWith("data:") || href.startsWith("blob:")) continue;
        if (href.startsWith("/")) mark(posixNorm(`${rootPosix}${href}`));
        else mark(posixNorm(`${posixDir(habs)}/${href}`));
      }
    }

    // ── 6. framework dist css (deps ke hisaab se) ──
    if (deps.bootstrap) mark(`${rootPosix}/node_modules/bootstrap/dist/css/bootstrap.min.css`);
    if (deps.bulma) mark(`${rootPosix}/node_modules/bulma/css/bulma.min.css`);
    if (deps["foundation-sites"]) mark(`${rootPosix}/node_modules/foundation-sites/dist/css/foundation.min.css`);
    if (deps.antd) mark(`${rootPosix}/node_modules/antd/dist/antd.min.css`);
    if (deps["semantic-ui-css"]) mark(`${rootPosix}/node_modules/semantic-ui-css/semantic.min.css`);

    // ── 7. build output css (vite/cra dist) — pehla chhota bundle ──
    for (const drel of ["dist", "build"]) {
      try {
        const entries = await window.electronAPI?.readDirAll(`${rootPosix}/${drel}`);
        if (Array.isArray(entries)) {
          for (const e of entries.slice(0, 40)) {
            if (!e || e.isDir) continue;
            if (/\.css$/i.test(e.name || e.path || "")) mark(e.path || `${rootPosix}/${drel}/${e.name}`);
            if (orderedKeys.length > 60) break;
          }
          // dist/assets me aksar hashed css hota hai
          const assets = (entries || []).find((e) => e && e.isDir && e.name === "assets");
          if (assets) {
            try {
              const inner = await window.electronAPI?.readDirAll(assets.path);
              for (const f of (inner || []).slice(0, 20)) {
                if (f && !f.isDir && /\.css$/i.test(f.name || "")) mark(f.path);
              }
            } catch {}
          }
        }
      } catch {}
    }

    // ── read + inject (order preserved, cap 12 files / 600KB total / 500KB per file) ──
    // Bahut badi single stylesheet (MBs) iframe me lagatar inject hona OOM ka
    // reason ban sakta hai — isliye per-file cap.
    clearPreviewCss();
    const loaded = [];
    let bytes = 0;
    for (const key of orderedKeys.slice(0, 40)) {
      if (loaded.length >= 12 || bytes > 600 * 1024) break;
      let raw = null;
      try { raw = await tryRead(key); } catch {}
      if (raw == null || !raw.trim()) continue;
      if (raw.length > 500 * 1024) {
        try { console.warn(`[preview] skip oversize css (${Math.round(raw.length / 1024)}KB): ${key}`); } catch {}
        continue;
      }
      let finalCss = raw;
      try { finalCss = await resolveCssImports(raw, posixDir(key)); } catch {}
      bytes += (finalCss || "").length;
      contents.set(key, finalCss);
      injectPreviewCss(key, finalCss);
      // chhota display name: root-relative agar andar hai
      const rel = stripRoot(rootPosix, key);
      loaded.push(rel ? (rel === "." ? key : rel) : key);
    }
    // tailwind dep hai par koi tailwind css nahi mila -> browser CDN ready rakho
    if (hasTailwind && ![...contents.values()].some((c) => isTailwindCss(c))) {
      tailwindNeededRef.current = true;
      try { ensureTailwindScript(getIframeDoc()); } catch {}
    }
    projectCssCacheRef.current = {
      root: rootPosix,
      globals: [...contents.entries()].map(([key, content]) => ({ key, content })),
      hasTailwind,
    };
    setLoadedCssFiles(loaded);
  }, [injectPreviewCss, clearPreviewCss, resolveCssImports, readPackageInfo, getIframeDoc, ensureTailwindScript, isTailwindCss]);

  // ── Transpile & Load Component ────────────────────────────────────────────
  // Stronger origin isolation: bundle in main, evaluate & mount INSIDE iframe's realm
  const loadAndTranspile = useCallback(async (path, sourceOverride, opts = {}) => {
    if (!path) return;
    const mySeq = ++loadSeqRef.current;
    setTranspileError(null);

    const isLive = sourceOverride != null;
    const forceCss = !!opts.forceCss;
    let source = sourceOverride;
    if (source == null) {
      source = liveSourcesRef.current.get(path);
    }
    if (source == null) {
      source = await window.electronAPI.readTextFile(path);
    }
    if (source === null) {
      setTranspileError(`Could not read file: ${path.split(/[\\/]/).pop()}`);
      setPreviewCode(null);
      setComponentToRender(null);
      return;
    }

    // Globals: full rescan on file switch/save, cache-reuse on live typing.
    await loadAssociatedCss(path, { isLive: isLive && !forceCss, force: forceCss });

    let codeToTranspile = source;
    if (!/export\s+default|function|const|class/i.test(source) && /^\s*</.test(source.trim())) {
      codeToTranspile = `export default function PreviewSnippet() { return (\n${source}\n); }`;
    }

    if (!window.electronAPI?.bundleComponent) {
      setTranspileError("Preview bundler not available — restart the app after `npm install`");
      setPreviewCode(null);
      setComponentToRender(null);
      return;
    }
    let res;
    try {
      res = await window.electronAPI.bundleComponent(codeToTranspile, path, window.__currentProjectPath);
    } catch (e) {
      setTranspileError(e?.message || String(e) || "Bundling failed");
      setPreviewCode(null);
      setComponentToRender(null);
      return;
    }
    if (!res?.ok) {
      setTranspileError(res?.error || "Bundling failed");
      setPreviewCode(null);
      setComponentToRender(null);
      return;
    }

    // Stale guard: tez typing/save me purana bundle naya state overwrite na kare.
    if (mySeq !== loadSeqRef.current || path !== filePathRef.current) return;

    // Store CJS bundle for iframe to evaluate independently (isolated realm)
    // + bundler-resolved CSS (saare CSS imports — relative / package /
    // @import / CSS modules — resolve hokar ek stylesheet me)
    if (res.css) {
      injectPreviewCss(`__bundle__${path}`, res.css);
    } else {
      // pichhli file ka bundle-css yahan leak na ho
      try {
        const k = `__bundle__${path}`;
        if (loadedCssRef.current.has(k)) {
          loadedCssRef.current.delete(k);
          const doc = getIframeDoc();
          doc?.head?.querySelectorAll("style[data-preview-css]")?.forEach((el) => {
            if ((el.id || "").includes("__bundle__")) el.remove();
          });
        }
      } catch {}
    }
    setPreviewCode(res.code);
    setComponentToRender(null);
    setLastUpdateKey((k) => k + 1);
  }, [loadAssociatedCss, clearPreviewCss, injectPreviewCss, getIframeDoc]);

  useEffect(() => {
    // A pending live-reload from a previous file must not render here.
    if (liveReloadTimerRef.current) {
      clearTimeout(liveReloadTimerRef.current);
      liveReloadTimerRef.current = null;
    }
    if (filePath) {
      loadAndTranspile(filePath);
    }
  }, [filePath, loadAndTranspile]);

  // ── Live sync from the code editor ────────────────────────────────────────
  // Re-renders while typing (no save needed): the editor pushes in-memory
  // sources via `component:sourceChanged` and announces the active file via
  // `editor:fileActivated` (also fired when opening/switching a jsx/tsx file).
  const scheduleLiveReload = useCallback((path, code) => {
    if (liveReloadTimerRef.current) clearTimeout(liveReloadTimerRef.current);
    liveReloadTimerRef.current = setTimeout(() => {
      liveReloadTimerRef.current = null;
      if (path !== filePathRef.current) return;
      loadAndTranspile(path, code);
    }, 250);
  }, [loadAndTranspile]);

  useEffect(() => {
    const onSourceChanged = (e) => {
      const { path, code } = e.detail || {};
      if (!path || typeof code !== "string") return;
      liveSourcesRef.current.set(path, code);
      if (path === filePathRef.current) {
        scheduleLiveReload(path, code);
      }
    };
    const onFileActivated = (e) => {
      const p = e.detail?.path;
      if (p && /\.(jsx|tsx)$/i.test(p)) {
        setSampleMode(false);
        setFilePath(p);
      }
    };
    window.addEventListener("component:sourceChanged", onSourceChanged);
    window.addEventListener("editor:fileActivated", onFileActivated);
    return () => {
      window.removeEventListener("component:sourceChanged", onSourceChanged);
      window.removeEventListener("editor:fileActivated", onFileActivated);
      if (liveReloadTimerRef.current) {
        clearTimeout(liveReloadTimerRef.current);
        liveReloadTimerRef.current = null;
      }
    };
  }, [scheduleLiveReload]);

  // Watch for filesystem changes to auto-update live preview (authoritative
  // disk content after a save — drop any stale in-memory live source).
  // CSS save par cache invalidate taaki nayi global styles turant lagen.
  useEffect(() => {
    const root = window.__currentProjectPath;
    if (!root) return;
    const unsub = window.electronAPI.onFsChange((_dir, changedPath) => {
      if (!filePath) return;
      // Har fs event par reload nahi — dev-server (vite HMR) dist/build me
      // lagatar likhta hai; har event par full rescan+bundle = overload/crash.
      try {
        const cp = String(changedPath || "").replace(/\\/g, "/");
        if (!cp) return;
        // build outputs / deps / vcs ignore
        if (/(^|\/)(dist|build|out|\.next|\.nuxt|coverage|\.turbo|\.parcel-cache|node_modules|\.git)(\/|$)/i.test(cp)) return;
        const isSelf = cp.toLowerCase() === String(filePath).replace(/\\/g, "/").toLowerCase();
        const isCss = /\.css$/i.test(cp);
        const isCode = /\.(jsx|tsx|js|ts|json)$/i.test(cp);
        const isAsset = /\.(png|jpe?g|gif|webp|svg|woff2?|ttf|eot|otf)$/i.test(cp);
        if (!isSelf && !isCss && !isCode && !isAsset) return; // md/log/tmp etc.
        if (isCss) {
          projectCssCacheRef.current = { root: null, globals: [], hasTailwind: false };
        }
        // self-file change par stale live-source hatao; doosri file par nahi
        if (isSelf) liveSourcesRef.current.delete(filePath);
        if (fsReloadTimerRef.current) clearTimeout(fsReloadTimerRef.current);
        fsReloadTimerRef.current = setTimeout(() => {
          fsReloadTimerRef.current = null;
          if (filePathRef.current !== filePath) return;
          loadAndTranspile(filePath, undefined, { forceCss: isCss || isSelf });
        }, 600);
      } catch {}
    });
    return () => {
      try { unsub(); } catch {}
      if (fsReloadTimerRef.current) { clearTimeout(fsReloadTimerRef.current); fsReloadTimerRef.current = null; }
    };
  }, [filePath, loadAndTranspile]);

  // ── Iframe onLoad: mark ready, inject React, and trigger mount ──────────
  const handleIframeLoad = useCallback(() => {
    if (iframeReadyRef.current && getIframeWin()?.__previewMount) {
      setupIframeGuard();
      try { reapplyPreviewCss(); } catch {}
      return;
    }
    iframeReadyRef.current = true;
    setupIframeGuard();
    try { reapplyPreviewCss(); } catch {}
    // Defer mount to ensure iframe's internal script has set __previewMount
    setTimeout(() => setLastUpdateKey(k => k + 1), 0);
  }, [setupIframeGuard, getIframeWin, reapplyPreviewCss]);

  // ── Listen for navigation / errors forwarded from iframe ───────────────────
  useEffect(() => {
    const onMessage = (e) => {
      const data = e.data || {};
      if (data.__previewNav && data.url) {
        try {
          window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: String(data.url), config: { type: "browser", title: "Browser", url: String(data.url) } } }));
        } catch {}
      }
      if (data.__previewError && data.error) {
        // keep viewer's error state in sync but don't crash parent
        // transpileError already handles build errors; runtime errors stay inside iframe
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // ── Render the preview into the iframe (isolated realm) ───────────────────
  const renderPreview = useCallback(() => {
    const win = getIframeWin();
    const doc = getIframeDoc();
    if (!win || !doc) return;
    setupIframeGuard();
    // srcDoc reload head wipe kar deta hai — cached CSS wapas lagao
    try { reapplyPreviewCss(); } catch {}
    // Ensure React is available inside iframe
    if (!win.__previewMount) {
      // iframe script not yet ready, retry
      setTimeout(() => renderPreview(), 50);
      return;
    }
    // Apply bgMode to iframe body (parent controls outer container bg too)
    try {
      doc.body.style.background = bgMode === "light" ? "var(--text-inverse)" : bgMode === "grid" ? "var(--grad-preview-grid)" : "var(--bg-surface)";
      const m = getMount();
      if (m) m.style.background = "transparent";
    } catch {}

    // Delegate actual mounting to iframe's isolated context
    try {
      win.__previewMount({
        code: previewCode,
        filePath,
        zoom,
        sampleMode,
        transpileError,
        fileName: filePath ? filePath.split(/[\\/]/).pop() : "",
      });
    } catch (e) {
      // Never let iframe mount failure affect parent UI
      console.error("Preview mount failed (isolated):", e);
    }
  }, [sampleMode, transpileError, filePath, previewCode, zoom, bgMode, lastUpdateKey, getIframeWin, getIframeDoc, getMount, setupIframeGuard, reapplyPreviewCss]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      iframeReadyRef.current = false;
      const doc = getIframeDoc();
      if (doc && doc.__previewPoll) {
        try { clearInterval(doc.__previewPoll); } catch {}
        delete doc.__previewPoll;
      }
      // Tell iframe to unmount its own root (isolated)
      try { getIframeWin()?.__previewUnmount?.(); } catch {}
    };
  }, [getIframeDoc, getIframeWin]);

  // Re-render the preview whenever its inputs change (but parent root never unmounts)
  useEffect(() => {
    renderPreview();
  }, [renderPreview]);

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : "No file selected";

  const getCanvasBg = () => {
    if (bgMode === "light") return "var(--text-inverse)";
    if (bgMode === "grid") return "var(--grad-preview-grid)";
    return "var(--bg-surface)";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "var(--bg-deep)", position: "relative", overflow: "hidden" }}>
      {/* ── Header Toolbar ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-4) var(--space-10)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", fontSize: "var(--fs-body)", color: "var(--text-bright)", flexShrink: 0, gap: "var(--space-8)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: "var(--fw-semibold)", color: "var(--teal)", display: "flex", alignItems: "center", gap: "var(--space-4)", flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path style={{ stroke: "var(--teal)" }} d="M4 2.5L1.5 8L4 13.5M12 2.5L14.5 8L12 13.5M9.5 2L6.5 14" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            Preview:
          </span>

          {/* File selector dropdown */}
          <select
            value={filePath || ""}
            onChange={(e) => {
              const p = e.target.value || null;
              setSampleMode(false);
              setFilePath(p);
              // Link back to the code editor: open the selected component there.
              if (p) {
                try {
                  window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { filePath: p } }));
                } catch { /* ignore */ }
              }
            }}
            style={{
              background: "var(--bg-surface)",
              color: "var(--text-warm)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              fontSize: "var(--fs-small)",
              padding: "var(--space-2) var(--space-6)",
              outline: "none",
              cursor: "pointer",
              maxWidth: 260,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {projectFiles.length === 0 ? (
              <option value="">{filePath ? fileName : "No JSX files found"}</option>
            ) : (
              <>
                {filePath && !projectFiles.includes(filePath) && (
                  <option value={filePath}>{fileName} (current)</option>
                )}
                {projectFiles.map((p) => (
                  <option key={p} value={p}>
                    {p.split(/[\\/]/).pop()} ({p.replace(/.*[\\/]([^\\/]+[\\/][^\\/]+)$/, "$1")})
                  </option>
                ))}
              </>
            )}
          </select>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", flexShrink: 0 }}>
          {/* Sample Component Button */}
          <button
            onClick={() => setSampleMode(true)}
            title="Show sample component with temp data"
            style={{ background: sampleMode ? "var(--bg-active)" : "transparent", border: "none", color: sampleMode ? "var(--teal)" : "var(--icon-hover)", cursor: "pointer", padding: "var(--space-2) var(--space-8)", fontSize: "var(--fs-small)", borderRadius: "var(--radius-sm)" }}
          >
            Sample
          </button>

          {/* Background Mode Toggle */}
          <div style={{ display: "flex", background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", padding: "var(--space-1)" }}>
            <button
              onClick={() => setBgMode("dark")}
              title="Dark Background"
              style={{ background: bgMode === "dark" ? "var(--bg-thumb)" : "transparent", color: bgMode === "dark" ? "var(--text-inverse)" : "var(--icon-muted)", border: "none", borderRadius: "var(--radius-xs)", padding: "var(--space-2) var(--space-6)", fontSize: "var(--fs-tiny)", cursor: "pointer" }}
            >
              Dark
            </button>
            <button
              onClick={() => setBgMode("light")}
              title="Light Background"
              style={{ background: bgMode === "light" ? "var(--bg-thumb)" : "transparent", color: bgMode === "light" ? "var(--text-inverse)" : "var(--icon-muted)", border: "none", borderRadius: "var(--radius-xs)", padding: "var(--space-2) var(--space-6)", fontSize: "var(--fs-tiny)", cursor: "pointer" }}
            >
              Light
            </button>
            <button
              onClick={() => setBgMode("grid")}
              title="Grid Background"
              style={{ background: bgMode === "grid" ? "var(--bg-thumb)" : "transparent", color: bgMode === "grid" ? "var(--text-inverse)" : "var(--icon-muted)", border: "none", borderRadius: "var(--radius-xs)", padding: "var(--space-2) var(--space-6)", fontSize: "var(--fs-tiny)", cursor: "pointer" }}
            >
              Grid
            </button>
          </div>

          {/* Auto CSS indicator */}
          <span
            title={loadedCssFiles.length ? `Auto-loaded CSS (${loadedCssFiles.length}):\n${loadedCssFiles.join("\n")}` : "No global CSS detected — component imports (bundler) still apply"}
            style={{ fontSize: "var(--fs-tiny)", color: loadedCssFiles.length ? "var(--teal)" : "var(--icon-muted)", background: loadedCssFiles.length ? "var(--teal-a15)" : "transparent", border: "1px solid var(--border)", borderRadius: "var(--radius-pill)", padding: "var(--space-2) var(--space-8)", whiteSpace: "nowrap", cursor: "default" }}
          >
            CSS {loadedCssFiles.length ? `· ${loadedCssFiles.length}` : "· auto"}
          </span>

          {/* Refresh Button */}
          <button
            onClick={() => { if (filePath) loadAndTranspile(filePath, undefined, { forceCss: true }); }}
            title="Reload Preview (rescan CSS)"
            style={{ background: "transparent", border: "none", color: "var(--icon-hover)", cursor: "pointer", padding: "var(--space-2) var(--space-4)", fontSize: "var(--fs-body)" }}
          >
            ↻
          </button>
        </div>
      </div>

      {/* ── Main Preview Canvas — iframe sandbox full isolation ────────────── */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          display: "flex",
          alignItems: "stretch",
          justifyContent: "stretch",
          background: getCanvasBg(),
          padding: 0,
          position: "relative",
        }}
      >
        <iframe
          ref={iframeRef}
          title="Component Preview"
          sandbox="allow-scripts allow-same-origin allow-forms"
          srcDoc={IFRAME_HTML}
          onLoad={handleIframeLoad}
          style={{ width: "100%", height: "100%", border: "none", display: "block", background: "transparent" }}
        />
      </div>
    </div>
  );
};

export default ComponentPreview;
