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
  ahead = 1,
  behind = 0,
  statusRows = [],
  commitCalls = [],
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
        ahead,
        behind,
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
    case "gitCommit":
    case "gitCommitAmend":
      commitCalls.push([method, ...args]);
      return held("commit", args[0]);
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
  "gitCommit",
  "gitCommitAmend",
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
      await wait(() =>
        run(
          "document.querySelector('.git-primary-action')?.getAttribute('aria-busy')==='false' && !document.querySelector('[aria-label=\"Syncing\"]')",
        ),
      );
    };
    const refreshCount = () =>
      reads.filter(([kind]) => kind === "status").length;
    const reset = async (
      remote = true,
      rows = [],
      branch = { ahead: 1, behind: 0 },
    ) => {
      hasRemote = remote;
      ahead = branch.ahead;
      behind = branch.behind;
      statusRows = rows;
      commitCalls = [];
      calls = [];
      reads = [];
      pending = [];
      await win.loadFile(path.join(profile, "index.html"));
      await wait(() =>
        run(
          "!!document.querySelector('.git-primary-action') && !document.querySelector('[aria-label=\"Syncing\"]')",
        ),
      );
      await delay(60);
    };
    const typeMessage = async (text) => {
      await run(
        `(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await wait(() =>
        run(
          "document.querySelector('.git-primary-action').getAttribute('aria-label')==='Commit' && !document.querySelector('.git-primary-action').disabled",
        ),
      );
    };
    const capture = async (name) => {
      if (!process.argv.includes("--screenshots")) return;
      await run(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
      );
      await delay(100);
      const dir = path.join(root, ".appdata", "git-sync-evidence");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, name + ".png"),
        (await win.webContents.capturePage()).toPNG(),
      );
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
        "primary Sync supports keyboard activation, loading feedback and duplicate prevention",
        async () => {
          await ready();
          assert.equal(
            await run(
              "!!document.querySelector('.git-panel > div:first-child [aria-label=\"Sync\"]')",
            ),
            false,
          );
          await capture("primary-sync-ready");
          const before = refreshCount();
          win.webContents.focus();
          await run("document.querySelector('[aria-label=\"Sync\"]').focus()");
          win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
          win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
          await wait(() => pending.length === 1);
          await capture("primary-sync-loading");
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
        "file-list shortcuts do not intercept Enter or Space on the primary Commit action",
        async () => {
          await reset(true, [
            { rel: "changed.js", status: "M ", x: "M", y: " " },
          ]);
          await run(
            "document.querySelector('.git-panel').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))",
          );
          await delay(30);
          for (const keyCode of ["Enter", "Space"]) {
            await typeMessage("Update changed file");
            win.webContents.focus();
            await run("document.querySelector('.git-primary-action').focus()");
            win.webContents.sendInputEvent({ type: "keyDown", keyCode });
            win.webContents.sendInputEvent({
              type: "char",
              keyCode: keyCode === "Enter" ? "\r" : " ",
            });
            win.webContents.sendInputEvent({ type: "keyUp", keyCode });
            await wait(() => pending.length === 1);
            await finish({ ok: true });
          }
          assert.equal(commitCalls.length, 2);
          assert.equal(calls.length, 0);
        },
      );
      await check(
        "incoming, outgoing, and diverged branches use the main Sync button",
        async () => {
          for (const branch of [
            { ahead: 2, behind: 0 },
            { ahead: 0, behind: 3 },
            { ahead: 2, behind: 3 },
          ]) {
            await reset(true, [], branch);
            await ready();
            const label = await run(
              "document.querySelector('.git-primary-action').textContent",
            );
            assert.match(label, /Sync Changes/);
            if (branch.ahead) assert.ok(label.includes(`${branch.ahead}↑`));
            if (branch.behind) assert.ok(label.includes(`${branch.behind}↓`));
            assert.equal(
              await run(
                "document.querySelector('textarea').parentElement.parentElement.contains(document.querySelector('[aria-label=\"Sync\"]'))",
              ),
              true,
            );
            assert.equal(
              await run(
                "document.querySelectorAll('[aria-label=\"Sync\"]').length",
              ),
              1,
            );
          }
        },
      );
      await check(
        "local changes, drafts, and Amend keep the primary commit action",
        async () => {
          for (const row of [
            { rel: "changed.js", status: " M", x: " ", y: "M" },
            { rel: "changed.js", status: "M ", x: "M", y: " " },
          ]) {
            await reset(true, [row]);
            assert.equal(
              await run(
                "document.querySelector('.git-primary-action').getAttribute('aria-label')",
              ),
              "Commit",
            );
          }
          await reset();
          await typeMessage("Draft commit message");
          assert.equal(
            await run("document.querySelector('textarea').value"),
            "Draft commit message",
          );
          await reset();
          await click('[aria-label="More commit actions"]');
          await run(
            "[...document.querySelectorAll('button')].find(button=>button.textContent==='Amend Last Commit').click()",
          );
          await wait(() =>
            run(
              "document.querySelector('.git-primary-action').getAttribute('aria-label')==='Amend'",
            ),
          );
          assert.equal(calls.length, 0);
        },
      );
      await check(
        "an up-to-date branch keeps Commit and offers manual Sync in the menu",
        async () => {
          await reset(true, [], { ahead: 0, behind: 0 });
          assert.equal(
            await run(
              "document.querySelector('.git-primary-action').getAttribute('aria-label')",
            ),
            "Commit",
          );
          assert.equal(
            await run("document.querySelector('.git-primary-action').disabled"),
            true,
          );
          await menu();
          await menuSync(false);
          await wait(() => pending.length === 1);
          await finish({ ok: true });
          assert.equal(
            await run("document.querySelector('[role=status]').textContent"),
            "Synced",
          );
        },
      );
      await check(
        "the main button changes from Commit to Sync and back after completion",
        async () => {
          await reset(
            true,
            [{ rel: "changed.js", status: "M ", x: "M", y: " " }],
            { ahead: 0, behind: 0 },
          );
          await typeMessage("Update changed file");
          await capture("primary-commit-ready");
          await click(".git-primary-action");
          await wait(() => pending.length === 1);
          assert.equal(pending[0].kind, "commit");
          assert.match(
            await run(
              "document.querySelector('.git-primary-action').textContent",
            ),
            /Committing/,
          );
          statusRows = [];
          ahead = 2;
          await finish({ ok: true });
          await ready();
          assert.deepEqual(commitCalls, [
            ["gitCommit", project, "Update changed file"],
          ]);
          assert.ok(
            (
              await run(
                "document.querySelector('.git-primary-action').textContent",
              )
            ).includes("2↑"),
          );
          await capture("primary-sync-after-commit");
          await click('[aria-label="Sync"]');
          await wait(() => pending.length === 1);
          assert.equal(pending[0].kind, "sync");
          ahead = 0;
          behind = 0;
          await finish({ ok: true });
          assert.equal(
            await run(
              "document.querySelector('.git-primary-action').getAttribute('aria-label')",
            ),
            "Commit",
          );
          assert.equal(
            await run("document.querySelector('.git-primary-action').disabled"),
            true,
          );
          assert.equal(
            await run("document.querySelector('[role=status]').textContent"),
            "Synced",
          );
          await capture("primary-sync-complete");
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
          await run(
            "document.querySelector('.git-primary-action').getAttribute('aria-label')==='Commit' && document.querySelector('.git-primary-action').disabled",
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
            await reset(true, [], { ahead: 12345, behind: 67890 });
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
