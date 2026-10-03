// Hub chat AI (free, no key).
// Chain: Pollinations (legacy anonymous text API) → fallback OVHcloud AI
// Endpoints anonymous tier (OpenAI-compatible, 2 RPM per model).
// Dono hi bina key ke chalte hain; ek fail hoto dusra try hota hai.
const { ipcMain } = require("electron");

const SYSTEM =
  "You are Idiot Box's project-setup assistant inside a desktop IDE. " +
  "Help the user decide WHAT to build and HOW to set it up, through normal, short conversation. " +
  "Always reply in English, even if the user writes in another language. " +
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
  "Example: user writes \"I want to make a Telegram bot\" → ask for the bot name + JS/TS once, " +
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
        "AI is not available right now (" +
          ((e && e.message) || "pollinations failed") +
          " / " +
          ((e2 && e2.message) || "fallback failed") +
          ")"
      );
    }
  }
}

// ── Streaming (live) mode — OpenAI-compatible SSE `data:` lines ─────────────
// Chunks seedha renderer ko bhejte hain; partial stream fail hoto fallback
// provider par jate hain (sirf jab koi chunk emit na hua ho — warna duplicate).
async function readOpenAiSse(res, onDelta) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.replace(/\r$/, "").trim();
      if (line.indexOf("data:") !== 0) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const c = j && j.choices && j.choices[0];
        const d = c && c.delta && c.delta.content;
        if (d) { full += d; onDelta(d); }
      } catch {}
    }
  }
  return full;
}

// 1) Pollinations — legacy GET ko progressive reader se padho (server agar
// token-by-token bheje to live chunks, warna ek hi chunk me pura text).
// NOTE: yahan POST /openai endpoint NAHI use karta wo anonymous tier par
// hang/402 karta hai; plain GET fast respond karta hai (200/4xx dono).
async function pollinationsAskStream(messages, onDelta) {
  const url = "https://text.pollinations.ai/" + encodeURIComponent(buildPrompt(messages)) + "?model=openai";
  return withTimeout(async (signal) => {
    const res = await fetch(url, { signal, headers: { Accept: "text/plain" } });
    if (!res.ok) throw new Error("pollinations HTTP " + res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const s = dec.decode(value, { stream: true });
      if (s) { full += s; onDelta(s); }
    }
    const text = full.trim();
    if (!text || text === "{}") throw new Error("pollinations empty response");
    return text;
  }, 40000);
}

// 2) OVHcloud — OpenAI-compatible streaming (model loop, 429 par agla model)
async function ovhAskStream(messages, onDelta) {
  const msgs = cleanMessages(messages);
  let emitted = 0;
  const emit = (d) => { emitted++; onDelta(d); };
  let lastErr = null;
  for (const model of OVH_MODELS) {
    try {
      const text = await withTimeout(async (signal) => {
        const res = await fetch(OVH_URL, {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: msgs,
            max_tokens: 1024,
            temperature: 0.7,
            stream: true,
          }),
        });
        if (res.status === 429) { const e = new Error("rate limited (" + model + ")"); e.retry = true; throw e; }
        if (!res.ok) { const e = new Error("ovh stream HTTP " + res.status + " (" + model + ")"); e.retry = true; throw e; }
        const t = await readOpenAiSse(res, emit);
        if (!t) { const e = new Error("ovh empty stream (" + model + ")"); e.retry = true; throw e; }
        return t;
      }, 45000);
      return text;
    } catch (e) {
      // beech me chunk nikal chuke ho to retry = duplicate text — ruk jao.
      if (emitted > 0) return;
      lastErr = e;
      if (!e || !e.retry) break; // network/abort — aur models ka koi fayda nahi
    }
  }
  throw lastErr || new Error("ovh stream failed");
}

// Stream chain: ovh(SSE, asli token streaming) → pollinations(GET progressive)
// → non-stream fallback (single chunk). Partial chunk nikal chuke ho to
// retry nahi (duplicate text bachega).
async function askAiStream(messages, onDelta) {
  let emitted = 0;
  const emit = (d) => { if (d) { emitted++; onDelta(d); } };
  try { await ovhAskStream(messages, emit); return; } catch {}
  if (emitted > 0) return;
  try { await pollinationsAskStream(messages, emit); return; } catch {}
  if (emitted > 0) return;
  const text = await askAi({ messages });
  if (text) onDelta(text);
}

// ── Voice input — renderer ka 16k mono PCM WAV → Windows System.Speech
// (offline, bina key ke) se text. Best-effort: fail ho to "" jata hai.
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

async function transcribeWav(base64Wav) {
  if (!base64Wav) return "";
  const file = path.join(os.tmpdir(), "ibx-voice-" + Date.now() + ".wav");
  try { fs.writeFileSync(file, Buffer.from(String(base64Wav), "base64")); }
  catch { return ""; }
  const ps = [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
    "$ErrorActionPreference='SilentlyContinue';" +
    "Add-Type -AssemblyName System.Speech;" +
    "$eng=New-Object System.Speech.Recognition.SpeechRecognitionEngine;" +
    "try{$eng.RecognizerCulture=[System.Globalization.CultureInfo]::GetCultureInfo('en-IN')}catch{};" +
    "$eng.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar));" +
    "$eng.SetInputToWaveFile('" + file.replace(/'/g, "''") + "');" +
    "$out='';" +
    "try{$r=$eng.Recognize([TimeSpan]::FromSeconds(20));if($r){$out=$r.Text}}catch{};" +
    "[Console]::Out.Write($out)",
  ];
  const text = await new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ps,
      { timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout) => resolve(err ? "" : String(stdout || ""))
    );
  });
  try { fs.unlinkSync(file); } catch {}
  return text.trim();
}

function registerAiChat() {
  try {
    ipcMain.handle("ai:chat", (_e, payload) => askAi(payload || {}));
    // Mic input: WAV base64 → transcribed text (Windows speech engine)
    ipcMain.handle("ai:transcribe", (_e, p) => transcribeWav(p && p.wav));
    // Streaming: renderer `ai:chat:start` bhejta hai, main chunk/done/error
    // events wapas usi webContents ko deta hai.
    ipcMain.on("ai:chat:start", async (e, payload) => {
      const id = (payload && payload.id) || "ai_" + Date.now();
      const sender = e.sender;
      const messages = (payload && payload.messages) || [];
      let full = "";
      const send = (channel, data) => {
        try { if (sender && !sender.isDestroyed()) sender.send(channel, data); } catch {}
      };
      try {
        await askAiStream(messages, (d) => {
          full += d;
          send("ai:chat:chunk", { id, text: d });
        });
        send("ai:chat:done", { id, text: full });
      } catch (err) {
        send("ai:chat:error", { id, message: (err && err.message) || "AI request failed" });
      }
    });
  } catch {}
}

module.exports = { registerAiChat };
