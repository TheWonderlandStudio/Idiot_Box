// Run & Debug v1: Run panel — launch configs, runners, npm scripts, history.
// Executes via main run engine (pty); console neeche REAL xterm hai (colors,
// links, input) aur full log Output panel ke "Run" channel me jata hai.
// Debug adapters (DAP, breakpoints, variables, watch) are phase 2.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { cssVar } from "../shared/theme.js";

// Renderer me process.* nahi hota (context isolation) — platform UA se pakdo
const isWin = typeof navigator !== "undefined" && /win/i.test(`${navigator.platform || ""} ${navigator.userAgent || ""}`);
const HIST_MAX = 10;

const stripAnsi = (s) =>
  String(s ?? "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
// NOTE: \r DELETE nahi karte — progress bars/spinners same-line overwrite
// ke liye \r bhejte hain; Output panel usse handle karta hai.

// ── Shell helpers (compiled languages compile+run ek pty me) ──────────────
const SHELL_BIN = isWin ? "cmd.exe" : "sh";
const SHELL_FLAG = isWin ? "/c" : "-c";
// Path me space / shell chars ho to double-quote karo.
const q = (s) => {
  const t = String(s ?? "");
  return /[\s"'&|<>^()!]/.test(t) ? `"${t.replace(/"/g, '\\"')}"` : t;
};
const clsOf = (f) => baseName(f).replace(/\.[^.]+$/, "");
const dirOf = (f) => {
  const s = String(f || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i > 0 ? s.slice(0, i) : "";
};
const exeOf = (f) => {
  const d = dirOf(f);
  const sep = String(f || "").includes("\\") ? "\\" : "/";
  return `${d ? `${d}${sep}` : ""}${clsOf(f)}${isWin ? ".exe" : ""}`;
};
// probe version-string vs actual binary: python/lua/npm ke binary alag field me.
// Default "python" hai ("py" launcher kai machine par hota hi nahi — probes/
// main-engine use milte hi sahi binary par switch kar lete hain).
const pyBin = (probes) => (probes?.pythonCmd) || "python";
const npmBin = (probes) => (probes?.npmCmd) || "npm";
const luaBin = (probes) => (probes?.luaCmd) || "lua";

// extension -> builder(file, probes) => { cmd, args, cwd?, live? } | { missing: "tool" }
// Single binary wali simple hain; compile wali (c/cpp/java/rust/kotlin) shell
// string banati hain taaki `javac && java` ek run me ho jaye.
const RUNNERS = {
  ".js":  { runtimes: ["node"], build: (f) => ({ cmd: "node", args: [f] }) },
  ".mjs": { runtimes: ["node"], build: (f) => ({ cmd: "node", args: [f] }) },
  ".cjs": { runtimes: ["node"], build: (f) => ({ cmd: "node", args: [f] }) },
  ".jsx": { runtimes: ["tsx", "node"], build: (f, p) => p?.tsx ? ({ cmd: "tsx", args: [f] }) : ({ cmd: "node", args: [f] }) },
  ".ts":  { runtimes: ["tsx", "tsnode", "deno", "bun", "node"], build: (f, p) => {
    if (p?.tsx) return { cmd: "tsx", args: [f] };
    if (p?.tsnode) return { cmd: "ts-node", args: [f] };
    if (p?.deno) return { cmd: "deno", args: ["run", f] };
    if (p?.bun) return { cmd: "bun", args: [f] };
    return { cmd: "node", args: ["--experimental-strip-types", f] };
  } },
  ".mts": { runtimes: ["tsx", "tsnode", "deno", "bun", "node"], build: (f, p) => {
    if (p?.tsx) return { cmd: "tsx", args: [f] };
    if (p?.tsnode) return { cmd: "ts-node", args: [f] };
    if (p?.deno) return { cmd: "deno", args: ["run", f] };
    if (p?.bun) return { cmd: "bun", args: [f] };
    return { cmd: "node", args: ["--experimental-strip-types", f] };
  } },
  ".cts": { runtimes: ["tsx", "tsnode", "deno", "bun", "node"], build: (f, p) => {
    if (p?.tsx) return { cmd: "tsx", args: [f] };
    if (p?.tsnode) return { cmd: "ts-node", args: [f] };
    return { cmd: "node", args: ["--experimental-strip-types", f] };
  } },
  ".tsx": { runtimes: ["tsx", "tsnode"], build: (f, p) => {
    if (p?.tsx) return { cmd: "tsx", args: [f] };
    if (p?.tsnode) return { cmd: "ts-node", args: [f] };
    return { missing: "tsx" };
  } },
  ".py":  { runtimes: ["python"], build: (f, p) => ({ cmd: pyBin(p), args: [f] }) },
  ".pyw": { runtimes: ["python"], build: (f, p) => ({ cmd: pyBin(p), args: [f] }) },
  ".php": { runtimes: ["php"], build: (f) => ({ cmd: "php", args: [f] }) },
  ".go":  { runtimes: ["go"], build: (f) => ({ cmd: "go", args: ["run", f] }) },
  ".java": { runtimes: ["javac", "java"], build: (f, p) => {
    if (p?.javac && p?.java) {
      const d = dirOf(f) || ".";
      return { cmd: SHELL_BIN, args: [SHELL_FLAG, `javac ${q(f)} && java -cp ${q(d)} ${clsOf(f)}`] };
    }
    if (p?.java) return { cmd: "java", args: [f] }; // JDK 11+ single-file mode
    return { missing: "java" };
  } },
  ".c": { runtimes: ["gcc", "clang", "gpp"], build: (f, p) => {
    const cc = p?.gcc ? "gcc" : p?.clang ? "clang" : p?.gpp ? "g++" : null;
    if (!cc) return { missing: "gcc" };
    return { cmd: SHELL_BIN, args: [SHELL_FLAG, `${cc} ${q(f)} -o ${q(exeOf(f))} && ${q(exeOf(f))}`] };
  } },
  ".h": { runtimes: ["gcc"], build: () => ({ missing: "gcc" }) },
  ".cpp": { runtimes: ["gpp", "clang", "gcc"], build: (f, p) => {
    const cxx = p?.gpp ? "g++" : p?.clang ? "clang++" : p?.gcc ? "gcc" : null;
    if (!cxx) return { missing: "g++" };
    return { cmd: SHELL_BIN, args: [SHELL_FLAG, `${cxx} ${q(f)} -o ${q(exeOf(f))} && ${q(exeOf(f))}`] };
  } },
  ".cc": { runtimes: ["gpp", "clang"], build: (f, p) => {
    const cxx = p?.gpp ? "g++" : p?.clang ? "clang++" : null;
    if (!cxx) return { missing: "g++" };
    return { cmd: SHELL_BIN, args: [SHELL_FLAG, `${cxx} ${q(f)} -o ${q(exeOf(f))} && ${q(exeOf(f))}`] };
  } },
  ".cxx": { runtimes: ["gpp", "clang"], build: (f, p) => {
    const cxx = p?.gpp ? "g++" : p?.clang ? "clang++" : null;
    if (!cxx) return { missing: "g++" };
    return { cmd: SHELL_BIN, args: [SHELL_FLAG, `${cxx} ${q(f)} -o ${q(exeOf(f))} && ${q(exeOf(f))}`] };
  } },
  ".rs": { runtimes: ["cargo", "rustc"], build: (f, p) => {
    if (p?.rustc) return { cmd: SHELL_BIN, args: [SHELL_FLAG, `rustc ${q(f)} -o ${q(exeOf(f))} && ${q(exeOf(f))}`] };
    return { missing: "rustc" };
  } },
  ".cs": { runtimes: ["dotnet"], build: (f) => ({ cmd: "dotnet", args: ["run", f] }) },
  ".rb": { runtimes: ["ruby"], build: (f) => ({ cmd: "ruby", args: [f] }) },
  ".lua": { runtimes: ["lua"], build: (f, p) => ({ cmd: luaBin(p), args: [f] }) },
  ".pl": { runtimes: ["perl"], build: (f) => ({ cmd: "perl", args: [f] }) },
  ".r":  { runtimes: ["rscript"], build: (f) => ({ cmd: "Rscript", args: [f] }) },
  ".jl": { runtimes: ["julia"], build: (f) => ({ cmd: "julia", args: [f] }) },
  ".dart": { runtimes: ["dart"], build: (f) => ({ cmd: "dart", args: [f] }) },
  ".swift": { runtimes: ["swift"], build: (f) => ({ cmd: "swift", args: [f] }) },
  ".kt": { runtimes: ["kotlinc", "kotlin", "java"], build: (f, p) => {
    if (p?.kotlinc && p?.java) {
      const d = dirOf(f) || ".";
      const sep = String(f || "").includes("\\") ? "\\" : "/";
      const jar = `${d}${sep}${clsOf(f)}.jar`;
      return { cmd: SHELL_BIN, args: [SHELL_FLAG, `kotlinc ${q(f)} -include-runtime -d ${q(jar)} && java -jar ${q(jar)}`] };
    }
    if (p?.kotlin) return { cmd: "kotlin", args: [f] };
    return { missing: "kotlinc" };
  } },
  ".sh": { runtimes: ["bash"], build: (f, p) => ({ cmd: p?.bash ? "bash" : "sh", args: [f] }) },
  ".bat": { runtimes: [], build: (f) => isWin ? ({ cmd: "cmd.exe", args: ["/c", f] }) : ({ missing: "cmd.exe" }) },
  ".cmd": { runtimes: [], build: (f) => isWin ? ({ cmd: "cmd.exe", args: ["/c", f] }) : ({ missing: "cmd.exe" }) },
  ".ps1": { runtimes: ["pwsh"], build: (f) => isWin
    ? ({ cmd: "powershell", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", f] })
    : ({ cmd: "pwsh", args: ["-File", f] }) },
  ".html": { runtimes: [], build: (f) => ({ live: true, file: f }) },
  ".htm": { runtimes: [], build: (f) => ({ live: true, file: f }) },
};
// ── Auto-install helper — run button se pehle missing deps install karo ────
const getInstallCommand = async (root, probes) => {
  if (!root) return null;
  const api = window.electronAPI;
  if (!api?.stat) return null;
  const exists = async (p) => {
    try { const s = await api.stat(p); return !!s?.exists; } catch { return false; }
  };
  const join = (f) => `${String(root).replace(/[\\/]+$/, "")}/${f}`;
  // Node: package.json + missing node_modules → npm/yarn/pnpm/bun install
  if (await exists(join("package.json"))) {
    const hasModules = await exists(join("node_modules"));
    if (!hasModules) {
      if (await exists(join("yarn.lock"))) return { cmd: "yarn", args: ["install"], cwd: root, label: "yarn install" };
      if (await exists(join("pnpm-lock.yaml"))) return { cmd: "pnpm", args: ["install"], cwd: root, label: "pnpm install" };
      if (await exists(join("bun.lockb"))) return { cmd: "bun", args: ["install"], cwd: root, label: "bun install" };
      const npm = npmBin(probes);
      return { cmd: npm, args: ["install"], cwd: root, label: `${npm} install` };
    }
  }
  // Python: requirements.txt → pip install (only if venv not ready — pip will be no-op if satisfied)
  if (await exists(join("requirements.txt"))) {
    const py = pyBin(probes);
    return { cmd: py, args: ["-m", "pip", "install", "-r", "requirements.txt"], cwd: root, label: `${py} -m pip install -r requirements.txt` };
  }
  // Go: go.mod → go mod tidy
  if (await exists(join("go.mod"))) {
    return { cmd: "go", args: ["mod", "tidy"], cwd: root, label: "go mod tidy" };
  }
  // Rust: Cargo.toml → cargo fetch (optional, cargo run will fetch)
  return null;
};

// Kisi file ke liye fresh runner banao (probes ke hisab se binary/missing decide).
const buildRunnerForFile = (file, probes) => {
  if (!file) return null;
  const dot = (() => { const b = baseName(file); const i = b.lastIndexOf("."); return i >= 0 ? b.slice(i).toLowerCase() : ""; })();
  const def = RUNNERS[dot];
  if (!def) return null;
  try {
    const spec = def.build(file, probes || null);
    if (!spec || spec.missing) {
      const miss = spec?.missing || (def.runtimes?.[0] || "runtime");
      return { ok: false, missing: miss, hint: `${miss} not found` };
    }
    if (spec.live) return { ok: true, live: true, file: spec.file };
    const ok = probes
      ? (def.runtimes?.length ? def.runtimes.some((k) => !!probes[k]) : true)
      : true; // probes abhi unknown → allow (error spawn par dikhega)
    return { ok, cmd: spec.cmd, args: spec.args || [], hint: `${spec.cmd} ${baseName(file)}` };
  } catch { return null; }
};
// Command field me poori line likh di ho ("py main.py") to quote-aware split
// karke binary + args alag karo. Quoted path ("C:\Program Files\...") ek
// token rehta hai. Built-in runners par no-op (unke cmd me space hoti nahi).
const splitCmdLine = (cmd, extraArgs) => {
  const c = String(cmd || "").trim();
  const rest = Array.isArray(extraArgs) ? extraArgs : [];
  if (!c || !/[\s]/.test(c)) return { cmd: c, args: rest };
  const parts = c.match(/(?:[^\s"]+|"[^"]*")+/g) || [c];
  const clean = parts.map((p) => p.replace(/^"(.*)"$/, "$1")).filter((p) => p.length > 0);
  if (!clean.length) return { cmd: c, args: rest };
  return { cmd: clean[0], args: [...clean.slice(1), ...rest] };
};
// probe key -> actual command to spawn (legacy; python/lua/npm probes se resolve hota hai.
// python default "python" — "py" sirf tab jab probes.pythonCmd wahi bataye.)
const RUNTIME_CMD = { node: "node", python: "python", php: "php", go: "go", npm: isWin ? "npm.cmd" : "npm" };
// Spawn binary (basename, lowercase, no ext) -> mise tool id. Only tools
// mise can actually provide — system toolchains (gcc, kotlinc…) stay on the
// old "not found" error path.
const MISE_TOOL = {
  node: "node", "npm": "node", "npx": "node",
  bun: "bun", deno: "deno",
  python: "python", python3: "python", py: "python", pip: "python", pip3: "python",
  go: "go", cargo: "rust", rustc: "rust",
  dotnet: "dotnet",
  java: "java", mvn: "maven", gradle: "gradle",
  ruby: "ruby", bundle: "ruby",
  php: "php", composer: "php",
  dart: "dart", flutter: "flutter",
  lua: "lua", perl: "perl",
};
const miseToolFor = (cmd) => {
  try {
    const base = String(cmd || "").split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
    return MISE_TOOL[base] || null;
  } catch { return null; }
};
// Spawn se pehle alias resolve: py/python/python3, npm, lua variants → probes wala binary.
// probes abhi unknown ho to "py" ko "python" par lao (launcher aksar missing hota hai;
// main-engine bhi py→python→python3 retry karta hai, ye sirf display/hint sahi rakhta hai).
const resolveCmd = (cmd, probes) => {
  const c = String(cmd || "");
  if (/^(py|python|python3)(\.exe|\.cmd)?$/i.test(c)) {
    if (probes?.pythonCmd) return probes.pythonCmd;
    if (/^py(\.exe|\.cmd)?$/i.test(c)) return "python";
    return cmd;
  }
  if (/^npm(\.cmd)?$/i.test(c) && probes?.npmCmd) return probes.npmCmd;
  if (/^(lua|lua5\.4|luajit)(\.exe)?$/i.test(c) && probes?.luaCmd) return probes.luaCmd;
  return cmd;
};

const lsKey = (root) => `ibx:runConfigs:${root || "__global__"}`;
const histKey = (root) => `ibx:runHistory:${root || "__global__"}`;
const loadJson = (k, fb) => {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return fb;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : fb;
  } catch { return fb; }
};
const saveJson = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

const baseName = (p) => String(p || "").replace(/.*[\\/]/, "") || String(p || "");
const stripSlash = (p) => String(p || "").replace(/[\\/]+$/, "");
// ── Project auto-detect: project type se default run command ─────────────
// Priority: npm scripts (dev>start>serve>watch) > dotnet > cargo > go >
// python entry > ruby > php server > dart > java (gradle/maven) >
// static index.html (Live Server). Null = kuch samajh nahi aaya.
export async function detectAutoConfig(root) {
  try {
    if (!root) return null;
    const api = window.electronAPI;
    if (!api?.readDirAll) return null;
    let entries = [];
    try { entries = (await api.readDirAll(root)) || []; } catch { return null; }
    const files = entries.filter((e) => !e.isDir).map((e) => String(e.name || ""));
    const lower = new Set(files.map((f) => f.toLowerCase()));
    const has = (n) => lower.has(String(n).toLowerCase());
    const hasExt = (ext) => [...lower].some((f) => f.endsWith(ext));
    const real = (n) => entries.find((e) => !e.isDir && String(e.name).toLowerCase() === String(n).toLowerCase())?.name || n;
    const join = (n) => `${stripSlash(root)}/${n}`;
    if (has("package.json")) {
      try {
        const pkg = JSON.parse((await api.readTextFile(join("package.json"))) || "{}");
        const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? Object.keys(pkg.scripts) : [];
        if (scripts.length) {
          const pref = ["dev", "start", "serve", "watch"];
          const pick = pref.find((s) => scripts.includes(s))
            || scripts.find((s) => !/^(pre|post)/.test(s))
            || scripts[0];
          return { kind: "run", name: `npm run ${pick}`, cmd: RUNTIME_CMD.npm, args: ["run", pick], cwd: root };
        }
      } catch {}
    }
    if (hasExt(".csproj") || hasExt(".sln")) return { kind: "run", name: "dotnet run", cmd: "dotnet", args: ["run"], cwd: root };
    if (has("Cargo.toml")) return { kind: "run", name: "cargo run", cmd: "cargo", args: ["run"], cwd: root };
    if (has("go.mod")) return { kind: "run", name: "go run .", cmd: "go", args: ["run", "."], cwd: root };
    if (has("requirements.txt") || has("pyproject.toml") || has("setup.py") || has("manage.py") || has("main.py") || has("app.py")) {
      const py = RUNTIME_CMD.python;
      const entry = ["manage.py", "main.py", "app.py", "server.py"].find((f) => lower.has(f))
        || [...lower].find((f) => f.endsWith(".py") && !f.startsWith("test"));
      if (entry) {
        const rn = real(entry);
        if (entry === "manage.py") return { kind: "run", name: "python manage.py runserver", cmd: py, args: [join(rn), "runserver"], cwd: root };
        return { kind: "run", name: `${py} ${rn}`, cmd: py, args: [join(rn)], cwd: root };
      }
    }
    if (has("rakefile") || has("gemfile") || hasExt(".gemspec")) {
      if (has("rakefile")) return { kind: "run", name: "rake", cmd: "rake", args: [], cwd: root };
      const entry = ["main.rb", "app.rb", "server.rb"].find((f) => lower.has(f))
        || [...lower].find((f) => f.endsWith(".rb"));
      if (entry) return { kind: "run", name: `ruby ${real(entry)}`, cmd: "ruby", args: [join(real(entry))], cwd: root };
    }
    if (has("composer.json")) return { kind: "run", name: "php server :8000", cmd: "php", args: ["-S", "127.0.0.1:8000", "-t", "."], cwd: root };
    if (has("pubspec.yaml")) return { kind: "run", name: "dart run", cmd: "dart", args: ["run"], cwd: root };
    if (has("build.gradle") || has("build.gradle.kts") || has("pom.xml")) {
      if (has("gradlew") || has("gradlew.bat")) return { kind: "run", name: "gradle run", cmd: isWin ? "gradlew.bat" : "./gradlew", args: ["run"], cwd: root };
      if (has("build.gradle") || has("build.gradle.kts")) return { kind: "run", name: "gradle run", cmd: "gradle", args: ["run"], cwd: root };
      return { kind: "run", name: "mvn spring-boot:run", cmd: "mvn", args: ["spring-boot:run"], cwd: root };
    }
    if (has("index.html")) return { kind: "live", name: "Live Server", file: join(real("index.html")), cwd: root };
    return null;
  } catch { return null; }
}
const dirName = (p) => {
  const s = String(p || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i > 0 ? s.slice(0, i) : "";
};
const extOf = (p) => {
  const b = baseName(p);
  const i = b.lastIndexOf(".");
  return i >= 0 ? b.slice(i).toLowerCase() : "";
};
// ── Runtime errors → Problems panel ───────────────────────────────────────
// Fail run ke tail se Python traceback / Node stack / Java frame nikalo aur
// `codemirror:diagnostics` (origin:"runtime") par bhejo. Problems panel inhe
// editor-lint se alag bucket me rakhta hai. runFile = chalai gayi file
// (current-file runs) — Java ke bare filename isi se resolve hote hain.
const parseRuntimeDiagnostics = (text, runFile) => {
  const found = [];
  try {
    const t = String(text || "");
    if (!t) return found;
    // — Python: Traceback … File "abs", line N … ValueError: msg —
    if (/Traceback \(most recent call last\)/.test(t)) {
      const frames = [...t.matchAll(/File "([^"]+)", line (\d+)(?:, in (\S+))?/g)];
      const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
      const exc = [...lines].reverse().find((l) => !/^(Traceback|File "|[\^~]+$)/.test(l) && /(Error|Exception|assert|raise\b)/i.test(l))
        || lines[lines.length - 1] || "Runtime error";
      if (frames.length) {
        const last = frames[frames.length - 1];
        const at = last[3] && last[3] !== "<module>" ? ` in ${last[3]}` : "";
        found.push({
          path: last[1],
          markers: [{
            path: last[1],
            message: `${String(exc).slice(0, 300)}${at}`,
            severity: 8,
            startLineNumber: parseInt(last[2], 10) || 1,
            startColumn: 1,
            source: "Python",
          }],
          origin: "runtime",
        });
        return found;
      }
    }
    // — Node.js: Error: msg … at fn (D:\x\app.js:10:15) —
    const nl = t.split("\n");
    const head = (nl.find((l) => /^\s*(Error|.*Error|Exception)\s*:/i.test(l)) || nl.find((l) => l.trim()) || "Runtime error").trim().slice(0, 300);
    for (const l of nl) {
      const m = l.match(/at\s+(?:.+?\s+\()?((?:[A-Za-z]:[\\/]|\/)[^()\s]+?\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts)):(\d+):(\d+)\)?/);
      if (m && !/node:internal|node_modules[\\/]/i.test(m[1])) {
        found.push({
          path: m[1],
          markers: [{
            path: m[1], message: head, severity: 8,
            startLineNumber: parseInt(m[2], 10) || 1,
            startColumn: parseInt(m[3], 10) || 1,
            source: "Node",
          }],
          origin: "runtime",
        });
        return found;
      }
    }
    // — Java: at com.Foo.main(Foo.java:12) — bare filename runFile se jodo —
    if (runFile) {
      const jm = t.match(/at\s+[\w.$]+\(([\w-]+\.java):(\d+)\)/);
      const base = baseName(runFile);
      if (jm && jm[1].toLowerCase() === String(base || "").toLowerCase()) {
        const jhead = (nl.find((l) => /(Exception|Error)/.test(l)) || "Runtime error").trim().slice(0, 300);
        found.push({
          path: runFile,
          markers: [{
            path: runFile, message: jhead, severity: 8,
            startLineNumber: parseInt(jm[2], 10) || 1, startColumn: 1,
            source: "Java",
          }],
          origin: "runtime",
        });
        return found;
      }
    }
  } catch {}
  return found;
};


const RunPanel = () => {
  const [projectRoot, setProjectRoot] = useState(() => {
    try { return window.__currentProjectPath || null; } catch { return null; }
  });
  const [activeFile, setActiveFile] = useState(null);
  const [probes, setProbes] = useState(null); // { node, python, ... } | null
  const [npmScripts, setNpmScripts] = useState([]);
  const [customs, setCustoms] = useState(() => loadJson(lsKey(null), []));
  const [selected, setSelected] = useState("__current__");
  const [auto, setAuto] = useState(null); // detectAutoConfig result
  const autoRef = useRef(null);
  autoRef.current = auto;
  const [running, setRunning] = useState(null); // { runId, label, startedAt, cwd }
  const [history, setHistory] = useState(() => loadJson(histKey(null), []));
  const [err, setErr] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", cmd: "", args: "", cwd: "" });
  const runningRef = useRef(null);
  runningRef.current = running;
  const rootRef = useRef(projectRoot);
  rootRef.current = projectRoot;
  // doRun callback ke andar fresh values (stale closure se bachne ke liye)
  const probesRef = useRef(null);
  probesRef.current = probes;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const projectRootRef = useRef(projectRoot);
  projectRootRef.current = projectRoot;
  // xterm console refs
  const termWrapRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const lastCwdRef = useRef(null);
  const browserOpenedRef = useRef(false);

  const out = useCallback((msg, level) => {
    try { window.__outputLog?.("Run", msg, level || "info"); } catch {}
  }, []);

  // ── Project + active file tracking ──────────────────────────────────────
  useEffect(() => {
    const syncRoot = () => { try { setProjectRoot(window.__currentProjectPath || null); } catch {} };
    const onOpen = (e) => {
      try {
        const p = e?.detail?.path ?? e?.detail?.filePath;
        if (p) { setActiveFile(p); return; }
      } catch {}
      syncRoot();
    };
    const onClose = () => { setProjectRoot(null); };
    syncRoot();
    const activePoll = () => {
      try {
        const m = window.__flexModel?.current;
        const node = m?.getActiveTabset?.()?.getSelectedNode?.();
        const fp = node?.getConfig?.()?.filePath;
        if (fp) setActiveFile((prev) => (prev === fp ? prev : fp));
      } catch {}
    };
    activePoll();
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    window.addEventListener("open-file-in-editor", onOpen);
    window.addEventListener("open-file-in-new-editor-tab", onOpen);
    const iv1 = setInterval(syncRoot, 3000);
    const iv2 = setInterval(activePoll, 2000);
    return () => {
      window.removeEventListener("project:opened", onOpen);
      window.removeEventListener("project:closed", onClose);
      window.removeEventListener("open-file-in-editor", onOpen);
      window.removeEventListener("open-file-in-new-editor-tab", onOpen);
      clearInterval(iv1);
      clearInterval(iv2);
    };
  }, []);

  // ── Probes (runtimes) ───────────────────────────────────────────────────
  const refreshProbes = useCallback(async () => {
    try {
      const r = await window.electronAPI?.runProbes?.();
      if (r && typeof r === "object") setProbes(r);
    } catch {}
  }, []);
  useEffect(() => { refreshProbes(); }, [refreshProbes]);

  // ── mise fallback refs/helpers ──────────────────────────────────────
  // Missing runtime → `mise install <tool>` (xterm me progress, stoppable)
  // → retry wrapped as `mise x -- <cmd>`. Success path mise ko chhoota
  // bhi nahi — sirf failure par kaam aata hai.
  const pendingExitRef = useRef(null); // { runId, resolve } — chained setup steps
  const refreshProbesRef = useRef(null);
  const spawnRunRef = useRef(null);
  useEffect(() => {
    refreshProbesRef.current = refreshProbes;
  });

  const waitRunExit = useCallback((runId) => new Promise((resolve) => {
    pendingExitRef.current = { runId, resolve };
  }), []);

  const miseInstallAndRespawn = useCallback(async ({ tool, cmd, args, cwd, label, file }) => {
    const api = window.electronAPI;
    try {
      let ens = null;
      try { ens = await api?.miseEnsure?.(); } catch (e) { ens = { ok: false, error: e?.message || String(e) }; }
      if (!ens?.ok || !ens?.bin) {
        const msg = `mise unavailable — cannot auto-install ${tool}${ens?.error ? `: ${ens.error}` : ""}`;
        setErr(msg);
        try { out(msg, "error"); } catch {}
        return false;
      }
      const bin = ens.bin;
      try { await api?.miseTrust?.(cwd); } catch {}
      const runId = `run-mise-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      try { termRef.current?.writeln(`\x1b[33m[mise] installing ${tool}…\x1b[0m`); } catch {}
      try { out(`[mise] installing ${tool}…`); } catch {}
      setRunning({ runId, label: `mise install ${tool}`, startedAt: Date.now(), cwd: cwd || null, file: file || null });
      let res = null;
      try { res = await api?.runStart?.({ runId, cmd: bin, args: ["install", tool], cwd, label: `mise install ${tool}` }); } catch (e) { res = { ok: false, error: e?.message || String(e) }; }
      if (!res?.ok) {
        setRunning(null);
        const msg = `mise install could not start: ${res?.error || "unknown"}`;
        setErr(msg);
        try { out(msg, "error"); } catch {}
        return false;
      }
      const code = await waitRunExit(runId);
      if (Number(code) !== 0) {
        setRunning(null);
        const msg = `mise install ${tool} failed (exit ${code}) — check output above`;
        setErr(msg);
        try { out(msg, "error"); } catch {}
        try { setHistory((prev) => [{ label: `mise install ${tool}`, code: Number(code), ms: 0, at: Date.now() }, ...prev].slice(0, HIST_MAX)); } catch {}
        return false;
      }
      try { await refreshProbesRef.current?.(); } catch {}
      try { termRef.current?.writeln(`\x1b[90m[mise] ${tool} ready — running via mise\x1b[0m`); } catch {}
      if (spawnRunRef.current) {
        return await spawnRunRef.current(
          { cmd: bin, args: ["x", "--", cmd, ...(args || [])], cwd, label: `${label} (via mise)`, file },
          { allowMise: false }
        );
      }
      return false;
    } catch (e) {
      setRunning(null);
      setErr(e?.message || String(e));
      return false;
    }
  }, [out, waitRunExit]);

  // Missing-runtime file (current-file flow) → patched probes se runner
  // banao (cmd/args nikalo), phir mise chain. Tool unknown → false (purana error).
  const tryMiseForFile = useCallback(async (file, miss) => {
    try {
      const clean = String(miss || "").toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
      const tool = MISE_TOOL[clean];
      if (!tool || !file) return false;
      const patched = { ...(probesRef.current || {}), [clean]: "__mise__" };
      const fb2 = buildRunnerForFile(file, patched);
      if (!fb2?.ok || !fb2.cmd) return false;
      const bin = clean;
      const cmd = String(fb2.cmd).split("__mise__").join(bin);
      const args = (fb2.args || []).map((a) => String(a).split("__mise__").join(bin));
      const cwd = (typeof dirName === "function" ? dirName(file) : null) || projectRootRef.current;
      const label = `Current File — ${baseName(file)}`;
      await miseInstallAndRespawn({ tool, cmd, args, cwd, label, file });
      return true; // took over (error bhi khud set kiya agar fail hua)
    } catch { return false; }
  }, [out, miseInstallAndRespawn]);

  const spawnRun = useCallback(async ({ cmd, args, cwd, label, file }, opts) => {
    const allowMise = !opts || opts.allowMise !== false;
    setErr(null);
    try {
      if (runningRef.current) {
        try { await window.electronAPI?.runStop?.(runningRef.current.runId); } catch {}
      }
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      try {
        termRef.current?.clear?.();
        termRef.current?.writeln(`\x1b[90m$ ${cmd} ${(args || []).join(" ")}\x1b[0m`);
      } catch {}
      lastCwdRef.current = cwd || null;
      browserOpenedRef.current = false;
      // file bhi rakho taaki exit par runtime-errors Problems me file se jud sakein.
      setRunning({ runId, label, startedAt: Date.now(), cwd: cwd || null, file: file || null });
      // Output panel kholo + uska channel "Run" par lao (warna logs App me chhupe rehte hain).
      try { window.dispatchEvent(new CustomEvent("add-output-panel", { detail: { channel: "Run" } })); } catch {}
      try { window.dispatchEvent(new CustomEvent("output:switchChannel", { detail: { channel: "Run" } })); } catch {}
      out(`—— ${label} ——`);
      const res = await window.electronAPI?.runStart?.({ runId, cmd, args: args || [], cwd, label });
      if (!res?.ok) {
        // Spawn fail + binary mise se mil sakta hai → install karke retry.
        const tool = allowMise ? miseToolFor(cmd) : null;
        if (tool) {
          return await miseInstallAndRespawn({ tool, cmd, args: args || [], cwd, label, file });
        }
        setRunning(null);
        // Detected runtimes bhi batao taaki "py vs python" confusion turant clear ho.
        let det = "";
        try {
          const p = probesRef.current;
          det = !p
            ? " (still detecting runtimes — press ↻)"
            : ` (detected: python=${p.python ? `${p.python} via ${p.pythonCmd || "?"}` : "MISSING"}, node=${p.node || "MISSING"})`;
        } catch {}
        const hint = /Could not start/i.test(res?.error || "")
          ? `${res?.error} — is "${cmd}" installed and on PATH?${det}`
          : (res?.error || "Could not start");
        setErr(hint);
        out(`FAILED: ${hint}`, "error");
        setHistory((prev) => [{ label, code: -1, ms: 0, at: Date.now() }, ...prev].slice(0, HIST_MAX));
        return false;
      }
      return true;
    } catch (e) {
      setRunning(null);
      setErr(e?.message || String(e));
      return false;
    }
  }, [out, miseInstallAndRespawn]);
  useEffect(() => { spawnRunRef.current = spawnRun; });

  // ── npm scripts + persisted customs/history per project ─────────────────
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        setCustoms(loadJson(lsKey(projectRoot), []));
        setHistory(loadJson(histKey(projectRoot), []));
      } catch {}
      if (!projectRoot) { if (!dead) { setNpmScripts([]); setAuto(null); } return; }
      try {
        const pkgPath = `${projectRoot.replace(/[\\/]+$/, "")}/package.json`;
        const text = await window.electronAPI?.readTextFile?.(pkgPath);
        if (dead) return;
        const pkg = JSON.parse(text || "{}");
        const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? Object.keys(pkg.scripts) : [];
        setNpmScripts(scripts);
      } catch { if (!dead) setNpmScripts([]); }
      try {
        const a = await detectAutoConfig(projectRoot);
        if (!dead) setAuto(a);
      } catch { if (!dead) setAuto(null); }
    })();
    return () => { dead = true; };
  }, [projectRoot]);

  useEffect(() => { saveJson(lsKey(projectRoot), customs); }, [customs, projectRoot]);
  useEffect(() => { saveJson(histKey(projectRoot), history); }, [history, projectRoot]);

  // Default select: project AUTO-command ko priority (npm run dev / ...),
  // khuli runnable file uske baad. User ki explicit choice (npm/custom) ko
  // nahi chhedo. Top ▾ dropdown se koi bhi option ek click me chalti hai.
  useEffect(() => {
    setSelected((s) => {
      if (s !== "__current__" && s !== "__auto__") return s;
      if (auto) return "__auto__";
      return "__current__";
    });
  }, [auto]);

  // ── Engine events → xterm console + Output panel ────────────────────────
  // RAW chunk xterm me (colors/spinners/progress as-is), stripped lines Output me.
  const termWrite = useCallback((data) => {
    try { termRef.current?.write(typeof data === "string" ? data : String(data ?? "")); } catch {}
  }, []);
  useEffect(() => {
    const onData = ({ runId, data }) => {
      try {
        if (!runningRef.current || String(runId) !== String(runningRef.current.runId)) return;
        termWrite(data);
        const clean = stripAnsi(data);
        if (!browserOpenedRef.current) {
          const browserUrl = clean.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s\u001b]*)?/i)?.[0];
          if (browserUrl) {
            browserOpenedRef.current = true;
            window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: browserUrl } }));
          }
        }
        // \r\n par split (CRLF ka \r kha jao), lone trailing \r RAKHO —
        // wo same-line overwrite hai, Output panel use write (bina newline) karta hai.
        const lines = clean.split(/\r\n|\n/).map((l) => l.replace(/[ \t]+$/, "")).filter((l) => l.length > 0).slice(0, 200);
        for (const l of lines) out(l);
      } catch {}
    };
    const onExit = ({ runId, code, ms }) => {
      try {
        // Chained setup step (mise install) → waiter ko resolve, normal
        // history/diagnostics handling skip (yeh setup tha, run nahi).
        const pend = pendingExitRef.current;
        if (pend && String(runId) === String(pend.runId)) {
          pendingExitRef.current = null;
          try { pend.resolve(Number(code)); } catch {}
          return;
        }
        if (!runningRef.current || String(runId) !== String(runningRef.current.runId)) return;
        const info = runningRef.current;
        const label = info.label;
        const runFile = info.file || null;
        setRunning(null);
        try {
          termRef.current?.writeln(`\x1b[90m[exit code ${code} in ${((Number(ms) || 0) / 1000).toFixed(1)}s]\x1b[0m`);
        } catch {}
        setHistory((prev) => [{ label, code: Number(code), ms: Number(ms) || 0, at: Date.now() }, ...prev].slice(0, HIST_MAX));
        // ── Problems panel sync ──────────────────────────────────────
        // Pass → us file ke purane runtime-errors clear; fail → tail se
        // traceback/stack nikalo aur Problems me dikhao (click → editor).
        try {
          if (Number(code) === 0) {
            if (runFile) {
              window.dispatchEvent(new CustomEvent("codemirror:diagnostics", {
                detail: { path: runFile, markers: [], origin: "runtime" },
              }));
            }
          } else {
            const buf = window.__outputBuffer?.Run || [];
            const tail = buf.slice(-150).map((l) => l?.msg ?? "").join("\n");
            for (const d of parseRuntimeDiagnostics(tail, runFile)) {
              window.dispatchEvent(new CustomEvent("codemirror:diagnostics", { detail: d }));
            }
          }
        } catch {}
      } catch {}
    };
    let u1 = null, u2 = null;
    try { u1 = window.electronAPI?.onRunData?.(onData); } catch {}
    try { u2 = window.electronAPI?.onRunExit?.(onExit); } catch {}
    return () => { try { u1?.(); } catch {} try { u2?.(); } catch {} };
  }, [out, termWrite]);

  // ── xterm console lifecycle (Terminal wala pattern) ───────────────────────
  useEffect(() => {
    let term = null, fit = null, ro = null, raf = 0, fitIv = null, disposed = false;
    let raf2 = 0;
    const el0 = termWrapRef.current;
    if (!el0) return undefined;

    const openPathLink = (text) => {
      try {
        const m = String(text || "").match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/);
        if (!m) return;
        let p = m[1] || "";
        const line = parseInt(m[2] || "1", 10) || 1;
        const col = parseInt(m[3] || "1", 10) || 1;
        if (!p) return;
        // relative → last run cwd se jodo
        if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(p) && lastCwdRef.current) {
          p = `${String(lastCwdRef.current).replace(/[\\/]+$/, "")}/${p}`;
        }
        window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: p } }));
        setTimeout(() => {
          try { window.dispatchEvent(new CustomEvent("editor:revealLine", { detail: { path: p, line, column: col } })); } catch {}
        }, 300);
      } catch {}
    };

    try {
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: "Consolas, 'Courier New', monospace",
        fontSize: 12,
        lineHeight: 1.2,
        letterSpacing: 0,
        scrollback: 1000,
        convertEol: true,
        theme: {
          background: cssVar("--bg-vscode", "#1e1e1e"),
          foreground: cssVar("--text-bright", "#cccccc"),
          cursor: cssVar("--teal", "#4ec9b0"),
          cursorAccent: cssVar("--bg-vscode", "#1e1e1e"),
          selectionBackground: cssVar("--term-selection", "#2c4f6e"),
          black: cssVar("--border", "#333333"),
          red: cssVar("--danger", "#f44747"),
          green: cssVar("--teal", "#4ec9b0"),
          yellow: cssVar("--code-yellow", "#dcdcaa"),
          blue: cssVar("--code-blue", "#569cd6"),
          magenta: cssVar("--code-magenta", "#c586c0"),
          cyan: cssVar("--code-cyan", "#9cdcfe"),
          white: cssVar("--text-highlight", "#d4d4d4"),
          brightBlack: cssVar("--term-bright-black", "#767676"),
          brightRed: cssVar("--danger", "#f44747"),
          brightGreen: cssVar("--teal", "#4ec9b0"),
          brightYellow: cssVar("--code-yellow", "#dcdcaa"),
          brightBlue: cssVar("--code-blue", "#569cd6"),
          brightMagenta: cssVar("--code-magenta", "#c586c0"),
          brightCyan: cssVar("--code-cyan", "#9cdcfe"),
          brightWhite: cssVar("--text-inverse", "#ffffff"),
        },
      });
    } catch { return undefined; }
    fit = new FitAddon();
    try { term.loadAddon(fit); } catch {}
    // URLs clickable — localhost/Browser me, baaki OS browser me (Terminal jaisa)
    try {
      term.loadAddon(new WebLinksAddon((event, uri) => {
        try {
          if (/localhost|127\.0\.0\.1|^\d+\.\d+\.\d+\.\d+/.test(uri) || /^https?:\/\//i.test(uri)) {
            window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: uri, config: { type: "browser", title: "Browser", url: uri } } }));
          } else {
            window.electronAPI.openUrl(uri);
          }
        } catch {
          try { window.electronAPI.openUrl(uri); } catch {}
        }
      }));
    } catch {}
    // file[:line[:col]] links clickable — editor me kholo
    try {
      term.registerLinkProvider({
        provideLinks(y, cb) {
          try {
            const line = term.buffer.active.getLine(y - 1)?.translateToString(true) || "";
            const out = [];
            const re = /([\w\-.\\/]+?\.(?:js|jsx|ts|tsx|mts|cts|mjs|cjs|py|pyw|go|php|java|rb|c|h|cpp|cc|cxx|hpp|cs|rs|swift|kt|dart|lua|pl|r|jl|sh|bat|cmd|ps1|json|html|htm|css|txt|log|md)(?::\d+(?::\d+)?)?)/g;
            let m;
            let guard = 0;
            while ((m = re.exec(line)) && guard++ < 20) {
              const text = m[1];
              const start = m.index;
              if (/^https?:\/\//i.test(text)) continue; // WebLinksAddon sambhalega
              out.push({
                range: { start: { x: start + 1, y }, end: { x: start + text.length + 1, y } },
                text,
                activate: (_e, t) => openPathLink(t || text),
              });
            }
            cb(out);
          } catch { try { cb(undefined); } catch {} }
        },
      });
    } catch {}

    const el = termWrapRef.current;
    if (!el) { try { term.dispose(); } catch {} return undefined; }
    try { el.innerHTML = ""; } catch {}
    try { term.open(el); } catch { try { term.dispose(); } catch {} return undefined; }
    termRef.current = term;
    fitRef.current = fit;
    try {
      term.writeln("\x1b[90mRun console — output here, full log in Output › Run. Type to send input to a running process.\x1b[0m");
    } catch {}

    // Typing → chalti run ko stdin (idle ho to ignore)
    try {
      term.onData((data) => {
        try {
          const r = runningRef.current;
          if (!r) return;
          window.electronAPI?.runWrite?.(r.runId, data)?.catch?.(() => {});
        } catch {}
      });
    } catch {}

    const safeFit = () => {
      try {
        if (disposed || !fit || !term || !termWrapRef.current) return;
        if (termWrapRef.current.offsetWidth === 0 || termWrapRef.current.offsetHeight === 0) return;
        fit.fit();
      } catch {}
    };
    // Tab hidden mount ho to pehle fit fail hoga — dikhte hi fit karo
    fitIv = setInterval(safeFit, 800);
    const stopFit = () => { try { clearInterval(fitIv); } catch {} fitIv = null; };
    // Pehle successful fit ke 3s baad interval band (resize RO sambhalta hai)
    raf = requestAnimationFrame(function tick() {
      if (disposed) return;
      try {
        if (termWrapRef.current && termWrapRef.current.offsetWidth > 0) {
          safeFit();
          raf2 = requestAnimationFrame(() => { if (!disposed) setTimeout(stopFit, 3000); });
          return;
        }
      } catch {}
      raf = requestAnimationFrame(tick);
    });
    try {
      ro = new ResizeObserver(() => safeFit());
      ro.observe(el);
    } catch {}
    return () => {
      disposed = true;
      try { cancelAnimationFrame(raf); } catch {}
      try { cancelAnimationFrame(raf2); } catch {}
      try { clearInterval(fitIv); } catch {}
      try { ro?.disconnect(); } catch {}
      try { term?.dispose(); } catch {}
      if (termRef.current === term) termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // ── Config list ─────────────────────────────────────────────────────────
  // currentRunner har render par fresh banta hai taaki probes update hote hi
  // sahi binary / missing-hint mile (py→python fallback समेत).
  const currentRunner = (() => {
    if (!activeFile) return null;
    const built = buildRunnerForFile(activeFile, probes);
    if (!built) return null;
    if (built.live) return { live: true, file: built.file, ok: true, cmd: "live-server", hint: `Live Server ${baseName(activeFile)}` };
    return { cmd: resolveCmd(built.cmd, probes), ok: !!built.ok, hint: built.hint, missing: built.missing, file: activeFile };
  })();

  const configs = [
    ...(auto ? [{ id: "__auto__", name: `Auto — ${auto.name}`, hint: "detected from project", auto: true }] : []),
    {
      id: "__current__",
      name: activeFile ? `Current File — ${baseName(activeFile)}` : "Current File — (none open)",
      disabled: !currentRunner || (probes ? !currentRunner.ok && !currentRunner.live : false),
      hint: !activeFile
        ? "koi file kholo"
        : !currentRunner
          ? `no runner for ${extOf(activeFile) || "this type"}`
          : (currentRunner.live ? currentRunner.hint
            : (probes && !currentRunner.ok ? `${currentRunner.missing || currentRunner.cmd} not found — install it or pick another config` : currentRunner.hint)),
      run: currentRunner,
      file: activeFile,
    },
    ...npmScripts.map((s) => ({
      id: `npm:${s}`,
      name: `npm run ${s}`,
      hint: `package.json script`,
      run: { cmd: RUNTIME_CMD.npm, args: ["run", s], cwd: projectRoot },
    })),
    ...customs.map((c) => ({
      id: `custom:${c.id}`,
      name: c.name,
      hint: [c.cmd, ...(c.args || [])].join(" ").slice(0, 80),
      run: { cmd: c.cmd, args: c.args || [], cwd: c.cwd || projectRoot },
      customId: c.id,
    })),
  ];
  const active = configs.find((c) => c.id === selected) || configs[0];

  // ── Top ▾ dropdown bridge ─────────────────────────────────────────────
  // configs har render fresh hain — poll/dropdown ke liye ref me rakho.
  const configsRef = useRef([]);
  configsRef.current = configs;
  // Options badle tabhi broadcast (har render par storm nahi).
  const optionsKey = `${selected}~${configs.map((c) => `${c.id}|${c.disabled ? 1 : 0}|${c.name}`).join("~")}`;
  const lastOptionsKeyRef = useRef("");
  useEffect(() => {
    if (lastOptionsKeyRef.current === optionsKey) return;
    lastOptionsKeyRef.current = optionsKey;
    try {
      window.dispatchEvent(new CustomEvent("run:options", {
        detail: {
          options: configsRef.current.map((c) => ({ id: c.id, name: c.name, hint: c.hint, disabled: !!c.disabled })),
          selected,
        },
      }));
    } catch {}
  });

  // Static projects: Live Server kholo (browser tab me)
  const runLive = useCallback(async (a) => {
    setErr(null);
    const label = a?.name || "Live Server";
    try {
      const res = await window.electronAPI?.startLiveServer?.(a.cwd || projectRoot, a.file);
      if (res?.url) {
        out(`Live Server → ${res.url}`);
        try { window.dispatchEvent(new CustomEvent("add-browser-panel", { detail: { url: res.url } })); } catch {}
        setHistory((prev) => [{ label, code: 0, ms: 0, at: Date.now() }, ...prev].slice(0, HIST_MAX));
      } else {
        setErr("Live Server start failed");
        out("Live Server start failed", "error");
      }
    } catch (e) {
      setErr(e?.message || String(e));
      out(`Live Server failed: ${e?.message || e}`, "error");
    }
  }, [projectRoot, out]);

  const doRun = useCallback(async (cfg) => {
    let c = cfg || active;
    if (!c || c.disabled) {
      // Disabled current-file par bhi wajah batao (silent fail nahi) —
      // mise se mil sake to install karke chalao.
      if (c?.id === "__current__" && activeFile) {
        const b = buildRunnerForFile(activeFile, probesRef.current);
        if (b && !b.ok) {
          const handled = await tryMiseForFile(activeFile, b.missing);
          if (handled) return;
          setErr(`${b.missing || "runtime"} not found — install it and press ↻, or pick another config`);
        }
      }
      return;
    }
    // Auto sentinel → resolve karo (NO recursion — resolved config seedha
    // neeche chalti hai, warna __auto__ loop ban jata hai).
    // Priority: project AUTO-command pehle (npm run dev / cargo run / ...),
    // phir khuli runnable file. Koi file khuli nahi ya runnable nahi to auto
    // hi chalta hai; auto nahi to current file. (Dropdown me explicit choice
    // seedha usi config par jati hai — neeche run:runOption dekho.)
    if (c.auto || c.id === "__auto__") {
      const a = autoRef.current;
      const f = activeFileRef.current;
      const fb = buildRunnerForFile(f, probesRef.current);
      const runCurrentFile = () => {
        if (!f || !fb) return false;
        if (fb.live) { runLive({ name: `Live Server — ${baseName(f)}`, file: fb.file, cwd: projectRootRef.current }); return true; }
        if (fb.ok) {
          c = { id: "__current__", name: `Current File — ${baseName(f)}`, run: { cmd: resolveCmd(fb.cmd, probesRef.current), args: fb.args }, file: f };
          return true;
        }
        return false;
      };
      const runAutoCfg = () => {
        if (!a) return false;
        if (a.kind === "live") { runLive(a); return true; }
        c = { id: "__auto_resolved__", name: a.name, run: { cmd: resolveCmd(a.cmd, probesRef.current), args: a.args, cwd: a.cwd } };
        return true;
      };
      const done = runAutoCfg() || runCurrentFile();
      if (!done) {
        // Missing runtime mise se mil sake to install karke chalao.
        if (fb && !fb.ok && f) {
          const handled = await tryMiseForFile(f, fb.missing);
          if (handled) return;
        }
        setErr(fb && !fb.ok
          ? `${fb.missing || "runtime"} not found — install it and press ↻, or open a project (package.json / Cargo.toml / go.mod / *.csproj / python / index.html)`
          : "Nothing to run — open a code file (.py .js .java .c .cpp .go .rs .rb .php …) or a project, then press Run");
        out("Nothing runnable for Run button — open a file or pick a config", "warn");
        return;
      }
    }
    // Current-file config: probes fresh ho sakte hain — runner dobara build karo.
    if (c.id === "__current__") {
      const f = c.file || activeFileRef.current;
      const fb = buildRunnerForFile(f, probesRef.current);
      if (!fb) { setErr(`No runner for ${extOf(f) || "this type"} yet`); return; }
      if (fb.live) { runLive({ name: `Live Server — ${baseName(f)}`, file: fb.file, cwd: projectRootRef.current }); return; }
      if (!fb.ok) {
        const handled = await tryMiseForFile(f, fb.missing);
        if (handled) return;
        setErr(`${fb.missing || "runtime"} not found — install it and press ↻`); out(`Cannot run ${baseName(f)}: ${fb.missing || "runtime"} missing`, "error"); return;
      }
      c = { ...c, run: { cmd: resolveCmd(fb.cmd, probesRef.current), args: fb.args } };
    }
    if (!c.run) return;
    const raw = { ...c.run, cmd: resolveCmd(c.run.cmd, probesRef.current) };
    // Command field me poori line ho ("py main.py") to binary/args alag karo,
    // phir alias resolve (py→probes.pythonCmd/"python").
    const sp = splitCmdLine(raw.cmd, raw.args);
    const run = { ...raw, cmd: resolveCmd(sp.cmd, probesRef.current), args: sp.args };
    const cwd = run.cwd || (c.id === "__current__" && (c.file || activeFileRef.current) ? (dirName(c.file || activeFileRef.current) || projectRootRef.current) : projectRootRef.current) || undefined;
    const args = run.args || [];
    const label = c.name;
    // file bhi rakho taaki exit par runtime-errors Problems me file se jud sakein.
    const runFile = (c.id === "__current__" ? (c.file || activeFileRef.current) : null) || null;
    // ── Deps auto-install (npm/pip/go mod) — pehle wali behavior, par ab
    // chained PTY step (shell `&&` nahi) taaki mise flow ke saath compose ho.
    let autoInstall = null;
    try {
      const rootForInstall = run.cwd || c.cwd || projectRootRef.current;
      autoInstall = await getInstallCommand(rootForInstall, probesRef.current);
    } catch {}
    if (autoInstall) {
      try {
        termRef.current?.writeln(`\x1b[33m[auto-install] ${autoInstall.label}...\x1b[0m`);
        out(`Auto-install: ${autoInstall.label}`);
      } catch {}
      const insId = `run-install-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setRunning({ runId: insId, label: autoInstall.label, startedAt: Date.now(), cwd: autoInstall.cwd || null, file: runFile });
      let ires = null;
      try {
        ires = await window.electronAPI?.runStart?.({
          runId: insId,
          cmd: resolveCmd(autoInstall.cmd, probesRef.current),
          args: autoInstall.args || [],
          cwd: autoInstall.cwd,
          label: autoInstall.label,
        });
      } catch (e) { ires = { ok: false, error: e?.message || String(e) }; }
      if (!ires?.ok) {
        setRunning(null);
        const msg = `Auto-install could not start: ${ires?.error || "unknown"}`;
        setErr(msg);
        out(msg, "error");
        return;
      }
      const icode = await waitRunExit(insId);
      if (Number(icode) !== 0) {
        setRunning(null);
        const msg = `${autoInstall.label} failed (exit ${icode}) — fix errors above, then Run again`;
        setErr(msg);
        out(msg, "error");
        try { setHistory((prev) => [{ label: autoInstall.label, code: Number(icode), ms: 0, at: Date.now() }, ...prev].slice(0, HIST_MAX)); } catch {}
        return;
      }
    }
    // spawnRun: start karega; spawn fail + mise-tool mile to install→retry khud karega.
    return spawnRun({ cmd: run.cmd, args, cwd, label, file: runFile });
  }, [active, out, runLive, spawnRun, tryMiseForFile, waitRunExit]);

  const doStop = useCallback(async () => {
    try {
      if (runningRef.current) await window.electronAPI?.runStop?.(runningRef.current.runId);
    } catch {}
  }, []);

  // ── Status-bar button bridge ────────────────────────────────────────────
  // window.__pendingAutoRun = { auto:true } → khuli runnable file pehle,
  // warna project auto-command (doRun preferCurrent me khud decide karta hai).
  // "run:stopCurrent" event → chalti run roko.
  // Har running change par "run:status" broadcast (status button sunta hai).
  const doRunRef = useRef(null);
  doRunRef.current = doRun;
  useEffect(() => {
    const onRunRequest = () => {
      window.__pendingAutoRun = null;
      try { doRunRef.current?.({ id: "__auto__", auto: true }); } catch {}
    };
    const iv = setInterval(() => {
      try {
        if (window.__pendingAutoRun) {
          window.__pendingAutoRun = null;
          // doRun: auto → current-file fallback + visible error khud handle karta hai.
          try { doRunRef.current?.({ id: "__auto__", auto: true }); } catch {}
        }
        // Top ▾ dropdown se chuni option (panel mount hone ke baad chalti hai —
        // isliye poll, seedha event nahi: panel tabhi mount hota hai).
        if (window.__pendingRunOption) {
          const { id } = window.__pendingRunOption || {};
          window.__pendingRunOption = null;
          try {
            const list = configsRef.current || [];
            const cfg = list.find((x) => x.id === id);
            if (cfg) doRunRef.current?.(cfg);
            else {
              setErr("That run option no longer exists — pick again from the panel");
              out(`Run option not found: ${id}`, "warn");
            }
          } catch {}
        }
      } catch {}
    }, 700);
    const onStopReq = () => { try { doStop(); } catch {} };
    window.addEventListener("run:request", onRunRequest);
    window.addEventListener("run:stopCurrent", onStopReq);
    return () => {
      clearInterval(iv);
      window.removeEventListener("run:request", onRunRequest);
      window.removeEventListener("run:stopCurrent", onStopReq);
    };
  }, [out, doStop]);
  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent("run:status", {
        detail: running ? { running: true, label: running.label } : { running: false },
      }));
    } catch {}
  }, [running]);

  const deleteCustom = useCallback((id) => {
    setCustoms((prev) => prev.filter((c) => c.id !== id));
    setSelected((s) => (s === `custom:${id}` ? "__current__" : s));
  }, []);

  const addCustom = useCallback(() => {
    const name = form.name.trim();
    const cmd = form.cmd.trim();
    if (!name || !cmd) return;
    const args = form.args.split(/\s+/).map((a) => a.trim()).filter(Boolean);
    const id = `c${Date.now().toString(36)}`;
    setCustoms((prev) => [...prev, { id, name, cmd, args, cwd: form.cwd.trim() || null }]);
    setSelected(`custom:${id}`);
    setForm({ name: "", cmd: "", args: "", cwd: "" });
    setShowAdd(false);
  }, [form]);

  const dot = running ? "var(--teal)" : "var(--text-muted)";
  const runtimeHint = probes
    ? ["node", "python", "php", "go", "java", "gcc", "gpp", "cargo", "rustc", "ruby", "dotnet", "dart", "tsx", "deno", "bun", "lua", "perl", "rscript", "julia"]
      .filter((k) => probes[k]).map((k) => `${k} ${String(probes[k]).split(" ")[0]}`).join(" • ") || "no runtimes found — install node/python/java/gcc and press ↻"
    : "detecting runtimes…";

  const btn = {
    background: "var(--bg-surface)", border: "1px solid var(--border-light)", color: "var(--text-bright)",
    padding: "var(--space-4) var(--space-10)", borderRadius: "var(--radius-sm)", cursor: "pointer",
    fontSize: "var(--fs-body)", fontWeight: "var(--fw-semibold)", display: "inline-flex",
    alignItems: "center", gap: "var(--space-6)",
  };
  const btnPrimary = { ...btn, background: "var(--grad-teal)", color: "var(--ink-on-teal)", border: "none" };
  const inp = {
    background: "var(--bg-surface)", color: "var(--text-bright)", border: "1px solid var(--border-light)",
    borderRadius: "var(--radius-sm)", fontSize: "var(--fs-body)", padding: "var(--space-4) var(--space-8)", width: "100%",
    boxSizing: "border-box", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", color: "var(--text-bright)", fontFamily: "sans-serif", overflow: "hidden" }}>
      {/* xterm measuring guards (Terminal panel ke bina bhi monospace grid sahi rahe) */}
      <style>{`.run-console .xterm, .run-console .xterm * { font-kerning: none; }
.run-console .xterm-rows span, .run-console .xterm-char-measure-element { font-family: inherit; }
.run-console .xterm { height: 100%; padding: 0 !important; background: var(--bg-vscode) !important; }
.run-console .xterm-viewport { scrollbar-width: thin; background: var(--bg-vscode) !important; }
.run-console .xterm-screen { background: var(--bg-vscode) !important; }
.run-console .xterm-rows { font-variant-ligatures: none; letter-spacing: normal; }`}</style>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-6) var(--space-12)", background: "var(--bg-vscode)", borderBottom: "var(--space-1) solid var(--bg-active)", flexShrink: 0 }}>
        <span style={{ width: 8, height: 8, borderRadius: "var(--radius-round)", background: dot, boxShadow: running ? "0 0 6px var(--teal)" : "none", animation: running ? "pulse 1.4s infinite" : "none" }} />
        <span style={{ fontSize: "var(--fs-body)", fontWeight: "var(--fw-semibold)" }}>Run &amp; Debug</span>
        {running && (
          <span style={{ fontSize: "var(--fs-tiny)", background: "var(--teal-a22)", color: "var(--teal)", padding: "var(--space-1) var(--space-6)", borderRadius: "var(--radius-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
            {running.label}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-4)" }}>
          {!running ? (
            <button onClick={() => doRun()} disabled={!active || active.disabled} title={active?.disabled ? active.hint : `Run ${active?.name}`} style={{ ...btnPrimary, opacity: !active || active.disabled ? 0.45 : 1, cursor: !active || active.disabled ? "default" : "pointer" }}>
              <span>▶</span> Run
            </button>
          ) : (
            <button onClick={doStop} title="Stop" style={{ ...btn, borderColor: "var(--error-border-short)", color: "var(--error-text)" }}>
              <span>■</span> Stop
            </button>
          )}
          <button onClick={() => { if (running) { doStop().finally(() => setTimeout(() => doRun(), 300)); } else doRun(); }} disabled={!active || active.disabled} title="Restart" style={{ ...btn, opacity: !active || active.disabled ? 0.45 : 1 }}>
            <span>↻</span>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-8) var(--space-12)", display: "flex", flexDirection: "column", gap: "var(--space-10)" }}>
        {err && (
          <div style={{ padding: "var(--space-6) var(--space-8)", background: "var(--error-bg)", border: "1px solid var(--error-border-short)", borderRadius: "var(--radius-sm)", color: "var(--error-text)", fontSize: "var(--fs-small)" }}>
            {err}
          </div>
        )}

        {/* Launch */}
        <div>
          <div style={{ fontSize: "var(--fs-tiny)", fontWeight: "var(--fw-bold)", letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "var(--space-4)" }}>Launch</div>
          <select
            value={active?.id || "__current__"}
            onChange={(e) => setSelected(e.target.value)}
            style={{ ...inp, cursor: "pointer" }}
          >
            {configs.map((c) => (
              <option key={c.id} value={c.id} disabled={!!c.disabled}>
                {c.name}{c.disabled ? ` — ${c.hint}` : ""}
              </option>
            ))}
          </select>
          <div style={{ fontSize: "var(--fs-tiny)", color: "var(--text-muted)", marginTop: "var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }} title={runtimeHint}>{runtimeHint}</span>
            <button onClick={refreshProbes} title="Re-detect runtimes" style={{ background: "transparent", border: "none", color: "var(--icon)", cursor: "pointer", fontSize: "var(--fs-small)", padding: 0 }}>↻</button>
          </div>
          {!projectRoot && (
            <div style={{ fontSize: "var(--fs-small)", color: "var(--text-muted)", marginTop: "var(--space-4)" }}>No project open — runs use the file's folder. npm scripts need a project.</div>
          )}
        </div>

        {/* Console — real terminal (colors, links, input). Full log → Output › Run */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 170 }}>
          <div style={{ fontSize: "var(--fs-tiny)", fontWeight: "var(--fw-bold)", letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
            <span>Console</span>
            <span style={{ fontWeight: "var(--fw-medium)", textTransform: "none", letterSpacing: 0 }}>
              {running ? "type to send input • links are clickable" : "full log → Output › Run"}
            </span>
          </div>
          <div
            ref={termWrapRef}
            className="run-console"
            style={{ flex: 1, minHeight: 140, overflow: "hidden", background: "var(--bg-vscode)", border: "1px solid var(--bg-active)", borderRadius: "var(--radius-sm)", padding: "var(--space-4) var(--space-6)", boxSizing: "border-box" }}
          />
        </div>

        {/* Custom configs */}
        <div>
          <div style={{ display: "flex", alignItems: "center", marginBottom: "var(--space-4)" }}>
            <span style={{ fontSize: "var(--fs-tiny)", fontWeight: "var(--fw-bold)", letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-muted)" }}>My commands</span>
            <button onClick={() => setShowAdd((v) => !v)} title="New custom command" style={{ ...btn, marginLeft: "auto", padding: "var(--space-1) var(--space-8)" }}>+ New</button>
          </div>
          {showAdd && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", marginBottom: "var(--space-6)", background: "var(--bg-vscode)", border: "1px solid var(--bg-active)", borderRadius: "var(--radius-sm)", padding: "var(--space-8)" }}>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name — e.g. Dev server" style={inp} />
              <input value={form.cmd} onChange={(e) => setForm({ ...form, cmd: e.target.value })} placeholder="Command — e.g. node, python, npm" style={{ ...inp, fontFamily: "var(--font-code)" }} />
              <input value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder="Args — e.g. server.js --port 3000" style={{ ...inp, fontFamily: "var(--font-code)" }} />
              <input value={form.cwd} onChange={(e) => setForm({ ...form, cwd: e.target.value })} placeholder="Folder (optional — default project root)" style={inp} />
              <div style={{ display: "flex", gap: "var(--space-6)", justifyContent: "flex-end" }}>
                <button onClick={() => setShowAdd(false)} style={btn}>Cancel</button>
                <button onClick={addCustom} disabled={!form.name.trim() || !form.cmd.trim()} style={{ ...btnPrimary, opacity: !form.name.trim() || !form.cmd.trim() ? 0.45 : 1 }}>Add</button>
              </div>
            </div>
          )}
          {customs.length === 0 && !showAdd && (
            <div style={{ fontSize: "var(--fs-small)", color: "var(--text-placeholder)" }}>No custom commands yet.</div>
          )}
          {customs.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-4) 0", borderBottom: "1px solid var(--bg-active)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--fs-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                <div style={{ fontSize: "var(--fs-tiny)", color: "var(--text-muted)", fontFamily: "var(--font-code)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[c.cmd, ...(c.args || [])].join(" ")}
                </div>
              </div>
              <button onClick={() => doRun({ id: `custom:${c.id}`, name: c.name, run: { cmd: c.cmd, args: c.args || [], cwd: c.cwd || projectRoot } })} title={`Run ${c.name}`} style={btn}>▶</button>
              <button onClick={() => deleteCustom(c.id)} title="Delete" style={{ ...btn, color: "var(--error-text)" }}>×</button>
            </div>
          ))}
        </div>

        {/* History */}
        {history.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: "var(--space-4)" }}>
              <span style={{ fontSize: "var(--fs-tiny)", fontWeight: "var(--fw-bold)", letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-muted)" }}>Recent</span>
              <button onClick={() => setHistory([])} title="Clear history" style={{ ...btn, marginLeft: "auto", padding: "var(--space-1) var(--space-8)" }}>Clear</button>
            </div>
            {history.map((h, i) => (
              <div key={`${h.at}-${i}`} style={{ display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "var(--space-4) 0", borderBottom: "1px solid var(--bg-active)", fontSize: "var(--fs-small)" }}>
                <span style={{ color: h.code === 0 ? "var(--teal)" : h.code === -1 ? "var(--error-text)" : "var(--git-modified)", fontWeight: "var(--fw-bold)", flexShrink: 0 }}>
                  {h.code === 0 ? "✓" : "✕"} {h.code}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h.label}>{h.label}</span>
                <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{(Number(h.ms) / 1000).toFixed(1)}s</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: "var(--fs-tiny)", color: "var(--text-placeholder)", marginTop: "auto", paddingTop: "var(--space-8)" }}>
          Debug adapters (breakpoints, variables, watch) — coming in phase 2.
        </div>
      </div>
    </div>
  );
};

export default RunPanel;
