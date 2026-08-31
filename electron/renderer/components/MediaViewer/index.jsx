import React, { useState, useCallback, useEffect, useRef } from "react";

const TEXT_EXTS  = [".txt", ".md", ".json", ".js", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".scss", ".less", ".py", ".xml", ".yaml", ".yml", ".ini", ".cfg", ".conf", ".env", ".log", ".sh", ".bash", ".bat", ".ps1", ".sql", ".rb", ".php", ".c", ".cpp", ".h", ".hpp", ".java", ".rs", ".go", ".toml", ".csv", ".tsv", ".properties", ".gradle", ".gitignore", ".dockerfile", ".makefile"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".avif", ".tiff", ".tif", ".heic", ".heif"];
const VIDEO_EXTS_SUPPORTED   = [".mp4", ".webm", ".ogv"];
const VIDEO_EXTS_UNSUPPORTED = [".avi", ".mov", ".mkv", ".wmv", ".flv", ".m4v", ".3gp"];
const PDF_EXTS  = [".pdf"];
const AUDIO_EXTS = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".opus", ".aiff", ".mid", ".midi"];

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
        background: "#121212",
        outline: "none",
        userSelect: "none",
      }}
    >
      {/* ── Empty state ─────────────────────────────────────────────── */}
      {!filePath && !error && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666", fontSize: 13, flexDirection: "column", gap: 12 }}>
          <svg width="40" height="40" viewBox="0 0 16 16" fill="#383838">
            <path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h6.086a1.5 1.5 0 0 1 1.06.44l2.914 2.914A1.5 1.5 0 0 1 14 5.414V13.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-11z"/>
          </svg>
          <span style={{ color: "#888", fontWeight: 500 }}>Drop file here to view</span>
          <span style={{ fontSize: 11, color: "#555", textAlign: "center", lineHeight: 1.5 }}>Images • Videos • PDFs • Audio • Text<br/>or right-click any file → Open in Media Viewer</span>
        </div>
      )}

      {/* ── Top Header & Toolbar ────────────────────────────────────── */}
      {filePath && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 10px",
            background: "#1c1c1c",
            borderBottom: "1px solid #2d2d2d",
            flexShrink: 0,
            fontSize: 12,
            color: "#ccc",
            zIndex: 10,
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {/* File Name & Path */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
            <span
              style={{
                fontWeight: 600,
                color: "#e0e0e0",
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
              <span style={{ fontSize: 10, background: "#2a2a2a", color: "#aaa", padding: "1px 6px", borderRadius: 3, flexShrink: 0 }}>
                {fileInfo.width ? `${fileInfo.width}×${fileInfo.height} px • ` : ""}
                {formatFileSize(fileInfo.size)}
              </span>
            )}
          </div>

          {/* Action Toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
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
                  style={{ ...btnStyle, minWidth: 42, fontSize: 11 }}
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
                  style={{ ...btnStyle, background: fitMode ? "#333" : "transparent" }}
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
                  style={{ ...btnStyle, background: flipH ? "#333" : "transparent" }}
                >
                  ↔
                </button>
                <button
                  onClick={handleFlipV}
                  title="Flip Vertical (V)"
                  style={{ ...btnStyle, background: flipV ? "#333" : "transparent" }}
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
                  style={{ background: "#262626", color: "#ccc", border: "1px solid #3c3c3c", borderRadius: 3, fontSize: 11, padding: "1px 4px", outline: "none", cursor: "pointer" }}
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
                <span style={{ fontSize: 11, color: "#888", minWidth: 20, textAlign: "center" }}>{fontSize}px</span>
                <button onClick={() => setFontSize(s => Math.min(32, s + 1))} title="Increase font size" style={btnStyle}>A+</button>
                <button
                  onClick={() => setLineWrap(w => !w)}
                  title="Toggle Word Wrap"
                  style={{ ...btnStyle, background: lineWrap ? "#333" : "transparent" }}
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
              style={{ ...btnStyle, color: showInfo ? "#5a9fd4" : "#999" }}
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
              style={{ ...btnStyle, color: "#e55" }}
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
          background: "#0a0a0a",
          cursor: isDragging ? "grabbing" : (zoom > 1 || !fitMode) ? "grab" : "default",
        }}
      >
        {error && (
          <div style={{ color: "#f44747", fontSize: 13, textAlign: "center", padding: 24, maxWidth: 450, lineHeight: 1.6, background: "#1c1414", border: "1px solid #4a2222", borderRadius: 6 }}>
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
              transition: isDragging ? "none" : "transform 0.1s ease-out",
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
                transition: isDragging ? "none" : "transform 0.15s ease-out",
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
                transition: isDragging ? "none" : "transform 0.15s ease-out",
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
            style={{ width: "100%", height: "100%", border: "none", background: "#525659" }}
            title={fileName(filePath)}
          />
        )}

        {/* ── AUDIO VIEW ───────────────────────────────────────────── */}
        {type === "audio" && content && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, width: "100%" }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#252526", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>♫</div>
            <div style={{ color: "#e0e0e0", fontSize: 13, fontWeight: 600, textAlign: "center", maxWidth: "80%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName(filePath)}</div>
            <audio
              controls
              src={content}
              style={{ width: "80%", maxWidth: 480, outline: "none" }}
              onError={() => setError(`Failed to play audio.`)}
            />
            {fileInfo?.size && <div style={{ color: "#888", fontSize: 11 }}>{formatFileSize(fileInfo.size)}</div>}
          </div>
        )}

        {/* ── TEXT VIEW ────────────────────────────────────────────── */}
        {type === "text" && content !== null && (
          <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
            <pre
              style={{
                margin: 0,
                padding: 16,
                color: "#d4d4d4",
                fontSize: `${fontSize}px`,
                fontFamily: 'Consolas, "Courier New", monospace',
                whiteSpace: lineWrap ? "pre-wrap" : "pre",
                wordBreak: lineWrap ? "break-word" : "normal",
                lineHeight: 1.5,
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
              background: "rgba(22, 22, 22, 0.92)",
              backdropFilter: "blur(8px)",
              border: "1px solid #383838",
              borderRadius: 6,
              padding: 14,
              fontSize: 11,
              color: "#ccc",
              boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
              zIndex: 20,
              minWidth: 240,
            }}
          >
            <div style={{ fontWeight: 700, color: "#fff", marginBottom: 8, fontSize: 12, borderBottom: "1px solid #333", paddingBottom: 4 }}>
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
            padding: "2px 10px",
            background: "#181818",
            borderTop: "1px solid #282828",
            fontSize: 10,
            color: "#777",
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
  color: "#bbb",
  borderRadius: 3,
  padding: "2px 6px",
  fontSize: 12,
  cursor: "pointer",
  outline: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
  transition: "background 0.1s, color 0.1s",
};

const dividerStyle = {
  width: 1,
  height: 14,
  background: "#333",
  margin: "0 2px",
};

const infoRowStyle = {
  display: "flex",
  marginBottom: 4,
  lineHeight: 1.4,
};

const infoLabelStyle = {
  color: "#888",
  width: 75,
  flexShrink: 0,
};

export default MediaViewer;
