import { useState, useEffect, useCallback, useRef } from "react";

// ─── useSettings ─────────────────────────────────────────────────────────────
// Shared hook for reading/writing persistent application settings.
// Usage:
//   const [settings, updateSettings, loading] = useSettings();
//   updateSettings({ defaultEditor: "vscode" });
// ─────────────────────────────────────────────────────────────────────────────

const useSettings = () => {
  const [settings, setSettings] = useState({});
  const [loading,  setLoading]  = useState(true);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.readSettings().then((data) => {
      if (cancelled) return;
      const s = data ?? {};
      settingsRef.current = s;
      setSettings(s);
      setLoading(false);
    });
    // Live sync from other windows via BroadcastChannel + IPC fallback
    // Previously only app/editor were listened, so terminal/canvas/git direct broadcasts
    // never reached SettingsWindow state — and useSettings broadcast every patch to both
    // app+editor (leak). Now listen to all domain channels and route broadcasts.
    const makeBc = (name) => {
      try {
        const bc = new BroadcastChannel(name);
        bc.onmessage = (e) => {
          if (e.data && typeof e.data === "object") {
            const next = { ...settingsRef.current, ...e.data };
            settingsRef.current = next;
            setSettings(next);
          }
        };
        return bc;
      } catch { return null; }
    };
    const bcApp = makeBc("app-settings");
    const bcEditor = makeBc("editor-settings");
    const bcTerminal = makeBc("terminal-settings");
    const bcCanvas = makeBc("canvas-settings");
    const bcGit = makeBc("git-settings");
    // IPC fallback (BroadcastChannel doesn't work across file:// origins)
    let unsubIpc = null;
    try {
      unsubIpc = window.electronAPI?.onSettingsUpdated?.((data) => {
        if (data && typeof data === "object") {
          const next = { ...settingsRef.current, ...data };
          settingsRef.current = next;
          setSettings(next);
        }
      });
    } catch {}
    return () => {
      cancelled = true;
      try { bcApp?.close(); } catch {}
      try { bcEditor?.close(); } catch {}
      try { bcTerminal?.close(); } catch {}
      try { bcCanvas?.close(); } catch {}
      try { bcGit?.close(); } catch {}
      try { unsubIpc?.(); } catch {}
    };
  }, []);

  const updateSettings = useCallback(async (patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    await window.electronAPI.writeSettings(next);
    // Route broadcast only to relevant channels (was: always app+editor → leak)
    const chans = new Set();
    for (const k of Object.keys(patch)) {
      if (k === "terminal" || k.startsWith("terminal")) chans.add("terminal-settings");
      else if (k === "canvas" || k.startsWith("canvas")) chans.add("canvas-settings");
      else if (k === "git" || k.startsWith("git")) chans.add("git-settings");
      else if (["theme","zoom","showHiddenFiles","confirmDelete","restoreTabs","telemetryEnabled","autoOpenMediaViewer"].includes(k)) chans.add("app-settings");
      else if (["minimap","wordWrap","lineNumbers","fontSize","fontFamily","tabSize","editorTheme","autoSave","defaultEditor","formatOnSave",
        // CodeMirror setup flags (24) + extras — editor-settings channel
        "highlightActiveLineGutter","highlightSpecialChars","history","foldGutter","drawSelection","dropCursor",
        "allowMultipleSelections","indentOnInput","syntaxHighlighting","bracketMatching","closeBrackets",
        "autocompletion","rectangularSelection","crosshairCursor","highlightActiveLine","highlightSelectionMatches",
        "closeBracketsKeymap","defaultKeymap","searchKeymap","historyKeymap","foldKeymap","completionKeymap",
        "lintKeymap","indentUnit","lineWrapping","highlightWhitespace","lint","lintGutter","snippets",
        "customKeys","vim","tabAcceptsCompletion","theme","customHighlights"].includes(k)) chans.add("editor-settings");
      else chans.add("app-settings");
    }
    // Ensure at least app-settings for unknown keys (fallback live sync for SettingsWindow)
    if (chans.size === 0) chans.add("app-settings");
    for (const name of chans) {
      try { const bc = new BroadcastChannel(name); bc.postMessage(patch); bc.close(); } catch {}
    }
    return next;
  }, []);

  return [settings, updateSettings, loading];
};

export default useSettings;
