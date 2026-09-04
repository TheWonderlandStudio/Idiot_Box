// languageDetect.mjs — pure, dependency-free language auto-detection.
//
// Used by the Editor panel when the filename gives no answer (unknown/missing
// extension → service + fallback map both say "plaintext"). Inspects a head
// slice of the text for shebangs, editor modelines, magic markers and
// distinctive syntax, and returns { id, confidence, reason } or null.
//
// Pure ESM with no vscode/monaco imports so it can be unit-tested with plain
// node:  node electron/renderer/components/Editor/languageDetect.test.mjs

// Single source of truth for language ids the editor can actually highlight
// (every id here has a TextMate grammar bundled via a default-extension).
export const LANG_OPTIONS = [
  "plaintext", "javascript", "javascriptreact", "typescript", "typescriptreact",
  "json", "jsonc", "html", "css", "scss", "less", "markdown", "markdown-math",
  "restructuredtext", "python",
  "java", "csharp", "cpp", "c", "go", "rust", "php", "ruby", "sql",
  "xml", "yaml", "shellscript", "bat", "powershell", "ini", "properties",
  "coffeescript", "dart", "fsharp", "groovy", "handlebars", "julia", "juliamarkdown",
  "lua", "objective-c", "objective-cpp", "perl", "raku", "r", "razor",
  "swift", "vb", "clojure", "jade", "diff", "shaderlab",
  "dockerfile", "makefile", "log",
];

const KNOWN = new Set(LANG_OPTIONS);
export const isKnownLanguageId = (id) => KNOWN.has(id);

// Modeline aliases (vim ft= / emacs mode:) → canonical language id.
const MODELINE_ALIASES = {
  text: "plaintext", fundamental: "plaintext",
  python: "python", py: "python",
  javascript: "javascript", js: "javascript",
  javascriptreact: "javascriptreact", jsx: "javascriptreact",
  typescript: "typescript", ts: "typescript",
  typescriptreact: "typescriptreact", tsx: "typescriptreact",
  json: "json", jsonc: "jsonc", html: "html", css: "css",
  scss: "scss", sass: "scss", less: "less",
  markdown: "markdown", md: "markdown", rst: "restructuredtext",
  restructuredtext: "restructuredtext", log: "log", diff: "diff",
  java: "java", csharp: "csharp", cs: "csharp", "c#": "csharp",
  cpp: "cpp", "c++": "cpp", cc: "cpp", c: "c", h: "c",
  go: "go", rust: "rust", rs: "rust", php: "php",
  ruby: "ruby", rb: "ruby", sql: "sql",
  xml: "xml", yaml: "yaml", yml: "yaml",
  shellscript: "shellscript", sh: "shellscript", bash: "shellscript",
  shell: "shellscript", bat: "bat", dosbatch: "bat",
  powershell: "powershell", ps1: "powershell",
  ini: "ini", properties: "properties", conf: "ini",
  coffee: "coffeescript", coffeescript: "coffeescript",
  dart: "dart", fsharp: "fsharp", fs: "fsharp",
  groovy: "groovy", handlebars: "handlebars", hbs: "handlebars",
  julia: "julia", jl: "julia", lua: "lua",
  "objective-c": "objective-c", objc: "objective-c",
  "objective-cpp": "objective-cpp", objcpp: "objective-cpp",
  perl: "perl", pl: "perl", raku: "raku", r: "r",
  razor: "razor", swift: "swift", vb: "vb", visualbasic: "vb",
  clojure: "clojure", clj: "clojure", jade: "jade", pug: "jade",
  shaderlab: "shaderlab", dockerfile: "dockerfile", docker: "dockerfile",
  makefile: "makefile", make: "makefile",
};

// Shebang interpreter (basename, lowercased) → language id.
const SHEBANG_MAP = [
  [/^pythonw?[\d.]*$/, "python"],
  [/^(node|nodejs|bun|deno)$/, "javascript"],
  [/^(ba|da|z|fi)?sh$/, "shellscript"],
  [/^ruby$/, "ruby"],
  [/^perl$/, "perl"],
  [/^php$/, "php"],
  [/^lua(luajit)?$/, "lua"],
  [/^(pwsh|powershell)$/, "powershell"],
  [/^(rscript|r)$/, "r"],
  [/^groovy$/, "groovy"],
  [/^swift$/, "swift"],
  [/^dart$/, "dart"],
  [/^julia$/, "julia"],
];

// Medium-confidence syntax fingerprints: [RegExp, languageId, reason].
// Tested against the head slice only. Ordered most-specific-first.
const CONTENT_RULES = [
  [/^\s*\(\s*(ns|defn|defmacro)\s+/m, "clojure", "Clojure (ns/defn) form"],
  [/<\?php\b/, "php", "<?php tag"],
  [/^@echo\s+off/im, "bat", "@echo off"],
  [/^#import\s+</m, "objective-c", "#import directive"],
  [/@(?:implementation|interface)\s+\w+/, "objective-c", "@implementation block"],
  [/@page\b|@model\s+[\w.<>]+/, "razor", "Razor @page/@model"],
  [/^doctype\s+html/im, "jade", "doctype html (Pug/Jade)"],
  [/\{\{[#/>!]?\s*[\w@.]+/, "handlebars", "{{…}} template tags"],
  [/^\s*local\s+function\b/m, "lua", "local function"],
  [/\brequire\s*\(\s*['"][\w./-]+['"]\s*\)/, "lua", "require('…') call"],
  [/\bmy\s+\$\w+/, "perl", "my $variable"],
  [/\buse\s+(strict|warnings)\s*;/, "perl", "use strict"],
  [/\blibrary\s*\(\s*['"]?\w+/, "r", "library(…) call"],
  [/\w+\s*<-\s*\S/, "r", "<- assignment"],
  [/Write-Host\b|\$PSVersionTable\b/, "powershell", "PowerShell automatic variable"],
  [/^\s*param\s*\(/m, "powershell", "param(…) block"],
  [/import\s+(UIKit|SwiftUI|Foundation|Combine)\b/, "swift", "Apple framework import"],
  [/struct\s+\w+\s*:\s*(View|App)\b/, "swift", "SwiftUI View/App struct"],
  [/import\s+['"]package:flutter/, "dart", "Flutter package import"],
  [/extends\s+(StatelessWidget|StatefulWidget)\b/, "dart", "Flutter widget class"],
  [/public\s+static\s+void\s+main\b/, "java", "public static void main"],
  [/System\.out\.print/, "java", "System.out.print"],
  [/using\s+System\s*;/, "csharp", "using System;"],
  [/Console\.(WriteLine|Write|ReadLine)\s*\(/, "csharp", "Console.*(…) call"],
  [/^\s*package\s+main\b/m, "go", "package main"],
  [/\bfn\s+main\s*\(\s*\)/, "rust", "fn main()"],
  [/\blet\s+mut\s+\w+/, "rust", "let mut binding"],
  [/#include\s*<[^>\n]+>/, "cpp", "#include <…>"],
  [/\b(SELECT\b[\s\S]{0,400}?\bFROM\b|INSERT\s+INTO\b|CREATE\s+TABLE\b|UPDATE\s+\w+\s+SET\b)/i, "sql", "SQL statement"],
  [/^\s*def\s+\w+.*:\s*$/m, "python", "def …: block"],
  [/^\s*(def|class|module)\s+\w+[\s\S]*?\nend\s*$/m, "ruby", "def/class…end block"],
  [/^\s*(if\s+\[|then\s*$|fi\s*$|function\s+\w+\s*\(\s*\)|export\s+\w+=)/m, "shellscript", "shell construct"],
  [/^\s*def\s+\w+\s*=\s*\{/m, "groovy", "def x = { closure"],
  [/^\s*(pipeline|node|stage)\s*[\(\{]/m, "groovy", "Jenkins pipeline DSL"],
  [/^\s*\w[\w-]*\s*=\s*\([^)]*\)\s*->/m, "coffeescript", "CoffeeScript arrow"],
  [/(^\s*End\s+(Sub|Function|If)\b|\bDim\s+\w+\s+As\s+\w+|\bAs\s+(String|Integer|Long|Boolean|Object|Variant)\b)/im, "vb", "VB block keyword"],
  [/^\s*(function\s+\w+|mutable\s+struct\s+\w+|using\s+[A-Z]\w*)/m, "julia", "Julia syntax"],
  [/^@@\s+-\d+([,]\d+)?\s+\+\d+([,]\d+)?\s+@@/m, "diff", "unified diff hunk"],
  [/```\w*\n[\s\S]*?\n```/, "markdown", "fenced code block"],
  [/(^|\n)#{1,6}\s+\S[^\n]*\n[^\n]*\[.+?\]\(.+?\)/, "markdown", "heading + link"],
  [/\.\.\s+\w+::/, "restructuredtext", "reST directive"],
];

const countMatches = (re, text) => {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let n = 0;
  while (g.exec(text) !== null && ++n <= 5) { /* count up to 5 */ }
  return n;
};

/**
 * Detect the language of `text`. Returns { id, confidence, reason } or null.
 * Only ever returns ids present in LANG_OPTIONS.
 */
export function detectLanguageFromContent(text) {
  if (!text || typeof text !== "string") return null;
  const slice = text.length > 65536 ? text.slice(0, 65536) : text;
  if (!slice.trim()) return null;
  const lines = slice.split("\n", 80);
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);

  // ── 1) Shebang ──────────────────────────────────────────────────────────
  const first = (lines[0] || "").trim();
  if (first.startsWith("#!")) {
    const parts = first.slice(2).trim().split(/\s+/).filter(Boolean);
    let interp = (parts[0] || "").split("/").pop().toLowerCase();
    // `#!/usr/bin/env python3` / `#!/usr/bin/env -S node`
    if ((interp === "env" || interp === "-S") && parts[1]) {
      interp = parts[1].split("/").pop().toLowerCase();
      if (interp === "-S" && parts[2]) interp = parts[2].split("/").pop().toLowerCase();
    }
    for (const [re, id] of SHEBANG_MAP) {
      if (re.test(interp)) return { id, confidence: "high", reason: `shebang (#!/…/${interp})` };
    }
  }

  // ── 2) Editor modelines (first 5 + last 5 lines) ────────────────────────
  const edgeLines = [...lines.slice(0, 5), ...lines.slice(-5)];
  for (const raw of edgeLines) {
    const line = raw.trim();
    // Emacs: -*- mode: python -*-  or  -*- sh -*-
    let m = line.match(/-\*-\s*(?:mode\s*:\s*)?([A-Za-z][\w#+.-]*)\s*-\*-/);
    // Vim: vim: set ft=python :  /  vi: filetype=ruby
    if (!m) m = line.match(/(?:vi|vim|ex)\s*:[^:]*\b(?:ft|filetype|syntax)=([A-Za-z][\w#+.-]*)/);
    if (m) {
      const alias = m[1].toLowerCase().replace(/-mode$/, "");
      const id = MODELINE_ALIASES[alias];
      if (id && KNOWN.has(id)) {
        return { id, confidence: "high", reason: `modeline (${m[1]})` };
      }
    }
  }

  // ── 3) Magic markers ────────────────────────────────────────────────────
  const head = nonEmpty.slice(0, 10).join("\n");
  if (/^<\?xml[\s?>]/i.test(nonEmpty[0] || "")) {
    return { id: "xml", confidence: "high", reason: "XML prolog" };
  }
  if (/^<!doctype\s+html/i.test(nonEmpty[0] || "") || /^<html[\s>]/i.test(nonEmpty[0] || "")) {
    return { id: "html", confidence: "high", reason: "HTML doctype" };
  }

  // ── 4) Dockerfile / Makefile structure ──────────────────────────────────
  const firstCode = nonEmpty.find((l) => !l.startsWith("#")) || "";
  if (/^FROM\s+\S+/i.test(firstCode) && /^(RUN|CMD|ENTRYPOINT|COPY|ADD|WORKDIR|EXPOSE|ENV|ARG|LABEL)\b/im.test(slice)) {
    return { id: "dockerfile", confidence: "medium", reason: "FROM image + build steps" };
  }
  const targetLine = lines.some((l) => {
    if (!/^[\w][\w\s.,%/()${}-]*::?[^:=]*$/.test(l)) return false;
    return true;
  });
  const recipeLines = lines.filter((l) => /^\t+\S/.test(l)).length;
  if (targetLine && recipeLines >= 1) {
    return { id: "makefile", confidence: "medium", reason: "target: + tab-indented recipe" };
  }

  // ── 5) JSON (before INI: a doc starting with `[` may be a JSON array) ────
  const trimmed = slice.trim();
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && text.length <= 262144) {
    try {
      JSON.parse(text.length > 65536 ? text : trimmed);
      return { id: "json", confidence: "medium", reason: "valid JSON document" };
    } catch { /* not JSON */ }
  }

  // INI-style section headers (2+), before the generic rule list.
  if (countMatches(/^\s*\[[^\]\n]+\]\s*$/gm, slice) >= 2 && !/^[\s{(]/.test(trimmed)) {
    // Avoid misfiring on INI-looking fragments inside code: require that a
    // decent share of non-empty lines are headers or key=value pairs.
    const kv = countMatches(/^\s*[\w.-]+\s*=/gm, slice);
    if (kv >= 1) return { id: "ini", confidence: "medium", reason: "[sections] + key=value" };
  }

  // Timestamped lines (3+) → log file.
  if (countMatches(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/gm, slice) >= 3) {
    return { id: "log", confidence: "medium", reason: "timestamped lines" };
  }

  // ── 6) Syntax fingerprints ──────────────────────────────────────────────
  for (const [re, id, reason] of CONTENT_RULES) {
    try {
      if (re.test(head.length > 20000 ? head : slice)) {
        if (KNOWN.has(id)) return { id, confidence: "medium", reason };
      }
    } catch { /* bad pattern — skip */ }
  }

  return null;
}

/** C vs C++ disambiguation for `.h` headers based on content. */
export function sniffCHeader(text) {
  if (!text || typeof text !== "string") return "c";
  const slice = text.length > 65536 ? text.slice(0, 65536) : text;
  return /\b(class|namespace|template\s*<|typename|std::|iostream|constexpr|noexcept|override|new\s+\w+\s*\[|delete\s*(\[\])?)\b/.test(slice)
    ? "cpp"
    : "c";
}
