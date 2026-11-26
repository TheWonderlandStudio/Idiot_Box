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

// The emulator scales the image to fit inside width×height while preserving the
// aspect ratio — and *if either dimension is 0 it uses the native display size*
// (1080×2400 = 10.4 MB of RGBA on a Pixel, which overflows gRPC-js's 4 MB
// default receive limit). That was the real bug: every request sent height=0,
// so gRPC always failed with `Received message larger than max` and the panel
// silently fell back to the slow adb screencap loop.
//
// A square box of side 1200 is rotation-proof: portrait 1080×2400 → 540×1200,
// landscape 2400×1080 → 1200×540. Same 540-wide portrait frame as before, but
// now aspect-correct and never native-sized. The receive limit is also raised so
// a large display can never trip the 4 MB cap again.
const IMAGE_BOX = 1200;
const MAX_MESSAGE = 32 * 1024 * 1024;
const STREAM_WIDTH = 540; // documented width of the portrait frame we aim for
const CHANNEL_OPTIONS = {
  "grpc.max_receive_message_length": MAX_MESSAGE,
  "grpc.max_send_message_length": MAX_MESSAGE,
};

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
  c = new Ctor(`127.0.0.1:${port}`, grpc.credentials.createInsecure(), CHANNEL_OPTIONS);
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

// Flip bottom-up RGBA to top-down into a caller-owned buffer. A 60fps stream
// must not allocate a fresh multi-MB buffer per frame (that alone was enough
// GC pressure to stutter the panel), so callers pass a scratch buffer.
function flipInto(src, dst, w, h) {
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    src.copy(dst, y * row, (h - 1 - y) * row, (h - y) * row);
  }
  return dst;
}

// Flip bottom-up RGBA to top-down in a fresh buffer (one-shot callers).
function flipVertical(src, w, h) {
  return flipInto(src, Buffer.allocUnsafe(src.length), w, h);
}

// Build the ImageFormat request. Both dimensions MUST be > 0: the emulator
// treats a 0 dimension as "use the native display", which returns a full
// 10 MB+ RGBA frame and trips gRPC's receive limit. Guarding here makes that
// class of bug impossible.
function buildImageFormat({ width = IMAGE_BOX, height = IMAGE_BOX } = {}) {
  return {
    format: 1, // RGBA8888 — cheapest to produce (PNG encoding is ~40ms/frame)
    width: width > 0 ? Math.round(width) : IMAGE_BOX,
    height: height > 0 ? Math.round(height) : IMAGE_BOX,
    display: 0,
  };
}

// Unary screenshot. Resolves { w, h, pixels(top-down RGBA), seq }.
// Throws on any problem (caller falls back to adb).
function getScreenshot(port, { width = IMAGE_BOX, height = IMAGE_BOX, timeoutMs = 10000 } = {}) {
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
    const req = buildImageFormat({ width, height });
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
          resolve(parseImageResponse(res));
        } catch (e) {
          reject(e);
        }
      });
    } catch (e) {
      if (!done) { done = true; clearTimeout(timer); reject(e); }
    }
  });
}

function parseImageResponse(res, ctx = null) {
  const fmt = res?.format || {};
  const w = fmt.width || res?.width || 0;
  const h = fmt.height || res?.height || 0;
  const img = res?.image;
  if (!w || !h || w > 4096 || h > 4096) {
    throw new Error(`empty/invalid gRPC frame (${w}x${h}) — display off?`);
  }
  if (!img || img.length < w * h * 4) {
    throw new Error(`short gRPC frame (${img?.length || 0} < ${w * h * 4})`);
  }
  const src = img.subarray ? img.subarray(0, w * h * 4) : img.slice(0, w * h * 4);
  // ctx.scratch is reused across frames (streaming). The returned buffer is
  // only valid until the next parse on the same ctx — push it before then.
  let pixels;
  if (ctx) {
    if (!ctx.scratch || ctx.scratch.length !== src.length) ctx.scratch = Buffer.allocUnsafe(src.length);
    pixels = flipInto(src, ctx.scratch, w, h);
  } else {
    pixels = flipVertical(src, w, h);
  }
  return { w, h, pixels, seq: res?.seq || 0, timestampUs: res?.timestampUs || 0 };
}

// Streaming screenshot call. Returns a stream object that emits "data", "error", "end".
function streamScreenshot(port, { width = IMAGE_BOX, height = IMAGE_BOX } = {}) {
  const client = getClient(port);
  const call = client.streamScreenshot(buildImageFormat({ width, height }));
  return call;
}

module.exports = {
  STREAM_WIDTH,
  IMAGE_BOX,
  buildImageFormat,
  getClient,
  closeClient,
  getScreenshot,
  streamScreenshot,
  parseImageResponse,
  isAuthError,
  flipVertical,
  flipInto,
  grpcAvailable: () => !!(grpc && protoLoader),
};
