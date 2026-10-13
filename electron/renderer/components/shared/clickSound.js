// ─── UI click sound (WebAudio synth — no audio files, works offline) ─────
// Shared: a soft click in Hub (or anywhere). The AudioContext is created/resumed
// on the first user gesture (autoplay-policy safe).
let ctx = null;
let enabled = true;

export function setClickEnabled(v) {
  enabled = v !== false;
}

function ensureCtx() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function playClick() {
  if (!enabled) return;
  try {
    const ac = ensureCtx();
    if (!ac) return;
    const t = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    // Normal "tick": a fast high-pitch tick with a very short decay.
    osc.type = "sine";
    osc.frequency.setValueAtTime(2900, t);
    osc.frequency.exponentialRampToValueAtTime(1900, t + 0.015);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.11, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.04);
  } catch {}
}

export default playClick;
