// Test Explorer backend — framework detection, collection and process runs.
//
// Supported: Jest, Vitest, Mocha, node:test, pytest and unittest.
// Runs stream newline events to the requesting renderer and finish with a
// normalized per-test status list that the panel maps onto its tree.
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { spawn, execFile } = require("child_process");

const MAX_TEST_FILES = 600;
const MAX_TEST_FILE_BYTES = 1_000_000;
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

const IGNORED_DIRS = new Set([
  ".git", ".hg", ".svn", ".bin", ".trash", "node_modules", "__pycache__",
  ".venv", "venv", "env", ".next", ".nuxt", ".turbo", ".cache",
  "coverage", "dist", "build", "out", "target", "vendor", ".pytest_cache",
]);

const JS_TEST_RE = /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/i;
const JS_DIR_RE = /(^|[\\/])__tests__[\\/].*\.(js|jsx|ts|tsx|mjs|cjs)$/i;
const PY_TEST_RE = /^(test_.*|.*_test)\.py$/i;

const runs = new Map();

const statSafe = async (p) => { try { return await fsp.stat(p); } catch { return null; } };
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

function safeRoot(rootPath) {
  if (typeof rootPath !== "string" || !rootPath.trim() || rootPath.includes("\0")) return null;
  try {
    const resolved = path.resolve(rootPath);
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

const relOf = (root, file) => path.relative(root, file).split(path.sep).join("/");

async function* walk(root, shouldInclude) {
  const stack = [root];
  let found = 0;
  while (stack.length && found < MAX_TEST_FILES) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) continue;
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!shouldInclude(full)) continue;
      found++;
      yield full;
      if (found >= MAX_TEST_FILES) return;
    }
  }
}

// ── Framework detection ────────────────────────────────────────────────────

let pytestChecked = null;
let pythonInfo = null;

function findPython() {
  if (pythonInfo) return Promise.resolve(pythonInfo);
  return new Promise((resolve) => {
    execFile("python", ["--version"], { timeout: 2500, windowsHide: true }, (err) => {
      if (!err) { pythonInfo = { cmd: "python", base: [] }; resolve(pythonInfo); return; }
      execFile("py", ["-3", "--version"], { timeout: 2500, windowsHide: true }, (err2) => {
        pythonInfo = err2 ? null : { cmd: "py", base: ["-3"] };
        resolve(pythonInfo);
      });
    });
  });
}

function checkPytest(python) {
  if (pytestChecked !== null) return Promise.resolve(pytestChecked);
  return new Promise((resolve) => {
    if (!python) { pytestChecked = false; resolve(false); return; }
    execFile(python.cmd, [...python.base, "-m", "pytest", "--version"], { timeout: 4000, windowsHide: true }, (err) => {
      pytestChecked = !err;
      resolve(pytestChecked);
    });
  });
}

const hasAnyFile = (root, names) => names.some((n) => exists(path.join(root, n)));

const configFiles = (root, prefixes) => {
  try {
    return fs.readdirSync(root).filter((name) => prefixes.some((p) => name.startsWith(p)));
  } catch {
    return [];
  }
};

async function detectFrameworks(rootPath) {
  const root = safeRoot(rootPath);
  if (!root) return { ok: false, error: "Open a project folder first.", frameworks: [], primary: null };

  const pkg = readJson(path.join(root, "package.json")) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts || {};
  const frameworks = [];

  const jestConfig = configFiles(root, ["jest.config", "jest.setup"]).length > 0 || !!pkg.jest;
  const vitestConfig = configFiles(root, ["vitest.config", "vite.config"]).length > 0 || !!pkg.vitest;
  const mochaConfig = configFiles(root, [".mocharc"]).length > 0 || !!pkg.mocha;

  if (deps.vitest || vitestConfig) {
    frameworks.push({ id: "vitest", label: "Vitest", kind: "node", package: "vitest", bin: "vitest" });
  }
  if (deps.jest || jestConfig) {
    frameworks.push({ id: "jest", label: "Jest", kind: "node", package: "jest", bin: "jest" });
  }
  if (deps.mocha || mochaConfig) {
    frameworks.push({ id: "mocha", label: "Mocha", kind: "node", package: "mocha", bin: "mocha" });
  }
  const nodeTestScript = Object.values(scripts).some((s) => typeof s === "string" && /node\s+--test|--test-name-pattern/.test(s));
  const hasJsTests = findTestsQuick(root, /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/i);
  if (nodeTestScript || (!frameworks.length && hasJsTests)) {
    frameworks.push({ id: "node-test", label: "node:test", kind: "node", package: null, bin: null });
  }

  // Python side.
  const pyMarkers =
    hasAnyFile(root, ["pytest.ini", "conftest.py", "tox.ini", "setup.cfg"]) ||
    (exists(path.join(root, "pyproject.toml")) && /pytest/i.test(readTextSafe(path.join(root, "pyproject.toml"), 200_000))) ||
    (exists(path.join(root, "requirements.txt")) && /pytest/i.test(readTextSafe(path.join(root, "requirements.txt"), 200_000)));

  let python = null;
  const hasPythonTests = findTestsQuick(root, PY_TEST_RE);
  if (pyMarkers || hasPythonTests) {
    python = await findPython();
    const pytest = pyMarkers || (python ? await checkPytest(python) : false);
    if (pytest) frameworks.push({ id: "pytest", label: "pytest", kind: "python", package: "pytest", bin: null });
    else if (python) frameworks.push({ id: "unittest", label: "unittest", kind: "python", package: null, bin: null });
  }

  return { ok: true, frameworks, primary: frameworks[0]?.id || null, python: python ? python.cmd : null };
}

function findTestsQuick(root, testRe, depth = 0) {
  if (depth > 3) return false;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return false; }
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    if (ent.isFile() && testRe.test(ent.name)) return true;
    if (ent.isDirectory() && depth < 3 && !IGNORED_DIRS.has(ent.name)) {
      if (findTestsQuick(path.join(root, ent.name), testRe, depth + 1)) return true;
    }
  }
  return false;
}

function readTextSafe(file, limit = 500_000) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > limit) return "";
    return fs.readFileSync(file, "utf8");
  } catch { return ""; }
}

// ── Static collection ──────────────────────────────────────────────────────

function parseJsTests(text, rel) {
  const tests = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 400) continue;
    const m = line.match(/^\s*(?:it|test|specify)(?:\.[A-Za-z]+(?:\([^)]*\))?)*\s*\(\s*(['"`])(.+?)\1/);
    if (!m) continue;
    const name = m[2];
    if (!name || name.includes("${") || /%[sdifjoO]/.test(name)) continue;
    tests.push({ id: `${rel}::${name}::~${i + 1}`, name, line: i + 1, kind: "test" });
    if (tests.length >= 400) break;
  }
  return tests;
}

function parsePyTests(text, rel) {
  const tests = [];
  const lines = text.split("\n");
  let cls = null;
  let clsIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 400) continue;
    const cm = line.match(/^(\s*)class\s+([A-Za-z_]\w*)/);
    if (cm) {
      cls = cm[2];
      clsIndent = cm[1].length;
      continue;
    }
    const fm = line.match(/^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/);
    if (!fm) {
      if (/^\S/.test(line) && !line.startsWith("#")) { cls = null; clsIndent = -1; }
      continue;
    }
    const indent = fm[1].length;
    if (cls && clsIndent >= 0 && indent <= clsIndent) cls = null;
    const name = fm[2];
    const full = cls ? `${cls}::${name}` : name;
    tests.push({ id: `${rel}::${full}::~${i + 1}`, name, className: cls || undefined, fullName: full, line: i + 1, kind: "test" });
    if (tests.length >= 400) break;
  }
  return tests;
}

async function collectTests(payload = {}) {
  const root = safeRoot(payload.rootPath);
  if (!root) return { ok: false, error: "Open a project folder first.", files: [] };
  const detected = await detectFrameworks(root);
  const framework = payload.framework || detected.primary;
  if (!framework) {
    return { ok: true, framework: null, frameworks: detected.frameworks, files: [], message: "No test framework detected." };
  }
  const kind = detected.frameworks.find((f) => f.id === framework)?.kind ||
    (["pytest", "unittest"].includes(framework) ? "python" : "node");

  const seen = new Set();
  const files = [];
  const matcher = kind === "python"
    ? (f) => PY_TEST_RE.test(path.basename(f))
    : (f) => {
        const base = path.basename(f);
        if (JS_TEST_RE.test(base) || JS_DIR_RE.test(f)) return true;
        if (framework === "mocha") {
          const rel = relOf(root, f);
          return /^test\/.*\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(rel) && !/\.d\.ts$/i.test(base);
        }
        return false;
      };

  for await (const full of walk(root, matcher)) {
    if (seen.has(full)) continue;
    let st;
    try { st = await fsp.stat(full); } catch { continue; }
    if (!st.isFile() || st.size > MAX_TEST_FILE_BYTES) continue;
    const rel = relOf(root, full);
    let text = "";
    try { text = await fsp.readFile(full, "utf8"); } catch { continue; }
    const tests = kind === "python" ? parsePyTests(text, rel) : parseJsTests(text, rel);
    seen.add(full);
    files.push({ path: full, rel, framework, tests });
    if (files.length >= MAX_TEST_FILES) break;
  }

  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    ok: true,
    root,
    framework,
    kind,
    frameworks: detected.frameworks,
    files,
    testCount: files.reduce((n, f) => n + f.tests.length, 0),
  };
}

// ── Command building ───────────────────────────────────────────────────────

function resolveLocalBin(root, name) {
  const base = path.join(root, "node_modules", ".bin", name);
  if (process.platform === "win32") {
    for (const ext of [".cmd", ".bat", ".exe", ""]) {
      if (exists(base + ext)) return base + ext;
    }
    return null;
  }
  return exists(base) ? base : null;
}

function findNodeScript(root, framework) {
  const candidates = {
    jest: ["node_modules/jest/bin/jest.js", "node_modules/jest-cli/bin/jest.js"],
    vitest: ["node_modules/vitest/vitest.mjs", "node_modules/vitest/vitest.js"],
    mocha: ["node_modules/mocha/bin/mocha.js", "node_modules/mocha/bin/_mocha"],
  }[framework] || [];
  for (const rel of candidates) {
    const full = path.join(root, rel);
    if (exists(full)) return full;
  }
  return null;
}

function pyNodeId(rel, test) {
  const file = rel.replace(/\\/g, "/");
  if (!test) return file;
  return `${file}::${test.fullName || test.name}`;
}

function pyModule(rel) {
  return rel.replace(/\.py$/i, "").replace(/[\\/]/g, ".");
}

function jsTestArgs(framework, file, testName, binPath) {
  const args = [];
  const useBin = !binPath; // paths below are for `node <script>`
  if (framework === "jest") {
    args.push("--runInBand", "--verbose");
    if (file) args.push(file);
    if (testName) args.push("-t", testName);
  } else if (framework === "vitest") {
    args.push("run", "--reporter=verbose");
    if (file) args.push(file);
    if (testName) args.push("-t", testName);
  } else if (framework === "mocha") {
    args.push("--reporter", "spec");
    if (file) args.push(file);
    if (testName) args.push("--grep", testName);
  } else if (framework === "node-test") {
    args.push("--test", "--test-reporter=spec");
    if (file) args.push(file);
    if (testName) args.push(`--test-name-pattern=${testName}`);
  }
  void useBin;
  return args;
}

async function buildRunCommand(payload = {}) {
  const root = safeRoot(payload.rootPath);
  if (!root) return { ok: false, error: "Open a project folder first." };
  const detected = await detectFrameworks(root);
  const framework = payload.framework || detected.primary;
  if (!framework) return { ok: false, error: "No test framework detected." };
  const kind = ["pytest", "unittest"].includes(framework) ? "python" : "node";
  const file = payload.file ? String(payload.file).replace(/\\/g, "/") : "";
  const test = payload.test || null;
  const testName = test?.name || payload.testName || "";
  const python = kind === "python" ? await findPython() : null;

  if (framework === "pytest") {
    if (!python) return { ok: false, error: "Python was not found on PATH." };
    const args = [...python.base, "-m", "pytest", "-v", "-p", "no:cacheprovider"];
    if (test?.fullName || test?.name) args.push(pyNodeId(file, test));
    else if (file) args.push(file);
    return { ok: true, framework, kind, cmd: python.cmd, args, cwd: root, display: [python.cmd, ...args].join(" ") };
  }

  if (framework === "unittest") {
    if (!python) return { ok: false, error: "Python was not found on PATH." };
    const args = [...python.base, "-m", "unittest", "-v"];
    if (file) {
      let target = pyModule(file);
      if (test?.className) target += `.${test.className}`;
      if (test?.name) target += `.${test.name}`;
      args.push(target);
    } else {
      args.push("discover", "-s", "tests", "-p", "test_*.py");
    }
    return { ok: true, framework, kind, cmd: python.cmd, args, cwd: root, display: [python.cmd, ...args].join(" ") };
  }

  if (framework === "node-test") {
    const args = jsTestArgs("node-test", file, testName);
    return { ok: true, framework, kind, cmd: "node", args, cwd: root, display: ["node", ...args].join(" ") };
  }

  const bin = resolveLocalBin(root, framework === "vitest" ? "vitest" : framework);
  if (!bin) {
    return {
      ok: false,
      error: `Local ${framework} not found. Install it first: npm install -D ${framework}`,
    };
  }
  const args = jsTestArgs(framework, file, testName);
  return { ok: true, framework, kind, cmd: bin, args, cwd: root, display: [bin, ...args].join(" ") };
}

// Returns a launch descriptor understood by electron/main/debugger.js.
// Node: { language:"node", cmd, program, programArgs, cwd }
// Python: { language:"python", python:[cmd,...base], module|program, args, cwd }
async function buildDebugCommand(payload = {}) {
  const base = await buildRunCommand(payload);
  if (!base.ok) return base;
  const root = safeRoot(payload.rootPath);
  const file = payload.file ? String(payload.file).replace(/\\/g, "/") : "";
  const test = payload.test || null;
  const testName = test?.name || payload.testName || "";

  if (base.kind === "python") {
    const python = await findPython();
    if (!python) return { ok: false, error: "Python was not found on PATH." };
    const language = "python";
    if (base.framework === "pytest") {
      const args = ["-v", "-p", "no:cacheprovider"];
      if (test?.fullName || test?.name) args.push(pyNodeId(file, test));
      else if (file) args.push(file);
      return {
        ok: true, language, framework: base.framework, kind: "python",
        name: test?.name ? `${test.name} (pytest)` : file ? `${path.basename(file)} (pytest)` : "pytest",
        python: [python.cmd, ...python.base], module: "pytest", args, cwd: root,
        display: [python.cmd, "-m", "pytest", ...args].join(" "),
      };
    }
    const args = ["-v"];
    if (file) {
      let target = pyModule(file);
      if (test?.className) target += `.${test.className}`;
      if (test?.name) target += `.${test.name}`;
      args.push(target);
    } else {
      args.push("discover", "-s", "tests", "-p", "test_*.py");
    }
    return {
      ok: true, language, framework: base.framework, kind: "python",
      name: test?.name ? `${test.name} (unittest)` : file ? `${path.basename(file)} (unittest)` : "unittest",
      python: [python.cmd, ...python.base], module: "unittest", args, cwd: root,
      display: [python.cmd, "-m", "unittest", ...args].join(" "),
    };
  }

  if (base.framework === "node-test") {
    if (!file) return { ok: false, error: "Pick a test file to debug." };
    return {
      ok: true, language: "node", framework: base.framework, kind: "node",
      name: test?.name ? `${test.name} (node:test)` : `${path.basename(file)} (node:test)`,
      cmd: "node", program: path.join(root, file), programArgs: [], cwd: root,
      display: `node --inspect-brk ${file}`,
    };
  }

  const script = findNodeScript(root, base.framework);
  if (!script) {
    return { ok: false, error: `Cannot find the ${base.framework} entry script for debugging.` };
  }
  const args = jsTestArgs(base.framework, file, testName);
  return {
    ok: true, language: "node", framework: base.framework, kind: "node",
    name: test?.name ? `${test.name} (${base.framework})` : file ? `${path.basename(file)} (${base.framework})` : `${base.framework} tests`,
    cmd: "node", program: script, programArgs: args, cwd: root,
    display: `node --inspect-brk ${path.relative(root, script).replace(/\\/g, "/")} ${args.join(" ")}`.trim(),
  };
}

// ── Process execution ──────────────────────────────────────────────────────

function winQuote(arg) {
  const s = String(arg);
  if (!/[\s"&|<>^()]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

function spawnExec(cmd, args, opts) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd)) {
    const line = [cmd, ...args].map(winQuote).join(" ");
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", line], opts);
  }
  return spawn(cmd, args, opts);
}

function killTree(proc) {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      try { process.kill(-proc.pid, "SIGTERM"); } catch { proc.kill("SIGTERM"); }
    }
  } catch {
    try { proc.kill(); } catch {}
  }
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const stripAnsi = (s) => String(s).replace(ANSI_RE, "");

const TEST_SYMBOL_RE = /^\s*(?:✓|√|✔|✗|✕|×|✖|❌|❯)\s+(.+?)\s*$/;
const PY_RESULT_RE = /^\s*(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\s+(\S+)/;
const FILE_RESULT_RE = /^\s*(PASS|FAIL)\s+(.+?)\s*$/;

function cleanTestName(raw) {
  let name = String(raw || "").trim();
  name = name.replace(/\s+\(\d+(?:\.\d+)?\s*(?:ms|s|m)\)\s*$/, "");
  name = name.replace(/\s+\d+(?:\.\d+)?\s*(?:ms|s|m)\s*$/, "");
  name = name.replace(/^\d+\)\s+/, "");
  if (name.includes(" > ")) name = name.split(" > ").pop().trim();
  return name;
}

function parseTestLine(line, state) {
  let m = PY_RESULT_RE.exec(line);
  if (m) {
    const status = m[1] === "PASSED" || m[1] === "XPASS" ? "passed" : m[1] === "SKIPPED" ? "skipped" : "failed";
    const nodeid = m[2];
    const name = nodeid.split("::").pop();
    addStatus(state, name, status, nodeid.split("::")[0]);
    return;
  }
  m = FILE_RESULT_RE.exec(line);
  if (m) {
    state.fileStatuses[m[2].trim()] = m[1] === "PASS" ? "passed" : "failed";
    return;
  }
  m = TEST_SYMBOL_RE.exec(line);
  if (m) {
    const [, rest] = m;
    const raw = line.trim()[0];
    const failed = /[✗✕×✖❌]/.test(raw);
    const name = cleanTestName(rest);
    if (name && !/^tests?\s*$/i.test(name)) addStatus(state, name, failed ? "failed" : "passed");
  }
}

function addStatus(state, name, status, file) {
  if (!name) return;
  state.statuses.push({ name, status, file });
  const key = name.toLowerCase();
  if (status === "passed") state.summary.passed++;
  else if (status === "skipped") state.summary.skipped++;
  else state.summary.failed++;
}

function parseSummary(line, state) {
  const text = stripAnsi(line);
  let m;
  if ((m = text.match(/Tests:\s+(.+)$/i))) {
    const part = m[1];
    const failed = part.match(/(\d+)\s+failed/i);
    const passed = part.match(/(\d+)\s+passed/i);
    const skipped = part.match(/(\d+)\s+(?:skipped|pending|todo)/i);
    const total = part.match(/(\d+)\s+total/i);
    if (failed) state.summary.failed = Number(failed[1]);
    if (passed) state.summary.passed = Number(passed[1]);
    if (skipped) state.summary.skipped = Number(skipped[1]);
    if (total) state.summary.total = Number(total[1]);
    state.summary.fromSummary = true;
    return;
  }
  if ((m = text.match(/^\s*Tests\s+(.+)$/i)) && /passed|failed/i.test(m[1])) {
    const part = m[1];
    const failed = part.match(/(\d+)\s+failed/i);
    const passed = part.match(/(\d+)\s+passed/i);
    if (failed) state.summary.failed = Number(failed[1]);
    if (passed) state.summary.passed = Number(passed[1]);
    state.summary.fromSummary = true;
    return;
  }
  if ((m = text.match(/(\d+)\s+failed,\s*(\d+)\s+passed/i))) {
    // pytest: "1 failed, 2 passed in 0.12s"
    state.summary.failed = Number(m[1]);
    state.summary.passed = Number(m[2]);
    state.summary.fromSummary = true;
    return;
  }
  if ((m = text.match(/(\d+)\s+passed,\s*(\d+)\s+failed/i))) {
    state.summary.passed = Number(m[1]);
    state.summary.failed = Number(m[2]);
    state.summary.fromSummary = true;
    return;
  }
  if (/^OK\b/.test(text.trim())) {
    state.summary.fromSummary = true;
  }
  if ((m = text.match(/FAILED\s*\((?:failures|errors)=(\d+)/i))) {
    state.summary.failed = Math.max(state.summary.failed, Number(m[1]));
    state.summary.fromSummary = true;
  }
}

function startRun(event, payload = {}) {
  const sender = event.sender;
  const runId = String(payload.runId || `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);
  return (async () => {
    const built = await buildRunCommand(payload);
    if (!built.ok) return { ok: false, error: built.error };

    const state = { statuses: [], fileStatuses: {}, summary: { passed: 0, failed: 0, skipped: 0, total: 0, fromSummary: false } };
    const startedAt = Date.now();
    const send = (data) => {
      try { if (!sender.isDestroyed()) sender.send("test:event", { runId, ...data }); } catch {}
    };

    let proc;
    try {
      proc = spawnExec(built.cmd, built.args, {
        cwd: built.cwd,
        env: {
          ...process.env,
          CI: "1",
          FORCE_COLOR: "0",
          NO_COLOR: "1",
          TERM: "dumb",
          PYTHONUNBUFFERED: "1",
          PYTHONDONTWRITEBYTECODE: "1",
        },
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch (err) {
      return { ok: false, error: err.message };
    }

    const record = { proc, runId, startedAt, senderId: sender.id };
    runs.set(runId, record);
    send({ type: "start", framework: built.framework, display: built.display, file: payload.file || null, test: payload.test || null });

    const timeout = setTimeout(() => {
      try { send({ type: "output", stream: "stderr", line: "Test run timed out after 20 minutes." }); } catch {}
      killTree(proc);
    }, RUN_TIMEOUT_MS);

    const wire = (stream) => {
      let buffer = "";
      proc[stream].on("data", (chunk) => {
        buffer += chunk.toString();
        let nl;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          const rawLine = buffer.slice(0, nl).replace(/\r$/, "");
          buffer = buffer.slice(nl + 1);
          const line = stripAnsi(rawLine);
          if (!line.trim()) continue;
          parseTestLine(line, state);
          parseSummary(line, state);
          send({ type: "output", stream, line });
        }
        if (buffer.length > 200_000) buffer = buffer.slice(-100_000);
      });
    };
    wire("stdout");
    wire("stderr");

    proc.on("error", (err) => {
      clearTimeout(timeout);
      runs.delete(runId);
      send({
        type: "done", ok: false, code: null, error: err.message,
        statuses: state.statuses, fileStatuses: state.fileStatuses,
        summary: state.summary, durationMs: Date.now() - startedAt,
      });
    });

    proc.on("close", (code, signal) => {
      clearTimeout(timeout);
      runs.delete(runId);
      const summary = state.summary;
      if (!summary.fromSummary) summary.total = summary.passed + summary.failed + summary.skipped;
      else if (!summary.total) summary.total = summary.passed + summary.failed + summary.skipped;
      send({
        type: "done",
        ok: code === 0,
        code,
        signal: signal || null,
        killed: !!(record.stopped),
        statuses: state.statuses,
        fileStatuses: state.fileStatuses,
        summary,
        durationMs: Date.now() - startedAt,
        display: built.display,
      });
    });

    return { ok: true, runId, display: built.display, framework: built.framework };
  })();
}

function stopRun(runId) {
  const record = runs.get(String(runId || ""));
  if (!record) return { ok: false, error: "No such test run" };
  record.stopped = true;
  killTree(record.proc);
  return { ok: true };
}

module.exports = {
  detectFrameworks,
  collectTests,
  buildRunCommand,
  buildDebugCommand,
  startRun,
  stopRun,
  _runs: runs,
};
