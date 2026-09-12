# Changelog

All notable changes to Idiot Box are documented here.
Older releases: see [GitHub Releases](https://github.com/TheWonderlandStudio/Idiot_Box/releases).

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
