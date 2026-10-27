// Debugger backend — Node (Chrome DevTools Protocol) and Python (DAP).
//
// Node: the target is spawned with --inspect-brk=0, we read the websocket URL
// from stderr and drive the inspector protocol directly.
// Python: debugpy's adapter is spawned with `python -m debugpy.adapter` and
// spoken to over stdio using the Debug Adapter Protocol.
//
// Sessions stay paused at startup until the renderer sends the "run" action so
// the UI can subscribe with its session id before the first stop event.
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { pathToFileURL, fileURLToPath } = require("url");
const { BrowserWindow } = require("electron");

const sessions = new Map();
let sessionCounter = 0;

// ── Shared helpers ─────────────────────────────────────────────────────────

const uid = (prefix) => {
  sessionCounter++;
  return `${prefix}_${Date.now().toString(36)}_${sessionCounter}_${Math.random().toString(36).slice(2, 6)}`;
};

const broadcast = (payload) => {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send("debug:event", payload);
    } catch {}
  }
};

const toAbs = (p) => {
  try { return path.resolve(String(p)); } catch { return String(p || ""); }
};

const urlToPath = (url) => {
  const s = String(url || "");
  if (!s) return "";
  if (s.startsWith("file://")) {
    try { return fileURLToPath(s); } catch { return ""; }
  }
  return s;
};

const fileUrl = (file) => {
  try { return pathToFileURL(toAbs(file)).href; } catch { return ""; }
};

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

function makeLineBuffer(onLine) {
  let buffer = "";
  return {
    push(chunk) {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        onLine(line);
      }
      if (buffer.length > 200_000) buffer = buffer.slice(-100_000);
    },
    flush() {
      if (buffer) {
        const line = buffer;
        buffer = "";
        onLine(line);
      }
    },
  };
}

function killTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      try { process.kill(-proc.pid, "SIGTERM"); } catch { proc.kill("SIGTERM"); }
    }
  } catch {
    try { proc.kill(); } catch {}
  }
}

function emitOutput(session, stream, text) {
  const clean = stripAnsi(text);
  if (!clean) return;
  const lines = String(clean).split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    broadcast({ sessionId: session.id, type: "output", stream: stream || "stdout", line });
  }
}

function markTerminated(session, extra = {}) {
  if (!session || session.terminated) return;
  session.terminated = true;
  session.status = "terminated";
  // The Python adapter outlives the debuggee in some debugpy versions; make
  // sure it does not linger after the session is over.
  if (session.type === "python" && session.proc && session.proc.exitCode === null) {
    try { killTree(session.proc); } catch {}
  }
  try { session.cdp?.close(); } catch {}
  try { session.ws?.close(); } catch {}
  try { session.dap?.close?.(); } catch {}
  broadcast({
    sessionId: session.id,
    type: "terminated",
    exitCode: extra.exitCode ?? null,
    signal: extra.signal ?? null,
    error: extra.error || null,
  });
  setTimeout(() => { sessions.delete(session.id); }, 60_000).unref?.();
}

// ── WebSocket helpers (global WebSocket, ws fallback) ─────────────────────

function wsOn(ws, event, handler) {
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(event, (ev) => {
      if (event === "message") handler(ev.data);
      else handler(ev);
    });
  } else if (typeof ws.on === "function") {
    ws.on(event, handler);
  }
}

const wsDataToString = (data) => {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data && typeof data.text === "function") return data.text();
  return String(data ?? "");
};

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.onEvent = null;
    this.onClose = null;
    this.closed = false;
    wsOn(ws, "message", (data) => this.handleMessage(data));
    wsOn(ws, "close", () => this.handleClose());
    wsOn(ws, "error", () => this.handleClose());
  }

  static connect(url, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        const WS = globalThis.WebSocket || require("ws");
        ws = new WS(url);
      } catch (err) {
        reject(err);
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close?.(); } catch {}
        reject(new Error("Timed out connecting to the Node inspector."));
      }, timeoutMs);
      const open = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      };
      if (typeof ws.addEventListener === "function") {
        ws.addEventListener("open", open, { once: true });
        ws.addEventListener("error", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error("Could not connect to the Node inspector."));
        }, { once: true });
      } else {
        ws.once("open", open);
        ws.once("error", (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
      }
    });
  }

  handleMessage(data) {
    let msg;
    try { msg = JSON.parse(wsDataToString(data)); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || "Inspector request failed"));
      else p.resolve(msg.result || {});
    } else if (msg.method) {
      try { this.onEvent?.(msg.method, msg.params || {}); } catch {}
    }
  }

  handleClose() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      try { p.reject(new Error("Debugger connection closed.")); } catch {}
    }
    this.pending.clear();
    try { this.onClose?.(); } catch {}
  }

  send(method, params = {}) {
    if (this.closed) return Promise.reject(new Error("Debugger connection closed."));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        this.pending.delete(id);
        reject(err);
        return;
      }
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`Inspector request timed out: ${method}`));
      }, 20_000).unref?.();
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.ws.close(); } catch {}
  }
}

// ── Node inspector session ────────────────────────────────────────────────

const NODE_SCOPE_NAMES = {
  local: "Locals",
  closure: "Closure",
  global: "Global",
  block: "Block",
  script: "Script",
  with: "With",
  catch: "Catch",
  eval: "Eval",
  module: "Module",
};

const remoteValue = (obj) => {
  if (!obj) return "undefined";
  if (obj.type === "undefined") return "undefined";
  if (obj.type === "string") return obj.value ?? "";
  if (Object.prototype.hasOwnProperty.call(obj, "value")) {
    if (typeof obj.value === "object" && obj.value !== null) {
      try { return JSON.stringify(obj.value); } catch { return String(obj.value); }
    }
    return String(obj.value);
  }
  if (obj.unserializableValue != null) return String(obj.unserializableValue);
  if (obj.preview?.description) return String(obj.preview.description);
  if (obj.description) {
    const first = String(obj.description).split("\n")[0];
    return first.length > 300 ? first.slice(0, 300) + "…" : first;
  }
  return String(obj.type || "undefined");
};

const remoteType = (obj) => {
  if (!obj) return "undefined";
  if (obj.subtype) return obj.subtype;
  return obj.type || "undefined";
};

function normalizeNodeArgs(args) {
  const out = [];
  for (const a of Array.isArray(args) ? args : []) {
    if (/^--inspect(-brk)?(=|$)/.test(String(a))) continue;
    out.push(String(a));
  }
  return out;
}

function groupInitialBreakpoints(list) {
  const grouped = new Map();
  for (const bp of Array.isArray(list) ? list : []) {
    const file = bp?.path || bp?.file;
    const line = Number(bp?.line);
    if (!file || !Number.isFinite(line) || line < 1) continue;
    const abs = toAbs(file);
    if (!grouped.has(abs)) grouped.set(abs, []);
    grouped.get(abs).push({ line: Math.trunc(line), enabled: bp.enabled !== false, condition: bp.condition || "" });
  }
  return grouped;
}

async function applyNodeBreakpoints(session, file, list) {
  const cdp = session.cdp;
  if (!cdp || cdp.closed) return { ok: false, error: "No active debug session.", breakpoints: [] };
  const abs = toAbs(file);
  const previous = session.breakpoints.get(abs) || [];
  for (const old of previous) {
    if (!old.breakpointId) continue;
    try { await cdp.send("Debugger.removeBreakpoint", { breakpointId: old.breakpointId }); } catch {}
  }
  const applied = [];
  const url = fileUrl(abs);
  for (const bp of Array.isArray(list) ? list : []) {
    const line = Math.trunc(Number(bp?.line));
    if (!Number.isFinite(line) || line < 1) continue;
    const enabled = bp?.enabled !== false;
    if (!enabled) {
      applied.push({ line, enabled: false, verified: false, breakpointId: null });
      continue;
    }
    try {
      const res = await cdp.send("Debugger.setBreakpointByUrl", {
        url,
        lineNumber: line - 1,
        columnNumber: 0,
        ...(bp?.condition ? { condition: String(bp.condition) } : {}),
      });
      applied.push({
        line,
        enabled: true,
        verified: Array.isArray(res.locations) && res.locations.length > 0,
        breakpointId: res.breakpointId || null,
      });
    } catch (err) {
      applied.push({ line, enabled: true, verified: false, breakpointId: null, error: err.message });
    }
  }
  session.breakpoints.set(abs, applied);
  broadcast({ sessionId: session.id, type: "breakpoint", file: abs, breakpoints: applied });
  return { ok: true, breakpoints: applied };
}

function finishNodeSession(session) {
  if (!session || session.terminated || session.exitRequested) return;
  session.exitRequested = true;
  // Node keeps the process alive at "Waiting for the debugger to disconnect..."
  // once the program ends; closing the inspector lets the exit handler report
  // the real exit code.
  try { session.cdp?.close(); } catch {}
  const proc = session.proc;
  const timer = setTimeout(() => {
    if (session.terminated) return;
    try { if (proc && proc.exitCode === null) killTree(proc); } catch {}
    markTerminated(session, {});
  }, 2000);
  timer.unref?.();
}

function handleCdpEvent(session, method, params) {
  if (method === "Runtime.executionContextCreated") {
    // Remember the main (default) context so a destroyed VM/worker context
    // does not look like the program ending.
    const ctx = params.context || {};
    if (ctx.auxData?.isDefault) session.mainContextId = ctx.id;
    return;
  }

  if (method === "Runtime.executionContextDestroyed") {
    if (session.terminated) return;
    if (
      session.mainContextId != null &&
      params.executionContextId != null &&
      params.executionContextId !== session.mainContextId
    ) return;
    finishNodeSession(session);
    return;
  }

  if (method === "NodeRuntime.waitingForDisconnect") {
    finishNodeSession(session);
    return;
  }

  if (method === "Debugger.paused") {
    const reason = params.reason || "other";
    // --inspect-brk pauses before the first statement. Unless the user asked
    // to stop on entry, skip that synthetic break so the debuggee runs to the
    // first real breakpoint.
    if (
      !session.stopOnEntry &&
      !session.entryResumed &&
      reason === "Break on start" &&
      !(Array.isArray(params.hitBreakpointIds) && params.hitBreakpointIds.length)
    ) {
      session.entryResumed = true;
      try { session.cdp?.send("Debugger.resume").catch(() => {}); } catch {}
      return;
    }
    const frames = (params.callFrames || []).map((f) => ({
      id: f.callFrameId,
      name: f.functionName || "(anonymous)",
      path: urlToPath(f.url),
      line: (f.location?.lineNumber ?? 0) + 1,
      column: (f.location?.columnNumber ?? 0) + 1,
      scopes: (f.scopeChain || []).map((sc) => ({
        name: NODE_SCOPE_NAMES[sc.type] || String(sc.type || "Scope"),
        type: sc.type || "scope",
        variablesReference: sc.object?.objectId || "",
      })),
    }));
    session.paused = { reason, frames, threadId: 1 };
    session.status = "paused";
    broadcast({
      sessionId: session.id,
      type: "stopped",
      reason,
      threadId: 1,
      frames,
    });
    return;
  }

  if (method === "Debugger.breakpointResolved") {
    const id = params.breakpointId;
    if (!id) return;
    for (const [file, list] of session.breakpoints) {
      const idx = list.findIndex((b) => b && b.breakpointId === id);
      if (idx === -1) continue;
      const next = list.map((b, i) => (i === idx
        ? { ...b, verified: true, actualLine: (params.location?.lineNumber ?? 0) + 1 }
        : b));
      session.breakpoints.set(file, next);
      broadcast({ sessionId: session.id, type: "breakpoint", file, breakpoints: next });
      break;
    }
    return;
  }

  if (method === "Debugger.resumed") {
    session.paused = null;
    session.status = "running";
    broadcast({ sessionId: session.id, type: "continued", threadId: 1 });
    return;
  }

  // Console output is not broadcast here: Node writes console.log/error to the
  // piped stdout/stderr as well, and those handlers already emit it. Relaying
  // Runtime.consoleAPICalled duplicated every line.

  if (method === "Runtime.exceptionThrown") {
    const d = params.exceptionDetails || {};
    const text = d.exception?.description || d.text || "Uncaught exception";
    emitOutput(session, "stderr", text + "\n");
  }
}

async function startNodeSession(desc) {
  const cwd = desc.cwd && fs.existsSync(desc.cwd) ? desc.cwd : process.cwd();
  const cmd = desc.cmd || "node";
  const args = normalizeNodeArgs(desc.args);
  const spawnArgs = ["--inspect-brk=0"];
  if (desc.program) spawnArgs.push(toAbs(desc.program));
  if (Array.isArray(desc.programArgs) && desc.programArgs.length) spawnArgs.push(...desc.programArgs.map(String));
  spawnArgs.push(...args);

  const session = {
    id: uid("dbg"),
    type: "node",
    language: "node",
    name: desc.name || (desc.program ? path.basename(desc.program) : "Node"),
    cwd,
    rootPath: desc.rootPath || cwd,
    status: "starting",
    breakpoints: new Map(),
    paused: null,
    cdp: null,
    proc: null,
    terminated: false,
    stopOnEntry: desc.stopOnEntry === true,
    entryResumed: false,
    mainContextId: null,
    exitRequested: false,
    command: [cmd, ...spawnArgs].join(" "),
  };
  sessions.set(session.id, session);

  let proc;
  try {
    proc = spawn(cmd, spawnArgs, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      windowsHide: true,
    });
  } catch (err) {
    sessions.delete(session.id);
    return { ok: false, error: `Could not start Node: ${err.message}` };
  }
  session.proc = proc;
  session.pid = proc.pid;

  broadcast({
    sessionId: session.id,
    type: "started",
    language: "node",
    name: session.name,
    pid: proc.pid,
    cwd,
    command: session.command,
  });

  const stdout = makeLineBuffer((line) => emitOutput(session, "stdout", line + "\n"));
  const stderr = makeLineBuffer((line) => {
    if (/^Debugger listening on ws:\/\//.test(line)) return;
    if (/^For help, see:/.test(line)) return;
    if (/^Debugger attached\./.test(line)) return;
    if (/^Waiting for the debugger to disconnect\.\.\./.test(line)) return;
    emitOutput(session, "stderr", line + "\n");
  });
  proc.stdout.on("data", (c) => stdout.push(c));
  proc.stderr.on("data", (c) => stderr.push(c));
  proc.on("error", (err) => {
    markTerminated(session, { error: `Could not start Node: ${err.message}` });
  });
  proc.on("exit", (code, signal) => {
    stdout.flush();
    stderr.flush();
    markTerminated(session, { exitCode: code, signal });
  });

  // Wait for the inspector URL on stderr, then attach.
  const inspectUrl = await new Promise((resolve) => {
    let seen = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, 15_000);
    const onData = (chunk) => {
      if (settled) return;
      seen += chunk.toString();
      const match = /Debugger listening on (ws:\/\/[^\s]+)/.exec(seen);
      if (match) {
        settled = true;
        clearTimeout(timer);
        proc.stderr.removeListener("data", onData);
        resolve(match[1]);
      }
      if (seen.length > 20_000) seen = seen.slice(-10_000);
    };
    proc.stderr.on("data", onData);
    proc.once("exit", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });

  if (!inspectUrl) {
    markTerminated(session, { error: "Node exited before the debugger could attach." });
    return { ok: true, sessionId: session.id, language: "node", name: session.name };
  }

  let cdp;
  try {
    cdp = await CdpClient.connect(inspectUrl);
  } catch (err) {
    markTerminated(session, { error: err.message });
    return { ok: true, sessionId: session.id, language: "node", name: session.name };
  }
  session.cdp = cdp;
  cdp.onEvent = (method, params) => handleCdpEvent(session, method, params);
  cdp.onClose = () => {
    if (!session.terminated) {
      // Give the exit handler a moment to report the real exit code.
      setTimeout(() => markTerminated(session, {}), 500).unref?.();
    }
  };

  try {
    await cdp.send("Runtime.enable");
    await cdp.send("NodeRuntime.enable").catch(() => {});
    await cdp.send("Debugger.enable");
    await cdp.send("Debugger.setAsyncCallStackDepth", { maxDepth: 32 }).catch(() => {});
    for (const [file, bps] of groupInitialBreakpoints(desc.breakpoints)) {
      await applyNodeBreakpoints(session, file, bps);
    }
  } catch (err) {
    markTerminated(session, { error: `Could not initialize the Node debugger: ${err.message}` });
    return { ok: true, sessionId: session.id, language: "node", name: session.name };
  }

  session.status = "waiting";
  broadcast({ sessionId: session.id, type: "ready", canRun: true });
  return { ok: true, sessionId: session.id, language: "node", name: session.name, pid: proc.pid, command: session.command };
}

async function runNodeSession(session) {
  if (!session.cdp || session.cdp.closed) return { ok: false, error: "Debugger is not connected." };
  try {
    await session.cdp.send("Runtime.runIfWaitingForDebugger");
    session.status = "running";
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Python DAP session ─────────────────────────────────────────────────────

class DapConnection {
  constructor(proc) {
    this.proc = proc;
    this.buffer = Buffer.alloc(0);
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.queue = [];
    this.closed = false;
    proc.stdout.on("data", (chunk) => this.onData(chunk));
    proc.on("exit", () => this.close());
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const m = /content-length:\s*(\d+)/i.exec(header);
      if (!m) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(m[1]);
      if (this.buffer.length < headerEnd + 4 + length) break;
      const body = this.buffer.slice(headerEnd + 4, headerEnd + 4 + length).toString("utf8");
      this.buffer = this.buffer.slice(headerEnd + 4 + length);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      this.dispatch(msg);
    }
  }

  dispatch(msg) {
    if (msg.type === "response") {
      const pending = this.pending.get(msg.request_seq);
      if (!pending) return;
      this.pending.delete(msg.request_seq);
      if (msg.success === false) {
        const error = msg.body?.error || {};
        const err = new Error(error.format || error.message || "Debug adapter request failed");
        err.code = error.id;
        pending.reject(err);
      } else {
        pending.resolve(msg.body || {});
      }
      return;
    }
    if (msg.type === "event") {
      const waiters = this.listeners.get(msg.event);
      if (waiters && waiters.length) {
        // Listeners are persistent (output/stopped/continued/terminated);
        // waitEvent() removes its own one-shot handler when it fires.
        for (const w of [...waiters]) {
          try { w(msg.body || {}); } catch {}
        }
      } else {
        this.queue.push({ event: msg.event, body: msg.body || {} });
        if (this.queue.length > 200) this.queue.shift();
      }
    }
  }

  request(command, args = {}, timeoutMs = 20_000) {
    if (this.closed) return Promise.reject(new Error("Debug adapter is not running."));
    const seq = ++this.seq;
    const body = JSON.stringify({ seq, type: "request", command, arguments: args });
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      try {
        this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      } catch (err) {
        this.pending.delete(seq);
        reject(err);
        return;
      }
      if (timeoutMs > 0) {
        setTimeout(() => {
          if (!this.pending.has(seq)) return;
          this.pending.delete(seq);
          reject(new Error(`Debug adapter timed out: ${command}`));
        }, timeoutMs).unref?.();
      }
    });
  }

  waitEvent(name, timeoutMs = 15_000) {
    const idx = this.queue.findIndex((e) => e.event === name);
    if (idx !== -1) {
      const [entry] = this.queue.splice(idx, 1);
      return Promise.resolve(entry.body);
    }
    return new Promise((resolve, reject) => {
      const list = this.listeners.get(name) || [];
      let timer = null;
      const done = (body) => {
        clearTimeout(timer);
        const arr = this.listeners.get(name) || [];
        this.listeners.set(name, arr.filter((fn) => fn !== done));
        resolve(body);
      };
      list.push(done);
      this.listeners.set(name, list);
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const arr = this.listeners.get(name) || [];
          this.listeners.set(name, arr.filter((fn) => fn !== done));
          reject(new Error(`Timed out waiting for the debug adapter (${name}).`));
        }, timeoutMs);
      }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      try { p.reject(new Error("Debug adapter closed.")); } catch {}
    }
    this.pending.clear();
  }
}

let pythonCache = null;
let debugpyCache = null; // { pythonKey, ok, version }
let installPromise = null;

function findPython() {
  if (pythonCache) return Promise.resolve(pythonCache);
  const probe = (cmd, base) => new Promise((resolve) => {
    try {
      execFile(cmd, [...base, "--version"], { timeout: 4000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) { resolve(null); return; }
        const text = String(stdout || "").trim() || String(stderr || "").trim();
        resolve({ cmd, base, version: text });
      });
    } catch { resolve(null); }
  });
  return (async () => {
    pythonCache = await probe("python", []);
    if (!pythonCache) pythonCache = await probe("py", ["-3"]);
    return pythonCache;
  })();
}

const pythonKey = (py) => `${py?.cmd || ""}|${(py?.base || []).join(" ")}`;

function checkDebugpy(py, force = false) {
  if (!py) return Promise.resolve({ ok: false, version: null });
  if (!force && debugpyCache && debugpyCache.pythonKey === pythonKey(py)) return Promise.resolve(debugpyCache);
  return new Promise((resolve) => {
    execFile(
      py.cmd,
      [...py.base, "-c", "import debugpy,sys;print(debugpy.__version__)"],
      { timeout: 8000, windowsHide: true },
      (err, stdout) => {
        debugpyCache = err
          ? { pythonKey: pythonKey(py), ok: false, version: null }
          : { pythonKey: pythonKey(py), ok: true, version: String(stdout || "").trim() || "unknown" };
        resolve(debugpyCache);
      }
    );
  });
}

function normalizePython(py) {
  if (Array.isArray(py) && py.length) return { cmd: String(py[0]), base: py.slice(1).map(String) };
  if (typeof py === "string" && py.trim()) return { cmd: py.trim(), base: [] };
  return null;
}

async function startPythonSession(desc) {
  const py = normalizePython(desc.python) || await findPython();
  if (!py) return { ok: false, error: "Python was not found on PATH." };
  const availability = await checkDebugpy(py, true);
  if (!availability.ok) {
    return {
      ok: false,
      error: "debugpy is not installed for this Python interpreter.",
      needsDebugpy: true,
      python: py.cmd,
    };
  }

  const cwd = desc.cwd && fs.existsSync(desc.cwd) ? desc.cwd : process.cwd();
  const session = {
    id: uid("dbg"),
    type: "python",
    language: "python",
    name: desc.name || (desc.program ? path.basename(desc.program) : desc.module || "Python"),
    cwd,
    rootPath: desc.rootPath || cwd,
    status: "starting",
    breakpoints: new Map(),
    paused: null,
    dap: null,
    proc: null,
    terminated: false,
    threadId: 1,
  };
  sessions.set(session.id, session);

  let proc;
  try {
    proc = spawn(py.cmd, [...py.base, "-m", "debugpy.adapter"], {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" },
      windowsHide: true,
    });
  } catch (err) {
    sessions.delete(session.id);
    return { ok: false, error: `Could not start debugpy: ${err.message}` };
  }
  session.proc = proc;
  session.pid = proc.pid;
  const dap = new DapConnection(proc);
  session.dap = dap;

  broadcast({
    sessionId: session.id,
    type: "started",
    language: "python",
    name: session.name,
    pid: proc.pid,
    cwd,
    command: `${py.cmd} -m debugpy.adapter`,
  });

  proc.on("error", (err) => markTerminated(session, { error: `debugpy failed: ${err.message}` }));
  proc.on("exit", (code, signal) => markTerminated(session, { exitCode: code, signal }));

  const outBuffer = makeLineBuffer((line) => emitOutput(session, "stdout", line + "\n"));
  const errBuffer = makeLineBuffer((line) => emitOutput(session, "stderr", line + "\n"));

  dap.listeners.set("output", []);
  const onDapEvent = (name, fn) => {
    const list = dap.listeners.get(name) || [];
    list.push(fn);
    dap.listeners.set(name, list);
  };

  onDapEvent("output", (body) => {
    const category = String(body.category || "stdout");
    if (category === "telemetry") return;
    const stream = category === "stderr" ? "stderr" : "stdout";
    const buf = stream === "stderr" ? errBuffer : outBuffer;
    buf.push(String(body.output || ""));
  });

  onDapEvent("stopped", async (body) => {
    const threadId = body.threadId ?? session.threadId ?? 1;
    session.threadId = threadId;
    let frames = [];
    try {
      const st = await dap.request("stackTrace", { threadId, startFrame: 0, levels: 40 });
      frames = (st.stackFrames || []).map((f) => ({
        id: f.id,
        name: f.name || "(frame)",
        path: f.source?.path || "",
        line: f.line || 1,
        column: f.column || 1,
      }));
    } catch {}
    session.paused = { reason: body.reason || "other", frames, threadId };
    session.status = "paused";
    broadcast({
      sessionId: session.id,
      type: "stopped",
      reason: body.reason || "other",
      threadId,
      frames,
    });
  });

  onDapEvent("continued", (body) => {
    session.paused = null;
    session.status = "running";
    broadcast({ sessionId: session.id, type: "continued", threadId: body.threadId ?? session.threadId });
  });

  onDapEvent("breakpoint", (body) => {
    const bp = body.breakpoint || {};
    const file = bp.source?.path;
    if (!file) return;
    broadcast({
      sessionId: session.id,
      type: "breakpoint",
      file: toAbs(file),
      reason: body.reason || "changed",
      breakpoints: [{
        line: bp.line || 1,
        enabled: true,
        verified: bp.verified !== false,
        id: bp.id,
      }],
    });
  });

  onDapEvent("terminated", () => markTerminated(session, {}));
  // debugpy normally sends "terminated" after "exited"; handle either so a
  // finished debuggee never leaves the UI stuck in "running".
  onDapEvent("exited", (body) => {
    if (!session.terminated) markTerminated(session, { exitCode: body?.exitCode ?? null });
  });

  let initialized;
  try {
    initialized = dap.waitEvent("initialized", 20_000);
    await dap.request("initialize", {
      adapterID: "python",
      clientID: "idiot-box",
      clientName: "Idiot Box",
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsRunInTerminalRequest: false,
      supportsStartDebuggingRequest: false,
      supportsVariableType: true,
      supportsVariablePaging: true,
    }, 20_000);
  } catch (err) {
    markTerminated(session, { error: `Could not initialize debugpy: ${err.message}` });
    return { ok: true, sessionId: session.id, language: "python", name: session.name };
  }

  const launchArgs = {
    name: session.name,
    type: "python",
    request: "launch",
    cwd,
    console: "internalConsole",
    redirectOutput: true,
    justMyCode: desc.justMyCode !== false,
    python: [py.cmd, ...py.base],
  };
  if (desc.program) launchArgs.program = toAbs(desc.program);
  if (desc.module) launchArgs.module = String(desc.module);
  launchArgs.args = Array.isArray(desc.args) ? desc.args.map(String) : [];
  if (desc.stopOnEntry) launchArgs.stopOnEntry = true;

  const launchPromise = dap.request("launch", launchArgs, 0);
  launchPromise.catch((err) => {
    if (!session.terminated) {
      markTerminated(session, { error: `Launch failed: ${err.message}` });
    }
  });

  try {
    await initialized;
  } catch (err) {
    markTerminated(session, { error: err.message });
    return { ok: true, sessionId: session.id, language: "python", name: session.name };
  }

  for (const [file, bps] of groupInitialBreakpoints(desc.breakpoints)) {
    await applyPythonBreakpoints(session, file, bps);
  }

  session.status = "waiting";
  broadcast({ sessionId: session.id, type: "ready", canRun: true });
  return { ok: true, sessionId: session.id, language: "python", name: session.name, pid: proc.pid };
}

async function applyPythonBreakpoints(session, file, list) {
  const dap = session.dap;
  if (!dap || dap.closed) return { ok: false, error: "No active debug session.", breakpoints: [] };
  const abs = toAbs(file);
  const input = Array.isArray(list) ? list : [];
  const enabled = input.filter((b) => b?.enabled !== false && Number(b?.line) >= 1);
  try {
    const res = await dap.request("setBreakpoints", {
      source: { path: abs, name: path.basename(abs) },
      breakpoints: enabled.map((b) => ({
        line: Math.trunc(Number(b.line)),
        ...(b.condition ? { condition: String(b.condition) } : {}),
      })),
      sourceModified: false,
    });
    const verified = Array.isArray(res.breakpoints) ? res.breakpoints : [];
    let vi = 0;
    const applied = input.map((b) => {
      const line = Math.trunc(Number(b.line));
      if (b?.enabled === false) return { line, enabled: false, verified: false };
      const match = verified[vi++];
      return {
        line,
        enabled: true,
        verified: match?.verified !== false,
        id: match?.id,
        actualLine: match?.line,
      };
    });
    session.breakpoints.set(abs, applied);
    broadcast({ sessionId: session.id, type: "breakpoint", file: abs, breakpoints: applied });
    return { ok: true, breakpoints: applied };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runPythonSession(session) {
  if (!session.dap || session.dap.closed) return { ok: false, error: "Debug adapter is not running." };
  try {
    await session.dap.request("configurationDone", {}, 20_000);
    session.status = "running";
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── Unified public API ────────────────────────────────────────────────────

async function startDebug(payload = {}) {
  const language = payload.language || (String(payload.program || "").toLowerCase().endsWith(".py") ? "python" : "node");
  try {
    if (language === "python") return await startPythonSession(payload);
    return await startNodeSession(payload);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function getSession(sessionId) {
  return sessions.get(String(sessionId || "")) || null;
}

async function control(sessionId, action) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "Debug session not found." };
  const act = String(action || "").toLowerCase();
  if (act === "run") {
    if (session.type === "python") return runPythonSession(session);
    return runNodeSession(session);
  }
  if (session.terminated) return { ok: false, error: "The debug session has ended." };
  if (act === "stop") return stopSession(sessionId);

  if (session.type === "node") {
    const cdp = session.cdp;
    if (!cdp || cdp.closed) return { ok: false, error: "Debugger is not connected." };
    const map = { continue: "Debugger.resume", pause: "Debugger.pause", next: "Debugger.stepOver", stepIn: "Debugger.stepInto", stepOut: "Debugger.stepOut" };
    const method = map[act];
    if (!method) return { ok: false, error: `Unknown debug action: ${action}` };
    try {
      await cdp.send(method, act === "pause" ? {} : {});
      if (act === "continue") {
        session.paused = null;
        session.status = "running";
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  const dap = session.dap;
  if (!dap || dap.closed) return { ok: false, error: "Debug adapter is not running." };
  const threadId = session.paused?.threadId ?? session.threadId ?? 1;
  try {
    if (act === "continue") {
      const res = await dap.request("continue", { threadId });
      session.paused = null;
      session.status = "running";
      return { ok: true, allThreadsContinued: res.allThreadsContinued !== false };
    }
    if (act === "pause") {
      await dap.request("pause", { threadId });
      return { ok: true };
    }
    const map = { next: "next", stepIn: "stepIn", stepOut: "stepOut" };
    const command = map[act];
    if (!command) return { ok: false, error: `Unknown debug action: ${action}` };
    await dap.request(command, { threadId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function stopSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "Debug session not found." };
  if (session.terminated) return { ok: true };
  try {
    if (session.type === "python" && session.dap && !session.dap.closed) {
      await Promise.race([
        session.dap.request("disconnect", { terminateDebuggee: true }, 4000).catch(() => {}),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    }
    if (session.type === "node" && session.cdp && !session.cdp.closed) {
      try { await session.cdp.send("Debugger.disable"); } catch {}
      try { await session.cdp.send("Runtime.runIfWaitingForDebugger"); } catch {}
    }
  } catch {}
  killTree(session.proc);
  markTerminated(session, {});
  return { ok: true };
}

function getStack(sessionId) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "Debug session not found.", frames: [] };
  return { ok: true, frames: session.paused?.frames || [], reason: session.paused?.reason || null };
}

async function getScopes(sessionId, frameId) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "Debug session not found.", scopes: [] };
  if (session.type === "node") {
    const frames = session.paused?.frames || [];
    const frame = frames.find((f) => f.id === frameId) || frames[0];
    if (!frame) return { ok: true, scopes: [] };
    return {
      ok: true,
      frameId: frame.id,
      scopes: (frame.scopes || []).map((s) => ({
        name: s.name,
        variablesReference: s.variablesReference,
        expensive: false,
      })),
    };
  }
  try {
    const res = await session.dap.request("scopes", { frameId });
    return { ok: true, scopes: res.scopes || [] };
  } catch (err) {
    return { ok: false, error: err.message, scopes: [] };
  }
}

async function getVariables(sessionId, variablesReference) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "Debug session not found.", variables: [] };
  if (!variablesReference) return { ok: true, variables: [] };
  if (session.type === "node") {
    const cdp = session.cdp;
    if (!cdp || cdp.closed) return { ok: false, error: "Debugger is not connected.", variables: [] };
    try {
      const res = await cdp.send("Runtime.getProperties", {
        objectId: String(variablesReference),
        ownProperties: true,
        generatePreview: true,
      });
      const variables = (res.result || [])
        .filter((p) => p && p.name && p.enumerable !== false && !String(p.name).startsWith("[["))
        .map((p) => {
          if (p.get || p.set) {
            return { name: p.name, value: "(getter)", type: "property", variablesReference: 0 };
          }
          const v = p.value || {};
          return {
            name: p.name,
            value: remoteValue(v),
            type: remoteType(v),
            variablesReference: v.objectId || 0,
          };
        });
      return { ok: true, variables };
    } catch (err) {
      return { ok: false, error: err.message, variables: [] };
    }
  }
  try {
    const res = await session.dap.request("variables", {
      variablesReference,
      start: 0,
      count: 0,
    });
    const variables = (res.variables || []).map((v) => ({
      name: v.name,
      value: v.value,
      type: v.type || "",
      variablesReference: v.variablesReference || 0,
    }));
    return { ok: true, variables };
  } catch (err) {
    return { ok: false, error: err.message, variables: [] };
  }
}

async function evaluate(sessionId, expression, frameId) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "Debug session not found." };
  const expr = String(expression || "").trim();
  if (!expr) return { ok: false, error: "Enter an expression." };
  if (session.type === "node") {
    const cdp = session.cdp;
    if (!cdp || cdp.closed) return { ok: false, error: "Debugger is not connected." };
    const frames = session.paused?.frames || [];
    const frame = frames.find((f) => f.id === frameId) || frames[0];
    if (!frame) return { ok: false, error: "The debugger is not paused on a frame." };
    try {
      const res = await cdp.send("Debugger.evaluateOnCallFrame", {
        callFrameId: frame.id,
        expression: expr,
        silent: false,
        returnByValue: false,
        generatePreview: true,
      });
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        return { ok: false, error: d.exception?.description || d.text || "Evaluation failed." };
      }
      return {
        ok: true,
        result: remoteValue(res.result),
        type: remoteType(res.result),
        variablesReference: res.result?.objectId || 0,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
  try {
    const res = await session.dap.request("evaluate", {
      expression: expr,
      frameId: frameId || session.paused?.frames?.[0]?.id,
      context: "repl",
    });
    return {
      ok: true,
      result: res.result,
      type: res.type || "",
      variablesReference: res.variablesReference || 0,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function setBreakpoints(sessionId, file, breakpoints) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "Debug session not found." };
  if (session.type === "python") return applyPythonBreakpoints(session, file, breakpoints);
  return applyNodeBreakpoints(session, file, breakpoints);
}

async function getThreads(sessionId) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "Debug session not found.", threads: [] };
  if (session.type === "node") {
    return { ok: true, threads: [{ id: 1, name: "Main Thread" }] };
  }
  try {
    const res = await session.dap.request("threads", {});
    return { ok: true, threads: res.threads || [] };
  } catch (err) {
    return { ok: false, error: err.message, threads: [] };
  }
}

async function installDebugpy() {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const py = await findPython();
    if (!py) return { ok: false, error: "Python was not found on PATH." };
    return new Promise((resolve) => {
      execFile(
        py.cmd,
        [...py.base, "-m", "pip", "install", "--disable-pip-version-check", "--no-input", "debugpy"],
        { timeout: 300_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          const output = `${stdout || ""}${stderr || ""}`.trim();
          if (err) {
            resolve({ ok: false, error: err.message || "pip install failed", output });
            return;
          }
          debugpyCache = null;
          resolve({ ok: true, output: output.split(/\r?\n/).slice(-6).join("\n"), python: py.cmd });
        }
      );
    });
  })();
  try {
    return await installPromise;
  } finally {
    installPromise = null;
  }
}

async function availability(opts = {}) {
  const py = await findPython();
  const debugpy = py ? await checkDebugpy(py, opts?.force === true) : { ok: false, version: null };
  return {
    ok: true,
    node: process.version,
    python: py ? { cmd: py.cmd, version: py.version } : null,
    debugpy: { installed: !!debugpy.ok, version: debugpy.version || null },
  };
}

function listSessions() {
  // Terminated sessions are kept briefly for late stop/stack calls; they are
  // not "active" and should not be listed to callers.
  return [...sessions.values()].filter((s) => !s.terminated).map((s) => ({
    id: s.id,
    language: s.language,
    name: s.name,
    status: s.status,
    pid: s.pid || null,
  }));
}

function stopAll() {
  for (const session of sessions.values()) {
    if (session.terminated) continue;
    try { killTree(session.proc); } catch {}
    markTerminated(session, {});
  }
}

module.exports = {
  startDebug,
  control,
  stopSession,
  getStack,
  getScopes,
  getVariables,
  evaluate,
  setBreakpoints,
  getThreads,
  installDebugpy,
  availability,
  listSessions,
  stopAll,
  _sessions: sessions,
};
