import React from "react";

const PreviewPage = ({ settings, onSave }) => {
  const background = ["dark", "light", "grid"].includes(settings.componentPreviewBgMode)
    ? settings.componentPreviewBgMode
    : "dark";

  const updateBackground = async (mode) => {
    await onSave({ componentPreviewBgMode: mode });
    try {
      const channel = new BroadcastChannel("component-preview-settings");
      channel.postMessage({ componentPreviewBgMode: mode });
      channel.close();
    } catch {}
  };

  return (
    <section className="sw-frame">
      <div className="sw-section-title">Component Viewer</div>
      <div className="sw-row">
        <span className="sw-row__label">Preview Background</span>
        <span className="sw-row__desc">Background behind rendered project components and captured website elements.</span>
        <select
          className="sw-select"
          value={background}
          onChange={(e) => updateBackground(e.target.value)}
          aria-label="Preview background"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="grid">Grid</option>
        </select>
      </div>
    </section>
  );
};

export default PreviewPage;