// cm/languages.js — language detection + CodeMirror language support.
//
// Detection do-step hai (purane Editor jaisa):
//   1. static EXT_MAP (extension / well-known filenames)
//   2. content sniffing (./languageDetect.mjs — shebang/modeline/fingerprints,
//      monaco-style id deta hai -> MONACO_TO_CM se map)
// Display name ke liye @codemirror/language-data registry dekhte hain
// (l.extensions / l.filename — defensive access, kuch entries me ye fields
// missing hote hain) aur fallback me static map.
//
// Canonical CM ids: plaintext javascript jsx typescript tsx json html css
// python java cpp php rust markdown sql xml yaml

import { javascript, javascriptLanguage, jsxLanguage, typescriptLanguage, tsxLanguage } from "@codemirror/lang-javascript";
// NOTE: javascript()/jsx/etc. LanguageSupport return karte hain — unpar .data
// UNDEFINED hai. data.of() hamesha Language instance par lagao
// (javascriptLanguage/jsxLanguage/...) warna TypeError (pehle silently
// swallow ho raha tha aur JS/TS snippets gayab the).
import { python, pythonLanguage } from "@codemirror/lang-python";
import { java, javaLanguage } from "@codemirror/lang-java";
import { cpp, cppLanguage } from "@codemirror/lang-cpp";
import { html, htmlLanguage } from "@codemirror/lang-html";
import { css, cssLanguage } from "@codemirror/lang-css";
import { json, jsonLanguage } from "@codemirror/lang-json";
import { php, phpLanguage } from "@codemirror/lang-php";
import { rust, rustLanguage } from "@codemirror/lang-rust";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { sql, StandardSQL } from "@codemirror/lang-sql";
import { xml, xmlLanguage } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { languages as cmRegistry } from "@codemirror/language-data";
import { autocompletion } from "@codemirror/autocomplete";
import { detectLanguageFromContent } from "../languageDetect.mjs";
import { snippetSourceFor } from "./snippets.js";
import { jsGlobalCompletion } from "./globals.js";

export const CM_LANG_IDS = [
  "plaintext", "javascript", "jsx", "typescript", "tsx", "json",
  "html", "css", "python", "java", "cpp", "php", "rust",
  "markdown", "sql", "xml", "yaml",
];

const EXT_MAP = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx", ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript",
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

// languageDetect.mjs (monaco-style ids) -> canonical CM ids.
const MONACO_TO_CM = {
  plaintext: "plaintext",
  javascript: "javascript", javascriptreact: "jsx",
  typescript: "typescript", typescriptreact: "tsx",
  json: "json", jsonc: "json", html: "html",
  css: "css", scss: "css", less: "css",
  markdown: "markdown", "markdown-math": "markdown", restructuredtext: "plaintext",
  python: "python", java: "java", csharp: "plaintext", cpp: "cpp", c: "cpp",
  go: "plaintext", rust: "rust", php: "php", ruby: "plaintext", sql: "sql",
  xml: "xml", yaml: "yaml", shellscript: "plaintext", bat: "plaintext",
  powershell: "plaintext", ini: "plaintext", properties: "plaintext",
  coffeescript: "plaintext", dart: "plaintext", fsharp: "plaintext",
  groovy: "plaintext", handlebars: "plaintext", julia: "plaintext",
  juliamarkdown: "markdown", lua: "plaintext", "objective-c": "plaintext",
  "objective-cpp": "plaintext", perl: "plaintext", raku: "plaintext",
  r: "plaintext", razor: "plaintext", swift: "plaintext", vb: "plaintext",
  clojure: "plaintext", jade: "plaintext", diff: "plaintext",
  shaderlab: "plaintext", dockerfile: "plaintext", makefile: "plaintext",
  log: "plaintext",
};

const baseName = (p) => { try { return String(p || "").split(/[\\/]/).pop() || ""; } catch { return ""; } };
const extOf = (p) => {
  try {
    const b = baseName(p);
    const i = b.lastIndexOf(".");
    return i > 0 ? b.slice(i + 1).toLowerCase() : "";
  } catch { return ""; }
};

// filePath + (optional) text -> { id, auto, reason }
export const resolveCmLanguage = (filePath, text) => {
  const base = baseName(filePath).toLowerCase();
  if (base && FILENAME_MAP[base]) return { id: FILENAME_MAP[base], auto: false, reason: "filename" };
  // Dockerfile.foo / Makefile.foo jaise prefixed names
  for (const [k, v] of Object.entries(FILENAME_MAP)) {
    if (base === k || base.startsWith(k + ".")) return { id: v, auto: false, reason: "filename" };
  }
  const e = extOf(filePath);
  if (e && EXT_MAP[e]) return { id: EXT_MAP[e], auto: false, reason: "extension" };
  if (text) {
    try {
      const hit = detectLanguageFromContent(text);
      if (hit && hit.id && hit.id !== "plaintext") {
        return { id: MONACO_TO_CM[hit.id] || "plaintext", auto: true, reason: hit.reason };
      }
    } catch {}
  }
  return { id: "plaintext", auto: false, reason: e ? "unknown extension" : "no extension" };
};

// ── Display names: registry pehle (defensive), phir static fallback ──
const STATIC_NAMES = {
  plaintext: "Plain Text", javascript: "JavaScript", jsx: "JavaScript React",
  typescript: "TypeScript", tsx: "TypeScript React", json: "JSON",
  html: "HTML", css: "CSS", python: "Python", java: "Java", cpp: "C++",
  php: "PHP", rust: "Rust", markdown: "Markdown", sql: "SQL",
  xml: "XML", yaml: "YAML",
};

const registryNameFor = (cmId, filePath) => {
  try {
    const e = extOf(filePath);
    const b = baseName(filePath).toLowerCase();
    for (const l of cmRegistry || []) {
      if (!l || typeof l !== "object") continue;
      const exts = Array.isArray(l.extensions) ? l.extensions : [];
      const files = Array.isArray(l.filename) ? l.filename : [];
      const aliases = Array.isArray(l.alias) ? l.alias : [];
      if ((e && exts.some((x) => String(x || "").toLowerCase() === e)) ||
          (b && files.some((x) => String(x || "").toLowerCase() === b))) {
        if (l.name) return String(l.name);
      }
      // cm id se alias match (e.g. "python" alias)
      if (aliases.some((a) => String(a || "").toLowerCase() === String(cmId).toLowerCase()) && l.name) {
        return String(l.name);
      }
    }
  } catch {}
  return null;
};

export const displayNameFor = (cmId, filePath) =>
  registryNameFor(cmId, filePath) || STATIC_NAMES[cmId] || cmId || "Plain Text";

// ── Language support (extensions) ────────────────────────────────────
// data.of({ autocomplete }) sirf wahan jahan Language instance hai —
// sql aur yaml me koi Language instance export NAHI hota, isliye wahan
// snippets language-swap ke sath plain source ki tarah lagte hain.
// langSupport: LanguageSupport, langObj: uska Language instance (data.of ke liye).
const withSnippets = (langSupport, langObj, langId, useSnippets) => {
  if (!useSnippets) return [langSupport];
  const src = snippetSourceFor(langId);
  if (!src || !langObj || typeof langObj.data?.of !== "function") return [langSupport];
  try {
    return [langSupport, langObj.data.of({ autocomplete: src })];
  } catch {
    return [langSupport];
  }
};

// Chaaro JS dialects base javascriptLanguage ka data inherit karte hain,
// isliye global scope ek baar yahin lagta hai (keywords/snippets ke sath merge).
const withJsGlobals = (arr) => {
  try {
    const src = jsGlobalCompletion();
    if (src) arr.push(javascriptLanguage.data.of({ autocomplete: src }));
  } catch {}
  return arr;
};

export const getLanguageSupport = (cmId, { useSnippets = true } = {}) => {
  switch (cmId) {
    case "javascript": {
      return withJsGlobals(withSnippets(javascript({ jsx: false, typescript: false }), javascriptLanguage, "javascript", useSnippets));
    }
    case "jsx": {
      return withJsGlobals(withSnippets(javascript({ jsx: true }), jsxLanguage, "jsx", useSnippets));
    }
    case "typescript": {
      return withJsGlobals(withSnippets(javascript({ typescript: true }), typescriptLanguage, "typescript", useSnippets));
    }
    case "tsx": {
      return withJsGlobals(withSnippets(javascript({ jsx: true, typescript: true }), tsxLanguage, "tsx", useSnippets));
    }
    case "json": {
      const lang = json();
      if (useSnippets) {
        const src = snippetSourceFor("json");
        if (src) {
          try { return [lang, jsonLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    case "html": {
      const lang = html();
      if (useSnippets) {
        const src = snippetSourceFor("html");
        if (src) {
          try { return [lang, htmlLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    case "css": {
      const lang = css();
      if (useSnippets) {
        const src = snippetSourceFor("css");
        if (src) {
          try { return [lang, cssLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    case "python": {
      const lang = python();
      if (useSnippets) {
        const src = snippetSourceFor("python");
        if (src) {
          try { return [lang, pythonLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    case "java": {
      const lang = java();
      if (useSnippets) {
        const src = snippetSourceFor("java");
        if (src) {
          try { return [lang, javaLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    case "cpp": {
      const lang = cpp();
      if (useSnippets) {
        const src = snippetSourceFor("cpp");
        if (src) {
          try { return [lang, cppLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    case "php": {
      const lang = php();
      if (useSnippets) {
        const src = snippetSourceFor("php");
        if (src) {
          try { return [lang, phpLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    case "rust": {
      const lang = rust();
      if (useSnippets) {
        const src = snippetSourceFor("rust");
        if (src) {
          try { return [lang, rustLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    case "markdown": {
      const lang = markdown();
      if (useSnippets) {
        const src = snippetSourceFor("markdown");
        if (src) {
          try { return [lang, markdownLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    case "xml": {
      const lang = xml();
      if (useSnippets) {
        const src = snippetSourceFor("xml");
        if (src) {
          try { return [lang, xmlLanguage.data.of({ autocomplete: src })]; } catch {}
        }
      }
      return [lang];
    }
    // sql / yaml: package koi Language instance export NAHI karta, isliye
    // `sql.language` / `yaml.language` par data.of SKIP (gotcha — crash hota).
    // sql: dialect ki .language (StandardSQL.language) real instance hai —
    // uspar data.of se keyword completion + snippets MERGE hote hain.
    // yaml(): bare me koi completion source nahi hota, isliye snippets plain
    // override source ki tarah lagte hain (kuch replace nahi hota). Dono
    // sources sirf tab active jab ye language active ho (extensions
    // language-switch par badalte hain).
    case "sql": {
      const out = [sql()];
      if (useSnippets) {
        const src = snippetSourceFor("sql");
        if (src) {
          try { out.push(StandardSQL.language.data.of({ autocomplete: src })); } catch {}
        }
      }
      return out;
    }
    case "yaml": {
      const out = [yaml()];
      if (useSnippets) {
        const src = snippetSourceFor("yaml");
        if (src) {
          try { out.push(autocompletion({ override: [src] })); } catch {}
        }
      }
      return out;
    }
    default:
      return [];
  }
}
