// cm/highlights.js — custom HighlightStyle (@lezer/highlight tags).
//
// syntaxHighlighting() me lagta hai; `customHighlights` off ho to default
// (defaultHighlightStyle + fallback) use hota hai. Dark/light variants taaki
// teeno themes (vscodeDark / vscodeLight / oneDark) par readable rahe.

import { tags } from "@lezer/highlight";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";

const darkSpec = [
  { tag: tags.keyword, color: "#c586c0" },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: "#9cdcfe" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#dcdcaa" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "#4fc1ff" },
  { tag: [tags.definition(tags.name), tags.separator], color: "#9cdcfe" },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: "#4ec9b0" },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: "#d4d4d4" },
  { tag: [tags.meta, tags.comment], color: "#6a9955" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "#4ec9b0", textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: "#9cdcfe" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: "#569cd6" },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: "#ce9178" },
  { tag: tags.invalid, color: "#f44747" },
];

const lightSpec = [
  { tag: tags.keyword, color: "#0000ff" },
  { tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName], color: "#001080" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#795e26" },
  { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: "#0070c1" },
  { tag: [tags.definition(tags.name), tags.separator], color: "#001080" },
  { tag: [tags.typeName, tags.className, tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: "#267f99" },
  { tag: [tags.operator, tags.operatorKeyword, tags.url, tags.escape, tags.regexp, tags.link, tags.special(tags.string)], color: "#000000" },
  { tag: [tags.meta, tags.comment], color: "#008000" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "#267f99", textDecoration: "underline" },
  { tag: tags.heading, fontWeight: "bold", color: "#001080" },
  { tag: [tags.atom, tags.bool, tags.special(tags.variableName)], color: "#0000ff" },
  { tag: [tags.processingInstruction, tags.string, tags.inserted], color: "#a31515" },
  { tag: tags.invalid, color: "#cd3131" },
];

export const customDarkHighlights = HighlightStyle.define(darkSpec);
export const customLightHighlights = HighlightStyle.define(lightSpec);

// theme: "dark" | "light" | "oneDark" — oneDark bhi dark variant use karta hai.
export const customHighlightsFor = (theme) =>
  syntaxHighlighting(theme === "light" ? customLightHighlights : customDarkHighlights);
