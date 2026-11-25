# IPC channel reference

All channels below are registered in the main process (`ipcMain.handle` unless noted) and exposed to the renderer through `window.electronAPI` in `electron/preload/index.js`. The MCP server can invoke most of them directly (interactive/UI channels are blocked — see [MCP.md](../MCP.md)).

## App, settings, zoom

| Channel | Purpose |
|---|---|
| `editor:rendererReady` | Renderer announces readiness; flushes pending "Open With" files |
| `editor:takePendingFiles` | Pull next queued OS-opened file |
| `settings:read` / `settings:write` | Read / patch `settings.json` (broadcasts `settings:updated`) |
| `settings:openWindow` | Open the Settings window |
| `zoom:in` / `zoom:out` / `zoom:reset` / `zoom:get` / `zoom:set` | UI zoom 0.25–3.0, step 0.1 |
| `editors:list` | List editor apps for external-editor integration |
| `session:save` / `session:load` | Persist / restore window layout |

## Files & projects

| Channel | Purpose |
|---|---|
| `fs:readDir` / `fs:readDirAll` | List directory (single / recursive) |
| `fs:findFiles` | Glob/filename search in project |
| `fs:readTextFile` / `fs:readFileAsDataUrl` / `fs:stat` | File reads and metadata |
| `fs:writeFile` / `fs:saveFileAs` | Write / save-as file |
| `fs:openFile` | Open a file in the editor |
| `fs:newFolder` / `fs:newFile` / `fs:rename` / `fs:delete` / `fs:trashItem` / `fs:restoreTrashItem` / `fs:duplicate` / `fs:copyItem` / `fs:moveItem` / `fs:revealInExplorer` | File operations (trash is recoverable) |
| `fs:watch` / `fs:unwatch` | chokidar watch (broadcasts `fs:change`) |
| `fs:getVscodeIcon` / `fs:getIcon` / `fs:getFilePreview` | Icons and previews |
| `project:openDirect` | Open project by path |
| `project:clearCurrent` | Clear current project |
| `project:load-recent` / `project:add-recent` / `project:remove-recent` / `project:toggle-pin` / `project:refresh-recent` | Recent projects + pins |
| `menu:openProject` / `menu:newProject` | Menu-driven project actions |
| `projectConfig:readTabs` / `projectConfig:writeTabs` | Per-project tab config |
| `fs:readPinConfig` / `fs:writePinConfig` / `fs:readVisualTokens` / `fs:writeVisualTokens` | Pinned tabs + visual tokens |
| `projectStorage:getInfo` / `getTrashList` / `reveal` / `revealTrash` / `clearPin` / `clearTabs` / `clearCanvas` / `clearTrash` / `clearAll` / `listAll` / `revealAll` / `clearAllProjects` | Project data housekeeping (Storage menu) |

## Tabs & editor

| Channel | Purpose |
|---|---|
| `tabs:list` / `tabs:open` / `tabs:close` / `tabs:select` | Editor tab management (persisted) |
| `component:bundle` | esbuild-bundle a React component file for preview (concurrency 4) |
| `clipboard:readText` / `clipboard:writeText` (`on`, sync) | Clipboard access |
| `tab:contextMenu` | Editor tab context menu |

## Dialogs, media

| Channel | Purpose |
|---|---|
| `dialog:confirm` / `dialog:confirmSave` / `dialog:alert` / `dialog:openFolder` / `dialog:browseFolder` / `dialog:openImage` / `dialog:getDefaultLocation` | Native dialogs |
| `media:saveImage` / `media:saveImageAs` / `media:copyImage` | Image save / copy |
| `open:url` | Open external URL in system browser |

## Search & history

| Channel | Purpose |
|---|---|
| `search:project` / `search:replace` / `search:undoReplace` | Project search/replace engine (ripgrep fast path) |
| `history:list` / `history:read` / `history:snapshot` / `history:restore` / `history:delete` / `history:clear` / `history:stats` | Local file history |

## Git

| Channel | Purpose |
|---|---|
| `git:status` | Working-tree status |
| `git:diff` / `git:diffStaged` / `git:diffAll` / `git:diffUnstaged` | Diffs |
| `git:stage` / `git:unstage` / `git:stageAll` / `git:unstageAll` / `git:discard` / `git:applyHunk` | Staging and hunks |
| `git:branch` / `git:branches` / `git:createBranch` / `git:switchBranch` / `git:deleteBranch` / `git:renameBranch` / `git:init` / `git:checkoutRemote` | Branches |
| `git:conflicts` / `git:markResolved` | Merge conflicts |
| `git:commit` / `git:commitAmend` / `git:commitShow` / `git:commitDiff` | Commits |
| `git:push` / `git:pull` / `git:fetch` / `git:log` / `git:blame` | Remote and history |
| `git:operationState` / `git:operationAction` | Long-operation state / continue-abort |
| `git:menuAction` / `git:clone` | Menu-driven actions; clone with `git:clone:log`/`git:clone:done` |

## Terminal, run, notebook

| Channel | Purpose |
|---|---|
| `terminal:getProjectPath` | Current project path for terminal |
| `terminal:open` / `terminal:write` / `terminal:chdir` / `terminal:resize` / `terminal:close` / `terminal:contextMenu` / `terminal:tabContextMenu` | node-pty lifecycle |
| `run:start` / `run:write` / `run:stop` / `run:list` / `run:probes` | Run engine (events `run:data` / `run:exit`) |
| `notebook:checkPython` / `notebook:execute` / `notebook:restart` | Python notebooks |

## Debug & tests

| Channel | Purpose |
|---|---|
| `debug:start` / `debug:control` / `debug:stop` / `debug:stack` / `debug:scopes` / `debug:variables` / `debug:evaluate` / `debug:setBreakpoints` / `debug:threads` / `debug:installDebugpy` / `debug:availability` / `debug:sessions` | Debugger (events `debug:event`) |
| `test:detect` / `test:collect` / `test:run` / `test:stop` / `test:command` / `test:debugCommand` | Test explorer (events `test:event`) |

## Browser & live preview

| Channel | Purpose |
|---|---|
| `browser:webviewContextMenu` / `browser:tabContextMenu` | Browser context menus |
| `browser:registerGuest` | Register a webview guest |
| `browser:pickComponent` / `browser:guestEdit` | Design inspector (CDP) |
| `liveServer:start` | Live-reload HTTP server on 127.0.0.1 (random port) |
| `liveEdit:applyTextChange` / `liveEdit:locate` / `liveEdit:applyHtmlChange` / `liveEdit:revert` | Live-edit patches (events `liveEdit:fileChanged`) |
| `contextMenu:show` | Generic context menu |
| `panel:addMenu` | Panel menu items |
| `drag:startNative` (`on`) | Start native file drag |

## Updater, ports, tunnels

| Channel | Purpose |
|---|---|
| `updater:check` / `updater:download` / `updater:install` / `updater:getVersion` / `updater:isStore` / `updater:getState` | Auto-update (events `updater:*`) |
| `ports:list` / `ports:check` / `ports:forward` / `ports:unforward` / `ports:kill` / `ports:clearAutoDetected` | Ports panel |
| `devtunnels:status` / `devtunnels:check` / `devtunnels:login` / `devtunnels:logout` / `devtunnels:start` / `devtunnels:stop` / `devtunnels:stopAll` / `devtunnels:install` | Dev Tunnels (events `devtunnels:event`) |

## Chrome extensions

| Channel | Purpose |
|---|---|
| `chrome:loadExtension` / `chrome:loadCrx` / `chrome:listExtensions` / `chrome:setExtensionEnabled` / `chrome:removeExtension` | Chrome extension management |
| `ext:popupAnchor` | Anchor browser-action popups |

## Extension host (`ext:*`)

| Channel | Purpose |
|---|---|
| `ext:installFolder` / `ext:create` / `ext:openDir` / `ext:reload` | Install from folder, scaffold, reveal, reload |
| `ext:communityList` / `ext:communityInstall` / `ext:communityReadme` | Community (GitHub) extensions |
| `ext:details` / `ext:uninstall` / `ext:setEnabled` / `ext:list` | Manage extensions |
| `ext:commands` / `ext:invoke` / `ext:format` | Commands and formatting |
| `ext:views` / `ext:viewHtml` / `ext:viewMessage` / `ext:log` / `ext:statusItems` | Views, status bar, logs |

## AI & OpenCode

| Channel | Purpose |
|---|---|
| `ai:chat` / `ai:transcribe` | One-shot chat; speech-to-text |
| `ai:chat:start` (`on`) | Streaming chat → `ai:chat:chunk` / `ai:chat:done` / `ai:chat:error` |
| `opencode-panel:start` / `opencode-panel:stop` | OpenCode agent panel |

## Android, QEMU, misc

| Channel | Purpose |
|---|---|
| `android:getState` / `android:setupSdk` / `android:listAvds` / `android:createAvd` / `android:deleteAvd` / `android:startAvd` / `android:stopAvd` / `android:frame` / `android:frameStop` / `android:display` / `android:screenshot` / `android:screencap` / `android:waitSerial` / `android:diagKeyboard` / `android:bootState` / `android:input` / `android:installPackage` / `android:revealFolder` | Android SDK/emulator (events `android:progress`) |
| `qemu:getState` / `qemu:createVm` / `qemu:deleteVm` / `qemu:startVm` / `qemu:stopVm` / `qemu:input` / `qemu:getLog` / `qemu:pickIso` / `qemu:selectVmStorageDir` / `qemu:setCustomBinDir` / `qemu:revealFolder` | QEMU VMs (events `qemu:progress`) |
| `db:list` / `db:table` / `db:query` / `db:updateCell` / `db:insertRow` / `db:deleteRows` / `db:createTable` / `db:dropTable` / `db:export` | SQLite inspector |
| `mise:ensure` / `mise:trust` | mise runtime manager |
| `canvas:scan` / `canvas:saveLayout` / `canvas:loadLayout` / `canvas:saveDrawing` / `canvas:loadDrawing` | Canvas persistence |
| `layoutPresets:list` / `layoutPresets:save` / `layoutPresets:delete` | Layout presets |
| `menu:popup` | Context menu popup |

## Main → renderer events (selection)

`devtunnels:event`, `browser:componentPicked`, `add-browser-panel`, `updater:*`, `editor:osFilesPending`, `settings:updated`, `cet:refreshMenu`, `zoom:changed`, `editor:openFile`, `liveEdit:fileChanged`, `menu:openProject`, `project:pin-updated`, `output:log`, `project:recent-updated`, `settings:navigate`, `menu:closeProject`, `menu:cycleEditorTab`, `browser:shortcut`, `window:stateChanged`, ~50 menu-action events (whitelisted in preload), `terminal:data`, `terminal:exit`, `run:data`, `run:exit`, `fs:change`, `git:clone:log`, `git:clone:done`, `test:event`, `debug:event`, `android:progress`, `qemu:progress`, `ext:*`, `chrome:createTab`, `ai:chat:*`.
