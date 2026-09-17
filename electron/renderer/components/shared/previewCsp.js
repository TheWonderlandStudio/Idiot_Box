// Preview iframe CSP — keep in sync with electron/main/csp.js PREVIEW_IFRAME_CSP.
// srcDoc guests get their own permissive-but-sandboxed policy via the iframe
// `csp` attribute. See main/csp.js for the full rationale.
export const PREVIEW_IFRAME_CSP = [
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
