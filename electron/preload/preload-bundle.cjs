var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// electron/preload/index.js
var require_index = __commonJS({
  "electron/preload/index.js"() {
    var { contextBridge, ipcRenderer, webUtils, clipboard } = require("electron");
    contextBridge.exposeInMainWorld("electronAPI", {
      // ── Native file drag (outgoing to OS/external apps) ────────────────────
      startNativeDrag: (paths) => ipcRenderer.send("drag:startNative", paths),
      // ── Clipboard ─────────────────────────────────────────────────────────────
      clipboardRead: () => clipboard.readText(),
      clipboardWrite: (t) => clipboard.writeText(t),
      // ── Drag & drop (external files) ───────────────────────────────────────────
      getPathForFile: (file) => webUtils.getPathForFile(file),
      // ── Icons ──────────────────────────────────────────────────────────────────
      getVscodeIcon: (name, isDir, isOpen) => ipcRenderer.invoke("fs:getVscodeIcon", { name, isDir, isOpen: !!isOpen }),
      getIcon: (filePath) => ipcRenderer.invoke("fs:getIcon", filePath),
      getFilePreview: (filePath) => ipcRenderer.invoke("fs:getFilePreview", filePath),
      readTextFile: (filePath) => ipcRenderer.invoke("fs:readTextFile", filePath),
      writeFileText: (filePath, text) => ipcRenderer.invoke("fs:writeFile", { filePath, text }),
      saveFileAs: (filePath, text) => ipcRenderer.invoke("fs:saveFileAs", { filePath, text }),
      readFileAsDataUrl: (filePath) => ipcRenderer.invoke("fs:readFileAsDataUrl", filePath),
      transpileJsx: (code) => ipcRenderer.invoke("jsx:transpile", code),
      bundleComponent: (source, filePath, projectRoot) => ipcRenderer.invoke("component:bundle", { source, filePath, projectRoot }),
      copyImageToClipboard: (filePath) => ipcRenderer.invoke("media:copyImage", filePath),
      onOpenFileInEditor: (callback) => {
        const handler = (_e, payload) => callback(payload);
        ipcRenderer.on("editor:openFile", handler);
        return () => ipcRenderer.removeListener("editor:openFile", handler);
      },
      // ── Directory access ───────────────────────────────────────────────────────
      openFolder: () => ipcRenderer.invoke("dialog:openFolder"),
      readDir: (dir) => ipcRenderer.invoke("fs:readDir", dir),
      readDirAll: (dir) => ipcRenderer.invoke("fs:readDirAll", dir),
      stat: (p) => ipcRenderer.invoke("fs:stat", p),
      findFiles: (rootPath, query, limit) => ipcRenderer.invoke("fs:findFiles", rootPath, query, limit),
      searchText: (rootPath, query, limit) => ipcRenderer.invoke("fs:searchText", rootPath, query, limit),
      // ── File operations ────────────────────────────────────────────────────────
      newFolder: (parentPath, name) => ipcRenderer.invoke("fs:newFolder", { parentPath, name }),
      newFile: (parentPath, name) => ipcRenderer.invoke("fs:newFile", { parentPath, name }),
      rename: (oldPath, newName) => ipcRenderer.invoke("fs:rename", { oldPath, newName }),
      deleteItem: (itemPath) => ipcRenderer.invoke("fs:delete", { itemPath }),
      duplicate: (itemPath) => ipcRenderer.invoke("fs:duplicate", { itemPath }),
      copyItem: (srcPath, destDir) => ipcRenderer.invoke("fs:copyItem", { srcPath, destDir }),
      moveItem: (srcPath, destDir) => ipcRenderer.invoke("fs:moveItem", { srcPath, destDir }),
      revealInExplorer: (itemPath) => ipcRenderer.invoke("fs:revealInExplorer", { itemPath }),
      openFile: (filePath, editorId) => ipcRenderer.invoke("fs:openFile", { filePath, editorId }),
      trashItem: (itemPath, rootPath) => ipcRenderer.invoke("fs:trashItem", { itemPath, rootPath }),
      restoreTrashItem: (trashId, rootPath) => ipcRenderer.invoke("fs:restoreTrashItem", { trashId, rootPath }),
      // ── Confirm dialog (native OS message box) ────────────────────────────────
      confirmDialog: (message) => ipcRenderer.invoke("dialog:confirm", message),
      showAlert: (message) => ipcRenderer.invoke("dialog:alert", message),
      // ── Context menu ──────────────────────────────────────────────────────────
      // type: "none" | "file" | "folder" | "multi" | "pinned" | "breadcrumb"
      showContextMenu: (type, selectedPaths, clipboardPaths) => ipcRenderer.invoke("contextMenu:show", { type, selectedPaths, clipboardPaths }),
      // ── Pin config ──────────────────────────────────────────────────────────────
      readPinConfig: (rootPath) => ipcRenderer.invoke("fs:readPinConfig", rootPath),
      writePinConfig: (rootPath, data) => ipcRenderer.invoke("fs:writePinConfig", rootPath, data),
      // ── Settings ───────────────────────────────────────────────────────────────
      readSettings: () => ipcRenderer.invoke("settings:read"),
      writeSettings: (data) => ipcRenderer.invoke("settings:write", data),
      listEditors: () => ipcRenderer.invoke("editors:list"),
      openSettingsWindow: () => ipcRenderer.invoke("settings:openWindow"),
      // ── Browser context menus ──────────────────────────────────────────────────
      showBrowserTabContextMenu: () => ipcRenderer.invoke("browser:tabContextMenu"),
      showBrowserWebviewContextMenu: (params) => ipcRenderer.invoke("browser:webviewContextMenu", params),
      // ── Filesystem watcher ─────────────────────────────────────────────────────
      watchDir: (rootPath) => ipcRenderer.invoke("fs:watch", rootPath),
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
          "menu:openProject",
          "menu:newProject",
          "menu:saveProject",
          "menu:closeProject",
          "menu:resetLayout",
          "menu:saveFile",
          "menu:saveFileAs",
          "menu:toggleAutoSave",
          "menu:commandPalette",
          "menu:loadExtension",
          "menu:undo",
          "menu:redo",
          "menu:cut",
          "menu:copy",
          "menu:paste",
          "menu:selectAll",
          "menu:find",
          "menu:findNext",
          "menu:findPrevious",
          "menu:replace",
          "menu:fullscreen",
          "menu:newTerminal",
          "menu:splitTerminalRight",
          "menu:splitTerminalDown",
          "menu:clearTerminal",
          "menu:killTerminal"
        ];
        if (!valid.includes(channel)) return () => {
        };
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
      getWebviewPreload: () => true ? "C:/Users/Jignesh/Downloads/Idiot_Box/node_modules/electron-chrome-extensions/dist/chrome-extension-api.preload.js" : void 0,
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
        } catch {
        }
        return () => {
        };
      })(),
      // ── Terminal ──────────────────────────────────────────────────────────────
      getProjectPath: () => ipcRenderer.invoke("terminal:getProjectPath"),
      openTerminal: (tabId, cwd, forceRestart) => ipcRenderer.invoke("terminal:open", { tabId, cwd, forceRestart: !!forceRestart }),
      writeToTerminal: (tabId, data) => ipcRenderer.invoke("terminal:write", { tabId, data }),
      resizeTerminal: (tabId, cols, rows) => ipcRenderer.invoke("terminal:resize", { tabId, cols, rows }),
      closeTerminal: (tabId) => ipcRenderer.invoke("terminal:close", { tabId }),
      onTerminalData: (callback) => {
        const handler = (_e, payload) => callback(payload);
        ipcRenderer.on("terminal:data", handler);
        return () => ipcRenderer.removeListener("terminal:data", handler);
      },
      onTerminalExit: (callback) => {
        const handler = (_e, payload) => callback(payload);
        ipcRenderer.on("terminal:exit", handler);
        return () => ipcRenderer.removeListener("terminal:exit", handler);
      },
      showTerminalContextMenu: (hasSelection) => ipcRenderer.invoke("terminal:contextMenu", { hasSelection }),
      showTerminalTabContextMenu: () => ipcRenderer.invoke("terminal:tabContextMenu"),
      // ── Panel Add Menu ──────────────────────────────────────────────────────────
      showPanelAddMenu: () => ipcRenderer.invoke("panel:addMenu"),
      // ── Port scanner ────────────────────────────────────────────────────────────
      scanPorts: () => ipcRenderer.invoke("port:scan"),
      scanPortsDetailed: () => ipcRenderer.invoke("port:scanDetailed"),
      killPort: (port) => ipcRenderer.invoke("port:kill", port),
      restartPort: (port) => ipcRenderer.invoke("port:restart", port),
      // ── Open URL in browser ───────────────────────────────────────────────────
      openUrl: (url) => ipcRenderer.invoke("open:url", url),
      // ── Project config (per-project tab state) ────────────────────────────────
      readProjectTabs: (rootPath) => ipcRenderer.invoke("projectConfig:readTabs", rootPath),
      writeProjectTabs: (rootPath, data) => ipcRenderer.invoke("projectConfig:writeTabs", rootPath, data),
      // ── Git ─────────────────────────────────────────────────────────────────────
      gitStatus: (rootPath) => ipcRenderer.invoke("git:status", rootPath),
      gitDiff: (rootPath, filePath) => ipcRenderer.invoke("git:diff", rootPath, filePath),
      gitDiffAll: (rootPath) => ipcRenderer.invoke("git:diffAll", rootPath),
      gitBranch: (rootPath) => ipcRenderer.invoke("git:branch", rootPath),
      gitLog: (rootPath, n) => ipcRenderer.invoke("git:log", rootPath, n),
      gitStage: (rootPath, rel) => ipcRenderer.invoke("git:stage", rootPath, rel),
      gitUnstage: (rootPath, rel) => ipcRenderer.invoke("git:unstage", rootPath, rel),
      gitStageAll: (rootPath) => ipcRenderer.invoke("git:stageAll", rootPath),
      gitUnstageAll: (rootPath) => ipcRenderer.invoke("git:unstageAll", rootPath),
      gitDiscard: (rootPath, rel) => ipcRenderer.invoke("git:discard", rootPath, rel),
      gitCommit: (rootPath, msg) => ipcRenderer.invoke("git:commit", rootPath, msg),
      gitPush: (rootPath) => ipcRenderer.invoke("git:push", rootPath),
      gitPull: (rootPath) => ipcRenderer.invoke("git:pull", rootPath),
      gitFetch: (rootPath) => ipcRenderer.invoke("git:fetch", rootPath),
      // ── Canvas (Visual Project Map) ────────────────────────────────────────────
      scanCanvas: (rootPath) => ipcRenderer.invoke("canvas:scan", rootPath),
      saveCanvasLayout: (rootPath, data) => ipcRenderer.invoke("canvas:saveLayout", rootPath, data),
      loadCanvasLayout: (rootPath) => ipcRenderer.invoke("canvas:loadLayout", rootPath),
      // ── Window state ────────────────────────────────────────────────────────────
      onWindowStateChanged: (callback) => {
        const handler = (_e, payload) => callback(payload);
        ipcRenderer.on("window:stateChanged", handler);
        return () => ipcRenderer.removeListener("window:stateChanged", handler);
      },
      // ── Session ─────────────────────────────────────────────────────────────────
      saveSession: (data) => ipcRenderer.invoke("session:save", data),
      loadSession: () => ipcRenderer.invoke("session:load")
    });
  }
});

// node_modules/electron-chrome-extensions/dist/cjs/browser-action.js
var require_browser_action = __commonJS({
  "node_modules/electron-chrome-extensions/dist/cjs/browser-action.js"(exports2, module2) {
    "use strict";
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames2 = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames2(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
    var browser_action_exports = {};
    __export(browser_action_exports, {
      injectBrowserAction: () => injectBrowserAction
    });
    module2.exports = __toCommonJS(browser_action_exports);
    var import_electron = require("electron");
    var injectBrowserAction = () => {
      const actionMap = /* @__PURE__ */ new Map();
      const observerCounts = /* @__PURE__ */ new Map();
      const internalEmitter = process;
      const invoke = (name, partition, ...args) => {
        return import_electron.ipcRenderer.invoke("crx-msg-remote", partition, name, ...args);
      };
      const __browserAction__ = {
        addEventListener(name, listener) {
          internalEmitter.addListener(`-actions-${name}`, listener);
        },
        removeEventListener(name, listener) {
          internalEmitter.removeListener(`-actions-${name}`, listener);
        },
        getAction(extensionId) {
          return actionMap.get(extensionId);
        },
        async getState(partition) {
          const state = await invoke("browserAction.getState", partition);
          for (const action of state.actions) {
            actionMap.set(action.id, action);
          }
          queueMicrotask(() => internalEmitter.emit("-actions-update", state));
          return state;
        },
        activate: (partition, details) => {
          return invoke("browserAction.activate", partition, details);
        },
        addObserver(partition) {
          let count = observerCounts.has(partition) ? observerCounts.get(partition) : 0;
          count = count + 1;
          observerCounts.set(partition, count);
          if (count === 1) {
            invoke("browserAction.addObserver", partition);
          }
        },
        removeObserver(partition) {
          let count = observerCounts.has(partition) ? observerCounts.get(partition) : 0;
          count = Math.max(count - 1, 0);
          observerCounts.set(partition, count);
          if (count === 0) {
            invoke("browserAction.removeObserver", partition);
            observerCounts.delete(partition);
          }
        }
      };
      import_electron.ipcRenderer.on("browserAction.update", () => {
        for (const partition of observerCounts.keys()) {
          __browserAction__.getState(partition);
        }
      });
      function mainWorldScript() {
        const DEFAULT_PARTITION = "_self";
        const browserAction = globalThis.browserAction || __browserAction__;
        class BrowserActionElement extends HTMLButtonElement {
          get id() {
            return this.getAttribute("id") || "";
          }
          set id(id) {
            this.setAttribute("id", id);
          }
          get tab() {
            const tabId = parseInt(this.getAttribute("tab") || "", 10);
            return typeof tabId === "number" && !isNaN(tabId) ? tabId : -1;
          }
          set tab(tab) {
            this.setAttribute("tab", `${tab}`);
          }
          get partition() {
            return this.getAttribute("partition");
          }
          set partition(partition) {
            if (partition) {
              this.setAttribute("partition", partition);
            } else {
              this.removeAttribute("partition");
            }
          }
          get alignment() {
            return this.getAttribute("alignment") || "";
          }
          set alignment(alignment) {
            this.setAttribute("alignment", alignment);
          }
          static get observedAttributes() {
            return ["id", "tab", "partition", "alignment"];
          }
          constructor() {
            super();
            this.addEventListener("click", this.onClick.bind(this));
            this.addEventListener("contextmenu", this.onContextMenu.bind(this));
          }
          connectedCallback() {
            if (this.isConnected) {
              this.update();
            }
          }
          disconnectedCallback() {
            if (this.updateId) {
              cancelAnimationFrame(this.updateId);
              this.updateId = void 0;
            }
            if (this.pendingIcon) {
              this.pendingIcon = void 0;
            }
          }
          attributeChangedCallback() {
            if (this.isConnected) {
              this.update();
            }
          }
          activate(event) {
            const rect = this.getBoundingClientRect();
            browserAction.activate(this.partition || DEFAULT_PARTITION, {
              eventType: event.type,
              extensionId: this.id,
              tabId: this.tab,
              alignment: this.alignment,
              anchorRect: {
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
              }
            });
          }
          onClick(event) {
            this.activate(event);
          }
          onContextMenu(event) {
            event.stopImmediatePropagation();
            event.preventDefault();
            this.activate(event);
          }
          getBadge() {
            let badge = this.badge;
            if (!badge) {
              this.badge = badge = document.createElement("div");
              badge.className = "badge";
              badge.part = "badge";
              this.appendChild(badge);
            }
            return badge;
          }
          update() {
            if (this.updateId) return;
            this.updateId = requestAnimationFrame(this.updateCallback.bind(this));
          }
          updateIcon(info) {
            const iconSize = 32;
            const resizeType = 2;
            const searchParams = new URLSearchParams({
              tabId: `${this.tab}`,
              partition: `${this.partition || DEFAULT_PARTITION}`
            });
            if (info.iconModified) {
              searchParams.append("t", info.iconModified);
            }
            const iconUrl = `crx://extension-icon/${this.id}/${iconSize}/${resizeType}?${searchParams.toString()}`;
            const bgImage = `url(${iconUrl})`;
            if (this.pendingIcon) {
              this.pendingIcon.onload = this.pendingIcon.onerror = () => {
              };
              this.pendingIcon = void 0;
            }
            const img = this.pendingIcon = new Image();
            img.onerror = () => {
              if (this.isConnected) {
                this.classList.toggle("no-icon", true);
                if (this.title) {
                  this.dataset.letter = this.title.charAt(0);
                }
                this.pendingIcon = void 0;
              }
            };
            img.onload = () => {
              if (this.isConnected) {
                this.classList.toggle("no-icon", false);
                this.style.backgroundImage = bgImage;
                this.pendingIcon = void 0;
              }
            };
            img.src = iconUrl;
          }
          updateCallback() {
            this.updateId = void 0;
            const action = browserAction.getAction(this.id);
            const activeTabId = this.tab;
            const tabInfo = activeTabId > -1 ? action.tabs[activeTabId] : {};
            const info = { ...tabInfo, ...action };
            this.title = typeof info.title === "string" ? info.title : "";
            this.updateIcon(info);
            if (info.text) {
              const badge = this.getBadge();
              badge.textContent = info.text;
              badge.style.color = "#fff";
              badge.style.backgroundColor = info.color;
            } else if (this.badge) {
              this.badge.remove();
              this.badge = void 0;
            }
          }
        }
        customElements.define("browser-action", BrowserActionElement, { extends: "button" });
        class BrowserActionListElement extends HTMLElement {
          constructor() {
            super();
            this.observing = false;
            this.fetchState = async () => {
              try {
                await browserAction.getState(this.partition || DEFAULT_PARTITION);
              } catch {
                console.error(
                  `browser-action-list failed to update [tab: ${this.tab}, partition: '${this.partition}']`
                );
              }
            };
            this.update = (state) => {
              const tabId = typeof this.tab === "number" && this.tab >= 0 ? this.tab : state.activeTabId || -1;
              for (const action of state.actions) {
                let browserActionNode = this.shadowRoot?.querySelector(
                  `[id=${action.id}]`
                );
                if (!browserActionNode) {
                  const node = document.createElement("button", {
                    is: "browser-action"
                  });
                  node.id = action.id;
                  node.className = "action";
                  node.alignment = this.alignment;
                  node.part = "action";
                  browserActionNode = node;
                  this.shadowRoot?.appendChild(browserActionNode);
                }
                if (this.partition) browserActionNode.partition = this.partition;
                if (this.alignment) browserActionNode.alignment = this.alignment;
                browserActionNode.tab = tabId;
              }
              const actionNodes = Array.from(
                this.shadowRoot?.querySelectorAll(".action")
              );
              for (const actionNode of actionNodes) {
                if (!state.actions.some((action) => action.id === actionNode.id)) {
                  actionNode.remove();
                }
              }
            };
            const shadowRoot = this.attachShadow({ mode: "open" });
            const style = document.createElement("style");
            style.textContent = `
:host {
  display: flex;
  flex-direction: row;
  gap: 5px;
}

.action {
  width: 28px;
  height: 28px;
  background-color: transparent;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 70%;
  border: none;
  border-radius: 4px;
  padding: 0;
  position: relative;
  outline: none;
}

.action:hover {
  background-color: var(--browser-action-hover-bg, rgba(255, 255, 255, 0.3));
}

.action.no-icon::after {
  content: attr(data-letter);
  text-transform: uppercase;
  font-size: .7rem;
  background-color: #757575;
  color: white;
  border-radius: 4px;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80%;
  height: 80%;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}

.badge {
  box-shadow: 0px 0px 1px 1px var(--browser-action-badge-outline, #444);
  box-sizing: border-box;
  max-width: 100%;
  height: 12px;
  padding: 0 2px;
  border-radius: 2px;
  position: absolute;
  bottom: 1px;
  right: 0;
  pointer-events: none;
  line-height: 1.5;
  font-size: 9px;
  font-weight: 400;
  overflow: hidden;
  white-space: nowrap;
}`;
            shadowRoot.appendChild(style);
          }
          get tab() {
            const tabId = parseInt(this.getAttribute("tab") || "", 10);
            return typeof tabId === "number" && !isNaN(tabId) ? tabId : null;
          }
          set tab(tab) {
            if (typeof tab === "number") {
              this.setAttribute("tab", `${tab}`);
            } else {
              this.removeAttribute("tab");
            }
          }
          get partition() {
            return this.getAttribute("partition");
          }
          set partition(partition) {
            if (partition) {
              this.setAttribute("partition", partition);
            } else {
              this.removeAttribute("partition");
            }
          }
          get alignment() {
            return this.getAttribute("alignment") || "";
          }
          set alignment(alignment) {
            this.setAttribute("alignment", alignment);
          }
          static get observedAttributes() {
            return ["tab", "partition", "alignment"];
          }
          connectedCallback() {
            if (this.isConnected) {
              this.startObserving();
              this.fetchState();
            }
          }
          disconnectedCallback() {
            this.stopObserving();
          }
          attributeChangedCallback(name, oldValue, newValue) {
            if (oldValue === newValue) return;
            if (this.isConnected) {
              this.fetchState();
            }
          }
          startObserving() {
            if (this.observing) return;
            browserAction.addEventListener("update", this.update);
            browserAction.addObserver(this.partition || DEFAULT_PARTITION);
            this.observing = true;
          }
          stopObserving() {
            if (!this.observing) return;
            browserAction.removeEventListener("update", this.update);
            browserAction.removeObserver(this.partition || DEFAULT_PARTITION);
            this.observing = false;
          }
        }
        customElements.define("browser-action-list", BrowserActionListElement);
      }
      if (process.contextIsolated) {
        import_electron.contextBridge.exposeInMainWorld("browserAction", __browserAction__);
        if ("executeInMainWorld" in import_electron.contextBridge) {
          import_electron.contextBridge.executeInMainWorld({
            func: mainWorldScript
          });
        } else {
          import_electron.webFrame.executeJavaScript(`(${mainWorldScript}());`);
        }
      } else {
        mainWorldScript();
      }
    };
  }
});

// electron/preload/browser-action-entry.cjs
var require_browser_action_entry = __commonJS({
  "electron/preload/browser-action-entry.cjs"() {
    var { injectBrowserAction } = require_browser_action();
    injectBrowserAction();
  }
});

// electron/preload/preload-entry.cjs
require_index();
require_browser_action_entry();
