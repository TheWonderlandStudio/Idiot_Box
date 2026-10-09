import React, { useState, useEffect, useMemo, useRef } from "react";
import { Search } from "lucide-react";
import useSettings from "../shared/useSettings.jsx";
import { NAV_GROUPS, NAV, NAV_BY_ID } from "./nav.js";
import { SETTINGS_INDEX } from "./searchIndex.js";
import GeneralPage     from "./pages/GeneralPage.jsx";
import HubPage         from "./pages/HubPage.jsx";
import EditorPage      from "./pages/EditorPage.jsx";
import TerminalPage    from "./pages/TerminalPage.jsx";
import GitPage         from "./pages/GitPage.jsx";
import CanvasPage      from "./pages/CanvasPage.jsx";
import KeybindingsPage from "./pages/KeybindingsPage.jsx";
import ExtensionsPage  from "./pages/ExtensionsPage.jsx";
import "../../variables.css";
import "./settings.css";

const urlParam = (name) => {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
};

const INITIAL_PAGE = (() => {
  const p = urlParam("page");
  return p && NAV.some((n) => n.id === p) ? p : "general";
})();

const INITIAL_FOCUS = (() => {
  const f = urlParam("focus");
  return f ? { label: f, page: INITIAL_PAGE } : null;
})();

// Pages ka plain root div unwrap karta hai, taaki har sw-frame
// (.sw-section-title card header + rows) body ke direct child banein.
const UnwrapRoot = ({ children }) => {
  let count = 0;
  let single = null;
  React.Children.forEach(children, (c) => {
    if (c === null || c === undefined || typeof c === "boolean") return;
    count++;
    single = c;
  });
  if (
    count === 1 &&
    React.isValidElement(single) &&
    single.type === "div" &&
    !single.props.className &&
    !single.props.style
  ) {
    return <>{single.props.children}</>;
  }
  return <>{children}</>;
};

const SettingsWindow = () => {
  const [activePage, setActivePage] = useState(INITIAL_PAGE);
  const [settings, updateSettings, loading] = useSettings();
  const [gq, setGq] = useState("");
  const [gsOpen, setGsOpen] = useState(false);
  const [gsIdx, setGsIdx] = useState(0);
  const [gsPos, setGsPos] = useState(null);
  const [focusReq, setFocusReq] = useState(INITIAL_FOCUS);

  const searchWrapRef = useRef(null);
  const gsRef = useRef(null);
  const inputRef = useRef(null);
  const bodyRef = useRef(null);

  const visibleNav = useMemo(() => {
    const q = String(gq || "").trim().toLowerCase();
    if (!q) return NAV;
    return NAV.filter((n) => n.label.toLowerCase().includes(q) || n.id.includes(q));
  }, [gq]);

  const gsResults = useMemo(() => {
    const q = String(gq || "").trim().toLowerCase();
    if (!q) return [];
    const out = [];
    // Specific rows pehle, page entries baad me
    for (const pass of ["row", "page"]) {
      for (const e of SETTINGS_INDEX) {
        if (e.kind !== pass) continue;
        const pageLabel = NAV_BY_ID[e.page]?.label || e.page;
        const hay = `${e.label} ${e.desc} ${e.kw || ""} ${pageLabel}`.toLowerCase();
        if (hay.includes(q)) out.push(e);
        if (out.length >= 40) break;
      }
      if (out.length >= 40) break;
    }
    return out;
  }, [gq]);

  const gsItems = gsResults;

  const gsList = useMemo(() => {
    const out = [];
    let group = null;
    let i = 0;
    for (const e of gsResults) {
      const head = e.kind === "page" ? "Pages" : "Settings";
      if (head !== group) {
        group = head;
        out.push({ type: "head", key: `h-${head}`, label: head });
      }
      out.push({ type: "item", key: `${e.kind}:${e.page}:${e.label}`, e, i: i++ });
    }
    return out;
  }, [gsResults]);

  // Panel search field ke neeche anchor karo (fixed positioning)
  useEffect(() => {
    if (!gsOpen) { setGsPos(null); return; }
    const update = () => {
      const r = searchWrapRef.current?.getBoundingClientRect();
      if (!r) return;
      setGsPos({
        top: r.bottom + 6,
        left: r.left,
        width: Math.max(300, Math.min(440, window.innerWidth - r.left - 16)),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [gsOpen]);

  // Bahar click karne par search results band
  useEffect(() => {
    if (!gsOpen) return;
    const onDown = (e) => {
      if (searchWrapRef.current?.contains(e.target)) return;
      if (gsRef.current?.contains(e.target)) return;
      setGsOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [gsOpen]);

  // Ctrl+K / Ctrl+F se global search focus (IPC path main-process se bhi aata hai)
  useEffect(() => {
    const focusSearch = () => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
      setGsOpen(true);
    };
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = (e.key || "").toLowerCase();
      if (k === "k" || k === "f") {
        e.preventDefault();
        e.stopPropagation();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const unsub = window.electronAPI?.onSettingsFocusSearch?.(focusSearch);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      try { unsub?.(); } catch {}
    };
  }, []);

  // Main window se navigate request (e.g. Browser → Manage extensions, ya palette se row-jump)
  useEffect(() => {
    const unsub = window.electronAPI?.onSettingsNavigate?.((page, focus) => {
      if (page && NAV.some((n) => n.id === page)) setActivePage(page);
      if (focus) setFocusReq({ label: focus, page });
    });
    return () => { try { unsub?.(); } catch {} };
  }, []);

  // Focus request: page render hone par target row ko scroll + flash karo
  useEffect(() => {
    if (!focusReq || loading) return;
    let tries = 0;
    let timer = null;
    const attempt = () => {
      let target = null;
      const body = bodyRef.current;
      if (body) {
        for (const row of body.querySelectorAll(".sw-row")) {
          const l = row.querySelector(".sw-row__label");
          if (l && l.textContent.trim() === focusReq.label) { target = row; break; }
        }
      }
      if (target) {
        try { target.scrollIntoView({ block: "center", behavior: "smooth" }); } catch {}
        target.classList.add("sw-row--flash");
        const el = target;
        setTimeout(() => el.classList.remove("sw-row--flash"), 2000);
        setFocusReq(null);
        return;
      }
      if (++tries < 50) timer = setTimeout(attempt, 40);
      else setFocusReq(null);
    };
    timer = setTimeout(attempt, 60);
    return () => { if (timer) clearTimeout(timer); };
  }, [focusReq, loading, activePage]);

  // Apply theme to settings window itself (default dark)
  useEffect(() => {
    if (loading) return;
    const th = settings.theme || settings.editorTheme || "dark";
    const isLight = th === "light" || th === "lightPlus" || th === "lightModern" || th === "light2026" || th === "Visual Studio Light" || th === "Light+" || th === "Light Modern" || th === "Light 2026";
    document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
  }, [settings.theme, settings.editorTheme, loading]);

  // Also listen to cross-window theme changes (e.g., from main window)
  useEffect(() => {
    const applyTheme = (th) => {
      if (!th) return;
      const isLight = th === "light" || th === "lightPlus" || th === "lightModern" || th === "light2026" || th === "Visual Studio Light" || th === "Light+" || th === "Light Modern" || th === "Light 2026";
      document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    };
    let bc, bc2;
    try {
      bc = new BroadcastChannel("app-settings");
      bc.onmessage = (e) => {
        const th = e.data?.theme || e.data?.editorTheme;
        if (th) applyTheme(th);
      };
    } catch {}
    try {
      bc2 = new BroadcastChannel("editor-settings");
      bc2.onmessage = (e) => {
        const th = e.data?.theme || e.data?.editorTheme;
        if (th) applyTheme(th);
      };
    } catch {}
    return () => { try { bc?.close(); } catch {} try { bc2?.close(); } catch {} };
  }, []);

  const renderPage = () => {
    if (loading) return <div style={{ color: "var(--text-placeholder)", fontSize: "var(--fs-body)" }}>Loading...</div>;
    switch (activePage) {
      case "general":     return <GeneralPage settings={settings} onSave={updateSettings} />;
      case "hub":         return <HubPage settings={settings} onSave={updateSettings} />;
      case "editor":      return <EditorPage settings={settings} onSave={updateSettings} />;
      case "terminal":    return <TerminalPage settings={settings} onSave={updateSettings} />;
      case "git":         return <GitPage settings={settings} onSave={updateSettings} />;
      case "canvas":      return <CanvasPage settings={settings} onSave={updateSettings} />;
      case "keybindings": return <KeybindingsPage />;
      case "extensions":  return <ExtensionsPage />;
      default:            return null;
    }
  };

  const goTo = (entry) => {
    setGsOpen(false);
    setGq("");
    setGsIdx(0);
    if (entry.page && NAV.some((n) => n.id === entry.page)) setActivePage(entry.page);
    if (entry.kind === "row") setFocusReq({ label: entry.label, page: entry.page });
  };

  const onSearchKeyDown = (e) => {
    const total = gsItems.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setGsOpen(true);
      if (total) setGsIdx((i) => Math.min(i + 1, total - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (total) setGsIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (gsOpen && total) goTo(gsItems[Math.min(gsIdx, total - 1)]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (gq) { setGq(""); setGsIdx(0); setGsOpen(false); }
      else { setGsOpen(false); e.currentTarget.blur(); }
    }
  };

  const active = NAV_BY_ID[activePage];
  const pageTitle = active?.label ?? "";
  const pageDesc = active?.desc ?? "";

  return (
    <div className="sw-shell">
      {/* Sidebar — global search + grouped nav */}
      <div className="sw-sidebar">
        <div className="sw-sidebar__title">Settings</div>
        <div className="sw-search" ref={searchWrapRef}>
          <Search size={13} />
          <input
            ref={inputRef}
            value={gq}
            onChange={(e) => { setGq(e.target.value); setGsIdx(0); setGsOpen(true); }}
            onFocus={() => { if (gq.trim()) setGsOpen(true); }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search all settings…"
            aria-label="Search all settings"
            autoComplete="off"
            spellCheck={false}
          />
          {gq ? null : <kbd className="sw-kbd">Ctrl F</kbd>}
        </div>
        {NAV_GROUPS.map((g) => {
          const items = visibleNav.filter((n) => n.group === g);
          if (!items.length) return null;
          return (
            <React.Fragment key={g}>
              <div className="sw-nav-group">{g}</div>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.id}
                    className={`sw-nav-item${activePage === item.id ? " sw-nav-item--active" : ""}`}
                    onClick={() => setActivePage(item.id)}
                    title={item.desc}
                  >
                    {Icon ? <Icon size={15} /> : null}
                    {item.label}
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
        {!visibleNav.length && <div className="sw-nav-empty">No matches</div>}
      </div>

      {/* Content */}
      <div className="sw-content">
        <div className="sw-content__header">
          <span className="sw-content__title">{pageTitle}</span>
          {pageDesc ? <span className="sw-content__desc">{pageDesc}</span> : null}
        </div>
        <div className="sw-content__body" ref={bodyRef} key={activePage}>
          <UnwrapRoot>{renderPage()}</UnwrapRoot>
        </div>
      </div>

      {/* Global search results */}
      {gsOpen && gq.trim() && gsPos && (
        <div
          className="sw-gs"
          ref={gsRef}
          style={{ top: gsPos.top, left: gsPos.left, width: gsPos.width }}
          role="listbox"
          aria-label="Search results"
        >
          {gsResults.length === 0 ? (
            <div className="sw-gs__empty">No settings match “{gq.trim()}”.</div>
          ) : (
            gsList.map((x) => {
              if (x.type === "head") return <div className="sw-gs__head" key={x.key}>{x.label}</div>;
              const on = x.i === gsIdx;
              const Icon = NAV_BY_ID[x.e.page]?.icon;
              return (
                <div
                  key={x.key}
                  className={`sw-gs__item${on ? " is-on" : ""}`}
                  role="option"
                  aria-selected={on}
                  onMouseEnter={() => setGsIdx(x.i)}
                  onMouseDown={(ev) => { ev.preventDefault(); goTo(x.e); }}
                >
                  {Icon ? <Icon size={14} className="sw-gs__icon" /> : null}
                  <span className="sw-gs__text">
                    <span className="sw-gs__label">{x.e.label}</span>
                    <span className="sw-gs__desc">{x.e.desc}</span>
                  </span>
                  <span className="sw-gs__meta">{NAV_BY_ID[x.e.page]?.label}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default SettingsWindow;
