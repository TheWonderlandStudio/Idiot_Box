/**
 * tools/stamp-dev-icon.cjs
 * Dev-only: embeds the app icon into node_modules/electron/dist/electron.exe,
 * so a dev run (`electron .`) shows the app logo on the Windows taskbar instead
 * of Electron's default logo.
 *
 * Why needed: the Windows taskbar button takes its icon NOT from the live window icon,
 * but from the process exe identity (embedded icon + AUMID). In dev the exe is electron.exe
 * with Electron's icon — regardless of the BrowserWindow `icon` option,
 * the taskbar shows that. Stamping the exe is the deterministic fix.
 *
 * - Runs automatically via `postinstall` (even after a fresh electron binary download)
 * - Re-stamps whenever the icon changed OR electron.exe was replaced. The previous
 *   check compared mtimes, which broke after an electron reinstall: the freshly
 *   downloaded electron.exe carries a fixed 1980 timestamp, so it looked "older"
 *   than our marker and the stamp was wrongly skipped (=> default taskbar icon).
 *   We now fingerprint the exe (size + mtime, recorded AFTER stamping) and the
 *   exact icon bytes, so a replaced/unstamped exe is always re-stamped.
 * - Falls back to the committed electron/renderer/assets/icon.ico when
 *   build/icons/icon.ico has not been generated yet.
 * - Never throws: on stamp failure it warns and continues
 *   (e.g. if the dev app is running the exe will be locked — close the app and
 *   `npm run dev:icon` again)
 * - Revert: back to default on `npm rebuild electron` or electron reinstall
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function sha1(buf) { return crypto.createHash("sha1").update(buf).digest("hex"); }

async function main() {
  if (process.platform !== "win32") return;
  const root = path.resolve(__dirname, "..");
  const exe = path.join(root, "node_modules", "electron", "dist", "electron.exe");

  // Prefer the generated icon, but fall back to the committed asset so a fresh
  // clone (where build:icons has not run) still gets a stamped taskbar icon.
  const ico = [
    path.join(root, "build", "icons", "icon.ico"),
    path.join(root, "electron", "renderer", "assets", "icon.ico"),
  ].find((p) => fs.existsSync(p));

  if (!fs.existsSync(exe)) { console.log("[dev-icon] electron.exe not found, skip"); return; }
  if (!ico) { console.log("[dev-icon] no icon.ico found, skip (run `npm run build:icons` first)"); return; }

  const marker = path.join(root, "node_modules", ".cache", "idiot-box-dev-icon");
  const iconHash = sha1(fs.readFileSync(ico));
  const exeStat = fs.statSync(exe);

  // Skip only when the CURRENT exe is the one we stamped for THIS exact icon.
  // exeSize/exeMtime are recorded post-stamp, so an untouched stamped exe matches
  // while a freshly reinstalled electron.exe (different size) does not.
  try {
    const prev = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (prev.iconHash === iconHash && prev.exeSize === exeStat.size && prev.exeMtime === exeStat.mtimeMs) {
      console.log("[dev-icon] electron.exe already stamped, skip");
      return;
    }
  } catch { /* marker missing/corrupt/legacy -> stamp again */ }

  const { rcedit } = require("rcedit");
  await rcedit(exe, { icon: ico });
  const stamped = fs.statSync(exe);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ iconHash, exeSize: stamped.size, exeMtime: stamped.mtimeMs }));
  console.log("[dev-icon] app logo stamped into electron.exe");
}

main().catch((e) => {
  console.warn("[dev-icon] stamp failed (app will still run normally): " + (e && e.message));
  console.warn("[dev-icon] close the dev app and run again: npm run dev:icon");
});
