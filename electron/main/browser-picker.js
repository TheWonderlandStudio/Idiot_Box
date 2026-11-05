"use strict";

const { ipcMain } = require("electron");
const browserRegistry = require("./browser-registry");

const pending = new Map();
const highlightConfig = {
  showInfo: true,
  contentColor: { r: 66, g: 153, b: 225, a: 0.35 },
  paddingColor: { r: 106, g: 168, b: 79, a: 0.35 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.5 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.35 },
};

// Serialized and run on the selected DOM node in the guest. The result is
// untrusted and is sanitized again before being displayed in Component Preview.
function captureElement() {
  const root = this.nodeType === 1 ? this : this.parentElement;
  if (!root) return null;
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const snapshot = doc.implementation.createHTMLDocument("");
  const styles = [
    "display", "position", "inset", "z-index", "box-sizing", "width", "height",
    "min-width", "min-height", "max-width", "max-height", "overflow",
    "margin", "padding", "border", "border-radius", "box-shadow", "opacity",
    "background", "color", "font", "letter-spacing", "line-height", "white-space",
    "text-align", "text-decoration", "text-transform", "text-shadow",
    "flex", "flex-flow", "align-items", "align-self", "align-content", "justify-content",
    "justify-items", "justify-self", "gap", "grid-template", "grid-area",
    "object-fit", "object-position", "transform", "vertical-align",
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
  ];
  const skipped = new Set(["script", "style", "link", "meta", "base", "template", "iframe", "object", "embed"]);
  let nodes = 0;
  let characters = 0;
  function clone(node, depth = 0) {
    if (++nodes > 500 || depth > 60 || characters > 500_000) return null;
    if (node.nodeType === 3) {
      const value = node.textContent.slice(0, 20_000);
      characters += value.length;
      return snapshot.createTextNode(value);
    }
    if (node.nodeType !== 1 || skipped.has(node.localName)) return null;

    const copy = /^(html|body)$/i.test(node.localName) ? snapshot.createElement("div") : snapshot.importNode(node, false);
    for (const attr of copy.getAttributeNames()) {
      if (/^(?:on|src|href|xlink:href|autofocus|action|formaction|ping|is)/i.test(attr)) {
        copy.removeAttribute(attr);
      }
    }
    copy.removeAttribute("style");
    if (node.localName === "img" && /^(?:https?:|data:image\/|ibx-file:)/i.test(node.currentSrc || node.src)) {
      copy.setAttribute("src", node.currentSrc || node.src);
      copy.setAttribute("referrerpolicy", "no-referrer");
    }
    const computed = view.getComputedStyle(node);
    for (const property of styles) {
      const value = computed.getPropertyValue(property);
      // Preserve regular paints and gradients. URLs in CSS can trigger requests.
      if (value.length < 4000 && !/url\s*\(/i.test(value)) copy.style.setProperty(property, value);
    }
    if (node === root) {
      copy.style.position = "relative";
      copy.style.inset = "auto";
      copy.style.margin = "0";
    }
    characters += copy.outerHTML.length;
    // Avoid moving a subtree out of its original tree during capture.
    const children = node.shadowRoot?.childNodes || node.childNodes;
    for (const child of children) {
      if (nodes >= 500 || characters > 500_000) break;
      const childCopy = clone(child, depth + 1);
      if (childCopy) copy.appendChild(childCopy);
    }
    return copy;
  }
  const copy = clone(root);
  if (!copy) return null;
  const label = root.localName + (root.id ? "#" + root.id : "");
  return { label: label.slice(0, 90), html: copy.outerHTML, truncated: nodes >= 500 || characters > 500_000 };
}

function pickElement(wc, owner, requestId) {
  return new Promise((resolve) => {
    const guestId = wc.id;
    const dbg = wc.debugger;
    const subscriptions = [];
    let active = true;
    let capturing = false;
    let attachedHere = false;
    let overlay = false;
    let openTimer;
    const listen = (target, name, callback) => {
      target.on(name, callback);
      subscriptions.push(() => target.removeListener(name, callback));
    };
    const command = (method, params = {}) => dbg.sendCommand(method, params);
    const cancel = () => finish({ canceled: true });
    const fail = (error) => finish({ error });
    const session = { owner, requestId, cancel };
    const finish = async (result) => {
      if (!active) return;
      active = false;
      clearTimeout(openTimer);
      for (const unsubscribe of subscriptions) unsubscribe();
      try {
        if (dbg.isAttached() && overlay) await command("Overlay.setInspectMode", { mode: "none" });
      } catch {}
      try { if (attachedHere && dbg.isAttached()) dbg.detach(); } catch {}
      if (pending.get(guestId) === session) pending.delete(guestId);
      resolve(result);
    };
    pending.set(guestId, session);

    listen(wc, "destroyed", cancel);
    listen(wc, "devtools-closed", cancel);
    listen(wc, "render-process-gone", cancel);
    listen(wc, "did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) cancel();
    });
    listen(owner, "destroyed", cancel);
    listen(owner, "did-start-navigation", (_event, _url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace) cancel();
    });
    listen(dbg, "detach", cancel);
    listen(dbg, "message", async (_event, method, params) => {
      if (method === "Overlay.inspectModeCanceled") return cancel();
      if (method !== "Overlay.inspectNodeRequested" || !active || capturing) return;
      capturing = true;
      const objectGroup = "component-preview-picker";
      try {
        const { object } = await command("DOM.resolveNode", { backendNodeId: params.backendNodeId, objectGroup });
        if (!active) return;
        const { result, exceptionDetails } = await command("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: captureElement.toString(),
          returnByValue: true,
        });
        const element = result?.value;
        if (exceptionDetails || typeof element?.html !== "string" || !element.html || element.html.length > 1_000_000) {
          return fail("This element couldn't be previewed. Try selecting a smaller element.");
        }
        finish({ element });
      } catch {
        fail("The selected element is no longer available. Try selecting it again.");
      } finally {
        command("Runtime.releaseObjectGroup", { objectGroup }).catch(() => {});
      }
    });

    const arm = async () => {
      clearTimeout(openTimer);
      if (!active) return;
      try {
        if (!dbg.isAttached()) {
          dbg.attach("1.3");
          attachedHere = true;
        }
        await command("DOM.enable");
        if (!active) return;
        await command("Overlay.enable");
        if (!active) return;
        overlay = true;
        await command("Overlay.setInspectMode", { mode: "searchForNode", highlightConfig });
      } catch {
        fail("Couldn't start the element picker. Try reopening DevTools.");
      }
    };

    if (wc.isDevToolsOpened()) {
      void arm();
    } else {
      listen(wc, "devtools-opened", arm);
      openTimer = setTimeout(() => fail("DevTools didn't open. Try selecting again."), 10_000);
      try { wc.openDevTools({ activate: false }); } catch { fail("Couldn't open DevTools for this browser tab."); }
    }
  });
}

function registerBrowserPicker() {
  ipcMain.handle("browser:pickElement", (event, guestId, requestId) => {
    const wc = browserRegistry.pick(guestId);
    if (!Number.isInteger(guestId) || !wc || wc.hostWebContents !== event.sender) {
      return { error: "Open a page in the Browser panel before selecting an element." };
    }
    if (pending.has(guestId)) return { error: "An element picker is already open for this browser tab." };
    return pickElement(wc, event.sender, requestId);
  });
  ipcMain.on("browser:cancelElementPick", (event, guestId, requestId) => {
    const session = pending.get(guestId);
    if (session?.owner === event.sender && session.requestId === requestId) session.cancel();
  });
}

module.exports = { registerBrowserPicker };
