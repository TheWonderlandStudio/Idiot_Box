// ─── Context-menu contributions ─────────────────────────────────────────────
// package.json `contributes.menus` + runtime `ibox.menus.register` dono yahan
// se native Electron menus me lagte hain.
"use strict";

const path = require("path");

// Host context-menu `type` → extension menu ids that should appear there.
const TYPE_SOURCES = {
  file: ["file", "explorer/context", "ibox.explorer", "ibox.file"],
  folder: ["folder", "explorer/context", "ibox.explorer", "ibox.folder"],
  multi: ["multi", "explorer/context", "ibox.explorer"],
  pinned: ["pinned", "explorer/context", "ibox.explorer", "ibox.folder"],
  none: ["none", "explorer/context", "ibox.empty"],
  breadcrumb: ["breadcrumb", "ibox.breadcrumb"],
  editor: ["editor", "editor/context", "ibox.editor"],
  tab: ["tab", "ibox.tab"],
  mediaViewer: ["mediaViewer", "ibox.media"],
};

function matchesMenu(storedMenu, type) {
  const sources = TYPE_SOURCES[type] || [type];
  return sources.includes(String(storedMenu || ""));
}

function evalAtom(atom, vars) {
  let s = String(atom || "").trim();
  if (!s) return true;
  let neg = false;
  if (s.charAt(0) === "!") {
    neg = true;
    s = s.slice(1).trim();
  }
  let ok;
  const cmp = s.match(/^([a-zA-Z][a-zA-Z0-9.]*)\s*(==|!=)\s*(.+)$/);
  if (cmp) {
    const left = vars[cmp[1]];
    const raw = cmp[3].trim().replace(/^['"]|['"]$/g, "");
    const eq = String(left ?? "") === raw;
    ok = cmp[2] === "==" ? eq : !eq;
  } else {
    ok = !!vars[s];
  }
  return neg ? !ok : ok;
}

// Tiny `when` evaluator: `resourceExtname == .js && !explorerResourceIsFolder`
function evalWhen(expr, ctx) {
  const s = String(expr || "").trim();
  if (!s) return true;
  const paths = ctx.selectedPaths || [];
  const p = String(paths[0] || ctx.filePath || "");
  const vars = {
    explorerResourceIsFolder: ctx.type === "folder" || ctx.type === "pinned",
    resourceExtname: path.extname(p).toLowerCase(),
    resourceFilename: path.basename(p),
  };
  try {
    return s.split("&&").every((part) => evalAtom(part, vars));
  } catch {
    return true;
  }
}

module.exports = { matchesMenu, evalWhen, TYPE_SOURCES };
