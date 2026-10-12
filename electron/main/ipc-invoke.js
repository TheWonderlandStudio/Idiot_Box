const { ipcMain } = require("electron");

const handlers = new Map();

const originalHandle = ipcMain.handle.bind(ipcMain);
const originalRemoveHandler = ipcMain.removeHandler.bind(ipcMain);

ipcMain.handle = (channel, listener) => {
  handlers.set(channel, listener);
  return originalHandle(channel, listener);
};

ipcMain.removeHandler = (channel) => {
  handlers.delete(channel);
  return originalRemoveHandler(channel);
};

let senderProvider = () => null;

function buildEvent() {
  let wc = null;
  try { wc = senderProvider(); } catch {}
  if (wc && typeof wc.isDestroyed === "function" && !wc.isDestroyed()) return { sender: wc };
  const stub = {
    id: 0,
    send() {},
    once() { return stub; },
    on() { return stub; },
    removeListener() { return stub; },
    removeAllListeners() { return stub; },
    isDestroyed: () => false,
    getURL: () => "",
  };
  return { sender: stub };
}

function invoke(channel, ...args) {
  const handler = handlers.get(channel);
  if (!handler) return Promise.reject(new Error(`No handler registered for channel "${channel}"`));
  try {
    return Promise.resolve(handler(buildEvent(), ...args));
  } catch (err) {
    return Promise.reject(err);
  }
}

function listChannels() {
  return [...handlers.keys()].sort();
}

function hasChannel(channel) {
  return handlers.has(channel);
}

function setSenderProvider(fn) {
  if (typeof fn === "function") senderProvider = fn;
}

module.exports = { invoke, listChannels, hasChannel, setSenderProvider };
