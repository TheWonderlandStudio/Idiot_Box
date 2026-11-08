// npm postinstall.
//
// Native dependencies are only rebuilt when the electron-builder config asks
// for it (`build.nativeModules.npmRebuild`, default true). node-pty 1.1 ships
// N-API prebuilds that load in Electron as-is; `electron-builder
// install-app-deps` ignores npmRebuild=false and forces a node-gyp compile,
// which made a plain `npm install` fail on machines without Visual Studio.
//
// Keep this script so a future native dependency can opt back in by setting
// npmRebuild to true.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const shouldRebuild = pkg.build?.nativeModules?.npmRebuild !== false;

function run(command, args, label, useShell = false) {
  const isWindows = process.platform === "win32";
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    // electron-builder is a .cmd shim on Windows; node itself must not go
    // through cmd.exe (its path contains spaces).
    shell: useShell && isWindows,
    env: process.env,
  });
  if (result.error) {
    console.warn(`[postinstall] ${label} could not run: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`[postinstall] ${label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
  return true;
}

if (shouldRebuild) {
  run("electron-builder", ["install-app-deps"], "electron-builder install-app-deps", true);
} else {
  console.log("[postinstall] nativeModules.npmRebuild=false — using shipped N-API prebuilds, skipping electron-builder install-app-deps");
}

run(process.execPath, [path.join("build", "generate-icons.cjs")], "generate-icons");
run(process.execPath, [path.join("tools", "stamp-dev-icon.cjs")], "stamp-dev-icon");
