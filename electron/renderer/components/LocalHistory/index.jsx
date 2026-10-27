// LocalHistory — per-file snapshots captured on save / live edit / replace.
// Opens as a flexlayout panel and follows the active editor tab.
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  History, RefreshCw, Camera, Trash2, RotateCcw, AlertCircle, Loader2,
} from "lucide-react";
import { getActiveEditorPath } from "../Editor/shared.js";
import "./localHistory.css";

const fmtWhen = (at) => {
  const t = Number(at) || 0;
  if (!t) return "unknown";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  const d = new Date(t);
  try {
    return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return d.toISOString();
  }
};

const fmtBytes = (n) => {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const baseName = (p) => String(p || "").split(/[\\/]/).pop() || p;

const LocalHistoryPanel = ({ config }) => {
  const [filePath, setFilePath] = useState(config?.filePath || getActiveEditorPath() || "");
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const filePathRef = useRef(filePath);
  const selectedIdRef = useRef(null);
  const noticeTimer = useRef(null);
  filePathRef.current = filePath;

  const flash = useCallback((text, kind = "ok") => {
    setNotice({ text, kind });
    try { clearTimeout(noticeTimer.current); } catch {}
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => () => { try { clearTimeout(noticeTimer.current); } catch {} }, []);

  const openEntry = useCallback(async (entry, path) => {
    if (!entry || !path) return;
    selectedIdRef.current = entry.id;
    setSelectedId(entry.id);
    setPreviewLoading(true);
    try {
      const res = await window.electronAPI.localHistoryRead(path, entry.id);
      if (res?.ok) setPreview({ text: String(res.text ?? ""), meta: res.meta || entry, path: res.path || path });
      else {
        setPreview(null);
        flash(res?.error || "Could not read that snapshot", "error");
      }
    } catch (err) {
      setPreview(null);
      flash(err?.message || "Could not read that snapshot", "error");
    } finally {
      setPreviewLoading(false);
    }
  }, [flash]);

  const load = useCallback(async (path, keepId = null) => {
    if (!path) {
      setEntries([]);
      setPreview(null);
      setSelectedId(null);
      selectedIdRef.current = null;
      return;
    }
    setLoading(true);
    try {
      const list = await window.electronAPI.localHistoryList(path);
      const rows = Array.isArray(list) ? list : [];
      setEntries(rows);
      const want = keepId || selectedIdRef.current;
      const next = rows.find((e) => e.id === want) || rows[0] || null;
      if (next) await openEntry(next, path);
      else {
        selectedIdRef.current = null;
        setSelectedId(null);
        setPreview(null);
      }
    } catch (err) {
      setEntries([]);
      setPreview(null);
      flash(err?.message || "Could not load local history", "error");
    } finally {
      setLoading(false);
    }
  }, [flash, openEntry]);

  // Follow the active editor tab.
  useEffect(() => {
    const onActivated = (e) => {
      const p = e.detail?.path;
      if (!p || p === filePathRef.current) return;
      selectedIdRef.current = null;
      setFilePath(p);
    };
    const onFocus = (e) => {
      const p = e.detail?.filePath;
      if (!p) return;
      selectedIdRef.current = null;
      setFilePath(p);
    };
    window.addEventListener("editor:fileActivated", onActivated);
    window.addEventListener("local-history:focus", onFocus);
    return () => {
      window.removeEventListener("editor:fileActivated", onActivated);
      window.removeEventListener("local-history:focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!filePath) return;
    load(filePath);
  }, [filePath, load]);

  // External writes (replace, live edit, restore, another window) refresh the list.
  useEffect(() => {
    let unsub = null;
    try {
      unsub = window.electronAPI?.onLiveEditFileChanged?.((payload) => {
        if (payload?.filePath && payload.filePath === filePathRef.current) load(filePathRef.current);
      });
    } catch {}
    return () => { try { unsub?.(); } catch {} };
  }, [load]);

  const refresh = () => load(filePath, selectedIdRef.current);

  const takeSnapshot = async () => {
    if (!filePath || busy) return;
    setBusy(true);
    try {
      const res = await window.electronAPI.localHistorySnapshot(filePath, "Manual snapshot");
      if (res?.ok) {
        flash("Snapshot saved");
        await load(filePath, res.entry?.id || selectedIdRef.current);
      } else {
        flash(res?.error || "No change to snapshot", "error");
      }
    } catch (err) {
      flash(err?.message || "Snapshot failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (entry) => {
    if (!entry || !filePath || busy) return;
    let ok = true;
    const message = `Restore "${baseName(filePath)}" to the version from ${fmtWhen(entry.at)}?\n\n${entry.reason || "Saved"} · ${fmtBytes(entry.size)}\nThe current content is saved as a snapshot first.`;
    try {
      ok = window.electronAPI?.confirmDialog ? await window.electronAPI.confirmDialog(message) : window.confirm(message);
    } catch { ok = false; }
    if (!ok) return;
    setBusy(true);
    try {
      const res = await window.electronAPI.localHistoryRestore(filePath, entry.id);
      if (res?.ok) {
        flash("Version restored");
        await load(filePath);
      } else {
        flash(res?.error || "Restore failed", "error");
      }
    } catch (err) {
      flash(err?.message || "Restore failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const removeEntry = async (entry) => {
    if (!entry || !filePath || busy) return;
    let ok = true;
    const message = `Delete this history entry for "${baseName(filePath)}"?\n\n${fmtWhen(entry.at)} · ${entry.reason || "Saved"}\nThis cannot be undone.`;
    try {
      ok = window.electronAPI?.confirmDialog ? await window.electronAPI.confirmDialog(message) : window.confirm(message);
    } catch { ok = false; }
    if (!ok) return;
    setBusy(true);
    try {
      await window.electronAPI.localHistoryDelete(filePath, entry.id);
      selectedIdRef.current = null;
      await load(filePath);
      flash("History entry deleted");
    } catch (err) {
      flash(err?.message || "Delete failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!filePath || !entries.length || busy) return;
    let ok = true;
    const message = `Clear all ${entries.length} history entries for "${baseName(filePath)}"?\n\nThis cannot be undone.`;
    try {
      ok = window.electronAPI?.confirmDialog ? await window.electronAPI.confirmDialog(message) : window.confirm(message);
    } catch { ok = false; }
    if (!ok) return;
    setBusy(true);
    try {
      await window.electronAPI.localHistoryClear(filePath);
      selectedIdRef.current = null;
      await load(filePath);
      flash("Local history cleared");
    } catch (err) {
      flash(err?.message || "Clear failed", "error");
    } finally {
      setBusy(false);
    }
  };

  if (!filePath) {
    return (
      <div className="ibx-history">
        <div className="ibx-history-empty">
          Open a file to see its local history.<br />
          Snapshots are captured automatically on save, live edit and Replace in Files.
        </div>
      </div>
    );
  }

  const selected = entries.find((e) => e.id === selectedId) || null;
  const previewText = preview?.text || "";
  const clipboardPreview = previewText.length > 400_000
    ? `${previewText.slice(0, 400_000)}\n\n… preview truncated — restoring still restores the full file.`
    : previewText;

  return (
    <div className="ibx-history">
      <div className="ibx-history-side">
        <div className="ibx-history-head">
          <div className="ibx-history-file" title={filePath}>
            <History size={13} style={{ flexShrink: 0, color: "var(--icon)" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{baseName(filePath)}</span>
          </div>
          <div className="ibx-history-path" title={filePath}>{filePath}</div>
          <div className="ibx-history-toolbar">
            <button className="ibx-history-btn" data-tone="accent" onClick={takeSnapshot} disabled={busy} title="Snapshot the saved file now">
              <Camera size={11} /> Snapshot
            </button>
            <button className="ibx-history-btn" onClick={refresh} disabled={busy || loading} title="Refresh history">
              {loading ? <Loader2 size={11} className="ibx-history-spin" /> : <RefreshCw size={11} />} Refresh
            </button>
            <button className="ibx-history-btn" data-tone="danger" onClick={clearAll} disabled={busy || !entries.length} title="Delete every snapshot for this file">
              <Trash2 size={11} /> Clear
            </button>
          </div>
        </div>

        <div className="ibx-history-list">
          {loading && !entries.length && (
            <div className="ibx-history-empty"><Loader2 size={15} className="ibx-history-spin" /></div>
          )}
          {!loading && !entries.length && (
            <div className="ibx-history-empty">
              No history yet for this file.<br />
              Edit and save it to create the first snapshot.
            </div>
          )}
          {entries.map((entry) => (
            <button
              key={entry.id}
              className="ibx-history-item"
              data-active={entry.id === selectedId || undefined}
              onClick={() => openEntry(entry, filePath)}
              title={`${fmtWhen(entry.at)} · ${entry.reason || "Saved"}`}
            >
              <span className="ibx-history-reason">
                <History size={10} style={{ flexShrink: 0, opacity: 0.7 }} />
                {entry.reason || "Saved"}
              </span>
              <span className="ibx-history-meta">
                <span>{fmtWhen(entry.at)}</span>
                <span>{fmtBytes(entry.size)}</span>
              </span>
            </button>
          ))}
        </div>

        {notice && (
          <div className="ibx-history-note" data-kind={notice.kind}>
            {notice.kind === "error" && <AlertCircle size={11} />}
            {notice.text}
          </div>
        )}
        <div className="ibx-history-note">
          Snapshots are stored in app data, never inside the project folder.
        </div>
      </div>

      <div className="ibx-history-preview">
        {!selected ? (
          <div className="ibx-history-empty">
            Select a history entry to preview it.
          </div>
        ) : (
          <>
            <div className="ibx-history-preview-head">
              <span className="ibx-history-preview-title" title={`${fmtWhen(selected.at)} · ${selected.reason || "Saved"}`}>
                {fmtWhen(selected.at)} · {selected.reason || "Saved"}
              </span>
              <span className="ibx-history-badge">{fmtBytes(selected.size)}</span>
              <button
                className="ibx-history-btn"
                data-tone="accent"
                onClick={() => restore(selected)}
                disabled={busy}
                title="Restore this version (the current content is snapshotted first)"
              >
                <RotateCcw size={11} /> Restore
              </button>
              <button
                className="ibx-history-btn"
                data-tone="danger"
                onClick={() => removeEntry(selected)}
                disabled={busy}
                title="Delete this history entry"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <pre className="ibx-history-code">
              {previewLoading ? "Loading snapshot…" : clipboardPreview || "(empty file)"}
            </pre>
          </>
        )}
      </div>
    </div>
  );
};

export default LocalHistoryPanel;
