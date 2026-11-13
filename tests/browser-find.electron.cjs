// Run after npm run build with: electron tests/browser-find.electron.cjs
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-find-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
const guestUrl = "data:text/html," + encodeURIComponent("<p>alpha alpha Alpha beta</p>");
require("esbuild").buildSync({
  stdin: {
    contents: `import React from "react";
      import { createRoot } from "react-dom/client";
      import Browser from "./electron/renderer/components/Browser/index.jsx";
      window.electronAPI = { onBrowserShortcut(cb) { window.browserShortcut = cb; return () => {}; } };
      createRoot(document.body).render(<Browser nodeId="browser-test" config={{ url: ${JSON.stringify(guestUrl)} }} />);`,
    resolveDir: root,
    loader: "jsx",
  },
  bundle: true,
  outfile: path.join(profile, "test.js"),
});
fs.writeFileSync(path.join(profile, "index.html"), '<!doctype html><body><script src="test.js"></script></body>');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { webviewTag: true } });
  const attached = new Promise((resolve) => win.webContents.once("did-attach-webview", (_event, guest) => resolve(guest)));
  win.webContents.setBackgroundThrottling(false);
  await win.loadFile(path.join(profile, "index.html"));
  const guest = await attached;
  if (guest.isLoading()) await new Promise((resolve) => guest.once("did-finish-load", resolve));
  const run = (js) => win.webContents.executeJavaScript(js);
  const wait = async (js) => {
    for (let i = 0; i < 150; i++) {
      if (await run(js)) return;
      await delay(20);
    }
    throw new Error(`Timed out: ${js}`);
  };
  const input = '[aria-label="Find in page"]';
  const open = async () => {
    await run(`window.browserShortcut({ action: "find", wcId: ${guest.id} })`);
    await wait(`!!document.querySelector('${input}')`);
  };
  const type = (value) => run(`(() => {
    const input = document.querySelector('${input}');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  const click = (title) => run(`document.querySelector(${JSON.stringify(`[title="${title}"]`)}).click()`);
  const count = (value) => wait(`new RegExp(${JSON.stringify(value)}).test(document.querySelector(".browser__findbar span").textContent)`);
  await run(`(() => {
    const guest = document.querySelector("webview");
    const nativeFind = guest.findInPage.bind(guest);
    window.findCalls = [];
    guest.findInPage = (...args) => {
      const id = nativeFind(...args);
      window.findCalls.push({ id, text: args[0], options: args[1] });
      return id;
    };
  })()`);

  await open();
  await type("alpha");
  await click("Close (Esc)");
  await delay(250);
  assert.equal(await run("window.findCalls.length"), 0, "closing Find cancels the pending search");
  console.log("PASS: closing Find cancels a queued search");

  await open();
  await type("alpha");
  await count("^1/3$");
  await click("Next (Enter)");
  await count("^2/3$");
  await click("Previous (Shift+Enter)");
  await count("^1/3$");
  await click("Match case: off");
  await count("^[12]/2$");
  await type("beta");
  await count("^1/1$");
  await run(`(() => {
    const event = new Event("found-in-page");
    event.result = { requestId: window.findCalls[0].id, matches: 3, activeMatchOrdinal: 3 };
    document.querySelector("webview").dispatchEvent(event);
  })()`);
  assert.equal(await run('document.querySelector(".browser__findbar span").textContent'), "1/1");
  console.log("PASS: typing, navigating matches, Match Case, and ignoring stale results");
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
setTimeout(() => app.exit(2), 25_000).unref();
