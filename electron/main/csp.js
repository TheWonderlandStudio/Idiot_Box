// ─── Content-Security-Policy — Idiot Box app shell ──────────────────────────
// Single source of truth for the Electron renderer CSP.
// Enforced in two layers (defense in depth):
//   1. Response header via session.webRequest.onHeadersReceived (strongest —
//      applies to file:// app shell even before any <meta> parses).
//   2. <meta http-equiv="Content-Security-Policy"> fallback in index.html /
//      settings.html (covers the case where the header hook hasn't run yet).
//
// Design notes — why each source exists (do NOT widen without a reason):
//   script-src: 'self' + file:/ibx-file:/blob: only. NO https:, NO 'unsafe-inline'.
//     'unsafe-eval' + 'wasm-unsafe-eval' are REQUIRED: ComponentEmbed / preview
//     use `new Function()` to evaluate esbuild bundles, and shiki/CodeMirror/
//     Excalidraw pull in wasm that Chromium gates behind wasm-unsafe-eval.
//     Remote scripts are intentionally blocked — a compromised CDN or pasted
//     <script src=https> must never execute in the privileged app shell.
//   style-src: 'unsafe-inline' is REQUIRED (React inline styles everywhere +
//     xterm/CodeMirror dynamic styles). Remote styles limited to Google Fonts.
//   font-src: local bundle (esbuild inlines woff2 as data:) + Google Fonts.
//   img-src / media-src: https:/http: allowed — markdown, AI chat, notebook
//     outputs and Excalidraw embeds legitimately render remote images/video.
//   connect-src: https:/wss: allowed — AI providers are user-configurable
//     (OpenAI, Anthropic, Gemini, Pollinations, Vercel Gateway, custom
//     OpenAI-compatible LAN hosts, Ollama). http:/ws: additionally allowed
//     ONLY for localhost/loopback dev servers; LAN http custom endpoints also
//     need it. Keep remote *script* blocked even though connect is open.
//   worker-src blob:: CodeMirror/xterm/extension-host spawn blob workers.
//   frame-src: local only — preview uses srcDoc (not remote src), external
//     pages MUST open in the Browser <webview>/OS browser, never in an iframe.
//   object-src 'none': no plugins (Flash/Java) ever.
//   base-uri / form-action: locked to app schemes to block <base> hijacking.
//   frame-ancestors: header-only (ignored in <meta>) — app must never be
//     embedded by a remote page.
//
// Guest isolation: the header hook below ONLY touches file:// responses for
// the app shell. <webview> guests (https, ibx-file:, data:, blob:) and the
// ibx-file project-file handler are NEVER given this policy, so web browsing
// and local project previews keep working.

"use strict";

const APP_CSP_DIRECTIVES = [
  "default-src 'self' file: ibx-file:",
  // No https:, no 'unsafe-inline' — remote script injection must fail closed.
  "script-src 'self' file: ibx-file: blob: 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' file: ibx-file: blob: data: 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' file: ibx-file: blob: data: https://fonts.gstatic.com https://fonts.googleapis.com",
  "img-src 'self' file: ibx-file: blob: data: https: http:",
  "media-src 'self' file: ibx-file: blob: data: https: http:",
  // https:/wss: = user-configurable AI endpoints; http:/ws: localhost dev
  // servers (Ollama :11434, live-server ports, custom LAN endpoints).
  "connect-src 'self' file: ibx-file: blob: data: https: wss: ws: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' file: ibx-file: blob:",
  "child-src 'self' file: ibx-file: blob:",
  "frame-src 'self' file: ibx-file: blob: data:",
  "object-src 'none'",
  "base-uri 'self' file: ibx-file:",
  "form-action 'self' file: ibx-file:",
  "frame-ancestors 'self' file:",
];

const APP_CSP = APP_CSP_DIRECTIVES.join("; ");

// frame-ancestors is ignored in <meta> (header-only). Browsers log a warning
// if present, so strip it for the meta fallback. Everything else is identical.
const APP_CSP_META = APP_CSP_DIRECTIVES.filter((d) => !d.startsWith("frame-ancestors")).join("; ");

// ─── Preview iframe CSP (srcDoc sandbox guests) ─────────────────────────────
// User component/HTML previews run inside sandboxed srcDoc iframes with their
// own `csp` attribute. Deliberately MORE permissive than the app shell:
// user code legitimately needs CDN scripts (tailwind browser build on
// cdn.jsdelivr.net), inline handlers, eval, remote images and ibx-file local
// assets via <base href="ibx-file://…">. Isolation comes from
// sandbox="allow-scripts allow-same-origin allow-forms" (no top-navigation,
// no popups) + navigation guards that forward https/localhost out to the
// Browser panel — NOT from starving the preview of scripts.
// Keep in sync with electron/renderer/components/shared/previewCsp.js.
const PREVIEW_IFRAME_CSP = [
  "default-src 'self' file: ibx-file: blob: data: https: http:",
  "script-src 'self' file: ibx-file: blob: data: https: http: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' file: ibx-file: blob: data: https: http: 'unsafe-inline'",
  "font-src 'self' file: ibx-file: blob: data: https: http:",
  "img-src 'self' file: ibx-file: blob: data: https: http:",
  "media-src 'self' file: ibx-file: blob: data: https: http:",
  "connect-src 'self' file: ibx-file: blob: data: https: http: ws: wss:",
  "worker-src 'self' file: ibx-file: blob: data: https: http:",
  "frame-src 'self' file: ibx-file: blob: data: https: http:",
  "object-src 'none'",
  "base-uri 'self' file: ibx-file: blob: data: https: http:",
  "form-action 'self' file: ibx-file: blob: data: https: http:",
].join("; ");

function isAppShellFileUrl(url) {
  return typeof url === "string" && url.startsWith("file://");
}

// Inject the policy as a response header for the app shell only.
// Must be called once per session, BEFORE any BrowserWindow loads file://.
function setupCsp(webSession) {
  if (!webSession || !webSession.webRequest || typeof webSession.webRequest.onHeadersReceived !== "function") {
    try { console.warn("[csp] session.webRequest unavailable — header enforcement skipped (meta fallback still applies)"); } catch {}
    return false;
  }
  try {
    // URL filter keeps guest <webview> (https/data/blob/ibx-file) and crx://
    // extension pages completely untouched — only file:// app shell is stamped.
    webSession.webRequest.onHeadersReceived({ urls: ["file://*"] }, (details, callback) => {
      try {
        if (!isAppShellFileUrl(details.url)) {
          // Defensive double-check (filter should already guarantee file://).
          callback({});
          return;
        }
        const headers = Object.assign({}, details.responseHeaders || {});
        // Overwrite any existing CSP (file:// has none, but be explicit).
        headers["Content-Security-Policy"] = [APP_CSP];
        // Defense in depth: correct MIME types are served for bundle.js/css,
        // so nosniff is safe and blocks MIME-confusion attacks.
        if (!headers["X-Content-Type-Options"]) {
          headers["X-Content-Type-Options"] = ["nosniff"];
        }
        callback({ responseHeaders: headers });
      } catch (err) {
        try { console.warn("[csp] onHeadersReceived failed:", err && err.message); } catch {}
        callback({});
      }
    });
    return true;
  } catch (err) {
    try { console.warn("[csp] setup failed:", err && err.message); } catch {}
    return false;
  }
}

module.exports = { APP_CSP, APP_CSP_META, PREVIEW_IFRAME_CSP, setupCsp };
