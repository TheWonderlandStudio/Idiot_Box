import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Play, Sparkles, Square } from "lucide-react";
import { CM_LANG_IDS, displayNameFor } from "./cm/languages.js";

export default function EditorStatusBar({
  cursorPos,
  statusMsg,
  database,
  editable,
  problemCount,
  blame,
  canPreview,
  previewOpen,
  previewKind,
  formatBusy,
  autoSave,
  settings,
  eol,
  encoding,
  languageId,
  onPreview,
  onFormat,
  onProblems,
  onIndent,
  onEol,
  onWrap,
  onMinimap,
  onLanguage,
}) {
  const [menu, setMenu] = useState(null);
  const [query, setQuery] = useState("");
  const barRef = useRef(null),
    popupRef = useRef(null),
    moreRef = useRef(null),
    languageRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const displayName = displayNameFor(languageId);
  const tabSize = Number.isFinite(settings.tabSize) ? settings.tabSize : 2;
  const location = database
    ? "SQLite database"
    : `Ln ${cursorPos.line}, Col ${cursorPos.col}`;
  const fullLocation = database
    ? "SQLite database · data / schema / SQL"
    : `${location} (${cursorPos.totalLines} lines)`;
  const close = (restore = false) => {
    setMenu(null);
    if (restore) triggerRef.current?.focus();
  };
  const open = (next, trigger) => {
    triggerRef.current = trigger;
    setQuery("");
    setMenu((current) => (current === next ? null : next));
  };

  useEffect(() => {
    const owner = barRef.current.closest(".ed-panel");
    const resize = () => {
      barRef.current.style.setProperty(
        "--ed-status-popup-height",
        `${Math.max(0, owner.clientHeight - barRef.current.offsetHeight - 8)}px`,
      );
      if (owner.clientWidth > 900 && menuRef.current === "more") {
        if (popupRef.current?.contains(document.activeElement))
          languageRef.current?.focus();
        setMenu(null);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(owner);
    resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menu) return;
    const frame = requestAnimationFrame(() =>
      popupRef.current?.querySelector("input,button:not(:disabled)")?.focus(),
    );
    const outside = (event) => {
      if (!barRef.current?.contains(event.target)) close();
    };
    const escape = (event) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [menu]);

  const actions = [
    canPreview && {
      id: "preview",
      label: previewOpen
        ? "Back to editor"
        : previewKind
          ? `Preview ${previewKind}`
          : "Preview document",
      short: previewOpen ? "Editor" : `${previewKind || "Document"} Preview`,
      icon: previewOpen ? Square : Play,
      run: onPreview,
    },
    editable && {
      id: "format",
      label: formatBusy ? "Formatting…" : "Format document",
      short: "Format",
      icon: Sparkles,
      disabled: formatBusy,
      run: onFormat,
    },
    {
      id: "indent",
      label: `Indentation: ${settings.indentUnit === "\t" ? "Tab" : `Spaces: ${tabSize}`}`,
      short: settings.indentUnit === "\t" ? "Tab" : `Spaces: ${tabSize}`,
      run: onIndent,
    },
    { id: "eol", label: `End of line: ${eol}`, short: eol, run: onEol },
    {
      id: "wrap",
      label: "Word wrap",
      short: `Wrap: ${settings.lineWrapping === false ? "Off" : "On"}`,
      checked: settings.lineWrapping !== false,
      run: onWrap,
    },
    {
      id: "minimap",
      label: "Minimap",
      short: "Minimap",
      checked: settings.minimap !== false,
      run: onMinimap,
    },
  ].filter(Boolean);
  const choose = (action) => {
    close(true);
    action.run();
  };
  const menuKey = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (event.target.tagName === "INPUT" && ["Home", "End"].includes(event.key))
      return;
    const items = [
      ...popupRef.current.querySelectorAll("input,button:not(:disabled)"),
    ];
    const current = items.indexOf(document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    event.preventDefault();
    items[next]?.focus();
    items[next]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="ed-status" ref={barRef} aria-label="Editor status">
      <div className="ed-status__left">
        <span className="ed-status__location" title={fullLocation}>
          {location}
          <span className="ed-status__total">
            {!database && ` (${cursorPos.totalLines} lines)`}
          </span>
        </span>
        {statusMsg && (
          <span className="ed-status__message" role="status" title={statusMsg}>
            {statusMsg}
          </span>
        )}
        {editable && (
          <button
            className="ed-status__button ed-status__detail"
            onClick={onProblems}
            title="Problems (F8)"
          >
            ⚠ {problemCount}
          </button>
        )}
        {blame && (
          <span
            className="ed-blame ed-status__detail"
            title={`${blame.author} · ${blame.when} · ${blame.summary} · ${blame.hash?.slice(0, 7)}`}
          >
            {blame.author} · {blame.when} · {blame.summary}
          </span>
        )}
      </div>
      <div className="ed-status__secondary">
        {actions.map((action) => (
          <button
            key={action.id}
            className="ed-status__button"
            onClick={action.run}
            disabled={action.disabled}
            title={action.label}
          >
            {action.icon && <action.icon size={11} />} {action.short}
          </button>
        ))}
        {autoSave && <span>AutoSave: On</span>}
        <span title="File encoding">{encoding}</span>
      </div>
      <button
        className="ed-status__button ed-status__language"
        ref={languageRef}
        title={`Change language mode: ${displayName}`}
        aria-label={`Language mode: ${displayName}`}
        aria-haspopup="dialog"
        aria-expanded={menu === "language"}
        onClick={() => open("language", languageRef.current)}
      >
        {displayName}
      </button>
      <button
        className="ed-status__button ed-status__more"
        ref={moreRef}
        title="More editor actions"
        aria-label="More editor actions"
        aria-haspopup="menu"
        aria-expanded={menu === "more"}
        onClick={() => open("more", moreRef.current)}
      >
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <div
          className="ed-status__popup"
          ref={popupRef}
          role={menu === "more" ? "menu" : "dialog"}
          aria-label={menu === "more" ? "Editor actions" : "Language mode"}
          onKeyDown={menuKey}
        >
          {menu === "more" ? (
            <>
              {editable && (
                <button
                  role="menuitem"
                  onClick={() => choose({ run: onProblems })}
                >
                  Problems <span>{problemCount}</span>
                </button>
              )}
              {actions.map((action) => (
                <button
                  key={action.id}
                  role={
                    action.checked === undefined
                      ? "menuitem"
                      : "menuitemcheckbox"
                  }
                  aria-checked={action.checked}
                  disabled={action.disabled}
                  onClick={() => choose(action)}
                >
                  {action.label}
                  <span>
                    {action.checked === undefined
                      ? ""
                      : action.checked
                        ? "On"
                        : "Off"}
                  </span>
                </button>
              ))}
              <div className="ed-status__info">
                AutoSave: {autoSave ? "On" : "Off"} · {encoding}
              </div>
              {statusMsg && <div className="ed-status__info">{statusMsg}</div>}
              {blame && (
                <div className="ed-status__info">
                  {blame.author} · {blame.when}
                  <br />
                  {blame.summary}
                </div>
              )}
            </>
          ) : (
            <>
              <label className="ed-status__search-label">
                Language mode
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search languages…"
                />
              </label>
              {CM_LANG_IDS.filter((id) =>
                `${displayNameFor(id)} ${id}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase()),
              ).map((id) => (
                <button
                  key={id}
                  aria-pressed={id === languageId}
                  onClick={() => {
                    close(true);
                    onLanguage(id);
                  }}
                >
                  {displayNameFor(id)}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
