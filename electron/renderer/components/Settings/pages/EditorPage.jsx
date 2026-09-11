import React, { useState, useEffect, useRef } from "react";
import {
  DEFAULT_CM_SETTINGS,
  validateCmSettings,
  saveStoredCmSettings,
} from "../../Editor/cm/settings.js";

// ─── EditorPage (CodeMirror) ────────────────────────────────────────────────
// Neeche wala JSON hi source-of-truth hai: toggles + JSON box two-way synced.
// Apply validated hai (galat type wapas purani value + error list), save
// settings.json (live broadcast) + localStorage { v, settings } versioning.
// ─────────────────────────────────────────────────────────────────────────────

const FONT_OPTIONS = [
  "Consolas",
  "Cascadia Code",
  "Fira Code",
  "JetBrains Mono",
  "Courier New",
  "monospace",
];

const THEME_OPTIONS = [
  { value: "dark", label: "Dark (VS Code Dark)" },
  { value: "light", label: "Light (VS Code Light)" },
  { value: "oneDark", label: "One Dark" },
];

const INDENT_OPTIONS = [
  { value: "  ", label: "2 spaces" },
  { value: "    ", label: "4 spaces" },
  { value: "\t", label: "Tab" },
];

const FLAG_GROUPS = [
  {
    title: "Gutter & View",
    flags: [
      ["lineNumbers", "Line Numbers", "Gutter me line numbers dikhao."],
      ["highlightActiveLineGutter", "Active Line Gutter", "Current line ka gutter number highlight karo."],
      ["highlightSpecialChars", "Special Chars", "Invisible/control characters dikhao."],
      ["foldGutter", "Fold Gutter", "Code folding markers (gutter me)."],
      ["drawSelection", "Draw Selection", "Selection ka layer rendering."],
      ["dropCursor", "Drop Cursor", "Drag-drop ke waqt drop position dikhao."],
      ["rectangularSelection", "Rectangular Selection", "Alt+drag se block selection."],
      ["crosshairCursor", "Crosshair Cursor", "Alt dabane par crosshair cursor."],
      ["highlightActiveLine", "Active Line", "Current line poori highlight karo."],
      ["highlightSelectionMatches", "Selection Matches", "Selected text ke saare matches highlight karo."],
      ["highlightWhitespace", "Whitespace Dots", "Har space/tab par faint dots (custom all-spaces)."],
      ["lineWrapping", "Word Wrap", "Lambi lines wrap karo (horizontal scroll nahi)."],
    ],
  },
  {
    title: "Editing",
    flags: [
      ["history", "Undo History", "Undo/redo stack."],
      ["allowMultipleSelections", "Multi-Cursor", "Ctrl+click se multiple cursors."],
      ["indentOnInput", "Indent On Input", "Brace/newline par auto-indent."],
      ["bracketMatching", "Bracket Matching", "Matching brackets highlight karo."],
      ["closeBrackets", "Close Brackets", "Bracket type karte hi auto-close."],
      ["syntaxHighlighting", "Syntax Highlighting", "Grammar-based coloring."],
      ["customHighlights", "Custom Highlights", "Built-in theme ki jagah custom token colors."],
    ],
  },
  {
    title: "Completion & Lint",
    flags: [
      ["autocompletion", "Autocompletion", "Suggest popup (Ctrl+Space)."],
      ["snippets", "Snippets", "Per-language snippet templates (built-ins ke sath merge)."],
      ["tabAcceptsCompletion", "Tab Accepts Suggestion", "Tab: suggestion khula ho to accept, band ho to normal indent. (Popup ke turant baad ~75ms tak Tab indent karega — interaction guard.)"],
      ["lint", "Lint", "JSON validation + trailing-whitespace + TODO markers."],
      ["lintGutter", "Lint Gutter", "Errors/warnings ke gutter markers + Problems panel."],
    ],
  },
  {
    title: "Keymaps",
    flags: [
      ["customKeys", "Custom Keys", "Tab=accept, Ctrl+/=comment, Ctrl+D=delete line, Alt+↑/↓=move line."],
      ["defaultKeymap", "Default Keymap", "Standard editing keys."],
      ["searchKeymap", "Search Keymap", "Find/replace/go-to-line keys."],
      ["historyKeymap", "History Keymap", "Undo/redo keys."],
      ["foldKeymap", "Fold Keymap", "Fold/unfold keys."],
      ["completionKeymap", "Completion Keymap", "Suggest popup keys."],
      ["lintKeymap", "Lint Keymap", "Next/prev diagnostic keys."],
      ["closeBracketsKeymap", "Close-Brackets Keymap", "Bracket navigation keys."],
    ],
  },
  {
    title: "Modes",
    flags: [
      ["vim", "Vim Mode", "Vim keybindings (toggleable)."],
    ],
  },
];

const broadcast = (patch) => {
  try {
    window.opener?.dispatchEvent(new CustomEvent("editor:settings-changed", { detail: patch }));
  } catch {}
  try {
    const bc = new BroadcastChannel("editor-settings");
    bc.postMessage(patch);
    bc.close();
  } catch {}
};

const stringifyForm = (form) => JSON.stringify(form, null, 2);

const EditorPage = ({ settings, onSave }) => {
  // settings.json + defaults -> validated form (fatal nahi: errors dikhte hain)
  const [form, setForm] = useState(() => validateCmSettings(settings || {}).settings);
  const [jsonText, setJsonText] = useState(() => stringifyForm(validateCmSettings(settings || {}).settings));
  const [jsonErrors, setJsonErrors] = useState([]);
  const [jsonOk, setJsonOk] = useState("");
  const [jsonDirty, setJsonDirty] = useState(false); // box me unapplied edits
  const formRef = useRef(form);
  formRef.current = form;

  // Dusri window se settings badle to form + box sync karo (box me unapplied
  // edits hon to box mat chhedo).
  useEffect(() => {
    const next = validateCmSettings({ ...formRef.current, ...(settings || {}) }).settings;
    setForm(next);
    setJsonDirty((dirty) => {
      if (!dirty) setJsonText(stringifyForm(next));
      return dirty;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const persist = async (nextForm) => {
    // Compat mirror: wordWrap (Notebook/purane readers) + theme duplicates
    const patch = { ...nextForm, wordWrap: nextForm.lineWrapping !== false, editorTheme: nextForm.theme, theme: nextForm.theme };
    await onSave(patch);
    broadcast(patch);
    try { saveStoredCmSettings(nextForm); } catch {}
  };

  const applyForm = (nextForm) => {
    setForm(nextForm);
    setJsonText(stringifyForm(nextForm));
    setJsonDirty(false);
    setJsonErrors([]);
    persist(nextForm);
  };

  const toggle = (key) => {
    const next = { ...formRef.current, [key]: !formRef.current[key] };
    applyForm(next);
  };

  const updateValue = (key, value) => {
    const next = { ...formRef.current, [key]: value };
    applyForm(next);
  };

  // ── JSON box: type karte hi validate (live errors), Apply par save ──
  const onJsonChange = (text) => {
    setJsonText(text);
    setJsonDirty(true);
    setJsonOk("");
    try {
      const parsed = JSON.parse(text);
      const { errors } = validateCmSettings(parsed);
      setJsonErrors(errors);
    } catch (e) {
      setJsonErrors(["Invalid JSON: " + (e?.message || e)]);
    }
  };

  const applyJson = () => {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      setJsonErrors(["Invalid JSON: " + (e?.message || e)]);
      return;
    }
    const { settings: valid, errors } = validateCmSettings({ ...formRef.current, ...parsed });
    setJsonErrors(errors);
    setForm(valid);
    setJsonText(stringifyForm(valid));
    setJsonDirty(false);
    setJsonOk(errors.length ? "Applied with warnings (neeche dekho)" : "Applied");
    persist(valid);
    setTimeout(() => setJsonOk(""), 3000);
  };

  const resetDefaults = () => {
    applyForm({ ...DEFAULT_CM_SETTINGS });
    setJsonOk("Defaults restored");
    setTimeout(() => setJsonOk(""), 3000);
  };

  const compat = settings || {};
  const autoSave = compat.autoSave === true || compat.autoSave === "afterDelay";
  const formatOnSave = compat.formatOnSave === true;
  const fontFamily = compat.fontFamily || "Consolas";

  const toggleCompat = async (key, currentVal) => {
    const next = !currentVal;
    await onSave({ [key]: next });
    broadcast({ [key]: next });
  };

  const ToggleRow = ({ flagKey, label, desc }) => {
    const on = form[flagKey] !== false;
    return (
      <div className="sw-row">
        <span className="sw-row__label">{label}</span>
        <span className="sw-row__desc">{desc}</span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{on ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${on ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggle(flagKey)}
            aria-checked={on}
            role="switch"
            aria-label={`Toggle ${label}`}
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>
    );
  };

  return (
    <div>
      <div className="sw-row">
        <span className="sw-row__label">Settings JSON (source-of-truth)</span>
        <span className="sw-row__desc">
          Toggles aur ye box two-way synced hain. Box edit karke Apply dabao — validation errors neeche dikhenge, galat values purani rahengi.
        </span>
      </div>
      <textarea
        value={jsonText}
        onChange={(e) => onJsonChange(e.target.value)}
        spellCheck={false}
        rows={12}
        style={{
          width: "100%", boxSizing: "border-box", resize: "vertical",
          background: "var(--bg-surface)", border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-md)", color: "var(--text-highlight)",
          fontFamily: "var(--font-code)", fontSize: "var(--fs-body)",
          padding: "var(--space-8) var(--space-10)", outline: "none",
          minHeight: 180,
        }}
        aria-label="Editor settings JSON"
      />
      {!!jsonErrors.length && (
        <div style={{ marginTop: "var(--space-6)", color: "var(--danger)", fontSize: "var(--fs-small)" }}>
          {jsonErrors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      )}
      {jsonOk && (
        <div style={{ marginTop: "var(--space-6)", color: "var(--teal)", fontSize: "var(--fs-small)" }}>{jsonOk}</div>
      )}
      <div style={{ display: "flex", gap: "var(--space-8)", margin: "var(--space-8) 0 var(--space-12)" }}>
        <button className="sw-btn" onClick={applyJson} disabled={!jsonDirty && !jsonErrors.length} title="Validate karke apply karo">
          Apply JSON
        </button>
        <button className="sw-btn" onClick={resetDefaults} title="Sab defaults par wapas">
          Reset Defaults
        </button>
      </div>

      {FLAG_GROUPS.map((g) => (
        <div key={g.title}>
          <div className="sw-section-title">{g.title}</div>
          {g.flags.map(([key, label, desc]) => (
            <ToggleRow key={key} flagKey={key} label={label} desc={desc} />
          ))}
        </div>
      ))}

      {/* ── Theme (3-way) ── */}
      <div className="sw-section-title">Appearance</div>
      <div className="sw-row">
        <span className="sw-row__label">Theme</span>
        <span className="sw-row__desc">
          vscodeDark / vscodeLight / oneDark. Turant apply hota hai. (Purane Dark+/Light+ settings auto-migrate ho jate hain.)
        </span>
        <select
          className="sw-select"
          value={form.theme || "dark"}
          onChange={(e) => updateValue("theme", e.target.value)}
          aria-label="Editor theme"
        >
          {THEME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Font Family (compat) ── */}
      <div className="sw-row">
        <span className="sw-row__label">Font Family</span>
        <span className="sw-row__desc">
          Editor font. Missing font par monospace fallback lagta hai.
        </span>
        <select
          className="sw-select"
          value={fontFamily}
          onChange={async (e) => { await onSave({ fontFamily: e.target.value }); broadcast({ fontFamily: e.target.value }); }}
          aria-label="Font family"
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      {/* ── Font Size ── */}
      <div className="sw-row">
        <span className="sw-row__label">Font Size</span>
        <span className="sw-row__desc">
          Pixels me. Range 8–32.
        </span>
        <div className="sw-inline-row">
          <input
            type="range"
            className="sw-range"
            min={8}
            max={32}
            step={1}
            value={Number.isFinite(form.fontSize) ? form.fontSize : 14}
            onChange={(e) => {
              let v = parseInt(e.target.value, 10);
              if (!Number.isFinite(v)) return;
              updateValue("fontSize", Math.min(32, Math.max(8, v)));
            }}
            aria-label="Font size"
          />
          <input
            type="number"
            className="sw-input sw-input--small"
            min={8}
            max={32}
            value={Number.isFinite(form.fontSize) ? form.fontSize : 14}
            onChange={(e) => {
              let v = parseInt(e.target.value, 10);
              if (!Number.isFinite(v)) return;
              updateValue("fontSize", Math.min(32, Math.max(8, v)));
            }}
            aria-label="Font size number"
          />
          <span className="sw-inline-label">px</span>
        </div>
      </div>

      {/* ── Tab Size + Indent Unit ── */}
      <div className="sw-row">
        <span className="sw-row__label">Tab Size</span>
        <span className="sw-row__desc">
          EditorState.tabSize — tab stop width (1–8).
        </span>
        <select
          className="sw-select"
          value={form.tabSize}
          onChange={(e) => updateValue("tabSize", parseInt(e.target.value, 10))}
          aria-label="Tab size"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>{n} spaces</option>
          ))}
        </select>
      </div>
      <div className="sw-row">
        <span className="sw-row__label">Indent Unit</span>
        <span className="sw-row__desc">
          indentUnit.of(...) — nayi indent me kya insert ho.
        </span>
        <select
          className="sw-select"
          value={form.indentUnit}
          onChange={(e) => updateValue("indentUnit", e.target.value)}
          aria-label="Indent unit"
        >
          {INDENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Auto Save (compat) ── */}
      <div className="sw-section-title">Saving</div>
      <div className="sw-row">
        <span className="sw-row__label">Auto Save</span>
        <span className="sw-row__desc">
          Rukne par thodi der me auto-save. Band ho to Ctrl+S dabao.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{autoSave ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${autoSave ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggleCompat("autoSave", autoSave)}
            aria-checked={autoSave}
            role="switch"
            aria-label="Toggle auto save"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Format On Save (Prettier) ── */}
      <div className="sw-row">
        <span className="sw-row__label">Format On Save</span>
        <span className="sw-row__desc">
          Har save se pehle Prettier formatter (JS/TS/JSON/HTML/CSS/Markdown/YAML). Baaki languages me no-op.
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{formatOnSave ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${formatOnSave ? " sw-toggle-btn--on" : ""}`}
            onClick={() => toggleCompat("formatOnSave", formatOnSave)}
            aria-checked={formatOnSave}
            role="switch"
            aria-label="Toggle format on save"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      <div className="sw-row">
        <span className="sw-row__label">Minimap</span>
        <span className="sw-row__desc">
          CodeMirror me minimap nahi hota — ye setting ab ignore hoti hai (purani value bani rehti hai, kuch toot ta nahi).
        </span>
      </div>
    </div>
  );
};

export default EditorPage;
