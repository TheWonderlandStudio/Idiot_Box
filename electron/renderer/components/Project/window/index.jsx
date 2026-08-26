import React, { useState, useEffect, useCallback, useRef } from "react";
import SidebarTree from "./SidebarTree.jsx";
import ContentArea from "./ContentArea.jsx";
import StatusBar   from "./StatusBar.jsx";
import "./project-window.css";

const SIDEBAR_MIN     = 120;
const SIDEBAR_MAX     = 400;
const SIDEBAR_DEFAULT = 180;

const ZOOM_DEFAULT    = 100;

const ProjectWindow = () => {
  const [rootPath,      setRootPath]      = useState(null);
  const [currentPath,   setCurrentPath]   = useState(null);
  const [selectedPath,  setSelectedPath]  = useState(null);
  const [selectedItems, setSelectedItems] = useState(() => new Set());
  const [expandedSet,   setExpandedSet]   = useState(() => new Set());
  const [childCache,    setChildCache]    = useState(() => new Map());
  const [itemCount,     setItemCount]     = useState(null);
  const [sidebarWidth,  setSidebarWidth]  = useState(SIDEBAR_DEFAULT);
  const [clipboard,     setClipboard]     = useState(null);
  const [refreshToken,  setRefreshToken]  = useState(0);
  const [zoom,          setZoom]          = useState(ZOOM_DEFAULT);
  const [showHidden,    setShowHidden]    = useState(false);
  const [showFolders,   setShowFolders]   = useState(true);
  const [showFiles,     setShowFiles]     = useState(true);
  const [showPreview,   setShowPreview]   = useState(false);
  const draggingRef = useRef(false);
  const startXRef   = useRef(0);
  const startWRef   = useRef(SIDEBAR_DEFAULT);

  // ── Persist zoom to settings ─────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.readSettings().then((s) => {
      if (s.zoom) setZoom(s.zoom);
    });
  }, []);

  const handleZoom = useCallback((val) => {
    setZoom(val);
    window.electronAPI.readSettings().then((s) => {
      window.electronAPI.writeSettings({ ...s, zoom: val });
    });
  }, []);

  // ── Navigation history (back/forward) ────────────────────────────────────
  const navHistoryRef = useRef({ stack: [], cursor: -1 });

  const pushNavHistory = useCallback((path) => {
    const h = navHistoryRef.current;
    // Don't push duplicate consecutive entries
    if (h.stack.length > 0 && h.stack[h.cursor] === path) return;
    const trimmed = h.stack.slice(0, h.cursor + 1);
    trimmed.push(path);
    navHistoryRef.current = { stack: trimmed, cursor: trimmed.length - 1 };
  }, []);

  const handleBack = useCallback(() => {
    const h = navHistoryRef.current;
    if (h.cursor <= 0) return;
    h.cursor--;
    const path = h.stack[h.cursor];
    setSelectedPath(path); setCurrentPath(path); setSelectedItems(new Set());
  }, []);

  const handleForward = useCallback(() => {
    const h = navHistoryRef.current;
    if (h.cursor >= h.stack.length - 1) return;
    h.cursor++;
    const path = h.stack[h.cursor];
    setSelectedPath(path); setCurrentPath(path); setSelectedItems(new Set());
  }, []);

  // ── Undo / Redo stacks ───────────────────────────────────────────────────
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  // ── Sidebar resize ───────────────────────────────────────────────────────
  const onResizeStart = useCallback((e) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current   = e.clientX;
    startWRef.current   = sidebarWidth;
    const onMove = (ev) => {
      if (!draggingRef.current) return;
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWRef.current + (ev.clientX - startXRef.current))));
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [sidebarWidth]);

  // ── Cache ────────────────────────────────────────────────────────────────
  const loadChildren = useCallback(async (folderPath) => {
    if (childCache.has(folderPath)) return childCache.get(folderPath);
    const entries = await window.electronAPI.readDirAll(folderPath);
    setChildCache((prev) => new Map(prev).set(folderPath, entries));
    return entries;
  }, [childCache]);

  const invalidateCache = useCallback((dirPath) => {
    setChildCache((prev) => { const n = new Map(prev); n.delete(dirPath); return n; });
  }, []);

  const refreshAll = useCallback((dirs) => {
    for (const d of dirs) invalidateCache(d);
    setRefreshToken((t) => t + 1);
  }, [invalidateCache]);

  // ── Push undo operation ──────────────────────────────────────────────────
  const pushUndo = useCallback((op) => {
    undoStackRef.current.push(op);
    redoStackRef.current = [];
  }, []);

  // ── Undo ─────────────────────────────────────────────────────────────────
  const performUndo = useCallback(async () => {
    const stack = undoStackRef.current;
    if (!stack.length) return;
    const op = stack.pop();
    const affected = new Set();

    try {
      switch (op.type) {
        case "move": {
          for (const { from, to } of op.pairs) {
            const srcParent  = from.replace(/[\\/][^\\/]+$/, "") || from;
            const destParent = to.replace(/[\\/][^\\/]+$/, "")   || to;
            // Undo: move the file from its destination back to the original parent dir
            try { await window.electronAPI.moveItem(to, srcParent); } catch (err) {
              await window.electronAPI.showAlert(`Undo move failed:\n${err.message}`);
              continue;
            }
            affected.add(srcParent);
            affected.add(destParent);
          }
          break;
        }
        case "create": {
          try { await window.electronAPI.deleteItem(op.path, false); } catch (err) {
            await window.electronAPI.showAlert(`Undo create failed:\n${err.message}`);
            break;
          }
          affected.add(op.parentDir);
          break;
        }
        case "rename": {
          try { await window.electronAPI.rename(op.newPath, op.oldName); } catch (err) {
            await window.electronAPI.showAlert(`Undo rename failed:\n${err.message}`);
            break;
          }
          affected.add(op.parentDir);
          break;
        }
        case "delete": {
          if (op.trashIds?.length) {
            for (const { from, trashId } of op.trashIds) {
              try { await window.electronAPI.restoreTrashItem(trashId, op.rootPath); } catch (err) {
                await window.electronAPI.showAlert(`Undo delete failed:\n${err.message}`);
                continue;
              }
              affected.add(from.replace(/[\\/][^\\/]+$/, "") || from);
            }
          }
          break;
        }
      }
      redoStackRef.current.push(op);
      refreshAll([...affected]);
    } catch (err) {
      console.warn("Undo failed:", err);
    }
  }, [refreshAll]);

  // ── Redo ─────────────────────────────────────────────────────────────────
  const performRedo = useCallback(async () => {
    const stack = redoStackRef.current;
    if (!stack.length) return;
    const op = stack.pop();
    const affected = new Set();

    try {
      switch (op.type) {
        case "move": {
          for (const { from, to } of op.pairs) {
            const srcParent  = from.replace(/[\\/][^\\/]+$/, "") || from;
            // FIX: `to` is the full destination path (file/folder name included).
            // moveItem expects a *directory*, so extract the parent from `to`.
            const destParent = to.replace(/[\\/][^\\/]+$/, "") || to;
            try { await window.electronAPI.moveItem(from, destParent); } catch (err) {
              await window.electronAPI.showAlert(`Redo move failed:\n${err.message}`);
              continue;
            }
            affected.add(srcParent);
            affected.add(destParent);
          }
          break;
        }
        case "create": {
          try {
            if (op.isDir) await window.electronAPI.newFolder(op.parentDir, op.name);
            else          await window.electronAPI.newFile(op.parentDir, op.name);
          } catch (err) {
            await window.electronAPI.showAlert(`Redo create failed:\n${err.message}`);
            break;
          }
          affected.add(op.parentDir);
          break;
        }
        case "rename": {
          try { await window.electronAPI.rename(op.oldPath, op.newName); } catch (err) {
            await window.electronAPI.showAlert(`Redo rename failed:\n${err.message}`);
            break;
          }
          affected.add(op.parentDir);
          break;
        }
        case "delete": {
          if (op.trashIds?.length) {
            for (const { from, trashId } of op.trashIds) {
              try { await window.electronAPI.trashItem(from, op.rootPath); } catch (err) {
                await window.electronAPI.showAlert(`Redo delete failed:\n${err.message}`);
                continue;
              }
              affected.add(from.replace(/[\\/][^\\/]+$/, "") || from);
            }
          }
          break;
        }
      }
      undoStackRef.current.push(op);
      refreshAll([...affected]);
    } catch (err) {
      console.warn("Redo failed:", err);
    }
  }, [refreshAll]);

  // ── Mouse back/forward buttons ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.button === 3) { e.preventDefault(); handleBack(); }
      if (e.button === 4) { e.preventDefault(); handleForward(); }
    };
    document.addEventListener("mouseup", handler);
    document.addEventListener("mousedown", (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    });
    return () => document.removeEventListener("mouseup", handler);
  }, [handleBack, handleForward]);

  // ── Chokidar watcher ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!rootPath) return;
    window.electronAPI.watchDir(rootPath);
    const unsub = window.electronAPI.onFsChange((affectedDir) => {
      invalidateCache(affectedDir);
      setCurrentPath((p) => {
        if (p === affectedDir) setRefreshToken((t) => t + 1);
        return p;
      });
    });
    return () => { unsub(); window.electronAPI.unwatchDir(rootPath); };
  }, [rootPath, invalidateCache]);

  // ── Project open / close ─────────────────────────────────────────────────
  const openProject = useCallback((folderPath) => {
    setRootPath(folderPath);
    setCurrentPath(folderPath);
    setSelectedPath(folderPath);
    setSelectedItems(new Set());
    setExpandedSet(new Set([folderPath]));
    setChildCache(new Map());
    setItemCount(null);
    setClipboard(null);
    setRefreshToken(0);
    undoStackRef.current = [];
    redoStackRef.current = [];
    navHistoryRef.current = { stack: [folderPath], cursor: 0 };
  }, []);

  const closeProject = useCallback(() => {
    setRootPath(null); setCurrentPath(null); setSelectedPath(null);
    setSelectedItems(new Set()); setExpandedSet(new Set());
    setChildCache(new Map()); setItemCount(null); setClipboard(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    navHistoryRef.current = { stack: [], cursor: -1 };
  }, []);

  useEffect(() => {
    const u1 = window.electronAPI.onMenuEvent("menu:openProject",  openProject);
    const u2 = window.electronAPI.onMenuEvent("menu:newProject",   openProject);
    const u3 = window.electronAPI.onMenuEvent("menu:closeProject", closeProject);
    const u4 = window.electronAPI.onMenuEvent("menu:saveProject",  () => {});
    return () => { u1(); u2(); u3(); u4(); };
  }, [openProject, closeProject]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSidebarSelect = useCallback((folderPath) => {
    setSelectedPath(folderPath); setCurrentPath(folderPath); setSelectedItems(new Set());
    pushNavHistory(folderPath);
  }, [pushNavHistory]);

  const handleToggle = useCallback((folderPath) => {
    setExpandedSet((prev) => { const n = new Set(prev); n.has(folderPath) ? n.delete(folderPath) : n.add(folderPath); return n; });
  }, []);

  const handleNavigate = useCallback((folderPath) => {
    setCurrentPath(folderPath); setSelectedPath(folderPath); setSelectedItems(new Set());
    pushNavHistory(folderPath);
  }, [pushNavHistory]);

  const handleSetSelectedItems = useCallback((nextSet) => setSelectedItems(nextSet), []);
  const handleItemsLoaded      = useCallback((count)   => setItemCount(count),       []);

  const handleSidebarFileSelect = useCallback((filePath) => {
    setSelectedPath(filePath);
    setCurrentPath(filePath.replace(/[\\/][^\\/]+$/, "") || filePath);
    setSelectedItems(new Set([filePath]));
  }, []);

  const handleCollapseAll = useCallback(() => {
    setExpandedSet(new Set());
  }, []);

  const handleRefreshAll = useCallback(() => {
    setChildCache(new Map());
    setRefreshToken((t) => t + 1);
  }, []);

  const handleSidebarDrop = useCallback(async (targetFolderPath, draggedPaths) => {
    const pairs = [];
    const sourceParents = new Set();
    const failedDrop = [];
    for (const src of draggedPaths) {
      if (src === targetFolderPath) continue;
      const parentDir = src.replace(/[\\/][^\\/]+$/, "") || src;
      sourceParents.add(parentDir);
      try {
        const dest = await window.electronAPI.moveItem(src, targetFolderPath);
        if (dest) pairs.push({ from: src, to: dest });
      } catch (err) { failedDrop.push(src.split(/[\\/]/).pop()); }
    }
    if (failedDrop.length) {
      await window.electronAPI.showAlert(`Cannot move item(s):\n${failedDrop.join(", ")}`);
    }
    if (pairs.length) pushUndo({ type: "move", pairs });
    for (const p of sourceParents) invalidateCache(p);
    invalidateCache(targetFolderPath);
    setSelectedItems(new Set());
    setRefreshToken((t) => t + 1);
  }, [invalidateCache, pushUndo]);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!rootPath) {
    return (
      <div className="pw-root">
        <div className="pw-empty">
          <button
            onClick={async () => {
              await window.electronAPI.openFolder();
            }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
              padding: "20px 32px", background: "#2d2d2d",
              border: "1px solid #3c3c3c", borderRadius: 2,
              color: "#c8c8c8", fontSize: 13, fontFamily: "inherit",
              cursor: "pointer", outline: "none",
              transition: "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#383838"; e.currentTarget.style.borderColor = "#5a9fd4"; e.currentTarget.style.color = "#e8e8e8"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#2d2d2d"; e.currentTarget.style.borderColor = "#3c3c3c"; e.currentTarget.style.color = "#c8c8c8"; }}
          >
            <svg width="28" height="28" viewBox="0 0 16 16" fill="none">
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.086a1.5 1.5 0 0 1 1.06.44L7.56 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9Z" fill="#c8a84b"/>
            </svg>
            Open Folder
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pw-root">
      <div className="pw-body">
        <div className="pw-sidebar" style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN, maxWidth: SIDEBAR_MAX }}>
          <SidebarTree
            rootPath={rootPath}
            selectedPath={selectedPath}
            expandedSet={expandedSet}
            childCache={childCache}
            clipboard={clipboard}
            onClipboardChange={setClipboard}
            onSelect={handleSidebarSelect}
            onToggle={handleToggle}
            loadChildren={loadChildren}
            invalidateCache={invalidateCache}
            onDrop={handleSidebarDrop}
            showHidden={showHidden}
            showFolders={showFolders}
            showFiles={showFiles}
            showPreview={showPreview}
            onFileSelect={handleSidebarFileSelect}
            pushUndo={pushUndo}
            onCollapseAll={handleCollapseAll}
            onRefreshAll={handleRefreshAll}
          />
          <div className="pw-sidebar__resize" onMouseDown={onResizeStart} />
        </div>

        <ContentArea
          rootPath={rootPath}
          currentPath={currentPath}
          refreshToken={refreshToken}
          selectedItems={selectedItems}
          onSetSelectedItems={handleSetSelectedItems}
          onNavigate={handleNavigate}
          onItemsLoaded={handleItemsLoaded}
          itemCount={itemCount}
          clipboard={clipboard}
          onClipboardChange={setClipboard}
          invalidateCache={invalidateCache}
          pushUndo={pushUndo}
          performUndo={performUndo}
          performRedo={performRedo}
          zoom={zoom}
          onZoom={handleZoom}
          showHidden={showHidden}
          onToggleHidden={() => setShowHidden((v) => !v)}
          showFolders={showFolders}
          onToggleFolders={() => setShowFolders((v) => !v)}
          showFiles={showFiles}
          onToggleFiles={() => setShowFiles((v) => !v)}
          showPreview={showPreview}
          onTogglePreview={() => setShowPreview((v) => !v)}
        />
      </div>
      <StatusBar
        selectedCount={selectedItems.size}
        selectedPath={selectedItems.size === 1 ? [...selectedItems][0] : currentPath}
        itemCount={itemCount}
        zoom={zoom}
        onZoom={handleZoom}
      />
    </div>
  );
};

export default ProjectWindow;
