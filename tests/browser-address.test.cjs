const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveAddress } = require("../electron/renderer/components/Browser/address.cjs");

test("ordinary and dotted text queries stay searches", () => {
  for (const value of ["react.js error", "two words", "how to use localhost", "just-a-word", "javascript:alert(1)"]) {
    assert.equal(resolveAddress(value), `https://www.google.com/search?q=${encodeURIComponent(value)}`);
  }
  assert.equal(resolveAddress("  "), "");
});
test("local development addresses and port shortcuts use HTTP", () => {
  for (const value of ["localhost:3000", "app.localhost:5173/path", "127.0.0.1:8000/?q=test", "[::1]:5173", "192.168.1.2:8080"]) assert.equal(resolveAddress(value), `http://${value}`);
  assert.equal(resolveAddress(":3000"), "http://localhost:3000");
  assert.equal(resolveAddress(":5173/docs?q=test#section"), "http://localhost:5173/docs?q=test#section");
});
test("explicit supported addresses retain their schemes", () => {
  for (const value of ["https://example.com/path", "http://localhost:3000", "ibx-file://file/C:/demo/index.html", "file:///tmp/index.html", "idiotbox://home", "view-source:https://example.com"]) assert.equal(resolveAddress(` ${value} `), value);
});
test("domains use HTTPS while invalid ports remain editable search text", () => {
  assert.equal(resolveAddress("example.com/docs?q=hello"), "https://example.com/docs?q=hello");
  assert.equal(resolveAddress("example.com/docs with spaces?q=hello world"), "https://example.com/docs with spaces?q=hello world");
  assert.equal(resolveAddress("localhost.example.com"), "https://localhost.example.com");
  for (const value of [":0", ":65536", "localhost:70000", "[::1]:70000"]) assert.equal(resolveAddress(value), `https://www.google.com/search?q=${encodeURIComponent(value)}`);
});
