// ─── Titlebar menu keyboard access (Alt-toggled menu mode) ───────────────
// Default: Tab sirf app me ghumta hai, toolbar skip hota hai.
// Alt akele dabao (ya titlebar par Alt+click) → menu mode ON: menubar
// buttons Tab se reachable + pehle button par focus. Dobara Alt / Escape →
// mode OFF, Tab wapas sirf app me. (node_modules patch kiye bina —
// MutationObserver rebuilds par bhi nazar rakhta hai.)
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

// Menu mode ON/OFF — buttons ko Tab order me dalo/nikalo.
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
  // Default app-mode: Tab toolbar skip kare (menu mode me "0")
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
        // Menu mode me Enter/Space se menu kholo (click → CET khud open
        // karke apni arrow/Esc navigation sambhalta hai).
        if (!menuMode) return;
        e.preventDefault();
        e.stopPropagation();
        el.click();
      } else if (e.key === "ArrowDown") {
        if (!menuMode) return;
        if (el.classList.contains("open")) return; // khula ho to CET sambhale
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
  // CET thoda late attach hota hai — shuru me kuch baar retry karo
  let tries = 0;
  const timer = setInterval(() => {
    armAll();
    if (++tries >= 10) {
      try {
        clearInterval(timer);
      } catch {}
    }
  }, 500);
  // ── Alt mnemonic (Windows jaisa): akele Alt dabao → menu mode toggle.
  // Alt+combo (Alt+Left wagera) me toggle NA ho — isliye keyup par, aur
  // beech me koi aur key dab gayi to cancel.
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
    // Titlebar par Alt+click → menu mode ON (mouse users ke liye)
    document.addEventListener("click", (e) => {
      try {
        if (e.altKey && e.target instanceof Node && e.target.closest?.(".cet-titlebar")) {
          setTitlebarMenuMode(true);
        }
      } catch {}
    });
    // App me kahin click → menu mode OFF (Tab wapas sirf app me)
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
