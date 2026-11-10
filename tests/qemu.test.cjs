const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ARCHES,
  archBinary,
  buildQemuArgs,
  parseQemuRuntimeArgs,
  validateVmConfig,
  sanitizeVmName,
  parseQemuVersion,
  hmpKeyName,
  qemuDownloadTarget,
  makeQmpClient,
  buildInputAction,
  createVncWebSocketProxy,
  closeVncWebSocketProxy,
  readQemuLog,
  ISO_CATALOG,
} = require("../electron/main/qemu");
const net = require("node:net");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("sanitizeVmName accepts safe names and rejects traversal", () => {
  assert.equal(sanitizeVmName("linux-x64"), "linux-x64");
  assert.equal(sanitizeVmName("Win11.test_1"), "Win11.test_1");
  assert.throws(() => sanitizeVmName("../evil"), /VM name/);
  assert.throws(() => sanitizeVmName("a/b"), /VM name/);
  assert.throws(() => sanitizeVmName(""), /VM name/);
  assert.throws(() => sanitizeVmName("has space"), /VM name/);
});

test("validateVmConfig clamps resources and defaults the arch", () => {
  const cfg = validateVmConfig({ name: "vm1" });
  assert.equal(cfg.arch, "x86_64");
  assert.equal(cfg.memoryMb, 2048);
  assert.equal(cfg.cpus, 2);
  assert.equal(cfg.diskGb, 20);
  assert.equal(cfg.iso, null);
  const big = validateVmConfig({ name: "vm1", arch: "aarch64", memoryMb: 999999, cpus: 99, diskGb: 9999 });
  assert.equal(big.arch, "aarch64");
  assert.equal(big.memoryMb, 65536);
  assert.equal(big.cpus, 32);
  assert.equal(big.diskGb, 512);
  assert.equal(validateVmConfig({ name: "vm1", arch: "bogus" }).arch, "x86_64");
  assert.throws(() => validateVmConfig({ name: "vm1", iso: "/no/such/file.iso" }), /ISO not found/);
});

test("buildQemuArgs boots x86 with in-app VNC display, monitor, tablet and cdrom", () => {
  const args = buildQemuArgs(
    { arch: "x86_64", memoryMb: 4096, cpus: 4, diskFormat: "qcow2", iso: "C:/os/linux.iso" },
    { disk: "C:/vms/a/disk.qcow2", iso: "C:/os/linux.iso", monitorPort: 5901, vncDisplay: 7, serialLog: "C:/logs/a-serial.log" }
  );
  const joined = args.join(" ");
  assert.ok(joined.includes("-m 4096"));
  assert.ok(joined.includes("-smp 4"));
  assert.ok(joined.includes("format=qcow2"));
  assert.ok(joined.includes("if=ide"));
  assert.ok(joined.includes("-cdrom C:/os/linux.iso"));
  assert.ok(joined.includes("-boot order=d"));
  assert.ok(joined.includes("-display none"));
  assert.ok(joined.includes("-vnc 127.0.0.1:7"));
  assert.ok(joined.includes("-qmp tcp:127.0.0.1:5901,server,nowait"));
  assert.ok(joined.includes("usb-tablet"));
  assert.ok(joined.includes("-serial file:C:/logs/a-serial.log"));
});

test("buildQemuArgs uses virt machine for aarch64 and boot order c without ISO", () => {
  const args = buildQemuArgs(
    { arch: "aarch64", memoryMb: 2048, cpus: 2, diskFormat: "raw", iso: null },
    { disk: "/vms/a/disk.img", iso: null, monitorPort: 1234, vncDisplay: 8, serialLog: null }
  );
  const joined = args.join(" ");
  assert.ok(joined.includes("-machine virt"));
  assert.ok(joined.includes("if=virtio"));
  assert.ok(joined.includes("qemu-xhci"));
  assert.ok(joined.includes("usb-tablet"));
  assert.ok(joined.includes("-boot order=c"));
  assert.ok(!joined.includes("-cdrom"));
  assert.ok(!joined.includes("-serial"));
});

test("parseQemuRuntimeArgs identifies a VM's persisted QMP and VNC endpoints", () => {
  const disk = path.resolve("vms", "linux x64", "disk.qcow2");
  const commandLine = `"qemu-system-x86_64" -drive "file=${disk},format=qcow2,if=ide" -vnc 127.0.0.1:4 -qmp tcp:127.0.0.1:43127,server,nowait`;
  assert.deepEqual(parseQemuRuntimeArgs(commandLine, disk), { monitorPort: 43127, vncDisplay: 4 });
  const legacyCommand = `"qemu-system-x86_64" -drive "file=${disk},format=qcow2,if=ide" -qmp tcp:127.0.0.1:43127,server,nowait`;
  assert.deepEqual(parseQemuRuntimeArgs(legacyCommand, disk), { monitorPort: 43127, vncDisplay: null });
  assert.equal(parseQemuRuntimeArgs(commandLine, `${disk}.other`), null);
});

test("VNC WebSocket proxy forwards binary display data and guest input", async () => {
  const tcpServer = net.createServer((socket) => {
    socket.on("data", (data) => socket.write(Buffer.concat([Buffer.from("reply:"), data])));
  });
  await new Promise((resolve) => tcpServer.listen(0, "127.0.0.1", resolve));
  const proxy = await createVncWebSocketProxy(tcpServer.address().port);
  const client = new WebSocket(`ws://127.0.0.1:${proxy.port}`);
  try {
    await once(client, "open");
    const expected = Buffer.from("reply:guest-input");
    const reply = new Promise((resolve) => {
      let received = Buffer.alloc(0);
      client.on("message", (data) => {
        received = Buffer.concat([received, Buffer.from(data)]);
        if (received.length >= expected.length) resolve(received.subarray(0, expected.length));
      });
    });
    client.send(Buffer.from("guest-input"));
    assert.deepEqual(await reply, expected);
  } finally {
    client.terminate();
    await closeVncWebSocketProxy(proxy);
    await new Promise((resolve) => tcpServer.close(resolve));
  }
});

test("QEMU log reader returns the saved tail and reports missing logs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "idiot-box-qemu-log-"));
  try {
    assert.deepEqual(readQemuLog("vm1", dir), { ok: true, text: "", truncated: false });
    const contents = `${"x".repeat(200001)}tail`;
    fs.writeFileSync(path.join(dir, "vm1.log"), contents);
    const log = readQemuLog("vm1", dir);
    assert.equal(log.ok, true);
    assert.equal(log.truncated, true);
    assert.equal(log.text.length, 200000);
    assert.ok(log.text.endsWith("tail"));
    assert.throws(() => readQemuLog("../outside", dir), /VM name/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseQemuVersion and hmpKeyName map common inputs", () => {
  assert.equal(parseQemuVersion("QEMU emulator version 9.0.4 (Debian)"), "9.0.4");
  assert.equal(parseQemuVersion("no version here"), null);
  assert.equal(hmpKeyName("Enter"), "ret");
  assert.equal(hmpKeyName("ctrl"), "ctrl");
  assert.equal(hmpKeyName("a"), "a");
  assert.equal(hmpKeyName("not-a-key"), null);
  // raw DOM KeyboardEvent.key values used by the panel's real-keyboard capture
  assert.equal(hmpKeyName(" "), "spc");
  assert.equal(hmpKeyName("ArrowUp"), "up");
  assert.equal(hmpKeyName("Escape"), "esc");
  assert.equal(hmpKeyName("Shift"), "shift");
  assert.equal(hmpKeyName("Backspace"), "backspace");
  assert.equal(hmpKeyName("Delete"), "delete");
  assert.equal(hmpKeyName("F5"), "f5");
  assert.equal(hmpKeyName("/"), "slash");
  assert.equal(hmpKeyName(":"), "semicolon");
  assert.equal(hmpKeyName("_"), "minus");
  assert.equal(hmpKeyName("Z"), "z");
  assert.equal(archBinary("x86_64").startsWith("qemu-system-x86_64"), true);
  assert.ok(ARCHES.some((a) => a.id === "riscv64"));
});

test("buildInputAction sends absolute pointer + real key events over input-send-event", () => {
  const click = buildInputAction({ type: "click", x: 16000, y: 8000, button: "left" });
  assert.equal(click.command, "input-send-event");
  assert.deepEqual(click.args.events.map((e) => e.type), ["abs", "abs", "btn", "btn"]);
  assert.deepEqual(click.args.events[0].data, { axis: "x", value: 16000 });
  assert.deepEqual(click.args.events[2].data, { down: true, button: "left" });
  assert.deepEqual(click.args.events[3].data, { down: false, button: "left" });

  const right = buildInputAction({ type: "click", x: 1, y: 2, button: "right" });
  assert.equal(right.args.events[2].data.button, "right");

  const down = buildInputAction({ type: "keydown", key: "a" });
  assert.deepEqual(down.args.events, [{ type: "key", data: { down: true, key: { type: "qcode", data: "a" } } }]);
  const up = buildInputAction({ type: "keyup", key: "Enter" });
  assert.deepEqual(up.args.events, [{ type: "key", data: { down: false, key: { type: "qcode", data: "ret" } } }]);

  // chord presses modifiers first, releases in reverse
  const chord = buildInputAction({ type: "key", keys: "ctrl-alt-f1" });
  assert.equal(chord.args.events.length, 6);
  assert.equal(chord.args.events[0].data.key.data, "ctrl");
  assert.equal(chord.args.events[2].data.key.data, "f1");
  assert.equal(chord.args.events[5].data.key.data, "ctrl");
  assert.equal(chord.args.events[5].data.down, false);

  // text is batched into one command, down+up per character, Shift for uppercase/symbols
  const text = buildInputAction({ type: "text", text: "hi!" });
  assert.equal(text.args.events.length, 8); // h, i, shift+1
  assert.deepEqual(text.args.events.slice(0, 2).map((e) => [e.data.key.data, e.data.down]), [["h", true], ["h", false]]);
  assert.deepEqual(text.args.events.slice(4).map((e) => [e.data.key.data, e.data.down]),
    [["shift", true], ["1", true], ["1", false], ["shift", false]]);
  const upper = buildInputAction({ type: "text", text: "A" });
  assert.deepEqual(upper.args.events.map((e) => e.data.key.data), ["shift", "a", "a", "shift"]);

  const wheel = buildInputAction({ type: "wheel", x: 10, y: 20, delta: -120 });
  assert.equal(wheel.args.events.at(-1).data.button, "wheel-up");

  assert.match(buildInputAction({ type: "click", x: -5, y: 0 }).error, /range/);
  assert.match(buildInputAction({ type: "keydown", key: "NotAKey" }).error, /Unsupported/);
  assert.match(buildInputAction({ type: "nope" }).error, /Unknown/);
});

test("QMP client matches replies by id (no prompt-desync) and survives events", async () => {
  const seen = [];
  const server = net.createServer((sock) => {
    sock.write(JSON.stringify({ QMP: { version: { qemu: { major: 9, minor: 0, micro: 0 } }, capabilities: [] } }) + "\n");
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const cmd = JSON.parse(line);
        seen.push(cmd);
        if (cmd.execute === "input-send-event") {
          // an async event must not be mistaken for the reply
          sock.write(JSON.stringify({ event: "RESET", data: {} }) + "\n");
        }
        sock.write(JSON.stringify({ return: { ok: true, echo: cmd.execute }, id: cmd.id }) + "\n");
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const client = makeQmpClient(port);
  try {
    await client.readyPromise;
    const a = await new Promise((resolve, reject) => {
      const id = ++client.seq;
      client.pending.set(id, { resolve, reject });
      client.socket.write(JSON.stringify({ execute: "query-status", id }) + "\n");
    });
    assert.equal(a.echo, "query-status");
    // back-to-back commands must each get their own reply
    const results = await Promise.all(["first", "second", "third"].map((name) => new Promise((resolve, reject) => {
      const id = ++client.seq;
      client.pending.set(id, { resolve, reject });
      client.socket.write(JSON.stringify({ execute: "input-send-event", arguments: { name }, id }) + "\n");
    })));
    assert.deepEqual(results.map((r) => r.echo), ["input-send-event", "input-send-event", "input-send-event"]);
    assert.equal(seen[0].execute, "qmp_capabilities");
    assert.equal(seen.filter((c) => c.execute === "qmp_capabilities").length, 1);
  } finally {
    try { client.socket.destroy(); } catch {}
    await new Promise((r) => server.close(r));
  }
});

test("ISO catalog links are official https, unique, and match known arches", () => {
  assert.ok(ISO_CATALOG.length >= 8);
  const ids = new Set();
  const arches = new Set(ARCHES.map((a) => a.id));
  for (const e of ISO_CATALOG) {
    assert.ok(e.id && !ids.has(e.id), `duplicate/missing id: ${e.id}`);
    ids.add(e.id);
    assert.ok(e.name && e.note, `${e.id} missing name/note`);
    assert.ok(arches.has(e.arch), `${e.id} has unknown arch ${e.arch}`);
    assert.match(e.page, /^https:\/\//, `${e.id} page must be https`);
    if (e.iso !== null) {
      assert.match(e.iso, /^https:\/\/\S+\.iso$/, `${e.id} direct link must be an https .iso`);
    }
  }
  // A couple of well-known official sources must be present
  const hosts = ISO_CATALOG.map((e) => new URL(e.page).host);
  assert.ok(hosts.includes("releases.ubuntu.com"));
  assert.ok(hosts.includes("cdimage.debian.org"));
  assert.ok(hosts.includes("alpinelinux.org"));
});

test("qemuDownloadTarget: Windows gets an installer, others get the page + command", () => {
  const win = qemuDownloadTarget("win32", "x64");
  assert.equal(win.kind, "installer");
  assert.match(win.url, /qemu\.weilnetz\.de\/w64\/qemu-w64-x86_64-latest\.exe$/);
  assert.ok(win.file.endsWith(".exe"));
  assert.equal(qemuDownloadTarget("win32", "arm64").url.includes("aarch64"), true);
  const mac = qemuDownloadTarget("darwin", "arm64");
  assert.equal(mac.kind, "page");
  assert.equal(mac.command, "brew install qemu");
  const lin = qemuDownloadTarget("linux", "x64");
  assert.equal(lin.kind, "page");
  assert.match(lin.command, /qemu-system/);
});
