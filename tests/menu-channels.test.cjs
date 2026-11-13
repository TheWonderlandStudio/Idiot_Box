const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The preload bridges native menu events to the renderer through
// `onMenuEvent(channel, cb)`. It only forwards channels that appear in its
// `valid` allowlist — an unknown channel silently returns a no-op
// unsubscribe, so the renderer never hears about it and the menu item does
// nothing at all.
//
// That allowlist has to stay in sync with the menu channels the main process
// emits and the channels the renderer subscribes to. These tests pin that
// invariant so a new menu item cannot be added on one side only.

const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

function preloadAllowlist() {
  const src = read("electron/preload/index.js");
  const block = src.match(/const valid = \[([\s\S]*?)\];/);
  assert.ok(block, "could not find the onMenuEvent allowlist in electron/preload/index.js");
  return [...block[1].matchAll(/"(menu:[A-Za-z]+)"/g)].map((m) => m[1]);
}

function rendererSubscribedChannels() {
  const root = path.join(REPO, "electron", "renderer");
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "assets") walk(full);
      } else if (/\.(jsx?|cjs)$/.test(entry.name) && !/bundle/i.test(entry.name)) {
        files.push(full);
      }
    }
  })(root);

  const channels = new Set();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    // onMenuEvent("menu:x", …) and the optional-chained onMenuEvent?.("menu:x", …)
    for (const m of src.matchAll(/onMenuEvent\??\.?\(\s*"(menu:[A-Za-z]+)"/g)) channels.add(m[1]);
  }
  return [...channels].sort();
}

function mainEmittedChannels() {
  const src = read("electron/main/index.js");
  const channels = new Set();
  for (const m of src.matchAll(/"(menu:[A-Za-z]+)"/g)) {
    // ipcMain.handle("menu:x") is an invoke channel, not an event to forward.
    const before = src.slice(Math.max(0, m.index - 20), m.index);
    if (/ipcMain\.handle\(\s*$/.test(before)) continue;
    channels.add(m[1]);
  }
  return [...channels].sort();
}

test("every menu channel the renderer subscribes to is allowed by the preload", () => {
  const allow = preloadAllowlist();
  const subscribed = rendererSubscribedChannels();
  assert.ok(subscribed.length > 0, "no menu subscriptions found in the renderer");
  const blocked = subscribed.filter((channel) => !allow.includes(channel));
  assert.deepEqual(
    blocked,
    [],
    `the preload allowlist drops ${blocked.join(", ")} — the renderer subscribes to `
      + "these channels but onMenuEvent() returns a no-op for them, so the "
      + "matching menu item does nothing"
  );
});

test("every menu channel the main process emits is allowed by the preload", () => {
  const allow = preloadAllowlist();
  const emitted = mainEmittedChannels();
  assert.ok(emitted.length > 0, "no menu channels found in electron/main/index.js");
  const blocked = emitted.filter((channel) => !allow.includes(channel));
  assert.deepEqual(
    blocked,
    [],
    `the preload allowlist drops ${blocked.join(", ")} — the main process emits `
      + "these menu events but onMenuEvent() refuses to forward them"
  );
});

test("the preload allowlist has no duplicate channels", () => {
  const allow = preloadAllowlist();
  const seen = new Set();
  const dupes = allow.filter((channel) => (seen.has(channel) ? true : (seen.add(channel), false)));
  assert.deepEqual(dupes, []);
});

test("the menu items that open panels are reachable", () => {
  // Regression guard for the four items that were dropped from the allowlist:
  // View ▸ Local History / Test Explorer / Debugger and Run ▸ Debug Current File.
  const allow = preloadAllowlist();
  for (const channel of [
    "menu:localHistory",
    "menu:testExplorer",
    "menu:debugPanel",
    "menu:debugCurrent",
  ]) {
    assert.ok(allow.includes(channel), `${channel} must be allowed by the preload`);
    assert.ok(
      rendererSubscribedChannels().includes(channel),
      `${channel} must be subscribed to by the renderer`
    );
  }
});
