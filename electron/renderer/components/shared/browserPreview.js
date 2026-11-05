import DOMPurify from "dompurify";

let lastBrowserId;

export function rememberBrowserForPreview(nodeId) {
  lastBrowserId = nodeId;
}

export function getBrowserPreviewTarget(model) {
  const activeId = model?.getActiveTabset()?.getSelectedNode()?.getId();
  const targets = [];
  for (const view of document.querySelectorAll("webview[data-browser-node-id]")) {
    const node = model?.getNodeById(view.dataset.browserNodeId);
    if (!node) continue;
    try {
      const guestId = view.getWebContentsId();
      if (view.getURL() && view.getURL() !== "about:blank") targets.push({ view, node, guestId });
    } catch {
      // The browser guest has not attached yet.
    }
  }
  return targets.find(({ node }) => node.getId() === activeId)
    || targets.find(({ node }) => node.getId() === lastBrowserId)
    || targets.find(({ node }) => node.isVisible())
    || targets[0];
}

export function makeBrowserPreviewDocument(html) {
  const markup = DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "link", "meta", "base", "iframe", "object", "embed", "template"],
    FORBID_ATTR: ["href", "xlink:href", "srcset", "action", "formaction", "autofocus", "ping"],
  });
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: http: data: ibx-file:; form-action 'none'; base-uri 'none'">
    <meta name="referrer" content="no-referrer">
    <style>body { margin: 12px; } main { pointer-events: none; }</style>
    </head><body><main inert>${markup}</main></body></html>`;
}
