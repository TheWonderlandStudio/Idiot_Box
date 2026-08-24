const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const entry = path.join(__dirname, '..', 'electron', 'host', 'node-extension-host.js');

if (!fs.existsSync(entry)) {
  console.log('[build-node-host] Node extension host entry not present, skipping.');
  process.exit(0);
}

esbuild
  .build({
    entryPoints: [entry],
    bundle: true,
    outfile: 'electron/host/node-extension-host.bundle.mjs',
    platform: 'node',
    format: 'esm',
    target: 'node18',
    logLevel: 'info',
  })
  .catch(() => process.exit(1));

