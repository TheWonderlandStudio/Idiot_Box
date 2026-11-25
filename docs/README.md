# Idiot Box — Documentation

Welcome to the Idiot Box documentation. Idiot Box is a desktop IDE built with Electron and React: a code editor, terminal, Git panel, AI assistant, embedded browser, debugger, test explorer, notebooks, Android emulator, desktop VMs, and more — all in one workspace.

## Getting started

- [Installation](getting-started/installation.mdx) — downloads, installers, silent flags, file associations, updates
- [Run from source](getting-started/run-from-source.mdx) — clone, install, dev workflow
- [First steps](getting-started/first-steps.mdx) — projects, tabs, layout, zoom, sessions, palette

## User guide

- [Project Hub](user-guide/project-hub.mdx) — opening projects, recent list, pins, AI setup chat
- [Editor](user-guide/editor.mdx) — CodeMirror editor, tabs, splits, previews, special file views
- [Terminal & Run](user-guide/terminal-run.mdx) — shells, run engine, ports panel
- [Git](user-guide/git.mdx) — status, staging, branches, sync, merge, clone
- [AI assistant](user-guide/ai-assistant.mdx) — chat, streaming, speech-to-text, OpenCode panel
- [Browser](user-guide/browser.mdx) — embedded tabs, design inspector, Chrome extensions
- [Debugger](user-guide/debugger.mdx) — Node.js and Python debugging
- [Testing](user-guide/testing.mdx) — test explorer and framework detection
- [Notebooks](user-guide/notebooks.mdx) — Python notebook execution
- [Search & local history](user-guide/search-history.mdx) — project-wide search/replace, file snapshots
- [Database manager](user-guide/database-manager.mdx) — SQLite inspector
- [Android emulator](user-guide/android-emulator.mdx) — offline SDK, AVDs, in-app screen streaming
- [Desktop VMs (QEMU)](user-guide/desktop-vms.mdx) — VMs with VNC streaming and input control
- [Live server](user-guide/live-server.mdx) — live-reload preview server
- [Ports & Dev Tunnels](user-guide/ports-tunnels.mdx) — port forwarding to public URLs
- [Extensions manager](user-guide/extensions-manager.mdx) — install, manage, and scaffold extensions
- [Command palette](user-guide/command-palette.mdx) — commands, quick open, recent files
- [Settings](user-guide/settings.mdx) — appearance, theme tokens, keybindings, editor options

## Architecture

- [Overview](architecture/overview.mdx) — Electron architecture and data flow
- [Main process](architecture/main-process.mdx) — module map of the backend
- [Renderer](architecture/renderer.mdx) — React UI, panels, lazy chunks
- [IPC & preload](architecture/ipc-preload.mdx) — contextBridge API, protocol schemes
- [Data storage](architecture/storage.mdx) — where everything lives on disk
- [Security & privacy](architecture/security-privacy.mdx) — CSP, sandbox, network endpoints, telemetry

## Development

- [Build system](development/build-system.mdx) — esbuild pipeline, theme tokens, icons
- [Testing](development/testing.mdx) — unit tests and Electron harnesses
- [Packaging](development/packaging.mdx) — electron-builder targets, signing, installer
- [CI/CD](development/ci-cd.mdx) — GitHub Actions workflows

## Reference

- [IPC channels](reference/ipc-channels.md) — every main-process channel
- [Keybindings](reference/keybindings.md) — default shortcuts and overrides
- [Application menu](reference/application-menu.md) — menu structure
- [Environment variables](reference/environment-variables.md) — app, build, and signing vars

## Integrations

- [MCP server](MCP.md) — let external AI agents drive the IDE
- [Extensions — guide](EXTENSIONS_GUIDE.md) — extension system overview
- [Extensions — reference](extensions/overview.mdx) — API docs (manifest, commands, menus, panels, storage, formatters, lifecycle)
- [Installer exit codes](installer-exit-codes.md) — NSIS installer reference
- [Sponsors](SPONSORS.md)
