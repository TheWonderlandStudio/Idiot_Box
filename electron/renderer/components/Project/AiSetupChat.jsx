import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import AI_TW_CSS from "../ai-elements/ai-tw-css.js";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "../ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from "../ai-elements/prompt-input";
import { Suggestions, Suggestion } from "../ai-elements/suggestion";
import { Shimmer } from "../ai-elements/shimmer";
import { Layers, Sparkles, FolderPlus } from "lucide-react";

// Quick starters — pehla message yahin se bhej do, AI setup convo khud chalata hai.
const STARTERS = [
  { label: "Build a Telegram bot", text: "I want to build a Telegram bot — what setup do I need?" },
  { label: "React dashboard", text: "I want to build a React dashboard web app, tell me the right setup." },
  { label: "Discord bot (Python)", text: "I want to build a Discord bot in Python, tell me the setup." },
  { label: "CLI tool", text: "I want to build my first CLI tool — how do I start?" },
];

// ── AI setup proposal card (AI Elements ke neeche, same shadow styles) ─────
function ProposalCard({ proposal, onCreate, onDismiss, busy }) {
  if (!proposal) return null;
  return (
    <div className="ss-card">
      <div className="ss-card-title">
        <Sparkles size={14} />
        Project setup ready
      </div>
      <div className="ss-card-grid">
        <span className="ss-k">Project</span>
        <span className="ss-v">{proposal.projectName}</span>
        <span className="ss-k">Framework</span>
        <span className="ss-v">
          {proposal.frameworkName}
          {proposal.language && proposal.language !== "Default" ? ` · ${proposal.language}` : ""}
        </span>
      </div>
      <div className="ss-card-panels">
        {proposal.panels.map((p) => (
          <span className="ss-chip" key={p.key}>
            {p.label}
          </span>
        ))}
      </div>
      <div className="ss-card-actions">
        <button type="button" className="ss-btn ss-btn--primary" onClick={onCreate} disabled={busy}>
          <FolderPlus size={13} />
          {busy ? "Creating…" : "Create project"}
        </button>
        <button type="button" className="ss-btn" onClick={onDismiss} disabled={busy}>
          Change plan
        </button>
      </div>
    </div>
  );
}

// ── Chat body (AI Elements) — shadow root ke andar render hota hai ─────────
function ChatBody({ messages, busy, onSend, proposal, onCreate, onDismiss }) {
  const send = (text) => {
    const t = String(text || "").trim();
    if (!t || busy) return;
    onSend(t);
  };
  const empty = messages.length === 0 && !busy;
  // Streaming: pehla chunk aate hi shimmer band (last assistant message live
  // update ho rahi hai) — wait time par hi "Soch raha hoon…" dikhe.
  const lastMsg = messages[messages.length - 1];
  const streamingLive = !!(busy && lastMsg && lastMsg.role === "assistant" && String(lastMsg.content || "").trim());
  return (
    <div className="ss-root">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
          {empty ? (
            <>
              <ConversationEmptyState
                icon={<Layers className="size-10" />}
                title="Project setup assistant"
                description="Tell us what you want to build — the AI picks the framework and panels for the setup."
              />
              <Suggestions className="mx-auto w-fit max-w-full">
                {STARTERS.map((s) => (
                  <Suggestion key={s.label} suggestion={s.text} onClick={send}>
                    {s.label}
                  </Suggestion>
                ))}
              </Suggestions>
            </>
          ) : (
            messages.map((m, i) => (
              <Message from={m.role} key={`${i}-${m.role}`}>
                <MessageContent>
                  {m.role === "assistant" ? (
                    <MessageResponse>{m.content}</MessageResponse>
                  ) : (
                    <span>{m.content}</span>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
          {busy && !streamingLive && (
            <Message from="assistant" key="__busy">
              <MessageContent>
                <Shimmer className="text-sm">Thinking…</Shimmer>
              </MessageContent>
            </Message>
          )}
          <ProposalCard proposal={proposal} onCreate={onCreate} onDismiss={onDismiss} busy={busy} />
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="ss-composer">
        <PromptInput onSubmit={(msg) => send(msg && msg.text)}>
          <PromptInputTextarea
            placeholder="Say what you want to build… (Enter to send, Shift+Enter for a new line)"
            rows={3}
            disabled={busy}
          />
          <PromptInputFooter>
            <PromptInputTools>
              <span className="ss-hint">Free AI • project setup assistant</span>
            </PromptInputTools>
            <PromptInputSubmit status={busy ? "submitted" : "ready"} disabled={busy} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

// ── Shadow DOM host — Tailwind/shadcn styles sirf chat ke andar, app safe ──
export default function AiSetupChat(props) {
  const hostRef = useRef(null);
  const [mount, setMount] = useState(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (host.shadowRoot) {
      setMount(host.shadowRoot.querySelector("[data-ai-mount]"));
      return;
    }
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = AI_TW_CSS;
    shadow.appendChild(style);
    const m = document.createElement("div");
    m.setAttribute("data-ai-mount", "");
    m.setAttribute("class", "ai-scope dark");
    m.style.cssText = "height:100%;display:flex;flex-direction:column;";
    shadow.appendChild(m);
    setMount(m);
    return () => setMount(null);
  }, []);

  return (
    <div className="phub__chatfs-body" ref={hostRef}>
      {mount ? createPortal(<ChatBody {...props} />, mount) : null}
    </div>
  );
}
