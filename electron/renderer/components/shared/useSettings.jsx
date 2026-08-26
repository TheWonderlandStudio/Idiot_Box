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
    // Live sync from other windows via BroadcastChannel
    let bc;
    try {
      bc = new BroadcastChannel("app-settings");
      bc.onmessage = (e) => {
        if (e.data && typeof e.data === "object") {
          const next = { ...settingsRef.current, ...e.data };
          settingsRef.current = next;
          setSettings(next);
        }
      };
    } catch {}
    let bc2;
    try {
      bc2 = new BroadcastChannel("editor-settings");
      bc2.onmessage = (e) => {
        if (e.data && typeof e.data === "object") {
          const next = { ...settingsRef.current, ...e.data };
          settingsRef.current = next;
          setSettings(next);
        }
      };
    } catch {}
    return () => {
      cancelled = true;
      try { bc?.close(); } catch {}
      try { bc2?.close(); } catch {}
    };
  }, []);

  const updateSettings = useCallback(async (patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    await window.electronAPI.writeSettings(next);
    // Broadcast for live sync (editor-settings for editor fields, app-settings for general)
    // Use both to ensure all listeners get it; editor already listens to multiple channels
    try {
      const bc = new BroadcastChannel("app-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
    try {
      const bc = new BroadcastChannel("editor-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
    return next;
  }, []);

  return [settings, updateSettings, loading];
};

export default useSettings;
