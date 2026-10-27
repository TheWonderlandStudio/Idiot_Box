// TestExplorer — detect frameworks, browse test files/tests, run and debug.
import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  FlaskConical, Play, Square, RefreshCw, ChevronDown, ChevronRight,
  Search, Bug, TerminalSquare, Loader2, AlertTriangle, CheckCircle2,
  XCircle, CircleSlash, Trash2,
} from "lucide-react";
import "./tests.css";

const norm = (s) => String(s || "").trim().toLowerCase();
const baseName = (p) => String(p || "").split(/[\\/]/).pop() || p;
const splitRel = (rel) => {
  const i = String(rel || "").lastIndexOf("/");
  return i === -1 ? { name: rel, dir: "" } : { name: rel.slice(i + 1), dir: rel.slice(0, i) };
};

const StatusDot = ({ status }) => (
  <span
    className="ibx-test-dot"
    data-status={status || undefined}
    title={status ? status[0].toUpperCase() + status.slice(1) : "Not run"}
  />
);

const TestExplorer = () => {
  const [frameworks, setFrameworks] = useState([]);
  const [framework, setFramework] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [statuses, setStatuses] = useState(() => new Map());
  const [fileStatuses, setFileStatuses] = useState(() => new Map());
  const [summary, setSummary] = useState(null);
  const [notice, setNotice] = useState(null);
  const [output, setOutput] = useState([]);
  const [showOutput, setShowOutput] = useState(true);
  const [runningRunId, setRunningRunId] = useState(null);
  const [runningTarget, setRunningTarget] = useState(null);
  const [stopping, setStopping] = useState(false);

  const frameworkRef = useRef(null);
  const filesRef = useRef([]);
  const runningTargetRef = useRef(null);
  const runIdRef = useRef(null);
  const outRef = useRef(null);

  frameworkRef.current = framework;
  filesRef.current = files;

  const applyDone = useCallback((res) => {
    const target = runningTargetRef.current || {};
    const updates = new Map();
    let matched = 0;

    if (Array.isArray(res.statuses) && res.statuses.length) {
      for (const s of res.statuses) {
        const key = norm(s.name);
        for (const f of filesRef.current) {
          if (target.file && f.rel !== target.file) continue;
          for (const t of f.tests) {
            if (norm(t.name) === key || norm(t.fullName) === key) {
              updates.set(t.id, s.status);
              matched++;
            }
          }
        }
      }
    }

    const nextFileStatuses = new Map(fileStatuses);
    if (res.fileStatuses && typeof res.fileStatuses === "object") {
      for (const [rel, status] of Object.entries(res.fileStatuses)) {
        nextFileStatuses.set(rel, status);
        const file = filesRef.current.find((f) => f.rel === rel || baseName(f.rel) === baseName(rel));
        if (file && status === "passed") {
          for (const t of file.tests) { updates.set(t.id, "passed"); matched++; }
        }
      }
    }

    // Clear stale "running" markers, then apply parsed results.
    setStatuses((prev) => {
      const next = new Map();
      for (const [id, status] of prev) if (status !== "running") next.set(id, status);
      for (const [id, status] of updates) next.set(id, status);

      // Fallback for output formats that do not expose per-test names.
      if (!matched) {
        if (target.test?.id) next.set(target.test.id, res.ok ? "passed" : "failed");
        else if (target.file) {
          const file = filesRef.current.find((f) => f.rel === target.file);
          if (file) for (const t of file.tests) next.set(t.id, res.ok ? "passed" : "failed");
        } else if (target.all && res.ok) {
          for (const file of filesRef.current) for (const t of file.tests) next.set(t.id, "passed");
        }
      }
      return next;
    });
    if (nextFileStatuses.size !== fileStatuses.size) setFileStatuses(nextFileStatuses);
    else {
      let changed = false;
      for (const [k, v] of nextFileStatuses) if (fileStatuses.get(k) !== v) { changed = true; break; }
      if (changed) setFileStatuses(nextFileStatuses);
    }

    setSummary(res.summary || null);
    if (res.error) setNotice({ kind: "error", text: res.error });
    else if (res.ok) setNotice({ kind: "ok", text: `Tests finished in ${(res.durationMs / 1000).toFixed(1)}s` });
    else setNotice({ kind: "error", text: `Tests failed${res.summary?.failed ? ` · ${res.summary.failed} failing` : ""}` });
  }, [fileStatuses]);

  useEffect(() => {
    let unsub = null;
    try {
      unsub = window.electronAPI?.onTestEvent?.((payload) => {
        if (!payload || payload.runId !== runIdRef.current) return;
        if (payload.type === "output") {
          setOutput((prev) => {
            const next = [...prev, { stream: payload.stream || "stdout", line: payload.line || "" }];
            return next.length > 1800 ? next.slice(-1800) : next;
          });
        } else if (payload.type === "done") {
          applyDone(payload);
          setRunningRunId(null);
          setRunningTarget(null);
          setStopping(false);
          runningTargetRef.current = null;
        }
      });
    } catch {}
    return () => { try { unsub?.(); } catch {} };
  }, [applyDone]);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output.length]);

  const refresh = useCallback(async (fw = null) => {
    const root = window.__currentProjectPath;
    if (!root) {
      setFrameworks([]);
      setFramework(null);
      setFiles([]);
      setStatuses(new Map());
      setFileStatuses(new Map());
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const res = await window.electronAPI.testCollect({ rootPath: root, framework: fw || frameworkRef.current || undefined });
      if (!res?.ok) {
        setNotice({ kind: "error", text: res?.error || "Failed to collect tests" });
        setFiles([]);
        return;
      }
      setFrameworks(Array.isArray(res.frameworks) ? res.frameworks : []);
      setFramework(res.framework || null);
      setFiles(Array.isArray(res.files) ? res.files : []);
      setStatuses(new Map());
      setFileStatuses(new Map());
      setSummary(null);
      setOutput([]);
      if (res.message) setNotice({ kind: "error", text: res.message });
    } catch (err) {
      setNotice({ kind: "error", text: err?.message || "Failed to collect tests" });
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startRun = useCallback(async (target) => {
    if (runningRunId) return;
    const root = window.__currentProjectPath;
    if (!root) { setNotice({ kind: "error", text: "Open a project folder first." }); return; }
    if (!frameworkRef.current) { setNotice({ kind: "error", text: "No test framework detected." }); return; }
    const runId = `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    runIdRef.current = runId;
    runningTargetRef.current = target;
    setRunningRunId(runId);
    setRunningTarget(target);
    setOutput([]);
    setSummary(null);
    setNotice(null);
    setShowOutput(true);
    // Mark the target as running in the tree.
    if (target.test?.id) {
      setStatuses((prev) => new Map(prev).set(target.test.id, "running"));
    } else if (target.file) {
      setStatuses((prev) => {
        const next = new Map(prev);
        const file = filesRef.current.find((f) => f.rel === target.file);
        if (file) for (const t of file.tests) next.set(t.id, "running");
        return next;
      });
    }
    try {
      const res = await window.electronAPI.testRun({
        runId,
        rootPath: root,
        framework: frameworkRef.current,
        file: target.file || undefined,
        test: target.test || undefined,
      });
      if (!res?.ok) {
        setRunningRunId(null);
        setRunningTarget(null);
        runningTargetRef.current = null;
        setNotice({ kind: "error", text: res?.error || "Could not start tests" });
      }
    } catch (err) {
      setRunningRunId(null);
      setRunningTarget(null);
      runningTargetRef.current = null;
      setNotice({ kind: "error", text: err?.message || "Could not start tests" });
    }
  }, [runningRunId]);

  const stop = async () => {
    if (!runningRunId || stopping) return;
    setStopping(true);
    try { await window.electronAPI.testStop(runningRunId); } catch {}
  };

  const debugTarget = (file, test) => {
    const root = window.__currentProjectPath;
    if (!root) return;
    const detail = {
      requestId: `dbgtest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      rootPath: root,
      framework,
      file: file?.rel || file || null,
      test: test || null,
    };
    // The Debugger panel consumes this on mount; the event covers an already
    // open panel. Both paths dedupe on requestId.
    try { window.__pendingDebugTest = detail; } catch {}
    window.dispatchEvent(new CustomEvent("add-debug-panel"));
    setTimeout(() => {
      try {
        if (window.__pendingDebugTest?.requestId === detail.requestId) window.__pendingDebugTest = null;
      } catch {}
      try { window.dispatchEvent(new CustomEvent("debug:startTest", { detail })); } catch {}
    }, 250);
  };

  const toggleCollapsed = (rel) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  };

  const filteredFiles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files
      .map((f) => {
        const fileMatch = f.rel.toLowerCase().includes(q);
        const tests = fileMatch ? f.tests : f.tests.filter((t) => t.name.toLowerCase().includes(q) || (t.fullName || "").toLowerCase().includes(q));
        return tests.length ? { ...f, tests } : null;
      })
      .filter(Boolean);
  }, [files, filter]);

  const fileStatus = (file) => {
    if (runningTarget?.file === file.rel && !runningTarget.test) return "running";
    const vals = file.tests.map((t) => statuses.get(t.id)).filter(Boolean);
    if (vals.includes("failed")) return "failed";
    if (vals.includes("running")) return "running";
    if (vals.length && vals.every((v) => v === "passed" || v === "skipped")) return "passed";
    return fileStatuses.get(file.rel) || "";
  };

  const totalTests = files.reduce((n, f) => n + f.tests.length, 0);
  const running = !!runningRunId;

  if (!window.__currentProjectPath) {
    return <div className="ibx-tests"><div className="ibx-tests-empty">Open a project folder to discover tests.</div></div>;
  }

  return (
    <div className="ibx-tests">
      <div className="ibx-tests-head">
        <span className="ibx-tests-title"><FlaskConical size={14} /> Test Explorer</span>
        {frameworks.length > 0 && (
          <select
            className="ibx-tests-select"
            value={framework || ""}
            onChange={(e) => refresh(e.target.value)}
            aria-label="Test framework"
            disabled={running}
          >
            {frameworks.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        )}
        <span className="ibx-tests-spacer" />
        <button
          className="ibx-tests-btn"
          data-tone="accent"
          onClick={() => startRun({ all: true })}
          disabled={running || !framework || !files.length}
          title="Run every test"
        >
          {running && !runningTarget?.file ? <Loader2 size={11} className="ibx-tests-spin" /> : <Play size={11} />} Run All
        </button>
        <button className="ibx-tests-btn" data-tone="danger" onClick={stop} disabled={!running || stopping} title="Stop the running tests">
          {stopping ? <Loader2 size={11} className="ibx-tests-spin" /> : <Square size={10} />} Stop
        </button>
        <button className="ibx-tests-btn" onClick={() => refresh(framework)} disabled={running || loading} title="Rescan the project">
          {loading ? <Loader2 size={11} className="ibx-tests-spin" /> : <RefreshCw size={11} />}
        </button>
        <button className="ibx-tests-btn" onClick={() => setShowOutput((v) => !v)} title={showOutput ? "Hide output" : "Show output"}>
          <TerminalSquare size={11} />
        </button>
      </div>

      <div className="ibx-tests-filter">
        <Search size={11} style={{ color: "var(--icon)" }} />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tests…"
          aria-label="Filter tests"
          spellCheck={false}
        />
        {filter && <button className="ibx-tests-icon-btn" onClick={() => setFilter("")} title="Clear filter"><XCircle size={11} /></button>}
        <span className="ibx-tests-count" title="Collected tests">{totalTests}</span>
      </div>

      <div className="ibx-tests-tree">
        {loading && <div className="ibx-tests-empty"><Loader2 size={15} className="ibx-tests-spin" /> Scanning for tests…</div>}
        {!loading && !frameworks.length && (
          <div className="ibx-tests-empty">
            No test framework detected.<br />
            Supported: Jest, Vitest, Mocha, node:test, pytest and unittest.
          </div>
        )}
        {!loading && frameworks.length > 0 && !files.length && (
          <div className="ibx-tests-empty">
            No {framework === "pytest" || framework === "unittest" ? "Python" : "JavaScript"} test files found.<br />
            Expected names like <code>*.test.js</code>, <code>*.spec.ts</code> or <code>test_*.py</code>.
          </div>
        )}
        {!loading && files.length > 0 && filteredFiles.length === 0 && (
          <div className="ibx-tests-empty">No tests match “{filter}”.</div>
        )}
        {!loading && filteredFiles.map((file) => {
          const isCollapsed = collapsed.has(file.rel);
          const { name, dir } = splitRel(file.rel);
          const status = fileStatus(file);
          const fileRunning = runningTarget?.file === file.rel && !runningTarget.test;
          return (
            <div className="ibx-tests-file" key={file.rel}>
              <div
                className="ibx-tests-file-head"
                data-active={(runningTarget?.file === file.rel) || undefined}
                role="button"
                tabIndex={0}
                onClick={() => toggleCollapsed(file.rel)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCollapsed(file.rel); } }}
                title={file.rel}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <StatusDot status={status} />
                <span className="ibx-tests-file-name">{name}</span>
                {dir && <span className="ibx-tests-file-dir">{dir}</span>}
                <span className="ibx-tests-count">{file.tests.length}</span>
                <span className="ibx-tests-file-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="ibx-tests-icon-btn" disabled={running} title="Run this file" onClick={() => startRun({ file: file.rel })}>
                    {fileRunning ? <Loader2 size={11} className="ibx-tests-spin" /> : <Play size={11} />}
                  </button>
                  <button className="ibx-tests-icon-btn" disabled={running} title="Debug this file" onClick={() => debugTarget(file, null)}>
                    <Bug size={11} />
                  </button>
                </span>
              </div>
              {!isCollapsed && file.tests.map((test) => {
                const testStatus = statuses.get(test.id) || "";
                const active = runningTarget?.test?.id === test.id;
                return (
                  <div
                    className="ibx-tests-test-row"
                    key={test.id}
                    data-active={active || undefined}
                    title={`${test.fullName || test.name} (line ${test.line})`}
                  >
                    <StatusDot status={testStatus} />
                    <span className="ibx-tests-test-name">{test.name}</span>
                    <span className="ibx-tests-line">{test.line}</span>
                    <span className="ibx-tests-test-actions">
                      <button className="ibx-tests-icon-btn" disabled={running} title="Run this test" onClick={() => startRun({ file: file.rel, test })}>
                        {active ? <Loader2 size={10} className="ibx-tests-spin" /> : <Play size={10} />}
                      </button>
                      <button className="ibx-tests-icon-btn" disabled={running} title="Debug this test" onClick={() => debugTarget(file, test)}>
                        <Bug size={10} />
                      </button>
                    </span>
                  </div>
                );
              })}
              {!isCollapsed && !file.tests.length && (
                <div className="ibx-tests-test-row" style={{ color: "var(--text-placeholder)", cursor: "default" }}>
                  <span className="ibx-tests-test-name">No named tests found — run the file to execute it.</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {notice && (
        <div className="ibx-tests-note" data-kind={notice.kind}>
          {notice.kind === "error" ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
          {notice.text}
        </div>
      )}

      {showOutput && (
        <div className="ibx-tests-output">
          <div className="ibx-tests-output-head">
            <strong>Test Output</strong>
            {summary && (
              <>
                <span className="ibx-tests-summary-pass"><CheckCircle2 size={10} /> {summary.passed || 0} passed</span>
                <span className="ibx-tests-summary-fail"><XCircle size={10} /> {summary.failed || 0} failed</span>
                {summary.skipped > 0 && <span className="ibx-tests-summary-skip"><CircleSlash size={10} /> {summary.skipped} skipped</span>}
              </>
            )}
            {running && <span><Loader2 size={10} className="ibx-tests-spin" /> running</span>}
            <span className="ibx-tests-spacer" />
            <button className="ibx-tests-icon-btn" onClick={() => setOutput([])} title="Clear output" disabled={!output.length}>
              <Trash2 size={10} />
            </button>
          </div>
          <pre className="ibx-tests-output-body" ref={outRef}>
            {output.length
              ? output.map((o, i) => (
                  <div className="ibx-tests-output-line" data-stream={o.stream} key={i}>{o.line}</div>
                ))
              : <span style={{ color: "var(--text-placeholder)" }}>Run tests to see output here.</span>}
          </pre>
        </div>
      )}
    </div>
  );
};

export default TestExplorer;
