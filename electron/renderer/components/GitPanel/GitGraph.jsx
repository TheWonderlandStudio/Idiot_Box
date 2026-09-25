// GitGraph — commit history as a branch graph (lanes + SVG rail).
// Lane assignment: newest-first rows; each row's hash arrives on a lane
// placed by its child (or opens a new lane at branch tips). First parent
// continues the lane, extra parents fork/merge with curved edges.
// Props: commits (filtered log, each with fullHash + parents "h1 h2"),
// onSelect(commit) (opens the existing diff modal), selectedHash?
import React, { useMemo } from "react";

const LANE_W = 14;
const PAD_X = 12;
const ROW_H = 34;
const NODE_R = 4;

const PALETTE = [
  "#4ec9b0", "#569cd6", "#dcdcaa", "#c586c0",
  "#9cdcfe", "#6a9955", "#ce9178", "#b180d7",
];

const laneColor = (lane) => PALETTE[((lane % PALETTE.length) + PALETTE.length) % PALETTE.length];

function layoutGraph(commits) {
  const shown = new Set((commits || []).map((c) => c.fullHash));
  const lanes = []; // hash occupying each lane (post-update state)
  const rows = [];
  let maxLanes = 1;
  (commits || []).forEach((c) => {
    const hash = c.fullHash;
    let col = lanes.indexOf(hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) {
        lanes.push(null);
        col = lanes.length - 1;
      }
    } else {
      // same hash stranded on other lanes → free duplicates
      lanes.forEach((h, idx) => {
        if (idx !== col && h === hash) lanes[idx] = null;
      });
    }
    const pre = [...lanes];
    const parents = String(c.parents || "").split(" ").map((s) => s.trim()).filter(Boolean);
    const edges = [];
    const p0 = parents[0] || null;
    if (p0 && shown.has(p0)) {
      lanes[col] = p0;
      // p0 duplicated elsewhere → single lane is enough
      lanes.forEach((h, idx) => {
        if (idx !== col && h === p0) lanes[idx] = null;
      });
      edges.push({ from: col, to: col });
    } else {
      lanes[col] = null;
    }
    for (let k = 1; k < parents.length; k++) {
      const p = parents[k];
      if (!shown.has(p)) continue;
      const ex = lanes.indexOf(p);
      if (ex !== -1) {
        edges.push({ from: col, to: ex, merge: true });
      } else {
        let s = lanes.indexOf(null);
        if (s === -1) {
          lanes.push(null);
          s = lanes.length - 1;
        }
        lanes[s] = p;
        edges.push({ from: col, to: s, branch: true });
      }
    }
    const post = [...lanes];
    if (lanes.length > maxLanes) maxLanes = lanes.length;
    rows.push({ commit: c, col, pre, post, edges });
  });
  return { rows, maxLanes };
}

export default function GitGraph({ commits, onSelect, selectedHash }) {
  const { rows, maxLanes } = useMemo(() => layoutGraph(commits || []), [commits]);
  const width = PAD_X * 2 + Math.max(maxLanes - 1, 0) * LANE_W;
  const height = rows.length * ROW_H;
  const x = (lane) => PAD_X + lane * LANE_W;
  const y = (i) => i * ROW_H + ROW_H / 2;

  const edgePath = (from, to, i) => {
    const fx = x(from);
    const fy = y(i);
    const tx = x(to);
    const ty = y(i + 1);
    if (from === to) return `M ${fx} ${fy} L ${tx} ${ty}`;
    const my = (fy + ty) / 2;
    return `M ${fx} ${fy} C ${fx} ${my}, ${tx} ${my}, ${tx} ${ty}`;
  };

  if (!rows.length) return null;

  return (
    <div style={{ display: "flex", alignItems: "stretch" }}>
      {/* rail */}
      <svg
        width={width}
        height={height}
        style={{ flexShrink: 0, display: "block" }}
        aria-hidden="true"
      >
        {rows.map((r, i) => {
          const els = [];
          // pass-through lanes (untouched by this row)
          for (let L = 0; L < maxLanes; L++) {
            const h = r.pre[L];
            if (h != null && r.post[L] === h && i + 1 < rows.length) {
              els.push(
                <line
                  key={`p${i}-${L}`}
                  x1={x(L)} y1={y(i)} x2={x(L)} y2={y(i + 1)}
                  stroke={laneColor(L)} strokeWidth={2}
                />
              );
            }
          }
          // edges out of this node
          r.edges.forEach((e, k) => {
            els.push(
              <path
                key={`e${i}-${k}`}
                d={edgePath(e.from, e.to, i)}
                fill="none"
                stroke={laneColor(e.from)} strokeWidth={2}
              />
            );
          });
          // node
          const isHead = /\bHEAD\b/.test(r.commit.refs || "");
          els.push(
            <circle
              key={`n${i}`}
              cx={x(r.col)} cy={y(i)} r={NODE_R}
              fill={laneColor(r.col)}
              stroke={isHead ? "#ffffff" : "none"}
              strokeWidth={isHead ? 1.5 : 0}
            />
          );
          return <g key={`r${i}`}>{els}</g>;
        })}
      </svg>
      {/* compact rows (fixed height = rail alignment) */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {rows.map((r, i) => {
          const c = r.commit;
          const sel = selectedHash && c.fullHash === selectedHash;
          return (
            <div
              key={c.fullHash}
              onClick={() => { try { onSelect && onSelect(c); } catch {} }}
              title={`${c.fullHash}\n${c.author} <${c.email}>\n${c.refs || ""}`}
              style={{
                height: ROW_H,
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "0 8px 0 4px",
                borderBottom: "1px solid var(--border-row)",
                fontSize: "var(--fs-small)",
                background: sel ? "var(--bg-hover-strong)" : "var(--bg-deep)",
                cursor: "pointer",
                minWidth: 0,
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  try {
                    const h = c.fullHash;
                    if (window.electronAPI?.clipboardWrite) window.electronAPI.clipboardWrite(h);
                    else navigator.clipboard.writeText(h);
                  } catch {}
                }}
                title="Copy full hash"
                style={{
                  color: "var(--code-blue)", fontFamily: "var(--font-code)", fontSize: "var(--fs-tiny)",
                  background: "var(--bg-vscode)", padding: "var(--space-2) var(--space-5)",
                  borderRadius: "var(--radius-sm)", border: "var(--space-1) solid var(--bg-active)",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                {c.hash}
              </button>
              <span
                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-input)", fontWeight: "var(--fw-semibold)" }}
                title={c.msg}
              >
                {c.msg}
              </span>
              {c.refs ? (
                <span style={{ fontSize: "var(--fs-tiny)", color: "var(--git-modified)", background: "var(--bg-active)", padding: "var(--space-1) var(--space-5)", borderRadius: "var(--radius-sm)", flexShrink: 0, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.refs}>
                  {c.refs}
                </span>
              ) : null}
              <span style={{ fontSize: "var(--fs-tiny)", color: "var(--icon)", flexShrink: 0 }}>
                {c.relTime}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
