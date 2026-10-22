import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import "./openpencil.css";

const DEFAULT_URL = "https://app.openpencil.dev";

const OpenPencilPanel = ({ config, nodeId }) => {
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
        if (e && e.errorCode === -3) return;
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

  useEffect(() => {
    const onRefresh = (e) => {
      if (e.detail?.nodeId && e.detail.nodeId !== nodeId) return;
      reload();
    };
    window.addEventListener("openpencil:refresh", onRefresh);
    return () => window.removeEventListener("openpencil:refresh", onRefresh);
  });

  return (
    <div className="op-root">
      <div className="op-view-wrap">
        {loading && !failed && <div className="op-progress" />}
        <webview
          className="op-view"
          ref={attachWebview}
          src={url}
          allowpopups=""
          allowFullScreen=""
        />
        {failed && (
          <div className="op-fail">
            <TriangleAlert size={30} />
            <h3>Could not load OpenPencil</h3>
            <p>Check your internet connection and try again.</p>
            <button className="op-fail__btn" onClick={reload}>
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OpenPencilPanel;
