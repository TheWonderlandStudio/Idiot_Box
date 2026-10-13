// shared/previewCss.js — project CSS discovery for live previews.
//
// ComponentPreview (iframe) and Canvas embeds (shadow DOM) both need the
// global stylesheets OUTSIDE the component that never reach the bundler
// (the bundler only resolves the import chain into `res.css`).
// This module only derives CANDIDATE PATHS (ordered, deduped) + inlines
// @import — the caller injects into the DOM (iframe head vs shadow).
// Pure functions (fs access is injected) so this can be unit-tested in node.

export const toPosix = (p) => String(p || "").replace(/\\/g, "/");

export const posixNorm = (p) => {
  const parts = toPosix(p).split("/");
  const out = [];
  for (const seg of parts) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== ".." && !/^[A-Za-z]:$/.test(out[out.length - 1])) out.pop();
      else out.push(seg);
    } else out.push(seg);
  }
  let s = out.join("/");
  if (/^[A-Za-z]:/.test(toPosix(p).slice(0, 2)) && !/^[A-Za-z]:\//.test(s)) {
    s = s.replace(/^([A-Za-z]:)/, "$1/");
  }
  if (toPosix(p).startsWith("/") && !s.startsWith("/")) s = "/" + s;
  return s;
};

export const posixDir = (p) => {
  const s = toPosix(p);
  const i = s.lastIndexOf("/");
  return i <= 0 ? s.slice(0, i + 1) : s.slice(0, i);
};

export const stripRoot = (root, p) => {
  const r = toPosix(root).replace(/\/$/, "");
  const s = toPosix(p);
  if (s === r) return ".";
  if (s.startsWith(r + "/")) return s.slice(r.length + 1);
  return null;
};

const WALK_COMMONS = ["index.css", "styles.css", "style.css", "globals.css", "global.css", "main.css", "app.css", "App.css", "output.css"];

const ROOT_CONVENTIONS = [
  "src/index.css", "src/globals.css", "src/global.css", "src/styles.css",
  "src/style.css", "src/main.css", "src/App.css", "src/output.css",
  "src/index.tailwind.css", "app/globals.css", "styles/globals.css",
  "styles/global.css", "styles/main.css", "public/styles.css",
  "public/global.css", "assets/style.css", "renderer/globals.css",
];

const ENTRY_FILES = ["src/main.jsx", "src/main.tsx", "src/main.js", "src/main.ts", "src/index.jsx", "src/index.tsx", "src/index.js", "src/index.ts", "src/App.jsx", "src/App.tsx", "src/App.js", "src/App.ts"];
const HTML_FILES = ["index.html", "public/index.html", "src/index.html"];

const IMPORT_RE = /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+\.css(?:\?[^'"]*)?)['"]|require\s*\(\s*['"]([^'"]+\.css(?:\?[^'"]*)?)['"]\s*\)/g;
const LINK_RE = /<link\b[^>]*href\s*=\s*["']([^"']+\.css[^"']*)["'][^>]*>/gi;

const resolveImport = (rootPosix, absPosix, imp) => {
  const clean = String(imp || "").split("?")[0];
  if (!clean) return null;
  if (clean.startsWith("@/")) return posixNorm(`${rootPosix}/src/${clean.slice(2)}`);
  if (clean.startsWith("~/")) return posixNorm(`${rootPosix}/${clean.slice(2)}`);
  if (clean.startsWith("/") && !clean.startsWith("//")) return posixNorm(`${rootPosix}${clean}`);
  if (clean.startsWith(".")) return posixNorm(`${posixDir(absPosix)}/${clean}`);
  if (/^(http|data:|blob:)/i.test(clean)) return null;
  return posixNorm(`${rootPosix}/node_modules/${clean}`); // bare package css
};

// Ordered, deduped candidate ABS posix paths. Only .css (no scss/less here
// — nothing compiles them; the bundler also leaves them empty).
// opts: { includeSibling: true } — sibling same-name (.css/.module.css).
export async function findGlobalCssFiles({ targetAbsPath, projectRoot, readTextFile, readDirAll, extraExts = null } = {}) {
  const ordered = [];
  const seen = new Set();
  const mark = (key) => {
    if (!key) return;
    const k = posixNorm(key);
    if (!/\.css$/i.test(k)) return;
    const lk = k.toLowerCase();
    if (seen.has(lk)) return;
    seen.add(lk);
    ordered.push(k);
  };
  if (!targetAbsPath) return ordered;
  const targetPosix = toPosix(targetAbsPath);
  const rootPosix = projectRoot ? toPosix(projectRoot).replace(/\/$/, "") : posixDir(targetPosix);
  void extraExts;

  // 1. sibling same-name (App.jsx -> App.css / App.module.css)
  const siblingBase = targetPosix.replace(/\.(jsx|tsx|js|ts|vue|svelte)$/i, "");
  for (const cand of [`${siblingBase}.css`, `${siblingBase}.module.css`]) {
    if (cand !== targetPosix) mark(cand);
  }

  // 2. walk-up: component dir -> root
  try {
    let dir = posixDir(targetPosix);
    let guard = 0;
    while (dir && guard++ < 10) {
      for (const n of WALK_COMMONS) mark(`${dir}/${n}`);
      if (dir.toLowerCase() === rootPosix.toLowerCase()) break;
      const parent = posixDir(dir);
      if (!parent || parent === dir) break;
      dir = parent;
      if (dir.length < rootPosix.length - 1 && !rootPosix.toLowerCase().startsWith(dir.toLowerCase())) break;
    }
  } catch {}

  // 3. root conventions
  for (const rel of ROOT_CONVENTIONS) mark(`${rootPosix}/${rel}`);

  // 4. css imports from entry files (reading is required — these files are small)
  if (typeof readTextFile === "function") {
    for (const rel of ENTRY_FILES) {
      const abs = `${rootPosix}/${rel}`;
      let text = null;
      try { text = await readTextFile(abs); } catch {}
      if (typeof text !== "string" || !text) continue;
      IMPORT_RE.lastIndex = 0;
      let im;
      while ((im = IMPORT_RE.exec(text))) {
        const resolved = resolveImport(rootPosix, abs, im[1] || im[2] || "");
        if (resolved) mark(resolved);
      }
      if (ordered.length > 60) break;
    }

    // 5. index.html <link rel=stylesheet>
    for (const hrel of HTML_FILES) {
      const habs = `${rootPosix}/${hrel}`;
      let htmlText = null;
      try { htmlText = await readTextFile(habs); } catch {}
      if (typeof htmlText !== "string" || !htmlText) continue;
      let lm;
      LINK_RE.lastIndex = 0;
      while ((lm = LINK_RE.exec(htmlText))) {
        const href = String(lm[1] || "").split("?")[0].split("#")[0].trim();
        if (!href || /^(http|data:|blob:)/i.test(href)) continue;
        if (href.startsWith("/")) mark(posixNorm(`${rootPosix}${href}`));
        else mark(posixNorm(`${posixDir(habs)}/${href}`));
      }
    }

    // 6. framework dist css (based on package.json deps)
    try {
      const raw = await readTextFile(`${rootPosix}/package.json`);
      const pkg = raw ? JSON.parse(raw) : null;
      const deps = { ...((pkg && pkg.dependencies) || {}), ...((pkg && pkg.devDependencies) || {}) };
      if (deps.bootstrap) mark(`${rootPosix}/node_modules/bootstrap/dist/css/bootstrap.min.css`);
      if (deps.bulma) mark(`${rootPosix}/node_modules/bulma/css/bulma.min.css`);
      if (deps["foundation-sites"]) mark(`${rootPosix}/node_modules/foundation-sites/dist/css/foundation.min.css`);
      if (deps.antd) mark(`${rootPosix}/node_modules/antd/dist/antd.min.css`);
      if (deps["semantic-ui-css"]) mark(`${rootPosix}/node_modules/semantic-ui-css/semantic.min.css`);
    } catch {}
  }

  // 7. build output css (vite/cra dist — compiled tailwind/utilities are
  // found here). Only when readDirAll is available (the caller provides it).
  if (typeof readDirAll === "function") {
    for (const drel of ["dist", "build"]) {
      try {
        const entries = await readDirAll(`${rootPosix}/${drel}`);
        if (!Array.isArray(entries)) continue;
        for (const e of entries.slice(0, 40)) {
          if (!e || e.isDir) continue;
          if (/\.css$/i.test(e.name || e.path || "")) mark(e.path || `${rootPosix}/${drel}/${e.name}`);
          if (ordered.length > 80) break;
        }
        const assets = (entries || []).find((e) => e && e.isDir && e.name === "assets");
        if (assets) {
          try {
            const inner = await readDirAll(assets.path);
            for (const f of (inner || []).slice(0, 20)) {
              if (f && !f.isDir && /\.css$/i.test(f.name || "")) mark(f.path);
            }
          } catch {}
        }
      } catch {}
      if (ordered.length > 80) break;
    }
  }

  return ordered;
}

// ── ibx-file URLs (for loading local assets in iframe/srcDoc) ────
// Same construction as the Browser panel (matches main decodeIbxFileUrl).
export function ibxFileUrlFor(absPosixPath) {
  const p = String(absPosixPath || "").replace(/\\/g, "/");
  if (!p) return "";
  return "ibx-file://file/" + encodeURI(p).replace(/#/g, "%23");
}

// ── Standalone HTML docs (for .html preview/canvas-embed) ───────────
// srcDoc documents have no base URL — relative <link>/img/script URLs
// break. Inject <base href="ibx-file://...dir/"> so all
// relative assets resolve from the file's folder. If a <base> already exists,
// leave the author's choice alone (do not touch it).
// Returns { html, hadBase }.
export function prepareHtmlDocument(htmlText, fileAbsPath) {
  const src = typeof htmlText === "string" ? htmlText : "";
  if (/<base\b/i.test(src)) return { html: src, hadBase: true };
  const dir = posixDir(fileAbsPath || "");
  const base = ibxFileUrlFor(dir).replace(/\/?$/, "/");
  if (!base || base === "ibx-file://file//") return { html: src, hadBase: false };
  const tag = `<base href="${base}">`;
  if (/<head[^>]*>/i.test(src)) {
    return { html: src.replace(/<head[^>]*>/i, (m) => m + tag), hadBase: false };
  }
  if (/<html[^>]*>/i.test(src)) {
    return { html: src.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`), hadBase: false };
  }
  return { html: `<head>${tag}</head>` + src, hadBase: false };
}

// ── Shadow-DOM scoping ─────────────────────────────────────────────────
// Shadow trees have no html/body nodes, so `body{...}`, `html{...}`,
// `:root{...}` (Vite template!) and `#root{...}` rules stay dead —
// including variables (var(--brand)). Map them onto `:host` (custom properties
// inherit from :host, so var() comes alive again).
// Do not touch anything inside strings/comments/urls — mask them first.
export function scopeCssForShadow(css) {
  if (!css || typeof css !== "string") return css;
  if (css.indexOf("body") === -1 && css.indexOf("html") === -1 && css.indexOf(":root") === -1 && css.indexOf("#root") === -1) {
    return css; // fast path — nothing worth doing
  }
  // 1) move comments / strings / url(...) into placeholders
  const stash = [];
  const masked = String(css).replace(/\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\(\s*[^)]*\)/gi, (m) => {
    stash.push(m);
    return `\u0000${stash.length - 1}\u0000`;
  });
  // 2) transform selectors
  const out = masked
    .replace(/:root(?![\w-])/g, ":host")
    .replace(/#root(?![\w-])/g, ":host")
    .replace(/(^|[\s,{}>+~])(html|body)(?=[\s,{:>+~.\[#]|$)/gi, "$1:host");
  // 3) restore placeholders
  return out.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)] ?? m);
}

// Inline relative @import "..." from global CSS (depth cap,
// cycle guard). Skip http/data/tailwind bare imports.
export async function inlineCssImports(css, baseDirPosix, readTextFile, seen = new Set(), depth = 0) {
  if (!css || depth > 4 || typeof readTextFile !== "function") return css;
  const re = /@import\s+(?:url\(\s*["']?([^"')]+)["']?\s*\)|["']([^"']+)["'])\s*[^;]*;/g;
  let out = css;
  let m;
  const jobs = [];
  while ((m = re.exec(css))) {
    const raw = (m[1] || m[2] || "").trim();
    if (!raw || /^(http|data:|blob:)/i.test(raw) || raw === "tailwindcss") continue;
    const clean = raw.split("?")[0].split("#")[0];
    if (!/\.css$/i.test(clean)) continue;
    let abs = null;
    if (clean.startsWith("./") || clean.startsWith("../") || (!clean.includes(":") && !clean.startsWith("@") && !clean.startsWith("~"))) {
      abs = posixNorm(`${baseDirPosix}/${clean}`);
    } else continue;
    if (!abs || seen.has(abs.toLowerCase())) continue;
    seen.add(abs.toLowerCase());
    jobs.push({ full: m[0], abs });
  }
  for (const j of jobs) {
    let inner = null;
    try { inner = await readTextFile(j.abs); } catch {}
    if (typeof inner !== "string" || !inner) continue;
    const resolved = await inlineCssImports(inner, posixDir(j.abs), readTextFile, seen, depth + 1);
    out = out.split(j.full).join(`/* @import ${j.abs} */\n${resolved}`);
  }
  return out;
}
