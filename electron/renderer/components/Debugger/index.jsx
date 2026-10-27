// Debugger — Node (inspector) and Python (debugpy/DAP) sessions.
//
// Launch from the config row, from the editor's active file, or from the
// Test Explorer (which hands off a test descriptor). Breakpoints live in the
// shared renderer store, so the gutter and this panel are always in sync.
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Bug, Play, Pause, Square, StepForward, StepBack, ArrowDownToLine, ArrowUpFromLine,
  RotateCcw, ChevronDown, ChevronRight, Settings2, FileCode2, Trash2, Plus,
  Loader2, AlertTriangle, CheckCircle2, X, Eye, Braces, TerminalSquare, RefreshCw,
} from "lucide-react";
import {
  allBreakpoints, getBreakpointKey, setBreakpointEnabled, removeBreakpoint,
  setBreakpointCondition, subscribeBreakpoints,
} from "../Editor/breakpoints.js";
import { getActiveEditorPath } from "../Editor/shared.js";
import "./debugger.css";

const WATCH_KEY = "ibx.debug.watches.v1";
const MAX_OUTPUT = 2500;

const projectRoot = () => {
  try { return window.__currentProjectPath || ""; } catch { return ""; }
};

const baseName = (p) => String(p || "").split(/[\\/]/).pop() || String(p || "");

const isAbsolutePath = (p) => /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(String(p || ""));

const joinPath = (root, p) => {
  const s = String(p || "").trim();
  if (!s) return "";
  if (isAbsolutePath(s) || !root) return s;
  return `${String(root).replace(/[\\/]+$/, "")}/${s.replace(/^[\\/]+/, "")}`;
};

const languageFor = (p) => (/\.pyw?$/i.test(String(p || "")) ? "python" : "node");

const parseArgs = (text) => {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || "")))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
};

const loadWatches = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(WATCH_KEY) || "null");
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => String(s || "").trim()).filter(Boolean).slice(0, 30);
  } catch {
    return [];
  }
};

const saveWatches = (list) => {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(list.slice(0, 30))); } catch {}
};

const openFileAt = (filePath, line, column) => {
  if (!filePath) return;
  try {
    window.dispatchEvent(new CustomEvent("open-file-in-editor", { detail: { path: filePath } }));
  } catch {}
  if (!line) return;
  setTimeout(() => {
    try {
      window.dispatchEvent(new CustomEvent("editor:revealLine", {
        detail: { path: filePath, line, column: column || 1 },
      }));
    } catch {}
  }, 300);
};

const statusText = (session, paused) => {
  if (!session) return "Not started";
  switch (session.status) {
    case "starting": return "Starting…";
    case "waiting": return "Waiting";
    case "running": return "Running";
    case "paused": return `Paused · ${paused?.reason || "breakpoint"}`;
    case "terminated": return "Terminated";
    default: return session.status || "Not started";
  }
};

const DebuggerPanel = () => {
  const [availability, setAvailability] = useState(null);
  const [language, setLanguage] = useState(() => languageFor(getActiveEditorPath()));
  const [target, setTarget] = useState(() => getActiveEditorPath() || "");
  const [argsText, setArgsText] = useState("");
  const [showConfig, setShowConfig] = useState(true);

  const [session, setSession] = useState(null);
  const [paused, setPaused] = useState(null);
  const [frames, setFrames] = useState([]);
  const [selectedFrameId, setSelectedFrameId] = useState(null);
  const [scopes, setScopes] = useState([]);
  const [scopesLoading, setScopesLoading] = useState(false);
  const [scopesError, setScopesError] = useState(null);
  const [expandedScopes, setExpandedScopes] = useState(() => new Set());
  const [variables, setVariables] = useState({});
  const [expandedVars, setExpandedVars] = useState(() => new Set());

  const [breakpoints, setBreakpoints] = useState(() => allBreakpoints());
  const [bpVerified, setBpVerified] = useState(() => new Map());
  const [editingBp, setEditingBp] = useState(null);
  const [conditionDraft, setConditionDraft] = useState("");

  const [watches, setWatches] = useState(loadWatches);
  const [watchExpr, setWatchExpr] = useState("");
  const [watchResults, setWatchResults] = useState({});
  const [evalExpr, setEvalExpr] = useState("");
  const [evalResult, setEvalResult] = useState(null);

  const [output, setOutput] = useState([]);
  const [notice, setNotice] = useState(null);
  const [starting, setStarting] = useState(false);
  const [actionBusy, setActionBusy] = useState(null);
  const [installing, setInstalling] = useState(false);

  const sessionRef = useRef(null);
  const sessionStateRef = useRef(null);
  const languageRef = useRef(language);
  const targetRef = useRef(target);
  const autoTargetRef = useRef(target);
  const startingRef = useRef(false);
  const pendingEventsRef = useRef(new Map());
  const testRequestRef = useRef("");
  const currentRequestRef = useRef("");
  const frameEpochRef = useRef(0);
  const variableRequestsRef = useRef(new Set());
  const variableStatesRef = useRef({});
  const outRef = useRef(null);

  sessionStateRef.current = session;
  languageRef.current = language;
  targetRef.current = target;

  useEffect(() => { saveWatches(watches); }, [watches]);
  useEffect(() => { variableStatesRef.current = variables; }, [variables]);

  // ── Event plumbing ───────────────────────────────────────────────────────
  // debug:start resolves after the backend already broadcast "started" and
  // "ready", so events for an unknown session are buffered until we know its
  // id (then replayed in order).
  const applyEvent = useCallback((ev) => {
    if (!ev || !ev.sessionId) return;
    switch (ev.type) {
      case "started":
        setSession((prev) => (prev && prev.id === ev.sessionId
          ? {
              ...prev,
              name: prev.name || ev.name || "Debug",
              pid: ev.pid ?? prev.pid,
              command: ev.command || prev.command,
            }
          : prev));
        break;
      case "ready":
        setSession((prev) => (prev && prev.id === ev.sessionId && prev.status === "starting"
          ? { ...prev, status: "waiting" }
          : prev));
        break;
      case "output":
        setOutput((prev) => {
          const next = [...prev, { stream: ev.stream === "stderr" ? "stderr" : "stdout", line: String(ev.line ?? "") }];
          return next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next;
        });
        break;
      case "stopped": {
        const nextFrames = Array.isArray(ev.frames) ? ev.frames : [];
        frameEpochRef.current++;
        variableRequestsRef.current.clear();
        setSession((prev) => (prev ? { ...prev, status: "paused" } : prev));
        setPaused({ reason: ev.reason || "other", threadId: ev.threadId ?? 1 });
        setFrames(nextFrames);
        setSelectedFrameId(nextFrames[0]?.id ?? null);
        setScopes([]);
        setScopesError(null);
        setVariables({});
        setExpandedVars(new Set());
        setExpandedScopes(new Set());
        break;
      }
      case "continued":
        frameEpochRef.current++;
        variableRequestsRef.current.clear();
        setSession((prev) => (prev ? { ...prev, status: "running" } : prev));
        setPaused(null);
        setFrames([]);
        setSelectedFrameId(null);
        setScopes([]);
        setScopesError(null);
        setVariables({});
        setExpandedVars(new Set());
        setExpandedScopes(new Set());
        break;
      case "breakpoint": {
        const fileKey = getBreakpointKey(ev.file);
        if (!fileKey) break;
        setBpVerified((prev) => {
          const next = new Map(prev);
          for (const bp of ev.breakpoints || []) {
            const line = Number(bp?.line);
            if (!Number.isFinite(line) || line < 1) continue;
            const key = `${fileKey}:${line}`;
            if (bp.enabled === false) next.delete(key);
            else next.set(key, bp.verified !== false);
          }
          return next;
        });
        break;
      }
      case "terminated": {
        frameEpochRef.current++;
        variableRequestsRef.current.clear();
        setSession((prev) => (prev ? { ...prev, status: "terminated" } : prev));
        setPaused(null);
        setFrames([]);
        setSelectedFrameId(null);
        setScopes([]);
        setScopesError(null);
        setVariables({});
        setExpandedVars(new Set());
        setExpandedScopes(new Set());
        setBpVerified(new Map());
        if (ev.error) {
          setNotice({ kind: "error", text: ev.error });
          setOutput((prev) => {
            const next = [...prev, { stream: "stderr", line: ev.error }];
            return next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next;
          });
        }
        break;
      }
      case "error":
        if (ev.message || ev.error) setNotice({ kind: "error", text: ev.message || ev.error });
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    let unsub = null;
    try {
      unsub = window.electronAPI?.onDebugEvent?.((ev) => {
        if (!ev || !ev.sessionId) return;
        if (!sessionRef.current) {
          const list = pendingEventsRef.current.get(ev.sessionId) || [];
          list.push(ev);
          pendingEventsRef.current.set(ev.sessionId, list.slice(-300));
          return;
        }
        if (ev.sessionId !== sessionRef.current) return;
        applyEvent(ev);
      });
    } catch {}
    return () => { try { unsub?.(); } catch {} };
  }, [applyEvent]);

  // ── Availability / debugpy ───────────────────────────────────────────────
  const refreshAvailability = useCallback(async (force = false) => {
    try {
      const res = await window.electronAPI?.debugAvailability?.(force ? { force: true } : undefined);
      if (res) setAvailability(res);
    } catch {}
  }, []);

  useEffect(() => { refreshAvailability(); }, [refreshAvailability]);

  const installDebugpy = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    setNotice({ kind: "info", text: "Installing debugpy…" });
    try {
      const res = await window.electronAPI?.debugInstallDebugpy?.();
      if (res?.output) {
        setOutput((prev) => {
          const lines = String(res.output).split(/\r?\n/).filter(Boolean).map((line) => ({ stream: "stdout", line }));
          const next = [...prev, ...lines];
          return next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next;
        });
      }
      if (res?.ok) {
        setNotice({ kind: "ok", text: "debugpy installed for this Python interpreter." });
        await refreshAvailability(true);
      } else {
        setNotice({ kind: "error", text: res?.error || "debugpy installation failed." });
      }
    } catch (err) {
      setNotice({ kind: "error", text: err?.message || "debugpy installation failed." });
    } finally {
      setInstalling(false);
    }
  }, [installing, refreshAvailability]);

  // ── Starting / controlling sessions ──────────────────────────────────────
  const startSession = useCallback(async (desc, opts = {}) => {
    if (!desc || startingRef.current) return;
    const lang = desc.language || languageRef.current || "node";
    const program = desc.program ? String(desc.program) : "";
    const module = desc.module ? String(desc.module) : "";
    if (!program && !module) {
      setNotice({ kind: "error", text: "Enter a file to debug, or debug one from the Test Explorer." });
      return;
    }
    startingRef.current = true;
    setStarting(true);
    setActionBusy(null);
    setNotice(null);
    setOutput([]);
    setPaused(null);
    setFrames([]);
    setSelectedFrameId(null);
    setScopes([]);
    setScopesError(null);
    setVariables({});
    setExpandedVars(new Set());
    setExpandedScopes(new Set());
    setBpVerified(new Map());
    frameEpochRef.current++;
    variableRequestsRef.current.clear();

    try {
      const old = sessionRef.current;
      if (old) {
        try { await window.electronAPI?.debugStop?.(old); } catch {}
        sessionRef.current = null;
        setSession(null);
      }
      pendingEventsRef.current.clear();

      const root = opts.root || desc.cwd || projectRoot();
      const payload = {
        language: lang,
        name: desc.name || (program ? baseName(program) : module),
        cwd: desc.cwd || root,
        rootPath: desc.rootPath || root,
        breakpoints: allBreakpoints(),
      };
      if (lang === "python") {
        if (program) payload.program = program;
        if (module) payload.module = module;
        payload.args = Array.isArray(desc.args) ? desc.args : [];
        if (desc.python) payload.python = desc.python;
        if (desc.stopOnEntry) payload.stopOnEntry = true;
      } else {
        payload.cmd = desc.cmd || "node";
        payload.program = program;
        payload.programArgs = Array.isArray(desc.programArgs) ? desc.programArgs : [];
        payload.args = Array.isArray(desc.args) ? desc.args : [];
      }

      const res = await window.electronAPI?.debugStart?.(payload);
      if (!res?.ok) {
        setNotice({
          kind: res?.needsDebugpy ? "warn" : "error",
          text: res?.error || "Could not start the debug session.",
          needsDebugpy: !!res?.needsDebugpy,
        });
        return;
      }

      sessionRef.current = res.sessionId;
      setSession({
        id: res.sessionId,
        name: res.name || payload.name || "Debug",
        language: res.language || lang,
        status: "waiting",
        pid: res.pid || null,
        command: res.command || desc.display || "",
      });
      setLanguage(lang);
      setShowConfig(false);

      const buffered = pendingEventsRef.current.get(res.sessionId) || [];
      pendingEventsRef.current.delete(res.sessionId);
      for (const ev of buffered) applyEvent(ev);

      try {
        const runRes = await window.electronAPI?.debugControl?.(res.sessionId, "run");
        if (runRes?.ok) {
          setSession((prev) => (prev && prev.id === res.sessionId &&
            (prev.status === "starting" || prev.status === "waiting")
            ? { ...prev, status: "running" }
            : prev));
        } else {
          setNotice({ kind: "error", text: runRes?.error || "Could not start the debuggee." });
        }
      } catch (err) {
        setNotice({ kind: "error", text: err?.message || "Could not start the debuggee." });
      }
    } catch (err) {
      setNotice({ kind: "error", text: err?.message || "Could not start debugging." });
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [applyEvent]);

  const startFile = useCallback((filePath) => {
    const p = String(filePath || "").trim();
    if (!p) {
      setNotice({ kind: "warn", text: "Open a file to debug." });
      setShowConfig(true);
      return;
    }
    const root = projectRoot();
    const abs = joinPath(root, p);
    const lang = languageFor(abs);
    autoTargetRef.current = abs;
    setLanguage(lang);
    setTarget(abs);
    setArgsText("");
    return startSession({
      language: lang,
      name: baseName(abs),
      cwd: root,
      rootPath: root,
      program: abs,
      args: [],
      ...(lang === "node" ? { cmd: "node", programArgs: [] } : {}),
      display: `${lang === "python" ? "python" : "node"} ${abs}`,
    }, { root });
  }, [startSession]);

  const startFromTest = useCallback(async (detail) => {
    if (!detail) return;
    const requestId = String(detail.requestId || "");
    if (requestId) {
      if (testRequestRef.current === requestId) return;
      testRequestRef.current = requestId;
    }
    const root = detail.rootPath || projectRoot();
    setNotice(null);
    try {
      const desc = await window.electronAPI?.testDebugCommand?.({
        rootPath: root,
        framework: detail.framework || undefined,
        file: detail.file || undefined,
        test: detail.test || undefined,
      });
      if (!desc?.ok) {
        setNotice({ kind: "error", text: desc?.error || "Could not prepare the test debug command." });
        setShowConfig(true);
        return;
      }
      autoTargetRef.current = null;
      if (desc.program) setTarget(desc.program);
      else if (desc.module) setTarget(desc.module);
      if (desc.language) setLanguage(desc.language);
      setArgsText(Array.isArray(desc.args) ? desc.args.join(" ") : "");
      await startSession(desc, { root });
    } catch (err) {
      setNotice({ kind: "error", text: err?.message || "Could not start debugging the test." });
    }
  }, [startSession]);

  const startCurrent = useCallback((detail) => {
    const requestId = String(detail?.requestId || "");
    if (requestId) {
      if (currentRequestRef.current === requestId) return;
      currentRequestRef.current = requestId;
    }
    const p = detail?.path || getActiveEditorPath();
    if (!p) {
      setNotice({ kind: "warn", text: "Open a file to debug." });
      setShowConfig(true);
      return;
    }
    startFile(p);
  }, [startFile]);

  const onStart = () => {
    const raw = String(target || "").trim();
    if (!raw) {
      setNotice({ kind: "error", text: "Enter a file to debug, or use “Active file”." });
      setShowConfig(true);
      return;
    }
    const root = projectRoot();
    const abs = joinPath(root, raw);
    const lang = languageRef.current;
    startSession({
      language: lang,
      name: baseName(abs),
      cwd: root,
      rootPath: root,
      program: abs,
      args: parseArgs(argsText),
      ...(lang === "node" ? { cmd: "node", programArgs: [] } : {}),
      display: `${lang === "python" ? "python" : "node"} ${abs}`,
    }, { root });
  };

  const control = useCallback(async (action) => {
    const sid = sessionRef.current;
    if (!sid) return;
    setActionBusy(action);
    try {
      const res = await window.electronAPI?.debugControl?.(sid, action);
      if (!res?.ok) {
        setNotice({ kind: "error", text: res?.error || `Could not ${action}.` });
      } else if (action === "continue" || action === "next" || action === "stepIn" || action === "stepOut") {
        setSession((prev) => (prev ? { ...prev, status: "running" } : prev));
        setPaused(null);
        setFrames([]);
        setSelectedFrameId(null);
        setScopes([]);
        setVariables({});
        setExpandedVars(new Set());
        setExpandedScopes(new Set());
      }
    } catch (err) {
      setNotice({ kind: "error", text: err?.message || `Could not ${action}.` });
    } finally {
      setActionBusy(null);
    }
  }, []);

  const stop = useCallback(async () => {
    const sid = sessionRef.current;
    if (!sid) return;
    setActionBusy("stop");
    try { await window.electronAPI?.debugStop?.(sid); } catch {}
    setSession((prev) => (prev ? { ...prev, status: "terminated" } : prev));
    setPaused(null);
    setFrames([]);
    setSelectedFrameId(null);
    setScopes([]);
    setVariables({});
    setExpandedVars(new Set());
    setExpandedScopes(new Set());
    setBpVerified(new Map());
    setActionBusy(null);
  }, []);

  // ── Breakpoint store → panel / live session ──────────────────────────────
  useEffect(() => {
    setBreakpoints(allBreakpoints());
    try {
      return subscribeBreakpoints(() => setBreakpoints(allBreakpoints()));
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const sid = sessionRef.current;
      const detail = e?.detail;
      if (!sid || !detail?.path) return;
      const state = sessionStateRef.current;
      if (!state || state.status === "terminated") return;
      window.electronAPI?.debugSetBreakpoints?.(sid, detail.path, detail.breakpoints || []).catch?.(() => {});
    };
    window.addEventListener("debug:breakpointsChanged", handler);
    return () => window.removeEventListener("debug:breakpointsChanged", handler);
  }, []);

  const toggleBpEnabled = (bp, enabled) => {
    setBreakpointEnabled(bp.path, bp.line, enabled);
  };

  const deleteBp = (bp) => {
    removeBreakpoint(bp.path, bp.line);
    if (editingBp && editingBp.path === bp.path && editingBp.line === bp.line) setEditingBp(null);
  };

  const beginCondition = (bp) => {
    setEditingBp({ path: bp.path, line: bp.line });
    setConditionDraft(bp.condition || "");
  };

  const saveCondition = () => {
    if (!editingBp) return;
    setBreakpointCondition(editingBp.path, editingBp.line, conditionDraft.trim());
    setEditingBp(null);
  };

  // ── Frame / scope / variable loading ─────────────────────────────────────
  const selectFrame = (frame) => {
    if (!frame) return;
    frameEpochRef.current++;
    variableRequestsRef.current.clear();
    setSelectedFrameId(frame.id);
    setScopes([]);
    setScopesError(null);
    setVariables({});
    setExpandedVars(new Set());
    setExpandedScopes(new Set());
    if (frame.path) openFileAt(frame.path, frame.line, frame.column);
  };

  useEffect(() => {
    if (!paused || !selectedFrameId || !sessionRef.current) {
      setScopes([]);
      return undefined;
    }
    let alive = true;
    setScopesLoading(true);
    setScopesError(null);
    window.electronAPI?.debugScopes?.(sessionRef.current, selectedFrameId)
      .then((res) => {
        if (!alive) return;
        if (res?.ok) setScopes(Array.isArray(res.scopes) ? res.scopes : []);
        else {
          setScopes([]);
          if (res?.error) setScopesError(res.error);
        }
      })
      .catch((err) => {
        if (!alive) return;
        setScopes([]);
        setScopesError(err?.message || "Could not read scopes.");
      })
      .finally(() => { if (alive) setScopesLoading(false); });
    return () => { alive = false; };
  }, [paused, selectedFrameId]);

  const loadVariables = useCallback(async (reference) => {
    if (reference === null || reference === undefined || reference === "" || reference === 0) return;
    const key = String(reference);
    if (variableRequestsRef.current.has(key)) return;
    if (variableStatesRef.current[key]?.items) return;
    const sid = sessionRef.current;
    if (!sid) return;
    const epoch = frameEpochRef.current;
    variableRequestsRef.current.add(key);
    setVariables((prev) => ({ ...prev, [key]: { loading: true, items: [] } }));
    try {
      const res = await window.electronAPI?.debugVariables?.(sid, reference);
      if (epoch !== frameEpochRef.current) return;
      setVariables((prev) => ({
        ...prev,
        [key]: res?.ok
          ? { loading: false, items: Array.isArray(res.variables) ? res.variables : [] }
          : { loading: false, items: [], error: res?.error || "Could not read variables." },
      }));
    } catch (err) {
      if (epoch !== frameEpochRef.current) return;
      setVariables((prev) => ({
        ...prev,
        [key]: { loading: false, items: [], error: err?.message || "Could not read variables." },
      }));
    } finally {
      variableRequestsRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    if (!scopes.length) return;
    const first = scopes[0];
    setExpandedScopes(new Set([first.name]));
    if (first.variablesReference) loadVariables(first.variablesReference);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopes]);

  const toggleScope = (scope) => {
    const open = expandedScopes.has(scope.name);
    setExpandedScopes((prev) => {
      const next = new Set(prev);
      if (open) next.delete(scope.name);
      else next.add(scope.name);
      return next;
    });
    if (!open && scope.variablesReference) loadVariables(scope.variablesReference);
  };

  const toggleVar = (rowKey, reference) => {
    const open = expandedVars.has(rowKey);
    setExpandedVars((prev) => {
      const next = new Set(prev);
      if (open) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
    if (!open && reference) loadVariables(reference);
  };

  // ── Watch expressions / evaluate ─────────────────────────────────────────
  const addWatch = () => {
    const expr = watchExpr.trim();
    if (!expr) return;
    setWatches((prev) => (prev.includes(expr) ? prev : [...prev, expr]));
    setWatchExpr("");
  };

  const removeWatch = (expr) => {
    setWatches((prev) => prev.filter((x) => x !== expr));
    setWatchResults((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, expr)) return prev;
      const next = { ...prev };
      delete next[expr];
      return next;
    });
  };

  const runEval = async () => {
    const expr = evalExpr.trim();
    const sid = sessionRef.current;
    if (!expr) return;
    if (!sid || !paused) {
      setEvalResult({ expr, error: "Pause at a breakpoint to evaluate expressions." });
      return;
    }
    setEvalResult({ expr, pending: true });
    try {
      const res = await window.electronAPI?.debugEvaluate?.(sid, expr, selectedFrameId || frames[0]?.id);
      if (res?.ok) setEvalResult({ expr, value: res.result, type: res.type });
      else setEvalResult({ expr, error: res?.error || "Evaluation failed." });
    } catch (err) {
      setEvalResult({ expr, error: err?.message || "Evaluation failed." });
    }
  };

  useEffect(() => {
    if (!paused || !watches.length || !sessionRef.current) {
      setWatchResults({});
      return undefined;
    }
    let alive = true;
    const sid = sessionRef.current;
    const frameId = selectedFrameId || frames[0]?.id;
    (async () => {
      const results = {};
      for (const expr of watches) {
        try {
          const res = await window.electronAPI?.debugEvaluate?.(sid, expr, frameId);
          results[expr] = res?.ok
            ? { value: res.result, type: res.type }
            : { error: res?.error || "evaluation failed" };
        } catch (err) {
          results[expr] = { error: err?.message || "evaluation failed" };
        }
      }
      if (alive) setWatchResults(results);
    })();
    return () => { alive = false; };
  }, [paused, selectedFrameId, watches]);

  // ── Output auto-scroll ───────────────────────────────────────────────────
  useEffect(() => {
    const el = outRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [output.length]);

  // ── External open requests ───────────────────────────────────────────────
  useEffect(() => {
    let pendingTest = null;
    let pendingFile = null;
    try {
      pendingTest = window.__pendingDebugTest || null;
      if (pendingTest) window.__pendingDebugTest = null;
      pendingFile = window.__pendingDebugFile || null;
      if (pendingFile) window.__pendingDebugFile = null;
    } catch {}
    if (pendingTest) startFromTest(pendingTest);
    if (pendingFile) startCurrent(typeof pendingFile === "string" ? { path: pendingFile } : pendingFile);

    const onTest = (e) => { if (e.detail) startFromTest(e.detail); };
    const onCurrent = (e) => startCurrent(e.detail || {});
    window.addEventListener("debug:startTest", onTest);
    window.addEventListener("debug:currentFile", onCurrent);
    return () => {
      window.removeEventListener("debug:startTest", onTest);
      window.removeEventListener("debug:currentFile", onCurrent);
    };
  }, [startFromTest, startCurrent]);

  // Follow the active editor only while the target field is untouched.
  useEffect(() => {
    const onActivated = (e) => {
      const p = e.detail?.path;
      if (!p) return;
      const prev = targetRef.current;
      if (prev && prev !== autoTargetRef.current) return;
      autoTargetRef.current = p;
      targetRef.current = p;
      setTarget(p);
      setLanguage(languageFor(p));
    };
    window.addEventListener("editor:fileActivated", onActivated);
    return () => window.removeEventListener("editor:fileActivated", onActivated);
  }, []);

  // ── Derived values ───────────────────────────────────────────────────────
  const activeSession = !!session && session.status !== "terminated";
  const isPaused = activeSession && session.status === "paused";
  const isRunning = activeSession && !isPaused;

  const breakpointGroups = useMemo(() => {
    const map = new Map();
    for (const bp of breakpoints) {
      const key = getBreakpointKey(bp.path);
      if (!map.has(key)) map.set(key, { path: bp.path, items: [] });
      map.get(key).items.push(bp);
    }
    return [...map.values()];
  }, [breakpoints]);

  const pythonInfo = availability?.python;
  const debugpyInstalled = availability?.debugpy?.installed === true;

  const renderVariables = (reference, depth) => {
    if (reference === null || reference === undefined || reference === "" || reference === 0) {
      return <div className="ibx-debug-empty" style={{ padding: "6px 12px", textAlign: "left" }}>No variables.</div>;
    }
    const state = variables[String(reference)] || {};
    if (state.loading) {
      return (
        <div className="ibx-debug-empty" style={{ padding: "5px 12px", textAlign: "left" }}>
          <Loader2 size={10} className="ibx-debug-spin" /> Loading…
        </div>
      );
    }
    if (state.error) {
      return <div className="ibx-debug-hint" data-kind="error" style={{ padding: "5px 12px" }}>{state.error}</div>;
    }
    if (!state.items || !state.items.length) {
      return <div className="ibx-debug-empty" style={{ padding: "5px 12px", textAlign: "left" }}>No variables.</div>;
    }
    return state.items.map((v, i) => {
      const rowKey = `${String(reference)}:${i}`;
      const expandable = !!v.variablesReference;
      const open = expandedVars.has(rowKey);
      return (
        <React.Fragment key={rowKey}>
          <div
            className="ibx-debug-var"
            data-expandable={expandable || undefined}
            style={{ paddingLeft: 10 + depth * 12 }}
            title={`${v.name}: ${v.value ?? ""}${v.type ? ` (${v.type})` : ""}`}
            onClick={() => { if (expandable) toggleVar(rowKey, v.variablesReference); }}
          >
            <span className="ibx-debug-var-caret">{expandable ? (open ? "▾" : "▸") : ""}</span>
            <span className="ibx-debug-var-name">{v.name}</span>
            <span className="ibx-debug-var-eq">=</span>
            <span className="ibx-debug-var-value" data-type={v.type || undefined}>{String(v.value ?? "")}</span>
          </div>
          {open && expandable && renderVariables(v.variablesReference, depth + 1)}
        </React.Fragment>
      );
    });
  };

  return (
    <div className="ibx-debug">
      <div className="ibx-debug-head">
        <span className="ibx-debug-title"><Bug size={14} /> Debugger</span>
        <span
          className="ibx-debug-status"
          data-state={session?.status || "idle"}
          title={session?.command || session?.id || "No active debug session"}
        >
          {session?.name ? `${session.name} · ` : ""}{statusText(session, paused)}
        </span>
        <span className="ibx-debug-spacer" />

        <button className="ibx-debug-btn" data-tone="accent" onClick={onStart} disabled={starting} title="Start or restart debugging">
          {starting ? <Loader2 size={11} className="ibx-debug-spin" />
            : activeSession ? <RotateCcw size={11} /> : <Play size={11} />}
          {activeSession ? "Restart" : "Start"}
        </button>
        <button className="ibx-debug-btn" onClick={() => control("continue")} disabled={!isPaused || !!actionBusy} title="Continue">
          {actionBusy === "continue" ? <Loader2 size={11} className="ibx-debug-spin" /> : <Play size={11} />} Continue
        </button>
        <button className="ibx-debug-btn" onClick={() => control("pause")} disabled={!isRunning || !!actionBusy} title="Pause">
          {actionBusy === "pause" ? <Loader2 size={11} className="ibx-debug-spin" /> : <Pause size={11} />}
        </button>
        <button className="ibx-debug-btn" onClick={() => control("next")} disabled={!isPaused || !!actionBusy} title="Step Over">
          <ArrowDownToLine size={11} /> Step Over
        </button>
        <button className="ibx-debug-btn" onClick={() => control("stepIn")} disabled={!isPaused || !!actionBusy} title="Step Into">
          <StepForward size={11} /> Step In
        </button>
        <button className="ibx-debug-btn" onClick={() => control("stepOut")} disabled={!isPaused || !!actionBusy} title="Step Out">
          <StepBack size={11} /> Step Out
        </button>
        <button className="ibx-debug-btn" data-tone="danger" onClick={stop} disabled={!activeSession || !!actionBusy} title="Stop debugging">
          {actionBusy === "stop" ? <Loader2 size={11} className="ibx-debug-spin" /> : <Square size={10} />} Stop
        </button>
        <button
          className="ibx-debug-btn"
          onClick={() => setShowConfig((v) => !v)}
          title={showConfig ? "Hide launch configuration" : "Show launch configuration"}
        >
          <Settings2 size={11} />
        </button>
      </div>

      {notice && (
        <div className="ibx-debug-notice" data-kind={notice.kind || "info"}>
          {notice.kind === "error" || notice.kind === "warn"
            ? <AlertTriangle size={11} />
            : notice.kind === "ok" ? <CheckCircle2 size={11} /> : <Braces size={11} />}
          <span className="ibx-debug-notice-text">{notice.text}</span>
          {notice.needsDebugpy && (
            <button className="ibx-debug-btn" onClick={installDebugpy} disabled={installing}>
              {installing ? <Loader2 size={10} className="ibx-debug-spin" /> : <Plus size={10} />} Install debugpy
            </button>
          )}
          <button className="ibx-debug-notice-x" onClick={() => setNotice(null)} title="Dismiss"><X size={11} /></button>
        </div>
      )}

      {showConfig && (
        <div className="ibx-debug-config">
          <div className="ibx-debug-config-row">
            <select
              className="ibx-debug-select"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              aria-label="Debugger language"
              disabled={starting}
            >
              <option value="node">Node.js</option>
              <option value="python">Python</option>
            </select>
            <input
              className="ibx-debug-input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={language === "python" ? "path/to/script.py or module" : "path/to/script.js"}
              aria-label="File to debug"
              spellCheck={false}
              disabled={starting}
            />
            <button
              className="ibx-debug-btn"
              onClick={() => {
                const p = getActiveEditorPath();
                if (!p) { setNotice({ kind: "warn", text: "No active editor file." }); return; }
                autoTargetRef.current = p;
                setTarget(p);
                setLanguage(languageFor(p));
              }}
              title="Use the file open in the active editor"
            >
              <FileCode2 size={11} /> Active file
            </button>
          </div>
          <div className="ibx-debug-config-row">
            <input
              className="ibx-debug-input"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="Program arguments (optional, quoted values supported)"
              aria-label="Program arguments"
              spellCheck={false}
              disabled={starting}
            />
            <button className="ibx-debug-btn" data-tone="accent" onClick={onStart} disabled={starting} title="Start debugging this target">
              {starting ? <Loader2 size={11} className="ibx-debug-spin" /> : <Play size={11} />} Start
            </button>
          </div>
          <div className="ibx-debug-hint">
            <TerminalSquare size={11} />
            <span style={{ flex: 1, minWidth: 0 }}>
              Working directory: <code>{projectRoot() || "no project open"}</code>
              {language === "node"
                ? ` · Node ${availability?.node || "runtime"}`
                : pythonInfo
                  ? ` · ${pythonInfo.version || pythonInfo.cmd} · debugpy ${debugpyInstalled ? (availability.debugpy.version || "installed") : "not installed"}`
                  : " · Python was not found on PATH"}
            </span>
            {language === "python" && pythonInfo && !debugpyInstalled && (
              <button className="ibx-debug-btn" onClick={installDebugpy} disabled={installing} title="Install debugpy for this Python interpreter">
                {installing ? <Loader2 size={10} className="ibx-debug-spin" /> : <Plus size={10} />} Install debugpy
              </button>
            )}
            <button className="ibx-debug-btn" onClick={() => refreshAvailability(true)} title="Re-check runtimes">
              <RefreshCw size={10} />
            </button>
          </div>
          <div className="ibx-debug-hint">
            <Bug size={11} />
            <span>Tip: press F9 in the editor to toggle a breakpoint. Tests can be debugged from the Test Explorer.</span>
          </div>
        </div>
      )}

      <div className="ibx-debug-body">
        <div className="ibx-debug-col ibx-debug-col--stack">
          <div className="ibx-debug-section ibx-debug-section--stack">
            <div className="ibx-debug-section-head">
              <ListIcon /> Call Stack
              <span className="ibx-debug-spacer" />
              {frames.length > 0 && <span>{frames.length}</span>}
            </div>
            <div className="ibx-debug-list">
              {frames.length === 0 && (
                <div className="ibx-debug-empty">
                  {isPaused ? "No stack frames." : "Pause at a breakpoint to inspect the call stack."}
                </div>
              )}
              {frames.map((f) => (
                <button
                  key={f.id}
                  className="ibx-debug-frame"
                  data-active={f.id === selectedFrameId || undefined}
                  onClick={() => selectFrame(f)}
                  title={f.path ? `${f.path}:${f.line}` : `Line ${f.line}`}
                >
                  <span className="ibx-debug-frame-name">{f.name}</span>
                  <span className="ibx-debug-frame-loc">
                    {f.path ? `${baseName(f.path)}:${f.line}` : `line ${f.line}`}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="ibx-debug-section ibx-debug-section--breakpoints">
            <div className="ibx-debug-section-head">
              <BreakpointsIcon /> Breakpoints
              <span className="ibx-debug-spacer" />
              <span>{breakpoints.length}</span>
            </div>
            <div className="ibx-debug-list">
              {breakpointGroups.length === 0 && (
                <div className="ibx-debug-empty">
                  No breakpoints.<br />Click the editor gutter or press F9.
                </div>
              )}
              {breakpointGroups.map((group) => (
                <div key={group.path}>
                  <div className="ibx-debug-bp-file" title={group.path}>{group.path}</div>
                  {group.items.map((bp) => {
                    const verified = bpVerified.get(`${getBreakpointKey(bp.path)}:${bp.line}`);
                    const editing = editingBp && editingBp.path === bp.path && editingBp.line === bp.line;
                    return (
                      <div key={`${group.path}:${bp.line}`}>
                        <div
                          className="ibx-debug-bp"
                          role="button"
                          tabIndex={0}
                          title={`${bp.path}:${bp.line}${bp.condition ? ` · ${bp.condition}` : ""}`}
                          onClick={() => openFileAt(bp.path, bp.line, 1)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFileAt(bp.path, bp.line, 1); }
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={bp.enabled !== false}
                            onChange={(e) => toggleBpEnabled(bp, e.target.checked)}
                            onClick={(e) => e.stopPropagation()}
                            title={bp.enabled !== false ? "Disable breakpoint" : "Enable breakpoint"}
                          />
                          <span
                            className="ibx-debug-bp-dot"
                            data-verified={verified === true ? "true" : "false"}
                            data-enabled={bp.enabled === false ? "false" : "true"}
                          />
                          <span className="ibx-debug-bp-line">
                            {baseName(bp.path)}:{bp.line}
                            {bp.condition && <span className="ibx-debug-bp-cond"> · {bp.condition}</span>}
                          </span>
                          <button
                            className="ibx-debug-bp-x"
                            onClick={(e) => { e.stopPropagation(); beginCondition(bp); }}
                            title={bp.condition ? "Edit condition" : "Add condition"}
                          >
                            <Braces size={10} />
                          </button>
                          <button
                            className="ibx-debug-bp-x"
                            onClick={(e) => { e.stopPropagation(); deleteBp(bp); }}
                            title="Remove breakpoint"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                        {editing && (
                          <div className="ibx-debug-bp-edit">
                            <input
                              autoFocus
                              value={conditionDraft}
                              onChange={(e) => setConditionDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); saveCondition(); }
                                else if (e.key === "Escape") setEditingBp(null);
                              }}
                              placeholder="Condition, e.g. i === 3"
                              aria-label="Breakpoint condition"
                              spellCheck={false}
                            />
                            <button className="ibx-debug-btn" onClick={saveCondition}>OK</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="ibx-debug-col ibx-debug-col--vars">
          <div className="ibx-debug-section ibx-debug-section--scopes">
            <div className="ibx-debug-section-head">
              <Braces size={11} /> Variables
              <span className="ibx-debug-spacer" />
              {scopesLoading && <Loader2 size={10} className="ibx-debug-spin" />}
            </div>
            <div className="ibx-debug-list">
              {!isPaused && <div className="ibx-debug-empty">Pause at a breakpoint to inspect variables.</div>}
              {isPaused && scopesLoading && !scopes.length && (
                <div className="ibx-debug-empty"><Loader2 size={13} className="ibx-debug-spin" /> Loading scopes…</div>
              )}
              {isPaused && scopesError && <div className="ibx-debug-hint" data-kind="error" style={{ padding: 10 }}>{scopesError}</div>}
              {isPaused && !scopesLoading && !scopes.length && !scopesError && (
                <div className="ibx-debug-empty">No scopes for this frame.</div>
              )}
              {scopes.map((scope) => {
                const open = expandedScopes.has(scope.name);
                return (
                  <div className="ibx-debug-scope" key={`${scope.name}:${scope.variablesReference}`}>
                    <button className="ibx-debug-scope-head" onClick={() => toggleScope(scope)}>
                      {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                      <span className="ibx-debug-scope-name">{scope.name}</span>
                    </button>
                    {open && renderVariables(scope.variablesReference, 0)}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ibx-debug-section ibx-debug-section--watch">
            <div className="ibx-debug-section-head">
              <Eye size={11} /> Watch &amp; Evaluate
              <span className="ibx-debug-spacer" />
              <span>{watches.length}</span>
            </div>
            <div className="ibx-debug-watch-input">
              <Eye size={11} style={{ color: "var(--icon)", flexShrink: 0 }} />
              <input
                value={watchExpr}
                onChange={(e) => setWatchExpr(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addWatch(); } }}
                placeholder="Watch expression — press Enter to add"
                aria-label="Watch expression"
                spellCheck={false}
              />
              <button className="ibx-debug-btn" onClick={addWatch} disabled={!watchExpr.trim()} title="Add watch expression">
                <Plus size={10} />
              </button>
            </div>
            <div className="ibx-debug-list">
              {!watches.length && (
                <div className="ibx-debug-empty" style={{ padding: "6px 10px", textAlign: "left" }}>
                  Add an expression to watch it while paused.
                </div>
              )}
              {watches.map((expr) => {
                const res = watchResults[expr];
                return (
                  <div className="ibx-debug-watch-row" key={expr} title={expr}>
                    <span className="ibx-debug-watch-expr">{expr}</span>
                    <span
                      className="ibx-debug-watch-res"
                      data-error={res?.error ? "true" : undefined}
                    >
                      {!paused ? "not paused" : res ? (res.error || String(res.value ?? "")) : "…"}
                    </span>
                    <button className="ibx-debug-bp-x" onClick={() => removeWatch(expr)} title="Remove watch">
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="ibx-debug-watch-input" style={{ borderTop: "1px solid var(--bg-active)", borderBottom: 0 }}>
              <Braces size={11} style={{ color: "var(--icon)", flexShrink: 0 }} />
              <input
                value={evalExpr}
                onChange={(e) => setEvalExpr(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runEval(); } }}
                placeholder="Evaluate expression — press Enter"
                aria-label="Evaluate expression"
                spellCheck={false}
              />
              <button className="ibx-debug-btn" onClick={runEval} disabled={!evalExpr.trim()} title="Evaluate expression">
                <Play size={10} />
              </button>
            </div>
            {evalResult && (
              <div className="ibx-debug-watch-row" title={evalResult.expr}>
                <span className="ibx-debug-watch-expr">{evalResult.expr}</span>
                <span className="ibx-debug-watch-res" data-error={evalResult.error ? "true" : undefined}>
                  {evalResult.pending ? "…" : evalResult.error || String(evalResult.value ?? "")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="ibx-debug-output">
        <div className="ibx-debug-section-head">
          <TerminalSquare size={11} /> Debug Output
          <span className="ibx-debug-spacer" />
          {output.length > 0 && <span>{output.length} lines</span>}
          <button
            className="ibx-debug-bp-x"
            style={{ opacity: 1 }}
            onClick={() => setOutput([])}
            disabled={!output.length}
            title="Clear debug output"
          >
            <Trash2 size={10} />
          </button>
        </div>
        <pre className="ibx-debug-output-body" ref={outRef}>
          {output.length
            ? output.map((o, i) => (
                <div className="ibx-debug-output-line" data-stream={o.stream} key={i}>{o.line}</div>
              ))
            : <span style={{ color: "var(--text-placeholder)" }}>Debug output appears here.</span>}
        </pre>
      </div>
    </div>
  );
};

// Tiny inline icons keep the header compact without pulling in extra glyphs.
const ListIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M3 4h10M3 8h10M3 12h10" />
  </svg>
);
const BreakpointsIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="4" fill="currentColor" />
  </svg>
);

export default DebuggerPanel;
