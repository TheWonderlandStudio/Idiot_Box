# Keybindings reference

Source of truth: `electron/shared/keybindings.json` (48 entries). Each entry has an id, title, category, default accelerator, scope (`global` / `editor`), a CodeMirror mapping (`cmDefault`) for editor-scoped bindings, and a description. Per-user overrides live in `settings.json` → `keybindings` and are applied by `electron/main/keybindings.js` (`acceleratorFor`); the menu rebuilds when a binding changes. `Ctrl` maps to `Cmd` on macOS (`CmdOrCtrl`).

## General

| Command | Default |
|---|---|
| Command Palette | Ctrl+Shift+P |
| Quick Open | Ctrl+P |
| Settings | Ctrl+, |
| Toggle Full Screen | F11 |

## File

| Command | Default |
|---|---|
| Open Project | Ctrl+O |
| Open File | Ctrl+Shift+O |
| New Project | Ctrl+N |
| Save | Ctrl+S |
| Save As | Ctrl+Shift+S |
| Save All | Ctrl+Alt+S |
| New Tab | Ctrl+T |
| Close Tab | Ctrl+W |
| Reopen Closed Editor | Ctrl+Shift+T |
| Close Project | Ctrl+Shift+W |
| New Window | Ctrl+Shift+N |

## Edit

| Command | Default |
|---|---|
| Undo / Redo | Ctrl+Z / Ctrl+Y |
| Cut / Copy / Paste | Ctrl+X / Ctrl+C / Ctrl+V |
| Select All | Ctrl+A |
| Find | Ctrl+F |
| Find Next / Previous | F3 / Shift+F3 |
| Replace | Ctrl+H |

## Search

| Command | Default |
|---|---|
| Find in Files | Ctrl+Shift+F |
| Replace in Files | Ctrl+Shift+H |
| Local History | Ctrl+Alt+H |

## Editor

| Command | Default | CodeMirror |
|---|---|---|
| Format Document | Shift+Alt+F | Shift-Alt-f |
| Toggle Line Comment | Ctrl+/ | Mod-/ |
| Go to Line | Ctrl+G | Mod-g |
| Delete Line | Ctrl+Shift+K | Mod-Shift-k |
| Duplicate Line Down | Shift+Alt+Down | Shift-Alt-ArrowDown |
| Move Line Up / Down | Alt+Up / Alt+Down | Alt-ArrowUp / Alt-ArrowDown |
| Add Cursor Above / Below | Ctrl+Alt+Up / Ctrl+Alt+Down | Ctrl-Alt-ArrowUp / Ctrl-Alt-ArrowDown |

## Debug

| Command | Default |
|---|---|
| Toggle Breakpoint | F9 |
| Debugger Panel | Ctrl+Alt+D |

## View

| Command | Default |
|---|---|
| Reset Window Layout | Ctrl+Alt+R |
| Split Editor Right | Ctrl+\\ |
| Toggle Developer Tools | Ctrl+Shift+I |

## Terminal

| Command | Default |
|---|---|
| New Terminal | Ctrl+\` |
| Split Terminal Right | Ctrl+Shift+5 |
| Split Terminal Down | Ctrl+Shift+\\ |
| Clear Terminal | Ctrl+K |

## Git

| Command | Default |
|---|---|
| Refresh Git Status | Ctrl+Shift+G |
| Commit | Ctrl+Enter |

## Unbound (menu-only) commands

Run Auto-Detected Command, Stop Running Process, and Test Explorer have no default accelerator and are reachable from the menus, the command palette, and the Settings → Keybindings page where you can assign one.
