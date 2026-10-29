const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-files-"));
app.setPath("userData", temp);
app.setPath("sessionData", temp);
const project = path.join(temp, "project"), first = path.join(project, "first"), second = path.join(project, "second");
const entry = (folder, name, isDir = false) => ({ path: path.join(folder, name), name, isDir });
const queues = [], trash = [], renamed = [];
let hold = false, rejectNext = false;
let items;
let readDirectory;
const mainSource = fs.readFileSync(path.join(root, "electron/main/index.js"), "utf8");
vm.runInNewContext(mainSource.match(/ipcMain\.handle\("fs:readDirAll",[\s\S]*?\n}\);/)[0], {
  fs, path, toLongPath: (p) => p, sortByName: (entries) => entries.sort((a, b) => a.name.localeCompare(b.name)),
  ipcMain: { handle: (_channel, handler) => { readDirectory = handler; } },
});
ipcMain.handle("test:directory", (_e, folder, options) => {
  if (rejectNext) { rejectNext = false; return readDirectory(null, path.join(temp, "unavailable"), options); }
  return hold ? new Promise((resolve) => queues.push({ folder, resolve })) : items.get(folder) || [];
});
ipcMain.handle("test:trash", (_e, file) => { trash.push(file); });
ipcMain.handle("test:rename", (_e, oldPath, name) => {
  const newPath = path.join(path.dirname(oldPath), name);
  renamed.push({ oldPath, name });
  items.set(first, items.get(first).map((e) => e.path === oldPath ? { ...e, name, path: newPath } : e));
  return newPath;
});
fs.writeFileSync(path.join(temp, "preload.cjs"), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{
  readSettings:async()=>({confirmDelete:false}),onSettingsUpdated:()=>()=>{},getVscodeIcon:async()=>null,
  readDirAll:(folder,options)=>ipcRenderer.invoke('test:directory',folder,options),trashItem:p=>ipcRenderer.invoke('test:trash',p),
  rename:(p,n)=>ipcRenderer.invoke('test:rename',p,n),stat:async()=>({exists:true,isDir:false}),openFile:async()=>{},showAlert:async()=>{}
});`);
require("esbuild").buildSync({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Files from './electron/renderer/components/Project/window/ContentArea.jsx';import './electron/renderer/components/Project/window/project-window.css';import './electron/renderer/variables.css';import './electron/renderer/layout.css';
const project=${JSON.stringify(project)},first=${JSON.stringify(first)},second=${JSON.stringify(second)};
window.test={undo:0,redo:0,history:[],clipboard:null};
function Harness(){const[folder,setFolder]=useState(first),[selected,setSelected]=useState(new Set()),[count,setCount]=useState(0),[zoom,setZoom]=useState(100),[files,setFiles]=useState(true),[folders,setFolders]=useState(true),[hidden,setHidden]=useState(false);window.test.selected=[...selected];window.test.navigate=p=>{setSelected(new Set());setFolder(p)};window.test.zoom=setZoom;return <div className="pw-root" style={{height:'100vh'}}><div className="pw-body"><Files rootPath={project} currentPath={folder} refreshToken={0} selectedItems={selected} onSetSelectedItems={setSelected} onNavigate={window.test.navigate} onItemsLoaded={setCount} itemCount={count} clipboard={null} onClipboardChange={c=>window.test.clipboard=c} invalidateCache={()=>{}} pushUndo={op=>window.test.history.push(op)} performUndo={()=>window.test.undo++} performRedo={()=>window.test.redo++} zoom={zoom} onZoom={setZoom} showFiles={files} onToggleFiles={()=>setFiles(v=>!v)} showFolders={folders} onToggleFolders={()=>setFolders(v=>!v)} showHidden={hidden} onToggleHidden={()=>setHidden(v=>!v)} showPreview={false} onTogglePreview={()=>{}}/></div></div>};createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: root, loader: "jsx" }, bundle: true, platform: "browser", outfile: path.join(temp, "ui.js"), define: { "process.env.NODE_ENV": '"production"' } });
fs.writeFileSync(path.join(temp, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body style="margin:0"><div id="root"></div><script src="ui.js"></script></body></html>');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { offscreen: true, preload: path.join(temp, "preload.cjs"), contextIsolation: true, sandbox: false } });
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (e) => { if (e.level === "error") errors.push(e.message); });
  const run = (code) => win.webContents.executeJavaScript(code);
  const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(30); } throw new Error(`Timed out: ${label}`); };
  const wait = (code) => until(() => run(code), code);
  const type = (selector, value) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const key = (selector, key, options = {}) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();return !el.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true,...${JSON.stringify(options)}}));})()`);
  const select = () => run("document.querySelector('[title=\"report.test.js\"]').click()");
  const reset = async () => {
    hold = rejectNext = false; trash.length = renamed.length = 0;
    queues.splice(0).forEach((q) => q.resolve([]));
    items = new Map([[first, [entry(first, "report.test.js"), entry(first, "other.txt"), entry(first, "folder", true), entry(first, ".env")]], [second, [entry(second, "second.txt")]]]);
    await win.loadFile(path.join(temp, "index.html"));
    await wait("!!document.querySelector('[title=\"report.test.js\"]')");
  };
  let failed = 0;
  const check = async (name, body) => { await reset(); try { await body(); console.log("PASS:", name); } catch (e) { failed++; console.error("FAIL:", name, e.message); } };
  try {
    await check("Delete in the file filter never trashes a selected file", async () => {
      await select(); await delay(30);
      await key(".pw-bar__search-input", "Delete"); await delay(100);
      assert.equal(trash.length, 0);
    });
    await check("text selection and clipboard shortcuts stay in the input", async () => {
      await select(); await delay(30);
      assert.equal(await key(".pw-bar__search-input", "a", { ctrlKey: true }), false);
      assert.equal(await key(".pw-bar__search-input", "c", { ctrlKey: true }), false);
      await delay(30);
      assert.equal(await run("window.test.selected.length"), 1);
      assert.equal(await run("window.test.clipboard"), null);
    });
    await check("an older folder response cannot overwrite the current folder", async () => {
      hold = true;
      await run(`window.test.navigate(${JSON.stringify(second)})`);
      await until(() => queues.some((q) => q.folder === second), "second request");
      await run(`window.test.navigate(${JSON.stringify(first)})`);
      await until(() => queues.some((q) => q.folder === first), "first request");
      queues.find((q) => q.folder === first).resolve(items.get(first));
      await wait("!!document.querySelector('[title=\"report.test.js\"]')");
      queues.find((q) => q.folder === second).resolve(items.get(second));
      await delay(80);
      assert.equal(await run("!!document.querySelector('[title=\"second.txt\"]')"), false);
      assert.equal(await run("!!document.querySelector('[title=\"report.test.js\"]')"), true);
    });
    await check("Ctrl+Shift+Z redoes instead of undoing or doing nothing", async () => {
      await key(".pw-right", "Z", { ctrlKey: true, shiftKey: true });
      assert.deepEqual(await run("[window.test.undo,window.test.redo]"), [0, 1]);
    });
    if (process.argv.includes("--baseline")) { console.log(`${failed} original regressions reproduced`); app.exit(failed ? 1 : 0); return; }
    await check("rename selects the file stem and keeps the renamed item selected", async () => {
      await select(); await delay(30); await key(".pw-right", "F2");
      await wait("!!document.querySelector('.pw-rename-input')");
      assert.deepEqual(await run("[document.activeElement.selectionStart,document.activeElement.selectionEnd]"), [0, "report.test".length]);
      await type(".pw-rename-input", "renamed.js"); await key(".pw-rename-input", "Enter");
      await wait("!!document.querySelector('[title=\"renamed.js\"]')");
      assert.deepEqual(renamed, [{ oldPath: path.join(first, "report.test.js"), name: "renamed.js" }]);
      assert.deepEqual(await run("window.test.selected"), [path.join(first, "renamed.js")]);
      assert.equal(await run("document.activeElement.classList.contains('pw-right')"), true);
    });
    await check("Escape cancels rename and returns keyboard focus", async () => {
      await select(); await delay(30); await key(".pw-right", "F2");
      await wait("!!document.querySelector('.pw-rename-input')");
      await type(".pw-rename-input", "cancel.js"); await key(".pw-rename-input", "Escape"); await delay(200);
      assert.equal(renamed.length, 0);
      assert.equal(await run("document.activeElement.classList.contains('pw-right')"), true);
    });
    await check("folder rename selects the whole name in list view", async () => {
      await run("window.test.zoom(45);document.querySelector('[title=folder]').click()"); await delay(50);
      await key(".pw-right", "F2"); await wait("!!document.querySelector('.pw-rename-input')");
      assert.deepEqual(await run("[document.activeElement.selectionStart,document.activeElement.selectionEnd]"), [0, 6]);
    });
    await check("filter empty state offers recovery and Escape keeps focus", async () => {
      await type(".pw-bar__search-input", "missing"); await delay(30);
      assert.equal(await run("document.querySelector('.pw-content__empty').textContent.includes('missing')"), true);
      await run("document.querySelector('.pw-content__empty button').click()");
      await wait("!!document.querySelector('[title=\"report.test.js\"]')");
      await type(".pw-bar__search-input", "missing"); await key(".pw-bar__search-input", "Escape"); await delay(30);
      assert.equal(await run("document.querySelector('.pw-bar__search-input').value"), "");
      assert.equal(await run("document.activeElement.classList.contains('pw-bar__search-input')"), true);
    });
    await check("hidden view filters have a contextual recovery action", async () => {
      await run("document.querySelector('[title=\"Show files\"]').click();document.querySelector('[title=\"Show folders\"]').click()");
      await wait("!!document.querySelector('.pw-content__empty button')");
      await run("document.querySelector('.pw-content__empty button').click()");
      await wait("document.querySelectorAll('[role=listitem]').length===4");
    });
    await check("a rejected folder request can be retried without old rows", async () => {
      rejectNext = true; await run(`window.test.navigate(${JSON.stringify(second)})`);
      await wait("!!document.querySelector('.pw-content__empty [role=alert]')");
      assert.equal(await run("document.querySelectorAll('[role=listitem]').length"), 0);
      await run("document.querySelector('.pw-content__empty button').click()");
      await wait("!!document.querySelector('[title=\"second.txt\"]')");
    });
    await check("file shortcuts still work after clicking a file", async () => {
      await run("document.querySelector('.pw-bar__search-input').focus()"); await select(); await delay(30);
      assert.equal(await run("document.activeElement.classList.contains('pw-right')"), true);
      await key(".pw-right", "Delete");
      await until(() => trash.length === 1, "file delete");
      assert.equal(trash[0], path.join(first, "report.test.js"));
    });
    await check("finishing a rename on blur keeps focus in the filter", async () => {
      await select(); await delay(30); await key(".pw-right", "F2");
      await wait("!!document.querySelector('.pw-rename-input')");
      await type(".pw-rename-input", "renamed.js");
      await delay(30);
      // An offscreen window has no OS focus, so deliver the blur explicitly.
      await run("const input=document.querySelector('.pw-rename-input');document.querySelector('.pw-bar__search-input').focus();input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}))");
      await wait("!!document.querySelector('[title=\"renamed.js\"]')");
      assert.equal(await run("document.activeElement.classList.contains('pw-bar__search-input')"), true);
    });
    await check("dotfiles select their full name and buttons keep their keyboard input", async () => {
      await run("document.querySelector('[title*=\"hidden files\"]').click()");
      await wait("!!document.querySelector('[title=\".env\"]')");
      await run("document.querySelector('[title=\".env\"]').click()"); await delay(30);
      await key(".pw-right", "F2"); await wait("!!document.querySelector('.pw-rename-input')");
      assert.deepEqual(await run("[document.activeElement.selectionStart,document.activeElement.selectionEnd]"), [0, 4]);
      await key(".pw-rename-input", "Escape");
      assert.equal(await key('[title="Show files"]', "Delete"), false);
      await delay(50); assert.equal(trash.length, 0);
    });
    await check("filter and view controls stay reachable in a narrow pane", async () => {
      win.setSize(240, 420); await delay(80);
      const controlsFit = await run(`(()=>{const bounds=document.querySelector('.pw-right').getBoundingClientRect();return [...document.querySelectorAll('.pw-bar input,.pw-bar button')].every(el=>{const r=el.getBoundingClientRect();return r.width>10&&r.left>=bounds.left&&r.right<=bounds.right+1})})()`);
      assert.equal(controlsFit, true);
      await type(".pw-bar__search-input", "missing"); await delay(30);
      const recoveryFits = await run("(()=>{const r=document.querySelector('.pw-content__recover').getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight&&r.right<innerWidth})()");
      assert.equal(recoveryFits, true);
      win.setSize(1000, 700);
    });
    const legacyRead = await readDirectory(null, path.join(temp, "unavailable"));
    assert.equal(legacyRead.length, 0, "existing callers retain their empty-array fallback");
    assert.deepEqual(errors, [], "renderer console errors");
    if (failed) throw new Error(`${failed} project-file checks failed`);
    console.log("All project-file checks passed."); win.destroy(); app.exit(0);
  } catch (err) { console.error(err); app.exit(1); }
}).catch((err) => { console.error(err); app.exit(1); });
