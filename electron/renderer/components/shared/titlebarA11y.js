// ─── Titlebar menu keyboard access (Alt-toggled menu mode) ───────────────
// Default: Tab only moves inside the app; the toolbar is skipped.
// Press Alt alone (or Alt+click on the titlebar) → menu mode ON: the menubar
// buttons become reachable via Tab + focus the first button. Press Alt / Escape again →
// mode OFF, Tab only moves inside the app again. (Without patching node_modules —
// the MutationObserver also watches rebuilds.)
const BTN_SEL = ".cet-menubar-menu-button";

let menuMode = false;

function menubarButtons() {
  try {
    return Array.from(document.querySelectorAll(BTN_SEL)).filter(
      (el) => el && el.offsetParent !== null
    );
  } catch {
    return [];
  }
}

// Menu mode ON/OFF — add/remove the buttons from the Tab order.
export function setTitlebarMenuMode(on) {
  menuMode = !!on;
  try {
    const btns = menubarButtons();
    btns.forEach((el) => {
      try { el.setAttribute("tabindex", menuMode ? "0" : "-1"); } catch {}
    });
    if (menuMode) {
      if (btns[0]) btns[0].focus();
    } else if (document.activeElement && document.activeElement.matches?.(BTN_SEL)) {
      try { document.activeElement.blur(); } catch {}
    }
  } catch {}
}

export function isTitlebarMenuMode() {
  return menuMode;
}

function armButton(el) {
  if (!el || el.__ibxA11yArmed) return;
  el.__ibxA11yArmed = true;
  // Default app mode: skip the toolbar via Tab (becomes "0" in menu mode)
  try {
    el.setAttribute("tabindex", menuMode ? "0" : "-1");
  } catch {}
  el.addEventListener("keydown", (e) => {
    try {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        const btns = menubarButtons();
        const i = btns.indexOf(el);
        if (i >= 0 && btns.length > 1) {
          const n =
            e.key === "ArrowRight"
              ? btns[(i + 1) % btns.length]
              : btns[(i - 1 + btns.length) % btns.length];
          if (n) n.focus();
        }
      } else if (e.key === "Enter" || e.key === " ") {
        // In menu mode, open the menu with Enter/Space (click → CET itself opens
        // and handles its own arrow/Esc navigation).
        if (!menuMode) return;
        e.preventDefault();
        e.stopPropagation();
        el.click();
      } else if (e.key === "ArrowDown") {
        if (!menuMode) return;
        if (el.classList.contains("open")) return; // CET handles it when open
        e.preventDefault();
        e.stopPropagation();
        el.click();
      } else if (e.key === "Escape") {
        if (!menuMode) return;
        e.preventDefault();
        e.stopPropagation();
        setTitlebarMenuMode(false);
      }
    } catch {}
  });
}

function armAll() {
  try {
    document.querySelectorAll(BTN_SEL).forEach(armButton);
  } catch {}
}

let started = false;
export function setupTitlebarA11y() {
  if (started) return;
  started = true;
  armAll();
  try {
    const mo = new MutationObserver(() => armAll());
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
  // CET attaches a bit late — retry a few times at startup
  let tries = 0;
  const timer = setInterval(() => {
    armAll();
    if (++tries >= 10) {
      try {
        clearInterval(timer);
      } catch {}
    }
  }, 500);
  // ── Alt mnemonic (like Windows): press Alt alone → toggle menu mode.
  // Do NOT toggle on Alt+combo (Alt+Left etc.) — hence on keyup, and
  // cancel if any other key was pressed in between.
  let altAlone = false;
  try {
    window.addEventListener(
      "keydown",
      (e) => {
        try {
          if (e.key === "Alt" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            altAlone = true;
            return;
          }
          altAlone = false;
        } catch {}
      },
      true
    );
    window.addEventListener(
      "keyup",
      (e) => {
        try {
          if (e.key === "Alt" && altAlone) {
            altAlone = false;
            setTitlebarMenuMode(!menuMode);
          } else {
            altAlone = false;
          }
        } catch {}
      },
      true
    );
    // Alt+click on the titlebar → menu mode ON (for mouse users)
    document.addEventListener("click", (e) => {
      try {
        if (e.altKey && e.target instanceof Node && e.target.closest?.(".cet-titlebar")) {
          setTitlebarMenuMode(true);
        }
      } catch {}
    });
    // Click anywhere in the app → menu mode OFF (Tab only moves inside the app again)
    document.addEventListener("mousedown", (e) => {
      try {
        if (!menuMode) return;
        if (e.target instanceof Node && e.target.closest?.(".cet-titlebar")) return;
        setTitlebarMenuMode(false);
      } catch {}
    });
  } catch {}
}

try {
  setupTitlebarA11y();
} catch {}

export default setupTitlebarA11y;
