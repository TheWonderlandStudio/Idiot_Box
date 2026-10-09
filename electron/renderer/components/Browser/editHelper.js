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
        // v4: Ctrl+E fallback ke liye last mouse point
        let lastPt = null;
        // v3: delete/duplicate/wrap-link, inspector, style-bar extras
        let inspectPopup = null;
        let linkPopup = null;
        let lastCommitEl = null;
        // v4: raw HTML editor popup
        let htmlPopup = null;
        // v5: sidebar-style ka pending (debounced) commit target
        let styleCommitEl = null;
        // Mutation ke dauran real mouse re-hover hover-class wapas na laga de
        // (warna anchor snapshot me artifact aake file-match toot jata hai).
        let busy = 0;
        // classList.remove ke baad class="" bach jata hai (element pehle
        // classless tha) — ye attribute file me NAHI hota, ancestor commit ke
        // oldHtml ko kharab karta hai. Khaali ho to attribute hi hatao.
        function stripEmptyClass(el){
          try{
            if(el && el.removeAttribute && String(el.className||'').trim()==='') el.removeAttribute('class');
          }catch{}
        }
        // Edit sidebar ke peeche popup na chhupo — host viewport me se sidebar
        // ki width ghata kar deta hai (window.__ibxSidebarW, px).
        function vw(){
          let w=window.innerWidth||800;
          try{ const s=Number(window.__ibxSidebarW)||0; if(s>0) w=Math.max(240, w-s); }catch{}
          return w;
        }
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
            .__ibx-stylebar { position: fixed !important; z-index: 2147483647 !important; background: #111111 !important; border-radius: 6px !important; padding: 3px 5px !important; display: flex !important; gap: 3px !important; align-items: center !important; box-shadow: 0 4px 14px rgba(0,0,0,0.4) !important; flex-wrap: nowrap !important; white-space: nowrap !important; max-width: none !important; }
            body { cursor: text !important; }
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
        function onMouseOver(e){
          if(!window.__ibxEditEnabled || activeEl || busy) return;
          if(isUiNode(e.target)) return;
          try{ lastPt={ x:e.clientX, y:e.clientY }; }catch{}
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
          // HAMESHA refresh: har save ke baad file DOM barabar ho jati hai
          // (fail par host revert karta hai), isliye "pehle wala orig"
          // stale ho jata tha — agla commit us purane needle se fail hota tha.
          try{
            let h=String(el.outerHTML||'');
            // spellcheck=false sirf edit-time lagta hai; purane cycle se node
            // par chipak jaye to orig/file-needle me NA aaye — warna html save
            // "Element not found in project" se fail hoke revert hota tha.
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
        // pre/code: innerText whitespace collapse karta hai — textContent lo.
        // contenteditable consecutive spaces ko nbsp char banata hai — use
        // regular space me badlo (source file me nbsp nahi chahiye).
        // NOTE: fromCharCode use kiya hai taaki regex/backslash-escapes se
        // bacha ja sake (outer template literal backslash kha jata hai).
        const NBSP=String.fromCharCode(160);
        function readElText(el){
          try{
            const raw=String(el.textContent||el.innerText||'');
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
          try{ el.classList.remove('__ibx-edit-active'); stripEmptyClass(el); }catch{}
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
          try{ capturePrevTitle(); }catch{}
          lastCommitEl=el;
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
              el.removeAttribute('spellcheck');
              el.classList.remove('__ibx-edit-active');
              stripEmptyClass(el);
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
            el.removeAttribute('spellcheck');
            el.classList.remove('__ibx-edit-active');
            stripEmptyClass(el);
            el.style.outline='';
          }catch{}
          hideStyleBar();
          activeEl=null; committing=false;
          clearHover();
          try{ capturePrevTitle(); }catch{}
          lastCommitEl=el;
          sendPayload(payload);
        }
        window.__ibxCommitPendingEdit = function(){
          try{
            // Sidebar-style ka pending commit abhi chala do (Done = sab save).
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
            // activeEl ke alawa last bheja gaya commit bhi revert karo —
            // html commits activeEl null karke bhejte hain, warna host ka
            // revert khaali jaata tha (failed save par DOM reformed rehta tha).
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
          lastCommitEl=null;
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
          const mod=(e.ctrlKey||e.metaKey);
          if(e.key!=='Tab'){
            // ── v4 shortcuts (hovered element par; hover outline = target) ──
            if(mod && !e.shiftKey && (e.key==='e'||e.key==='E')){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              let t=hoverEl;
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
              moveHovered(e.key==='ArrowUp' ? -1 : 1);
              return;
            }
            // ── v3 shortcuts (hovered element par; hover outline = target) ──
            if(e.key==='Delete' && !mod && hoverEl){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              deleteHovered();
              return;
            }
            if(mod && (e.key==='d'||e.key==='D') && hoverEl){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              duplicateHovered();
              return;
            }
            if(mod && (e.key==='k'||e.key==='K') && hoverEl){
              e.preventDefault(); e.stopPropagation();
              try{ if(typeof e.stopImmediatePropagation==='function') e.stopImmediatePropagation(); }catch{}
              openLinkWrap(hoverEl);
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
        function onPageHide(){ try{ if(activeEl){ const el=activeEl; activeEl=null; committing=false; detachActiveListeners(el); } }catch{} try{ clearHover(); }catch{} try{ closeAttrPopup(); }catch{} try{ hideStyleBar(); }catch{} try{ hideHint(); }catch{} try{ closeInspect(); }catch{} try{ closeLinkPopup(); }catch{} try{ closeHtmlPopup(); }catch{} }
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
        // ── Quick styles toolbar (active text element par) ─────────────
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
        // computed textAlign 'start'/'end' de sakta hai — cycle/display me
        // logical keywords ko physical me badlo warna cycle atak jati hai.
        function normAlign(v){
          const s=String(v||'left');
          if(s==='start' || s==='match-parent') return 'left';
          if(s==='end') return 'right';
          return s;
        }
        // Sidebar se apply kiya gaya style (jab target edit-me NA ho) ek baar
        // debounced commit hota hai — color-drag par har tick ka file-save nahi.
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
                // Doosra element edit ho raha hai — thodi der baad phir koshish.
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
          // v4: underline / strikethrough toggles (sidebar STYLE section bhi yahi use karti hai)
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
            // NOTE: ye template-literal ke andar hai — regex backslash DOUBLE likho
            // (single \s outer literal parse hote hi 's' ban jata hai).
            const m=String(c||'').match(/rgba?\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
            if(!m) return '#000000';
            const h=function(n){ n=Math.max(0, Math.min(255, parseInt(n,10)||0)); const s=n.toString(16); return s.length===1?'0'+s:s; };
            return '#'+h(m[1])+h(m[2])+h(m[3]);
          }catch{ return '#000000'; }
        }
        // ── v3: delete / duplicate / wrap-link + inspector ──────────────
        // Delete/duplicate/wrap me element khud mutate hota hai — persist
        // closest PARENT ke outerHTML old→new commit se hota hai (chhota
        // ancestor dhoondho jiska outerHTML size cap ke andar ho).
        function pickCommitAnchor(el, estRatio){
          let p=el ? el.parentElement : null;
          let g=0;
          while(p && g++<8){
            try{
              // HTML/HEAD kabhi mat lo — head me edit-sheet/title payload hote
              // hain jo file me nahi, aur body ke andar bhi data-ibx-ui popups
              // aa sakte hain (detachUi unhe hatata hai, body allowed hai).
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
        // Body-anchor commit me popups/stylebar/hint (data-ibx-ui) snapshot me
        // aa jate the — file ke saath needle match nahi hota tha. Serialize ke
        // waqt hatao, baad me wapas lagao.
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
          // restoreOriginal ne outerHTML replace kar diya — koi ui node bacha
          // ho to body me wapas daal do (fixed positioning hai, safe).
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
            let oldHtml='';
            try{ oldHtml=String(p.outerHTML||''); }catch{}
            if(!oldHtml){ reattachUi(hidden); return false; }
            p.__ibxOrigHTML=oldHtml;
            let mutated=false;
            try{ mutate(p); mutated=true; }catch{}
            let cur='';
            if(mutated){ try{ cur=String(p.outerHTML||''); }catch{} }
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
            // Pehle hover-class hatao — warna anchor (parent) ka outerHTML
            // file me maujood HTML se alag ho jata hai (save fail + revert).
            clearHover();
            const ok=commitViaAnchor(el, function(){ try{ el.remove(); }catch{} }, 1.0);
            // Anchor nahi mila (bohot bada page) to visual-only delete.
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
        // Pending text/style edit ho to pehle save karo (DOM file ke barabar ho
        // jaye) — warna HTML editor ka parent-needle save fail hoke revert karta.
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
        // ── v4: Ctrl+Z → host se last save revert + DOM wapas ────────────
        // NOTE: payload me nonce (n) zaroori — host 5s me same title string
        // dedupe karta hai, warna dobara Ctrl+Z dabane par undo swallow ho jata.
        let undoSeq=0;
        function requestUndo(){
          try{
            if(activeEl || committing) return false;
            sendPayload({ mode:'undo', n: ++undoSeq, at: Date.now(), url: location.href });
            return true;
          }catch{ return false; }
        }
        // Host ne file revert kar di — DOM ka last commit bhi wapas lao.
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
        // ── v5: sidebar APIs (host sidebar ke buttons yahan se chalte hain) ──
        function sendNotice(msg){
          try{ sendPayload({ mode:'notice', msg:String(msg||''), at: Date.now() }); }catch{}
        }
        // Sidebar par mouse page me nahi hota — last pointed element = target.
        function resolveTarget(needText){
          try{
            if(activeEl && document.contains(activeEl)) return activeEl;
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
        // Pending text/style edit ho to pehle save karo, phir tool chalao
        // (HTML tool ka openHtmlEditor bhi yahi karta hai).
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
        // STYLE section: name se inline style apply (sidebar + state dono) ──
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
              let cur='none';
              try{ cur=window.getComputedStyle(el).textTransform||'none'; }catch{}
              let i=tts.indexOf(cur); if(i<0) i=0;
              el.style.textTransform=tts[(i+1)%tts.length];
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
              el=resolveTarget(true);
              if(!el){ sendNotice('Click a text element first'); return false; }
              // Pending style-session chal raha ho to snapshot mat taazo —
              // warna needle (orig) har tick ke saath drift kar save fail karega.
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
        // Sidebar ka STYLE panel isi se highlight/state padhta hai (host poll).
        window.__ibxStyleState=function(){
          try{
            const el=activeEl;
            if(!el || !document.contains(el)) return { active:false };
            const is=window.getComputedStyle(el);
            const deco=String(el.style.textDecorationLine||'');
            let color='#000000', bg='';
            try{ color=rgbToHex(is.color||''); }catch{}
            try{
              const b=String(is.backgroundColor||'');
              if(b && b!=='rgba(0, 0, 0, 0)' && b!=='rgba(0,0,0,0)' && b!=='transparent') bg=rgbToHex(b);
            }catch{}
            return {
              active: true,
              tag: String(el.tagName||'').toLowerCase(),
              text: String(el.textContent||'').trim().slice(0,60),
              bold: String(el.style.fontWeight||'')==='bold',
              italic: String(el.style.fontStyle||'')==='italic',
              underline: deco.split(' ').indexOf('underline')!==-1,
              strike: deco.split(' ').indexOf('line-through')!==-1,
              color: color,
              bg: bg,
              align: normAlign(el.style.textAlign||is.textAlign||'left'),
              tt: String(el.style.textTransform||is.textTransform||'none'),
              size: Math.round(parseFloat(is.fontSize)||16)
            };
          }catch{ return { active:false }; }
        };
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
              b.textContent=String(label).slice(0,80);
              b.style.left=Math.max(4, Math.min((vw())-180, r.left))+'px';
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
            // NOTE: cursor inline style ME mat lagao — body.outerHTML file se
            // match karna chahiye (body anchor commits). CSS sheet me hai.
            try{ window.addEventListener('pagehide', onPageHide); }catch{}
            try{ capturePrevTitle(); }catch{}
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
            try{ closeInspect(); }catch{}
            try{ closeLinkPopup(); }catch{}
            try{ closeHtmlPopup(); }catch{}
            try{ hideStyleBar(); }catch{}
            clearHover();
            removeStyle();
          }
          return true;
        };
        if(window.__ibxPendingEditMode) window.__ibxSetEditMode(true);
        return true;
      } catch(e){ return false; }
   })()`;
