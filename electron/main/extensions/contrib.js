// ─── package.json `contributes` ka chhota summary ──────────────────────────
// UI ko dikhane ke liye: extension ke commands/views/menus/keybindings
// kahan-kahan lagte hain (Installed details + Community details dono me).
"use strict";

function summarizeContributions(mf) {
  const custom = (mf && (mf.idiotbox || mf.ibox)) || {};
  const native = custom.contributes || custom.extensions || {};
  const c = (mf && mf.contributes) || native;
  const menus = [];
  for (const [menuId, entries] of Object.entries(c.menus || {})) {
    if (Array.isArray(entries) && entries.length) menus.push({ menu: menuId, count: entries.length });
  }
  const views = [];
  for (const [container, entries] of Object.entries(c.views || {})) {
    if (!Array.isArray(entries)) continue;
    for (const v of entries) views.push({ container, id: (v && v.id) || "", name: (v && (v.name || v.id)) || "" });
  }
  const viewContainers = Object.entries(c.viewsContainers || {}).map(([id, vc]) => ({
    id, title: (vc && vc.title) || id,
  }));
  const keybindings = Array.isArray(c.keybindings)
    ? c.keybindings.filter(Boolean).map((k) => ({ key: k.key || "", command: k.command || "" }))
    : [];
  const configuration = Array.isArray(c.configuration) ? c.configuration.length : (c.configuration ? 1 : 0);
  return { menus, views, viewContainers, keybindings, configuration };
}

module.exports = { summarizeContributions };
