// ─── Emulator gRPC screenshots (Google's embedded-emulator recipe) ──────────
// Android Studio embeds the emulator with `-qt-hide-window` + this same
// interface (getScreenshot). We keep our own startup (only `-grpc
// localhost:PORT` is added) and use gRPC purely as a faster frame source:
//
//   - persistent HTTP/2 channel — no adb client spawn per frame
//   - server-side scaling (width param) — same small frames, no PNG round-trip
//   - RGBA8888 pixels, flipped to top-down here so the renderer is untouched
//
// Anything goes wrong (port closed, UNAUTHENTICATED on hardened builds,
// empty frame, timeout) → throw → caller falls back to the adb pipeline.
// Worst case == today's behavior, never a black screen.
const path = require("path");

let grpc = null;
let protoLoader = null;
try { grpc = require("@grpc/grpc-js"); } catch (e) { /* optional */ }
try { protoLoader = require("@grpc/proto-loader"); } catch (e) { /* optional */ }

const PROTO_PATH = path.join(__dirname, "proto", "emulator_controller.proto");
const STREAM_WIDTH = 540; // matches the panel's stream resolution

let _clientCtor = null;
function clientCtor() {
  if (_clientCtor) return _clientCtor;
  if (!grpc || !protoLoader) throw new Error("gRPC deps not installed (npm install)");
  const def = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: Number,
    enums: Number,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(def);
  const ctl = pkg?.android?.emulation?.control?.EmulatorController;
  if (!ctl) throw new Error("EmulatorController not found in proto package");
  _clientCtor = ctl;
  return ctl;
}

const clients = new Map(); // port -> grpc Client

function getClient(port) {
  let c = clients.get(port);
  if (c) return c;
  const Ctor = clientCtor();
  c = new Ctor(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  clients.set(port, c);
  if (clients.size > 8) {
    try {
      const oldest = clients.keys().next().value;
      if (oldest !== port) closeClient(oldest);
    } catch {}
  }
  return c;
}

function closeClient(port) {
  const c = clients.get(port);
  if (!c) return;
  clients.delete(port);
  try { c.close(); } catch {}
}

function isAuthError(e) {
  const code = e?.code;
  if (code === 16) return true; // UNAUTHENTICATED
  return /unauthenticated|authorization header|permission denied/i.test(String(e?.details || e?.message || ""));
}

// Flip bottom-up RGBA to top-down in place-copy (renderer expects top-down).
function flipVertical(src, w, h) {
  const row = w * 4;
  const out = Buffer.allocUnsafe(src.length);
  for (let y = 0; y < h; y++) {
    src.copy(out, y * row, (h - 1 - y) * row, (h - y) * row);
  }
  return out;
}

// Unary screenshot. Resolves { w, h, pixels(top-down RGBA), seq }.
// Throws on any problem (caller falls back to adb).
function getScreenshot(port, { width = STREAM_WIDTH, timeoutMs = 10000 } = {}) {
  const client = getClient(port);
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      const err = new Error("gRPC screenshot timed out");
      err.code = 4; // DEADLINE_EXCEEDED-ish
      reject(err);
    }, timeoutMs);
    const req = { format: 1, width, height: 0, display: 0 }; // RGBA8888, aspect-preserved
    try {
      client.getScreenshot(req, { deadline: Date.now() + timeoutMs }, (err, res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) {
          if (isAuthError(err)) {
            const auth = new Error(`gRPC auth rejected (${err.details || err.message})`);
            auth.grpcAuth = true;
            return reject(auth);
          }
          return reject(err);
        }
        try {
          const fmt = res?.format || {};
          const w = fmt.width || res?.width || 0;
          const h = fmt.height || res?.height || 0;
          const img = res?.image;
          if (!w || !h || w > 4096 || h > 4096) {
            return reject(new Error(`empty/invalid gRPC frame (${w}x${h}) — display off?`));
          }
          if (!img || img.length < w * h * 4) {
            return reject(new Error(`short gRPC frame (${img?.length || 0} < ${w * h * 4})`));
          }
          const pixels = flipVertical(Buffer.from(img.subarray ? img.subarray(0, w * h * 4) : img.slice(0, w * h * 4)), w, h);
          resolve({ w, h, pixels, seq: res?.seq || 0, timestampUs: res?.timestampUs || 0 });
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      if (!done) { done = true; clearTimeout(timer); reject(e); }
    }
  });
}

module.exports = {
  STREAM_WIDTH,
  getClient,
  closeClient,
  getScreenshot,
  isAuthError,
  flipVertical,
  grpcAvailable: () => !!(grpc && protoLoader),
};
