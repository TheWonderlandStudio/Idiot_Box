const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readRecentFiles, updateRecentFiles, mergeRecentFiles } = require("../electron/renderer/components/CommandPalette/recentFiles.cjs");
const memory = () => { let value = null; return { getItem: () => value, setItem: (_key, next) => { value = next; } }; };
test("recents are bounded, ordered, deduplicated, and scoped to a project", () => {
  const storage = memory();
  for (let i = 0; i < 25; i++) updateRecentFiles(storage, "C:/work/app", `C:/work/app/file${i}.js`);
  updateRecentFiles(storage, "c:/WORK/app", "c:/work/app/FILE20.js");
  const files = readRecentFiles(storage, "C:/work/app");
  assert.equal(files.length, 20);
  assert.equal(files[0].name, "FILE20.js");
  assert.equal(readRecentFiles(storage, "C:/work/other").length, 0);
  updateRecentFiles(storage, "C:/work/app", "C:/work/outside.js");
  assert.equal(readRecentFiles(storage, "C:/work/app").length, 20);
});
test("missing files can be removed without affecting other recent files", () => {
  const storage = memory();
  updateRecentFiles(storage, "/app", "/app/one.js");
  updateRecentFiles(storage, "/app", "/app/two.js");
  assert.equal(updateRecentFiles(storage, "/app", "/app/two.js", true)[0].name, "one.js");
});
test("merging recent and found files does not duplicate the same path", () => {
  const recent = [{ path: "/app/file.js", name: "file.js", rel: "file.js" }];
  assert.equal(mergeRecentFiles(recent, recent).length, 1);
  assert.equal(mergeRecentFiles(recent, recent)[0].recent, true);
});
test("unavailable or corrupt storage does not prevent opening the palette", () => {
  assert.deepEqual(readRecentFiles({ getItem: () => "invalid" }, "/app"), []);
  assert.equal(updateRecentFiles({ getItem() { throw Error(); }, setItem() { throw Error(); } }, "/app", "/app/file.js")[0].name, "file.js");
});
