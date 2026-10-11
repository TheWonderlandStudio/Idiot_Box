"use strict";

function activate(context) {
  const { ibox, subscriptions } = context;

  // 1. Register hello command
  const helloCommand = ibox.commands.registerCommand(
    "community.sample-extension.hello",
    (ctx) => {
      const activePath =
        (ctx && (ctx.filePath || (ctx.paths && ctx.paths[0]))) ||
        ibox.workspace.getProjectPath() ||
        "";
      ibox.window.showInfo(
        "Hello from Sample Extension!" + (activePath ? `\nTarget: ${activePath}` : "")
      );
    }
  );
  subscriptions.push(helloCommand);

  // 2. Create webview panel
  const panel = ibox.window.createPanel({
    id: "community.sample-extension.panel",
    title: "Sample Panel",
    reveal: false,
    html: `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      margin: 0;
      font-family: system-ui, -apple-system, sans-serif;
      background: #181818;
      color: #e0e0e0;
      padding: 24px;
    }
    h2 { margin-top: 0; color: #58a6ff; }
    p { color: #8b949e; line-height: 1.5; }
    .card {
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
    }
    button {
      background: #238636;
      color: #ffffff;
      border: 0;
      border-radius: 6px;
      padding: 8px 16px;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover { background: #2ea043; }
    pre {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 12px;
      font-size: 13px;
      overflow-x: auto;
      color: #79c0ff;
    }
  </style>
</head>
<body>
  <h2>Sample Extension Panel</h2>
  <p>This panel is loaded dynamically from an external extension folder outside the app bundle.</p>
  <div class="card">
    <button id="btn">Send Ping to Host</button>
    <pre id="log">Ready for messages...</pre>
  </div>
  <script>
    const log = document.getElementById("log");
    document.getElementById("btn").onclick = function() {
      ibx.post({ type: "ping", sentAt: new Date().toLocaleTimeString() });
    };
    ibx.on(function(msg) {
      log.textContent = JSON.stringify(msg, null, 2);
    });
  </script>
</body>
</html>`
  });

  subscriptions.push(
    panel.webview.onDidReceiveMessage((msg) => {
      panel.webview.postMessage({
        received: true,
        echo: msg,
        respondedAt: new Date().toLocaleTimeString()
      });
    })
  );

  // 3. Command to reveal the panel
  const openPanelCommand = ibox.commands.registerCommand(
    "community.sample-extension.openPanel",
    () => {
      panel.reveal();
    }
  );
  subscriptions.push(openPanelCommand);

  // 4. Status Bar item
  const statusItem = ibox.window.createStatusBarItem({
    text: "$(symbol-misc) Sample Ext",
    tooltip: "Click to open Sample Panel",
    command: "community.sample-extension.openPanel"
  });
  statusItem.show();
  subscriptions.push(statusItem);
}

function deactivate() {}

module.exports = { activate, deactivate };
