# Idiot Box — Extensions Development Guide

This guide explains the architecture of the Idiot Box extension system, how extensions are decoupled from the application bundle, and how to create, test, and distribute custom extensions.

---

## 1. System Architecture & Zero-Bundle Design

### Why Extensions Are Not Bundled with the App
Extensions in Idiot Box are **strictly externalized** and are **never bundled into the app binary or `app.asar`**:

1. **Storage Location**: Installed and user-created extensions are saved into the OS user data directory outside the app's install directory:
   - **Windows**: `%APPDATA%\Idiot Box\vsx-extensions\`
   - **macOS**: `~/Library/Application Support/Idiot Box/vsx-extensions/`
   - **Linux**: `~/.config/Idiot Box/vsx-extensions/`
2. **State Persistence**: Active status, enabled/disabled toggles, and metadata are persisted in `%APPDATA%\Idiot Box\extensions-state.json`.
3. **No Rebuild Needed**: You do not need to recompile, rebuild, or repackage Idiot Box when creating, installing, or modifying extensions. You can load unpacked extension folders from any directory on your computer.

### How the Extension Host Works
```
┌────────────────────────────────────────────────────────┐
│                   MAIN PROCESS (Node.js)               │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │             Extension Host Runtime               │  │
│  │   • Activates extensions in safe sandbox         │  │
│  │   • Provides `context.ibox` native API           │  │
│  │   • Manages command & formatter registries       │  │
│  │   • Handles state & settings persistence         │  │
│  └──────────────────────────────────────────────────┘  │
│                           ▲                            │
│                           │ (IPC Channels)             │
│                           ▼                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Preload Bridge API                  │  │
│  │   • `window.electronAPI.extList()`               │  │
│  │   • `window.electronAPI.extSetEnabled(id, on)`   │  │
│  │   • `window.electronAPI.extInvoke(cmd, ...args)` │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                  RENDERER PROCESS (UI)                 │
│                                                        │
│  • Command Palette (Ctrl+Shift+P) triggers commands    │
│  • Extensions Panel (Installed, Community, Browser)    │
│  • Status Bar items render registered counters/icons   │
│  • Custom Views render inside sandboxed editor iframes │
│  • Context menus appear in File Tree and Code Editor   │
└────────────────────────────────────────────────────────┘
```

---

## 2. Extension Anatomy

Every extension is a standalone folder containing at minimum:

```
my-extension/
├── package.json      # Manifest defining extension metadata, commands, and contributions
├── extension.js      # Entry point exporting activate(context) and deactivate()
└── README.md         # Documentation displayed inside the Extensions Panel
```

### 1. `package.json` (The Manifest)

```json
{
  "name": "my-extension",
  "displayName": "My Awesome Extension",
  "description": "Adds awesome functionality to Idiot Box",
  "version": "1.0.0",
  "publisher": "myname",
  "main": "extension.js",
  "engines": {
    "idiotbox": "*"
  },
  "idiotbox": {
    "id": "myname.my-extension",
    "name": "My Awesome Extension",
    "version": "1.0.0",
    "main": "extension.js"
  },
  "contributes": {
    "commands": [
      {
        "command": "myname.my-extension.hello",
        "title": "Say Hello",
        "category": "My Extension"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "myname.my-extension.hello",
          "group": "navigation"
        }
      ],
      "explorer/context": [
        {
          "command": "myname.my-extension.hello",
          "group": "navigation"
        }
      ]
    },
    "views": {
      "ibox": [
        {
          "id": "myname.my-extension.panel",
          "name": "My Dashboard"
        }
      ]
    }
  }
}
```

#### Manifest Properties:
- **`idiotbox.id`**: Unique identifier in the format `publisher.extension-name`.
- **`main`**: Path to the entry file (defaults to `extension.js`).
- **`contributes.commands`**: Array of commands exposed to the Command Palette (`Ctrl+Shift+P`).
- **`contributes.menus`**: Context menu placements:
  - `editor/context`: Right-click inside the code editor.
  - `explorer/context`: Right-click inside the file explorer tree.
- **`contributes.views`**: Custom panel tabs registered in the editor view.

---

### 2. `extension.js` (The Code)

Extensions run in the Node.js runtime and export `activate(context)` and `deactivate()`:

```javascript
"use strict";

/**
 * Called when the extension is activated
 * @param {object} context - Extension context with subscriptions and ibox API
 */
function activate(context) {
  const { ibox, subscriptions } = context;

  // 1. Register a command
  const disposableCommand = ibox.commands.registerCommand(
    "myname.my-extension.hello",
    async (args) => {
      // Show info notification toast
      await ibox.window.showInfo("Hello from My Extension!");

      // Inspect active file or project path if invoked from context menu
      const targetPath = args?.filePath || ibox.workspace.getProjectPath();
      if (targetPath) {
        ibox.window.showInfo(`Active path: ${targetPath}`);
      }
    }
  );
  subscriptions.push(disposableCommand);

  // 2. Add an item to the status bar
  const statusBar = ibox.window.createStatusBarItem({
    text: "$(star) My Extension",
    tooltip: "Click to run Hello",
    command: "myname.my-extension.hello"
  });
  statusBar.show();
  subscriptions.push(statusBar);

  // 3. Register a Webview Panel
  const panel = ibox.window.createPanel({
    id: "myname.my-extension.panel",
    title: "My Dashboard",
    reveal: false,
    html: `<!doctype html>
      <html>
        <head>
          <style>
            body { font-family: system-ui; background: #1e1e1e; color: #fff; padding: 20px; }
            button { background: #0e639c; color: #fff; border: 0; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
          </style>
        </head>
        <body>
          <h2>My Dashboard</h2>
          <button id="btn">Send Ping to Host</button>
          <pre id="output"></pre>
          <script>
            document.getElementById("btn").onclick = () => {
              ibx.post({ type: "ping", time: Date.now() });
            };
            ibx.on((msg) => {
              document.getElementById("output").textContent = JSON.stringify(msg, null, 2);
            });
          </script>
        </body>
      </html>`
  });

  // Listen to messages from the webview panel
  subscriptions.push(
    panel.webview.onDidReceiveMessage((message) => {
      if (message.type === "ping") {
        panel.webview.postMessage({ type: "pong", echo: message });
      }
    })
  );
}

/**
 * Called when the extension is disabled or uninstalled
 */
function deactivate() {
  // Clean up any external resources if needed
}

module.exports = { activate, deactivate };
```

---

## 3. Extension API Reference (`context.ibox`)

### `ibox.commands`
- **`registerCommand(id, handler, title, category)`**: Registers a callable command.
  - Returns a `Disposable` that automatically unregisters on deactivation.
- **`executeCommand(id, ...args)`**: Executes an existing registered or built-in command.

### `ibox.window`
- **`showInfo(message)`**: Displays an info toast banner in the application.
- **`showWarning(message)`**: Displays a warning toast.
- **`showError(message)`**: Displays an error toast.
- **`createStatusBarItem({ text, tooltip, command })`**: Creates a status bar item.
  - Call `.show()`, `.hide()`, `.dispose()`.
  - Properties `.text`, `.tooltip`, `.command` can be updated dynamically.
- **`createPanel({ id, title, html, reveal })`**: Creates a custom webview tab.
  - `.webview.html`: Set or update the HTML string.
  - `.webview.postMessage(msg)`: Send a JSON message into the webview.
  - `.webview.onDidReceiveMessage(cb)`: Listen for messages sent via `ibx.post()` from inside the webview.
  - `.reveal()`: Bring the tab to focus.

### `ibox.workspace`
- **`getProjectPath()`**: Returns the root path of the currently open project/folder.
- **`fs`**: Safe file system operations restricted to the open project and the extension's folder.

### `ibox.menus`
- **`register({ menu, command, title, group, when })`**:
  - `menu`: `'editor/context'`, `'explorer/context'`, `'ibox.file'`, `'ibox.folder'`, `'ibox.tab'`.
  - `when`: Conditions like `resourceExt == .js` or `editorTextFocus`.

### `ibox.languages`
- **`registerDocumentFormattingEditProvider(selector, provider)`**:
  - Registers a document formatter (such as Prettier or custom code styler).
  - `provider.provideDocumentFormattingEdits(document, options, token)` returns text edits `{ from, to, newText }`.

### `ibox.storage`
- **`globalState`**: Persistent key-value storage across sessions:
  - `.get(key, defaultValue)`
  - `.update(key, value)`
- **`workspaceState`**: Key-value storage scoped to the active workspace project.

### `ibox.env`
- **`clipboard.writeText(text)`**: Copy text to system clipboard.
- **`clipboard.readText()`**: Read text from system clipboard.
- **`openExternal(url)`**: Open external URLs in the user's default browser.

---

## 4. Webview Two-Way Communication (`ibx` Bridge)

Every webview panel created via `ibox.window.createPanel()` automatically gets the native `ibx` bridge injected into its page:

### Inside the Webview HTML/JS:
```javascript
// Send data to the extension host:
ibx.post({ action: "saveSettings", theme: "dark" });

// Listen for data from the extension host:
const listener = ibx.on((msg) => {
  console.log("Received from host:", msg);
});

// Maintain local state across reloads:
ibx.setState({ count: 10 });
const savedState = ibx.getState();
```

### In Extension Host (`extension.js`):
```javascript
panel.webview.onDidReceiveMessage(async (msg) => {
  if (msg.action === "saveSettings") {
    await context.ibox.storage.globalState.update("theme", msg.theme);
    panel.webview.postMessage({ status: "success" });
  }
});
```

---

## 5. Creating, Testing & Reloading Workflow

### Option A: Create from UI
1. Open Idiot Box.
2. In the sidebar or View menu, open the **Extensions** panel.
3. Click the **+ Create** button.
4. Enter Publisher and Name (e.g., `local.my-extension`).
5. Idiot Box automatically scaffolds the files in `%APPDATA%\Idiot Box\vsx-extensions\local.my-extension\`.
6. Click the folder icon to open and edit `extension.js`.

### Option B: Create in an External Folder
1. Create a folder anywhere on your computer (e.g., `D:\my-extensions\my-tool\`).
2. Add `package.json`, `extension.js`, and `README.md`.
3. Open Idiot Box → Extensions Panel → Click **Load Unpacked**.
4. Select your folder. Idiot Box will install and activate it immediately.

### Reloading Extensions During Development
Whenever you edit `extension.js`:
- Press `Ctrl+Shift+P` (Command Palette)
- Run: `Idiot Box: Reload extensions`
- Your extensions will reload immediately with updated code without restarting the app!

---

## 6. Enabling, Disabling & Uninstalling

- **Disable/Enable**:
  - In the Extensions Panel under **Installed**, click the toggle button next to any extension to switch between **Enabled** and **Disabled**.
  - When disabled, all commands, status bar items, formatters, and views from the extension are automatically deactivated and unloaded from memory.
- **Uninstall**:
  - Click the Trash icon next to the extension. Files in the external storage directory are deleted cleanly.
