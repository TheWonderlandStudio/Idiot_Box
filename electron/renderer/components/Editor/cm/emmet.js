// cm/emmet.js — Emmet abbreviation expansion for HTML/CSS/JSX/XML.
//
// The tracker shows an inline preview as you type an abbreviation and
// Tab expands it (it registers its own high-precedence keymap internally).

import { abbreviationTracker } from "@emmetio/codemirror6-plugin";

const EMMET_LANGS = new Set(["html", "css", "xml", "jsx", "tsx"]);

export const emmetExtension = (languageId) => {
  if (!EMMET_LANGS.has(languageId)) return [];
  try {
    return [abbreviationTracker()];
  } catch {
    return [];
  }
};
