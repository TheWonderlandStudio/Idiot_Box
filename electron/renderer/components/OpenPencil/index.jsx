import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import "./openpencil.css";

const DEFAULT_URL = "https://app.openpencil.dev";

// Brand logo ko guest page me load/mat dikhao (request main process me block hoti hai).
const GUEST_ICON_CSS = 'img[data-test-id="app-logo"],img[src*="/brand/app-icon.svg"]{display:none!important}';

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
    const injectCss = () => {
      try {
        const p = el.insertCSS(GUEST_ICON_CSS);
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {}
    };
    el.addEventListener("did-start-loading", onStart);
    el.addEventListener("did-stop-loading", onStop);
    el.addEventListener("did-fail-load", onFail);
    el.addEventListener("render-process-gone", onGone);
    // Har navigation ke baad CSS dobara lagani padti hai (naye document pe reset ho jata hai).
    el.addEventListener("did-finish-load", injectCss);
    injectCss();
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
