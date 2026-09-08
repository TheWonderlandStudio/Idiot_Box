// Preload script entry point
const { contextBridge, ipcRenderer, webUtils, clipboard } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Native file drag (outgoing to OS/external apps) ────────────────────
  startNativeDrag: (paths) => ipcRenderer.send("drag:startNative", paths),

  // ── Clipboard ─────────────────────────────────────────────────────────────
  clipboardRead:  ()  => clipboard.readText(),
  clipboardWrite: (t) => clipboard.writeText(t),

  // ── Drag & drop (external files) ───────────────────────────────────────────
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // ── Icons ──────────────────────────────────────────────────────────────────
  getVscodeIcon:  (name, isDir, isOpen) => ipcRenderer.invoke("fs:getVscodeIcon", { name, isDir, isOpen: !!isOpen }),
  getIcon:        (filePath) => ipcRenderer.invoke("fs:getIcon", filePath),
  getFilePreview: (filePath) => ipcRenderer.invoke("fs:getFilePreview", filePath),
  readTextFile:   (filePath) => ipcRenderer.invoke("fs:readTextFile", filePath),
  writeFileText:  (filePath, text) => ipcRenderer.invoke("fs:writeFile", { filePath, text }),
  saveFileAs:     (filePath, text) => ipcRenderer.invoke("fs:saveFileAs", { filePath, text }),
   readFileAsDataUrl: (filePath) => ipcRenderer.invoke("fs:readFileAsDataUrl", filePath),
  bundleComponent: (source, filePath, projectRoot) => ipcRenderer.invoke("component:bundle", { source, filePath, projectRoot }),
  copyImageToClipboard: (filePath) => ipcRenderer.invoke("media:copyImage", filePath),
  onOpenFileInEditor: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("editor:openFile", handler);
    return () => ipcRenderer.removeListener("editor:openFile", handler);
  },

  // ── Directory access ───────────────────────────────────────────────────────
  openFolder:  ()      => ipcRenderer.invoke("dialog:openFolder"),
  readDir:     (dir)   => ipcRenderer.invoke("fs:readDir",    dir),
  readDirAll:  (dir)   => ipcRenderer.invoke("fs:readDirAll", dir),
  stat:        (p)     => ipcRenderer.invoke("fs:stat",       p),
  findFiles:   (rootPath, query, limit) => ipcRenderer.invoke("fs:findFiles", rootPath, query, limit),
  searchText:  (rootPath, query, limit) => ipcRenderer.invoke("fs:searchText", rootPath, query, limit),

  // ── File operations ────────────────────────────────────────────────────────
  newFolder:        (parentPath, name)          => ipcRenderer.invoke("fs:newFolder",  { parentPath, name }),
  newFile:          (parentPath, name)          => ipcRenderer.invoke("fs:newFile",    { parentPath, name }),
  rename:           (oldPath, newName)          => ipcRenderer.invoke("fs:rename",     { oldPath, newName }),
  deleteItem:       (itemPath)                  => ipcRenderer.invoke("fs:delete",     { itemPath }),
  duplicate:        (itemPath)                  => ipcRenderer.invoke("fs:duplicate",  { itemPath }),
  copyItem:         (srcPath, destDir)          => ipcRenderer.invoke("fs:copyItem",   { srcPath, destDir }),
  moveItem:         (srcPath, destDir)          => ipcRenderer.invoke("fs:moveItem",   { srcPath, destDir }),
  revealInExplorer: (itemPath)                  => ipcRenderer.invoke("fs:revealInExplorer", { itemPath }),
  openFile:         (filePath, editorId)        => ipcRenderer.invoke("fs:openFile",   { filePath, editorId }),
  trashItem:        (itemPath, rootPath)        => ipcRenderer.invoke("fs:trashItem",        { itemPath, rootPath }),
  restoreTrashItem: (trashId, rootPath)         => ipcRenderer.invoke("fs:restoreTrashItem", { trashId, rootPath }),

  // ── Confirm dialog (native OS message box) ────────────────────────────────
  confirmDialog: (message) => ipcRenderer.invoke("dialog:confirm", message),
  // 3-way save guard: resolves to "save" | "dontSave" | "cancel"
  confirmSaveDialog: (fileName) => ipcRenderer.invoke("dialog:confirmSave", fileName),
  showAlert:     (message) => ipcRenderer.invoke("dialog:alert",   message),

  // ── Context menu ──────────────────────────────────────────────────────────
  // type: "none" | "file" | "folder" | "multi" | "pinned" | "breadcrumb"
  showContextMenu: (type, selectedPaths, clipboardPaths) =>
    ipcRenderer.invoke("contextMenu:show", { type, selectedPaths, clipboardPaths }),

  // ── Pin config ──────────────────────────────────────────────────────────────
  readPinConfig:  (rootPath) => ipcRenderer.invoke("fs:readPinConfig", rootPath),
  writePinConfig: (rootPath, data) => ipcRenderer.invoke("fs:writePinConfig", rootPath, data),

  // ── Settings ───────────────────────────────────────────────────────────────
  readSettings:  ()     => ipcRenderer.invoke("settings:read"),
  writeSettings: (data) => ipcRenderer.invoke("settings:write", data),
  listEditors:   ()     => ipcRenderer.invoke("editors:list"),
  openSettingsWindow: (page) => ipcRenderer.invoke("settings:openWindow", page),
  onSettingsNavigate: (cb) => { const h=(_e,page)=>cb(page); ipcRenderer.on("settings:navigate", h); return ()=>ipcRenderer.removeListener("settings:navigate", h); },
  onSettingsUpdated: (cb) => { const h=(_e,data)=>cb(data); ipcRenderer.on("settings:updated", h); return ()=>ipcRenderer.removeListener("settings:updated", h); },

  // ── Browser context menus ──────────────────────────────────────────────────
  showBrowserTabContextMenu: ()            => ipcRenderer.invoke("browser:tabContextMenu"),
  showBrowserWebviewContextMenu: (params) => ipcRenderer.invoke("browser:webviewContextMenu", params),

  // ── Browser guest user-agent (responsive/mobile preview) ───────────────────
  // wcId = webview.getWebContentsId(). Empty/omitted ua => default UA restore.
  getGuestUserAgent: (wcId)     => ipcRenderer.invoke("browser:getGuestUA", wcId),
  setGuestUserAgent: (wcId, ua) => ipcRenderer.invoke("browser:setGuestUA", { wcId, ua }),

  // ── Filesystem watcher ─────────────────────────────────────────────────────
  watchDir:   (rootPath) => ipcRenderer.invoke("fs:watch",   rootPath),
  unwatchDir: (rootPath) => ipcRenderer.invoke("fs:unwatch", rootPath),
  // Returns unsubscribe function
  onFsChange: (callback) => {
    const handler = (_e, affectedDir, changedPath) => callback(affectedDir, changedPath);
    ipcRenderer.on("fs:change", handler);
    return () => ipcRenderer.removeListener("fs:change", handler);
  },

  // ── Menu events ────────────────────────────────────────────────────────────
  onMenuEvent: (channel, callback) => {
    const valid = [
      "menu:openProject","menu:newProject","menu:saveProject","menu:closeProject",
      "menu:resetLayout","menu:saveFile","menu:saveFileAs","menu:toggleAutoSave",
      "menu:commandPalette","menu:loadExtension",
      "menu:undo","menu:redo","menu:cut","menu:copy","menu:paste","menu:selectAll",
      "menu:find","menu:findNext","menu:findPrevious","menu:replace",
      "menu:formatDocument","menu:commentLine","menu:copyLineDown",
      "menu:moveLineUp","menu:moveLineDown","menu:gotoLine","menu:gotoSymbol",
      "menu:splitEditorRight",
      "menu:fullscreen",
      "menu:newTerminal","menu:splitTerminalRight","menu:splitTerminalDown",
      "menu:clearTerminal","menu:killTerminal",
      "menu:openPorts","menu:openGit","menu:openAI","menu:openAndroid"
    ];
    if (!valid.includes(channel)) return () => {};
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  // ── Chrome extensions ───────────────────────────────────────────────────────
  loadChromeExtension: () => ipcRenderer.invoke("chrome:loadExtension"),
  listChromeExtensions: () => ipcRenderer.invoke("chrome:listExtensions"),
  setChromeExtensionEnabled: (id, enabled) => ipcRenderer.invoke("chrome:setExtensionEnabled", id, enabled),
  removeChromeExtension: (id) => ipcRenderer.invoke("chrome:removeExtension", id),
  // Absolute path of the chrome.* API preload to attach to <webview> tags
  getWebviewPreload: () => (typeof __WEBVIEW_PRELOAD__ !== "undefined" ? __WEBVIEW_PRELOAD__ : undefined),
  onChromeCreateTab: (callback) => {
    const handler = (_e, url) => callback(url);
    ipcRenderer.on("chrome:createTab", handler);
    return () => ipcRenderer.removeListener("chrome:createTab", handler);
  },
  // ── Navigation isolation bridge: main -> renderer as window event ────────
  _initNavIsolation: (() => {
    try {
      ipcRenderer.on("add-browser-panel", (_e, data) => {
        const url = data?.url || data;
        if (url) window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url, config: { type: "browser", title: "Browser", url } } }));
      });
    } catch {}
    return () => {};
  })(),

  // ── Terminal ──────────────────────────────────────────────────────────────
  getProjectPath:  ()                          => ipcRenderer.invoke("terminal:getProjectPath"),
  openTerminal:    (tabId, cwd, forceRestart)  => ipcRenderer.invoke("terminal:open",  { tabId, cwd, forceRestart: !!forceRestart }),
  writeToTerminal: (tabId, data)   => ipcRenderer.invoke("terminal:write", { tabId, data }),
  cdTerminal: (tabId, cwd) => ipcRenderer.invoke("terminal:chdir", { tabId, cwd }),
  resizeTerminal:  (tabId, cols, rows) => ipcRenderer.invoke("terminal:resize", { tabId, cols, rows }),
  closeTerminal:   (tabId)         => ipcRenderer.invoke("terminal:close", { tabId }),
  onTerminalData:  (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("terminal:data", handler);
    return () => ipcRenderer.removeListener("terminal:data", handler);
  },
  onTerminalExit:  (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("terminal:exit", handler);
    return () => ipcRenderer.removeListener("terminal:exit", handler);
  },
  showTerminalContextMenu: (hasSelection) => ipcRenderer.invoke("terminal:contextMenu", { hasSelection }),
  showTerminalTabContextMenu: () => ipcRenderer.invoke("terminal:tabContextMenu"),

  // ── Panel Add Menu ──────────────────────────────────────────────────────────
  showPanelAddMenu: () => ipcRenderer.invoke("panel:addMenu"),

  // ── Live Server ─────────────────────────────────────────────────────────────
  startLiveServer: (rootPath, filePath) => ipcRenderer.invoke("liveServer:start", { rootPath, filePath }),

  // ── Auto Updater — Proper Cycle with Progress Bar ───────────────────────
  updaterCheck: () => ipcRenderer.invoke("updater:check"),
  updaterDownload: () => ipcRenderer.invoke("updater:download"),
  updaterInstall: () => ipcRenderer.invoke("updater:install"),
  updaterGetVersion: () => ipcRenderer.invoke("updater:getVersion"),
  updaterGetState: () => ipcRenderer.invoke("updater:getState"),
  onUpdaterChecking: (cb) => { const h=(_e)=>cb(); ipcRenderer.on("updater:checking", h); return ()=>ipcRenderer.removeListener("updater:checking", h); },
  onUpdaterAvailable: (cb) => { const h=(_e,info)=>cb(info); ipcRenderer.on("updater:available", h); return ()=>ipcRenderer.removeListener("updater:available", h); },
  onUpdaterNotAvailable: (cb) => { const h=(_e,info)=>cb(info); ipcRenderer.on("updater:not-available", h); return ()=>ipcRenderer.removeListener("updater:not-available", h); },
  onUpdaterError: (cb) => { const h=(_e,err)=>cb(err); ipcRenderer.on("updater:error", h); return ()=>ipcRenderer.removeListener("updater:error", h); },
  onUpdaterProgress: (cb) => { const h=(_e,p)=>cb(p); ipcRenderer.on("updater:progress", h); return ()=>ipcRenderer.removeListener("updater:progress", h); },
  onUpdaterDownloaded: (cb) => { const h=(_e,info)=>cb(info); ipcRenderer.on("updater:downloaded", h); return ()=>ipcRenderer.removeListener("updater:downloaded", h); },
  onUpdaterManualCheck: (cb) => { const h=(_e)=>cb(); ipcRenderer.on("updater:manualCheck", h); return ()=>ipcRenderer.removeListener("updater:manualCheck", h); },
  onUpdaterState: (cb) => { const h=(_e,s)=>cb(s); ipcRenderer.on("updater:state", h); return ()=>ipcRenderer.removeListener("updater:state", h); },

  // ── Port Manager ────────────────────────────────────────────────────────────
  getPorts:        () => ipcRenderer.invoke("ports:list"),
  checkPort:      (port) => ipcRenderer.invoke("ports:check", port),
  forwardPort:    (port, label) => ipcRenderer.invoke("ports:forward", port, label),
  unforwardPort:  (port) => ipcRenderer.invoke("ports:unforward", port),
  killPort:       (pid) => ipcRenderer.invoke("ports:kill", pid),
  clearAutoDetectedPorts: () => ipcRenderer.invoke("ports:clearAutoDetected"),

  // ── Open URL in browser ───────────────────────────────────────────────────
  openUrl: (url) => ipcRenderer.invoke("open:url", url),

  // ── Project config (per-project tab state) ────────────────────────────────
  readProjectTabs:  (rootPath)        => ipcRenderer.invoke("projectConfig:readTabs",  rootPath),
  writeProjectTabs: (rootPath, data)  => ipcRenderer.invoke("projectConfig:writeTabs", rootPath, data),

  // ── Git ─────────────────────────────────────────────────────────────────────
  gitStatus:  (rootPath)             => ipcRenderer.invoke("git:status", rootPath),
  gitDiff:    (rootPath, filePath)   => ipcRenderer.invoke("git:diff", rootPath, filePath),
  gitDiffStaged: (rootPath, filePath)=> ipcRenderer.invoke("git:diffStaged", rootPath, filePath),
  gitDiffAll: (rootPath)             => ipcRenderer.invoke("git:diffAll", rootPath),
  gitBranch:  (rootPath)             => ipcRenderer.invoke("git:branch", rootPath),
  gitBranches: (rootPath)            => ipcRenderer.invoke("git:branches", rootPath),
  gitCreateBranch: (rootPath, name)  => ipcRenderer.invoke("git:createBranch", rootPath, name),
  gitSwitchBranch: (rootPath, name)  => ipcRenderer.invoke("git:switchBranch", rootPath, name),
  gitDeleteBranch: (rootPath, name, force) => ipcRenderer.invoke("git:deleteBranch", rootPath, name, force),
  gitRenameBranch: (rootPath, oldN, newN) => ipcRenderer.invoke("git:renameBranch", rootPath, oldN, newN),
  gitInit:    (rootPath)             => ipcRenderer.invoke("git:init", rootPath),
  gitConflicts: (rootPath)           => ipcRenderer.invoke("git:conflicts", rootPath),
  gitMarkResolved: (rootPath, rel)   => ipcRenderer.invoke("git:markResolved", rootPath, rel),
  gitCommitShow: (rootPath, hash)    => ipcRenderer.invoke("git:commitShow", rootPath, hash),
  gitCommitDiff: (rootPath, hash)    => ipcRenderer.invoke("git:commitDiff", rootPath, hash),
  gitLog:     (rootPath, n)          => ipcRenderer.invoke("git:log", rootPath, n),
  gitStage:   (rootPath, rel)        => ipcRenderer.invoke("git:stage", rootPath, rel),
  gitUnstage: (rootPath, rel)        => ipcRenderer.invoke("git:unstage", rootPath, rel),
  gitStageAll: (rootPath)            => ipcRenderer.invoke("git:stageAll", rootPath),
  gitUnstageAll: (rootPath)          => ipcRenderer.invoke("git:unstageAll", rootPath),
  gitDiscard: (rootPath, rel)        => ipcRenderer.invoke("git:discard", rootPath, rel),
  gitCommit:  (rootPath, msg, opts)  => ipcRenderer.invoke("git:commit", rootPath, msg, opts),
  gitCommitAmend: (rootPath, msg)    => ipcRenderer.invoke("git:commitAmend", rootPath, msg),
  gitPush:    (rootPath)             => ipcRenderer.invoke("git:push", rootPath),
  gitPull:    (rootPath)             => ipcRenderer.invoke("git:pull", rootPath),
  gitFetch:   (rootPath)             => ipcRenderer.invoke("git:fetch", rootPath),

  // ── Canvas (Excalidraw drawing surface) ────────────────────────────────────
  scanCanvas:        (rootPath) => ipcRenderer.invoke("canvas:scan",        rootPath),
  saveCanvasLayout:  (rootPath, data) => ipcRenderer.invoke("canvas:saveLayout", rootPath, data),
  loadCanvasLayout:  (rootPath) => ipcRenderer.invoke("canvas:loadLayout",  rootPath),
  // JSON / .excalidraw drawings — per-project scratch file in app storage.
  // File-backed drawings (*.excalidraw in the project) use readTextFile/writeFileText.
  saveDrawing: (rootPath, data) => ipcRenderer.invoke("canvas:saveDrawing", rootPath, data),
  loadDrawing: (rootPath) => ipcRenderer.invoke("canvas:loadDrawing", rootPath),

  // ── Project storage (app memory — not in project folder) ──────────────────
  getProjectStorageInfo: (rootPath) => ipcRenderer.invoke("projectStorage:getInfo", rootPath),
  getProjectTrashList:   (rootPath) => ipcRenderer.invoke("projectStorage:getTrashList", rootPath),
  revealProjectStorage:  (rootPath) => ipcRenderer.invoke("projectStorage:reveal", rootPath),
  revealProjectTrash:    (rootPath) => ipcRenderer.invoke("projectStorage:revealTrash", rootPath),
  clearProjectPin:       (rootPath) => ipcRenderer.invoke("projectStorage:clearPin", rootPath),
  clearProjectTabs:      (rootPath) => ipcRenderer.invoke("projectStorage:clearTabs", rootPath),
  clearProjectCanvas:    (rootPath) => ipcRenderer.invoke("projectStorage:clearCanvas", rootPath),
  clearProjectTrash:     (rootPath) => ipcRenderer.invoke("projectStorage:clearTrash", rootPath),
  clearProjectAll:       (rootPath) => ipcRenderer.invoke("projectStorage:clearAll", rootPath),
  listAllProjectStorages:() => ipcRenderer.invoke("projectStorage:listAll"),
  revealAllStorages:     () => ipcRenderer.invoke("projectStorage:revealAll"),
  clearAllProjectsStorage:() => ipcRenderer.invoke("projectStorage:clearAllProjects"),

  // ── UI Zoom (View → UI Size — Ctrl + + / Ctrl + -) ───────────────────────
  zoomIn: () => ipcRenderer.invoke("zoom:in"),
  zoomOut: () => ipcRenderer.invoke("zoom:out"),
  zoomReset: () => ipcRenderer.invoke("zoom:reset"),
  getZoom: () => ipcRenderer.invoke("zoom:get"),
  setZoom: (factor) => ipcRenderer.invoke("zoom:set", factor),
  onZoomChanged: (cb) => { const h=(_e,f)=>cb(f); ipcRenderer.on("zoom:changed", h); return ()=>ipcRenderer.removeListener("zoom:changed", h); },

  // ── Window state ────────────────────────────────────────────────────────────
  onWindowStateChanged: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("window:stateChanged", handler);
    return () => ipcRenderer.removeListener("window:stateChanged", handler);
  },

  // ── Live Edit (Browser edit-mode) — text-only, auto detection html/js/jsx/ts/tsx ─
  liveEditApply: (payload) => ipcRenderer.invoke("liveEdit:applyTextChange", payload),
  onLiveEditFileChanged: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("liveEdit:fileChanged", handler);
    return () => ipcRenderer.removeListener("liveEdit:fileChanged", handler);
  },

  // ── Android Emulator (SDK rooted at <userData>/.appdata/android) ─────────
  androidGetState:      () => ipcRenderer.invoke("android:getState"),
  androidSetupSdk:      () => ipcRenderer.invoke("android:setupSdk"),
  androidListAvds:      () => ipcRenderer.invoke("android:listAvds"),
  androidCreateAvd:     (payload) => ipcRenderer.invoke("android:createAvd", payload),
  androidDeleteAvd:     (name) => ipcRenderer.invoke("android:deleteAvd", { name }),
  androidStartAvd:      (name, opts) => ipcRenderer.invoke("android:startAvd", { name, ...(opts || {}) }),
  androidStopAvd:       (name) => ipcRenderer.invoke("android:stopAvd", { name }),
  androidInstallPackage:(packageId) => ipcRenderer.invoke("android:installPackage", { packageId }),
  androidRevealFolder:  () => ipcRenderer.invoke("android:revealFolder"),
  // Embedded screen: headless emulator streamed into the panel
  androidWaitSerial:  (name, timeoutMs) => ipcRenderer.invoke("android:waitSerial", { name, timeoutMs }),
  androidBootState:   (serial) => ipcRenderer.invoke("android:bootState", { serial }),
  androidDiagKeyboard:(serial, name) => ipcRenderer.invoke("android:diagKeyboard", { serial, name }),
  androidScreencap:   (serial) => ipcRenderer.invoke("android:screencap", { serial }),
  androidFrame:       (serial) => ipcRenderer.invoke("android:frame", { serial }),
  androidFrameStop:   (serial) => ipcRenderer.invoke("android:frameStop", { serial }),
  androidInput:       (serial, action) => ipcRenderer.invoke("android:input", { serial, action }),
  androidDisplay:     (serial, mode) => ipcRenderer.invoke("android:display", { serial, mode }),
  androidScreenshot:  (serial, name) => ipcRenderer.invoke("android:screenshot", { serial, name }),
  onAndroidProgress: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("android:progress", handler);
    return () => ipcRenderer.removeListener("android:progress", handler);
  },

  // ── Notebook (Jupyter-like .ipynb cells, stateful Python kernel in main) ─
  notebookCheckPython: () => ipcRenderer.invoke("notebook:checkPython"),
  notebookExecute: (payload) => ipcRenderer.invoke("notebook:execute", payload),
  notebookRestart: (payload) => ipcRenderer.invoke("notebook:restart", payload),

  // ── Session ─────────────────────────────────────────────────────────────────
  saveSession:   (data) => ipcRenderer.invoke("session:save", data),
  loadSession:   ()     => ipcRenderer.invoke("session:load"),

  // ── AI Panel — Vercel AI SDK streaming via main (https://ai-sdk.dev) ─────
  // invoke aiChat -> { ok, requestId?, error? }; stream arrives on ai:stream,
  // completion on ai:done, failures on ai:error (all carry requestId).
  aiChat:     (payload) => ipcRenderer.invoke("ai:chat", payload),
  aiAbort:    (requestId) => ipcRenderer.invoke("ai:abort", requestId),
  aiValidate: (config) => ipcRenderer.invoke("ai:validate", config || {}),
  onAiStream: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("ai:stream", handler);
    return () => ipcRenderer.removeListener("ai:stream", handler);
  },
  onAiDone: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("ai:done", handler);
    return () => ipcRenderer.removeListener("ai:done", handler);
  },
  onAiError: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("ai:error", handler);
    return () => ipcRenderer.removeListener("ai:error", handler);
  },
});