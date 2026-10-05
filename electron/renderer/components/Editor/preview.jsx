// Editor ke liye side preview panes — Markdown render + SQLite file inspect.
// Markdown: Notebook ka zero-dep renderMarkdown reuse (styles .nb-md-view).
// DB: main process ka node:sqlite handler (db:inspect) → tables/rows grid.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Table2, Database } from "lucide-react";
import { renderMarkdown } from "../Notebook/index.jsx";

// ── Header bar dono panes me common (close: corner toggle button se) ──
const PrevHead = ({ title, extra }) => (
  <div className="ed-prev__head">
    <span className="ed-prev__title">{title}</span>
    {extra}
  </div>
);

// ── Markdown live preview (doc har keystroke par re-render hota hai) ────────
export const MarkdownPreview = ({ doc }) => {
  const html = useMemo(() => renderMarkdown(doc), [doc]);
  return (
    <>
      <PrevHead title="Markdown Preview" />
      <div className="nb-md-view ed-prev__body" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
};

// ── Cell value formatting ──
const fmtCell = (v) => {
  if (v === null || v === undefined) return <span className="ed-null">NULL</span>;
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
    const b = v instanceof Uint8Array ? v : new Uint8Array(v);
    return <span className="ed-blob">BLOB · {b.length} B</span>;
  }
  if (typeof v === "boolean") return <span className="ed-bool">{v ? "true" : "false"}</span>;
  const s = String(v);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
};

// ── SQLite database preview: table list + data grid ───────────────────────
export const DbPreview = ({ filePath }) => {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await window.electronAPI.inspectDb?.(filePath);
      if (!res || res.error) {
        setErr(res?.error || "Database could not be read");
        setData(null);
      } else {
        setData(res);
        setActive(0);
      }
    } catch (e) {
      setErr(String(e?.message || e));
      setData(null);
    }
    setLoading(false);
  }, [filePath]);

  useEffect(() => { load(); }, [load]);

  const tables = data?.tables || [];
  const table = tables[active];
  const refreshBtn = (
    <button className="ed-prev__btn" title="Refresh" onClick={load} disabled={loading}>
      <RefreshCw size={13} className={loading ? "ed-spin" : undefined} />
    </button>
  );

  return (
    <>
      <PrevHead
        title={`Database Preview — ${filePath.split(/[\\/]/).pop()}`}
        extra={refreshBtn}
      />
      <div className="ed-prev__body ed-db">
        {err ? (
          <div className="ed-db__msg">
            <div>{err}</div>
            <button className="ed-prev__btn ed-prev__btn--wide" onClick={load}>Retry</button>
          </div>
        ) : !data ? (
          <div className="ed-db__msg">{loading ? "Reading database…" : "No data"}</div>
        ) : tables.length === 0 ? (
          <div className="ed-db__msg">No tables or views found in this database.</div>
        ) : (
          <>
            <div className="ed-db__list">
              {tables.map((t, i) => (
                <button
                  key={t.name + i}
                  className={"ed-db__item" + (i === active ? " ed-db__item--on" : "")}
                  onClick={() => setActive(i)}
                  title={`${t.type} · ${t.count ?? "?"} rows`}
                >
                  <Table2 size={13} className="ed-db__item-ico" />
                  <span className="ed-db__item-name">{t.name}</span>
                  <span className="ed-db__item-count">{t.count ?? "—"}</span>
                </button>
              ))}
            </div>
            <div className="ed-db__grid">
              <div className="ed-db__meta">
                <Database size={13} />
                <span>{table.name}</span>
                <span className="ed-db__meta-dim">
                  {table.count ?? "?"} rows · showing {table.rows.length}
                  {data.truncated ? " · (large db — partial list)" : ""}
                </span>
              </div>
              {table.columns.length === 0 ? (
                <div className="ed-db__msg">Could not read columns for “{table.name}”.</div>
              ) : (
                <div className="ed-db__scroll">
                  <table className="ed-db-tbl">
                    <thead>
                      <tr>
                        {table.columns.map((c) => (
                          <th key={c.name} title={c.type || undefined}>{c.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.length === 0 ? (
                        <tr>
                          <td className="ed-db__empty" colSpan={table.columns.length}>Empty table</td>
                        </tr>
                      ) : (
                        table.rows.map((r, ri) => (
                          <tr key={ri}>
                            {table.columns.map((c) => (
                              <td key={c.name}>{fmtCell(r[c.name])}</td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};
