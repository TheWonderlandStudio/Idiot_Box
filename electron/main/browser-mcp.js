"use strict";

// Browser automation tools for Idiot Box's MCP server.
//
// These tools drive the real browser panel (<webview>) through the Chrome
// DevTools Protocol instead of spawning a second browser. That means the agent
// sees exactly what the user sees: same cookies, logins, extensions and page
// state. The main process already owns the guest webContents, so no renderer
// bridge or extra dependency is required.

const fs = require("fs");
const os = require("os");
const path = require("path");
const browserRegistry = require("./browser-registry");

const states = new WeakMap();

// Caps for CDP event buffers: DevTools-style history kept per panel, oldest
// entries dropped first so a busy page cannot grow memory without bound.
const MAX_NETWORK_ENTRIES = 300;
const MAX_CONSOLE_ENTRIES = 200;
const MAX_CONSOLE_TEXT = 500;

function stateFor(wc) {
  let state = states.get(wc);
  if (!state) {
    state = {
      refs: new Map(),
      enabled: false,
      network: { requests: new Map(), blocked: [] },
      console: [],
      trace: null,
    };
    states.set(wc, state);
  }
  return state;
}

function cdpEventsEnabled(state) {
  return Boolean(state.listening);
}

function browserGuests() {
  return browserRegistry.all()
    .map(({ wc }) => wc)
    .filter((wc) => browserRegistry.isBrowserGuest(wc));
}

function pickGuest(tabId) {
  const all = browserGuests();
  if (tabId != null) {
    const found = all.find((wc) => wc.id === Number(tabId));
    if (!found) throw new Error(`No browser panel with webContents id ${tabId}. Call browser tabs.`);
    return found;
  }
  return browserRegistry.pick();
}

function needGuest(tabId) {
  const wc = pickGuest(tabId);
  if (!wc) {
    throw new Error("No browser panel is open. Call browser open first.");
  }
  return wc;
}

async function debuggerFor(wc) {
  const dbg = wc.debugger;
  if (!dbg) throw new Error("Electron's webContents debugger API is unavailable.");
  if (!dbg.isAttached()) {
    try {
      dbg.attach("1.3");
    } catch (err) {
      throw new Error(
        `Could not attach to the browser panel: ${err.message}. ` +
        "Close DevTools for that panel and try again."
      );
    }
  }
  const state = stateFor(wc);
  if (!state.enabled) {
    try {
      await dbg.sendCommand("Page.enable");
      await dbg.sendCommand("Runtime.enable");
      await dbg.sendCommand("DOM.enable");
      await dbg.sendCommand("Accessibility.enable");
      state.enabled = true;
    } catch (err) {
      throw new Error(`Could not initialize the browser panel: ${err.message}`);
    }
  }
  if (!cdpEventsEnabled(state)) {
    try {
      await dbg.sendCommand("Network.enable", { maxTotalBufferSize: 20000000 });
      await dbg.sendCommand("Log.enable");
    } catch (err) {
      throw new Error(`Could not enable network/console capture: ${err.message}`);
    }
    state.listening = true;
    dbg.on("message", (_event, method, params) => handleCdpEvent(wc, method, params));
  }
  return dbg;
}

function consoleTextFromArgs(args) {
  return (args || [])
    .map((a) => {
      if (!a) return "";
      if (a.value !== undefined) {
        if (typeof a.value === "object") {
          try { return JSON.stringify(a.value); } catch { return String(a.value); }
        }
        return String(a.value);
      }
      if (a.description) return String(a.description).replace(/^"|"$/g, "");
      return "";
    })
    .join(" ")
    .slice(0, MAX_CONSOLE_TEXT);
}

function handleCdpEvent(wc, method, params) {
  const state = stateFor(wc);
  const net = state.network;
  switch (method) {
    case "Network.requestWillBeSent":
      net.requests.set(params.requestId, {
        id: params.requestId,
        method: params.request?.method || "",
        url: params.request?.url || "",
        type: params.type || "",
        ts: params.timestamp || Date.now() / 1000,
      });
      if (net.requests.size > MAX_NETWORK_ENTRIES) {
        net.requests.delete(net.requests.keys().next().value);
      }
      break;
    case "Network.responseReceived": {
      const entry = net.requests.get(params.requestId);
      if (entry) {
        entry.status = params.response?.status;
        entry.statusText = params.response?.statusText || "";
        entry.mimeType = params.response?.mimeType || "";
        entry.fromCache = Boolean(params.response?.fromDiskCache || params.response?.fromPrefetchCache);
        entry.remoteAddress = params.response?.remoteIPAddress
          ? `${params.response.remoteIPAddress}:${params.response.remotePort}`
          : "";
        entry.headers = params.response?.headers || {};
      }
      break;
    }
    case "Network.loadingFinished": {
      const entry = net.requests.get(params.requestId);
      if (entry) {
        entry.finished = true;
        entry.encodedDataLength = params.encodedDataLength || 0;
      }
      break;
    }
    case "Network.loadingFailed": {
      const entry = net.requests.get(params.requestId);
      if (entry) {
        entry.failed = true;
        entry.errorText = params.errorText || "failed";
      }
      break;
    }
    case "Runtime.consoleAPICalled":
      state.console.push({
        level: params.type || "log",
        text: consoleTextFromArgs(params.args),
        ts: params.timestamp || Date.now() / 1000,
      });
      if (state.console.length > MAX_CONSOLE_ENTRIES) state.console.shift();
      break;
    case "Log.entryAdded": {
      const entry = params.entry || {};
      state.console.push({
        level: entry.level || "info",
        text: String(entry.text || "").slice(0, MAX_CONSOLE_TEXT),
        source: entry.source || "",
        ts: (entry.timestamp || Date.now()) / 1000,
      });
      if (state.console.length > MAX_CONSOLE_ENTRIES) state.console.shift();
      break;
    }
    case "Tracing.dataCollected":
      if (state.trace && Array.isArray(params.value)) state.trace.push(...params.value);
      break;
    default:
      break;
  }
}

function waitForEvent(dbg, method, timeoutMs) {
  return new Promise((resolve) => {
    let timer = null;
    const onMessage = (_event, msgMethod, params) => {
      if (msgMethod !== method) return;
      cleanup();
      resolve(params || {});
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try { dbg.removeListener("message", onMessage); } catch {}
    };
    timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    dbg.on("message", onMessage);
  });
}

async function pageInfo(wc) {
  const dbg = await debuggerFor(wc);
  try {
    const { result } = await dbg.sendCommand("Runtime.evaluate", {
      expression: "({ url: location.href, title: document.title, readyState: document.readyState })",
      returnByValue: true,
    });
    return result?.value || { url: wc.getURL(), title: wc.getTitle(), readyState: null };
  } catch {
    return { url: wc.getURL(), title: wc.getTitle(), readyState: null };
  }
}

async function navigate(wc, url) {
  const dbg = await debuggerFor(wc);
  stateFor(wc).refs.clear();
  const loaded = waitForEvent(dbg, "Page.loadEventFired", 20000);
  let response;
  try {
    response = await dbg.sendCommand("Page.navigate", { url });
  } catch (err) {
    throw new Error(`Navigation failed: ${err.message}`);
  }
  if (response?.errorText) throw new Error(`Navigation failed: ${response.errorText}`);
  // Same-document navigations (hash changes) do not fire a load event and do
  // not return a loaderId.
  if (response?.loaderId) await loaded;
  return pageInfo(wc);
}

async function readPage(wc, maxChars) {
  const dbg = await debuggerFor(wc);
  const limit = Math.max(1000, Math.min(Number(maxChars) || 8000, 20000));
  const { result } = await dbg.sendCommand("Runtime.evaluate", {
    expression: `(() => {
      const text = document.body ? document.body.innerText : "";
      return {
        url: location.href,
        title: document.title,
        text: text.slice(0, ${limit}),
        length: text.length,
        truncated: text.length > ${limit}
      };
    })()`,
    returnByValue: true,
  });
  return result?.value || { url: wc.getURL(), title: wc.getTitle(), text: "", length: 0, truncated: false };
}

const ACTION_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
  "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio", "tab",
  "switch", "slider", "spinbutton", "img", "heading", "cell", "gridcell",
  "row", "treeitem", "dialog", "alertdialog", "navigation", "form", "search",
]);

function propValue(node, name) {
  const prop = (node.properties || []).find((p) => p.name === name);
  return prop ? prop.value?.value : undefined;
}

async function waitForReady(wc, timeoutMs = 15000) {
  const dbg = await debuggerFor(wc);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { result } = await dbg.sendCommand("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      if (result?.value === "complete") return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function snapshot(wc, maxNodes) {
  const dbg = await debuggerFor(wc);
  await waitForReady(wc, 10000);
  const limit = Math.max(20, Math.min(Number(maxNodes) || 120, 400));
  const { nodes } = await dbg.sendCommand("Accessibility.getFullAXTree");
  const refs = new Map();
  const lines = [];
  let count = 0;
  let skipped = 0;

  for (const node of nodes || []) {
    if (node.ignored) continue;
    const role = String(node.role?.value || "");
    const name = String(node.name?.value || "").replace(/\s+/g, " ").trim();
    if (!ACTION_ROLES.has(role)) continue;
    if (!node.backendDOMNodeId) continue;
    if (!name && role !== "textbox" && role !== "searchbox") continue;

    if (count >= limit) { skipped += 1; continue; }
    count += 1;
    const ref = `e${count}`;
    refs.set(ref, node.backendDOMNodeId);

    const flags = [];
    if (propValue(node, "disabled")) flags.push("disabled");
    if (propValue(node, "checked")) flags.push("checked");
    if (propValue(node, "selected")) flags.push("selected");
    if (propValue(node, "expanded")) flags.push("expanded");
    if (propValue(node, "required")) flags.push("required");
    if (propValue(node, "readonly")) flags.push("readonly");

    const suffix = flags.length ? ` [${flags.join(",")}]` : "";
    lines.push(`[${ref}] ${role}${name ? ` "${name}"` : ""}${suffix}`);
  }

  stateFor(wc).refs = refs;
  const info = await pageInfo(wc);
  return {
    url: info.url,
    title: info.title,
    snapshot: lines.join("\n"),
    nodes: count,
    truncated: skipped > 0,
  };
}

function centerOf(model) {
  const quad = model?.content?.length ? model.content : model?.border;
  if (!quad || quad.length < 8) return null;
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  };
}

const CLICKABLE_SELECTOR = 'a[href],button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="checkbox"],[role="radio"],[role="switch"],[role="option"],[onclick]';

async function resolveObject(dbg, backendNodeId) {
  try {
    const { object } = await dbg.sendCommand("DOM.resolveNode", { backendNodeId });
    return object?.objectId || null;
  } catch {
    return null;
  }
}

async function clickableObject(dbg, objectId) {
  try {
    const { result } = await dbg.sendCommand("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function(sel) {
        const el = this;
        if (!el || !el.matches) return null;
        if (el.matches(sel)) return el;
        const inside = el.querySelector(sel);
        if (inside) return inside;
        return el.closest('a[href],button,[role="button"],[role="link"],label');
      }`,
      arguments: [{ value: CLICKABLE_SELECTOR }],
      returnByValue: false,
    });
    return result?.objectId || null;
  } catch {
    return null;
  }
}

async function settleAfterAction(wc, dbg, beforeUrl, maxWaitMs = 1200) {
  const deadline = Date.now() + maxWaitMs;
  let navigating = false;
  while (Date.now() < deadline) {
    let url = "";
    try { url = wc.getURL() || ""; } catch {}
    if (url && beforeUrl && url !== beforeUrl) { navigating = true; break; }
    try {
      const { result } = await dbg.sendCommand("Runtime.evaluate", {
        expression: "document.readyState",
        returnByValue: true,
      });
      if (result?.value === "loading") { navigating = true; break; }
    } catch {
      navigating = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (navigating) {
    stateFor(wc).refs.clear();
    await waitForReady(wc, 15000);
  }
  try {
    return await pageInfo(wc);
  } catch {
    return { url: wc.getURL(), title: wc.getTitle(), readyState: null };
  }
}

async function clickRef(wc, ref, count) {
  const backendNodeId = stateFor(wc).refs.get(ref);
  if (!backendNodeId) throw new Error(`Unknown ref "${ref}". Call browser snapshot again.`);
  const dbg = await debuggerFor(wc);
  let beforeUrl = "";
  try { beforeUrl = wc.getURL() || ""; } catch {}
  try { wc.focus(); } catch {}

  // Prefer the real interactive element. An accessibility ref can point at a
  // heading or row that wraps the actual link/button the user means.
  const objectId = await resolveObject(dbg, backendNodeId);
  const clickId = objectId ? await clickableObject(dbg, objectId) : null;
  const targetId = clickId || objectId;

  if (targetId) {
    try {
      await dbg.sendCommand("Runtime.callFunctionOn", {
        objectId: targetId,
        functionDeclaration: `function() { try { this.scrollIntoView({ block: "center", inline: "center" }); } catch {} }`,
      });
    } catch {}
  } else {
    try { await dbg.sendCommand("DOM.scrollIntoViewIfNeeded", { backendNodeId }); } catch {}
  }

  let model;
  try {
    ({ model } = await dbg.sendCommand("DOM.getBoxModel", targetId ? { objectId: targetId } : { backendNodeId }));
  } catch (err) {
    throw new Error(`Could not find a clickable box for ${ref}: ${err.message}`);
  }
  const point = centerOf(model);
  if (!point) throw new Error(`Element ${ref} has no visible box.`);

  let hitTarget = false;
  if (targetId) {
    try {
      const { result } = await dbg.sendCommand("Runtime.callFunctionOn", {
        objectId: targetId,
        functionDeclaration: `function(x, y) {
          const el = document.elementFromPoint(x, y);
          return !!(el && (el === this || this.contains(el)));
        }`,
        arguments: [{ value: point.x }, { value: point.y }],
        returnByValue: true,
      });
      hitTarget = result?.value === true;
    } catch {}
  }

  if (!hitTarget && targetId) {
    // The element moved or is covered. A DOM click still activates it.
    try {
      await dbg.sendCommand("Runtime.callFunctionOn", {
        objectId: targetId,
        functionDeclaration: `function() { try { this.click(); } catch {} }`,
      });
      return settleAfterAction(wc, dbg, beforeUrl);
    } catch {}
  }

  const clicks = Math.max(1, Math.min(Number(count) || 1, 2));
  await dbg.sendCommand("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: point.x, y: point.y, button: "none",
  });
  for (let i = 1; i <= clicks; i += 1) {
    await dbg.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: i,
    });
    await dbg.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: i,
    });
  }
  return settleAfterAction(wc, dbg, beforeUrl);
}

const KEY_MAP = {
  Enter: { key: "Enter", code: "Enter", vk: 13 },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 },
  PageUp: { key: "PageUp", code: "PageUp", vk: 33 },
  PageDown: { key: "PageDown", code: "PageDown", vk: 34 },
  Space: { key: " ", code: "Space", vk: 32, text: " " },
};

function keyDefinition(key) {
  if (KEY_MAP[key]) return KEY_MAP[key];
  if (typeof key === "string" && key.length === 1) {
    const upper = key.toUpperCase();
    return { key, code: /[A-Z]/.test(upper) ? `Key${upper}` : "", vk: upper.charCodeAt(0), text: key };
  }
  throw new Error(`Unsupported key "${key}". Try Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown or Space.`);
}

async function pressKey(wc, key) {
  const dbg = await debuggerFor(wc);
  try { wc.focus(); } catch {}
  let beforeUrl = "";
  try { beforeUrl = wc.getURL() || ""; } catch {}
  const def = keyDefinition(key);

  // Electron's sendInputEvent goes through the same native path as a real
  // keyboard. Prefer it: CDP key events are dropped when the webview has not
  // received a mouse click yet (no RenderWidget keyboard focus).
  const nativeCode = def.key === " " ? "Space" : def.key;
  let nativeSent = false;
  try {
    // Let the focus message reach the renderer before injecting keys.
    await new Promise((resolve) => setTimeout(resolve, 80));
    wc.sendInputEvent({ type: "keyDown", keyCode: nativeCode });
    if (def.text) wc.sendInputEvent({ type: "char", keyCode: def.text });
    wc.sendInputEvent({ type: "keyUp", keyCode: nativeCode });
    nativeSent = true;
  } catch {}

  if (!nativeSent) {
    const base = {
      key: def.key,
      code: def.code,
      windowsVirtualKeyCode: def.vk,
      nativeVirtualKeyCode: def.vk,
    };
    await dbg.sendCommand("Input.dispatchKeyEvent", {
      type: def.text ? "keyDown" : "rawKeyDown",
      ...base,
      ...(def.text ? { text: def.text } : {}),
    });
    await dbg.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
  // Enter commonly submits a form; give that navigation a moment to start.
  if (def.key === "Enter") return settleAfterAction(wc, dbg, beforeUrl, 1200);
  return pageInfo(wc);
}

async function focusValue(dbg) {
  const { result } = await dbg.sendCommand("Runtime.evaluate", {
    expression: `(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName,
        value: "value" in el ? String(el.value) : String(el.innerText ?? el.textContent ?? ""),
      };
    })()`,
    returnByValue: true,
  });
  return result?.value || null;
}

async function selectFocusedText(dbg) {
  await dbg.sendCommand("Runtime.evaluate", {
    expression: `(() => {
      const el = document.activeElement;
      if (!el) return false;
      if (typeof el.setSelectionRange === "function" && el.value != null) {
        try { el.setSelectionRange(0, el.value.length); return true; } catch {}
      }
      if (el.isContentEditable) {
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        } catch {}
      }
      try { el.select(); return true; } catch {}
      return false;
    })()`,
    returnByValue: true,
  });
}

function charDefinition(ch) {
  const upper = ch.toUpperCase();
  if (/^[A-Z]$/.test(upper)) {
    return { key: ch, code: `Key${upper}`, vk: upper.charCodeAt(0) };
  }
  if (/^[0-9]$/.test(ch)) {
    return { key: ch, code: `Digit${ch}`, vk: ch.charCodeAt(0) };
  }
  if (ch === " ") {
    return { key: " ", code: "Space", vk: 32 };
  }
  return { key: ch, code: "", vk: 0 };
}

async function typeText(dbg, text) {
  for (const ch of String(text)) {
    if (ch === "\n") {
      await dbg.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r",
      });
      await dbg.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      continue;
    }
    const def = charDefinition(ch);
    const base = { ...def, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk };
    await dbg.sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown", ...base, text: ch, unmodifiedText: ch,
    });
    await dbg.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
}

async function setFocusedValue(dbg, text, clear) {
  await dbg.sendCommand("Runtime.evaluate", {
    expression: `(() => {
      const el = document.activeElement;
      if (!el) return false;
      const typed = ${JSON.stringify(String(text ?? ""))};
      if ("value" in el) {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        const next = ${Boolean(clear)} ? typed : String(el.value ?? "") + typed;
        if (setter) setter.call(el, next); else el.value = next;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      if (el.isContentEditable) {
        if (${Boolean(clear)}) {
          try { document.execCommand("selectAll", false, null); } catch {}
        }
        let ok = false;
        try { ok = document.execCommand("insertText", false, typed); } catch {}
        if (!ok) {
          el.textContent = ${Boolean(clear)} ? typed : String(el.textContent ?? "") + typed;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return true;
      }
      return false;
    })()`,
    returnByValue: true,
  });
}

async function typeInto(wc, ref, text, clear) {
  const backendNodeId = stateFor(wc).refs.get(ref);
  if (!backendNodeId) throw new Error(`Unknown ref "${ref}". Call browser snapshot again.`);
  const dbg = await debuggerFor(wc);
  try { wc.focus(); } catch {}

  // Click the field with a real mouse event first. DOM.focus alone changes
  // document.activeElement but does not give the webview keyboard focus, so
  // synthesized keystrokes would be dropped on a freshly opened page.
  const objectId = await resolveObject(dbg, backendNodeId);
  const focusId = objectId ? await clickableObject(dbg, objectId) : null;
  if (focusId) {
    try {
      await dbg.sendCommand("Runtime.callFunctionOn", {
        objectId: focusId,
        functionDeclaration: `function() { try { this.scrollIntoView({ block: "center", inline: "center" }); } catch {} }`,
      });
      const { model } = await dbg.sendCommand("DOM.getBoxModel", { objectId: focusId });
      const point = centerOf(model);
      if (point) {
        await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
        await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
        await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
      }
    } catch {}
  }

  try { await dbg.sendCommand("DOM.scrollIntoViewIfNeeded", { backendNodeId }); } catch {}
  await dbg.sendCommand("DOM.focus", { backendNodeId });

  if (clear) await selectFocusedText(dbg);

  const before = await focusValue(dbg);
  await typeText(dbg, text);
  const after = await focusValue(dbg);

  // If the page ignored synthesized keys (or the ref was an editable element
  // without keyboard focus), set the value directly and keep input/change
  // events intact for framework-controlled fields.
  if (after && before && after.value === before.value) {
    await setFocusedValue(dbg, text, clear);
  }
  return pageInfo(wc);
}

async function scrollState(dbg) {
  try {
    const { result } = await dbg.sendCommand("Runtime.evaluate", {
      expression: `(() => {
        const se = document.scrollingElement || document.documentElement;
        let node = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
        let nested = null;
        while (node && node !== document.body && node !== document.documentElement) {
          const cs = getComputedStyle(node);
          if (/(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) {
            nested = node;
            break;
          }
          node = node.parentElement;
        }
        return {
          x: se ? se.scrollLeft : 0,
          y: se ? se.scrollTop : 0,
          nx: nested ? nested.scrollLeft : null,
          ny: nested ? nested.scrollTop : null,
        };
      })()`,
      returnByValue: true,
    });
    return result?.value || { x: 0, y: 0 };
  } catch {
    return { x: 0, y: 0 };
  }
}

function scrollMoved(before, after) {
  if ((after.x || 0) !== (before.x || 0) || (after.y || 0) !== (before.y || 0)) return true;
  return (after.nx || 0) !== (before.nx || 0) || (after.ny || 0) !== (before.ny || 0);
}

async function scrollPage(wc, deltaX, deltaY) {
  const dbg = await debuggerFor(wc);
  const dx = Number(deltaX) || 0;
  const dy = Number(deltaY) || 0;
  try { wc.focus(); } catch {}

  const metrics = await dbg.sendCommand("Page.getLayoutMetrics");
  const viewport = metrics.cssLayoutViewport || metrics.layoutViewport || {};
  const x = Math.round((viewport.clientWidth || 800) / 2);
  const y = Math.round((viewport.clientHeight || 600) * 0.6);
  const before = await scrollState(dbg);

  // synthesizeScrollGesture mirrors a real trackpad/wheel gesture, including
  // picking the scroll container under the pointer. Fall back to a raw wheel
  // event for Chromium builds that do not implement the gesture command.
  let gestured = false;
  try {
    await dbg.sendCommand("Input.synthesizeScrollGesture", {
      x, y,
      xDistance: -dx,
      yDistance: -dy,
      speed: 800,
      gestureSourceType: "mouse",
    });
    gestured = true;
  } catch {}
  if (!gestured) {
    await dbg.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseWheel", x, y, deltaX: dx, deltaY: dy,
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 250));

  // Some pages (fixed layouts, canvas apps, text fields under the pointer)
  // swallow wheel events. Scrolling the DOM directly keeps the tool useful.
  if (!scrollMoved(before, await scrollState(dbg))) {
    await dbg.sendCommand("Runtime.evaluate", {
      expression: `(() => {
        let node = document.elementFromPoint(${x}, ${y});
        while (node && node !== document.body && node !== document.documentElement) {
          const cs = getComputedStyle(node);
          if (/(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) {
            node.scrollBy(${dx}, ${dy});
            return true;
          }
          node = node.parentElement;
        }
        window.scrollBy(${dx}, ${dy});
        return true;
      })()`,
      returnByValue: true,
    });
  }
  return pageInfo(wc);
}

async function captureScreenshot(wc, fullPage) {
  const dbg = await debuggerFor(wc);
  const { data } = await dbg.sendCommand("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: Boolean(fullPage),
  });
  if (!data) throw new Error("The browser panel returned an empty screenshot.");
  return data;
}

async function waitForNavigation(wc, beforeUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let changed = false;
  while (Date.now() < deadline) {
    const current = safeUrl(wc);
    if (current && current !== beforeUrl) changed = true;
    try {
      const info = await pageInfo(wc);
      if (changed && info.readyState === "complete") return info;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return pageInfo(wc).catch(() => ({ url: safeUrl(wc), title: wc.getTitle(), readyState: null }));
}

async function history(wc, delta) {
  stateFor(wc).refs.clear();
  const beforeUrl = safeUrl(wc);
  let moved = false;
  try {
    if (delta < 0) {
      if (!wc.canGoBack()) return pageInfo(wc);
      wc.goBack();
      moved = true;
    } else {
      if (!wc.canGoForward()) return pageInfo(wc);
      wc.goForward();
      moved = true;
    }
  } catch {}
  if (!moved) {
    // Fall back to the protocol for builds without the navigation helpers.
    const dbg = await debuggerFor(wc);
    const entries = await dbg.sendCommand("Page.getNavigationHistory");
    const entry = entries?.entries?.[entries.currentIndex + delta];
    if (!entry) return pageInfo(wc);
    await dbg.sendCommand("Page.navigateToHistoryEntry", { entryId: entry.id });
  }
  return waitForNavigation(wc, beforeUrl);
}

async function reload(wc) {
  stateFor(wc).refs.clear();
  const beforeUrl = safeUrl(wc);
  try {
    // Use Electron's own reload path. CDP Page.reload can tear down the
    // webview's target in ways that destabilise the host renderer.
    wc.reload();
  } catch (err) {
    if (!beforeUrl) throw err;
    await wc.loadURL(beforeUrl);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const info = await pageInfo(wc);
      if (info.readyState === "complete" && (!safeUrl(wc) || safeUrl(wc) === beforeUrl || !beforeUrl)) return info;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return pageInfo(wc).catch(() => ({ url: safeUrl(wc), title: wc.getTitle(), readyState: null }));
}

async function evaluate(wc, expression) {
  const dbg = await debuggerFor(wc);
  const { result, exceptionDetails } = await dbg.sendCommand("Runtime.evaluate", {
    expression: String(expression ?? ""),
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || "Evaluation failed");
  }
  return result?.value === undefined ? null : result.value;
}

async function waitFor(wc, options) {
  const dbg = await debuggerFor(wc);
  const timeoutMs = Math.max(500, Math.min(Number(options.timeoutMs) || 10000, 60000));
  const deadline = Date.now() + timeoutMs;
  const selector = options.selector ? String(options.selector) : "";
  const text = options.text ? String(options.text) : "";
  if (!selector && !text) throw new Error("Pass either selector or text to browser_wait.");
  const expression = selector
    ? `Boolean(document.querySelector(${JSON.stringify(selector)}))`
    : `Boolean(document.body && document.body.innerText.includes(${JSON.stringify(text)}))`;

  while (Date.now() < deadline) {
    const { result } = await dbg.sendCommand("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    if (result?.value === true) return { found: true, ...(await pageInfo(wc)) };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${selector ? `selector ${selector}` : `text ${JSON.stringify(text)}`}.`);
}

function listTabs() {
  return browserRegistry.list();
}

// --- Network inspection ------------------------------------------------

function networkList(wc, limit) {
  const cap = Math.max(1, Math.min(Number(limit) || 50, MAX_NETWORK_ENTRIES));
  const entries = [...stateFor(wc).network.requests.values()];
  const out = entries.slice(-cap).map((e) => ({
    id: e.id,
    method: e.method,
    url: e.url.length > 200 ? e.url.slice(0, 200) + "..." : e.url,
    status: e.failed ? "FAILED" : e.status || "pending",
    type: e.type,
    mimeType: e.mimeType || "",
    fromCache: e.fromCache || undefined,
    bytes: e.encodedDataLength || undefined,
    error: e.errorText || undefined,
  }));
  return { total: entries.length, shown: out.length, requests: out };
}

async function networkDetail(wc, requestId) {
  const entry = stateFor(wc).network.requests.get(String(requestId));
  if (!entry) throw new Error(`Unknown request id "${requestId}". Call browser network list first.`);
  const dbg = await debuggerFor(wc);
  let body = null;
  try {
    const res = await dbg.sendCommand("Network.getResponseBody", { requestId: entry.id });
    if (res.body) body = res.base64Encoded ? `<base64 ${Buffer.from(res.body, "base64").length} bytes>` : String(res.body).slice(0, 4000);
  } catch (err) {
    body = `<unavailable: ${err && err.message ? err.message : "no body"}>`;
  }
  return {
    id: entry.id,
    method: entry.method,
    url: entry.url,
    type: entry.type,
    status: entry.status,
    statusText: entry.statusText,
    mimeType: entry.mimeType,
    fromCache: entry.fromCache,
    remoteAddress: entry.remoteAddress,
    bytes: entry.encodedDataLength,
    failed: entry.failed || undefined,
    errorText: entry.errorText || undefined,
    headers: entry.headers || {},
    body,
  };
}

async function networkBlock(wc, urlPattern, unblock) {
  const state = stateFor(wc);
  const dbg = await debuggerFor(wc);
  let urls = state.network.blocked;
  if (unblock) {
    urls = urlPattern ? urls.filter((u) => u !== urlPattern) : [];
  } else if (urlPattern && !urls.includes(urlPattern)) {
    urls = [...urls, urlPattern];
  } else if (!urlPattern) {
    throw new Error("Pass urlPattern (e.g. https://example.com/ads/*) to block.");
  }
  await dbg.sendCommand("Network.setBlockedURLs", { urls });
  state.network.blocked = urls;
  return { blocked: urls };
}

async function networkClear(wc) {
  stateFor(wc).network.requests.clear();
  return { ok: true };
}

// --- Console -----------------------------------------------------------

function consoleLogs(wc, limit) {
  const entries = stateFor(wc).console;
  const cap = Math.max(1, Math.min(Number(limit) || 50, MAX_CONSOLE_ENTRIES));
  return { total: entries.length, shown: Math.min(cap, entries.length), entries: entries.slice(-cap) };
}

function consoleClear(wc) {
  const state = stateFor(wc);
  state.console.length = 0;
  try { debuggerFor(wc).then((dbg) => dbg.sendCommand("Runtime.discardConsoleEntries")); } catch {}
  return { ok: true };
}

// --- Cookies -----------------------------------------------------------

async function cookiesList(wc, url) {
  const dbg = await debuggerFor(wc);
  const res = await dbg.sendCommand("Network.getCookies", url ? { urls: [url] } : {});
  return (res.cookies || []).map((c) => ({
    name: c.name,
    value: String(c.value || "").slice(0, 200),
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly || undefined,
    secure: c.secure || undefined,
    session: c.session || undefined,
    sameSite: c.sameSite || undefined,
  }));
}

async function cookieSet(wc, { name, value, url, domain, path }) {
  if (!name || !value || !url) throw new Error("name, value and url are required to set a cookie.");
  const dbg = await debuggerFor(wc);
  const res = await dbg.sendCommand("Network.setCookie", {
    name, value, url,
    ...(domain ? { domain } : {}),
    ...(path ? { path } : {}),
  });
  return { ok: Boolean(res.success), url };
}

async function cookieClear(wc, { url, name }) {
  const dbg = await debuggerFor(wc);
  await dbg.sendCommand("Network.deleteCookies", {
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
  });
  return { ok: true };
}

// --- Local/session storage ---------------------------------------------

const STORAGE_EVAL = (type, op, key, value) => {
  const store = type === "session" ? "sessionStorage" : "localStorage";
  const k = JSON.stringify(key || "");
  const v = JSON.stringify(value ?? "");
  switch (op) {
    case "keys":
      return `(() => { try { const s = ${store}; return Array.from({ length: s.length }, (_, i) => s.key(i)); } catch (e) { return { error: String(e && e.message || e) }; } })()`;
    case "get":
      return `(() => { try { const s = ${store}; return s.getItem(${k}); } catch (e) { return { error: String(e && e.message || e) }; } })()`;
    case "set":
      return `(() => { try { const s = ${store}; s.setItem(${k}, ${v}); return true; } catch (e) { return { error: String(e && e.message || e) }; } })()`;
    case "clear":
      return `(() => { try { ${store}.clear(); return true; } catch (e) { return { error: String(e && e.message || e) }; } })()`;
    default:
      throw new Error(`Unknown storage op: ${op}`);
  }
};

async function storageAction(wc, { type, op, key, value }) {
  const dbg = await debuggerFor(wc);
  const { result, exceptionDetails } = await dbg.sendCommand("Runtime.evaluate", {
    expression: STORAGE_EVAL(type, op, key, value),
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || "Storage access failed");
  const v = result?.value;
  if (v && typeof v === "object" && v.error) throw new Error(`Storage access failed: ${v.error}`);
  return op === "get" ? { key, value: v } : op === "keys" ? { keys: v } : { ok: true };
}

// --- Performance tracing ------------------------------------------------

async function traceStart(wc, categories) {
  const state = stateFor(wc);
  const dbg = await debuggerFor(wc);
  if (state.trace) return { alreadyRunning: true };
  state.trace = [];
  await dbg.sendCommand("Tracing.start", {
    categories: String(categories || "devtools.timeline"),
    transferMode: "ReportEvents",
  });
  return { running: true, categories: String(categories || "devtools.timeline") };
}

async function traceStop(wc) {
  const state = stateFor(wc);
  const dbg = await debuggerFor(wc);
  if (!state.trace) throw new Error("No trace is running. Call browser trace start first.");
  const events = state.trace;
  state.trace = null;
  await dbg.sendCommand("Tracing.end").catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
  const file = path.join(os.tmpdir(), `idiotbox-trace-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ traceEvents: events }));
  return { file, events: events.length };
}

async function metricsList(wc) {
  const dbg = await debuggerFor(wc);
  const res = await dbg.sendCommand("Performance.getMetrics");
  return (res.metrics || []).map((m) => ({ name: m.name, value: m.value }));
}

// --- Device emulation ----------------------------------------------------

async function deviceSet(wc, { width, height, deviceScaleFactor, mobile }) {
  const dbg = await debuggerFor(wc);
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);
  if (w < 200 || h < 200) throw new Error("width and height (>=200) are required for device emulation.");
  await dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: Number(deviceScaleFactor) || 1,
    mobile: Boolean(mobile),
  });
  return { width: w, height: h, deviceScaleFactor: Number(deviceScaleFactor) || 1, mobile: Boolean(mobile) };
}

async function deviceClear(wc) {
  const dbg = await debuggerFor(wc);
  await dbg.sendCommand("Emulation.clearDeviceMetricsOverride");
  return { ok: true };
}

function safeUrl(wc) {
  try { return wc.getURL() || ""; } catch { return ""; }
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "");
    // http and https count as the same target: many sites redirect between them.
    return `${host}${pathname}${u.search}`.toLowerCase();
  } catch {
    return raw.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function urlsMatch(requested, current) {
  const a = normalizeUrl(requested);
  const b = normalizeUrl(current);
  return Boolean(a && b && a === b);
}

async function openBrowser(openTab, url, listTabs) {
  const before = new Set(browserGuests().map((wc) => wc.id));
  let beforeTabIds = new Set();
  try {
    const tabs = await listTabs();
    if (Array.isArray(tabs)) beforeTabIds = new Set(tabs.map((t) => t.id));
  } catch {}

  const startedAt = Date.now();
  const deadline = startedAt + 15000;
  let lastAttemptAt = startedAt;
  let fresh = null;

  try { await openTab({ type: "browser", url: url || undefined }); } catch {}
  lastAttemptAt = Date.now();

  while (Date.now() < deadline) {
    const all = browserGuests();
    const freshGuests = all.filter((wc) => !before.has(wc.id));
    if (freshGuests.length) fresh = freshGuests[freshGuests.length - 1];

    // Exact URL match wins, even if the panel existed before this call. Sites
    // often redirect (http→https, www), so compare host/path/query only.
    const matching = url ? all.find((wc) => urlsMatch(url, safeUrl(wc))) : fresh;
    if (matching) {
      try {
        await waitForReady(matching, 8000);
        const info = await pageInfo(matching);
        if (!url || info.readyState === "complete") return { id: matching.id, ...info };
      } catch {}
    }

    // Right after a project opens the workspace may restore a browser panel
    // just after openBrowser starts. If no tab was created for us, drive that
    // restored panel to the requested URL instead of failing or duplicating it.
    if (fresh && url && Date.now() - startedAt > 4000) {
      if (!urlsMatch(url, safeUrl(fresh))) {
        try { await fresh.loadURL(url); } catch {}
      }
      try {
        await waitForReady(fresh, 8000);
        const info = await pageInfo(fresh);
        return { id: fresh.id, ...info };
      } catch {
        return { id: fresh.id, url: safeUrl(fresh), title: fresh.getTitle() };
      }
    }

    // Retry only when no new browser tab appeared: an event dispatched before
    // the workspace mounted is dropped, while a successful dispatch must not be
    // repeated (that would open duplicate tabs).
    if (Date.now() - lastAttemptAt > 2000) {
      lastAttemptAt = Date.now();
      let hasNewBrowserTab = false;
      try {
        const tabs = await listTabs();
        hasNewBrowserTab = Array.isArray(tabs) && tabs.some(
          (t) => t.component === "panel3" && !beforeTabIds.has(t.id)
        );
      } catch {}
      if (!hasNewBrowserTab) {
        try { await openTab({ type: "browser", url: url || undefined }); } catch {}
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (fresh) {
    if (url && !urlsMatch(url, safeUrl(fresh))) {
      try { await fresh.loadURL(url); } catch {}
      try { await waitForReady(fresh, 5000); } catch {}
    }
    const info = await pageInfo(fresh).catch(() => null);
    return info
      ? { id: fresh.id, ...info }
      : { id: fresh.id, url: safeUrl(fresh), title: fresh.getTitle() };
  }
  const all = browserGuests();
  if (all.length) {
    const wc = all[all.length - 1];
    const info = await pageInfo(wc).catch(() => null);
    return info
      ? { id: wc.id, ...info }
      : { id: wc.id, url: safeUrl(wc), title: wc.getTitle() };
  }
  throw new Error("The browser panel did not open. Make sure a project is open, then try again.");
}

function registerBrowserTools(server, helpers) {
  const { z, call, ok, fail } = helpers;
  if (!server || !z || !call || !ok || !fail) throw new Error("browser tool helpers are incomplete");

  // One grouped tool instead of 15: the action enum + shared fields cost far
  // fewer schema tokens than 15 near-duplicate schemas, while the internal
  // snapshot/click/type workflow is unchanged.
  server.registerTool("browser", {
    description: "Browser panel: action open|tabs|navigate|read|snapshot|click|type|press|scroll|screenshot|eval|wait|back|forward|reload|network|console|cookies|storage|trace|metrics|device. Workflow: open -> snapshot (refs e1..) -> click/type ref. Refs expire after navigation/snapshot. Read/snapshot capped (maxChars 8000, maxNodes 120). tab=panel id (omit for focused). network: op list|detail(reqId)|clear|block(urlPattern)|unblock. console: op logs|clear. cookies: op list|set(name,value,url)|clear(name?,url?). storage: op keys|get|set|clear with type local|session and key/value. trace: op start|stop (stop saves JSON to tmp). device: op set(width,height,deviceScaleFactor,mobile)|clear. metrics: no op.",
    inputSchema: {
      action: z.enum(["open", "tabs", "navigate", "read", "snapshot", "click", "type", "press", "scroll", "screenshot", "eval", "wait", "back", "forward", "reload", "network", "console", "cookies", "storage", "trace", "metrics", "device"]),
      url: z.string().optional(), tab: z.number().optional(),
      maxChars: z.number().optional(), maxNodes: z.number().optional(),
      ref: z.string().optional(), count: z.number().optional(),
      text: z.string().optional(), clear: z.boolean().optional(),
      key: z.string().optional(),
      deltaX: z.number().optional(), deltaY: z.number().optional(),
      fullPage: z.boolean().optional(),
      expression: z.string().optional(),
      selector: z.string().optional(), timeoutMs: z.number().optional(),
      op: z.enum(["list", "detail", "clear", "block", "unblock", "logs", "keys", "get", "set", "start", "stop"]).optional(),
      reqId: z.string().optional(), urlPattern: z.string().optional(),
      name: z.string().optional(), value: z.string().optional(),
      type: z.enum(["local", "session"]).optional(),
      domain: z.string().optional(), path: z.string().optional(),
      width: z.number().optional(), height: z.number().optional(),
      deviceScaleFactor: z.number().optional(), mobile: z.boolean().optional(),
      limit: z.number().optional(), categories: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async (a) => {
    const { action, url, tab: tabId, maxChars, maxNodes, ref, count, text, clear, key, deltaX, deltaY, fullPage, expression, selector, timeoutMs, op, reqId, urlPattern, name, value, type, domain, path, width, height, deviceScaleFactor, mobile, limit, categories } = a || {};
    try {
      switch (action) {
        case "open": {
          if (url && url !== "about:blank" && !/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs and about:blank are supported.");
          return ok(await openBrowser((options) => call("tabs:open", options), url, () => call("tabs:list")));
        }
        case "tabs": return ok({ tabs: listTabs() });
        case "navigate": {
          if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs are supported.");
          return ok(await navigate(needGuest(tabId), url));
        }
        case "read": return ok(await readPage(needGuest(tabId), maxChars));
        case "snapshot": return ok(await snapshot(needGuest(tabId), maxNodes));
        case "click": return ok(await clickRef(needGuest(tabId), ref, count));
        case "type": return ok(await typeInto(needGuest(tabId), ref, text, clear));
        case "press": return ok(await pressKey(needGuest(tabId), key));
        case "scroll": return ok(await scrollPage(needGuest(tabId), deltaX, deltaY ?? 600));
        case "screenshot": {
          const wc = needGuest(tabId);
          const data = await captureScreenshot(wc, fullPage);
          const file = path.join(os.tmpdir(), `idiotbox-browser-${Date.now()}.png`);
          fs.writeFileSync(file, Buffer.from(data, "base64"));
          return {
            content: [
              { type: "text", text: `Screenshot saved to ${file}` },
              { type: "image", data, mimeType: "image/png" },
            ],
          };
        }
        case "eval": return ok(await evaluate(needGuest(tabId), expression));
        case "wait": return ok(await waitFor(needGuest(tabId), { selector, text, timeoutMs }));
        case "back": return ok(await history(needGuest(tabId), -1));
        case "forward": return ok(await history(needGuest(tabId), 1));
        case "reload": return ok(await reload(needGuest(tabId)));
        case "network": {
          const wc = needGuest(tabId);
          switch (op) {
            case "detail": return ok(await networkDetail(wc, reqId));
            case "clear": return ok(await networkClear(wc));
            case "block": return ok(await networkBlock(wc, urlPattern, false));
            case "unblock": return ok(await networkBlock(wc, urlPattern, true));
            default: return ok(networkList(wc, limit));
          }
        }
        case "console": {
          const wc = needGuest(tabId);
          return ok(op === "clear" ? await consoleClear(wc) : consoleLogs(wc, limit));
        }
        case "cookies": {
          const wc = needGuest(tabId);
          switch (op) {
            case "set": return ok(await cookieSet(wc, { name, value, url, domain, path }));
            case "clear": return ok(await cookieClear(wc, { url, name }));
            default: return ok(await cookiesList(wc, url));
          }
        }
        case "storage": {
          const wc = needGuest(tabId);
          if (!["keys", "get", "set", "clear"].includes(op)) throw new Error("storage needs op keys|get|set|clear and type local|session.");
          return ok(await storageAction(wc, { type: type || "local", op, key, value }));
        }
        case "trace": {
          const wc = needGuest(tabId);
          return ok(op === "stop" ? await traceStop(wc) : await traceStart(wc, categories));
        }
        case "metrics": return ok(await metricsList(needGuest(tabId)));
        case "device": {
          const wc = needGuest(tabId);
          return ok(op === "clear" ? await deviceClear(wc) : await deviceSet(wc, { width, height, deviceScaleFactor, mobile }));
        }
        default: throw new Error(`Unknown browser action: ${action}`);
      }
    } catch (err) { return fail(err); }
  });
}

module.exports = { registerBrowserTools };
