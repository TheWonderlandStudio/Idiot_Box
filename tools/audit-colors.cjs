#!/usr/bin/env node
/**
 * Audit hard-coded colors outside the central token sheet.
 * Prints every literal, how many times it appears, and whether an exact
 * token already exists in variables.css.
 *
 * Run: node tools/audit-colors.cjs [--json]
 */
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const renderer = path.join(root, "electron", "renderer")

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch)\(\s*(?=[0-9.+#a-z-])[^)]*\)/g
const norm = (v) => v.replace(/\s+/g, "").toLowerCase()

// ── token values from the central sheet ────────────────────────────────────
const css = fs.readFileSync(path.join(renderer, "variables.css"), "utf8")
const tokenByValue = new Map()
for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
  const key = m[1]
  const value = m[2].trim()
  if (!/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\()/i.test(value)) continue
  const n = norm(value)
  if (!tokenByValue.has(n)) tokenByValue.set(n, [])
  tokenByValue.get(n).push(key)
}

// ── walk renderer ──────────────────────────────────────────────────────────
const skip = /(\\|\/)(chunks|node_modules|theme)(\\|\/)|\b(bundle|settings-bundle)[^\\/]*$|variables\.css$|tokens\.generated\.js$|ai-tw-css\.js$/
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(jsx?|css)$/.test(entry.name) && !skip.test(full)) files.push(full)
  }
}
walk(renderer)

const counts = new Map()
const byFile = new Map()
for (const file of files) {
  let text = fs.readFileSync(file, "utf8")
  text = text.replace(/\/\*[\s\S]*?\*\//g, "")
  if (/\.jsx?$/.test(file)) text = text.replace(/\/\/[^\n]*/g, "")
  const matches = text.match(COLOR_RE)
  if (!matches) continue
  const rel = path.relative(root, file).replace(/\\/g, "/")
  byFile.set(rel, matches.length)
  for (const raw of matches) {
    const key = norm(raw)
    const entry = counts.get(key) || { raw, count: 0, files: new Set() }
    entry.count++
    entry.files.add(rel)
    counts.set(key, entry)
  }
}

const rows = [...counts.entries()]
  .map(([key, e]) => ({
    value: e.raw,
    count: e.count,
    files: e.files.size,
    tokens: tokenByValue.get(key) || [],
  }))
  .sort((a, b) => b.count - a.count)

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ files: Object.fromEntries(byFile), rows }, null, 2))
} else {
  const total = rows.reduce((n, r) => n + r.count, 0)
  const mapped = rows.filter((r) => r.tokens.length).reduce((n, r) => n + r.count, 0)
  console.log(`files: ${files.length}  literals: ${total}  unique: ${rows.length}`)
  console.log(`already tokenizable (exact value): ${mapped} occurrences / ${rows.filter((r) => r.tokens.length).length} unique\n`)
  for (const r of rows) {
    const t = r.tokens.length ? ` -> ${r.tokens.join(", ")}` : ""
    console.log(`${String(r.count).padStart(4)}  ${r.value.padEnd(34)} ${String(r.files).padStart(2)}f${t}`)
  }
  console.log("\nper file:")
  for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(4)}  ${f}`)
  }
}
