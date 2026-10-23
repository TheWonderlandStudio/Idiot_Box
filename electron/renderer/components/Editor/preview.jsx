// Side preview panes for the editor — Markdown render, MDX preview + SQLite file inspect.
// Markdown: reuses Notebook's zero-dep renderMarkdown (styles .nb-md-view).
// MDX: Frontmatter + JSX components + GFM tables/code preview.
// DB: main-process node:sqlite handler (db:inspect) → tables/rows grid.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw, Table2, Database, Eye, Code, Copy, Check,
  ChevronDown, ChevronRight, FileText, Sparkles, Layers,
  ExternalLink, Info, AlertTriangle, BookOpen
} from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { renderMarkdown } from "../Notebook/index.jsx";
import {
  detectDelimiter, parseDelimited, delimiterLabel,
  CSV_MAX_ROWS, CSV_MAX_COLS,
} from "./csv.js";

// Configure marked defaults once
marked.setOptions({ gfm: true, breaks: false });

// ── Header bar shared by both panes (close via the corner toggle button) ──
const PrevHead = ({ title, extra }) => (
  <div className="ed-prev__head">
    <span className="ed-prev__title">{title}</span>
    {extra}
  </div>
);

// ── Markdown live preview (the doc re-renders on every keystroke) ────────
export const MarkdownPreview = ({ doc }) => {
  const html = useMemo(() => renderMarkdown(doc), [doc]);
  return (
    <>
      <PrevHead title="Markdown Preview" />
      <div className="nb-md-view ed-prev__body" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
};

// ── CSV / TSV preview ───────────────────────────────────────────────────────
export const CsvPreview = ({ doc, filePath }) => {
  const [header, setHeader] = useState(true);
  const [filter, setFilter] = useState("");

  const isTsv = /\.tsv$/i.test(filePath || "");
  const fileName = (filePath ? filePath.split(/[\\/]/).pop() : "data.csv") || "data.csv";

  const parsed = useMemo(() => {
    const text = String(doc || "");
    if (!text.trim()) return { rows: [], truncated: false, delimiter: isTsv ? "\t" : "," };
    const delimiter = isTsv ? "\t" : detectDelimiter(text);
    return { ...parseDelimited(text, delimiter, CSV_MAX_ROWS), delimiter };
  }, [doc, isTsv]);

  const headerRow = header && parsed.rows.length ? parsed.rows[0] : null;
  const dataRows = header ? parsed.rows.slice(1) : parsed.rows;
  let columnCount = headerRow ? headerRow.length : 0;
  for (const r of dataRows) columnCount = Math.max(columnCount, r.length);
  const visibleCols = Math.min(columnCount, CSV_MAX_COLS);
  const columns = Array.from({ length: visibleCols }, (_, i) => {
    const label = headerRow?.[i]?.trim();
    return label || `Col ${i + 1}`;
  });

  const query = filter.trim().toLowerCase();
  const visibleRows = [];
  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i];
    if (!query || cells.some((c) => c.toLowerCase().includes(query))) {
      visibleRows.push({ cells, index: i });
    }
  }

  const rowLabel = dataRows.length === 1 ? "row" : "rows";
  const colLabel = columnCount === 1 ? "col" : "cols";
  const dims = `${dataRows.length} ${rowLabel} × ${columnCount} ${colLabel}`;

  return (
    <>
      <PrevHead
        title={`CSV Preview — ${fileName}`}
        extra={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
            <span className="ed-csv__meta">{dims}</span>
            <span className="ed-csv__badge">{delimiterLabel(parsed.delimiter)}</span>
          </div>
        }
      />
      <div className="ed-prev__body ed-csv">
        {!parsed.rows.length ? (
          <div className="ed-csv__msg">Empty file — add some comma-separated data to see a preview.</div>
        ) : (
          <>
            <div className="ed-csv__toolbar">
              <input
                className="ed-csv__filter"
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter rows…"
                spellCheck={false}
              />
              <label className="ed-csv__check">
                <input
                  type="checkbox"
                  checked={header}
                  onChange={(e) => setHeader(e.target.checked)}
                />
                First row is header
              </label>
              {query && (
                <span className="ed-csv__note">
                  {visibleRows.length} match{visibleRows.length === 1 ? "" : "es"}
                </span>
              )}
              {parsed.truncated && (
                <span className="ed-csv__note" title={`Only the first ${CSV_MAX_ROWS} rows are rendered`}>
                  First {CSV_MAX_ROWS} rows
                </span>
              )}
              {columnCount > CSV_MAX_COLS && (
                <span className="ed-csv__note" title={`Only the first ${CSV_MAX_COLS} of ${columnCount} columns are rendered`}>
                  {CSV_MAX_COLS} of {columnCount} cols
                </span>
              )}
            </div>
            <div className="ed-csv__scroll">
              <table className="ed-csv-tbl">
                <thead>
                  <tr>
                    <th className="ed-csv__rownum">#</th>
                    {columns.map((name, i) => (
                      <th key={i} title={name}>{name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td className="ed-csv__empty" colSpan={visibleCols + 1}>No rows match the filter.</td>
                    </tr>
                  ) : visibleRows.map(({ cells, index }) => (
                    <tr key={index}>
                      <td className="ed-csv__rownum">{header ? index + 2 : index + 1}</td>
                      {Array.from({ length: visibleCols }, (_, ci) => {
                        const raw = cells[ci] ?? "";
                        const oneLine = raw.replace(/\r?\n/g, " ↵ ");
                        const display = oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
                        return (
                          <td key={ci} title={raw.length > 200 ? raw : undefined}>
                            {display || "\u00A0"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
};

// ── MDX Utilities ───────────────────────────────────────────────────────────
const escapeHtml = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeAttr = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const parseFrontmatter = (raw) => {
  const match = String(raw || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { meta: null, content: raw || "" };
  const yamlBlock = match[1];
  const content = (raw || "").slice(match[0].length);
  const meta = {};
  yamlBlock.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const m = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (m) {
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      } else if (val.startsWith("[") && val.endsWith("]")) {
        val = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } else if (val === "true") val = true;
      else if (val === "false") val = false;
      else if (!isNaN(Number(val)) && val !== "") val = Number(val);
      meta[key] = val;
    }
  });
  return { meta: Object.keys(meta).length > 0 ? meta : null, content };
};

const extractImportsExports = (raw) => {
  const imports = [];
  const exports = [];
  const lines = String(raw || "").split(/\r?\n/);
  const remaining = [];
  let inCodeFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      remaining.push(line);
      continue;
    }
    if (!inCodeFence && /^\s*import\s+/.test(line)) {
      imports.push(line.trim());
    } else if (!inCodeFence && /^\s*export\s+/.test(line)) {
      exports.push(line.trim());
    } else {
      remaining.push(line);
    }
  }
  return { content: remaining.join("\n"), imports, exports };
};

const renderInnerMd = (mdText) => {
  try {
    return marked.parse(String(mdText || "").trim(), { async: false, gfm: true, breaks: false });
  } catch {
    return escapeHtml(mdText);
  }
};

const transformMdxJsx = (src) => {
  let text = String(src || "");
  let hasComp = false;

  // Callouts: <Callout type="..." title="...">body</Callout>
  text = text.replace(/<Callout(?:\s+type=["']([^"']*)["'])?(?:\s+title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/Callout>/gi, (_, type = "info", title, body) => {
    hasComp = true;
    const t = (type || "info").toLowerCase();
    const heading = title || (t.charAt(0).toUpperCase() + t.slice(1));
    return `\n<div class="mdx-callout mdx-callout--${escapeAttr(t)}"><div class="mdx-callout__head"><span class="mdx-callout__badge">${escapeHtml(heading)}</span></div><div class="mdx-callout__body">${renderInnerMd(body)}</div></div>\n`;
  });

  // Built-in Callout variations: <Note>, <Tip>, <Warning>, <Caution>, <Important>, <Info>
  const alertTags = ["Note", "Tip", "Warning", "Caution", "Important", "Info"];
  alertTags.forEach((tag) => {
    const reg = new RegExp(`<${tag}(?:\\s+title=["']([^"']*)["'])?[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    text = text.replace(reg, (_, title, body) => {
      hasComp = true;
      const t = tag.toLowerCase();
      const heading = title || tag;
      return `\n<div class="mdx-callout mdx-callout--${escapeAttr(t)}"><div class="mdx-callout__head"><span class="mdx-callout__badge">${escapeHtml(heading)}</span></div><div class="mdx-callout__body">${renderInnerMd(body)}</div></div>\n`;
    });
  });

  // Cards: <Card title="..." href="..." icon="...">body</Card>
  text = text.replace(/<Card(?:\s+title=["']([^"']*)["'])?(?:\s+href=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/Card>/gi, (_, title = "Card", href, body) => {
    hasComp = true;
    const linkStart = href ? `<a href="${escapeAttr(href)}" class="mdx-card__link" target="_blank" rel="noreferrer noopener">` : "";
    const linkEnd = href ? `</a>` : "";
    return `\n<div class="mdx-card">${linkStart}<div class="mdx-card__title">${escapeHtml(title)}</div><div class="mdx-card__body">${renderInnerMd(body)}</div>${linkEnd}</div>\n`;
  });

  // Cards container: <Cards>...</Cards> or <CardGroup>...</CardGroup>
  text = text.replace(/<(?:Cards|CardGroup)[^>]*>([\s\S]*?)<\/(?:Cards|CardGroup)>/gi, (_, body) => {
    hasComp = true;
    return `\n<div class="mdx-cards">\n${body}\n</div>\n`;
  });

  // Steps: <Steps>...</Steps>
  text = text.replace(/<Steps[^>]*>([\s\S]*?)<\/Steps>/gi, (_, body) => {
    hasComp = true;
    return `\n<div class="mdx-steps">\n${body}\n</div>\n`;
  });

  // Step: <Step title="...">body</Step>
  text = text.replace(/<Step(?:\s+title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/Step>/gi, (_, title = "Step", body) => {
    hasComp = true;
    return `\n<div class="mdx-step"><div class="mdx-step__head"><span class="mdx-step__title">${escapeHtml(title)}</span></div><div class="mdx-step__body">${renderInnerMd(body)}</div></div>\n`;
  });

  // Accordion / Details: <Accordion title="...">body</Accordion>
  text = text.replace(/<Accordion(?:\s+title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/Accordion>/gi, (_, title = "Details", body) => {
    hasComp = true;
    return `\n<details class="mdx-accordion"><summary class="mdx-accordion__summary">${escapeHtml(title)}</summary><div class="mdx-accordion__body">${renderInnerMd(body)}</div></details>\n`;
  });

  // Badges: <Badge variant="...">text</Badge> or <Badge text="..." />
  text = text.replace(/<Badge(?:\s+variant=["']([^"']*)["'])?(?:\s+text=["']([^"']*)["'])?[^>]*>(.*?)<\/Badge>/gi, (_, variant = "default", textProp, inner) => {
    hasComp = true;
    const val = (inner || textProp || "").trim();
    return `<span class="mdx-badge mdx-badge--${escapeAttr(variant.toLowerCase())}">${escapeHtml(val)}</span>`;
  });
  text = text.replace(/<Badge(?:\s+variant=["']([^"']*)["'])?\s+text=["']([^"']*)["'][^>]*\/>/gi, (_, variant = "default", textProp) => {
    hasComp = true;
    return `<span class="mdx-badge mdx-badge--${escapeAttr(variant.toLowerCase())}">${escapeHtml(textProp)}</span>`;
  });

  // Generic custom block tags (PascalCase): <Tabs>, <Widget>, etc.
  text = text.replace(/<([A-Z][a-zA-Z0-9_.-]*)([^>]*)>([\s\S]*?)<\/\1>/g, (_, tagName, attrs, body) => {
    hasComp = true;
    return `\n<div class="mdx-custom-block" data-component="${escapeAttr(tagName)}"><div class="mdx-custom-block__badge">&lt;${escapeHtml(tagName)}&gt;</div><div class="mdx-custom-block__body">${renderInnerMd(body)}</div></div>\n`;
  });

  // Self-closing custom tags (PascalCase): <Widget prop="123" />
  text = text.replace(/<([A-Z][a-zA-Z0-9_.-]*)([^>]*?)\/>/g, (_, tagName) => {
    hasComp = true;
    return `<span class="mdx-custom-chip" title="Custom MDX component">&lt;${escapeHtml(tagName)} /&gt;</span>`;
  });

  return { text, hasComp };
};

const enhanceCodeBlocks = (html) => {
  return html.replace(/<pre><code(?:\s+class="([^"]*)")?>([\s\S]*?)<\/code><\/pre>/gi, (_, cls = "", codeContent) => {
    const langMatch = cls.match(/language-([a-zA-Z0-9_-]+)/);
    const lang = langMatch ? langMatch[1] : "";
    return `
      <div class="mdx-code-wrap">
        <div class="mdx-code-header">
          <span class="mdx-code-lang">${escapeHtml(lang || "code")}</span>
          <button type="button" class="mdx-code-copy" title="Copy code" data-copy-code="1">Copy</button>
        </div>
        <pre><code${cls ? ` class="${escapeAttr(cls)}"` : ""}>${codeContent}</code></pre>
      </div>
    `;
  });
};

const renderMdx = (rawSource) => {
  const { text: transformed, hasComp } = transformMdxJsx(rawSource);
  let rawHtml = "";
  try {
    rawHtml = marked.parse(transformed, { async: false, gfm: true, breaks: false });
  } catch (e) {
    rawHtml = `<div class="mdx-error">Markdown Parsing Error: ${escapeHtml(e?.message || String(e))}</div>`;
  }
  const enhanced = enhanceCodeBlocks(rawHtml);
  const clean = DOMPurify.sanitize(enhanced, {
    ADD_TAGS: [
      "details", "summary", "svg", "path", "div", "span", "p", "table",
      "thead", "tbody", "tr", "th", "td", "pre", "code", "blockquote",
      "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "hr", "a",
      "img", "strong", "em", "del", "mark", "button"
    ],
    ADD_ATTR: [
      "target", "rel", "class", "style", "data-component", "data-lang",
      "title", "href", "src", "alt", "width", "height", "data-copy-code"
    ],
  });
  return { html: clean, hasComp };
};

// ── MDX Preview Component ───────────────────────────────────────────────────
export const MdxPreview = ({ doc, filePath }) => {
  const [viewMode, setViewMode] = useState("rendered"); // "rendered" | "source"
  const [showRawMeta, setShowRawMeta] = useState(false);
  const [showImports, setShowImports] = useState(false);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef(null);

  const stats = useMemo(() => {
    const text = String(doc || "").trim();
    if (!text) return { words: 0, readTime: "< 1 min" };
    const words = text.split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.ceil(words / 200));
    return { words, readTime: `${minutes} min read` };
  }, [doc]);

  const { meta, imports, exports, renderedHtml, hasComponents } = useMemo(() => {
    const { meta: parsedMeta, content: withoutFm } = parseFrontmatter(doc || "");
    const { content: withoutImports, imports: impList, exports: expList } = extractImportsExports(withoutFm);
    const { html, hasComp } = renderMdx(withoutImports);
    return {
      meta: parsedMeta,
      imports: impList,
      exports: expList,
      renderedHtml: html,
      hasComponents: hasComp,
    };
  }, [doc]);

  const handleCopyDoc = useCallback(() => {
    navigator.clipboard?.writeText(doc || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [doc]);

  const handleBodyClick = useCallback((e) => {
    // 1. Copy button in code fence
    const copyBtn = e.target.closest("[data-copy-code]");
    if (copyBtn) {
      const wrap = copyBtn.closest(".mdx-code-wrap");
      const codeEl = wrap?.querySelector("code");
      if (codeEl) {
        const text = codeEl.innerText || codeEl.textContent || "";
        navigator.clipboard?.writeText(text);
        const prevText = copyBtn.innerText;
        copyBtn.innerText = "Copied!";
        copyBtn.classList.add("mdx-code-copy--copied");
        setTimeout(() => {
          copyBtn.innerText = prevText;
          copyBtn.classList.remove("mdx-code-copy--copied");
        }, 2000);
      }
      return;
    }

    // 2. Clickable links
    const link = e.target.closest("a");
    if (link) {
      const href = link.getAttribute("href");
      if (href) {
        if (/^https?:\/\//i.test(href)) {
          e.preventDefault();
          try {
            window.electronAPI?.openExternal?.(href);
          } catch {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        } else if (href.startsWith("#")) {
          e.preventDefault();
          const targetId = href.slice(1);
          const targetEl =
            bodyRef.current?.querySelector(`[id="${targetId}"]`) ||
            bodyRef.current?.querySelector(`h1, h2, h3, h4, h5, h6`);
          targetEl?.scrollIntoView({ behavior: "smooth" });
        }
      }
    }
  }, []);

  const fileName = (filePath ? filePath.split(/[\\/]/).pop() : "document.mdx") || "document.mdx";

  const headControls = (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-6)" }}>
      <span className="mdx-pill mdx-pill--badge" title="MDX Format">MDX</span>
      <span className="mdx-meta-dim">{stats.words} words · {stats.readTime}</span>
      <button
        className={"ed-prev__btn" + (viewMode === "rendered" ? " ed-prev__btn--on" : "")}
        title="Rendered Preview"
        onClick={() => setViewMode("rendered")}
      >
        <Eye size={12} />
      </button>
      <button
        className={"ed-prev__btn" + (viewMode === "source" ? " ed-prev__btn--on" : "")}
        title="Raw MDX Source"
        onClick={() => setViewMode("source")}
      >
        <Code size={12} />
      </button>
      <button
        className="ed-prev__btn"
        title={copied ? "Copied to clipboard!" : "Copy MDX"}
        onClick={handleCopyDoc}
      >
        {copied ? <Check size={12} color="var(--teal)" /> : <Copy size={12} />}
      </button>
    </div>
  );

  return (
    <>
      <PrevHead
        title={`MDX Preview — ${fileName}`}
        extra={headControls}
      />
      <div className="ed-prev__body mdx-container">
        {viewMode === "source" ? (
          <div className="mdx-raw-source">
            <pre className="mdx-raw-code"><code>{doc}</code></pre>
          </div>
        ) : (
          <div className="mdx-view-wrapper">
            {/* Frontmatter metadata card */}
            {meta && (
              <div className="mdx-frontmatter">
                <div className="mdx-frontmatter__head">
                  <div className="mdx-frontmatter__title-wrap">
                    <span className="mdx-frontmatter__type">Frontmatter</span>
                    {meta.title && <h1 className="mdx-frontmatter__title">{meta.title}</h1>}
                    {meta.description && <p className="mdx-frontmatter__desc">{meta.description}</p>}
                  </div>
                  <button
                    className="mdx-frontmatter__toggle"
                    onClick={() => setShowRawMeta((v) => !v)}
                    title={showRawMeta ? "Collapse details" : "Expand metadata"}
                  >
                    {showRawMeta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                </div>

                {/* Metadata badges / chips */}
                <div className="mdx-frontmatter__badges">
                  {meta.author && <span className="mdx-pill">Author: {meta.author}</span>}
                  {meta.date && <span className="mdx-pill">Date: {meta.date}</span>}
                  {meta.version && <span className="mdx-pill">v{meta.version}</span>}
                  {meta.category && <span className="mdx-pill mdx-pill--accent">{meta.category}</span>}
                  {Array.isArray(meta.tags) && meta.tags.map((t) => (
                    <span key={t} className="mdx-pill mdx-pill--tag">#{t}</span>
                  ))}
                  {hasComponents && (
                    <span className="mdx-pill mdx-pill--comp" title="Document contains custom MDX components">
                      <Sparkles size={11} style={{ marginRight: 3 }} /> Components
                    </span>
                  )}
                </div>

                {/* Expanded metadata table */}
                {showRawMeta && (
                  <div className="mdx-frontmatter__raw">
                    <table className="mdx-meta-tbl">
                      <tbody>
                        {Object.entries(meta).map(([k, v]) => (
                          <tr key={k}>
                            <td className="mdx-meta-key">{k}</td>
                            <td className="mdx-meta-val">
                              {typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Imports & Exports header badge */}
            {(imports.length > 0 || exports.length > 0) && (
              <div className="mdx-modules-banner">
                <button
                  className="mdx-modules-toggle"
                  onClick={() => setShowImports((v) => !v)}
                >
                  <Layers size={12} />
                  <span>
                    MDX Modules: {imports.length} import{imports.length === 1 ? "" : "s"}
                    {exports.length > 0 ? `, ${exports.length} export${exports.length === 1 ? "" : "s"}` : ""}
                  </span>
                  {showImports ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                {showImports && (
                  <div className="mdx-modules-list">
                    {imports.map((imp, idx) => (
                      <div key={idx} className="mdx-module-item"><code>{imp}</code></div>
                    ))}
                    {exports.map((exp, idx) => (
                      <div key={idx} className="mdx-module-item mdx-module-item--export"><code>{exp}</code></div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Document body */}
            {(!doc || !doc.trim()) ? (
              <div className="mdx-empty">
                <FileText size={24} style={{ opacity: 0.5, marginBottom: 8 }} />
                <div>Empty MDX file</div>
                <div className="mdx-meta-dim">Switch to Editor mode to write content.</div>
              </div>
            ) : (
              <div
                ref={bodyRef}
                className="nb-md-view mdx-content"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
                onClick={handleBodyClick}
              />
            )}
          </div>
        )}
      </div>
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
