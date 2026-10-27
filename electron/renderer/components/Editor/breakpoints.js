// Breakpoint store shared by the editor gutter, Debugger panel and palette.
//
// Persisted in localStorage so breakpoints survive restarts. Paths are stored
// once with their original casing and indexed case-insensitively on Windows.
const STORAGE_KEY = "ibx.breakpoints.v1";

const isWindows = () => {
  try { return /windows|win32/i.test(navigator.platform || navigator.userAgent || ""); } catch { return false; }
};

const toSlashes = (p) => String(p || "").replace(/\\/g, "/");
const keyOf = (p) => {
  const s = toSlashes(p).replace(/\/+$/, "");
  return isWindows() ? s.toLowerCase() : s;
};

// files: { [key]: { path, breakpoints: [{ line, enabled, condition }] } }
let files = {};

const normalizeList = (list) => {
  const out = [];
  const seen = new Set();
  for (const bp of Array.isArray(list) ? list : []) {
    const line = Math.trunc(Number(bp?.line));
    if (!Number.isFinite(line) || line < 1 || seen.has(line)) continue;
    seen.add(line);
    out.push({
      line,
      enabled: bp?.enabled !== false,
      ...(bp?.condition ? { condition: String(bp.condition) } : {}),
    });
  }
  out.sort((a, b) => a.line - b.line);
  return out;
};

const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw || typeof raw !== "object" || !raw.files || typeof raw.files !== "object") return {};
    const clean = {};
    for (const [key, entry] of Object.entries(raw.files)) {
      if (!entry || typeof entry.path !== "string" || !Array.isArray(entry.breakpoints)) continue;
      const list = normalizeList(entry.breakpoints);
      if (list.length) clean[key] = { path: entry.path, breakpoints: list };
    }
    return clean;
  } catch {
    return {};
  }
};

files = load();

const listeners = new Set();

const persist = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, files })); } catch {}
};

const notify = (filePath) => {
  const list = getBreakpoints(filePath);
  for (const fn of [...listeners]) {
    try { fn(filePath, list); } catch {}
  }
  try {
    window.dispatchEvent(new CustomEvent("debug:breakpointsChanged", {
      detail: { path: filePath, breakpoints: list },
    }));
  } catch {}
};

export const getBreakpointKey = keyOf;

export const getBreakpoints = (filePath) => {
  if (!filePath) return [];
  const entry = files[keyOf(filePath)];
  return entry ? entry.breakpoints.map((bp) => ({ ...bp })) : [];
};

export const hasBreakpoint = (filePath, line) =>
  getBreakpoints(filePath).some((bp) => bp.line === Number(line));

export const getBreakpointAt = (filePath, line) =>
  getBreakpoints(filePath).find((bp) => bp.line === Number(line)) || null;

export const setBreakpoints = (filePath, list) => {
  if (!filePath) return [];
  const key = keyOf(filePath);
  const clean = normalizeList(list);
  if (clean.length) files[key] = { path: String(filePath), breakpoints: clean };
  else delete files[key];
  persist();
  notify(filePath);
  return clean;
};

export const addBreakpoint = (filePath, line, options = {}) => {
  const list = getBreakpoints(filePath);
  if (list.some((bp) => bp.line === Number(line))) return list;
  list.push({ line: Number(line), enabled: options.enabled !== false, ...(options.condition ? { condition: String(options.condition) } : {}) });
  return setBreakpoints(filePath, list);
};

export const removeBreakpoint = (filePath, line) => {
  const list = getBreakpoints(filePath).filter((bp) => bp.line !== Number(line));
  return setBreakpoints(filePath, list);
};

/** Returns true when a breakpoint was added, false when one was removed. */
export const toggleBreakpoint = (filePath, line, options = {}) => {
  if (!filePath) return false;
  const list = getBreakpoints(filePath);
  const exists = list.some((bp) => bp.line === Number(line));
  if (exists) {
    setBreakpoints(filePath, list.filter((bp) => bp.line !== Number(line)));
    return false;
  }
  list.push({ line: Number(line), enabled: true, ...(options.condition ? { condition: String(options.condition) } : {}) });
  setBreakpoints(filePath, list);
  return true;
};

export const setBreakpointEnabled = (filePath, line, enabled) => {
  const list = getBreakpoints(filePath).map((bp) =>
    bp.line === Number(line) ? { ...bp, enabled: !!enabled } : bp
  );
  return setBreakpoints(filePath, list);
};

export const setBreakpointCondition = (filePath, line, condition) => {
  const list = getBreakpoints(filePath).map((bp) =>
    bp.line === Number(line) ? { ...bp, condition: String(condition || "") } : bp
  );
  return setBreakpoints(filePath, list);
};

export const clearBreakpoints = (filePath) => setBreakpoints(filePath, []);

export const allBreakpoints = () => {
  const out = [];
  for (const entry of Object.values(files)) {
    for (const bp of entry.breakpoints) {
      out.push({ path: entry.path, line: bp.line, enabled: bp.enabled !== false, condition: bp.condition || "" });
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return out;
};

export const breakpointFileCount = () => Object.keys(files).length;

export const subscribeBreakpoints = (fn) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};
