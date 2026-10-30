// Side preview panes for the editor — Markdown render, MDX preview + SQLite file inspect.
// Markdown: reuses Notebook's zero-dep renderMarkdown (styles .nb-md-view).
// MDX: Frontmatter + JSX components + GFM tables/code preview.
// DB: main-process SQLite manager (electron/main/db-manager.js) → data/schema/SQL UI.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw, Table2, Database, Eye, Code, Copy, Check,
  ChevronDown, ChevronRight, FileText, Sparkles, Layers,
  ExternalLink, Info, AlertTriangle, BookOpen,
  Plus, Trash2, Play, Download, Search, X, ChevronLeft,
  Loader2, AlertCircle, Key
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
// ── SQLite database manager ────────────────────────────────────────────────
// Read + write through electron/main/db-manager.js. Every IPC call opens the
// database fresh, so nothing keeps a lock (or a stale handle) between actions.
const DB_ROWID = "__idiotbox_rowid__";

const dbIsBlob = (v) => v instanceof Uint8Array || v instanceof ArrayBuffer;

const dbValueText = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "bigint") return v.toString();
  if (dbIsBlob(v)) return `BLOB · ${v.byteLength} B`;
  return String(v);
};

const dbRowId = (row, keyColumns) => {
  if (!keyColumns || !keyColumns.length) return "";
  return keyColumns.map((column) => {
    const v = row?.[column];
    if (v === null || v === undefined) return "null";
    if (typeof v === "bigint") return `big:${v}`;
    if (dbIsBlob(v)) return `blob:${Array.from(new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength)).slice(0, 24).join(".")}`;
    return `${typeof v}:${String(v)}`;
  }).join("\u0001");
};

const dbRowKey = (row, keyColumns) => {
  const key = {};
  for (const column of keyColumns || []) key[column] = row?.[column];
  return key;
};

const dbFormatCell = (v) => {
  if (v === null || v === undefined) return <span className="ed-null">NULL</span>;
  if (dbIsBlob(v)) return <span className="ed-blob">BLOB · {v.byteLength} B</span>;
  if (typeof v === "boolean") return <span className="ed-bool">{v ? "true" : "false"}</span>;
  const text = typeof v === "bigint" ? v.toString() : String(v);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
};

const dbFormatBytes = (bytes) => {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const dbQuote = (name) => `"${String(name).replace(/"/g, '""')}"`;

const DbModal = ({ title, children, footer, onClose, width }) => (
  <div
    className="ed-db-modal__backdrop"
    onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
  >
    <div className="ed-db-modal" style={width ? { width } : undefined} role="dialog" aria-modal="true">
      <div className="ed-db-modal__head">
        <span>{title}</span>
        <button className="ed-db__iconbtn" onClick={onClose} title="Close"><X size={14} /></button>
      </div>
      <div className="ed-db-modal__body">{children}</div>
      {footer && <div className="ed-db-modal__foot">{footer}</div>}
    </div>
  </div>
);

const DB_COLUMN_TYPES = ["TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC", "BOOLEAN", "DATE", "DATETIME", "TIMESTAMP"];
const dbNewColumn = () => ({ name: "", type: "TEXT", pk: false, notnull: false, dflt: "" });

export const DbPreview = ({ filePath }) => {
  const [info, setInfo] = useState(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoErr, setInfoErr] = useState(null);

  const [activeName, setActiveName] = useState(null);
  const [objFilter, setObjFilter] = useState("");
  const [tab, setTab] = useState("data");

  const [data, setData] = useState(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataErr, setDataErr] = useState(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [orderBy, setOrderBy] = useState("");
  const [orderDir, setOrderDir] = useState("asc");
  const [selected, setSelected] = useState(() => new Map());
  const [refreshTick, setRefreshTick] = useState(0);

  const [editing, setEditing] = useState(null);
  const editInputRef = useRef(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addValues, setAddValues] = useState({});
  const [addNulls, setAddNulls] = useState({});
  const [addSaving, setAddSaving] = useState(false);
  const [addErr, setAddErr] = useState(null);

  const [newTableOpen, setNewTableOpen] = useState(false);
  const [newTable, setNewTable] = useState({ name: "", columns: [dbNewColumn()] });
  const [newTableSaving, setNewTableSaving] = useState(false);
  const [newTableErr, setNewTableErr] = useState(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const [dropSaving, setDropSaving] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(null);
  const exportRef = useRef(null);

  const [sqlText, setSqlText] = useState("");
  const [sqlResult, setSqlResult] = useState(null);
  const [sqlErr, setSqlErr] = useState(null);
  const [sqlRunning, setSqlRunning] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const reqSeq = useRef(0);
  const editSaveRef = useRef(false);

  const showToast = useCallback((message, kind = "ok") => {
    setToast({ message: String(message || ""), kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  useEffect(() => {
    if (editing) requestAnimationFrame(() => { editInputRef.current?.focus(); editInputRef.current?.select(); });
  }, [editing]);

  const loadInfo = useCallback(async () => {
    setInfoLoading(true);
    setInfoErr(null);
    try {
      const res = await window.electronAPI?.dbList?.(filePath);
      if (!res || res.error) throw new Error(res?.error || "Could not read the database");
      setInfo(res);
      setActiveName((prev) => {
        if (prev && res.objects.some((o) => o.name === prev)) return prev;
        return res.objects[0]?.name || null;
      });
    } catch (e) {
      setInfo(null);
      setInfoErr(String(e?.message || e));
    } finally {
      setInfoLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    setInfo(null);
    setInfoErr(null);
    setActiveName(null);
    setData(null);
    setTab("data");
    setSelected(new Map());
    setSqlText("");
    setSqlResult(null);
    setSqlErr(null);
    setToast(null);
    loadInfo();
  }, [loadInfo]);

  useEffect(() => {
    // A different object means a different page/filter/selection.
    setData(null);
    setPage(0);
    setSearchInput("");
    setSearch("");
    setOrderBy("");
    setOrderDir("asc");
    setSelected(new Map());
    setEditing(null);
    setExportOpen(false);
  }, [activeName]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
      setSearch(searchInput.trim());
    }, 280);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const objects = info?.objects || [];
  const activeObj = objects.find((o) => o.name === activeName) || null;
  const fileName = filePath.split(/[\\/]/).pop();

  const visibleObjects = useMemo(() => {
    const q = objFilter.trim().toLowerCase();
    return q ? objects.filter((o) => o.name.toLowerCase().includes(q)) : objects;
  }, [objects, objFilter]);

  const loadData = useCallback(async () => {
    if (!activeName || tab === "sql") return;
    const seq = ++reqSeq.current;
    setDataLoading(true);
    setDataErr(null);
    try {
      const res = await window.electronAPI?.dbTable?.({
        filePath,
        table: activeName,
        page,
        pageSize,
        search,
        orderBy,
        orderDir,
      });
      if (seq !== reqSeq.current) return;
      if (!res || res.error) throw new Error(res?.error || "Could not read this object");
      setData(res);
    } catch (e) {
      if (seq === reqSeq.current) {
        setData(null);
        setDataErr(String(e?.message || e));
      }
    } finally {
      if (seq === reqSeq.current) setDataLoading(false);
    }
  }, [filePath, activeName, tab, page, pageSize, search, orderBy, orderDir]);

  useEffect(() => {
    if (tab !== "sql") loadData();
  }, [loadData, tab, refreshTick]);

  const refreshAll = useCallback(() => {
    setRefreshTick((n) => n + 1);
    loadInfo();
  }, [loadInfo]);

  const selectObject = (name) => {
    setActiveName(name);
    setTab("data");
  };

  const toggleSort = (column) => {
    if (orderBy === column) setOrderDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setOrderBy(column); setOrderDir("asc"); }
    setPage(0);
  };

  // ── Cell editing ────────────────────────────────────────────────────────
  const startEdit = (row, column) => {
    if (!data || data.type !== "table" || !data.keyColumns?.length) return;
    if (dbIsBlob(row[column.name])) return;
    setEditing({
      id: dbRowId(row, data.keyColumns),
      column: column.name,
      key: dbRowKey(row, data.keyColumns),
      value: row[column.name] == null ? "" : dbValueText(row[column.name]),
      wasNull: row[column.name] == null,
    });
  };

  const saveCell = async (value) => {
    const edit = editing;
    if (!edit || editSaveRef.current) return;
    editSaveRef.current = true;
    setEditing(null);
    try {
      const res = await window.electronAPI?.dbUpdateCell?.({
        filePath, table: activeName, key: edit.key, column: edit.column, value,
      });
      if (!res || res.error) throw new Error(res?.error || "Update failed");
      showToast(res.changes ? "Cell updated" : "No row was changed");
      setRefreshTick((n) => n + 1);
    } catch (e) {
      showToast(String(e?.message || e), "err");
    } finally {
      editSaveRef.current = false;
    }
  };

  const commitEdit = () => {
    if (!editing) return;
    saveCell(editing.wasNull && editing.value === "" ? null : editing.value);
  };

  // ── Selection ───────────────────────────────────────────────────────────
  const selectable = !!(data && data.type === "table" && data.keyColumns?.length);
  const pageIds = data?.rows?.map((row) => dbRowId(row, data.keyColumns)) || [];
  const allPageSelected = selectable && pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const toggleRow = (id, row) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id); else next.set(id, row);
      return next;
    });
  };

  const toggleAllPage = () => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else data.rows.forEach((row) => next.set(dbRowId(row, data.keyColumns), row));
      return next;
    });
  };

  // ── Mutations ───────────────────────────────────────────────────────────
  const beginAdd = () => {
    setAddValues({});
    setAddNulls({});
    setAddErr(null);
    setAddOpen(true);
  };

  const submitAdd = async () => {
    if (!data) return;
    const values = {};
    for (const column of data.columns) {
      if (addNulls[column.name]) { values[column.name] = null; continue; }
      const raw = addValues[column.name];
      if (raw === undefined || raw === "") continue;
      values[column.name] = raw;
    }
    setAddSaving(true);
    setAddErr(null);
    try {
      const res = await window.electronAPI?.dbInsertRow?.({ filePath, table: activeName, values });
      if (!res || res.error) throw new Error(res?.error || "Insert failed");
      setAddOpen(false);
      setRefreshTick((n) => n + 1);
      showToast("Row added");
    } catch (e) {
      setAddErr(String(e?.message || e));
    } finally {
      setAddSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!data || !selected.size) return;
    const keys = Array.from(selected.values()).map((row) => dbRowKey(row, data.keyColumns));
    try {
      const res = await window.electronAPI?.dbDeleteRows?.({ filePath, table: activeName, keys });
      if (!res || res.error) throw new Error(res?.error || "Delete failed");
      setDeleteOpen(false);
      setSelected(new Map());
      setRefreshTick((n) => n + 1);
      showToast(`${res.changes} row${res.changes === 1 ? "" : "s"} deleted`);
    } catch (e) {
      setDeleteOpen(false);
      showToast(String(e?.message || e), "err");
    }
  };

  const openNewTable = () => {
    setNewTable({ name: "", columns: [dbNewColumn()] });
    setNewTableErr(null);
    setNewTableOpen(true);
  };

  const patchNewColumn = (index, patch) => {
    setNewTable((prev) => ({
      ...prev,
      columns: prev.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)),
    }));
  };

  const submitNewTable = async () => {
    setNewTableSaving(true);
    setNewTableErr(null);
    try {
      const res = await window.electronAPI?.dbCreateTable?.({
        filePath,
        name: newTable.name.trim(),
        columns: newTable.columns,
      });
      if (!res || res.error) throw new Error(res?.error || "Could not create table");
      setNewTableOpen(false);
      await loadInfo();
      setActiveName(res.name);
      setTab("data");
      showToast(`Table "${res.name}" created`);
    } catch (e) {
      setNewTableErr(String(e?.message || e));
    } finally {
      setNewTableSaving(false);
    }
  };

  const confirmDrop = async () => {
    if (!dropTarget) return;
    setDropSaving(true);
    try {
      const res = await window.electronAPI?.dbDropTable?.({ filePath, table: dropTarget.name });
      if (!res || res.error) throw new Error(res?.error || "Drop failed");
      setDropTarget(null);
      setData(null);
      setActiveName(null);
      await loadInfo();
      setRefreshTick((n) => n + 1);
      showToast(`${res.type === "view" ? "View" : "Table"} "${res.name}" dropped`);
    } catch (e) {
      setDropTarget(null);
      showToast(String(e?.message || e), "err");
    } finally {
      setDropSaving(false);
    }
  };

  const doExport = async (format) => {
    if (!activeName) return;
    setExportOpen(false);
    setExporting(format);
    try {
      const res = await window.electronAPI?.dbExport?.({ filePath, table: activeName, format });
      if (!res || res.error) throw new Error(res?.error || "Export failed");
      if (res.canceled) return;
      showToast(`Exported ${res.rows} row${res.rows === 1 ? "" : "s"} → ${res.path}`);
    } catch (e) {
      showToast(String(e?.message || e), "err");
    } finally {
      setExporting(null);
    }
  };

  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [exportOpen]);

  // ── SQL console ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab === "sql" && !sqlText.trim() && activeName) {
      setSqlText(`SELECT * FROM ${dbQuote(activeName)} LIMIT 100;`);
    }
  }, [tab, activeName]);

  const runSql = async () => {
    const text = sqlText.trim();
    if (!text || sqlRunning) return;
    setSqlRunning(true);
    setSqlErr(null);
    try {
      const res = await window.electronAPI?.dbQuery?.({ filePath, sql: text });
      if (!res || res.error) throw new Error(res?.error || "Query failed");
      setSqlResult(res);
      if (res.columns.length) {
        showToast(`${res.rowCount} row${res.rowCount === 1 ? "" : "s"}${res.truncated ? " (truncated)" : ""}`);
      } else {
        showToast(res.write ? `${res.changes} row${res.changes === 1 ? "" : "s"} affected` : "Statement executed");
        loadInfo();
        setRefreshTick((n) => n + 1);
      }
    } catch (e) {
      setSqlResult(null);
      setSqlErr(String(e?.message || e));
      setToast(null);
    } finally {
      setSqlRunning(false);
    }
  };

  const copyText = (text, label = "Copied") => {
    try {
      window.electronAPI?.clipboardWrite?.(String(text ?? ""));
      showToast(label);
    } catch (e) {
      showToast(String(e?.message || e), "err");
    }
  };

  const busy = infoLoading || dataLoading;
  const refreshBtn = (
    <button className="ed-prev__btn" title="Refresh database" onClick={refreshAll} disabled={busy}>
      <RefreshCw size={13} className={busy ? "ed-spin" : undefined} />
    </button>
  );

  // ── Data grid ───────────────────────────────────────────────────────────
  const renderData = () => {
    if (dataErr) {
      return (
        <div className="ed-db__msg">
          <AlertCircle size={20} />
          <div>{dataErr}</div>
          <button className="ed-db__btn" onClick={() => setRefreshTick((n) => n + 1)}>Retry</button>
        </div>
      );
    }
    if (!data) {
      return <div className="ed-db__msg">{dataLoading ? <><Loader2 size={18} className="ed-spin" /> Loading rows…</> : "Select a table or view"}</div>;
    }
    if (!data.columns.length) {
      return <div className="ed-db__msg">Could not read columns for “{data.table}”.</div>;
    }

    const colspan = data.columns.length + 1 + (selectable ? 1 : 0);
    return (
      <>
        <div className="ed-db__scroll">
          <table className="ed-db-tbl">
            <thead>
              <tr>
                <th className="ed-db-tbl__num">#</th>
                {selectable && (
                  <th className="ed-db-tbl__check">
                    <input type="checkbox" checked={allPageSelected} onChange={toggleAllPage} title="Select page" />
                  </th>
                )}
                {data.columns.map((column) => (
                  <th
                    key={column.name}
                    onClick={() => toggleSort(column.name)}
                    title={`${column.name}${column.type ? ` · ${column.type}` : ""} · click to sort`}
                  >
                    <span className="ed-db-tbl__col">
                      <span className="ed-db-tbl__colname">{column.name}</span>
                      {column.pk > 0 && <Key size={10} className="ed-db-tbl__key" />}
                      {orderBy === column.name && (
                        <span className="ed-db-tbl__sort">{orderDir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </span>
                    {column.type && <span className="ed-db-tbl__coltype">{column.type}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td className="ed-db__empty" colSpan={colspan}>
                    {search ? "No rows match this filter." : "Empty table."}
                  </td>
                </tr>
              ) : data.rows.map((row, rowIndex) => {
                const rowId = dbRowId(row, data.keyColumns) || `r${rowIndex}`;
                const isSelected = selected.has(rowId);
                return (
                  <tr key={rowId || rowIndex} className={isSelected ? "ed-db-tbl__row--sel" : undefined}>
                    <td className="ed-db-tbl__num">{data.page * data.pageSize + rowIndex + 1}</td>
                    {selectable && (
                      <td className="ed-db-tbl__check">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(rowId, row)}
                        />
                      </td>
                    )}
                    {data.columns.map((column) => {
                      const isEditing = editing && editing.id === rowId && editing.column === column.name;
                      const raw = row[column.name];
                      return (
                        <td
                          key={column.name}
                          className={"ed-db-tbl__cell" + (isEditing ? " ed-db-tbl__cell--edit" : "")}
                          onDoubleClick={() => startEdit(row, column)}
                          title={isEditing ? undefined : (raw == null ? "NULL" : dbValueText(raw))}
                        >
                          {isEditing ? (
                            <div className="ed-db-celledit">
                              <input
                                ref={editInputRef}
                                className="ed-db-celledit__input"
                                value={editing.value}
                                onChange={(e) => setEditing((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                                onBlur={commitEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
                                  else if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                                }}
                              />
                              <button
                                className="ed-db-celledit__null"
                                title="Set NULL"
                                onMouseDown={(e) => { e.preventDefault(); saveCell(null); }}
                              >∅</button>
                            </div>
                          ) : dbFormatCell(raw)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {dataLoading && <div className="ed-db__loadingbar" />}
        </div>
        <div className="ed-db__pager">
          <span className="ed-db__pager-info">
            {data.total === 0 ? "No rows" : `${data.page * data.pageSize + 1}–${Math.min(data.total, (data.page + 1) * data.pageSize)} of ${data.total.toLocaleString()}`}
            {selected.size > 0 && ` · ${selected.size} selected`}
          </span>
          {!selectable && <span className="ed-db__pager-note">no stable key — read-only</span>}
          <span className="ed-db__pager-spacer" />
          <select
            className="ed-db__select"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            title="Rows per page"
          >
            {[50, 100, 250, 500].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button className="ed-db__iconbtn" disabled={data.page <= 0} onClick={() => setPage(Math.max(0, data.page - 1))} title="Previous page">
            <ChevronLeft size={14} />
          </button>
          <span className="ed-db__pager-page">{data.page + 1} / {data.pageCount}</span>
          <button className="ed-db__iconbtn" disabled={data.page >= data.pageCount - 1} onClick={() => setPage(Math.min(data.pageCount - 1, data.page + 1))} title="Next page">
            <ChevronRight size={14} />
          </button>
        </div>
      </>
    );
  };

  // ── Schema tab ──────────────────────────────────────────────────────────
  const renderSchema = () => {
    if (dataErr) {
      return (
        <div className="ed-db__msg">
          <AlertCircle size={20} />
          <div>{dataErr}</div>
          <button className="ed-db__btn" onClick={() => setRefreshTick((n) => n + 1)}>Retry</button>
        </div>
      );
    }
    if (!data) {
      return <div className="ed-db__msg">{dataLoading ? <><Loader2 size={18} className="ed-spin" /> Loading schema…</> : "Select a table or view"}</div>;
    }
    const keyLabel = data.keyKind === "rowid"
      ? "rowid"
      : data.keyColumns?.length ? data.keyColumns.join(", ") : "none (read-only)";
    return (
      <div className="ed-db__scroll ed-db-schema">
        <div className="ed-db-schema__head">
          <div className="ed-db-schema__title">
            <Database size={14} />
            <strong>{data.table}</strong>
            <span className="ed-db__badge">{data.type}</span>
          </div>
          <div className="ed-db-schema__stats">
            <span>{data.total.toLocaleString()} rows</span>
            <span>{data.columns.length} columns</span>
            <span>key: {keyLabel}</span>
          </div>
        </div>

        <section className="ed-db-section">
          <h4 className="ed-db-section__title">Columns</h4>
          <div className="ed-db__scroll ed-db-schema__scroll">
            <table className="ed-db-schema-tbl">
              <thead>
                <tr><th>#</th><th>Name</th><th>Type</th><th>Not null</th><th>Default</th><th>PK</th></tr>
              </thead>
              <tbody>
                {data.columns.map((column, index) => (
                  <tr key={column.name}>
                    <td>{index + 1}</td>
                    <td className="ed-db-schema__name">{column.name}</td>
                    <td>{column.type || "—"}</td>
                    <td>{column.notnull ? "yes" : "—"}</td>
                    <td className="ed-db-schema__dflt">{column.dflt ?? "—"}</td>
                    <td>{column.pk > 0 ? `#${column.pk}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ed-db-section">
          <h4 className="ed-db-section__title">Indexes <span className="ed-db-section__count">{data.indexes.length}</span></h4>
          {data.indexes.length === 0 ? (
            <div className="ed-db-section__empty">No indexes.</div>
          ) : (
            <div className="ed-db-idxlist">
              {data.indexes.map((index) => (
                <div className="ed-db-idx" key={index.name}>
                  <Key size={11} />
                  <span className="ed-db-idx__name">{index.name}</span>
                  {index.unique && <span className="ed-db__badge ed-db__badge--ok">unique</span>}
                  <span className="ed-db-idx__cols">{index.columns.join(", ") || "expression"}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="ed-db-section">
          <div className="ed-db-section__bar">
            <h4 className="ed-db-section__title">SQL</h4>
            <button className="ed-db__btn ed-db__btn--ghost" onClick={() => copyText(data.sql, "CREATE SQL copied")} disabled={!data.sql}>
              <Copy size={12} /> Copy
            </button>
          </div>
          <pre className="ed-db-code">{data.sql || "—"}</pre>
        </section>

        <section className="ed-db-section ed-db-section--danger">
          <h4 className="ed-db-section__title">Danger zone</h4>
          <div className="ed-db-section__row">
            <span>Permanently remove this {data.type} and all of its rows.</span>
            <button className="ed-db__btn ed-db__btn--danger" onClick={() => setDropTarget({ name: data.table, type: data.type })}>
              <Trash2 size={12} /> Drop {data.type}
            </button>
          </div>
        </section>
      </div>
    );
  };

  // ── SQL tab ─────────────────────────────────────────────────────────────
  const renderSql = () => (
    <div className="ed-db-sql">
      <div className="ed-db-sql__bar">
        <Code size={13} />
        <span>SQL console</span>
        <span className="ed-db-sql__hint">Ctrl+Enter to run · one statement</span>
        {activeName && (
          <>
            <button className="ed-db__chip" onClick={() => setSqlText(`SELECT * FROM ${dbQuote(activeName)} LIMIT 100;`)}>Preview {activeName}</button>
            <button className="ed-db__chip" onClick={() => setSqlText("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;")}>Objects</button>
          </>
        )}
        <span className="ed-db-sql__spacer" />
        <button className="ed-db__btn ed-db__btn--primary" onClick={runSql} disabled={sqlRunning || !sqlText.trim()}>
          {sqlRunning ? <Loader2 size={12} className="ed-spin" /> : <Play size={12} />} Run
        </button>
      </div>
      <textarea
        className="ed-db-sql__text"
        value={sqlText}
        spellCheck={false}
        onChange={(e) => setSqlText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runSql(); }
        }}
        placeholder="SELECT * FROM table_name LIMIT 100;"
      />
      {sqlErr && (
        <div className="ed-db-sql__error">
          <AlertCircle size={14} />
          <span>{sqlErr}</span>
        </div>
      )}
      {sqlResult && !sqlErr && (
        sqlResult.columns.length ? (
          <div className="ed-db-sql__result">
            <div className="ed-db-sql__resulthead">
              <span>{sqlResult.rowCount} row{sqlResult.rowCount === 1 ? "" : "s"}</span>
              <span>{sqlResult.durationMs} ms</span>
              {sqlResult.truncated && <span className="ed-db__badge ed-db__badge--warn">first {sqlResult.rowCount}</span>}
            </div>
            <div className="ed-db__scroll">
              <table className="ed-db-tbl">
                <thead>
                  <tr>
                    <th className="ed-db-tbl__num">#</th>
                    {sqlResult.columns.map((column) => (
                      <th key={column.name} title={column.type || undefined}>
                        <span className="ed-db-tbl__col"><span className="ed-db-tbl__colname">{column.name}</span></span>
                        {column.type && <span className="ed-db-tbl__coltype">{column.type}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sqlResult.rows.map((row, index) => (
                    <tr key={index}>
                      <td className="ed-db-tbl__num">{index + 1}</td>
                      {sqlResult.columns.map((column) => (
                        <td key={column.name} className="ed-db-tbl__cell" title={dbValueText(row[column.name])}>
                          {dbFormatCell(row[column.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="ed-db-sql__summary">
            <Check size={14} /> {sqlResult.write ? `${sqlResult.changes} row${sqlResult.changes === 1 ? "" : "s"} affected` : "Statement executed"}
            <span>{sqlResult.durationMs} ms</span>
          </div>
        )
      )}
      {!sqlResult && !sqlErr && !sqlRunning && (
        <div className="ed-db-sql__empty">Results appear here. Reads, writes and DDL all work.</div>
      )}
    </div>
  );

  // ── Header / body ───────────────────────────────────────────────────────
  return (
    <>
      <PrevHead title={`Database — ${fileName}`} extra={refreshBtn} />
      <div className="ed-prev__body ed-db">
        <div className="ed-db__compact-objects">
          <select aria-label="Database object" title={activeName || "Choose a database object"} value={activeName || ""} onChange={event => selectObject(event.target.value)}>
            {!objects.length && <option value="">No tables yet</option>}
            {objects.map(object => <option key={object.name} value={object.name}>{object.name}{object.type === "view" ? " (view)" : ""}</option>)}
          </select>
          <button className="ed-db__iconbtn" title="New table" onClick={openNewTable} disabled={!info}><Plus size={14}/></button>
        </div>
        <aside className="ed-db__side">
          <div className="ed-db__side-head">
            <span className="ed-db__side-title">Objects</span>
            <button className="ed-db__iconbtn" title="New table" onClick={openNewTable} disabled={!info}>
              <Plus size={14} />
            </button>
          </div>
          <div className="ed-db__side-search">
            <Search size={12} />
            <input
              value={objFilter}
              onChange={(e) => setObjFilter(e.target.value)}
              placeholder="Filter objects"
              spellCheck={false}
            />
            {objFilter && <button className="ed-db__clear" onClick={() => setObjFilter("")} title="Clear"><X size={11} /></button>}
          </div>
          <div className="ed-db__list">
            {infoLoading && !info ? (
              <div className="ed-db__side-msg"><Loader2 size={14} className="ed-spin" /> Reading…</div>
            ) : visibleObjects.length === 0 ? (
              <div className="ed-db__side-msg">{objects.length === 0 ? "No tables yet" : "No match"}</div>
            ) : visibleObjects.map((object) => (
              <button
                key={object.name}
                className={"ed-db__item" + (object.name === activeName ? " ed-db__item--on" : "")}
                onClick={() => selectObject(object.name)}
                title={`${object.type}: ${object.name}`}
              >
                {object.type === "view" ? <Eye size={13} className="ed-db__item-ico" /> : <Table2 size={13} className="ed-db__item-ico" />}
                <span className="ed-db__item-name">{object.name}</span>
                {object.type === "view" && <span className="ed-db__item-tag">view</span>}
              </button>
            ))}
          </div>
          <div className="ed-db__side-foot">
            {info?.file ? (
              <>
                <span title={info.file.path}>{dbFormatBytes(info.file.size)}</span>
                <span title={new Date(info.file.mtimeMs).toLocaleString()}>{info.objects.length} objects</span>
              </>
            ) : <span>SQLite</span>}
          </div>
        </aside>

        <main className="ed-db__main">
          {infoErr ? (
            <div className="ed-db__msg">
              <AlertCircle size={20} />
              <div>{infoErr}</div>
              <button className="ed-db__btn" onClick={loadInfo}>Retry</button>
            </div>
          ) : !info && infoLoading ? (
            <div className="ed-db__msg"><Loader2 size={18} className="ed-spin" /> Reading database…</div>
          ) : !activeObj ? (
            <div className="ed-db__msg">
              <Database size={26} />
              <div>This database has no tables or views.</div>
              <button className="ed-db__btn ed-db__btn--primary" onClick={openNewTable}><Plus size={12} /> New table</button>
            </div>
          ) : (
            <>
              <div className="ed-db__tabs">
                <button className={"ed-db__tab" + (tab === "data" ? " ed-db__tab--on" : "")} onClick={() => setTab("data")}>
                  <Table2 size={12} /> Data
                </button>
                <button className={"ed-db__tab" + (tab === "schema" ? " ed-db__tab--on" : "")} onClick={() => setTab("schema")}>
                  <Layers size={12} /> Schema
                </button>
                <button className={"ed-db__tab" + (tab === "sql" ? " ed-db__tab--on" : "")} onClick={() => setTab("sql")}>
                  <Code size={12} /> SQL
                </button>
                <span className="ed-db__tabs-meta">
                  <span className="ed-db__objname" title={activeName}>{activeName}</span>
                  <span className="ed-db__badge">{activeObj.type}</span>
                </span>
              </div>

              {tab === "data" && (
                <div className="ed-db__view">
                  <div className="ed-db__toolbar">
                    <div className="ed-db__search">
                      <Search size={12} />
                      <input
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder="Filter rows (all columns)"
                        spellCheck={false}
                      />
                      {searchInput && <button className="ed-db__clear" onClick={() => setSearchInput("")} title="Clear"><X size={11} /></button>}
                    </div>
                    <span className="ed-db__toolbar-meta">
                      {data ? `${data.total.toLocaleString()} rows` : "—"}
                    </span>
                    <span className="ed-db__toolbar-spacer" />
                    <button className="ed-db__btn" onClick={beginAdd} disabled={!data || data.type !== "table"} title="Insert a row">
                      <Plus size={12} /> Add row
                    </button>
                    <button className="ed-db__btn ed-db__btn--danger-ghost" onClick={() => setDeleteOpen(true)} disabled={!selectable || selected.size === 0} title="Delete selected rows">
                      <Trash2 size={12} /> Delete{selected.size ? ` (${selected.size})` : ""}
                    </button>
                    <div className="ed-db__export" ref={exportRef}>
                      <button className="ed-db__btn" onClick={() => setExportOpen((v) => !v)} disabled={!data || !!exporting} title="Export table">
                        {exporting ? <Loader2 size={12} className="ed-spin" /> : <Download size={12} />} Export <ChevronDown size={11} />
                      </button>
                      {exportOpen && (
                        <div className="ed-db__menu">
                          <button onClick={() => doExport("csv")}>CSV (.csv)</button>
                          <button onClick={() => doExport("json")}>JSON (.json)</button>
                          <button onClick={() => doExport("sql")} disabled={data?.type === "view"}>SQL (.sql)</button>
                        </div>
                      )}
                    </div>
                  </div>
                  {renderData()}
                </div>
              )}

              {tab === "schema" && <div className="ed-db__view">{renderSchema()}</div>}
              {tab === "sql" && renderSql()}
            </>
          )}
        </main>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {addOpen && data && (
        <DbModal
          title={`Add row — ${activeName}`}
          onClose={() => setAddOpen(false)}
          width="min(560px, 92vw)"
          footer={
            <>
              <button className="ed-db__btn" onClick={() => setAddOpen(false)} disabled={addSaving}>Cancel</button>
              <button className="ed-db__btn ed-db__btn--primary" onClick={submitAdd} disabled={addSaving}>
                {addSaving ? <Loader2 size={12} className="ed-spin" /> : <Plus size={12} />} Add row
              </button>
            </>
          }
        >
          <div className="ed-db-modal__hint">Leave a field blank to use its default / NULL. Tick NULL to insert NULL explicitly.</div>
          {addErr && <div className="ed-db-modal__error"><AlertCircle size={13} /> {addErr}</div>}
          <div className="ed-db-form">
            {data.columns.map((column) => (
              <div className="ed-db-form__row" key={column.name}>
                <label className="ed-db-form__label" title={column.type || undefined}>
                  <span>{column.name}</span>
                  <span className="ed-db-form__type">
                    {column.pk > 0 && <Key size={9} />} {column.type || "ANY"}{column.notnull ? " · not null" : ""}
                  </span>
                </label>
                <input
                  className="ed-db-input"
                  value={addNulls[column.name] ? "" : (addValues[column.name] ?? "")}
                  disabled={!!addNulls[column.name]}
                  placeholder={column.dflt != null ? `default: ${column.dflt}` : column.notnull ? "required" : "NULL"}
                  onChange={(e) => setAddValues((prev) => ({ ...prev, [column.name]: e.target.value }))}
                />
                <label className="ed-db-form__null" title="Insert NULL">
                  <input
                    type="checkbox"
                    checked={!!addNulls[column.name]}
                    onChange={(e) => setAddNulls((prev) => ({ ...prev, [column.name]: e.target.checked }))}
                  /> NULL
                </label>
              </div>
            ))}
          </div>
        </DbModal>
      )}

      {newTableOpen && (
        <DbModal
          title="New table"
          onClose={() => setNewTableOpen(false)}
          width="min(760px, 94vw)"
          footer={
            <>
              <button className="ed-db__btn" onClick={() => setNewTableOpen(false)} disabled={newTableSaving}>Cancel</button>
              <button className="ed-db__btn ed-db__btn--primary" onClick={submitNewTable} disabled={newTableSaving || !newTable.name.trim()}>
                {newTableSaving ? <Loader2 size={12} className="ed-spin" /> : <Plus size={12} />} Create table
              </button>
            </>
          }
        >
          {newTableErr && <div className="ed-db-modal__error"><AlertCircle size={13} /> {newTableErr}</div>}
          <div className="ed-db-form__field">
            <label className="ed-db-form__label">Table name</label>
            <input
              className="ed-db-input"
              autoFocus
              value={newTable.name}
              placeholder="e.g. customers"
              onChange={(e) => setNewTable((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div className="ed-db-newtable__head">
            <span>Columns</span>
            <button className="ed-db__btn ed-db__btn--ghost" onClick={() => setNewTable((prev) => ({ ...prev, columns: [...prev.columns, dbNewColumn()] }))}>
              <Plus size={11} /> Add column
            </button>
          </div>
          <div className="ed-db-newtable">
            <div className="ed-db-newtable__row ed-db-newtable__row--head">
              <span>Name</span><span>Type</span><span>PK</span><span>Not null</span><span>Default</span><span />
            </div>
            {newTable.columns.map((column, index) => (
              <div className="ed-db-newtable__row" key={index}>
                <input
                  className="ed-db-input"
                  value={column.name}
                  placeholder={`column_${index + 1}`}
                  onChange={(e) => patchNewColumn(index, { name: e.target.value })}
                />
                <select
                  className="ed-db__select ed-db__select--wide"
                  value={column.type}
                  onChange={(e) => patchNewColumn(index, { type: e.target.value })}
                >
                  {DB_COLUMN_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <input
                  type="checkbox"
                  checked={!!column.pk}
                  title="Primary key"
                  onChange={(e) => patchNewColumn(index, { pk: e.target.checked })}
                />
                <input
                  type="checkbox"
                  checked={!!column.notnull}
                  title="NOT NULL"
                  onChange={(e) => patchNewColumn(index, { notnull: e.target.checked })}
                />
                <input
                  className="ed-db-input"
                  value={column.dflt}
                  placeholder="default"
                  onChange={(e) => patchNewColumn(index, { dflt: e.target.value })}
                />
                <button
                  className="ed-db__iconbtn"
                  title="Remove column"
                  disabled={newTable.columns.length <= 1}
                  onClick={() => setNewTable((prev) => ({ ...prev, columns: prev.columns.filter((_, i) => i !== index) }))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </DbModal>
      )}

      {dropTarget && (
        <DbModal
          title={`Drop ${dropTarget.type}`}
          onClose={() => setDropTarget(null)}
          width="min(430px, 92vw)"
          footer={
            <>
              <button className="ed-db__btn" onClick={() => setDropTarget(null)} disabled={dropSaving}>Cancel</button>
              <button className="ed-db__btn ed-db__btn--danger" onClick={confirmDrop} disabled={dropSaving}>
                {dropSaving ? <Loader2 size={12} className="ed-spin" /> : <Trash2 size={12} />} Drop
              </button>
            </>
          }
        >
          <div className="ed-db-modal__warn">
            <AlertTriangle size={18} />
            <div>
              <strong>{dropTarget.name}</strong> will be permanently removed, including all of its rows and indexes.
              <div className="ed-db-modal__dim">This cannot be undone.</div>
            </div>
          </div>
        </DbModal>
      )}

      {deleteOpen && data && (
        <DbModal
          title="Delete rows"
          onClose={() => setDeleteOpen(false)}
          width="min(430px, 92vw)"
          footer={
            <>
              <button className="ed-db__btn" onClick={() => setDeleteOpen(false)}>Cancel</button>
              <button className="ed-db__btn ed-db__btn--danger" onClick={confirmDelete}>
                <Trash2 size={12} /> Delete {selected.size}
              </button>
            </>
          }
        >
          <div className="ed-db-modal__warn">
            <AlertTriangle size={18} />
            <div>
              Delete <strong>{selected.size}</strong> selected row{selected.size === 1 ? "" : "s"} from <strong>{activeName}</strong>?
              <div className="ed-db-modal__dim">This cannot be undone.</div>
            </div>
          </div>
        </DbModal>
      )}

      {toast && (
        <div className={`ed-db-toast ed-db-toast--${toast.kind}`} role="status">
          {toast.kind === "err" ? <AlertCircle size={13} /> : <Check size={13} />}
          <span>{toast.message}</span>
        </div>
      )}
    </>
  );
};
