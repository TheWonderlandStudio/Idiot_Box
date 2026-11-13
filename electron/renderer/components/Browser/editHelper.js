// editHelper.js — Live Edit guest script (runs INSIDE the webview page).
//
// Browser/index.jsx injects this as a string (executeJavaScript).
// So this file is a plain script: no import/export values, only the
// EDIT_HELPER_SOURCE string is exported. Backticks inside stay escaped (\`)
// because the outer literal is backtick-delimited — when editing by hand,
// always escape a new backtick (\`).
// BACKSLASH RULE: never write single \s \d \n \. in regex/string — the backslash
// is dropped as soon as the outer literal is parsed (the guest gets a broken regex).
// Always write DOUBLE backslashes (\\s \\d \\n \\. \\\\ for a backslash).
//
// NOTE: this CSS/DOM runs inside the *outer website* — the app's var(--tokens)
// do NOT resolve there, so keep everything as literals.
//
// Test: import the source from node, evaluate it in a headless page
// (window globals are not shared in the eval context — assert via the DOM bridge).
export const EDIT_HELPER_SOURCE = `(() => {
      try {
        if (window.__ibxEditHelpersInstalled) return true;
        window.__ibxEditHelpersInstalled = true;
        window.__ibxEditEnabled = !!window.__ibxEditEnabled;
        let hoverEl = null;
        let activeEl = null;
        let styleEl = null;
        let prevTitle = document.title;
        let committing = false;
        // v2: attribute popup, styles toolbar, hover hint, locate pings
        let attrPopup = null;
        let styleBar = null;
        let hintBadge = null;
        let locateTimer = null;
        let locateSeq = 0;
        let lastLocateEl = null;
        // v4: last mouse point for the Ctrl+E fallback
        let lastPt = null;
        // v3: delete/duplicate/wrap-link, inspector, style-bar extras
        let inspectPopup = null;
        let linkPopup = null;
        let lastCommitEl = null;
        // v4: raw HTML editor popup
        let htmlPopup = null;
        // v5: sidebar-style pending (debounced) commit target
        let styleCommitEl = null;
        // v7: DOM tree panel (sidebar) — tree selection + highlight + id map
        let treeSelEl = null;
        let treeHiEl = null;
        // v8: Cursor-style visual selection (click selects, double-click edits)
        let selEl = null;
        let selBar = null;
        let selBarEl = null;
        let selMenu = null;
        // During a mutation, a real mouse re-hover must not re-apply the hover class
        // (otherwise an artifact lands in the anchor snapshot and file matching breaks).
        let busy = 0;
        // classList.remove leaves behind class="" (when the element was previously
        // classless) — that attribute is NOT in the file and corrupts the ancestor commit's
        // oldHtml. Remove the attribute entirely when empty.
        function stripEmptyClass(el){
          try{
            if(el && el.removeAttribute && String(el.className||'').trim()==='') el.removeAttribute('class');
          }catch{}
        }
        // Edit-mode transient classes/attrs must NOT end up in the file needle.
        // __ibxTreeHover / mouse hover leaves __ibx-edit-hover on the target
        // — it was included in outerHTML at snapshot/commit time, so the host got
        // "Element not found in project" and the whole change was reverted.
        function stripEditArtifacts(root){
          if(!root) return;
          try{
            root.removeAttribute('contenteditable');
            root.removeAttribute('spellcheck');
            root.classList.remove('__ibx-edit-hover','__ibx-edit-active','__ibx-edit-selected');
            stripEmptyClass(root);
          }catch{}
          try{
            const nodes=root.querySelectorAll('.__ibx-edit-hover,.__ibx-edit-active,.__ibx-edit-selected,[contenteditable],[spellcheck="false"]');
            for(let i=0;i<nodes.length;i++){
              try{
                const n=nodes[i];
                n.removeAttribute('contenteditable');
                n.removeAttribute('spellcheck');
                n.classList.remove('__ibx-edit-hover','__ibx-edit-active','__ibx-edit-selected');
                stripEmptyClass(n);
              }catch{}
            }
          }catch{}
        }
        // Don't hide the popup behind the edit sidebar — the host subtracts the sidebar
        // width from the viewport (window.__ibxSidebarW, px).
        function vw(){
          let w=window.innerWidth||800;
          try{ const s=Number(window.__ibxSidebarW)||0; if(s>0) w=Math.max(240, w-s); }catch{}
          return w;
        }
        function ensureStyle(){
          if (styleEl) return;
          styleEl = document.createElement('style');
          styleEl.id = '__ibx-edit-style';
          // NOTE: this CSS is injected into the *outer website* — the app's
          // var(--tokens) do NOT resolve there, so literals are used.
          // Values match the CENTRAL sheet: --teal (#4ec9b0),
          // --teal-a08, --teal-a14. If tokens change, update them here too.
          styleEl.textContent = \`
            .__ibx-edit-hover { outline: 1px solid #3b82f6 !important; outline-offset: 0px !important; background: rgba(59,130,246,0.05) !important; cursor: default !important; }
            .__ibx-edit-selected { outline: 1.5px solid #3b82f6 !important; outline-offset: 0px !important; cursor: default !important; }
            .__ibx-edit-active { outline: 2px solid #3b82f6 !important; outline-offset: 1px !important; background: rgba(59,130,246,0.07) !important; cursor: text !important; }
            .__ibx-hint { position: fixed !important; z-index: 2147483647 !important; background: #3b82f6 !important; color: #ffffff !important; border: none !important; font: 10px/17px ui-monospace, SFMono-Regular, Menlo, monospace !important; padding: 0 6px !important; border-radius: 3px !important; box-shadow: 0 1px 4px rgba(0,0,0,0.3) !important; pointer-events: none !important; white-space: nowrap !important; max-width: 340px !important; overflow: hidden !important; text-overflow: ellipsis !important; }
            .__ibx-chip { position: fixed !important; z-index: 2147483647 !important; background: #3b82f6 !important; color: #ffffff !important; border: none !important; border-radius: 3px !important; padding: 0 1px 0 6px !important; display: flex !important; align-items: center !important; gap: 1px !important; box-shadow: 0 1px 4px rgba(0,0,0,0.35) !important; font: 10px/18px ui-monospace, SFMono-Regular, Menlo, monospace !important; white-space: nowrap !important; max-width: 320px !important; }
            .__ibx-chip-label { max-width: 280px !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
            .__ibx-chip-more { border: none !important; background: transparent !important; color: #dbeafe !important; font: 12px/1 system-ui, sans-serif !important; padding: 2px 4px !important; border-radius: 2px !important; cursor: pointer !important; }
            .__ibx-chip-more:hover { background: rgba(255,255,255,0.22) !important; color: #ffffff !important; }
            .__ibx-menu { position: fixed !important; z-index: 2147483647 !important; background: #1c1c1c !important; border: 1px solid #3a3a3a !important; border-radius: 6px !important; padding: 3px !important; display: flex !important; flex-direction: column !important; gap: 1px !important; box-shadow: 0 8px 24px rgba(0,0,0,0.45) !important; font: 11px/1.4 system-ui, sans-serif !important; min-width: 100px !important; }
            .__ibx-menu button { text-align: left !important; background: transparent !important; border: none !important; color: #dddddd !important; padding: 4px 18px 4px 9px !important; border-radius: 4px !important; font: 11px/1.4 system-ui, sans-serif !important; cursor: pointer !important; white-space: nowrap !important; }
            .__ibx-menu button:hover { background: #2a2a2a !important; color: #ffffff !important; }
            .__ibx-popup { position: fixed !important; z-index: 2147483647 !important; background: #ffffff !important; color: #111111 !important; font: 13px/1.5 system-ui, sans-serif !important; border: 1px solid #999999 !important; border-radius: 8px !important; box-shadow: 0 8px 28px rgba(0,0,0,0.35) !important; padding: 10px 12px !important; width: 290px !important; }
            .__ibx-popup label { display: block !important; font-weight: bold !important; font-size: 11px !important; color: #555555 !important; margin: 6px 0 1px !important; }
            .__ibx-popup input { width: 100% !important; box-sizing: border-box !important; padding: 4px 6px !important; border: 1px solid #bbbbbb !important; border-radius: 4px !important; font: inherit !important; color: #111111 !important; background: #ffffff !important; }
            .__ibx-popup button { font: inherit !important; padding: 3px 12px !important; margin: 8px 6px 0 0 !important; border-radius: 4px !important; border: 1px solid #999999 !important; background: #f0f0f0 !important; color: #111111 !important; cursor: pointer !important; }
            .__ibx-popup button.__ibx-primary { background: #4ec9b0 !important; border-color: #4ec9b0 !important; color: #06281f !important; font-weight: bold !important; }
            .__ibx-stylebar { position: fixed !important; z-index: 2147483647 !important; background: #111111 !important; border-radius: 6px !important; padding: 3px 5px !important; display: flex !important; gap: 3px !important; align-items: center !important; box-shadow: 0 4px 14px rgba(0,0,0,0.4) !important; flex-wrap: nowrap !important; white-space: nowrap !important; max-width: none !important; }
            body { cursor: default !important; }
            .__ibx-stylebar button { background: transparent !important; color: #eeeeee !important; border: 1px solid transparent !important; border-radius: 4px !important; font: 12px/1.5 system-ui, sans-serif !important; padding: 2px 7px !important; cursor: pointer !important; min-width: 24px !important; }
            .__ibx-stylebar button:hover { background: #333333 !important; }
            .__ibx-stylebar input[type=color] { width: 26px !important; height: 20px !important; border: none !important; background: none !important; padding: 0 !important; cursor: pointer !important; }
            .__ibx-popup textarea { display:block !important; width:100% !important; box-sizing:border-box !important; min-height:170px !important; max-height:340px !important; margin-top:2px !important; padding:6px !important; border:1px solid #bbbbbb !important; border-radius:4px !important; font:12px/1.45 Consolas,'Courier New',monospace !important; color:#111111 !important; background:#ffffff !important; resize:vertical !important; }
            .__ibx-popup .__ibx-note { font-size:11px !important; color:#666666 !important; margin-top:6px !important; }
            .__ibx-moveflash { outline: 2px solid #4ec9b0 !important; outline-offset: 2px !important; }
          \`;
          (document.head||document.documentElement).appendChild(styleEl);
        }
        function removeStyle(){ try{ if(styleEl) styleEl.remove(); }catch{} styleEl=null; try{ if(hoverEl) hoverEl.classList.remove('__ibx-edit-hover'); }catch{} hoverEl=null; }
        function isSkippedTag(el){
          if(!el || !el.tagName) return true;
          const t=el.tagName.toLowerCase();
          return ['script','style','noscript','iframe','canvas','svg','path','head','meta','link','input','textarea','select','button','video','audio','img','br','hr'].indexOf(t)!==-1 || el.isContentEditable;
        }
        function hasVisibleText(el){
          try{
            const txt=(el.innerText||'').trim();
            if(!txt) return false;
            if(txt.length>600) return false;
            const st=window.getComputedStyle(el);
            if(st && (st.display==='none' || st.visibility==='hidden' || parseFloat(st.opacity)===0)) return false;
            return true;
          }catch{ return false; }
        }
        function isLeafEditable(el){
          if(!el || el.nodeType!==1 || !el.tagName) return false;
          const t=el.tagName.toLowerCase();
          const allowed=['p','h1','h2','h3','h4','h5','h6','span','a','li','td','th','label','strong','em','b','i','u','small','code','pre','blockquote','div','dt','dd','caption','figcaption'];
          if(allowed.indexOf(t)===-1) return false;
          if(isSkippedTag(el)) return false;
          if(!hasVisibleText(el)) return false;
          try{
            const kids=el.children||[];
            if(kids.length===0) return true;
            if(kids.length===1 && kids[0].tagName && String(kids[0].tagName).toLowerCase()==='br') return true;
            return false;
          }catch{ return false; }
        }
        function findEditableTarget(start){
          let el=start;
          if(el && el.nodeType===3) el=el.parentElement;
          let depth=0;
          while(el && el!==document.body && el!==document.documentElement && depth<4){
            if(el.nodeType===1 && isLeafEditable(el)) return el;
            el=el.parentElement; depth++;
          }
          return null;
        }
        function clearHover(){
          try{
            if(hoverEl){ hoverEl.classList.remove('__ibx-edit-hover'); stripEmptyClass(hoverEl); }
          }catch{}
          hoverEl=null; hideHint();
        }
        function isUiNode(n){ try{ return !!(n && n.closest && n.closest('[data-ibx-ui]')); }catch{ return false; } }
        // Cursor-style selector label: tag#id.class (one class max, ibx artifacts removed)
        function domLabel(el){
          try{
            if(!el || !el.tagName) return '';
            let s=String(el.tagName).toLowerCase();
            try{ if(el.id) s+='#'+String(el.id).slice(0,24); }catch{}
            try{
              const cl=(typeof el.className==='string') ? el.className : '';
              const words=cl.split(/\\s+/).filter(function(w){ return !!w && w.indexOf('__ibx-')!==0; }).slice(0,1);
              if(words.length) s+='.'+words[0].slice(0,24);
            }catch{}
            return s.slice(0,48);
          }catch{ return ''; }
        }
        // Full selector chain for the Cursor-style chip (all classes, artifacts removed).
        function selChain(el){
          try{
            if(!el || !el.tagName) return '';
            let s=String(el.tagName).toLowerCase();
            try{ if(el.id) s+='#'+String(el.id).slice(0,24); }catch{}
            try{
              const cl=(typeof el.className==='string') ? el.className : '';
              const words=cl.split(/\\s+/).filter(function(w){ return !!w && w.indexOf('__ibx-')!==0; });
              if(words.length) s+='.'+words.join('.').slice(0,80);
            }catch{}
            return s.slice(0,100);
          }catch{ return ''; }
        }
        // Hover target: the element under the cursor (walk up to 2 levels for text nodes)
        function hoverCandidate(start){
          let el=start;
          if(el && el.nodeType===3) el=el.parentElement;
          let d=0;
          while(el && el!==document.body && el!==document.documentElement && d<2){
            if(el.nodeType===1 && el.tagName){
              const tg=String(el.tagName).toUpperCase();
              if(['SCRIPT','STYLE','NOSCRIPT','HEAD','META','LINK','TEMPLATE'].indexOf(tg)===-1 && !isUiNode(el)) return el;
            }
            el=el.parentElement; d++;
          }
          return null;
        }
        function hideHint(){ try{ if(hintBadge) hintBadge.remove(); }catch{} hintBadge=null; }
        // Instant selector chip on hover (the locate reply later appends the file name)
        function showHoverLabel(el){
          try{
            hideHint();
            if(!el || !document.contains(el)) return;
            const r=el.getBoundingClientRect();
            const b=document.createElement('div');
            b.setAttribute('data-ibx-ui','1');
            b.className='__ibx-hint';
            b.textContent=selChain(el)||domLabel(el);
            b.style.left=Math.max(4, Math.min((vw())-120, r.left))+'px';
            b.style.top=Math.max(4, r.top-20)+'px';
            document.body.appendChild(b);
            hintBadge=b;
          }catch{}
        }
        // ── v8: selection overlay + floating element toolbar ─────────────
        function hideSelMenu(){ try{ if(selMenu) selMenu.remove(); }catch{} selMenu=null; }
        function hideSelBar(){ hideSelMenu(); try{ if(selBar) selBar.remove(); }catch{} selBar=null; selBarEl=null; }
        function clearSelection(){
          try{
            if(selEl){ selEl.classList.remove('__ibx-edit-selected'); stripEmptyClass(selEl); }
          }catch{}
          selEl=null;
          hideSelBar();
        }
        function positionSelMenu(){
          try{
            if(!selMenu || !selBar) return;
            const r=selBar.getBoundingClientRect();
            const w=selMenu.offsetWidth||130;
            const hgt=selMenu.offsetHeight||210;
            let left=Math.max(4, Math.min((vw())-w-6, r.left));
            let top=r.bottom+4;
            if(top+hgt>(window.innerHeight||600)) top=Math.max(4, r.top-hgt-4);
            selMenu.style.left=Math.round(left)+'px';
            selMenu.style.top=Math.round(top)+'px';
          }catch{}
        }
        function positionSelBar(){
          if(!selBar || !selBarEl) return;
          try{
            if(!document.contains(selBarEl)){ hideSelBar(); return; }
            const r=selBarEl.getBoundingClientRect();
            const w=selBar.offsetWidth||160;
            const left=Math.max(2, Math.min((vw())-w-6, r.left));
            let top=r.top-19;
            if(top<2) top=Math.max(2, r.top+1);
            selBar.style.left=Math.round(left)+'px';
            selBar.style.top=Math.round(top)+'px';
            if(selMenu) positionSelMenu();
          }catch{}
        }
        function onViewportChange(){ try{ positionSelBar(); }catch{} }
        function showSelMenu(el){
          hideSelMenu();
          if(!el || !document.contains(el)) return;
          const menu=document.createElement('div');
          menu.setAttribute('data-ibx-ui','1');
          menu.className='__ibx-menu';
          const add=function(label, title, fn){
            const b=document.createElement('button');
            b.type='button';
            b.textContent=label;
            b.title=title;
            b.addEventListener('mousedown', function(e){ try{ e.preventDefault(); e.stopPropagation(); }catch{} }, true);
            b.addEventListener('click', function(e){
              try{ e.preventDefault(); e.stopPropagation(); }catch{}
              hideSelMenu();
              try{ fn(); }catch{}
            });
            menu.appendChild(b);
          };
          const editTarget=(function(){ try{ return findEditableTarget(el)||(isLeafEditable(el)?el:null); }catch{ return null; } })();
          if(editTarget) add('Edit text', 'Double-click / Enter', function(){ selectElement(editTarget); activateEl(editTarget); });
          add('Duplicate', 'Ctrl+D', function(){ hoverEl=el; duplicateHovered(); clearSelection(); });
          add('Delete', 'Del', function(){ hoverEl=el; deleteHovered(); clearSelection(); });
          add('Move up', 'Alt+↑', function(){ hoverEl=el; moveHovered(-1); positionSelBar(); });
          add('Move down', 'Alt+↓', function(){ hoverEl=el; moveHovered(1); positionSelBar(); });
          add('Wrap in link', 'Ctrl+K', function(){ openLinkWrap(el); });
          add('Edit HTML', 'Ctrl+E', function(){ openHtmlEditor(el); });
          add('Attributes', 'Alt+click', function(){
            let x=100, y=100;
            try{ const r=el.getBoundingClientRect(); x=r.left; y=r.bottom+6; }catch{}
            openAttrPopup(el, x, y);
          });
          document.body.appendChild(menu);
          selMenu=menu;
          positionSelMenu();
        }
        function showSelBar(el){
          hideSelBar();
          if(!el || !document.contains(el) || !window.__ibxEditEnabled) return;
          const chip=document.createElement('div');
          chip.setAttribute('data-ibx-ui','1');
          chip.className='__ibx-chip';
          const label=document.createElement('span');
          label.className='__ibx-chip-label';
          label.textContent=selChain(el)||'element';
          chip.appendChild(label);
          const more=document.createElement('button');
          more.type='button';
          more.className='__ibx-chip-more';
          more.textContent='⋯';
          more.title='Element actions';
          more.addEventListener('mousedown', function(e){ try{ e.preventDefault(); e.stopPropagation(); }catch{} }, true);
          more.addEventListener('click', function(e){
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
            if(selMenu){ hideSelMenu(); return; }
            showSelMenu(el);
          });
          chip.appendChild(more);
          chip.addEventListener('mousedown', function(e){ try{ e.stopPropagation(); }catch{} }, true);
          document.body.appendChild(chip);
          selBar=chip;
          selBarEl=el;
          positionSelBar();
        }
        function selectElement(el){
          try{
            if(!el || !document.contains(el)) return false;
            if(activeEl && activeEl!==el){
              try{ commitEdit(); }catch{}
              try{ if(activeEl) cleanupActive(false); }catch{}
            }
            clearHover();
            if(selEl && selEl!==el){ try{ selEl.classList.remove('__ibx-edit-selected'); stripEmptyClass(selEl); }catch{} }
            selEl=el;
            treeSelEl=el;
            try{ el.classList.add('__ibx-edit-selected'); }catch{}
            showSelBar(el);
            return true;
          }catch{ return false; }
        }
        function onMouseOver(e){
          if(!window.__ibxEditEnabled || activeEl || busy) return;
          if(isUiNode(e.target)) return;
          try{ lastPt={ x:e.clientX, y:e.clientY }; }catch{}
          // No hover outline in drag mode — the ghost/drop-line is the only feedback.
          if(dragMode) return;
          let t=null; try{ t=hoverCandidate(e.target); }catch{}
          if(t===hoverEl) return;
          clearHover();
          // Selection persists while hovering other elements (Cursor-like).
          if(t && t!==selEl){
            hoverEl=t;
            try{ hoverEl.classList.add('__ibx-edit-hover'); }catch{}
            showHoverLabel(t);
            queueLocate(t);
          }
        }
        function onMouseOut(e){
          if(!window.__ibxEditEnabled || activeEl || dragMode) return;
          try{ const rel=e.relatedTarget; if(hoverEl && rel && hoverEl.contains(rel)) return; }catch{}
          clearHover();
        }
        function snapshot(el){
          // ALWAYS refresh: the file matches the DOM after every save
          // (the host reverts on failure), so the "earlier orig"
          // went stale — the next commit failed on that old needle.
          try{
            // Serialize from a clone: removing classes/attrs on the live DOM would break
            // highlighting — a clone is silent, keeping artifacts safe on both sides.
            let h='';
            try{
              const c=el.cloneNode(true);
              stripEditArtifacts(c);
              h=String(c.outerHTML||'');
            }catch{ h=String(el.outerHTML||''); }
            // spellcheck=false is only applied at edit time; if it sticks to the node from
            // an older cycle it must NOT enter the orig/file-needle — otherwise the html save
            // fails with "Element not found in project" and reverts.
            try{
              const frag=' spellcheck="false"';
              let i=h.indexOf(frag);
              while(i!==-1){ h=h.slice(0,i)+h.slice(i+frag.length); i=h.indexOf(frag); }
            }catch{}
            el.__ibxOrigHTML=h;
            el.__ibxOldText=readElText(el);
            el.__ibxDirtyHTML=false;
          }catch{}
        }
        // pre/code: innerText collapses whitespace — use textContent.
        // contenteditable turns consecutive spaces into nbsp chars — convert them
        // back to regular spaces (the source file should not contain nbsp).
        // NOTE: fromCharCode is used to avoid regex/backslash escapes
        // (the outer template literal eats backslashes).
        const NBSP=String.fromCharCode(160);
        function readElText(el){
          try{
            const raw=String(el.textContent||el.innerText||'');
            return raw.split(NBSP).join(' ').trim();
          }catch{ return ''; }
        }
        // document.title STRIPS + COLLAPSES whitespace (spec: strip-and-collapse),
        // so the payload goes as base64 — otherwise "a  b"/tabs/newlines get mangled.
        // The host understands __IBX_EDIT__B64__ / __IBX_LOCATE64__.
        function b64encode(s){
          try{
            const bytes=new TextEncoder().encode(String(s==null?'':s));
            let bin='';
            for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
            return btoa(bin);
          }catch{ return ''; }
        }
        function capturePrevTitle(){
          try{
            const t=String(document.title||"");
            if(t && t.indexOf("__IBX_")!==0) prevTitle=t;
          }catch{}
        }
        function sendPayload(payload){
          try{
            const t="__IBX_EDIT__B64__"+b64encode(JSON.stringify(payload));
            document.title=t;
            setTimeout(function(){ try{ if(String(document.title)===t && String(prevTitle).indexOf("__IBX_")!==0) document.title=prevTitle; }catch{} }, 900);
          }catch{}
        }
        // Whole-element HTML commit (attributes / inline styles / styled text).
        function commitHtml(el){
          let oldHtml='';
          try{ oldHtml=String(el.__ibxOrigHTML||''); }catch{}
          try{ el.removeAttribute('contenteditable'); }catch{}
          try{ el.removeAttribute('spellcheck'); }catch{}
          stripEditArtifacts(el);
          try{ el.style.outline=''; }catch{}
          hideStyleBar();
          let cur='';
          try{ cur=String(el.outerHTML||''); }catch{}
          // Persist the selection: activeEl is null after commit — by then the
          // mouse is over the sidebar (hoverEl/lastPt could point at the wrong
          // element). treeSelEl = stable target for the next button clicks.
          try{ if(document.contains(el)) treeSelEl=el; }catch{}
          activeEl=null; committing=false;
          if(!oldHtml.trim()||!cur.trim()||oldHtml===cur){
            try{ restoreOriginal(el); }catch{}
            clearHover();
            return;
          }
          if(cur.length>15000){
            try{ restoreOriginal(el); }catch{}
            clearHover();
            return;
          }
          clearHover();
          try{ capturePrevTitle(); }catch{}
          lastCommitEl=el;
          sendPayload({ mode:'html', oldHtml: oldHtml, newHtml: cur, tagName: String(el.tagName||''), url: location.href });
          try{ selectElement(el); }catch{}
        }
        function detachActiveListeners(el){
          try{ el.removeEventListener('keydown', onEditKey); }catch{}
          try{ el.removeEventListener('blur', onEditBlur); }catch{}
        }
        function restoreOriginal(el){
          try{
            if(selEl && (selEl===el || (el.contains && el.contains(selEl)))) clearSelection();
          }catch{}
          try{
            const html=el.__ibxOrigHTML;
            if(html!=null){ el.outerHTML=html; return true; }
          }catch{}
          return false;
        }
        function cleanupActive(cancel){
          if(!activeEl) return;
          const el=activeEl;
          activeEl=null; committing=false;
          detachActiveListeners(el);
          hideStyleBar();
          try{
            if(cancel){
              restoreOriginal(el);
            } else {
              el.removeAttribute('contenteditable');
              el.removeAttribute('spellcheck');
              el.classList.remove('__ibx-edit-active');
              stripEmptyClass(el);
              el.style.outline='';
              try{ if(document.contains(el)) selectElement(el); }catch{}
            }
          }catch{}
        }
        function commitEdit(){
          if(!activeEl || committing) return;
          committing=true;
          const el=activeEl;
          // If styles/attrs changed, send the whole element block (html mode).
          if(el.__ibxDirtyHTML){
            commitHtml(el);
            return;
          }
          const oldText=String(el.__ibxOldText||'');
          const newText=readElText(el);
          // Use ORIGINAL outerHTML for file matching (not the edited DOM)
          let outerSnippet='';
          try{ outerSnippet=String(el.__ibxOrigHTML||el.outerHTML||'').slice(0,300); }catch{ outerSnippet=''; }
          const tagName=String(el.tagName||'');
          if(!newText || newText===oldText.trim()){
            // No change: restore original markup to undo any contenteditable damage
            const r=el; activeEl=null; committing=false;
            detachActiveListeners(r);
            hideStyleBar();
            restoreOriginal(r);
            clearHover();
            return;
          }
          const payload={ mode:'text', oldText: String(oldText).trim(), newText: String(newText).trim(), outerSnippet: outerSnippet, tagName: tagName, url: location.href };
          // Leave edited DOM in place; host reverts on failure via __ibxRevertActive.
          // Detach without restoring so text stays visible while saving.
          try{
            detachActiveListeners(el);
            el.removeAttribute('contenteditable');
            el.removeAttribute('spellcheck');
            el.classList.remove('__ibx-edit-active');
            stripEmptyClass(el);
            el.style.outline='';
          }catch{}
          hideStyleBar();
          try{ if(document.contains(el)) treeSelEl=el; }catch{}
          activeEl=null; committing=false;
          clearHover();
          try{ capturePrevTitle(); }catch{}
          lastCommitEl=el;
          sendPayload(payload);
          try{ selectElement(el); }catch{}
        }
        window.__ibxCommitPendingEdit = function(){
          try{
            // Fire the pending sidebar-style commit now (Done = save everything).
            const pel=styleCommitEl;
            if(pel && pel.__ibxStyleTimer && !activeEl){
              clearTimeout(pel.__ibxStyleTimer); pel.__ibxStyleTimer=null; styleCommitEl=null;
              if(document.contains(pel)){ hideStyleBar(); commitHtml(pel); return true; }
            }
            if(activeEl && !committing) commitEdit(); return true;
          }catch(e){ return false; }
        };
        window.__ibxRevertActive = function(){
          try{
            // Also revert the last sent commit besides activeEl —
            // html commits are sent with activeEl nulled, otherwise the host's
            // revert missed (the DOM stayed edited after a failed save).
            let el=activeEl || lastCommitEl;
            lastCommitEl=null;
            if(!el) return true;
            activeEl=null; committing=false;
            detachActiveListeners(el);
            try{ restoreOriginal(el); }catch{}
            clearHover();
            return true;
          }catch(e){ return false; }
        };
        window.__ibxCancelEdit = function(){
          try{
            clearPendingStyle(true);
            if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); restoreOriginal(el); }
            clearHover();
            return true;
          }catch(e){ return false; }
        };
        window.__ibxIsEditing = function(){ try{ return !!activeEl; }catch{ return false; } };
        // Tab while editing: commit + jump to next/prev editable (Shift+Tab).
        // Blur also commits, but on Tab the browser moves focus wherever it wants
        // — so commit explicitly and activate the next one.
        function commitAndJump(dir){
          // NOTE: activeEl itself is contenteditable so it stays OUT of collectEditables
          // (isSkippedTag) — derive the position in document order.
          let list=[], idx=-1;
          try{
            list=collectEditables();
            idx=list.indexOf(activeEl);
            if(idx===-1 && activeEl){
              try{
                if(document.contains(activeEl)){
                  let at=list.length;
                  for(let i=0;i<list.length;i++){
                    try{ if(activeEl.compareDocumentPosition(list[i])&4){ at=i; break; } }catch{}
                  }
                  list.splice(at,0,activeEl);
                  idx=at;
                }
              }catch{}
            }
          }catch{}
          let nx=null;
          if(idx!==-1 && list.length>1) nx=list[(idx+dir+list.length)%list.length];
          try{ if(activeEl && !committing) commitEdit(); }catch{}
          try{
            if(!nx) return;
            if(!document.contains(nx)){
              const fresh=collectEditables();
              if(!fresh.length) return;
              nx=fresh[Math.min(Math.max(0,idx+dir),fresh.length-1)]||fresh[0];
              if(!nx) return;
            }
            clearHover();
            activateEl(nx);
            try{ nx.scrollIntoView({block:'nearest'}); }catch{}
          }catch{}
        }
        function onEditKey(e){
          if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation==='function') try{e.stopImmediatePropagation();}catch{} cleanupActive(true); clearHover(); }
          else if(e.key==='Tab'){ e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation==='function') try{e.stopImmediatePropagation();}catch{} commitAndJump(e.shiftKey?-1:1); }
          else if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation==='function') try{e.stopImmediatePropagation();}catch{} try{ activeEl && activeEl.blur(); }catch{} }
        }
        function onEditBlur(){ setTimeout(()=>{ try{ if(activeEl && !committing) commitEdit(); }catch{} }, 80); }
        function activateEl(t){
          clearHover();
          hideHint();
          if(activeEl) cleanupActive(true);
          lastCommitEl=null;
          try{ if(selEl){ selEl.classList.remove('__ibx-edit-selected'); stripEmptyClass(selEl); } }catch{}
          selEl=t; treeSelEl=t;
          hideSelBar();
          activeEl=t;
          try{
            snapshot(activeEl);
            activeEl.classList.add('__ibx-edit-active');
            activeEl.setAttribute('contenteditable','true');
            try{ activeEl.setAttribute('spellcheck','false'); }catch{}
            activeEl.focus();
            try{
              const range=document.createRange(); range.selectNodeContents(activeEl); const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
            }catch{}
            activeEl.addEventListener('keydown', onEditKey);
            activeEl.addEventListener('blur', onEditBlur);
            showStyleBar(activeEl);
          }catch{}
        }
        function collectEditables(){
          const out=[];
          try{
            const nodes=document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,span,a,li,td,th,label,strong,em,b,i,u,small,code,pre,blockquote,div,dt,dd,caption,figcaption');
            for(let i=0;i<nodes.length && out.length<500;i++){ try{ if(isLeafEditable(nodes[i])) out.push(nodes[i]); }catch{} }
          }catch{}
          return out;
        }
        function onDocKey(e){
          if(!window.__ibxEditEnabled) return;
          // While a drag is in progress, only Esc cancels (other keys stay blocked)
          if(dragSrc || dragActive){
            if(e.key==='Escape'){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              cancelDrag();
            }
            if(dragActive || dragSrc) return;
          }
          if(activeEl) return; // let native keys work during text editing
          try{ if(e.target && e.target.closest && e.target.closest('[data-ibx-ui]')) return; }catch{}
          try{
            const t=e.target;
            // Don't get stuck in the guard on a detached node (a removed popup input) —
            // if it is not in the document, don't treat it as a form field at all.
            if(t && document.contains(t) && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)) return;
          }catch{}
          const mod=(e.ctrlKey||e.metaKey);
          const actTarget=selEl||hoverEl;
          if(e.key==='Escape' && selEl){
            e.preventDefault(); e.stopPropagation();
            try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
            clearSelection(); clearHover(); hideStyleBar();
            return;
          }
          if(e.key==='Enter' && selEl && !mod && !e.altKey && !e.shiftKey){
            let t=null;
            try{ t=findEditableTarget(selEl); }catch{}
            if(!t){ try{ if(isLeafEditable(selEl)) t=selEl; }catch{} }
            if(t){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              selectElement(t);
              activateEl(t);
              return;
            }
          }
          if(e.key!=='Tab'){
            // ── v4 shortcuts (on the hovered/selected element) ──
            if(mod && !e.shiftKey && (e.key==='e'||e.key==='E')){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              let t=actTarget;
              if(!t && lastPt){ try{ t=findEditableTarget(document.elementFromPoint(lastPt.x, lastPt.y)); }catch{} t=t||null; }
              if(!t){ try{ t=findEditableTarget(e.target); }catch{} t=t||null; }
              if(t) openHtmlEditor(t);
              return;
            }
            if(mod && !e.shiftKey && !e.altKey && (e.key==='z'||e.key==='Z')){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              requestUndo();
              return;
            }
            if(e.altKey && (e.key==='ArrowUp'||e.key==='ArrowDown')){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              if(actTarget) hoverEl=actTarget;
              moveHovered(e.key==='ArrowUp' ? -1 : 1);
              positionSelBar();
              return;
            }
            // ── v3 shortcuts (on the hovered/selected element) ──
            if(e.key==='Delete' && !mod && actTarget){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              hoverEl=actTarget;
              deleteHovered();
              clearSelection();
              return;
            }
            if(mod && (e.key==='d'||e.key==='D') && actTarget){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              hoverEl=actTarget;
              duplicateHovered();
              positionSelBar();
              return;
            }
            if(mod && (e.key==='k'||e.key==='K') && actTarget){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              openLinkWrap(actTarget);
              return;
            }
            return;
          }
          e.preventDefault(); e.stopPropagation();
          try{
            if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation();
          }catch{}
          try{
            const list=collectEditables();
            if(!list.length) return;
            let idx=-1;
            if(hoverEl){ for(let i=0;i<list.length;i++){ if(list[i]===hoverEl){ idx=i; break; } } }
            const next=list[(idx+(e.shiftKey?-1:1)+list.length)%list.length];
            clearHover();
            activateEl(next);
            try{ next.scrollIntoView({block:'nearest'}); }catch{}
          }catch{}
        }
        function onClick(e){
          if(!window.__ibxEditEnabled) return;
          // Click right after drag-drop (or a simple press in drag mode) — don't
          // activate editing. 350ms suppress window.
          if(Date.now()<suppressClickUntil){
            try{ e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
            return;
          }
          try{ if(e.target && e.target.closest && e.target.closest('[data-ibx-ui]')) return; }catch{}
          // Drag mode: a click must NOT activate text editing — grab cursor here,
          // click = drag intent. Otherwise activeEl would be set and block the drag.
          if(dragMode) return;
          // Alt+click = attributes (img src, link href, ...). No text editing.
          if(e.altKey){
            e.preventDefault(); e.stopPropagation();
            try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
            if(activeEl) cleanupActive(true);
            clearHover(); hideStyleBar();
            let at=null; try{ at=findAttrTarget(e.target); }catch{}
            if(at) openAttrPopup(at, e.clientX, e.clientY);
            return;
          }
          // Shift+click = element inspector (tag/size/colors/font + Copy HTML).
          if(e.shiftKey){
            e.preventDefault(); e.stopPropagation();
            try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
            if(activeEl) cleanupActive(true);
            clearHover(); hideStyleBar();
            let it=null;
            try{
              let n=e.target;
              if(n && n.nodeType===3) n=n.parentElement;
              if(n && n.nodeType===1 && n.tagName && n!==document.body && n!==document.documentElement) it=n;
            }catch{}
            if(it) openInspector(it, e.clientX, e.clientY);
            return;
          }
          // Ctrl/Cmd+click on a link = follow it (navigate), don't edit.
          if(e.ctrlKey||e.metaKey){
            try{
              const a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
              if(a) return;
            }catch{}
          }
          // While text editing, clicks inside the active element place the caret
          // natively — do not turn them into a new selection.
          if(activeEl && activeEl.contains(e.target)) return;
          // Cursor-like selection: a single click selects the element.
          // Double-click (or Enter) starts text editing.
          let t=null; try{ t=hoverCandidate(e.target); }catch{}
          if(!t) return;
          e.preventDefault(); e.stopPropagation();
          try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
          if(t===selEl){ showSelBar(t); return; }
          selectElement(t);
        }
        function onDblClick(e){
          if(!window.__ibxEditEnabled || dragMode || activeEl) return;
          try{ if(e.target && e.target.closest && e.target.closest('[data-ibx-ui]')) return; }catch{}
          let t=null;
          try{ t=findEditableTarget(e.target); }catch{}
          if(!t){
            let h=e.target;
            if(h && h.nodeType===3) h=h.parentElement;
            try{ if(h && isLeafEditable(h)) t=h; }catch{}
          }
          if(!t) return;
          e.preventDefault(); e.stopPropagation();
          try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
          selEl=t; treeSelEl=t;
          activateEl(t);
          try{ t.scrollIntoView({block:'nearest'}); }catch{}
        }
        function onPageHide(){ try{ if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); } }catch{} try{ clearHover(); }catch{} try{ treeSelEl=null; setTreeHi(null); }catch{} try{ clearSelection(); }catch{} try{ closeAttrPopup(); }catch{} try{ hideStyleBar(); }catch{} try{ hideHint(); }catch{} try{ closeInspect(); }catch{} try{ closeLinkPopup(); }catch{} try{ closeHtmlPopup(); }catch{} }
        // ── Attribute editor (Alt+click) ─────────────────────────────
        const ATTR_DEFS=[
          {k:'href',label:'Link URL'},
          {k:'src',label:'Source URL'},
          {k:'alt',label:'Alt text'},
          {k:'title',label:'Title'},
          {k:'placeholder',label:'Placeholder'},
          {k:'value',label:'Value'}
        ];
        function findAttrTarget(start){
          let el=start;
          if(el && el.nodeType===3) el=el.parentElement;
          let depth=0;
          while(el && el!==document.body && el!==document.documentElement && depth<5){
            if(el.nodeType===1 && el.tagName){
              const t=String(el.tagName).toLowerCase();
              if(['script','style','noscript','head','meta','link'].indexOf(t)===-1){
                for(let i=0;i<ATTR_DEFS.length;i++){
                  try{ if(el.hasAttribute && el.hasAttribute(ATTR_DEFS[i].k)) return el; }catch{}
                }
                if(t==='img'||t==='a'||t==='input'||t==='button'||t==='video'||t==='textarea'||t==='select') return el;
              }
            }
            el=el.parentElement; depth++;
          }
          return null;
        }
        function escAttr(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
        function closeAttrPopup(){
          try{
            // Remove focus left inside the popup — otherwise focus sticks to the detached input
            // and the later Tab guard (form-field check) swallows Tab.
            if(attrPopup && attrPopup.box){
              try{ if(attrPopup.box.contains(document.activeElement)) document.activeElement.blur(); }catch{}
              attrPopup.box.remove();
            }
          }catch{}
          attrPopup=null;
        }
        function openAttrPopup(target, x, y){
          closeAttrPopup();
          try{ closeInspect(); }catch{}
          try{ closeLinkPopup(); }catch{}
          hideHint();
          lastCommitEl=null;
          snapshot(target);
          const t=String(target.tagName||'').toLowerCase();
          const rows=[];
          for(let i=0;i<ATTR_DEFS.length;i++){
            const k=ATTR_DEFS[i].k;
            let has=false;
            try{ has=!!(target.hasAttribute && target.hasAttribute(k)); }catch{}
            if(!has){
              if((k==='href'&&t==='a')||(k==='src'&&(t==='img'||t==='video'))||(k==='alt'&&t==='img')||(k==='placeholder'&&(t==='input'||t==='textarea'))) has=true;
            }
            if(has) rows.push(ATTR_DEFS[i]);
          }
          const box=document.createElement('div');
          box.setAttribute('data-ibx-ui','1');
          box.className='__ibx-popup';
          let html='<div style="font-weight:bold;margin-bottom:2px;">Attributes &lt;'+t+'&gt;</div>';
          if(!rows.length) html+='<div style="color:#666;font-size:12px;">No editable attributes on this element.</div>';
          for(let i=0;i<rows.length;i++){
            let v='';
            try{ v=target.getAttribute(rows[i].k)||''; }catch{}
            html+='<label>'+rows[i].label+'</label><input data-k="'+rows[i].k+'" value="'+escAttr(v)+'" spellcheck="false">';
          }
          html+='<div><button data-act="save" class="__ibx-primary">Save</button><button data-act="cancel">Cancel</button></div>';
          box.innerHTML=html;
          const bx=Math.max(4, Math.min((vw())-300, (x||100)+8));
          const by=Math.max(4, Math.min((window.innerHeight||600)-200, (y||100)+10));
          box.style.left=bx+'px'; box.style.top=by+'px';
          document.body.appendChild(box);
          attrPopup={ box: box, el: target };
          const stop=function(e){ try{ e.stopPropagation(); }catch{} };
          try{ box.addEventListener('mousedown', stop, false); }catch{}
          try{ box.addEventListener('click', stop, false); }catch{}
          try{ box.addEventListener('keydown', stop, false); }catch{}
          const btns=box.querySelectorAll('button');
          for(let i=0;i<btns.length;i++){
            (function(btn){
              btn.addEventListener('click', function(e){
                try{ e.preventDefault(); e.stopPropagation(); }catch{}
                if(btn.getAttribute('data-act')==='cancel'){ closeAttrPopup(); return; }
                try{
                  const el=attrPopup && attrPopup.el;
                  if(!el || !document.contains(el)){ closeAttrPopup(); return; }
                  const inputs=box.querySelectorAll('input[data-k]');
                  let changed=false;
                  for(let j=0;j<inputs.length;j++){
                    const k=inputs[j].getAttribute('data-k');
                    const nv=inputs[j].value;
                    let ov=null;
                    try{ ov=el.getAttribute(k); }catch{}
                    if(String(ov==null?'':ov)!==nv){
                      try{ el.setAttribute(k, nv); }catch{}
                      try{ if(k==='value' && ('value' in el)) el.value=nv; }catch{}
                      changed=true;
                    }
                  }
                  if(changed){ el.__ibxDirtyHTML=true; commitHtml(el); }
                }catch{}
                closeAttrPopup();
              });
            })(btns[i]);
          }
          try{
            const first=box.querySelector('input');
            if(first){ first.focus(); first.select(); }
          }catch{}
        }
        // ── Quick styles toolbar (on the active text element) ─────────────
        function toggleDeco(el, word){
          try{
            const cur=String(el.style.textDecorationLine||'');
            const parts=cur ? cur.split(' ') : [];
            let nx='';
            if(parts.indexOf(word)!==-1){
              nx=parts.filter(function(w){ return w!==word; }).join(' ');
            } else {
              nx=(cur ? cur+' ':'')+word;
            }
            el.style.textDecorationLine=nx || 'none';
            el.__ibxDirtyHTML=true;
          }catch{}
        }
        // computed textAlign can return 'start'/'end' — map logical keywords to
        // physical ones in the cycle/display, otherwise the cycle gets stuck.
        function normAlign(v){
          const s=String(v||'left');
          if(s==='start' || s==='match-parent') return 'left';
          if(s==='end') return 'right';
          return s;
        }
        // A style applied from the sidebar (while the target is NOT being edited) commits
        // once, debounced — no file save on every color-drag tick.
        function clearPendingStyle(revert){
          try{
            const el=styleCommitEl;
            styleCommitEl=null;
            if(el && el.__ibxStyleTimer){
              clearTimeout(el.__ibxStyleTimer);
              el.__ibxStyleTimer=null;
              if(revert && document.contains(el)) restoreOriginal(el);
            }
          }catch{}
        }
        function scheduleStyleCommit(el, tries){
          try{
            if(!el || !document.contains(el)) return;
            if(el.__ibxStyleTimer) clearTimeout(el.__ibxStyleTimer);
            styleCommitEl=el;
            el.__ibxStyleTimer=setTimeout(function(){
              try{
                el.__ibxStyleTimer=null;
                if(styleCommitEl===el) styleCommitEl=null;
                if(!document.contains(el)) return;
                // Another element is being edited — retry after a short delay.
                if(activeEl && activeEl!==el && (tries||0)<6){ scheduleStyleCommit(el, (tries||0)+1); return; }
                if(activeEl) return;
                hideStyleBar();
                commitHtml(el);
              }catch{}
            }, 500);
          }catch{}
        }
        function hideStyleBar(){ try{ if(styleBar) styleBar.remove(); }catch{} styleBar=null; }
        function placeStyleBar(bar, el){
          try{
            const r=el.getBoundingClientRect();
            let top=r.top-36;
            if(top<4) top=r.bottom+6;
            const w=bar.offsetWidth||340;
            const left=Math.max(4, Math.min((vw())-w-8, r.left));
            bar.style.left=left+'px'; bar.style.top=Math.max(4, top)+'px';
          }catch{}
        }
        function styleBtn(bar, label, title, fn){
          const b=document.createElement('button');
          b.textContent=label; b.title=title;
          b.addEventListener('click', function(e){
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
            try{ fn(); }catch{}
            try{ activeEl && activeEl.focus && activeEl.focus(); }catch{}
          });
          bar.appendChild(b);
          return b;
        }
        function showStyleBar(el){
          hideStyleBar();
          if(!el || !document.contains(el)) return;
          const bar=document.createElement('div');
          bar.setAttribute('data-ibx-ui','1');
          bar.className='__ibx-stylebar';
          // CRITICAL: keep focus inside the contenteditable on mousedown.
          // Without this, a button/color click steals focus -> blur ->
          // onEditBlur fires commitEdit within 80ms (a premature text save
          // or a no-change restore that wipes the style). The color picker is
          // modal — the commit would run in between and the style would land on
          // a detached node (invisible). mousedown preventDefault keeps focus put;
          // click still fires. (Don't apply this to the attr popup —
          // its text inputs need focus.)
          try{
            bar.addEventListener('mousedown', function(e){ try{ e.preventDefault(); }catch{} }, true);
          }catch{}
          styleBtn(bar, 'B', 'Bold', function(){ el.style.fontWeight=(el.style.fontWeight==='bold'?'':'bold'); el.__ibxDirtyHTML=true; });
          styleBtn(bar, 'I', 'Italic', function(){ el.style.fontStyle=(el.style.fontStyle==='italic'?'':'italic'); el.__ibxDirtyHTML=true; });
          // v4: underline / strikethrough toggles (the sidebar STYLE section uses these too)
          styleBtn(bar, 'U', 'Underline', function(){ toggleDeco(el, 'underline'); });
          styleBtn(bar, 'S', 'Strikethrough', function(){ toggleDeco(el, 'line-through'); });
          styleBtn(bar, 'A+', 'Font bigger', function(){
            let s=16;
            try{ s=parseFloat(window.getComputedStyle(el).fontSize)||16; }catch{}
            el.style.fontSize=Math.min(72, s+2)+'px'; el.__ibxDirtyHTML=true;
          });
          styleBtn(bar, 'A−', 'Font smaller', function(){
            let s=16;
            try{ s=parseFloat(window.getComputedStyle(el).fontSize)||16; }catch{}
            el.style.fontSize=Math.max(8, s-2)+'px'; el.__ibxDirtyHTML=true;
          });
          const col=document.createElement('input');
          col.type='color'; col.title='Text color';
          try{
            let c='#000000';
            try{ c=window.getComputedStyle(el).color||c; }catch{}
            col.value=rgbToHex(c);
          }catch{}
          col.addEventListener('input', function(){ try{ el.style.color=col.value; el.__ibxDirtyHTML=true; }catch{} });
          col.addEventListener('click', function(e){ try{ e.stopPropagation(); }catch{} });
          bar.appendChild(col);
          const aligns=['left','center','right','justify'];
          const ab=styleBtn(bar, '≡', 'Text align (cycle)', function(){
            let cur='';
            try{ cur=normAlign(window.getComputedStyle(el).textAlign||'left'); }catch{}
            let i=aligns.indexOf(cur); if(i<0) i=0;
            const nx=aligns[(i+1)%aligns.length]||'left';
            el.style.textAlign=nx; el.__ibxDirtyHTML=true;
            try{ ab.textContent=nx.charAt(0).toUpperCase(); }catch{}
          });
          // ── v3: text-transform, font family, letter spacing, background ──
          const tts=['none','uppercase','lowercase','capitalize'];
          const ttLabels=['TT','AA','aa','Aa'];
          const ttb=styleBtn(bar, 'TT', 'Text transform: none → UPPER → lower → Capitalize', function(){
            let cur='none';
            try{ cur=window.getComputedStyle(el).textTransform||'none'; }catch{}
            let i=tts.indexOf(cur); if(i<0) i=0;
            const j=(i+1)%tts.length;
            el.style.textTransform=tts[j]; el.__ibxDirtyHTML=true;
            try{ ttb.textContent=ttLabels[j]; }catch{}
          });
          const FONTS=['inherit','Arial, sans-serif','Helvetica, sans-serif','Times New Roman, serif','Georgia, serif','Courier New, monospace','Verdana, sans-serif','Tahoma, sans-serif','Trebuchet MS, sans-serif','system-ui, sans-serif','monospace','serif','sans-serif'];
          const fontLabel=function(name){ try{ return (String(name).split(',')[0].trim().split(' ')[0]||'Fnt').slice(0,7); }catch{ return 'Fnt'; } };
          const fb=styleBtn(bar, 'Fnt', 'Font family (cycle)', function(){
            let i=-1;
            try{
              const cur=String(window.getComputedStyle(el).fontFamily||'').toLowerCase();
              for(let j=0;j<FONTS.length;j++){
                const head=String(FONTS[j]).split(',')[0].trim().toLowerCase();
                if(head!=='inherit' && cur.indexOf(head)!==-1){ i=j; break; }
              }
            }catch{}
            const nx=FONTS[(i+1)%FONTS.length];
            el.style.fontFamily=nx; el.__ibxDirtyHTML=true;
            try{ fb.textContent=fontLabel(nx); }catch{}
          });
          try{
            const cur=String(window.getComputedStyle(el).fontFamily||'').toLowerCase();
            for(let j=1;j<FONTS.length;j++){
              const head=String(FONTS[j]).split(',')[0].trim().toLowerCase();
              if(cur.indexOf(head)!==-1){ fb.textContent=fontLabel(FONTS[j]); break; }
            }
          }catch{}
          styleBtn(bar, 'LS+', 'Letter spacing +0.5px', function(){
            let v=0;
            try{ v=parseFloat(window.getComputedStyle(el).letterSpacing)||0; }catch{}
            if(!isFinite(v)||v<0) v=0;
            v=Math.min(12, Math.round((v+0.5)*10)/10);
            el.style.letterSpacing=v+'px'; el.__ibxDirtyHTML=true;
          });
          styleBtn(bar, 'LS−', 'Letter spacing −0.5px', function(){
            let v=0;
            try{ v=parseFloat(window.getComputedStyle(el).letterSpacing)||0; }catch{}
            if(!isFinite(v)||v<0) v=0;
            v=Math.max(0, Math.round((v-0.5)*10)/10);
            el.style.letterSpacing=v>0 ? v+'px' : 'normal'; el.__ibxDirtyHTML=true;
          });
          const bg=document.createElement('input');
          bg.type='color'; bg.title='Background color';
          try{
            let c='';
            try{ c=String(window.getComputedStyle(el).backgroundColor||''); }catch{}
            if(!c || c==='transparent' || c==='rgba(0, 0, 0, 0)' || c==='rgba(0,0,0,0)') bg.value='#ffffff';
            else bg.value=rgbToHex(c);
          }catch{ bg.value='#ffffff'; }
          bg.addEventListener('input', function(){ try{ el.style.backgroundColor=bg.value; el.__ibxDirtyHTML=true; }catch{} });
          bg.addEventListener('click', function(e){ try{ e.stopPropagation(); }catch{} });
          bar.appendChild(bg);
          styleBtn(bar, 'HTML', 'Edit element as raw HTML (Ctrl+E)', function(){ try{ openHtmlEditor(el); }catch{} });
          styleBtn(bar, '✕', 'Clear inline styles', function(){ try{ el.removeAttribute('style'); }catch{} el.__ibxDirtyHTML=true; });
          document.body.appendChild(bar);
          styleBar=bar;
          placeStyleBar(bar, el);
        }
        function rgbToHex(c){
          try{
            // NOTE: this is inside a template literal — write regex backslashes DOUBLE
            // (a single \s becomes 's' as soon as the outer literal is parsed).
            const m=String(c||'').match(/rgba?\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
            if(!m) return '#000000';
            const h=function(n){ n=Math.max(0, Math.min(255, parseInt(n,10)||0)); const s=n.toString(16); return s.length===1?'0'+s:s; };
            return '#'+h(m[1])+h(m[2])+h(m[3]);
          }catch{ return '#000000'; }
        }
        // ── v3: delete / duplicate / wrap-link + inspector ──────────────
        // Delete/duplicate/wrap mutates the element itself — persistence happens
        // via an old→new commit of the closest PARENT outerHTML (find a small
        // ancestor whose outerHTML fits within the size cap).
        function pickCommitAnchor(el, estRatio){
          let p=el ? el.parentElement : null;
          let g=0;
          while(p && g++<8){
            try{
              // Never take HTML/HEAD — head holds the edit-sheet/title payloads that
              // are not in the file, and data-ibx-ui popups can appear inside body
              // (detachUi removes them; body is allowed).
              if(p.nodeType===1 && p.tagName && p.tagName!=='HEAD' && p.tagName!=='HTML'){
                const len=String(p.outerHTML||'').length;
                const est=Math.ceil(len*estRatio);
                if(len>0 && len<=14000 && est<=14000) return p;
              }
            }catch{}
            p=p.parentElement;
          }
          return null;
        }
        // In body-anchor commits, popups/stylebar/hint (data-ibx-ui) ended up in the
        // snapshot — the needle no longer matched the file. Remove them while
        // serializing, then re-attach afterwards.
        function detachUi(root){
          const removed=[];
          try{
            const list=root.querySelectorAll('[data-ibx-ui]');
            for(let i=0;i<list.length;i++){
              const n=list[i];
              const par=n.parentNode;
              if(!par) continue;
              removed.push({ n:n, p:par, nx:n.nextSibling });
              try{ par.removeChild(n); }catch{}
            }
          }catch{}
          return removed;
        }
        function reattachUi(removed){
          for(let i=removed.length-1;i>=0;i--){
            const r=removed[i];
            try{ if(r.n && r.n.parentNode==null && r.p) r.p.insertBefore(r.n, r.nx); }catch{}
          }
        }
        function ensureUiAttached(removed){
          // restoreOriginal replaced outerHTML — put any leftover ui node back
          // into body (fixed positioning, safe).
          try{
            for(let i=0;i<removed.length;i++){
              const n=removed[i].n;
              if(n && n.parentNode==null && document.body) document.body.appendChild(n);
            }
          }catch{}
        }
        function commitViaAnchor(el, mutate, ratio){
          try{
            if(!el || !document.contains(el)) return false;
            const p=pickCommitAnchor(el, ratio||1.2);
            if(!p) return false;
            const hidden=detachUi(p);
            stripEditArtifacts(p);
            let oldHtml='';
            try{ oldHtml=String(p.outerHTML||''); }catch{}
            if(!oldHtml){ reattachUi(hidden); return false; }
            p.__ibxOrigHTML=oldHtml;
            let mutated=false;
            try{ mutate(p); mutated=true; }catch{}
            let cur='';
            if(mutated){ stripEditArtifacts(p); try{ cur=String(p.outerHTML||''); }catch{} }
            reattachUi(hidden);
            if(!mutated || !cur || oldHtml===cur || cur.length>14000){
              try{ restoreOriginal(p); }catch{}
              ensureUiAttached(hidden);
              return false;
            }
            try{ capturePrevTitle(); }catch{}
            lastCommitEl=p;
            sendPayload({ mode:'html', oldHtml: oldHtml, newHtml: cur, tagName: String(p.tagName||''), url: location.href });
            return true;
          }catch{ return false; }
        }
        function deleteHovered(){
          const el=hoverEl;
          if(!el || !document.contains(el) || activeEl) return;
          busy++;
          try{
            // Remove the hover class first — otherwise the anchor (parent) outerHTML
            // differs from the HTML in the file (save fails + reverts).
            clearHover();
            const ok=commitViaAnchor(el, function(){ try{ el.remove(); }catch{} }, 1.0);
            // No anchor found (page too large), so delete visually only.
            if(!ok && document.contains(el)){
              try{ el.remove(); }catch{}
            }
          } finally { busy--; }
          clearHover();
        }
        function duplicateHovered(){
          const el=hoverEl;
          if(!el || !document.contains(el) || activeEl) return;
          busy++;
          try{
            clearHover();
            let clone=null;
            try{
              clone=el.cloneNode(true);
              try{ clone.removeAttribute('id'); }catch{}
              try{
                const ids=clone.querySelectorAll('[id]');
                for(let i=0;i<ids.length;i++){ try{ ids[i].removeAttribute('id'); }catch{} }
              }catch{}
              try{ clone.classList.remove('__ibx-edit-hover','__ibx-edit-active'); }catch{}
              try{ clone.removeAttribute('contenteditable'); }catch{}
            }catch{ clone=null; }
            if(!clone) return;
            const insert=function(){
              const p=el.parentElement;
              if(!p) throw new Error('no parent');
              p.insertBefore(clone, el.nextSibling);
            };
            let ok=false;
            try{ ok=commitViaAnchor(el, insert, 2.0); }catch{ ok=false; }
            if(!ok){
              try{ if(document.contains(el)) insert(); }catch{}
            }
          } finally { busy--; }
          clearHover();
        }
        function copyText(s){
          try{
            const ta=document.createElement('textarea');
            ta.value=String(s==null?'':s);
            ta.setAttribute('data-ibx-ui','1');
            ta.style.position='fixed'; ta.style.left='-9999px';
            document.body.appendChild(ta);
            ta.select();
            let ok=false;
            try{ ok=document.execCommand('copy'); }catch{}
            try{ ta.remove(); }catch{}
            if(!ok && navigator.clipboard && navigator.clipboard.writeText){
              try{ navigator.clipboard.writeText(String(s==null?'':s)); ok=true; }catch{}
            }
            return !!ok;
          }catch{ return false; }
        }
        function closeInspect(){
          try{
            if(inspectPopup && inspectPopup.box){
              try{ if(inspectPopup.box.contains(document.activeElement)) document.activeElement.blur(); }catch{}
              inspectPopup.box.remove();
            }
          }catch{}
          inspectPopup=null;
        }
        // TODO(React props panel — phase 2): a "Props" section will sit with the inspector.
        // Guest: send the target's outerHTML + tag/class fingerprint;
        // host: resolve the source file via liveEditLocate, parse the component's
        // props/defaults in JSX/TSX, show the variant list in the sidebar
        // (enum/bool/number); on edit, write the file → reload the preview.
        // DOM→component mapping via approximation (tagName+className+text) is fine.
        function openInspector(el, x, y){
          try{
            if(!el || el.nodeType!==1 || !el.tagName) return;
            if(el===document.body || el===document.documentElement) return;
            closeInspect(); closeAttrPopup(); closeLinkPopup(); hideHint();
            lastCommitEl=null;
            let cs=null;
            try{ cs=window.getComputedStyle(el); }catch{}
            let rw=0, rh=0;
            try{ const rr=el.getBoundingClientRect(); rw=rr.width; rh=rr.height; }catch{}
            const tag=String(el.tagName||'').toLowerCase();
            const box=document.createElement('div');
            box.setAttribute('data-ibx-ui','1');
            box.className='__ibx-popup';
            const rows=[];
            rows.push(['Tag','&lt;'+escAttr(tag)+'&gt;']);
            try{ if(el.id) rows.push(['ID','#'+escAttr(String(el.id))]); }catch{}
            try{
              const cls=(typeof el.className==='string') ? el.className : '';
              if(cls.trim()) rows.push(['Class', escAttr(cls.trim().slice(0,70))]);
            }catch{}
            rows.push(['Size', Math.round(rw)+' × '+Math.round(rh)+' px']);
            if(cs){
              let txt=''; try{ txt=String(el.innerText||'').trim(); }catch{}
              rows.push(['Text', txt.length+' chars']);
              rows.push(['Font', escAttr(String(cs.fontSize||''))+' / '+escAttr(String(cs.fontWeight||''))]);
              rows.push(['Family', escAttr(String(cs.fontFamily||'').slice(0,38))]);
              const swatch=function(col){ return '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:'+escAttr(String(col||''))+';vertical-align:-1px;"></span> '; };
              rows.push(['Color', swatch(cs.color)+escAttr(String(cs.color||''))]);
              const bgc=String(cs.backgroundColor||'');
              if(bgc && bgc!=='rgba(0, 0, 0, 0)' && bgc!=='transparent') rows.push(['BG', swatch(bgc)+escAttr(bgc)]);
            }
            let html='<div style="font-weight:bold;margin-bottom:4px;">Inspector</div>';
            for(let i=0;i<rows.length;i++){
              html+='<div style="display:flex;gap:8px;font-size:12px;padding:1px 0;"><span style="color:#555555;min-width:64px;flex-shrink:0;">'+rows[i][0]+'</span><span style="word-break:break-all;">'+rows[i][1]+'</span></div>';
            }
            html+='<div><button data-act="copy">Copy HTML</button><button data-act="edit">Edit HTML</button><button data-act="attrs">Attributes</button><button data-act="close">Close</button></div>';
            box.innerHTML=html;
            const bx=Math.max(4, Math.min((vw())-300, (x||100)+8));
            const by=Math.max(4, Math.min((window.innerHeight||600)-250, (y||100)+10));
            box.style.left=bx+'px'; box.style.top=by+'px';
            document.body.appendChild(box);
            inspectPopup={ box: box, el: el };
            const stop=function(e){ try{ e.stopPropagation(); }catch{} };
            try{ box.addEventListener('mousedown', stop, false); }catch{}
            try{ box.addEventListener('click', stop, false); }catch{}
            const btns=box.querySelectorAll('button');
            for(let i=0;i<btns.length;i++){
              (function(btn){
                btn.addEventListener('click', function(e){
                  try{ e.preventDefault(); e.stopPropagation(); }catch{}
                  const act=btn.getAttribute('data-act');
                  const target=(inspectPopup && inspectPopup.el) || el;
                  if(act==='close'){ closeInspect(); return; }
                  if(act==='edit'){
                    const et=(inspectPopup && inspectPopup.el) || el;
                    closeInspect();
                    if(et && document.contains(et)) openHtmlEditor(et);
                    return;
                  }
                  if(act==='copy'){
                    let ok=false;
                    try{ ok=copyText(String(target.outerHTML||'')); }catch{}
                    const old=btn.textContent;
                    btn.textContent=ok?'Copied!':'Copy failed';
                    setTimeout(function(){ try{ btn.textContent=old; }catch{} }, 1200);
                    return;
                  }
                  if(act==='attrs'){
                    const ax=(x||100), ay=(y||100);
                    closeInspect();
                    if(target && document.contains(target)) openAttrPopup(target, ax, ay);
                    return;
                  }
                });
              })(btns[i]);
            }
          }catch{}
        }
        function closeLinkPopup(){
          try{
            if(linkPopup && linkPopup.box){
              try{ if(linkPopup.box.contains(document.activeElement)) document.activeElement.blur(); }catch{}
              linkPopup.box.remove();
            }
          }catch{}
          linkPopup=null;
        }
        function openLinkWrap(el){
          try{
            if(!el || !document.contains(el) || activeEl) return;
            try{ if(el.closest && el.closest('a')) return; }catch{}
            closeAttrPopup(); closeLinkPopup(); closeInspect(); hideHint();
            lastCommitEl=null;
            clearHover();
            let x=100, y=100;
            try{ const r=el.getBoundingClientRect(); x=r.left; y=r.bottom+6; }catch{}
            const box=document.createElement('div');
            box.setAttribute('data-ibx-ui','1');
            box.className='__ibx-popup';
            let html='<div style="font-weight:bold;margin-bottom:2px;">Wrap &lt;'+escAttr(String(el.tagName||'').toLowerCase())+'&gt; as link</div>';
            html+='<label>Link URL</label><input data-url placeholder="https://" spellcheck="false">';
            html+='<div><button data-act="wrap" class="__ibx-primary">Wrap</button><button data-act="cancel">Cancel</button></div>';
            box.innerHTML=html;
            const bx=Math.max(4, Math.min((vw())-300, x+8));
            const by=Math.max(4, Math.min((window.innerHeight||600)-200, y+10));
            box.style.left=bx+'px'; box.style.top=by+'px';
            document.body.appendChild(box);
            linkPopup={ box: box, el: el };
            const stop=function(e){ try{ e.stopPropagation(); }catch{} };
            try{ box.addEventListener('mousedown', stop, false); }catch{}
            try{ box.addEventListener('click', stop, false); }catch{}
            const wrap=function(e){
              try{ e.preventDefault(); e.stopPropagation(); }catch{}
              const inp=box.querySelector('input[data-url]');
              let url=inp? String(inp.value||'').trim() : '';
              if(!url){ try{ if(inp) inp.focus(); }catch{} return; }
              url=url.split(' ').join('');
              if(url.indexOf(':')===-1 && url.charAt(0)!=='/' && url.charAt(0)!=='#' && url.charAt(0)!=='.') url='https://'+url;
              const finalUrl=url;
              const wrapIt=function(){
                const p=el.parentElement;
                if(!p) throw new Error('no parent');
                const a=document.createElement('a');
                a.setAttribute('href', finalUrl);
                p.insertBefore(a, el);
                a.appendChild(el);
              };
              let ok=false;
              busy++;
              try{ clearHover(); ok=commitViaAnchor(el, wrapIt, 1.4); }catch{ ok=false; } finally { busy--; }
              if(!ok){
                try{ if(document.contains(el)) wrapIt(); }catch{}
              }
              closeLinkPopup();
              clearHover();
            };
            const btns=box.querySelectorAll('button');
            for(let i=0;i<btns.length;i++){
              (function(btn){
                btn.addEventListener('click', function(e){
                  try{ e.preventDefault(); e.stopPropagation(); }catch{}
                  if(btn.getAttribute('data-act')==='cancel'){ closeLinkPopup(); return; }
                  wrap(e);
                });
              })(btns[i]);
            }
            try{
              const inp=box.querySelector('input[data-url]');
              if(inp){
                inp.addEventListener('keydown', function(e){
                  try{ e.stopPropagation(); }catch{}
                  if(e.key==='Enter') wrap(e);
                });
                inp.focus();
              }
            }catch{}
          }catch{}
        }
        // ── v4: raw HTML editor (Ctrl+E / stylebar / inspector) ─────────
        function closeHtmlPopup(){
          try{
            if(htmlPopup && htmlPopup.box){
              try{ if(htmlPopup.box.contains(document.activeElement)) document.activeElement.blur(); }catch{}
              htmlPopup.box.remove();
            }
          }catch{}
          htmlPopup=null;
        }
        function openHtmlBox(target){
          try{
            if(!target || !document.contains(target)) return;
            closeAttrPopup(); closeInspect(); closeLinkPopup(); closeHtmlPopup(); hideHint();
            lastCommitEl=null;
            snapshot(target);
            const tag=String(target.tagName||'').toLowerCase();
            const box=document.createElement('div');
            box.setAttribute('data-ibx-ui','1');
            box.className='__ibx-popup';
            box.style.width='352px';
            let html='<div style="font-weight:bold;margin-bottom:2px;">Edit HTML &lt;'+escAttr(tag)+'&gt;</div>';
            html+='<textarea data-html spellcheck="false"></textarea>';
            html+='<div class="__ibx-note">Ctrl+Enter applies &nbsp;·&nbsp; Esc cancels</div>';
            html+='<div><button data-act="apply" class="__ibx-primary">Apply</button><button data-act="cancel">Cancel</button></div>';
            box.innerHTML=html;
            const ta=box.querySelector('textarea[data-html]');
            try{ if(ta) ta.value=String(target.outerHTML||''); }catch{}
            let x=60, y=60;
            try{ const r=target.getBoundingClientRect(); x=r.left; y=r.bottom+8; }catch{}
            box.style.left=Math.max(4, Math.min((vw())-368, x+8))+'px';
            box.style.top=Math.max(4, Math.min((window.innerHeight||600)-330, y+10))+'px';
            document.body.appendChild(box);
            htmlPopup={ box: box, el: target };
            const stop=function(e){ try{ e.stopPropagation(); }catch{} };
            try{ box.addEventListener('mousedown', stop, false); }catch{}
            try{ box.addEventListener('click', stop, false); }catch{}
            const apply=function(){
              try{
                const el=htmlPopup && htmlPopup.el;
                const val=ta? String(ta.value||'').trim() : '';
                if(!el || !document.contains(el) || !val){ closeHtmlPopup(); return; }
                let parsed=null;
                try{
                  const holder=document.createElement('div');
                  holder.innerHTML=val;
                  const first=holder.firstElementChild;
                  if(first) parsed=first.outerHTML;
                }catch{ parsed=null; }
                if(!parsed || parsed===String(el.outerHTML||'').trim()){ return; }
                if(parsed.length>14000){ return; }
                busy++;
                let ok=false;
                try{
                  clearHover(); hideStyleBar();
                  ok=commitViaAnchor(el, function(){ el.outerHTML=parsed; }, 1.2);
                }catch{ ok=false; } finally { busy--; }
                if(!ok && document.contains(el)){ try{ el.outerHTML=parsed; }catch{} }
              }catch{}
              closeHtmlPopup();
              clearHover();
            };
            const btns=box.querySelectorAll('button');
            for(let i=0;i<btns.length;i++){
              (function(btn){
                btn.addEventListener('click', function(e){
                  try{ e.preventDefault(); e.stopPropagation(); }catch{}
                  if(btn.getAttribute('data-act')==='cancel'){ closeHtmlPopup(); return; }
                  apply();
                });
              })(btns[i]);
            }
            if(ta){
              ta.addEventListener('keydown', function(e){
                try{ e.stopPropagation(); }catch{}
                const mod=(e.ctrlKey||e.metaKey);
                if(mod && e.key==='Enter'){ try{ e.preventDefault(); }catch{} apply(); }
                else if(e.key==='Escape'){ try{ e.preventDefault(); }catch{} closeHtmlPopup(); }
              });
              ta.focus();
            }
          }catch{}
        }
        // If a text/style edit is pending, save it first (so the DOM matches the file)
        // — otherwise the HTML editor's parent-needle save fails and reverts.
        function openHtmlEditor(target){
          try{
            if(!target || !document.contains(target)) return;
            if(activeEl){
              const el=activeEl;
              let hasChange=false;
              try{ hasChange = !!el.__ibxDirtyHTML || (readElText(el)!==String(el.__ibxOldText||'').trim()); }catch{}
              if(hasChange || committing){
                if(!committing){ try{ commitEdit(); }catch{} }
                setTimeout(function(){ try{ openHtmlBox(target); }catch{} }, 600);
                return;
              }
              try{ cleanupActive(false); }catch{}
              try{ hideStyleBar(); }catch{}
            }
            openHtmlBox(target);
          }catch{}
        }
        // ── v4: move hovered element among siblings (Alt+Up / Alt+Down) ──
        function moveHovered(dir){
          const el=hoverEl;
          if(!el || !document.contains(el) || activeEl) return;
          try{
            if(!el.parentElement) return;
            if(dir<0 && !el.previousElementSibling) return;
            if(dir>0 && !el.nextElementSibling) return;
          }catch{ return; }
          busy++;
          try{
            clearHover();
            const swap=function(){
              if(dir<0){
                const prev=el.previousElementSibling;
                if(!prev) throw new Error('edge');
                el.parentElement.insertBefore(el, prev);
              } else {
                const nx=el.nextElementSibling;
                if(!nx) throw new Error('edge');
                nx.parentElement.insertBefore(nx, el);
              }
            };
            let ok=false;
            try{ ok=commitViaAnchor(el, swap, 1.6); }catch{ ok=false; }
            if(!ok && document.contains(el)){ try{ swap(); }catch{} }
          } finally { busy--; }
          clearHover();
        }
        // ── v4: Ctrl+Z → revert last save via host + restore DOM ────────────
        // NOTE: a nonce (n) in the payload is required — the host dedupes the same
        // title string within 5s, otherwise pressing Ctrl+Z again swallows the undo.
        let undoSeq=0;
        function requestUndo(){
          try{
            if(activeEl || committing) return false;
            sendPayload({ mode:'undo', n: ++undoSeq, at: Date.now(), url: location.href });
            return true;
          }catch{ return false; }
        }
        // The host reverted the file — also restore the DOM's last commit.
        window.__ibxUndoLastVisual=function(){
          try{
            if(activeEl) return false;
            const el=lastCommitEl;
            lastCommitEl=null;
            if(!el || !document.contains(el)) return false;
            restoreOriginal(el);
            clearHover(); hideHint();
            return true;
          }catch{ return false; }
        };
        // ── v5: sidebar APIs (host sidebar buttons run from here) ──
        function sendNotice(msg){
          try{ sendPayload({ mode:'notice', msg:String(msg||''), at: Date.now() }); }catch{}
        }
        // The mouse is not over the page when on the sidebar — last pointed element = target.
        function resolveTarget(needText){
          try{
            if(activeEl && document.contains(activeEl)) return activeEl;
            if(treeSelEl && document.contains(treeSelEl)) return treeSelEl;
            if(hoverEl && document.contains(hoverEl)) return hoverEl;
            if(!lastPt) return null;
            const hit=document.elementFromPoint(lastPt.x, lastPt.y);
            if(!hit || isUiNode(hit)) return null;
            const t=findEditableTarget(hit);
            if(t) return t;
            if(needText) return null;
            let el=hit, d=0;
            while(el && el!==document.body && el!==document.documentElement && d<5){
              if(el.nodeType===1 && el.tagName){
                const tg=String(el.tagName).toUpperCase();
                if(['SCRIPT','STYLE','NOSCRIPT','HEAD','META','LINK'].indexOf(tg)===-1) return el;
              }
              el=el.parentElement; d++;
            }
          }catch{}
          return null;
        }
        // Style controls target: even without a text edit, a page element can be
        // styled (padding/radius on a card, etc.). Same resolution as the tools,
        // excluding body/html and our own UI nodes.
        function resolveStyleTarget(){
          try{
            if(activeEl && document.contains(activeEl)) return activeEl;
            if(selEl && document.contains(selEl)) return selEl;
            if(treeSelEl && document.contains(treeSelEl)) return treeSelEl;
            if(hoverEl && document.contains(hoverEl)) return hoverEl;
            if(!lastPt) return null;
            const hit=document.elementFromPoint(lastPt.x, lastPt.y);
            if(!hit || hit.nodeType!==1 || isUiNode(hit)) return null;
            const tg=String(hit.tagName||'').toUpperCase();
            if(tg==='HTML'||tg==='HEAD'||tg==='BODY') return null;
            return hit;
          }catch{ return null; }
        }
        // If a text/style edit is pending, save it first, then run the tool
        // (the HTML tool's openHtmlEditor does the same).
        function runTool(fn){
          try{
            if(activeEl){
              const el=activeEl;
              let hasChange=false;
              try{ hasChange = !!el.__ibxDirtyHTML || (readElText(el)!==String(el.__ibxOldText||'').trim()); }catch{}
              if(hasChange || committing){
                if(!committing){ try{ commitEdit(); }catch{} }
                setTimeout(function(){ try{ fn(); }catch{} }, 600);
                return true;
              }
              try{ cleanupActive(false); }catch{}
              try{ hideStyleBar(); }catch{}
            }
            fn();
            return true;
          }catch{ return false; }
        }
        window.__ibxEditAction=function(name){
          try{
            if(!window.__ibxEditEnabled) return false;
            if(name==='cancel'){ try{ window.__ibxCancelEdit && window.__ibxCancelEdit(); }catch{} return true; }
            // The drag toggle needs no target — the mode is just on/off.
            if(name==='dragToggle'){ try{ window.__ibxSetDragMode(!dragMode); }catch{} return true; }
            const needText=(name==='edit'||name==='html');
            const t=resolveTarget(needText);
            if(!t){ sendNotice('Point at an element in the page first'); return false; }
            const has=function(){ try{ return document.contains(t); }catch{ return false; } };
            const closeAll=function(){ try{ closeAttrPopup(); closeInspect(); closeLinkPopup(); closeHtmlPopup(); hideHint(); }catch{} };
            if(name==='edit'){
              runTool(function(){
                if(!has()) return;
                closeAll();
                clearHover();
                activateEl(t);
                try{ t.scrollIntoView({block:'nearest'}); }catch{}
              });
              return true;
            }
            if(name==='delete'){
              runTool(function(){ if(has()){ closeAll(); clearHover(); hoverEl=t; deleteHovered(); } });
              return true;
            }
            if(name==='duplicate'){
              runTool(function(){ if(has()){ closeAll(); clearHover(); hoverEl=t; duplicateHovered(); } });
              return true;
            }
            if(name==='link'){
              runTool(function(){ if(has()){ clearHover(); openLinkWrap(t); } });
              return true;
            }
            if(name==='html'){
              runTool(function(){ if(has()){ clearHover(); openHtmlBox(t); } });
              return true;
            }
            if(name==='inspect'){
              runTool(function(){
                if(!has()) return;
                closeAll(); clearHover(); hideStyleBar();
                let x=100, y=100;
                try{ const r=t.getBoundingClientRect(); x=r.left; y=r.bottom+8; }catch{}
                openInspector(t, x, y);
              });
              return true;
            }
            if(name==='moveUp' || name==='moveDown'){
              const dir=(name==='moveUp') ? -1 : 1;
              runTool(function(){ if(has()){ closeAll(); clearHover(); hoverEl=t; moveHovered(dir); } });
              return true;
            }
            return false;
          }catch{ return false; }
        };
        // ── v6: drag-and-drop rearrange (sidebar "Drag" toggle) ────────────────
        // Drag mode ON: grab an element and drop it above/below any other element
        // (depending on the parent axis) — the order/parent changes and saves to
        // the file via the (anchor ancestor) html commit. Ghost chip + teal drop-line indicator.
        let dragMode=false, dragSrc=null, dragActive=false, dragStart=null,
            dragGhost=null, dragLine=null, dragStyleEl=null,
            dragParent=null, dragRef=null, suppressClickUntil=0;
        function setDragCursor(on){
          try{
            if(on){
              if(!dragStyleEl){
                dragStyleEl=document.createElement('style');
                dragStyleEl.setAttribute('data-ibx-ui','1');
                dragStyleEl.textContent='html,body,body *{cursor:grab !important;}';
                (document.head||document.documentElement).appendChild(dragStyleEl);
              }
            } else if(dragStyleEl){ try{ dragStyleEl.remove(); }catch{} dragStyleEl=null; }
          }catch{}
        }
        function ensureDragUi(){
          try{
            if(!dragGhost){
              dragGhost=document.createElement('div');
              dragGhost.setAttribute('data-ibx-ui','1');
              dragGhost.style.cssText='position:fixed !important;z-index:2147483647 !important;pointer-events:none !important;background:#111111 !important;color:#4ec9b0 !important;font:11px/1.4 system-ui,sans-serif !important;padding:2px 8px !important;border-radius:4px !important;box-shadow:0 4px 14px rgba(0,0,0,0.4) !important;display:none !important;';
              document.body.appendChild(dragGhost);
            }
            if(!dragLine){
              dragLine=document.createElement('div');
              dragLine.setAttribute('data-ibx-ui','1');
              dragLine.style.cssText='position:fixed !important;z-index:2147483646 !important;background:#4ec9b0 !important;pointer-events:none !important;display:none !important;';
              document.body.appendChild(dragLine);
            }
          }catch{}
        }
        function removeDragUi(){
          try{ if(dragGhost){ dragGhost.remove(); dragGhost=null; } }catch{}
          try{ if(dragLine){ dragLine.remove(); dragLine=null; } }catch{}
        }
        function hideDragUi(){
          try{ if(dragGhost) dragGhost.style.display='none'; }catch{}
          try{ if(dragLine) dragLine.style.display='none'; }catch{}
        }
        function dragEndVisual(){
          try{ if(dragSrc){ dragSrc.classList.remove('__ibx-edit-hover'); stripEmptyClass(dragSrc); } }catch{}
          hideDragUi();
        }
        function dragSkipNode(n){
          try{
            if(!n || n.nodeType!==1) return true;
            const tg=String(n.tagName||'').toUpperCase();
            if(tg==='HTML'||tg==='HEAD'||tg==='BODY') return true;
            if(isUiNode(n)) return true;
            if(dragSrc && (n===dragSrc || dragSrc.contains(n))) return true;
          }catch{ return true; }
          return false;
        }
        // Determine the drop point's target/axis + show the drop line.
        // Axis: parent block/grid → vertical (above/below), flex-row/inline →
        // horizontal (before/after). Sibling insert = Cursor-like reorder.
        function dragUpdate(x, y){
          try{
            let T=null;
            try{ T=document.elementFromPoint(x, y); }catch{}
            if(T && T.nodeType===3) T=T.parentElement;
            if(!T || dragSkipNode(T) || !T.parentElement){ hideDragUi(); dragParent=null; dragRef=null; return; }
            const P=T.parentElement;
            if(dragSkipNode(P)){ hideDragUi(); dragParent=null; dragRef=null; return; }
            let axis='y';
            try{
              const cs=window.getComputedStyle(P);
              const d=String(cs.display||'');
              const fd=String(cs.flexDirection||'');
              if(d==='flex'||d==='inline-flex'){ axis=(fd.indexOf('row')!==-1 && fd.indexOf('column')===-1)?'x':'y'; }
              else if(d==='inline'||d==='inline-block'||d==='table'||d==='table-row-group'){ axis='x'; }
            }catch{}
            const r=T.getBoundingClientRect();
            const before=(axis==='x') ? (x < r.left+r.width/2) : (y < r.top+r.height/2);
            dragParent=P;
            dragRef=before ? T : T.nextElementSibling;
            ensureDragUi();
            try{
              if(axis==='y'){
                dragLine.style.left=r.left+'px';
                dragLine.style.width=Math.max(8, r.width)+'px';
                dragLine.style.height='2px';
                dragLine.style.top=((before ? r.top : r.bottom)-1)+'px';
              } else {
                dragLine.style.top=r.top+'px';
                dragLine.style.height=Math.max(8, r.height)+'px';
                dragLine.style.width='2px';
                dragLine.style.left=((before ? r.left : r.right)-1)+'px';
              }
              dragLine.style.display='block';
            }catch{}
          }catch{}
        }
        // Move commit: the anchor must contain BOTH the old and new locations (old parent
        // and new parent) — otherwise a cross-parent drop only removes the old spot
        // from the file and never adds the new one.
        function dragCommitMove(src, P, ref){
          try{
            if(!src || !document.contains(src) || !P || !document.contains(P)) return false;
            if(src===P || src.contains(P)) return false;
            const oldP=src.parentElement;
            if(!oldP) return false;
            if(ref===src) return true; // no-op drop
            if(!ref && oldP===P && !src.nextElementSibling) return true; // no-op drop
            let C=null;
            if(oldP===P){
              try{ C=pickCommitAnchor(src, 1.6); }catch{ C=null; }
              if(C && !(C===P || (C.contains && C.contains(src)))) C=null;
            }
            if(!C){
              let x=oldP, g=0;
              while(x && g++<12 && x!==document.documentElement){
                if(x===P || (x.contains && x.contains(P))){ C=x; break; }
                x=x.parentElement;
              }
            }
            if(!C) C=P;
            const hidden=detachUi(C);
            stripEditArtifacts(C);
            let oldHtml='';
            try{ oldHtml=String(C.outerHTML||''); }catch{}
            C.__ibxOrigHTML=oldHtml;
            let moved=false;
            try{ P.insertBefore(src, ref||null); moved=true; }catch{ moved=false; }
            let cur='';
            if(moved){ stripEditArtifacts(C); try{ cur=String(C.outerHTML||''); }catch{} }
            reattachUi(hidden);
            if(!moved || !oldHtml || !cur || oldHtml===cur || oldHtml.length>14000 || cur.length>14000){
              try{ restoreOriginal(C); }catch{}
              return false;
            }
            try{ capturePrevTitle(); }catch{}
            lastCommitEl=C;
            sendPayload({ mode:'html', oldHtml: oldHtml, newHtml: cur, tagName: String(C.tagName||''), url: location.href });
            return true;
          }catch{ return false; }
        }
        function onDragDown(e){
          try{
            if(!dragMode || !window.__ibxEditEnabled || e.button!==0) return;
            if(e.ctrlKey||e.metaKey||e.altKey) return;
            if(isUiNode(e.target)) return;
            // If a text edit is active, finish it first — otherwise the whole
            // drag session stalled on this check (drag felt "dead").
            if(activeEl){ try{ commitEdit(); }catch{} }
            if(activeEl){ try{ cleanupActive(false); }catch{} }
            if(activeEl) return;
            let t=e.target;
            if(t && t.nodeType===3) t=t.parentElement;
            if(!t || t.nodeType!==1) return;
            let hit=findEditableTarget(t);
            if(!hit){
              const tg=String(t.tagName||'').toUpperCase();
              if(tg==='HTML'||tg==='HEAD'||tg==='BODY') return;
              hit=t;
            }
            if(!hit || !hit.parentElement || isUiNode(hit)) return;
            dragSrc=hit;
            dragActive=false;
            dragStart={ x:e.clientX, y:e.clientY };
            dragParent=null; dragRef=null;
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
          }catch{}
        }
        function onDragMove(e){
          try{
            if(!dragSrc) return;
            if(!dragActive){
              if(!dragStart) return;
              if(Math.abs(e.clientX-dragStart.x)+Math.abs(e.clientY-dragStart.y)<6) return;
              dragActive=true;
              try{ clearHover(); }catch{}
              try{ hideStyleBar(); hideHint(); }catch{}
              ensureDragUi();
              try{
                dragSrc.classList.add('__ibx-edit-hover');
                dragGhost.textContent=String(dragSrc.tagName||'').toLowerCase()+(dragSrc.id?'#'+dragSrc.id:'');
                dragGhost.style.display='block';
              }catch{}
            }
            try{
              dragGhost.style.left=(e.clientX+14)+'px';
              dragGhost.style.top=(e.clientY+14)+'px';
            }catch{}
            dragUpdate(e.clientX, e.clientY);
          }catch{}
        }
        function onDragUp(){
          try{
            if(!dragSrc) return;
            const src=dragSrc, was=dragActive, P=dragParent, ref=dragRef;
            dragSrc=null; dragActive=false; dragStart=null; dragParent=null; dragRef=null;
            suppressClickUntil=Date.now()+350;
            dragEndVisual();
            if(!was) return; // no drag happened (simple press-release) — suppress the click too
            if(!P || !document.contains(src)) return;
            busy++;
            try{ dragCommitMove(src, P, ref); }
            finally { busy--; }
            try{ clearHover(); }catch{}
          }catch{}
        }
        function cancelDrag(){
          try{
            dragSrc=null; dragActive=false; dragStart=null; dragParent=null; dragRef=null;
            suppressClickUntil=Date.now()+350;
            dragEndVisual();
          }catch{}
        }
        window.__ibxSetDragMode=function(on){
          try{
            dragMode=!!on;
            if(dragMode){
              // An active text edit used to block (onDragDown stopped on activeEl)
              // — commit any pending edit as soon as drag is turned ON.
              try{ if(activeEl) commitEdit(); }catch{}
              try{ if(activeEl) cleanupActive(false); }catch{}
              setDragCursor(true);
            }
            else { cancelDrag(); setDragCursor(false); removeDragUi(); }
          }catch{}
          return dragMode;
        };
        // STYLE section: apply inline style by name (sidebar + state both) ──
        function applyStyle(el, name, val){
          try{
            if(name==='bold'){ el.style.fontWeight=(el.style.fontWeight==='bold'?'':'bold'); return true; }
            if(name==='italic'){ el.style.fontStyle=(el.style.fontStyle==='italic'?'':'italic'); return true; }
            if(name==='underline'){ toggleDeco(el,'underline'); return true; }
            if(name==='strike'){ toggleDeco(el,'line-through'); return true; }
            if(name==='size+' || name==='size-'){
              let s=16;
              try{ s=parseFloat(window.getComputedStyle(el).fontSize)||16; }catch{}
              const nx=(name==='size+') ? Math.min(72, s+2) : Math.max(8, s-2);
              el.style.fontSize=nx+'px';
              return true;
            }
            if(name==='color'){ if(val){ el.style.color=String(val); return true; } return false; }
            if(name==='bg'){ if(val){ el.style.backgroundColor=String(val); return true; } return false; }
            if(name==='align'){
              const aligns=['left','center','right','justify'];
              let cur='';
              try{ cur=normAlign(window.getComputedStyle(el).textAlign||'left'); }catch{}
              let i=aligns.indexOf(cur); if(i<0) i=0;
              el.style.textAlign=aligns[(i+1)%aligns.length];
              return true;
            }
            if(name==='tt'){
              const tts=['none','uppercase','lowercase','capitalize'];
              if(val != null){
                const v=String(val);
                if(tts.indexOf(v)!==-1){ el.style.textTransform=v; return true; }
                return false;
              }
              let cur='none';
              try{ cur=window.getComputedStyle(el).textTransform||'none'; }catch{}
              let i=tts.indexOf(cur); if(i<0) i=0;
              el.style.textTransform=tts[(i+1)%tts.length];
              return true;
            }
            // ── Visual controls (sliders/layout — from the host sidebar) ──
            const num=function(dflt,min,max){
              const v=parseFloat(val);
              if(!isFinite(v)) return dflt;
              return Math.min(max, Math.max(min,v));
            };
            if(name==='fs'){ el.style.fontSize=Math.round(num(16,6,240))+'px'; return true; }
            if(name==='fw'){ el.style.fontWeight=String(Math.round(num(400,100,900))); return true; }
            if(name==='lh'){ el.style.lineHeight=String(Math.round(num(1.2,0.3,5)*100)/100); return true; }
            if(name==='ls'){ el.style.letterSpacing=(Math.round(num(0,-10,40)*2)/2)+'px'; return true; }
            if(name==='ff'){ if(val){ el.style.fontFamily=String(val); return true; } return false; }
            if(name==='pad'){ el.style.padding=Math.round(num(0,0,160))+'px'; return true; }
            if(name==='mg'){ el.style.margin=Math.round(num(0,0,160))+'px'; return true; }
            if(name==='rad'){ el.style.borderRadius=Math.round(num(0,0,160))+'px'; return true; }
            if(name==='op'){ el.style.opacity=String(Math.round(num(100,0,100))/100); return true; }
            if(name==='gap'){ el.style.gap=Math.round(num(0,0,128))+'px'; return true; }
            if(name==='dir'){
              if(val==='off'){
                try{ el.style.removeProperty('display'); el.style.removeProperty('flex-direction'); }catch{}
                return true;
              }
              if(val==='row'||val==='col'){
                el.style.display='flex';
                el.style.flexDirection=(val==='col')?'column':'row';
                return true;
              }
              return false;
            }
            if(name==='jc'){
              if(val){ el.style.justifyContent=String(val); }
              else { try{ el.style.removeProperty('justify-content'); }catch{} }
              return true;
            }
            if(name==='ai'){
              if(val){ el.style.alignItems=String(val); }
              else { try{ el.style.removeProperty('align-items'); }catch{} }
              return true;
            }
            // ── Grid controls (sidebar Layout section) ──
            if(name==='grid'){
              if(String(el.style.display||'')==='grid'){ try{ el.style.removeProperty('display'); }catch{} }
              else { el.style.display='grid'; }
              return true;
            }
            if(name==='block'){ try{ el.style.removeProperty('display'); }catch{} return true; }
            if(name==='gcols' || name==='grows'){
              const prop=(name==='gcols') ? 'grid-template-columns' : 'grid-template-rows';
              const s=String(val==null?'':val).trim();
              if(!s){ try{ el.style.removeProperty(prop); }catch{} return true; }
              // A bare number becomes repeat(n, 1fr) — otherwise the user's raw value
              let v=s;
              if(/^[0-9]+$/.test(s)) v='repeat('+s+', 1fr)';
              try{ el.style.setProperty(prop, v); }catch{ return false; }
              return true;
            }
            if(name==='wrap'){
              if(!val || val==='off'){ try{ el.style.removeProperty('flex-wrap'); }catch{} return true; }
              el.style.flexWrap=(val==='wrap') ? 'wrap' : 'nowrap';
              return true;
            }
            // ── Per-side spacing / size / border / effects (Cursor inspector) ──
            const SIDES={ pt:'paddingTop', pr:'paddingRight', pb:'paddingBottom', pl:'paddingLeft',
                          mt:'marginTop', mr:'marginRight', mb:'marginBottom', ml:'marginLeft' };
            if(SIDES[name]){
              const v=Math.round(num(0,0,400));
              el.style[SIDES[name]]=v+'px';
              return true;
            }
            if(name==='w' || name==='h'){
              const prop=(name==='w')?'width':'height';
              const raw=String(val==null?'':val).trim();
              if(!raw){ try{ el.style.removeProperty(prop); }catch{} return true; }
              let v=parseFloat(raw);
              if(!isFinite(v)) return false;
              v=Math.max(0,Math.min(9999,v));
              el.style[prop]=(v===0 && raw==='0') ? '0px' : v+'px';
              return true;
            }
            if(name==='bw'){
              const v=Math.round(num(0,0,40));
              if(v<=0){
                try{ el.style.removeProperty('border-width'); el.style.removeProperty('border-style'); }catch{}
                return true;
              }
              el.style.borderStyle='solid';
              el.style.borderWidth=v+'px';
              return true;
            }
            if(name==='bc'){ if(val){ el.style.borderColor=String(val); return true; } return false; }
            if(name==='shadow'){
              if(!val || val==='off'){ try{ el.style.removeProperty('box-shadow'); }catch{} return true; }
              const shadows={
                sm:'0 1px 2px rgba(0,0,0,0.24)',
                md:'0 4px 12px rgba(0,0,0,0.32)',
                lg:'0 12px 32px rgba(0,0,0,0.42)'
              };
              const v=shadows[String(val)];
              if(!v) return false;
              el.style.boxShadow=v;
              return true;
            }
            if(name==='disp'){
              const dv=String(val==null?'':val);
              if(!dv || dv==='off'){ try{ el.style.removeProperty('display'); }catch{} return true; }
              const allowed=['block','flex','inline-flex','inline-block','grid','inline-grid','none','contents'];
              if(allowed.indexOf(dv)===-1) return false;
              el.style.display=dv;
              return true;
            }
            if(name==='ta'){
              if(val){ el.style.textAlign=String(val); return true; }
              return false;
            }
            // ── Cursor inspector: position / transform / box model ──
            if(name==='pos'){
              const p=String(val||'');
              const allowed=['static','relative','absolute','fixed','sticky'];
              if(!p || p==='static'){ try{ el.style.removeProperty('position'); }catch{} return true; }
              if(allowed.indexOf(p)===-1) return false;
              el.style.position=p;
              return true;
            }
            if(name==='x' || name==='y'){
              try{ if(String(window.getComputedStyle(el).position||'')==='static') el.style.position='relative'; }catch{}
              const prop=(name==='x')?'left':'top';
              const raw=String(val==null?'':val).trim();
              if(!raw){ try{ el.style.removeProperty(prop); }catch{} return true; }
              const v=parseFloat(raw);
              if(!isFinite(v)) return false;
              el.style[prop]=Math.round(v)+'px';
              return true;
            }
            if(name==='z'){
              const raw=String(val==null?'':val).trim();
              if(!raw){ try{ el.style.removeProperty('z-index'); }catch{} return true; }
              const v=parseInt(raw,10);
              if(!isFinite(v)) return false;
              el.style.zIndex=String(Math.round(v));
              return true;
            }
            if(name==='rot'){
              const v=Math.round(num(0,-360,360));
              if(v===0){ try{ el.style.removeProperty('rotate'); }catch{} return true; }
              try{ el.style.rotate=v+'deg'; }catch{ return false; }
              return true;
            }
            if(name==='clip'){
              const v=String(val||'');
              if(!v || v==='off' || v==='visible'){ try{ el.style.removeProperty('overflow'); }catch{} return true; }
              const allowed=['hidden','auto','scroll','clip'];
              if(allowed.indexOf(v)===-1) return false;
              el.style.overflow=v;
              return true;
            }
            if(name==='bbox'){
              const v=String(val||'');
              if(v!=='border-box' && v!=='content-box') return false;
              el.style.boxSizing=v;
              return true;
            }
            if(name==='rgap' || name==='cgap'){
              const prop=(name==='rgap')?'rowGap':'columnGap';
              el.style[prop]=Math.round(num(0,0,240))+'px';
              return true;
            }
            // Whole inline-style text (CSS tab).
            if(name==='css'){
              const s=String(val==null?'':val).slice(0,4000);
              try{
                if(!s.trim()) el.removeAttribute('style');
                else el.setAttribute('style', s);
              }catch{ return false; }
              return true;
            }
            if(name==='clear'){ try{ el.removeAttribute('style'); }catch{} return true; }
          }catch{}
          return false;
        }
        window.__ibxStyleAction=function(name, val){
          try{
            if(!window.__ibxEditEnabled) return false;
            let el=activeEl;
            let own=false;
            if(!el || !document.contains(el)){
              el=resolveStyleTarget();
              if(!el){ sendNotice('Point at an element in the page first'); return false; }
              // Don't refresh the snapshot while a style session is pending —
              // otherwise the needle (orig) drifts with every tick and the save fails.
              if(!el.__ibxStyleTimer) snapshot(el);
              own=true;
            }
            if(!applyStyle(el, name, val)) return false;
            el.__ibxDirtyHTML=true;
            if(own){
              try{ hideStyleBar(); }catch{}
              scheduleStyleCommit(el, 0);
            }
            return true;
          }catch{ return false; }
        };
        // Ancestor path (root → target) for the sidebar breadcrumb
        function selPath(el){
          const out=[];
          try{
            let x=el, g=0;
            while(x && x.nodeType===1 && g++<8 && x!==document.documentElement){
              if(x===document.body){ out.push({ t:'body' }); break; }
              let c='';
              try{
                c=(typeof x.className==='string' ? x.className : '').split(/\\s+/).filter(function(w){ return !!w && w.indexOf('__ibx-')!==0; }).slice(0,1).join(' ');
              }catch{}
              out.push({ t:String(x.tagName||'').toLowerCase(), x:String(x.id||'').slice(0,24), c:c });
              x=x.parentElement;
            }
          }catch{}
          return out.reverse();
        }
        // The host sidebar STYLE panel reads highlight/state from here (host poll).
        window.__ibxStyleState=function(){
          try{
            // Selection-driven (Cursor-like): active text edit → selected element →
            // tree selection. Hover alone never changes the inspector.
            let el=activeEl;
            if(!el || !document.contains(el)) el=selEl;
            if(!el || !document.contains(el)) el=treeSelEl;
            if(!el || !document.contains(el)) return { active:false, drag: dragMode };
            const is=window.getComputedStyle(el);
            const deco=String(el.style.textDecorationLine||'');
            let color='#000000', bg='';
            try{ color=rgbToHex(is.color||''); }catch{}
            try{
              const b=String(is.backgroundColor||'');
              if(b && b!=='rgba(0, 0, 0, 0)' && b!=='rgba(0,0,0,0)' && b!=='transparent') bg=rgbToHex(b);
            }catch{}
            // ── visual controls readback (numeric fields / selects) ──
            let fs=16, fw=400, lh=1.2, ls=0;
            try{ fs=Math.round(parseFloat(is.fontSize)||16); }catch{}
            try{ fw=parseInt(is.fontWeight,10)||400; }catch{}
            try{
              const lhv=parseFloat(is.lineHeight);
              lh = (isFinite(lhv) && lhv>0 && fs>0) ? Math.round((lhv/fs)*10)/10 : 1.2;
            }catch{}
            try{
              const lsv=parseFloat(is.letterSpacing);
              ls = isFinite(lsv) ? Math.round(lsv*2)/2 : 0;
            }catch{}
            let rad=0, op=100, gap=0;
            try{ rad=Math.round(parseFloat(String(is.borderRadius||'').split(' ')[0])||0); }catch{}
            try{ op=Math.round((parseFloat(is.opacity)||0)*100); if(op<0) op=0; if(op>100) op=100; }catch{}
            try{ gap=Math.round(parseFloat(el.style.gap||is.gap||'')||0); }catch{}
            // ── spacing (4 sides) ──
            const px=function(v){ const n=parseFloat(v); return isFinite(n)?Math.round(n):0; };
            let pt=0,pr=0,pb=0,pl=0,mt=0,mr=0,mb=0,ml=0;
            try{ pt=px(is.paddingTop); pr=px(is.paddingRight); pb=px(is.paddingBottom); pl=px(is.paddingLeft); }catch{}
            try{ mt=px(is.marginTop); mr=px(is.marginRight); mb=px(is.marginBottom); ml=px(is.marginLeft); }catch{}
            // ── size + border ──
            let w=0, h=0, bw=0, bc='';
            try{ const rr=el.getBoundingClientRect(); w=Math.round(rr.width); h=Math.round(rr.height); }catch{}
            try{ bw=px(is.borderTopWidth); }catch{}
            try{ if(bw>0) bc=rgbToHex(is.borderTopColor||''); }catch{}
            let jc=String(is.justifyContent||''); if(jc==='normal') jc='';
            let ai=String(is.alignItems||''); if(ai==='normal') ai='';
            let gcols='', grows='', wrap='';
            try{ gcols=String(el.style.gridTemplateColumns||''); }catch{}
            try{ grows=String(el.style.gridTemplateRows||''); }catch{}
            try{ wrap=String(is.flexWrap||''); if(wrap==='normal') wrap=''; }catch{}
            const disp=String(is.display||'');
            const layout=(disp==='flex'||disp==='inline-flex') ? 'flex' : (disp==='grid'||disp==='inline-grid' ? 'grid' : 'block');
            // ── Cursor inspector: position / box model / inline CSS ──
            let pos='static', x=0, y=0, z=0, rot=0, clip='visible', bbox='content-box', rgap=0, cgap=0, cssText='';
            try{ pos=String(is.position||'static'); }catch{}
            try{ x=Math.round(parseFloat(is.left)||0); y=Math.round(parseFloat(is.top)||0); }catch{}
            try{ const zv=parseInt(is.zIndex,10); z=isFinite(zv)?zv:0; }catch{}
            try{ const rv=parseFloat(String(is.rotate||'0deg')); rot=isFinite(rv)?Math.round(rv):0; }catch{}
            try{ clip=String(is.overflow||'visible'); }catch{}
            try{ bbox=String(is.boxSizing||'content-box'); }catch{}
            try{ rgap=Math.round(parseFloat(is.rowGap)||0); }catch{}
            try{ cgap=Math.round(parseFloat(is.columnGap)||0); }catch{}
            try{ cssText=String(el.getAttribute('style')||''); }catch{}
            return {
              active: true,
              sel: true,
              drag: dragMode,
              tag: String(el.tagName||'').toLowerCase(),
              label: domLabel(el),
              path: selPath(el),
              text: String(el.textContent||'').trim().slice(0,60),
              bold: String(el.style.fontWeight||'')==='bold',
              italic: String(el.style.fontStyle||'')==='italic',
              underline: deco.split(' ').indexOf('underline')!==-1,
              strike: deco.split(' ').indexOf('line-through')!==-1,
              color: color,
              bg: bg,
              align: normAlign(el.style.textAlign||is.textAlign||'left'),
              tt: String(el.style.textTransform||is.textTransform||'none'),
              size: Math.round(parseFloat(is.fontSize)||16),
              fs: fs, fw: fw, lh: lh, ls: ls,
              ff: String(is.fontFamily||''),
              pt: pt, pr: pr, pb: pb, pl: pl,
              mt: mt, mr: mr, mb: mb, ml: ml,
              pad: pt, mg: mt,
              w: w, h: h, bw: bw, bc: bc,
              rad: rad, op: op, gap: gap,
              shadow: String(is.boxShadow||'none')!=='none',
              disp: disp, layout: layout,
              dir: String(is.flexDirection||''),
              jc: jc, ai: ai,
              gcols: gcols, grows: grows, wrap: wrap,
              pos: pos, x: x, y: y, z: z, rot: rot,
              clip: clip, bbox: bbox, rgap: rgap, cgap: cgap,
              cssText: cssText
            };
          }catch{ return { active:false, drag: dragMode }; }
        };
        // ── Hover locate hint (file guess badge) ───────────────────────
        function queueLocate(el){
          try{
            clearTimeout(locateTimer);
            let txt='';
            try{ txt=String(el.innerText||'').trim().slice(0,200); }catch{}
            if(!txt) return;
            let outer='';
            try{
              const c=el.cloneNode(true);
              stripEditArtifacts(c);
              outer=String(c.outerHTML||'').slice(0,300);
            }catch{}
            const tag=String(el.tagName||'');
            const id=++locateSeq;
            lastLocateEl=el;
            locateTimer=setTimeout(function(){
              if(hoverEl!==el && activeEl!==el) return;
              try{
                const lt="__IBX_LOCATE64__"+id+" "+b64encode(JSON.stringify({ t: txt, h: outer, tag: tag }));
                document.title=lt;
                setTimeout(function(){ try{ if(String(document.title)===lt && String(prevTitle).indexOf("__IBX_")!==0) document.title=prevTitle; }catch{} }, 900);
              }catch{}
            }, 350);
          }catch{}
        }
        window.__ibxHintResult=function(id, label){
          try{
            if(id!==locateSeq) return false;
            hideHint();
            const el=lastLocateEl;
            if(!el || !label) return true;
            try{ if(!document.contains(el)) return true; }catch{ return true; }
            try{
              const r=el.getBoundingClientRect();
              const b=document.createElement('div');
              b.setAttribute('data-ibx-ui','1');
              b.className='__ibx-hint';
              b.textContent=(selChain(el) + (label ? '  ·  ' + String(label) : '')).slice(0,100);
              b.style.left=Math.max(4, Math.min((vw())-180, r.left))+'px';
              b.style.top=Math.max(4, r.top-20)+'px';
              document.body.appendChild(b);
              hintBadge=b;
            }catch{}
            return true;
          }catch{ return false; }
        };
        // ── v7: DOM tree panel (sidebar) + properties panel ──────────────────
        // Tree ids: stable via WeakMap (page lifetime); the Map only holds the latest
        // snapshot's elements (stale id → miss → host refreshes).
        let treeSeq=0;
        const treeWeak=(typeof WeakMap!=='undefined') ? new WeakMap() : null;
        let treeMap=new Map();
        function treeIdOf(el){
          try{
            if(!treeWeak) return 0;
            let id=treeWeak.get(el);
            if(!id){ id=++treeSeq; treeWeak.set(el, id); }
            return id;
          }catch{ return 0; }
        }
        function treeElOf(id){
          try{ return treeMap.get(Number(id)||0)||null; }catch{ return null; }
        }
        function treeSkipNode(n){
          try{
            if(!n || n.nodeType!==1) return true;
            if(isUiNode(n)) return true;
            const tg=String(n.tagName||'');
            if(['SCRIPT','STYLE','NOSCRIPT','META','LINK','TITLE','BASE','TEMPLATE'].indexOf(tg)!==-1) return true;
            return false;
          }catch{ return true; }
        }
        function treeVisible(el){
          try{
            const s=window.getComputedStyle(el);
            if(s.display==='none' || s.visibility==='hidden') return false;
            return true;
          }catch{ return true; }
        }
        // Target path (root→target) so the host can expand that row in the tree
        function treePathOf(el){
          const out=[];
          try{
            let x=el, g=0;
            while(x && g++<40){
              if(treeSkipNode(x)) { x=null; break; }
              out.push(treeIdOf(x));
              if(x===document.body || x===document.documentElement) break;
              x=x.parentElement;
            }
          }catch{}
          return out.reverse();
        }
        function setTreeHi(el){
          try{
            if(treeHiEl && treeHiEl!==el){ try{ treeHiEl.classList.remove('__ibx-edit-hover'); stripEmptyClass(treeHiEl); }catch{} treeHiEl=null; }
            if(el && document.contains(el)){ treeHiEl=el; el.classList.add('__ibx-edit-hover'); }
          }catch{}
        }
        // Host poll: full (depth-limited) tree JSON — caps keep the sidebar responsive
        // even on huge pages.
        window.__ibxTreeState=function(){
          try{
            if(!window.__ibxEditEnabled) return { on:false, nodes:[] };
            treeMap=new Map();
            const MAX=900, MAXKIDS=80, MAXDEPTH=12;
            let count=0, trunc=false;
            function walk(el, depth){
              if(count>=MAX || depth>MAXDEPTH){ trunc=true; return null; }
              if(treeSkipNode(el)) return null;
              const id=treeIdOf(el);
              if(!id) return null;
              count++;
              treeMap.set(id, el);
              const node={ i:id, t:String(el.tagName||'').toLowerCase(), d:depth };
              try{ if(el.id) node.x=String(el.id).slice(0,40); }catch{}
              try{
                const cl=el.className;
                if(typeof cl==='string' && cl.trim()) node.c=cl.trim().split(/\\s+/).filter(function(w){ return !!w && w!=='__ibx-edit-hover' && w!=='__ibx-edit-active'; }).slice(0,3).join(' ').slice(0,60);
              }catch{}
              try{
                if(el.children && el.children.length<=2){
                  const tx=String(el.innerText||'').trim().split(/\\s+/).join(' ').slice(0,40);
                  if(tx) node.tx=tx;
                }
              }catch{}
              if(!treeVisible(el)) node.h=1;
              const kids=[];
              try{
                const ch=el.children;
                if(ch){
                  const lim=Math.min(ch.length, MAXKIDS);
                  for(let k=0;k<lim;k++){
                    const cn=walk(ch[k], depth+1);
                    if(cn) kids.push(cn);
                    if(count>=MAX){ trunc=true; break; }
                  }
                  if(ch.length>lim) trunc=true;
                }
              }catch{}
              if(kids.length) node.k=kids;
              return node;
            }
            const root=walk(document.body||document.documentElement, 0);
            // Current target (selection / tree select / hover) + its path
            let tgt=null;
            try{
              if(activeEl && document.contains(activeEl)) tgt=activeEl;
              else if(selEl && document.contains(selEl)) tgt=selEl;
              else if(treeSelEl && document.contains(treeSelEl)) tgt=treeSelEl;
              else if(hoverEl && document.contains(hoverEl)) tgt=hoverEl;
            }catch{}
            const tgtId=tgt ? treeIdOf(tgt) : 0;
            const tgtPath=tgt ? treePathOf(tgt) : [];
            return { on:true, nodes: root?[root]:[], tgt:tgtId, tgtPath:tgtPath, trunc:trunc };
          }catch(e){ return { on:false, nodes:[] }; }
        };
        window.__ibxTreeHover=function(id){
          try{
            if(!window.__ibxEditEnabled) return false;
            const el=treeElOf(id);
            setTreeHi(el);
            if(el){ try{ el.scrollIntoView({block:'nearest'}); }catch{} }
            return !!el;
          }catch{ return false; }
        };
        window.__ibxTreeSelect=function(id){
          try{
            if(!window.__ibxEditEnabled) return false;
            const el=treeElOf(id);
            if(!el) return false;
            try{ clearHover(); }catch{}
            selectElement(el);
            try{ el.scrollIntoView({block:'nearest'}); }catch{}
            return true;
          }catch{ return false; }
        };
        window.__ibxTreeClear=function(){
          try{ clearSelection(); treeSelEl=null; setTreeHi(null); }catch{}
          return true;
        };
        // Select an ancestor of the current selection (breadcrumb "up" navigation).
        window.__ibxSelectParent=function(levels){
          try{
            if(!window.__ibxEditEnabled) return false;
            let el=selEl || treeSelEl || activeEl;
            if(!el || !document.contains(el)) return false;
            let n=parseInt(levels,10); if(!isFinite(n)||n<1) n=1;
            while(n-->0 && el && el.parentElement && el!==document.body) el=el.parentElement;
            if(!el || el===document.documentElement) return false;
            if(el===document.body && selEl!==document.body){
              selectElement(document.body);
              return true;
            }
            selectElement(el);
            try{ el.scrollIntoView({block:'nearest'}); }catch{}
            return true;
          }catch{ return false; }
        };
        // Reorder by dragging from the tree — the same anchor-based HTML commit that
        // in-page drag (dragCommitMove) uses.
        window.__ibxTreeMove=function(srcId, refId, pos){
          try{
            if(!window.__ibxEditEnabled) return false;
            const src=treeElOf(srcId), ref=treeElOf(refId);
            if(!src || !ref || src===ref) return false;
            if(!document.contains(src) || !document.contains(ref)) return false;
            const ts=String(src.tagName||''), tr=String(ref.tagName||'');
            if(ts==='BODY'||ts==='HTML'||tr==='BODY'||tr==='HTML') return false;
            if(src.contains(ref)) return false;
            let P=null, r=null;
            if(pos==='inside'){ P=ref; r=null; }
            else { P=ref.parentElement; r=ref; }
            if(!P) return false;
            try{ setTreeHi(null); }catch{}
            busy++;
            try{ return !!dragCommitMove(src, P, r); }
            finally { busy--; }
          }catch{ return false; }
        };
        // ── Properties panel: attributes read/edit ──
        function resolvePropTarget(){
          try{
            if(activeEl && document.contains(activeEl)) return activeEl;
            if(selEl && document.contains(selEl)) return selEl;
            if(treeSelEl && document.contains(treeSelEl)) return treeSelEl;
            return null;
          }catch{ return null; }
        }
        window.__ibxPropState=function(){
          try{
            if(!window.__ibxEditEnabled) return { active:false };
            const el=resolvePropTarget();
            if(!el) return { active:false };
            const attrs=[];
            try{
              const named=el.attributes;
              for(let i=0; named && i<named.length; i++){
                const a=named[i];
                if(!a || a.name==='style' || a.name==='contenteditable' || a.name==='spellcheck') continue;
                attrs.push({ n:String(a.name), v:String(a.value||'').slice(0,300) });
              }
            }catch{}
            let cls='';
            try{ cls=(typeof el.className==='string') ? el.className : ''; }catch{}
            try{
              cls=cls.split('__ibx-edit-hover').join(' ').split('__ibx-edit-active').join(' ');
              cls=cls.split(' ').filter(function(w){ return !!w; }).join(' ');
            }catch{}
            let txt='';
            try{ txt=String(el.innerText||'').trim().split(/\\s+/).join(' ').slice(0,160); }catch{}
            let outer='';
            try{
              const c=el.cloneNode(true);
              stripEditArtifacts(c);
              outer=String(c.outerHTML||'').slice(0,300);
            }catch{}
            return {
              active:true,
              tag:String(el.tagName||'').toLowerCase(),
              id:String(el.id||''),
              cls:cls, attrs:attrs, text:txt, outer:outer,
              kids: el.children ? el.children.length : 0
            };
          }catch(e){ return { active:false }; }
        };
        window.__ibxPropSet=function(name, val){
          try{
            if(!window.__ibxEditEnabled) return false;
            const n=String(name==null?'':name).trim();
            if(!n || !/^[a-zA-Z][a-zA-Z0-9:._-]*$/.test(n)) return false;
            const el=resolvePropTarget();
            if(!el){ sendNotice('Point at an element in the page first'); return false; }
            const v=String(val==null?'':val);
            let cur=null;
            try{ cur=el.getAttribute(n); }catch{}
            if(String(cur==null?'':cur)===v) return true;
            let own=false;
            if(!(activeEl===el)){
              if(!el.__ibxStyleTimer) snapshot(el);
              own=true;
            }
            try{
              if(v==='') el.removeAttribute(n);
              else el.setAttribute(n, v);
            }catch{ return false; }
            el.__ibxDirtyHTML=true;
            if(own){ try{ hideStyleBar(); }catch{} scheduleStyleCommit(el, 0); }
            return true;
          }catch{ return false; }
        };
        window.__ibxSetEditMode = function(enabled){
          window.__ibxEditEnabled = !!enabled;
          if(window.__ibxEditEnabled){
            ensureStyle();
            try{ document.addEventListener('mouseover', onMouseOver, true); }catch{}
            try{ document.addEventListener('mouseout', onMouseOut, true); }catch{}
            try{ document.addEventListener('click', onClick, true); }catch{}
            try{ document.addEventListener('dblclick', onDblClick, true); }catch{}
            try{ document.addEventListener('keydown', onDocKey, true); }catch{}
            // v6: drag-and-drop rearrange (sidebar Drag toggle)
            try{ document.addEventListener('mousedown', onDragDown, true); }catch{}
            try{ document.addEventListener('mousemove', onDragMove, true); }catch{}
            try{ document.addEventListener('mouseup', onDragUp, true); }catch{}
            // Selection toolbar tracks scroll/resize
            try{ window.addEventListener('scroll', onViewportChange, true); }catch{}
            try{ window.addEventListener('resize', onViewportChange); }catch{}
            // NOTE: don't set the cursor inline style here — body.outerHTML should
            // match the file (body anchor commits). It lives in the CSS sheet.
            try{ window.addEventListener('pagehide', onPageHide); }catch{}
            try{ capturePrevTitle(); }catch{}
          } else {
            try{ document.removeEventListener('mouseover', onMouseOver, true); }catch{}
            try{ document.removeEventListener('mouseout', onMouseOut, true); }catch{}
            try{ document.removeEventListener('click', onClick, true); }catch{}
            try{ document.removeEventListener('dblclick', onDblClick, true); }catch{}
            try{ document.removeEventListener('keydown', onDocKey, true); }catch{}
            try{ document.removeEventListener('mousedown', onDragDown, true); }catch{}
            try{ document.removeEventListener('mousemove', onDragMove, true); }catch{}
            try{ document.removeEventListener('mouseup', onDragUp, true); }catch{}
            try{ window.removeEventListener('scroll', onViewportChange, true); }catch{}
            try{ window.removeEventListener('resize', onViewportChange); }catch{}
            try{ window.removeEventListener('pagehide', onPageHide); }catch{}
            try{ window.__ibxSetDragMode && window.__ibxSetDragMode(false); }catch{}
            // Host already commits via __ibxCommitPendingEdit before disabling.
            // Any leftover active edit here is stale — restore to avoid broken UI.
            try{ if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); restoreOriginal(el); } }catch{}
            try{ closeAttrPopup(); }catch{}
            try{ closeInspect(); }catch{}
            try{ closeLinkPopup(); }catch{}
            try{ closeHtmlPopup(); }catch{}
            try{ hideStyleBar(); }catch{}
            try{ clearSelection(); }catch{}
            try{ treeSelEl=null; setTreeHi(null); }catch{}
            clearHover();
            removeStyle();
          }
          return true;
        };
        if(window.__ibxPendingEditMode) window.__ibxSetEditMode(true);
        return true;
      } catch(e){ return false; }
   })()`;
