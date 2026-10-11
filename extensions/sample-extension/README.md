# Sample Extension

This is a standalone sample extension for **Idiot Box**.

## What this extension does
1. **Commands**:
   - `Hello from Sample Extension`: Shows a toast notification with the active file path or project directory.
   - `Open Sample Panel`: Opens a dedicated webview tab.
2. **Webview Panel**:
   - Displays a custom UI with two-way messaging between the webview and the Node.js extension host via `ibx.post()` and `ibx.on()`.
3. **Context Menus**:
   - Registered under editor and explorer right-click context menus.
4. **Status Bar Item**:
   - Displays `Sample Ext` in the status bar with a click handler.

## How to Load This Extension
1. Open Idiot Box.
2. Open the **Extensions** panel.
3. Click **Load Unpacked**.
4. Select this folder: `extensions/sample-extension`.
5. The extension activates immediately without restarting the app!
