// Run after npm run build with: electron tests/component-picker.electron.cjs
// Add --screenshots to save captures in the ignored .appdata folder.
const { app, BrowserWindow, ipcMain, webContents } = require("electron");
const { setupTitlebarAndAttachToWindow } = require("custom-electron-titlebar/main");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { registerBrowserPicker } = require("../electron/main/browser-picker");
const browserRegistry = require("../electron/main/browser-registry");
const { setupCsp } = require("../electron/main/csp");

const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-picker-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
const labelByHost = new Map();
const page = (label) => "data:text/html," + encodeURIComponent(`<!doctype html><style>
  body { margin: 0; padding: 24px; background: #f0f4f9; font: 16px system-ui; }
  #card { width: 215px; padding: 18px; border-radius: 12px; background: #255986; color: white; }
</style><article id="card" onclick="window.pageClicks++"><h3>${label}</h3>
<p>Picked from this browser tab.</p><a href="https://example.com">Sample link</a></article>
<script>window.pageClicks = 0;</script>`);
const tab = (id, component, config) => ({ type: "tab", id, name: id, component, config });
const group = (children) => ({ type: "tabset", children });
const layout = (label) => ({
  global: { tabSetEnableDeleteWhenEmpty: false },
  layout: { type: "row", children: [
    group([tab("Browser", "panel3", { url: page(label) })]),
    group([tab("Preview", "componentPreview"), tab("other-browser", "panel3", { url: page("Other tab") })]),
  ] },
});

registerBrowserPicker();
const handlers = {
  "settings:read": () => ({ githubOnboardingDismissed: true }),
  "session:load": () => null,
  "projectConfig:readTabs": (e) => ({ tabs: [], panels: layout(labelByHost.get(e.sender.id)) }),
  "terminal:getProjectPath": () => profile,
  "browser:registerGuest": (e, id) => {
    const wc = webContents.fromId(id);
    return wc?.hostWebContents === e.sender && browserRegistry.markBrowser(wc);
  },
};
const preload = fs.readFileSync(path.join(root, "electron/preload/index.js"), "utf8");
for (const channel of new Set([...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((match) => match[1]))) {
  if (channel !== "browser:pickElement") ipcMain.handle(channel, handlers[channel] || (() => []));
}
ipcMain.handle("crx-msg-remote", () => []);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await delay(35);
  }
  throw new Error(`Timed out: ${label}`);
}
async function openWorkspace(label) {
  const win = new BrowserWindow({
    show: false, width: 1040, height: 600, titleBarStyle: "hidden",
    webPreferences: {
      sandbox: false, contextIsolation: true, webviewTag: true,
      preload: path.join(root, "electron/preload/preload-bundle.cjs"),
    },
  });
  labelByHost.set(win.webContents.id, label);
  win.webContents.on("did-attach-webview", (_event, guest) => browserRegistry.add(guest, win));
  win.webContents.setBackgroundThrottling(false);
  await setupTitlebarAndAttachToWindow(win);
  await win.loadFile(path.join(root, "electron/renderer/index.html"));
  win.webContents.send("menu:openProject", profile);
  const run = (js) => win.webContents.executeJavaScript(js);
  await until(() => run('!!document.querySelector(\'[title="Select an element in the Browser"]\')'), "Select button");
  win.showInactive();
  return { win, run };
}
const button = '[title="Select an element in the Browser"]';
const snapshot = 'iframe[title^="Browser element preview"]';
async function startPick({ run }) {
  await run(`document.querySelector(${JSON.stringify(button)}).click()`);
}
async function pickCard(guest) {
  await until(() => guest.debugger.isAttached(), "native picker attached");
  await delay(180);
  const input = (type, button) => guest.debugger.sendCommand("Input.dispatchMouseEvent", { type, x: 30, y: 30, button, clickCount: 1 });
  await input("mouseMoved", "none");
  await input("mousePressed", "left");
  if (guest.debugger.isAttached()) await input("mouseReleased", "left").catch(() => {});
}

app.whenReady().then(async () => {
  const { session } = require("electron");
  setupCsp(session.defaultSession);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["https://*/*", "http://*/*"] }, (_details, done) => done({ cancel: true }));
  const first = await openWorkspace("First window");
  const second = await openWorkspace("Second window");
  const guestOf = (win, label) => browserRegistry.all().find(({ wc }) => wc.hostWebContents === win.webContents && wc.getURL().includes(encodeURIComponent(label)))?.wc;
  await until(() => [first, second].every(({ win }, i) => {
    const guest = guestOf(win, i ? "Second window" : "First window");
    return guest && browserRegistry.isBrowserGuest(guest);
  }), "both browser guests registered");
  const firstGuest = guestOf(first.win, "First window");
  const secondGuest = guestOf(second.win, "Second window");
  const foreign = await second.run(`window.electronAPI.pickBrowserElement(${firstGuest.id}, "other-window")`);
  assert.ok(foreign.error);
  assert.equal(firstGuest.isDevToolsOpened(), false);

  await startPick(first);
  await pickCard(firstGuest);
  await until(() => first.run(`document.querySelector('${snapshot}')?.srcdoc.includes('First window')`), "first window snapshot");
  assert.equal(await firstGuest.executeJavaScript("window.pageClicks"), 0);
  assert.equal(await second.run(`!!document.querySelector('${snapshot}')`), false);
  const captured = await first.run(`document.querySelector('${snapshot}').srcdoc`);
  assert.match(captured, /rgb\(37, 89, 134\)/);
  assert.doesNotMatch(captured, /onclick=|href=|<script/i);
  assert.equal(await first.run(`document.querySelector('${snapshot}').getAttribute('sandbox')`), "");
  await until(() => first.run(`document.querySelector('${snapshot}').contentDocument === null`), "opaque snapshot origin");
  assert.equal(await first.run('[...document.querySelectorAll("[role=status]")].some(el => el.textContent.includes("Loaded <article#card>"))'), true);
  console.log("PASS: closed DevTools opens, native click loads the styled, isolated element");

  if (process.argv.includes("--screenshots")) {
    const dir = path.join(root, ".appdata", "component-picker-evidence");
    fs.mkdirSync(dir, { recursive: true });
    first.win.focus();
    await delay(180);
    fs.writeFileSync(path.join(dir, "selected-element.png"), (await first.win.webContents.capturePage()).toPNG());
  }

  secondGuest.openDevTools({ mode: "undocked", activate: false });
  await until(() => secondGuest.isDevToolsOpened(), "undocked DevTools");
  await startPick(second);
  await pickCard(secondGuest);
  await until(() => second.run(`document.querySelector('${snapshot}')?.srcdoc.includes('Second window')`), "second window snapshot");
  assert.equal(await first.run(`document.querySelector('${snapshot}').srcdoc`), captured);
  console.log("PASS: an already-open undocked picker stays scoped to its own window");

  await startPick(first);
  await until(() => firstGuest.debugger.isAttached(), "reopened picker");
  firstGuest.closeDevTools();
  await until(() => first.run(`!!document.querySelector(${JSON.stringify(button)})`), "close cancels selection");
  assert.equal(await first.run(`document.querySelector('${snapshot}').srcdoc`), captured);
  console.log("PASS: closing DevTools cancels the pick and preserves the previous preview");

  await first.run("document.getElementById('flexlayout-tabbutton-other-browser').click()");
  await until(() => {
    const guest = guestOf(first.win, "Other tab");
    return guest && browserRegistry.isBrowserGuest(guest);
  }, "other browser tab");
  await first.run("document.getElementById('flexlayout-tabbutton-Preview').click()");
  await startPick(first);
  await pickCard(guestOf(first.win, "Other tab"));
  await until(() => first.run(`document.querySelector('${snapshot}')?.srcdoc.includes('Other tab') && document.querySelector('${snapshot}').getBoundingClientRect().width > 0`), "return to requesting preview");
  console.log("PASS: the most recently active tab is revealed and the result returns to its preview");

  await first.run('document.querySelector(\'[aria-label="Return to file preview"]\').click()');
  assert.equal(await first.run(`!!document.querySelector('${snapshot}')`), false);
  console.log("PASS: the file preview can be restored");
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
setTimeout(() => app.exit(2), 50_000).unref();
