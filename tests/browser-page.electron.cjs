const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-browser-page-"));
app.setPath("userData", temp); app.setPath("sessionData", temp);
fs.writeFileSync(path.join(temp, "page.html"), '<!doctype html><html><head><title>Find fixture</title></head><body style="font:16px system-ui;padding:24px"><h1>Project preview</h1><p>alpha: first section</p><p>beta: another section</p><p>alpha: second section</p><p>alpha: third section</p></body></html>');
fs.writeFileSync(path.join(temp, "preload.cjs"), `const{contextBridge}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{onBrowserShortcut:()=>()=>{},onLiveEditFileChanged:()=>()=>{}});`);
require("esbuild").buildSync({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import Browser from './electron/renderer/components/Browser/index.jsx';import './electron/renderer/variables.css';import './electron/renderer/layout.css';createRoot(document.getElementById('root')).render(<Browser nodeId="browser-page" config={{url:${JSON.stringify(pathToFileURL(path.join(temp, "page.html")).href)}}}/>);`, resolveDir: root, loader: "jsx" }, bundle: true, platform: "browser", outfile: path.join(temp, "ui.js"), define: { "process.env.NODE_ENV": '"production"' } });
fs.writeFileSync(path.join(temp, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 840, height: 500, webPreferences: { offscreen: true, webviewTag: true, preload: path.join(temp, "preload.cjs"), contextIsolation: true, sandbox: false } });
  win.webContents.setBackgroundThrottling(false);
  const run = (code) => win.webContents.executeJavaScript(code);
  const wait = async (code) => { for (let i = 0; i < 160; i++) { if (await run(code)) return; await delay(25); } throw new Error(`Timed out: ${code}`); };
  const type = (text) => run(`(()=>{const el=document.querySelector('[aria-label="Find in page"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  try {
    await win.loadFile(path.join(temp, "index.html"));
    await wait("(()=>{try{return document.querySelector('webview')?.getURL().endsWith('/page.html')}catch{return false}})()");
    await run("window.findResults=[];document.querySelector('webview').addEventListener('found-in-page',e=>window.findResults.push(e.result))");
    await wait("document.querySelector('webview').executeJavaScript('document.readyState===\"complete\"')");
    await run("document.querySelector('.browser__url').dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}))");
    await wait("!!document.querySelector('[aria-label=\"Find in page\"]')");
    await type("alpha"); await wait("document.querySelector('.browser__findbar [role=status]').textContent==='1/3'");
    await run("document.querySelector('[aria-label=\"Next match\"]').click()");
    await wait("document.querySelector('.browser__findbar [role=status]').textContent==='2/3'");
    await run("document.querySelector('[aria-label=\"Previous match\"]').click()");
    await wait("document.querySelector('.browser__findbar [role=status]').textContent==='1/3'");
    console.log("PASS: a real embedded local page finds all matches and moves next/previous");
    await type("ALPHA"); await wait("document.querySelector('.browser__findbar [role=status]').textContent.endsWith('/3')");
    await run("document.querySelector('[aria-label=\"Match case\"]').click()");
    await wait("document.querySelector('.browser__findbar [role=status]').textContent==='No matches'");
    assert.equal(await run("document.querySelector('[aria-label=\"Next match\"]').disabled"), true);
    await run("document.querySelector('[aria-label=\"Match case\"]').click()");
    await wait("document.querySelector('.browser__findbar [role=status]').textContent.endsWith('/3')");
    console.log("PASS: a real embedded local page updates match-case and no-match feedback");
    if (process.argv.includes("--capture")) {
      await delay(100);
      fs.writeFileSync(path.join(temp, "browser-find.png"), (await win.webContents.capturePage()).toPNG());
      console.log("Screenshot:", path.join(temp, "browser-find.png"));
    }
    await run("document.querySelector('[aria-label=\"Close find\"]').click()"); await wait("!document.querySelector('.browser__findbar')");
    win.destroy(); app.exit(0);
  } catch (e) { console.error(e); console.log(await run("JSON.stringify({status:document.querySelector('.browser__findbar')?.textContent,results:window.findResults})")); app.exit(1); }
}).catch((e) => { console.error(e); app.exit(1); });
