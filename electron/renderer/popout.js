// popout.js — sync the FlexLayout popout shell with the main window theme.
// Loaded as an external file (not inline) so the popout.html CSP
// (script-src without 'unsafe-inline') allows it to run.
(function () {
  "use strict";

  // The main window owns the theme: mode (data-theme) plus the user's custom
  // color overrides, which live as inline CSS custom properties on <html>.
  // Copy both so a popped-out panel looks exactly like its parent.
  function syncFromOpener() {
    try {
      var src = window.opener && window.opener.document && window.opener.document.documentElement;
      if (!src) return false;
      var theme = src.getAttribute("data-theme");
      if (theme) document.documentElement.setAttribute("data-theme", theme);
      var dst = document.documentElement;
      for (var i = dst.style.length - 1; i >= 0; i--) {
        var name = dst.style[i];
        if (name && name.indexOf("--") === 0) dst.style.removeProperty(name);
      }
      var style = src.style;
      for (var j = 0; j < style.length; j++) {
        var prop = style[j];
        if (prop && prop.indexOf("--") === 0) {
          dst.style.setProperty(prop, style.getPropertyValue(prop));
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // (a) Inherit the opener's current theme, if reachable.
  syncFromOpener();

  // (b) Follow live theme + custom color changes from the main window.
  try {
    var bc = new BroadcastChannel("app-settings");
    bc.onmessage = function () {
      if (!syncFromOpener()) {
        // Fallback when the opener is gone: honour the broadcast's mode only.
        var d = (arguments[0] && arguments[0].data) || {};
        var th = d.theme || d.editorTheme;
        if (th) {
          var isLight = th === "light" || th === "lightPlus" || th === "lightModern" || th === "light2026"
            || th === "Visual Studio Light" || th === "Light+" || th === "Light Modern" || th === "Light 2026";
          document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
        }
      }
    };
  } catch (e) {}
})();
