# Application menu

Built in `electron/main/index.js` (`buildMenu()`). All accelerators resolve through the keybinding registry plus per-user overrides from Settings → Keybindings.

## File

Open Project, Open File, New Project, Recent (submenu from `recent-projects.json`), Save, Save As, Save All, Auto Save (toggle), New Tab, Close Tab, Reopen Closed, Close Project, New Window, Exit.

## Edit

Cut, Copy, Paste, Undo, Redo (standard roles).

## View

Command Palette, Quick Open, Fullscreen, Zoom In/Out/Reset, Appearance (theme), Reset Layout, Split Editor, panel openers — Ports, Extensions, Android, Desktop — and Local History, Test Explorer, Debugger, Toggle DevTools.

## Git

Status refresh, stage/unstage all, commit, push/pull/fetch, branch operations, clone — mirrors the Git panel (`git:menuAction`).

## Terminal

New terminal, split right/down, clear, and terminal session actions.

## Run

Run Auto-Detected Command, Stop Running Process, notebook actions, debug current file.

## Storage

Per-project and global housekeeping: clear tabs, pins, canvas, trash, or all project data; reveal storage folders.

## Settings

Open Settings (Ctrl+,) and quick navigation to specific settings pages.

## Window

Standard window controls plus editor tab cycling.

## Help

About, Check for Updates, View Releases, Privacy Policy, Keyboard Shortcuts, Report Issue, GitHub, Discord.

## Context menus

Separate dynamic menus exist for editor tabs, browser tabs/webviews, terminal tabs, the panel add-menu, generic contexts, and extension-contributed menus (`contributes.menus` — see [docs/extensions/menus.mdx](../extensions/menus.mdx)).
