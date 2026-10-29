const { test } = require("node:test");
const assert = require("node:assert/strict");
const { relativeProjectPath, closedEditorSnapshot, createClosedEditorHistory, findOpenEditor } = require("../electron/renderer/components/shared/editorTabs.cjs");

const entry = (filePath) => ({ tab: { config: { filePath } } });

test("relative paths respect project boundaries and preserve filename case", () => {
  assert.equal(relativeProjectPath("C:\\Work\\app\\src\\Index.jsx", "c:\\work\\APP\\"), "src/Index.jsx");
  assert.equal(relativeProjectPath("C:\\other\\file.js", "C:\\work"), null);
  assert.equal(relativeProjectPath("/work/application/file.js", "/work/app"), null);
  assert.equal(relativeProjectPath("/work/app/../private.txt", "/work/app"), null);
  assert.equal(relativeProjectPath("/work/app", "/work/app"), null);
  assert.equal(relativeProjectPath("/Work/app/file.js", "/work/app"), null);
});

test("relative paths support Unix, drive roots, and network shares", () => {
  assert.equal(relativeProjectPath("/work/app/src/index.js", "/work/app/"), "src/index.js");
  assert.equal(relativeProjectPath("/index.js", "/"), "index.js");
  assert.equal(relativeProjectPath("C:\\src\\index.js", "c:\\"), "src/index.js");
  assert.equal(relativeProjectPath("\\\\HOST\\share\\app\\File.js", "\\\\host\\share\\app"), "File.js");
  assert.equal(relativeProjectPath("/work/app/file.js", null), null);
});

test("recovery history returns recent files first and stays within its cap", () => {
  const history = createClosedEditorHistory(2);
  history.setProject("/work/app");
  history.remember(entry("/work/app/one.js"));
  history.remember(entry("/work/app/two.js"));
  history.remember(entry("/work/app/three.js"));
  assert.equal(history.size, 2);
  assert.equal(history.peek().tab.config.filePath, "/work/app/three.js");
  history.remove(history.peek());
  assert.equal(history.peek().tab.config.filePath, "/work/app/two.js");
  history.remove(history.peek());
  assert.equal(history.peek(), null);
});

test("project switches clear recovery history while equivalent Windows roots retain it", () => {
  const history = createClosedEditorHistory();
  history.setProject("C:\\Work\\App");
  history.remember(entry("C:\\Work\\App\\file.js"));
  history.setProject("c:/work/app/");
  assert.equal(history.size, 1);
  history.setProject("C:\\Work\\Other");
  assert.equal(history.size, 0);
  history.remember(entry("C:\\Work\\Other\\file.js"));
  history.setProject(null);
  assert.equal(history.size, 0);
  history.remember(entry("/outside.js"));
  assert.equal(history.size, 0);
});

test("closing a file again moves its recovery entry to the front without duplicates", () => {
  const history = createClosedEditorHistory();
  history.setProject("C:\\Work");
  history.remember(entry("C:\\Work\\one.js"));
  history.remember(entry("C:\\Work\\two.js"));
  history.remember(entry("c:/work/ONE.js"));
  assert.equal(history.size, 2);
  assert.equal(history.peek().tab.config.filePath, "c:/work/ONE.js");
});

test("snapshots recover only file-backed editors and keep their opening options", () => {
  const config = { filePath: "/work/app/notes.ipynb", forceText: true };
  const node = { getComponent: () => "editor", getConfig: () => config,
    getParent: () => ({ getId: () => "editors", getChildren: () => [node] }) };
  const snapshot = closedEditorSnapshot(node);
  assert.equal(snapshot.parentId, "editors");
  assert.equal(snapshot.index, 0);
  assert.equal(snapshot.tab.name, "notes.ipynb");
  assert.equal(snapshot.tab.config.forceText, true);
  config.forceText = false;
  assert.equal(snapshot.tab.config.forceText, true);
  assert.equal(closedEditorSnapshot({ getComponent: () => "terminal" }), null);
  assert.equal(closedEditorSnapshot({ getComponent: () => "editor", getConfig: () => ({}) }), null);
});

test("already-open editors are found across the model with Windows path equivalence", () => {
  const terminal = { getComponent: () => "terminal", getConfig: () => ({ filePath: "C:/Work/file.js" }) };
  const editor = { getComponent: () => "editor", getConfig: () => ({ filePath: "c:\\work\\FILE.js" }) };
  const model = { visitNodes: (fn) => [terminal, editor].forEach(fn) };
  assert.equal(findOpenEditor(model, "C:/Work/file.js"), editor);
  assert.equal(findOpenEditor(model, "C:/Work/missing.js"), null);
});

test("the reopen shortcut is registered and respects keybinding overrides", () => {
  const { acceleratorFor } = require("../electron/main/keybindings.js");
  assert.equal(acceleratorFor({}, "reopenClosedEditor"), "CmdOrCtrl+Shift+T");
  assert.equal(acceleratorFor({ keybindings: { reopenClosedEditor: "Alt+T" } }, "reopenClosedEditor"), "Alt+T");
  assert.equal(acceleratorFor({ keybindings: { reopenClosedEditor: "" } }, "reopenClosedEditor"), undefined);
});
