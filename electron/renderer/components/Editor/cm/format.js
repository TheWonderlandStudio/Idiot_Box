// cm/format.js — prettier/standalone formatting (async).
//
// Parser/plugin map (spec):
//   JS/JSX      -> parser "babel",    plugins [babel, estree]
//   TS/TSX      -> parser "babel-ts", plugins [babel, estree]
//   JSON        -> parser "json",     plugins [babel, estree]
//   HTML        -> parser "html",     plugins [html]
//   CSS/SCSS    -> parser "css",      plugins [postcss]
//   Markdown    -> parser "markdown", plugins [markdown]
//   YAML        -> parser "yaml",     plugins [yaml]
// Baaki languages -> { supported: false } (no-op, status message dikhao).

import { format } from "prettier/standalone";
import * as prettierPluginBabel from "prettier/plugins/babel";
import * as prettierPluginEstree from "prettier/plugins/estree";
import * as prettierPluginHtml from "prettier/plugins/html";
import * as prettierPluginPostcss from "prettier/plugins/postcss";
import * as prettierPluginMarkdown from "prettier/plugins/markdown";
import * as prettierPluginYaml from "prettier/plugins/yaml";

const MAP = {
  javascript: { parser: "babel", plugins: [prettierPluginBabel, prettierPluginEstree] },
  jsx: { parser: "babel", plugins: [prettierPluginBabel, prettierPluginEstree] },
  typescript: { parser: "babel-ts", plugins: [prettierPluginBabel, prettierPluginEstree] },
  tsx: { parser: "babel-ts", plugins: [prettierPluginBabel, prettierPluginEstree] },
  json: { parser: "json", plugins: [prettierPluginBabel, prettierPluginEstree] },
  html: { parser: "html", plugins: [prettierPluginHtml] },
  css: { parser: "css", plugins: [prettierPluginPostcss] },
  markdown: { parser: "markdown", plugins: [prettierPluginMarkdown] },
  yaml: { parser: "yaml", plugins: [prettierPluginYaml] },
};

export const isFormattable = (langId) => !!MAP[langId];

export const formatCode = async (langId, source) => {
  const cfg = MAP[langId];
  if (!cfg) return { ok: false, error: `No formatter for "${langId || "plaintext"}"` };
  try {
    const out = await format(String(source ?? ""), {
      parser: cfg.parser,
      plugins: cfg.plugins,
    });
    return { ok: true, code: out };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};
