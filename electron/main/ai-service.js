// ─── AI service — Vercel AI SDK (https://ai-sdk.dev) ───────────────────────────
// Runs in the main process (Node) so API keys never live in bundled renderer
// code and all providers stream through one unified `streamText` pipeline.
//
// Renderer protocol (see preload `electronAPI.ai*`):
//   invoke("ai:chat", payload) -> { requestId }  (stream starts in background)
//   invoke("ai:abort", requestId) -> { ok }
//   invoke("ai:validate", config) -> { ok, error? }
// Events pushed to the requesting window:
//   "ai:stream" { requestId, part }   — text deltas + tool activity
//   "ai:done"   { requestId, text, usage?, steps? }
//   "ai:error"  { requestId, error }
//
// Supported providers: gateway | openai | anthropic | google | ollama |
// openai-compatible (custom Base URL). Config resolves from the chat payload
// first, then settings.json (`ai*` flat keys or nested `ai` object).

const path = require("path");
const fs = require("fs");

const AI_IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", "out",
  "coverage", ".cache", ".parcel-cache", ".turbo", ".vscode", ".idea",
  ".output", ".trash", ".project_config", ".canvas", "trash", "__pycache__",
  ".venv", "venv", "target", "bin", "obj",
]);

const DEFAULT_MODELS = {
  gateway: "openai/gpt-4o-mini",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  google: "gemini-2.0-flash",
  ollama: "llama3.1",
  "openai-compatible": "llama3.1",
};

function pickSetting(s, ...keys) {
  for (const k of keys) {
    if (s && s[k] !== undefined && s[k] !== null && s[k] !== "") return s[k];
  }
  if (s && s.ai && typeof s.ai === "object") {
    for (const k of keys) {
      const short = String(k).replace(/^ai/, "").replace(/^./, (c) => c.toLowerCase());
      if (s.ai[k] !== undefined && s.ai[k] !== "" && s.ai[k] !== null) return s.ai[k];
      if (s.ai[short] !== undefined && s.ai[short] !== "" && s.ai[short] !== null) return s.ai[short];
    }
  }
  return undefined;
}

function resolveConfig(payload = {}, settings = {}) {
  const provider = String(
    payload.provider || pickSetting(settings, "aiProvider", "provider") || "openai"
  ).toLowerCase();
  const model =
    String(payload.model || pickSetting(settings, "aiModel", "model") || "").trim() ||
    DEFAULT_MODELS[provider] ||
    DEFAULT_MODELS.openai;
  const apiKey = String(
    payload.apiKey ?? pickSetting(settings, "aiApiKey", "apiKey") ?? ""
  );
  const baseURL = String(
    payload.baseURL ?? payload.baseUrl ?? pickSetting(settings, "aiBaseUrl", "aiBaseURL", "baseURL", "baseUrl") ?? ""
  ).trim();
  let temperature = payload.temperature ?? pickSetting(settings, "aiTemperature", "temperature");
  temperature = temperature === "" || temperature === null || temperature === undefined
    ? undefined
    : Math.min(2, Math.max(0, Number(temperature)));
  if (!Number.isFinite(temperature)) temperature = undefined;
  const system = String(
    payload.system ?? pickSetting(settings, "aiSystemPrompt", "systemPrompt", "system") ?? ""
  ).trim();
  const projectRoot = payload.projectRoot || settings.__projectRoot || null;
  const allowTools = payload.allowTools !== false &&
    (pickSetting(settings, "aiAllowTools", "allowTools") !== false);
  return { provider, model, apiKey, baseURL, temperature, system, projectRoot, allowTools };
}

function humanAiError(raw) {
  const s = String(raw || "");
  const low = s.toLowerCase();
  if (!s) return "AI request failed";
  if (low.includes("401") || low.includes("unauthorized") || low.includes("invalid api key") ||
      low.includes("incorrect api key") || low.includes("invalid x-api-key") || low.includes("authentication")) {
    return "Invalid API key — check Settings → AI and paste a valid key for the selected provider.";
  }
  if (low.includes("403") || low.includes("forbidden") || low.includes("permission")) {
    return "API key lacks permission for this model — check your provider plan / key scopes.";
  }
  if (low.includes("404") || low.includes("not found") || low.includes("does not exist") || low.includes("unknown model")) {
    return "Model not found — check the model id in Settings → AI (e.g. gpt-4o-mini).";
  }
  if (low.includes("429") || low.includes("rate limit") || low.includes("quota") || low.includes("insufficient_quota") || low.includes("billing")) {
    return "Rate limit / quota exceeded — wait a moment or check provider billing.";
  }
  if (low.includes("econnrefused") || low.includes("failed to fetch") || low.includes("fetch failed") ||
      low.includes("network") || low.includes("enotfound") || low.includes("econnreset") || low.includes("socket hang up")) {
    return "Network error — check your connection. For Ollama, is `ollama serve` running?";
  }
  if (low.includes("aborted") || low.includes("abort")) return "Request stopped.";
  if (low.includes("context") && low.includes("length")) {
    return "Conversation too long for this model — press Clear and try again.";
  }
  const first = s.split("\n").map((l) => l.trim()).filter(Boolean)[0];
  return (first || "AI request failed").slice(0, 400);
}

function ensureInside(root, rel) {
  try {
    if (!root || !rel || typeof rel !== "string") return null;
    if (rel.includes("\0") || path.isAbsolute(rel)) return null;
    const joined = path.resolve(path.join(root, rel));
    const r = path.resolve(root);
    if (joined === r || joined.startsWith(r + path.sep)) return joined;
  } catch { /* ignore */ }
  return null;
}

function isUiMessage(m) {
  return m && typeof m === "object" &&
    typeof m.id === "string" &&
    (m.role === "user" || m.role === "assistant" || m.role === "system") &&
    Array.isArray(m.parts);
}

// Minimal read-only IDE tools so the model can inspect the open project.
// They run in main (Node) with path confinement + size caps.
async function buildTools(projectRoot, z) {
  if (!projectRoot) return undefined;
  let root = null;
  try {
    if (!fs.existsSync(projectRoot)) return undefined;
    root = path.resolve(projectRoot);
  } catch { return undefined; }

  return {
    list_files: {
      description: "List files in a project directory (1 level). Use '.' for the project root.",
      inputSchema: z.object({
        dir: z.string().optional().describe("Relative directory, '.' for root"),
      }),
      execute: async ({ dir }) => {
        const rel = String(dir || ".").replace(/\\/g, "/");
        const abs = rel === "." || rel === "" ? root : ensureInside(root, rel);
        if (!abs) return "Invalid directory (must be inside the project).";
        let entries = [];
        try {
          entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch (e) {
          return `Cannot list directory: ${e.message}`;
        }
        const out = [];
        for (const e of entries) {
          if (e.name.startsWith(".") && e.name !== ".env") continue;
          if (AI_IGNORE_DIRS.has(e.name)) continue;
          out.push(`${e.isDirectory() ? "dir " : "file"} ${e.name}`);
          if (out.length >= 80) { out.push("… (truncated)"); break; }
        }
        return out.length ? out.join("\n") : "(empty directory)";
      },
    },
    read_file: {
      description: "Read a text file from the project (truncated past 60 KB).",
      inputSchema: z.object({
        path: z.string().describe("Relative file path inside the project"),
      }),
      execute: async ({ path: rel }) => {
        const abs = ensureInside(root, String(rel || "").replace(/\\/g, "/"));
        if (!abs) return "Invalid path (must be a file inside the project).";
        try {
          const st = fs.statSync(abs);
          if (!st.isFile()) return "Not a file.";
          if (st.size > 2 * 1024 * 1024) return "File too large (>2 MB).";
          const buf = fs.readFileSync(abs);
          if (buf.includes(0)) return "Binary file — cannot display.";
          let text = buf.toString("utf8");
          if (text.length > 60000) text = text.slice(0, 60000) + "\n… (truncated)";
          return text || "(empty file)";
        } catch (e) {
          return `Cannot read file: ${e.message}`;
        }
      },
    },
    search_text: {
      description: "Search project text for a query (code-aware, capped at 20 hits).",
      inputSchema: z.object({
        query: z.string().describe("Text to search for (min 2 chars)"),
        limit: z.number().optional().describe("Max hits (default 20, max 40)"),
      }),
      execute: async ({ query, limit }) => {
        const q = String(query || "").trim().toLowerCase();
        if (q.length < 2) return "Query too short.";
        const max = Math.min(40, Math.max(1, Number(limit) || 20));
        const hits = [];
        const stack = [root];
        const seen = new Set();
        let scanned = 0;
        while (stack.length && hits.length < max && scanned < 1500) {
          const dir = stack.pop();
          let real = dir;
          try { real = fs.realpathSync(dir); } catch { /* ignore */ }
          if (seen.has(real)) continue;
          seen.add(real);
          let entries = [];
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
          for (const e of entries) {
            if (e.name.startsWith(".") && e.name !== ".env") continue;
            if (AI_IGNORE_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { stack.push(full); continue; }
            scanned++;
            if (scanned > 1500) break;
            try {
              const st = fs.statSync(full);
              if (st.size > 1024 * 1024) continue;
              const content = fs.readFileSync(full, "utf8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length && hits.length < max; i++) {
                if (lines[i].toLowerCase().includes(q)) {
                  const rel = path.relative(root, full).replace(/\\/g, "/");
                  hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
                }
              }
            } catch { /* skip unreadable */ }
          }
        }
        return hits.length ? hits.join("\n") : "No matches.";
      },
    },
  };
}

async function resolveModel(cfg) {
  const { provider, model, apiKey, baseURL } = cfg;
  if (provider === "openai") {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI({ apiKey: apiKey || undefined, baseURL: baseURL || undefined })(model);
  }
  if (provider === "anthropic") {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    return createAnthropic({ apiKey: apiKey || undefined, baseURL: baseURL || undefined })(model);
  }
  if (provider === "google") {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    return createGoogleGenerativeAI({ apiKey: apiKey || undefined, baseURL: baseURL || undefined })(model);
  }
  if (provider === "gateway") {
    // AI Gateway (https://ai-sdk.dev/docs/getting-started/nodejs) — default
    // global provider. Model ids look like "openai/gpt-4o-mini".
    if (apiKey) {
      try {
        const { createGateway } = await import("@ai-sdk/gateway");
        return createGateway({ apiKey, baseURL: baseURL || undefined })(model);
      } catch {
        process.env.AI_GATEWAY_API_KEY = apiKey;
        const { gateway } = await import("ai");
        return gateway(model);
      }
    }
    const { gateway } = await import("ai");
    return gateway(model);
  }
  if (provider === "ollama" || provider === "openai-compatible" || provider === "custom" || provider === "lmstudio") {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    return createOpenAICompatible({
      name: provider === "ollama" ? "ollama" : "custom",
      baseURL: baseURL || "http://localhost:11434/v1",
      apiKey: apiKey || "ollama",
    })(model);
  }
  throw new Error(`Unknown provider "${provider}". Use gateway, openai, anthropic, google, ollama or openai-compatible.`);
}

function setupAiIpc({ ipcMain, BrowserWindow, readSettings }) {
  const controllers = new Map(); // requestId -> AbortController
  let seq = 0;

  const needsKey = (provider) =>
    ["openai", "anthropic", "google", "gateway"].includes(provider);

  ipcMain.handle("ai:chat", async (event, payload = {}) => {
    const requestId = `ai-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const sender = event.sender;
    let settings = {};
    try { settings = (typeof readSettings === "function" ? readSettings() : {}) || {}; } catch { settings = {}; }
    const cfg = resolveConfig(payload, settings);

    const uiMessages = Array.isArray(payload.messages)
      ? payload.messages.filter(isUiMessage).slice(-40)
      : [];
    if (!uiMessages.length) return { ok: false, error: "No messages to send." };

    if (needsKey(cfg.provider) && !cfg.apiKey) {
      return { ok: false, error: `Missing API key for ${cfg.provider} — open Settings → AI and paste a key.` };
    }

    const controller = new AbortController();
    controllers.set(requestId, controller);

    // Run streaming in the background; the native UI-message stream
    // (https://ai-sdk.dev/docs/ai-sdk-ui) is forwarded chunk-by-chunk over
    // ai:stream, then ai:done / ai:error close the request.
    (async () => {
      try {
        const ai = await import("ai");
        const { z } = await import("zod");
        const model = await resolveModel(cfg);
        const tools = cfg.allowTools ? await buildTools(cfg.projectRoot, z) : undefined;
        const stopWhen = typeof ai.stepCountIs === "function"
          ? ai.stepCountIs(5)
          : typeof ai.isStepCount === "function" ? ai.isStepCount(5) : undefined;

        const modelMessages = await ai.convertToModelMessages(uiMessages, {
          ...(tools ? { tools } : {}),
          ignoreIncompleteToolCalls: true,
        });

        const result = ai.streamText({
          model,
          messages: modelMessages,
          ...(cfg.system ? { system: cfg.system } : {}),
          ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
          ...(tools ? { tools } : {}),
          ...(stopWhen ? { stopWhen } : {}),
          abortSignal: controller.signal,
        });

        const uiStream = ai.toUIMessageStream({
          stream: result.stream,
          ...(tools ? { tools } : {}),
          sendReasoning: true,
          onError: (e) => humanAiError(e instanceof Error ? e.message : e),
        });

        try {
          const reader = uiStream.getReader();
          for (;;) {
            if (controller.signal.aborted) {
              try { reader.cancel(); } catch { /* ignore */ }
              break;
            }
            const { done, value } = await reader.read();
            if (done) break;
            try {
              if (!sender.isDestroyed()) {
                sender.send("ai:stream", { requestId, chunk: value });
              }
            } catch { /* window gone — keep draining */ }
          }
          try { reader.releaseLock(); } catch { /* ignore */ }
        } catch (streamErr) {
          if (controller.signal.aborted) {
            try { if (!sender.isDestroyed()) sender.send("ai:error", { requestId, error: "Request stopped." }); } catch {}
            return;
          }
          throw streamErr;
        }

        // Drain post-stream promises so provider errors surface as ai:error
        // instead of unhandled rejections (the chunks already delivered the text).
        try { await result.text; } catch (e) {
          if (!controller.signal.aborted) throw e;
          try { if (!sender.isDestroyed()) sender.send("ai:error", { requestId, error: "Request stopped." }); } catch {}
          return;
        }
        try {
          if (!sender.isDestroyed()) sender.send("ai:done", { requestId });
        } catch { /* ignore */ }
      } catch (err) {
        const aborted = controller.signal.aborted;
        try {
          if (!sender.isDestroyed()) {
            sender.send("ai:error", {
              requestId,
              error: aborted ? "Request stopped." : humanAiError(err?.message || err),
            });
          }
        } catch { /* ignore */ }
      } finally {
        controllers.delete(requestId);
      }
    })();

    return { ok: true, requestId, model: cfg.model, provider: cfg.provider };
  });

  ipcMain.handle("ai:abort", async (_e, requestId) => {
    try {
      const c = controllers.get(String(requestId));
      if (c) { c.abort(); controllers.delete(String(requestId)); return { ok: true }; }
    } catch { /* ignore */ }
    return { ok: false };
  });

  ipcMain.handle("ai:validate", async (_e, config = {}) => {
    let settings = {};
    try { settings = (typeof readSettings === "function" ? readSettings() : {}) || {}; } catch { settings = {}; }
    const cfg = resolveConfig(config, settings);
    if (needsKey(cfg.provider) && !cfg.apiKey) {
      return { ok: false, error: `Missing API key for ${cfg.provider}.` };
    }
    if (!cfg.model) return { ok: false, error: "Missing model id." };
    if (cfg.provider === "ollama" || cfg.provider === "openai-compatible" || cfg.provider === "custom" || cfg.provider === "lmstudio") {
      const base = cfg.baseURL || "http://localhost:11434/v1";
      try {
        const u = new URL(base);
        const origin = `${u.protocol}//${u.host}`;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        try {
          // Ollama exposes /api/tags; OpenAI-compatible servers usually 404 it
          // but still prove reachability — either way a response = reachable.
          const r = await fetch(`${origin}/api/tags`, { signal: ctrl.signal });
          return { ok: true, detail: `Server reachable (${r.status}).` };
        } finally {
          clearTimeout(t);
        }
      } catch (e) {
        return { ok: false, error: `Cannot reach ${base} — is the server running? (${e.message})` };
      }
    }
    try {
      await resolveModel(cfg);
      return { ok: true, detail: `${cfg.provider} / ${cfg.model} looks valid. Send a message to test generation.` };
    } catch (e) {
      return { ok: false, error: humanAiError(e?.message || e) };
    }
  });

  // Best-effort cleanup when windows close with streams in flight.
  try {
    BrowserWindow.getAllWindows();
  } catch { /* ignore */ }
}

module.exports = { setupAiIpc, resolveConfig, humanAiError, DEFAULT_MODELS, buildTools };
