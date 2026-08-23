// Copies the extension-host iframe document from the monaco-vscode-api
// extensions-service-override package into the renderer output folder,
// where the bundled code references it as ./worker/webWorkerExtensionHostIframe.html
//
// Patches: under file:// (Electron), postMessage event.origin is reported as
// "null" while window.origin reports "file://" — the stock iframe compares
// event.origin against the parentOrigin query param and silently drops the
// parent's bootstrap/init messages. Relax both origin equality checks and
// re-hash the inline script for the CSP meta tag.
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
s = s.replace(
  "if (event.origin !== parentOrigin || event.data.type !== bootstrapNlsType) {",
  "if (event.data.type !== bootstrapNlsType) {"
);
s = s.replace(
  "} else {\n\t\t\t\t\tworker.onerror = console.error.bind(console);\n\t\t\t\t\twindow.parent.postMessage({\n\t\t\t\t\t\tvscodeWebWorkerExtHostId,\n\t\t\t\t\t\tdata\n\t\t\t\t\t}, parentOrigin, [data]);\n\t\t\t\t}",
  `} else if (data && data.__ppooProbe) {
					window.parent.postMessage({
						vscodeWebWorkerExtHostId: "probe-" + vscodeWebWorkerExtHostId,
						probeType: "if",
						step: "worker-probe",
						msg: data.dbg
					}, "*");
				} else {
					worker.onerror = console.error.bind(console);
					window.parent.postMessage({
						vscodeWebWorkerExtHostId,
						data
					}, parentOrigin, [data]);
				}`
);
s = s.replace(
  "\t\t\tself.onmessage = (event) => {\n\t\t\t\tif (false) {\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tworker.postMessage(event.data, event.ports);\n\t\t\t};",
  `\t\t\tself.onmessage = (event) => {
				if (event.data && event.data.type) probePost({ step: "got-msg2", type: event.data.type });
				if (false) {
					return;
				}
				worker.postMessage(event.data, event.ports);
			};`
);
s = s.replace(
  "\t\twindow.parent.postMessage({\n\t\t\tvscodeWebWorkerExtHostId,\n\t\t\ttype: bootstrapNlsType\n\t\t}, '*');",
  `\t\twindow.parent.postMessage({
			vscodeWebWorkerExtHostId,
			type: bootstrapNlsType
		}, '*');
		const probePost = (extra) => window.parent.postMessage({ vscodeWebWorkerExtHostId: "probe-" + vscodeWebWorkerExtHostId, probeType: "if", ...extra }, "*");
		probePost({ step: "script-ran", origin: window.origin });
		setTimeout(() => probePost({ step: "alive-check", workerRef: !!globalThis.__ppooWorkerRef, href: location.href.slice(0, 80) }), 8000);
		(async () => {
			const wb = location.pathname.slice(0, location.pathname.lastIndexOf("/"));
			const urls = { ppooC: "ppoo-file:///C:/Users/Jignesh/Downloads/New%20folder%20(8)/electron/renderer/extensionHost.worker.js", ppooc: "ppoo-file://" + wb + "/extensionHost.worker.js" };
			for (const [tag, u] of Object.entries(urls)) {
				try {
					const r = await fetch(u);
					probePost({ step: "if-fetch", tag, status: r.status });
				} catch (e) { probePost({ step: "if-fetch-err", tag, err: String(e) }); }
				try {
					const tBlob = new Blob([\`import(\${JSON.stringify(u)}).then(() => self.postMessage("import-ok")).catch(e => self.postMessage("import-err:" + e.message));\`], { type: "application/javascript" });
					const tw = new Worker(URL.createObjectURL(tBlob), { type: "module" });
					const r = await new Promise((res) => {
						const to = setTimeout(() => { res("timeout"); try { tw.terminate(); } catch {} }, 6000);
						tw.onmessage = (e) => { clearTimeout(to); res(String(e.data)); };
						tw.onerror = (e) => { clearTimeout(to); res("worker-err:" + e.message); };
					});
					probePost({ step: "if-blob-import", tag, result: r });
				} catch (e) { probePost({ step: "if-blob-import-err", tag, err: String(e) }); }
			}
		})();
		self.onmessage = (event) => {
			if (event.data && event.data.type) probePost({ step: "got-msg", type: event.data.type });
			if (!event.data || event.data.type !== bootstrapNlsType) {
				if (globalThis.__ppooWorkerRef) globalThis.__ppooWorkerRef.postMessage(event.data, event.ports);
				return;
			}
			const { data } = event.data;
			createWorker(data.workerUrl, data.workerOptions, data.fileRoot, data.nls.messages, data.nls.language);
		};`
);
s = s.replace(
  "if (event.data.type !== bootstrapNlsType) {",
  "if (event.data.type !== bootstrapNlsType) { /* relaxed for file:// origins */"
);
s = s.replace(
  "\tconst salt = searchParams.get('salt');",
  `\tconst salt = searchParams.get('salt');
	const probePost = (extra) => window.parent.postMessage({ vscodeWebWorkerExtHostId: "probe-" + vscodeWebWorkerExtHostId, probeType: "if", ...extra }, "*");`
);
s = s.replace(
  "const worker = new Worker(URL.createObjectURL(blob), { name, ...workerOptions });",
  "const worker = new Worker(URL.createObjectURL(blob), { name, ...workerOptions }); globalThis.__ppooWorkerRef = worker; probePost({ step: \"worker-created\", url: String(workerUrl).slice(0, 200) });"
);
s = s.replace(
  "} else {\n\t\t\t\t\tworker.onerror = console.error.bind(console);",
  `} else {
					probePost({ step: "worker-msg", what: data && data.__ppooProbe ? "probe" : data instanceof MessagePort ? "port" : "bin" });
					worker.onerror = console.error.bind(console);`
);
s = s.replace(
  "}, parentOrigin, [data]);",
  "}, \"*\", [data]);"
);
s = s.replace(
  "connect-src 'self' data: extension-file: https: wss:",
  "connect-src 'self' data: extension-file: ppoo-file: file: https: wss:"
);
s = s.replace(
  "child-src 'self' data: blob:;",
  "child-src 'self' data: blob: ppoo-file: file:;"
);
s = s.replace(
  "script-src 'self' 'unsafe-eval' 'sha256-",
  "script-src 'self' 'unsafe-eval' ppoo-file: file: 'sha256-"
);

const script = s.match(/<script>([\s\S]*?)<\/script>/);
if (!script) throw new Error("Could not find inline script in ext-host iframe html");
const hash = crypto.createHash("sha256").update(Buffer.from(script[1], "utf8")).digest("base64");
s = s.replace(/'sha256-[A-Za-z0-9+/=]+'/, `'sha256-${hash}'`);

fs.writeFileSync(out, s);
console.log("Copied ext-host iframe:", out, "| CSP sha256-" + hash);

// Also copy extensionHost.worker.js to worker/ for the iframe's ppooc URL (worker/extensionHost.worker.js)
try {
  const workerSrc = path.join(__dirname, "..", "electron", "renderer", "extensionHost.worker.js");
  const workerDest = path.join(outDir, "extensionHost.worker.js");
  if (fs.existsSync(workerSrc)) {
    fs.copyFileSync(workerSrc, workerDest);
    console.log("Copied extensionHost.worker.js to worker/", workerDest);
  }
} catch (e) {
  console.warn("Failed to copy extensionHost.worker.js to worker/", e.message);
}