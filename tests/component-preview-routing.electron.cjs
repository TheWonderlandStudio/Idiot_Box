// Run with: electron tests/component-preview-routing.electron.cjs
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-preview-routing-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
require("esbuild").buildSync({
  stdin: {
    contents: `import React from "react";
      import { createRoot } from "react-dom/client";
      import Preview from "./electron/renderer/components/ComponentPreview/index.jsx";
      import Browser from "./electron/renderer/components/Browser/index.jsx";
      const browser = { getId: () => "browser", getType: () => "tab", getComponent: () => "panel3" };
      window.selected = [];
      window.__flexModel = { current: {
        getRoot: () => ({ getChildren: () => [browser] }),
        doAction: (id) => window.selected.push(id)
      } };
      window.__flexActions = { selectTab: (id) => id };
      const listeners = new Set();
      window.electronAPI = {
        browserPickComponent: async (webContentsId, previewId) => {
          window.completePick = () => listeners.forEach(cb => cb({
            webContentsId, previewId, tagName: "article", html: "<article>Selected card</article>"
          }));
          return { ok: true };
        },
        onBrowserComponentPicked: (cb) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      };
      createRoot(document.body).render(<>
        <Browser nodeId="browser" config={{ url: "data:text/html,<p>Fixture</p>" }} />
        <section id="first"><Preview nodeId="first" /></section>
        <section id="second"><Preview nodeId="second" /></section>
      </>);`,
    resolveDir: path.resolve(__dirname, ".."),
    loader: "jsx",
  },
  bundle: true,
  outfile: path.join(profile, "test.js"),
});
fs.writeFileSync(path.join(profile, "index.html"), '<!doctype html><body><script src="test.js"></script></body>');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { webviewTag: true } });
  const attached = new Promise((resolve) => win.webContents.once("did-attach-webview", (_event, guest) => resolve(guest)));
  win.webContents.setBackgroundThrottling(false);
  await win.loadFile(path.join(profile, "index.html"));
  const guest = await attached;
  if (guest.isLoading()) await new Promise((resolve) => guest.once("did-finish-load", resolve));
  const run = (js) => win.webContents.executeJavaScript(js);
  const wait = async (js) => {
    for (let i = 0; i < 120; i++) {
      if (await run(js)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${js}`);
  };
  const button = (id) => `[...document.querySelectorAll("#${id} button")].find(el => el.textContent.includes("Select component from browser"))`;
  const captured = (id) => `document.querySelector("#${id} iframe").srcdoc.includes("Selected card")`;
  await wait(`!!(${button("first")})`);
  await run(`${button("first")}.click()`);
  await wait("typeof window.completePick === 'function'");
  await run("window.completePick()");
  await wait(captured("first"));
  assert.equal(await run(captured("second")), false, "the other preview keeps its content");
  assert.deepEqual(await run("window.selected"), ["browser", "first"]);
  console.log("PASS: the Browser returns the snapshot only to the preview that clicked Select");
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
setTimeout(() => app.exit(2), 20_000).unref();
