// Extension host worker entry — bundled by esbuild into extensionHost.worker.js.
// The VS Code extension host runs here (in a worker created inside the
// monaco-vscode-api iframe). Nested workers requested by extensions
// (language services etc.) are routed to our locally bundled workers.

globalThis.__ibxNativePost = self.postMessage.bind(self);
globalThis.__ibxProbe = (dbg) => {
  try { globalThis.__ibxNativePost({ __ibxProbe: true, dbg }); } catch {}
};

const workerFiles = {
  TextMateWorker: "./textmate.worker.js",
  TextEditorWorker: "./editor.worker.js",
  editorWorkerService: "./editor.worker.js",
  tsWorker: "./ts.worker.js",
  jsonWorker: "./json.worker.js",
  cssWorker: "./css.worker.js",
  htmlWorker: "./html.worker.js",
};

const workerBase = new URL(".", import.meta.url);

self.MonacoEnvironment = {
  getWorkerUrl: (_moduleId, label) =>
    new URL(workerFiles[label] || "./editor.worker.js", workerBase).toString(),
};

setTimeout(() => {
  console.log("[exthost-worker] worker script executed OK");
}, 3000);
self.addEventListener("error", (e) => {
  console.error("[exthost-worker] ERROR: " + (e.message || "") + " " + (e.error ? e.error.stack : ""));
});

import "@codingame/monaco-vscode-api/workers/extensionHost.worker";