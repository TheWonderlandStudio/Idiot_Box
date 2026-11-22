import React, { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Search, Copy, Download, Upload, Check } from "lucide-react";
import { THEME_GROUPS, THEME_TOKEN_MAP } from "../../../theme/tokens.generated.js";
import { applyThemeSettings, cssVar, isLightTheme, setThemeVar, themeMode } from "../../shared/theme.js";

// ─── AppearancePage ─────────────────────────────────────────────────────────
// Every color in the app comes from variables.css. This page exposes those
// tokens as color pickers and stores user overrides in settings.customTheme
// ({ dark: { "--token": "#hex" }, light: { ... } }).
// ─────────────────────────────────────────────────────────────────────────────

const MODE_LABEL = { dark: "Dark theme", light: "Light theme" };

const THEME_OPTIONS = [
  { value: "dark", label: "Dark (default)" },
  { value: "darkPlus", label: "Dark+" },
  { value: "light", label: "Light" },
];

// Resolve any CSS color (hex / rgb / hsl / oklch) to #rrggbb for <input type=color>.
const resolveHex = (value) => {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    return ("#" + raw.slice(1).split("").map((c) => c + c).join("")).toLowerCase();
  }
  if (/^#[0-9a-f]{8}$/i.test(raw)) return raw.slice(0, 7).toLowerCase();
  try {
    const el = document.createElement("span");
    el.style.color = raw;
    if (!el.style.color) return cssVar("--black");
    el.style.position = "absolute";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    document.body.appendChild(el);
    const rgb = getComputedStyle(el).color;
    el.remove();
    const m = rgb.match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return cssVar("--black");
    const to = (n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, "0");
    return `#${to(m[0])}${to(m[1])}${to(m[2])}`;
  } catch {
    return cssVar("--black");
  }
};

const isValidColor = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)|transparent)$/i.test(raw)) return true;
  try {
    const el = document.createElement("span");
    el.style.color = raw;
    return !!el.style.color;
  } catch {
    return false;
  }
};

const clone = (value) => JSON.parse(JSON.stringify(value || {}));

const AppearancePage = ({ settings, onSave }) => {
  const activeMode = themeMode(settings);
  const [editMode, setEditMode] = useState(activeMode);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [customTheme, setCustomTheme] = useState(() => clone(settings.customTheme));
  const [drafts, setDrafts] = useState({});
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef(null);
  const fileRef = useRef(null);
  const savedRef = useRef(JSON.stringify(settings.customTheme || {}));

  // Follow external changes (other window / reset) without stomping local edits.
  useEffect(() => {
    const next = JSON.stringify(settings.customTheme || {});
    if (next !== savedRef.current) {
      savedRef.current = next;
      setCustomTheme(clone(settings.customTheme));
    }
  }, [settings.customTheme]);

  // Editing a different mode should not leave the other mode's preview applied.
  useEffect(() => {
    if (editMode !== activeMode) applyThemeSettings(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const overrides = customTheme?.[editMode] || {};

  const persist = (next, immediate = false) => {
    setCustomTheme(next);
    savedRef.current = JSON.stringify(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const write = () => onSave({ customTheme: next });
    if (immediate) write();
    else saveTimer.current = setTimeout(write, 250);
  };

  const changeColor = (token, value, { persistNow = false } = {}) => {
    const next = clone(customTheme);
    if (!next[editMode]) next[editMode] = {};
    if (value == null || String(value).trim() === "") delete next[editMode][token];
    else next[editMode][token] = String(value).trim();
    if (Object.keys(next[editMode]).length === 0) delete next[editMode];
    // Live preview only while editing the mode the app is currently showing.
    if (editMode === activeMode) setThemeVar(token, value);
    persist(next, persistNow);
  };

  const resetToken = (token) => {
    const next = clone(customTheme);
    if (next[editMode]) {
      delete next[editMode][token];
      if (Object.keys(next[editMode]).length === 0) delete next[editMode];
    }
    if (editMode === activeMode) setThemeVar(token, "");
    persist(next, true);
  };

  const resetGroup = (tokens) => {
    const next = clone(customTheme);
    if (next[editMode]) {
      for (const key of tokens) delete next[editMode][key];
      if (Object.keys(next[editMode]).length === 0) delete next[editMode];
    }
    if (editMode === activeMode) for (const key of tokens) setThemeVar(key, "");
    persist(next, true);
  };

  const resetAll = () => {
    persist({}, true);
    applyThemeSettings({ ...settings, customTheme: {} });
  };

  const exportTheme = () => {
    const payload = { format: "idiot-box-theme", version: 1, customTheme: customTheme || {} };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "idiot-box-theme.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importTheme = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const raw = data?.customTheme && typeof data.customTheme === "object" ? data.customTheme : data;
      const next = {};
      for (const mode of ["dark", "light"]) {
        const map = raw?.[mode];
        if (!map || typeof map !== "object") continue;
        next[mode] = {};
        for (const [key, value] of Object.entries(map)) {
          if (key.startsWith("--") && typeof value === "string" && isValidColor(value)) {
            next[mode][key] = value.trim();
          }
        }
        if (Object.keys(next[mode]).length === 0) delete next[mode];
      }
      persist(next, true);
      if (editMode === activeMode) applyThemeSettings({ ...settings, customTheme: next });
    } catch {}
  };

  const copyCss = async () => {
    const lines = [":root[data-theme=\"dark\"] {"];
    for (const [key, value] of Object.entries(customTheme?.dark || {})) lines.push(`  ${key}: ${value};`);
    lines.push("}", "", ":root[data-theme=\"light\"] {");
    for (const [key, value] of Object.entries(customTheme?.light || {})) lines.push(`  ${key}: ${value};`);
    lines.push("}");
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return THEME_GROUPS
      .filter((g) => group === "all" || g.id === group)
      .map((g) => ({
        ...g,
        tokens: g.tokens.filter((key) => {
          if (!q) return true;
          const t = THEME_TOKEN_MAP[key];
          return (
            key.toLowerCase().includes(q) ||
            (t?.label || "").toLowerCase().includes(q) ||
            (t?.description || "").toLowerCase().includes(q)
          );
        }),
      }))
      .filter((g) => g.tokens.length > 0);
  }, [query, group]);

  const customizedCount = Object.keys(overrides).length;
  const totalCustomized = Object.values(customTheme || {}).reduce(
    (sum, map) => sum + Object.keys(map || {}).length,
    0,
  );

  const isActiveMode = editMode === activeMode;

  return (
    <div className="th-page">
      <section className="sw-frame">
        <div className="sw-section-title">Theme</div>

        <div className="sw-row">
          <span className="sw-row__label">Active theme</span>
          <span className="sw-row__desc">
            Switches the whole app between the dark and light token sets. Custom colors are kept per mode.
          </span>
          <select
            className="sw-select"
            value={isLightTheme(settings.theme) ? "light" : (settings.theme || "dark")}
            onChange={(e) => onSave({ theme: e.target.value })}
            aria-label="Active theme"
          >
            {THEME_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="sw-row">
          <span className="sw-row__label">Colors to edit</span>
          <span className="sw-row__desc">
            Every color in the app is a token. Pick a mode, then change any token below — changes apply live
            and are saved to your settings.
          </span>
          <div className="th-tabs" role="tablist" aria-label="Theme mode">
            {["dark", "light"].map((mode) => (
              <button
                key={mode}
                role="tab"
                aria-selected={editMode === mode}
                className={`th-tab${editMode === mode ? " th-tab--active" : ""}`}
                onClick={() => setEditMode(mode)}
              >
                {MODE_LABEL[mode]}
                <span className="th-tab__count">
                  {Object.keys(customTheme?.[mode] || {}).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {!isActiveMode && (
          <div className="th-note">
            You are editing the {editMode} palette while the app shows the {activeMode} theme.
            <button className="th-link" onClick={() => onSave({ theme: editMode })}>
              Switch app to {editMode}
            </button>
          </div>
        )}

        <div className="th-actions">
          <button className="th-btn" onClick={exportTheme} title="Download the current colors as JSON">
            <Download size={13} /> Export
          </button>
          <button className="th-btn" onClick={() => fileRef.current?.click()} title="Load colors from a JSON file">
            <Upload size={13} /> Import
          </button>
          <button className="th-btn" onClick={copyCss} title="Copy the current overrides as CSS">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy CSS"}
          </button>
          <button className="th-btn th-btn--danger" onClick={resetAll} disabled={totalCustomized === 0}>
            <RotateCcw size={13} /> Reset all colors
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="th-file"
            onChange={(e) => { importTheme(e.target.files?.[0]); e.target.value = ""; }}
          />
          <span className="th-stat">
            {customizedCount} customized in {editMode}
            {totalCustomized !== customizedCount ? ` · ${totalCustomized} total` : ""}
          </span>
        </div>
      </section>

      <div className="th-toolbar">
        <div className="th-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search colors (background, teal, border…)"
            aria-label="Search theme colors"
          />
        </div>
        <div className="th-chips">
          <button
            className={`th-chip${group === "all" ? " th-chip--active" : ""}`}
            onClick={() => setGroup("all")}
          >
            All
          </button>
          {THEME_GROUPS.map((g) => (
            <button
              key={g.id}
              className={`th-chip${group === g.id ? " th-chip--active" : ""}`}
              onClick={() => setGroup(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {visibleGroups.length === 0 && (
        <div className="th-empty">No colors match “{query}”.</div>
      )}

      {visibleGroups.map((g) => {
        const groupOverrides = g.tokens.filter((key) => overrides[key] != null).length;
        return (
          <section className="sw-frame th-group" key={g.id}>
            <div className="sw-section-title th-group__head">
              <span>{g.label}</span>
              <span className="th-group__meta">
                {groupOverrides > 0 && <span className="th-group__count">{groupOverrides} customized</span>}
                {groupOverrides > 0 && (
                  <button className="th-link" onClick={() => resetGroup(g.tokens)}>Reset group</button>
                )}
              </span>
            </div>
            <div className="th-rows">
              {g.tokens.map((key) => {
                const token = THEME_TOKEN_MAP[key];
                const value = overrides[key] ?? token?.[editMode] ?? "";
                const overridden = overrides[key] != null;
                const draft = drafts[key] ?? value;
                return (
                  <div className={`th-row${overridden ? " th-row--custom" : ""}`} key={key}>
                    <label className="th-swatch" style={{ background: value }} title={`Pick ${token?.label || key}`}>
                      <input
                        type="color"
                        value={resolveHex(value)}
                        onChange={(e) => {
                          setDrafts((d) => ({ ...d, [key]: e.target.value }));
                          changeColor(key, e.target.value);
                        }}
                        aria-label={`${token?.label || key} color`}
                      />
                    </label>
                    <div className="th-info">
                      <span className="th-label">{token?.label || key}</span>
                      <code className="th-key" title={token?.description || key}>{key}</code>
                    </div>
                    <input
                      className="sw-input th-value"
                      value={draft}
                      spellCheck={false}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDrafts((d) => ({ ...d, [key]: v }));
                        if (isValidColor(v)) changeColor(key, v);
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        setDrafts((d) => {
                          const next = { ...d };
                          delete next[key];
                          return next;
                        });
                        if (v === "") changeColor(key, "", { persistNow: true });
                        else if (isValidColor(v)) changeColor(key, v, { persistNow: true });
                      }}
                      aria-label={`${token?.label || key} value`}
                    />
                    <button
                      className="th-reset"
                      onClick={() => {
                        setDrafts((d) => {
                          const next = { ...d };
                          delete next[key];
                          return next;
                        });
                        resetToken(key);
                      }}
                      disabled={!overridden}
                      title={overridden ? "Reset this color" : "Using the built-in color"}
                      aria-label={`Reset ${token?.label || key}`}
                    >
                      <RotateCcw size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default AppearancePage;
