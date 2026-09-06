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

function startEmulatorProcess(avdName, extraArgs = []) {
  ensureDirs();
  const bin = emulatorBin();
  if (!fs.existsSync(bin)) throw new Error("Emulator not installed yet — run Setup SDK first.");
  if (runningEmulators.has(avdName)) {
    const cur = runningEmulators.get(avdName);
    try { process.kill(cur.pid, 0); return cur; } catch { runningEmulators.delete(avdName); }
  }
  const logFile = path.join(getDownloadsDir(), `emulator-${avdName}.log`);
  const args = ["-avd", avdName, ...extraArgs];
  const child = spawn(bin, args, {
    env: androidEnv(),
    detached: true,
    windowsHide: false, // emulator opens its own window; keep visible
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  child.on("exit", () => { if (runningEmulators.get(avdName)?.pid === child.pid) runningEmulators.delete(avdName); });
  const entry = { pid: child.pid, startedAt: Date.now(), logFile };
  runningEmulators.set(avdName, entry);
  broadcast({ op: "start", phase: "started", message: `${avdName} starting (pid ${child.pid})…`, avd: avdName, at: Date.now() });
  return entry;
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
    tracked: [...runningEmulators.entries()].map(([avd, e]) => ({ avd, pid: e.pid, startedAt: e.startedAt })),
  };
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

  ipcMain.handle("android:startAvd", async (_e, { name, args } = {}) => {
    try {
      const avdName = String(name || "").trim();
      if (!avdName) return { ok: false, error: "Missing AVD name." };
      const entry = startEmulatorProcess(avdName, Array.isArray(args) ? args.filter((a) => typeof a === "string").slice(0, 12) : []);
      return { ok: true, pid: entry.pid };
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
  });

  ipcMain.handle("android:stopAvd", async (_e, { name } = {}) => {
    try {
      const r = await stopEmulatorProcess(String(name || "").trim());
      if (r.ok) broadcast({ op: "stop", phase: "done", message: `${name} stopped.`, avd: name, at: Date.now() });
      return r;
    } catch (e) { return { ok: false, error: (e?.message || String(e)).slice(0, 1200) }; }
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
};
