"use strict";

const { app, ipcMain } = require("electron");
const { spawn } = require("child_process");
const { createServer } = require("net");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

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

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOpenCode(instance) {
  const { createOpencodeClient } = await import("@opencode-ai/sdk/v2");
  const client = createOpencodeClient({
    baseUrl: instance.url,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(1500) }),
  });
  const deadline = Date.now() + 30000;
  let lastError;

  while (Date.now() < deadline) {
    if (instance.stopping) throw new Error("OpenCode startup was cancelled.");
    if (instance.failure) throw instance.failure;
    try {
      await client.global.health();
      const response = await fetch(instance.url, { signal: AbortSignal.timeout(1500) });
      const servesWebUi = response.ok && response.headers.get("content-type")?.includes("text/html");
      await response.body?.cancel();
      if (!servesWebUi) {
        throw new Error("OpenCode started without serving its web interface.");
      }
      return;
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }

  throw new Error(`OpenCode did not become ready in time${lastError ? `: ${lastError.message}` : "."}`);
}

async function startInstance(workspace, instance) {
  const cliPath = getCliPath();
  const port = await getAvailablePort();
  if (instance.stopping) throw new Error("OpenCode startup was cancelled.");
  instance.url = `http://127.0.0.1:${port}`;
  const child = spawn(cliPath, [
    "serve",
    "--hostname", "127.0.0.1",
    "--port", String(port),
  ], {
    cwd: workspace,
    env: process.env,
    stdio: "ignore",
    windowsHide: true,
  });
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
  } catch (error) {
    await stopInstance(instance);
    throw new Error(`Could not start OpenCode: ${error.message}`);
  }
}

function stopInstance(instance) {
  if (instance.stopPromise) return instance.stopPromise;
  instance.stopping = true;
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
  return { url: instance.url, leaseId };
}

function registerOpenCodePanel(getActiveProjectPath) {
  ipcMain.handle("opencode-panel:start", (event, rootPath) => acquireInstance(rootPath, event.sender, getActiveProjectPath));
  ipcMain.handle("opencode-panel:stop", (event, leaseId) => releaseLease(String(leaseId || ""), event.sender.id));
  app.once("before-quit", () => {
    for (const instance of instances.values()) void stopInstance(instance);
    instances.clear();
    leases.clear();
  });
}

module.exports = { registerOpenCodePanel };
