const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");

// Exercise the main-process service without starting a desktop session.
function loadSearch(rgOutput = null, rgExit = 0) {
  const filename = path.resolve(__dirname, "../electron/main/search.js");
  const service = new Module(filename, module);
  service.filename = filename;
  service.paths = module.paths;
  const originalRequire = service.require.bind(service);
  service.require = (name) => {
    if (name === "electron") return { BrowserWindow: { getAllWindows: () => [] } };
    if (name === "./local-history") return { recordSnapshotSync() {} };
    if (name === "child_process") return {
      execFile(_bin, _args, _options, callback) {
        callback(rgOutput === null ? new Error("rg unavailable") : null);
      },
      spawn() {
        const proc = new EventEmitter();
        proc.stdout = new PassThrough();
        proc.kill = () => {};
        process.nextTick(() => {
          const bytes = Buffer.from(rgOutput);
          // Include a split inside the first multibyte character.
          const split = bytes.indexOf(Buffer.from("é")) + 1;
          proc.stdout.write(bytes.subarray(0, split));
          proc.stdout.end(bytes.subarray(split));
          proc.emit("close", rgExit);
        });
        return proc;
      },
    };
    return originalRequire(name);
  };
  service._compile(fs.readFileSync(filename, "utf8"), filename);
  return service.exports;
}

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-search-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
  return root;
}

function rgMatch(text, query = "TODO") {
  const submatches = [];
  let index = text.indexOf(query);
  while (index !== -1) {
    const start = Buffer.byteLength(text.slice(0, index));
    submatches.push({ match: { text: query }, start, end: start + Buffer.byteLength(query) });
    index = text.indexOf(query, index + query.length);
  }
  return JSON.stringify({ type: "match", data: {
    path: { text: "./sample.txt" }, lines: { text }, line_number: 1, submatches,
  } }) + "\n";
}

test("ripgrep reports every occurrence with UTF-16 editor columns", async (t) => {
  const text = "é🙂 TODO TODO\n";
  const root = fixture(t, { "sample.txt": text });
  const result = await loadSearch(rgMatch(text)).searchProject({ rootPath: root, query: "TODO" });
  assert.equal(result.engine, "rg");
  assert.equal(result.count, 2);
  assert.deepEqual(result.results[0].matches.map(({ line, column, length }) => ({ line, column, length })), [
    { line: 1, column: 4, length: 4 }, { line: 1, column: 9, length: 4 },
  ]);
  assert.equal(result.results[0].matches[0].lineText, text.trimEnd());
});

test("ripgrep limits individual occurrences even on the same line", async (t) => {
  const root = fixture(t, { "sample.txt": "TODO TODO\n" });
  const result = await loadSearch(rgMatch("TODO TODO\n")).searchProject({
    rootPath: root, query: "TODO", options: { maxResults: 1 },
  });
  assert.equal(result.count, 1);
  assert.equal(result.truncated, true);
});

test("Node fallback counts the same occurrences and supports literal replacement", async (t) => {
  const root = fixture(t, { "sample.txt": "é🙂 TODO TODO\n" });
  const service = loadSearch();
  const found = await service.searchProject({ rootPath: root, query: "TODO" });
  assert.equal(found.engine, "node");
  assert.equal(found.count, 2);
  assert.deepEqual(found.results[0].matches.map((m) => m.column), [4, 9]);
  const result = await service.replaceProject({ rootPath: root, query: "TODO", replacement: "$1" });
  assert.equal(result.replaced, 2);
  assert.equal(fs.readFileSync(path.join(root, "sample.txt"), "utf8"), "é🙂 $1 $1\n");
  assert.equal(service.undoReplace({ token: result.undoToken }).restored, 1);
  assert.equal(fs.readFileSync(path.join(root, "sample.txt"), "utf8"), "é🙂 TODO TODO\n");
});

test("an unsuccessful ripgrep search falls back to the file walker", async (t) => {
  const root = fixture(t, { "sample.txt": "TODO\n" });
  const result = await loadSearch("", 2).searchProject({ rootPath: root, query: "TODO" });
  assert.equal(result.engine, "node");
  assert.equal(result.count, 1);
});

test("Undo replace preserves a save made after Replace All", async (t) => {
  const root = fixture(t, { "sample.txt": "hello world\n" });
  const file = path.join(root, "sample.txt");
  const service = loadSearch();
  const result = await service.replaceProject({ rootPath: root, query: "hello", replacement: "hi" });
  fs.writeFileSync(file, "hi world\nmy new work\n");
  const undo = service.undoReplace({ token: result.undoToken });
  assert.equal(fs.readFileSync(file, "utf8"), "hi world\nmy new work\n");
  assert.equal(undo.ok, false);
  assert.equal(undo.restored, 0);
  assert.match(undo.error, /changed/i);
});

test("partial undo restores unchanged files and keeps conflicts retryable", async (t) => {
  const root = fixture(t, { "first.txt": "hello\n", "second.txt": "hello\n" });
  const service = loadSearch();
  const result = await service.replaceProject({ rootPath: root, query: "hello", replacement: "hi" });
  const first = path.join(root, "first.txt"), second = path.join(root, "second.txt");
  fs.writeFileSync(second, "hi\nnew work\n");
  const undo = service.undoReplace({ token: result.undoToken });
  assert.equal(undo.ok, false);
  assert.equal(undo.restored, 1);
  assert.equal(fs.readFileSync(first, "utf8"), "hello\n");
  assert.equal(fs.readFileSync(second, "utf8"), "hi\nnew work\n");
  // A retry must never revisit the file already restored.
  fs.writeFileSync(first, "later first-file edit\n");
  fs.writeFileSync(second, "hi\n");
  const retry = service.undoReplace({ token: result.undoToken });
  assert.equal(retry.ok, true);
  assert.equal(retry.restored, 1);
  assert.equal(fs.readFileSync(first, "utf8"), "later first-file edit\n");
  assert.equal(fs.readFileSync(second, "utf8"), "hello\n");
  assert.equal(service._undoStore.has(result.undoToken), false);
});

test("Undo replace does not recreate a file deleted afterwards", async (t) => {
  const root = fixture(t, { "sample.txt": "hello\n" });
  const service = loadSearch();
  const result = await service.replaceProject({ rootPath: root, query: "hello", replacement: "hi" });
  const file = path.join(root, "sample.txt");
  fs.unlinkSync(file);
  const undo = service.undoReplace({ token: result.undoToken });
  assert.equal(undo.ok, false);
  assert.equal(undo.restored, 0);
  assert.equal(fs.existsSync(file), false);
});
