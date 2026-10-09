import { Settings2, LayoutGrid, CodeXml, Terminal, GitBranch, Palette, Keyboard, Blocks } from "lucide-react";

export const NAV_GROUPS = ["Preferences", "Workspace", "System"];

export const NAV = [
  { id: "general",     label: "General",     desc: "Appearance, startup behaviour and general preferences.", group: "Preferences", icon: Settings2, keywords: "theme appearance zoom ui scale startup session restore hidden files telemetry privacy confirm delete media viewer" },
  { id: "hub",         label: "Hub",         desc: "Project Hub, contribution heatmap and app-data management.", group: "Preferences", icon: LayoutGrid, keywords: "github username contribution heatmap wallpaper opacity custom cursor click sound recent projects storage onboarding" },
  { id: "editor",      label: "Editor",      desc: "Font, wrapping and editing behaviour.", group: "Preferences", icon: CodeXml, keywords: "font size family theme tab size indent word wrap line numbers autocompletion auto save snippets vim" },
  { id: "terminal",    label: "Terminal",    desc: "Font, cursor, scrollback and shell preferences.", group: "Preferences", icon: Terminal, keywords: "font size family cursor style blink scrollback buffer copy on select shell" },
  { id: "git",         label: "Git",         desc: "Commit, fetch and gutter preferences.", group: "Workspace", icon: GitBranch, keywords: "auto fetch stash commit confirm gutter inline blame source control" },
  { id: "canvas",      label: "Canvas",      desc: "Drawing surface and preview preferences.", group: "Workspace", icon: Palette, keywords: "excalidraw drawing background autosave storage grid" },
  { id: "keybindings", label: "Keybindings", desc: "Keyboard shortcuts.", group: "System", icon: Keyboard, keywords: "keyboard shortcuts hotkeys keys bindings command palette" },
  { id: "extensions",  label: "Extensions",  desc: "Manage installed extensions.", group: "System", icon: Blocks, keywords: "chrome crx browser unpacked load extension" },
];

export const NAV_BY_ID = Object.fromEntries(NAV.map((n) => [n.id, n]));
