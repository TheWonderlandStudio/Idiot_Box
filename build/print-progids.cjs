/**
 * build/print-progids.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Prints the Windows ProgIDs electron-builder v27 generates for our
 * fileAssociations (NSIS target), plus ready-to-paste NSIS !defines.
 *
 * The ProgIDs are deterministic: UUIDv5(appId) as namespace + productFilename
 * as program segment (see node_modules/app-builder-lib ProgIdMaker). They only
 * change if `build.appId`, `build.productName`, or an association `name`
 * changes — if any of those change, re-run this script and update the
 * IB_PROGID_* defines in build/installer.nsh.
 *
 * Usage:
 *   node build/print-progids.cjs            # human-readable mapping
 *   node build/print-progids.cjs --nsis     # NSIS !define lines for installer.nsh
 */
"use strict";

async function main() {
  const path = require("path");
  const pkg = require(path.join(__dirname, "..", "package.json"));
  const { ProgIdMaker, ELECTRON_BUILDER_NS_UUID } = await import(
    "../node_modules/app-builder-lib/dist/targets/win/nsis/progId.js"
  );
  const { UUID } = await import("builder-util-runtime");

  const appId = pkg.build.appId;
  const productFilename = pkg.build.productName; // appInfo.productFilename == productName ("Idiot Box")
  const appGuid = UUID.v5(appId, ELECTRON_BUILDER_NS_UUID).toString();
  const maker = new ProgIdMaker(appGuid, productFilename);

  const names = [];
  for (const item of pkg.build.fileAssociations || []) {
    const firstExt = Array.isArray(item.ext) ? item.ext[0] : item.ext;
    names.push(item.name || firstExt);
  }

  if (process.argv.includes("--nsis")) {
    for (const name of names) {
      console.log(`!define IB_PROGID_${name} "${maker.progId(name)}"`);
    }
    return;
  }

  console.log(`appId:           ${appId}`);
  console.log(`appGuid:         ${appGuid}`);
  console.log(`productFilename: ${productFilename}`);
  console.log(`program segment: ${maker.program}`);
  console.log("");
  for (const name of names) {
    console.log(`${name} -> ${maker.progId(name)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
