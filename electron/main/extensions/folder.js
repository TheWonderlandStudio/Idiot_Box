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
function extensionId(manifest) {
  const custom = (manifest && (manifest.idiotbox || manifest.ibox)) || {};
  if (custom.id) return safeId(custom.id);
  const name = custom.name || (manifest && manifest.name) || "";
  if (!name) return "";
  if (String(name).includes(".")) return safeId(name);
  return safeId(`${(manifest && manifest.publisher) || custom.publisher || "local"}.${name}`);
}

function installFromFolder(folder, rootDir) {
  const src = path.resolve(folder);
  const manifest = readManifest(src);
  if (!manifest) throw new Error("No package.json in that folder");
  const id = extensionId(manifest);
  if (!id) throw new Error("package.json needs name or idiotbox.id");
  const dest = path.join(rootDir, id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, filter: (s) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(s) });
  return { id, dir: dest, manifest };
}

module.exports = { installFromFolder, readManifest, extensionId, safeId };
