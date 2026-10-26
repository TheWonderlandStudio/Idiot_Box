// ── SQLite database manager (main process) ────────────────────────────────
// Uses node:sqlite (built into Electron — no native dependency).
//
// The renderer talks to this file through a small IPC surface:
//   db:list          → file info + tables/views
//   db:table         → paged rows, columns, keys, indexes, CREATE SQL
//   db:query         → run one SQL statement (SELECT/PRAGMA/DDL/DML)
//   db:updateCell    → UPDATE one cell by stable row key
//   db:insertRow     → INSERT a row
//   db:deleteRows    → DELETE selected rows
//   db:createTable   → CREATE TABLE from the New Table dialog
//   db:dropTable     → DROP TABLE / VIEW
//   db:export        → save table as CSV / JSON / SQL
//
// Every call opens and closes the database, so the UI never keeps a stale
// handle (or a WAL lock) around. Files are still validated as SQLite files.

"use strict";

const fs = require("fs");
const path = require("path");

const DB_EXTS = new Set([".db", ".db3", ".sqlite", ".sqlite3"]);
const PAGE_SIZE_MAX = 500;
const QUERY_ROW_LIMIT = 5000;
const EXPORT_ROW_LIMIT = 500000;
const ROWID_ALIAS = "__idiotbox_rowid__";
const COLUMN_TYPES = ["TEXT", "INTEGER", "REAL", "BLOB", "NUMERIC", "BOOLEAN", "DATE", "DATETIME", "TIMESTAMP"];

// ── Small helpers ──────────────────────────────────────────────────────────
const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;

const errorMessage = (err) => {
  if (!err) return "Unknown database error";
  const msg = String(err.message || err);
  if (/database is locked/i.test(msg)) {
    return "Database is locked by another process. Close it and try again.";
  }
  if (/file is not a database/i.test(msg)) {
    return "This file is not a valid SQLite database.";
  }
  if (/unable to open database file/i.test(msg)) {
    return "Could not open the database file. Check the path and permissions.";
  }
  return msg;
};

function assertDbPath(filePath, resolvePath) {
  if (!filePath || typeof filePath !== "string") throw new Error("No database file provided");
  if (!DB_EXTS.has(path.extname(filePath).toLowerCase())) {
    throw new Error("Not a SQLite database (.db, .db3, .sqlite, .sqlite3)");
  }
  const checkPath = typeof resolvePath === "function" ? resolvePath(filePath) : filePath;
  if (!fs.existsSync(checkPath)) throw new Error("Database file not found");
}

function openDb(dbPath, readOnly) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: !!readOnly });
  try { db.exec("PRAGMA busy_timeout = 3000"); } catch {}
  return db;
}

function closeDb(db) {
  try { db?.close(); } catch {}
}

function tableRecord(db, name) {
  return db.prepare(
    "SELECT name, type, sql FROM sqlite_master WHERE name = ? AND type IN ('table','view')"
  ).get(String(name || "")) || null;
}

function tableColumns(db, name) {
  return db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all().map((row) => ({
    cid: Number(row.cid),
    name: String(row.name),
    type: String(row.type || ""),
    notnull: !!Number(row.notnull),
    dflt: row.dflt_value == null ? null : String(row.dflt_value),
    pk: Number(row.pk || 0),
  }));
}

function listIndexes(db, name) {
  let indexes = [];
  try {
    indexes = db.prepare(`PRAGMA index_list(${quoteIdent(name)})`).all().map((row) => {
      let columns = [];
      try {
        columns = db.prepare(`PRAGMA index_info(${quoteIdent(row.name)})`).all()
          .map((c) => c.name).filter((c) => c != null);
      } catch {}
      return {
        name: String(row.name),
        unique: !!Number(row.unique),
        origin: String(row.origin || ""),
        columns,
      };
    });
  } catch {}
  return indexes;
}

// Find a stable way to address one row. Prefer SQLite's implicit rowid (works
// even for tables without a PK); fall back to the declared primary key.
function findRowKey(db, name, type, columns) {
  if (type !== "table") return { keyColumns: [], keyKind: null, rowidExpr: null };
  const lowered = new Set(columns.map((c) => c.name.toLowerCase()));
  for (const candidate of ["rowid", "_rowid_", "oid"]) {
    if (lowered.has(candidate)) continue;
    try {
      db.prepare(`SELECT ${candidate} AS ${quoteIdent(ROWID_ALIAS)} FROM ${quoteIdent(name)} LIMIT 1`).all();
      return { keyColumns: [ROWID_ALIAS], keyKind: "rowid", rowidExpr: candidate };
    } catch {}
  }
  const pk = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  if (pk.length) {
    return { keyColumns: pk.map((c) => c.name), keyKind: "pk", rowidExpr: null };
  }
  return { keyColumns: [], keyKind: null, rowidExpr: null };
}

function normalizeValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return String(value);
}

function buildSearch(columns, term) {
  const query = String(term || "").trim();
  if (!query || !columns.length) return { sql: "", params: [] };
  const parts = columns.map((c) =>
    `instr(lower(CAST(${quoteIdent(c.name)} AS TEXT)), lower(?)) > 0`
  );
  return { sql: ` WHERE (${parts.join(" OR ")})`, params: columns.map(() => query) };
}

function rowKeyOf(row, keyColumns) {
  const key = {};
  for (const column of keyColumns) key[column] = row?.[column];
  return key;
}

function buildKeyWhere(keyMeta, rowKey) {
  const columns = keyMeta.keyColumns || [];
  if (!columns.length) throw new Error("This object has no stable row key — editing is disabled");
  const key = rowKey || {};
  const parts = [];
  const params = [];
  for (const column of columns) {
    const value = normalizeValue(key[column]);
    if (column === ROWID_ALIAS) {
      if (value === undefined || value === null) throw new Error("Missing row id");
      parts.push(`${keyMeta.rowidExpr} = ?`);
      params.push(value);
    } else if (value === undefined) {
      throw new Error(`Missing key value for "${column}"`);
    } else if (value === null) {
      parts.push(`${quoteIdent(column)} IS NULL`);
    } else {
      parts.push(`${quoteIdent(column)} = ?`);
      params.push(value);
    }
  }
  return { sql: parts.join(" AND "), params };
}

function validateTableAndColumns(db, table) {
  const record = tableRecord(db, table);
  if (!record) throw new Error(`Table or view not found: ${table}`);
  const columns = tableColumns(db, table);
  if (!columns.length) throw new Error(`Could not read columns for "${table}"`);
  return { record, columns };
}

// ── Read APIs ──────────────────────────────────────────────────────────────
function listObjects(db, filePath) {
  const objects = db.prepare(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
  ).all().map((row) => ({ name: String(row.name), type: String(row.type) }));

  let file = { name: path.basename(filePath), path: filePath, size: 0, mtimeMs: 0 };
  try {
    const stat = fs.statSync(filePath);
    file = { ...file, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {}

  return { file, objects };
}

function getTableData(db, table, options = {}) {
  const { record, columns } = validateTableAndColumns(db, table);
  const keyMeta = findRowKey(db, table, record.type, columns);
  const search = buildSearch(columns, options.search);

  const total = Number(
    db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}${search.sql}`)
      .get(...search.params)?.c ?? 0
  );

  const requestedSize = Number(options.pageSize);
  const pageSize = Math.max(1, Math.min(PAGE_SIZE_MAX, Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : 100));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = Number(options.page);
  const page = Math.max(0, Math.min(pageCount - 1, Number.isFinite(requestedPage) ? requestedPage : 0));

  let orderBy = String(options.orderBy || "");
  if (!columns.some((c) => c.name === orderBy)) orderBy = "";
  const direction = String(options.orderDir || "").toLowerCase() === "desc" ? "DESC" : "ASC";
  const order = orderBy
    ? ` ORDER BY ${quoteIdent(orderBy)} ${direction}`
    : keyMeta.keyKind === "rowid" ? ` ORDER BY ${keyMeta.rowidExpr} ${direction}` : "";

  const selectKey = keyMeta.keyKind === "rowid"
    ? `${keyMeta.rowidExpr} AS ${quoteIdent(ROWID_ALIAS)}, `
    : "";
  const rows = db.prepare(
    `SELECT ${selectKey}* FROM ${quoteIdent(table)}${search.sql}${order} LIMIT ? OFFSET ?`
  ).all(...search.params, pageSize, page * pageSize);

  return {
    table: String(table),
    type: record.type,
    columns,
    rows,
    total,
    page,
    pageSize,
    pageCount,
    keyColumns: keyMeta.keyColumns,
    keyKind: keyMeta.keyKind,
    sql: String(record.sql || ""),
    indexes: record.type === "table" ? listIndexes(db, table) : [],
  };
}

function runQuery(db, sql) {
  const text = String(sql || "").trim();
  if (!text) throw new Error("Enter a SQL statement");

  // sqlite3_changes() is connection-wide: DDL/DROP after an INSERT can report
  // the previous statement's count. Only trust it for actual write statements.
  const stripped = text
    .replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, "")
    .trimStart();
  const first = (stripped.match(/^([A-Za-z]+)/)?.[1] || "").toUpperCase();
  const write = /^(INSERT|UPDATE|DELETE|REPLACE|WITH)$/.test(first);

  const started = Date.now();
  const stmt = db.prepare(text);
  const columnInfo = stmt.columns();
  if (columnInfo.length) {
    const rows = [];
    let truncated = false;
    for (const row of stmt.iterate()) {
      if (rows.length >= QUERY_ROW_LIMIT) { truncated = true; break; }
      rows.push(row);
    }
    return {
      columns: columnInfo.map((c) => ({ name: c.name, type: c.type || "" })),
      rows,
      rowCount: rows.length,
      truncated,
      changes: 0,
      write,
      durationMs: Date.now() - started,
    };
  }

  const info = stmt.run();
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    changes: write ? Number(info.changes || 0) : 0,
    write,
    lastInsertRowid: write && typeof info.lastInsertRowid === "bigint"
      ? info.lastInsertRowid.toString()
      : info.lastInsertRowid,
    durationMs: Date.now() - started,
  };
}

// ── Write APIs ─────────────────────────────────────────────────────────────
function updateCell(db, { table, key, column, value }) {
  const { record, columns } = validateTableAndColumns(db, table);
  if (record.type !== "table") throw new Error("Views are read-only");
  if (!columns.some((c) => c.name === column)) throw new Error(`Unknown column: ${column}`);
  const keyMeta = findRowKey(db, table, record.type, columns);
  const where = buildKeyWhere(keyMeta, key);
  const info = db.prepare(
    `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ? WHERE ${where.sql}`
  ).run(normalizeValue(value), ...where.params);
  return { changes: Number(info.changes || 0) };
}

function insertRow(db, { table, values }) {
  const { record, columns } = validateTableAndColumns(db, table);
  if (record.type !== "table") throw new Error("Views are read-only");
  const byName = new Map(columns.map((c) => [c.name, c]));
  const entries = [];
  for (const [column, value] of Object.entries(values || {})) {
    if (value === undefined) continue;
    if (!byName.has(column)) throw new Error(`Unknown column: ${column}`);
    entries.push([column, normalizeValue(value)]);
  }
  const info = entries.length
    ? db.prepare(
        `INSERT INTO ${quoteIdent(table)} (${entries.map(([c]) => quoteIdent(c)).join(", ")}) ` +
        `VALUES (${entries.map(() => "?").join(", ")})`
      ).run(...entries.map(([, v]) => v))
    : db.prepare(`INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`).run();
  return {
    changes: Number(info.changes || 0),
    lastInsertRowid: typeof info.lastInsertRowid === "bigint"
      ? info.lastInsertRowid.toString()
      : info.lastInsertRowid,
  };
}

function deleteRows(db, { table, keys }) {
  const { record, columns } = validateTableAndColumns(db, table);
  if (record.type !== "table") throw new Error("Views are read-only");
  const list = Array.isArray(keys) ? keys.slice(0, 500) : [];
  if (!list.length) throw new Error("No rows selected");
  const keyMeta = findRowKey(db, table, record.type, columns);
  const parts = [];
  const params = [];
  for (const key of list) {
    const where = buildKeyWhere(keyMeta, key);
    parts.push(`(${where.sql})`);
    params.push(...where.params);
  }
  const info = db.prepare(
    `DELETE FROM ${quoteIdent(table)} WHERE ${parts.join(" OR ")}`
  ).run(...params);
  return { changes: Number(info.changes || 0) };
}

// ── Schema APIs ────────────────────────────────────────────────────────────
function safeType(value) {
  const type = String(value || "TEXT").toUpperCase().trim();
  return COLUMN_TYPES.includes(type) ? type : "TEXT";
}

function safeDefault(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return "";
  if (/^(NULL|CURRENT_TIME|CURRENT_DATE|CURRENT_TIMESTAMP|TRUE|FALSE)$/i.test(text)) {
    return ` DEFAULT ${text.toUpperCase()}`;
  }
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return ` DEFAULT ${text}`;
  if (/^'(?:[^']|'')*'$/.test(text)) return ` DEFAULT ${text}`;
  return ` DEFAULT '${text.replace(/'/g, "''")}'`;
}

function createTable(db, { name, columns }) {
  const tableName = String(name || "").trim();
  if (!tableName) throw new Error("Enter a table name");
  if (tableRecord(db, tableName)) throw new Error(`"${tableName}" already exists`);

  const list = Array.isArray(columns) ? columns : [];
  if (!list.length) throw new Error("Add at least one column");
  const seen = new Set();
  const defs = [];
  const pkColumns = [];

  for (const col of list) {
    const colName = String(col?.name || "").trim();
    if (!colName) throw new Error("Every column needs a name");
    const lower = colName.toLowerCase();
    if (seen.has(lower)) throw new Error(`Duplicate column: ${colName}`);
    seen.add(lower);
    const type = safeType(col?.type);
    let def = `${quoteIdent(colName)} ${type}`;
    if (col?.pk) pkColumns.push(colName);
    if (col?.notnull) def += " NOT NULL";
    def += safeDefault(col?.dflt);
    defs.push(def);
  }

  if (pkColumns.length === 1) {
    const index = defs.findIndex((d) => d.startsWith(quoteIdent(pkColumns[0]) + " "));
    if (index >= 0) defs[index] += " PRIMARY KEY";
  } else if (pkColumns.length > 1) {
    defs.push(`PRIMARY KEY (${pkColumns.map(quoteIdent).join(", ")})`);
  }

  db.exec(`CREATE TABLE ${quoteIdent(tableName)} (${defs.join(", ")})`);
  return { name: tableName };
}

function dropObject(db, { table }) {
  const record = tableRecord(db, table);
  if (!record) throw new Error(`Table or view not found: ${table}`);
  db.exec(`DROP ${record.type === "view" ? "VIEW" : "TABLE"} ${quoteIdent(table)}`);
  return { name: String(table), type: record.type };
}

// ── Export ─────────────────────────────────────────────────────────────────
const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const sqlLiteral = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
};

const jsonValue = (value) => {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (value instanceof Uint8Array) {
    return { $blob: Buffer.from(value).toString("base64") };
  }
  return value;
};

function exportTableToFile(db, table, format, outPath) {
  const { record, columns } = validateTableAndColumns(db, table);
  const names = columns.map((c) => c.name);
  const stmt = db.prepare(`SELECT * FROM ${quoteIdent(table)}`);
  const fmt = String(format || "csv").toLowerCase();
  const fd = fs.openSync(outPath, "w");
  let rows = 0;

  try {
    if (fmt === "json") {
      fs.writeSync(fd, "[\n");
      for (const row of stmt.iterate()) {
        if (rows >= EXPORT_ROW_LIMIT) break;
        const obj = {};
        for (const name of names) obj[name] = jsonValue(row[name]);
        fs.writeSync(fd, (rows ? ",\n" : "") + "  " + JSON.stringify(obj));
        rows++;
      }
      fs.writeSync(fd, rows ? "\n]\n" : "]\n");
    } else if (fmt === "sql") {
      if (record.type === "view") throw new Error("SQL export is only available for tables");
      fs.writeSync(fd, `-- Idiot Box export · ${table}\n-- ${new Date().toISOString()}\n\n`);
      fs.writeSync(fd, `${record.sql || `CREATE TABLE ${quoteIdent(table)} (...)`};\n\n`);
      fs.writeSync(fd, `BEGIN TRANSACTION;\n`);
      for (const row of stmt.iterate()) {
        if (rows >= EXPORT_ROW_LIMIT) break;
        fs.writeSync(
          fd,
          `INSERT INTO ${quoteIdent(table)} (${names.map(quoteIdent).join(", ")}) VALUES (${names.map((n) => sqlLiteral(row[n])).join(", ")});\n`
        );
        rows++;
      }
      fs.writeSync(fd, "COMMIT;\n");
    } else {
      fs.writeSync(fd, names.map(csvCell).join(",") + "\n");
      for (const row of stmt.iterate()) {
        if (rows >= EXPORT_ROW_LIMIT) break;
        fs.writeSync(fd, names.map((name) => csvCell(row[name])).join(",") + "\n");
        rows++;
      }
    }
  } finally {
    try { fs.closeSync(fd); } catch {}
  }

  return { rows, truncated: rows >= EXPORT_ROW_LIMIT, path: outPath, format: fmt };
}

// ── IPC registration ───────────────────────────────────────────────────────
function registerDbManager({ ipcMain, dialog, BrowserWindow, toLongPath }) {
  const longPath = typeof toLongPath === "function" ? toLongPath : (p) => p;

  const handle = (channel, readOnly, fn) => {
    ipcMain.handle(channel, async (event, payload) => {
      let db = null;
      try {
        const filePath = typeof payload === "string" ? payload : payload?.filePath;
        assertDbPath(filePath, longPath);
        db = openDb(longPath(filePath), readOnly);
        return await fn({ db, payload, event, filePath, dialog, BrowserWindow });
      } catch (err) {
        return { error: errorMessage(err) };
      } finally {
        closeDb(db);
      }
    });
  };

  handle("db:list", true, ({ db, payload, filePath }) => listObjects(db, filePath));

  handle("db:table", true, ({ db, payload }) =>
    getTableData(db, payload?.table, payload || {})
  );

  handle("db:query", false, ({ db, payload }) => runQuery(db, payload?.sql));

  handle("db:updateCell", false, ({ db, payload }) => updateCell(db, payload || {}));

  handle("db:insertRow", false, ({ db, payload }) => insertRow(db, payload || {}));

  handle("db:deleteRows", false, ({ db, payload }) => deleteRows(db, payload || {}));

  handle("db:createTable", false, ({ db, payload }) => createTable(db, payload || {}));

  handle("db:dropTable", false, ({ db, payload }) => dropObject(db, payload || {}));

  handle("db:export", false, async ({ db, payload, event, dialog, BrowserWindow }) => {
    const table = String(payload?.table || "");
    const format = String(payload?.format || "csv").toLowerCase();
    if (!["csv", "json", "sql"].includes(format)) throw new Error("Unsupported export format");
    validateTableAndColumns(db, table);

    const win = BrowserWindow?.fromWebContents?.(event.sender);
    const safeName = table.replace(/[\\/:*?"<>|]+/g, "_");
    const filters = format === "csv"
      ? [{ name: "CSV", extensions: ["csv"] }]
      : format === "json"
        ? [{ name: "JSON", extensions: ["json"] }]
        : [{ name: "SQL", extensions: ["sql"] }];
    const result = await dialog.showSaveDialog(win || undefined, {
      title: `Export ${table}`,
      defaultPath: `${safeName}.${format}`,
      filters,
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return exportTableToFile(db, table, format, result.filePath);
  });
}

module.exports = {
  registerDbManager,
  // Exported for tests / reuse.
  listObjects,
  getTableData,
  runQuery,
  updateCell,
  insertRow,
  deleteRows,
  createTable,
  dropObject,
  exportTableToFile,
};
