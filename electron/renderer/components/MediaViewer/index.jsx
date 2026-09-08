import React, { useState, useCallback, useEffect, useRef } from "react";
import { IMAGE_EXTS, VIDEO_EXTS_SUPPORTED, PDF_EXTS, AUDIO_EXTS } from "./mediaTypes.js";

const TEXT_EXTS  = [".txt", ".md", ".json", ".js", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".scss", ".less", ".py", ".xml", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".env", ".log", ".sh", ".bash", ".bat", ".ps1", ".sql", ".rb", ".php", ".c", ".cpp", ".h", ".hpp", ".java", ".rs", ".go", ".toml", ".csv", ".tsv", ".properties", ".gradle", ".gitignore", ".dockerfile", ".makefile"];
const VIDEO_EXTS_UNSUPPORTED = [".avi", ".mov", ".mkv", ".wmv", ".flv", ".m4v", ".3gp"];

const ext = (p) => {
  try {
    if (!p) return "";
    const base = p.split(/[\\/]/).pop() || "";
    const idx = base.lastIndexOf(".");
    return idx > 0 ? base.slice(idx).toLowerCase() : "";
  } catch { return ""; }
};
const fileName = (p) => { try { return p.split(/[\\/]/).pop(); } catch { return p; } };

const formatFileSize = (bytes) => {
  if (!bytes || isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const toFileUrl = (p) => {
  if (!p) return null;
  const normalized = p.replace(/\\/g, "/");
  const encoded = encodeURI(normalized).replace(/#/g, "%23");
  return "file:///" + (encoded.startsWith("/") ? encoded.slice(1) : encoded);
};

const MediaViewer = () => {
  const [filePath,     setFilePath]     = useState(null);
  const [content,      setContent]      = useState(null);
  const [type,         setType]         = useState(null);
  const [error,        setError]        = useState(null);
  
  // ── View transformation states ───────────────────────────────────────────
  const [zoom,         setZoom]         = useState(1.0);
  const [fitMode,      setFitMode]      = useState(true);
  const [rotation,     setRotation]     = useState(0); // 0, 90, 180, 270
  const [flipH,        setFlipH]        = useState(false);
  const [flipV,        setFlipV]        = useState(false);
  const [pan,          setPan]          = useState({ x: 0, y: 0 });
  const [isDragging,   setIsDragging]   = useState(false);
  const dragStartRef                    = useRef({ x: 0, y: 0 });

  // ── Metadata & Media specific states ──────────────────────────────────────
  const [fileInfo,     setFileInfo]     = useState(null);
  const [showInfo,     setShowInfo]     = useState(false);
  const [fontSize,     setFontSize]     = useState(13);
  const [lineWrap,     setLineWrap]     = useState(true);
  const [videoSpeed,   setVideoSpeed]   = useState(1.0);
  const [videoMuted,   setVideoMuted]   = useState(false);

  const containerRef = useRef(null);
  const videoRef     = useRef(null);

  // ── Reset controls to initial ─────────────────────────────────────────────
  const resetTransform = useCallback(() => {
    setZoom(1.0);
    setFitMode(true);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setPan({ x: 0, y: 0 });
  }, []);

  // ── Open file handler ─────────────────────────────────────────────────────
  const openFile = useCallback(async (fp) => {
    if (!fp) return;
    setError(null);
    setContent(null);
    setType(null);
    setFileInfo(null);
    resetTransform();

    const e = ext(fp);

    // Fetch file stats (size, modified time)
    try {
      const stats = await window.electronAPI.stat(fp);
      if (stats?.exists) {
        setFileInfo({
          size: stats.size,
          mtime: stats.mtime ? new Date(stats.mtime).toLocaleString() : null,
          width: null,
          height: null,
        });
      }
    } catch {}

    if (IMAGE_EXTS.includes(e)) {
      const data = await window.electronAPI.readFileAsDataUrl(fp);
      if (data) {
        setContent(data);
        setType("image");
        setFilePath(fp);
      } else {
        setError(`Failed to load image: ${fileName(fp)}`);
        setFilePath(fp);
      }
      return;
    }

    if (VIDEO_EXTS_SUPPORTED.includes(e)) {
      const fileUrl = toFileUrl(fp);
      if (fileUrl) {
        setContent(fileUrl);
        setType("video");
        setFilePath(fp);
      } else {
        setError(`Could not resolve path: ${fileName(fp)}`);
        setFilePath(fp);
      }
      return;
    }

    if (VIDEO_EXTS_UNSUPPORTED.includes(e)) {
      setError(`${e.toUpperCase().slice(1)} videos are not supported natively. Convert to MP4 or WebM.`);
      setFilePath(fp);
      return;
    }

    if (PDF_EXTS.includes(e)) {
      const fileUrl = toFileUrl(fp);
      if (fileUrl) {
        setContent(fileUrl);
        setType("pdf");
        setFilePath(fp);
      } else {
        setError(`Could not resolve path: ${fileName(fp)}`);
        setFilePath(fp);
      }
      return;
    }

    if (AUDIO_EXTS.includes(e)) {
      const fileUrl = toFileUrl(fp);
      if (fileUrl) {
        setContent(fileUrl);
        setType("audio");
        setFilePath(fp);
      } else {
        setError(`Could not resolve path: ${fileName(fp)}`);
        setFilePath(fp);
      }
      return;
    }

    if (TEXT_EXTS.includes(e)) {
      const text = await window.electronAPI.readTextFile(fp);
      if (text !== null) {
        setContent(text);
        setType("text");
        setFilePath(fp);
      } else {
        setError(`Failed to read file: ${fileName(fp)}`);
        setFilePath(fp);
      }
      return;
    }

    setError(`Unsupported file type: ${e || "(no extension)"}`);
    setFilePath(fp);
  }, [resetTransform]);

  useEffect(() => {
    const handler = (e) => { openFile(e.detail.path); };
    window.addEventListener("media-viewer:open", handler);
    return () => window.removeEventListener("media-viewer:open", handler);
  }, [openFile]);

  // ── Drag & drop, Paste handlers ───────────────────────────────────────────
  const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    const file = files[0];
    if (!file) return;
    const path = window.electronAPI.getPathForFile?.(file);
    if (path) openFile(path);
  }, [openFile]);

  const handlePaste = useCallback((e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData("text");
    if (!text) return;
    if (/^[a-zA-Z]:[\\/]/.test(text) || /^\//.test(text)) {
      openFile(text.trim());
    }
  }, [openFile]);

  const handleClose = useCallback(() => {
    setFilePath(null);
    setContent(null);
    setType(null);
    setError(null);
    setFileInfo(null);
    setShowInfo(false);
    resetTransform();
  }, [resetTransform]);

  // ── Zoom Actions ──────────────────────────────────────────────────────────
  const handleZoomIn = useCallback(() => {
    setFitMode(false);
    setZoom((z) => Math.min(10.0, +(z + 0.25).toFixed(2)));
  }, []);

  const handleZoomOut = useCallback(() => {
    setFitMode(false);
    setZoom((z) => Math.max(0.1, +(z - 0.25).toFixed(2)));
  }, []);

  const handleResetZoom = useCallback(() => {
    setFitMode(false);
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleFitScreen = useCallback(() => {
    setFitMode(true);
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleRotateRight = useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  const handleRotateLeft = useCallback(() => {
    setRotation((r) => (r + 270) % 360);
  }, []);

  const handleFlipH = useCallback(() => {
    setFlipH((f) => !f);
  }, []);

  const handleFlipV = useCallback(() => {
    setFlipV((f) => !f);
  }, []);

  // ── Wheel zoom ────────────────────────────────────────────────────────────
  const handleWheel = useCallback((e) => {
    if (!filePath || (type !== "image" && type !== "video")) return;
    e.preventDefault();
    setFitMode(false);
    const delta = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom((prevZoom) => {
      const next = prevZoom * delta;
      return Math.min(10.0, Math.max(0.1, +next.toFixed(2)));
    });
  }, [filePath, type]);

  // ── Pan / Mouse Drag ──────────────────────────────────────────────────────
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0 || (type !== "image" && type !== "video")) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }, [type, pan]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // ── Context Menu (Right Click) ───────────────────────────────────────────
  const handleContextMenu = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!filePath) return;

    const result = await window.electronAPI.showContextMenu("mediaViewer", [filePath]);
    if (!result) return;

    switch (result.action) {
      case "zoomIn":      handleZoomIn(); break;
      case "zoomOut":     handleZoomOut(); break;
      case "resetZoom":   handleResetZoom(); break;
      case "fitWindow":   handleFitScreen(); break;
      case "rotateRight": handleRotateRight(); break;
      case "rotateLeft":  handleRotateLeft(); break;
      case "flipH":       handleFlipH(); break;
      case "flipV":       handleFlipV(); break;
      case "copyImage":
        if (type === "image") {
          await window.electronAPI.copyImageToClipboard(filePath);
        }
        break;
      case "copyPath":
        navigator.clipboard.writeText(filePath);
        break;
      case "reveal":
        window.electronAPI.revealInExplorer(filePath);
        break;
      case "openWithSystem":
        window.electronAPI.openFile(filePath, "system");
        break;
      case "close":
        handleClose();
        break;
    }
  }, [filePath, type, handleZoomIn, handleZoomOut, handleResetZoom, handleFitScreen, handleRotateRight, handleRotateLeft, handleFlipH, handleFlipV, handleClose]);

  // ── Keyboard Shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!filePath) return;
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
        e.preventDefault(); handleZoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault(); handleZoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault(); handleResetZoom();
      } else if (e.key === "f" || e.key === "F") {
        handleFitScreen();
      } else if (e.key === "r" && !e.shiftKey) {
        handleRotateRight();
      } else if (e.key === "R" || (e.key === "r" && e.shiftKey)) {
        handleRotateLeft();
      } else if (e.key === "h" || e.key === "H") {
        handleFlipH();
      } else if (e.key === "v" || e.key === "V") {
        handleFlipV();
      } else if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filePath, handleZoomIn, handleZoomOut, handleResetZoom, handleFitScreen, handleRotateRight, handleRotateLeft, handleFlipH, handleFlipV, handleClose]);

  // Transform CSS style calculation
  const mediaTransform = `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1}) scale(${zoom})`;

  // Text stats
  const textStats = type === "text" && content ? {
    lines: content.split("\n").length,
    words: content.trim() ? content.trim().split(/\s+/).length : 0,
    chars: content.length,
  } : null;

  return (
    <div
      className="panel"
      ref={containerRef}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onContextMenu={handleContextMenu}
      tabIndex={0}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        overflow: "hidden",
        position: "relative",
        background: "var(--media-panel)",
        outline: "none",
        userSelect: "none",
      }}
    >
      {/* ── Empty state ─────────────────────────────────────────────── */}
      {!filePath && !error && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "var(--fs-title)", flexDirection: "column", gap: "var(--space-12)" }}>
          <svg style={{ fill: "var(--bg-lift)" }} width="40" height="40" viewBox="0 0 16 16">
            <path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h6.086a1.5 1.5 0 0 1 1.06.44l2.914 2.914A1.5 1.5 0 0 1 14 5.414V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11z"/>
          </svg>
          <span style={{ color: "var(--icon)", fontWeight: "var(--fw-medium)" }}>Drop file here to view</span>
          <span style={{ fontSize: "var(--fs-small)", color: "var(--text-placeholder)", textAlign: "center", lineHeight: "var(--lh-code)" }}>Images • Videos • PDFs • Audio • Text<br/>or right-click any file → Open in Media Viewer</span>
        </div>
      )}

      {/* ── Top Header & Toolbar ────────────────────────────────────── */}
      {filePath && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-4) var(--space-10)",
            background: "var(--coal)",
            borderBottom: "1px solid var(--bg-active)",
            flexShrink: 0,
            fontSize: "var(--fs-body)",
            color: "var(--text-bright)",
            zIndex: "var(--z-popover)",
            gap: "var(--space-8)",
            flexWrap: "wrap",
          }}
        >
          {/* File Name & Path */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", minWidth: 0, flex: 1 }}>
            <span
              style={{
                fontWeight: "var(--fw-semibold)",
                color: "var(--text-input)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={filePath}
            >
              {fileName(filePath)}
            </span>

            {/* File info pill */}
            {(fileInfo?.size || fileInfo?.width) && (
              <span style={{ fontSize: "var(--fs-tiny)", background: "var(--bg-hover)", color: "var(--icon-hover)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-sm)", flexShrink: 0 }}>
                {fileInfo.width ? `${fileInfo.width}×${fileInfo.height} px • ` : ""}
                {formatFileSize(fileInfo.size)}
              </span>
            )}
          </div>

          {/* Action Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexShrink: 0 }}>
            {/* Image / Video Zoom & Rotate controls */}
            {(type === "image" || type === "video") && (
              <>
                <button
                  onClick={handleZoomOut}
                  title="Zoom Out (Ctrl+Minus)"
                  style={btnStyle}
                >
                  −
                </button>
                <button
                  onClick={handleResetZoom}
                  title="Reset Zoom (100%)"
                  style={{ ...btnStyle, minWidth: 42, fontSize: "var(--fs-small)" }}
                >
                  {fitMode ? "Fit" : `${Math.round(zoom * 100)}%`}
                </button>
                <button
                  onClick={handleZoomIn}
                  title="Zoom In (Ctrl+Plus)"
                  style={btnStyle}
                >
                  +
                </button>
                <div style={dividerStyle} />

                <button
                  onClick={handleFitScreen}
                  title="Fit to Screen (F)"
                  style={{ ...btnStyle, background: fitMode ? "var(--bg-thumb)" : "transparent" }}
                >
                  ⛶
                </button>
                <button
                  onClick={handleRotateLeft}
                  title="Rotate Left (Shift+R)"
                  style={btnStyle}
                >
                  ↶
                </button>
                <button
                  onClick={handleRotateRight}
                  title="Rotate Right (R)"
                  style={btnStyle}
                >
                  ↷
                </button>
                <button
                  onClick={handleFlipH}
                  title="Flip Horizontal (H)"
                  style={{ ...btnStyle, background: flipH ? "var(--bg-thumb)" : "transparent" }}
                >
                  ↔
                </button>
                <button
                  onClick={handleFlipV}
                  title="Flip Vertical (V)"
                  style={{ ...btnStyle, background: flipV ? "var(--bg-thumb)" : "transparent" }}
                >
                  ↕
                </button>
                <div style={dividerStyle} />
              </>
            )}

            {/* Video specific controls */}
            {type === "video" && (
              <>
                <select
                  value={videoSpeed}
                  onChange={(e) => {
                    const spd = parseFloat(e.target.value);
                    setVideoSpeed(spd);
                    if (videoRef.current) videoRef.current.playbackRate = spd;
                  }}
                  style={{ background: "var(--media-chip)", color: "var(--text-bright)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", fontSize: "var(--fs-small)", padding: "var(--space-1) var(--space-4)", outline: "none", cursor: "pointer" }}
                  title="Playback Speed"
                >
                  <option value={0.5}>0.5x</option>
                  <option value={1.0}>1.0x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2.0}>2.0x</option>
                </select>
                <div style={dividerStyle} />
              </>
            )}

            {/* Text specific controls */}
            {type === "text" && (
              <>
                <button onClick={() => setFontSize(s => Math.max(9, s - 1))} title="Decrease font size" style={btnStyle}>A-</button>
                <span style={{ fontSize: "var(--fs-small)", color: "var(--icon)", minWidth: 20, textAlign: "center" }}>{fontSize}px</span>
                <button onClick={() => setFontSize(s => Math.min(32, s + 1))} title="Increase font size" style={btnStyle}>A+</button>
                <button
                  onClick={() => setLineWrap(w => !w)}
                  title="Toggle Word Wrap"
                  style={{ ...btnStyle, background: lineWrap ? "var(--bg-thumb)" : "transparent" }}
                >
                  Wrap
                </button>
                <div style={dividerStyle} />
              </>
            )}

            {/* Info toggle */}
            <button
              onClick={() => setShowInfo(v => !v)}
              title="File Info"
              style={{ ...btnStyle, color: showInfo ? "var(--accent-light)" : "var(--text-secondary)" }}
            >
              ⓘ
            </button>

            {/* Open in Explorer */}
            <button
              onClick={() => window.electronAPI.revealInExplorer(filePath)}
              title="Reveal in File Explorer"
              style={btnStyle}
            >
              📁
            </button>

            {/* Close Button */}
            <button
              onClick={handleClose}
              title="Close File (Esc)"
              style={{ ...btnStyle, color: "var(--error-short)" }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Main Media Display Canvas / Viewport ───────────────────── */}
      <div
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={() => {
          if (type === "image" || type === "video") {
            if (fitMode) handleResetZoom(); else handleFitScreen();
          }
        }}
        style={{
          flex: 1,
          overflow: "hidden",
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--media-stage)",
          cursor: isDragging ? "grabbing" : (zoom > 1 || !fitMode) ? "grab" : "default",
        }}
      >
        {error && (
          <div style={{ color: "var(--danger)", fontSize: "var(--fs-title)", textAlign: "center", padding: "var(--space-24)", maxWidth: 450, lineHeight: "var(--lh-doc)", background: "var(--media-error-bg)", border: "var(--space-1) solid var(--media-error-border)", borderRadius: "var(--radius-lg)" }}>
            {error}
          </div>
        )}

        {/* ── IMAGE VIEW ───────────────────────────────────────────── */}
        {type === "image" && content && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: fitMode ? "100%" : "auto",
              height: fitMode ? "100%" : "auto",
              transition: isDragging ? "none" : "transform var(--t-normal) ease-out",
            }}
          >
            <img
              src={content}
              onLoad={(e) => {
                const img = e.target;
                setFileInfo((prev) => ({
                  ...prev,
                  width: img.naturalWidth,
                  height: img.naturalHeight,
                }));
              }}
              style={{
                maxWidth: fitMode ? "100%" : "none",
                maxHeight: fitMode ? "100%" : "none",
                objectFit: "contain",
                transform: mediaTransform,
                transition: isDragging ? "none" : "transform var(--t-slow) ease-out",
                pointerEvents: "none",
              }}
              alt=""
            />
          </div>
        )}

        {/* ── VIDEO VIEW ───────────────────────────────────────────── */}
        {type === "video" && content && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: fitMode ? "100%" : "auto",
              height: fitMode ? "100%" : "auto",
            }}
          >
            <video
              ref={videoRef}
              key={content}
              controls
              muted={videoMuted}
              onLoadedMetadata={(e) => {
                const vid = e.target;
                setFileInfo((prev) => ({
                  ...prev,
                  width: vid.videoWidth,
                  height: vid.videoHeight,
                }));
              }}
              style={{
                maxWidth: fitMode ? "100%" : "none",
                maxHeight: fitMode ? "100%" : "none",
                transform: mediaTransform,
                transition: isDragging ? "none" : "transform var(--t-slow) ease-out",
              }}
              src={content}
              onError={() => setError(`Failed to play video. Unsupported codec or corrupted file.`)}
            />
          </div>
        )}

        {/* ── PDF VIEW ─────────────────────────────────────────────── */}
        {type === "pdf" && content && (
          <iframe
            src={content}
            style={{ width: "100%", height: "100%", border: "none", background: "var(--media-video-bg)" }}
            title={fileName(filePath)}
          />
        )}

        {/* ── AUDIO VIEW ───────────────────────────────────────────── */}
        {type === "audio" && content && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-16)", padding: "var(--space-24)", width: "100%" }}>
            <div style={{ width: 80, height: 80, borderRadius: "var(--radius-round)", background: "var(--bg-vscode)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "var(--fs-28)" }}>♫</div>
            <div style={{ color: "var(--text-input)", fontSize: "var(--fs-title)", fontWeight: "var(--fw-semibold)", textAlign: "center", maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName(filePath)}</div>
            <audio
              controls
              src={content}
              style={{ width: "80%", maxWidth: 480, outline: "none" }}
              onError={() => setError(`Failed to play audio.`)}
            />
            {fileInfo?.size && <div style={{ color: "var(--icon)", fontSize: "var(--fs-small)" }}>{formatFileSize(fileInfo.size)}</div>}
          </div>
        )}

        {/* ── TEXT VIEW ────────────────────────────────────────────── */}
        {type === "text" && content !== null && (
          <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
            <pre
              style={{
                margin: 0,
                padding: "var(--space-16)",
                color: "var(--text-highlight)",
                fontSize: `${fontSize}px`,
                fontFamily: 'var(--font-code)',
                whiteSpace: lineWrap ? "pre-wrap" : "pre",
                wordBreak: lineWrap ? "break-word" : "normal",
                lineHeight: "var(--lh-code)",
                userSelect: "text",
              }}
            >
              {content}
            </pre>
          </div>
        )}

        {/* ── File Metadata Info Popover ────────────────────────────── */}
        {showInfo && filePath && (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              background: "var(--media-veil)",
              backdropFilter: "blur(8px)",
              border: "1px solid var(--bg-lift)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-14)",
              fontSize: "var(--fs-small)",
              color: "var(--text-bright)",
              boxShadow: "0 8px 24px var(--overlay-dark)",
              zIndex: "var(--z-toast)",
              minWidth: 240,
            }}
          >
            <div style={{ fontWeight: "var(--fw-bold)", color: "var(--text-inverse)", marginBottom: "var(--space-8)", fontSize: "var(--fs-body)", borderBottom: "1px solid var(--border)", paddingBottom: "var(--space-4)" }}>
              File Details
            </div>
            <div style={infoRowStyle}><span style={infoLabelStyle}>Name:</span> {fileName(filePath)}</div>
            <div style={infoRowStyle}><span style={infoLabelStyle}>Path:</span> <span style={{ wordBreak: "break-all" }}>{filePath}</span></div>
            {fileInfo?.size && <div style={infoRowStyle}><span style={infoLabelStyle}>Size:</span> {formatFileSize(fileInfo.size)}</div>}
            {fileInfo?.width && <div style={infoRowStyle}><span style={infoLabelStyle}>Dimensions:</span> {fileInfo.width} × {fileInfo.height} px</div>}
            {fileInfo?.mtime && <div style={infoRowStyle}><span style={infoLabelStyle}>Modified:</span> {fileInfo.mtime}</div>}
            {textStats && (
              <>
                <div style={infoRowStyle}><span style={infoLabelStyle}>Lines:</span> {textStats.lines}</div>
                <div style={infoRowStyle}><span style={infoLabelStyle}>Words:</span> {textStats.words}</div>
                <div style={infoRowStyle}><span style={infoLabelStyle}>Characters:</span> {textStats.chars}</div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Status Bar (for text stats) ────────────────────── */}
      {type === "text" && textStats && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-2) var(--space-10)",
            background: "var(--bg-deep)",
            borderTop: "1px solid var(--media-sep)",
            fontSize: "var(--fs-tiny)",
            color: "var(--icon-muted)",
            flexShrink: 0,
          }}
        >
          <span>Lines: {textStats.lines} | Words: {textStats.words} | Chars: {textStats.chars}</span>
          <span>{lineWrap ? "Wrap: On" : "Wrap: Off"}</span>
        </div>
      )}
    </div>
  );
};

const btnStyle = {
  background: "transparent",
  border: "1px solid transparent",
  color: "var(--text-soft)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-6)",
  fontSize: "var(--fs-body)",
  cursor: "pointer",
  outline: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: "var(--lh-flat)",
  transition: "background var(--t-normal), color var(--t-normal)",
};

const dividerStyle = {
  width: 1,
  height: 14,
  background: "var(--bg-thumb)",
  margin: "0 var(--space-2)",
};

const infoRowStyle = {
  display: "flex",
  marginBottom: "var(--space-4)",
  lineHeight: "var(--lh-body)",
};

const infoLabelStyle = {
  color: "var(--icon)",
  width: 75,
  flexShrink: 0,
};

export default MediaViewer;
