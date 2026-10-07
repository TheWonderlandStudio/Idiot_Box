// ─── Anonymous usage tracking ────────────────────────────────────────────────
// Do cheezein jaati hain (dono anonymous, opt-out):
//  1. Total users — har install par ek +1 public counter (countapi).
//  2. Online users — 30s ka retained MQTT heartbeat (random id + version +
//     timestamp) public relay par. Site "Online now" + version chips isi se
//     banata hai; app quit hone par retained message clear ho jaata hai.
// Koi PII nahi, koi server nahi. Opt-out: Settings → General → Telemetry
// (settings.telemetryEnabled, default on).
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

let mqtt = null;
try { mqtt = require("mqtt"); } catch (e) { console.warn("[tracking] mqtt not available:", e.message); }

const TOPIC_PREFIX = "idiotbox9f4c2/hb/";
const BROKER_WSS = "wss://broker.emqx.io:8084/mqtt";
const BROKER_TCP = "mqtt://broker.emqx.io:1883";
const HEARTBEAT_MS = 30 * 1000;
const CONNECT_GRACE_MS = 12 * 1000;
const COUNTER_HIT = "https://countapi.mileshilliard.com/api/v1/hit/idiotbox-total-installs-9f4c2";

let client = null;
let timer = null;
let fallbackTimer = null;
let usingWss = true;
let appRef = null;
let readSettingsRef = null;
let stateFile = null;
let state = null;
let starting = false;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}
function writeJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); return true; } catch (e) { return false; }
}

function ensureState() {
  if (state) return state;
  if (!appRef) return null;
  try { stateFile = path.join(appRef.getPath("userData"), "install-id.json"); } catch (e) { return null; }
  const loaded = readJson(stateFile) || {};
  if (!/^[a-f0-9]{16,64}$/i.test(String(loaded.id || ""))) {
    loaded.id = crypto.randomBytes(12).toString("hex");
    loaded.firstSeen = new Date().toISOString();
    loaded.counted = false;
    writeJson(stateFile, loaded);
  }
  state = loaded;
  return state;
}

function isEnabled() {
  try {
    const s = readSettingsRef ? readSettingsRef() : null;
    return !(s && s.telemetryEnabled === false);
  } catch (e) { return true; }
}

// ── total users — one +1 per install (sirf ek baar, success par flagged) ────
function countInstall() {
  const st = ensureState();
  if (!st || st.counted || typeof fetch !== "function") return;
  fetch(COUNTER_HIT, { method: "GET" })
    .then((res) => {
      if (!res.ok && res.status !== 404) return;
      st.counted = true;
      st.countedAt = new Date().toISOString();
      writeJson(stateFile, st);
    })
    .catch(() => { /* offline — agli launch par retry */ });
}

// ── heartbeat — retained publish, page ko turant live milta hai ─────────────
function topic() {
  const st = ensureState();
  return TOPIC_PREFIX + (st ? st.id : "unknown");
}
function payload() {
  const version = appRef && appRef.getVersion ? String(appRef.getVersion()) : "0";
  return JSON.stringify({ id: (ensureState() || {}).id, v: version, t: Date.now() });
}

function publish(raw, retain) {
  if (!client || !client.connected) return false;
  try {
    client.publish(topic(), raw, { qos: 0, retain: !!retain }, () => {});
    return true;
  } catch (e) { return false; }
}

function ensureConnected() {
  if (client) return;
  if (!mqtt || !appRef) return;
  const url = usingWss ? BROKER_WSS : BROKER_TCP;
  try {
    client = mqtt.connect(url, {
      connectTimeout: 10000,
      reconnectPeriod: 10000,
      keepalive: 30,
      clean: true,
      resubscribe: false,
    });
  } catch (e) {
    client = null;
    return;
  }
  client.on("connect", () => {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
    publish(payload(), true);
  });
  client.on("error", () => {});
  client.on("close", () => {});
  client.on("offline", () => {});

  // wss block ho to plain TCP broker par fallback
  if (usingWss) {
    fallbackTimer = setTimeout(() => {
      if (client && client.connected) return;
      try { client.end(true); } catch (e) {}
      client = null;
      usingWss = false;
      ensureConnected();
    }, CONNECT_GRACE_MS);
  }
}

function disconnect(clear) {
  clearTimeout(fallbackTimer);
  fallbackTimer = null;
  if (!client) return;
  if (clear) publish("", true); // retained hata do → user turant offline
  const c = client;
  client = null;
  setTimeout(() => { try { c.end(true); } catch (e) {} }, clear ? 400 : 0);
}

function tick() {
  if (!isEnabled()) {
    if (client) disconnect(true);
    return;
  }
  countInstall();
  ensureConnected();
  publish(payload(), true);
}

function start({ app, readSettings }) {
  if (!app) return false;
  appRef = app;
  readSettingsRef = readSettings || null;
  if (timer || starting) return true;
  starting = true;

  try {
    app.on("before-quit", () => stop());
  } catch (e) {}

  tick();
  timer = setInterval(tick, HEARTBEAT_MS);
  if (typeof timer.unref === "function") timer.unref();
  starting = false;
  return true;
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  disconnect(true);
}

module.exports = { start, stop };
