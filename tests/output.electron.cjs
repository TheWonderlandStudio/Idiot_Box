const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-output-"));
app.setPath("userData", temp); app.setPath("sessionData", temp);
fs.writeFileSync(path.join(temp, "preload.cjs"), `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{
  extList:async()=>[{id:'sample.tool',name:'Sample Tool'}],onExtChanged:()=>()=>{},onSettingsUpdated:()=>()=>{},
  clipboardWrite:async text=>{window.copied=text;ipcRenderer.send('test:copied',text)},
  onOutputLog:cb=>{const handler=(_e,entry)=>cb(entry);ipcRenderer.on('test:log',handler);return()=>ipcRenderer.removeListener('test:log',handler)}
});`);
let copied;
require("electron").ipcMain.on("test:copied", (_e, text) => { copied = text; });
const building = require("esbuild").build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Output from './electron/renderer/components/Output/index.jsx';import './electron/renderer/variables.css';import './electron/renderer/layout.css';
window.terms=[];function Harness(){const[count,setCount]=useState(0);window.mountOutput=setCount;return <div style={{display:'flex',height:'100vh'}}>{Array.from({length:count},(_,i)=><section key={i} id={'panel'+i} style={{flex:1,minWidth:0}}><Output/></section>)}</div>}createRoot(document.getElementById('root')).render(<Harness/>);`, resolveDir: root, loader: "jsx" }, bundle: true, platform: "browser", outfile: path.join(temp, "ui.js"), define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "observe-terminal", setup(build) {
  build.onResolve({ filter: /^@xterm\/xterm$/ }, () => ({ path: "terminal-observer", namespace: "test" }));
  build.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: `import{Terminal as RealTerminal}from ${JSON.stringify(require.resolve("@xterm/xterm"))};export class Terminal extends RealTerminal{constructor(...args){super(...args);window.terms.push(this)}}`, resolveDir: root }));
} }] });
fs.writeFileSync(path.join(temp, "index.html"), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
Promise.all([app.whenReady(), building]).then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 600, webPreferences: { offscreen: true, preload: path.join(temp, "preload.cjs"), contextIsolation: true, sandbox: false } });
  win.webContents.setBackgroundThrottling(false);
  const run = (code) => win.webContents.executeJavaScript(code);
  const until = async (predicate, label) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(25); } throw new Error(`Timed out: ${label}`); };
  const wait = (code) => until(() => run(code), code);
  const mount = async (count = 1) => { await run(`window.mountOutput(${count})`); await wait(`window.terms.length>=${count}`); await delay(80); };
  const text = (index = 0) => run(`(()=>{const b=window.terms[${index}].buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i).translateToString(true)).join(String.fromCharCode(10))})()`);
  const log = (message, channel = "App") => run(`window.__outputLog(${JSON.stringify(channel)},${JSON.stringify(message)})`);
  const selectChannel = (channel) => run(`(()=>{const el=document.querySelector('#panel0 select');el.value=${JSON.stringify(channel)};el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  let failed = 0;
  const check = async (name, body) => {
    copied = undefined;
    await win.loadFile(path.join(temp, "index.html")); await wait("!!window.mountOutput");
    try { await body(); console.log("PASS:", name); } catch (e) { failed++; console.error("FAIL:", name, e.message); }
  };
  try {
    await check("main-process logs are buffered before the first Output view opens", async () => {
      win.webContents.send("test:log", { channel: "App", message: "early-log" }); await delay(60);
      assert.equal(await run("window.__outputBuffer.App?.length||0"), 1);
      await mount(); await until(async () => (await text()).includes("early-log"), "early log rendered");
    });
    await check("two Output views receive one shared copy of each log", async () => {
      await mount(2); win.webContents.send("test:log", { channel: "App", message: "one-log" }); await delay(80);
      assert.equal(await run("window.__outputBuffer.App.length"), 1);
      for (let i = 0; i < 2; i++) assert.equal((await text(i)).split("one-log").length - 1, 1);
    });
    await check("renderer clear removes the terminal text as well as its buffer", async () => {
      await mount(); await log("old-renderer-output"); await until(async () => (await text()).includes("old-renderer-output"), "old output");
      await run("window.__outputClear('App')"); await delay(80);
      assert.equal((await text()).includes("old-renderer-output"), false);
    });
    await check("switching channels removes the previous progress line", async () => {
      await mount(); await log("x".repeat(55) + " OLD_PROGRESS_TAIL\r");
      await until(async () => (await text()).includes("OLD_PROGRESS_TAIL"), "progress output");
      await log("new", "Git"); await selectChannel("Git"); await delay(80);
      assert.equal((await text()).includes("OLD_PROGRESS_TAIL"), false);
      assert.equal((await text()).includes("new"), true);
    });
    await check("manually pausing Follow stays paused when new logs arrive", async () => {
      await mount(); await run("document.querySelector('#panel0 button').click()");
      await log(Array.from({length:70},(_,i)=>`line-${i}`).join("\n")); await delay(100);
      assert.equal(await run("document.querySelector('#panel0 button').title.includes('off')"), true);
    });
    if (!process.argv.includes("--baseline")) {
      await check("Clear in one view clears every view of that channel", async () => {
        await mount(2); await log("shared-output"); await delay(80);
        await run("[...document.querySelectorAll('#panel0 button')].find(b=>b.textContent==='Clear').click()"); await delay(80);
        for (let i = 0; i < 2; i++) assert.equal((await text(i)).includes("shared-output"), false);
      });
      await check("Copy output uses plain rendered text and joins wrapped rows", async () => {
        await mount(); await log("\x1b[31mred text\x1b[0m\n" + "long ".repeat(40));
        await until(async () => (await text()).includes("red text"), "colored output");
        await run("document.querySelector('[aria-label=\"Copy App output\"]').click()");
        await until(() => !!copied, "copied output");
        assert.equal(copied.includes("red text"), true);
        assert.equal(copied.includes("\x1b"), false);
        assert.equal(copied.includes("long ".repeat(39) + "long"), true);
        assert.equal(await run("document.querySelector('[role=status]').textContent.includes('Copied')"), true);
      });
      await check("project reset clears a non-App channel and queued writes", async () => {
        await mount(); await selectChannel("Git");
        await run("window.__outputLog('Git','old-project');for(const key of Object.keys(window.__outputBuffer))window.__outputBuffer[key]=[];window.dispatchEvent(new CustomEvent('output:log',{detail:{channel:'App'}}))");
        await delay(80); assert.equal((await text()).includes("old-project"), false);
        await log("new-project", "Git"); await delay(80);
        assert.equal((await text()).includes("new-project"), true);
        assert.equal((await text()).includes("old-project"), false);
      });
      await check("Follow resumes immediately and scrolls to the newest line", async () => {
        await mount(); await log(Array.from({length:90},(_,i)=>`row-${i}`).join("\n")); await delay(80);
        await run("window.terms[0].scrollToTop()"); await delay(30);
        assert.equal(await run("document.querySelector('[aria-label=\"Follow output\"]').getAttribute('aria-pressed')"), "false");
        await run("document.querySelector('[aria-label=\"Follow output\"]').click()"); await delay(30);
        assert.equal(await run("window.terms[0].buffer.active.viewportY===window.terms[0].buffer.active.baseY"), true);
      });
      await check("the Output toolbar fits a small panel", async () => {
        win.setSize(300, 400); await mount(); await log("message"); await delay(80);
        assert.equal(await run("[...document.querySelectorAll('#panel0 button,#panel0 select')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>10})"), true);
        win.setSize(1000, 600);
      });
      await check("an installed extension has a named channel before its first log", async () => {
        await mount();
        await wait("!!document.querySelector('option[value=\"ext:sample.tool\"]')");
        assert.equal(await run("document.querySelector('option[value=\"ext:sample.tool\"]').textContent"), "Sample Tool");
        await selectChannel("ext:sample.tool"); await delay(30);
        assert.equal(await run("document.querySelector('[aria-label=\"Copy ext:sample.tool output\"]').disabled"), true);
      });
    }
    if (failed) throw new Error(`${failed} Output checks failed`);
    console.log("All Output checks passed."); win.destroy(); app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
}).catch((error) => { console.error(error); app.exit(1); });
