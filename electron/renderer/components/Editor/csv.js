// csv.js — dependency-free delimiter/writer helpers for the editor's CSV preview.

export const CSV_MAX_ROWS = 500;
export const CSV_MAX_COLS = 80;

const CANDIDATES = [",", ";", "\t", "|"];

export function detectDelimiter(text) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const counts = Object.create(null);
  for (const d of CANDIDATES) counts[d] = 0;

  let inQuotes = false;
  let rows = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === "\n") {
      rows++;
      if (rows >= 20) break;
      continue;
    }
    if (ch in counts) counts[ch]++;
  }

  let best = ",";
  for (const d of CANDIDATES) {
    if (counts[d] > counts[best]) best = d;
  }
  return best;
}

export function parseDelimited(text, delimiter, maxRows = Infinity) {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const sep = delimiter || ",";
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let truncated = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (ch === sep) {
      pushField();
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      pushRow();
      if (rows.length >= maxRows) {
        truncated = src.slice(i + 1).trim().length > 0;
        break;
      }
      continue;
    }
    field += ch;
  }

  if (!truncated && (field !== "" || row.length > 0)) pushRow();

  while (rows.length) {
    const last = rows[rows.length - 1];
    if (last.length === 0 || last.every((cell) => cell === "")) rows.pop();
    else break;
  }

  return { rows, truncated };
}

export function delimiterLabel(delimiter) {
  if (delimiter === "\t") return "Tab";
  if (delimiter === ";") return "Semicolon";
  if (delimiter === "|") return "Pipe";
  return "Comma";
}
