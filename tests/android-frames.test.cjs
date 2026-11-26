// Frame parsing for the emulator gRPC stream: the emulator hands back
// bottom-up RGBA, and a 60fps stream must not allocate a fresh buffer per
// frame. These tests pin both behaviours (and the pull-path fallback).
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const grpc = require(path.join(__dirname, "..", "electron", "main", "emulatorGrpc.js"));

// 2x2 bottom-up image: row 0 in the buffer is the BOTTOM row of the screen.
function bottomUp(width, height) {
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      px[i] = x; // R = column
      px[i + 1] = y; // G = buffer row
      px[i + 2] = 255;
      px[i + 3] = 255;
    }
  }
  return px;
}

const res = (w, h) => ({
  format: { width: w, height: h },
  image: bottomUp(w, h),
  seq: 7,
  timestampUs: 123,
});

test("parseImageResponse flips bottom-up RGBA to top-down", () => {
  const out = grpc.parseImageResponse(res(2, 3));
  assert.equal(out.w, 2);
  assert.equal(out.h, 3);
  assert.equal(out.seq, 7);
  assert.equal(out.timestampUs, 123);
  assert.equal(out.pixels.length, 2 * 3 * 4);
  // top row of the screen == last row of the bottom-up buffer (G = 2)
  assert.equal(out.pixels[1], 2, "top row should come from the buffer's last row");
  assert.equal(out.pixels[(2 * 2) * 4 + 1], 0, "bottom row should come from buffer row 0");
});

test("parseImageResponse reuses the caller's scratch buffer when streaming", () => {
  const ctx = { scratch: null };
  const a = grpc.parseImageResponse(res(4, 4), ctx);
  assert.ok(Buffer.isBuffer(ctx.scratch));
  const first = ctx.scratch;
  const b = grpc.parseImageResponse(res(4, 4), ctx);
  assert.strictEqual(ctx.scratch, first, "same size → no new allocation");
  assert.strictEqual(a.pixels, first);
  assert.strictEqual(b.pixels, first);
});

test("parseImageResponse grows the scratch buffer on resolution change", () => {
  const ctx = { scratch: null };
  grpc.parseImageResponse(res(2, 2), ctx);
  const small = ctx.scratch.length;
  grpc.parseImageResponse(res(3, 3), ctx);
  assert.equal(ctx.scratch.length, 3 * 3 * 4);
  assert.ok(ctx.scratch.length > small);
});

test("parseImageResponse rejects empty / short frames instead of drawing garbage", () => {
  assert.throws(() => grpc.parseImageResponse({ format: { width: 0, height: 0 }, image: Buffer.alloc(0) }), /empty\/invalid/);
  assert.throws(() => grpc.parseImageResponse({ format: { width: 8, height: 8 }, image: Buffer.alloc(16) }), /short gRPC frame/);
});

test("flipInto writes into the provided buffer (no allocation)", () => {
  const src = bottomUp(2, 2);
  const dst = Buffer.alloc(src.length);
  const out = grpc.flipInto(src, dst, 2, 2);
  assert.strictEqual(out, dst);
  assert.equal(out[1], 1);
  assert.equal(out[(1 * 2) * 4 + 1], 0);
});

// Regression guard: sending height=0 makes the emulator return the native
// display (10 MB+ RGBA), which overflows gRPC's 4 MB default receive limit and
// silently fell back to the slow adb screencap loop. Both dimensions must be
// positive, and RGBA8888 must be used (PNG is ~40ms/frame at 540×1200).
test("buildImageFormat always sends a positive width and height", () => {
  for (const req of [grpc.buildImageFormat(), grpc.buildImageFormat({ width: 0, height: 0 }), grpc.buildImageFormat({ width: 540 })]) {
    assert.ok(req.width > 0, `width must be > 0 (got ${req.width})`);
    assert.ok(req.height > 0, `height must be > 0 (got ${req.height})`);
    assert.equal(req.format, 1, "expects RGBA8888");
    assert.equal(req.display, 0);
  }
  // A Pixel-class portrait display fits in the default 4 MB limit (and the
  // client also raises the limit, so even larger displays are safe).
  assert.ok(540 * 1200 * 4 < 4 * 1024 * 1024, "540×1200 RGBA must fit the 4 MB limit");
});
