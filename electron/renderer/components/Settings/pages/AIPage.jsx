import React, { useState } from "react";

// ─── AIPage ───────────────────────────────────────────────────────────────────
// AI assistant settings (Vercel AI SDK): provider, model, API key, local
// server URL, temperature, system prompt and read-only project tools.
// Keys are stored locally in settings.json and never leave the machine
// except as auth headers to the selected provider.
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDERS = [
  { id: "pollinations", label: "Pollinations (free)", needsKey: false, keyUrl: "https://enter.pollinations.ai", models: ["openai", "openai-fast", "mistral"] },
  { id: "openai", label: "OpenAI", needsKey: true, keyUrl: "https://platform.openai.com/api-keys", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"] },
  { id: "anthropic", label: "Anthropic", needsKey: true, keyUrl: "https://console.anthropic.com/settings/keys", models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-sonnet-4-5"] },
  { id: "google", label: "Google Gemini", needsKey: true, keyUrl: "https://aistudio.google.com/apikey", models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"] },
  { id: "gateway", label: "Vercel AI Gateway", needsKey: true, keyUrl: "https://vercel.com/ai-gateway", models: ["openai/gpt-4o-mini", "anthropic/claude-sonnet-4.5", "google/gemini-2.0-flash"] },
  { id: "ollama", label: "Ollama (local, free)", needsKey: false, keyUrl: "https://ollama.com", models: ["llama3.1", "qwen2.5-coder", "codellama", "mistral", "deepseek-coder-v2"] },
  { id: "openai-compatible", label: "Custom OpenAI-compatible server", needsKey: false, keyUrl: "", models: [] },
];

const DEFAULT_BASE_URL = { ollama: "http://localhost:11434/v1", "openai-compatible": "http://localhost:1234/v1" };

const AIPage = ({ settings, onSave }) => {
  const provider = String(settings.aiProvider || settings.ai?.provider || "pollinations");
  const meta = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];
  const model = String(settings.aiModel || settings.ai?.model || meta.models[0] || "");
  const apiKey = String(settings.aiApiKey || settings.ai?.apiKey || "");
  const baseUrl = String(settings.aiBaseUrl || settings.ai?.baseUrl || "");
  const temperature = settings.aiTemperature ?? settings.ai?.temperature ?? 0.7;
  const systemPrompt = String(settings.aiSystemPrompt || settings.ai?.systemPrompt || "");
  const allowTools = (settings.aiAllowTools ?? settings.ai?.allowTools) !== false;

  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, detail?, error? }

  const update = async (patch) => {
    setTestResult(null);
    await onSave(patch);
    try {
      const bc = new BroadcastChannel("app-settings");
      bc.postMessage(patch);
      bc.close();
    } catch {}
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await window.electronAPI.aiValidate({
        provider,
        model,
        apiKey,
        baseURL: baseUrl || DEFAULT_BASE_URL[provider] || "",
      });
      setTestResult(r || { ok: false, error: "No response" });
    } catch (e) {
      setTestResult({ ok: false, error: e?.message || String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      {/* ── Provider ─────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Provider</span>
        <span className="sw-row__desc">
          Model provider used by the AI panel (Vercel AI SDK). Pollinations is free with no key.
          No key configured? The panel automatically uses local Ollama if running, else free Pollinations.
        </span>
        <select
          className="sw-select"
          value={meta.id}
          onChange={(e) => {
            const id = e.target.value;
            const m = PROVIDERS.find((p) => p.id === id);
            update({ aiProvider: id, aiModel: m?.models?.[0] || "" });
          }}
          aria-label="AI provider"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* ── Model ────────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Model</span>
        <span className="sw-row__desc">
          Model id for {meta.label}. You can type any valid id, not just the suggestions.
        </span>
        <div className="sw-inline-row">
          <input
            className="sw-input"
            style={{ flex: 1, fontFamily: "Consolas,monospace" }}
            value={model}
            list="ai-settings-models"
            onChange={(e) => update({ aiModel: e.target.value })}
            placeholder={meta.models[0] || "model-id"}
            spellCheck={false}
            aria-label="AI model"
          />
          <datalist id="ai-settings-models">
            {meta.models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>
      </div>

      {/* ── API key ──────────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">API Key{meta.needsKey ? "" : " (optional)"}</span>
        <span className="sw-row__desc">
          {meta.needsKey ? (
            <>Stored locally in settings.json. {meta.keyUrl && <>Get one at <a href={meta.keyUrl} onClick={(e) => { e.preventDefault(); window.electronAPI?.openUrl?.(meta.keyUrl); }}>{meta.keyUrl}</a>.</>}</>
          ) : meta.id === "pollinations" ? (
            <>Not required — Pollinations works without a key (rate-limited). Paste a free token from <a href={meta.keyUrl} onClick={(e) => { e.preventDefault(); window.electronAPI?.openUrl?.(meta.keyUrl); }}>{meta.keyUrl}</a> for higher limits. Stored locally only.</>
          ) : (
            <>Optional for {meta.label} — only needed if your local server requires one.</>
          )}
        </span>
        <div className="sw-inline-row">
          <input
            className="sw-input"
            style={{ flex: 1, fontFamily: "Consolas,monospace" }}
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => update({ aiApiKey: e.target.value.trim() })}
            placeholder={meta.needsKey ? "sk-… / ant-… / AI_…" : "(optional)"}
            spellCheck={false}
            autoComplete="off"
            aria-label="AI API key"
          />
          <button className="sw-btn" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide key" : "Show key"}>
            {showKey ? "Hide" : "Show"}
          </button>
          {apiKey && (
            <button className="sw-btn" onClick={() => update({ aiApiKey: "" })} aria-label="Clear key">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Base URL (local / custom) ────────────────────────────────── */}
      {(meta.id === "ollama" || meta.id === "openai-compatible") && (
        <div className="sw-row">
          <span className="sw-row__label">Server URL</span>
          <span className="sw-row__desc">
            Base URL of the OpenAI-compatible endpoint (e.g. Ollama, LM Studio).
          </span>
          <input
            className="sw-input"
            style={{ fontFamily: "Consolas,monospace" }}
            value={baseUrl}
            onChange={(e) => update({ aiBaseUrl: e.target.value.trim() })}
            placeholder={DEFAULT_BASE_URL[meta.id]}
            spellCheck={false}
            aria-label="Server base URL"
          />
        </div>
      )}

      {/* ── Temperature ──────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Temperature</span>
        <span className="sw-row__desc">
          Lower is more precise, higher is more creative. 0.7 is a good default.
        </span>
        <div className="sw-inline-row">
          <input
            type="range"
            className="sw-range"
            min={0}
            max={2}
            step={0.1}
            value={Number(temperature)}
            onChange={(e) => update({ aiTemperature: parseFloat(e.target.value) })}
            aria-label="Temperature"
          />
          <input
            type="number"
            className="sw-input sw-input--small"
            min={0}
            max={2}
            step={0.1}
            value={Number(temperature)}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) update({ aiTemperature: Math.min(2, Math.max(0, v)) });
            }}
            aria-label="Temperature number"
          />
        </div>
      </div>

      {/* ── System prompt ────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">System Prompt</span>
        <span className="sw-row__desc">
          Optional instructions prepended to every conversation (coding style, brevity, …).
        </span>
        <textarea
          className="sw-input"
          style={{ minHeight: 64, resize: "vertical", fontFamily: "inherit" }}
          value={systemPrompt}
          onChange={(e) => update({ aiSystemPrompt: e.target.value })}
          placeholder="e.g. You are a senior engineer. Answer concisely with code examples."
          aria-label="System prompt"
        />
      </div>

      {/* ── Project tools ────────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Project Tools</span>
        <span className="sw-row__desc">
          Let the AI list, read and search files in the open project (read-only, confined to the project folder).
        </span>
        <label className="sw-toggle-row">
          <span className="sw-toggle-label">{allowTools ? "Enabled" : "Disabled"}</span>
          <button
            className={`sw-toggle-btn${allowTools ? " sw-toggle-btn--on" : ""}`}
            onClick={() => update({ aiAllowTools: !allowTools })}
            aria-checked={allowTools}
            role="switch"
            aria-label="Toggle project tools"
          >
            <span className="sw-toggle-thumb" />
          </button>
        </label>
      </div>

      {/* ── Test connection ──────────────────────────────────────────── */}
      <div className="sw-row">
        <span className="sw-row__label">Connection</span>
        <span className="sw-row__desc">
          Verify the provider, model and server reachability without spending tokens on generation.
        </span>
        <div className="sw-inline-row">
          <button className="sw-btn" onClick={testConnection} disabled={testing}>
            {testing ? "Testing…" : "Test Connection"}
          </button>
          {testResult && (
            <span style={{ fontSize: 12, color: testResult.ok ? "#4ec9b0" : "#f44747" }}>
              {testResult.ok ? `✓ ${testResult.detail || "OK"}` : `✕ ${testResult.error || "Failed"}`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIPage;
