const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-navigation-"));
app.setPath("userData", temp);
app.setPath("sessionData", temp);
const first = path.join(temp, "first"), second = path.join(temp, "second");
const queues = { files: [], search: [], confirm: [] }, replacements = [];
let holdFiles = false, holdSearch = false, holdConfirm = false;
let matchCount = 1, missing = false;
const file = (folder, name) => ({ path: path.join(folder, name), rel: name, name });
const result = (folder, name) => ({ ok: true, engine: "node", results: [{ ...file(folder, name), matches: Array.from({ length: matchCount }, (_, i) => ({ line: i + 1, column: 0, lineText: "alpha beta" })) }] });
ipcMain.handle("test:files", (_e, folder, query) => holdFiles && query
  ? new Promise((resolve) => queues.files.push({ folder, query, resolve })) : []);
ipcMain.handle("test:search", (_e, payload) => holdSearch
  ? new Promise((resolve) => queues.search.push({ ...payload, resolve })) : result(payload.rootPath, "sample.js"));
ipcMain.handle("test:confirm", () => holdConfirm ? new Promise((resolve) => queues.confirm.push(resolve)) : true);
ipcMain.handle("test:replace", (_e, payload) => { replacements.push(payload); return { ok: true, replaced: 1, fileCount: 1, undoToken: "replace-token" }; });
ipcMain.handle("test:undo", () => ({ ok: true, restored: 1 }));
ipcMain.handle("test:stat", () => ({ exists: !missing, isDir: false }));
fs.writeFileSync(path.join(temp, "preload.cjs"), `const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  readSettings:async()=>({}), extCommands:async()=>[], onExtChanged:()=>()=>{}, onMenuEvent:(name,cb)=>{const h=(_e,...args)=>cb(...args);ipcRenderer.on(name,h);return()=>ipcRenderer.removeListener(name,h)},
  findFiles:(...args)=>ipcRenderer.invoke('test:files',...args), projectSearch:p=>ipcRenderer.invoke('test:search',p),
  projectReplace:p=>ipcRenderer.invoke('test:replace',p), projectReplaceUndo:p=>ipcRenderer.invoke('test:undo',p),
  confirmDialog:()=>ipcRenderer.invoke('test:confirm'), stat:p=>ipcRenderer.invoke('test:stat',p)
});`);
require("esbuild").buildSync({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Palette from './electron/renderer/components/CommandPalette/index.jsx';import Search from './electron/renderer/components/SearchPanel/index.jsx';import './electron/renderer/variables.css'; window.__currentProjectPath=${JSON.stringify(first)};createRoot(document.getElementById('root')).render(<><Palette/><Search/></>);`, resolveDir: root, loader: "jsx" }, bundle: true, platform: "browser", outfile: path.join(temp, "ui.js"), define: { "process.env.NODE_ENV": '"production"' } });
fs.writeFileSync(path.join(temp, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><button id="launch">Return here</button><div id="root"></div><script src="ui.js"></script></body></html>');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 720, webPreferences: { offscreen: true, preload: path.join(temp, "preload.cjs"), contextIsolation: true, sandbox: false } });
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (e) => { if (e.level === "error") errors.push(e.message); });
  const run = (code) => win.webContents.executeJavaScript(code);
  const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(30); } throw new Error(`Timed out: ${label}`); };
  const wait = (code) => until(() => run(code), code);
  const type = (selector, text) => run(`(() => {const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const reset = async () => {
    matchCount = 1; missing = false;
    holdFiles = holdSearch = holdConfirm = false; replacements.length = 0;
    for (const q of queues.files.splice(0)) q.resolve([]);
    for (const q of queues.search.splice(0)) q.resolve({ ok: true, results: [] });
    for (const resolve of queues.confirm.splice(0)) resolve(false);
    await win.loadFile(path.join(temp, "index.html"));
    await run("localStorage.clear(); document.getElementById('launch').focus()");
    await delay(80);
  };
  let failed = 0;
  const check = async (name, body) => { await reset(); try { await body(); console.log("PASS:", name); } catch (e) { failed++; console.error("FAIL:", name, e.message); } };
  try {
    await check("Quick Open ignores responses for an older query", async () => {
      holdFiles = true;
      await run("window.dispatchEvent(new CustomEvent('quickopen:open'))");
      await wait("!!document.querySelector('.ui-pop input')");
      await type(".ui-pop input", "alpha");
      await until(() => queues.files.some((q) => q.query === "alpha"), "alpha request");
      await type(".ui-pop input", "beta");
      await until(() => queues.files.some((q) => q.query === "beta"), "beta request");
      queues.files.find((q) => q.query === "beta").resolve([file(first, "beta.js")]);
      await wait("document.querySelector('.ui-pop').textContent.includes('beta.js')");
      queues.files.find((q) => q.query === "alpha").resolve([file(first, "alpha.js")]);
      await delay(80);
      assert.equal(await run("document.querySelector('.ui-pop').textContent.includes('alpha.js')"), false);
    });
    await check("command-only mode cannot be repopulated by a file response", async () => {
      holdFiles = true;
      await run("window.dispatchEvent(new CustomEvent('quickopen:open'))");
      await wait("!!document.querySelector('.ui-pop input')");
      await type(".ui-pop input", "alpha");
      await until(() => queues.files.length > 0, "file request");
      await type(".ui-pop input", ">save");
      queues.files[0].resolve([file(first, "alpha.js")]);
      await delay(80);
      assert.equal(await run("document.querySelector('.ui-pop').textContent.includes('alpha.js')"), false);
    });
    await check("Replace All is disabled as soon as the query changes", async () => {
      await run("window.dispatchEvent(new CustomEvent('search:open',{detail:{mode:'replace'}}))");
      await wait("!!document.querySelector('[aria-label=\"Search query\"]')");
      await type('[aria-label="Search query"]', "alpha");
      await wait("document.querySelectorAll('.ibx-search-match').length === 1");
      await type('[aria-label="Search query"]', "beta");
      await delay(30);
      assert.equal(await run("document.querySelector('[data-tone=accent]').disabled"), true);
    });
    await check("switching projects while confirming replacement cancels the write", async () => {
      holdConfirm = true;
      await run("window.dispatchEvent(new CustomEvent('search:open',{detail:{mode:'replace'}}))");
      await wait("!!document.querySelector('[aria-label=\"Search query\"]')");
      await type('[aria-label="Search query"]', "alpha");
      await wait("document.querySelectorAll('.ibx-search-match').length === 1");
      await run("document.querySelector('[data-tone=accent]').click()");
      await until(() => queues.confirm.length > 0, "confirmation");
      await run(`window.__currentProjectPath=${JSON.stringify(second)};window.dispatchEvent(new CustomEvent('project:opened',{detail:{path:${JSON.stringify(second)}}}))`);
      queues.confirm[0](true);
      await delay(100);
      assert.equal(replacements.length, 0);
    });
    await check("Quick Open shows recent files without a duplicate file row", async () => {
      await run(`window.dispatchEvent(new CustomEvent('editor:fileActivated',{detail:{path:${JSON.stringify(path.join(first, "recent.js"))}}}));window.dispatchEvent(new CustomEvent('quickopen:open'))`);
      await wait("document.querySelector('.ui-pop').textContent.includes('Recent files')");
      assert.equal(await run("[...document.querySelectorAll('.ui-pop [role=option]')].filter(el=>el.textContent.includes('recent.js')).length"), 1);
      await run(`window.__currentProjectPath=${JSON.stringify(second)};window.dispatchEvent(new CustomEvent('project:opened',{detail:{path:${JSON.stringify(second)}}}))`);
      await delay(80);
      assert.equal(await run("document.querySelector('.ui-pop').textContent.includes('recent.js')"), false);
    });
    await check("unavailable recent files stay out of the editor and explain the problem", async () => {
      missing = true;
      await run(`window.opened=[];window.addEventListener('open-file-in-editor',e=>window.opened.push(e.detail.path));window.dispatchEvent(new CustomEvent('editor:fileActivated',{detail:{path:${JSON.stringify(path.join(first, "missing.js"))}}}));window.dispatchEvent(new CustomEvent('quickopen:open'))`);
      await wait("[...document.querySelectorAll('.ui-pop [role=option]')].some(el=>el.textContent.includes('missing.js'))");
      await run("[...document.querySelectorAll('.ui-pop [role=option]')].find(el=>el.textContent.includes('missing.js')).click()");
      await wait("document.querySelector('.ui-pop [role=alert]')?.textContent.includes('no longer available')");
      assert.equal(await run("window.opened.length"), 0);
    });
    await check("Escape returns focus and Tab stays inside Quick Open", async () => {
      await run("document.getElementById('launch').focus();window.dispatchEvent(new CustomEvent('quickopen:open'))");
      await wait("document.activeElement === document.querySelector('.ui-pop input')");
      await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))");
      assert.equal(await run("document.activeElement === document.querySelector('.ui-pop input')"), true);
      await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
      await wait("document.activeElement.id === 'launch'");
    });
    await check("opening a second navigation dialog replaces the first", async () => {
      await run("document.getElementById('launch').focus();window.dispatchEvent(new CustomEvent('search:open'))");
      await wait("!!document.querySelector('.ibx-search-dialog')");
      await run("window.dispatchEvent(new CustomEvent('quickopen:open'))");
      await wait("!!document.querySelector('.ui-pop') && !document.querySelector('.ibx-search-dialog')");
      await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
      await wait("document.activeElement.id === 'launch'");
    });
    await check("one-character searches run explicitly with Enter", async () => {
      holdSearch = true;
      await run("window.dispatchEvent(new CustomEvent('search:open'))");
      await wait("!!document.querySelector('[aria-label=\"Search query\"]')");
      await type('[aria-label="Search query"]', "x");
      await wait("document.querySelector('.ibx-search-empty')?.textContent.includes('Press Enter')");
      assert.equal(queues.search.length, 0);
      await run("document.querySelector('[aria-label=\"Search query\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))");
      await until(() => queues.search.length === 1, "explicit search");
      assert.equal(queues.search[0].query, "x");
      queues.search[0].resolve(result(first, "x.js"));
      await wait("document.querySelectorAll('.ibx-search-match').length === 1");
    });
    await check("search results can be reached and navigated from the keyboard", async () => {
      matchCount = 2;
      await run("window.dispatchEvent(new CustomEvent('search:open'))");
      await wait("!!document.querySelector('[aria-label=\"Search query\"]')");
      await type('[aria-label="Search query"]', "alpha");
      await wait("document.querySelectorAll('.ibx-search-match').length === 2");
      await run("document.querySelector('[aria-label=\"Search query\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))");
      assert.equal(await run("document.activeElement === document.querySelectorAll('.ibx-search-match')[0]"), true);
      await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))");
      assert.equal(await run("document.activeElement === document.querySelectorAll('.ibx-search-match')[1]"), true);
    });
    await check("replacement feedback survives the follow-up search", async () => {
      await run("window.dispatchEvent(new CustomEvent('search:open',{detail:{mode:'replace'}}))");
      await wait("!!document.querySelector('[aria-label=\"Search query\"]')");
      await type('[aria-label="Search query"]', "alpha");
      await wait("document.querySelectorAll('.ibx-search-match').length === 1");
      await run("document.querySelector('[data-tone=accent]').click()");
      await wait("document.querySelector('.ibx-search-note[role=status]')?.textContent.includes('Replaced 1') && !document.querySelector('[data-tone=accent]').disabled");
      assert.equal(replacements.length, 1);
      await run(`window.__currentProjectPath=${JSON.stringify(second)};window.dispatchEvent(new CustomEvent('project:opened',{detail:{path:${JSON.stringify(second)}}}))`);
      await delay(50);
      assert.equal(await run("!!document.querySelector('[title=\"Undo the last Replace All\"]')"), false);
    });
    await check("search controls and feedback fit a short window", async () => {
      win.setContentSize(700, 420);
      await run("window.dispatchEvent(new CustomEvent('search:open',{detail:{mode:'replace'}}))");
      await wait("!!document.querySelector('.ibx-search-filters-toggle')");
      await run("document.querySelector('.ibx-search-filters-toggle').click()");
      await delay(80);
      assert.equal(await run("document.querySelector('.ibx-search-foot').getBoundingClientRect().bottom <= document.querySelector('.ibx-search-dialog').getBoundingClientRect().bottom + 1"), true);
      win.setContentSize(1000, 720);
    });
    assert.deepEqual(errors, [], "No renderer errors");
  } finally { win.destroy(); app.exit(failed ? 1 : 0); }
}).catch((error) => { console.error(error); app.exit(1); });
