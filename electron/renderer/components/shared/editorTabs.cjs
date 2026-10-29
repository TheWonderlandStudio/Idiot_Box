const normalize = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
const pathKey = (value) => {
  const normalized = normalize(value);
  return /^[a-z]:(\/|$)/i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
};

function relativeProjectPath(filePath, rootPath) {
  if (!filePath || !rootPath) return null;
  const file = normalize(filePath);
  const root = normalize(rootPath);
  const prefix = `${pathKey(root)}/`;
  if (!pathKey(file).startsWith(prefix)) return null;
  const relative = file.slice(root.length + 1);
  return relative && !relative.split("/").includes("..") ? relative : null;
}

function closedEditorSnapshot(node) {
  if (!node || !["editor", "notebook"].includes(node.getComponent?.())) return null;
  const config = node.getConfig?.();
  if (!config?.filePath) return null;
  const parent = node.getParent?.();
  return {
    parentId: parent?.getId?.(),
    index: parent?.getChildren?.().indexOf(node) ?? -1,
    tab: {
      type: "tab", component: node.getComponent(), enableClose: true,
      name: String(config.filePath).split(/[\\/]/).pop(),
      config: JSON.parse(JSON.stringify(config)),
    },
  };
}

function findOpenEditor(model, filePath) {
  let found = null;
  model.visitNodes((node) => {
    if (!found && ["editor", "notebook"].includes(node.getComponent?.()) &&
        pathKey(node.getConfig?.()?.filePath) === pathKey(filePath)) found = node;
  });
  return found;
}

function createClosedEditorHistory(limit = 20) {
  let project = null;
  let entries = [];
  return {
    setProject(root) {
      const next = root ? pathKey(root) : null;
      if (next !== project) { entries = []; project = next; }
    },
    remember(entry) {
      if (!project || !entry?.tab?.config?.filePath) return;
      const key = pathKey(entry.tab.config.filePath);
      entries = entries.filter((item) => pathKey(item.tab.config.filePath) !== key);
      entries.push(entry);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
    },
    peek: () => entries.at(-1) || null,
    remove(entry) { entries = entries.filter((item) => item !== entry); },
    get size() { return entries.length; },
  };
}

module.exports = { relativeProjectPath, closedEditorSnapshot, createClosedEditorHistory, findOpenEditor };
