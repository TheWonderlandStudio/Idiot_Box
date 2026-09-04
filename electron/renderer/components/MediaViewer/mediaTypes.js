// ─── MediaViewer shared media types ─────────────────────────────────────────
// Single source of truth for "is this a media file that Media Viewer can show?".
// Used by:
//   - MediaViewer/index.jsx      (actual rendering)
//   - renderer/index.jsx         (open-file-in-editor routing + drag-drop)
//   - Project/window/*          (click / double-click / Enter handling)
// Keep these lists in sync with MediaViewer/index.jsx.
// ─────────────────────────────────────────────────────────────────────────────

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".avif", ".tiff", ".tif", ".heic", ".heif"];
export const VIDEO_EXTS_SUPPORTED = [".mp4", ".webm", ".ogv"];
export const PDF_EXTS = [".pdf"];
export const AUDIO_EXTS = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma", ".opus", ".aiff", ".mid", ".midi"];

// Extensions grouped for routing: anything here auto-opens in Media Viewer
// when Settings → autoOpenMediaViewer is ON (default true).
export const MEDIA_VIEWER_EXTS = new Set([
  ...IMAGE_EXTS,
  ...VIDEO_EXTS_SUPPORTED,
  ...PDF_EXTS,
  ...AUDIO_EXTS,
]);

export const extOf = (p) => {
  try {
    if (!p) return "";
    const base = String(p).split(/[\\/]/).pop() || "";
    const idx = base.lastIndexOf(".");
    return idx > 0 ? base.slice(idx).toLowerCase() : "";
  } catch { return ""; }
};

// True if Media Viewer should handle this file on Project-panel click.
export const isMediaFile = (p) => MEDIA_VIEWER_EXTS.has(extOf(p));

// Async settings check — default true (auto-open ON) when key is missing.
export const shouldAutoOpenMediaViewer = async () => {
  try {
    const s = await window.electronAPI.readSettings();
    return s?.autoOpenMediaViewer !== false;
  } catch { return true; }
};

// Sync check against an already-loaded settings object (for sync event paths).
export const shouldAutoOpenMediaViewerSync = (settings) => {
  if (!settings || typeof settings !== "object") return true;
  return settings.autoOpenMediaViewer !== false;
};

export default { isMediaFile, shouldAutoOpenMediaViewer, shouldAutoOpenMediaViewerSync, MEDIA_VIEWER_EXTS };
