// Hub chat AI (free, no key).
// Chain: Pollinations (legacy anonymous text API) → fallback OVHcloud AI
// Endpoints anonymous tier (OpenAI-compatible, 2 RPM per model).
// Dono hi bina key ke chalte hain; ek fail hoto dusra try hota hai.
const { ipcMain } = require("electron");

const SYSTEM =
  "You are Idiot Box's project-setup assistant inside a desktop IDE. " +
  "Help the user decide WHAT to build and HOW to set it up, through normal, short conversation. " +
  "Reply in the same language the user writes in (Hinglish me likha ho to Hinglish me hi jawab do). " +
  "Keep replies short (max ~100 words), friendly, and ask at most one question at a time.\n" +
  "Your job: 1) understand the project they want, 2) pick a framework from the list below, " +
  "3) pick the IDE panels they will need, 4) when you have enough info (idea + project name), " +
  "recommend the setup and END your reply with EXACTLY one fenced block like:\n" +
  "```setup\n" +
  '{"projectName":"my-app","language":"TypeScript","framework":"react","panels":["editor","terminal","git","browser"]}\n' +
  "```\n" +
  "Setup-block rules:\n" +
  "- framework: exactly ONE id from the framework list (never invent ids).\n" +
  "- language: \"JavaScript\" or \"TypeScript\" for JS frameworks, otherwise \"Default\". " +
  "If the user already named a language (e.g. JavaScript), use EXACTLY that one.\n" +
  "- projectName: short kebab-case folder name (a-z 0-9 and dashes).\n" +
  "- panels: 3-6 keys from the panel list, chosen to fit this project.\n" +
  "- Emit a setup block only ONCE per plan. If the user wants changes, chat normally and " +
  "emit a NEW setup block only after the new plan is settled.\n" +
  "- If the user is chatting about something unrelated, just reply normally with NO setup block.\n" +
  "Frameworks (id: name): react: React, nextjs: Next.js, vue: Vue, svelte: Svelte, " +
  "angular: Angular, astro: Astro, html: HTML/CSS/JS, nuxt: Nuxt, express: Express, " +
  "nestjs: NestJS, fastify: Fastify, hono: Hono, flask: Flask, django: Django, " +
  "fastapi: FastAPI, streamlit: Streamlit, gradio: Gradio, go: Go, rust: Rust, " +
  "java: Java, php: PHP (Laravel), expo: Expo, flutter: Flutter, electron: Electron, " +
  "tauri: Tauri, discord-node: Discord Bot (Node), discord-py: Discord Bot (Python), " +
  "telegram-node: Telegram Bot (Node), telegram-py: Telegram Bot (Python), slack: Slack Bot, " +
  "whatsapp: WhatsApp Bot, twitter: Twitter Bot, chrome-ext: Chrome Extension, cli: CLI Tool.\n" +
  "Panels (key: meaning): editor: code editor, terminal: terminal, git: git/changes, " +
  "browser: built-in browser, problems: problems list, output: output log, ports: forwarded ports, " +
  "runDebug: run & debug, project: project file tree, media: media viewer, canvas: whiteboard, " +
  "community: community panel, emulator: Android emulator.\n" +
  "Example: user writes \"mujhe telegram bot banani hai\" → ask for the bot name + JS/TS once, " +
  "then propose framework telegram-node with panels editor/terminal/git/output.\n" +
  "Put code inside markdown fences.";

const OVH_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions";
// Anonymous tier 2 RPM per model — 429 aane par agla model try hota hai.
const OVH_MODELS = [
  "Mistral-7B-Instruct-v0.3",
  "gpt-oss-20b",
  "Mistral-Small-3.2-24B-Instruct-2506",
  "Qwen3.6-27B",
  "Mistral-Nemo-Instruct-2407",
  "Meta-Llama-3_3-70B-Instruct",
  "gpt-oss-120b",
];

function cleanMessages(messages) {
  const list = Array.isArray(messages) ? messages.slice(-10) : [];
  const out = [{ role: "system", content: SYSTEM }];
  for (const m of list) {
    if (!m) continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = String(m.content || "").slice(0, 4000).trim();
    if (content) out.push({ role, content });
  }
  if (out.length === 1) out.push({ role: "user", content: "hi" });
  return out;
}

function buildPrompt(messages) {
  return cleanMessages(messages)
    .map((m) => (m.role === "system" ? "[system] " + m.content : m.role + ": " + m.content))
    .join("\n\n") + "\n\nassistant:";
}

async function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); }
  finally { clearTimeout(timer); }
}

// ── 1) Pollinations — legacy anonymous text API ─────────────────────────────
async function pollinationsAsk(messages) {
  const url = "https://text.pollinations.ai/" + encodeURIComponent(buildPrompt(messages)) + "?model=openai";
  return withTimeout(async (signal) => {
    const res = await fetch(url, { signal, headers: { Accept: "text/plain" } });
    if (!res.ok) throw new Error("pollinations HTTP " + res.status);
    const text = (await res.text()).trim();
    if (!text) throw new Error("pollinations empty response");
    return text;
  }, 40000);
}

// ── 2) Fallback — OVHcloud AI Endpoints (anonymous, OpenAI-compatible) ──────
async function ovhAsk(messages) {
  const msgs = cleanMessages(messages);
  let lastErr = null;
  for (const model of OVH_MODELS) {
    try {
      const text = await withTimeout(async (signal) => {
        const res = await fetch(OVH_URL, {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: msgs, max_tokens: 1024, temperature: 0.7 }),
        });
        if (res.status === 429) { const e = new Error("rate limited (" + model + ")"); e.retry = true; throw e; }
        if (!res.ok) { const e = new Error("ovh HTTP " + res.status + " (" + model + ")"); e.retry = true; throw e; }
        const j = await res.json();
        const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!content || !String(content).trim()) { const e = new Error("ovh empty content (" + model + ")"); e.retry = true; throw e; }
        return String(content).trim();
      }, 45000);
      return text;
    } catch (e) {
      lastErr = e;
      if (!e || !e.retry) break; // network/abort — aur models ka koi fayda nahi
    }
  }
  throw lastErr || new Error("ovh failed");
}

async function askAi(payload) {
  const messages = (payload && payload.messages) || [];
  // 1) Pollinations try karo (jaisa user ne chuna), fail hoto fallback.
  try {
    return await pollinationsAsk(messages);
  } catch (e) {
    try { return await ovhAsk(messages); }
    catch (e2) {
      throw new Error(
        "AI abhi available nahi hai (" +
          ((e && e.message) || "pollinations failed") +
          " / " +
          ((e2 && e2.message) || "fallback failed") +
          ")"
      );
    }
  }
}

function registerAiChat() {
  try {
    ipcMain.handle("ai:chat", (_e, payload) => askAi(payload || {}));
  } catch {}
}

module.exports = { registerAiChat };
