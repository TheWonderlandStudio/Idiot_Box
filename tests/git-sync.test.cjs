const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Exercise the registered handler without starting the desktop app or accessing a remote.
const source = fs.readFileSync(
  path.join(__dirname, "../electron/main/index.js"),
  "utf8",
);
const registration = source.match(
  /ipcMain\.handle\("git:menuAction",[\s\S]*?\n}\);/,
)[0];
const rootPath = "/fixture/repository";
function handler(runGit) {
  let sync;
  const events = [];
  vm.runInNewContext(registration, {
    ipcMain: {
      handle: (_channel, callback) => {
        sync = callback;
      },
    },
    gitExec: async () => "true",
    gitRunLogged: async (root, args) => {
      assert.equal(root, rootPath);
      events.push(args.join(" "));
      return runGit(args[0]);
    },
    gitCacheInvalidate: (root) => {
      assert.equal(root, rootPath);
      events.push("invalidate");
    },
    humanGitError: String,
  });
  return { sync: () => sync(null, rootPath, "sync"), events };
}

test("Sync waits for Pull before Push and invalidates cached state", async () => {
  let finishPull;
  const pull = new Promise((resolve) => {
    finishPull = resolve;
  });
  const { sync, events } = handler((command) =>
    command === "pull" ? pull : "Pushed",
  );
  const pending = sync();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["pull"]);
  finishPull("Pulled");
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.out, "Pulled\nPushed");
  assert.deepEqual(events, ["pull", "invalidate", "push", "invalidate"]);
});

test("a failed Pull never pushes and invalidates cached conflict state", async () => {
  const { sync, events } = handler(() => {
    throw Object.assign(new Error("Pull failed"), {
      stderr: "CONFLICT: resolve merge conflicts first",
    });
  });
  const result = await sync();
  assert.equal(result.ok, false);
  assert.match(result.error, /CONFLICT/);
  assert.deepEqual(events, ["pull", "invalidate"]);
});

test("a failed Push reports the error and invalidates state after Pull", async () => {
  const { sync, events } = handler((command) => {
    if (command === "push") throw new Error("Push rejected");
    return "Pulled";
  });
  const result = await sync();
  assert.equal(result.ok, false);
  assert.equal(result.error, "Push rejected");
  assert.deepEqual(events, ["pull", "invalidate", "push", "invalidate"]);
});
