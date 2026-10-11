/**
 * build/generate-icons.cjs
 * Generates build/icons/icon.ico  (Windows – multi-size ICO with embedded PNGs)
 *            build/icons/icon.icns (macOS  – ICNS with PNG payloads, 10.7+)
 *            build/icons/icon.png  (Linux  – 512×512 copy)
 * from electron/renderer/assets/idot_box.png
 *
 * Uses ONLY Node.js built-ins (zlib) — no npm installs needed.
 * Run: node build/generate-icons.cjs
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const zlib = require("zlib");

const SRC  = path.resolve(__dirname, "../electron/renderer/assets/idot_box.png");
const DEST = path.resolve(__dirname, "icons");

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

// ─── Minimal pure-JS PNG decoder (RGBA 8-bit truecolor/alpha) ─────────────
function decodePng(buf) {
  const SIG = [137,80,78,71,13,10,26,10];
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error("Not a PNG");
  let pos = 8;
  const chunks = {};
  while (pos < buf.length) {
    const len  = buf.readUInt32BE(pos); pos += 4;
    const type = buf.slice(pos, pos+4).toString("ascii"); pos += 4;
    const data = buf.slice(pos, pos+len); pos += len;
    pos += 4; // crc
    if (!chunks[type]) chunks[type] = [];
    chunks[type].push(data);
  }
  const ihdr      = chunks.IHDR[0];
  const width     = ihdr.readUInt32BE(0);
  const height    = ihdr.readUInt32BE(4);
  const bitDepth  = ihdr[8];
  const colorType = ihdr[9]; // 2=RGB, 6=RGBA
  if (bitDepth !== 8) throw new Error("Unsupported bit depth: " + bitDepth);
  const channels = (colorType === 6 || colorType === 4) ? 4 : 3;
  const idat = Buffer.concat(chunks.IDAT.map(d => d));
  const raw  = zlib.inflateSync(idat);
  const stride  = width * channels;
  const pixels  = Buffer.alloc(width * height * 4);
  let rawPos = 0, pixPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const row    = raw.slice(rawPos, rawPos + stride); rawPos += stride;
    const decoded = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? decoded[x - channels] : 0;
      const prevRowBase = pixPos - width * 4;
      const ch = x % channels;
      const xc = (x / channels | 0);
      const b  = y > 0 ? pixels[prevRowBase + xc * 4 + ch] : 0;
      switch (filter) {
        case 0: decoded[x] = row[x]; break;
        case 1: decoded[x] = (row[x] + a) & 0xFF; break;
        case 2: decoded[x] = (row[x] + b) & 0xFF; break;
        case 3: decoded[x] = (row[x] + ((a + b) >> 1)) & 0xFF; break;
        case 4: {
          const c  = x >= channels && y > 0 ? pixels[prevRowBase + (xc-1) * 4 + ch] : 0;
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2*c);
          decoded[x] = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
          break;
        }
      }
    }
    for (let x = 0; x < width; x++) {
      pixels[pixPos++] = decoded[x*channels];
      pixels[pixPos++] = decoded[x*channels+1];
      pixels[pixPos++] = decoded[x*channels+2];
      pixels[pixPos++] = channels === 4 ? decoded[x*channels+3] : 255;
    }
  }
  return { width, height, pixels };
}

// ─── Bilinear resize ────────────────────────────────────────────────────────
function resizeRGBA(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = y * yr, y0 = Math.min(sy|0, sh-1), y1 = Math.min(y0+1, sh-1), fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = x * xr, x0 = Math.min(sx|0, sw-1), x1 = Math.min(x0+1, sw-1), fx = sx - x0;
      const di = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const tl = src[(y0*sw+x0)*4+c], tr = src[(y0*sw+x1)*4+c];
        const bl = src[(y1*sw+x0)*4+c], br = src[(y1*sw+x1)*4+c];
        dst[di+c] = Math.round(tl*(1-fx)*(1-fy) + tr*fx*(1-fy) + bl*(1-fx)*fy + br*fx*fy);
      }
    }
  }
  return dst;
}

// ─── PNG encoder ────────────────────────────────────────────────────────────
function crc32(buf) {
  if (!crc32._t) {
    crc32._t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c>>>1) : c>>>1;
      crc32._t[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (const b of buf) c = crc32._t[(c ^ b) & 0xFF] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const cv = Buffer.alloc(4); cv.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, cv]);
}
function encodePng(pixels, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8]=8; ihdr[9]=6;
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]));
    rows.push(pixels.slice(y*width*4, (y+1)*width*4));
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── ICO builder ─────────────────────────────────────────────────────────────
// Modern Windows uses embedded PNG payloads inside ICO — same as Vista+
function buildIco(sizes, srcPixels, srcW, srcH) {
  const images = sizes.map(sz =>
    encodePng(sz === srcW && sz === srcH ? srcPixels : resizeRGBA(srcPixels, srcW, srcH, sz, sz), sz, sz)
  );
  const HEADER = 6, ENTRY = 16;
  let offset = HEADER + ENTRY * images.length;
  const hdr = Buffer.alloc(HEADER);
  hdr.writeUInt16LE(0,0); hdr.writeUInt16LE(1,2); hdr.writeUInt16LE(images.length,4);
  const dir = Buffer.alloc(ENTRY * images.length);
  images.forEach((img, i) => {
    const sz = sizes[i], d = i * ENTRY;
    dir[d] = sz>=256 ? 0 : sz;
    dir[d+1] = sz>=256 ? 0 : sz;
    dir[d+2]=0; dir[d+3]=0;
    dir.writeUInt16LE(1,  d+4);
    dir.writeUInt16LE(32, d+6);
    dir.writeUInt32LE(img.length, d+8);
    dir.writeUInt32LE(offset, d+12);
    offset += img.length;
  });
  return Buffer.concat([hdr, dir, ...images]);
}

// ─── ICNS builder ────────────────────────────────────────────────────────────
const ICNS_OST = { 16:"icp4", 32:"icp5", 64:"icp6", 128:"ic07", 256:"ic08", 512:"ic09", 1024:"ic10" };
function buildIcns(sizes, srcPixels, srcW, srcH) {
  const parts = [];
  for (const sz of sizes) {
    const ost = ICNS_OST[sz]; if (!ost) continue;
    const px  = sz===srcW&&sz===srcH ? srcPixels : resizeRGBA(srcPixels, srcW, srcH, sz, sz);
    const png = encodePng(px, sz, sz);
    const hdr = Buffer.alloc(8);
    Buffer.from(ost,"ascii").copy(hdr,0);
    hdr.writeUInt32BE(8+png.length, 4);
    parts.push(hdr, png);
  }
  const body = Buffer.concat(parts);
  const fhdr = Buffer.alloc(8);
  Buffer.from("icns","ascii").copy(fhdr,0);
  fhdr.writeUInt32BE(8+body.length, 4);
  return Buffer.concat([fhdr, body]);
}

// ─── Main ────────────────────────────────────────────────────────────────────
(function main() {
  console.log("[icons] Reading " + SRC);
  const srcBuf = fs.readFileSync(SRC);
  const { width, height, pixels } = decodePng(srcBuf);
  console.log("[icons] Decoded " + width + "x" + height);

  const ico = buildIco([16,32,48,64,128,256], pixels, width, height);
  fs.writeFileSync(path.join(DEST,"icon.ico"), ico);
  console.log("[icons] icon.ico  " + (ico.length/1024|0) + " KB");

  const icns = buildIcns([16,32,64,128,256,512,1024], pixels, width, height);
  fs.writeFileSync(path.join(DEST,"icon.icns"), icns);
  console.log("[icons] icon.icns " + (icns.length/1024|0) + " KB");

  const linuxPng = width===512&&height===512
    ? srcBuf
    : encodePng(resizeRGBA(pixels, width, height, 512, 512), 512, 512);
  fs.writeFileSync(path.join(DEST,"icon.png"), linuxPng);
  console.log("[icons] icon.png  " + (linuxPng.length/1024|0) + " KB (512x512)");

  console.log("[icons] Done! Files in build/icons/");
})();
