// ─── Titlebar menu keyboard access (Tab) ────────────────────────────────────
// custom-electron-titlebar apne menubar buttons (File/Edit/View/…) ko
// tabindex="-1" se render karta hai, isliye Tab kabhi titlebar menu tak
// pahunchta hi nahi. Ye bridge (node_modules patch kiye bina):
//   1. har .cet-menubar-menu-button ko tabindex="0" deta hai — menu rebuilds
//      par bhi (MutationObserver ke through),
//   2. Enter/Space se menu kholta/band karta hai (click dispatch → CET khud
//      open karke apni arrow/Esc navigation sambhalta hai),
//   3. ArrowDown (band menu par) se kholta hai, ArrowLeft/Right se padosi
//      menu button par focus le jata hai.
const BTN_SEL = ".cet-menubar-menu-button";

function menubarButtons() {
  try {
    return Array.from(document.querySelectorAll(BTN_SEL)).filter(
      (el) => el && el.offsetParent !== null
    );
  } catch {
    return [];
  }
}

function armButton(el) {
  if (!el || el.__ibxA11yArmed) return;
  el.__ibxA11yArmed = true;
  // Set tabindex="0" so Tab navigates through these buttons
  try {
    el.setAttribute("tabindex", "0");
  } catch {}
  // Optionally still allow Arrow navigation within menu if needed
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
      }
      // DO NOT handle Enter/Space — let browser handle normal behavior
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
}

// TEMP-DIAG (headless debug ke liye — verify ke baad hatayenge)
try {
  setTimeout(() => {
    try {
      const btns = Array.from(document.querySelectorAll(BTN_SEL));
      console.log(
        "[ibx-a11y-diag] menubar buttons: " + btns.length +
        " | tabindexes: [" + btns.map((b) => b.getAttribute("tabindex")).join(",") + "]" +
        " | titlebar in DOM: " + (!!document.querySelector(".cet-titlebar")) +
        " | activeElement: " + (document.activeElement ? document.activeElement.tagName + "." + document.activeElement.className : "none")
      );
    } catch (e) { console.log("[ibx-a11y-diag] error: " + (e && e.message)); }
  }, 4000);
} catch {}
try {
  setupTitlebarA11y();
} catch {}

export default setupTitlebarA11y;
