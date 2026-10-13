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
 * - Re-stamps only when icon.ico or electron.exe changed after the last stamp
 * - Never throws: on stamp failure it warns and continues
 *   (e.g. if the dev app is running the exe will be locked — close the app and
 *   `npm run dev:icon` again)
 * - Revert: back to default on `npm rebuild electron` or electron reinstall
 */
"use strict";

const fs = require("fs");
const path = require("path");

async function main() {
  if (process.platform !== "win32") return;
  const root = path.resolve(__dirname, "..");
  const exe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  const ico = path.join(root, "build", "icons", "icon.ico");
  if (!fs.existsSync(exe)) { console.log("[dev-icon] electron.exe not found, skip"); return; }
  if (!fs.existsSync(ico)) { console.log("[dev-icon] build/icons/icon.ico not found, skip (run `npm run build:icons` first)"); return; }

  const marker = path.join(root, "node_modules", ".cache", "idiot-box-dev-icon");
  try {
    const exeStat = fs.statSync(exe);
    const icoStat = fs.statSync(ico);
    const markerStat = fs.statSync(marker);
    const stampedIcoTime = Number(fs.readFileSync(marker, "utf8")) || 0;
    // Stamp is invalid when: icon was regenerated after the stamp, or exe was reinstalled
    if (stampedIcoTime >= icoStat.mtimeMs && markerStat.mtimeMs >= exeStat.mtimeMs) {
      console.log("[dev-icon] electron.exe already stamped, skip");
      return;
    }
  } catch { /* marker missing/corrupt -> stamp again */ }

  const { rcedit } = require("rcedit");
  await rcedit(exe, { icon: ico });
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, String(fs.statSync(ico).mtimeMs));
  console.log("[dev-icon] app logo stamped into electron.exe");
}

main().catch((e) => {
  console.warn("[dev-icon] stamp failed (app will still run normally): " + (e && e.message));
  console.warn("[dev-icon] close the dev app and run again: npm run dev:icon");
});
