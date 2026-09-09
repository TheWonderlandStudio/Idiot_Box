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
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\r/g, "");

// extension -> { runtime key, args(file) }
const RUNNERS = {
  ".js":  { runtime: "node",   makeArgs: (f) => [f] },
  ".mjs": { runtime: "node",   makeArgs: (f) => [f] },
  ".cjs": { runtime: "node",   makeArgs: (f) => [f] },
  ".py":  { runtime: "python", makeArgs: (f) => [f] },
  ".php": { runtime: "php",    makeArgs: (f) => [f] },
  ".go":  { runtime: "go",     makeArgs: (f) => ["run", f] },
};
// probe key -> actual command to spawn
const RUNTIME_CMD = { node: "node", python: isWin ? "py" : "python3", php: "php", go: "go", npm: isWin ? "npm.cmd" : "npm" };

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
// Priority: npm scripts (dev>start>serve>watch) > cargo > go > python entry >
// php server > static index.html (Live Server). Null = kuch samajh nahi aaya.
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
    if (has("Cargo.toml")) return { kind: "run", name: "cargo run", cmd: "cargo", args: ["run"], cwd: root };
    if (has("go.mod")) return { kind: "run", name: "go run .", cmd: "go", args: ["run", "."], cwd: root };
    if (has("requirements.txt") || has("pyproject.toml") || has("setup.py")) {
      const py = RUNTIME_CMD.python;
      const entry = ["manage.py", "main.py", "app.py", "server.py"].find((f) => lower.has(f))
        || [...lower].find((f) => f.endsWith(".py") && !f.startsWith("test"));
      if (entry) {
        const rn = real(entry);
        if (entry === "manage.py") return { kind: "run", name: "python manage.py runserver", cmd: py, args: [join(rn), "runserver"], cwd: root };
        return { kind: "run", name: `${py} ${rn}`, cmd: py, args: [join(rn)], cwd: root };
      }
    }
    if (has("composer.json")) return { kind: "run", name: "php server :8000", cmd: "php", args: ["-S", "127.0.0.1:8000", "-t", "."], cwd: root };
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
  // xterm console refs
  const termWrapRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const lastCwdRef = useRef(null);

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

  // Auto-detected command default select karo (user ne kuch aur chuna ho to wahi rahe)
  useEffect(() => { if (auto) setSelected((s) => (s === "__current__" ? "__auto__" : s)); }, [auto]);

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
        const lines = clean.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.length > 0).slice(0, 200);
        for (const l of lines) out(l);
      } catch {}
    };
    const onExit = ({ runId, code, ms }) => {
      try {
        if (!runningRef.current || String(runId) !== String(runningRef.current.runId)) return;
        const label = runningRef.current.label;
        setRunning(null);
        try {
          termRef.current?.writeln(`\x1b[90m[exit code ${code} in ${((Number(ms) || 0) / 1000).toFixed(1)}s]\x1b[0m`);
        } catch {}
        setHistory((prev) => [{ label, code: Number(code), ms: Number(ms) || 0, at: Date.now() }, ...prev].slice(0, HIST_MAX));
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
            const re = /([\w\-.\\/]+?\.(?:js|jsx|ts|tsx|mjs|cjs|py|go|php|java|rb|c|h|cpp|json|html|css|txt|log|md)(?::\d+(?::\d+)?)?)/g;
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
      term.writeln("\x1b[90mRun console — output yahan, poora log Output › Run me. Chalti run me type karke input de sakte ho.\x1b[0m");
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
  const currentRunner = (() => {
    if (!activeFile) return null;
    const r = RUNNERS[extOf(activeFile)];
    if (!r) return null;
    const cmd = RUNTIME_CMD[r.runtime];
    const ok = probes ? !!probes[r.runtime] : true; // probes unknown yet → allow
    return { ...r, cmd, ok, file: activeFile };
  })();

  const configs = [
    ...(auto ? [{ id: "__auto__", name: `Auto — ${auto.name}`, hint: "detected from project", auto: true }] : []),
    {
      id: "__current__",
      name: activeFile ? `Current File — ${baseName(activeFile)}` : "Current File — (none open)",
      disabled: !currentRunner || (probes ? !currentRunner.ok : false),
      hint: !activeFile
        ? "koi file kholo"
        : !currentRunner
          ? `no runner for ${extOf(activeFile) || "this type"}`
          : (probes && !currentRunner.ok ? `${currentRunner.cmd} not found` : `${currentRunner.cmd} ${baseName(activeFile)}`),
      run: currentRunner,
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
    if (!c || c.disabled) return;
    // Auto sentinel → project-detected command resolve karo (NO recursion —
    // resolved config seedha neeche chalti hai, warna __auto__ loop ban jata hai)
    if (c.auto || c.id === "__auto__") {
      const a = autoRef.current;
      if (!a) { setErr("Nothing auto-detectable — open a project file or pick a config"); return; }
      if (a.kind === "live") { runLive(a); return; }
      c = { id: "__auto_resolved__", name: a.name, run: { cmd: a.cmd, args: a.args, cwd: a.cwd } };
    }
    if (!c.run) return;
    setErr(null);
    try {
      if (runningRef.current) {
        try { await window.electronAPI?.runStop?.(runningRef.current.runId); } catch {}
      }
      const run = c.run;
      const cwd = run.cwd || (c.id === "__current__" && activeFile ? (dirName(activeFile) || projectRoot) : projectRoot) || undefined;
      const args = c.id === "__current__" && run.file ? run.makeArgs(run.file) : (run.args || []);
      const label = c.name;
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      try {
        termRef.current?.clear?.();
        termRef.current?.writeln(`\x1b[90m$ ${run.cmd} ${(args || []).join(" ")}\x1b[0m`);
      } catch {}
      lastCwdRef.current = cwd || null;
      setRunning({ runId, label, startedAt: Date.now(), cwd: cwd || null });
      try { window.dispatchEvent(new CustomEvent("add-output-panel")); } catch {}
      out(`—— ${label} ——`);
      const res = await window.electronAPI?.runStart?.({ runId, cmd: run.cmd, args, cwd, label });
      if (!res?.ok) {
        setRunning(null);
        setErr(res?.error || "Could not start");
        out(`FAILED: ${res?.error || "Could not start"}`, "error");
        setHistory((prev) => [{ label, code: -1, ms: 0, at: Date.now() }, ...prev].slice(0, HIST_MAX));
      }
    } catch (e) {
      setRunning(null);
      setErr(e?.message || String(e));
    }
  }, [active, activeFile, projectRoot, out, runLive]);

  const doStop = useCallback(async () => {
    try {
      if (runningRef.current) await window.electronAPI?.runStop?.(runningRef.current.runId);
    } catch {}
  }, []);

  // ── Status-bar button bridge ────────────────────────────────────────────
  // window.__pendingAutoRun = { auto:true } → default auto command chalao.
  // "run:stopCurrent" event → chalti run roko.
  // Har running change par "run:status" broadcast (status button sunta hai).
  const doRunRef = useRef(null);
  doRunRef.current = doRun;
  useEffect(() => {
    const iv = setInterval(() => {
      try {
        if (window.__pendingAutoRun) {
          window.__pendingAutoRun = null;
          const a = autoRef.current;
          if (a) doRunRef.current?.({ id: "__auto__", name: a.name, auto: true });
          else {
            // Status-bar button se aaya par kuch auto-detectable nahi —
            // panel khula hai, isliye visible error dikhao (silent mat raho).
            setErr("No auto-detectable run here — open a project (package.json / go.mod / Cargo.toml / python / index.html) or pick a config above");
            out("No auto-detectable run for this project — pick a config", "warn");
          }
        }
      } catch {}
    }, 700);
    const onStopReq = () => { try { doStop(); } catch {} };
    window.addEventListener("run:stopCurrent", onStopReq);
    return () => { clearInterval(iv); window.removeEventListener("run:stopCurrent", onStopReq); };
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
    ? ["node", "python", "php", "go"].filter((k) => probes[k]).map((k) => `${k} ${String(probes[k]).split(" ")[0]}`).join(" • ") || "no runtimes found"
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
