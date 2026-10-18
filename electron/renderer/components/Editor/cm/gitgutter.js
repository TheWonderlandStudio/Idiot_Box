// cm/gitgutter.js — git-change decorations on the editor lines.
//
// The diff is fetched outside (Editor/index.jsx via window.electronAPI.gitDiff)
// and pushed in as a plain descriptor through a StateEffect:
//   { added:Set<line>, modified:Set<line>, deleted:Set<line> }
// Lines are 1-based new-file line numbers.

import { StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export const setGitChanges = StateEffect.define();

const addedLine = Decoration.line({ class: "ibx-git-added" });
const modLine = Decoration.line({ class: "ibx-git-modified" });
const delLine = Decoration.line({ class: "ibx-git-deleted" });

const buildDeco = (state, desc) => {
  if (!desc) return Decoration.none;
  const doc = state.doc;
  const entries = [];
  const collect = (set, deco) => {
    if (!set) return;
    for (const ln of set) {
      if (ln < 1 || ln > doc.lines) continue;
      entries.push({ pos: doc.line(ln).from, deco });
    }
  };
  collect(desc.added, addedLine);
  collect(desc.modified, modLine);
  collect(desc.deleted, delLine);
  entries.sort((a, b) => a.pos - b.pos);
  const builder = new RangeSetBuilder();
  for (const e of entries) builder.add(e.pos, e.pos, e.deco);
  return builder.finish();
};

const gitField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setGitChanges)) deco = buildDeco(tr.state, e.value);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const gitGutterExtension = () => gitField;

export const applyGitChanges = (view, desc) => {
  try { view.dispatch({ effects: setGitChanges.of(desc) }); } catch {}
};

// ── Unified-diff parser ────────────────────────────────────────────────────
// Returns { added, modified, deleted } as Sets of new-file line numbers.
export const parseUnifiedDiff = (patch) => {
  const added = new Set();
  const modified = new Set();
  const deleted = new Set();
  if (!patch || typeof patch !== "string") return { added, modified, deleted };
  const lines = patch.split("\n");
  let newLine = 0;
  let hunkAdds = [];
  let hunkDels = [];
  let hasRemoval = false;
  let hasAddition = false;

  const flush = () => {
    if (hasRemoval && hasAddition) {
      // Removals + additions in one hunk → treat as modified.
      for (const ln of hunkAdds) { added.delete(ln); modified.add(ln); }
      for (const ln of hunkDels) deleted.add(ln);
    } else if (hasAddition) {
      for (const ln of hunkAdds) added.add(ln);
    } else if (hasRemoval) {
      for (const ln of hunkDels) deleted.add(ln);
    }
    hunkAdds = []; hunkDels = [];
    hasRemoval = false; hasAddition = false;
  };

  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      flush();
      const m = /\+(\d+)(?:,\d+)?/.exec(raw);
      newLine = m ? parseInt(m[1], 10) : 1;
      continue;
    }
    if (raw.startsWith("---") || raw.startsWith("+++") || raw.startsWith("diff ") ||
        raw.startsWith("index ") || raw.startsWith("new file") || raw.startsWith("deleted file") ||
        raw.startsWith("old mode") || raw.startsWith("new mode") || raw.startsWith("similarity") ||
        raw.startsWith("rename ") || raw.startsWith("\\")) {
      continue;
    }
    const tag = raw[0];
    if (tag === "+") { hunkAdds.push(newLine); hasAddition = true; newLine++; }
    else if (tag === "-") { hunkDels.push(newLine); hasRemoval = true; }
    else if (tag === " " || raw === "") { newLine++; }
  }
  flush();
  return { added, modified, deleted };
};
