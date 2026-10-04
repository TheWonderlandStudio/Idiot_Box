// CommunityPanel — community chat.
// Webview me load (CSP `frame-src` sirf self allow karta hai → iframe nahi
// chalega).
import React, { useCallback, useRef, useState } from "react";
import { X, RefreshCw, TriangleAlert } from "lucide-react";
import "./community.css";

const DEFAULT_URL = "https://wonder-no-server-chat.pages.dev/";

export default function CommunityPanel({ nodeId, config }) {
  const url = (config && config.url) || DEFAULT_URL;
  const webviewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

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
    el.addEventListener("did-start-loading", onStart);
    el.addEventListener("did-stop-loading", onStop);
    el.addEventListener("did-fail-load", onFail);
    el.addEventListener("render-process-gone", onGone);
  }, []);

  const reload = () => {
    setFailed(false);
    setLoading(true);
    try {
      const wv = webviewRef.current;
      if (!wv) return;
      if (failed && typeof wv.loadURL === "function") wv.loadURL(url);
      else wv.reload();
    } catch {}
  };

  return (
    <div className="cp-root">
      <div className="cp-bar">
        <span className="cp-bar__title">Community</span>
        <div className="cp-bar__actions">
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

      <div className="cp-view-wrap">
        {loading && !failed && <div className="cp-progress" />}
        <webview
          className="cp-view"
          ref={attachWebview}
          src={url}
          allowpopups=""
          allowFullScreen=""
        />
        {failed && (
          <div className="cp-fail">
            <TriangleAlert size={30} />
            <h3>Could not load Community</h3>
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
