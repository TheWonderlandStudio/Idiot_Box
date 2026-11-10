// ─── Desktop (QEMU) Emulator manager ────────────────────────────────────────
// VM files live under the selected storage directory:
//
//   <selected-folder>/<name>/
//   ├── vm.json
//   ├── disk.qcow2
//   ├── runtime.json
//   └── logs/            ← QEMU stdout + serial logs
//
// The selected storage path preference is saved in Electron userData. The app
// never runs a QEMU installer.
// QEMU's VNC framebuffer is streamed into the panel over a loopback WebSocket;
// guests have no host-folder, host-device, or network access by default.
const path = require("path");
const fs = require("fs");
const net = require("net");
const { WebSocket, WebSocketServer } = require("ws");
const { spawn, execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

let _deps = null; // { app, BrowserWindow, shell, dialog }
function deps() {
  if (!_deps) {
    const { app, BrowserWindow, shell, dialog } = require("electron");
    _deps = { app, BrowserWindow, shell, dialog };
  }
  return _deps;
}

// ─── Paths ──────────────────────────────────────────────────────────────────
function getQemuRoot() {
  const { app } = deps();
  return path.join(app.getPath("userData"), ".appdata", "qemu");
}
function getLegacyVmsDir() { return path.join(getQemuRoot(), "vms"); }
function getVmsDir() {
  const configured = readSettings().vmStorageDir;
  return typeof configured === "string" && configured ? configured : getLegacyVmsDir();
}
function getSettingsPath() { return path.join(getQemuRoot(), "settings.json"); }
function vmDir(name) { return path.join(getVmsDir(), name); }
function vmRoots() {
  const settings = readSettings();
  const savedRoots = Array.isArray(settings.vmStorageDirs)
    ? settings.vmStorageDirs.filter((root) => typeof root === "string" && root)
    : [];
  return [...new Set([getVmsDir(), ...savedRoots, getLegacyVmsDir()])];
}
function resolveVmDir(name) {
  const safeName = sanitizeVmName(name);
  for (const root of vmRoots()) {
    const folder = path.join(root, safeName);
    try {
      if (!fs.lstatSync(folder).isDirectory()) continue;
      if (!fs.lstatSync(path.join(folder, "vm.json")).isFile()) continue;
      return folder;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}
function vmLogsDir(name) { return path.join(resolveVmDir(name) || vmDir(name), "logs"); }
function vmLogPath(name) { return path.join(vmLogsDir(name), "qemu.log"); }
function vmRuntimePath(name) { return path.join(resolveVmDir(name) || vmDir(name), "runtime.json"); }
function ensureVmLogsDir(name) {
  const folder = resolveVmDir(name);
  if (!folder) throw new Error(`VM "${name}" storage folder was not found.`);
  const logsDir = path.join(folder, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  if (!fs.lstatSync(logsDir).isDirectory()) throw new Error(`VM "${name}" logs path must be a folder inside its VM folder.`);
  for (const file of [path.join(logsDir, "qemu.log"), path.join(logsDir, "serial.log")]) {
    try {
      const info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) {
        throw new Error(`VM "${name}" log files must be regular files inside its VM folder.`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return logsDir;
}

const isWin = () => process.platform === "win32";
const exe = (n) => (isWin() ? `${n}.exe` : n);

// ─── Catalogs ───────────────────────────────────────────────────────────────
const ARCHES = [
  { id: "x86_64", label: "x86_64 — 64-bit PC (Windows/Linux x64)" },
  { id: "i386", label: "i386 — 32-bit PC" },
  { id: "aarch64", label: "aarch64 — ARM64 (virt)" },
  { id: "arm", label: "arm — ARM32 (virt)" },
  { id: "riscv64", label: "riscv64 (virt)" },
  { id: "ppc64", label: "ppc64 (pseries)" },
  { id: "s390x", label: "s390x (IBM Z)" },
];
// Official ISO download links shown in the panel's Create form. Nothing is
// bundled or downloaded by the app — these only open the vendor's page / file
// in the user's browser. `page` is always valid; `iso` is a direct image link
// (versioned filenames age — the page link is the fallback).
const ISO_CATALOG = [
  {
    id: "ubuntu-desktop", name: "Ubuntu 24.04 LTS Desktop", arch: "x86_64", note: "~5.9 GB · full desktop",
    iso: "https://releases.ubuntu.com/24.04/ubuntu-24.04.5.1-desktop-amd64.iso",
    page: "https://releases.ubuntu.com/24.04/",
  },
  {
    id: "ubuntu-server", name: "Ubuntu 24.04 LTS Server", arch: "x86_64", note: "~3.9 GB · text installer",
    iso: "https://releases.ubuntu.com/24.04/ubuntu-24.04.5-live-server-amd64.iso",
    page: "https://releases.ubuntu.com/24.04/",
  },
  {
    id: "ubuntu-server-arm64", name: "Ubuntu 24.04 LTS Server (ARM64)", arch: "aarch64", note: "~3.6 GB · boots with arch aarch64 · virt",
    iso: "https://cdimage.ubuntu.com/releases/24.04/release/ubuntu-24.04.5-live-server-arm64.iso",
    page: "https://cdimage.ubuntu.com/releases/24.04/release/",
  },
  {
    id: "debian", name: "Debian 13 netinst", arch: "x86_64", note: "~756 MB · smallest full installer",
    iso: "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.7.0-amd64-netinst.iso",
    page: "https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/",
  },
  {
    id: "fedora", name: "Fedora Workstation 45", arch: "x86_64", note: "~2.5 GB · GNOME live",
    iso: "https://download.fedoraproject.org/pub/fedora/linux/releases/45/Workstation/x86_64/iso/Fedora-Workstation-Live-45-1.4.x86_64.iso",
    page: "https://fedoraproject.org/workstation/download",
  },
  {
    id: "alpine", name: "Alpine Linux Standard", arch: "x86_64", note: "~353 MB · tiny, fast boot",
    iso: "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/x86_64/alpine-standard-3.24.4-x86_64.iso",
    page: "https://alpinelinux.org/downloads/",
  },
  {
    id: "alpine-arm64", name: "Alpine Linux Standard (ARM64)", arch: "aarch64", note: "~376 MB · boots with arch aarch64 · virt",
    iso: "https://dl-cdn.alpinelinux.org/alpine/latest-stable/releases/aarch64/alpine-standard-3.24.4-aarch64.iso",
    page: "https://alpinelinux.org/downloads/",
  },
  {
    id: "arch", name: "Arch Linux", arch: "x86_64", note: "~1.3 GB · rolling release",
    iso: "https://geo.mirror.pkgbuild.com/iso/latest/archlinux-x86_64.iso",
    page: "https://archlinux.org/download/",
  },
  {
    id: "kali", name: "Kali Linux Installer", arch: "x86_64", note: "~4 GB · security distro",
    iso: "https://cdimage.kali.org/current/kali-linux-2026.3-installer-amd64.iso",
    page: "https://www.kali.org/get-kali/",
  },
  {
    id: "mint", name: "Linux Mint", arch: "x86_64", note: "Cinnamon / MATE / Xfce — pick on the page",
    iso: null,
    page: "https://linuxmint.com/download.php",
  },
  {
    id: "windows11", name: "Windows 11", arch: "x86_64", note: "Microsoft requires its download tool / page",
    iso: null,
    page: "https://www.microsoft.com/software-download/windows11",
  },
  {
    id: "freebsd", name: "FreeBSD", arch: "x86_64", note: "disc1 ISO — pick the release on the page",
    iso: null,
    page: "https://www.freebsd.org/where/",
  },
  {
    id: "reactos", name: "ReactOS", arch: "i386", note: "lightweight Windows-compatible OS",
    iso: null,
    page: "https://reactos.org/download/",
  },
];
// Per-arch machine/cpu defaults (x86 uses the QEMU default "pc").
const ARCH_MACHINE = {
  aarch64: ["-machine", "virt", "-cpu", "cortex-a72"],
  arm: ["-machine", "virt", "-cpu", "cortex-a15"],
  riscv64: ["-machine", "virt", "-cpu", "rv64"],
  ppc64: ["-machine", "pseries"],
  s390x: ["-machine", "s390-ccw"],
};
function archBinary(arch) { return exe(`qemu-system-${arch}`); }
function isKnownArch(a) { return ARCHES.some((x) => x.id === a); }

// ─── Settings (custom QEMU install dir) ─────────────────────────────────────
function readSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), "utf8");
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? j : {};
  } catch { return {}; }
}
function writeSettings(patch) {
  fs.mkdirSync(getQemuRoot(), { recursive: true });
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(getSettingsPath(), JSON.stringify(next, null, 2));
  return next;
}

// ─── QEMU detection ─────────────────────────────────────────────────────────
function candidateDirs() {
  const dirs = [];
  const custom = readSettings().qemuBinDir;
  if (custom) dirs.push(String(custom));
  dirs.push(path.join(getQemuRoot(), "bin"));
  if (isWin()) {
    dirs.push("C:\\Program Files\\qemu");
    dirs.push(path.join(process.env.LOCALAPPDATA || "", "Programs", "qemu"));
  } else if (process.platform === "darwin") {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  } else {
    dirs.push("/usr/bin", "/usr/local/bin", "/opt/qemu/bin");
  }
  return [...new Set(dirs.filter(Boolean))];
}
function findQemuBinFile(arch) {
  const bin = archBinary(arch);
  for (const d of candidateDirs()) {
    const p = path.join(d, bin);
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}
function findQemuImgFile() {
  for (const d of candidateDirs()) {
    const p = path.join(d, exe("qemu-img"));
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}
function parseQemuVersion(out) {
  const m = String(out || "").match(/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : null;
}
// PATH probe (cached 30s — getState is polled by the panel).
let _pathProbe = { at: 0, result: null };
function probePathQemu(arch) {
  const now = Date.now();
  if (_pathProbe.result && now - _pathProbe.at < 30000 && _pathProbe.result.arch === arch) {
    return Promise.resolve(_pathProbe.result);
  }
  return new Promise((resolve) => {
    execFile(archBinary(arch), ["--version"], { encoding: "utf8", timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      const out = String(stdout || "") + String(stderr || "");
      const version = err ? null : parseQemuVersion(out);
      const result = { arch, found: !err && !!version, version };
      _pathProbe = { at: now, result };
      resolve(result);
    });
  });
}
async function detectQemu() {
  // Default-arch probe for the headline "QEMU installed?" status.
  const fileBin = findQemuBinFile("x86_64");
  if (fileBin) {
    const version = await new Promise((r) => {
      execFile(fileBin, ["--version"], { encoding: "utf8", timeout: 8000, windowsHide: true }, (e, so, se) => r(e ? null : parseQemuVersion(String(so || "") + String(se || ""))));
    });
    return { found: true, bin: fileBin, version, qemuImg: findQemuImgFile(), source: "file" };
  }
  const probed = await probePathQemu("x86_64");
  if (probed.found) {
    return { found: true, bin: archBinary("x86_64"), version: probed.version, qemuImg: findQemuImgFile(), source: "PATH" };
  }
  return { found: false, bin: null, version: null, qemuImg: findQemuImgFile(), source: null };
}
async function resolveArchBin(arch) {
  const fileBin = findQemuBinFile(arch);
  if (fileBin) return fileBin;
  const probed = await probePathQemu(arch);
  if (probed.found) return archBinary(arch);
  throw new Error(
    `qemu-system-${arch} not found. Select an existing or portable QEMU folder containing that binary via "Custom QEMU folder…".`
  );
}

// ─── VM config ──────────────────────────────────────────────────────────────
function sanitizeVmName(name) {
  const n = String(name || "").trim();
  if (!/^[A-Za-z0-9_.\-]{1,48}$/.test(n) || n === "." || n === "..") {
    throw new Error("VM name may only contain letters, numbers, _, - and . (max 48 chars).");
  }
  return n;
}
function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
function validateVmConfig(payload = {}) {
  const name = sanitizeVmName(payload.name);
  const arch = isKnownArch(payload.arch) ? payload.arch : "x86_64";
  const memoryMb = clampInt(payload.memoryMb ?? payload.memory, 128, 65536, 2048);
  const cpus = clampInt(payload.cpus, 1, 32, 2);
  const diskGb = clampInt(payload.diskGb ?? payload.disk, 1, 512, 20);
  let iso = payload.iso ? String(payload.iso).trim() : "";
  if (iso && !fs.existsSync(iso)) throw new Error(`ISO not found: ${iso}`);
  return { name, arch, memoryMb, cpus, diskGb, iso: iso || null };
}
function readVmConfig(name) {
  try {
    const folder = resolveVmDir(name);
    if (!folder) return null;
    const raw = fs.readFileSync(path.join(folder, "vm.json"), "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object" && j.name) return j;
  } catch {}
  return null;
}
function listVmNames() {
  const names = new Set();
  for (const root of vmRoots()) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && /^[A-Za-z0-9_.-]{1,48}$/.test(entry.name) &&
            entry.name !== "." && entry.name !== ".." && readVmConfig(entry.name)) names.add(entry.name);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return [...names].sort();
}
function describeVm(name) {
  const cfg = readVmConfig(name) || { name, arch: "x86_64", memoryMb: 2048, cpus: 2, diskGb: 20, iso: null };
  const folder = resolveVmDir(name) || vmDir(name);
  const disk = path.join(folder, cfg.diskFormat === "raw" ? "disk.img" : "disk.qcow2");
  let diskBytes = 0;
  try {
    const diskInfo = fs.lstatSync(disk);
    if (diskInfo.isFile() && !diskInfo.isSymbolicLink() && diskInfo.nlink === 1) diskBytes = diskInfo.size;
  } catch {}
  const running = runningVms.get(name);
  return {
    ...cfg,
    disk,
    diskBytes,
    storageDir: folder,
    running: !!running,
    pid: running?.pid || null,
    websocketPort: running?.websocketPort || null,
    recoveryError: vmRecoveryErrors.get(name) || null,
  };
}

// ─── Progress broadcast (mirrors android:progress) ──────────────────────────
function broadcast(payload) {
  try {
    const { BrowserWindow } = deps();
    for (const win of BrowserWindow.getAllWindows()) {
      try { if (!win.isDestroyed()) win.webContents.send("qemu:progress", payload); } catch {}
    }
  } catch {}
}
const progress = (op, phase, message, percent = null, extra = null) =>
  broadcast({ op, phase, message, percent, ...(extra || {}), at: Date.now() });

// ─── QEMU args ──────────────────────────────────────────────────────────────
// Pure (exported for tests): everything needed to boot a VM with in-app VNC.
function buildQemuArgs(vm, { disk, iso, monitorPort, vncDisplay, serialLog }) {
  const args = [];
  if (ARCH_MACHINE[vm.arch]) args.push(...ARCH_MACHINE[vm.arch]);
  args.push("-m", String(vm.memoryMb), "-smp", String(vm.cpus));
  const isX86 = vm.arch === "x86_64" || vm.arch === "i386";
  args.push("-drive", `file=${disk},format=${vm.diskFormat === "raw" ? "raw" : "qcow2"},if=${isX86 ? "ide" : "virtio"}`);
  if (iso) args.push("-cdrom", iso, "-boot", "order=d");
  else args.push("-boot", "order=c");
  args.push("-net", "none");
  // Use a localhost VNC server; noVNC renders its incremental framebuffer in-app.
  // x86 has UHCI by default; other machines need an explicit XHCI controller.
  if (isX86) args.push("-usb", "-device", "usb-tablet");
  else args.push("-device", "qemu-xhci", "-device", "usb-tablet", "-device", "usb-kbd");
  args.push("-display", "none", "-vnc", `127.0.0.1:${vncDisplay}`);
  // QMP (JSON) instead of the human monitor: deterministic replies, and it
  // exposes input-send-event for real mouse/keyboard input.
  args.push("-qmp", `tcp:127.0.0.1:${monitorPort},server,nowait`);
  if (serialLog) args.push("-serial", `file:${serialLog}`);
  return args;
}

// ─── Running processes ──────────────────────────────────────────────────────
const runningVms = new Map(); // name -> { pid, child, startedAt, monitorPort, logFile }
const vmRecoveryErrors = new Map();
let startupRecovery = null;
const QEMU_LOG_TAB = "qemu-log"; // must match renderer index.jsx

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}
function listQemuProcesses() {
  const command = isWin()
    ? execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "$p = @(Get-CimInstance Win32_Process -Filter \"Name LIKE 'qemu-system-%'\" | Select-Object ProcessId, CommandLine); ConvertTo-Json -InputObject $p -Compress",
    ], { encoding: "utf8", timeout: 10000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    : execFileAsync("ps", ["-eo", "pid=,args="], { encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  return new Promise((resolve, reject) => {
    command.then(({ stdout }) => {
      if (isWin()) {
        try {
          const parsed = JSON.parse(stdout || "[]");
          resolve((Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).map((proc) => ({
            pid: Number(proc.ProcessId),
            commandLine: String(proc.CommandLine || ""),
          })));
        } catch (e) {
          reject(new Error(`Could not read running QEMU process details: ${e.message}`));
        }
        return;
      }
      resolve(String(stdout || "").split(/\r?\n/).flatMap((line) => {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        return match ? [{ pid: Number(match[1]), commandLine: match[2] }] : [];
      }));
    }, reject);
  });
}
function parseQemuRuntimeArgs(commandLine, disk) {
  const normalizedDisk = path.resolve(disk).replace(/\//g, "\\").toLowerCase();
  const normalizedCommand = String(commandLine || "").replace(/\//g, "\\").toLowerCase();
  if (!normalizedCommand.includes(normalizedDisk)) return null;
  const monitor = String(commandLine).match(/(?:^|\s)-qmp\s+(?:"?tcp:)?127\.0\.0\.1:(\d+)/i);
  if (!monitor) return null;
  const vnc = String(commandLine).match(/(?:^|\s)-vnc\s+127\.0\.0\.1:(\d+)/i);
  const vncDisplay = vnc ? Number(vnc[1]) : null;
  if (vncDisplay !== null && (vncDisplay < 0 || vncDisplay > 99)) return null;
  return { monitorPort: Number(monitor[1]), vncDisplay };
}
function writeRuntimeState(name, entry) {
  const file = vmRuntimePath(name);
  const tempFile = `${file}.${process.pid}.tmp`;
  const contents = JSON.stringify({
    version: 1,
    pid: entry.pid,
    monitorPort: entry.monitorPort,
    vncDisplay: entry.vncDisplay,
    startedAt: entry.startedAt,
  });
  try {
    fs.writeFileSync(tempFile, contents, { flag: "w" });
    fs.renameSync(tempFile, file);
  } catch (e) {
    try { fs.unlinkSync(tempFile); } catch {}
    throw e;
  }
}
function clearRuntimeState(name) {
  try { fs.unlinkSync(vmRuntimePath(name)); }
  catch (e) { if (e.code !== "ENOENT") console.warn(`[qemu] could not remove runtime state for ${name}: ${e.message}`); }
}
function readRuntimeState(name) {
  try {
    const data = JSON.parse(fs.readFileSync(vmRuntimePath(name), "utf8"));
    if (data?.version !== 1 || !Number.isInteger(data.pid) || data.pid <= 0 ||
        !Number.isInteger(data.monitorPort) || data.monitorPort < 1 || data.monitorPort > 65535 ||
        !Number.isInteger(data.vncDisplay) || data.vncDisplay < 0 || data.vncDisplay > 99) return null;
    return data;
  } catch { return null; }
}
function isProcessRunning(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}
async function waitForProcessExit(pid, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessRunning(pid);
}
async function getFreeVncDisplay() {
  for (let display = 0; display < 100; display++) {
    const server = net.createServer();
    const available = await new Promise((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(5900 + display, "127.0.0.1", () => server.close(() => resolve(true)));
    });
    if (available) return display;
  }
  throw new Error("No free local VNC display is available (ports 5900–5999).");
}
function createVncWebSocketProxy(vncPort) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0, perMessageDeflate: false });
  server.on("connection", (ws) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: vncPort });
    socket.on("data", (chunk) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
    });
    socket.on("error", () => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1011, "QEMU VNC connection failed");
    });
    socket.on("close", () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });
    ws.on("message", (data) => {
      if (!socket.destroyed) socket.write(data);
    });
    ws.on("close", () => socket.destroy());
    ws.on("error", () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      server.removeListener("error", reject);
      resolve({ server, port: server.address().port });
    });
  });
}
function closeVncWebSocketProxy(proxy) {
  if (!proxy) return Promise.resolve();
  if (proxy.closing) return proxy.closing;
  for (const client of proxy.server.clients) client.terminate();
  proxy.closing = new Promise((resolve) => proxy.server.close(() => resolve()));
  return proxy.closing;
}
function waitForTcpPort(port, child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      child?.removeListener("error", onError);
      child?.removeListener("exit", onExit);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onError = (error) => finish(new Error(`Could not launch QEMU: ${error.message}`));
    const onExit = (code, signal) => finish(new Error(`QEMU exited before its display was ready (code ${code ?? "unknown"}${signal ? `, signal ${signal}` : ""}).`));
    child?.once("error", onError);
    child?.once("exit", onExit);
    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); finish(); });
      socket.once("error", () => {
        socket.destroy();
        if (settled) return;
        if (child && (child.exitCode !== null || child.signalCode !== null)) return onExit(child.exitCode, child.signalCode);
        timer = setTimeout(attempt, 100);
      });
    };
    attempt();
    timer = setTimeout(() => finish(new Error(`QEMU's VNC display did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds.`)), timeoutMs);
  });
}
function readQemuLog(name, logDir = null) {
  const file = logDir
    ? path.join(logDir, `${sanitizeVmName(name)}.log`)
    : vmLogPath(name);
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) {
      throw new Error("QEMU log must be a regular file.");
    }
    const contents = fs.readFileSync(file, "utf8");
    return { ok: true, text: contents.slice(-200000), truncated: contents.length > 200000 };
  } catch (error) {
    if (error.code === "ENOENT") return { ok: true, text: "", truncated: false };
    throw error;
  }
}
async function findExistingQemu(name, disk) {
  const runtime = readRuntimeState(name);
  const processes = await listQemuProcesses();
  const normalizedDisk = path.resolve(disk).replace(/\//g, "\\").toLowerCase();
  const processInfo = processes.find((proc) =>
    proc.pid > 0 && String(proc.commandLine).replace(/\//g, "\\").toLowerCase().includes(normalizedDisk));
  if (!processInfo) {
    if (runtime) clearRuntimeState(name);
    return null;
  }
  const commandArgs = parseQemuRuntimeArgs(processInfo.commandLine, disk);
  const monitorPort = commandArgs?.monitorPort || (runtime?.pid === processInfo.pid ? runtime.monitorPort : null);
  if (!monitorPort) {
    throw new Error(`Found an existing QEMU process using "${name}", but it has no recoverable QMP port. Close that QEMU process, then retry.`);
  }
  return {
    pid: processInfo.pid,
    monitorPort,
    vncDisplay: commandArgs?.vncDisplay ?? (runtime?.pid === processInfo.pid ? runtime.vncDisplay : null),
    startedAt: runtime?.pid === processInfo.pid ? runtime.startedAt : Date.now(),
    logFile: vmLogPath(name),
  };
}
async function recoverExistingQemu(name, disk) {
  const found = await findExistingQemu(name, disk);
  if (!found) return null;
  const entry = { ...found, child: null, websocketPort: null, vncProxy: null };
  runningVms.set(name, entry);
  try {
    await qmpCommand(name, "query-status");
    if (entry.vncDisplay === null) {
      await qmpCommand(name, "quit", null, 3000);
      qmpClose(name);
      runningVms.delete(name);
      if (!await waitForProcessExit(entry.pid)) {
        throw new Error(`QEMU is still using "${name}"'s disk. Close its existing window, then retry.`);
      }
      clearRuntimeState(name);
      vmRecoveryErrors.delete(name);
      return null;
    }
    await waitForTcpPort(5900 + entry.vncDisplay, null, 5000);
    entry.vncProxy = await createVncWebSocketProxy(5900 + entry.vncDisplay);
    entry.websocketPort = entry.vncProxy.port;
    writeRuntimeState(name, entry);
    vmRecoveryErrors.delete(name);
    progress("start", "recovered", `${name} was recovered from the previous app session.`, null, { vm: name });
    return entry;
  } catch (error) {
    qmpClose(name);
    runningVms.delete(name);
    await closeVncWebSocketProxy(entry.vncProxy);
    if (error?.code === "ECONNREFUSED" || /QMP connect timed out/i.test(error?.message || "")) {
      throw new Error(`Found an existing QEMU process using "${name}", but its control socket is unavailable. Close that QEMU process before starting the VM again.`);
    }
    throw error;
  }
}
async function recoverVmsAtStartup(names) {
  if (!startupRecovery) {
    startupRecovery = Promise.all(names.map(async (name) => {
      try {
        const cfg = readVmConfig(name);
        if (cfg) await recoverExistingQemu(name, describeVm(name).disk);
        vmRecoveryErrors.delete(name);
      } catch (error) {
        const message = error?.message || String(error);
        vmRecoveryErrors.set(name, message);
        console.warn(`[qemu] could not recover ${name}: ${message}`);
      }
    }));
  }
  await startupRecovery;
}
function forwardOut(name, chunk, logFile) {
  try {
    let text = String(chunk.toString("utf8") || "");
    if (!text) return;
    try { fs.appendFileSync(logFile, text); } catch {}
    text = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    if (text.length > 32768) text = text.slice(0, 32768) + "\r\n[…truncated]\r\n";
    const { BrowserWindow } = deps();
    for (const win of BrowserWindow.getAllWindows()) {
      try { if (!win.isDestroyed()) win.webContents.send("terminal:data", { tabId: QEMU_LOG_TAB, data: text }); } catch {}
    }
  } catch {}
}

async function startVmProcess(name) {
  const cfg = readVmConfig(name);
  if (!cfg) throw new Error(`VM "${name}" not found.`);
  const cur = runningVms.get(name);
  if (cur) {
    if (isProcessRunning(cur.pid)) return cur;
    runningVms.delete(name);
    qmpClose(name);
    await closeVncWebSocketProxy(cur.vncProxy);
    clearRuntimeState(name);
  }
  const bin = await resolveArchBin(cfg.arch);
  const disk = describeVm(name).disk;
  if (!fs.existsSync(disk)) throw new Error(`Disk image missing for "${name}" — recreate the VM.`);
  const diskInfo = fs.lstatSync(disk);
  if (!diskInfo.isFile() || diskInfo.isSymbolicLink() || diskInfo.nlink > 1) {
    throw new Error(`VM disk for "${name}" must be a regular, unlinked file inside its VM folder.`);
  }
  const recovered = await recoverExistingQemu(name, disk);
  if (recovered) return recovered;
  const monitorPort = await getFreePort();
  const vncDisplay = await getFreeVncDisplay();
  const vncPort = 5900 + vncDisplay;
  const folder = resolveVmDir(name);
  if (!folder) throw new Error(`VM "${name}" storage folder was not found.`);
  const logsDir = ensureVmLogsDir(name);
  const logFile = vmLogPath(name);
  const serialLog = path.join(logsDir, "serial.log");
  const args = buildQemuArgs(cfg, { disk, iso: cfg.iso, monitorPort, vncDisplay, serialLog });
  const child = spawn(bin, args, {
    env: { ...process.env },
    detached: true,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: folder,
  });
  child.unref();
  const pid = child.pid;
  try { child.stdout.on("data", (d) => forwardOut(name, d, logFile)); } catch {}
  try { child.stderr.on("data", (d) => forwardOut(name, d, logFile)); } catch {}
  let vncProxy = null;
  const t0 = Date.now();
  child.on("exit", (code) => {
    if (runningVms.get(name)?.pid === child.pid) runningVms.delete(name);
    qmpClose(name);
    closeVncWebSocketProxy(vncProxy);
    try {
      const { BrowserWindow } = deps();
      for (const win of BrowserWindow.getAllWindows()) {
        try { if (!win.isDestroyed()) win.webContents.send("terminal:exit", { tabId: QEMU_LOG_TAB, code: code ?? 0 }); } catch {}
      }
    } catch {}
    if (Date.now() - t0 < 15000) {
      progress("start", "error", `${name}: QEMU exited too quickly (code ${code}) — check the log (panel → Log tab).`, null, { vm: name });
    }
  });
  try {
    await waitForTcpPort(vncPort, child);
    vncProxy = await createVncWebSocketProxy(vncPort);
  } catch (e) {
    try { child.kill(); } catch {}
    await closeVncWebSocketProxy(vncProxy);
    throw new Error(`Could not start the in-app VNC stream: ${e?.message || String(e)}`);
  }
  const entry = { pid, startedAt: Date.now(), monitorPort, vncDisplay, logFile, websocketPort: vncProxy.port, vncProxy, child };
  try {
    writeRuntimeState(name, entry);
  } catch (error) {
    try { child.kill(); } catch {}
    await closeVncWebSocketProxy(vncProxy);
    throw new Error(`Could not save VM runtime state: ${error.message}`);
  }
  vmRecoveryErrors.delete(name);
  runningVms.set(name, entry);
  forwardOut(name, Buffer.from(`[${name}] QEMU starting (pid ${pid}) — ${bin} ${args.join(" ")}\n`), logFile);
  progress("start", "started", `${name} starting (pid ${pid}) — opening the in-app display…`, null, { vm: name });
  return entry;
}

async function stopVmProcess(name) {
  const entry = runningVms.get(name);
  if (entry) {
    try { await qmpCommand(name, "quit", null, 3000); } catch {}
    if (!await waitForProcessExit(entry.pid, 5000)) {
      if (isWin()) {
        await execFileAsync("taskkill", ["/PID", String(entry.pid), "/F", "/T"], {
          encoding: "utf8", timeout: 10000, windowsHide: true,
        }).catch(() => {});
      } else {
        try { process.kill(entry.pid, "SIGTERM"); } catch {}
        if (!await waitForProcessExit(entry.pid, 2000)) {
          try { process.kill(entry.pid, "SIGKILL"); } catch {}
        }
      }
      await waitForProcessExit(entry.pid, 3000);
    }
    if (await isProcessRunning(entry.pid)) {
      throw new Error(`Could not stop QEMU for "${name}". Its VM disk is still in use.`);
    }
    qmpClose(name);
    await closeVncWebSocketProxy(entry.vncProxy);
    runningVms.delete(name);
    clearRuntimeState(name);
    return { ok: true };
  }
  return { ok: false, error: `VM "${name}" is not running.` };
}

async function stopAllVms() {
  const results = await Promise.all([...runningVms.keys()].map(async (name) => {
    try {
      const result = await stopVmProcess(name);
      return result.ok ? null : { name, error: result.error };
    } catch (error) {
      return { name, error: error?.message || String(error) };
    }
  }));
  return results.filter(Boolean);
}

// ─── QMP client (JSON, newline-delimited) ───────────────────────────────────
// The old human-monitor client was unreliable for input: its replies are only
// delimited by the "(qemu) " prompt, so a stale prompt desynced the queue, and
// HMP mouse_move takes *relative* deltas (so clicks landed nowhere). QMP gives
// id-matched replies + input-send-event (absolute pointer and real key events).
const qmpClients = new Map(); // name -> { socket, buf, pending, seq, dead, ready }
// Factory kept separate from the name→client cache so tests can drive it
// against a fake QMP server (see tests/qemu.test.cjs).
function makeQmpClient(port) {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  const c = { socket, buf: "", pending: new Map(), seq: 0, dead: false, ready: false, readyPromise: null };
  c.readyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { socket.destroy(); } catch {}
      reject(new Error("QMP connect timed out."));
    }, 8000);
    const fail = (e) => {
      c.dead = true;
      clearTimeout(timer);
      for (const p of c.pending.values()) { try { p.reject(e); } catch {} }
      c.pending.clear();
      reject(e);
    };
    socket.on("data", (d) => {
      c.buf += d.toString("utf8");
      let idx;
      while ((idx = c.buf.indexOf("\n")) >= 0) {
        const line = c.buf.slice(0, idx).trim();
        c.buf = c.buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.QMP) {
          // Greeting → negotiate capabilities (required before any command).
          if (!c.negotiating) {
            c.negotiating = true;
            c.seq = 1;
            c.pending.set(1, {
              resolve: () => { c.ready = true; clearTimeout(timer); resolve(c); },
              reject: fail,
            });
            try { socket.write(JSON.stringify({ execute: "qmp_capabilities", id: 1 }) + "\n"); }
            catch (e) { fail(e); }
          }
          continue;
        }
        if (msg.event) continue; // async events — not replies
        if (typeof msg.id === "number") {
          const p = c.pending.get(msg.id);
          if (!p) continue;
          c.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.desc || msg.error.class || "QMP error"));
          else p.resolve(msg.return);
        }
      }
    });
    socket.on("error", (e) => { if (!c.ready) fail(e); c.dead = true; });
    socket.on("close", () => { c.dead = true; });
  });
  c.readyPromise.catch(() => {});
  return c;
}
function qmpConnect(name) {
  let c = qmpClients.get(name);
  if (c && !c.dead) return c.ready ? Promise.resolve(c) : c.readyPromise;
  const entry = runningVms.get(name);
  if (!entry) return Promise.reject(new Error(`VM "${name}" is not running.`));
  c = makeQmpClient(entry.monitorPort);
  qmpClients.set(name, c);
  return c.readyPromise;
}
async function qmpCommand(name, cmd, args, timeoutMs = 10000) {
  const c = await qmpConnect(name);
  return new Promise((resolve, reject) => {
    const id = ++c.seq;
    const timer = setTimeout(() => {
      c.pending.delete(id);
      reject(new Error(`QMP ${cmd} timed out.`));
    }, timeoutMs);
    c.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    const payload = args ? { execute: cmd, arguments: args, id } : { execute: cmd, id };
    try { c.socket.write(JSON.stringify(payload) + "\n"); }
    catch (e) { clearTimeout(timer); c.pending.delete(id); reject(e); }
  });
}
// Drop a VM's client (stop/delete/restart) so the next command reconnects.
function qmpClose(name) {
  const c = qmpClients.get(name);
  if (!c) return;
  qmpClients.delete(name);
  try { c.socket.destroy(); } catch {}
  c.dead = true;
}

// ─── Input (QMP input-send-event) ───────────────────────────────────────────
// Aliases for chords/chips (HMP-style names) AND raw DOM KeyboardEvent.key
// values, all mapped to QKeyCode strings.
const KEY_MAP = {
  enter: "ret", return: "ret", esc: "esc", escape: "esc", tab: "tab",
  backspace: "backspace", space: "spc", " ": "spc", delete: "delete", del: "delete",
  insert: "insert", up: "up", down: "down", left: "left", right: "right",
  arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right",
  home: "home", end: "end", pageup: "pgup", pagedown: "pgdn", pgup: "pgup", pgdn: "pgdn",
  f1: "f1", f2: "f2", f3: "f3", f4: "f4", f5: "f5", f6: "f6",
  f7: "f7", f8: "f8", f9: "f9", f10: "f10", f11: "f11", f12: "f12",
  ctrl: "ctrl", control: "ctrl", alt: "alt", altgraph: "altgr", shift: "shift",
  meta: "meta_l", os: "meta_l", capslock: "caps_lock", numlock: "num_lock",
  scrolllock: "scroll_lock", printscreen: "print", pause: "pause", contextmenu: "menu",
  minus: "minus", "-": "minus", equal: "equal", "=": "equal", comma: "comma", ",": "comma",
  dot: "dot", period: "dot", ".": "dot", slash: "slash", "/": "slash",
  semicolon: "semicolon", ";": "semicolon", apostrophe: "apostrophe", "'": "apostrophe",
  bracket_left: "bracket_left", "[": "bracket_left",
  bracket_right: "bracket_right", "]": "bracket_right",
  backslash: "backslash", "\\": "backslash", grave_accent: "grave_accent", "`": "grave_accent",
  "<": "comma", ">": "dot", "?": "slash", ":": "semicolon", '"': "apostrophe",
  "{": "bracket_left", "}": "bracket_right", "|": "backslash", "~": "grave_accent",
  "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8",
  "(": "9", ")": "0", "_": "minus", "+": "equal",
};
function hmpKeyName(raw) {
  const rawStr = String(raw ?? "");
  if (!rawStr || rawStr === " ") return rawStr === " " ? "spc" : null;
  const k = rawStr.trim();
  if (!k) return null;
  const lower = k.toLowerCase();
  if (KEY_MAP[lower]) return KEY_MAP[lower];
  if (/^[A-Za-z0-9]$/.test(k)) return lower;
  return null;
}
const keyEvent = (qcodeName, down) => ({
  type: "key",
  data: { down, key: { type: "qcode", data: qcodeName } },
});
// Characters that are produced with Shift held on a US keyboard (text mode
// has no host Shift state to inherit, unlike real keydown events).
const SHIFTED = new Set(["!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+",
  "{", "}", "|", "~", ":", '"', "<", ">", "?"]);
function charToKeys(ch) {
  if (/^[A-Z]$/.test(ch)) return { qcode: ch.toLowerCase(), shift: true };
  if (SHIFTED.has(ch)) return { qcode: hmpKeyName(ch), shift: true };
  const qcode = hmpKeyName(ch);
  return qcode ? { qcode, shift: false } : null;
}
// QMP absolute pointer range for usb-tablet is 0..0x7FFF.
const ABS_MAX = 32767;
function absEvents(x, y, button, down) {
  const events = [
    { type: "abs", data: { axis: "x", value: Math.round(x) } },
    { type: "abs", data: { axis: "y", value: Math.round(y) } },
  ];
  if (button) {
    events.push({ type: "btn", data: { down: true, button } });
    events.push({ type: "btn", data: { down: false, button } });
  }
  return events;
}
// Pure action → QMP command mapping (exported for tests).
function buildInputAction(action = {}) {
  const num = (v, lo, hi) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < lo || n > hi) return null;
    return n;
  };
  const coords = () => {
    const x = num(action.x, 0, ABS_MAX), y = num(action.y, 0, ABS_MAX);
    return x === null || y === null ? null : { x, y };
  };
  if (action.type === "click") {
    const p = coords();
    if (!p) return { error: "Coordinates out of range." };
    const button = action.button === "right" ? "right" : action.button === "middle" ? "middle" : "left";
    return { command: "input-send-event", args: { events: absEvents(p.x, p.y, button) } };
  }
  if (action.type === "move") {
    const p = coords();
    if (!p) return { error: "Coordinates out of range." };
    return { command: "input-send-event", args: { events: absEvents(p.x, p.y) } };
  }
  if (action.type === "wheel") {
    const p = coords();
    if (!p) return { error: "Coordinates out of range." };
    const dir = Number(action.delta ?? -1) < 0 ? "wheel-up" : "wheel-down";
    const events = absEvents(p.x, p.y);
    events.push({ type: "btn", data: { down: true, button: dir } });
    events.push({ type: "btn", data: { down: false, button: dir } });
    return { command: "input-send-event", args: { events } };
  }
  // Single physical key transition from the real keyboard (onKeyDown/onKeyUp).
  if (action.type === "keydown" || action.type === "keyup") {
    const q = hmpKeyName(action.key);
    if (!q) return { error: `Unsupported key: ${action.key}` };
    return { command: "input-send-event", args: { events: [keyEvent(q, action.type === "keydown")] } };
  }
  // Chord, e.g. "ctrl-alt-f1" (panel chips) — press in order, release reversed.
  if (action.type === "key") {
    // Accept both "ctrl+alt+f1" and the HMP-style "ctrl-alt-f1" used by the chips.
    const raw = String(action.keys || "").trim();
    const parts = (raw.includes("+") ? raw.split("+") : raw.split("-")).map(hmpKeyName).filter(Boolean);
    if (!parts.length) return { error: `Unknown key: ${action.keys}` };
    if (parts.length > 4) return { error: "Too many keys in a chord." };
    const events = [];
    for (const q of parts) events.push(keyEvent(q, true));
    for (let i = parts.length - 1; i >= 0; i--) events.push(keyEvent(parts[i], false));
    return { command: "input-send-event", args: { events } };
  }
  // Bulk text: all key transitions in ONE QMP command (fast, ordered).
  if (action.type === "text") {
    const text = String(action.text || "").slice(0, 200);
    if (!text) return { error: "Empty text." };
    const events = [];
    let skipped = 0;
    for (const ch of text) {
      if (ch === "\n") { events.push(keyEvent("ret", true), keyEvent("ret", false)); continue; }
      const k = charToKeys(ch);
      if (!k || !k.qcode) { skipped++; continue; }
      if (k.shift) events.push(keyEvent("shift", true));
      events.push(keyEvent(k.qcode, true), keyEvent(k.qcode, false));
      if (k.shift) events.push(keyEvent("shift", false));
    }
    if (!events.length) return { error: "No typeable characters." };
    return { command: "input-send-event", args: { events }, timeout: 20000, skipped };
  }
  return { error: "Unknown input action." };
}
async function sendInput(name, action = {}) {
  const built = buildInputAction(action);
  if (built.error) return { ok: false, error: built.error };
  await qmpCommand(name, built.command, built.args, built.timeout || 10000);
  return { ok: true, ...(built.skipped ? { skipped: built.skipped } : {}) };
}

// ─── Create / delete ────────────────────────────────────────────────────────
async function createVm(payload = {}) {
  const cfg = { ...validateVmConfig(payload), createdAt: Date.now() };
  const storageDir = readSettings().vmStorageDir;
  if (!storageDir) throw new Error("Choose a VM storage folder before creating a VM.");
  if (readVmConfig(cfg.name) || fs.existsSync(vmDir(cfg.name))) throw new Error(`VM "${cfg.name}" already exists.`);
  fs.mkdirSync(storageDir, { recursive: true });
  const folder = vmDir(cfg.name);
  fs.mkdirSync(folder);
  const qimg = findQemuImgFile();
  let disk;
  try {
    if (qimg) {
      disk = path.join(folder, "disk.qcow2");
      cfg.diskFormat = "qcow2";
      progress("create", "disk", `Creating ${cfg.diskGb} GB qcow2 disk…`, null, { vm: cfg.name });
      await new Promise((resolve, reject) => {
        execFile(qimg, ["create", "-f", "qcow2", disk, `${cfg.diskGb}G`], { cwd: folder, encoding: "utf8", timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
          if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
          else resolve(String(stdout || ""));
        });
      });
    } else {
      disk = path.join(folder, "disk.img");
      cfg.diskFormat = "raw";
      progress("create", "disk", `qemu-img not found — creating a sparse ${cfg.diskGb} GB raw disk instead…`, null, { vm: cfg.name });
      const fd = fs.openSync(disk, "w");
      try { fs.ftruncateSync(fd, cfg.diskGb * 1024 * 1024 * 1024); } finally { fs.closeSync(fd); }
    }
    fs.writeFileSync(path.join(folder, "vm.json"), JSON.stringify(cfg, null, 2));
  } catch (error) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  progress("create", "done", `VM "${cfg.name}" created.`, 100, { vm: cfg.name });
  return { ok: true, vm: describeVm(cfg.name) };
}

async function deleteVm(name) {
  const n = sanitizeVmName(name);
  if (!readVmConfig(n)) return { ok: false, error: `VM "${n}" not found.` };
  const disk = describeVm(n).disk;
  await recoverExistingQemu(n, disk);
  if (runningVms.has(n)) {
    const stopped = await stopVmProcess(n);
    if (!stopped.ok) return stopped;
  }
  qmpClose(n);
  const folder = resolveVmDir(n);
  try { if (folder) fs.rmSync(folder, { recursive: true, force: true }); } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
  progress("delete", "done", `VM "${n}" deleted.`, null, { vm: n });
  return { ok: true };
}

// ─── State ──────────────────────────────────────────────────────────────────
async function getState() {
  const settings = readSettings();
  const storageDir = typeof settings.vmStorageDir === "string" && settings.vmStorageDir
    ? settings.vmStorageDir
    : null;
  const qemu = await detectQemu();
  const names = listVmNames();
  await recoverVmsAtStartup(names);
  const vms = names.map(describeVm);
  return {
    ok: true,
    root: getQemuRoot(),
    vmsDir: getVmsDir(),
    storageDir,
    storageConfigured: !!storageDir,
    qemu,
    customBinDir: settings.qemuBinDir || null,
    arches: ARCHES,
    isoCatalog: ISO_CATALOG,
    vms,
    running: vms.filter((v) => v.running).map((v) => v.name),
  };
}

// ─── IPC wiring ─────────────────────────────────────────────────────────────
function setupQemuIpc() {
  const { ipcMain, shell, dialog } = require("electron");

  ipcMain.handle("qemu:getState", async () => {
    try { return await getState(); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  ipcMain.handle("qemu:createVm", async (_e, payload = {}) => {
    try { return await createVm(payload); }
    catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
  });

  ipcMain.handle("qemu:deleteVm", async (_e, { name } = {}) => {
    try { return await deleteVm(name); }
    catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
  });

  ipcMain.handle("qemu:startVm", async (_e, { name } = {}) => {
    try {
      const n = sanitizeVmName(name);
      const entry = await startVmProcess(n);
      return { ok: true, pid: entry.pid, websocketPort: entry.websocketPort };
    } catch (e) {
      const message = (e?.message || String(e)).slice(0, 1200);
      try {
        const n = sanitizeVmName(name);
        if (resolveVmDir(n)) {
          ensureVmLogsDir(n);
          fs.appendFileSync(vmLogPath(n), `\r\n[QEMU start error] ${message}\r\n`);
        }
      } catch {}
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("qemu:stopVm", async (_e, { name } = {}) => {
    try {
      const n = sanitizeVmName(name);
      const r = await stopVmProcess(n);
      if (r.ok) progress("stop", "done", `${n} stopped.`, null, { vm: n });
      return r;
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
  });

  ipcMain.handle("qemu:input", async (_e, { name, action } = {}) => {
    try {
      const n = sanitizeVmName(name);
      if (!runningVms.has(n)) return { ok: false, error: "VM is not running." };
      return await sendInput(n, action || {});
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 300) }; }
  });

  ipcMain.handle("qemu:getLog", async (_e, { name } = {}) => {
    try { return readQemuLog(name); }
    catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 300) }; }
  });

  ipcMain.handle("qemu:pickIso", async () => {
    const r = await dialog.showOpenDialog({
      title: "Choose an ISO image",
      properties: ["openFile"],
      filters: [{ name: "Disk images", extensions: ["iso", "img", "vhd", "vhdx", "vdi", "vmdk"] }],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return r.filePaths[0];
  });

  ipcMain.handle("qemu:selectVmStorageDir", async () => {
    const r = await dialog.showOpenDialog({
      title: "Choose the parent folder for QEMU VMs",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const selected = fs.realpathSync(r.filePaths[0]);
    if (!fs.statSync(selected).isDirectory()) throw new Error("The selected VM storage path is not a folder.");
    const savedRoots = readSettings().vmStorageDirs;
    const roots = [...new Set([...(Array.isArray(savedRoots) ? savedRoots.filter((root) => typeof root === "string") : []), selected])];
    writeSettings({ vmStorageDir: selected, vmStorageDirs: roots });
    return { ok: true, storageDir: selected };
  });

  ipcMain.handle("qemu:setCustomBinDir", async () => {
    const r = await dialog.showOpenDialog({
      title: "Choose the folder containing qemu-system-*",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths.length) return null;
    const dir = r.filePaths[0];
    writeSettings({ qemuBinDir: dir });
    _pathProbe = { at: 0, result: null };
    return { ok: true, qemuBinDir: dir };
  });

  ipcMain.handle("qemu:revealFolder", async () => {
    try {
      const error = await shell.openPath(getVmsDir());
      if (error) throw new Error(error);
      return { ok: true };
    }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });
}

module.exports = {
  setupQemuIpc,
  stopAllVms,
  getQemuRoot,
  getVmsDir,
  ARCHES,
  ARCH_MACHINE,
  ISO_CATALOG,
  archBinary,
  buildQemuArgs,
  parseQemuRuntimeArgs,
  createVncWebSocketProxy,
  closeVncWebSocketProxy,
  readQemuLog,
  validateVmConfig,
  sanitizeVmName,
  parseQemuVersion,
  hmpKeyName,
  makeQmpClient,
  buildInputAction,
  sendInput,
  candidateDirs,
  findQemuBinFile,
};
