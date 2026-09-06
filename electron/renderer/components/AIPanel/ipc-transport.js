// ElectronIpcTransport — a ChatTransport for useChat
// (https://ai-sdk.dev/docs/ai-sdk-ui/transport) that talks to the Electron
// main process over IPC instead of HTTP. The main process runs streamText and
// returns a native UI-message stream whose chunks are relayed here.
//
// getRequest() supplies the per-request config:
//   { provider, model, apiKey, baseURL, temperature, system,
//     projectRoot, allowTools, attachFile }
export class ElectronIpcTransport {
  constructor(getRequest) {
    this.getRequest = getRequest;
    // Permanent IPC subscriptions + per-request queues so fast (local-model)
    // chunks that arrive before aiChat resolves are never lost.
    this.queues = new Map(); // requestId -> { chunks: [], done: null | { error?: string } }
    this.handlers = new Map(); // requestId -> { onChunk, onDone, onError }
    this.installed = false;
  }

  ensureInstalled() {
    if (this.installed) return;
    this.installed = true;
    try {
      window.electronAPI?.onAiStream?.(({ requestId, chunk } = {}) => {
        if (!requestId) return;
        const h = this.handlers.get(requestId);
        if (h) h.onChunk(chunk);
        else this.queueFor(requestId).chunks.push(chunk);
      });
      window.electronAPI?.onAiDone?.(({ requestId } = {}) => {
        if (!requestId) return;
        const h = this.handlers.get(requestId);
        if (h) h.onDone();
        else this.queueFor(requestId).done = {};
      });
      window.electronAPI?.onAiError?.(({ requestId, error } = {}) => {
        if (!requestId) return;
        const h = this.handlers.get(requestId);
        if (h) h.onError(error);
        else this.queueFor(requestId).done = { error: error || "AI request failed" };
      });
    } catch {
      this.installed = false;
    }
  }

  queueFor(requestId) {
    let q = this.queues.get(requestId);
    if (!q) {
      q = { chunks: [], done: null };
      this.queues.set(requestId, q);
    }
    return q;
  }

  // No persistent server stream exists (each request is a fresh IPC round
  // trip), so reconnection always yields null — same contract as the SDK's
  // DirectChatTransport. Only used when useChat is given `resume: true`.
  async reconnectToStream() {
    return null;
  }

  // Fresh editor context is injected into a COPY of the last user message on
  // every request (regenerations pick up the latest file too). Displayed
  // history and persisted messages never contain it.
  injectContext(messages, attachFile) {
    if (!attachFile) return messages;
    let ctx = null;
    try {
      ctx = window.__aiGetEditorContext?.();
    } catch {
      ctx = null;
    }
    if (!ctx || !ctx.filePath || !(ctx.selection || ctx.content)) return messages;
    const name = ctx.fileName || String(ctx.filePath).split(/[\\/]/).pop();
    const lang = (String(name).split(".").pop() || "").toLowerCase();
    const body = String(ctx.selection || ctx.content || "").slice(0, 12000);
    const where = ctx.selection
      ? ` (selected lines ${ctx.startLine || "?"}-${ctx.endLine || "?"})`
      : " (full file)";
    const block =
      `\n\n--- Attached file: ${name}${where} ---\n` +
      "```" + lang + "\n" + body + "\n```\n" +
      `--- End of ${name} ---`;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== "user" || !Array.isArray(m.parts)) continue;
      const tp = m.parts.find((p) => p && p.type === "text");
      if (tp && typeof tp.text === "string") tp.text = tp.text + block;
      break;
    }
    return messages;
  }

  async sendMessages({ messages, abortSignal }) {
    this.ensureInstalled();
    const req = this.getRequest() || {};
    let out;
    try {
      out = JSON.parse(JSON.stringify(messages));
    } catch {
      out = messages;
    }
    this.injectContext(out, req.attachFile !== false);

    let res;
    try {
      res = await window.electronAPI.aiChat({
        messages: out,
        provider: req.provider,
        model: req.model,
        apiKey: req.apiKey || "",
        baseURL: req.baseURL || "",
        temperature: req.temperature,
        system: req.system || "",
        projectRoot: req.projectRoot || null,
        allowTools: req.allowTools !== false && !!req.projectRoot,
      });
    } catch (e) {
      throw new Error(e?.message || "AI request failed");
    }
    if (!res?.ok) throw new Error(res?.error || "AI request failed");
    const requestId = res.requestId;
    const transport = this;

    let onAbort = null;
    const stream = new ReadableStream({
      start(controller) {
        const cleanup = () => {
          transport.handlers.delete(requestId);
          // Keep terminal queue entries briefly for late drain, then drop.
          setTimeout(() => transport.queues.delete(requestId), 5000);
          if (onAbort && abortSignal) {
            try {
              abortSignal.removeEventListener("abort", onAbort);
            } catch {}
          }
        };
        transport.handlers.set(requestId, {
          onChunk: (chunk) => {
            try {
              controller.enqueue(chunk);
            } catch {}
          },
          onDone: () => {
            cleanup();
            try {
              controller.close();
            } catch {}
          },
          onError: (error) => {
            cleanup();
            try {
              controller.error(new Error(error || "AI request failed"));
            } catch {}
          },
        });
        // Drain anything that arrived before the handler was registered.
        const q = transport.queues.get(requestId);
        if (q) {
          for (const chunk of q.chunks) {
            try {
              controller.enqueue(chunk);
            } catch {}
          }
          q.chunks = [];
          if (q.done) {
            const { error } = q.done;
            cleanup();
            if (error) {
              try {
                controller.error(new Error(error));
              } catch {}
            } else {
              try {
                controller.close();
              } catch {}
            }
            return;
          }
        }
        onAbort = () => {
          try {
            window.electronAPI.aiAbort(requestId).catch(() => {});
          } catch {}
          cleanup();
          // Graceful end on abort: useChat keeps the partial message.
          try {
            controller.close();
          } catch {}
        };
        if (abortSignal) {
          if (abortSignal.aborted) onAbort();
          else abortSignal.addEventListener("abort", onAbort, { once: true });
        }
      },
      cancel() {
        try {
          window.electronAPI.aiAbort(requestId).catch(() => {});
        } catch {}
        transport.handlers.delete(requestId);
        transport.queues.delete(requestId);
      },
    });

    return stream;
  }
}
