const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUTFILES = [
  path.join(ROOT, 'electron/renderer/bundle.js'),
  path.join(ROOT, 'electron/renderer/bundle.css'),
];
// Renderer ke bahar ki cheezein jo bundle ko affect karti hain
const EXTRA_INPUTS = [
  path.join(ROOT, 'package.json'),
  path.join(ROOT, 'package-lock.json'),
  path.join(ROOT, 'build/build-renderer.cjs'),
  path.join(ROOT, 'build/vscode-url-fix.cjs'),
];
const SKIP_OUTPUTS = new Set(['bundle.js', 'bundle.css']);

function walkMaxMtime(dir, skipOutputs) {
  let max = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const m = walkMaxMtime(p, skipOutputs);
      if (m > max) max = m;
    } else if (e.isFile()) {
      if (skipOutputs && SKIP_OUTPUTS.has(e.name)) continue;
      try {
        const m = fs.statSync(p).mtimeMs;
        if (m > max) max = m;
      } catch {}
    }
  }
  return max;
}

async function main() {
  const force = process.argv.includes('--force') || process.env.IBX_FORCE_BUILD === '1';
  if (!force) {
    try {
      const outTimes = OUTFILES.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } });
      if (outTimes.every((t) => t > 0)) {
        const minOut = Math.min(...outTimes);
        let maxIn = walkMaxMtime(path.join(ROOT, 'electron/renderer'), true);
        for (const f of EXTRA_INPUTS) {
          try {
            const m = fs.statSync(f).mtimeMs;
            if (m > maxIn) maxIn = m;
          } catch {}
        }
        if (maxIn <= minOut) {
          console.log('[build:renderer] up-to-date — skipping (IBX_FORCE_BUILD=1 or --force to rebuild)');
          return;
        }
      }
    } catch {}
  }
  console.log('[build:renderer] bundling renderer (156MB — pehli baar / changes par 1-3 min lag sakta hai)…');
  const t0 = Date.now();
  await esbuild.build({
    entryPoints: ['electron/renderer/index.jsx'],
    bundle: true,
    outfile: 'electron/renderer/bundle.js',
    platform: 'browser',
    // "production" first so @excalidraw/excalidraw's "./index.css"
    // (development/production only) resolves to dist/prod/index.css.
    conditions: ['production', 'browser', 'import', 'module', 'default'],
    // automatic JSX runtime: vendored AI Elements (.tsx) don't import React
    // for JSX; existing .jsx files keep working unchanged.
    jsx: 'automatic',
    loader: {
      '.css': 'css',
      '.jsx': 'jsx',
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.svg': 'dataurl',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.jpeg': 'dataurl',
      '.gif': 'dataurl',
      '.ttf': 'dataurl',
      '.otf': 'dataurl',
      '.woff': 'dataurl',
      '.woff2': 'dataurl',
      '.eot': 'dataurl',
    },
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    external: ['node:fs/promises', 'node:fs', 'node:path'],
    logLevel: 'info',
  });
  console.log(`[build:renderer] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch(() => process.exit(1));
