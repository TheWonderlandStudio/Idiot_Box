const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");

const endpoint = "http://127.0.0.1:39271/mcp";
function fixture(t, contents, extension = "jsonc") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-config-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, ".config", "opencode", `opencode.${extension}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (contents !== undefined) fs.writeFileSync(file, contents);
  const filename = path.resolve(__dirname, "../electron/main/mcp-server.js");
  const service = new Module(filename, module);
  service.filename = filename;
  service.paths = module.paths;
  const originalRequire = service.require.bind(service);
  service.require = (name) => {
    if (name === "os") return { ...os, homedir: () => home };
    if (name === "node-pty") return null;
    return originalRequire(name);
  };
  service._compile(fs.readFileSync(filename, "utf8"), filename);
  return { home, file, sync: service.exports.syncOpenCodeConfig };
}

test("sync preserves settings and other servers in JSON containing URLs", (t) => {
  const before = {
    $schema: "https://opencode.ai/config.json",
    theme: "dark",
    instructions: ["TEAM.md"],
    mcp: { servers: { existing: { type: "remote", url: "https://example.test/mcp" } } },
  };
  const { file, sync } = fixture(t, JSON.stringify(before), "json");
  sync(endpoint);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.theme, "dark");
  assert.deepEqual(after.mcp.servers.existing, before.mcp.servers.existing);
  assert.ok(after.instructions.includes("TEAM.md"));
  assert.equal(after.mcp.servers["idiot-box"].url, endpoint);
});

test("JSONC comments, trailing commas, and comment-like string contents survive", (t) => {
  const raw = '{\n  // Team preference\n  "theme": "dark",\n  "instructions": ["docs/*guide*/.md",],\n  "endpoint": "https://example.test/a//b",\n}\n';
  const { file, sync } = fixture(t, raw);
  sync(endpoint);
  const text = fs.readFileSync(file, "utf8");
  const { parse } = require("jsonc-parser");
  const after = parse(text, [], { allowTrailingComma: true });
  assert.equal(after.theme, "dark");
  assert.equal(after.endpoint, "https://example.test/a//b");
  assert.ok(after.instructions.includes("docs/*guide*/.md"));
  assert.match(text, /\/\/ Team preference/);
  assert.equal(after.mcp.servers["idiot-box"].url, endpoint);
});

test("malformed existing global and project configs are left byte-for-byte intact", (t) => {
  const raw = '{ "theme": "dark", broken';
  const { home, file, sync } = fixture(t, raw);
  const project = path.join(home, "project");
  const projectFile = path.join(project, ".opencode", "opencode.json");
  fs.mkdirSync(path.dirname(projectFile), { recursive: true });
  fs.writeFileSync(projectFile, raw);
  sync(endpoint, project);
  assert.equal(fs.readFileSync(file, "utf8"), raw);
  assert.equal(fs.readFileSync(projectFile, "utf8"), raw);
});

test("repeated sync preserves instructions without duplicating integration guidance", (t) => {
  const { file, sync } = fixture(t, '{ "instructions": ["TEAM.md"] }');
  sync(endpoint);
  const once = JSON.parse(fs.readFileSync(file, "utf8"));
  sync(endpoint);
  const twice = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(twice.instructions, once.instructions);
  assert.equal(twice.instructions.filter((item) => item === "TEAM.md").length, 1);
});

test("project sync preserves unrelated settings and migrates only its own legacy entry", (t) => {
  const { home, sync } = fixture(t);
  const project = path.join(home, "project");
  const projectFile = path.join(project, ".opencode", "opencode.json");
  const before = { theme: "dark", mcp: {
    "idiot-box": { type: "remote", url: "http://127.0.0.1:1/mcp" },
    other: { type: "local", command: ["example-server"] },
    servers: { existing: { type: "remote", url: "https://example.test/mcp" } },
  } };
  fs.mkdirSync(path.dirname(projectFile), { recursive: true });
  fs.writeFileSync(projectFile, JSON.stringify(before));
  sync(endpoint, project);
  const after = JSON.parse(fs.readFileSync(projectFile, "utf8"));
  assert.equal(after.theme, "dark");
  assert.deepEqual(after.mcp.other, before.mcp.other);
  assert.deepEqual(after.mcp.servers.existing, before.mcp.servers.existing);
  assert.equal(after.mcp["idiot-box"], undefined);
  assert.equal(after.mcp.servers["idiot-box"].url, endpoint);
});

test("invalid config shapes are not replaced with defaults", (t) => {
  for (const raw of ["null", "[]", '{"mcp":[]}', '{"mcp":{"servers":[]}}', '{"instructions":{}}']) {
    const { file, sync } = fixture(t, raw);
    sync(endpoint);
    assert.equal(fs.readFileSync(file, "utf8"), raw);
  }
});
