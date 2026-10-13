// popout.js — sync the FlexLayout popout shell with the main window theme.
// Loaded as an external file (not inline) so the popout.html CSP
// (script-src without 'unsafe-inline') allows it to run.
(function () {
  "use strict";
  // Same light-name mapping as the main window theme handling in index.jsx.
  function apply(th) {
    var isLight = th === "light" || th === "lightPlus" || th === "lightModern" || th === "light2026"
      || th === "Visual Studio Light" || th === "Light+" || th === "Light Modern" || th === "Light 2026";
    try {
      document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    } catch (e) {}
  }
  // (a) Inherit the opener's current theme, if reachable.
  try {
    var t = window.opener && window.opener.document
      && window.opener.document.documentElement.getAttribute("data-theme");
    if (t) apply(t);
  } catch (e) {}
  // (b) Follow live theme changes from the main window.
  try {
    var bc = new BroadcastChannel("app-settings");
    bc.onmessage = function (e) {
      var d = (e && e.data) || {};
      if (d.theme) apply(d.theme);
      else if (d.editorTheme) apply(d.editorTheme);
    };
  } catch (e) {}
})();
