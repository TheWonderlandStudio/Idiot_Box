// ─── mise service — on-demand runtimes for the Run button ───────────────────
// mise (https://mise.jdx.dev, MIT, single binary, Windows-supported) installs
// exact dev-tool versions per project. The Run panel uses it ONLY as a
// fallback: local runtime missing → `mise install <tool>` → run via
// `mise x -- <cmd>`. Success path (runtime present) never touches mise.
//
// Protocol (see preload electronAPI.mise*):
//   invoke("mise:ensure") -> { ok, bin?, version?, error? }
//   invoke("mise:trust", dir) -> { ok, error? }

const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");

const GITHUB_LATEST = "https://api.github.com/repos/jdx/mise/releases/latest";

function miseDir() {
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "mise");
  } catch {
    return path.join(os.homedir(), ".idiot-box", "mise");
  }
}

function miseBinName() {
  return process.platform === "win32" ? "mise.exe" : "mise";
}

function runBin(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    try {
      execFile(
        bin,
        args,
        { timeout: timeoutMs || 20000, windowsHide: true },
        (err, stdout, stderr) => {
          if (err) {
            resolve({ ok: false, error: String(stderr || (err && err.message) || err).slice(0, 300) });
          } else {
            resolve({ ok: true, output: String(stdout || "") });
          }
        }
      );
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
    }
  });
}

async function tryBin(bin) {
  const r = await runBin(bin, ["--version"], 10000);
  if (!r.ok) return null;
  const m = String(r.output).match(/(\d{4}\.\d+\.\d+|\d+\.\d+\.\d+)/);
  return { bin, version: m ? m[1] : String(r.output).trim().slice(0, 32) };
}

function pickAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const p = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const match = (name, wants) => {
    const n = String(name || "").toLowerCase();
    return wants.every((w) => n.includes(w));
  };
  let wants;
  if (p === "win32") wants = ["windows", "x64", ".zip"];
  else if (p === "darwin") wants = ["macos", arch];
  else wants = ["linux", "x64", ".tar.gz"];
  for (const a of list) {
    if (a && a.name && a.browser_download_url && match(a.name, wants)) return a;
  }
  // Loose fallback: any archive mentioning the platform.
  const plat = p === "win32" ? "windows" : p === "darwin" ? "macos" : "linux";
  for (const a of list) {
    const n = String((a && a.name) || "").toLowerCase();
    if (a && a.browser_download_url && n.includes(plat) && (n.endsWith(".zip") || n.endsWith(".tar.gz"))) return a;
  }
  return null;
}

async function downloadFile(url, dest) {
  const res = await fetch(url, {
    headers: { "User-Agent": "idiot-box", Accept: "application/octet-stream" },
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

function findBinaryRecursive(dir, name) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return full;
      if (e.isDirectory()) {
        const hit = findBinaryRecursive(full, name);
        if (hit) return hit;
      }
    }
  } catch {}
  return null;
}

async function extractArchive(archive, destDir) {
  const lower = String(archive).toLowerCase();
  if (lower.endsWith(".zip")) {
    // Windows 10+ ships bsdtar (handles zip); fallback to PowerShell.
    let r = await runBin("tar", ["-xf", archive, "-C", destDir], 60000);
    if (!r.ok && process.platform === "win32") {
      r = await runBin("powershell", [
        "-NoProfile", "-NonInteractive", "-Command",
        `Expand-Archive -LiteralPath "${archive}" -DestinationPath "${destDir}" -Force`,
      ], 60000);
    }
    if (!r.ok) throw new Error(`Extract failed: ${r.error || "unknown"}`);
  } else {
    const r = await runBin("tar", ["-xzf", archive, "-C", destDir], 60000);
    if (!r.ok) throw new Error(`Extract failed: ${r.error || "unknown"}`);
  }
}

async function ensureMise() {
  try {
    // 1) PATH
    const viaPath = await tryBin(process.platform === "win32" ? "mise.exe" : "mise");
    if (viaPath) return { ok: true, ...viaPath, source: "path" };
    // 2) Our cache
    const dir = miseDir();
    const cached = path.join(dir, miseBinName());
    if (fs.existsSync(cached)) {
      const hit = await tryBin(cached);
      if (hit) return { ok: true, ...hit, source: "cache" };
    }
    // 3) Download latest release
    fs.mkdirSync(dir, { recursive: true });
    let rel;
    try {
      const res = await fetch(GITHUB_LATEST, {
        headers: { "User-Agent": "idiot-box", Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rel = await res.json();
    } catch (e) {
      return { ok: false, error: `Cannot reach GitHub releases (${(e && e.message) || e}). Check connection — or install mise manually (https://mise.jdx.dev).` };
    }
    const asset = pickAsset(rel && rel.assets);
    if (!asset) {
      const names = (rel.assets || []).map((a) => a.name).filter(Boolean).slice(0, 12).join(", ");
      return { ok: false, error: `No mise binary for ${process.platform}-${process.arch} in latest release${names ? ` (saw: ${names})` : ""}. Install mise manually (https://mise.jdx.dev).` };
    }
    const archive = path.join(dir, asset.name);
    try {
      await downloadFile(asset.browser_download_url, archive);
    } catch (e) {
      return { ok: false, error: `mise download failed (${(e && e.message) || e}).` };
    }
    const outDir = path.join(dir, "pkg");
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.mkdirSync(outDir, { recursive: true });
      await extractArchive(archive, outDir);
    } catch (e) {
      return { ok: false, error: `mise extract failed (${(e && e.message) || e}).` };
    } finally {
      try { fs.rmSync(archive, { force: true }); } catch {}
    }
    const found = findBinaryRecursive(outDir, miseBinName()) || path.join(outDir, miseBinName());
    if (!fs.existsSync(found)) {
      return { ok: false, error: "mise archive had no binary — install mise manually (https://mise.jdx.dev)." };
    }
    try {
      if (process.platform !== "win32") fs.chmodSync(found, 0o755);
      if (found !== cached) {
        try { fs.rmSync(cached, { force: true }); } catch {}
        fs.copyFileSync(found, cached);
      }
    } catch {}
    const hit = await tryBin(cached);
    if (!hit) return { ok: false, error: "Downloaded mise binary does not run — install mise manually (https://mise.jdx.dev)." };
    return { ok: true, ...hit, source: "download" };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300) };
  }
}

function setupMiseIpc({ ipcMain }) {
  ipcMain.handle("mise:ensure", async () => ensureMise());
  ipcMain.handle("mise:trust", async (_e, dir) => {
    try {
      if (!dir || typeof dir !== "string") return { ok: false, error: "No directory" };
      const ens = await ensureMise();
      if (!ens.ok) return ens;
      const r = await runBin(ens.bin, ["trust", dir], 15000);
      // trust is best-effort (already-trusted exits 0; failures surface at install)
      return { ok: true, skipped: !r.ok };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
    }
  });
}

module.exports = { setupMiseIpc, ensureMise };
