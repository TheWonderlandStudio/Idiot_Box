 <img src="electron/renderer/assets/idot_box.png" width=200px>

# Idiot Box

Idiot Box is a modern and customizable desktop IDE that brings code editing, preview, terminal, browser and developer tools into one workspace.

## Download

**Windows:** [Microsoft Store](https://apps.microsoft.com/detail/9PB1J8PS17ZT?hl=en-us&gl=IN&ocid=pdpshare)

**macOS / Linux:** [Download page](https://thewonderlandstudio.github.io/Idiot_Box/download.html)

**All installers:** [GitHub Releases](https://github.com/TheWonderlandStudio/Idiot_Box/releases)

<img src="https://files.catbox.moe/dx4x76.gif">

## Features

<table style="width:100%; table-layout:fixed; border-collapse:collapse;">
<tr>
<td style="width:50%; vertical-align:top; padding:0;">

<details>
<summary>Canvas</summary>

Visual project map with live preview cards for pages and components. Cards are grouped by folder on an infinite pan and zoom canvas. Drag, resize, search and organize layouts per project using `.canvas/layout.json`.

</details>

<details>
<summary>Code Editor</summary>

Code OSS editor services with syntax highlighting for 50+ languages, IntelliSense, diagnostics, automatic language detection, minimap, word wrap, autosave, Save As, dirty tab markers and live reload for external file changes.

</details>

<details>
<summary>Extension Host</summary>

Runs VS Code compatible extensions in a local web worker using `@codingame/monaco-vscode-api`. Includes built in language extensions and a demo extension.

</details>

<details>
<summary>Live Component Preview</summary>

Shadow DOM previews that sync instantly with the editor without saving.

</details>

<details>
<summary>Terminal</summary>

xterm.js and node-pty with split panels and working directory support.

</details>

<details>
<summary>Search & Replace</summary>

Project wide literal and regex search with case, whole word, include and exclude filters. Supports grouped results, replace across files and one step undo. Shortcut: `Ctrl+Shift+F`.

</details>

<details>
<summary>Local History</summary>

Per file snapshots on save, live edit and replace. Stored under userData with preview and restore options.

</details>

<details>
<summary>Test Explorer</summary>

Detects Jest, Vitest, Mocha, node:test, pytest and unittest. Includes test trees, individual test runs, streamed output, pass and fail summaries and debug handoff.

</details>

<details>
<summary>Debugger</summary>

Supports Node.js inspector/CDP and Python debugpy/DAP sessions. Includes launch configurations, conditional breakpoints, call stack, scopes, variables, watches, evaluate console and output.

</details>

</td>
<td style="width:50%; vertical-align:top; padding:0;">

<details>
<summary>Editable Keybindings</summary>

Rebind commands from Settings with recording and conflict detection. Overrides persist in `settings.json` and update native menu accelerators.

</details>

<details>
<summary>Browser Panel</summary>

Webview based tabs with development server port detection.

</details>

<details>
<summary>Desktop Emulator</summary>

QEMU desktop VMs with automatic detection of `qemu-system-*`. Create VMs with custom architecture, RAM, CPU, disk and ISO. Includes live VNC, mouse and keyboard input, stop and delete actions, logs and official ISO download links for Ubuntu, Debian, Fedora, Alpine, Arch, Kali and more. VMs are stored in `.appdata/qemu`.

</details>

<details>
<summary>Project Panel</summary>

Grid and list file manager with drag and drop, multi select, clipboard operations, undo and redo, rename, duplicate, context menus and sidebar tree. Files can be opened in new tabs, revealed or opened in a terminal. Delete moves files to the OS Recycle Bin using `shell.trashItem`. Permanent delete bypasses it. Deleted files can be restored from the OS Recycle Bin.

</details>

<details>
<summary>Media Viewer</summary>

Zoom, rotate, flip and pan for images and videos.

</details>

<details>
<summary>Settings Window</summary>

Live editor preferences for minimap and word wrap using BroadcastChannel.

</details>

<details>
<summary>Command Palette</summary>

Quick access to projects, files, panels and layout actions.

</details>

<details>
<summary>Session Restore</summary>

Remembers window state and open tabs.

</details>

<details>
<summary>MCP Server</summary>

Built in local Model Context Protocol endpoint for external AI clients like Claude Desktop, Cursor and opencode. Supports file operations, git, commands and IDE control. See [docs/MCP.md](docs/MCP.md).

</details>

</td>
</tr>
</table>

## Stack

Electron 43, React 19 and flexlayout-react for dockable panels.

Code OSS workbench services through `@codingame/monaco-vscode-api` for TextMate grammars, themes, IntelliSense, diagnostics, language services and extension hosting.

xterm.js and node-pty for terminal support, with chokidar for file watching.

esbuild for bundling, with CSS and HTML workers for Monaco.

## Getting Started

```bash
npm install
npm start
```

`npm start` builds the workers, renderer and settings bundles, then launches the app.

## AI Control (MCP)

The app runs a local MCP endpoint at `http://127.0.0.1:39271/mcp` while active. The endpoint is also written to `mcp.json` in the app's user data folder. 

Connect any Streamable HTTP MCP client to let AI use the IDE. Available tools include files, git, shell, editor tabs, extensions, notebooks and the Android emulator.

Setup and full tool list: [docs/MCP.md](docs/MCP.md).

## Scripts

| Script | Description |
| --- | --- |
| `npm run build:workers` | Build Monaco and extension host web workers |
| `npm run build:renderer` | Build the main renderer bundle |
| `npm run build:settings` | Build the settings window bundle |
| `npm run build` | Build everything |
| `npm start` | Build everything and launch |

## Structure

```text
electron/
  main/             Electron main process (IPC, menus, fs watcher, canvas scan)
  preload/          Context isolated API bridge
  renderer/
    components/     Panels: Editor, Project, Terminal, Browser, Canvas, ComponentPreview, Blank
    workers/        Monaco language/theme workers and extension host worker entry
    extensions/     Bundled demo extension
  host/             Legacy extension host files, migrated to worker
build/              esbuild configs and worker asset copy
```

## Official Sources

**Windows:** https://apps.microsoft.com/detail/9PB1J8PS17ZT?hl=en-us&gl=IN&ocid=pdpshare

**macOS / Linux:** https://thewonderlandstudio.github.io/Idiot_Box/download.html

**Releases:** https://github.com/TheWonderlandStudio/Idiot_Box/releases

**Discord:** https://discord.gg/Z9DynuSxRY

Other sites offering Idiot Box downloads are not official.

## License

Source code is licensed under the [GNU General Public License v3](LICENSE).

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## Trademark

The Idiot Box branding, logo and rules for forks and re releases are defined in [TRADEMARK.md](TRADEMARK.md).

Anyone can fork and modify the code under the GPL. Modified versions must use a different name and identity. Builds must not be presented as official Idiot Box releases.
