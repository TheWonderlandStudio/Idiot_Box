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
          padding: 16,
          background: "#2a1717",
          border: "1px solid #732222",
          borderRadius: 6,
          color: "#f44747",
          fontSize: 12,
          fontFamily: "Consolas, monospace",
          maxWidth: 600,
          margin: 16,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Runtime Error in Component</div>
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
  { id: 1, name: "Alice Kumar", role: "UI Designer",    status: "Active",  color: "#4ec9b0" },
  { id: 2, name: "Bob Sharma",  role: "Full-stack Dev", status: "Active",  color: "#569cd6" },
  { id: 3, name: "Charlie Rao", role: "Project Lead",   status: "Away",    color: "#dcdcaa" },
  { id: 4, name: "Diana Singh", role: "QA Engineer",    status: "Offline", color: "#c586c0" },
];

const SampleComponent = () => {
  const total = SAMPLE_TEMP_DATA.length;
  const active = SAMPLE_TEMP_DATA.filter((d) => d.status === "Active").length;
  return (
    <div style={{ width: "100%", boxSizing: "border-box", background: "#252526", border: "1px solid #333", borderRadius: 8, padding: 20, color: "#d4d4d4", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Team Overview</div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>Sample component rendered with temp data</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, background: "#1e1e1e", border: "1px solid #333", borderRadius: 6, padding: "10px 12px" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#4ec9b0" }}>{total}</div>
          <div style={{ fontSize: 11, color: "#888" }}>Total members</div>
        </div>
        <div style={{ flex: 1, background: "#1e1e1e", border: "1px solid #333", borderRadius: 6, padding: "10px 12px" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#569cd6" }}>{active}</div>
          <div style={{ fontSize: 11, color: "#888" }}>Active now</div>
        </div>
      </div>
      {SAMPLE_TEMP_DATA.map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid #2d2d2d" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: d.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#111", flexShrink: 0 }}>
            {d.name.split(" ").map((w) => w[0]).join("")}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{d.name}</div>
            <div style={{ fontSize: 11, color: "#888" }}>{d.role}</div>
          </div>
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: d.status === "Active" ? "rgba(78,201,176,.15)" : d.status === "Away" ? "rgba(220,220,170,.15)" : "rgba(197,134,192,.15)", color: d.status === "Active" ? "#4ec9b0" : d.status === "Away" ? "#dcdcaa" : "#c586c0", border: `1px solid ${d.color}33` }}>{d.status}</span>
        </div>
      ))}
    </div>
  );
};

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
    {id:1,name:"Alice Kumar",role:"UI Designer",status:"Active",color:"#4ec9b0"},
    {id:2,name:"Bob Sharma",role:"Full-stack Dev",status:"Active",color:"#569cd6"},
    {id:3,name:"Charlie Rao",role:"Project Lead",status:"Away",color:"#dcdcaa"},
    {id:4,name:"Diana Singh",role:"QA Engineer",status:"Offline",color:"#c586c0"}
  ];
  function SampleComponent(){
    const R=window.React;
    const total=SAMPLE_DATA.length;
    const active=SAMPLE_DATA.filter(d=>d.status==="Active").length;
    return R.createElement('div',{style:{width:'100%',boxSizing:'border-box',background:'#252526',border:'1px solid #333',borderRadius:8,padding:20,color:'#d4d4d4',fontFamily:"'Segoe UI', Arial, sans-serif"}},
      R.createElement('div',{style:{fontSize:16,fontWeight:600,marginBottom:4}},'Team Overview'),
      R.createElement('div',{style:{fontSize:12,color:'#888',marginBottom:16}},'Sample component rendered with temp data'),
      R.createElement('div',{style:{display:'flex',gap:10,marginBottom:16}},
        R.createElement('div',{style:{flex:1,background:'#1e1e1e',border:'1px solid #333',borderRadius:6,padding:'10px 12px'}},
          R.createElement('div',{style:{fontSize:20,fontWeight:700,color:'#4ec9b0'}}, total),
          R.createElement('div',{style:{fontSize:11,color:'#888'}},'Total members')
        ),
        R.createElement('div',{style:{flex:1,background:'#1e1e1e',border:'1px solid #333',borderRadius:6,padding:'10px 12px'}},
          R.createElement('div',{style:{fontSize:20,fontWeight:700,color:'#569cd6'}}, active),
          R.createElement('div',{style:{fontSize:11,color:'#888'}},'Active now')
        )
      ),
      ...SAMPLE_DATA.map(d=> R.createElement('div',{key:d.id, style:{display:'flex',alignItems:'center',gap:10,padding:'8px 6px',borderBottom:'1px solid #2d2d2d'}},
        R.createElement('div',{style:{width:28,height:28,borderRadius:'50%',background:d.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#111',flexShrink:0}}, d.name.split(' ').map(w=>w[0]).join('')),
        R.createElement('div',{style:{flex:1,minWidth:0}},
          R.createElement('div',{style:{fontSize:12,fontWeight:600}}, d.name),
          R.createElement('div',{style:{fontSize:11,color:'#888'}}, d.role)
        ),
        R.createElement('span',{style:{fontSize:10,padding:'2px 8px',borderRadius:10,background:d.status==='Active'?'rgba(78,201,176,.15)':d.status==='Away'?'rgba(220,220,170,.15)':'rgba(197,134,192,.15)',color:d.status==='Active'?'#4ec9b0':d.status==='Away'?'#dcdcaa':'#c586c0',border:'1px solid '+d.color+'33'}}, d.status)
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
            R.createElement('div',{style:{width:'100%',minHeight:'100%',transform:'scale('+zoom+')',transformOrigin:'top left',transition:'transform 0.1s ease'}},
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
          root.render(R.createElement('div',{style:{display:'flex',flexDirection:'column',alignItems:'center',gap:10,color:'#666',fontSize:13}}, R.createElement('div',null,'Select a .jsx or .tsx file to render live preview')));
        }catch(e){ showError(String(e)); }
        return;
      }
      if(!opts.code){
        const root=ensureRoot(); if(!root) return;
        try{
          const R=window.React;
          root.render(R.createElement('div',{style:{color:'#777',fontSize:12}},'Loading preview…'));
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
        const wrapper=R.createElement('div',{style:{width:'100%',minHeight:'100%',transform:'scale('+zoom+')',transformOrigin:'top left',transition:'transform 0.1s ease'}}, el);
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

  // ── Helper to inject CSS into the iframe's document head ───────────────────
  const injectPreviewCss = useCallback((cssKey, cssContent) => {
    if (!cssKey) return;
    const doc = getIframeDoc();
    if (!doc) return;
    const head = doc.head;
    if (!head) return;
    const styleId = `preview-css-${cssKey.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    let el = head.querySelector(`#${styleId}`);
    if (!el) {
      el = doc.createElement("style");
      el.id = styleId;
      el.setAttribute("data-preview-css", cssKey);
      head.appendChild(el);
    }
    el.textContent = cssContent || "";
  }, [getIframeDoc]);

  // Drop all styles injected for a previously previewed component.
  const clearPreviewCss = useCallback(() => {
    const doc = getIframeDoc();
    if (!doc || !doc.head) return;
    doc.head.querySelectorAll("style[data-preview-css]").forEach((el) => el.remove());
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
    const onOpen = () => refreshFileList();
    const onClose = () => { setSampleMode(false); setFilePath(null); setProjectFiles([]); setComponentToRender(null); setPreviewCode(null); };
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

  // ── Helper to resolve relative file paths ─────────────────────────────────
  const resolvePath = (baseFile, relativePath) => {
    if (!baseFile || !relativePath) return null;
    const parts = baseFile.replace(/\\/g, "/").split("/");
    parts.pop(); // remove base filename, keeping directory
    const relParts = relativePath.replace(/\\/g, "/").split("/");
    for (const p of relParts) {
      if (p === "." || p === "") continue;
      if (p === "..") { parts.pop(); }
      else { parts.push(p); }
    }
    return parts.join("/");
  };

  // ── Scan and inject associated CSS files ──────────────────────────────────
  const loadAssociatedCss = useCallback(async (targetFilePath, sourceCode) => {
    if (!targetFilePath) return;

    // 1. Direct CSS import matches in source code: import "./styles.css" / require("./app.css")
    const cssImportRegex = /(?:import|require)\s*\(?['"]([^'"]+\.(?:css|scss|less|pcss))['"]\)?/gi;
    let match;
    while ((match = cssImportRegex.exec(sourceCode)) !== null) {
      const relCssPath = match[1];
      const fullCssPath = resolvePath(targetFilePath, relCssPath);
      if (fullCssPath) {
        try {
          const cssContent = await window.electronAPI.readTextFile(fullCssPath);
          if (cssContent !== null) {
            injectPreviewCss(fullCssPath, cssContent);
          }
        } catch {}
      }
    }

    // 2. Sibling CSS file with same name (e.g. App.jsx -> App.css)
    const sameNameCss = targetFilePath.replace(/\.(jsx|tsx)$/i, ".css");
    if (sameNameCss !== targetFilePath) {
      try {
        const cssContent = await window.electronAPI.readTextFile(sameNameCss);
        if (cssContent !== null) {
          injectPreviewCss(sameNameCss, cssContent);
        }
      } catch {}
    }

    // 3. Common project CSS files in same directory or project root
    const dirParts = targetFilePath.replace(/\\/g, "/").split("/");
    dirParts.pop();
    const dirPath = dirParts.join("/");
    const commonNames = ["index.css", "style.css", "styles.css", "App.css", "global.css", "main.css"];
    for (const name of commonNames) {
      const commonPath = `${dirPath}/${name}`;
      try {
        const cssContent = await window.electronAPI.readTextFile(commonPath);
        if (cssContent !== null) {
          injectPreviewCss(commonPath, cssContent);
        }
      } catch {}
    }
  }, [injectPreviewCss]);

  // ── Transpile & Load Component ────────────────────────────────────────────
  // Stronger origin isolation: bundle in main, evaluate & mount INSIDE iframe's realm
  const loadAndTranspile = useCallback(async (path, sourceOverride) => {
    if (!path) return;
    setTranspileError(null);

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

    clearPreviewCss();
    await loadAssociatedCss(path, source);

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

    // Store CJS bundle for iframe to evaluate independently (isolated realm)
    setPreviewCode(res.code);
    setComponentToRender(null);
    setLastUpdateKey((k) => k + 1);
  }, [loadAssociatedCss, clearPreviewCss]);

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
  useEffect(() => {
    const root = window.__currentProjectPath;
    if (!root) return;
    const unsub = window.electronAPI.onFsChange(() => {
      if (filePath) {
        liveSourcesRef.current.delete(filePath);
        loadAndTranspile(filePath);
      }
    });
    return () => unsub();
  }, [filePath, loadAndTranspile]);

  // ── Iframe onLoad: mark ready, inject React, and trigger mount ──────────
  const handleIframeLoad = useCallback(() => {
    if (iframeReadyRef.current && getIframeWin()?.__previewMount) {
      setupIframeGuard();
      return;
    }
    iframeReadyRef.current = true;
    setupIframeGuard();
    // Defer mount to ensure iframe's internal script has set __previewMount
    setTimeout(() => setLastUpdateKey(k => k + 1), 0);
  }, [setupIframeGuard, getIframeWin, getIframeDoc]);

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
    // Ensure React is available inside iframe
    if (!win.__previewMount) {
      // iframe script not yet ready, retry
      setTimeout(() => renderPreview(), 50);
      return;
    }
    // Apply bgMode to iframe body (parent controls outer container bg too)
    try {
      doc.body.style.background = bgMode === "light" ? "#ffffff" : bgMode === "grid" ? "repeating-conic-gradient(#252526 0% 25%, #1e1e1e 0% 50%) 50% / 16px 16px" : "#1e1e1e";
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
  }, [sampleMode, transpileError, filePath, previewCode, zoom, bgMode, lastUpdateKey, getIframeWin, getIframeDoc, getMount, setupIframeGuard]);

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
    if (bgMode === "light") return "#ffffff";
    if (bgMode === "grid") return "repeating-conic-gradient(#252526 0% 25%, #1e1e1e 0% 50%) 50% / 16px 16px";
    return "#1e1e1e";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "#181818", position: "relative", overflow: "hidden" }}>
      {/* ── Header Toolbar ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 10px", background: "#252526", borderBottom: "1px solid #2d2d2d", fontSize: 12, color: "#ccc", flexShrink: 0, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, color: "#4ec9b0", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 2.5L1.5 8L4 13.5M12 2.5L14.5 8L12 13.5M9.5 2L6.5 14" stroke="#4ec9b0" strokeWidth="1.2" strokeLinecap="round" />
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
              background: "#1e1e1e",
              color: "#d0d0d0",
              border: "1px solid #3c3c3c",
              borderRadius: 3,
              fontSize: 11,
              padding: "2px 6px",
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
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {/* Sample Component Button */}
          <button
            onClick={() => setSampleMode(true)}
            title="Show sample component with temp data"
            style={{ background: sampleMode ? "#2d2d2d" : "transparent", border: "none", color: sampleMode ? "#4ec9b0" : "#aaa", cursor: "pointer", padding: "2px 8px", fontSize: 11, borderRadius: 3 }}
          >
            Sample
          </button>

          {/* Background Mode Toggle */}
          <div style={{ display: "flex", background: "#1e1e1e", borderRadius: 3, border: "1px solid #333", padding: 1 }}>
            <button
              onClick={() => setBgMode("dark")}
              title="Dark Background"
              style={{ background: bgMode === "dark" ? "#333" : "transparent", color: bgMode === "dark" ? "#fff" : "#777", border: "none", borderRadius: 2, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}
            >
              Dark
            </button>
            <button
              onClick={() => setBgMode("light")}
              title="Light Background"
              style={{ background: bgMode === "light" ? "#333" : "transparent", color: bgMode === "light" ? "#fff" : "#777", border: "none", borderRadius: 2, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}
            >
              Light
            </button>
            <button
              onClick={() => setBgMode("grid")}
              title="Grid Background"
              style={{ background: bgMode === "grid" ? "#333" : "transparent", color: bgMode === "grid" ? "#fff" : "#777", border: "none", borderRadius: 2, padding: "2px 6px", fontSize: 10, cursor: "pointer" }}
            >
              Grid
            </button>
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => { if (filePath) loadAndTranspile(filePath); }}
            title="Reload Preview"
            style={{ background: "transparent", border: "none", color: "#aaa", cursor: "pointer", padding: "2px 4px", fontSize: 12 }}
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
