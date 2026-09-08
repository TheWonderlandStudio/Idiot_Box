import React, { useState, useEffect, useRef } from "react";

// ─── Module-level URL cache: "name|isDir|isOpen" → URL string ────────────────
const urlCache = new Map();

const cacheKey = (name, isDir, isOpen) => `${name}|${isDir ? 1 : 0}|${isOpen ? 1 : 0}`;

// ── Fallback SVGs ─────────────────────────────────────────────────────────────
const FolderFallback = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <path style={{ fill: "var(--warn-gold)" }} d="M1 3.5A1.5 1.5 0 0 1 2.5 2h3.086a1.5 1.5 0 0 1 1.06.44L7.56 3.5H13.5A1.5 1.5 0 0 1 15 5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9Z" opacity="0.85"/>
  </svg>
);

const FileFallback = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <rect style={{ fill: "var(--icon-faint)" }} x="2" y="1" width="10" height="14" rx="1"/>
    <path style={{ stroke: "var(--text-secondary)" }} d="M8.5 1.5V5H12" fill="none" strokeWidth="0.8"/>
  </svg>
);

// ─── VscodeIcon ───────────────────────────────────────────────────────────────
// Renders the correct vscode-icons SVG for any file or folder name.
//
// Props:
//   name    — filename (e.g. "index.html") or folder name (e.g. "src")
//   isDir   — boolean
//   isOpen  — boolean (only meaningful when isDir=true)
//   size    — px size for the rendered <img> (default 16)
//   style   — optional inline style
// ─────────────────────────────────────────────────────────────────────────────
const VscodeIcon = ({ name, isDir = false, isOpen = false, size = 16, style }) => {
  const key = cacheKey(name, isDir, isOpen);
  const [url, setUrl] = useState(() => urlCache.get(key) ?? null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (url) return;
    window.electronAPI.getVscodeIcon(name, isDir, isOpen).then((resolved) => {
      if (resolved && mounted.current) {
        urlCache.set(key, resolved);
        setUrl(resolved);
      }
    });
    return () => { mounted.current = false; };
  }, [key]);

  if (!url) {
    return isDir
      ? <FolderFallback size={size} />
      : <FileFallback size={size} />;
  }

  return (
    <img
      src={url}
      width={size}
      height={size}
      alt=""
      draggable={false}
      style={{ objectFit: "contain", display: "block", ...style }}
    />
  );
};

export default VscodeIcon;
