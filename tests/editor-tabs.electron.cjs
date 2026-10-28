const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const { setupTitlebarAndAttachToWindow } = require("custom-electron-titlebar/main");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-editor-tabs-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
const fixture = path.join(profile, "project"), second = path.join(profile, "second");
for (const folder of [fixture, second]) {
  fs.mkdirSync(folder, { recursive: true });
  for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(folder, `file${i}.js`), `export const value${i} = ${i};\n`);
}
const panelsFor = (folder) => ({
  global: { tabEnableClose: true, tabSetEnableDeleteWhenEmpty: false },
  layout: { type: "row", children: [
    { type: "tabset", id: "project", weight: 25, children: [{ type: "tab", name: "Project", component: "projectPanel" }] },
    { type: "tabset", id: "editors", weight: 75, active: true, children: [1, 2, 3, 4].map((i) => ({ type: "tab", id: `file${i}`, name: `file${i}.js`, component: "editor", config: { filePath: path.join(folder, `file${i}.js`), forceText: i === 1 } })) },
  ] },
});
let activeProject = fixture, menuAction = null, menuOptions = null, copied = null;
let holdStat = false, releaseStat = null;
const stat = (file) => { try { return { exists: true, isDir: fs.statSync(file).isDirectory() }; } catch { return { exists: false, isDir: false }; } };
const handlers = {
  "settings:read": () => ({ githubOnboardingDismissed: true, editorMinimap: false }),
  "session:load": () => null,
  "terminal:getProjectPath": () => activeProject,
  "projectConfig:readTabs": (_e, folder) => ({ tabs: [], panels: panelsFor(folder) }),
  "fs:readTextFile": (_e, file) => fs.readFileSync(file, "utf8"),
  "fs:readDir": () => [],
  "fs:stat": (_e, file) => holdStat ? new Promise((resolve) => { releaseStat = () => resolve(stat(file)); }) : stat(file),
  "tab:contextMenu": (_e, options) => { menuOptions = options; return { action: menuAction }; },
  "dialog:confirmSave": () => "cancel",
};
const source = fs.readFileSync(path.join(root, "electron/preload/index.js"), "utf8");
for (const channel of new Set([...source.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]))) ipcMain.handle(channel, handlers[channel] || (() => []));
ipcMain.on("clipboard:writeText", (event, text) => { copied = text; event.returnValue = true; });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "File", submenu: [{ label: "Open" }] }]));
  const win = new BrowserWindow({ width: 1100, height: 750, show: false, titleBarStyle: "hidden",
    webPreferences: { offscreen: true, sandbox: false, preload: path.join(root, "electron/preload/preload-bundle.cjs"), contextIsolation: true, nodeIntegration: false, webviewTag: true } });
  await setupTitlebarAndAttachToWindow(win);
  const errors = [];
  win.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
  const run = (code) => win.webContents.executeJavaScript(code);
  const waitFor = async (code) => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await delay(50); } console.error(errors, await run("document.getElementById('ibx-layout-toast')?.textContent")); throw new Error(`Timed out: ${code}`); };
  const close = async (file) => {
    await run(`(() => { const tab = [...document.querySelectorAll('[role=tab]')].find(el => el.getAttribute('aria-label') === '${file}.js'); tab.querySelector('.flexlayout__tab_button_trailing').click(); })()`);
    await waitFor(`testFiles('${file}.js').length === 0`);
  };
  const menu = async (file, action) => {
    menuAction = action;
    await run(`(() => { const tab = [...document.querySelectorAll('[role=tab]')].find(el => el.getAttribute('aria-label') === '${file}.js'); tab.querySelector('.flexlayout__tab_button_content span').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true})); })()`);
    await delay(100);
  };
  const reopen = () => win.webContents.send("menu:reopenClosedEditor");
  try {
    await win.loadFile(path.join(root, "electron/renderer/index.html"));
    await waitFor("!!window.__flexModel?.current");
    win.webContents.send("menu:openProject", fixture);
    await waitFor("!!document.getElementById('flexlayout-tabbutton-file1')");
    await delay(300);
    await run(`window.testFiles = (name) => { const out = []; window.__flexModel.current.visitNodes(node => { if (node.getConfig?.()?.filePath?.endsWith(name)) out.push(node); }); return out; }; true`);
    // A cancelled dirty close does not create a recovery entry.
    await run("window.testDirty = window.__ibxIsDirty; window.__ibxIsDirty = () => true; true");
    await run("document.querySelector('#flexlayout-tabbutton-file1 .flexlayout__tab_button_trailing').click()");
    await delay(100);
    assert.equal(await run("testFiles('file1.js').length"), 1);
    reopen();
    await waitFor("document.getElementById('ibx-layout-toast')?.textContent.includes('No recently closed')");
    await run("window.__ibxIsDirty = window.testDirty; true");
    // Closing through the File menu keeps the project open and can be undone.
    win.webContents.send("menu:closeEditor");
    await waitFor("testFiles('file1.js').length === 0");
    assert.equal(await run("window.__currentProjectPath"), fixture);
    reopen();
    await waitFor("testFiles('file1.js').length === 1");
    assert.equal(await run("testFiles('file1.js')[0].getParent().getId()"), "editors");
    assert.equal(await run("window.__flexModel.current.getNodeById('editors').getChildren()[0].getConfig().filePath.endsWith('file1.js')"), true);
    assert.equal(await run("testFiles('file1.js')[0].getConfig().forceText"), true);
    // The same command is discoverable and executable in the palette.
    await close("file1");
    win.webContents.send("menu:commandPalette");
    await waitFor("!!document.querySelector('.ui-pop input')");
    await run("(() => { const input=document.querySelector('.ui-pop input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'>Reopen Closed Editor'); input.dispatchEvent(new Event('input',{bubbles:true})); })()");
    await waitFor("[...document.querySelectorAll('.ui-pop [data-ai]')].some(el=>el.textContent.includes('Reopen Closed Editor'))");
    await run("[...document.querySelectorAll('.ui-pop [data-ai]')].find(el=>el.textContent.includes('Reopen Closed Editor')).click()");
    await waitFor("testFiles('file1.js').length === 1");
    // An already reopened file is focused without adding a duplicate.
    await close("file1");
    await run(`window.dispatchEvent(new CustomEvent('open-file-in-new-editor-tab',{detail:{path:${JSON.stringify(path.join(fixture, "file1.js"))}}}))`);
    await waitFor("testFiles('file1.js').length === 1");
    reopen();
    await delay(150);
    assert.equal(await run("testFiles('file1.js').length"), 1);
    // Missing files are reported without opening an empty editor.
    await close("file2");
    fs.unlinkSync(path.join(fixture, "file2.js"));
    reopen();
    await waitFor("document.getElementById('ibx-layout-toast')?.textContent.includes('no longer available')");
    assert.equal(await run("testFiles('file2.js').length"), 0);
    await menu("file3", "copyRelativePath");
    assert.equal(menuOptions.canCopyRelativePath, true);
    assert.equal(copied, "file3.js");
    // A switch while filesystem stat is pending cannot reopen the old file.
    await close("file3");
    holdStat = true;
    reopen();
    for (let i = 0; i < 100 && !releaseStat; i++) await delay(20);
    assert.ok(releaseStat);
    activeProject = second;
    win.webContents.send("menu:openProject", second);
    await waitFor(`window.__currentProjectPath === ${JSON.stringify(second)} && testFiles('file3.js')[0]?.getConfig().filePath.startsWith(${JSON.stringify(second)})`);
    holdStat = false;
    releaseStat();
    await delay(200);
    assert.equal(await run("testFiles('file3.js').length"), 1);
    assert.equal(await run(`testFiles('file3.js')[0].getConfig().filePath.startsWith(${JSON.stringify(second)})`), true);
    reopen();
    await waitFor("document.getElementById('ibx-layout-toast')?.textContent.includes('No recently closed')");
    assert.deepEqual(errors, [], "No renderer errors");
    console.log("PASS: cancelled close, native file close, menu/palette recovery, tab options, deduplication, missing files, relative clipboard path, and project-switch race");
  } finally { win.destroy(); app.quit(); }
}).catch((error) => { console.error(error); app.exit(1); });
