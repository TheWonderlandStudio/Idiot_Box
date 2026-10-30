// Exercise real renderer controls with isolated project fixtures and mocked IPC.
// No native processes, external services, or user projects are touched.
// --panels=editor,canvas narrows the matrix; --scale=1.25 checks display scaling.
// --screenshots writes review captures only to the ignored .appdata directory.
const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const {
  setupTitlebarAndAttachToWindow,
} = require("custom-electron-titlebar/main");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-overflow-"));
app.setPath("userData", profile);
app.setPath("sessionData", profile);
app.commandLine.appendSwitch(
  "force-device-scale-factor",
  process.argv.find((a) => a.startsWith("--scale="))?.split("=")[1] || "1",
);
const fixture = path.join(profile, "project-with-a-long-name");
fs.mkdirSync(fixture);
const file = path.join(fixture, "long-document-name.js");
fs.writeFileSync(file, "export const value = 1;\nexport const second = 2;\n");
fs.writeFileSync(
  path.join(fixture, "preview.html"),
  "<!doctype html><title>Preview</title><p>Local preview fixture</p>",
);
fs.writeFileSync(
  path.join(fixture, "notebook.ipynb"),
  JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }),
);
fs.writeFileSync(
  path.join(fixture, "document.md"),
  "# Preview\n\nA paragraph with a long link: https://example.com/" +
    "long-path".repeat(40),
);
fs.writeFileSync(
  path.join(fixture, "data.csv"),
  "name,value\nexample," + "long-cell".repeat(30),
);
fs.writeFileSync(path.join(fixture, "records.sqlite"), "");
let panel = "editor",
  paneWidth = 320,
  paneHeight = null;
const panels = () => {
  const files = {
    notebook: "notebook.ipynb",
    "editor-md": "document.md",
    "editor-csv": "data.csv",
    "editor-db": "records.sqlite",
  };
  const target = {
    type: "tabset",
    active: true,
    weight: paneHeight || paneWidth,
    children: [
      {
        type: "tab",
        id: "audit-target",
        name: panel,
        component: panel.startsWith("editor-") ? "editor" : panel,
        config: {
          filePath: files[panel] ? path.join(fixture, files[panel]) : file,
          url: require("node:url").pathToFileURL(
            path.join(fixture, "preview.html"),
          ).href,
        },
      },
    ],
  };
  return {
    global: { tabSetEnableDeleteWhenEmpty: false },
    layout: {
      type: "row",
      children: [
        paneHeight
          ? {
              type: "row",
              weight: paneWidth,
              children: [
                target,
                {
                  type: "tabset",
                  weight: 800 - paneHeight,
                  children: [
                    { type: "tab", component: "blank", name: "Space below" },
                  ],
                },
              ],
            }
          : target,
        {
          type: "tabset",
          weight: 1200 - paneWidth,
          children: [{ type: "tab", name: "Space", component: "blank" }],
        },
      ],
    },
  };
};
let settings = {
  githubOnboardingDismissed: true,
  editorMinimap: false,
  minimap: false,
  gitBlame: true,
  gitGutter: false,
  autoSave: true,
};
const readDir = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({
      name: e.name,
      path: path.join(dir, e.name),
      isDir: e.isDirectory(),
    }));
  } catch {
    return [];
  }
};
const handlers = {
  "settings:read": () => settings,
  "settings:write": (_e, next) => {
    settings = next;
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send("settings:updated", settings);
    return true;
  },
  "session:load": () => null,
  "terminal:getProjectPath": () => fixture,
  "projectConfig:readTabs": () => ({ tabs: [], panels: panels() }),
  "fs:readTextFile": (_e, p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  },
  "fs:readDir": (_e, p) => readDir(p),
  "fs:readDirAll": (_e, p) => readDir(p),
  "fs:stat": (_e, p) => {
    try {
      return { exists: true, isDir: fs.statSync(p).isDirectory() };
    } catch {
      return { exists: false, isDir: false };
    }
  },
  "git:blame": () => ({
    ok: true,
    lines: Array.from({ length: 3 }, (_, i) => ({
      line: i + 1,
      author: "A contributor with a very long display name",
      hash: "1234567890abcdef",
      summary:
        "A long commit summary that should never push editor actions outside their pane".repeat(
          3,
        ),
      time: 1700000000,
    })),
  }),
  "git:branch": () => ({
    branch: "main",
    isRepo: true,
    ahead: 0,
    behind: 0,
    hasRemote: true,
  }),
  "git:branches": () => ({
    local: ["main", "feature/a-long-branch-name-for-layout-checks"],
    remote: ["origin/main"],
    current: "main",
  }),
  "ports:list": () => [
    { port: 3000, pid: 1234, process: "node", state: "LISTEN" },
  ],
  "run:probes": () => ({ node: true, npm: true, python: true }),
  "history:list": () => [
    {
      id: "snapshot",
      at: Date.now(),
      reason: "A saved version with a long description",
      size: 100,
    },
  ],
  "history:read": () => ({
    ok: true,
    text: "const previous = true;",
    at: Date.now(),
  }),
  "db:list": () => ({
    objects: [{ name: "records", type: "table" }],
    file: { path: file, size: 1024, mtimeMs: Date.now() },
  }),
  "db:table": () => ({
    table: "records",
    type: "table",
    columns: [
      { name: "id", type: "INTEGER", pk: 1 },
      { name: "description", type: "TEXT" },
    ],
    rows: [{ id: 1, description: "Long sample cell ".repeat(20) }],
    total: 1,
    page: 0,
    pageSize: 50,
    indexes: [],
    sql: "CREATE TABLE records (id INTEGER, description TEXT)",
  }),
  "ext:list": () => [
    {
      id: "layout-check",
      name: "An extension with a very long display name for testing",
      version: "1.0.0",
      enabled: true,
      path: path.join(fixture, "extensions/long-folder-name"),
    },
  ],
  "dialog:confirmSave": () => "discard",
};
const preload = fs.readFileSync(
  path.join(root, "electron/preload/index.js"),
  "utf8",
);
for (const channel of new Set(
  [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]),
))
  ipcMain.handle(channel, handlers[channel] || (() => []));
ipcMain.handle("crx-msg-remote", () => []);
ipcMain.on("clipboard:writeText", (e) => {
  e.returnValue = true;
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app
  .whenReady()
  .then(async () => {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ label: "File", submenu: [{ label: "Open" }] }]),
    );
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 800,
      titleBarStyle: "hidden",
      webPreferences: {
        offscreen: true,
        sandbox: false,
        preload: path.join(root, "electron/preload/preload-bundle.cjs"),
        contextIsolation: true,
        webviewTag: true,
      },
    });
    await setupTitlebarAndAttachToWindow(win);
    win.webContents.setBackgroundThrottling(false);
    win.webContents.session.webRequest.onBeforeRequest(
      { urls: ["https://*/*", "http://*/*"] },
      (_details, callback) => callback({ cancel: true }),
    );
    const run = (code) => win.webContents.executeJavaScript(code);
    const wait = async (code) => {
      for (let i = 0; i < 100; i++) {
        if (await run(code)) return;
        await delay(30);
      }
      throw new Error(`Timed out: ${code}`);
    };
    const report = [];
    const inspect = async (label, scope = "panel") => {
      const result = await run(`(()=>{
      const pane=${scope === "panel" ? "[...document.querySelectorAll('.flexlayout__tab')].filter(el=>el.getBoundingClientRect().width>1&&getComputedStyle(el).display!=='none').sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left)[0]" : "document.body"};
      if(!pane)return {missing:true};const bounds=pane.getBoundingClientRect();
      const failures=[...pane.querySelectorAll('button,input:not([type=hidden]),select,textarea,[role=button],[title][style*="cursor"]')].filter(el=>{
        const r=el.getBoundingClientRect();if(r.width<2||r.height<2||!el.getClientRects().length||getComputedStyle(el).visibility==='hidden'||el.closest('.cm-editor,.xterm,.monaco-editor'))return false;
        let x=r.left<bounds.left-1||r.right>bounds.right+1,y=r.top<bounds.top-1||r.bottom>bounds.bottom+1,scrollX=false,scrollY=false;
        for(let p=el.parentElement;p&&p!==pane;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();
          if(/hidden|clip/.test(s.overflowX)&&(r.left<b.left-1||r.right>b.right+1))x=true;
          if(/hidden|clip/.test(s.overflowY)&&(r.top<b.top-1||r.bottom>b.bottom+1))y=true;
          if(b.left>=bounds.left-1&&b.right<=bounds.right+1&&/auto|scroll/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+1&&(/run-tab-row|App-toolbar|excalidraw-toolbar|cm-scroller|ed-db.*(table|scroll)|ed-csv.*(table|scroll)|nb.*(scroll|table|toolbar)|ibx-history-code/.test(p.className)||p.tagName==='PRE'))scrollX=true;
          if(b.top>=bounds.top-1&&b.bottom<=bounds.bottom+1&&/auto|scroll/.test(s.overflowY)&&p.scrollHeight>p.clientHeight+1)scrollY=true;
        }
        return (x&&!scrollX)||(y&&!scrollY);
      }).map(el=>({tag:el.tagName,label:el.getAttribute('aria-label')||el.title||el.textContent?.trim().slice(0,60)||el.placeholder,rect:{left:Math.round(el.getBoundingClientRect().left-bounds.left),right:Math.round(el.getBoundingClientRect().right-bounds.left)},className:el.className}));
      return {width:Math.round(bounds.width),height:Math.round(bounds.height),failures,controls:pane.querySelectorAll('button,input,select').length,crash:pane.textContent.includes('Panel crashed')||pane.textContent.includes('Panel Load Failed')||pane.textContent.includes('Something went wrong while loading this panel'),outsideViewport:bounds.left < -1 || bounds.right > innerWidth + 1,text:pane.textContent.slice(0,140)};
    })()`);
      report.push({ label, ...result });
      if (process.argv.includes("--screenshots")) {
        const dir = path.join(root, ".appdata", "overflow-evidence");
        fs.mkdirSync(dir, { recursive: true });
        const bounds =
          scope === "panel"
            ? await run(
                "(()=>{const r=document.getElementById('audit-target')?.getBoundingClientRect()||[...document.querySelectorAll('.flexlayout__tab')].find(el=>el.getBoundingClientRect().width>1)?.getBoundingClientRect();return r?{x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}:null})()",
              )
            : null;
        const screenshot = await win.webContents.capturePage(
          bounds || undefined,
        );
        fs.writeFileSync(
          path.join(dir, label.replace(/[^a-z0-9]+/gi, "-") + ".png"),
          screenshot.toPNG(),
        );
      }
      console.log(
        `${result.failures?.length || result.missing || result.crash || result.outsideViewport ? "FAIL" : "PASS"}: ${label} (${result.width}px)${result.failures?.length ? " — " + result.failures.map((f) => f.label).join(", ") : ""}`,
      );
    };
    try {
      await win.loadFile(path.join(root, "electron/renderer/index.html"));
      await wait("!!window.__flexModel?.current");
      const chosen =
        process.argv.includes("--extras-only") ||
        process.argv.includes("--short-only")
          ? []
          : process.argv
              .find((a) => a.startsWith("--panels="))
              ?.split("=")[1]
              .split(",") || [
              "editor",
              "editor-md",
              "editor-csv",
              "editor-db",
              "terminal",
              "ports",
              "problems",
              "output",
              "runDebug",
              "gitPanel",
              "testExplorer",
              "debugPanel",
              "localHistory",
              "extensions",
              "mediaViewer",
              "panel3",
              "notebook",
              "projectPanel",
              "projectHub",
              "componentPreview",
              "androidEmulator",
              "canvas",
              "community",
              "aiAgent",
              "openPencil",
              "blank",
            ];
      for (panel of chosen)
        for (paneWidth of panel === "editor"
          ? [180, 240, 360, 640, 1000]
          : [240, 360, 640]) {
          await win.loadFile(path.join(root, "electron/renderer/index.html"));
          await wait("!!window.__flexModel?.current");
          win.webContents.send("menu:openProject", fixture);
          await wait(
            "!!document.getElementById('flexlayout-tabbutton-audit-target')",
          );
          const ready = {
            canvas: ".excalidraw-host .excalidraw",
            gitPanel: '[aria-label="Git actions"]',
            localHistory: ".ibx-history-item",
            "editor-db": ".ed-db__tab",
          }[panel];
          if (ready)
            await wait(`!!document.querySelector(${JSON.stringify(ready)})`);
          await delay(panel === "editor" ? 700 : 250);
          await inspect(`${panel} @ ${paneWidth}`);
          if (panel === "editor" && paneWidth === 180) {
            await run(
              "document.querySelector('[title=\"Show document outline\"]').click()",
            );
            await delay(60);
            await inspect("Document outline @ 180");
            assert.equal(
              await run(
                "(()=>{const r=document.querySelector('.ed-outline').getBoundingClientRect(),p=document.querySelector('.ed-panel').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right})()",
              ),
              true,
              "outline fits narrow editor",
            );
            await run(
              "document.querySelector('[title=\"Show document outline\"]').click()",
            );
          }
          if (["editor-md", "editor-csv"].includes(panel)) {
            await run("document.querySelector('.ed-prevbtn').click()");
            await delay(100);
            await inspect(`${panel} preview @ ${paneWidth}`);
          }
          if (panel === "editor-db" && paneWidth === 240) {
            await run(
              "[...document.querySelectorAll('[title=\"New table\"]')].find(el=>el.getClientRects().length).click()",
            );
            await wait("!!document.querySelector('.ed-db-modal')");
            await delay(80);
            await inspect("Database new-table dialog @ 240");
          }
          if (paneWidth === 240) {
            const menuSelector = {
              editor: '[aria-label="More editor actions"]',
              terminal: ".term-dd-btn",
              gitPanel: '[aria-label="Git actions"]',
            }[panel];
            if (
              menuSelector &&
              (await run(
                `!!document.querySelector(${JSON.stringify(menuSelector)})`,
              ))
            ) {
              await run(
                `document.querySelector(${JSON.stringify(menuSelector)}).click()`,
              );
              await delay(80);
              await inspect(`${panel} menu @ ${paneWidth}`);
              if (panel === "editor") {
                await run(
                  "document.querySelector('.ed-status__popup button').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))",
                );
                assert.equal(
                  await run(
                    "document.activeElement===document.querySelectorAll('.ed-status__popup button')[1]",
                  ),
                  true,
                  "menu arrow navigation",
                );
                await run(
                  "document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))",
                );
                assert.equal(
                  await run(
                    "!document.querySelector('.ed-status__popup')&&document.activeElement.getAttribute('aria-label')==='More editor actions'",
                  ),
                  true,
                  "Escape restores menu trigger",
                );
                await run(
                  "document.querySelector('.ed-status__language').click()",
                );
                await delay(60);
                await inspect("Language picker @ 240");
                await run(
                  "[...document.querySelectorAll('.ed-status__popup button')].find(el=>el.textContent==='Python').click()",
                );
                await wait(
                  "document.querySelector('.ed-status__language').textContent==='Python'",
                );
                await run(
                  "document.querySelector('[aria-label=\"More editor actions\"]').click()",
                );
                await delay(50);
                const wasWrapped = settings.lineWrapping !== false;
                await run(
                  "[...document.querySelectorAll('.ed-status__popup button')].find(el=>el.textContent.startsWith('Word wrap')).click()",
                );
                await delay(80);
                assert.equal(
                  settings.lineWrapping,
                  !wasWrapped,
                  "overflow action persists its setting",
                );
                console.log(
                  "PASS: editor menu keyboard, language selection, and persisted Wrap action",
                );
              }
            }
            if (panel === "gitPanel") {
              await run(
                "document.querySelector('[aria-label=\"Git actions\"]').click();document.querySelector('[aria-label=\"Graph options\"]').click()",
              );
              await delay(60);
              await inspect("Git graph menu @ 240");
              await run(
                "document.querySelector('[aria-label=\"Graph options\"]').click();document.querySelector('[title=\"Switch branch\"]').click()",
              );
              await delay(60);
              await inspect("Git branch picker @ 240");
            }
          }
        }
      if (!process.argv.some((a) => a.startsWith("--panels="))) {
        for (panel of [
          "editor",
          "editor-db",
          "terminal",
          "ports",
          "problems",
          "output",
          "runDebug",
          "gitPanel",
          "localHistory",
          "notebook",
          "canvas",
          "componentPreview",
        ]) {
          paneWidth = 320;
          paneHeight = 200;
          await win.loadFile(path.join(root, "electron/renderer/index.html"));
          await wait("!!window.__flexModel?.current");
          win.webContents.send("menu:openProject", fixture);
          await wait(
            "!!document.getElementById('flexlayout-tabbutton-audit-target')",
          );
          await delay(250);
          await inspect(`${panel} in short split`);
          if (["canvas", "notebook"].includes(panel)) {
            const selector =
              panel === "canvas"
                ? '[aria-label^="Hand (panning tool)"]'
                : ".nb-toolbar button";
            const reachable = await run(`(() => {
              const el = [...document.querySelectorAll(${JSON.stringify(selector)})].at(-1);
              if (!el) return false;
              el.focus(); el.scrollIntoView({block:"nearest", inline:"nearest"});
              const r = el.getBoundingClientRect(), pane = el.closest('.flexlayout__tab');
              for (let p = el.parentElement; p; p = p.parentElement) {
                const b = p.getBoundingClientRect(), s = getComputedStyle(p);
                if ((p === pane || /hidden|clip|auto|scroll/.test(s.overflowX)) && (r.left < b.left - 1 || r.right > b.right + 1)) return false;
                if ((p === pane || /hidden|clip|auto|scroll/.test(s.overflowY)) && (r.top < b.top - 1 || r.bottom > b.bottom + 1)) return false;
                if (p === pane) break;
              }
              return document.activeElement === el;
            })()`);
            assert.equal(
              reachable,
              true,
              `${panel} short-pane tools can be brought into view by keyboard`,
            );
          }
        }
        paneHeight = null;
        if (!process.argv.includes("--short-only")) {
          for (const width of [900, 700, 640, 480]) {
            win.setContentSize(width, 480);
            panel = "editor";
            paneWidth = 600;
            await win.loadFile(path.join(root, "electron/renderer/index.html"));
            await wait("!!window.__flexModel?.current");
            await wait(`Math.abs(innerWidth-${width})<=1`);
            win.webContents.send("menu:openProject", fixture);
            await wait(
              "!!document.getElementById('flexlayout-tabbutton-audit-target')",
            );
            await delay(200);
            await inspect(`split editor in ${width}px window`);
            await run(
              "window.dispatchEvent(new CustomEvent('search:open',{detail:{mode:'replace'}}))",
            );
            await delay(100);
            await inspect(`Search dialog in ${width}px window`, "body");
            await run(
              "document.querySelector('.ibx-search-filters-toggle').click()",
            );
            await delay(60);
            await inspect(`Search filters in ${width}px window`, "body");
            await run(
              "document.querySelector('.ibx-search-close').click();window.dispatchEvent(new KeyboardEvent('keydown',{key:'F1',bubbles:true}))",
            );
            await delay(80);
            await inspect(`Command palette in ${width}px window`, "body");
          }
          for (const width of [800, 640, 480])
            for (const page of [
              "general",
              "hub",
              "editor",
              "terminal",
              "git",
              "keybindings",
              "extensions",
              "canvas",
            ]) {
              win.setContentSize(width, 500);
              await win.loadFile(
                path.join(root, "electron/renderer/settings.html"),
                { query: { page } },
              );
              await wait("!!document.querySelector('.sw-content__body')");
              await wait(`Math.abs(innerWidth-${width})<=1`);
              await delay(100);
              await inspect(`Settings ${page} @ ${width}`, "body");
            }
        }
      }
      const reportPath = path.join(profile, "overflow-report.json");
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log("Report:", reportPath);
      const failures = report.filter(
        (r) => r.missing || r.crash || r.outsideViewport || r.failures.length,
      );
      if (failures.length && !process.argv.includes("--audit"))
        throw new Error(`${failures.length} overflow scenarios failed`);
      win.destroy();
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
