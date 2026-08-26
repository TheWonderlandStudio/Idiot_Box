// Copies the extension-host iframe document from the monaco-vscode-api
// extensions-service-override package into the renderer output folder,
// where the bundled code references it as ./worker/webWorkerExtensionHostIframe.html
//
// Patches: under file:// (Electron), postMessage event.origin is reported as
// "null" while window.origin reports "file://" — the stock iframe compares
// event.origin against the parentOrigin query param and silently drops the
// parent's bootstrap/init messages. Relax origin checks and allow ibx-file:.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const src = path.join(
  __dirname,
  "..",
  "node_modules",
  "@codingame",
  "monaco-vscode-extensions-service-override",
  "vscode",
  "src",
  "vs",
  "workbench",
  "services",
  "extensions",
  "worker",
  "webWorkerExtensionHostIframe.html"
);
const outDir = path.join(__dirname, "..", "electron", "renderer", "worker");
const out = path.join(outDir, "webWorkerExtensionHostIframe.html");

fs.mkdirSync(outDir, { recursive: true });

let s = fs.readFileSync(src, "utf8");

// Relax origin check for file:// (event.origin is "null")
s = s.replace(
  "if (event.origin !== parentOrigin || event.data.type !== bootstrapNlsType) {",
  "if (event.data.type !== bootstrapNlsType) {"
);
s = s.replace(
  "if (event.data.type !== bootstrapNlsType) {",
  "if (event.data.type !== bootstrapNlsType) { /* relaxed for file:// */"
);

// Allow ibx-file: / file: in postMessage and CSP
s = s.replace("}, parentOrigin, [data]);", `}, "*", [data]);`);
s = s.replace(
  "connect-src 'self' data: extension-file: https: wss:",
  "connect-src 'self' data: extension-file: ibx-file: file: https: wss:"
);
s = s.replace(
  "child-src 'self' data: blob:;",
  "object-src 'none'; child-src 'self' data: blob: ibx-file: file:;"
);
s = s.replace(
  "script-src 'self' 'unsafe-eval' 'sha256-",
  "script-src 'self' 'unsafe-eval' ibx-file: file: 'sha256-"
);

const script = s.match(/<script>([\s\S]*?)<\/script>/);
if (!script) throw new Error("Could not find inline script in ext-host iframe html");
const hash = crypto.createHash("sha256").update(Buffer.from(script[1], "utf8")).digest("base64");
s = s.replace(/'sha256-[A-Za-z0-9+/=]+'/, `'sha256-${hash}'`);

fs.writeFileSync(out, s);

// Also copy extensionHost.worker.js to worker/ for the iframe's ibx URL (worker/extensionHost.worker.js)
try {
  const workerSrc = path.join(__dirname, "..", "electron", "renderer", "extensionHost.worker.js");
  const workerDest = path.join(outDir, "extensionHost.worker.js");
  if (fs.existsSync(workerSrc)) {
    fs.copyFileSync(workerSrc, workerDest);
  }
} catch {}
