/**
 * build/notarize.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * electron-builder afterSign hook — submits the signed macOS .app to Apple's
 * notarization service.
 *
 * Required environment variables (set in CI / local .env — never commit):
 *   APPLE_ID                    Apple ID email used to request the notarization
 *   APPLE_APP_SPECIFIC_PASSWORD App-specific password created at appleid.apple.com
 *   APPLE_TEAM_ID               10-character Developer Team ID (e.g. "AB12CD34EF")
 *
 * Usage — this file is wired in via package.json "build.afterSign":
 *   "afterSign": "build/notarize.cjs"
 *
 * Skip notarization by not setting APPLE_ID (e.g. in local dev builds).
 *
 * Dependencies: @electron/notarize  (install once: npm i -D @electron/notarize)
 */
"use strict";

const path = require("path");

module.exports = async function notarize(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only run on macOS builds
  if (electronPlatformName !== "darwin") return;

  // Skip if Apple credentials are not set (local dev / Windows CI runners)
  const appleId       = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId        = process.env.APPLE_TEAM_ID;

  if (!appleId || !applePassword || !teamId) {
    console.log(
      "[notarize] Skipping — APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set."
    );
    return;
  }

  // Lazy-require so the module is optional (won't crash Windows builds if
  // @electron/notarize is absent)
  let notarize;
  try {
    ({ notarize } = require("@electron/notarize"));
  } catch {
    console.warn(
      "[notarize] @electron/notarize not installed. Run: npm i -D @electron/notarize"
    );
    return;
  }

  const appName  = context.packager.appInfo.productFilename;
  const appPath  = path.join(appOutDir, `${appName}.app`);

  console.log(`[notarize] Submitting ${appPath} to Apple Notary Service…`);
  console.log(`[notarize] Apple ID: ${appleId} | Team: ${teamId}`);

  await notarize({
    tool:        "notarytool",  // Preferred — xcrun notarytool (Xcode 13+)
    appPath,
    appleId,
    appleIdPassword: applePassword,
    teamId,
  });

  console.log("[notarize] Notarization complete ✓");
};
