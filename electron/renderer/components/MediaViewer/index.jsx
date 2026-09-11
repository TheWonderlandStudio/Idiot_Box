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

// ── Edit engine (canvas, zero deps, offline) ─────────────────────────────
const loadBitmap = (dataUrl) => new Promise((resolve, reject) => {
  try {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  } catch (e) { reject(e); }
});
const makeCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
const cloneCanvas = (src) => {
  const c = makeCanvas(src.width, src.height);
  c.getContext("2d").drawImage(src, 0, 0);
  return c;
};
// View rotation/flip ko bitmap me bake karo (edit space = display orientation)
const bakeView = (img, { rotation, flipH, flipV }) => {
  const rot = ((rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const c = makeCanvas(swap ? img.naturalHeight : img.naturalWidth, swap ? img.naturalWidth : img.naturalHeight);
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return c;
};
// Edge-seeded flood fill: border se jude tolerance-range pixels → transparent
const removeBackground = (srcCanvas, tolerance) => {
  const c = cloneCanvas(srcCanvas);
  const w = c.width, h = c.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const tol = tolerance * tolerance * 3;
  let r = 0, g = 0, b = 0, n = 0;
  const sample = (x, y) => { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; };
  for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { sample(0, y); sample(w - 1, y); }
  r /= n; g /= n; b /= n;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => { const p = y * w + x; if (!seen[p]) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const i = p * 4;
    if (d[i + 3] === 0) continue;
    const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
    if (dr * dr + dg * dg + db * db > tol) continue;
    d[i + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  ctx.putImageData(img, 0, 0);
  return c;
};
// Hex (#fff / #ffffff) → {r,g,b}
const hexToRgb = (hex) => {
  try {
    let h = String(hex || "").replace("#", "").trim();
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split("").map((ch) => ch + ch).join("");
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 255, g: 255, b: 255 };
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  } catch { return { r: 255, g: 255, b: 255 }; }
};
// Color-key: picked color se match karne wale SAARE pixels → transparent
const removeColorKey = (srcCanvas, rgb, tolerance) => {
  const c = cloneCanvas(srcCanvas);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const tol = tolerance * tolerance * 3;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const dr = d[i] - rgb.r, dg = d[i + 1] - rgb.g, db = d[i + 2] - rgb.b;
    if (dr * dr + dg * dg + db * db <= tol) d[i + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
  return c;
};
// Magic brush: brush stamps (canvas-px seeds) se connected similar-color
// region → transparent. Saare seeds ke colors sample karke EK BFS me match
// (har seed par alag BFS = lambi stroke par freeze ho jata).
const eraseSeeded = (srcCanvas, seeds, tolerance) => {
  const c = cloneCanvas(srcCanvas);
  const w = c.width, h = c.height;
  if (!seeds?.length) return c;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // Target colors — zyada seeds par stride sample (speed ke liye cap)
  const stride = Math.max(1, Math.floor(seeds.length / 16));
  const targets = [];
  for (let k = 0; k < seeds.length; k += stride) {
    const x = Math.min(w - 1, Math.max(0, Math.round(seeds[k].x)));
    const y = Math.min(h - 1, Math.max(0, Math.round(seeds[k].y)));
    const i = (y * w + x) * 4;
    if (d[i + 3] === 0) continue;
    targets.push([d[i], d[i + 1], d[i + 2]]);
  }
  if (!targets.length) { ctx.putImageData(img, 0, 0); return c; }
  const tol = tolerance * tolerance * 3;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (!seen[p]) { seen[p] = 1; stack.push(p); }
  };
  for (const s of seeds) push(Math.round(s.x), Math.round(s.y));
  const match = (i) => {
    for (let t = 0; t < targets.length; t++) {
      const dr = d[i] - targets[t][0], dg = d[i + 1] - targets[t][1], db = d[i + 2] - targets[t][2];
      if (dr * dr + dg * dg + db * db <= tol) return true;
    }
    return false;
  };
  while (stack.length) {
    const p = stack.pop();
    const i = p * 4;
    if (d[i + 3] === 0) continue;
    if (!match(i)) continue;
    d[i + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  ctx.putImageData(img, 0, 0);
  return c;
};
// Brightness/contrast/saturation + toggles (snapshot se re-render)
const applyFilters = (srcCanvas, f) => {
  const c = cloneCanvas(srcCanvas);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const bri = (Number(f.bri) || 0) * 2.55;
  const conF = (259 * ((Number(f.con) || 0) + 255)) / (255 * (259 - (Number(f.con) || 0)));
  const sat = (Number(f.sat) ?? 100) / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    r = conF * (r - 128) + 128 + bri;
    g = conF * (g - 128) + 128 + bri;
    b = conF * (b - 128) + 128 + bri;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sat;
    g = gray + (g - gray) * sat;
    b = gray + (b - gray) * sat;
    if (f.gray) { r = g = b = gray; }
    if (f.sepia) {
      const tr = 0.393 * r + 0.769 * g + 0.189 * b;
      const tg = 0.349 * r + 0.686 * g + 0.168 * b;
      const tb = 0.272 * r + 0.534 * g + 0.131 * b;
      r = tr; g = tg; b = tb;
    }
    if (f.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  ctx.putImageData(img, 0, 0);
  return c;
};
const cropCanvas = (src, rectNorm) => {
  const x = Math.round(rectNorm.x * src.width);
  const y = Math.round(rectNorm.y * src.height);
  const w = Math.round(rectNorm.w * src.width);
  const h = Math.round(rectNorm.h * src.height);
  const c = makeCanvas(Math.max(1, w), Math.max(1, h));
  c.getContext("2d").drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
  return c;
};
const resizeCanvas = (src, w, h) => {
  const c = makeCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
};
// Arbitrary-degree rotate (bounds expand) + flip bake
const rotateCanvas = (src, deg) => {
  const rad = ((Number(deg) || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const c = makeCanvas(src.width * cos + src.height * sin, src.width * sin + src.height * cos);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
};
const flipCanvas = (src, h, v) => {
  const c = cloneCanvas(src);
  const ctx = c.getContext("2d");
  ctx.save();
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.translate(h ? c.width : 0, v ? c.height : 0);
  ctx.scale(h ? -1 : 1, v ? -1 : 1);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  return c;
};

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

  // ── Image edit mode (canvas pipeline — original untouched until Save) ───
  const [editing,      setEditing]      = useState(false);
  const [editTool,     setEditTool]     = useState(null); // null | bg | filters | crop | resize
  const [dirty,        setDirty]        = useState(false);
  const [busy,         setBusy]         = useState(null);
  const [statusMsg,    setStatusMsg]    = useState(null);
  const [tolerance,    setTolerance]    = useState(32);
  // BG remover modes: edge (border flood) | color (picked color-key) | brush (magic brush stamps)
  const [bgMode,       setBgMode]       = useState("edge");
  const [bgColor,      setBgColor]      = useState("#ffffff");
  const [brushSize,    setBrushSize]    = useState(32); // display-px ring
  const brushSeedsRef    = useRef([]);   // canvas-px seed points (current stroke session)
  const brushPaintingRef = useRef(false);
  const brushLastRef     = useRef(null); // last canvas-px point (stroke interpolation)
  const brushPrevRef     = useRef(null); // last brush preview canvas (Apply fast-path)
  const brushRingRef     = useRef(null); // cursor ring (ref-driven, no re-render)
  const [fineDeg,      setFineDeg]      = useState(0);
  const [filters,      setFilters]      = useState({ bri: 0, con: 0, sat: 100, gray: false, sepia: false, invert: false });
  const [cropRatio,    setCropRatio]    = useState("free");
  const [cropRect,     setCropRect]     = useState(null); // stage-px {x,y,w,h} + imgRect snapshot
  const [resizePct,    setResizePct]    = useState(100);
  const origRef        = useRef(null);  // original dataURL
  const workRef        = useRef(null);  // current edited canvas
  const toolBaseRef    = useRef(null);  // snapshot for live sliders
  const hasAlphaRef    = useRef(false);
  const imgRef         = useRef(null);
  const previewRafRef  = useRef(0);
  const statusTimerRef = useRef(null);

  const flashEditStatus = useCallback((msg) => {
    setStatusMsg(msg);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => setStatusMsg(null), 3000);
  }, []);

  const filePathRef = useRef(null);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);
  const exportMime = useCallback(() => {
    if (hasAlphaRef.current) return "image/png";
    const e = ext(filePathRef.current || "");
    return (e === ".jpg" || e === ".jpeg") ? "image/jpeg" : "image/png";
  }, []);

  const showCanvas = useCallback((canvas) => {
    try {
      const mime = exportMime();
      setContent(canvas.toDataURL(mime, 0.92));
    } catch {}
  }, [exportMime]);
  // Slider drags ke liye rAF-throttled preview
  const previewSoon = useCallback((getCanvas) => {
    if (previewRafRef.current) return;
    previewRafRef.current = requestAnimationFrame(() => {
      previewRafRef.current = 0;
      try { showCanvas(getCanvas()); } catch {}
    });
  }, [showCanvas]);

  const clearEdits = useCallback(() => {
    origRef.current = null;
    workRef.current = null;
    toolBaseRef.current = null;
    hasAlphaRef.current = false;
    setEditing(false);
    setEditTool(null);
    setDirty(false);
    setBusy(null);
    setTolerance(32);
    setBgMode("edge");
    setBgColor("#ffffff");
    setBrushSize(32);
    brushSeedsRef.current = [];
    brushPaintingRef.current = false;
    brushLastRef.current = null;
    brushPrevRef.current = null;
    setFineDeg(0);
    setFilters({ bri: 0, con: 0, sat: 100, gray: false, sepia: false, invert: false });
    setCropRatio("free");
    setCropRect(null);
    setResizePct(100);
  }, []);

  // ── Metadata & Media specific states ──────────────────────────────────────
  const [fileInfo,     setFileInfo]     = useState(null);
  const [showInfo,     setShowInfo]     = useState(false);
  const [fontSize,     setFontSize]     = useState(13);
  const [lineWrap,     setLineWrap]     = useState(true);
  const [videoSpeed,   setVideoSpeed]   = useState(1.0);
  const [videoMuted,   setVideoMuted]   = useState(false);

  const containerRef = useRef(null);
  // Viewport = position:relative wala stage jiske andar crop overlay/selection
  // render hote hain. Saari crop/resize math isi ke space me hoti hai —
  // containerRef (root panel) use karne par header/editbar ki height ka offset
  // aa jata tha aur selection box cursor se hatkar dikhta tha.
  const viewportRef  = useRef(null);
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

  // ── Edit mode entry/exit + tool operations ───────────────────────────────
  const enterEdit = useCallback(async () => {
    if (type !== "image" || !content) return;
    setBusy("Loading…");
    try {
      const img = await loadBitmap(origRef.current || content);
      if (!origRef.current) origRef.current = content;
      let canvas = bakeView(img, { rotation, flipH, flipV });
      // Huge images ko 16MP par cap karo taaki ops hang na karein
      const px = canvas.width * canvas.height;
      if (px > 16_000_000) {
        const k = Math.sqrt(16_000_000 / px);
        canvas = resizeCanvas(canvas, canvas.width * k, canvas.height * k);
        flashEditStatus(`Large image — working at ${canvas.width}×${canvas.height}`);
      }
      workRef.current = canvas;
      setRotation(0); setFlipH(false); setFlipV(false);
      setEditing(true);
      setEditTool(null);
      setDirty(false);
      setBgMode("edge");
      setBgColor("#ffffff");
      setBrushSize(32);
      brushSeedsRef.current = [];
      brushPaintingRef.current = false;
      brushLastRef.current = null;
      brushPrevRef.current = null;
      showCanvas(canvas);
    } catch {
      flashEditStatus("Could not load image for editing");
    } finally {
      setBusy(null);
    }
  }, [type, content, rotation, flipH, flipV, showCanvas, flashEditStatus]);

  const exitEdit = useCallback(() => {
    setEditTool(null);
    setCropRect(null);
    setEditing(false);
  }, []);

  const resetEdits = useCallback(() => {
    if (!origRef.current) return;
    workRef.current = null;
    toolBaseRef.current = null;
    hasAlphaRef.current = false;
    setDirty(false);
    setEditTool(null);
    setCropRect(null);
    setTolerance(32);
    setBgMode("edge");
    setBgColor("#ffffff");
    setBrushSize(32);
    brushSeedsRef.current = [];
    brushPaintingRef.current = false;
    brushLastRef.current = null;
    brushPrevRef.current = null;
    setFineDeg(0);
    setFilters({ bri: 0, con: 0, sat: 100, gray: false, sepia: false, invert: false });
    setResizePct(100);
    setContent(origRef.current);
    flashEditStatus("Edits reset");
  }, [flashEditStatus]);

  // Tool kholo → live sliders ke liye snapshot lo
  const openTool = useCallback((t) => {
    // Bina-apply switch par preview wapas work state par lao
    if (workRef.current && (editTool === "bg" || editTool === "filters" || editTool === "rotate")) {
      try { showCanvas(workRef.current); } catch {}
    }
    setCropRect(null);
    // Brush stroke session hamesha tool switch par discard (stale seeds se bacho)
    brushSeedsRef.current = [];
    brushPaintingRef.current = false;
    brushLastRef.current = null;
    brushPrevRef.current = null;
    if (t === "rotate") setFineDeg(0);
    if (workRef.current && (t === "bg" || t === "filters" || t === "rotate")) toolBaseRef.current = cloneCanvas(workRef.current);
    else toolBaseRef.current = null;
    setEditTool((prev) => (prev === t ? null : t));
  }, [editTool, showCanvas]);

  // BG remover: slider = live preview, Apply = commit
  const previewBg = useCallback((tol) => {
    if (!toolBaseRef.current) return;
    previewSoon(() => removeBackground(toolBaseRef.current, tol));
  }, [previewSoon]);
  const applyBg = useCallback(() => {
    if (!toolBaseRef.current) return;
    setBusy("Removing…");
    setTimeout(() => {
      try {
        workRef.current = removeBackground(toolBaseRef.current, tolerance);
        hasAlphaRef.current = true;
        setDirty(true);
        toolBaseRef.current = cloneCanvas(workRef.current);
        showCanvas(workRef.current);
        flashEditStatus("Background removed — Save to keep");
      } finally { setBusy(null); }
    }, 30);
  }, [tolerance, showCanvas, flashEditStatus]);

  // BG remover — Color mode: picked color-key, slider = live preview, Apply = commit
  const previewBgColor = useCallback((hex, tol) => {
    if (!toolBaseRef.current) return;
    const rgb = hexToRgb(hex);
    previewSoon(() => removeColorKey(toolBaseRef.current, rgb, tol));
  }, [previewSoon]);
  const applyBgColor = useCallback(() => {
    if (!toolBaseRef.current) return;
    setBusy("Removing…");
    setTimeout(() => {
      try {
        workRef.current = removeColorKey(toolBaseRef.current, hexToRgb(bgColor), tolerance);
        hasAlphaRef.current = true;
        setDirty(true);
        toolBaseRef.current = cloneCanvas(workRef.current);
        showCanvas(workRef.current);
        flashEditStatus("Color removed — Save to keep");
      } finally { setBusy(null); }
    }, 30);
  }, [bgColor, tolerance, showCanvas, flashEditStatus]);

  // BG remover — Magic brush: image par drag → connected similar area erase
  // Client px → canvas px (displayed img rect se map; zoom/pan safe)
  const toCanvasPt = useCallback((clientX, clientY) => {
    const img = imgRef.current, base = toolBaseRef.current;
    if (!img || !base) return null;
    const r = img.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: ((clientX - r.left) / r.width) * base.width,
      y: ((clientY - r.top) / r.height) * base.height,
      scale: base.width / r.width,
    };
  }, []);
  // rAF callback fire-time par seeds padhta hai — pending frame ke dauran aaye
  // stamps bhi preview me aa jate hain (koi stroke drop nahi hota)
  const previewBrush = useCallback((tolOverride) => {
    const base = toolBaseRef.current;
    if (!base || !brushSeedsRef.current.length) return;
    const tol = tolOverride ?? tolerance;
    previewSoon(() => {
      const out = eraseSeeded(base, [...brushSeedsRef.current], tol);
      brushPrevRef.current = out;
      return out;
    });
  }, [previewSoon, tolerance]);
  // Stroke ke beech gaps na rahein — last point se interpolate karke seeds dalo
  const stampBrushSeed = useCallback((clientX, clientY) => {
    if (!toolBaseRef.current) return;
    const pt = toCanvasPt(clientX, clientY);
    if (!pt) return;
    const last = brushLastRef.current;
    if (last) {
      const dx = pt.x - last.x, dy = pt.y - last.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.min(64, Math.max(2, (brushSize * pt.scale) / 4));
      const n = Math.floor(dist / step);
      for (let k = 1; k <= n; k++) {
        brushSeedsRef.current.push({ x: last.x + (dx * k) / n, y: last.y + (dy * k) / n });
      }
    } else {
      brushSeedsRef.current.push({ x: pt.x, y: pt.y });
    }
    brushLastRef.current = pt;
    previewBrush();
  }, [toCanvasPt, brushSize, previewBrush]);
  const applyBrush = useCallback(() => {
    if (!toolBaseRef.current || !brushSeedsRef.current.length) return;
    setBusy("Removing…");
    setTimeout(() => {
      try {
        const out = brushPrevRef.current || eraseSeeded(toolBaseRef.current, brushSeedsRef.current, tolerance);
        workRef.current = out;
        hasAlphaRef.current = true;
        setDirty(true);
        brushSeedsRef.current = [];
        brushPrevRef.current = null;
        brushLastRef.current = null;
        toolBaseRef.current = cloneCanvas(workRef.current);
        showCanvas(workRef.current);
        flashEditStatus("Background brushed out — Save to keep");
      } finally { setBusy(null); }
    }, 30);
  }, [tolerance, showCanvas, flashEditStatus]);
  // Mode switch: stale seeds discard + preview wapas tool snapshot par
  const switchBgMode = useCallback((m) => {
    if (m === bgMode) return;
    brushSeedsRef.current = [];
    brushPrevRef.current = null;
    brushPaintingRef.current = false;
    brushLastRef.current = null;
    if (toolBaseRef.current) { try { showCanvas(toolBaseRef.current); } catch {} }
    setBgMode(m);
  }, [bgMode, showCanvas]);
  // Brush ring (cursor) — ref-driven, mousemove par re-render nahi hota
  const moveBrushRing = useCallback((e) => {
    const ring = brushRingRef.current;
    if (!ring) return;
    const st = e.currentTarget?.getBoundingClientRect();
    if (!st) return;
    ring.style.display = "block";
    ring.style.left = `${e.clientX - st.left}px`;
    ring.style.top = `${e.clientY - st.top}px`;
  }, []);
  const hideBrushRing = useCallback(() => {
    if (brushRingRef.current) brushRingRef.current.style.display = "none";
  }, []);
  const handleBrushDown = useCallback((e) => {
    if (e.button !== 0 || !toolBaseRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    brushPaintingRef.current = true;
    brushLastRef.current = null;
    stampBrushSeed(e.clientX, e.clientY);
  }, [stampBrushSeed]);
  const handleBrushMove = useCallback((e) => {
    e.preventDefault();
    moveBrushRing(e);
    if (!brushPaintingRef.current) return;
    stampBrushSeed(e.clientX, e.clientY);
  }, [moveBrushRing, stampBrushSeed]);
  const endBrushStroke = useCallback(() => {
    brushPaintingRef.current = false;
    brushLastRef.current = null;
    hideBrushRing();
  }, [hideBrushRing]);

  // Filters: live preview, Apply = commit
  const previewFilters = useCallback((f) => {
    if (!toolBaseRef.current) return;
    previewSoon(() => applyFilters(toolBaseRef.current, f));
  }, [previewSoon]);
  const applyFiltersWork = useCallback(() => {
    if (!toolBaseRef.current) return;
    workRef.current = applyFilters(toolBaseRef.current, filters);
    setDirty(true);
    toolBaseRef.current = cloneCanvas(workRef.current);
    showCanvas(workRef.current);
    flashEditStatus("Filters applied — Save to keep");
  }, [filters, showCanvas, flashEditStatus]);

  // Crop: overlay drag → normalized rect → Apply
  const applyCrop = useCallback(() => {
    if (!workRef.current || !cropRect?.norm) return;
    workRef.current = cropCanvas(workRef.current, cropRect.norm);
    setDirty(true);
    setCropRect(null);
    setEditTool(null);
    showCanvas(workRef.current);
    flashEditStatus(`Cropped to ${workRef.current.width}×${workRef.current.height} — Save to keep`);
  }, [cropRect, showCanvas, flashEditStatus]);

  // Resize: % slider → Apply
  const applyResize = useCallback(() => {
    if (!workRef.current) return;
    const k = Math.max(1, Math.min(800, Number(resizePct) || 100)) / 100;
    workRef.current = resizeCanvas(workRef.current, workRef.current.width * k, workRef.current.height * k);
    setDirty(true);
    setEditTool(null);
    showCanvas(workRef.current);
    flashEditStatus(`Resized to ${workRef.current.width}×${workRef.current.height} — Save to keep`);
  }, [resizePct, showCanvas, flashEditStatus]);

  // Rotate/flip bake — steps turant commit, fine slider live + Apply
  const bakeOp = useCallback((fn, msg) => {
    if (!workRef.current) return;
    setBusy("Working…");
    setTimeout(() => {
      try {
        workRef.current = fn(cloneCanvas(workRef.current));
        toolBaseRef.current = cloneCanvas(workRef.current);
        setFineDeg(0);
        setDirty(true);
        showCanvas(workRef.current);
        flashEditStatus(msg || "Applied — Save to keep");
      } finally { setBusy(null); }
    }, 20);
  }, [showCanvas, flashEditStatus]);
  const rotateStep = useCallback((deg) => {
    bakeOp((c) => rotateCanvas(c, deg), `Rotated ${deg}° — Save to keep`);
  }, [bakeOp]);
  const flipBake = useCallback((h) => {
    bakeOp((c) => flipCanvas(c, h, !h), h ? "Flipped ↔ — Save to keep" : "Flipped ↕ — Save to keep");
  }, [bakeOp]);
  const previewFine = useCallback((deg) => {
    if (!toolBaseRef.current) return;
    previewSoon(() => rotateCanvas(toolBaseRef.current, deg));
  }, [previewSoon]);
  const applyFine = useCallback(() => {
    if (!toolBaseRef.current) return;
    workRef.current = rotateCanvas(toolBaseRef.current, fineDeg);
    setDirty(true);
    toolBaseRef.current = cloneCanvas(workRef.current);
    setFineDeg(0);
    showCanvas(workRef.current);
    flashEditStatus("Rotation applied — Save to keep");
  }, [fineDeg, showCanvas, flashEditStatus]);

  // Save (overwrite — same file). JPG me transparency nahi jati, isliye
  // wahan white par flatten karke save hota hai (note ke saath).
  const handleSave = useCallback(async () => {
    if (!workRef.current || !filePath) return;
    setBusy("Saving…");
    try {
      const e = ext(filePath);
      const jpgTarget = e === ".jpg" || e === ".jpeg";
      let url;
      let note = "";
      if (hasAlphaRef.current && jpgTarget) {
        const flat = makeCanvas(workRef.current.width, workRef.current.height);
        const fctx = flat.getContext("2d");
        fctx.fillStyle = "#ffffff";
        fctx.fillRect(0, 0, flat.width, flat.height);
        fctx.drawImage(workRef.current, 0, 0);
        url = flat.toDataURL("image/jpeg", 0.92);
        note = " (flattened on white — Save As PNG for transparency)";
      } else {
        const mime = hasAlphaRef.current ? "image/png" : (jpgTarget ? "image/jpeg" : "image/png");
        url = workRef.current.toDataURL(mime, 0.92);
      }
      const res = await window.electronAPI.saveImage(filePath, url);
      if (res?.ok) {
        origRef.current = url;
        setDirty(false);
        flashEditStatus(`Saved ✓${note}`);
        try {
          const stats = await window.electronAPI.stat(filePath);
          if (stats?.exists) setFileInfo((prev) => ({ ...prev, size: stats.size, mtime: stats.mtime ? new Date(stats.mtime).toLocaleString() : null }));
        } catch {}
      } else {
        flashEditStatus(`Save failed: ${res?.error || "unknown"}`);
      }
    } catch (err) {
      flashEditStatus(`Save failed: ${err?.message || err}`);
    } finally {
      setBusy(null);
    }
  }, [filePath, flashEditStatus]);

  const handleSaveAs = useCallback(async () => {
    if (!workRef.current) return;
    setBusy("Saving…");
    try {
      const mime = exportMime();
      const url = workRef.current.toDataURL(mime, 0.92);
      const base = fileName(filePath).replace(/\.[^.]+$/, "") || "image";
      const defExt = mime === "image/png" ? "png" : "jpg";
      const res = await window.electronAPI.saveImageAs(filePath, url, `${base}-edited.${defExt}`);
      if (res?.ok) {
        flashEditStatus(`Saved ✓ ${fileName(res.path)}`);
        try { window.dispatchEvent(new CustomEvent("media-viewer:open", { detail: { path: res.path } })); } catch {}
      } else if (!res?.canceled) {
        flashEditStatus(`Save failed: ${res?.error || "unknown"}`);
      }
    } catch (err) {
      flashEditStatus(`Save failed: ${err?.message || err}`);
    } finally {
      setBusy(null);
    }
  }, [filePath, exportMime, flashEditStatus]);

  // ── Open file handler ─────────────────────────────────────────────────────
  const openFile = useCallback(async (fp) => {
    if (!fp) return;
    setError(null);
    setContent(null);
    setType(null);
    setFileInfo(null);
    clearEdits();
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
  }, [resetTransform, clearEdits]);

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
    clearEdits();
    resetTransform();
  }, [resetTransform, clearEdits]);

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

  // ── Pan / Mouse Drag (crop tool me overlay sambhalta hai) ────────────────
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0 || (type !== "image" && type !== "video")) return;
    if (editing && editTool === "crop") return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  }, [type, pan, editing, editTool]);

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

  // ── Visual resizer: image corner handle drag → live preview ────────────
  const [rsGeom, setRsGeom] = useState(null); // img geom snapshot (stage px)
  const rsDragRef = useRef(null);
  // NOTE: cropGeom yahin define hai — neeche useEffect dep-array me use hota hai.
  // Pehle ye neeche declare tha → TDZ ReferenceError → "Error rendering component".
  const cropGeom = useCallback(() => {
    try {
      const img = imgRef.current;
      const stage = viewportRef.current;
      if (!img || !stage) return null;
      const r = img.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
    } catch { return null; }
  }, []);
  useEffect(() => {
    if (editTool !== "resize") { setRsGeom(null); return; }
    let tries = 0, raf = 0, dead = false;
    const measure = () => {
      if (dead) return;
      const g = cropGeom();
      if (g && g.w > 4 && g.h > 4) { setRsGeom(g); return; }
      if (++tries < 10) raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => { dead = true; try { cancelAnimationFrame(raf); } catch {} };
  }, [editTool, zoom, pan, content, cropGeom]);
  const handleResizeDown = useCallback((e) => {
    if (e.button !== 0 || !workRef.current || !rsGeom) return;
    e.preventDefault();
    e.stopPropagation();
    toolBaseRef.current = cloneCanvas(workRef.current);
    const stage = viewportRef.current?.getBoundingClientRect();
    if (!stage) return;
    const ox = rsGeom.x, oy = rsGeom.y;
    const sx = e.clientX - stage.left, sy = e.clientY - stage.top;
    const d0 = Math.max(8, Math.hypot(sx - ox, sy - oy));
    const startPct = Number(resizePct) || 100;
    rsDragRef.current = { ox, oy, d0, startPct };
    const onMove = (ev) => {
      const d = rsDragRef.current;
      if (!d) return;
      const st = viewportRef.current?.getBoundingClientRect();
      if (!st || !toolBaseRef.current) return;
      try { ev.preventDefault(); } catch {}
      const dist = Math.hypot(ev.clientX - st.left - d.ox, ev.clientY - st.top - d.oy);
      const pct = Math.max(1, Math.min(800, Math.round(d.startPct * (dist / d.d0))));
      setResizePct(pct);
      const base = toolBaseRef.current;
      previewSoon(() => resizeCanvas(base, (base.width * pct) / 100, (base.height * pct) / 100));
    };
    const onUp = () => {
      rsDragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rsGeom, resizePct, previewSoon]);
  // ── Crop overlay drag (stage-px rect + img snapshot → normalized on Apply) ─
  const cropDragRef = useRef(null);
  const cropRectRef = useRef(null);
  useEffect(() => { cropRectRef.current = cropRect; }, [cropRect]);
  const constrainRatio = useCallback((x0, y0, x1, y1) => {
    let w = x1 - x0, h = y1 - y0;
    const ratio = cropRatio === "1:1" ? 1 : cropRatio === "16:9" ? 16 / 9 : cropRatio === "4:3" ? 4 / 3 : null;
    if (ratio) {
      if (Math.abs(w) / Math.abs(h || 1) > ratio) w = Math.sign(w || 1) * Math.abs(h) * ratio;
      else h = Math.sign(h || 1) * Math.abs(w) / ratio;
    }
    return {
      x: Math.min(x0, x0 + w),
      y: Math.min(y0, y0 + h),
      w: Math.abs(w),
      h: Math.abs(h),
    };
  }, [cropRatio]);
  const handleCropDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const g = cropGeom();
    const stage = viewportRef.current?.getBoundingClientRect();
    if (!g || !stage || g.w < 4 || g.h < 4) return;
    const sx = e.clientX - stage.left, sy = e.clientY - stage.top;
    // Existing rect ke andar click = MOVE, bahar = nayi selection
    const cur = cropRectRef.current;
    if (cur && cur.w > 4 && cur.h > 4
        && sx >= cur.x && sx <= cur.x + cur.w && sy >= cur.y && sy <= cur.y + cur.h) {
      cropDragRef.current = { mode: "move", dx: sx - cur.x, dy: sy - cur.y, orig: { ...cur }, g };
      return;
    }
    cropDragRef.current = { mode: "new", x0: sx, y0: sy, g };
    setCropRect({ x: sx, y: sy, w: 0, h: 0, norm: null });
  }, [cropGeom]);
  const handleCropMove = useCallback((e) => {
    const d = cropDragRef.current;
    if (!d) return;
    e.preventDefault();
    const stage = viewportRef.current?.getBoundingClientRect();
    if (!stage) return;
    const sx = e.clientX - stage.left, sy = e.clientY - stage.top;
    if (d.mode === "move") {
      // Poora rect uthao — img bounds me clamp
      const w = d.orig.w, h = d.orig.h;
      const x = Math.min(Math.max(sx - d.dx, d.g.x), d.g.x + d.g.w - w);
      const y = Math.min(Math.max(sy - d.dy, d.g.y), d.g.y + d.g.h - h);
      const nx = (x - d.g.x) / d.g.w, ny = (y - d.g.y) / d.g.h;
      setCropRect({ x, y, w, h, norm: { x: nx, y: ny, w: w / d.g.w, h: h / d.g.h } });
      return;
    }
    if (d.mode === "nw" || d.mode === "ne" || d.mode === "sw" || d.mode === "se") {
      // Opposite corner fixed, ye corner cursor ke saath
      const fx = d.mode[1] === "w" ? d.orig.x + d.orig.w : d.orig.x;
      const fy = d.mode[0] === "n" ? d.orig.y + d.orig.h : d.orig.y;
      const r = constrainRatio(fx, fy, sx, sy);
      const nx = Math.min(Math.max((r.x - d.g.x) / d.g.w, 0), 1);
      const ny = Math.min(Math.max((r.y - d.g.y) / d.g.h, 0), 1);
      const nx2 = Math.min(Math.max((r.x + r.w - d.g.x) / d.g.w, 0), 1);
      const ny2 = Math.min(Math.max((r.y + r.h - d.g.y) / d.g.h, 0), 1);
      setCropRect({ ...r, norm: { x: nx, y: ny, w: Math.max(0, nx2 - nx), h: Math.max(0, ny2 - ny) } });
      return;
    }
    const r = constrainRatio(d.x0, d.y0, sx, sy);
    const nx = Math.min(Math.max((r.x - d.g.x) / d.g.w, 0), 1);
    const ny = Math.min(Math.max((r.y - d.g.y) / d.g.h, 0), 1);
    const nx2 = Math.min(Math.max((r.x + r.w - d.g.x) / d.g.w, 0), 1);
    const ny2 = Math.min(Math.max((r.y + r.h - d.g.y) / d.g.h, 0), 1);
    setCropRect({ ...r, norm: { x: nx, y: ny, w: Math.max(0, nx2 - nx), h: Math.max(0, ny2 - ny) } });
  }, [constrainRatio]);
  const handleCropUp = useCallback(() => {
    const d = cropDragRef.current;
    cropDragRef.current = null;
    if (!d) return;
    // bahut chhota drag = cancel (sirf nayi selection par)
    if (d.mode === "new") {
      setCropRect((prev) => (prev && prev.w > 6 && prev.h > 6 ? prev : null));
    }
  }, []);
  // Corner handle drag start (move/resize visual)
  const handleHandleDown = useCallback((e, which) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = cropRectRef.current;
    const g = cropGeom();
    if (!cur || !g || cur.w < 4 || cur.h < 4) return;
    cropDragRef.current = { mode: which, orig: { ...cur }, g };
  }, [cropGeom]);

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

  // NOTE: keyboard shortcuts intentionally nahi hain — sab kuch buttons +
  // right-click menu se hota hai (keys dusre panels se takrati thin).

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
                  title="Zoom Out"
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
                  title="Zoom In"
                  style={btnStyle}
                >
                  +
                </button>
                <div style={dividerStyle} />

                <button
                  onClick={handleFitScreen}
                  title="Fit to Screen"
                  style={{ ...btnStyle, background: fitMode ? "var(--bg-thumb)" : "transparent" }}
                >
                  ⛶
                </button>
                {/* View rotate/flip edit mode me hidden — entry par bake ho chuke hain.
                    Edit me rotate/flip ke liye neeche Rotate tool use karo. */}
                {!editing && (
                  <>
                    <button
                      onClick={handleRotateLeft}
                      title="Rotate Left"
                      style={btnStyle}
                    >
                      ↶
                    </button>
                    <button
                      onClick={handleRotateRight}
                      title="Rotate Right"
                      style={btnStyle}
                    >
                      ↷
                    </button>
                    <button
                      onClick={handleFlipH}
                      title="Flip Horizontal"
                      style={{ ...btnStyle, background: flipH ? "var(--bg-thumb)" : "transparent" }}
                    >
                      ↔
                    </button>
                    <button
                      onClick={handleFlipV}
                      title="Flip Vertical"
                      style={{ ...btnStyle, background: flipV ? "var(--bg-thumb)" : "transparent" }}
                    >
                      ↕
                    </button>
                  </>
                )}
                <div style={dividerStyle} />
              </>
            )}
            {/* Image edit mode toggle */}
            {type === "image" && (
              <button
                onClick={() => (editing ? exitEdit() : enterEdit())}
                title={editing ? "Exit edit mode" : "Edit image — bg remover, filters, crop, resize"}
                style={{
                  ...btnStyle,
                  background: editing ? "var(--teal-a18)" : "transparent",
                  color: editing ? "var(--teal)" : undefined,
                  border: editing ? "1px solid var(--teal-a35)" : "1px solid transparent",
                  fontWeight: "var(--fw-bold)",
                  position: "relative",
                }}
              >
                ✎ Edit
                {dirty && (
                  <span style={{ position: "absolute", top: 2, right: 2, width: 6, height: 6, borderRadius: "var(--radius-round)", background: "var(--warning)" }} />
                )}
              </button>
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
              title="Close File"
              style={{ ...btnStyle, color: "var(--error-short)" }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Edit bar (image edit mode) ─────────────────────────────────── */}
      {editing && type === "image" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-6)",
            padding: "var(--space-4) var(--space-10)",
            background: "var(--teal-a12)",
            borderBottom: "1px solid var(--teal-a25)",
            flexShrink: 0,
            fontSize: "var(--fs-small)",
            color: "var(--teal)",
            fontWeight: "var(--fw-semibold)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ letterSpacing: 0.4 }}>EDIT</span>
          {[
            { id: "bg", label: "BG Remove", title: "Background remover — tolerance slider" },
            { id: "filters", label: "Filters", title: "Brightness / contrast / saturation / effects" },
            { id: "crop", label: "Crop", title: "Drag on image to select area" },
            { id: "resize", label: "Resize", title: "Scale image %" },
            { id: "rotate", label: "Rotate", title: "90° steps, fine rotate, flip" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => openTool(t.id)}
              title={t.title}
              style={{
                ...btnStyle,
                background: editTool === t.id ? "var(--teal-a22)" : "transparent",
                color: editTool === t.id ? "var(--teal)" : "var(--text-bright)",
                border: "1px solid var(--teal-a35)",
                fontSize: "var(--fs-small)",
                fontWeight: "var(--fw-bold)",
              }}
            >
              {t.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {statusMsg && (
            <span style={{ color: "var(--text-highlight)", fontWeight: "var(--fw-medium)" }}>{statusMsg}</span>
          )}
          {dirty && (
            <button onClick={resetEdits} title="Discard all edits" style={{ ...btnStyle, fontSize: "var(--fs-small)", color: "var(--warning)" }}>
              Reset
            </button>
          )}
          <button onClick={handleSave} disabled={!dirty || !!busy} title="Overwrite original file" style={{ ...btnStyle, fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", opacity: !dirty || busy ? 0.45 : 1 }}>
            Save
          </button>
          <button onClick={handleSaveAs} disabled={!!busy} title="Save as new file" style={{ ...btnStyle, fontSize: "var(--fs-small)", fontWeight: "var(--fw-bold)", background: "var(--teal)", color: "var(--ink-on-teal)", border: "none" }}>
            Save As
          </button>
          <button onClick={exitEdit} title="Done" style={{ ...btnStyle, fontSize: "var(--fs-small)" }}>
            Done
          </button>
        </div>
      )}

      {/* ── Tool sub-panels ────────────────────────────────────────────── */}
      {editing && type === "image" && editTool === "bg" && (
        <div style={toolPanelStyle}>
          <span style={toolLabelStyle}>Background remover</span>
          {[
            { id: "edge", label: "Edge", title: "Border se juda background auto-cut" },
            { id: "color", label: "Color", title: "Picked color har jagah se hatao" },
            { id: "brush", label: "Magic Brush", title: "Image par drag karo — similar connected area erase hoga" },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => switchBgMode(m.id)}
              title={m.title}
              style={{ ...btnStyle, fontSize: "var(--fs-small)", background: bgMode === m.id ? "var(--teal-a22)" : "transparent", color: bgMode === m.id ? "var(--teal)" : "var(--text-bright)", border: "1px solid var(--teal-a35)", fontWeight: "var(--fw-bold)" }}
            >
              {m.label}
            </button>
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: "var(--text-bright)" }}>
            Tolerance
            <input
              type="range" min={0} max={150} value={tolerance}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTolerance(v);
                if (bgMode === "edge") previewBg(v);
                else if (bgMode === "color") previewBgColor(bgColor, v);
                else previewBrush(v);
              }}
              style={{ width: 130 }}
            />
            <span style={{ minWidth: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{tolerance}</span>
          </label>
          {bgMode === "edge" && (
            <span style={{ color: "var(--text-muted)" }}>Edge color cut hota hai — solid backgrounds par best</span>
          )}
          {bgMode === "color" && (
            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: "var(--text-bright)" }}>
              Pick color
              <input
                type="color" value={bgColor}
                onChange={(e) => { const h = e.target.value; setBgColor(h); previewBgColor(h, tolerance); }}
                style={{ width: 36, height: 22, padding: 0, border: "1px solid var(--teal-a35)", borderRadius: 4, background: "transparent", cursor: "pointer" }}
              />
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{bgColor}</span>
            </label>
          )}
          {bgMode === "brush" && (
            <label style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: "var(--text-bright)" }}>
              Brush
              <input
                type="range" min={8} max={120} value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                style={{ width: 110 }}
              />
              <span style={{ minWidth: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brushSize}</span>
            </label>
          )}
          {bgMode === "brush" && (
            <span style={{ color: "var(--text-muted)" }}>Image par drag karo — jahan paint hoga wahan ka similar connected area transparent</span>
          )}
          <span style={{ flex: 1 }} />
          <button
            onClick={() => { if (bgMode === "edge") applyBg(); else if (bgMode === "color") applyBgColor(); else applyBrush(); }}
            disabled={!!busy}
            style={toolBtnPrimary}
          >
            Apply
          </button>
        </div>
      )}
      {editing && type === "image" && editTool === "filters" && (
        <div style={toolPanelStyle}>
          <span style={toolLabelStyle}>Filters</span>
          {[
            { k: "bri", label: "Brightness", min: -100, max: 100 },
            { k: "con", label: "Contrast", min: -100, max: 100 },
            { k: "sat", label: "Saturation", min: 0, max: 200 },
          ].map((s) => (
            <label key={s.k} style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: "var(--text-bright)" }}>
              {s.label}
              <input
                type="range" min={s.min} max={s.max} value={filters[s.k]}
                onChange={(e) => { const f = { ...filters, [s.k]: Number(e.target.value) }; setFilters(f); previewFilters(f); }}
                style={{ width: 110 }}
              />
              <span style={{ minWidth: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{filters[s.k]}</span>
            </label>
          ))}
          {[
            { k: "gray", label: "B&W" },
            { k: "sepia", label: "Sepia" },
            { k: "invert", label: "Invert" },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => { const f = { ...filters, [t.k]: !filters[t.k] }; setFilters(f); previewFilters(f); }}
              style={{ ...btnStyle, fontSize: "var(--fs-small)", background: filters[t.k] ? "var(--teal-a22)" : "transparent", color: filters[t.k] ? "var(--teal)" : "var(--text-bright)", border: "1px solid var(--teal-a35)" }}
            >
              {t.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button onClick={applyFiltersWork} disabled={!!busy} style={toolBtnPrimary}>Apply</button>
        </div>
      )}
      {editing && type === "image" && editTool === "crop" && (
        <div style={toolPanelStyle}>
          <span style={toolLabelStyle}>Crop — image par drag karo</span>
          {["free", "1:1", "16:9", "4:3"].map((r) => (
            <button
              key={r}
              onClick={() => { setCropRatio(r); setCropRect(null); }}
              style={{ ...btnStyle, fontSize: "var(--fs-small)", background: cropRatio === r ? "var(--teal-a22)" : "transparent", color: cropRatio === r ? "var(--teal)" : "var(--text-bright)", border: "1px solid var(--teal-a35)" }}
            >
              {r}
            </button>
          ))}
          {cropRect?.norm && cropRect.norm.w > 0.005 && cropRect.norm.h > 0.005 && workRef.current && (
            <span style={{ color: "var(--text-highlight)", fontVariantNumeric: "tabular-nums" }}>
              {Math.round(cropRect.norm.w * workRef.current.width)}×{Math.round(cropRect.norm.h * workRef.current.height)}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={applyCrop} disabled={!cropRect?.norm || !(cropRect.norm.w > 0.005 && cropRect.norm.h > 0.005)} style={{ ...toolBtnPrimary, opacity: cropRect?.norm ? 1 : 0.45 }}>Apply crop</button>
        </div>
      )}
      {editing && type === "image" && editTool === "resize" && (
        <div style={toolPanelStyle}>
          <span style={toolLabelStyle}>Resize</span>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: "var(--text-bright)" }}>
            <input
              type="range" min={1} max={400} value={resizePct}
              onChange={(e) => setResizePct(Number(e.target.value))}
              style={{ width: 160 }}
            />
            <span style={{ minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{resizePct}%</span>
          </label>
          {workRef.current && (
            <span style={{ color: "var(--text-highlight)", fontVariantNumeric: "tabular-nums" }}>
              {workRef.current.width}×{workRef.current.height} → {Math.max(1, Math.round(workRef.current.width * resizePct / 100))}×{Math.max(1, Math.round(workRef.current.height * resizePct / 100))}
            </span>
          )}
          <span style={{ color: "var(--text-muted)" }}>slider ya corner handle drag karo</span>
          <span style={{ flex: 1 }} />
          <button onClick={applyResize} disabled={!!busy} style={toolBtnPrimary}>Apply</button>
        </div>
      )}
      {editing && type === "image" && editTool === "rotate" && (
        <div style={toolPanelStyle}>
          <span style={toolLabelStyle}>Rotate</span>
          <button onClick={() => rotateStep(-90)} disabled={!!busy} title="Rotate 90° left" style={toolBtnPrimary}>⟲ 90°</button>
          <button onClick={() => rotateStep(90)} disabled={!!busy} title="Rotate 90° right" style={toolBtnPrimary}>90° ⟳</button>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", color: "var(--text-bright)" }}>
            Fine
            <input
              type="range" min={-45} max={45} value={fineDeg}
              onChange={(e) => { const v = Number(e.target.value); setFineDeg(v); previewFine(v); }}
              style={{ width: 130 }}
            />
            <span style={{ minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fineDeg}°</span>
          </label>
          <button onClick={() => flipBake(true)} disabled={!!busy} title="Flip horizontal (baked)" style={{ ...btnStyle, fontSize: "var(--fs-small)", color: "var(--text-bright)", border: "1px solid var(--teal-a35)" }}>↔ Flip</button>
          <button onClick={() => flipBake(false)} disabled={!!busy} title="Flip vertical (baked)" style={{ ...btnStyle, fontSize: "var(--fs-small)", color: "var(--text-bright)", border: "1px solid var(--teal-a35)" }}>↕ Flip</button>
          <span style={{ flex: 1 }} />
          <button onClick={applyFine} disabled={!!busy || fineDeg === 0} style={{ ...toolBtnPrimary, opacity: fineDeg === 0 ? 0.45 : 1 }}>Apply {fineDeg}°</button>
        </div>
      )}

      {/* ── Main Media Display Canvas / Viewport ───────────────────── */}
      <div
        ref={viewportRef}
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
              ref={imgRef}
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

        {/* ── CROP OVERLAY ─────────────────────────────────────────────── */}
        {editing && type === "image" && editTool === "crop" && (
          <div
            onMouseDown={handleCropDown}
            onMouseMove={handleCropMove}
            onMouseUp={handleCropUp}
            onMouseLeave={handleCropUp}
            style={{
              position: "absolute", inset: 0, zIndex: "var(--z-popover)",
              cursor: "crosshair", background: "var(--overlay-a25)",
            }}
            title="Drag to select crop area"
          >
            {cropRect && cropRect.w > 2 && cropRect.h > 2 && (
              <div
                style={{
                  position: "absolute",
                  left: cropRect.x, top: cropRect.y, width: cropRect.w, height: cropRect.h,
                  border: "2px solid var(--teal)",
                  background: "transparent",
                  boxShadow: "0 0 0 9999px var(--overlay-a45)",
                  pointerEvents: "none",
                }}
              >
                {/* corner handles — inke upar alag layer me (pointer events on) */}
              </div>
            )}
            {cropRect && cropRect.w > 2 && cropRect.h > 2 && ["nw", "ne", "sw", "se"].map((h) => {
              const hx = h[1] === "w" ? cropRect.x - 7 : cropRect.x + cropRect.w - 7;
              const hy = h[0] === "n" ? cropRect.y - 7 : cropRect.y + cropRect.h - 7;
              const cursor = (h === "nw" || h === "se") ? "nwse-resize" : "nesw-resize";
              return (
                <div
                  key={h}
                  onMouseDown={(e) => handleHandleDown(e, h)}
                  title="Drag to resize selection"
                  style={{
                    position: "absolute", left: hx, top: hy, width: 14, height: 14,
                    background: "var(--teal)", border: "2px solid #fff", borderRadius: 3,
                    cursor, zIndex: 1,
                  }}
                />
              );
            })}
            {(!cropRect || cropRect.w <= 2) && (
              <div style={{
                position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
                background: "var(--bg-vscode)", color: "var(--text-bright)",
                fontSize: "var(--fs-small)", padding: "var(--space-4) var(--space-10)",
                borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)",
                pointerEvents: "none", whiteSpace: "nowrap",
              }}>
                Drag = select • inside drag = move • corners = resize
              </div>
            )}
          </div>
        )}

        {/* ── MAGIC BRUSH OVERLAY ────────────────────────────────────────── */}
        {editing && type === "image" && editTool === "bg" && bgMode === "brush" && (
          <div
            onMouseDown={handleBrushDown}
            onMouseMove={handleBrushMove}
            onMouseUp={endBrushStroke}
            onMouseLeave={endBrushStroke}
            style={{
              position: "absolute", inset: 0, zIndex: "var(--z-popover)",
              cursor: "none", background: "transparent",
            }}
            title="Magic brush — background par drag karo"
          >
            <div
              ref={brushRingRef}
              style={{
                position: "absolute", left: -100, top: -100,
                width: brushSize, height: brushSize,
                border: "2px solid var(--teal)", borderRadius: "50%",
                boxShadow: "0 0 0 1px rgba(0,0,0,0.45)",
                pointerEvents: "none", transform: "translate(-50%,-50%)",
                display: "none",
              }}
            />
            <div style={{
              position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
              background: "var(--bg-vscode)", color: "var(--text-bright)",
              fontSize: "var(--fs-small)", padding: "var(--space-4) var(--space-10)",
              borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)",
              pointerEvents: "none", whiteSpace: "nowrap",
            }}>
              Drag = magic erase • Tolerance se control karo
            </div>
          </div>
        )}

        {/* ── RESIZE HANDLE (visual drag) ──────────────────────────────── */}
        {editing && type === "image" && editTool === "resize" && rsGeom && (
          <div
            onMouseDown={handleResizeDown}
            title={`Drag to resize (now ${resizePct}%)`}
            style={{
              position: "absolute",
              left: rsGeom.x + rsGeom.w - 10,
              top: rsGeom.y + rsGeom.h - 10,
              width: 20, height: 20,
              background: "var(--teal)", border: "2px solid #fff", borderRadius: 5,
              cursor: "nwse-resize", zIndex: "var(--z-popover)",
            }}
          />
        )}

        {/* ── BUSY OVERLAY ─────────────────────────────────────────────── */}
        {busy && (
          <div style={{
            position: "absolute", inset: 0, zIndex: "var(--z-toast)",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--overlay-a45)", color: "var(--text-inverse)",
            fontSize: "var(--fs-body)", fontWeight: "var(--fw-semibold)",
          }}>
            {busy}
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

const toolPanelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-10)",
  padding: "var(--space-6) var(--space-10)",
  background: "var(--bg-vscode)",
  borderBottom: "1px solid var(--bg-active)",
  flexShrink: 0,
  fontSize: "var(--fs-small)",
  flexWrap: "wrap",
};

const toolLabelStyle = {
  fontWeight: "var(--fw-bold)",
  color: "var(--teal)",
  letterSpacing: 0.3,
  textTransform: "uppercase",
  fontSize: "var(--fs-tiny)",
};

const toolBtnPrimary = {
  ...btnStyle,
  fontSize: "var(--fs-small)",
  fontWeight: "var(--fw-bold)",
  background: "var(--teal)",
  color: "var(--ink-on-teal)",
  border: "none",
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
