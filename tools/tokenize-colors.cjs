#!/usr/bin/env node
/**
 * Replace hard-coded colors in renderer CSS with central-sheet tokens.
 *
 * Every replacement points at a token defined in variables.css, so the whole
 * app stays themeable from the Appearance settings page. Run without flags for
 * a dry run, with --write to apply.
 *
 *   node tools/tokenize-colors.cjs
 *   node tools/tokenize-colors.cjs --write
 */
const fs = require("node:fs")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const renderer = path.join(root, "electron", "renderer")
const WRITE = process.argv.includes("--write")

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[^)]*\)|hsla?\(\s*[^)]*\)|oklch\(\s*[^)]*\)/g

/** Canonical key for a color literal (handles 0.10 vs 0.1, spaces, rgb slash). */
function canon(raw) {
  const s0 = String(raw).trim().toLowerCase()
  let m = s0.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    let body = m[1].trim()
    let alpha = null
    if (body.includes("/")) {
      const idx = body.indexOf("/")
      alpha = body.slice(idx + 1).trim()
      body = body.slice(0, idx).trim()
    }
    const parts = body.includes(",") ? body.split(",") : body.split(/\s+/)
    if (parts.length >= 3) {
      const [r, g, b] = parts.slice(0, 3).map((n) => Number(n))
      if (alpha == null && parts[3] != null) alpha = parts[3]
      const a = alpha == null ? 1 : String(alpha).endsWith("%") ? Number(String(alpha).slice(0, -1)) / 100 : Number(alpha)
      const fmt = (n) => String(Number(Number(n).toFixed(3)))
      return `rgba(${r},${g},${b},${fmt(a)})`
    }
  }
  m = s0.match(/^oklch\(([^)]+)\)$/)
  if (m) return `oklch(${m[1].replace(/\s+/g, " ").trim()})`
  return s0.replace(/\s+/g, "")
}

// ── semantic literal -> token ───────────────────────────────────────────────
const MAP = {
  // overlays (theme-agnostic)
  "rgba(255,255,255,0.03)": "--white-a03",
  "rgba(255,255,255,0.04)": "--white-a04",
  "rgba(255,255,255,0.05)": "--white-a05",
  "rgba(255,255,255,0.055)": "--white-a055",
  "rgba(255,255,255,0.06)": "--white-a06",
  "rgba(255,255,255,0.07)": "--white-a07",
  "rgba(255,255,255,0.08)": "--white-a08",
  "rgba(255,255,255,0.09)": "--white-a09",
  "rgba(255,255,255,0.1)": "--white-a10",
  "rgba(255,255,255,0.11)": "--white-a11",
  "rgba(255,255,255,0.12)": "--white-a12",
  "rgba(255,255,255,0.14)": "--white-a14",
  "rgba(255,255,255,0.16)": "--white-a16",
  "rgba(255,255,255,0.17)": "--white-a17",
  "rgba(255,255,255,0.18)": "--white-a18",
  "rgba(255,255,255,0.2)": "--white-a20",
  "rgba(255,255,255,0.22)": "--white-a22",
  "rgba(255,255,255,0.24)": "--white-a24",
  "rgba(255,255,255,0.25)": "--white-a25",
  "rgba(255,255,255,0.6)": "--white-a60",
  "rgba(255,255,255,0.74)": "--white-a74",
  "rgba(255,255,255,0.82)": "--white-a82",
  "rgba(255,255,255,0.85)": "--white-a85",
  "rgba(255,255,255,0.9)": "--white-a90",
  "rgba(255,255,255,0.92)": "--white-a92",
  "rgba(0,0,0,0.04)": "--overlay-a04",
  "rgba(0,0,0,0.05)": "--overlay-a05",
  "rgba(0,0,0,0.06)": "--overlay-a06",
  "rgba(0,0,0,0.08)": "--overlay-a08",
  "rgba(0,0,0,0.09)": "--overlay-a09",
  "rgba(0,0,0,0.1)": "--overlay-a10",
  "rgba(0,0,0,0.12)": "--overlay-a12",
  "rgba(0,0,0,0.14)": "--overlay-a14",
  "rgba(0,0,0,0.15)": "--overlay-a15",
  "rgba(0,0,0,0.16)": "--overlay-a16",
  "rgba(0,0,0,0.18)": "--overlay-a18",
  "rgba(0,0,0,0.2)": "--overlay-a20",
  "rgba(0,0,0,0.22)": "--overlay-a22",
  "rgba(0,0,0,0.25)": "--overlay-a25",
  "rgba(0,0,0,0.28)": "--overlay-a28",
  "rgba(0,0,0,0.3)": "--overlay-a30",
  "rgba(0,0,0,0.35)": "--overlay-a35",
  "rgba(0,0,0,0.38)": "--overlay-a38",
  "rgba(0,0,0,0.4)": "--overlay-a40",
  "rgba(0,0,0,0.42)": "--overlay-a42",
  "rgba(0,0,0,0.45)": "--overlay-a45",
  "rgba(0,0,0,0.5)": "--overlay",
  "rgba(0,0,0,0.55)": "--overlay-a55",
  "rgba(0,0,0,0.58)": "--overlay-a58",
  "rgba(0,0,0,0.6)": "--overlay-dark",
  "rgba(0,0,0,0.65)": "--overlay-a65",
  "rgba(0,0,0,0.8)": "--overlay-a80",
  "rgba(0,0,0,0.88)": "--overlay-a88",

  // syntax / semantic hues
  "#4ec9b0": "--teal",
  "#f44747": "--danger",
  "#9cdcfe": "--code-cyan",
  "#d7ba7d": "--code-tan",
  "#569cd6": "--code-blue",
  "#dcdcaa": "--code-yellow",
  "#c586c0": "--code-magenta",
  "#ce9178": "--code-orange",
  "#264f78": "--selection",
  "#2c4f6e": "--term-selection",
  "#767676": "--term-bright-black",
  "#0e639c": "--editor-blue",
  "#2a1717": "--error-bg",
  "#732222": "--error-border",
  "#3a1d1d": "--error-bg-strong",
  "#1c1c1c": "--coal",
  "#6b6b6b": "--icon-faint",
  "#bbbbbb": "--text-soft",
  "#666": "--text-muted",
  "#888": "--icon",
  "#999": "--text-secondary",
  "#ddd": "--text-hover",
  "#ccc": "--text-bright",
  "#c8c8c8": "--text-primary",
  "#222222": "--bg-header-dark",
  "#232323": "--border-row",
  "#2a2a2a": "--bg-hover",
  "#3a3a3a": "--border-light",
  "#005fb8": "--accent-dark",
  "#007acc": "--accent",
  "#4ec9b033": "--teal-border-soft",

  // browser edit overlay
  "#3b82f6": "--edit-blue",
  "#2f74e8": "--edit-blue-hover",
  "#2a68d4": "--edit-blue-deep",
  "#7fb0ff": "--edit-blue-soft",
  "rgba(59,130,246,0.05)": "--edit-blue-a05",
  "rgba(59,130,246,0.07)": "--edit-blue-a07",
  "rgba(59,130,246,0.12)": "--edit-blue-a12",
  "rgba(59,130,246,0.16)": "--edit-blue-a16",
  "rgba(59,130,246,0.26)": "--edit-blue-a26",

  // editor accents
  "#38bdf8": "--code-sky",
  "rgba(56,189,248,0.12)": "--code-sky-a12",
  "rgba(56,189,248,0.3)": "--code-sky-a30",
  "#f472b6": "--code-pink",
  "rgba(244,114,182,0.12)": "--code-pink-a12",
  "rgba(244,114,182,0.3)": "--code-pink-a30",
  "#f59e0b": "--code-amber",
  "#ef4444": "--code-red",
  "#10b981": "--code-emerald",
  "#e51400": "--code-red-strong",
  "#ffd700": "--code-gold",
  "#da70d6": "--code-orchid",
  "#179fff": "--code-azure",
  "#ff8c69": "--code-salmon",
  "#b5cea8": "--code-green-pale",
  "#6a9955": "--code-green",
  "#b180d7": "--code-purple",
  "#2ea043": "--git-added-strong",
  "#316dca": "--git-modified-strong",
  "#c93c37": "--git-removed-strong",
  "rgba(46,160,67,0.1)": "--git-added-a10-strong",
  "rgba(49,109,202,0.1)": "--git-modified-a10-strong",
  "rgba(201,60,55,0.1)": "--git-removed-a10-strong",
  "rgba(46,196,182,0.12)": "--teal-a12-strong",
  "rgba(46,196,182,0.3)": "--teal-a30-strong",
  "#f48771": "--error-soft",
  "rgba(244,135,113,0.12)": "--error-tint-a12",
  "rgba(215,186,125,0.12)": "--code-tan-a12",
  "rgba(78,201,176,0.12)": "--teal-a12",
  "rgba(244,71,71,0.12)": "--git-removed-a12",
  "rgba(244,71,71,0.4)": "--error-border-2",

  // community / discord
  "#5865f2": "--discord",
  "#4752c4": "--discord-hover",
  "rgba(88,101,242,0.14)": "--discord-a14",
  "#0b0b0e": "--community-bg",
  "#4a88ff": "--hub-blue-bright",
  "#3d7dfb": "--hub-blue",
  "#2f63d8": "--hub-blue-deep",
  "#3568e0": "--hub-blue-deep-2",

  // Project Hub palette
  "#0a0a0a": "--hub-bg",
  "#0a0a0c": "--hub-bg-deep",
  "#101010": "--hub-bg-raised",
  "#111111": "--hub-bg-elevated",
  "#121216": "--hub-bg-inset",
  "#131316": "--hub-surface",
  "#16161a": "--hub-surface-2",
  "#1b1b1b": "--hub-surface-3",
  "#1b1b20": "--hub-surface-4",
  "#101013": "--hub-surface-5",
  "#1d1d21": "--hub-sidebar-top",
  "#18181b": "--hub-sidebar-bottom",
  "#23232c": "--hub-modal-top",
  "#131317": "--hub-modal-mid",
  "#0e0e11": "--hub-modal-bottom",
  "#0e0e12": "--panel-void",
  "rgba(14,14,17,0.74)": "--hub-overlay",
  "rgba(10,10,12,0.62)": "--hub-overlay-2",
  "rgba(10,10,12,0.72)": "--hub-overlay-3",
  "rgba(19,19,22,0.92)": "--hub-overlay-4",
  "rgba(20,20,24,0.8)": "--hub-overlay-5",
  "#ececef": "--hub-paper",
  "#dcdce0": "--hub-paper-2",
  "#fff0dd": "--hub-paper-3",
  "#1a0f06": "--hub-ink-deep",
  "#ff9d4d": "--hub-orange",
  "#ffb37a": "--hub-orange-bright",
  "#ffe2c6": "--hub-orange-pale",
  "#ff7a1a": "--hub-orange-deep",
  "#f4761f": "--hub-orange-mid",
  "rgba(255,157,77,0.75)": "--hub-orange-a75",
  "rgba(255,150,74,0.46)": "--hub-orange-a46",
  "rgba(255,150,74,0.45)": "--hub-orange-a45",
  "rgba(255,150,74,0.4)": "--hub-orange-a40",
  "rgba(255,150,74,0.28)": "--hub-orange-a28",
  "rgba(255,150,74,0.22)": "--hub-orange-a22",
  "rgba(255,150,74,0.15)": "--hub-orange-a15",
  "rgba(255,100,30,0.34)": "--hub-orange-100-a34",
  "rgba(255,100,30,0.16)": "--hub-orange-100-a16",
  "rgba(255,70,12,0.22)": "--hub-orange-70-a22",
  "rgba(255,70,12,0.1)": "--hub-orange-70-a10",
  "#b45309": "--hub-amber-deep",
  "#6b3410": "--hub-amber-ink",
  "#7a4a1e": "--hub-amber-ink-2",
  "#b08d70": "--hub-amber-ink-3",
  "#2b1a0d": "--hub-amber-bg",
  "#8fb2ff": "--hub-blue-soft",
  "#eef2ff": "--hub-blue-pale",
  "rgba(47,99,216,0.32)": "--hub-blue-a32",
  "rgba(96,140,255,0.14)": "--hub-blue-a14",
  "rgba(96,140,255,0.12)": "--hub-blue-a12",
  "rgba(120,156,255,0.4)": "--hub-blue-soft-a40",
  "rgba(120,156,255,0.5)": "--hub-blue-soft-a50",
  "#ff6b6b": "--hub-red",
  "#ff8b8b": "--hub-red-soft",
  "#ff9a9a": "--hub-red-pale",
  "#ff8080": "--hub-red-bright",
  "rgba(255,70,70,0.16)": "--hub-red-a16",
  "rgba(255,70,70,0.18)": "--hub-red-a18",
  "rgba(255,70,70,0.24)": "--hub-red-a24",
  "rgba(255,80,80,0.12)": "--hub-red-a12",
  "rgba(255,90,90,0.5)": "--hub-red-a50",
  "rgba(255,110,110,0.7)": "--hub-red-a70",
  "#4ade80": "--hub-green",
  "rgba(34,197,94,0.14)": "--hub-green-a14",
  "rgba(34,197,94,0.35)": "--hub-green-a35",

  // emulator + misc
  "rgb(95,134,196)": "--emulator-blue",
  "rgba(95,134,196,0.1)": "--emulator-blue-a10",
  "rgb(119,166,119)": "--emulator-green",
  "rgba(119,166,119,0.075)": "--emulator-green-a075",
  "rgba(0,122,204,0.12)": "--overlay-tint-blue",
  "rgba(0,122,204,0.1)": "--overlay-tint-blue-a10",
  "rgba(0,122,204,0.4)": "--overlay-tint-blue-a40",
  "rgba(0,122,204,0.45)": "--overlay-tint-blue-a45",
  "rgba(95,134,196,1)": "--emulator-blue",
  "rgba(119,166,119,1)": "--emulator-green",
  "rgba(232,17,35,1)": "--window-close",
  "rgba(128,128,128,0.6)": "--editor-grid-a60",
  "rgba(150,150,150,0.55)": "--editor-grid-a55",
  "rgba(64,132,214,0.28)": "--search-hit-a28",
  "rgba(10,10,12,0.55)": "--composer-veil",
  "rgba(232,17,35,0.9)": "--window-close-a90",
  "rgb(232,17,35)": "--window-close",
  "#0d0d0d": "--bg-app",
}

// Neutral literals whose token depends on the CSS property.
const NEUTRAL = {
  "#ffffff": { bg: "--paper", border: "--border-strong", text: "--text-inverse", other: "--paper" },
  "#fff": { bg: "--paper", border: "--border-strong", text: "--text-inverse", other: "--paper" },
  "#000000": { bg: "--black", border: "--black", text: "--black", other: "--black" },
  "#000": { bg: "--black", border: "--black", text: "--black", other: "--black" },
  "#f3f3f3": { bg: "--paper-dim", border: "--border", text: "--text-primary", other: "--paper-dim" },
  "#f0f0f0": { bg: "--bg-panel", border: "--border", text: "--text-primary", other: "--bg-panel" },
  "#e0e0e0": { bg: "--bg-hover-strong", border: "--border", text: "--text-input", other: "--border" },
  "#e8e8e8": { bg: "--bg-hover", border: "--border-row", text: "--text-primary", other: "--bg-hover" },
  "#ececec": { bg: "--bg-vscode", border: "--border", text: "--text-primary", other: "--bg-vscode" },
  "#f7f7f7": { bg: "--bg-inset", border: "--border", text: "--text-primary", other: "--bg-inset" },
  "#efefef": { bg: "--paper-dim", border: "--border", text: "--text-primary", other: "--paper-dim" },
  "#d8d8d8": { bg: "--bg-active", border: "--border-strong", text: "--text-soft-2", other: "--bg-active" },
  "#d1d1d1": { bg: "--bg-subtle", border: "--border-input", text: "--text-soft", other: "--bg-subtle" },
  "#cccccc": { bg: "--bg-thumb", border: "--border-strong", text: "--text-bright", other: "--bg-thumb" },
  "#808080": { bg: "--bg-thumb", border: "--border-strong", text: "--icon", other: "--icon" },
  "#aaaaaa": { bg: "--bg-thumb", border: "--border-strong", text: "--icon-hover", other: "--icon-hover" },
  "#fafafa": { bg: "--bg-panel", border: "--border", text: "--text-primary", other: "--bg-panel" },
  "#ebebeb": { bg: "--bg-subtle", border: "--border", text: "--text-primary", other: "--bg-subtle" },
  "#eeeeee": { bg: "--bg-hover", border: "--border", text: "--text-primary", other: "--bg-hover" },
  "#e5e5e5": { bg: "--bg-hover", border: "--border", text: "--text-primary", other: "--bg-hover" },
  "#dddddd": { bg: "--bg-hover-strong", border: "--border-strong", text: "--text-hover", other: "--bg-hover-strong" },
  "#141414": { bg: "--bg-inset", border: "--border", text: "--text-primary", other: "--bg-inset" },
  "#1e1e1e": { bg: "--bg-surface", border: "--border", text: "--text-primary", other: "--bg-surface" },
  "#555555": { bg: "--bg-hover", border: "--border", text: "--text-secondary", other: "--text-secondary" },
  "#555": { bg: "--bg-hover", border: "--border", text: "--text-secondary", other: "--text-secondary" },
  "#333": { bg: "--bg-thumb", border: "--border", text: "--text-label", other: "--border" },
  "#333333": { bg: "--bg-thumb", border: "--border", text: "--text-label", other: "--border" },
  "#444": { bg: "--bg-input-strong", border: "--border-strong", text: "--text-disabled", other: "--text-disabled" },
  "#222": { bg: "--bg-header-dark", border: "--border", text: "--text-bright", other: "--bg-header-dark" },
  "#999999": { bg: "--bg-thumb", border: "--border-strong", text: "--text-secondary", other: "--text-secondary" },
  "#666666": { bg: "--bg-hover", border: "--border", text: "--text-muted", other: "--text-muted" },
  "#b9b9c3": { bg: "--bg-active", border: "--border", text: "--text-soft", other: "--text-soft" },
  "#b6b6c2": { bg: "--bg-active", border: "--border", text: "--text-soft", other: "--text-soft" },
  "#a9a9b5": { bg: "--bg-active", border: "--border", text: "--text-soft", other: "--text-soft" },
  "#a6a6b2": { bg: "--bg-active", border: "--border", text: "--text-secondary", other: "--text-secondary" },
  "#9a9aa8": { bg: "--bg-active", border: "--border", text: "--text-secondary", other: "--text-secondary" },
  "#9a9aa6": { bg: "--bg-active", border: "--border", text: "--text-secondary", other: "--text-secondary" },
  "#8b8b96": { bg: "--bg-active", border: "--border", text: "--text-muted", other: "--text-muted" },
  "#8b8b98": { bg: "--bg-active", border: "--border", text: "--text-muted", other: "--text-muted" },
  "#8d8d99": { bg: "--bg-active", border: "--border", text: "--text-muted", other: "--text-muted" },
  "#7e7e8c": { bg: "--bg-active", border: "--border", text: "--text-muted", other: "--text-muted" },
  "#75757f": { bg: "--bg-active", border: "--border", text: "--text-muted", other: "--text-muted" },
  "#71717c": { bg: "--bg-active", border: "--border", text: "--text-muted", other: "--text-muted" },
  "#7c7c88": { bg: "--bg-active", border: "--border", text: "--text-muted", other: "--text-muted" },
  "#6b6b78": { bg: "--bg-hover", border: "--border", text: "--text-placeholder", other: "--text-placeholder" },
  "#66666f": { bg: "--bg-hover", border: "--border", text: "--text-placeholder", other: "--text-placeholder" },
  "#6a6a73": { bg: "--bg-hover", border: "--border", text: "--text-placeholder", other: "--text-placeholder" },
  "#cfcfd7": { bg: "--bg-active", border: "--border", text: "--text-highlight", other: "--text-highlight" },
  "#d7d7de": { bg: "--bg-active", border: "--border", text: "--text-highlight", other: "--text-highlight" },
  "#f0f0f5": { bg: "--bg-panel", border: "--border", text: "--text-highlight", other: "--text-highlight" },
  "#ececf1": { bg: "--bg-panel", border: "--border", text: "--text-highlight", other: "--text-highlight" },
  "#777": { bg: "--bg-hover", border: "--border", text: "--text-muted", other: "--text-muted" },
  "#f2f2f7": { bg: "--bg-panel", border: "--border", text: "--text-highlight", other: "--text-highlight" },
  "#e8e8f0": { bg: "--bg-panel", border: "--border", text: "--text-highlight", other: "--text-highlight" },
  "#e9e9ee": { bg: "--bg-panel", border: "--border", text: "--text-highlight", other: "--text-highlight" },
  "#e6e6ec": { bg: "--bg-panel", border: "--border", text: "--text-highlight", other: "--text-highlight" },
  "#eef0f5": { bg: "--bg-panel", border: "--border", text: "--text-highlight", other: "--text-highlight" },
}

// Explicit overrides for library variables whose names carry the meaning.
const PROP_OVERRIDES = {
  "--flexlayout-color-text": "--text-primary",
  "--flexlayout-color-background": "--bg-panel",
  "--flexlayout-color-base": "--bg-panel",
  "--flexlayout-color-tabset-background": "--bg-panel",
  "--flexlayout-color-tabset-background-selected": "--bg-inset",
  "--flexlayout-color-tabset-background-maximized": "--paper-dim",
  "--flexlayout-color-tabset-header-background": "--bg-header",
  "--flexlayout-color-tabset-header": "--text-primary",
  "--flexlayout-color-border-tab-content": "--bg-panel",
  "--flexlayout-color-border-background": "--bg-header",
  "--flexlayout-color-border-divider-line": "--border",
  "--flexlayout-color-tab-content": "--bg-panel",
  "--flexlayout-color-tab-selected": "--text-primary",
  "--flexlayout-color-tab-selected-background": "--bg-panel",
  "--flexlayout-color-tab-unselected": "--text-secondary",
  "--flexlayout-color-tab-textbox": "--text-primary",
  "--flexlayout-color-tab-textbox-background": "--bg-hover",
  "--flexlayout-color-border-tab-selected": "--text-primary",
  "--flexlayout-color-border-tab-selected-background": "--bg-panel",
  "--flexlayout-color-border-tab-unselected": "--text-secondary",
  "--flexlayout-color-splitter": "--bg-header",
  "--flexlayout-color-splitter-hover": "--bg-hover-strong",
  "--flexlayout-color-splitter-drag": "--border-strong",
  "--flexlayout-color-drag-rect-border": "--border-strong",
  "--flexlayout-color-drag-rect-background": "--bg-active",
  "--flexlayout-color-drag-rect": "--text-primary",
  "--flexlayout-color-popup-border": "--border-input",
  "--flexlayout-color-popup-unselected": "--text-primary",
  "--flexlayout-color-popup-unselected-background": "--bg-panel",
  "--flexlayout-color-popup-selected": "--text-primary",
  "--flexlayout-color-popup-selected-background": "--bg-hover",
  "--flexlayout-color-edge-marker": "--icon-hover",
  "--flexlayout-color-edge-icon": "--text-secondary",
  "--flexlayout-color-toolbar-button-hover": "--bg-hover",
  "--flexlayout-color-drag1": "--emulator-blue",
  "--flexlayout-color-drag2": "--emulator-green",

  // AI Elements shadcn bridge (custom props inherit into the shadow DOM)
  "--background": "--bg-surface",
  "--foreground": "--text-primary",
  "--card": "--bg-raised",
  "--card-foreground": "--text-primary",
  "--popover": "--bg-raised",
  "--popover-foreground": "--text-primary",
  "--primary": "--text-primary",
  "--primary-foreground": "--bg-app",
  "--secondary": "--bg-hover",
  "--secondary-foreground": "--text-primary",
  "--muted": "--bg-hover",
  "--muted-foreground": "--text-secondary",
  "--accent": "--bg-hover",
  "--accent-foreground": "--text-primary",
  "--destructive": "--danger",
  "--border": "--border",
  "--input": "--border-input",
  "--ring": "--accent",
  "--chart-1": "--code-orange",
  "--chart-2": "--teal",
  "--chart-3": "--code-blue",
  "--chart-4": "--code-yellow",
  "--chart-5": "--code-tan",
  "--color-on-accent": "--text-inverse",
}

const fileOverrides = {
  "components/ai-elements/ai-input.css": {
    "--accent": "--bg-hover",
    "--accent-foreground": "--text-primary",
  },
  "components/Project/hub.css": {
    "rgba(255,255,255,0.5)": "--white-a60",
  },
}

const category = (prop) => {
  const p = prop.toLowerCase()
  if (/shadow|filter|drop-shadow/.test(p)) return "other"
  if (p.includes("background")) return "bg"
  if (p.includes("border") || p === "outline" || p === "outline-color" || p.includes("splitter")) return "border"
  if (p === "color" || p === "fill" || p === "stroke" || p.includes("text") || p.includes("icon")) return "text"
  return "other"
}

const files = [
  "layout.css",
  "components/Project/hub.css",
  "components/Editor/editor.css",
  "components/CommunityPanel/community.css",
  "components/Debugger/debugger.css",
  "components/OpenPencil/openpencil.css",
  "components/SearchPanel/search.css",
  "components/TestExplorer/tests.css",
  "components/Notebook/notebook.css",
  "components/ai-elements/ai-input.css",
]

const unknown = new Map()
let replaced = 0
let touchedFiles = 0

for (const rel of files) {
  const file = path.join(renderer, rel)
  if (!fs.existsSync(file)) continue
  const before = fs.readFileSync(file, "utf8")
  let count = 0

  const after = before.replace(/([-\w]+)\s*:\s*([^;{}]+);/g, (full, prop, value) => {
    if (!COLOR_RE.test(value)) return full
    COLOR_RE.lastIndex = 0
    const next = value.replace(COLOR_RE, (literal) => {
      const key = canon(literal)
      const over = fileOverrides[rel] || {}
      let token = over[key] || PROP_OVERRIDES[prop] || MAP[key]
      if (!token && NEUTRAL[key]) token = NEUTRAL[key][category(prop)]
      if (!token) {
        const k = `${rel}\t${key}\t${prop}`
        if (!unknown.has(k)) unknown.set(k, { rel, key, prop, literal })
        return literal
      }
      count++
      return `var(${token})`
    })
    return `${prop}: ${next};`
  })

  if (count > 0) {
    replaced += count
    touchedFiles++
    if (WRITE) fs.writeFileSync(file, after)
    console.log(`${String(count).padStart(4)}  ${rel}`)
  }
}

console.log(`\n${WRITE ? "replaced" : "would replace"}: ${replaced} in ${touchedFiles} files`)
if (unknown.size) {
  console.log(`\nunmapped (${unknown.size}):`)
  for (const u of unknown.values()) console.log(`  ${u.rel}: ${u.prop}: ${u.literal}`)
}
