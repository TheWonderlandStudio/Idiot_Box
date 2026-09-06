// AIPanel — default AI SDK chat UI (https://ai-sdk.dev/docs/ai-sdk-ui).
// State + streaming come from useChat (@ai-sdk/react) over a custom Electron
// IPC ChatTransport (./ipc-transport.js); rendering is 100% AI Elements
// (../ai-elements/*, vendored from elements.ai-sdk.dev). Styles are Tailwind
// scoped to this panel via Shadow DOM (./ai-tw-css.js) — zero global leakage.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@ai-sdk/react";
import AI_TW_CSS from "./ai-tw-css.js";
import { ElectronIpcTransport } from "./ipc-transport.js";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "../ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "../ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from "../ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "../ai-elements/reasoning";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "../ai-elements/tool";
import { Suggestions, Suggestion } from "../ai-elements/suggestion";
import {
  Bot,
  MessageSquare,
  Copy,
  Check,
  FileCode2,
  Wrench,
  Download,
  Settings,
  Trash2,
  X,
  RotateCcw,
  CircleAlert,
} from "lucide-react";

// ─── Provider catalogue (mirrors main ai-service defaults) ────────────────
const PROVIDERS = [
  {
    id: "openai", label: "OpenAI", needsKey: true,
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic", label: "Anthropic", needsKey: true,
    models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-sonnet-4-5"],
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google", label: "Google", needsKey: true,
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "gateway", label: "AI Gateway", needsKey: true,
    models: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4.5", "google/gemini-2.0-flash"],
    keyUrl: "https://vercel.com/ai-gateway",
  },
  {
    id: "ollama", label: "Ollama (local)", needsKey: false,
    models: ["llama3.1", "qwen2.5-coder", "codellama", "mistral", "deepseek-coder-v2"],
    keyUrl: "https://ollama.com",
  },
  {
    id: "openai-compatible", label: "Custom (OpenAI API)", needsKey: false,
    models: [],
    keyUrl: "",
  },
];

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  google: "gemini-2.0-flash",
  gateway: "openai/gpt-4o-mini",
  ollama: "llama3.1",
  "openai-compatible": "llama3.1",
};

const QUICK_PROMPTS = [
  { label: "Explain this file", prompt: "Explain what the attached file does, briefly." },
  { label: "Find bugs", prompt: "Review the attached file for bugs and suggest fixes." },
  { label: "Write tests", prompt: "Write unit tests for the attached file." },
  { label: "Refactor", prompt: "Suggest a cleaner refactor of the attached code." },
];

const messageText = (m) =>
  (m.parts || [])
    .filter((p) => p && p.type === "text")
    .map((p) => p.text || "")
    .join("");

const lastCodeFence = (text) => {
  const re = /```(?:\w*\n)?([\s\S]*?)```/g;
  let m;
  let last = null;
  while ((m = re.exec(String(text || "")))) last = m[1].replace(/^\n/, "").replace(/\n$/, "");
  return last;
};

// ─── Message parts (docs chatbot + tool-usage patterns) ───────────────────
function AssistantParts({ message, status }) {
  return (
    <>
      {(message.parts || []).map((part, i) => {
        const key = `${message.id}-${i}`;
        if (!part || typeof part.type !== "string") return null;
        if (part.type === "text") {
          return <MessageResponse key={key}>{part.text}</MessageResponse>;
        }
        if (part.type === "reasoning") {
          return (
            <Reasoning key={key} isStreaming={status === "streaming"}>
              <ReasoningTrigger />
              <ReasoningContent>{part.text}</ReasoningContent>
            </Reasoning>
          );
        }
        if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
          return (
            <Tool key={part.toolCallId || key} defaultOpen={false}>
              <ToolHeader type={part.type} state={part.state} toolName={part.toolName} />
              <ToolContent>
                {part.input != null && <ToolInput input={part.input} />}
                <ToolOutput output={part.output} errorText={part.errorText} />
              </ToolContent>
            </Tool>
          );
        }
        if (part.type === "file" && part.mediaType && String(part.mediaType).startsWith("image/")) {
          return <img key={key} src={part.url} alt="Generated image" className="max-w-full rounded-md" />;
        }
        if (part.type === "source-url") {
          return (
            <div key={key} className="text-xs">
              <a
                href={part.url}
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  window.dispatchEvent(
                    new CustomEvent("add-browser-panel", {
                      detail: { url: part.url, config: { type: "browser", title: "Browser", url: part.url } },
                    })
                  );
                }}
              >
                [{part.title || (() => { try { return new URL(part.url).hostname; } catch { return part.url; } })()}]
              </a>
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

// ─── The chat itself (remounted per project via key) ──────────────────────
function AiChat({ chatId, storageKey, nodeId, mountEl }) {
  const settingsRef = useRef({});
  const projectPathRef = useRef(null);
  const attachRef = useRef(true);
  const toolsRef = useRef(true);
  const [provider, setProvider] = useState("openai");
  const [providerMeta, setProviderMeta] = useState(PROVIDERS[0]);
  const [model, setModel] = useState(DEFAULT_MODELS.openai);
  const [hasKey, setHasKey] = useState(false);
  const [attachFile, setAttachFile] = useState(true);
  const [allowTools, setAllowTools] = useState(true);
  const [ctxPreview, setCtxPreview] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const modelFocusRef = useRef(false);

  try {
    projectPathRef.current = window.__currentProjectPath || null;
  } catch {
    projectPathRef.current = null;
  }
  attachRef.current = attachFile;
  toolsRef.current = allowTools;

  const applySettings = useCallback((st) => {
    const d = st || {};
    settingsRef.current = d;
    try {
      projectPathRef.current = window.__currentProjectPath || null;
    } catch {}
    const p = String(d.aiProvider || d.ai?.provider || "openai").toLowerCase();
    const meta = PROVIDERS.find((x) => x.id === p) || PROVIDERS[0];
    setProviderMeta(meta);
    setProvider(meta.id);
    const m = String(d.aiModel || d.ai?.model || "").trim() || DEFAULT_MODELS[meta.id];
    if (!modelFocusRef.current) setModel(m);
    setHasKey(String(d.aiApiKey || d.ai?.apiKey || "").length > 0);
  }, []);

  useEffect(() => {
    window.electronAPI?.readSettings?.().then((st) => applySettings(st || {})).catch(() => {});
    const unsub = window.electronAPI?.onSettingsUpdated
      ? window.electronAPI.onSettingsUpdated((patch) => {
          applySettings({ ...settingsRef.current, ...(patch || {}) });
        })
      : () => {};
    let bc = null;
    try {
      bc = new BroadcastChannel("app-settings");
      bc.onmessage = (e) => {
        if (e.data && typeof e.data === "object") applySettings({ ...settingsRef.current, ...e.data });
      };
    } catch {}
    return () => {
      try { unsub?.(); } catch {}
      try { bc?.close(); } catch {}
    };
  }, [applySettings]);

  // App theme -> shadow dark class.
  useEffect(() => {
    const sync = (isLight) => {
      try {
        mountEl?.classList?.toggle("dark", !isLight);
      } catch {}
    };
    window.electronAPI?.readSettings?.().then((s) => {
      const th = s?.theme || s?.editorTheme || "dark";
      sync(/^light/i.test(String(th)) || /light/i.test(String(th)));
    }).catch(() => sync(false));
    const apply = (th) => {
      if (th == null) return;
      sync(/light/i.test(String(th)));
    };
    let bc = null;
    try {
      bc = new BroadcastChannel("app-settings");
      bc.onmessage = (e) => apply(e.data?.theme ?? e.data?.editorTheme);
    } catch {}
    const unsub = window.electronAPI?.onSettingsUpdated
      ? window.electronAPI.onSettingsUpdated((p) => apply(p?.theme ?? p?.editorTheme))
      : () => {};
    return () => {
      try { bc?.close(); } catch {}
      try { unsub?.(); } catch {}
    };
  }, [mountEl]);

  // Editor context peek for the attach toggle label.
  useEffect(() => {
    const peek = () => {
      try {
        const ctx = window.__aiGetEditorContext?.();
        const next = ctx && ctx.filePath ? ctx : null;
        setCtxPreview((prev) => {
          const sig = (c) =>
            c ? `${c.filePath}|${c.startLine ?? ""}-${c.endLine ?? ""}|${(c.selection || "").length}|${(c.content || "").length}` : "";
          return sig(prev) === sig(next) ? prev : next;
        });
      } catch {
        setCtxPreview(null);
      }
    };
    peek();
    const iv = setInterval(peek, 2000);
    window.addEventListener("ai:context-changed", peek);
    return () => {
      clearInterval(iv);
      window.removeEventListener("ai:context-changed", peek);
    };
  }, []);

  const transport = useMemo(
    () =>
      new ElectronIpcTransport(() => {
        const st = settingsRef.current || {};
        return {
          provider,
          model: (model || "").trim() || DEFAULT_MODELS[provider],
          apiKey: st.aiApiKey || st.ai?.apiKey || "",
          baseURL: st.aiBaseUrl || st.aiBaseURL || st.ai?.baseUrl || st.ai?.baseURL || "",
          temperature: st.aiTemperature ?? st.ai?.temperature,
          system: st.aiSystemPrompt || st.ai?.systemPrompt || "",
          projectRoot: projectPathRef.current,
          allowTools: toolsRef.current && !!projectPathRef.current,
          attachFile: attachRef.current,
        };
      }),
    // Transport reads live values through the getter — stable instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [initialMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((m) => m && m.id && m.role && Array.isArray(m.parts)) : [];
    } catch {
      return [];
    }
  });

  const {
    messages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    setMessages,
    clearError,
  } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onFinish: ({ messages: all }) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify((all || []).slice(-100)));
      } catch {}
    },
    onError: () => {},
  });

  const isBusy = status === "streaming" || status === "submitted";

  const persistInlineConfig = useCallback((patch) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    window.electronAPI?.writeSettings?.(next).catch(() => {});
    try {
      const bc = new BroadcastChannel("app-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
  }, []);

  const onProviderChange = (id) => {
    const meta = PROVIDERS.find((x) => x.id === id) || PROVIDERS[0];
    setProviderMeta(meta);
    setProvider(meta.id);
    const m = DEFAULT_MODELS[meta.id] || "";
    setModel(m);
    persistInlineConfig({ aiProvider: meta.id, aiModel: m });
  };

  const clear = useCallback(() => {
    try {
      if (isBusy) stop();
    } catch {}
    try {
      clearError?.();
    } catch {}
    setMessages([]);
    try {
      localStorage.removeItem(storageKey);
    } catch {}
  }, [isBusy, stop, setMessages, storageKey, clearError]);

  const openSettings = () => {
    try {
      window.electronAPI.openSettingsWindow?.("ai");
    } catch {}
  };

  const copyText = useCallback(async (id, text) => {
    try {
      if (window.electronAPI?.clipboardWrite) await window.electronAPI.clipboardWrite(text);
      else await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {}
  }, []);

  const insertCode = useCallback((text) => {
    const code = lastCodeFence(text);
    if (!code) return;
    window.dispatchEvent(new CustomEvent("ai:insert-code", { detail: { code } }));
  }, []);

  const lastAssistantText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messageText(messages[i]);
    }
    return "";
  }, [messages]);

  const needsKey = providerMeta.needsKey && !hasKey;

  return (
    <div className="ai-scope dark flex h-full flex-col bg-background text-foreground">
      {/* Panel chrome: provider / model / settings */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Bot className="size-4 shrink-0 text-primary" />
        <span className="text-xs font-semibold">AI</span>
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value)}
          title="Provider (Vercel AI SDK)"
          className="max-w-28 rounded-md border bg-input px-1.5 py-1 text-xs outline-none"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <input
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            persistInlineConfig({ aiModel: e.target.value });
          }}
          onFocus={() => { modelFocusRef.current = true; }}
          onBlur={() => { modelFocusRef.current = false; }}
          placeholder={DEFAULT_MODELS[provider] || "model id"}
          list="ai-model-suggestions"
          spellCheck={false}
          title="Model id"
          className="w-full min-w-0 flex-1 rounded-md border bg-input px-1.5 py-1 font-mono text-xs outline-none"
        />
        <datalist id="ai-model-suggestions">
          {(providerMeta.models || []).map((m) => <option key={m} value={m} />)}
        </datalist>
        <span
          title={hasKey ? "API key set (Settings → AI)" : providerMeta.needsKey ? "No API key — open Settings → AI" : "Local server — no key needed"}
          onClick={openSettings}
          className={`size-2.5 shrink-0 cursor-pointer rounded-full ${hasKey ? "bg-green-500" : providerMeta.needsKey ? "bg-red-500" : "bg-sky-500"}`}
        />
        <MessageAction label="Clear chat" title="Clear chat" onClick={clear}>
          <Trash2 className="size-4" />
        </MessageAction>
        <MessageAction label="AI settings" title="AI settings" onClick={openSettings}>
          <Settings className="size-4" />
        </MessageAction>
        {nodeId && (
          <MessageAction
            label="Close AI panel"
            title="Close AI panel"
            onClick={() => window.dispatchEvent(new CustomEvent("close-flex-tab", { detail: { nodeId } }))}
          >
            <X className="size-4" />
          </MessageAction>
        )}
      </div>

      {/* Chat */}
      <Conversation className="min-h-0 flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <>
              <ConversationEmptyState
                icon={<MessageSquare className="size-12" />}
                title="Ask AI about your code"
                description="Powered by the Vercel AI SDK. Attach the current file, let it read the project, then ask."
              />
              {needsKey ? (
                <div className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-md border border-yellow-600/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-500">
                  <CircleAlert className="size-4 shrink-0" />
                  <span>Add an API key to start chatting.</span>
                  <button type="button" onClick={openSettings} className="font-semibold underline underline-offset-4">
                    Settings
                  </button>
                </div>
              ) : (
                <Suggestions className="mx-auto w-fit max-w-full">
                  {QUICK_PROMPTS.map((q) => (
                    <Suggestion
                      key={q.label}
                      suggestion={q.prompt}
                      onClick={(s) => sendMessage({ text: s })}
                    >
                      {q.label}
                    </Suggestion>
                  ))}
                </Suggestions>
              )}
            </>
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.role === "assistant" ? (
                    <AssistantParts message={message} status={status} />
                  ) : (
                    (message.parts || []).map((part, i) =>
                      part.type === "text" ? (
                        <span key={`${message.id}-${i}`}>{part.text}</span>
                      ) : part.type === "file" && part.mediaType && String(part.mediaType).startsWith("image/") ? (
                        <img key={`${message.id}-${i}`} src={part.url} alt={part.filename || "attachment"} className="max-w-full rounded-md" />
                      ) : null
                    )
                  )}
                </MessageContent>
                {message.role === "assistant" && messageText(message).trim() && (
                  <MessageActions>
                    <MessageAction
                      label={copiedId === message.id ? "Copied" : "Copy response"}
                      title={copiedId === message.id ? "Copied" : "Copy response"}
                      onClick={() => copyText(message.id, messageText(message))}
                    >
                      {copiedId === message.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                    </MessageAction>
                    {lastCodeFence(messageText(message)) && (
                      <MessageAction
                        label="Insert code into editor"
                        title="Insert code into editor at cursor"
                        onClick={() => insertCode(messageText(message))}
                      >
                        <Download className="size-4" />
                      </MessageAction>
                    )}
                  </MessageActions>
                )}
              </Message>
            ))
          )}
          {status === "submitted" && messages.length > 0 && messages[messages.length - 1]?.role === "user" && (
            <Message from="assistant" key="__pending">
              <MessageContent>
                <span className="text-sm text-muted-foreground">…</span>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Error + retry (docs pattern) */}
      {error && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs">
          <CircleAlert className="size-4 shrink-0 text-red-500" />
          <span className="min-w-0 flex-1 break-words">{error.message || "Something went wrong."}</span>
          <MessageAction label="Retry" title="Retry" onClick={() => regenerate()}>
            <RotateCcw className="size-4" />
          </MessageAction>
        </div>
      )}

      {/* Composer */}
      <div className="border-t p-3">
        <PromptInput
          onSubmit={(msg) => {
            if (msg.text && msg.text.trim()) sendMessage({ text: msg.text });
          }}
        >
          <PromptInputTextarea
            placeholder="Ask AI… (Enter to send, Shift+Enter for newline)"
            disabled={status !== "ready"}
          />
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputButton
                variant={attachFile ? "default" : "ghost"}
                onClick={() => setAttachFile((v) => !v)}
                title={ctxPreview ? `Attach: ${ctxPreview.fileName || ctxPreview.filePath}` : "Attach current editor file/selection"}
              >
                <FileCode2 className="size-4" />
                <span>{ctxPreview ? (ctxPreview.fileName || "file").slice(0, 18) : "File"}{attachFile && ctxPreview?.selection ? " (sel)" : ""}</span>
              </PromptInputButton>
              <PromptInputButton
                variant={allowTools && projectPathRef.current ? "default" : "ghost"}
                onClick={() => setAllowTools((v) => !v)}
                title={projectPathRef.current ? "Let AI list, read and search project files (read-only)" : "Open a project to enable file tools"}
              >
                <Wrench className="size-4" />
                <span>Tools</span>
              </PromptInputButton>
              <PromptInputButton
                variant="ghost"
                disabled={!lastCodeFence(lastAssistantText)}
                onClick={() => insertCode(lastAssistantText)}
                title="Insert last code block into the active editor at cursor"
              >
                <Download className="size-4" />
                <span>Insert code</span>
              </PromptInputButton>
            </PromptInputTools>
            <PromptInputSubmit status={status} onStop={() => stop()} />
          </PromptInputFooter>
        </PromptInput>
        <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
          <span>Vercel AI SDK • {providerMeta.label}</span>
          <span>{projectPathRef.current ? String(projectPathRef.current).split(/[\\/]/).pop() : "no project"}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Shadow DOM host: Tailwind + shadcn styles stay inside the panel ──────
export default function AIPanel({ nodeId }) {
  const hostRef = useRef(null);
  const [mount, setMount] = useState(null);
  const [projectPath, setProjectPath] = useState(() => {
    try {
      return window.__currentProjectPath || null;
    } catch {
      return null;
    }
  });

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

  useEffect(() => {
    const onOpen = (e) => setProjectPath(e.detail?.path || window.__currentProjectPath || null);
    const onClose = () => setProjectPath(null);
    window.addEventListener("project:opened", onOpen);
    window.addEventListener("project:closed", onClose);
    return () => {
      window.removeEventListener("project:opened", onOpen);
      window.removeEventListener("project:closed", onClose);
    };
  }, []);

  const chatId = `aipanel-${projectPath || "global"}`;
  const storageKey = `ai:chat:${projectPath || "global"}`;

  return (
    <div ref={hostRef} style={{ height: "100%", display: "flex", flexDirection: "column", background: "#1e1e1e" }}>
      {mount
        ? createPortal(
            <AiChat key={chatId} chatId={chatId} storageKey={storageKey} nodeId={nodeId} mountEl={mount} />,
            mount
          )
        : null}
    </div>
  );
}
