"use strict";

const { app, ipcMain, session } = require("electron");
const { spawn } = require("child_process");
const { createServer } = require("net");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { getMcpUrl, syncOpenCodeConfig } = require("./mcp-server");

const instances = new Map();
const leases = new Map();
const watchedSenders = new WeakSet();

function getCliPath() {
  const appRoot = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked")
    : path.resolve(__dirname, "..", "..");
  const executable = process.platform === "win32" ? "opencode.exe" : "opencode";
  const cliPath = path.join(appRoot, "node_modules", "opencode-ai", "bin", executable);
  if (!fs.existsSync(cliPath)) {
    throw new Error("The OpenCode runtime is missing. Reinstall Idiot Box to restore it.");
  }
  return cliPath;
}

function reservePort(port) {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(port, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

// OpenCode's web UI stores its open tabs, last session, theme and model in
// localStorage, which is scoped to the origin — port included. A random port
// per launch therefore threw that state away every time and the panel always
// booted into a fresh "New session". Derive a stable port from the workspace
// so each project keeps its own origin (and history) across restarts. The
// 42000-43999 range sits below Windows' ephemeral ports (49152+); if the port
// is busy we fall back to any free one, which only costs that run's state.
function preferredPort(workspace) {
  let hash = 0;
  const key = String(workspace || "").toLowerCase();
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return 42000 + (hash % 2000);
}

async function getAvailablePort(workspace) {
  const preferred = preferredPort(workspace);
  try {
    return await reservePort(preferred);
  } catch {
    return reservePort(0);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// `opencode serve` enforces basic auth as soon as OPENCODE_SERVER_PASSWORD is
// present in the environment (leaks in easily from an OpenCode parent process).
// Without credentials every probe answer is 401, so the panel never boots.
const panelCredentials = new Map();
let panelAuthorizationInstalled = false;

function getServerCredentials() {
  const password = process.env.OPENCODE_SERVER_PASSWORD;
  if (!password) return null;
  return { username: process.env.OPENCODE_SERVER_USERNAME || "opencode", password };
}

function authorizationHeader(credentials) {
  return `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`;
}

function installPanelAuthorization() {
  if (panelAuthorizationInstalled) return;
  panelAuthorizationInstalled = true;
  session.fromPartition("persist:opencode-panel").webRequest.onBeforeSendHeaders(
    { urls: ["http://127.0.0.1/*"] },
    (details, callback) => {
      const credentials = panelCredentials.get(new URL(details.url).port);
      if (credentials) details.requestHeaders.Authorization = authorizationHeader(credentials);
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

async function waitForOpenCode(instance) {
  const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");
  const headers = instance.credentials ? { Authorization: authorizationHeader(instance.credentials) } : undefined;
  const client = createOpencodeClient({
    baseUrl: instance.url,
    headers,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(1500) }),
  });
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    if (instance.stopping) throw new Error("OpenCode startup was cancelled.");
    if (instance.failure) throw instance.failure;
    try {
      const health = await client.global.health();
      if (health?.error) {
        const status = health.response?.status;
        throw new Error(`OpenCode health check failed${status ? ` (HTTP ${status})` : " before the server answered"}.`);
      }
      const response = await fetch(instance.url, { headers, signal: AbortSignal.timeout(1500) });
      const servesWebUi = response.ok && response.headers.get("content-type")?.includes("text/html");
      await response.body?.cancel();
      if (!servesWebUi) {
        throw new Error(`OpenCode started without serving its web interface (HTTP ${response.status || "no response"}).`);
      }
      return;
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }

  const tail = instance.childLogs ? `\nOpenCode server log tail:\n${instance.childLogs.slice(-20).join("\n")}` : "";
  throw new Error(`OpenCode did not become ready in time${lastError ? `: ${lastError.message}` : "."}${tail}`);
}

// The panel used to open `/<project>/session`, which always creates a new
// session — that is why every reopen looked like a fresh boot. Pick the most
// recently updated session for this workspace so the panel resumes it, and
// let the renderer fall back to a new session when there is none.
async function latestSessionId(instance) {
  try {
    const headers = instance.credentials ? { Authorization: authorizationHeader(instance.credentials) } : undefined;
    const response = await fetch(`${instance.url}/session`, { headers, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const sessions = await response.json();
    if (!Array.isArray(sessions) || !sessions.length) return null;
    const normalize = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const directory = normalize(instance.workspace);
    const match = sessions
      .filter((session) => normalize(session?.directory) === directory)
      .sort((a, b) => (b?.time?.updated ?? 0) - (a?.time?.updated ?? 0))[0];
    return match?.id || null;
  } catch {
    return null;
  }
}

async function startInstance(workspace, instance) {
  const cliPath = getCliPath();
  const port = await getAvailablePort(workspace);
  if (instance.stopping) throw new Error("OpenCode startup was cancelled.");
  instance.url = `http://127.0.0.1:${port}`;
  instance.port = String(port);
  instance.credentials = getServerCredentials();
  if (instance.credentials) {
    panelCredentials.set(instance.port, instance.credentials);
    installPanelAuthorization();
  }
  try {
    const mcpUrl = getMcpUrl?.();
    if (mcpUrl && syncOpenCodeConfig) syncOpenCodeConfig(mcpUrl, workspace);
  } catch (syncErr) {
    console.warn("[OpenCode panel] Failed to sync MCP config:", syncErr && syncErr.message);
  }
  const childLogs = [];
  const child = spawn(cliPath, [
    "serve",
    "--hostname", "127.0.0.1",
    "--port", String(port),
  ], {
    cwd: workspace,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  instance.childLogs = childLogs;
  child.stdout?.on("data", (d) => { childLogs.push(d.toString().trim()); if (childLogs.length > 80) childLogs.shift(); });
  child.stderr?.on("data", (d) => { childLogs.push(`stderr: ${d.toString().trim()}`); if (childLogs.length > 80) childLogs.shift(); });
  instance.child = child;
  child.once("error", (error) => { instance.failure = error; });
  child.once("exit", (code, signal) => {
    if (!instance.stopping) {
      instance.failure = new Error(`OpenCode exited before the panel closed (code ${code ?? "unknown"}, signal ${signal || "none"}).`);
      if (instances.get(workspace) === instance) instances.delete(workspace);
    }
  });

  try {
    await waitForOpenCode(instance);
    instance.lastSessionId = await latestSessionId(instance);
  } catch (error) {
    await stopInstance(instance);
    const tail = instance.childLogs ? `\nOpenCode server log tail:\n${instance.childLogs.slice(-20).join("\n")}` : "";
    throw new Error(`Could not start OpenCode: ${error.message}${tail}`);
  }
}

function stopInstance(instance) {
  if (instance.stopPromise) return instance.stopPromise;
  instance.stopping = true;
  if (instance.port) panelCredentials.delete(instance.port);
  if (instances.get(instance.workspace) === instance) instances.delete(instance.workspace);
  if (!instance.child || instance.child.exitCode !== null || instance.child.signalCode !== null) {
    instance.stopPromise = Promise.resolve();
    return instance.stopPromise;
  }
  instance.stopPromise = new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      instance.child.removeListener("close", finish);
      resolve();
    };
    const timer = setTimeout(finish, 3000);
    instance.child.once("close", finish);
    try { instance.child.kill(); } catch { finish(); }
  });
  return instance.stopPromise;
}

async function releaseLease(leaseId, senderId) {
  const lease = leases.get(leaseId);
  if (!lease || lease.senderId !== senderId) return false;
  leases.delete(leaseId);
  const instance = lease.instance;
  instance.leases.delete(leaseId);
  if (!instance.leases.size) await stopInstance(instance);
  return true;
}

async function acquireInstance(rootPath, sender, getActiveProjectPath) {
  const requestedRoot = await fs.promises.realpath(String(rootPath || ""));
  const activeRoot = getActiveProjectPath?.();
  if (!activeRoot || await fs.promises.realpath(activeRoot) !== requestedRoot) {
    throw new Error("Open a project folder before starting the OpenCode panel.");
  }
  if (!(await fs.promises.stat(requestedRoot)).isDirectory()) {
    throw new Error("The active project path is not a directory.");
  }

  let instance = instances.get(requestedRoot);
  if (!instance) {
    instance = { workspace: requestedRoot, url: "", child: null, leases: new Set(), failure: null, stopping: false, ready: null };
    instances.set(requestedRoot, instance);
    instance.ready = startInstance(requestedRoot, instance).then(() => {
      instance.ready = null;
    }).catch((error) => {
      if (instances.get(requestedRoot) === instance) instances.delete(requestedRoot);
      throw error;
    });
  }
  if (instance.ready) await instance.ready;

  const leaseId = randomUUID();
  instance.leases.add(leaseId);
  leases.set(leaseId, { workspace: requestedRoot, senderId: sender.id, instance });
  if (!watchedSenders.has(sender)) {
    watchedSenders.add(sender);
    sender.once("destroyed", () => {
      for (const [id, lease] of leases) {
        if (lease.senderId === sender.id) void releaseLease(id, sender.id);
      }
    });
  }
  return { url: instance.url, leaseId, lastSessionId: instance.lastSessionId || null };
}

function registerOpenCodePanel(getActiveProjectPath) {
  ipcMain.handle("opencode-panel:start", (event, rootPath) => acquireInstance(rootPath, event.sender, getActiveProjectPath));
  ipcMain.handle("opencode-panel:stop", (event, leaseId) => releaseLease(String(leaseId || ""), event.sender.id));
  app.once("before-quit", () => {
    for (const instance of instances.values()) void stopInstance(instance);
    instances.clear();
    leases.clear();
    panelCredentials.clear();
  });
}

module.exports = { registerOpenCodePanel };
