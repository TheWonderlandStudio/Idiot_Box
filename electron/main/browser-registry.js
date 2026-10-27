"use strict";

// Tracks <webview> guests created by the renderer. Electron's
// webContents.getAllWebContents() does not reliably list webview guests on all
// platforms/versions, but the main process receives every guest in
// did-attach-webview. Keeping our own registry also lets us remember which
// browser panel the user last focused.
//
// A guest is only treated as a browser panel after the Browser component marks
// it through the browser:registerGuest IPC. Other webviews in the IDE (OpenCode,
// Community, OpenPencil, ...) are tracked but never exposed to the browser tools.

const entries = new Map();
let activeId = null;

function add(wc, win) {
  if (!wc || wc.isDestroyed()) return;
  const existing = entries.get(wc.id);
  entries.set(wc.id, {
    wc,
    win: win || existing?.win || null,
    addedAt: Date.now(),
    // The renderer may have marked the guest before did-attach-webview ran.
    browser: Boolean(existing?.browser),
  });
  try {
    wc.on("focus", () => { activeId = wc.id; });
    wc.on("destroyed", () => {
      entries.delete(wc.id);
      if (activeId === wc.id) activeId = null;
    });
  } catch {}
}

function prune() {
  for (const [id, entry] of entries) {
    try {
      if (!entry.wc || entry.wc.isDestroyed()) entries.delete(id);
    } catch {
      entries.delete(id);
    }
  }
}

function markBrowser(wc) {
  if (!wc || wc.isDestroyed()) return false;
  const existing = entries.get(wc.id);
  if (existing) existing.browser = true;
  else entries.set(wc.id, { wc, win: null, addedAt: Date.now(), browser: true });
  return true;
}

function isBrowserGuest(wc) {
  try {
    if (!wc || wc.isDestroyed() || wc.getType() !== "webview") return false;
    const entry = entries.get(wc.id);
    return Boolean(entry?.browser);
  } catch {
    return false;
  }
}

function all() {
  prune();
  return [...entries.values()];
}

function list() {
  return all().filter(({ wc }) => isBrowserGuest(wc)).map(({ wc }) => {
    let focused = false;
    try { focused = wc.isFocused(); } catch {}
    return {
      id: wc.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      focused,
    };
  });
}

function pick(id) {
  const allEntries = all();
  if (id != null) {
    const match = allEntries.find(({ wc }) => wc.id === Number(id) && isBrowserGuest(wc));
    return match?.wc || null;
  }
  const focused = allEntries.find(({ wc }) => {
    try { return isBrowserGuest(wc) && wc.isFocused(); } catch { return false; }
  });
  if (focused) return focused.wc;
  if (activeId != null) {
    const active = entries.get(activeId);
    try {
      if (active && isBrowserGuest(active.wc)) return active.wc;
    } catch {}
  }
  const browsers = allEntries.filter(({ wc }) => isBrowserGuest(wc));
  return browsers.length ? browsers[browsers.length - 1].wc : null;
}

module.exports = { add, all, list, pick, markBrowser, isBrowserGuest };
