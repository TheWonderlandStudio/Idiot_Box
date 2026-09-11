// cm/lsp.js — @codemirror/lsp-client, offline-first.
//
// - WebSocket transport { send, subscribe, unsubscribe } khud likha hai.
// - Server header-less JSON-RPC bolta hai (raw JSON string per message, koi
//   Content-Length framing nahi) + file URI file:///<name>.
// - Connect + request timeout 1.5s. Fail ho to offline mode (local
//   completions) + status indicator + retry button.
// - Status changes par "lsp:status" window event — Editor extensions rebuild
//   karke retry ke baad LSP wapas jodta hai.

import { LSPClient, languageServerSupport } from "@codemirror/lsp-client";

export const LSP_URL = "ws://localhost:2087";
export const LSP_TIMEOUT_MS = 1500;

// status: "idle" | "connecting" | "online" | "offline"
let status = "idle";
let client = null;
let ws = null;
let lastError = "";
const listeners = new Set();

const setStatus = (s, err) => {
  status = s;
  if (err !== undefined) lastError = String(err || "");
  for (const fn of [...listeners]) {
    try { fn(status, lastError); } catch {}
  }
  try {
    window.dispatchEvent(new CustomEvent("lsp:status", { detail: { status, error: lastError } }));
  } catch {}
};

export const getLspStatus = () => status;
export const getLspError = () => lastError;
export const onLspStatus = (fn) => {
  listeners.add(fn);
  try { fn(status, lastError); } catch {}
  return () => { listeners.delete(fn); };
};

// Server header-less JSON-RPC: ws message == poora JSON string.
const makeTransport = (socket) => {
  const wrapped = new Map(); // original handler -> wrapped listener
  return {
    send(message) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error("socket not open");
      socket.send(message);
    },
    subscribe(handler) {
      const fn = (ev) => {
        try {
          const data = typeof ev.data === "string" ? ev.data : "";
          if (data) handler(data);
        } catch {}
      };
      wrapped.set(handler, fn);
      socket.addEventListener("message", fn);
    },
    unsubscribe(handler) {
      const fn = wrapped.get(handler);
      if (fn) {
        try { socket.removeEventListener("message", fn); } catch {}
        wrapped.delete(handler);
      }
    },
  };
};

const cleanupSocket = () => {
  try { ws?.close(); } catch {}
  ws = null;
};

let connectTimer = null;
let currentAttempt = 0;

export const connectLsp = ({ rootUri } = {}) => {
  currentAttempt += 1;
  const attempt = currentAttempt;
  if (status === "connecting") return;
  if (ws) cleanupSocket();
  if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
  setStatus("connecting", "");
  let socket = null;
  try {
    socket = new WebSocket(LSP_URL);
  } catch (e) {
    setStatus("offline", e?.message || String(e));
    return;
  }
  ws = socket;
  let settled = false;
  const fail = (msg) => {
    if (settled || attempt !== currentAttempt) return;
    settled = true;
    if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
    cleanupSocket();
    try { client?.disconnect(); } catch {}
    setStatus("offline", msg);
  };
  // 1.5s me open+initialize na ho to offline.
  connectTimer = setTimeout(() => fail(`LSP timeout (${LSP_TIMEOUT_MS}ms) — ${LSP_URL} par koi server nahi`), LSP_TIMEOUT_MS);
  socket.addEventListener("open", () => {
    if (attempt !== currentAttempt) return;
    try {
      if (!client) {
        client = new LSPClient({
          timeout: LSP_TIMEOUT_MS,
          ...(rootUri ? { rootUri } : {}),
        });
      }
      client.connect(makeTransport(socket));
      const init = client.initializing;
      if (init && typeof init.then === "function") {
        init.then(
          () => {
            if (settled || attempt !== currentAttempt) return;
            settled = true;
            if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
            setStatus("online", "");
          },
          (e) => fail(e?.message || "LSP initialize failed")
        );
      } else {
        if (!settled) {
          settled = true;
          if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
          setStatus("online", "");
        }
      }
    } catch (e) {
      fail(e?.message || String(e));
    }
  });
  socket.addEventListener("error", () => fail(`LSP server se connect nahi hua (${LSP_URL})`));
  socket.addEventListener("close", () => {
    // Open hone se pehle close = fail; baad me close = drop -> offline.
    if (!settled) fail(`LSP connection closed (${LSP_URL})`);
    else if (attempt === currentAttempt && status === "online") setStatus("offline", "LSP connection closed");
  });
};

export const retryLsp = (opts) => {
  try { client?.disconnect(); } catch {}
  client = null;
  cleanupSocket();
  connectLsp(opts);
};

// Editor extension: online + client ho tabhi LSP support, warna [] (offline
// local completions). URI file:///<name> (spec).
export const fileUriFor = (filePath) => {
  const base = String(filePath || "untitled").split(/[\\/]/).pop() || "untitled";
  return "file:///" + base;
};

export const getLspExtension = (filePath, languageId) => {
  if (status !== "online" || !client) return [];
  try {
    const uri = fileUriFor(filePath);
    return [languageServerSupport(client, uri, languageId || "plaintext")];
  } catch {
    return [];
  }
};

// Pehli editor mount par auto-try (sirf ek baar).
let autoTried = false;
export const autoConnectLspOnce = (opts) => {
  if (autoTried) return;
  autoTried = true;
  try { connectLsp(opts); } catch {}
};
