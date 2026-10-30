const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-git-sync-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const project = path.join(profile, "project");
let hasRemote = true,
  statusRows = [],
  calls = [],
  reads = [],
  pending = [];
const held = (kind, rootPath) =>
  new Promise((resolve, reject) =>
    pending.push({ kind, rootPath, resolve, reject }),
  );
ipcMain.handle("test:git", (_event, method, ...args) => {
  switch (method) {
    case "readSettings":
      return {};
    case "getVscodeIcon":
      return null;
    case "gitStatus":
      reads.push(["status", args[0]]);
      return statusRows;
    case "gitLog":
      reads.push(["log", args[0]]);
      return [];
    case "gitBranch":
      return {
        branch: args[0] === project ? "main" : "other-project",
        isRepo: true,
        hasRemote,
      };
    case "gitBranches":
      return { local: ["main"], remote: ["origin/main"], current: "main" };
    case "gitConflicts":
      return [];
    case "gitMenuAction":
      calls.push(args);
      return held("sync", args[0]);
    case "gitFetch":
      return held("fetch", args[0]);
    default:
      throw new Error(`Unexpected Git call: ${method}`);
  }
});
const methods = [
  "readSettings",
  "getVscodeIcon",
  "gitStatus",
  "gitLog",
  "gitBranch",
  "gitBranches",
  "gitConflicts",
  "gitMenuAction",
  "gitFetch",
];
fs.writeFileSync(
  path.join(profile, "preload.cjs"),
  `const {contextBridge,ipcRenderer}=require('electron');const api={};for(const method of ${JSON.stringify(methods)})api[method]=(...args)=>ipcRenderer.invoke('test:git',method,...args);contextBridge.exposeInMainWorld('electronAPI',api);`,
);
require("esbuild").buildSync({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import GitPanel from './electron/renderer/components/GitPanel/index.jsx';import './electron/renderer/variables.css';window.__currentProjectPath=${JSON.stringify(project)};createRoot(document.getElementById('root')).render(<GitPanel/>);`,
    resolveDir: root,
    loader: "jsx",
  },
  bundle: true,
  platform: "browser",
  outfile: path.join(profile, "ui.js"),
  define: { "process.env.NODE_ENV": '"production"' },
});
fs.writeFileSync(
  path.join(profile, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>',
);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 420,
      height: 600,
      webPreferences: {
        offscreen: true,
        sandbox: false,
        contextIsolation: true,
        preload: path.join(profile, "preload.cjs"),
      },
    });
    win.webContents.setBackgroundThrottling(false);
    const rendererErrors = [];
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") rendererErrors.push(event.message);
    });
    const run = (code) => win.webContents.executeJavaScript(code);
    const wait = async (predicate) => {
      for (let i = 0; i < 150; i++) {
        if (await predicate()) return;
        await delay(20);
      }
      throw new Error(`Timed out waiting for Git panel: ${predicate}`);
    };
    const ready = () =>
      wait(() =>
        run("!!document.querySelector('[aria-label=\"Sync\"]:not(:disabled)')"),
      );
    const click = (selector) =>
      run(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const menu = async () => {
      await click('[aria-label="Git actions"]');
      await wait(() =>
        run(
          "!![...document.querySelectorAll('button')].find(el=>el.textContent==='Sync Changes')",
        ),
      );
    };
    const menuSync = (nested) =>
      run(
        `[...document.querySelectorAll('button')].find(el=>el.textContent===${JSON.stringify(nested ? "Sync Changes (Pull, then Push)" : "Sync Changes")}).click()`,
      );
    const finish = async (result) => {
      pending.shift().resolve(result);
      await ready();
    };
    const refreshCount = () =>
      reads.filter(([kind]) => kind === "status").length;
    const reset = async (remote = true, rows = []) => {
      hasRemote = remote;
      statusRows = rows;
      calls = [];
      reads = [];
      pending = [];
      await win.loadFile(path.join(profile, "index.html"));
      await wait(() =>
        run(
          "!!document.querySelector('[aria-label=\"Sync\"]') && !document.querySelector('[aria-label=\"Syncing\"]')",
        ),
      );
      await delay(60);
    };
    let failed = 0;
    const check = async (name, body) => {
      await reset();
      try {
        await body();
        console.log("PASS:", name);
      } catch (error) {
        failed++;
        console.error("FAIL:", name, error.message, rendererErrors.slice(-3));
      }
    };
    try {
      await check(
        "header Sync supports keyboard activation, loading feedback and duplicate prevention",
        async () => {
          await ready();
          const before = refreshCount();
          win.webContents.focus();
          await run("document.querySelector('[aria-label=\"Sync\"]').focus()");
          win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
          win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
          await wait(() => pending.length === 1);
          assert.deepEqual(calls, [[project, "sync"]]);
          assert.equal(
            await run(
              "document.querySelector('[aria-label=\"Sync\"]').getAttribute('aria-busy')",
            ),
            "true",
          );
          assert.equal(
            await run(
              "document.querySelector('[aria-label=\"Push\"]').disabled",
            ),
            true,
          );
          assert.equal(
            await run(
              "[...document.querySelectorAll('[aria-label=\"Refresh\"]')].every(button=>button.disabled)",
            ),
            true,
          );
          await menu();
          assert.equal(
            await run(
              "[...document.querySelectorAll('button')].find(el=>el.textContent==='Sync Changes').disabled",
            ),
            true,
          );
          await menuSync(false);
          await click('[aria-label="Sync"]');
          assert.equal(calls.length, 1);
          await finish({ ok: true });
          assert.equal(
            await run("document.querySelector('[role=status]').textContent"),
            "Synced",
          );
          assert.ok(refreshCount() > before);
          assert.equal(
            reads.filter(([kind]) => kind === "log").length,
            refreshCount(),
          );
        },
      );
      await check(
        "file-list shortcuts do not intercept Enter or Space on Sync",
        async () => {
          await reset(true, [
            { rel: "changed.js", status: " M", x: " ", y: "M" },
          ]);
          await ready();
          await run(
            "document.querySelector('.git-panel').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))",
          );
          await delay(30);
          for (const keyCode of ["Enter", "Space"]) {
            win.webContents.focus();
            await run(
              "document.querySelector('[aria-label=\"Sync\"]').focus()",
            );
            win.webContents.sendInputEvent({ type: "keyDown", keyCode });
            win.webContents.sendInputEvent({
              type: "char",
              keyCode: keyCode === "Enter" ? "\r" : " ",
            });
            win.webContents.sendInputEvent({ type: "keyUp", keyCode });
            await wait(() => pending.length === 1);
            await finish({ ok: true });
          }
          assert.equal(calls.length, 2);
        },
      );
      for (const nested of [false, true])
        await check(
          `${nested ? "nested" : "top-level"} menu Sync uses the same operation`,
          async () => {
            await ready();
            await menu();
            if (nested)
              await run(
                "[...document.querySelectorAll('button')].find(el=>el.textContent==='Pull/Push').click()",
              );
            await menuSync(nested);
            await wait(() => pending.length === 1);
            assert.deepEqual(calls, [[project, "sync"]]);
            await finish({ ok: true });
            assert.equal(
              await run("document.querySelector('[role=status]').textContent"),
              "Synced",
            );
          },
        );
      await check(
        "failed Sync refreshes status and keeps actionable error details",
        async () => {
          await ready();
          const before = refreshCount();
          await click('[aria-label="Sync"]');
          await wait(() => pending.length === 1);
          await finish({
            ok: false,
            error: "CONFLICT: resolve merge conflicts first",
          });
          assert.equal(
            await run("document.querySelector('[role=status]').textContent"),
            "Sync failed",
          );
          assert.equal(
            await run(
              "document.querySelector('.git-panel').textContent.includes('CONFLICT: resolve merge conflicts first')",
            ),
            true,
          );
          assert.ok(refreshCount() > before);
          await click('[aria-label="Sync"]');
          await wait(() => pending.length === 1);
          await finish({ ok: true });
          assert.equal(
            await run("document.querySelector('[role=status]').textContent"),
            "Synced",
          );
        },
      );
      await check(
        "IPC rejection releases the loading state and allows retry",
        async () => {
          await ready();
          await click('[aria-label="Sync"]');
          await wait(() => pending.length === 1);
          pending.shift().reject(new Error("Connection dropped"));
          await ready();
          assert.equal(
            await run("document.querySelector('[role=status]').textContent"),
            "Sync failed",
          );
          assert.equal(
            await run(
              "document.querySelector('.git-panel').textContent.includes('Connection dropped')",
            ),
            true,
          );
        },
      );
      await check("Sync is disabled without a remote", async () => {
        await reset(false);
        assert.equal(
          await run("document.querySelector('[aria-label=\"Sync\"]').disabled"),
          true,
        );
        await menu();
        assert.equal(
          await run(
            "[...document.querySelectorAll('button')].find(el=>el.textContent==='Sync Changes').disabled",
          ),
          true,
        );
        await menuSync(false);
        await click('[aria-label="Sync"]');
        assert.equal(calls.length, 0);
      });
      await check("another Git operation disables Sync", async () => {
        await ready();
        await click('[aria-label="Fetch"]');
        await wait(() => pending.length === 1);
        assert.equal(
          await run("document.querySelector('[aria-label=\"Sync\"]').disabled"),
          true,
        );
        await click('[aria-label="Sync"]');
        assert.equal(calls.length, 0);
        await finish({ ok: true });
      });
      await check(
        "finishing Sync does not show results in a different project",
        async () => {
          await ready();
          await click('[aria-label="Sync"]');
          await wait(() => pending.length === 1);
          await run(
            `window.__currentProjectPath=${JSON.stringify(project + "-other")};window.dispatchEvent(new CustomEvent('project:opened',{detail:{path:window.__currentProjectPath}}))`,
          );
          await wait(() =>
            run(
              "document.querySelector('[title=\"Switch branch\"]').textContent.includes('other-project')",
            ),
          );
          const before = reads.length;
          await finish({ ok: true });
          assert.equal(reads.length, before);
          assert.equal(
            await run("!!document.querySelector('[role=status]')"),
            false,
          );
        },
      );
      await check(
        "Sync remains visible at narrow widths while idle and busy",
        async () => {
          for (const width of [180, 240, 360]) {
            win.setContentSize(width, 600);
            await reset();
            await ready();
            for (const busy of [false, true]) {
              if (busy) {
                await click('[aria-label="Sync"]');
                await wait(() => pending.length === 1);
              }
              assert.equal(
                await run(
                  "(()=>{const p=document.querySelector('.git-panel').getBoundingClientRect(),b=document.querySelector('[aria-label=\"Sync\"]').getBoundingClientRect();return b.width>40&&b.left>=p.left&&b.right<=p.right&&b.top>=p.top&&b.bottom<=p.bottom})()",
                ),
                true,
              );
              if (busy) await finish({ ok: true });
            }
          }
          if (process.argv.includes("--screenshots")) {
            const dir = path.join(root, ".appdata", "git-sync-evidence");
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
              path.join(dir, "sync-success.png"),
              (await win.webContents.capturePage()).toPNG(),
            );
          }
        },
      );
      win.destroy();
      app.exit(failed ? 1 : 0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
