const test = require("node:test");
const assert = require("node:assert/strict");
const { _parseHostingLine, _parseLoginText } = require("../electron/main/dev-tunnels");

test("parses a hosted dev tunnel URL", () => {
  const out = _parseHostingLine("Hosting port 3000 at https://l3rs99qw-3000.usw2.devtunnels.ms/\nPress Ctrl+C to stop.");
  assert.deepEqual(out, { url: "https://l3rs99qw-3000.usw2.devtunnels.ms/", tunnelId: "l3rs99qw" });
});

test("strips ANSI colour codes before parsing", () => {
  const out = _parseHostingLine("\u001b[32mHosting port 8080 at https://abcdef-8080.eu.devtunnels.ms/\u001b[0m");
  assert.equal(out.url, "https://abcdef-8080.eu.devtunnels.ms/");
  assert.equal(out.tunnelId, "abcdef");
});

test("parses the newer 'Connect via browser' host output", () => {
  const out = _parseHostingLine([
    "Hosting port: 8123",
    "Connect via browser: https://775rvv9s-8123.inc1.devtunnels.ms",
    "Inspect network activity: https://775rvv9s-8123-inspect.inc1.devtunnels.ms",
    "",
    "Ready to accept connections for tunnel: giant-book-zjsvm3t.inc1",
  ].join("\n"));
  assert.deepEqual(out, { url: "https://775rvv9s-8123.inc1.devtunnels.ms", tunnelId: "775rvv9s" });
});

test("does not treat the inspect URL as the tunnel URL", () => {
  const out = _parseHostingLine("Inspect network activity: https://abc-3000-inspect.inc1.devtunnels.ms");
  assert.equal(out, null);
});

test("ignores a URL split before the host is complete", () => {
  assert.equal(_parseHostingLine("Connect via browser: https://775rvv9s-8123.inc1.devtu"), null);
});

test("returns null when the host has not produced a URL yet", () => {
  assert.equal(_parseHostingLine("Connecting to host..."), null);
});

test("parses a Microsoft device-code prompt", () => {
  const prompt = _parseLoginText("To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code A1B2C3D4E to authenticate.");
  assert.equal(prompt.code, "A1B2C3D4E");
  assert.equal(prompt.url, "https://microsoft.com/devicelogin");
});

test("parses a GitHub device-code prompt", () => {
  const prompt = _parseLoginText("! First copy your one-time code: 1234-ABCD\nThen open this URL in your browser: https://github.com/login/device");
  assert.equal(prompt.code, "1234-ABCD");
  assert.equal(prompt.url, "https://github.com/login/device");
});
