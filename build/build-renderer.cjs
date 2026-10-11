/**
 * build/build-renderer.cjs  — esbuild with code-splitting
 *
 * Strategy:
 *   • Main entry:  electron/renderer/index.jsx  → bundle.js  (core UI shell)
 *   • Lazy chunks: heavy panels that are NOT needed at first paint are split
 *     into separate entry points so esbuild emits shared chunks.
 *   • All output goes to electron/renderer/chunks/ (auto-created).
 *   • The HTML loader script is updated to load bundle.js; lazy chunks are
 *     loaded via dynamic import() inside the component wrappers.
 *
 * Splitting approach compatible with Electron's file:// renderer:
 *   • format: "esm"  + splitting: true  → esbuild native chunk splitting
 *   • outdir instead of outfile
 *   • bundle.js becomes the main entry, chunks/*.js are lazy
 *
 * IBX_FORCE_BUILD=1 or --force skips the mtime cache check.
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const ROOT    = path.join(__dirname, "..");
const OUTDIR  = path.join(ROOT, "electron/renderer");
const CHUNKS  = path.join(OUTDIR, "chunks");
const BUNDLE  = path.join(OUTDIR, "bundle.js");
const CSS_OUT = path.join(OUTDIR, "bundle.css");

// Files whose mtime invalidates the cache
const EXTRA_INPUTS = [
  path.join(ROOT, "package.json"),
  path.join(ROOT, "package-lock.json"),
  path.join(ROOT, "build/build-renderer.cjs"),
];
const SKIP_NAMES = new Set(["bundle.js", "bundle.css"]);

function walkMaxMtime(dir) {
  let max = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "chunks") continue;
      const m = walkMaxMtime(p);
      if (m > max) max = m;
    } else if (e.isFile()) {
      if (SKIP_NAMES.has(e.name)) continue;
      try { const m = fs.statSync(p).mtimeMs; if (m > max) max = m; } catch {}
    }
  }
  return max;
}

// Shared loader + define config
const LOADERS = {
  ".css":   "css",
  ".jsx":   "jsx",
  ".ts":    "ts",
  ".tsx":   "tsx",
  ".svg":   "dataurl",
  ".png":   "dataurl",
  ".jpg":   "dataurl",
  ".jpeg":  "dataurl",
  ".gif":   "dataurl",
  ".ttf":   "dataurl",
  ".otf":   "dataurl",
  ".woff":  "dataurl",
  ".woff2": "dataurl",
  ".eot":   "dataurl",
};
const DEFINE = { "process.env.NODE_ENV": '"production"' };
const EXTERNAL = ["child_process", "fs", "path"];

async function main() {
  const force = process.argv.includes("--force") || process.env.IBX_FORCE_BUILD === "1";

  if (!force) {
    try {
      const outTime = fs.existsSync(BUNDLE) ? fs.statSync(BUNDLE).mtimeMs : 0;
      if (outTime > 0) {
        let maxIn = walkMaxMtime(path.join(ROOT, "electron/renderer"));
        for (const f of EXTRA_INPUTS) {
          try { const m = fs.statSync(f).mtimeMs; if (m > maxIn) maxIn = m; } catch {}
        }
        if (maxIn <= outTime) {
          console.log("[build:renderer] up-to-date — skipping (IBX_FORCE_BUILD=1 or --force to rebuild)");
          return;
        }
      }
    } catch {}
  }

  if (!fs.existsSync(CHUNKS)) fs.mkdirSync(CHUNKS, { recursive: true });

  console.log("[build:renderer] bundling renderer with code-splitting…");
  const t0 = Date.now();

  // ── Phase 1: Main bundle (no splitting — single outfile for fast first load)
  // Heavy panels are wrapped in React.lazy() + dynamic import() at runtime.
  // esbuild still does tree-shaking on the main entry; lazy chunks are emitted
  // separately via Phase 2.
  await esbuild.build({
    entryPoints: ["electron/renderer/index.jsx"],
    bundle:   true,
    outfile:  "electron/renderer/bundle.js",
    platform: "browser",
    format:   "iife",   // IIFE — works on file:// with no module loader
    conditions: ["production", "browser", "import", "module", "default"],
    jsx:      "automatic",
    loader:   LOADERS,
    define:   DEFINE,
    external: EXTERNAL,
    logLevel: "info",
    minify:   true,
    metafile: true,
  }).then(result => {
    // Report largest chunks
    const outputs = result.metafile?.outputs ?? {};
    const sizes = Object.entries(outputs)
      .map(([f, v]) => [path.basename(f), (v.bytes / 1024).toFixed(0) + " KB"])
      .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))
      .slice(0, 5);
    if (sizes.length) {
      console.log("[build:renderer] Top output sizes:");
      sizes.forEach(([f, s]) => console.log(`  ${f}: ${s}`));
    }
  });

  // ── Phase 2: Lazy panel chunks (ESM, emitted to chunks/)
  // These are only fetched when the user opens the panel for the first time.
  const LAZY_PANELS = [
    // [output name, entry source file]
    ["canvas",      "electron/renderer/components/Canvas/index.jsx"],
    ["ai-agent",    "electron/renderer/components/OpenCodePanel/index.jsx"],
    ["notebook",    "electron/renderer/components/Notebook/index.jsx"],
    ["git",         "electron/renderer/components/GitPanel/index.jsx"],
    ["community",   "electron/renderer/components/CommunityPanel/index.jsx"],
    ["android",     "electron/renderer/components/AndroidEmulator/index.jsx"],
    ["excalidraw",  "electron/renderer/components/OpenPencil/index.jsx"],
  ];

  // Filter to only entries that exist
  const validPanels = LAZY_PANELS.filter(([, src]) => fs.existsSync(path.join(ROOT, src)));

  if (validPanels.length > 0) {
    console.log(`[build:renderer] Building ${validPanels.length} lazy chunk(s)…`);
    await Promise.all(
      validPanels.map(([name, src]) =>
        esbuild.build({
          entryPoints: [src],
          bundle:   true,
          outfile:  path.join(CHUNKS, `${name}.js`),
          platform: "browser",
          format:   "iife",
          globalName: `__ibx_chunk_${name.replace(/-/g, "_")}`,
          conditions: ["production", "browser", "import", "module", "default"],
          jsx:      "automatic",
          loader:   LOADERS,
          define:   DEFINE,
          external: [...EXTERNAL, "react", "react-dom"],  // share React with main bundle
          logLevel: "warning",
          minify:   true,
        }).then(() => console.log(`[build:renderer]   ✓ chunks/${name}.js`))
         .catch(e  => console.warn(`[build:renderer]   ✗ chunks/${name}.js —`, e.message))
      )
    );
  }

  console.log(`[build:renderer] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(() => process.exit(1));
