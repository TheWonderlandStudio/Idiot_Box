// cm/bridge.js — Monaco-compat shim over a CodeMirror EditorView.
//
// Editor <-> CodeMirror bridge (SearchPanel, diagnostics, cursor sync).
// (editor:revealLine) and Notebook (focus) speak a Monaco-style API:
//   getValue() / getModel() -> { getValue(), getValueInRange(range),
//     getLineCount() } / getSelection() -> { startLineNumber, startColumn,
//     endLineNumber, endColumn, isEmpty() } / getPosition() /
//     executeEdits(source, [{ range, text }]) / focus() /
//     revealLineInCenter(line) / setPosition({ lineNumber, column })
//
// This shim provides that same shape over a CodeMirror view — no consumer changes needed.

// CodeMirror offset -> { lineNumber, column } (1-based, like Monaco)
export const offsetToPos = (doc, offset) => {
  try {
    const o = Math.min(Math.max(0, offset || 0), doc.length);
    const line = doc.lineAt(o);
    return { lineNumber: line.number, column: o - line.from + 1 };
  } catch {
    return { lineNumber: 1, column: 1 };
  }
};

// { lineNumber, column } -> offset (clamped)
export const posToOffset = (doc, lineNumber, column) => {
  try {
    const ln = Math.min(Math.max(1, lineNumber || 1), doc.lines);
    const line = doc.line(ln);
    const col = Math.min(Math.max(1, column || 1), line.length + 1);
    return line.from + col - 1;
  } catch {
    return 0;
  }
};

const monacoRangeToOffsets = (doc, range) => {
  const from = posToOffset(doc, range?.startLineNumber, range?.startColumn);
  const to = posToOffset(doc, range?.endLineNumber ?? range?.startLineNumber, range?.endColumn ?? range?.startColumn);
  return { from: Math.min(from, to), to: Math.max(from, to) };
};

export const createCmBridge = (getView) => {
  const viewOf = () => {
    try { return getView?.() || null; } catch { return null; }
  };

  const getValue = () => {
    try { return viewOf()?.state.doc.toString() ?? ""; } catch { return ""; }
  };

  const model = {
    getValue,
    setValue: (text) => {
      const view = viewOf();
      if (!view) return;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: String(text ?? "") },
        });
      } catch {}
    },
    getLineCount: () => {
      try { return viewOf()?.state.doc.lines ?? 1; } catch { return 1; }
    },
    getValueInRange: (range) => {
      const view = viewOf();
      if (!view) return "";
      try {
        const { from, to } = monacoRangeToOffsets(view.state.doc, range);
        return view.state.doc.sliceString(from, to);
      } catch { return ""; }
    },
  };

  return {
    getValue,
    getModel: () => model,
    getSelection: () => {
      const view = viewOf();
      if (!view) return null;
      try {
        const sel = view.state.selection.main;
        const a = offsetToPos(view.state.doc, sel.from);
        const b = offsetToPos(view.state.doc, sel.to);
        // Preserve anchor/head order (Monaco keeps start<=end).
        const empty = sel.from === sel.to;
        const fwd = sel.anchor <= sel.head;
        const start = fwd ? a : b;
        const end = fwd ? b : a;
        return {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
          isEmpty: () => empty,
        };
      } catch { return null; }
    },
    getPosition: () => {
      const view = viewOf();
      if (!view) return null;
      try { return offsetToPos(view.state.doc, view.state.selection.main.head); }
      catch { return null; }
    },
    setPosition: (pos) => {
      const view = viewOf();
      if (!view || !pos) return;
      try {
        const off = posToOffset(view.state.doc, pos.lineNumber, pos.column);
        view.dispatch({ selection: { anchor: off, head: off }, scrollIntoView: true });
      } catch {}
    },
    revealLineInCenter: (line) => {
      const view = viewOf();
      if (!view) return;
      try {
        const ln = Math.min(Math.max(1, line || 1), view.state.doc.lines);
        const off = view.state.doc.line(ln).from;
        view.dispatch({ effects: [] });
        // Center: no scrollDOM math — go to the line first, then center.
        try {
          view.dispatch({ selection: { anchor: off }, scrollIntoView: true });
          const lineBlock = view.lineBlockAt(off);
          const scroller = view.scrollDOM;
          scroller.scrollTop = Math.max(0, lineBlock.top - scroller.clientHeight / 2);
        } catch {}
      } catch {}
    },
    executeEdits: (_source, edits) => {
      const view = viewOf();
      if (!view || !Array.isArray(edits)) return;
      try {
        const changes = [];
        let selOff = null;
        for (const e of edits) {
          if (!e) continue;
          const { from, to } = monacoRangeToOffsets(view.state.doc, e.range);
          changes.push({ from, to, insert: String(e.text ?? "") });
          selOff = from + String(e.text ?? "").length;
        }
        if (!changes.length) return;
        view.dispatch({ changes, selection: selOff != null ? { anchor: selOff } : undefined, scrollIntoView: true });
        try { view.focus(); } catch {}
      } catch {}
    },
    focus: () => { try { viewOf()?.focus(); } catch {} },
  };
};
