<div align="center">
  <img src="electron/renderer/assets/idot_box.png" width="160" alt="Idiot Box logo" />

  <h1>Idiot Box</h1>

  <p><strong>A customizable desktop IDE that keeps your tools together.</strong></p>
  <p>Code, preview, test, browse, and run projects in one flexible workspace.</p>

  <p>
    <a href="https://apps.microsoft.com/detail/9PB1J8PS17ZT?hl=en-us&gl=IN&ocid=pdpshare"><img src="https://img.shields.io/badge/Get%20it-Microsoft%20Store-0078D4?style=for-the-badge&logo=microsoftstore&logoColor=white" alt="Get it from Microsoft Store" /></a>
    <a href="https://thewonderlandstudio.github.io/Idiot_Box/download.html"><img src="https://img.shields.io/badge/Download-macOS%20%2F%20Linux-555555?style=for-the-badge" alt="Download for macOS or Linux" /></a>
    <a href="https://github.com/TheWonderlandStudio/Idiot_Box/releases"><img src="https://img.shields.io/badge/All%20releases-GitHub-181717?style=for-the-badge&logo=github" alt="All GitHub releases" /></a>
  </p>

  <p>
    <a href="#features">Features</a> ·
    <a href="#get-started">Get started</a> ·
    <a href="#developer-tools">Developer tools</a> ·
    <a href="#community">Community</a>
  </p>
</div>

<p align="center">
  <img src="https://files.catbox.moe/dx4x76.gif" width="860" alt="Idiot Box IDE in action" />
</p>

## Your project, one workspace

Idiot Box is a free, open-source desktop IDE built for flexible project work. Arrange the editor, terminal, browser, previews, and developer tools around the way you work.

<div align="center">
  <table>
    <tr>
      <td align="center"><strong>✍️ Code</strong><br />Smart editor, diagnostics, and live reload</td>
      <td align="center"><strong>🧭 Explore</strong><br />Project map, file tools, and local history</td>
      <td align="center"><strong>▶️ Run</strong><br />Terminal, tests, debugger, and browser</td>
    </tr>
  </table>
</div>

## Features

<details open>
  <summary><strong>Editor &amp; project workflow</strong></summary>

| Tool | What you can do |
| --- | --- |
| **Code editor** | Edit 50+ languages with IntelliSense, diagnostics, automatic language detection, minimap, word wrap, autosave, and live reload when files change outside the app. |
| **Visual project map** | Explore pages and components as live preview cards on an infinite canvas. Group by folder, search, pan, zoom, resize, and save layouts per project. |
| **Project panel** | Browse files in grid or tree views; drag and drop, multi-select, copy, rename, duplicate, and undo. Deleted files go to the OS Recycle Bin. |
| **Search &amp; replace** | Search by literal text or regex, filter matches, replace across files, and undo a replacement. |
| **Local history** | Preview and restore per-file snapshots from saves, edits, and replacements. |
| **Live component preview** | See component changes immediately in an isolated preview—without saving first. |
| **Media viewer** | Zoom, rotate, flip, and pan images and videos. |
| **Session restore** | Return to your window state, workspace layout, and open tabs. |
</details>

<details>
  <summary><strong>Build, run &amp; debug</strong></summary>

| Tool | What you can do |
| --- | --- |
| **Terminal** | Open working-directory-aware terminals and split terminal panels. |
| **Run &amp; test** | Run project commands and discover Jest, Vitest, Mocha, `node:test`, pytest, and unittest tests. See streamed output and pass/fail summaries. |
| **Debugger** | Debug Node.js and Python with breakpoints, call stack, variables, watches, and an evaluate console. |
| **Browser panel** | Preview local development servers in dockable browser tabs. |
| **Desktop emulator** | Create and manage QEMU virtual machines, view their live display, and inspect logs. |
| **Android emulator** | Set up Android tools and manage virtual devices from the IDE. |
| **Extensions** | Run supported VS Code-compatible extensions in a local extension host. |
</details>

<details>
  <summary><strong>Workspace &amp; integrations</strong></summary>

| Tool | What you can do |
| --- | --- |
| **Dockable workspace** | Arrange panels around your workflow and save project layouts. |
| **Command palette &amp; keybindings** | Find common actions quickly and customize shortcuts. |
| **MCP server** | Let compatible local AI clients interact with project files, Git, the shell, editor tabs, and other IDE tools. [Setup guide →](docs/MCP.md) |
</details>

> **Privacy note:** Projects and settings are stored locally. If you choose to use an online AI feature, the prompt and relevant context are sent to its AI provider. See the [Privacy Policy](https://thewonderlandstudio.github.io/Idiot_Box/privacy.html).

## Get started

### Download the app

| Platform | Download |
| --- | --- |
| **Windows** | [Microsoft Store](https://apps.microsoft.com/detail/9PB1J8PS17ZT?hl=en-us&gl=IN&ocid=pdpshare) |
| **macOS / Linux** | [Download page](https://thewonderlandstudio.github.io/Idiot_Box/download.html) |
| **All releases** | [GitHub Releases](https://github.com/TheWonderlandStudio/Idiot_Box/releases) |

Only the links above are official Idiot Box download sources.

### Run from source

**Requirements:** Node.js LTS and npm.

```bash
git clone https://github.com/TheWonderlandStudio/Idiot_Box.git
cd Idiot_Box
npm install
npm start
```

`npm start` builds the app bundles and launches Idiot Box.

## Developer tools

| Command | Description |
| --- | --- |
| `npm run build` | Build the AI styles, preload, renderer, settings, and icons. |
| `npm run build:renderer` | Build the main renderer and its lazy-loaded chunks. |
| `npm run build:preload` | Build the Electron preload bundle. |
| `npm run build:settings` | Build the settings window bundle. |
| `npm test` | Run the Node.js test suite. |
| `npm run test:layout` | Build the app and run the Electron layout test. |
| `npm run test:ui-overflow` | Build the app and run the UI overflow test. |

### Tech stack

- **App:** Electron 43, React 19, and FlexLayout
- **Editor:** Code-OSS services, CodeMirror, and language tooling
- **Terminal:** xterm.js and node-pty
- **Build:** esbuild

### Repository layout

```text
electron/
  main/       Electron main process, IPC, services, and menus
  preload/    Context-isolated renderer API
  renderer/   React UI, panels, and bundled renderer assets
  shared/     Shared configuration and definitions
build/        Build scripts, icons, and installer resources
docs/         Guides and integration documentation
tests/        Unit and Electron tests
```

## Community

- [Issues &amp; feature requests](https://github.com/TheWonderlandStudio/Idiot_Box/issues)
- [Discussions](https://github.com/TheWonderlandStudio/Idiot_Box/discussions)
- [Discord](https://discord.gg/Z9DynuSxRY)
- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Contributor License Agreement](CLA.md)
- [Security policy](SECURITY.md)

## Sponsors

Idiot Box is free and open source. Thank you to everyone who supports its development.

<div align="center">
  <a href="https://github.com/sponsors/Jignesh1236"><img src="https://img.shields.io/badge/Sponsor-Idiot%20Box-ea4aaa?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor Idiot Box" /></a>
  <br /><br />
  <a href="https://github.com/mihsanalam" title="Mihsan">
    <img src="https://avatars.githubusercontent.com/u/175799515?s=120&v=4" width="72" height="72" alt="Mihsan (@mihsanalam)" />
  </a>
  <br />
  <strong><a href="https://github.com/mihsanalam">Mihsan · @mihsanalam</a></strong>
  <br />
  <a href="https://github.com/sponsors/Jignesh1236">Become a sponsor</a>
</div>

## License &amp; trademark

The source code is licensed under the [GNU General Public License v3](LICENSE). See [TRADEMARK.md](TRADEMARK.md) for the rules on using the Idiot Box name and branding.

<p align="center">
  <sub>Built with care by <a href="https://github.com/TheWonderlandStudio">The Wonderland Studio</a>.</sub>
</p>
