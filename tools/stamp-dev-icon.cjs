/**
 * tools/stamp-dev-icon.cjs
 * Dev-only: node_modules/electron/dist/electron.exe me app ka icon embed karta hai,
 * taaki dev run (`electron .`) me Windows taskbar par Electron ke default logo ki
 * jagah app ka logo dikhe.
 *
 * Kyun zaroori hai: Windows taskbar button live window icon se NAHI, process exe
 * ki identity (embedded icon + AUMID) se icon uthata hai. Dev me exe electron.exe
 * hai jiska icon Electron ka hai — BrowserWindow `icon` option chahe kuch bhi ho,
 * taskbar wahi dikhayegi. Exe stamp karna hi deterministic fix hai.
 *
 * - `postinstall` se auto-chalta hai (electron binary fresh download ke baad bhi)
 * - Dobara stamp sirf tab jab icon.ico ya electron.exe stamp ke baad change hua ho
 * - Kabhi throw nahi karta: stamp fail ho to warning dekar aage badhta hai
 *   (jaise dev app chal rahi ho to exe locked hoga — app band karke
 *   `npm run dev:icon` dobara chalao)
 * - Revert: `npm rebuild electron` ya electron reinstall karne par wapas default
 */
"use strict";

const fs = require("fs");
const path = require("path");

async function main() {
  if (process.platform !== "win32") return;
  const root = path.resolve(__dirname, "..");
  const exe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  const ico = path.join(root, "build", "icons", "icon.ico");
  if (!fs.existsSync(exe)) { console.log("[dev-icon] electron.exe nahi mila, skip"); return; }
  if (!fs.existsSync(ico)) { console.log("[dev-icon] build/icons/icon.ico nahi mila, skip (pehle `npm run build:icons`)"); return; }

  const marker = path.join(root, "node_modules", ".cache", "idiot-box-dev-icon");
  try {
    const exeStat = fs.statSync(exe);
    const icoStat = fs.statSync(ico);
    const markerStat = fs.statSync(marker);
    const stampedIcoTime = Number(fs.readFileSync(marker, "utf8")) || 0;
    // Stamp tab invalid jab: icon stamp ke baad regenerate hua, ya exe reinstall hua
    if (stampedIcoTime >= icoStat.mtimeMs && markerStat.mtimeMs >= exeStat.mtimeMs) {
      console.log("[dev-icon] electron.exe pehle se stamped hai, skip");
      return;
    }
  } catch { /* marker missing/corrupt -> stamp karo */ }

  const { rcedit } = require("rcedit");
  await rcedit(exe, { icon: ico });
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, String(fs.statSync(ico).mtimeMs));
  console.log("[dev-icon] electron.exe me app logo stamp ho gaya");
}

main().catch((e) => {
  console.warn("[dev-icon] stamp nahi ho paya (app phir bhi normal chalegi): " + (e && e.message));
  console.warn("[dev-icon] dev app band karke dobara chalao: npm run dev:icon");
});
