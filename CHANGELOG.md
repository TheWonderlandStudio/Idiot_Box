# Changelog

All notable changes to Idiot Box are documented here.
Older releases: see [GitHub Releases](https://github.com/TheWonderlandStudio/Idiot_Box/releases).

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
