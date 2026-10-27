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

function stateFor(wc) {
  let state = states.get(wc);
  if (!state) {
    state = { refs: new Map(), enabled: false };
    states.set(wc, state);
  }
  return state;
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
    if (!found) throw new Error(`No browser panel with webContents id ${tabId}. Call browser_tabs.`);
    return found;
  }
  return browserRegistry.pick();
}

function needGuest(tabId) {
  const wc = pickGuest(tabId);
  if (!wc) {
    throw new Error("No browser panel is open. Call browser_open (or tab_open with tabType 'browser') first.");
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
  return dbg;
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
  const limit = Math.max(1000, Math.min(Number(maxChars) || 30000, 100000));
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
  const limit = Math.max(10, Math.min(Number(maxNodes) || 400, 1000));
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
    ...info,
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
  if (!backendNodeId) throw new Error(`Unknown ref "${ref}". Call browser_snapshot again.`);
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
  if (!backendNodeId) throw new Error(`Unknown ref "${ref}". Call browser_snapshot again.`);
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
  const { z, tool, call } = helpers;
  if (!server || !z || !tool || !call) throw new Error("browser tool helpers are incomplete");

  const readOnly = { readOnlyHint: true, destructiveHint: false };
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
  const risky = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
  const tab = z.number().int().positive().optional()
    .describe("Browser panel webContents id from browser_tabs. Omit to use the focused/last panel.");

  tool(server, "browser_open", {
    title: "Open browser panel",
    description: "Open a browser tab in the Idiot Box browser panel and optionally navigate it. Returns the panel's webContents id.",
    inputSchema: {
      url: z.string().optional().describe("Optional http(s) URL or about:blank"),
    },
    annotations: write,
  }, async ({ url }) => {
    if (url && url !== "about:blank" && !/^https?:\/\//i.test(url)) {
      throw new Error("Only http(s) URLs and about:blank are supported.");
    }
    return openBrowser((options) => call("tabs:open", options), url, () => call("tabs:list"));
  });

  tool(server, "browser_tabs", {
    title: "List browser panels",
    description: "List open browser panels with their webContents id, URL, title and focus state.",
    inputSchema: {},
    annotations: readOnly,
  }, async () => ({ tabs: listTabs() }));

  tool(server, "browser_navigate", {
    title: "Navigate browser",
    description: "Navigate a browser panel to an http(s) URL and wait for the page load.",
    inputSchema: {
      url: z.string().describe("http(s) URL"),
      tab,
    },
    annotations: write,
  }, async ({ url, tab: tabId }) => {
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs are supported.");
    return navigate(needGuest(tabId), url);
  });

  tool(server, "browser_read", {
    title: "Read page",
    description: "Read the current page title, URL and visible text from a browser panel.",
    inputSchema: {
      tab,
      maxChars: z.number().int().min(1000).max(100000).default(30000)
        .describe("Maximum characters of page text to return."),
    },
    annotations: readOnly,
  }, async ({ tab: tabId, maxChars }) => readPage(needGuest(tabId), maxChars));

  tool(server, "browser_snapshot", {
    title: "Snapshot page",
    description: "Return an accessibility snapshot of clickable and readable elements with short refs for browser_click and browser_type. Refs expire after navigation or a new snapshot.",
    inputSchema: {
      tab,
      maxNodes: z.number().int().min(10).max(1000).default(400)
        .describe("Maximum number of elements to return."),
    },
    annotations: readOnly,
  }, async ({ tab: tabId, maxNodes }) => snapshot(needGuest(tabId), maxNodes));

  tool(server, "browser_click", {
    title: "Click element",
    description: "Click an element by its browser_snapshot ref. Uses real mouse events in the browser panel.",
    inputSchema: {
      ref: z.string().describe("Element ref from browser_snapshot, for example e12"),
      count: z.number().int().min(1).max(2).default(1).describe("1 for a click, 2 for a double click."),
      tab,
    },
    annotations: write,
  }, async ({ ref, count, tab: tabId }) => clickRef(needGuest(tabId), ref, count));

  tool(server, "browser_type", {
    title: "Type into element",
    description: "Focus an element by browser_snapshot ref and type text into it. Set clear=true to replace its current value.",
    inputSchema: {
      ref: z.string().describe("Element ref from browser_snapshot, for example e3"),
      text: z.string().describe("Text to type"),
      clear: z.boolean().default(false).describe("Select all existing text first."),
      tab,
    },
    annotations: write,
  }, async ({ ref, text, clear, tab: tabId }) => typeInto(needGuest(tabId), ref, text, clear));

  tool(server, "browser_press", {
    title: "Press key",
    description: "Press a named key in the focused browser panel, for example Enter, Tab, Escape, ArrowDown or Space.",
    inputSchema: {
      key: z.string().describe("Key name"),
      tab,
    },
    annotations: write,
  }, async ({ key, tab: tabId }) => pressKey(needGuest(tabId), key));

  tool(server, "browser_scroll", {
    title: "Scroll page",
    description: "Scroll the browser panel by a pixel delta. Positive deltaY scrolls down.",
    inputSchema: {
      deltaX: z.number().int().default(0),
      deltaY: z.number().int().default(600),
      tab,
    },
    annotations: write,
  }, async ({ deltaX, deltaY, tab: tabId }) => scrollPage(needGuest(tabId), deltaX, deltaY));

  server.registerTool("browser_screenshot", {
    title: "Browser screenshot",
    description: "Capture the browser panel as a PNG image. Also returns the saved server-local path.",
    inputSchema: {
      fullPage: z.boolean().default(false).describe("Capture the full page instead of the viewport."),
      tab,
    },
    annotations: readOnly,
  }, async ({ fullPage, tab: tabId }) => {
    try {
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
    } catch (err) {
      return { content: [{ type: "text", text: String(err?.message || err) }], isError: true };
    }
  });

  tool(server, "browser_eval", {
    title: "Evaluate JavaScript",
    description: "Evaluate a JavaScript expression in the current page and return its value. Use browser_snapshot and browser_read for normal work.",
    inputSchema: {
      expression: z.string().describe("JavaScript expression to evaluate"),
      tab,
    },
    annotations: risky,
  }, async ({ expression, tab: tabId }) => evaluate(needGuest(tabId), expression));

  tool(server, "browser_wait", {
    title: "Wait for page content",
    description: "Wait until a CSS selector exists or the page text contains a string.",
    inputSchema: {
      selector: z.string().optional().describe("CSS selector to wait for"),
      text: z.string().optional().describe("Text to wait for"),
      timeoutMs: z.number().int().min(500).max(60000).default(10000),
      tab,
    },
    annotations: readOnly,
  }, async ({ selector, text, timeoutMs, tab: tabId }) => waitFor(needGuest(tabId), { selector, text, timeoutMs }));

  tool(server, "browser_back", {
    title: "Go back",
    description: "Go back in the browser panel's history.",
    inputSchema: { tab },
    annotations: write,
  }, async ({ tab: tabId }) => history(needGuest(tabId), -1));

  tool(server, "browser_forward", {
    title: "Go forward",
    description: "Go forward in the browser panel's history.",
    inputSchema: { tab },
    annotations: write,
  }, async ({ tab: tabId }) => history(needGuest(tabId), 1));

  tool(server, "browser_reload", {
    title: "Reload page",
    description: "Reload the browser panel.",
    inputSchema: { tab },
    annotations: write,
  }, async ({ tab: tabId }) => reload(needGuest(tabId)));
}

module.exports = { registerBrowserTools };
