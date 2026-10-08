import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import "./opencode-panel.css";

function encodeDirectory(directory) {
  const bytes = new TextEncoder().encode(directory);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function OpenCodePanel() {
  const [rootPath, setRootPath] = useState(() => window.__currentProjectPath || "");
  const [server, setServer] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const webviewRef = useRef(null);

  useEffect(() => {
    const onProjectOpened = (event) => setRootPath(event?.detail?.path || window.__currentProjectPath || "");
    const onProjectClosed = () => setRootPath("");
    window.addEventListener("project:opened", onProjectOpened);
    window.addEventListener("project:closed", onProjectClosed);
    return () => {
      window.removeEventListener("project:opened", onProjectOpened);
      window.removeEventListener("project:closed", onProjectClosed);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let leaseId = "";
    setServer(null);
    setError("");

    if (!rootPath) {
      setError("Open a project folder before starting the OpenCode panel.");
      return () => { disposed = true; };
    }

    window.electronAPI.openCodePanelStart(rootPath).then((result) => {
      leaseId = result.leaseId;
      if (disposed) {
        window.electronAPI.openCodePanelStop(leaseId).catch(() => {});
        return;
      }
      setServer(result);
    }).catch((startError) => {
      if (!disposed) setError(startError.message || "OpenCode could not be started.");
    });

    return () => {
      disposed = true;
      if (leaseId) {
        window.electronAPI.openCodePanelStop(leaseId).catch((stopError) => {
          console.error("[OpenCode panel] Failed to stop its server:", stopError);
        });
      }
    };
  }, [retry, rootPath]);

  const attachWebview = useCallback((element) => {
    webviewRef.current = element;
  }, []);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return undefined;
    const handleLoad = () => {
      setError("");
      const script = `(() => {
        const styleId = "idiot-box-current-project-only";
        if (!document.getElementById(styleId)) {
          const style = document.createElement("style");
          style.id = styleId;
          style.textContent = '[data-action="home-add-project"], [data-action="home-add-project-row"], [data-action="prompt-project"] { display: none !important; }';
          (document.head || document.documentElement).appendChild(style);
        }
        if (window.location.pathname !== "/new-session") {
          document.querySelector('a[href^="/new-session"]')?.click();
        }
        return true;
      })()`;
      webview.executeJavaScript(script).catch((navigationError) => {
        setError(navigationError.message || "Could not open this project in OpenCode.");
      });
    };
    const handleFailure = (event) => {
      if (event.isMainFrame !== false && event.errorCode !== -3) {
        setError(event.errorDescription || "The OpenCode web interface could not be loaded.");
      }
    };
    const handleNavigation = (event) => {
      try {
        if (new URL(event.url).origin !== new URL(server.url).origin) {
          event.preventDefault();
          window.electronAPI.openExternal(event.url).catch((openError) => {
            console.error("[OpenCode panel] Could not open external link:", openError);
          });
        }
      } catch {
        event.preventDefault();
      }
    };
    webview.addEventListener("did-finish-load", handleLoad);
    webview.addEventListener("did-fail-load", handleFailure);
    webview.addEventListener("will-navigate", handleNavigation);
    const readyFallback = setTimeout(handleLoad, 500);
    return () => {
      clearTimeout(readyFallback);
      webview.removeEventListener("did-finish-load", handleLoad);
      webview.removeEventListener("did-fail-load", handleFailure);
      webview.removeEventListener("will-navigate", handleNavigation);
    };
  }, [server]);

  if (error) {
    return (
      <section className="opencode-panel-status" role="alert">
        <b>OpenCode unavailable</b>
        <p>{error}</p>
        <p className="opencode-panel-hint">The native OpenCode interface runs locally inside this panel.</p>
        <div className="opencode-panel-actions">
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            <RefreshCw size={14} /> Retry
          </button>
          <button type="button" onClick={() => window.electronAPI.openExternal("https://opencode.ai/download")}>
            <ExternalLink size={14} /> OpenCode website
          </button>
        </div>
      </section>
    );
  }

  if (!server) {
    return (
      <section className="opencode-panel-status" aria-live="polite">
        <Loader2 size={18} className="opencode-panel-spinner" />
        <b>Starting OpenCode…</b>
        <p>Loading the native OpenCode web interface for this project.</p>
      </section>
    );
  }

  return (
    <div className="opencode-panel">
      <webview
        ref={attachWebview}
        className="opencode-panel-webview"
        src={`${server.url}/${encodeDirectory(rootPath)}/session`}
        partition="persist:opencode-panel"
        webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
      />
    </div>
  );
}
