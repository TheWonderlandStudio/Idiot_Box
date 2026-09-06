const esbuild = require('esbuild');
const vscodeUrlFix = require('./vscode-url-fix.cjs');

esbuild
  .build({
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
    plugins: [vscodeUrlFix],
    logLevel: 'info',
  })
  .catch(() => process.exit(1));
