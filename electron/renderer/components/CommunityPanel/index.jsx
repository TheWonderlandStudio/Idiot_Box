// CommunityPanel — embedded Discord server.
// The official widget (https://discord.com/widget?id=<guild>&theme=dark) is
// used because discord.gg invite links are blocked by X-Frame-Options.
// The Join button opens the invite in the OS browser.
import React, { useCallback, useRef, useState } from "react";
import { X, RefreshCw, TriangleAlert, ExternalLink, Users } from "lucide-react";
import "./community.css";

const DISCORD_INVITE = "https://discord.gg/Z9DynuSxRY";
const DISCORD_GUILD_ID = "1147110101203816509";
const DISCORD_WIDGET_URL = `https://discord.com/widget?id=${DISCORD_GUILD_ID}&theme=dark`;
const DISCORD_SERVER_NAME = "Wonderland";

function openInBrowser(url) {
  try {
    if (window.electronAPI && typeof window.electronAPI.openExternal === "function") {
      window.electronAPI.openExternal(url);
      return;
    }
  } catch {}
  try { window.open(url, "_blank", "noopener"); } catch {}
}

export default function CommunityPanel({ nodeId, config }) {
  const widgetUrl = (config && (config.discordUrl || config.url)) || DISCORD_WIDGET_URL;
  const inviteUrl = (config && config.inviteUrl) || DISCORD_INVITE;

  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const webviewRef = useRef(null);

  // Target=_blank / window.open links open in the OS browser instead of
  // inside the app.
  const attachWebview = useCallback((el) => {
    if (webviewRef.current === el) return;
    webviewRef.current = el;
    if (!el) return;
    const onStart = () => { setLoading(true); setFailed(false); };
    const onStop = () => { setLoading(false); };
    const onFail = (e) => {
      try {
        if (e && e.isMainFrame === false) return;
        if (e && e.errorCode === -3) return; // aborted load
      } catch {}
      setLoading(false);
      setFailed(true);
    };
    const onGone = () => { setLoading(false); setFailed(true); };
    const onNewWindow = (e) => {
      try { e.preventDefault(); } catch {}
      const next = (e && (e.url || (e.params && e.params.url))) || "";
      openInBrowser(next || widgetUrl);
    };
    el.addEventListener("did-start-loading", onStart);
    el.addEventListener("did-stop-loading", onStop);
    el.addEventListener("did-fail-load", onFail);
    el.addEventListener("render-process-gone", onGone);
    try { el.addEventListener("new-window", onNewWindow); } catch {}
    try { el.addEventListener("did-create-window", onNewWindow); } catch {}
  }, [widgetUrl]);

  const reload = () => {
    setFailed(false);
    setLoading(true);
    try {
      const wv = webviewRef.current;
      if (!wv) return;
      if (failed && typeof wv.loadURL === "function") wv.loadURL(widgetUrl);
      else wv.reload();
    } catch {}
  };

  return (
    <div className="cp-root">
      <div className="cp-bar">
        <span className="cp-bar__title">
          <Users size={13} /> Community
        </span>
        <div className="cp-bar__actions">
          <button
            className="cp-btn"
            onClick={() => openInBrowser(inviteUrl)}
            title="Open Discord invite in browser"
          >
            <ExternalLink size={13} />
          </button>
          {nodeId && (
            <button
              className="cp-btn"
              onClick={() => window.dispatchEvent(new CustomEvent("close-flex-tab", { detail: { nodeId } }))}
              title="Close Community panel"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="cp-discord-card">
        <span className="cp-discord-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.029ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
          </svg>
        </span>
        <span className="cp-discord-meta">
          <strong>{DISCORD_SERVER_NAME}</strong>
          <small>{inviteUrl.replace(/^https?:\/\//, "")}</small>
        </span>
        <button className="cp-join-btn" onClick={() => openInBrowser(inviteUrl)}>
          Join Discord
        </button>
      </div>

      <div className="cp-view-wrap">
        {loading && !failed && <div className="cp-progress" />}
        <webview
          className="cp-view"
          ref={attachWebview}
          src={widgetUrl}
          allowpopups=""
          allowFullScreen=""
        />
        {failed && (
          <div className="cp-fail">
            <TriangleAlert size={30} />
            <h3>Could not load Discord</h3>
            <p>Check your internet connection and try again.</p>
            <button className="cp-fail__btn" onClick={reload}>
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
