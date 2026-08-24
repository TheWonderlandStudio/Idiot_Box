import React, {
  useState, useEffect, useCallback, useMemo, useRef,
} from "react";
import VscodeIcon  from "../../shared/VscodeIcon.jsx";
import useSettings from "../../shared/useSettings.jsx";

// ── SVG icons ─────────────────────────────────────────────────────────────────
const IcoFolder  = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.086a1.5 1.5 0 0 1 1.06.44L7.56 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9Z"/></svg>);
const IcoFile    = () => (<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V5.5L9.5 0H4Zm5.5 1.5v3A1.5 1.5 0 0 0 11 6h3v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5Z"/></svg>);
const IcoEye     = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8ZM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8Z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/></svg>);
const IcoHidden  = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.36 2.64a.5.5 0 0 1 0 .707l-10 10a.5.5 0 0 1-.707-.707l10-10a.5.5 0 0 1 .707 0zm-.277 3.754A12.09 12.09 0 0 1 14.828 8c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-.746 0-1.444-.13-2.083-.354l1.05-1.05A2.5 2.5 0 0 0 9.904 8.967l1.18-1.18c.226-.241.444-.5.64-.78zM4.917 5.623l-1.17 1.17c-.226.242-.444.5-.64.78A12.09 12.09 0 0 0 1.172 8c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.746 0 1.444-.13 2.083-.354l.792.792A9.996 9.996 0 0 1 8 14C3 14 0 8 0 8s1.128-2.303 3.122-3.78l1.795 1.795zm1.479-1.015A8.534 8.534 0 0 1 8 4c5 0 8 4 8 4s-1.128 2.303-3.122 3.78L10.3 9.202A2.5 2.5 0 0 0 6.396 5.402l.707-.707z"/><path d="M8 5.5a2.53 2.53 0 0 1 .794.13l-1.552 1.552A.5.5 0 0 1 6.5 6.5v-.001a2.5 2.5 0 0 1 1.5-.999z"/></svg>);
const IcoPreview = () => (<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H2zm0 1h12a1 1 0 0 1 1 1v5.5l-3.78-3.78a.5.5 0 0 0-.68.02L6.5 10.5 4.28 8.28a.5.5 0 0 0-.56-.1L1 9.96V4a1 1 0 0 1 1-1zm11 9H3.62l3.2-3.2 2.2 2.2a.5.5 0 0 0 .71.05L12 9.96l1 1V12z"/></svg>);

const IconBtn = ({ title, active, onClick, children }) => (
  <button className={`pw-bar-btn${active ? " pw-bar-btn--active" : ""}`} title={title} onClick={onClick}>{children}</button>
);

const PREVIEW_CACHE = new Map();

const PreviewIcon = ({ entry, showPreview, size }) => {
  const [preview, setPreview] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!showPreview) { setPreview(null); return; }
    const cached = PREVIEW_CACHE.get(entry.path);
    if (cached) { setPreview(cached); return; }
    if (entry.isDir) return;
    window.electronAPI.getFilePreview(entry.path).then((r) => {
      if (!mounted.current) return;
      if (r) {
        if (PREVIEW_CACHE.size >= 200) {
          const firstKey = PREVIEW_CACHE.keys().next().value;
          PREVIEW_CACHE.delete(firstKey);
        }
        PREVIEW_CACHE.set(entry.path, r);
      }
      setPreview(r);
    });
    return () => { mounted.current = false; };
  }, [entry.path, showPreview, entry.isDir]);
  if (!showPreview || entry.isDir || !preview) return <VscodeIcon name={entry.name} isDir={entry.isDir} size={size} />;
  if (preview.type === "image" && preview.data) {
    return <img src={preview.data} width={size} height={size} alt="" style={{ objectFit: "contain", display: "block", borderRadius: 2 }} />;
  }
  if (preview.type === "video") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <rect x="1" y="3.5" width="14" height="9" rx="1.2" fill="#3a3a3a" stroke="#666" strokeWidth="0.8"/>
        <polygon points="5.5,5.5 5.5,10.5 10.5,8" fill="#999"/>
      </svg>
    );
  }
  return <VscodeIcon name={entry.name} isDir={entry.isDir} size={size} />;
};

// ── Inline rename input ───────────────────────────────────────────────────────
const RenameInput = ({ initialValue, onCommit, onCancel }) => {
  const [val, setVal] = useState(initialValue);
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    const v = val.trim();
    if (v && v !== initialValue) onCommit(v); else onCancel();
  };
  return (
    <input
      ref={ref}
      className="pw-rename-input"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter")  commit();
        if (e.key === "Escape") onCancel();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
};

// ── Toolbar bar ───────────────────────────────────────────────────────────────
const Bar = ({ rootPath, currentPath, onNavigate, query, onQuery, showFolders, onToggleFolders, showFiles, onToggleFiles, showHidden, onToggleHidden, showPreview, onTogglePreview, itemCount, selectedCount, onCrumbsDragOver, onCrumbsDragLeave, onCrumbsDrop }) => {
  const crumbs = [];
  if (rootPath && currentPath) {
    const rootName = rootPath.split(/[\\/]/).filter(Boolean).pop();
    const relative = currentPath.slice(rootPath.length).replace(/^[\\/]/, "");
    const segs = relative ? relative.split(/[\\/]/) : [];
    crumbs.push({ label: rootName, path: rootPath });
    let b = rootPath;
    for (const s of segs) { b = b + "/" + s; crumbs.push({ label: s, path: b }); }
  }
  const eyeLabel = selectedCount > 0 ? `${selectedCount} selected` : itemCount != null ? `${itemCount} items` : "";
  return (
    <div className="pw-bar">
      <div className="pw-bar__crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={c.path}>
            {i > 0 && <span className="pw-breadcrumb__sep">›</span>}
            <span className={`pw-breadcrumb__item${i === crumbs.length - 1 ? " pw-breadcrumb__item--active" : ""}`}
              onClick={() => i < crumbs.length - 1 && onNavigate(c.path)} title={c.path}
              onContextMenu={async (e) => { e.preventDefault(); e.stopPropagation(); const r = await window.electronAPI.showContextMenu("breadcrumb", [c.path]); if (!r) return; switch (r.action) { case "copyPath": navigator.clipboard.writeText(c.path); break; case "copyName": navigator.clipboard.writeText(c.label); break; case "openInTerminal": window.dispatchEvent(new CustomEvent("open-terminal", { detail: { dir: c.path } })); break; case "reveal": window.electronAPI.revealInExplorer(c.path); break; case "refresh": break; } }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; onCrumbsDragOver?.(c.path); }}
              onDragLeave={(e) => { e.stopPropagation(); onCrumbsDragLeave?.(c.path); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onCrumbsDrop?.(e, c.path); }}
            >{c.label}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="pw-bar__actions">
        <div className="pw-bar__search">
          <svg className="pw-bar__search-ico" width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398l3.85 3.85a1 1 0 0 0 1.415-1.415l-3.868-3.833zm-5.242 1.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>
          </svg>
          <input className="pw-bar__search-input" type="text" placeholder="Search" value={query}
            onChange={(e) => onQuery(e.target.value)} spellCheck={false}/>
          {query && <button className="pw-bar__search-clear" onClick={() => onQuery("")}>×</button>}
        </div>
        <div className="pw-bar__divider"/>
        <IconBtn title="Show folders" active={showFolders} onClick={onToggleFolders}><IcoFolder/></IconBtn>
        <IconBtn title="Show files"   active={showFiles}   onClick={onToggleFiles}><IcoFile/></IconBtn>
        <IconBtn title={`${showHidden ? "Hide" : "Show"} hidden files (Ctrl+H)`} active={showHidden} onClick={onToggleHidden}><IcoHidden/></IconBtn>
        <IconBtn title={`${showPreview ? "Disable" : "Enable"} preview`} active={showPreview} onClick={onTogglePreview}><IcoPreview/></IconBtn>
        <div className="pw-bar-count" title={eyeLabel}>
          <IcoEye/>
          {eyeLabel && <span className="pw-bar-count__label">{selectedCount > 0 ? selectedCount : itemCount}</span>}
        </div>
      </div>
    </div>
  );
};

// ── ContentArea ───────────────────────────────────────────────────────────────
const ContentArea = ({
  rootPath, currentPath, refreshToken,
  selectedItems, onSetSelectedItems,
  onNavigate, onItemsLoaded, itemCount,
  clipboard, onClipboardChange,
  invalidateCache,
  pushUndo, performUndo, performRedo,
  zoom, onZoom,
  showHidden, onToggleHidden,
  showFolders, onToggleFolders,
  showFiles, onToggleFiles,
  showPreview, onTogglePreview,
}) => {
  const [entries,     setEntries]     = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [query,       setQuery]       = useState("");
  // showFolders, showFiles, showPreview, showHidden — managed in ProjectWindow
  const [band,        setBand]        = useState(null);
  const [renamingPath, setRenamingPath] = useState(null);

  const gridRef    = useRef(null);
  const contentRef = useRef(null);
  const bandOrigin = useRef(null);
  const bandMoved  = useRef(false);
  const itemRefs   = useRef({});
  const anchorRef  = useRef(null);

  // Keep stable refs so keyboard handlers and drag never see stale closures
  const selectedItemsRef  = useRef(selectedItems);
  const clipboardRef      = useRef(clipboard);
  const currentPathRef    = useRef(currentPath);
  const rootPathRef       = useRef(rootPath);
  const visibleRef        = useRef([]);
  const pushUndoRef       = useRef(pushUndo);
  const performUndoRef    = useRef(performUndo);
  const performRedoRef    = useRef(performRedo);

  useEffect(() => { selectedItemsRef.current = selectedItems; }, [selectedItems]);
  useEffect(() => { clipboardRef.current     = clipboard; },     [clipboard]);
  useEffect(() => { currentPathRef.current   = currentPath; },   [currentPath]);
  useEffect(() => { rootPathRef.current      = rootPath; },      [rootPath]);
  useEffect(() => { pushUndoRef.current      = pushUndo; },      [pushUndo]);
  useEffect(() => { performUndoRef.current   = performUndo; },   [performUndo]);
  useEffect(() => { performRedoRef.current   = performRedo; },   [performRedo]);
  const onZoomRef = useRef(onZoom);
  useEffect(() => { onZoomRef.current = onZoom; }, [onZoom]);
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const [settings] = useSettings();
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // ── Zoom-based sizing ────────────────────────────────────────────────────
  const iconSize   = Math.round(zoom * 0.48);
  const isListView = zoom < 60;
  const itemW      = isListView ? 0 : Math.round(zoom * 0.76);
  const itemP      = isListView ? "2px 6px" : `${Math.round(zoom * 0.06)}px ${Math.round(zoom * 0.04)}px ${Math.round(zoom * 0.04)}px`;

  // ── Error alert helper ────────────────────────────────────────────────────
  const alertErr = useCallback(async (label, err) => {
    const msg = err?.message || String(err || "Unknown error");
    await window.electronAPI.showAlert(`${label}:\n${msg}`);
  }, []);

  // ── Load entries ─────────────────────────────────────────────────────────
  const loadEntries = useCallback(() => {
    const cp = currentPathRef.current;
    if (!cp) { setEntries([]); return Promise.resolve(); }
    setLoading(true);
    return window.electronAPI.readDirAll(cp)
      .then((data) => { setEntries(data); if (onItemsLoaded) onItemsLoaded(data.length); })
      .finally(() => setLoading(false));
  }, [onItemsLoaded]);

  useEffect(() => { loadEntries(); }, [currentPath]);
  useEffect(() => { if (refreshToken > 0) loadEntries(); }, [refreshToken]);
  useEffect(() => { setQuery(""); setRenamingPath(null); }, [currentPath]);

  const visible = useMemo(() => {
    let r = entries;
    if (!showFolders) r = r.filter((e) => !e.isDir);
    if (!showFiles)   r = r.filter((e) => e.isDir);
    if (!showHidden)  r = r.filter((e) => !e.name.startsWith("."));
    if (query.trim()) { const q = query.trim().toLowerCase(); r = r.filter((e) => e.name.toLowerCase().includes(q)); }
    return r;
  }, [entries, showFolders, showFiles, showHidden, query]);

  useEffect(() => { visibleRef.current = visible; }, [visible]);

  // ── Core action executor — uses refs so it's always stable ───────────────
  const execAction = useCallback(async (action, targetPaths, targetDir) => {
    const sel  = selectedItemsRef.current;
    const clip = clipboardRef.current;
    const cp   = currentPathRef.current;
    const dir  = targetDir ?? cp;

    switch (action) {
      // ── Open ────────────────────────────────────────────────────────────
      case "open": {
        for (const p of targetPaths) {
          const s = await window.electronAPI.stat(p);
          if (s.isDir) onNavigate(p); else await window.electronAPI.openFile(p, settingsRef.current.defaultEditor ?? "system");
        }
        return;
      }
      case "openInNewEditorTab": {
        for (const p of targetPaths) {
          window.dispatchEvent(new CustomEvent("open-file-in-new-editor-tab", { detail: { path: p } }));
        }
        return;
      }
      case "openWithSystem": {
        for (const p of targetPaths) await window.electronAPI.openFile(p, "system");
        return;
      }
      case "openInMediaViewer": {
        for (const p of targetPaths) window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: p } }));
        return;
      }
      case "openInBrowser": {
        for (const p of targetPaths) {
          const url = "ppoo-file://file/" + encodeURI(p.replace(/\\/g, "/")).replace(/#/g, "%23");
          window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url, config: { type: "browser", title: "Browser", url } } }));
        }
        return;
      }
      case "openInExternalBrowser": {
        for (const p of targetPaths) {
          // try external browser via OS default (shell.openPath)
          try { await window.electronAPI.openFile(p, "system"); }
          catch {
            // fallback to file:// url via shell
            const fileUrl = "file:///" + p.replace(/\\/g, "/");
            try { await window.electronAPI.openUrl(fileUrl); } catch {}
          }
        }
        return;
      }
      default: {
        if (action.startsWith("openWithEditor:")) {
          const editorId = action.slice("openWithEditor:".length);
          for (const p of targetPaths) await window.electronAPI.openFile(p, editorId);
          return;
        }
        break;
      }
      case "openInTerminal": {
        for (const p of targetPaths) {
          const s = await window.electronAPI.stat(p);
          const dir = s.isDir ? p : p.replace(/[\\/][^\\/]*$/, "");
          window.dispatchEvent(new CustomEvent("open-terminal", { detail: { dir } }));
        }
        return;
      }
      // ── Create ──────────────────────────────────────────────────────────
      case "newFolder": {
        try {
          const created = await window.electronAPI.newFolder(dir, "New Folder");
          if (created) {
            pushUndoRef.current?.({ type: "create", path: created, parentDir: dir, name: created.split(/[\\/]/).pop(), isDir: true });
            await loadEntries();
            setRenamingPath(created);
          }
        } catch (err) { await alertErr("Cannot create folder", err); }
        return;
      }
      case "newFile": {
        try {
          const created = await window.electronAPI.newFile(dir, "New File.txt");
          if (created) {
            pushUndoRef.current?.({ type: "create", path: created, parentDir: dir, name: created.split(/[\\/]/).pop(), isDir: false });
            await loadEntries();
            setRenamingPath(created);
          }
        } catch (err) { await alertErr("Cannot create file", err); }
        return;
      }
      // ── Rename — trigger inline UI ──────────────────────────────────────
      case "rename": {
        if (targetPaths.length === 1) setRenamingPath(targetPaths[0]);
        return;
      }
      // ── Delete (move to local .trash) ────────────────────────────────────
      case "delete": {
        const names = targetPaths.map((p) => p.replace(/.*[\\/]/, ""));
        const label = targetPaths.length === 1
          ? `Move "${names[0]}" to Trash?`
          : `Move ${targetPaths.length} items to Trash?`;
        const ok = await window.electronAPI.confirmDialog(label);
        if (!ok) return;
        const failed = [];
        const trashIds = [];
        const rp = rootPathRef.current;
        for (const p of targetPaths) {
          try {
            const result = await window.electronAPI.trashItem(p, rp);
            if (result?.trashId) trashIds.push({ from: p, trashId: result.trashId });
          } catch (err) { failed.push(p.split(/[\\/]/).pop()); }
        }
        if (failed.length) await alertErr("Delete failed for", new Error(failed.join(", ")));
        if (failed.length === targetPaths.length) return;
        pushUndoRef.current?.({ type: "delete", trashIds, parentDir: dir, rootPath: rp });
        onSetSelectedItems(new Set());
        invalidateCache(dir);
        await loadEntries();
        return;
      }
      // ── Permanent delete (Shift+Delete) ─────────────────────────────────
      case "permaDelete": {
        const pnames = targetPaths.map((p) => p.replace(/.*[\\/]/, ""));
        const plabel = targetPaths.length === 1
          ? `Permanently delete "${pnames[0]}"?`
          : `Permanently delete ${targetPaths.length} items?`;
        const pok = await window.electronAPI.confirmDialog(plabel);
        if (!pok) return;
        const pfailed = [];
        for (const p of targetPaths) {
          try { await window.electronAPI.deleteItem(p); }
          catch (err) { pfailed.push(p.split(/[\\/]/).pop()); }
        }
        if (pfailed.length) await alertErr("Permanent delete failed for", new Error(pfailed.join(", ")));
        if (pfailed.length === targetPaths.length) return;
        onSetSelectedItems(new Set());
        invalidateCache(dir);
        await loadEntries();
        return;
      }
      // ── Duplicate ────────────────────────────────────────────────────────
      case "duplicate": {
        const failedDup = [];
        for (const p of targetPaths) {
          try { await window.electronAPI.duplicate(p); }
          catch (err) { failedDup.push(p.split(/[\\/]/).pop()); }
        }
        if (failedDup.length) await alertErr("Cannot duplicate", new Error(failedDup.join(", ")));
        if (failedDup.length < targetPaths.length) invalidateCache(dir);
        if (failedDup.length < targetPaths.length) await loadEntries();
        return;
      }
      // ── Clipboard ────────────────────────────────────────────────────────
      case "copy":
        onClipboardChange({ paths: targetPaths, mode: "copy" });
        return;
      case "cut":
        onClipboardChange({ paths: targetPaths, mode: "cut" });
        return;
      case "paste": {
        if (!clip?.paths?.length) return;
        const sourceParents = new Set();
        const pairs = [];
        const failedPaste = [];
        for (const src of clip.paths) {
          if (clip.mode === "copy") {
            try { await window.electronAPI.copyItem(src, dir); }
            catch (err) { failedPaste.push(src.split(/[\\/]/).pop()); }
          } else {
            const srcParent = src.replace(/[\\/][^\\/]+$/, "") || src;
            sourceParents.add(srcParent);
            try {
              const dest = await window.electronAPI.moveItem(src, dir);
              if (dest) pairs.push({ from: src, to: dest });
            } catch (err) { failedPaste.push(src.split(/[\\/]/).pop()); }
          }
        }
        if (failedPaste.length) await alertErr("Cannot paste", new Error(failedPaste.join(", ")));
        if (clip.mode === "cut") {
          if (pairs.length) pushUndoRef.current?.({ type: "move", pairs });
          onClipboardChange(null);
        }
        for (const p of sourceParents) invalidateCache(p);
        if (pairs.length || failedPaste.length < clip.paths.length) { invalidateCache(dir); await loadEntries(); }
        return;
      }
      // ── Misc ─────────────────────────────────────────────────────────────
      case "reveal":
        if (targetPaths[0]) window.electronAPI.revealInExplorer(targetPaths[0]);
        else                window.electronAPI.revealInExplorer(dir);
        return;
      case "copyPath":
        navigator.clipboard.writeText(targetPaths.length ? targetPaths.join("\n") : dir);
        return;
      case "refresh":
        invalidateCache(dir);
        loadEntries();
        return;
      case "pinToSidebar": {
        const rp = rootPathRef.current;
        for (const p of targetPaths) {
          const s = await window.electronAPI.stat(p);
          if (s.isDir) {
            const relPath = p.length > rp.length ? p.slice(rp.length + 1) : p.replace(/.*[\\/]/, "");
            const existing = await window.electronAPI.readPinConfig(rp);
            if (!existing.includes(relPath)) {
              existing.push(relPath);
              await window.electronAPI.writePinConfig(rp, existing);
            }
          }
        }
        window.dispatchEvent(new CustomEvent("pin-changed"));
        return;
      }
    }
  }, [onNavigate, onSetSelectedItems, onClipboardChange, invalidateCache, loadEntries]);

  // ── Rename commit ─────────────────────────────────────────────────────────
  const handleRenameCommit = useCallback(async (oldPath, newName) => {
    setRenamingPath(null);
    if (!oldPath || !newName) return;
    const parentDir = oldPath.replace(/[\\/][^\\/]+$/, "") || oldPath;
    const oldName = oldPath.split(/[\\/]/).pop();
    try {
      const result = await window.electronAPI.rename(oldPath, newName);
      const newPath = result || parentDir + (parentDir.includes("\\") ? "\\" : "/") + newName;
      pushUndoRef.current?.({ type: "rename", oldPath, oldName, newPath, newName, parentDir });
      invalidateCache(parentDir);
      await loadEntries();
    } catch (err) {
      await alertErr("Rename failed", err);
      invalidateCache(parentDir);
    }
  }, [invalidateCache, alertErr, loadEntries]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    // Don't fire if rename input is active
    if (renamingPath) return;
    const sel = selectedItemsRef.current;
    const vis = visibleRef.current;
    const cp  = currentPathRef.current;
    const cli = clipboardRef.current;
    const paths = sel.size > 0 ? [...sel] : [];

    if (e.key === "F2") {
      e.preventDefault();
      if (paths.length === 1) setRenamingPath(paths[0]);
      return;
    }
    if (e.key === "Delete" && e.shiftKey) {
      e.preventDefault();
      if (paths.length) execAction("permaDelete", paths, cp);
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      if (paths.length) execAction("delete", paths, cp);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "c") {
      e.preventDefault();
      if (paths.length) execAction("copy", paths, cp);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "x") {
      e.preventDefault();
      if (paths.length) execAction("cut", paths, cp);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      e.preventDefault();
      execAction("paste", [], cp);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "d") {
      e.preventDefault();
      if (paths.length) execAction("duplicate", paths, cp);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "a") {
      e.preventDefault();
      onSetSelectedItems(new Set(vis.map((v) => v.path)));
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "h") {
      e.preventDefault();
      onToggleHidden();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      performUndoRef.current?.();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || ((e.shiftKey || e.metaKey) && e.key === "z"))) {
      e.preventDefault();
      performRedoRef.current?.();
      return;
    }
    if (e.key === "Enter" && paths.length) {
      e.preventDefault();
      execAction("open", paths, cp);
      return;
    }
    // Arrow navigation
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!vis.length) return;
      const allPaths = vis.map((v) => v.path);
      const last     = paths[paths.length - 1];
      const idx      = last ? allPaths.indexOf(last) : -1;
      let next       = idx;
      if (e.key === "ArrowRight" || e.key === "ArrowDown")  next = Math.min(idx + 1, allPaths.length - 1);
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")    next = Math.max(idx - 1, 0);
      if (e.shiftKey) {
        const anchor = anchorRef.current;
        const ai = anchor ? allPaths.indexOf(anchor) : idx;
        const [lo, hi] = ai < next ? [ai, next] : [next, ai];
        onSetSelectedItems(new Set(allPaths.slice(lo, hi + 1)));
      } else {
        anchorRef.current = allPaths[next];
        onSetSelectedItems(new Set([allPaths[next]]));
      }
    }
  }, [renamingPath, execAction, onSetSelectedItems, onToggleHidden]);

  // ── Ctrl+Scroll zoom ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const step = e.deltaY > 0 ? -10 : 10;
      const current = onZoomRef.current;
      if (current) current(Math.max(30, Math.min(300, zoomRef.current + step)));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // ── Selection ─────────────────────────────────────────────────────────────
  const handleItemClick = useCallback((e, entry) => {
    e.stopPropagation();
    if (renamingPath === entry.path) return; // clicking renaming item does nothing
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selectedItemsRef.current);
      next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path);
      onSetSelectedItems(next);
    } else if (e.shiftKey && anchorRef.current) {
      const vp = visibleRef.current.map((v) => v.path);
      const a  = vp.indexOf(anchorRef.current), b = vp.indexOf(entry.path);
      if (a !== -1 && b !== -1) { const [lo, hi] = a < b ? [a, b] : [b, a]; onSetSelectedItems(new Set(vp.slice(lo, hi + 1))); }
      else onSetSelectedItems(new Set([entry.path]));
    } else {
      anchorRef.current = entry.path;
      onSetSelectedItems(new Set([entry.path]));
      if (!entry.isDir) {
        window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: entry.path } }));
      }
    }
  }, [renamingPath, onSetSelectedItems]);

  const handleGridClick = useCallback((e) => {
    if (e.target === gridRef.current || e.target === contentRef.current) {
      onSetSelectedItems(new Set()); anchorRef.current = null; setRenamingPath(null);
    }
  }, [onSetSelectedItems]);

  // ── Rubber band ───────────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target !== gridRef.current && e.target !== contentRef.current) return;
    if (renamingPath) { setRenamingPath(null); return; }
    e.preventDefault();
    const rect = contentRef.current.getBoundingClientRect();
    const scrollTop = contentRef.current.scrollTop;
    bandOrigin.current = { x: e.clientX - rect.left, y: e.clientY - rect.top + scrollTop };
    if (!e.ctrlKey && !e.metaKey) { onSetSelectedItems(new Set()); anchorRef.current = null; }

    const origSel = new Set(selectedItemsRef.current);
    bandMoved.current = false;
    const onMove = (mv) => {
      if (!bandOrigin.current) return;
      bandMoved.current = true;
      const cx = mv.clientX - rect.left;
      const cy = mv.clientY - rect.top + contentRef.current.scrollTop;
      const ox = bandOrigin.current.x, oy = bandOrigin.current.y;
      const bx = Math.min(cx, ox), by = Math.min(cy, oy), bw = Math.abs(cx - ox), bh = Math.abs(cy - oy);
      setBand({ x: bx, y: by, w: bw, h: bh });
      const next = new Set(e.ctrlKey || e.metaKey ? origSel : []);
      visibleRef.current.forEach((entry) => {
        const el = itemRefs.current[entry.path]; if (!el) return;
        const er = el.getBoundingClientRect();
        const elx = er.left - rect.left, ely = er.top - rect.top + contentRef.current.scrollTop;
        if (bx < elx + er.width && bx + bw > elx && by < ely + er.height && by + bh > ely) next.add(entry.path);
      });
      onSetSelectedItems(next);
    };
    const onUp = () => {
      const moved = bandMoved.current;
      setBand(null); bandOrigin.current = null; bandMoved.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
      // If mouse actually moved (rubber band drag), suppress the upcoming click
      if (moved) {
        const handler = (ce) => { ce.stopPropagation(); document.removeEventListener("click", handler, true); };
        document.addEventListener("click", handler, true);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [renamingPath, onSetSelectedItems]);

  // ── Drag — read selection from ref so it's never stale ───────────────────

  const handleDragStart = useCallback((e, entry) => {
    if (renamingPath) { e.preventDefault(); return; }
    const sel    = selectedItemsRef.current;
    const toDrag = sel.size > 0 && sel.has(entry.path) ? [...sel] : [entry.path];
    window.__ibxDragPaths = toDrag;
    const uris = toDrag.map((p) => `file:///${p.replace(/\\/g, "/")}`).join("\n");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/ibx-paths", JSON.stringify(toDrag));
    e.dataTransfer.setData("text/uri-list", uris);
    e.dataTransfer.setData("text/plain", toDrag.join("\n"));
  }, [renamingPath]);

  // ── External file drop helper ────────────────────────────────────────────
  const getExternalPaths = useCallback((e) => {
    const dt = e.dataTransfer;
    if (!dt) return null;
    if (!dt.types?.includes("Files")) return null;
    const getPath = window.electronAPI.getPathForFile;
    if (!getPath) return null;
    const paths = [];
    const items = dt.items;
    if (items?.length) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") {
          try {
            const f = items[i].getAsFile();
            if (f) {
              const p = getPath(f);
              if (p) paths.push(p);
            }
          } catch {}
        }
      }
    }
    if (!paths.length) {
      const files = dt.files;
      if (files?.length) {
        for (let i = 0; i < files.length; i++) {
          try {
            const p = getPath(files[i]);
            if (p) paths.push(p);
          } catch {}
        }
      }
    }
    return paths.length ? paths : null;
  }, []);

  const copyExternalFiles = useCallback(async (externalPaths, targetDir) => {
    const failed = [];
    const copied = [];
    for (const src of externalPaths) {
      try {
        const dest = await window.electronAPI.copyItem(src, targetDir);
        if (dest) copied.push(dest);
      } catch (err) { failed.push(src.split(/[\\/]/).pop()); }
    }
    if (failed.length) await alertErr("Cannot import", new Error(failed.join(", ")));
    return copied;
  }, [alertErr]);

  const handleContentAreaDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types?.includes("Files") ? "copy" : "move";
  }, []);

  const handleContentAreaDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const cp = currentPathRef.current;
    if (!cp) return;
    const rp = rootPathRef.current;

    // Resolve paths: custom MIME → internal native drag → external files
    let paths;
    let isInternal = true;
    try { paths = JSON.parse(e.dataTransfer.getData("application/ppoo-paths")); } catch {}
    if (!paths?.length && window.__ppooDragPaths?.length) {
      paths = window.__ppooDragPaths;
      window.__ppooDragPaths = null;
    }
    if (!paths?.length) {
      const externalPaths = getExternalPaths(e);
      if (externalPaths) {
        paths = externalPaths;
        isInternal = false;
      }
    }
    if (!paths?.length) return;

    if (!isInternal) {
      const copied = await copyExternalFiles(paths, cp);
      if (copied.length) { invalidateCache(cp); await loadEntries(); }
      return;
    }
    const pairs = [];
    const sourceParents = new Set();
    for (const src of paths) {
      if (src === cp) continue;
      const parentDir = src.replace(/[\\/][^\\/]+$/, "") || src;
      sourceParents.add(parentDir);
      try {
        const dest = await window.electronAPI.moveItem(src, cp);
        if (dest) pairs.push({ from: src, to: dest });
      } catch (err) { /* ignore */ }
    }
    if (pairs.length) pushUndoRef.current?.({ type: "move", pairs });
    for (const p of sourceParents) invalidateCache(p);
    invalidateCache(cp);
    onSetSelectedItems(new Set());
    await loadEntries();
  }, [invalidateCache, loadEntries, onSetSelectedItems, getExternalPaths, copyExternalFiles]);

  // ── Breadcrumb drop targets ─────────────────────────────────────────────
  const crumbsTimerRef = useRef(null);
  const crumbsHoverRef = useRef(null);

  const handleCrumbsDragOver = useCallback((path) => {
    if (crumbsHoverRef.current !== path) {
      crumbsHoverRef.current = path;
      if (crumbsTimerRef.current) clearTimeout(crumbsTimerRef.current);
      crumbsTimerRef.current = setTimeout(() => {
        onNavigate(path);
      }, 800);
    }
  }, [onNavigate]);

  const handleCrumbsDragLeave = useCallback((path) => {
    if (crumbsHoverRef.current === path) {
      crumbsHoverRef.current = null;
      if (crumbsTimerRef.current) { clearTimeout(crumbsTimerRef.current); crumbsTimerRef.current = null; }
    }
  }, []);

  const handleCrumbsDrop = useCallback(async (e, path) => {
    e.preventDefault();
    e.stopPropagation();
    if (crumbsTimerRef.current) { clearTimeout(crumbsTimerRef.current); crumbsTimerRef.current = null; }
    crumbsHoverRef.current = null;

    // Resolve paths
    let paths;
    let isInternal = true;
    try { paths = JSON.parse(e.dataTransfer.getData("application/ppoo-paths")); } catch {}
    if (!paths?.length && window.__ppooDragPaths?.length) {
      paths = window.__ppooDragPaths;
      window.__ppooDragPaths = null;
    }
    if (!paths?.length) {
      const externalPaths = getExternalPaths(e);
      if (externalPaths) { paths = externalPaths; isInternal = false; }
    }
    if (!paths?.length) return;

    if (!isInternal) {
      const copied = await copyExternalFiles(paths, path);
      if (copied.length) { invalidateCache(path); onNavigate(path); }
      return;
    }
    const pairs = [];
    const sourceParents = new Set();
    const failedCrumb = [];
    for (const src of paths) {
      if (src === path) continue;
      const parentDir = src.replace(/[\\/][^\\/]+$/, "") || src;
      sourceParents.add(parentDir);
      try {
        const dest = await window.electronAPI.moveItem(src, path);
        if (dest) pairs.push({ from: src, to: dest });
      } catch (err) { failedCrumb.push(src.split(/[\\/]/).pop()); }
    }
    if (failedCrumb.length) await alertErr("Cannot move item(s)", new Error(failedCrumb.join(", ")));
    if (pairs.length) pushUndoRef.current?.({ type: "move", pairs });
    for (const p of sourceParents) invalidateCache(p);
    invalidateCache(path);
    onSetSelectedItems(new Set());
    onNavigate(path);
  }, [invalidateCache, onNavigate, onSetSelectedItems, alertErr, getExternalPaths, copyExternalFiles]);

  // ── Content-area drop target (folder items) ──────────────────────────────
  const [dropTargetPath, setDropTargetPath] = useState(null);
  const expandTimerRef = useRef(null);
  const expandHoverRef = useRef(null);

  const handleDragOver = useCallback((e, entry) => {
    if (!entry.isDir) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types?.includes("Files") ? "copy" : "move";
    setDropTargetPath(entry.path);

    if (expandHoverRef.current !== entry.path) {
      expandHoverRef.current = entry.path;
      if (expandTimerRef.current) clearTimeout(expandTimerRef.current);
      expandTimerRef.current = setTimeout(() => {
        onNavigate(entry.path);
      }, 800);
    }
  }, [onNavigate]);

  const handleDragLeave = useCallback((e, entry) => {
    e.stopPropagation();
    setDropTargetPath((p) => p === entry.path ? null : p);
    if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
  }, []);

  const handleContentDrop = useCallback(async (e, entry) => {
    if (!entry.isDir) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetPath(null);
    if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }

    // Resolve paths
    let paths;
    let isInternal = true;
    try { paths = JSON.parse(e.dataTransfer.getData("application/ppoo-paths")); } catch {}
    if (!paths?.length && window.__ppooDragPaths?.length) {
      paths = window.__ppooDragPaths;
      window.__ppooDragPaths = null;
    }
    if (!paths?.length) {
      const externalPaths = getExternalPaths(e);
      if (externalPaths) { paths = externalPaths; isInternal = false; }
    }
    if (!paths?.length) return;

    if (!isInternal) {
      const copied = await copyExternalFiles(paths, entry.path);
      if (copied.length) { invalidateCache(entry.path); onNavigate(entry.path); }
      return;
    }
    const pairs = [];
    const sourceParents = new Set();
    const failedDrop = [];
    for (const src of paths) {
      if (src === entry.path) continue;
      const parentDir = src.replace(/[\\/][^\\/]+$/, "") || src;
      sourceParents.add(parentDir);
      try {
        const dest = await window.electronAPI.moveItem(src, entry.path);
        if (dest) pairs.push({ from: src, to: dest });
      } catch (err) { failedDrop.push(src.split(/[\\/]/).pop()); }
    }
    if (failedDrop.length) await alertErr("Cannot move item(s)", new Error(failedDrop.join(", ")));
    if (pairs.length) pushUndoRef.current?.({ type: "move", pairs });
    for (const p of sourceParents) invalidateCache(p);
    invalidateCache(entry.path);
    onSetSelectedItems(new Set());
    onNavigate(entry.path);
  }, [invalidateCache, onNavigate, onSetSelectedItems, alertErr, getExternalPaths, copyExternalFiles]);

  // ── Context menus ─────────────────────────────────────────────────────────
  const handleBlankContextMenu = useCallback(async (e) => {
    if (e.target !== gridRef.current && e.target !== contentRef.current) return;
    e.preventDefault();
    const cp = currentPathRef.current;
    if (!cp) return;
    setRenamingPath(null);
    const result = await window.electronAPI.showContextMenu("none", [], clipboardRef.current?.paths ?? null);
    if (result) await execAction(result.action, [], cp);
  }, [execAction]);

  const handleContextMenu = useCallback(async (e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    setRenamingPath(null);
    const sel = selectedItemsRef.current;
    if (!sel.has(entry.path)) {
      anchorRef.current = entry.path;
      onSetSelectedItems(new Set([entry.path]));
    }
    // Use current selection if the right-clicked item is in it, otherwise just this item
    const paths   = sel.has(entry.path) && sel.size > 1 ? [...sel] : [entry.path];
    const isMulti = paths.length > 1;
    const type    = isMulti ? "multi" : (entry.isDir ? "folder" : "file");
    const result  = await window.electronAPI.showContextMenu(type, paths, clipboardRef.current?.paths ?? null);
    if (result) await execAction(result.action, paths, currentPathRef.current);
  }, [onSetSelectedItems, execAction]);

  const cutPaths = useMemo(() => new Set(clipboard?.mode === "cut" ? clipboard.paths : []), [clipboard]);

  return (
    <div
      className="pw-right"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ outline: "none" }}
    >
      <Bar rootPath={rootPath} currentPath={currentPath} onNavigate={onNavigate}
        query={query} onQuery={setQuery}
        showFolders={showFolders} onToggleFolders={onToggleFolders}
        showFiles={showFiles}    onToggleFiles={onToggleFiles}
        showHidden={showHidden}  onToggleHidden={onToggleHidden}
        showPreview={showPreview} onTogglePreview={onTogglePreview}
        itemCount={itemCount}    selectedCount={selectedItems.size}
        onCrumbsDragOver={handleCrumbsDragOver}
        onCrumbsDragLeave={handleCrumbsDragLeave}
        onCrumbsDrop={handleCrumbsDrop} />

      <div className="pw-content" ref={contentRef}
        onMouseDown={handleMouseDown}
        onClick={handleGridClick}
        onContextMenu={handleBlankContextMenu}
        onDragOver={handleContentAreaDragOver}
        onDrop={handleContentAreaDrop}
      >
        {loading && <div className="pw-content__empty">Loading...</div>}
        {!loading && visible.length === 0 && (
          <div className="pw-content__empty">
            {query || !showFolders || !showFiles ? "No items match" : "Folder is empty"}
          </div>
        )}
        {!loading && visible.length > 0 && (
          <div className={`pw-grid${isListView ? " pw-grid--list" : ""}`} ref={gridRef} role="list" style={isListView ? undefined : { gap: `${Math.round(zoom * 0.02)}px` }}>
            {visible.map((entry) => {
              const isRenaming = renamingPath === entry.path;
              return (
                <div
                  key={entry.path}
                  ref={(el) => { if (el) itemRefs.current[entry.path] = el; else delete itemRefs.current[entry.path]; }}
                  className={[
                    isListView ? "pw-item-list" : "pw-item",
                    selectedItems.has(entry.path)  ? (isListView ? "pw-item-list--selected" : "pw-item--selected") : "",
                    cutPaths.has(entry.path)       ? (isListView ? "pw-item-list--cut" : "pw-item--cut") : "",
                    !isListView && dropTargetPath === entry.path  ? "pw-item--drop-target" : "",
                  ].filter(Boolean).join(" ")}
                  role="listitem"
                  title={isRenaming ? undefined : entry.name}
                  draggable={!isRenaming}
                  onDragStart={(e) => handleDragStart(e, entry)}
                  onDragOver={(e) => handleDragOver(e, entry)}
                  onDragLeave={(e) => handleDragLeave(e, entry)}
                  onDrop={(e) => handleContentDrop(e, entry)}
                  onClick={(e) => handleItemClick(e, entry)}
                  onDoubleClick={() => {
                    if (isRenaming) return;
                    if (entry.isDir) onNavigate(entry.path);
                    else window.electronAPI.openFile(entry.path, settingsRef.current.defaultEditor ?? "system");
                  }}
                  onContextMenu={(e) => handleContextMenu(e, entry)}
                  style={!isListView ? { width: `${itemW}px` } : undefined}
                >
                  {isListView ? (
                    <>
                      <span className="pw-item-list__icon">
                        <PreviewIcon entry={entry} showPreview={showPreview} size={iconSize}/>
                      </span>
                      {isRenaming ? (
                        <RenameInput
                          initialValue={entry.name}
                          onCommit={(newName) => handleRenameCommit(entry.path, newName)}
                          onCancel={() => setRenamingPath(null)}
                        />
                      ) : (
                        <span className="pw-item-list__label">{entry.name}</span>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="pw-item__icon-wrap" style={{ width: `${iconSize}px`, height: `${iconSize}px` }}>
                        <PreviewIcon entry={entry} showPreview={showPreview} size={iconSize}/>
                      </div>
                      {isRenaming ? (
                        <RenameInput
                          initialValue={entry.name}
                          onCommit={(newName) => handleRenameCommit(entry.path, newName)}
                          onCancel={() => setRenamingPath(null)}
                        />
                      ) : (
                        <span className="pw-item__label">{entry.name}</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {band && band.w > 4 && band.h > 4 && (
          <div className="pw-rubber-band" style={{ left: band.x, top: band.y, width: band.w, height: band.h }}/>
        )}
      </div>
    </div>
  );
};

export default ContentArea;
export { PreviewIcon };
