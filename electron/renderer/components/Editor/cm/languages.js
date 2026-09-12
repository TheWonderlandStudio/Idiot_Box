// cm/languages.js — extension/filename se language + CodeMirror support.
//
// Plain mapping: file extension (ya well-known filename) -> canonical id ->
// language extension. Koi content-sniffing, registry lookup ya snippet
// merging nahi — jo language package deta hai (keywords, tags, local
// completions) wahi milta hai.

import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { php } from "@codemirror/lang-php";
import { rust } from "@codemirror/lang-rust";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";

export const CM_LANG_IDS = [
  "plaintext", "javascript", "jsx", "typescript", "tsx", "json",
  "html", "css", "python", "java", "cpp", "php", "rust",
  "markdown", "sql", "xml", "yaml",
];

const EXT_MAP = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx", ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  json: "json", jsonc: "json", ipynb: "json",
  html: "html", htm: "html", vue: "html", svelte: "html", astro: "html",
  css: "css", scss: "css", sass: "css", less: "css",
  py: "python", pyw: "python",
  java: "java",
  c: "cpp", h: "cpp", cpp: "cpp", hpp: "cpp", cc: "cpp", cxx: "cpp", ino: "cpp",
  php: "php",
  rs: "rust",
  md: "markdown", markdown: "markdown", mdown: "markdown",
  sql: "sql",
  xml: "xml", xsl: "xml", svg: "xml",
  yaml: "yaml", yml: "yaml",
};

const FILENAME_MAP = {
  dockerfile: "plaintext", containerfile: "plaintext",
  makefile: "plaintext", gnumakefile: "plaintext", jenkinsfile: "plaintext",
  vagrantfile: "plaintext", gemfile: "plaintext", rakefile: "plaintext",
};

const DISPLAY_NAMES = {
  plaintext: "Plain Text", javascript: "JavaScript", jsx: "JavaScript React",
  typescript: "TypeScript", tsx: "TypeScript React", json: "JSON",
  html: "HTML", css: "CSS", python: "Python", java: "Java", cpp: "C++",
  php: "PHP", rust: "Rust", markdown: "Markdown", sql: "SQL",
  xml: "XML", yaml: "YAML",
};

const baseName = (p) => { try { return String(p || "").split(/[\\/]/).pop() || ""; } catch { return ""; } };
const extOf = (p) => {
  try {
    const b = baseName(p);
    const i = b.lastIndexOf(".");
    return i > 0 ? b.slice(i + 1).toLowerCase() : "";
  } catch { return ""; }
};

// filePath -> canonical id (unknown -> plaintext).
export const resolveCmLanguage = (filePath) => {
  const base = baseName(filePath).toLowerCase();
  if (base && FILENAME_MAP[base]) return FILENAME_MAP[base];
  for (const [k, v] of Object.entries(FILENAME_MAP)) {
    if (base === k || base.startsWith(k + ".")) return v;
  }
  const e = extOf(filePath);
  if (e && EXT_MAP[e]) return EXT_MAP[e];
  return "plaintext";
};

export const displayNameFor = (cmId) => DISPLAY_NAMES[cmId] || cmId || "Plain Text";

// Language package jo deta hai wahi — koi extra merging nahi.
export const getLanguageSupport = (cmId) => {
  switch (cmId) {
    case "javascript": return [javascript({ jsx: false, typescript: false })];
    case "jsx":        return [javascript({ jsx: true })];
    case "typescript": return [javascript({ typescript: true })];
    case "tsx":        return [javascript({ jsx: true, typescript: true })];
    case "json":       return [json()];
    case "html":       return [html()];
    case "css":        return [css()];
    case "python":     return [python()];
    case "java":       return [java()];
    case "cpp":        return [cpp()];
    case "php":        return [php()];
    case "rust":       return [rust()];
    case "markdown":   return [markdown()];
    case "sql":        return [sql()];
    case "xml":        return [xml()];
    case "yaml":       return [yaml()];
    default:           return [];
  }
};
