// cm/keybindings.js — user-editable editor shortcuts.
// Reads overrides from settings.keybindings and installs a high-precedence
// CodeMirror keymap. Old defaults are blocked when the user rebinds a command,
// so the new binding is the only one that fires.
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import REGISTRY from "../../../../shared/keybindings.json";

const KEY_ALIASES = {
  Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight",
  Esc: "Escape", Space: "Space", Del: "Delete",
};

const toCmKey = (key) => {
  const s = String(key || "").trim();
  if (!s) return "";
  const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return "";
  const mods = [];
  let main = parts.pop();
  for (const p of parts) {
    if (/^(ctrl|cmd|command|meta)$/i.test(p)) mods.push("Mod");
    else if (/^alt$/i.test(p)) mods.push("Alt");
    else if (/^shift$/i.test(p)) mods.push("Shift");
  }
  main = KEY_ALIASES[main] || main;
  if (main.length === 1) main = main.toLowerCase();
  return [...mods, main].join("-");
};

const CMD_IDS = new Set(REGISTRY.filter((c) => c.scope === "editor").map((c) => c.id));

export const buildEditorKeymap = (overrides, getPath) => {
  const o = overrides && typeof overrides === "object" ? overrides : {};
  const entries = [];
  const run = (id) => () => {
    try {
      window.dispatchEvent(new CustomEvent("editor:command", { detail: { cmd: id, path: getPath ? getPath() : undefined } }));
    } catch {}
    return true;
  };
  for (const c of REGISTRY) {
    if (!CMD_IDS.has(c.id)) continue;
    const has = Object.prototype.hasOwnProperty.call(o, c.id);
    const effective = has ? String(o[c.id] || "") : String(c.default || "");
    const defCm = c.cmDefault ? String(c.cmDefault) : "";
    const effCm = effective ? toCmKey(effective) : "";
    if (!defCm && !effCm) continue;
    if (effCm) {
      entries.push({ key: effCm, run: run(c.id) });
    }
    if (defCm && defCm !== effCm) {
      // The command moved (or was unbound): swallow the old default so
      // CodeMirror's built-in keymap does not run the command twice.
      entries.push({ key: defCm, run: () => true });
    }
  }
  if (!entries.length) return [];
  try { return [Prec.highest(keymap.of(entries))]; } catch { return []; }
};
