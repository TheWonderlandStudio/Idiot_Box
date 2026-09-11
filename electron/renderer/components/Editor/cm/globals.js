// cm/globals.js — JS/TS global scope completions.
//
// Bare javascript() me sirf keywords + snippets + local variables hote hain —
// `console` jaisa aam word suggest hi nahi hota tha (suggestions "kaam nahi
// kar rahe" lagte the). scopeCompletionSource real objects leta hai, isliye
// member chains bhi kaam karti hain: `console.` -> log/warn/error,
// `Math.` -> floor/random, `JSON.` -> stringify/parse, `document.` -> ....
// Sirf defined cheezein jodte hain (typeof guard), taaki koi env me crash na ho.

import { scopeCompletionSource } from "@codemirror/lang-javascript";

const put = (scope, name, value) => {
  try {
    if (typeof value !== "undefined") scope[name] = value;
  } catch {}
};

const g = (name) => {
  try {
    const v = globalThis[name];
    return typeof v !== "undefined" ? v : undefined;
  } catch {
    return undefined;
  }
};

const buildJsGlobalScope = () => {
  const scope = {};
  // ── JS builtins (real refs — member completion ke sath) ──
  for (const n of [
    "console", "JSON", "Math", "Object", "Array", "String", "Number",
    "Boolean", "BigInt", "Symbol", "Function", "Promise", "Map", "Set",
    "WeakMap", "WeakSet", "Date", "RegExp", "Error", "TypeError",
    "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError",
    "AggregateError", "ArrayBuffer", "DataView", "Intl", "Reflect", "Proxy",
    "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI", "decodeURI",
    "encodeURIComponent", "decodeURIComponent", "atob", "btoa",
    "structuredClone", "queueMicrotask",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "fetch", "URL", "URLSearchParams", "Blob", "File", "FormData",
    "Headers", "Request", "Response", "AbortController", "AbortSignal",
    "TextEncoder", "TextDecoder", "crypto", "performance",
    "setImmediate", "clearImmediate",
  ]) put(scope, n, g(n));
  // ── Browser-ish globals (Electron renderer me maujood) ──
  for (const n of [
    "window", "document", "globalThis", "self", "localStorage",
    "sessionStorage", "navigator", "location", "history", "customElements",
    "requestAnimationFrame", "cancelAnimationFrame",
  ]) put(scope, n, g(n));
  // ── Node-ish globals (guarded — browser me undefined rehte hain) ──
  for (const n of ["process", "require", "module", "exports", "__dirname", "__filename", "Buffer"]) {
    put(scope, n, g(n));
  }
  return scope;
};

let _scope = null;
export const jsGlobalScope = () => {
  if (!_scope) _scope = buildJsGlobalScope();
  return _scope;
};

// javascriptLanguage.data.of(...) me lagao — chaaro JS dialects
// (js/jsx/ts/tsx) isi base language ka data inherit karte hain.
export const jsGlobalCompletion = () => {
  try {
    return scopeCompletionSource(jsGlobalScope());
  } catch {
    return null;
  }
};
