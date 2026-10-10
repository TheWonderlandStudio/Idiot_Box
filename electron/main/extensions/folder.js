// ─── Unpacked extension folder installer (pure Node, no electron) ───────────
"use strict";

const fs = require("fs");
const path = require("path");

function readManifest(dir) {
  const mf = path.join(dir, "package.json");
  if (!fs.existsSync(mf)) return null;
  try { return JSON.parse(fs.readFileSync(mf, "utf8")); } catch { return null; }
}

function safeId(v) {
  return String(v || "").replace(/[^a-z0-9._-]/gi, "-").replace(/^[-.]+|[-.]+$/g, "") || "";
}

// ── Copy an unpacked folder into rootDir so state stays uniform ─────────────
function installFromFolder(folder, rootDir) {
  const src = path.resolve(folder);
  const manifest = readManifest(src);
  if (!manifest || !manifest.name) throw new Error("No package.json with a name in that folder");
  const id = safeId(`${manifest.publisher || "local"}.${manifest.name}`);
  const dest = path.join(rootDir, id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s) });
  return { id, dir: dest, manifest };
}

module.exports = { installFromFolder, readManifest };
