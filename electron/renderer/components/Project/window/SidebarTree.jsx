import React, { useState, useEffect, useCallback, useRef } from "react";
import VscodeIcon from "../../shared/VscodeIcon.jsx";
import { useInputDialog } from "../../shared/InputDialog.jsx";
import { PreviewIcon } from "./ContentArea.jsx";
import { isMediaFile, shouldAutoOpenMediaViewer } from "../../MediaViewer/mediaTypes.js";
import { ChevronRight, FilePlus, FolderPlus, RefreshCw, FoldVertical } from "lucide-react";

const ArrowSvg = () => <ChevronRight size={10} style={{ display: "block" }} />;

// Respect General → Confirm Before Delete
const shouldConfirmDelete = async () => {
  try { const s = await window.electronAPI.readSettings(); return s.confirmDelete !== false; } catch { return true; }
};
const confirmIfNeeded = async (msg) => {
  if (!(await shouldConfirmDelete())) return true;
  return window.electronAPI.confirmDialog(msg);
};

// ── TreeRow ───────────────────────────────────────────────────────────────────
const TreeRow = ({
  label, iconEl, depth, hasChildren, isOpen, isSelected, isDropTarget, isCut,
  onClick, onDoubleClick, onArrowClick, onDragEnter, onDragOver, onDragLeave, onDrop, onContextMenu,
  gitStatus,
}) => {
  const gitColor = gitStatus ? (
    String(gitStatus).includes("M") ? "#cca700" :
    String(gitStatus).includes("A") ? "#73c991" :
    String(gitStatus).includes("D") ? "#f44747" :
    String(gitStatus).includes("?") ? "#73c991" :
    String(gitStatus).includes("R") ? "#569cd6" : "#888"
  ) : null;
  return (
   <div
    className={[
      "pw-tree-row",
      isSelected   ? "pw-tree-row--selected"    : "",
      isDropTarget ? "pw-tree-row--drop-target" : "",
      isCut        ? "pw-tree-row--cut"         : "",
    ].filter(Boolean).join(" ")}
    style={{ paddingLeft: `${6 + depth * 14}px` }}
    onClick={onClick}
    onDoubleClick={onDoubleClick}
    onDragEnter={onDragEnter}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    onContextMenu={onContextMenu}
    role="treeitem"
    aria-expanded={hasChildren ? isOpen : undefined}
    aria-selected={isSelected}
  >
    <span
      className={`pw-tree-row__arrow${hasChildren
        ? (isOpen ? " pw-tree-row__arrow--open" : "")
        : " pw-tree-row__arrow--hidden"}`}
      onClick={hasChildren ? (e) => { e.stopPropagation(); onArrowClick(); } : undefined}
      aria-hidden="true"
    >
      <ArrowSvg />
    </span>
    <span className="pw-tree-row__icon" aria-hidden="true">{iconEl}</span>
    <span className="pw-tree-row__label" title={label}>{label}</span>
    {gitStatus && (
      <span title={String(gitStatus).trim()==="??" ? "Untracked" : String(gitStatus).trim()} style={{ marginLeft: "auto", fontSize: 10, color: gitColor, fontWeight: 700, paddingRight: 8, flexShrink: 0 }}>{String(gitStatus).trim()==="??" ? "U" : String(gitStatus).trim().slice(0, 2)}</span>
    )}
  </div>
);
};

// ── Recursive folder node ─────────────────────────────────────────────────────
const FolderNode = ({
  entry, depth, selectedPath, expandedSet, childCache,
  onSelect, onToggle, loadChildren, onDrop,
  dropTarget, setDropTarget, onContextMenu,
  showHidden, showFolders, showFiles, showPreview,
  onFileClick, onFileDblClick, onFileCtxMenu,
  onExternalDrop,
  getGitStatus = () => null,
  clipboard,
}) => {
  const isOpen     = expandedSet.has(entry.path);
  const isSelected = selectedPath === entry.path;
  const raw        = childCache.get(entry.path) ?? null;
  const children   = raw ? (showHidden ? raw : raw.filter((c) => !c.name.startsWith("."))) : null;
  const hasLoaded  = childCache.has(entry.path);
  const [loading, setLoading] = useState(false);
  const expandTimerRef = useRef(null);
  const expandHoverRef = useRef(null);

  useEffect(() => {
    if (isOpen && !hasLoaded) {
      setLoading(true);
      loadChildren(entry.path).finally(() => setLoading(false));
    }
  }, [isOpen, hasLoaded, entry.path, loadChildren]);

  // hasChildren: if not loaded yet, show arrow. If loaded, check after applying folder/file filter.
  const filteredChildren = children
    ? children.filter((c) => c.isDir ? showFolders : showFiles)
    : null;
  const hasChildren = !hasLoaded || (filteredChildren && filteredChildren.length > 0);

  const handleDragOver  = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types?.includes("Files") ? "copy" : "move";
    setDropTarget(entry.path);
    if (expandHoverRef.current !== entry.path) {
      expandHoverRef.current = entry.path;
      if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
      expandTimerRef.current = setTimeout(() => {
        if (!isOpen) onToggle(entry.path);
      }, 800);
    }
  }, [entry.path, setDropTarget, isOpen, onToggle]);
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types?.includes("Files") ? "copy" : "move";
    setDropTarget(entry.path);
  }, [entry.path, setDropTarget]);
  const handleDragLeave = useCallback((e) => {
    e.stopPropagation();
    // Only clear if relatedTarget is outside this node
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDropTarget((p) => p === entry.path ? null : p);
      if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
      expandHoverRef.current = null;
    }
  }, [entry.path, setDropTarget]);
  const handleDrop      = useCallback(async (e) => {
    e.preventDefault(); e.stopPropagation(); setDropTarget(null);
    if (expandTimerRef.current) { clearTimeout(expandTimerRef.current); expandTimerRef.current = null; }
    expandHoverRef.current = null;
    // Internal native drag (from startDrag) fallback
    if (window.__ibxDragPaths?.length) {
      const paths = window.__ibxDragPaths; window.__ibxDragPaths = null;
      onDrop(entry.path, paths); return;
    }
    if (await onExternalDrop?.(e, entry.path)) return;
    try { const paths = JSON.parse(e.dataTransfer.getData("application/ibx-paths")); if (paths?.length) onDrop(entry.path, paths); } catch {}
  }, [entry.path, onDrop, setDropTarget, onExternalDrop]);
  const handleCtxMenu   = useCallback((e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(entry.path, e.shiftKey); }, [entry.path, onContextMenu]);

  const isCutSelf = clipboard?.mode === "cut" && clipboard?.paths?.includes(entry.path);
  return (
    <>
      <TreeRow
        label={entry.name}
        iconEl={<VscodeIcon name={entry.name} isDir={true} isOpen={isOpen} size={16} />}
        depth={depth}
        hasChildren={hasChildren}
        isOpen={isOpen}
        isSelected={isSelected}
        isDropTarget={dropTarget === entry.path}
        isCut={isCutSelf}
        onClick={() => onSelect(entry.path)}
        onDoubleClick={() => onToggle(entry.path)}
        onArrowClick={() => onToggle(entry.path)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={handleCtxMenu}
        gitStatus={getGitStatus(entry.path)}
      />
      {isOpen && hasLoaded && filteredChildren && filteredChildren
        .map((child) => child.isDir ? (
        <FolderNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          expandedSet={expandedSet}
          childCache={childCache}
          onSelect={onSelect}
          onToggle={onToggle}
          loadChildren={loadChildren}
          onDrop={onDrop}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          onContextMenu={onContextMenu}
          showHidden={showHidden}
          showFolders={showFolders}
          showFiles={showFiles}
          showPreview={showPreview}
          onFileClick={onFileClick}
          onFileDblClick={onFileDblClick}
          onFileCtxMenu={onFileCtxMenu}
          onExternalDrop={onExternalDrop}
          getGitStatus={getGitStatus}
          clipboard={clipboard}
        />
      ) : (
        <TreeRow
          key={child.path}
          label={child.name}
          iconEl={<PreviewIcon entry={child} showPreview={showPreview} size={16} />}
          depth={depth + 1}
          hasChildren={false}
          isOpen={false}
          isSelected={selectedPath === child.path}
          isDropTarget={false}
          isCut={clipboard?.mode === "cut" && clipboard?.paths?.includes(child.path)}
          onClick={() => onFileClick?.(child.path)}
          onDoubleClick={() => onFileDblClick?.(child.path)}
          onArrowClick={() => {}}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDropTarget(entry.path); }}
          onDragLeave={(e) => { e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget((p) => p === entry.path ? null : p); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(e); }}
          gitStatus={getGitStatus ? getGitStatus(child.path) : null}
          onContextMenu={(e) => onFileCtxMenu?.(e, child.path)}
        />
      ))}
      {isOpen && loading && (
        <div style={{ paddingLeft: `${6 + (depth + 1) * 14 + 14}px`, color: "#555", fontSize: 11, height: 20, lineHeight: "20px" }}>...</div>
      )}
    </>
  );
};

// ── SidebarTree root ──────────────────────────────────────────────────────────
const SidebarTree = ({
  rootPath, selectedPath, expandedSet, childCache,
  onSelect, onToggle, loadChildren, onDrop,
  clipboard, invalidateCache, onClipboardChange,
  showHidden, showFolders, showFiles, showPreview,
  onFileSelect, pushUndo,
  onCollapseAll, onRefreshAll,
}) => {
  const [rootChildren, setRootChildren] = useState(null);
  const [dropTarget,   setDropTarget]   = useState(null);
  // Bump this to force a re-fetch of rootChildren after mutations
  const [localRefresh, setLocalRefresh] = useState(0);
  const [pinned,       setPinned]       = useState([]);
  const [gitStatus,    setGitStatus]    = useState(new Map());
  const { dialog: inputDialog, ask }    = useInputDialog();

  // ── Git status — lightweight, shared with GitPanel cache
  useEffect(() => {
    if (!rootPath) { setGitStatus(new Map()); return; }
    let cancelled = false;
    let fsDebounce = null;
    const fetchGit = async () => {
      if (document.hidden) return;
      try {
        const res = await window.electronAPI.gitStatus(rootPath);
        if (cancelled) return;
        const m = new Map();
        for (const item of (res || [])) {
          const rel = String(item.rel || "").replace(/\\/g, "/");
          const full = String(item.path || "").replace(/\\/g, "/");
          if (rel) m.set(rel, item.status);
          if (full) m.set(full, item.status);
          if (rel.startsWith("./")) m.set(rel.slice(2), item.status);
        }
        setGitStatus(m);
      } catch {}
    };
    fetchGit();
    const iv = setInterval(() => { if (!document.hidden) fetchGit(); }, 12000);
    const onFs = () => {
      clearTimeout(fsDebounce);
      fsDebounce = setTimeout(() => { if (!document.hidden) fetchGit(); }, 1200);
    };
    window.addEventListener("project:opened", onFs);
    const unsub = window.electronAPI.onFsChange(onFs);
    const onVis = () => { if (!document.hidden) fetchGit(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(iv);
      clearTimeout(fsDebounce);
      window.removeEventListener("project:opened", onFs);
      document.removeEventListener("visibilitychange", onVis);
      unsub();
    };
  }, [rootPath]);

  const getGitStatus = useCallback((fullPath) => {
    if (!fullPath || !gitStatus.size) return null;
    const norm = String(fullPath).replace(/\\/g, "/");
    if (gitStatus.has(norm)) return gitStatus.get(norm);
    if (rootPath) {
      const rel = norm.startsWith(rootPath.replace(/\\/g, "/")) ? norm.slice(rootPath.replace(/\\/g, "/").length + 1) : null;
      if (rel && gitStatus.has(rel)) return gitStatus.get(rel);
      if (rel && gitStatus.has("./" + rel)) return gitStatus.get("./" + rel);
    }
    // Try basename fallback for nested
    for (const [k, v] of gitStatus.entries()) {
      if (norm.endsWith("/" + k) || norm === k) return v;
    }
    return null;
  }, [gitStatus, rootPath]);

  // Helper: find a rootPath that can host .trash (top-most ancestor of folderPath)
  const findTrashRoot = useCallback((folderPath) => {
    // Use the project rootPath if folderPath is inside it, else parent
    if (rootPath && folderPath.startsWith(rootPath)) return rootPath;
    const parent = folderPath.replace(/[\\/][^\\/]+$/, "") || folderPath;
    return parent;
  }, [rootPath]);

  // Reload root children whenever rootPath changes OR a mutation triggers localRefresh
  useEffect(() => {
    if (!rootPath) { setRootChildren(null); return; }
    // Always re-read from IPC (bypass in-component cache) so mutations are visible
    window.electronAPI.readDirAll(rootPath).then(setRootChildren);
  }, [rootPath, localRefresh]);

  // Also reload when childCache for rootPath is invalidated (chokidar trigger)
  useEffect(() => {
    if (!rootPath || childCache.has(rootPath)) return;
    window.electronAPI.readDirAll(rootPath).then(setRootChildren);
  }, [rootPath, childCache]);

  const rootName = rootPath ? rootPath.split(/[\\/]/).filter(Boolean).pop() : "";

  const handleExternalDrop = useCallback(async (e, targetDir) => {
    // Internal native drag (from our app) should use move, not copy
    if (window.__ibxDragPaths?.length) return false;
    const dt = e.dataTransfer;
    if (!dt) return false;
    const hasFiles = dt.types?.includes("Files");
    if (!hasFiles) return false;
    const getPath = window.electronAPI.getPathForFile;
    if (!getPath) return false;
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
    if (!paths.length) return false;
    const failed = [];
    let copied = false;
    for (const src of paths) {
      try {
        await window.electronAPI.copyItem(src, targetDir);
        copied = true;
      } catch { failed.push(src.split(/[\\/]/).pop()); }
    }
    if (failed.length) await window.electronAPI.showAlert(`Cannot import:\n${failed.join(", ")}`);
    if (copied) { invalidateCache(targetDir); setLocalRefresh((k) => k + 1); }
    return true;
  }, [invalidateCache]);

  // ── Root row drag handlers ────────────────────────────────────────────────
  const handleRootDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = e.dataTransfer.types?.includes("Files") ? "copy" : "move"; setDropTarget(rootPath); };
  const handleRootDragOver  = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = e.dataTransfer.types?.includes("Files") ? "copy" : "move"; setDropTarget(rootPath); };
  const handleRootDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget((p) => p === rootPath ? null : p); };
  const handleRootDrop      = async (e) => {
    e.preventDefault(); e.stopPropagation(); setDropTarget(null);
    // Internal native drag (from startDrag) fallback
    if (window.__ibxDragPaths?.length) {
      const paths = window.__ibxDragPaths; window.__ibxDragPaths = null;
      onDrop(rootPath, paths); return;
    }
    // External files
    if (await handleExternalDrop(e, rootPath)) return;
    // Internal drag
    try { const paths = JSON.parse(e.dataTransfer.getData("application/ibx-paths")); if (paths?.length) onDrop(rootPath, paths); } catch {}
  };

  // ── Blank-area (sidebar empty space) drop handlers ────────────────────────
  const handleSidebarDragOver = useCallback((e) => {
    if (!rootPath) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types?.includes("Files") ? "copy" : "move";
  }, [rootPath]);

  const handleSidebarDrop = useCallback(async (e) => {
    if (!rootPath) return;
    e.preventDefault();
    e.stopPropagation();
    // External file drop onto blank sidebar area
    if (await handleExternalDrop(e, rootPath)) return;
    // Internal drag onto blank area → move to root
    if (window.__ibxDragPaths?.length) {
      const paths = window.__ibxDragPaths; window.__ibxDragPaths = null;
      onDrop(rootPath, paths); return;
    }
    try { const paths = JSON.parse(e.dataTransfer.getData("application/ibx-paths")); if (paths?.length) onDrop(rootPath, paths); } catch {}
  }, [rootPath, handleExternalDrop, onDrop]);

  // ── Pin config ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rootPath) { setPinned([]); return; }
    window.electronAPI.readPinConfig(rootPath).then(setPinned);
    const handler = () => window.electronAPI.readPinConfig(rootPath).then(setPinned);
    window.addEventListener("pin-changed", handler);
    return () => window.removeEventListener("pin-changed", handler);
  }, [rootPath]);

  const handlePinToggle = useCallback(async (folderName) => {
    if (!rootPath) return;
    let next;
    if (pinned.includes(folderName)) next = pinned.filter((n) => n !== folderName);
    else                              next = [...pinned, folderName];
    setPinned(next);
    await window.electronAPI.writePinConfig(rootPath, next);
    window.dispatchEvent(new CustomEvent("pin-changed"));
  }, [rootPath, pinned]);

  // ── Context menu for any sidebar folder ───────────────────────────────────
  const handleContextMenu = useCallback(async (folderPath, shiftKey = false) => {
    if (folderPath !== selectedPath) onSelect(folderPath);
    const parentDir = folderPath.replace(/[\\/][^\\/]+$/, "") || folderPath;
    const result = await window.electronAPI.showContextMenu(
      "folder", [folderPath], clipboard?.paths ?? null
    );
    if (!result) return;

    const refresh = () => {
      invalidateCache(folderPath);
      invalidateCache(parentDir);
      setLocalRefresh((k) => k + 1);
    };

    switch (result.action) {
      case "newFolder": {
        const askName = await ask("New folder name:", "New Folder");
        if (!askName) break;
        try {
          const created = await window.electronAPI.newFolder(folderPath, askName);
          if (created) {
            if (pushUndo) pushUndo({ type: "create", path: created, parentDir: folderPath, name: askName, isDir: true });
            invalidateCache(folderPath);
            setLocalRefresh((k) => k + 1);
            onSelect(folderPath);
          }
        } catch (err) { await window.electronAPI.showAlert(`Cannot create folder:\n${err.message}`); }
        break;
      }
      case "newFile": {
        const askName = await ask("New file name:", "New File.txt");
        if (!askName) break;
        try {
          const created = await window.electronAPI.newFile(folderPath, askName);
          if (created) {
            if (pushUndo) pushUndo({ type: "create", path: created, parentDir: folderPath, name: askName, isDir: false });
            invalidateCache(folderPath);
            setLocalRefresh((k) => k + 1);
            onSelect(folderPath);
          }
        } catch (err) { await window.electronAPI.showAlert(`Cannot create file:\n${err.message}`); }
        break;
      }
      case "rename": {
        const oldName = folderPath.replace(/.*[\\/]/, "");
        const n = await ask("Rename to:", oldName);
        if (n && n !== oldName) {
          try {
            const newPath = await window.electronAPI.rename(folderPath, n);
            if (pushUndo) pushUndo({ type: "rename", oldPath: folderPath, oldName, newPath: newPath || parentDir + (parentDir.includes("\\") ? "\\" : "/") + n, newName: n, parentDir });
            invalidateCache(parentDir);
            setLocalRefresh((k) => k + 1);
          } catch (err) { await window.electronAPI.showAlert(`Cannot rename:\n${err.message}`); }
        }
        break;
      }
      case "delete": {
        const name = folderPath.replace(/.*[\\/]/, "");
        if (shiftKey) {
          const ok = await confirmIfNeeded(`Permanently delete "${name}"?`);
          if (ok) {
            try {
              await window.electronAPI.deleteItem(folderPath);
              invalidateCache(parentDir);
              setLocalRefresh((k) => k + 1);
            } catch (err) { await window.electronAPI.showAlert(`Cannot delete:\n${err.message}`); }
          }
        } else {
          const ok = await confirmIfNeeded(`Move "${name}" to Trash?`);
          if (ok) {
            try {
              const result = await window.electronAPI.trashItem(folderPath, findTrashRoot(folderPath));
              if (pushUndo && result?.trashId) pushUndo({ type: "delete", trashIds: [{ from: folderPath, trashId: result.trashId }], parentDir, rootPath: findTrashRoot(folderPath) });
              invalidateCache(parentDir);
              setLocalRefresh((k) => k + 1);
            } catch (err) { await window.electronAPI.showAlert(`Cannot delete:\n${err.message}`); }
          }
        }
        break;
      }
      case "duplicate": {
        try {
          await window.electronAPI.duplicate(folderPath);
          invalidateCache(parentDir);
          setLocalRefresh((k) => k + 1);
        } catch (err) { await window.electronAPI.showAlert(`Cannot duplicate:\n${err.message}`); }
        break;
      }
      case "copy": onClipboardChange?.({ paths: [folderPath], mode: "copy" }); break;
      case "cut":  onClipboardChange?.({ paths: [folderPath], mode: "cut"  }); break;
      case "paste": {
        if (!clipboard?.paths?.length) break;
        const failed = [];
        const pairs = [];
        const srcParents = new Set();
        for (const src of clipboard.paths) {
          if (clipboard.mode === "copy") {
            try { await window.electronAPI.copyItem(src, folderPath); }
            catch (err) { failed.push(src.split(/[\\/]/).pop()); }
          } else {
            const srcParent = src.replace(/[\\/][^\\/]+$/, "") || src;
            srcParents.add(srcParent);
            try {
              const dest = await window.electronAPI.moveItem(src, folderPath);
              if (dest) pairs.push({ from: src, to: dest });
            } catch (err) { failed.push(src.split(/[\\/]/).pop()); }
          }
        }
        if (failed.length) await window.electronAPI.showAlert(`Cannot paste:\n${failed.join(", ")}`);
        if (clipboard.mode === "cut" && pairs.length) {
          if (pushUndo) pushUndo({ type: "move", pairs });
          onClipboardChange?.(null);
        }
        for (const p of srcParents) invalidateCache(p);
        invalidateCache(folderPath);
        setLocalRefresh((k) => k + 1);
        break;
      }
      case "reveal":   window.electronAPI.revealInExplorer(folderPath); break;
      case "copyPath": navigator.clipboard.writeText(folderPath); break;
      case "copyRelativePath": {
        const rel = rootPath && folderPath.startsWith(rootPath) ? folderPath.slice(rootPath.length + 1) : folderPath;
        navigator.clipboard.writeText(rel);
        break;
      }
      case "openInTerminal": {
        window.dispatchEvent(new CustomEvent("open-terminal", { detail: { dir: folderPath } }));
        break;
      }
      case "pinToSidebar": {
        const relPath = folderPath.length > rootPath.length
          ? folderPath.slice(rootPath.length + 1)
          : folderPath.replace(/.*[\\/]/, "");
        handlePinToggle(relPath);
        break;
      }
      case "refresh":  refresh(); break;
    }
  }, [selectedPath, onSelect, clipboard, invalidateCache, handlePinToggle, onClipboardChange, ask, pushUndo, rootPath, findTrashRoot]);

  // ── File handlers ────────────────────────────────────────────────────────
  // Single click → "open-file-in-editor" (central router in index.jsx sends
  // media files to Media Viewer when Settings → Auto Open Media Viewer is ON).
  const handleFileClick = useCallback((filePath) => {
    onFileSelect?.(filePath);
    window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: filePath } }));
  }, [onFileSelect]);

  // Double click → media files go to Media Viewer (if enabled), else system default.
  const handleFileDoubleClick = useCallback(async (filePath) => {
    if (isMediaFile(filePath) && await shouldAutoOpenMediaViewer()) {
      window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: filePath } }));
      return;
    }
    await window.electronAPI.openFile(filePath, "system");
  }, []);

  const handleFileContextMenu = useCallback(async (e, filePath) => {
    e.preventDefault();
    e.stopPropagation();
    const shiftKey = e.shiftKey;
    if (filePath !== selectedPath) onSelect(filePath);
    const parentDir = filePath.replace(/[\\/][^\\/]+$/, "") || filePath;
    const result = await window.electronAPI.showContextMenu(
      "file", [filePath], clipboard?.paths ?? null
    );
    if (!result) return;
    switch (result.action) {
      case "open":
        await window.electronAPI.openFile(filePath, "system");
        break;
      case "openInNewEditorTab":
        window.dispatchEvent(new CustomEvent("open-file-in-new-editor-tab", { detail: { path: filePath } }));
        break;
      case "openWithSystem":
        await window.electronAPI.openFile(filePath, "system");
        break;
      case "openInMediaViewer":
        window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: filePath } }));
        break;
      case "openInBrowser": {
        const url = "ibx-file://file/" + encodeURI(filePath.replace(/\\/g, "/")).replace(/#/g, "%23");
        window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url, config: { type: "browser", title: "Browser", url } } }));
        break;
      }
      case "openInExternalBrowser": {
        try { await window.electronAPI.openFile(filePath, "system"); }
        catch {
          const fileUrl = "file:///" + filePath.replace(/\\/g, "/").replace(/^\//, "");
          try { await window.electronAPI.openUrl(fileUrl); } catch {}
        }
        break;
      }
      case "openWithLiveServer": {
        try {
          const root = window.__currentProjectPath || rootPath;
          const { url } = await window.electronAPI.startLiveServer(root, filePath);
          window.dispatchEvent(new CustomEvent("add-browser-panel", {
            detail: { url, config: { type: "browser", title: "Live Server", url } },
          }));
        } catch (err) {
          await window.electronAPI.showAlert(`Live Server failed:\n${err.message}`);
        }
        break;
      }
      case "openInTerminal": {
        window.dispatchEvent(new CustomEvent("open-terminal", { detail: { dir: parentDir } }));
        break;
      }
      case "newFile": {
        const askName = await ask("New file name:", "New File.txt");
        if (!askName) break;
        try {
          const created = await window.electronAPI.newFile(parentDir, askName);
          if (created) {
            if (pushUndo) pushUndo({ type: "create", path: created, parentDir, name: askName, isDir: false });
            invalidateCache(parentDir);
            setLocalRefresh((k) => k + 1);
          }
        } catch (err) { await window.electronAPI.showAlert(`Cannot create file:\n${err.message}`); }
        break;
      }
      case "newFolder": {
        const askName = await ask("New folder name:", "New Folder");
        if (!askName) break;
        try {
          const created = await window.electronAPI.newFolder(parentDir, askName);
          if (created) {
            if (pushUndo) pushUndo({ type: "create", path: created, parentDir, name: askName, isDir: true });
            invalidateCache(parentDir);
            setLocalRefresh((k) => k + 1);
          }
        } catch (err) { await window.electronAPI.showAlert(`Cannot create folder:\n${err.message}`); }
        break;
      }
      case "rename": {
        const oldName = filePath.replace(/.*[\\/]/, "");
        const n = await ask("Rename to:", oldName);
        if (n && n !== oldName) {
          try {
            const newPath = await window.electronAPI.rename(filePath, n);
            if (pushUndo) pushUndo({ type: "rename", oldPath: filePath, oldName, newPath: newPath || parentDir + (parentDir.includes("\\") ? "\\" : "/") + n, newName: n, parentDir });
            invalidateCache(parentDir);
            setLocalRefresh((k) => k + 1);
          } catch (err) { await window.electronAPI.showAlert(`Cannot rename:\n${err.message}`); }
        }
        break;
      }
      case "delete": {
        const name = filePath.replace(/.*[\\/]/, "");
        if (shiftKey) {
          const ok = await confirmIfNeeded(`Permanently delete "${name}"?`);
          if (ok) {
            try {
              await window.electronAPI.deleteItem(filePath);
              invalidateCache(parentDir);
              setLocalRefresh((k) => k + 1);
            } catch (err) { await window.electronAPI.showAlert(`Cannot delete:\n${err.message}`); }
          }
        } else {
          const ok = await confirmIfNeeded(`Move "${name}" to Trash?`);
          if (ok) {
            try {
              const result = await window.electronAPI.trashItem(filePath, findTrashRoot(filePath));
              if (pushUndo && result?.trashId) pushUndo({ type: "delete", trashIds: [{ from: filePath, trashId: result.trashId }], parentDir, rootPath: findTrashRoot(filePath) });
              invalidateCache(parentDir);
              setLocalRefresh((k) => k + 1);
            } catch (err) { await window.electronAPI.showAlert(`Cannot delete:\n${err.message}`); }
          }
        }
        break;
      }
      case "duplicate": {
        try {
          await window.electronAPI.duplicate(filePath);
          invalidateCache(parentDir);
          setLocalRefresh((k) => k + 1);
        } catch (err) { await window.electronAPI.showAlert(`Cannot duplicate:\n${err.message}`); }
        break;
      }
      case "copy": onClipboardChange?.({ paths: [filePath], mode: "copy" }); break;
      case "cut":  onClipboardChange?.({ paths: [filePath], mode: "cut"  }); break;
      case "paste": {
        if (!clipboard?.paths?.length) break;
        const failed = [];
        const pairs = [];
        const srcParents = new Set();
        for (const src of clipboard.paths) {
          if (clipboard.mode === "copy") {
            try { await window.electronAPI.copyItem(src, parentDir); }
            catch (err) { failed.push(src.split(/[\\/]/).pop()); }
          } else {
            const srcParent = src.replace(/[\\/][^\\/]+$/, "") || src;
            srcParents.add(srcParent);
            try {
              const dest = await window.electronAPI.moveItem(src, parentDir);
              if (dest) pairs.push({ from: src, to: dest });
            } catch (err) { failed.push(src.split(/[\\/]/).pop()); }
          }
        }
        if (failed.length) await window.electronAPI.showAlert(`Cannot paste:\n${failed.join(", ")}`);
        if (clipboard.mode === "cut" && pairs.length) {
          if (pushUndo) pushUndo({ type: "move", pairs });
          onClipboardChange?.(null);
        }
        for (const p of srcParents) invalidateCache(p);
        invalidateCache(parentDir);
        setLocalRefresh((k) => k + 1);
        break;
      }
      case "reveal":
        window.electronAPI.revealInExplorer(filePath);
        break;
      case "copyPath":
        navigator.clipboard.writeText(filePath);
        break;
      case "copyRelativePath": {
        const rel = rootPath && filePath.startsWith(rootPath) ? filePath.slice(rootPath.length + 1) : filePath;
        navigator.clipboard.writeText(rel);
        break;
      }
      case "refresh": {
        invalidateCache(parentDir);
        setLocalRefresh((k) => k + 1);
        break;
      }
      default: {
        if (result.action.startsWith("openWithEditor:")) {
          const editorId = result.action.slice("openWithEditor:".length);
          await window.electronAPI.openFile(filePath, editorId);
        }
        break;
      }
    }
  }, [selectedPath, onSelect, clipboard, invalidateCache, findTrashRoot, onClipboardChange, ask, pushUndo, rootPath]);

  // ── Blank area context menu (right-click empty space) ─────────────────────
  const handleBlankContext = useCallback(async (e) => {
    if (!rootPath) return;
    const result = await window.electronAPI.showContextMenu(
      "none", [], clipboard?.paths ?? null
    );
    if (!result) return;

    const refresh = () => {
      invalidateCache(rootPath);
      setLocalRefresh((k) => k + 1);
    };

    switch (result.action) {
      case "newFolder": {
        const askName = await ask("New folder name:", "New Folder");
        if (!askName) break;
        try {
          const created = await window.electronAPI.newFolder(rootPath, askName);
          if (created && pushUndo) pushUndo({ type: "create", path: created, parentDir: rootPath, name: askName, isDir: true });
          refresh();
        } catch (err) { await window.electronAPI.showAlert(`Cannot create folder:\n${err.message}`); }
        break;
      }
      case "newFile": {
        const askName = await ask("New file name:", "New File.txt");
        if (!askName) break;
        try {
          const created = await window.electronAPI.newFile(rootPath, askName);
          if (created && pushUndo) pushUndo({ type: "create", path: created, parentDir: rootPath, name: askName, isDir: false });
          refresh();
        } catch (err) { await window.electronAPI.showAlert(`Cannot create file:\n${err.message}`); }
        break;
      }
      case "openInTerminal": {
        window.dispatchEvent(new CustomEvent("open-terminal", { detail: { dir: rootPath } }));
        break;
      }
      case "paste": {
        if (!clipboard?.paths?.length) break;
        const failed = [];
        const pairs = [];
        const srcParents = new Set();
        for (const src of clipboard.paths) {
          if (clipboard.mode === "copy") {
            try { await window.electronAPI.copyItem(src, rootPath); }
            catch (err) { failed.push(src.split(/[\\/]/).pop()); }
          } else {
            const srcParent = src.replace(/[\\/][^\\/]+$/, "") || src;
            srcParents.add(srcParent);
            try {
              const dest = await window.electronAPI.moveItem(src, rootPath);
              if (dest) pairs.push({ from: src, to: dest });
            } catch (err) { failed.push(src.split(/[\\/]/).pop()); }
          }
        }
        if (failed.length) await window.electronAPI.showAlert(`Cannot paste:\n${failed.join(", ")}`);
        if (clipboard.mode === "cut" && pairs.length) {
          if (pushUndo) pushUndo({ type: "move", pairs });
          onClipboardChange?.(null);
        }
        for (const p of srcParents) invalidateCache(p);
        refresh();
        break;
      }
      case "reveal":
        window.electronAPI.revealInExplorer(rootPath);
        break;
      case "copyPath":
        navigator.clipboard.writeText(rootPath);
        break;
      case "copyRelativePath": {
        const rel = rootPath ? rootPath.split(/[\\/]/).pop() : rootPath;
        navigator.clipboard.writeText(rel);
        break;
      }
      case "refresh":
        refresh();
        break;
    }
  }, [rootPath, clipboard, invalidateCache, pushUndo, onClipboardChange, ask]);

  // ── Header actions ──────────────────────────────────────────────────────────
  const getActiveDir = useCallback(async () => {
    if (!rootPath) return null;
    if (!selectedPath) return rootPath;
    try {
      const st = await window.electronAPI.stat(selectedPath);
      if (st?.isDir) return selectedPath;
    } catch {}
    const parent = selectedPath.replace(/[\\/][^\\/]+$/, "") || rootPath;
    // ensure parent exists under root; fallback to root
    if (!parent || !parent.startsWith(rootPath)) return rootPath;
    return parent;
  }, [rootPath, selectedPath]);

  const handleHeaderNewFile = useCallback(async () => {
    const targetDir = await getActiveDir();
    if (!targetDir) return;
    const name = await ask("New file name:", "New File.txt");
    if (!name) return;
    try {
      const created = await window.electronAPI.newFile(targetDir, name);
      if (created) {
        if (pushUndo) pushUndo({ type: "create", path: created, parentDir: targetDir, name, isDir: false });
        invalidateCache(targetDir);
        setLocalRefresh((k) => k + 1);
        if (!expandedSet.has(targetDir)) onToggle(targetDir);
      }
    } catch (err) { await window.electronAPI.showAlert(`Cannot create file:\n${err.message}`); }
  }, [getActiveDir, ask, pushUndo, invalidateCache, expandedSet, onToggle]);

  const handleHeaderNewFolder = useCallback(async () => {
    const targetDir = await getActiveDir();
    if (!targetDir) return;
    const name = await ask("New folder name:", "New Folder");
    if (!name) return;
    try {
      const created = await window.electronAPI.newFolder(targetDir, name);
      if (created) {
        if (pushUndo) pushUndo({ type: "create", path: created, parentDir: targetDir, name, isDir: true });
        invalidateCache(targetDir);
        setLocalRefresh((k) => k + 1);
        if (!expandedSet.has(targetDir)) onToggle(targetDir);
      }
    } catch (err) { await window.electronAPI.showAlert(`Cannot create folder:\n${err.message}`); }
  }, [getActiveDir, ask, pushUndo, invalidateCache, expandedSet, onToggle]);

  const handleHeaderRefresh = useCallback(() => {
    if (onRefreshAll) onRefreshAll();
    else {
      invalidateCache(rootPath);
      setLocalRefresh((k) => k + 1);
    }
  }, [onRefreshAll, rootPath, invalidateCache]);

  const handleHeaderCollapse = useCallback(() => {
    if (onCollapseAll) onCollapseAll();
    else {
      // fallback: clear all expanded except root
      // handled via parent
    }
  }, [onCollapseAll]);

  // ── Sidebar keyboard shortcuts ───────────────────────────────────────
  const handleSidebarKeyDown = useCallback(async (e) => {
    if (!rootPath || !selectedPath) return;
    const isFile = (() => {
      // heuristic: if expandedSet has it, it's a folder; otherwise treat as file.
      // For accurate check we could stat, but sync heuristic is fine for keyboard.
      if (expandedSet.has(selectedPath)) return false;
      // also check rootChildren to see if isDir false?
      return true;
    })();
    // Don't handle if input dialog open
    if (document.activeElement?.tagName === "INPUT") return;

    if (e.key === "F2") {
      e.preventDefault();
      const oldName = selectedPath.replace(/.*[\\/]/, "");
      const n = await ask("Rename to:", oldName);
      if (n && n !== oldName) {
        const parentDir = selectedPath.replace(/[\\/][^\\/]+$/, "") || selectedPath;
        try {
          const newPath = await window.electronAPI.rename(selectedPath, n);
          if (pushUndo) pushUndo({ type: "rename", oldPath: selectedPath, oldName, newPath: newPath || parentDir + (parentDir.includes("\\") ? "\\" : "/") + n, newName: n, parentDir });
          invalidateCache(parentDir);
          setLocalRefresh((k) => k + 1);
        } catch (err) { await window.electronAPI.showAlert(`Cannot rename:\n${err.message}`); }
      }
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      const name = selectedPath.replace(/.*[\\/]/, "");
      const parentDir = selectedPath.replace(/[\\/][^\\/]+$/, "") || selectedPath;
      if (e.shiftKey) {
        const ok = await confirmIfNeeded(`Permanently delete "${name}"?`);
        if (!ok) return;
        try { await window.electronAPI.deleteItem(selectedPath); invalidateCache(parentDir); setLocalRefresh((k)=>k+1); } catch (err) { await window.electronAPI.showAlert(`Cannot delete:\n${err.message}`); }
      } else {
        const ok = await confirmIfNeeded(`Move "${name}" to Trash?`);
        if (!ok) return;
        try {
          const result = await window.electronAPI.trashItem(selectedPath, findTrashRoot(selectedPath));
          if (pushUndo && result?.trashId) pushUndo({ type: "delete", trashIds: [{ from: selectedPath, trashId: result.trashId }], parentDir, rootPath: findTrashRoot(selectedPath) });
          invalidateCache(parentDir);
          setLocalRefresh((k)=>k+1);
        } catch (err) { await window.electronAPI.showAlert(`Cannot delete:\n${err.message}`); }
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      onClipboardChange?.({ paths: [selectedPath], mode: "copy" });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
      e.preventDefault();
      onClipboardChange?.({ paths: [selectedPath], mode: "cut" });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      if (!clipboard?.paths?.length) return;
      // paste into active dir
      const targetDir = await getActiveDir();
      if (!targetDir) return;
      const failed = [];
      const pairs = [];
      const srcParents = new Set();
      for (const src of clipboard.paths) {
        if (clipboard.mode === "copy") {
          try { await window.electronAPI.copyItem(src, targetDir); } catch { failed.push(src.split(/[\\/]/).pop()); }
        } else {
          const sp = src.replace(/[\\/][^\\/]+$/, "") || src;
          srcParents.add(sp);
          try { const dest = await window.electronAPI.moveItem(src, targetDir); if (dest) pairs.push({ from: src, to: dest }); } catch { failed.push(src.split(/[\\/]/).pop()); }
        }
      }
      if (failed.length) await window.electronAPI.showAlert(`Cannot paste:\n${failed.join(", ")}`);
      if (clipboard.mode === "cut" && pairs.length) { if (pushUndo) pushUndo({ type: "move", pairs }); onClipboardChange?.(null); }
      for (const p of srcParents) invalidateCache(p);
      invalidateCache(targetDir);
      setLocalRefresh((k)=>k+1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      if (e.shiftKey) await handleHeaderNewFolder();
      else await handleHeaderNewFile();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      const parentDir = selectedPath.replace(/[\\/][^\\/]+$/, "") || selectedPath;
      try { await window.electronAPI.duplicate(selectedPath); invalidateCache(parentDir); setLocalRefresh((k)=>k+1); } catch (err) { await window.electronAPI.showAlert(`Cannot duplicate:\n${err.message}`); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      // select all not applicable in tree; ignore
      return;
    }
    if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) {
      e.preventDefault();
      handleHeaderRefresh();
      return;
    }
  }, [rootPath, selectedPath, expandedSet, clipboard, ask, pushUndo, invalidateCache, onClipboardChange, getActiveDir, handleHeaderRefresh, handleHeaderNewFile, handleHeaderNewFolder, findTrashRoot]);

  return (
    <>
      {inputDialog}
      <div className="pw-sidebar__header">
        <span className="pw-sidebar__title">Explorer</span>
        <div className="pw-sidebar__actions">
          <button className="pw-sidebar__action-btn" title="New File (Ctrl+N)" onClick={handleHeaderNewFile}>
            <FilePlus size={14} />
          </button>
          <button className="pw-sidebar__action-btn" title="New Folder (Ctrl+Shift+N)" onClick={handleHeaderNewFolder}>
            <FolderPlus size={14} />
          </button>
          <button className="pw-sidebar__action-btn" title="Refresh (F5)" onClick={handleHeaderRefresh}>
            <RefreshCw size={13} />
          </button>
          <button className="pw-sidebar__action-btn" title="Collapse All" onClick={handleHeaderCollapse}>
            <FoldVertical size={13} />
          </button>
        </div>
      </div>
      <div className="pw-sidebar__scroll" role="tree" aria-label="Project tree"
        tabIndex={0}
        onKeyDown={handleSidebarKeyDown}
        onContextMenu={handleBlankContext}
        onDragOver={handleSidebarDragOver}
        onDrop={handleSidebarDrop}>
      {rootPath && (
        <>
          {pinned.length > 0 && (
            <>
              <div className="pw-section">
                <span className="pw-section__label">Pinned</span>
              </div>
              {pinned.map((name) => {
                const sep = rootPath.includes("\\") ? "\\" : "/";
                const fullPath = rootPath + sep + name;
                const folderName = name.split(/[\\/]/).pop();
                return (
                  <TreeRow
                    key={name}
                    label={folderName}
                    iconEl={<VscodeIcon name={folderName} isDir={true} size={16} />}
                    depth={0}
                    hasChildren={false}
                    isOpen={false}
                    isSelected={selectedPath === fullPath}
                    isDropTarget={false}
                    isCut={clipboard?.mode === "cut" && clipboard?.paths?.includes(fullPath)}
                    onClick={() => onSelect(fullPath)}
                    onDoubleClick={() => onToggle(fullPath)}
                    onArrowClick={() => {}}
                    onDragOver={() => {}}
                    onDragLeave={() => {}}
                    onDrop={() => {}}
                    onContextMenu={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (fullPath !== selectedPath) onSelect(fullPath);
                      const parentDir = fullPath.replace(/[\\/][^\\/]+$/, "") || fullPath;
                      const result = await window.electronAPI.showContextMenu("pinned", [fullPath], clipboard?.paths ?? null);
                      if (!result) return;
                      switch (result.action) {
                        case "newFolder": {
                          const askName = await ask("New folder name:", "New Folder");
                          if (!askName) break;
                          try {
                            const created = await window.electronAPI.newFolder(fullPath, askName);
                            if (created) { if (pushUndo) pushUndo({ type: "create", path: created, parentDir: fullPath, name: askName, isDir: true }); invalidateCache(fullPath); setLocalRefresh((k) => k + 1); onSelect(fullPath); }
                          } catch (err) { await window.electronAPI.showAlert(`Cannot create folder:\n${err.message}`); }
                          break;
                        }
                        case "newFile": {
                          const askName = await ask("New file name:", "New File.txt");
                          if (!askName) break;
                          try {
                            const created = await window.electronAPI.newFile(fullPath, askName);
                            if (created) { if (pushUndo) pushUndo({ type: "create", path: created, parentDir: fullPath, name: askName, isDir: false }); invalidateCache(fullPath); setLocalRefresh((k) => k + 1); onSelect(fullPath); }
                          } catch (err) { await window.electronAPI.showAlert(`Cannot create file:\n${err.message}`); }
                          break;
                        }
                        case "openInTerminal": {
                          window.dispatchEvent(new CustomEvent("open-terminal", { detail: { dir: fullPath } }));
                          break;
                        }
                        case "pinToSidebar": handlePinToggle(name); break;
                        case "rename": {
                          const oldName = fullPath.replace(/.*[\\/]/, "");
                          const n = await ask("Rename to:", oldName);
                          if (n && n !== oldName) {
                            try {
                              const newPath = await window.electronAPI.rename(fullPath, n);
                              if (pushUndo) pushUndo({ type: "rename", oldPath: fullPath, oldName, newPath: newPath || parentDir + (parentDir.includes("\\") ? "\\" : "/") + n, newName: n, parentDir });
                              invalidateCache(parentDir);
                              setLocalRefresh((k) => k + 1);
                            } catch (err) { await window.electronAPI.showAlert(`Cannot rename:\n${err.message}`); }
                          }
                          break;
                        }
                        case "delete": {
                          const dname = fullPath.replace(/.*[\\/]/, "");
                          const ok = await confirmIfNeeded(`Move "${dname}" to Trash?`);
                          if (ok) {
                            try {
                              const result = await window.electronAPI.trashItem(fullPath, rootPath);
                              if (pushUndo && result?.trashId) pushUndo({ type: "delete", trashIds: [{ from: fullPath, trashId: result.trashId }], parentDir, rootPath });
                              invalidateCache(parentDir);
                              setLocalRefresh((k) => k + 1);
                            } catch (err) { await window.electronAPI.showAlert(`Cannot delete:\n${err.message}`); }
                          }
                          break;
                        }
                        case "duplicate": {
                          try {
                            await window.electronAPI.duplicate(fullPath);
                            invalidateCache(parentDir);
                            setLocalRefresh((k) => k + 1);
                          } catch (err) { await window.electronAPI.showAlert(`Cannot duplicate:\n${err.message}`); }
                          break;
                        }
                        case "copy": onClipboardChange?.({ paths: [fullPath], mode: "copy" }); break;
                        case "cut":  onClipboardChange?.({ paths: [fullPath], mode: "cut"  }); break;
                        case "paste": {
                          if (!clipboard?.paths?.length) break;
                          const failed = [];
                          const pairs = [];
                          const srcParents = new Set();
                          for (const src of clipboard.paths) {
                            if (clipboard.mode === "copy") {
                              try { await window.electronAPI.copyItem(src, fullPath); }
                              catch { failed.push(src.split(/[\\/]/).pop()); }
                            } else {
                              const sp = src.replace(/[\\/][^\\/]+$/, "") || src;
                              srcParents.add(sp);
                              try { const dest = await window.electronAPI.moveItem(src, fullPath); if (dest) pairs.push({ from: src, to: dest }); }
                              catch { failed.push(src.split(/[\\/]/).pop()); }
                            }
                          }
                          if (failed.length) await window.electronAPI.showAlert(`Cannot paste:\n${failed.join(", ")}`);
                          if (clipboard.mode === "cut" && pairs.length) { if (pushUndo) pushUndo({ type: "move", pairs }); onClipboardChange?.(null); }
                          for (const p of srcParents) invalidateCache(p);
                          invalidateCache(fullPath);
                          setLocalRefresh((k) => k + 1);
                          break;
                        }
                        case "reveal": window.electronAPI.revealInExplorer(fullPath); break;
                        case "copyPath": navigator.clipboard.writeText(fullPath); break;
                        case "copyRelativePath": {
                          const rel = rootPath && fullPath.startsWith(rootPath) ? fullPath.slice(rootPath.length + 1) : fullPath;
                          navigator.clipboard.writeText(rel);
                          break;
                        }
                        case "refresh": {
                          invalidateCache(fullPath);
                          invalidateCache(parentDir);
                          setLocalRefresh((k) => k + 1);
                          break;
                        }
                      }
                    }}
                  />
                );
              })}
            </>
          )}
          <div className="pw-section">
            <span className="pw-section__label">Files</span>
          </div>
          <TreeRow
            label={rootName}
            iconEl={<VscodeIcon name={rootName} isDir={true} isOpen={expandedSet.has(rootPath)} size={16} />}
            depth={0}
            hasChildren={rootChildren === null || (rootChildren && rootChildren.length > 0)}
            isOpen={expandedSet.has(rootPath)}
            isSelected={selectedPath === rootPath}
            isDropTarget={dropTarget === rootPath}
            isCut={clipboard?.mode === "cut" && clipboard?.paths?.includes(rootPath)}
            onClick={() => onSelect(rootPath)}
            onDoubleClick={() => onToggle(rootPath)}
            onArrowClick={() => onToggle(rootPath)}
            onDragEnter={handleRootDragEnter}
            onDragOver={handleRootDragOver}
            onDragLeave={handleRootDragLeave}
            onDrop={handleRootDrop}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); handleContextMenu(rootPath, e.shiftKey); }}
            gitStatus={getGitStatus(rootPath)}
          />
          {expandedSet.has(rootPath) && rootChildren && rootChildren
            .filter((c) => showHidden || !c.name.startsWith("."))
            .filter((c) => c.isDir ? showFolders : showFiles)
            .map((entry) => entry.isDir ? (
            <FolderNode
              key={entry.path}
              entry={entry}
              depth={1}
              selectedPath={selectedPath}
              expandedSet={expandedSet}
              childCache={childCache}
              onSelect={onSelect}
              onToggle={onToggle}
              loadChildren={loadChildren}
              onDrop={onDrop}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              onContextMenu={handleContextMenu}
              showHidden={showHidden}
              showFolders={showFolders}
              showFiles={showFiles}
              showPreview={showPreview}
              onFileClick={handleFileClick}
              onFileDblClick={handleFileDoubleClick}
              onFileCtxMenu={handleFileContextMenu}
              onExternalDrop={handleExternalDrop}
              clipboard={clipboard}
            />
          ) : (
            <TreeRow
              key={entry.path}
              label={entry.name}
              iconEl={<PreviewIcon entry={entry} showPreview={showPreview} size={16} />}
              depth={1}
              hasChildren={false}
              isOpen={false}
              isSelected={selectedPath === entry.path}
              isDropTarget={false}
              isCut={clipboard?.mode === "cut" && clipboard?.paths?.includes(entry.path)}
              onClick={() => handleFileClick(entry.path)}
              onDoubleClick={() => handleFileDoubleClick(entry.path)}
              onArrowClick={() => {}}
              onDragOver={() => {}}
              onDragLeave={() => {}}
              onDrop={() => {}}
              onContextMenu={(e) => handleFileContextMenu(e, entry.path)}
              gitStatus={getGitStatus(entry.path)}
            />
          ))}
        </>
      )}
    </div>
    </>
  );
};

export default SidebarTree;
