const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const { setupTitlebarAndAttachToWindow } = require("custom-electron-titlebar/main");
const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert/strict");
const root = path.resolve(__dirname, "..");
const scale = process.argv.find((arg) => arg.startsWith("--scale="))?.split("=")[1] || "1";
app.commandLine.appendSwitch("force-device-scale-factor", scale);
if (process.argv.includes("--software-rendering")) app.disableHardwareAcceleration();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-layout-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
const fixture = path.join(profile, "project");
fs.mkdirSync(fixture, { recursive: true });
for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(fixture, `file${i}.js`), `export const value${i} = ${i};\n`);
let saved = null;
let tabAction = null;
const panels = {
  global: { tabEnableClose: true, tabSetEnableDeleteWhenEmpty: false, tabEnableFloat: true },
  borders: ["left", "right", "top", "bottom"].map((location) => ({ type: "border", location, selected: -1 })),
  layout: { type: "row", children: [
    { type: "tabset", id: "project", weight: 20, children: [{ type: "tab", id: "project-tab", name: "Project", component: "projectPanel" }] },
    { type: "tabset", id: "editors", weight: 45, active: true, children: [1, 2, 3].map((i) => ({ type: "tab", id: `file${i}`, name: `file${i}.js`, component: "editor", config: { filePath: path.join(fixture, `file${i}.js`) } })) },
    { type: "tabset", id: "other", weight: 35, children: [{ type: "tab", id: "file4", name: "file4.js", component: "editor", config: { filePath: path.join(fixture, "file4.js") } }] },
  ] },
};
const handlers = {
  "settings:read": () => ({ githubOnboardingDismissed: true, editorMinimap: false }),
  "session:load": () => null,
  "terminal:getProjectPath": () => fixture,
  "projectConfig:readTabs": () => saved || { tabs: [], panels },
  "projectConfig:writeTabs": (_e, _root, value) => { saved = value; return true; },
  "fs:readTextFile": (_e, file) => fs.readFileSync(file, "utf8"),
  "fs:readDir": () => [1, 2, 3, 4].map((i) => ({ name: `file${i}.js`, path: path.join(fixture, `file${i}.js`), isDirectory: false })),
  "fs:readDirAll": () => [],
  "fs:stat": () => ({ isDirectory: false, isFile: true, size: 20 }),
  "git:status": () => ({ files: [], branch: "main" }),
  "tab:contextMenu": () => ({ action: tabAction }),
};
const source = fs.readFileSync(path.join(root, "electron/preload/index.js"), "utf8");
for (const channel of new Set([...source.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]))) {
  ipcMain.handle(channel, handlers[channel] || (() => []));
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "File", submenu: [{ label: "Open" }] }, { label: "View", submenu: [{ label: "Layout" }] }]));
  const win = new BrowserWindow({ width: 1100, height: 750, useContentSize: true, titleBarStyle: "hidden", show: false,
    webPreferences: { offscreen: true, sandbox: false, preload: path.join(root, "electron/preload/preload-bundle.cjs"), contextIsolation: true, nodeIntegration: false, webviewTag: true } });
  await setupTitlebarAndAttachToWindow(win);
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
  const run = async (code) => {
    try { return await win.webContents.executeJavaScript(code); }
    catch (error) { console.error("Renderer check failed:", code, errors); throw error; }
  };
  const visibleOverlays = "[...document.querySelectorAll('.flexlayout__outline_rect,.flexlayout__outline_rect_edge,.flexlayout__layout_overlay')].filter(el => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden').length";
  const waitFor = async (code) => {
    for (let i = 0; i < 100; i++) { if (await run(code)) return; await delay(50); }
    throw new Error(`Timed out: ${code}`);
  };
  const geometry = () => run(`(() => {
    const rect = (element) => { const {x,y,width,height,bottom} = element.getBoundingClientRect(); return {x,y,width,height,bottom}; };
    const layout = document.querySelector('.flexlayout__layout');
    return { titlebar: rect(document.querySelector('.cet-titlebar')), container: rect(document.querySelector('.cet-container')),
      app: rect(document.querySelector('#root').firstElementChild), workspace: rect(layout.parentElement), layout: rect(layout),
      sidebar: rect(document.querySelector('.pw-sidebar')),
      viewportHeight: innerHeight };
  })()`);
  const checkBounds = async (stable) => {
    const g = await geometry();
    const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1.1, `${message}: ${a} vs ${b}`);
    near(g.container.y, g.titlebar.bottom, "Content starts below the titlebar");
    near(g.app.height, g.container.height, "App fits the titlebar container");
    near(g.layout.y, g.workspace.y, "Docking layout starts at its host");
    near(g.layout.bottom, g.workspace.bottom, "Docking layout ends at its host");
    if (stable) {
      assert.deepEqual(g.titlebar, stable.titlebar, "Dragging must not change titlebar geometry");
      assert.deepEqual(g.sidebar, stable.sidebar, "Dragging between editor tabsets must not change sidebar geometry");
    }
    return g;
  };
  try {
    await win.loadFile(path.join(root, "electron/renderer/index.html"));
    await waitFor("!!window.__flexModel?.current");
    win.webContents.send("menu:openProject", fixture);
    await waitFor("!!document.querySelector('.pw-sidebar') && !!document.getElementById('flexlayout-tabbutton-file1')");
    await delay(500);
    assert.equal(await run("!!document.querySelector('#pw-hostbar-left')"), false, "App status bar should not be rendered");
    const initial = await checkBounds();
    await run(`window.testDrag = async (targetId, reorder = false, cancel = false) => {
      const source = document.getElementById('flexlayout-tabbutton-file1');
      const m = window.__flexModel.current;
      const targetPath = m.getNodeById(targetId).getPath();
      const target = [...document.querySelectorAll('.flexlayout__tabset')].find((el) => el.getAttribute('data-layout-path') === targetPath);
      const rect = target.getBoundingClientRect();
      const sourceRect = source.getBoundingClientRect();
      const point = reorder ? {clientX:rect.right - 75,clientY:rect.top + 12} : {clientX:rect.x + rect.width / 2,clientY:rect.y + rect.height / 2};
      const dataTransfer = new DataTransfer();
      const send = (el, type, p = point) => el.dispatchEvent(new DragEvent(type, {bubbles:true,cancelable:true,dataTransfer,...p}));
      send(source, 'dragstart', {clientX:sourceRect.x + 10,clientY:sourceRect.y + 10});
      send(target, 'dragenter');
      await new Promise(requestAnimationFrame);
      send(target, 'dragover');
      await new Promise(requestAnimationFrame);
      window.testFinishDrag = () => { if (!cancel) send(target, 'drop'); send(source, 'dragend'); };
    }; true`);
    // Exercise the actual rendered HTML drag/drop handlers, including cancellation.
    for (let i = 0; i < 12; i++) {
      const target = i % 2 ? "editors" : "other";
      await run(`window.testDrag('${target}')`);
      await checkBounds(initial);
      await run("window.testFinishDrag()");
      await waitFor(`window.__flexModel.current.getNodeById('file1').getParent().getId() === '${target}'`);
      await waitFor(`${visibleOverlays} === 0`);
      await checkBounds(initial);
      assert.equal(await run(visibleOverlays), 0, "Drop clears the drag overlays");
    }
    await run("window.testDrag('editors', true)");
    await checkBounds(initial);
    await run("window.testFinishDrag()");
    await waitFor("window.__flexModel.current.getNodeById('editors').getChildren().at(-1).getId() === 'file1'");
    await run("window.testDrag('other', false, true)");
    await run("window.testFinishDrag()");
    await waitFor(`${visibleOverlays} === 0`);
    await checkBounds(initial);
    assert.equal(await run(visibleOverlays), 0, "Cancel clears the drag overlays");
    // Check narrow-window resizing and both themes as well as drag/drop.
    for (const theme of ["light", "dark"]) {
      await run(`document.documentElement.dataset.theme = '${theme}'`);
      win.setContentSize(800, 600);
      await delay(100);
      await checkBounds();
      win.setContentSize(1100, 750);
      await delay(100);
      await checkBounds();
    }
    const tabMenu = async (action) => {
      tabAction = action;
      await run("(() => { const tab = [...document.querySelectorAll('[role=tab]')].find(el => el.getAttribute('aria-label') === 'file1.js'); const content = tab.querySelector('.flexlayout__tab_button_content span,.flexlayout__border_button_content span'); content.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true})); })()");
    };
    await tabMenu("moveBorder:left");
    await waitFor("window.__flexModel.current.getNodeById('file1').getParent().getType() === 'border'");
    await checkBounds();
    await tabMenu("moveCenter");
    await waitFor("window.__flexModel.current.getNodeById('file1').getParent().getType() === 'tabset'");
    await checkBounds();
    await tabMenu("float");
    await waitFor("!!document.querySelector('.flexlayout__float_window')");
    await checkBounds();
    await delay(750);
    assert.ok(saved?.panels, "A changed layout is persisted");
    const order = await run("window.__flexModel.current.getNodeById('editors').getChildren().map((node) => node.getId())");
    win.webContents.reload();
    await waitFor("!!window.__flexModel?.current && !!window.__ibxCloseProject");
    win.webContents.send("menu:openProject", fixture);
    await waitFor("!!document.getElementById('flexlayout-tabbutton-file1')");
    await delay(200);
    assert.deepEqual(await run("window.__flexModel.current.getNodeById('editors').getChildren().map((node) => node.getId())"), order, "Reload restores tab order");
    await checkBounds();
    assert.deepEqual(errors, [], "No renderer errors");
    console.log(`PASS: tab drag, reorder, cancel, borders, float, themes, resize, and persistence at scale ${scale}`);
  } finally { win.destroy(); app.quit(); }
}).catch((error) => { console.error(error); app.exit(1); });
