# Changelog

All notable changes to Idiot Box are documented here.
Older releases: see [GitHub Releases](https://github.com/TheWonderlandStudio/Idiot_Box/releases).

## [0.1.30] - 2026-10-28

### Added
- **Project-wide search & replace** - `Ctrl+Shift+F` opens a search overlay with
  literal/regex and case/whole-word toggles, include/exclude filters, results
  grouped by file, replace across files and a one-step undo.
- **Editable keybindings** - every command is listed under Settings →
  Keybindings with shortcut recording, conflict detection and reset. Overrides
  persist in `settings.json` and rebuild the native menu accelerators, so the
  same binding works in the editor, terminal, Git menu commands and menus.
- **Local history** - per-file snapshots are written under userData on save,
  live edit and replace, and can be previewed or restored from the Local
  History panel without adding files to the project.
- **Debugger** - Node.js (inspector/CDP) and Python (debugpy/DAP) sessions with
  launch configurations, conditional breakpoints (gutter/`F9`), call stack,
  scopes and variables, watches, evaluate console, output, and launch-current-
  file/test handoff from the editor and Test Explorer.
- **Test Explorer** - detects Jest, Vitest, Mocha, node:test, pytest and
  unittest, collects tests into a tree, runs a file or a single test with
  streamed output and pass/fail summaries, and hands tests to the debugger.
- **SQLite database manager** - browse tables, run queries and edit rows from
  an editor tab.
- **Taskbar jump list** - right-click the Windows taskbar button for New
  Window, New Project, Open Project and Close Current Project; the task is
  handled by the running window (or queued until the renderer is ready).
- **Browser panel for MCP clients** - MCP clients can list, open and drive the
  IDE browser panel.
- **Also in this release** - CSV/TSV preview, workspace layout presets,
  multi-session terminal, browser URL persistence and F12 devtools, project
  sidebar multi-select, and clearer OpenCode server errors with last-session
  resume on a stable port.

### Changed
- **Titlebar polish** - the Run/Stop control is aligned with the titlebar, the
  browser bar is more compact, and the Run dropdown renders in a portal so it
  is no longer clipped.
- **Dev profile isolation** - `npm start` uses a separate Chromium session
  folder, so a dev build and an installed build can run at the same time
  without cache/service-worker corruption. Settings, projects and layouts stay
  shared.

### Fixed
- **Run button reliability** - Run/Stop now reflects live runs even when the
  Run panel is closed, rehydrates running PTYs after the panel remounts, waits
  for project config detection before auto-run, stays bound to the active
  project and stops the newest PTY. Chained setup runs also clear the Stop
  state.
- **Stale editor tab icons** - switching files in a reused tab no longer shows
  the previous file's icon, and icon fetches are cancellation-safe.
- **Node debug sessions now end naturally** - when the program finishes, the
  inspector is closed so Node no longer hangs at "Waiting for the debugger to
  disconnect..."; the real exit code is reported and the session disappears
  from the active list.
- **Duplicate debug output** - console lines are no longer emitted twice from
  the debuggee's stdout and the inspector's console event.

## [0.1.28] - 2026-10-21

### Added
- **Ctrl+PageDown / Ctrl+PageUp tab navigation** - switch to the next or
  previous tab in the active panel (VS Code style, wraps around). Works from
  the editor, terminal or any other panel; Cmd also works on macOS.
- **CodeMirror 6 editor upgrade** - minimap, indentation guides, bracket
  colorization, Emmet abbreviation expansion, multi-cursor (Ctrl+D,
  Ctrl+Alt+Up/Down), breadcrumbs and document outline, git gutter with inline
  blame, format-on-save, problem navigation (F8 / Shift+F8) and a
  compare-with-saved inline diff. New editor toggles added under
  Settings → Editor.

### Fixed
- **Editor stuck on the previous file** - rapid file switching no longer leaves
  the old buffer on screen; tab content is now invalidated correctly with
  flexlayout 0.11.
- **Vim mode could not be enabled** - the Settings → Editor toggle now
  persists and actually turns Vim mode on.
- **Editor Ctrl+Z cross-file leak** — undo history is now isolated per file:
  switching files (single-click preview open) no longer lets Ctrl+Z revert to
  a previously opened file's content, which could corrupt a save. Disk/live
  reloads are also excluded from history, so Ctrl+Z never restores stale
  on-disk text.
- **Canvas corrupt-file protection** — a corrupted (invalid JSON) or
  non-drawing `.excalidraw` file now mounts a truly empty scene with autosave
  paused, instead of leaving the previous drawing mounted and silently
  overwriting the file. The banner adds an "Open as text" action to inspect or
  repair the raw file; your file stays untouched until you explicitly save.

### Changed
- **Settings window redesigned** with a Material 3 layout: centered content
  column, navigation pills, Material switches, buttons and inputs.
- **Media Viewer removed from the default layout** - it is still available
  from the panel menu.
- **flexlayout-react upgraded** to 0.11.1 (from 0.8.19) with a verified
  move-to-border flow and clearer error reporting.
- **Windows downloads** route to the Microsoft Store from the landing page;
  the README now has a top Download section, and the NSIS installer uses
  explicit installer/uninstaller icons.
- **CI** — PR build check added; secret/dependency security checks and the
  gitleaks license configuration fixed.

## [0.1.27] - 2026-10-14

### Added
- **All 8 installer formats** — same as 0.1.26: every release ships
  `.exe` (NSIS), `.msi` (WiX) and `.msix` (+ `.msixupload` for Store
  submission) for Windows, `.AppImage`, `.deb`, `.rpm` and `.pacman`
  for Linux, and `.dmg` (+ `.zip` updater feed) for macOS
  (Intel + Apple Silicon), built on Windows, Ubuntu and macOS runners
  and attached to one GitHub Release.
- **Extension management pages** — internal `idiotbox://` pages for
  listing, enabling, uninstalling and loading unpacked extensions,
  with popup anchoring API and improved load error handling.
- **Complete light mode** — titlebar, tabs, Hub and popouts now fully
  themed (new `popout.js`, layout/variable CSS, Hub light styles).
- **MSIX Store readiness** — appx tiles/splash assets, Store updater
  guard (Store-signed builds skip the `latest.yml` self-updater),
  documented NSIS installer exit codes (`docs/installer-exit-codes.md`),
  hardened MSI/MSIX config (`winCodeSign` toolset, `warningsAsErrors`,
  `minVersion`/`maxVersionTested`, `showNameOnTiles`,
  `createMsixupload`).

### Changed
- **Discord-only Community panel** with its own styles; English-only
  pass across menus, installer script, release workflow and landing
  page.

### Fixed
- **Browser webview popout crash** — popout is blocked for webview
  panels (browser/community) so detaching them can no longer crash
  the app.

## [0.1.26] - 2026-10-12

### Added
- **All 8 installer formats** — every release now ships `.exe` (NSIS),
  `.msi` (WiX) and `.msix` for Windows, `.AppImage`, `.deb`, `.rpm` and
  `.pacman` for Linux, and `.dmg` for macOS (Intel + Apple Silicon),
  built on Windows, Ubuntu and macOS runners and attached to one
  GitHub Release.

### Fixed
- **Windows "Register as editor?" rollback** — declining the consent page
  now correctly restores your previous file handlers again: the rollback
  was rewritten for electron-builder v27, which registers associations
  under generated ProgIDs (`IdiotBox.<name><hash>`) and no longer keeps
  the old backup values the previous script relied on.

## [0.1.25] - 2026-10-04

### Added
- **Git panel actions** — Source Control gets a grouped overflow menu
  (Commit, Changes, Pull/Push, Branch, Remote, Stash, Tags) plus Clone,
  Checkout to…, Fetch and Show Git Output; the commit box adds Commit and
  Push, Amend last commit and Stage all shortcuts, and the main Git menu
  gets Pull (rebase) and per-section expand/collapse.
- **Tree view, sorting and inline diffs** — toggle the working tree into a
  directory tree, sort by path/status/name, expand a file to see its diff
  inline, mark conflicted files as resolved, and keep the commit history
  visible below the working tree. Git graph rows are denser and render
  each ref as its own chip (branch / remote icon, HEAD highlighted) with
  the author name shown.
- **Built-in layouts** — the titlebar Layouts menu now lists Default and
  Blank layouts in a "Default layouts" group (not deletable) above your
  saved presets, with an applied-state highlight and a "default" badge.

### Changed
- **Community panel** — replaces the blank shell with a real embedded
  webview: its own title bar with close, a load progress bar and a failure
  state with Retry (iframe is not usable because CSP `frame-src` allows
  only self).

### Fixed
- **Live Edit ghost reverts** — successful browser edits are no longer
  rolled back: `__IBX_*` titles are skipped when capturing the previous
  title (so no stale `__IBX_EDIT__` re-emits), `textContent` is used for
  needles so `text-transform` styling can't fail a save as "not found",
  duplicate edit title re-deliveries are deduped, and already-applied
  content is treated as success instead of reverting the file.
- **Snippet autocomplete** — snippets are registered as extra language
  data instead of overriding it (language package completions such as
  `console.` / `import` come back) and suggestions are suppressed inside
  strings and comments.

## [0.1.24] - 2026-10-03

### Added
- **Project setup AI chat** — full-screen Hub chat with live streaming
  replies and suggestion starters; the AI returns a setup proposal card
  (project name, framework, language, panel layout) with **Create project**,
  which now opens a folder picker first so you choose where the project is
  saved (cancel aborts the create).
- **Workspace-terminal scaffolding** — real CLI setup commands run in the
  workspace terminal right after the project opens, with live setup output
  and a Create layout choice (default panels vs blank workspace).
- **Titlebar Layouts menu** — one-click layout presets from the title bar.
- **OpenPencil panel** — open-source design editor (.fig files, AI canvas,
  design-to-code) as a project panel, with a Refresh entry in its tab menu.
- **Browser edit-mode extras** — Del removes an element, Ctrl+D duplicates,
  Ctrl+K wraps as link, Shift+click inspects, plus a wrapping edit banner.
- **Hub** — dark home redesign, inline composer chat with mic voice input,
  wallpaper cover fix, Git graph, mouse navigation, alt menu mode, click
  sound, per-project isolation and a credits page.
- **Per-project layout** — tabs and panel layout are restored per project;
  Create dialog gets a note send box and workspaces title-bar box.
- **Browser, Canvas, Community** — CRX install from the browser panel,
  in-panel canvas sidebar toggle, community panel + launcher.
- **Editor** — vim and snippets options; quick-open/accelerator fixes.

### Changed
- **English-only pass** across the app with a Hub sidebar/card redesign and
  restyled titlebar Run/Layouts controls.
- **Repo housekeeping** — GPL-3.0 license, human-tone security policy,
  trademark policy, issue/PR templates and Dependabot config.

### Removed
- **AI panel** — removed entirely (leftovers dropped, unused deps pruned);
  the project-setup chat in the Hub replaces it.

### Fixed
- Hub TDZ crash, wallpaper picker silent failures, wallpaper recents now
  persist across restarts, per-project tab mousedown leak and `open:url`
  allowlist tightening.

## [0.1.23] - 2026-09-25

### Added
- **AI panel: 7 new providers** — OpenRouter, Groq, Together AI, DeepSeek,
  xAI (Grok), Mistral AI and OpenCode Zen (free tier), all OpenAI-compatible
  with no extra dependencies. Synced across panel, Settings and main process.
- **AI file write tools** (opt-in, default OFF) — `write_file`, `edit_file`
  (unique-match guard), `make_dir`, `rename_path`, `copy_path`,
  `delete_path`. Project-confined, with panel + Settings toggles.
- **Run button: mise on-demand runtimes** — missing runtimes
  (node, python, go, rust, dotnet, java, ruby, php, dart…) auto-install via
  mise binary (auto-downloaded) and retry through `mise x --`. Success path
  untouched; dependency auto-install preserved as a chained step.
- **Run auto-detect v2** — multiple configs per project, framework detection
  (Next/Nuxt/Astro/Vue/Svelte/Angular/Expo/Electron…), Makefile,
  docker-compose and Taskfile support, prioritized npm scripts.
- **Hub wallpaper** — picker button (bottom-right), popup with wide-ratio
  recents grid, dotted + tile, custom right-click menu, session-only recents,
  wallpaper-tinted sidebar/center, opacity + cursor settings in Settings → Hub.
- **Hub drag-drop folder import** — drop any folder to import and open it
  directly (shared `openProjectDirect` path, no dialog), with status badges.
- **Output panel on xterm.js** — colored levels, clickable links,
  follow-lock, select-to-copy, incremental writes and same-line `\r`
  progress overwrites (with Run panel source fix).
- **Landing page privacy policy** (`privacy.html`) — human-written, no
  trackers/music notes, nav + sitemap wiring, jpg background.
- **Extension icon fallback** — icon-less extensions get the app icon
  instead of a 400 + broken tile.

### Changed
- **Project storage uses readable folder names** (`userData/projects/
  <ProjectName>/` with `project.json`, `README.txt`, `index.json`) with
  automatic migration from hashed names; Storage menu added.
- **Fonts: Consolas across the app**; shared smart CustomCursor (Hub +
  onboarding) with collapsible Hub sidebar rail.
- **All UI strings in English** — 27 Hinglish strings converted
  (Hub, Run, MediaViewer, Editor, Settings, storage README, emulator).
- **App-wide custom scrollbars** — single thin style everywhere, Hub rules unified.
- **Hub layout fit** — titlebar-aware container (`top: 30px`), flexible note
  panel, `min-height: 0` chain, short-screen compact mode, centered
  content-width Create panel with centered actions, flat backgrounds.
- **Canvas sidebar toggle** is now a Hub-style icon button; drawing saves
  are atomic (crash can no longer zero the file) with graceful corrupt-file
  handling.

### Fixed
- **Titlebar Tab access** — menubar buttons reachable via keyboard
  (`titlebarA11y` bridge + focus styles); Tab-eating handlers removed from
  Notebook and AndroidEmulator.
- **Canvas corrupt drawing recovery** — zeroed file diagnosed, backed up
  and repaired.
- **Recents filter menu clipping/z-order** and Hub bottom-margin/frame fit.
- **Temp titlebar diagnostics** removed from console.

## [0.1.22] - 2026-09-22

### Changed
- **Project Panel delete ab OS Recycle Bin me jata hai** — internal
  `.bin/<timestamp>_<name>` trash system + `manifest.json` + migration code
  hata diya. Delete (`shell.trashItem`) → OS Recycle Bin, permanent delete
  use bypass karta hai.
- **Delete ka internal undo hata diya** — deleted files OS Recycle Bin se
  restore karo. `Empty Trash` / `Reveal Trash` menu entries bhi hata diye.
- README me delete behavior document kiya.

## [0.1.21] - 2026-09-21

### Added
- **Project Hub redesign** — left sidebar (Create / Clone / Open / Frameworks),
  Note + Recents stacked panels, compact centered layout with scroll.
- **GitHub contribution heatmap in Hub** — GitHub-style full-year grid
  (month labels, Mon/Wed/Fri, Less→More legend, streak), shimmer skeleton +
  cascade load animations. Username via onboarding / Settings → Hub.
- **First-launch onboarding page** — minimal 2-screen flow (brand → GitHub
  username), Discord-style animations. Sirf first launch ya data reset par.
- **Frameworks gallery (32 templates)** — real devicons, categories + search,
  JS/TS language selector, template files tree preview (right column),
  one-click project creation with starter files. Framework icons in Recents.
- **Your repositories in Clone panel** — saved GitHub id ki public repos
  direct list + one-click clone.
- **Recents search + filter** — title-bar search, All/Pinned dropdown, pin
  buttons on rows.
- **Settings → Hub page** — GitHub username, heatmap toggle (live), reset
  onboarding, clear recents, open/clear main storage folder.
- **Settings redesign (fragments language)** — grouped icon sidebar + search,
  Card rows, Field layout, new Switch/buttons/inputs, staggered entrances.
- **Terminal multi-session** — global dropdown (saare panels me same list),
  top toolbar, bottom Kill/Clear/Restart, shells survive panel switch.
- **Run auto-install** — `npm install` / `pip install -r` / `go mod tidy`
  run se pehle auto (single chained command).
- **Storage menu** — top `Open Main Storage Folder` button.
- **Ctrl+Scroll UI zoom** — poori UI me (Media/Canvas local zoom excluded).
- **Git panel file icons**, **MediaViewer PDF fix** (plugins + dataURL),
  **clone console xterm**.

### Fixed
- **Pinned filter never worked** — `load-recent` galat
  `projects/project-pins.json` padhta tha, toggle `userData/` me likhta tha;
  path unify (restart required).
- **Onboarding black screen** — TDZ crash (`clean` used before declaration).
- **Terminal infinite re-render** — `useSyncExternalStore` snapshot caching.
- **Hub button overflow** + responsive gaps, create-panel spacing, dialog
  footer backgrounds.

## [0.1.20] - 2026-09-16

### Added
- **Website "Update my app" button** (chatlog page, floating bottom-right)
  — click par `idiotbox://update` deep link khulta hai: installed app
  launch/focus hota hai aur update check (latest.yml feed) turant chalta
  hai. App installed na ho to button fallback message + download hint
  dikhata hai.
- **`idiotbox://` protocol support in app** — NSIS installer registry entry
  (`protocols` in build config), `second-instance` / `open-url` /
  cold-start argv routing, single-instance lock taaki protocol clicks
  hamesha running app me aayen.

## [0.1.19] - 2026-09-16

### Fixed
- **Auto-updater ab `latest.yml` + `.exe.blockmap` flow use karta hai**
  (electron-updater primary) — version ka faisla GitHub Releases ke
  `latest.yml` feed se hota hai, aur download `.blockmap` differential se
  hota hai (sirf badle blocks, poora exe sirf zaroorat par). GitHub API ab
  sirf release notes/URL enrich + fallback ke liye hai jab feed unreachable
  ho. Isse purana check/download race bhi khatm (pehle check GitHub API se
  hota tha aur download ke paas feed ka asli `UpdateInfo` nahi hota tha).
- **Release workflow ab updater feed files explicitly attach karta hai**
  (`Idiot-Box-Setup-*.exe`, `*.blockmap`, `latest*.yml`, AppImage, deb) —
  `dist/*` se builder-debug junk bhi release me chala jata tha.
- NSIS `differentialPackage: true` explicitly set (blockmap hamesha bane).

### Added
- **Browser panel** — Electron browser component, preload script aur layout
  styles.
- **Notebook rich outputs** — DataFrame tables, image zoom, collapsible
  outputs, LaTeX rendering.
- **Notebook auto-height** — cells content + output ke hisaab se
  auto-extend hote hain (MutationObserver for dynamic updates).

### Changed
- Browser in-page Find button hidden.

## [0.1.18] - 2026-09-15

### Added
- **Custom Electron titlebar** — frameless window (`titleBarStyle: hidden`,
  native menu bar hidden) with `custom-electron-titlebar` in dark theme
  (`#171717`, left-aligned menu, shadow). Title in `index.html` cleared
  since the custom titlebar owns it.
- **FlexLayout tab context menus** — right-click any tab for **Close**,
  **Close Others**, **Close All**, **Duplicate**, **Split Right**; Browser
  tabs add **Refresh** / **Settings**, file tabs add **Copy Path** /
  **Reveal in File Explorer** (IPC `tab:contextMenu` + `menu:popup` for
  app menu).
- **Run & Debug status button in titlebar** — centered **Run/Stop** pill
  (green → red while running) with dropdown arrow: Run, Debug, Run with
  Options, Run Configuration. Single click triggers auto-detected run
  (`npm dev/start`, `python`, etc.), opens Run & Debug panel and fires
  `run:request`; while running it stops the current task.
- **Auto Browser on localhost URL** — `RunPanel` watches ANSI-stripped
  terminal output for `http://localhost|127.0.0.1` and auto-dispatches
  `add-browser-panel` once per run (guard `browserOpenedRef`).

### Changed
- **Browser tab refresh** — `BrowserPanel` listens for `browser:refresh`
  custom event (dispatched by tab menu) and calls `webview.reload()`.
- **Menu bar IDs** — `File`, `Edit`, `View`, `Git`, `Terminal`, `Run`,
  `Storage` menus now carry stable `id` (`menu-file`, `menu-run`, …)
  so the custom titlebar can pop them via `showAppMenu`.
- **Status bar** — removed "Idiot Box" text label (branding now in titlebar).

### Dependencies
- Added `custom-electron-titlebar@4.4.1`.

## [0.1.17] - 2026-09-12

### Added
- **New Panel search** — the Blank "New Panel" launcher now has a search
  bar; type to filter panels by name or description (Esc clears, × resets,
  friendly empty state when nothing matches).
- **More Android emulator variants** — the AVD create form now offers
  Android 11–16 (API 30–36) and a **System image** picker: Google APIs or
  Google APIs + Play Store (Play Store images are user builds — Store app
  included, no root). The device list grows to 12 (Pixel 9 / 9 Pro, 8 Pro,
  Fold, Tablet, 6 Pro, …), and AVDs built on a Play Store image get a
  "• Play Store" badge in the emulator list.
- **Native file drag-out** — drag files/folders from the sidebar or content
  area straight into Explorer / Desktop / VS Code via an OS-level drag;
  dropping them back into the app moves instead of copying.

## [0.1.16] - 2026-09-12

### Added
- **HTML file previews** — Component Preview panel lists, opens and renders
  `.html`/`.htm` files (file dropdown, editor follow, live update while
  typing, reload on save). Relative `<link>`/images/scripts resolve via an
  injected `<base href="ibx-file://…">`, so local assets just work.
- **HTML on Canvas** — project scan now lists root-level and `public/`
  `.html`/`.htm` files (new “html” group, `.htm` recognized everywhere);
  Canvas embeds render HTML cards with the same base-URL pipeline plus live
  sync while typing.
- **Canvas background options** — toolbar segmented control + Settings →
  Canvas dropdown: **Black / White / Grid**. Persists in settings, migrates
  the old grid toggle (no visual change for existing users), Clear respects
  the current mode, no spurious dirty-save on mount.
- **Canvas embed CSS pipeline** — embeds now load the bundler-resolved CSS
  (`res.css`: relative/package/`@import`/CSS-module imports) last, plus
  project globals (sibling, walk-up, root conventions, entry imports,
  `index.html` links, framework dist, `dist/` build output for compiled
  utilities). `body`/`html`/`:root`/`#root` selectors are mapped to `:host`
  so theme variables and resets apply inside shadow DOM. Live code + CSS-only
  refresh while typing (debounced, no wasteful rebundles).

### Changed
- **Editor simplified to plain CodeMirror** — file load/save/AutoSave,
  highlighting, AI bridge, find (built-in search panel), right-click menu,
  language picker and status bar stay; Settings → Editor is now 9 essential
  controls. Old `settings.json` keys keep working.
- Editor completions now come straight from the language packages
  (custom snippet/global merging removed).

### Removed
- Editor extras: LSP client, lint + Problems feed, git diff gutter, Vim
  mode, whitespace dots, custom highlight styles, Prettier format,
  custom find/replace bar, content-sniffing language detect.
- Dependencies pruned: `@codemirror/lsp-client`,
  `@codemirror/language-data`, `@codemirror/lint`,
  `@replit/codemirror-vim`, `prettier`, `@lezer/highlight`
  (renderer bundle is now ~38 MB).

### Fixed
- Canvas embeds no longer inject raw SCSS/Less as CSS, no longer leak
  styles across file switches, and overlapping reloads can't overwrite
  newer state.
