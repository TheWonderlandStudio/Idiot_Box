// Keybinding resolution for Electron's native menu accelerators.
// Stored shortcuts use "Ctrl+…" on every platform; Electron wants
// "CmdOrCtrl+…" so the same settings file works on macOS.
const fs = require("fs");
const path = require("path");

let REGISTRY = [];
try {
  REGISTRY = JSON.parse(fs.readFileSync(path.join(__dirname, "../shared/keybindings.json"), "utf8"));
} catch {}
const BY_ID = Object.fromEntries((Array.isArray(REGISTRY) ? REGISTRY : []).map((c) => [c.id, c]));

const toElectron = (key) => String(key || "")
  .replace(/\bCtrl\b/g, "CmdOrCtrl")
  .replace(/\bCmd\b/g, "CmdOrCtrl")
  .replace(/\bCommand\b/g, "CmdOrCtrl")
  .trim();

/** Effective accelerator for a command, or undefined when the user unbound it. */
function acceleratorFor(settings, id, fallback) {
  const overrides = settings && typeof settings === "object" && settings.keybindings && typeof settings.keybindings === "object"
    ? settings.keybindings
    : {};
  const has = Object.prototype.hasOwnProperty.call(overrides, id);
  const raw = has ? String(overrides[id] || "") : String(fallback || BY_ID[id]?.default || "");
  if (!raw.trim()) return undefined;
  return toElectron(raw);
}

module.exports = { REGISTRY, BY_ID, acceleratorFor, toElectron };
