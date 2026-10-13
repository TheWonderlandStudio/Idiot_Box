// ─── New extension scaffold (Create in the Extensions panel) ────────────────
"use strict";

const fs = require("fs");
const path = require("path");

function slugPart(v, fallback) {
  const s = String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
}

function write(dir, opts) {
  const publisher = slugPart(opts.publisher, "local");
  const name = slugPart(opts.name, "hello");
  const id = opts.id || `${publisher}.${name}`;
  const displayName = String(opts.displayName || name).trim() || name;
  const description = String(opts.description || "An Idiot Box extension.").trim();
  const feat = opts.features || {};
  const wantCommand = feat.command !== false;
  const wantPanel = !!feat.panel;
  const wantExplorer = !!feat.explorerMenu;
  const wantEditor = !!feat.editorMenu;
  const wantStatus = !!feat.statusBar;

  const cmdId = `${id}.hello`;
  const viewId = `${id}.panel`;

  const commands = [];
  if (wantCommand) {
    commands.push({ command: cmdId, title: `Hello from ${displayName}`, category: displayName });
  }

  const menus = {};
  if (wantExplorer && wantCommand) {
    menus["explorer/context"] = [{ command: cmdId, group: "navigation" }];
  }
  if (wantEditor && wantCommand) {
    menus["editor/context"] = [{ command: cmdId, group: "navigation" }];
  }

  const views = {};
  if (wantPanel) {
    views.ibox = [{ id: viewId, name: displayName }];
  }

  const contributes = { commands };
  if (Object.keys(menus).length) contributes.menus = menus;
  if (Object.keys(views).length) contributes.views = views;

  const pkg = {
    name,
    displayName,
    description,
    version: "0.0.1",
    publisher,
    engines: { idiotbox: "*" },
    main: "extension.js",
    activationEvents: ["*"],
    idiotbox: { id, name: displayName, version: "0.0.1", main: "extension.js" },
    contributes,
  };

  const js = buildExtensionJs({
    id, displayName, cmdId, viewId,
    wantCommand, wantPanel, wantExplorer, wantEditor, wantStatus,
  });

  const readme = [
    `# ${displayName}`,
    "",
    description,
    "",
    "This is an Idiot Box extension. Edit `extension.js` and reload extensions",
    "(`Idiot Box: Reload extensions` in the command palette) after you change it.",
    "",
    "## API",
    "",
    "- `context.ibox.commands.registerCommand(id, fn)`",
    "- `context.ibox.window.createPanel({ id, title, html })` — new editor tab",
    "- `context.ibox.menus.register({ menu, command, title, when })`",
    "- `context.ibox.window.createStatusBarItem({ text, command })`",
    "- `context.ibox.log(...args)` — logs to this extension's channel in the Output panel",
    "- `context.ibox.window.createOutputChannel(name?)` — `.append/.appendLine/.clear/.show()`",
    "",
    "Context menus: `explorer/context`, `editor/context`, `ibox.file`, `ibox.folder`, `ibox.tab`.",
    "",
    "`ibox.workspace.fs` can only touch the open project and this extension folder.",
    "",
  ].join("\n");

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "extension.js"), js);
  fs.writeFileSync(path.join(dir, "README.md"), readme);
  return { id, dir, publisher, name };
}

function buildExtensionJs(o) {
  const lines = [
    `"use strict";`,
    ``,
    `function activate(context) {`,
    `  const ibox = context.ibox;`,
  ];

  if (o.wantCommand) {
    lines.push(
      `  context.subscriptions.push(ibox.commands.registerCommand(${JSON.stringify(o.cmdId)}, (ctx) => {`,
      `    const target = (ctx && (ctx.filePath || (ctx.paths && ctx.paths[0]))) || ibox.workspace.getProjectPath() || "";`,
      `    ibox.window.showInfo(${JSON.stringify(o.displayName + " — hello")} + (target ? "\\n" + target : ""));`,
      `  }));`,
    );
  }

  if (o.wantPanel) {
    lines.push(
      `  const panel = ibox.window.createPanel({`,
      `    id: ${JSON.stringify(o.viewId)},`,
      `    title: ${JSON.stringify(o.displayName)},`,
      `    reveal: false,`,
      `    html: \`<!doctype html><html><head><meta charset="utf-8">`,
      `      <style>`,
      `        body { margin: 0; font-family: system-ui, sans-serif; background: #1e1e1e; color: #d4d4d4; padding: 20px; }`,
      `        h1 { font-size: 16px; font-weight: 600; color: #fff; }`,
      `        button { background: #0e639c; color: #fff; border: 0; border-radius: 4px; padding: 6px 12px; cursor: pointer; }`,
      `        pre { background: #111; padding: 10px; border-radius: 4px; font-size: 12px; overflow: auto; }`,
      `      </style></head><body>`,
      `        <h1>${escapeHtml(o.displayName)}</h1>`,
      `        <p>This panel is hosted by your extension. Edit <code>extension.js</code> to change it.</p>`,
      `        <button id="go">Say hello</button>`,
      `        <pre id="log"></pre>`,
      `        <script>`,
      `          const log = document.getElementById("log");`,
      `          document.getElementById("go").onclick = function () { ibx.post({ type: "hello" }); };`,
      `          ibx.on(function (msg) { log.textContent = JSON.stringify(msg, null, 2); });`,
      `        </script>`,
      `      </body></html>\`,`,
      `  });`,
      `  context.subscriptions.push(panel.webview.onDidReceiveMessage((msg) => {`,
      `    panel.webview.postMessage({ ok: true, echo: msg, at: Date.now() });`,
      `  }));`,
    );
  }

  if (o.wantStatus) {
    lines.push(
      `  const item = ibox.window.createStatusBarItem({ text: ${JSON.stringify("$(ext) " + o.displayName)}${o.wantCommand ? `, command: ${JSON.stringify(o.cmdId)}` : ""} });`,
      `  item.show();`,
      `  context.subscriptions.push(item);`,
    );
  }

  lines.push(
    `}`,
    ``,
    `function deactivate() {}`,
    ``,
    `module.exports = { activate, deactivate };`,
    ``,
  );
  return lines.join("\n");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = { write, slugPart };
