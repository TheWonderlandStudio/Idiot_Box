const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-browser-"));
app.setPath("userData", temp); app.setPath("sessionData", temp);
fs.writeFileSync(path.join(temp, "preload.cjs"), `const{contextBridge}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{onBrowserShortcut:()=>()=>{},onLiveEditFileChanged:()=>()=>{}});`);
require("esbuild").buildSync({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import Browser from './electron/renderer/components/Browser/index.jsx';import './electron/renderer/variables.css';import './electron/renderer/layout.css';
window.test={find:[],loads:[],tabs:[],reload:0,hardReload:0,stopFind:0};let request=0;const create=document.createElement.bind(document);document.createElement=(name,...args)=>{const el=create(name,...args);if(name==='webview'){window.guest=el;el.tabIndex=0;el.url='http://localhost:3000';Object.assign(el,{getURL:()=>el.url,getWebContentsId:()=>1001,canGoBack:()=>false,canGoForward:()=>false,getZoomFactor:()=>1,setZoomFactor:()=>{},executeJavaScript:async()=>null,loadURL:async url=>{window.test.loads.push(url);el.url=url},reload:()=>window.test.reload++,reloadIgnoringCache:()=>window.test.hardReload++,stop:()=>{},stopFindInPage:()=>window.test.stopFind++,findInPage:(text,options)=>{const id=++request;window.test.find.push({id,text,options});return id}})}return el};
window.__flexModel={current:{getNodeById:()=>null,getActiveTabset:()=>({getSelectedNode:()=>({getId:()=>'test-browser'})})}};window.addEventListener('add-browser-panel',e=>window.test.tabs.push(e.detail.url));createRoot(document.getElementById('root')).render(<Browser nodeId="test-browser" config={{url:'http://localhost:3000'}}/>);`, resolveDir: root, loader: "jsx" }, bundle: true, platform: "browser", outfile: path.join(temp, "ui.js"), define: { "process.env.NODE_ENV": '"production"' } });
fs.writeFileSync(path.join(temp, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 550, webPreferences: { offscreen: true, preload: path.join(temp, "preload.cjs"), contextIsolation: true, sandbox: false } });
  win.webContents.setBackgroundThrottling(false);
  const errors = [];
  win.webContents.on("console-message", (e) => { if (e.level === "error") errors.push(e.message); });
  const run = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code) => { for (let i = 0; i < 100; i++) { if (await run(code)) return; await delay(25); } throw new Error(`Timed out: ${code}`); };
  const key = (selector, key, options = {}) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true,...${JSON.stringify(options)}}))})()`);
  const type = (selector, text) => run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const openFind = async () => { await key(".browser__url", "f", { ctrlKey: true }); await wait("!!document.querySelector('.browser__findbar')"); };
  const result = (id, matches) => run(`(()=>{const e=new Event('found-in-page');e.result={requestId:${id},activeMatchOrdinal:1,matches:${matches},finalUpdate:true};window.guest.dispatchEvent(e)})()`);
  let failed = 0;
  const check = async (name, body) => {
    await win.loadFile(path.join(temp, "index.html")); await wait("!!document.querySelector('.browser__url')"); await delay(60);
    try { await body(); console.log("PASS:", name); } catch (e) { failed++; console.error("FAIL:", name, e.message); }
  };
  try {
    await check("closing Find cancels its pending search", async () => {
      await openFind(); await type('[aria-label="Find in page"]', "alpha"); await key('[aria-label="Find in page"]', "Escape"); await delay(180);
      assert.equal(await run("window.test.find.length"), 0);
    });
    await check("a result from an older query cannot replace the current count", async () => {
      await openFind(); await type('[aria-label="Find in page"]', "alpha"); await wait("window.test.find.length===1");
      await type('[aria-label="Find in page"]', "beta"); await wait("window.test.find.length===2");
      const [old, current] = await run("window.test.find.map(r=>r.id)");
      await result(current, 3); await delay(30); await result(old, 99); await delay(30);
      assert.equal(await run("document.querySelector('.browser__findbar').textContent.includes('1/3')"), true);
    });
    await check("background navigation preserves an address being edited", async () => {
      await run("document.querySelector('.browser__url').focus()"); await type(".browser__url", "new-address.test/path"); await delay(30);
      await run("window.guest.url='http://localhost:3000/background';window.guest.dispatchEvent(new Event('did-navigate-in-page'))"); await delay(30);
      assert.equal(await run("document.querySelector('.browser__url').value"), "new-address.test/path");
    });
    await check("Ctrl+F5 reaches hard reload", async () => {
      await key(".browser__url", "F5", { ctrlKey: true });
      assert.deepEqual(await run("[window.test.reload,window.test.hardReload]"), [0, 1]);
    });
    if (!process.argv.includes("--baseline")) {
      await check("changing match case cancels the previous delayed request", async () => {
        await openFind(); await type('[aria-label="Find in page"]', "alpha");
        await run("document.querySelector('[title=\"Match case: off\"]').click()"); await delay(180);
        assert.equal(await run("window.test.find.every(r=>r.options.matchCase)"), true);
        assert.equal(await run("window.test.find.length"), 1);
      });
      await check("Escape closes Find and returns focus to the page", async () => {
        await openFind(); await key('[aria-label="Find in page"]', "Escape"); await delay(30);
        assert.equal(await run("document.querySelector('.browser__findbar')===null&&document.activeElement===window.guest"), true);
      });
      await check("Alt+Enter opens the address in another tab", async () => {
        await type(".browser__url", ":5173"); await key(".browser__url", "Enter", { altKey: true }); await delay(30);
        assert.deepEqual(await run("window.test.tabs"), ["http://localhost:5173"]);
        assert.deepEqual(await run("window.test.loads"), []);
      });
      await check("search text containing a dotted name stays a search", async () => {
        await type(".browser__url", "react.js error"); await key(".browser__url", "Enter");
        assert.deepEqual(await run("window.test.loads"), ["https://www.google.com/search?q=react.js%20error"]);
      });
      await check("Ctrl+L restores a hidden toolbar and selects its address", async () => {
        await run("document.querySelector('[title=\"More options\"]').click()"); await wait("!!document.querySelector('[title=\"Hide toolbar\"]')");
        await run("document.querySelector('[title=\"Hide toolbar\"]').click()"); await wait("!document.querySelector('.browser__url')");
        await key("webview", "l", { ctrlKey: true }); await wait("!!document.querySelector('.browser__url')"); await delay(40);
        assert.equal(await run("document.activeElement===document.querySelector('.browser__url')&&document.activeElement.selectionEnd===document.activeElement.value.length"), true);
      });
      await check("Escape restores the latest live address after a background change", async () => {
        await run("document.querySelector('.browser__url').focus()"); await type(".browser__url", "draft");
        await run("window.guest.url='http://localhost:3000/latest';window.guest.dispatchEvent(new Event('did-navigate'))"); await delay(30);
        await key(".browser__url", "Escape"); await delay(30);
        assert.equal(await run("document.querySelector('.browser__url').value"), "http://localhost:3000/latest");
      });
      await check("clearing Find discards late results and leaves no hidden search", async () => {
        await openFind(); await type('[aria-label="Find in page"]', "alpha"); await wait("window.test.find.length===1");
        const id = await run("window.test.find[0].id"); await type('[aria-label="Find in page"]', ""); await result(id, 50); await delay(150);
        assert.equal(await run("document.querySelector('.browser__findbar').textContent.includes('50')"), false);
        assert.equal(await run("window.test.find.length"), 1);
      });
      await check("Find remains usable in a narrow browser panel", async () => {
        win.setSize(340, 420); await openFind(); await type('[aria-label="Find in page"]', "missing"); await wait("window.test.find.length===1");
        await result(await run("window.test.find[0].id"), 0); await delay(30);
        assert.equal(await run("document.querySelector('.browser__findbar').textContent.includes('No matches')"), true);
        assert.equal(await run("[...document.querySelectorAll('.browser__findbar input,.browser__findbar button')].every(el=>{const r=el.getBoundingClientRect();return r.width>=14&&r.left>=0&&r.right<=innerWidth})"), true);
        win.setSize(900, 550);
      });
      await check("Enter before debounce starts a search session, then advances it", async () => {
        await openFind(); await type('[aria-label="Find in page"]', "alpha"); await key('[aria-label="Find in page"]', "Enter");
        await wait("window.test.find.length===1");
        assert.equal(await run("window.test.find[0].options.findNext"), true);
        await result(await run("window.test.find[0].id"), 3);
        await key('[aria-label="Find in page"]', "Enter"); await delay(160);
        assert.equal(await run("window.test.find.length"), 2);
        assert.equal(await run("window.test.find[1].options.findNext"), false);
      });
      await check("Enter during text composition does not navigate", async () => {
        await type(".browser__url", "draft"); await key(".browser__url", "Enter", { isComposing: true });
        assert.equal(await run("window.test.loads.length"), 0);
      });
    }
    assert.deepEqual(errors, [], "renderer console errors");
    if (failed) throw new Error(`${failed} Browser checks failed`);
    console.log("All Browser checks passed."); win.destroy(); app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
}).catch((e) => { console.error(e); app.exit(1); });
