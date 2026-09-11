// editHelper.js — Live Edit guest script (runs INSIDE the webview page).
//
// Browser/index.jsx isko string ki tarah inject karta hai (executeJavaScript).
// Isliye ye file plain script hai: koi import/export-value nahi, sirf
// EDIT_HELPER_SOURCE string export hota hai. Andar backticks escaped (\`) rehte
// hain kyunki outer literal backtick-delimited hai — haath se edit karte waqt
// naya backtick hamesha escape karna (\`).
// BACKSLASH RULE: regex/string me single \s \d \n \. mat likho — outer literal
// parse hote hi backslash gir jata hai (guest ko toota regex milta hai).
// Hamesha DOUBLE backslash likho (\\s \\d \\n \\. \\\\ backslash ke liye).
//
// NOTE: ye CSS/DOM *bahar ki website* me chalta hai — app ke var(--tokens)
// resolve NAHI hote, isliye sab literals rakho.
//
// Test: node se import karke source lo, headless page me evaluate karo
// (window globals eval-context me share nahi hote — DOM-bridge se assert karo).
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
        function ensureStyle(){
          if (styleEl) return;
          styleEl = document.createElement('style');
          styleEl.id = '__ibx-edit-style';
          // NOTE: ye CSS *bahar ki website* me inject hota hai — wahan app ke
          // var(--tokens) resolve NAHI hote, isliye literals rakhe hain.
          // Values CENTRAL sheet ke barabar hain: --teal (#4ec9b0),
          // --teal-a08, --teal-a14. Token badle to yahan bhi badlo.
          styleEl.textContent = \`
            .__ibx-edit-hover { outline: 2px dashed #4ec9b0 !important; outline-offset: 2px !important; cursor: text !important; background: rgba(78,201,176,0.08) !important; }
            .__ibx-edit-active { outline: 2px solid #4ec9b0 !important; outline-offset: 2px !important; background: rgba(78,201,176,0.14) !important; }
            .__ibx-hint { position: fixed !important; z-index: 2147483647 !important; background: #111111 !important; color: #9cdcfe !important; font: 11px/1.5 system-ui, sans-serif !important; padding: 2px 8px !important; border-radius: 4px !important; pointer-events: none !important; white-space: nowrap !important; max-width: 340px !important; overflow: hidden !important; text-overflow: ellipsis !important; }
            .__ibx-popup { position: fixed !important; z-index: 2147483647 !important; background: #ffffff !important; color: #111111 !important; font: 13px/1.5 system-ui, sans-serif !important; border: 1px solid #999999 !important; border-radius: 8px !important; box-shadow: 0 8px 28px rgba(0,0,0,0.35) !important; padding: 10px 12px !important; width: 290px !important; }
            .__ibx-popup label { display: block !important; font-weight: bold !important; font-size: 11px !important; color: #555555 !important; margin: 6px 0 1px !important; }
            .__ibx-popup input { width: 100% !important; box-sizing: border-box !important; padding: 4px 6px !important; border: 1px solid #bbbbbb !important; border-radius: 4px !important; font: inherit !important; color: #111111 !important; background: #ffffff !important; }
            .__ibx-popup button { font: inherit !important; padding: 3px 12px !important; margin: 8px 6px 0 0 !important; border-radius: 4px !important; border: 1px solid #999999 !important; background: #f0f0f0 !important; color: #111111 !important; cursor: pointer !important; }
            .__ibx-popup button.__ibx-primary { background: #4ec9b0 !important; border-color: #4ec9b0 !important; color: #06281f !important; font-weight: bold !important; }
            .__ibx-stylebar { position: fixed !important; z-index: 2147483647 !important; background: #111111 !important; border-radius: 6px !important; padding: 3px 5px !important; display: flex !important; gap: 3px !important; align-items: center !important; box-shadow: 0 4px 14px rgba(0,0,0,0.4) !important; }
            .__ibx-stylebar button { background: transparent !important; color: #eeeeee !important; border: 1px solid transparent !important; border-radius: 4px !important; font: 12px/1.5 system-ui, sans-serif !important; padding: 2px 7px !important; cursor: pointer !important; min-width: 24px !important; }
            .__ibx-stylebar button:hover { background: #333333 !important; }
            .__ibx-stylebar input[type=color] { width: 26px !important; height: 20px !important; border: none !important; background: none !important; padding: 0 !important; cursor: pointer !important; }
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
        function clearHover(){ try{ if(hoverEl) hoverEl.classList.remove('__ibx-edit-hover'); }catch{} hoverEl=null; hideHint(); }
        function isUiNode(n){ try{ return !!(n && n.closest && n.closest('[data-ibx-ui]')); }catch{ return false; } }
        function onMouseOver(e){
          if(!window.__ibxEditEnabled || activeEl) return;
          if(isUiNode(e.target)) return;
          let t=null; try{ t=findEditableTarget(e.target); }catch{}
          if(t===hoverEl) return;
          clearHover();
          if(t){ hoverEl=t; try{ hoverEl.classList.add('__ibx-edit-hover'); }catch{} queueLocate(t); }
        }
        function onMouseOut(e){
          if(!window.__ibxEditEnabled || activeEl) return;
          try{ const rel=e.relatedTarget; if(hoverEl && rel && hoverEl.contains(rel)) return; }catch{}
          clearHover();
        }
        function snapshot(el){
          try{
            if(el.__ibxOrigHTML==null) el.__ibxOrigHTML=String(el.outerHTML||'');
            if(el.__ibxOldText==null) el.__ibxOldText=(el.innerText||'').trim();
            el.__ibxDirtyHTML=false;
          }catch{}
        }
        // pre/code: innerText whitespace collapse karta hai — textContent lo.
        // contenteditable consecutive spaces ko nbsp char banata hai — use
        // regular space me badlo (source file me nbsp nahi chahiye).
        // NOTE: fromCharCode use kiya hai taaki regex/backslash-escapes se
        // bacha ja sake (outer template literal backslash kha jata hai).
        const NBSP=String.fromCharCode(160);
        function readElText(el){
          try{
            let preLike=false;
            try{
              if(el.tagName==='PRE') preLike=true;
              else{ const cs=window.getComputedStyle(el); if(cs && String(cs.whiteSpace||'').indexOf('pre')===0) preLike=true; }
            }catch{}
            const raw=String(preLike ? (el.textContent||'') : (el.innerText||el.textContent||''));
            return raw.split(NBSP).join(' ').trim();
          }catch{ return ''; }
        }
        // document.title STRIPS + COLLAPSES whitespace (spec: strip-and-collapse),
        // isliye payload base64 me jata hai — warna "a  b"/tabs/newlines mangal
        // ho jate hain. Host __IBX_EDIT__B64__ / __IBX_LOCATE64__ samajhta hai.
        function b64encode(s){
          try{
            const bytes=new TextEncoder().encode(String(s==null?'':s));
            let bin='';
            for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
            return btoa(bin);
          }catch{ return ''; }
        }
        function sendPayload(payload){
          try{
            document.title="__IBX_EDIT__B64__"+b64encode(JSON.stringify(payload));
            setTimeout(function(){ try{ if(String(document.title).indexOf("__IBX_EDIT__B64__")===0) document.title=prevTitle; }catch{} }, 900);
          }catch{}
        }
        // Whole-element HTML commit (attributes / inline styles / styled text).
        function commitHtml(el){
          let oldHtml='';
          try{ oldHtml=String(el.__ibxOrigHTML||''); }catch{}
          try{ el.removeAttribute('contenteditable'); }catch{}
          try{ el.classList.remove('__ibx-edit-active'); }catch{}
          try{ el.style.outline=''; }catch{}
          hideStyleBar();
          let cur='';
          try{ cur=String(el.outerHTML||''); }catch{}
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
          try{ prevTitle=document.title; }catch{}
          sendPayload({ mode:'html', oldHtml: oldHtml, newHtml: cur, tagName: String(el.tagName||''), url: location.href });
        }
        function detachActiveListeners(el){
          try{ el.removeEventListener('keydown', onEditKey); }catch{}
          try{ el.removeEventListener('blur', onEditBlur); }catch{}
        }
        function restoreOriginal(el){
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
              el.classList.remove('__ibx-edit-active');
              el.style.outline='';
            }
          }catch{}
        }
        function commitEdit(){
          if(!activeEl || committing) return;
          committing=true;
          const el=activeEl;
          // Styles/attrs badle hon to poora element-block bhejo (html mode).
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
            el.classList.remove('__ibx-edit-active');
            el.style.outline='';
          }catch{}
          hideStyleBar();
          activeEl=null; committing=false;
          clearHover();
          try{ prevTitle=document.title; }catch{}
          sendPayload(payload);
        }
        window.__ibxCommitPendingEdit = function(){
          try{ if(activeEl && !committing) commitEdit(); return true; }catch(e){ return false; }
        };
        window.__ibxRevertActive = function(){
          try{
            if(!activeEl) return true;
            const el=activeEl; activeEl=null; committing=false;
            detachActiveListeners(el);
            restoreOriginal(el);
            clearHover();
            return true;
          }catch(e){ return false; }
        };
        window.__ibxCancelEdit = function(){
          try{
            if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); restoreOriginal(el); }
            clearHover();
            return true;
          }catch(e){ return false; }
        };
        window.__ibxIsEditing = function(){ try{ return !!activeEl; }catch{ return false; } };
        // Tab while editing: commit + jump to next/prev editable (Shift+Tab).
        // Blur-commit bhi hota hai, par Tab par focus browser ki marzi se kahin
        // bhi jata — isliye khud commit karke agla activate karo.
        function commitAndJump(dir){
          // NOTE: activeEl khud contenteditable hone se collectEditables se
          // BAHAR rehta hai (isSkippedTag) — position document-order me nikalo.
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
          if(activeEl) return; // text edit me native keys rehne do
          try{ if(e.target && e.target.closest && e.target.closest('[data-ibx-ui]')) return; }catch{}
          try{
            const t=e.target;
            // Detached node (hataya gaya popup input) guard me na atke —
            // document me nahi hai to form-field samjho hi mat.
            if(t && document.contains(t) && (t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable)) return;
          }catch{}
          if(e.key!=='Tab') return;
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
          try{ if(e.target && e.target.closest && e.target.closest('[data-ibx-ui]')) return; }catch{}
          // Alt+click = attributes (img src, link href, ...). Text edit nahi.
          if(e.altKey){
            e.preventDefault(); e.stopPropagation();
            try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
            if(activeEl) cleanupActive(true);
            clearHover(); hideStyleBar();
            let at=null; try{ at=findAttrTarget(e.target); }catch{}
            if(at) openAttrPopup(at, e.clientX, e.clientY);
            return;
          }
          // Ctrl/Cmd+click on a link = follow it (navigate), edit mat karo.
          if(e.ctrlKey||e.metaKey){
            try{
              const a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
              if(a) return;
            }catch{}
          }
          const t=findEditableTarget(e.target);
          if(!t) return;
          if(activeEl && activeEl.contains(e.target)) return;
          e.preventDefault(); e.stopPropagation(); if(typeof e.stopImmediatePropagation==='function') try{e.stopImmediatePropagation();}catch{}
          activateEl(t);
        }
        function onPageHide(){ try{ if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); } }catch{} try{ clearHover(); }catch{} try{ closeAttrPopup(); }catch{} try{ hideStyleBar(); }catch{} try{ hideHint(); }catch{} }
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
            // Popup ke andar focus reh gaya to hatao — warna detached input par
            // focus atak jata hai aur baad me Tab-guard (form-field check) Tab
            // kha jata hai.
            if(attrPopup && attrPopup.box){
              try{ if(attrPopup.box.contains(document.activeElement)) document.activeElement.blur(); }catch{}
              attrPopup.box.remove();
            }
          }catch{}
          attrPopup=null;
        }
        function openAttrPopup(target, x, y){
          closeAttrPopup();
          hideHint();
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
          const bx=Math.max(4, Math.min((window.innerWidth||800)-300, (x||100)+8));
          const by=Math.max(4, Math.min((window.innerHeight||600)-200, (y||100)+10));
          box.style.left=bx+'px'; box.style.top=by+'px';
          document.body.appendChild(box);
          attrPopup={ box: box, el: target };
          const stop=function(e){ try{ e.stopPropagation(); }catch{} };
          try{ box.addEventListener('mousedown', stop, true); }catch{}
          try{ box.addEventListener('click', stop, true); }catch{}
          try{ box.addEventListener('keydown', stop, true); }catch{}
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
        // ── Quick styles toolbar (active text element par) ─────────────
        function hideStyleBar(){ try{ if(styleBar) styleBar.remove(); }catch{} styleBar=null; }
        function placeStyleBar(bar, el){
          try{
            const r=el.getBoundingClientRect();
            let top=r.top-36;
            if(top<4) top=r.bottom+6;
            const left=Math.max(4, Math.min((window.innerWidth||800)-260, r.left));
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
          // CRITICAL: mousedown par focus contenteditable me hi rakho.
          // Bina iske button/color click focus chura leta hai -> blur ->
          // onEditBlur 80ms me commitEdit chala deta hai (text premature save
          // ya no-change restore jo style wipe kar deta hai). Color picker to
          // modal hai — commit beech me chal jata aur style detached node par
          // lagta (invisible). mousedown preventDefault se focus hilta hi nahi;
          // click phir bhi fire hota hai. (Attr popup par ye mat lagana —
          // uske text inputs ko focus chahiye hota hai.)
          try{
            bar.addEventListener('mousedown', function(e){ try{ e.preventDefault(); }catch{} }, true);
          }catch{}
          styleBtn(bar, 'B', 'Bold', function(){ el.style.fontWeight=(el.style.fontWeight==='bold'?'':'bold'); el.__ibxDirtyHTML=true; });
          styleBtn(bar, 'I', 'Italic', function(){ el.style.fontStyle=(el.style.fontStyle==='italic'?'':'italic'); el.__ibxDirtyHTML=true; });
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
            try{ cur=window.getComputedStyle(el).textAlign||'left'; }catch{}
            const nx=aligns[(aligns.indexOf(cur)+1+aligns.length)%aligns.length]||'left';
            el.style.textAlign=nx; el.__ibxDirtyHTML=true;
            try{ ab.textContent=nx.charAt(0).toUpperCase(); }catch{}
          });
          styleBtn(bar, '✕', 'Clear inline styles', function(){ try{ el.removeAttribute('style'); }catch{} el.__ibxDirtyHTML=true; });
          placeStyleBar(bar, el);
          document.body.appendChild(bar);
          styleBar=bar;
        }
        function rgbToHex(c){
          try{
            // NOTE: ye template-literal ke andar hai — regex backslash DOUBLE likho
            // (single \s outer literal parse hote hi 's' ban jata hai).
            const m=String(c||'').match(/rgba?\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
            if(!m) return '#000000';
            const h=function(n){ n=Math.max(0, Math.min(255, parseInt(n,10)||0)); const s=n.toString(16); return s.length===1?'0'+s:s; };
            return '#'+h(m[1])+h(m[2])+h(m[3]);
          }catch{ return '#000000'; }
        }
        // ── Hover locate hint (file guess badge) ───────────────────────
        function hideHint(){ try{ if(hintBadge) hintBadge.remove(); }catch{} hintBadge=null; }
        function queueLocate(el){
          try{
            clearTimeout(locateTimer);
            let txt='';
            try{ txt=String(el.innerText||'').trim().slice(0,200); }catch{}
            if(!txt) return;
            let outer='';
            try{ outer=String(el.outerHTML||'').slice(0,300); }catch{}
            const tag=String(el.tagName||'');
            const id=++locateSeq;
            lastLocateEl=el;
            locateTimer=setTimeout(function(){
              if(hoverEl!==el && activeEl!==el) return;
              try{
                document.title="__IBX_LOCATE64__"+id+" "+b64encode(JSON.stringify({ t: txt, h: outer, tag: tag }));
                setTimeout(function(){ try{ if(String(document.title).indexOf("__IBX_LOCATE64__")===0) document.title=prevTitle; }catch{} }, 900);
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
              b.textContent=String(label).slice(0,80);
              b.style.left=Math.max(4, Math.min((window.innerWidth||800)-180, r.left))+'px';
              b.style.top=Math.max(4, r.top-22)+'px';
              document.body.appendChild(b);
              hintBadge=b;
            }catch{}
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
            try{ document.addEventListener('keydown', onDocKey, true); }catch{}
            try{ window.addEventListener('pagehide', onPageHide); }catch{}
            try{ if(document.body) document.body.style.cursor='text'; }catch{}
            try{ prevTitle=document.title; }catch{}
          } else {
            try{ document.removeEventListener('mouseover', onMouseOver, true); }catch{}
            try{ document.removeEventListener('mouseout', onMouseOut, true); }catch{}
            try{ document.removeEventListener('click', onClick, true); }catch{}
            try{ document.removeEventListener('keydown', onDocKey, true); }catch{}
            try{ window.removeEventListener('pagehide', onPageHide); }catch{}
            // Host already commits via __ibxCommitPendingEdit before disabling.
            // Any leftover active edit here is stale — restore to avoid broken UI.
            try{ if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); restoreOriginal(el); } }catch{}
            try{ closeAttrPopup(); }catch{}
            try{ hideStyleBar(); }catch{}
            clearHover();
            removeStyle();
            try{ if(document.body) document.body.style.cursor=''; }catch{}
          }
          return true;
        };
        if(window.__ibxPendingEditMode) window.__ibxSetEditMode(true);
        return true;
      } catch(e){ return false; }
   })()`;
