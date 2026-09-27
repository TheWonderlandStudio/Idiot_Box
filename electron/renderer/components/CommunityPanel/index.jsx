// CommunityPanel — blank shell for now (content plan pending).
// Only a close affordance; flexlayout tabs have no native close buttons.
import React from "react";
import { X } from "lucide-react";

export default function CommunityPanel({ nodeId }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-surface)", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "var(--space-6) var(--space-8)", flexShrink: 0 }}>
        {nodeId && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("close-flex-tab", { detail: { nodeId } }))}
            title="Close Community panel"
            style={{ background: "transparent", border: "1px solid var(--border-light)", color: "var(--icon)", borderRadius: "var(--radius-md)", padding: "var(--space-3) var(--space-6)", cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
