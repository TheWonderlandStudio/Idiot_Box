// ─── Android Emulator manager — offline SDK rooted at `.appdata/android` ─────
// Root lives under Electron userData so the GitHub repo stays small and the
// real Android files land on the user's machine:
//
//   <userData>/.appdata/android/
//   ├── sdk/          ← ANDROID_SDK_ROOT (cmdline-tools, platform-tools, emulator, …)
//   ├── avd/          ← ANDROID_AVD_HOME (Pixel_8.avd, Pixel_8.ini, …)
//   └── downloads/    ← commandlinetools zips + emulator logs
//
// IMPORTANT: sdkmanager / avdmanager / emulator / adb are NEVER resolved via
// system PATH — every spawn uses an absolute path under sdkRoot (see *_BIN()).
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");
const http = require("http");
const { spawn, execFile } = require("child_process");
let ptyMod = null;
try { ptyMod = require("node-pty"); } catch (e) { /* ConPTY unavailable — plain spawn fallback */ }

let _deps = null; // { app, BrowserWindow, shell }

function deps() {
  if (!_deps) {
    const { app, BrowserWindow, shell } = require("electron");
    _deps = { app, BrowserWindow, shell };
  }
  return _deps;
}

// ─── Paths ──────────────────────────────────────────────────────────────────
function getAndroidRoot() {
  const { app } = deps();
  return path.join(app.getPath("userData"), ".appdata", "android");
}
function getSdkRoot() { return path.join(getAndroidRoot(), "sdk"); }
function getAvdDir() { return path.join(getAndroidRoot(), "avd"); }
function getDownloadsDir() { return path.join(getAndroidRoot(), "downloads"); }

function ensureDirs() {
  for (const d of [getAndroidRoot(), getSdkRoot(), getAvdDir(), getDownloadsDir()]) {
    try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch {}
  }
}

const isWin = () => process.platform === "win32";

// Absolute binary paths — never PATH-resolved (per spec §10)
function sdkManagerBin() {
  const base = path.join(getSdkRoot(), "cmdline-tools", "latest", "bin");
  return path.join(base, isWin() ? "sdkmanager.bat" : "sdkmanager");
}
function avdManagerBin() {
  const base = path.join(getSdkRoot(), "cmdline-tools", "latest", "bin");
  return path.join(base, isWin() ? "avdmanager.bat" : "avdmanager");
}
function emulatorBin() {
  return path.join(getSdkRoot(), "emulator", isWin() ? "emulator.exe" : "emulator");
}
function adbBin() {
  return path.join(getSdkRoot(), "platform-tools", isWin() ? "adb.exe" : "adb");
}

function androidEnv(extra = {}) {
  const sdkRoot = getSdkRoot();
  const avdDir = getAvdDir();
  const emuDir = path.join(sdkRoot, "emulator");
  const ptDir = path.join(sdkRoot, "platform-tools");
  const sep = isWin() ? ";" : ":";
  // Portable JDK (if Setup downloaded one) wins via JAVA_HOME — sdkmanager.bat
  // respects it, so system Java (e.g. Java 8) is left untouched.
  const jdkHome = findBundledJdkHome();
  const jdkBin = jdkHome ? path.join(jdkHome, "bin") : null;
  return {
    ...process.env,
    ANDROID_SDK_ROOT: sdkRoot,
    ANDROID_HOME: sdkRoot,
    ANDROID_AVD_HOME: avdDir,
    ANDROID_EMULATOR_HOME: avdDir,
    ...(jdkHome ? { JAVA_HOME: jdkHome } : {}),
    // Prepend so emulator DLLs (and bundled java) resolve, but binaries are still absolute-path spawned.
    PATH: `${jdkBin ? jdkBin + sep : ""}${emuDir}${sep}${ptDir}${sep}${process.env.PATH || ""}`,
    ...extra,
  };
}

// ─── Bundled portable JDK (Eclipse Temurin 17) — no system install needed ───
// Lives at <root>/jdk/ (either bin/ directly or jdk-17*/bin after extract).
function getJdkRoot() { return path.join(getAndroidRoot(), "jdk"); }

function findBundledJdkHome() {
  try {
    const root = getJdkRoot();
    if (!fs.existsSync(root)) return null;
    const exe = isWin() ? "java.exe" : "java";
    if (fs.existsSync(path.join(root, "bin", exe))) return root;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (fs.existsSync(path.join(root, e.name, "bin", exe))) return path.join(root, e.name);
    }
    return null;
  } catch { return null; }
}
function findBundledJava() {
  const home = findBundledJdkHome();
  return home ? path.join(home, "bin", isWin() ? "java.exe" : "java") : null;
}

function temurinTarget() {
  const osName = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "x86" : "x64";
  const ext = process.platform === "win32" ? "zip" : "tar.gz";
  return {
    url: `https://api.adoptium.net/v3/binary/latest/17/ga/${osName}/${arch}/jdk/hotspot/normal/eclipse`,
    file: `temurin-17-${osName}-${arch}.${ext}`,
  };
}

async function ensureBundledJdk(op = "setup-sdk") {
  if (findBundledJava()) {
    progress(op, "java", "Portable JDK 17 already present — reusing.");
    return;
  }
  ensureDirs();
  const { url, file } = temurinTarget();
  const dest = path.join(getDownloadsDir(), file);
  const isZip = file.endsWith(".zip");
  let looksComplete = false;
  try {
    looksComplete = isZip ? zipHasEocd(dest) : fs.statSync(dest).size > 100 * 1024 * 1024;
  } catch { looksComplete = false; }
  if (looksComplete) {
    let mb = "?";
    try { mb = (fs.statSync(dest).size / 1048576).toFixed(1); } catch {}
    progress(op, "java", `Reusing existing JDK download (${mb} MB) — skipping re-download.`, 100);
  } else {
    progress(op, "java", `Downloading portable JDK 17 (Temurin, ~190 MB)…\n${url}`);
    await downloadFile(url, dest, op, (pct, done, total) => {
      const mb = total ? `${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB` : `${(done / 1048576).toFixed(1)} MB`;
      progress(op, "java", `Downloading JDK 17… ${pct}% (${mb})`, pct, { done, total });
    });
  }
  progress(op, "java", "Extracting portable JDK 17 to .appdata/android/jdk …");
  const root = getJdkRoot();
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(root, { recursive: true });
  try {
    if (isZip) {
      extractZipNode(dest, root, (d, t) => {
        if (d === t || d % 500 === 0) progress(op, "java", `Extracting JDK… ${d}/${t} files`);
      });
    } else {
      await new Promise((resolve, reject) => {
        execFile("tar", ["-xzf", dest, "-C", root], { encoding: "utf8", timeout: 300000, windowsHide: true }, (err, stdout, stderr) => {
          if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
          resolve();
        });
      });
    }
  } catch (e) {
    try { fs.unlinkSync(dest); } catch {} // corrupt archive → re-download on next retry
    throw new Error(`JDK extract failed (${String(e?.message || e).split("\n")[0].slice(0, 140)}). The download was deleted — retry Setup to re-download.`);
  }
  const java = findBundledJava();
  if (!java) throw new Error("JDK extracted but the java binary was not found — install JDK 17 manually and retry.");
  if (!isWin()) { try { fs.chmodSync(java, 0o755); } catch {} }
  progress(op, "java", "Portable JDK 17 ready.", 100);
}

// ─── Progress broadcast ─────────────────────────────────────────────────────
function broadcast(payload) {
  try {
    const { BrowserWindow } = deps();
    for (const win of BrowserWindow.getAllWindows()) {
      try { if (!win.isDestroyed()) win.webContents.send("android:progress", payload); } catch {}
    }
  } catch {}
}
const progress = (op, phase, message, percent = null, extra = null) =>
  broadcast({ op, phase, message, percent, ...(extra || {}), at: Date.now() });

// ─── Catalogs (UI create form) ──────────────────────────────────────────────
const API_LEVELS = [
  { api: 35, android: "Android 15", image: "system-images;android-35;google_apis;x86_64", platform: "platforms;android-35" },
  { api: 34, android: "Android 14", image: "system-images;android-34;google_apis;x86_64", platform: "platforms;android-34" },
  { api: 33, android: "Android 13", image: "system-images;android-33;google_apis;x86_64", platform: "platforms;android-33" },
];
const DEVICES = [
  { id: "pixel_8", label: "Pixel 8" },
  { id: "pixel_7", label: "Pixel 7" },
  { id: "pixel_6", label: "Pixel 6" },
  { id: "pixel_5", label: "Pixel 5" },
  { id: "pixel", label: "Pixel (generic)" },
  { id: "", label: "Default (auto hardware profile)" },
];
const BASE_PACKAGES = ["platform-tools", "emulator", "platforms;android-35"];
const DEFAULT_IMAGE = "system-images;android-35;google_apis;x86_64";

function cmdlineToolsUrl() {
  const build = "11076708_latest";
  if (process.platform === "win32") return `https://dl.google.com/android/repository/commandlinetools-win-${build}.zip`;
  if (process.platform === "darwin") return `https://dl.google.com/android/repository/commandlinetools-mac-${build}.zip`;
  return `https://dl.google.com/android/repository/commandlinetools-linux-${build}.zip`;
}

// ─── Small helpers ──────────────────────────────────────────────────────────
function execOut(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", timeout: 60000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function javaMajorOf(versionStr) {
  const m = String(versionStr || "").match(/"?(\d+)(?:[._](\d+))?/);
  if (!m) return 0;
  // legacy scheme: 1.8.x → major 8; modern: 17.x / 21.x → major as-is
  if (m[1] === "1" && m[2]) return parseInt(m[2], 10);
  return parseInt(m[1], 10);
}

function javaVersionOf(javaBin) {
  return new Promise((resolve) => {
    execFile(javaBin, ["-version"], { encoding: "utf8", timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      const out = String(stderr || "") + String(stdout || "");
      if (!err || /version/i.test(out)) {
        const m = out.match(/"?(\d+[\.\d_]+)"?/);
        const version = m ? m[1] : "unknown";
        resolve({ ok: true, version, major: javaMajorOf(version) });
      } else {
        resolve({ ok: false, version: null, major: 0 });
      }
    });
  });
}

// Bundled portable JDK wins; system java is the fallback.
async function checkJava() {
  const bundled = findBundledJava();
  if (bundled) return { ...(await javaVersionOf(bundled)), source: "bundled JDK" };
  return { ...(await javaVersionOf("java")), source: "system" };
}

function isSdkInstalled() {
  try {
    const sm = sdkManagerBin();
    if (!fs.existsSync(sm)) return false;
    // platform-tools + emulator mark a usable setup (cmdline-tools alone is not enough)
    if (!fs.existsSync(adbBin())) return false;
    if (!fs.existsSync(emulatorBin())) return false;
    return true;
  } catch { return false; }
}

// Parse avd/<name>.avd/config.ini for friendly display
function readAvdConfig(name) {
  try {
    const iniPath = path.join(getAvdDir(), `${name}.avd`, "config.ini");
    if (!fs.existsSync(iniPath)) return {};
    const raw = fs.readFileSync(iniPath, "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([^#;=\s][^=]*?)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1].trim()] = m[2].trim();
    }
    return out;
  } catch { return {}; }
}

function describeAvd(name) {
  const cfg = readAvdConfig(name);
  const sysdir = String(cfg["image.sysdir.1"] || "");
  let api = null;
  let android = null;
  const mApi = sysdir.match(/android-(\d+)/);
  if (mApi) {
    api = parseInt(mApi[1], 10);
    const known = API_LEVELS.find((l) => l.api === api);
    android = known ? known.android : `Android (API ${api})`;
  }
  const device = cfg["hw.device.name"] || cfg["hw.device.manufacturer"] || "";
  return {
    name,
    device: String(device || "").replace(/_/g, " ") || null,
    api,
    android,
    image: sysdir ? sysdir.replace(/^system-images\//, "").replace(/\//g, " ") : null,
    rawImage: sysdir || null,
  };
}

// ─── Download (with redirect + progress) ────────────────────────────────────
function downloadFile(url, dest, op = "setup-sdk", onPct = null) {
  return new Promise((resolve, reject) => {
    const get = (u, redirects = 0) => {
      if (redirects > 8) return reject(new Error("Too many redirects"));
      const lib = String(u).startsWith("https:") ? https : http;
      const req = lib.get(u, { headers: { "User-Agent": "IdiotBox-Android-Setup" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, u).toString();
          res.resume();
          return get(next, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode} for ${u}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10) || 0;
        let done = 0;
        let lastPct = -1;
        const ws = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          done += chunk.length;
          if (total > 0) {
            const pct = Math.min(99, Math.round((done / total) * 100));
            if (pct !== lastPct && pct % 2 === 0) {
              lastPct = pct;
              try { onPct && onPct(pct, done, total); } catch {}
            }
          }
        });
        res.pipe(ws);
        ws.on("finish", () => ws.close(() => resolve({ path: dest, bytes: done, total })));
        ws.on("error", (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
        res.on("error", (e) => { try { ws.destroy(); } catch {} reject(e); });
      });
      req.on("error", reject);
      req.setTimeout(60000, () => { try { req.destroy(new Error("Download timed out")); } catch {} });
    };
    get(url);
  });
}

// ─── Zip helpers — validate + pure-Node extractor (no OS tools needed) ──────
// Scores of Windows boxes have a broken Microsoft.PowerShell.Archive module
// (Expand-Archive fails with "module could not be loaded"), so extraction
// must never depend on a single tool. Chain: Expand-Archive → pwsh → tar →
// jar → built-in (zlib). The built-in handles stored + deflated entries,
// which covers Google's commandlinetools zips.
function zipHasEocd(zipPath) {
  try {
    const st = fs.statSync(zipPath);
    if (!st.isFile() || st.size < 22) return false;
    const fd = fs.openSync(zipPath, "r");
    try {
      const tailLen = Math.min(st.size, 66000);
      const tail = Buffer.alloc(tailLen);
      fs.readSync(fd, tail, 0, tailLen, st.size - tailLen);
      for (let i = tailLen - 22; i >= 0; i--) {
        if (tail.readUInt32LE(i) === 0x06054b50) return true;
      }
      return false;
    } finally { try { fs.closeSync(fd); } catch {} }
  } catch { return false; }
}

// Minimal zip reader: central directory + local headers, methods 0/8.
function extractZipNode(zipPath, destDir, onFile = null) {
  const zlib = require("zlib");
  const destNorm = path.normalize(destDir + path.sep);
  const fd = fs.openSync(zipPath, "r");
  try {
    const { size } = fs.fstatSync(fd);
    if (size < 22) throw new Error("File too small to be a zip");
    const tailLen = Math.min(size, 66000);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocdAt = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocdAt = i; break; }
    }
    if (eocdAt < 0) throw new Error("Not a valid zip (EOCD record not found)");
    const count = tail.readUInt16LE(eocdAt + 10);
    if (count === 0xFFFF) throw new Error("Zip64 archives are not supported");
    const cdSize = tail.readUInt32LE(eocdAt + 12);
    const cdOff = tail.readUInt32LE(eocdAt + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt zip (bad central directory)");
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const fnLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const comLen = cd.readUInt16LE(p + 32);
      const localOff = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + fnLen).replace(/\//g, path.sep);
      p += 46 + fnLen + extraLen + comLen;
      const target = path.normalize(path.join(destDir, name));
      if (target !== path.normalize(destDir) && !target.startsWith(destNorm)) {
        throw new Error(`Unsafe zip entry (zip-slip): ${name}`);
      }
      if (name.endsWith(path.sep) || compSize === 0 && method === 0 && !name.includes(".")) {
        // directory entry (or empty file — handled below as file if it has an extension)
        if (name.endsWith(path.sep)) { fs.mkdirSync(target, { recursive: true }); }
        else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, Buffer.alloc(0)); }
      } else {
        if ((flags & 0x08) !== 0) throw new Error(`Unsupported zip entry (data descriptor): ${name}`);
        if (method !== 0 && method !== 8) throw new Error(`Unsupported compression method ${method}: ${name}`);
        const lh = Buffer.alloc(30);
        fs.readSync(fd, lh, 0, 30, localOff);
        if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`Corrupt zip (bad local header): ${name}`);
        const dataOff = localOff + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
        const comp = Buffer.alloc(compSize);
        if (compSize > 0) fs.readSync(fd, comp, 0, compSize, dataOff);
        const data = method === 8 ? zlib.inflateRawSync(comp) : comp;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
      }
      if (onFile && (n % 25 === 0 || n === count - 1)) { try { onFile(n + 1, count); } catch {} }
    }
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

// ─── Extract commandlinetools zip → sdk/cmdline-tools/latest ────────────────
function extractCmdlineTools(zipPath, op = "setup-sdk") {
  const sdkRoot = getSdkRoot();
  const tmpDir = path.join(getDownloadsDir(), "_ctl_extract");
  const resetTmp = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(tmpDir, { recursive: true });
  };
  resetTmp();

  const run = (file, args, timeout = 180000, cwd = undefined) => new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", timeout, windowsHide: true, ...(cwd ? { cwd } : {}) }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve(String(stdout || ""));
    });
  });

  const expandScript = (psExe) =>
    `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force`;

  const attempts = [];
  if (isWin()) {
    attempts.push({ name: "PowerShell Expand-Archive", fn: () => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", expandScript()]) });
    attempts.push({ name: "PowerShell 7 Expand-Archive", fn: () => run("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", expandScript()]) });
    // bsdtar ships with Windows 10+ (System32) and reads zips natively
    attempts.push({ name: "tar", fn: () => run("tar.exe", ["-xf", zipPath, "-C", tmpDir]) });
    // JDK's jar tool (Java is a setup prerequisite, so this is usually present)
    attempts.push({ name: "jar", fn: async () => {
      try { await run("jar.exe", ["xf", zipPath], 180000, tmpDir); }
      catch (e) {
        const jh = process.env.JAVA_HOME;
        if (!jh) throw e;
        await run(path.join(jh, "bin", "jar.exe"), ["xf", zipPath], 180000, tmpDir);
      }
    }});
  } else {
    // Linux/macOS: prefer unzip, fallback to python zipfile
    attempts.push({ name: "unzip", fn: () => run("unzip", ["-q", "-o", zipPath, "-d", tmpDir]) });
    attempts.push({ name: "python zipfile", fn: () => run("python3", ["-m", "zipfile", "-e", zipPath, tmpDir]) });
  }
  // Ultimate fallback — pure Node, always available
  attempts.push({ name: "built-in extractor", fn: async () => {
    extractZipNode(zipPath, tmpDir, (done, total) => {
      if (done === total || done % 500 === 0) progress(op, "extract", `Extracting… ${done}/${total} files`);
    });
  }});

  return (async () => {
    let lastErr = null;
    for (const a of attempts) {
      try {
        await a.fn();
        // a tool "succeeding" without producing cmdline-tools/ counts as failure
        if (fs.existsSync(path.join(tmpDir, "cmdline-tools"))) { lastErr = null; break; }
        lastErr = new Error(`${a.name} finished but cmdline-tools/ was not produced`);
      } catch (e) {
        lastErr = e;
      }
      progress(op, "extract", `${a.name} failed (${String(lastErr?.message || lastErr).split("\n")[0].slice(0, 140)}) — trying next…`);
      resetTmp();
    }
    if (lastErr) throw lastErr;
    // Zip root is `cmdline-tools/` (with bin/, lib/). Move to sdk/cmdline-tools/latest/
    const srcDir = path.join(tmpDir, "cmdline-tools");
    if (!fs.existsSync(srcDir)) {
      // Some mirrors nest one level deeper — search for bin/sdkmanager
      throw new Error("Unexpected zip layout: cmdline-tools/ folder not found after extract");
    }
    const destDir = path.join(sdkRoot, "cmdline-tools", "latest");
    try { fs.rmSync(destDir, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    fs.renameSync(srcDir, destDir);
    if (!isWin()) {
      for (const bin of ["sdkmanager", "avdmanager"]) {
        try { fs.chmodSync(path.join(destDir, "bin", bin), 0o755); } catch {}
      }
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    // Accept licenses dir + repositories.cfg to keep sdkmanager non-interactive
    try {
      const licDir = path.join(sdkRoot, "licenses");
      if (!fs.existsSync(licDir)) fs.mkdirSync(licDir, { recursive: true });
      const cfg = path.join(os.homedir(), ".android", "repositories.cfg");
      try { if (!fs.existsSync(cfg)) { fs.mkdirSync(path.dirname(cfg), { recursive: true }); fs.writeFileSync(cfg, "### User Sources for Android SDK Manager\n"); } } catch {}
    } catch {}
    return destDir;
  })();
}

// ─── sdkmanager runner (absolute path, auto-yes, progress streaming) ────────
// Serialized: two sdkmanager processes must never run at once (they lock the
// SDK repo and corrupt each other's downloads — seen when Setup + Create ran
// together). Every call goes through the shared chain.
let _sdkChain = Promise.resolve();
function runSdkManager(args, opts = {}) {
  const task = _sdkChain.then(() => _runSdkManager(args, opts), () => _runSdkManager(args, opts));
  _sdkChain = task.catch(() => {});
  return task;
}

// Parse sdkmanager's `[====  ] 25% Downloading foo.zip...` chatter into one
// clean {percent, message} event per change — the raw bar spam stays out of the UI log.
function parseSdkLine(line) {
  const t = String(line || "").trim();
  if (!t) return null;
  const m = t.match(/(\d{1,3})\s*%\s*(.*)$/);
  if (m) {
    let msg = m[2].replace(/^\[[\s=\]]*\]?\s*/, "").replace(/^[\s=\]]+/, "").trim().slice(0, 120);
    return { percent: Math.min(100, parseInt(m[1], 10)), message: msg || "Working…" };
  }
  const clean = t.replace(/\[[=\s]*\]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  return clean ? { percent: null, message: clean } : null;
}

function _runSdkManager(args, { op = "sdkmanager", stdinYes = true } = {}) {
  return new Promise((resolve, reject) => {
    const bin = sdkManagerBin();
    const sdkRoot = getSdkRoot();
    const fullArgs = [`--sdk_root=${sdkRoot}`, ...args];
    let child;
    const spawnWith = (file, a, opts) => spawn(file, a, opts);
    try {
      if (isWin()) {
        // .bat must run under cmd.exe. NOTE: no /s switch and no hand-quoting —
        // libuv quotes the .bat path itself; adding our own quotes (or /s)
        // makes cmd see literal quote chars → "'...sdkmanager.bat' is not recognized".
        child = spawnWith("cmd.exe", ["/d", "/c", bin, ...fullArgs], {
          env: androidEnv(),
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else {
        child = spawnWith(bin, fullArgs, {
          env: androidEnv(),
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }
    } catch (e) { return reject(e); }

    let out = "";
    let errOut = "";
    const feedYes = stdinYes ? setInterval(() => { try { child.stdin.write("y\n"); } catch {} }, 400) : null;
    try { if (stdinYes) child.stdin.write("y\n"); } catch {}
    let lastPct = -1, lastMsg = "", lastSent = 0;
    child.stdout.on("data", (d) => {
      const t = d.toString();
      out += t;
      if (out.length > 400000) out = out.slice(-400000);
      // sdkmanager rewrites one line via \r — split on those too, keep the latest
      const segs = t.split(/[\r\n]+/).map((seg) => seg.trim()).filter(Boolean);
      const parsed = parseSdkLine(segs.pop());
      if (!parsed) return;
      const now = Date.now();
      const changed = parsed.percent !== null
        ? (parsed.percent !== lastPct || parsed.message !== lastMsg)
        : (parsed.message !== lastMsg && now - lastSent > 2500);
      if (changed || now - lastSent > 4000) {
        if (parsed.percent !== null) lastPct = parsed.percent;
        lastMsg = parsed.message;
        lastSent = now;
        broadcast({ op, phase: "run", message: parsed.message, percent: parsed.percent, at: now });
      }
    });
    child.stderr.on("data", (d) => {
      const t = d.toString();
      errOut += t;
      if (errOut.length > 200000) errOut = errOut.slice(-200000);
    });
    child.on("error", (e) => { try { clearInterval(feedYes); } catch {} reject(e); });
    child.on("close", (code) => {
      try { clearInterval(feedYes); } catch {}
      try { child.stdin.end(); } catch {}
      if (code === 0) resolve({ code, out, errOut });
      else reject(new Error(`sdkmanager exited with code ${code}\n${(errOut || out).slice(-2000)}`));
    });
  });
}

async function acceptLicenses(op) {
  // Best-effort: pipe `y` into `sdkmanager --licenses`
  try {
    progress(op, "licenses", "Accepting SDK licenses…");
    await runSdkManager(["--licenses"], { op });
  } catch (e) {
    // Non-fatal — missing licenses surface as install errors later
    progress(op, "licenses", `License step warning: ${String(e?.message || e).split("\n")[0].slice(0, 160)}`);
  }
}

async function installPackages(packages, op) {
  const list = [...new Set(packages.filter(Boolean))];
  if (!list.length) return;
  progress(op, "install", `Installing: ${list.join(", ")}`);
  await runSdkManager(["--install", ...list], { op });
  await acceptLicenses(op);
  progress(op, "install", "Packages installed", 100);
}

// ─── avdmanager / emulator / adb runners (absolute paths) ───────────────────
function runAvdManager(args, { stdin = "no\n", timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = avdManagerBin();
    let child;
    try {
      if (isWin()) {
        // Same quoting rule as runSdkManager: no /s, no hand-quoting.
        child = spawn("cmd.exe", ["/d", "/c", bin, ...args], {
          env: androidEnv(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
        });
      } else {
        child = spawn(bin, args, { env: androidEnv(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      }
    } catch (e) { return reject(e); }
    let out = "";
    let errOut = "";
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error("avdmanager timed out")); }, timeout);
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.stderr.on("data", (d) => { errOut += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ code, out: String(out), errOut: String(errOut) });
      else reject(new Error(`avdmanager exited (${code}): ${(errOut || out).slice(-2000)}`));
    });
    try { if (stdin) child.stdin.write(stdin); } catch {}
    try { child.stdin.end(); } catch {}
  });
}

// Real hardware-profile IDs from `avdmanager list device` — the static DEVICES
// catalog is only labels; IDs like "pixel_8" may not exist in a given tools
// release (→ "No device found matching --device"). Resolve live, fuzzy-match,
// and fall back to the default profile instead of failing the whole create.
async function listDeviceIds() {
  try {
    if (!fs.existsSync(avdManagerBin())) return [];
    const { out } = await runAvdManager(["list", "device", "-c"], { stdin: "" });
    const ids = [];
    for (const line of String(out || "").split(/\r?\n/)) {
      const q = line.match(/"([^"]+)"/);
      if (q) { ids.push(q[1].trim()); continue; }
      const bare = line.trim().match(/^([\w\-.]+)$/);
      if (bare && !/^(id|name|oem|tag)$/i.test(bare[1])) ids.push(bare[1]);
    }
    return [...new Set(ids.filter(Boolean))];
  } catch { return []; }
}

function matchDeviceId(want, ids) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const w = norm(want);
  if (!w) return { id: null, note: "default hardware profile" };
  if (!ids.length) return { id: want, note: null }; // can't validate — try as-is
  if (ids.includes(want)) return { id: want, note: null };
  const byNorm = ids.find((id) => norm(id) === w);
  if (byNorm) return { id: byNorm, note: null };
  // newest Pixel profile, e.g. want pixel_8 → pixel_7 / pixel (whatever exists)
  const pixels = ids
    .filter((id) => norm(id).startsWith("pixel"))
    .sort((a, b) => {
      const na = parseInt((norm(a).match(/\d+/) || [0])[0], 10);
      const nb = parseInt((norm(b).match(/\d+/) || [0])[0], 10);
      return nb - na;
    });
  if (w.startsWith("pixel") && pixels.length) {
    return { id: pixels[0], note: `"${want}" not in this tools release — using "${pixels[0]}" instead` };
  }
  return { id: null, note: `"${want}" not a known device — using default hardware profile` };
}

async function listAvds() {
  ensureDirs();
  if (!fs.existsSync(emulatorBin())) return [];
  try {
    const { stdout } = await execOut(emulatorBin(), ["-list-avds"], { env: androidEnv(), timeout: 30000 });
    const names = String(stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return names;
  } catch {
    // Fallback: scan avd dir for *.ini
    try {
      return fs.readdirSync(getAvdDir()).filter((f) => f.endsWith(".ini")).map((f) => path.basename(f, ".ini"));
    } catch { return []; }
  }
}

async function adbDevices() {
  try {
    if (!fs.existsSync(adbBin())) return [];
    const { stdout } = await execOut(adbBin(), ["devices"], { env: androidEnv(), timeout: 15000 });
    const lines = String(stdout || "").split(/\r?\n/).slice(1);
    const devs = [];
    for (const ln of lines) {
      const m = ln.trim().match(/^(\S+)\s+(device|offline|unauthorized)$/);
      if (m) devs.push({ serial: m[1], state: m[2] });
    }
    return devs;
  } catch { return []; }
}

async function emulatorSerialToAvd(serial) {
  try {
    const { stdout } = await execOut(adbBin(), ["-s", serial, "emu", "avd", "name"], { env: androidEnv(), timeout: 15000 });
    const first = String(stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first || null;
  } catch { return null; }
}

// Track emulator processes spawned by this app for Stop support
const runningEmulators = new Map(); // avdName -> { pid, child, startedAt, logFile }
// In-app Terminal tab that mirrors emulator stdout/stderr (must match renderer index.jsx)
const EMULATOR_LOG_TAB = "android-emulator-log";

let emuGrpc = null;
try { emuGrpc = require("./emulatorGrpc"); } catch (e) { /* gRPC frame source unavailable */ }
const grpcPorts = new Map(); // avdName -> grpc port
const grpcAuthFailed = new Set(); // avdName — server demanded auth; don't retry spammy
const grpcOkLogged = new Set(); // avdName — one-time "frames via gRPC" note

function getFreePort() {
  const net = require("net");
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

// The emulator resolves <name>.ini -> path= -> config.ini. Follow that link
// instead of assuming the location (a stale/wrong guess = silent no-op).
function avdConfigPath(avdName) {
  try {
    const raw = fs.readFileSync(path.join(getAvdDir(), `${avdName}.ini`), "utf8");
    const m = raw.match(/^\s*path\s*=\s*(.*?)\s*$/m);
    if (m && m[1]) {
      const cfg = path.join(m[1].replace(/\//g, path.sep), "config.ini");
      if (fs.existsSync(cfg)) return cfg;
    }
  } catch {}
  return path.join(getAvdDir(), `${avdName}.avd`, "config.ini");
}

function readAvdKey(avdName, key) {
  try {
    const raw = fs.readFileSync(avdConfigPath(avdName), "utf8");
    const m = raw.match(new RegExp("^\\s*" + key.replace(/\./g, "\\.") + "\\s*=\\s*(.*?)\\s*$", "m"));
    return m ? m[1] : null;
  } catch { return null; }
}

// Physical keyboard in the emulator's own window needs hw.keyboard=yes in the
// AVD's config.ini — avdmanager-created AVDs often lack it. Patch on every
// start (takes effect on boot); returns true when it changed something.
function ensureAvdKeyboard(avdName, iniPath = null) {
  try {
    const ini = iniPath || avdConfigPath(avdName);
    if (!fs.existsSync(ini)) return false;
    const text = fs.readFileSync(ini, "utf8");
    const m = text.match(/^\s*hw\.keyboard\s*=\s*(.*?)\s*$/m);
    if (m && String(m[1]).toLowerCase() === "yes") return false; // already good
    let next;
    if (m) next = text.replace(/^\s*hw\.keyboard\s*=.*$/m, "hw.keyboard=yes");
    else next = (text.endsWith("\n") ? text : text + "\n") + "hw.keyboard=yes\n";
    if (next === text) return false;
    fs.writeFileSync(ini, next);
    return true;
  } catch { return false; }
}

async function startEmulatorProcess(avdName, extraArgs = [], { headless = true } = {}) {
  ensureDirs();
  const bin = emulatorBin();
  if (!fs.existsSync(bin)) throw new Error("Emulator not installed yet — run Setup SDK first.");
  const kbFixed = ensureAvdKeyboard(avdName);
  if (runningEmulators.has(avdName)) {
    const cur = runningEmulators.get(avdName);
    try {
      process.kill(cur.pid, 0);
      if (kbFixed) {
        broadcast({ op: "start", phase: "config", message: `${avdName}: physical keyboard enabled — takes effect after restart.`, avd: avdName, at: Date.now() });
      }
      return cur;
    } catch { runningEmulators.delete(avdName); }
  }
  // gRPC frame source (localhost-only, no auth): picked per start so parallel
  // AVDs never clash. If the port can't be reserved, frames use adb instead.
  let grpcPort = null;
  if (emuGrpc) {
    try { grpcPort = await getFreePort(); }
    catch { grpcPort = null; }
  }
  const logFile = path.join(getDownloadsDir(), `emulator-${avdName}.log`);
  // Headless (default): no OS pop-up — the screen is streamed into the IDE panel via adb.
  // Windowed: classic separate emulator window (user choice via pop-out button).
  const args = headless
    ? ["-avd", avdName, "-no-window", "-no-audio", "-no-boot-anim", ...extraArgs]
    : ["-avd", avdName, "-no-boot-anim", ...extraArgs];
  if (grpcPort) args.push("-grpc", `localhost:${grpcPort}`);
  // Console strategy: ConPTY (node-pty) hosts the whole process tree on an
  // INVISIBLE console — plain CREATE_NO_WINDOW only hides the direct child
  // while grandchildren (qemu) still pop a visible conhost. Qt GUI windows
  // are unaffected (windowed mode still shows its window, minus the console).
  let child;
  let pid;
  let usedPty = false;
  if (ptyMod) {
    try {
      const p = ptyMod.spawn(bin, args, {
        name: "xterm-256color", cols: 160, rows: 40,
        cwd: getDownloadsDir(), env: androidEnv(),
      });
      pid = p.pid;
      usedPty = true;
      child = {
        pid,
        stdout: { on: (ev, fn) => { if (ev === "data") p.onData((d) => { try { fn(d); } catch {} }); } },
        stderr: { on: () => {} }, // pty merges stderr into stdout
        stdin: { write: () => {}, end: () => {} },
        on: (ev, fn) => { if (ev === "exit" || ev === "close") p.onExit(({ exitCode }) => { try { fn(exitCode); } catch {} }); },
        kill: () => { try { p.kill(); } catch {} },
        unref: () => {},
      };
    } catch (e) { ptyMod = null; } // fall through to plain spawn
  }
  if (!usedPty) {
    const c = spawn(bin, args, {
      env: androidEnv(),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    c.unref();
    child = c;
    pid = c.pid;
  }
  // Mirror stdout/stderr into the in-app Terminal ("Emulator" tab) + log file
  const forwardEmuOut = (chunk) => {
    try {
      let text = String(chunk.toString("utf8") || "");
      if (!text) return;
      try { fs.appendFileSync(logFile, text); } catch {}
      text = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
      if (text.length > 32768) text = text.slice(0, 32768) + "\r\n[…truncated]\r\n";
      const { BrowserWindow } = deps();
      for (const win of BrowserWindow.getAllWindows()) {
        try { if (!win.isDestroyed()) win.webContents.send("terminal:data", { tabId: EMULATOR_LOG_TAB, data: text }); } catch {}
      }
    } catch {}
  };
  try { child.stdout.on("data", (d) => forwardEmuOut(d)); } catch {}
  try { child.stderr.on("data", (d) => forwardEmuOut(d)); } catch {}
  const t0 = Date.now();
  child.on("exit", (code) => {
    if (runningEmulators.get(avdName)?.pid === child.pid) runningEmulators.delete(avdName);
    try {
      const { BrowserWindow } = deps();
      for (const win of BrowserWindow.getAllWindows()) {
        try { if (!win.isDestroyed()) win.webContents.send("terminal:exit", { tabId: EMULATOR_LOG_TAB, code: code ?? 0 }); } catch {}
      }
    } catch {}
    if (Date.now() - t0 < 15000) {
      broadcast({ op: "start", phase: "error", message: `${avdName}: emulator exited too quickly (code ${code}) — check free disk space, or delete + recreate the AVD.`, avd: avdName, at: Date.now() });
    }
  });
  const entry = { pid, startedAt: Date.now(), logFile, headless, grpcPort };
  runningEmulators.set(avdName, entry);
  if (grpcPort) {
    grpcPorts.set(avdName, grpcPort);
    grpcAuthFailed.delete(avdName);
  }
  if (kbFixed) {
    broadcast({ op: "start", phase: "config", message: `${avdName}: physical keyboard enabled (hw.keyboard=yes).`, avd: avdName, at: Date.now() });
  }
  // Proof line: exact value the emulator will boot with + the file it came from
  try {
    const cfg = avdConfigPath(avdName);
    const val = readAvdKey(avdName, "hw.keyboard");
    broadcast({ op: "start", phase: "config", message: `${avdName}: keyboard check → hw.keyboard=${val === null ? "(missing!)" : val} @ ${cfg}`, avd: avdName, at: Date.now() });
  } catch {}
  forwardEmuOut(`[${avdName}] emulator starting (pid ${pid}) — full log: ${logFile}\n`);
  broadcast({
    op: "start", phase: "started", avd: avdName, at: Date.now(),
    message: headless
      ? `${avdName} starting headless (pid ${pid}) — screen appears in the panel…`
      : `${avdName} starting in a separate window (pid ${pid})…`,
  });
  return entry;
}

// ─── Embedded screen: serial resolve, boot probe, screencap, input ──────────
// The panel polls these — no native window embedding needed.
function validSerial(serial) {
  return /^emulator-\d+$/.test(String(serial || ""));
}

// serial -> avdName (filled on resolve; lets android:frame find the grpc port
// without an extra adb call per frame). Evicted on stop/delete.
const serialAvdCache = new Map();
function cacheSerialAvd(serial, avdName) {
  if (!serial || !avdName) return;
  serialAvdCache.set(serial, avdName);
  if (serialAvdCache.size > 32) {
    try { serialAvdCache.delete(serialAvdCache.keys().next().value); } catch {}
  }
}
function evictAvdCaches(avdName) {
  try {
    for (const [serial, avd] of serialAvdCache) {
      if (avd === avdName) serialAvdCache.delete(serial);
    }
  } catch {}
  grpcPorts.delete(avdName);
  grpcAuthFailed.delete(avdName);
}

async function waitForSerial(avdName, timeoutMs = 150000) {
  const start = Date.now();
  for (;;) {
    let devs = [];
    try { devs = await adbDevices(); } catch {}
    for (const d of devs) {
      if (!d.serial.startsWith("emulator-") || d.state !== "device") continue;
      let avd = null;
      try { avd = await emulatorSerialToAvd(d.serial); } catch {}
      if (avd === avdName) {
        cacheSerialAvd(d.serial, avdName);
        return d.serial;
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${avdName} on adb (is the emulator still booting? Check the log).`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function adbShell(serial, shellArgs, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(adbBin(), ["-s", serial, ...shellArgs], { env: androidEnv(), timeout, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve(String(stdout || ""));
    });
  });
}

// Skip re-sending identical frames (static screens are the common case).
const frameHashes = new Map(); // serial -> hash
function fnv1a(buf) {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

async function findSerial(avdName) {
  try {
    const devs = await adbDevices();
    for (const d of devs) {
      if (!d.serial.startsWith("emulator-") || d.state !== "device") continue;
      let avd = null;
      try { avd = await emulatorSerialToAvd(d.serial); } catch {}
      if (avd === avdName) return d.serial;
    }
  } catch {}
  return null;
}

// Stream mode: drop the virtual display to ~540px wide (density scaled too)
// so screencap encode + transfer keeps up. Reset restores the AVD default.
async function setDisplayMode(serial, mode) {
  if (!validSerial(serial)) throw new Error("Bad emulator serial.");
  if (mode === "reset") {
    await adbShell(serial, ["shell", "wm", "size", "reset"], { timeout: 15000 }).catch(() => {});
    await adbShell(serial, ["shell", "wm", "density", "reset"], { timeout: 15000 }).catch(() => {});
    return { ok: true, mode: "reset" };
  }
  const sizeOut = await adbShell(serial, ["shell", "wm", "size"], { timeout: 15000 });
  const densOut = await adbShell(serial, ["shell", "wm", "density"], { timeout: 15000 }).catch(() => "");
  const sm = sizeOut.match(/Physical size:\s*(\d+)x(\d+)/);
  if (!sm) throw new Error("Could not read display size.");
  const pw = parseInt(sm[1], 10), ph = parseInt(sm[2], 10);
  if (pw <= 600) return { ok: true, mode: "stream", skipped: true }; // already small
  const dm = densOut.match(/Physical density:\s*(\d+)/);
  const pd = dm ? parseInt(dm[1], 10) : 0;
  const nw = 540;
  const nh = Math.round((ph * nw) / pw);
  const nd = pd ? Math.round((pd * nw) / pw) : 0;
  await adbShell(serial, ["shell", "wm", "size", `${nw}x${nh}`], { timeout: 15000 });
  if (nd) await adbShell(serial, ["shell", "wm", "density", String(nd)], { timeout: 15000 }).catch(() => {});
  return { ok: true, mode: "stream", size: `${nw}x${nh}` };
}

// `adb emu <cmd>` — talks to the emulator console (rotation, kill, …)
function adbEmu(serial, emuArgs, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(adbBin(), ["-s", serial, "emu", ...emuArgs],
      { env: androidEnv(), timeout, windowsHide: true, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
        resolve(String(stdout || "").trim() || String(stderr || "").trim());
      });
  });
}

function escapeInputText(s) {
  return String(s || "")
    .replace(/%/g, "%%")
    .replace(/ /g, "%s")
    .replace(/(['"()&|<>!`$\\;*?~#])/g, "\\$1")
    .slice(0, 500);
}

async function stopEmulatorProcess(avdName) {
  const entry = runningEmulators.get(avdName);
  if (entry) {
    try {
      if (process.platform === "win32") {
        await execOut("taskkill", ["/PID", String(entry.pid), "/F", "/T"], { timeout: 10000 }).catch(() => {});
      } else {
        try { process.kill(entry.pid, "SIGTERM"); } catch {}
        await new Promise((r) => setTimeout(r, 1500));
        try { process.kill(entry.pid, 0); process.kill(entry.pid, "SIGKILL"); } catch {}
      }
    } finally {
      runningEmulators.delete(avdName);
    }
    return { ok: true, via: "process" };
  }
  // Fallback: find emulator serial for this AVD and `adb emu kill`
  try {
    const devs = await adbDevices();
    for (const d of devs) {
      if (!d.serial.startsWith("emulator-")) continue;
      const avd = await emulatorSerialToAvd(d.serial);
      if (avd === avdName) {
        await execOut(adbBin(), ["-s", d.serial, "emu", "kill"], { env: androidEnv(), timeout: 15000 }).catch(() => {});
        return { ok: true, via: "adb" };
      }
    }
  } catch {}
  return { ok: false, error: "Emulator is not running (no tracked process found)." };
}

// ─── Setup orchestration ────────────────────────────────────────────────────
let setupRunning = false;

async function setupSdk(eventOp = "setup-sdk") {
  if (setupRunning) return { ok: false, error: "Setup already running — watch the progress log." };
  setupRunning = true;
  const op = eventOp;
  try {
    ensureDirs();
    progress(op, "start", "Checking Java…");
    let java = await checkJava();
    if (!java.ok || (java.major || 0) < 17) {
      // No usable system Java (e.g. Java 8) — fetch a portable Temurin 17 into
      // .appdata/android/jdk instead of asking the user to install anything.
      progress(op, "java", `System Java is ${java.version || "missing"} — downloading a portable JDK 17 (system Java untouched)…`);
      await ensureBundledJdk(op);
      java = await checkJava();
    }
    if (!java.ok || (java.major || 0) < 17) {
      throw new Error(
        `Portable JDK setup failed (found: ${java.version || "none"}). ` +
        `Install Eclipse Temurin 17+ manually from https://adoptium.net, make sure "java -version" reports 17+, then retry Setup.`
      );
    }
    progress(op, "start", `Java OK (${java.version}, via ${java.source}). Preparing folders…`);

    if (!fs.existsSync(sdkManagerBin())) {
      const url = cmdlineToolsUrl();
      const zipName = `commandlinetools-${process.platform}.zip`;
      const zipPath = path.join(getDownloadsDir(), zipName);
      if (zipHasEocd(zipPath)) {
        // Previous run already downloaded it (extract failed later) — reuse, don't re-download.
        const mb = (fs.statSync(zipPath).size / 1048576).toFixed(1);
        progress(op, "download", `Reusing existing download (${mb} MB) — skipping re-download.`, 100);
      } else {
        progress(op, "download", `Downloading Android command-line tools…\n${url}`);
        await downloadFile(url, zipPath, op, (pct, done, total) => {
          const mb = `${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`;
          progress(op, "download", `Downloading command-line tools… ${pct}% (${mb})`, pct, { done, total });
        });
      }
      progress(op, "extract", "Extracting to .appdata/android/sdk/cmdline-tools/latest …");
      await extractCmdlineTools(zipPath, op);
      progress(op, "extract", "Command-line tools ready.", 100);
    } else {
      progress(op, "extract", "Command-line tools already present — skipping download.");
    }

    progress(op, "install", "Installing platform-tools + emulator + android-35 platform…");
    await installPackages([...BASE_PACKAGES], op);
    progress(op, "install", `Installing default system image (${DEFAULT_IMAGE})…`);
    await installPackages([DEFAULT_IMAGE], op);

    // Default AVD so the panel has something to Start on first run (§5)
    try {
      const existing = await listAvds();
      if (!existing.includes("Pixel_8")) {
        progress(op, "avd", "Creating default AVD Pixel_8 (Android 15)…");
        await createAvdInternal({ name: "Pixel_8", device: "pixel_8", image: DEFAULT_IMAGE, op });
      }
    } catch (e) {
      progress(op, "avd", `Default AVD skipped: ${String(e?.message || e).split("\n")[0].slice(0, 180)}`);
    }

    progress(op, "done", "Android SDK setup complete.", 100);
    return { ok: true, sdkRoot: getSdkRoot() };
  } catch (e) {
    const msg = e?.message || String(e);
    progress(op, "error", msg);
    return { ok: false, error: msg.slice(0, 1200) };
  } finally {
    setupRunning = false;
  }
}

async function createAvdInternal({ name, device, image, op = "create" }) {
  const avdName = String(name || "").trim();
  if (!/^[A-Za-z0-9_.\-]+$/.test(avdName)) throw new Error("AVD name may only contain letters, numbers, _, - and .");
  if (!image) throw new Error("Missing system image.");
  ensureDirs();
  if (!fs.existsSync(avdManagerBin())) throw new Error("sdkmanager/avdmanager not installed — run Setup SDK first.");
  // Ensure the requested image exists (Create flow downloads it on demand — §9)
  progress(op, "image", `Ensuring system image ${image} …`);
  await installPackages([image], op);
  const lvl = API_LEVELS.find((l) => l.image === image);
  if (lvl) await installPackages([lvl.platform], op).catch(() => {});
  // avdmanager create avd -n <name> -k "<image>" [-d <device>] — answer "no" to custom profile
  const args = ["create", "avd", "-n", avdName, "-k", image];
  const devId = String(device || "").trim();
  if (devId) {
    const ids = await listDeviceIds();
    const matched = matchDeviceId(devId, ids);
    if (matched.note) progress(op, "create", `${matched.note}.`);
    if (matched.id) args.push("-d", matched.id);
  }
  progress(op, "create", `Creating AVD ${avdName} …`);
  await runAvdManager(args, { stdin: "no\n" });
  progress(op, "done", `AVD ${avdName} created.`, 100);
  return { ok: true, name: avdName };
}

// ─── Public state snapshot ──────────────────────────────────────────────────
async function getState() {
  ensureDirs();
  const sdkInstalled = isSdkInstalled();
  const java = await checkJava().catch(() => ({ ok: false }));
  let avdNames = [];
  if (sdkInstalled) {
    try { avdNames = await listAvds(); } catch { avdNames = []; }
  }
  let running = [];
  try {
    const devs = sdkInstalled ? await adbDevices() : [];
    const emuSerials = devs.filter((d) => d.serial.startsWith("emulator-"));
    running = await Promise.all(emuSerials.map(async (d) => ({ serial: d.serial, avd: await emulatorSerialToAvd(d.serial) })));
  } catch { running = []; }
  const runningAvds = new Set([
    ...[...runningEmulators.keys()],
    ...running.map((r) => r.avd).filter(Boolean),
  ]);
  const avds = avdNames.map((n) => ({ ...describeAvd(n), running: runningAvds.has(n) }));
  return {
    ok: true,
    root: getAndroidRoot(),
    sdkRoot: getSdkRoot(),
    avdDir: getAvdDir(),
    downloadsDir: getDownloadsDir(),
    sdkInstalled,
    sdkmanager: fs.existsSync(sdkManagerBin()) ? sdkManagerBin() : null,
    avdmanager: fs.existsSync(avdManagerBin()) ? avdManagerBin() : null,
    emulator: fs.existsSync(emulatorBin()) ? emulatorBin() : null,
    adb: fs.existsSync(adbBin()) ? adbBin() : null,
    java,
    apiLevels: API_LEVELS,
    devices: DEVICES,
    basePackages: BASE_PACKAGES,
    defaultImage: DEFAULT_IMAGE,
    avds,
    running,
    tracked: [...runningEmulators.entries()].map(([avd, e]) => ({ avd, pid: e.pid, startedAt: e.startedAt, headless: e.headless !== false })),
  };
}

// ─── Raw framebuffer (no PNG encode on-device → 3-4x faster than screencap -p)
// `screencap` (raw) emits a 12-byte header (w, h, format LE) + RGBA pixels,
// which maps 1:1 onto canvas ImageData in the panel.
function parseRawFrame(raw) {
  if (!raw || raw.length < 16) throw new Error("Empty frame.");
  const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4), fmt = raw.readUInt32LE(8);
  if (fmt !== 1 || w <= 0 || h <= 0 || w > 4096 || h > 4096) {
    throw new Error(`Unsupported frame format (${w}x${h} fmt ${fmt}).`);
  }
  const expect = 12 + w * h * 4;
  if (raw.length < expect) throw new Error("Truncated frame.");
  return { w, h, pixels: raw.subarray(12, expect) };
}
const lastRawFrames = new Map(); // serial -> Buffer (memcmp skip for static screens)

function captureRawFrame(serial) {
  return new Promise((resolve, reject) => {
    execFile(adbBin(), ["-s", serial, "exec-out", "screencap"],
      { env: androidEnv(), timeout: 20000, windowsHide: true, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// ─── Persistent `adb shell` frame session ────────────────────────────────────
// A fresh adb client spawn (+handshake) per frame costs ~50-100ms on Windows.
// Instead, one `adb shell` stays open per serial with a MARKER-FRAMED protocol:
//
//   write:  echo __FS__; screencap; echo __FE__
//   read:   line "__FS__" → 12-byte header → w*h*4 pixels → line "__FE__"
//
// Every frame boundary is explicitly verified, so a stray byte can never
// cascade into a permanently glitched stream (the failure mode of naive
// exact-size reads): any mismatch destroys the session and the frame falls
// back to one-shot exec-out. Worst case == old behavior, never a stuck glitch.
const FS_START = "__FS__";
const FS_END = "__FE__";
const frameSessions = new Map(); // serial -> { child, buf, queue, busy, dead }

function frameSessionDestroy(serial) {
  const s = frameSessions.get(serial);
  if (!s) return;
  frameSessions.delete(serial);
  try { s.dead = true; } catch {}
  // settle anything still waiting — a hung read would freeze the panel loop
  try {
    const pending = s.queue.splice(0);
    for (const q of pending) { try { q.reject(new Error("session destroyed")); } catch {} }
  } catch {}
  try { s.child.kill(); } catch {}
}

// Queue entries: { kind:"exact", need } or { kind:"line", max }. Strict FIFO.
function frameSessionPump(s) {
  while (s.queue.length && !s.dead) {
    const req = s.queue[0];
    if (req.kind === "line") {
      const idx = s.buf.indexOf(0x0a); // \n
      if (idx < 0) {
        if (s.buf.length > req.max) {
          s.buf = Buffer.alloc(0); // drop unterminated garbage so it can't poison the next reader
          s.queue.shift();
          try { req.reject(new Error("line too long (desync)")); } catch {}
          continue;
        }
        return; // wait for more bytes
      }
      if (idx > req.max) {
        s.buf = s.buf.subarray(idx + 1); // drop the over-long line, keep what follows
        s.queue.shift();
        try { req.reject(new Error("line too long (desync)")); } catch {}
        continue;
      }
      const line = s.buf.subarray(0, idx);
      s.buf = s.buf.subarray(idx + 1);
      s.queue.shift();
      try { req.resolve(Buffer.from(line)); } catch {}
    } else {
      if (s.buf.length < req.need) return;
      const chunk = s.buf.subarray(0, req.need);
      s.buf = s.buf.subarray(req.need);
      s.queue.shift();
      try { req.resolve(Buffer.from(chunk)); } catch {}
    }
  }
}

function frameSessionGet(serial) {
  let s = frameSessions.get(serial);
  if (s && !s.dead) return s;
  if (s) frameSessions.delete(serial);
  const child = spawn(adbBin(), ["-s", serial, "shell"], {
    env: androidEnv(), windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  s = { child, buf: Buffer.alloc(0), queue: [], busy: false, dead: false };
  child.stdout.on("data", (d) => {
    const cur = frameSessions.get(serial);
    if (!cur || cur !== s || s.dead) return;
    s.buf = Buffer.concat([s.buf, d]);
    if (s.buf.length > 96 * 1024 * 1024) { // garbage flood — desynced, start over
      frameSessionDestroy(serial);
      return;
    }
    frameSessionPump(s);
  });
  child.stderr.on("data", () => {}); // shell chatter ignored — markers validate sync
  child.on("error", () => { s.dead = true; });
  child.on("exit", () => { s.dead = true; });
  frameSessions.set(serial, s);
  return s;
}

function frameSessionEnqueue(serial, req, timeoutMs = 15000) {
  const s = frameSessionGet(serial);
  return new Promise((resolve, reject) => {
    const entry = { ...req, resolve: (b) => { clearTimeout(timer); resolve(b); }, reject: (e) => { clearTimeout(timer); reject(e); } };
    const timer = setTimeout(() => {
      const i = s.queue.indexOf(entry); // identity — always removes the right one
      if (i >= 0) s.queue.splice(i, 1);
      entry.reject(new Error("Frame read timed out"));
    }, timeoutMs);
    s.queue.push(entry);
    frameSessionPump(s);
  });
}

const frameSessionRead = (serial, need, timeoutMs) =>
  frameSessionEnqueue(serial, { kind: "exact", need }, timeoutMs);
const frameSessionReadLine = (serial, max = 256, timeoutMs) =>
  frameSessionEnqueue(serial, { kind: "line", max }, timeoutMs);

async function captureFrameSession(serial) {
  const s = frameSessionGet(serial);
  if (s.dead) throw new Error("shell dead");
  if (s.busy) throw new Error("session busy");
  s.busy = true;
  try {
    try { s.child.stdin.write(`echo ${FS_START}; screencap; echo ${FS_END}\n`); }
    catch (e) { throw new Error("shell write failed"); }
    // skip any stray lines until the start marker (bounded — shell MOTDs etc.)
    for (let i = 0; i < 50; i++) {
      const ln = (await frameSessionReadLine(serial)).toString("utf8").replace(/\r$/, "");
      if (ln === FS_START) break;
      if (i === 49) throw new Error("no start marker (desync)");
    }
    const head = await frameSessionRead(serial, 12);
    const w = head.readUInt32LE(0), h = head.readUInt32LE(4), fmt = head.readUInt32LE(8);
    if (fmt !== 1 || w <= 0 || h <= 0 || w > 4096 || h > 4096) {
      throw new Error(`desync (${w}x${h} fmt ${fmt})`);
    }
    const expect = w * h * 4;
    if (expect > 64 * 1024 * 1024) throw new Error("frame too large");
    const pixels = await frameSessionRead(serial, expect);
    const endLn = (await frameSessionReadLine(serial)).toString("utf8").replace(/\r$/, "");
    if (endLn !== FS_END) throw new Error("no end marker (desync)");
    return { w, h, pixels };
  } finally {
    try { s.busy = false; } catch {}
  }
}

// ─── IPC wiring ─────────────────────────────────────────────────────────────
function setupAndroidIpc() {
  const { ipcMain, shell } = require("electron");
  ensureDirs();

  ipcMain.handle("android:getState", async () => {
    try { return await getState(); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  ipcMain.handle("android:setupSdk", async () => setupSdk("setup-sdk"));

  ipcMain.handle("android:listAvds", async () => {
    try {
      const names = await listAvds();
      return { ok: true, avds: names.map((n) => describeAvd(n)) };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });

  ipcMain.handle("android:createAvd", async (_e, payload = {}) => {
    try {
      if (setupRunning) return { ok: false, error: "SDK Setup is still running — wait for it to finish, then create the emulator." };
      const { name, device, api, image } = payload;
      let sysImage = image;
      if (!sysImage && api) {
        const lvl = API_LEVELS.find((l) => l.api === parseInt(api, 10));
        if (lvl) sysImage = lvl.image;
      }
      if (!sysImage) sysImage = DEFAULT_IMAGE;
      return await createAvdInternal({ name, device, image: sysImage, op: "create" });
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
  });

  ipcMain.handle("android:deleteAvd", async (_e, { name } = {}) => {
    try {
      const avdName = String(name || "").trim();
      if (!avdName) return { ok: false, error: "Missing AVD name." };
      try {
        const s = await findSerial(avdName);
        if (s) {
          await setDisplayMode(s, "reset").catch(() => {});
          frameSessionDestroy(s);
        }
      } catch {}
      try {
        const gp = grpcPorts.get(avdName);
        if (gp && emuGrpc) emuGrpc.closeClient(gp);
      } catch {}
      evictAvdCaches(avdName);
      await stopEmulatorProcess(avdName).catch(() => {});
      if (fs.existsSync(avdManagerBin())) {
        await runAvdManager(["delete", "avd", "-n", avdName], { stdin: "" }).catch(async (e) => {
          // Fallback: manual file removal if avdmanager delete fails
          try {
            fs.rmSync(path.join(getAvdDir(), `${avdName}.avd`), { recursive: true, force: true });
            fs.rmSync(path.join(getAvdDir(), `${avdName}.ini`), { force: true });
            return { ok: true };
          } catch { throw e; }
        });
      } else {
        fs.rmSync(path.join(getAvdDir(), `${avdName}.avd`), { recursive: true, force: true });
        fs.rmSync(path.join(getAvdDir(), `${avdName}.ini`), { force: true });
      }
      broadcast({ op: "delete", phase: "done", message: `${avdName} deleted.`, avd: avdName, at: Date.now() });
      return { ok: true };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
  });

  ipcMain.handle("android:startAvd", async (_e, { name, args, windowed } = {}) => {
    try {
      const avdName = String(name || "").trim();
      if (!avdName) return { ok: false, error: "Missing AVD name." };
      const entry = await startEmulatorProcess(
        avdName,
        Array.isArray(args) ? args.filter((a) => typeof a === "string").slice(0, 12) : [],
        { headless: !windowed }
      );
      return { ok: true, pid: entry.pid, headless: entry.headless !== false };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
  });

  ipcMain.handle("android:stopAvd", async (_e, { name } = {}) => {
    try {
      const avdName = String(name || "").trim();
      // restore full resolution before killing (stream mode changed it)
      try {
        const s = await findSerial(avdName);
        if (s) {
          await setDisplayMode(s, "reset").catch(() => {});
          frameSessionDestroy(s);
        }
      } catch {}
      try {
        const gp = grpcPorts.get(avdName);
        if (gp && emuGrpc) emuGrpc.closeClient(gp);
      } catch {}
      evictAvdCaches(avdName);
      const r = await stopEmulatorProcess(avdName);
      if (r.ok) broadcast({ op: "stop", phase: "done", message: `${name} stopped.`, avd: name, at: Date.now() });
      return r;
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
  });

  ipcMain.handle("android:frameStop", async (_e, { serial } = {}) => {
    try { if (validSerial(serial)) frameSessionDestroy(serial); } catch {}
    return { ok: true };
  });

  ipcMain.handle("android:display", async (_e, { serial, mode } = {}) => {
    try {
      if (!validSerial(serial)) return { ok: false, error: "Bad emulator serial." };
      if (!fs.existsSync(adbBin())) return { ok: false, error: "adb not installed." };
      return await setDisplayMode(serial, mode === "reset" ? "reset" : "stream");
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 300) }; }
  });

  ipcMain.handle("android:screenshot", async (_e, { serial, name } = {}) => {
    try {
      if (!validSerial(serial)) return { ok: false, error: "Bad emulator serial." };
      if (!fs.existsSync(adbBin())) return { ok: false, error: "adb not installed." };
      const png = await new Promise((resolve, reject) => {
        execFile(adbBin(), ["-s", serial, "exec-out", "screencap", "-p"],
          { env: androidEnv(), timeout: 20000, windowsHide: true, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)));
      });
      if (!png || png.length < 100) return { ok: false, error: "Empty frame." };
      ensureDirs();
      const safe = String(name || "emulator").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "emulator";
      const file = path.join(getDownloadsDir(), `${safe}-${Date.now()}.png`);
      fs.writeFileSync(file, png);
      return { ok: true, path: file };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 300) }; }
  });

  // Wait until the AVD's adbd is reachable, then the panel streams its screen.
  ipcMain.handle("android:waitSerial", async (_e, { name, timeoutMs } = {}) => {
    try {
      const avdName = String(name || "").trim();
      if (!avdName) return { ok: false, error: "Missing AVD name." };
      const t = Math.min(300000, Math.max(10000, parseInt(timeoutMs, 10) || 150000));
      return { ok: true, serial: await waitForSerial(avdName, t) };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 500) }; }
  });

  // Keyboard diagnostics: host-side config value + what Android itself sees
  // (dumpsys input device list + active IME). Runs automatically when the
  // panel connects to a device; result lines go to the setup log.
  ipcMain.handle("android:diagKeyboard", async (_e, { serial, name } = {}) => {
    const lines = [];
    try {
      const avdName = String(name || "").trim();
      if (avdName) {
        try {
          lines.push(`host: hw.keyboard=${readAvdKey(avdName, "hw.keyboard") ?? "(missing)"}`);
          lines.push(`host: config=${avdConfigPath(avdName)}`);
        } catch {}
      }
      if (!validSerial(serial)) {
        lines.push("device: no adb serial yet — rerun after boot");
        return { ok: true, lines };
      }
      if (!fs.existsSync(adbBin())) return { ok: false, error: "adb not installed." };
      try {
        const dump = await adbShell(serial, ["shell", "dumpsys", "input"], { timeout: 20000 });
        const kb = [];
        for (const ln of String(dump).split(/\r?\n/)) {
          if (/keyboard/i.test(ln) && kb.length < 12) kb.push(ln.trim().slice(0, 140));
        }
        // device descriptors carry keyboard flags — grab those blocks too
        const devBlocks = String(dump).match(/Device [^\n]*\n(?:.*\n){0,8}/gi) || [];
        for (const b of devBlocks) {
          if (/keyboard/i.test(b) && kb.length < 12) {
            const first = b.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 3).join(" | ").slice(0, 140);
            if (first && !kb.includes(first)) kb.push(first);
          }
        }
        lines.push(`device: keyboard lines (${kb.length})${kb.length ? "" : " — NONE, Android sees no hard keyboard!"}`);
        for (const k of kb) lines.push(`device:   ${k}`);
      } catch (e) { lines.push(`device: dumpsys failed (${String(e?.message || e).split("\n")[0].slice(0, 100)})`); }
      try {
        const ime = (await adbShell(serial, ["shell", "settings", "get", "secure", "default_input_method"], { timeout: 15000 })).trim();
        lines.push(`device: default_ime=${ime || "(unknown)"}`);
      } catch {}
      return { ok: true, lines };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 300) }; }
  });

  ipcMain.handle("android:bootState", async (_e, { serial } = {}) => {
    try {
      if (!validSerial(serial)) return { ok: false, error: "Bad emulator serial." };
      if (!fs.existsSync(adbBin())) return { ok: false, error: "adb not installed." };
      const out = await adbShell(serial, ["shell", "getprop", "sys.boot_completed"], { timeout: 15000 });
      return { ok: true, booted: out.trim() === "1" };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 300) }; }
  });

  ipcMain.handle("android:screencap", async (_e, { serial } = {}) => {
    try {
      if (!validSerial(serial)) return { ok: false, error: "Bad emulator serial." };
      if (!fs.existsSync(adbBin())) return { ok: false, error: "adb not installed." };
      const png = await new Promise((resolve, reject) => {
        execFile(adbBin(), ["-s", serial, "exec-out", "screencap", "-p"],
          { env: androidEnv(), timeout: 20000, windowsHide: true, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
          (err, stdout) => (err ? reject(err) : resolve(stdout)));
      });
      if (!png || png.length < 100) return { ok: false, error: "Empty frame." };
      const hash = fnv1a(png);
      if (frameHashes.get(serial) === hash) return { ok: true, unchanged: true };
      frameHashes.set(serial, hash);
      if (frameHashes.size > 20) {
        try { frameHashes.delete(frameHashes.keys().next().value); } catch {}
      }
      return { ok: true, png };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 300) }; }
  });

  ipcMain.handle("android:frame", async (_e, { serial } = {}) => {
    try {
      if (!validSerial(serial)) return { ok: false, error: "Bad emulator serial." };
      if (!fs.existsSync(adbBin())) return { ok: false, error: "adb not installed." };
      let w, h, pixels;
      let framed = null;
      // 1) gRPC screenshot (persistent channel, server-side scaling, no adb spawn)
      const avd = serialAvdCache.get(serial) || null;
      const port = avd ? grpcPorts.get(avd) : null;
      if (emuGrpc && port && avd && !grpcAuthFailed.has(avd)) {
        try {
          framed = await emuGrpc.getScreenshot(port, { width: emuGrpc.STREAM_WIDTH });
          if (!grpcOkLogged.has(avd)) {
            grpcOkLogged.add(avd);
            broadcast({ op: "frame", phase: "grpc", message: `${avd}: frames via gRPC (${framed.w}x${framed.h}).`, avd, at: Date.now() });
          }
        } catch (e) {
          if (e?.grpcAuth) {
            grpcAuthFailed.add(avd);
            broadcast({ op: "frame", phase: "auth", message: `${avd}: emulator wants gRPC auth — using adb frames instead.`, avd, at: Date.now() });
          }
          framed = null;
        }
      }
      // 2) persistent adb shell session
      if (!framed) {
        try {
          framed = await captureFrameSession(serial);
        } catch (e) {
          // session broken/desynced → destroy it, one-shot fallback (previous path)
          frameSessionDestroy(serial);
          framed = parseRawFrame(await captureRawFrame(serial));
        }
      }
      ({ w, h, pixels } = framed);
      const prev = lastRawFrames.get(serial);
      if (prev && prev.length === pixels.length && prev.equals(pixels)) {
        return { ok: true, unchanged: true, w, h };
      }
      lastRawFrames.set(serial, Buffer.from(pixels));
      if (lastRawFrames.size > 10) {
        try { lastRawFrames.delete(lastRawFrames.keys().next().value); } catch {}
      }
      return { ok: true, w, h, pixels };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 300) }; }
  });

  ipcMain.handle("android:input", async (_e, { serial, action } = {}) => {
    try {
      if (!validSerial(serial)) return { ok: false, error: "Bad emulator serial." };
      if (!fs.existsSync(adbBin())) return { ok: false, error: "adb not installed." };
      const a = action || {};
      const num = (v, lo, hi) => {
        const n = Math.round(Number(v));
        if (!Number.isFinite(n) || n < lo || n > hi) throw new Error("Coordinates out of range.");
        return n;
      };
      let args;
      if (a.type === "tap") {
        args = ["shell", "input", "tap", String(num(a.x, 0, 8000)), String(num(a.y, 0, 8000))];
      } else if (a.type === "swipe") {
        args = ["shell", "input", "swipe",
          String(num(a.x1, 0, 8000)), String(num(a.y1, 0, 8000)),
          String(num(a.x2, 0, 8000)), String(num(a.y2, 0, 8000)),
          String(num(a.ms ?? 300, 50, 5000))];
      } else if (a.type === "key") {
        args = ["shell", "input", "keyevent", String(num(a.code, 0, 300))];
      } else if (a.type === "text") {
        const t = escapeInputText(a.text);
        if (!t) return { ok: false, error: "Empty text." };
        args = ["shell", "input", "text", t];
      } else if (a.type === "rotate") {
        // True rotation like the emulator toolbar: console `rotate` first,
        // settings keys as fallback. Always reports which path worked (or both errors).
        const short = (e) => String(e?.message || e || "").split("\n")[0].slice(0, 160);
        try {
          const out = await adbEmu(serial, ["rotate"], { timeout: 15000 });
          if (/unknown command|invalid|not supported|error|failed/i.test(out)) {
            throw new Error(out.slice(0, 160) || "console rejected rotate");
          }
          return { ok: true, method: "console", detail: out.slice(0, 120) };
        } catch (e1) {
          try {
            await adbShell(serial, ["shell", "settings", "put", "system", "accelerometer_rotation", "0"], { timeout: 15000 });
            let cur = 0;
            try { cur = parseInt(await adbShell(serial, ["shell", "settings", "get", "system", "user_rotation"], { timeout: 15000 }), 10) || 0; } catch {}
            const next = (cur + 1) % 4;
            await adbShell(serial, ["shell", "settings", "put", "system", "user_rotation", String(next)], { timeout: 15000 });
            return { ok: true, method: "settings", detail: `rotation=${next}` };
          } catch (e2) {
            throw new Error(`Rotate failed — console: ${short(e1)}; settings: ${short(e2)}`);
          }
        }
      } else {
        return { ok: false, error: "Unknown input action." };
      }
      await adbShell(serial, args, { timeout: 15000 });
      return { ok: true };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 300) }; }
  });

  ipcMain.handle("android:installPackage", async (_e, { packageId } = {}) => {
    try {
      const id = String(packageId || "").trim();
      if (!id) return { ok: false, error: "Missing package id." };
      await installPackages([id], "install-package");
      return { ok: true };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
  });

  ipcMain.handle("android:revealFolder", async () => {
    try { ensureDirs(); await shell.openPath(getAndroidRoot()); return { ok: true }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });
}

module.exports = {
  setupAndroidIpc,
  getAndroidRoot,
  getSdkRoot,
  getAvdDir,
  getDownloadsDir,
  isSdkInstalled,
  API_LEVELS,
  DEVICES,
  // exposed for diagnostics / tests
  zipHasEocd,
  extractZipNode,
  javaMajorOf,
  temurinTarget,
  matchDeviceId,
  listDeviceIds,
  parseSdkLine,
  parseRawFrame,
  ensureAvdKeyboard,
  avdConfigPath,
  readAvdKey,
  frameSessionPump,
};
