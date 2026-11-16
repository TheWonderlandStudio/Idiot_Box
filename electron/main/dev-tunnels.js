// Microsoft Dev Tunnels port forwarding.
//
// All authentication is delegated to the official `devtunnel` CLI: the user
// signs in through a device-code page in their own browser and the CLI keeps
// the token in the OS keychain. This module never reads, stores or forwards
// credentials — it only spawns the CLI and reports its output.
const { spawn, execFile, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HOST_URL_AT_RE = /Hosting port \d+ at (https:\/\/[^\s]+)/i;
const DEV_TUNNEL_URL_RE = /https:\/\/[^\s"'<>]+/g;
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const INSTALL = process.platform === "win32"
  ? {
      command: "winget install --id Microsoft.devtunnel -e --accept-package-agreements --accept-source-agreements",
      docs: "https://learn.microsoft.com/azure/developer/dev-tunnels/get-started",
    }
  : {
      command: "curl -sL https://aka.ms/DevTunnelCliInstall | bash",
      docs: "https://learn.microsoft.com/azure/developer/dev-tunnels/get-started",
    };

const strip = (s) => String(s || "").replace(ANSI_RE, "");
const subscribers = new Set();
const hosts = new Map(); // port(string) -> { port, url, anonymous, startedAt, tunnelId, child, output }
let cliCache = { at: 0, value: null };
let userCache = { at: 0, value: null };
let loginProc = null;

function emit(evt) {
  for (const fn of subscribers) {
    try { fn(evt); } catch {}
  }
}

function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function cliSpawn(cliPath, args, opts = {}) {
  const isCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(cliPath);
  return spawn(isCmd ? `"${cliPath}"` : cliPath, args, {
    windowsHide: true,
    shell: isCmd,
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb", ...(opts.env || {}) },
    ...opts.spawn,
  });
}

function execCli(cliPath, args, timeout = 15000) {
  return new Promise((resolve) => {
    let out = "", errOut = "", child, settled = false;
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0 && !error, code, error: error || null, stdout: strip(out), stderr: strip(errOut) });
    };
    const timer = setTimeout(() => {
      try { child && child.kill(); } catch {}
      finish(-1, "Timed out");
    }, timeout);
    timer.unref?.();
    try { child = cliSpawn(cliPath, args); } catch (e) { finish(-1, e.message); return; }
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { errOut += d; });
    child.on("error", (e) => finish(-1, e.message));
    child.on("exit", (code) => finish(code == null ? -1 : code));
  });
}

async function runTool(cmd, args, timeout = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: strip(stdout), stderr: strip(stderr), error: err ? err.message : null });
    });
  });
}

async function findCli(force) {
  if (!force && cliCache.value && Date.now() - cliCache.at < 60_000) return cliCache.value;
  const candidates = [];
  if (process.env.DEVTUNNEL_CLI) candidates.push(process.env.DEVTUNNEL_CLI);
  const where = await runTool(process.platform === "win32" ? "where" : "which", ["devtunnel"]);
  let whereHit = null;
  if (where.ok) {
    for (const line of where.stdout.split(/\r?\n/)) {
      const p = line.trim();
      if (!p) continue;
      if (!whereHit) whereHit = p;
      candidates.push(p);
    }
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "devtunnel.exe"));
  }
  let found = null;
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { found = c; break; } } catch {}
  }
  if (!found && whereHit && !path.isAbsolute(whereHit)) found = whereHit;
  if (!found) {
    cliCache = { at: Date.now(), value: { installed: false, path: null, version: null } };
    return cliCache.value;
  }
  const v = await execCli(found, ["--version"], 12000);
  const version = (v.stdout || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || null;
  cliCache = {
    at: Date.now(),
    value: { installed: true, path: found, version, error: v.ok ? null : (v.stderr || v.error || null) },
  };
  return cliCache.value;
}

async function findCliForced() {
  return findCli(true);
}

async function getUser(force) {
  if (!force && userCache.value && Date.now() - userCache.at < 60_000) return userCache.value;
  const cli = await findCli();
  if (!cli.installed) {
    userCache = { at: Date.now(), value: { signedIn: false, username: null, raw: "" } };
    return userCache.value;
  }
  const r = await execCli(cli.path, ["user", "show"], 15000);
  const raw = strip(r.stdout + "\n" + r.stderr).trim();
  let signedIn = r.ok;
  let username = null;
  if (signedIn) {
    const email = raw.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
    if (email) username = email[0];
    else {
      const named = raw.match(/logged in as\s+([^\s,]+)/i) ||
        raw.match(/(?:user|account)\s*[:=]\s*([^\s,]+)/i);
      if (named) username = named[1].replace(/\.$/, "");
    }
    // Some CLI builds return exit 0 with "Not logged in" in the body.
    if (!username && /not logged in|no user/i.test(raw)) signedIn = false;
  }
  userCache = { at: Date.now(), value: { signedIn, username, raw: raw.slice(0, 400) } };
  return userCache.value;
}

function makeTunnel(raw) {
  const url = raw.replace(/[.,;)\]]+$/, "");
  const host = url.replace(/^https:\/\//i, "").split(/[/:?#]/)[0];
  const idPort = host.match(/^([^-]+)-\d+\./);
  const idPlain = host.match(/^([^.]+)\./);
  return { url, tunnelId: idPort ? idPort[1] : (idPlain ? idPlain[1] : null) };
}

function parseHostingLine(text) {
  const clean = strip(text);
  const at = clean.match(HOST_URL_AT_RE);
  if (at) return makeTunnel(at[1]);
  // Newer CLI builds print "Hosting port: 8123" then
  // "Connect via browser: https://<id>-<port>.<region>.devtunnels.ms".
  const urls = clean.match(DEV_TUNNEL_URL_RE) || [];
  for (const u of urls) {
    if (!/\.devtunnels\.ms(?:[:/?#]|$)/i.test(u)) continue;
    if (/-inspect[.-]/i.test(u)) continue;
    return makeTunnel(u);
  }
  return null;
}

function parseLoginText(text) {
  const clean = strip(text);
  let code = null;
  for (const re of [
    /one-time code\s*[:]\s*([A-Z0-9]{4,12}(?:-[A-Z0-9]{4,12})?)/i,
    /enter the code\s+([A-Z0-9]{4,12}(?:-[A-Z0-9]{4,12})?)/i,
    /\bcode\s*[:]\s*([A-Z0-9]{4,12}(?:-[A-Z0-9]{4,12})?)/i,
  ]) {
    const m = clean.match(re);
    if (m) { code = m[1].toUpperCase(); break; }
  }
  const urls = clean.match(/https?:\/\/[^\s"'<>]+/g) || [];
  const url = urls.find((u) => /devicelogin|login\/device|microsoftonline/i.test(u)) || urls[0] || null;
  return { code, url };
}

function tunnelList() {
  return [...hosts.values()]
    .filter((h) => h.url)
    .map((h) => ({
      port: h.port,
      url: h.url,
      anonymous: h.anonymous,
      startedAt: h.startedAt,
      tunnelId: h.tunnelId,
    }))
    .sort((a, b) => a.port - b.port);
}

async function status() {
  const cli = await findCli();
  const user = await getUser();
  return {
    cli: { ...cli, install: INSTALL },
    user,
    loginInProgress: !!loginProc,
    tunnels: tunnelList(),
  };
}

function login(provider) {
  return findCli().then((cli) => {
    if (!cli.installed) return { ok: false, error: "cli-missing" };
    if (loginProc) return { ok: false, error: "login-in-progress" };
    const args = ["user", "login"];
    if (provider === "github") args.push("-g");
    args.push("-d");
    let child;
    try {
      child = cliSpawn(cli.path, args);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    loginProc = child;
    let out = "";
    let lastPrompt = "";
    const consume = (chunk) => {
      out = (out + strip(chunk)).slice(-4000);
      const { code, url } = parseLoginText(out);
      const key = `${code || ""}|${url || ""}`;
      if ((code || url) && key !== lastPrompt) {
        lastPrompt = key;
        emit({ type: "login-prompt", provider: provider === "github" ? "github" : "microsoft", code, url, text: out.trim().split(/\r?\n/).slice(-3).join("\n") });
      }
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    const timer = setTimeout(() => {
      if (loginProc === child) {
        try { child.kill(); } catch {}
        emit({ type: "login-error", message: "Sign-in timed out" });
      }
    }, 5 * 60_000);
    timer.unref?.();
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (loginProc === child) loginProc = null;
      userCache = { at: 0, value: null };
      if (code === 0) {
        emit({ type: "login-done" });
        getUser(true).then((u) => emit({ type: "user", user: u })).catch(() => {});
      } else {
        const tail = strip(out).trim().split(/\r?\n/).filter(Boolean).slice(-4).join("\n");
        emit({ type: "login-error", message: tail || `devtunnel exited (${code})` });
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      if (loginProc === child) loginProc = null;
      emit({ type: "login-error", message: e.message });
    });
    return { ok: true, started: true };
  });
}

async function logout() {
  await stopAll();
  const cli = await findCli();
  if (!cli.installed) return { ok: false, error: "cli-missing" };
  const r = await execCli(cli.path, ["user", "logout"], 15000);
  userCache = { at: 0, value: null };
  return { ok: r.ok, error: r.ok ? null : (r.stderr || r.error || "Sign out failed") };
}

function start(port, opts = {}) {
  const p = parseInt(port, 10);
  if (!p || p < 1 || p > 65535) return Promise.resolve({ ok: false, error: "Port must be 1-65535" });
  const existing = hosts.get(String(p));
  if (existing && existing.url) {
    return Promise.resolve({ ok: true, port: p, url: existing.url, anonymous: existing.anonymous, already: true });
  }
  return Promise.all([findCli(), getUser()]).then(([cli, user]) => {
    if (!cli.installed) return { ok: false, error: "cli-missing" };
    if (!user.signedIn) return { ok: false, error: "not-signed-in" };
    const anonymous = !!opts.anonymous;
    const args = ["host", "-p", String(p)];
    if (anonymous) args.push("--allow-anonymous");
    let child;
    try {
      child = cliSpawn(cli.path, args, { spawn: { detached: process.platform !== "win32" } });
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const rec = { port: p, url: null, anonymous, startedAt: Date.now(), tunnelId: null, child, output: "" };
    hosts.set(String(p), rec);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        if (rec.url) return finish({ ok: true, port: p, url: rec.url, anonymous });
        try { child.kill(); } catch {}
        hosts.delete(String(p));
        emit({ type: "host-exit", port: p, code: null });
        finish({ ok: false, error: lastError() || "Timed out starting tunnel (60s)" });
      }, 60_000);
      timer.unref?.();
      const lastError = () => {
        const lines = strip(rec.output).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
        const err = lines.filter((l) => /error|fail|denied|not logged|sign in|login/i.test(l)).slice(-2);
        return (err.length ? err : lines.slice(-2)).join("\n").slice(0, 400) || null;
      };
      const consume = (chunk) => {
        rec.output = (rec.output + strip(chunk)).slice(-4000);
        if (rec.url) return;
        const parsed = parseHostingLine(rec.output);
        if (parsed) {
          rec.url = parsed.url;
          rec.tunnelId = parsed.tunnelId;
          emit({ type: "host-started", port: p, url: rec.url, tunnelId: rec.tunnelId, anonymous });
          finish({ ok: true, port: p, url: rec.url, tunnelId: rec.tunnelId, anonymous });
        }
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      child.on("error", (e) => {
        hosts.delete(String(p));
        finish({ ok: false, error: e.message });
      });
      child.on("exit", (code) => {
        const hadUrl = !!rec.url;
        rec.child = null;
        hosts.delete(String(p));
        emit({ type: "host-exit", port: p, code });
        if (!hadUrl) finish({ ok: false, error: lastError() || `devtunnel exited (${code})` });
      });
    });
  });
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    }
  } catch {
    try { child.kill(); } catch {}
  }
}

function stop(port) {
  const key = String(parseInt(port, 10));
  const rec = hosts.get(key);
  if (!rec) return Promise.resolve({ ok: true, port: parseInt(port, 10) });
  killTree(rec.child);
  hosts.delete(key);
  emit({ type: "stopped", port: parseInt(port, 10) });
  return Promise.resolve({ ok: true, port: parseInt(port, 10) });
}

async function stopAll() {
  for (const key of [...hosts.keys()]) {
    try { await stop(key); } catch {}
  }
  return { ok: true };
}

function stopAllSync() {
  for (const rec of hosts.values()) killTree(rec.child);
  hosts.clear();
}

async function install() {
  if (process.platform !== "win32") {
    return { ok: false, error: `Automatic install is only supported on Windows. Run:\n${INSTALL.command}`, command: INSTALL.command };
  }
  const r = await new Promise((resolve) => {
    execFile(
      "winget",
      ["install", "--id", "Microsoft.devtunnel", "-e", "--accept-package-agreements", "--accept-source-agreements"],
      { windowsHide: true, timeout: 8 * 60_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, error: err ? err.message : null, output: strip(stdout + "\n" + stderr).slice(-1200) })
    );
  });
  cliCache = { at: 0, value: null };
  const cli = await findCli(true);
  return { ...r, cli };
}

module.exports = {
  subscribe,
  status,
  login,
  logout,
  start,
  stop,
  stopAll,
  stopAllSync,
  install,
  checkCli: findCliForced,
  _parseHostingLine: parseHostingLine,
  _parseLoginText: parseLoginText,
};
