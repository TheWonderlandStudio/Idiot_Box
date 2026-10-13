/**
 * build/generate-file-icons.cjs
 * Per-file-type icons for OS file associations (Windows DefaultIcon / macOS
 * CFBundleTypeIconFile) — SAME vscode-icons SVGs shown by the project panel
 * (electron/main `fs:getVscodeIcon` + vscode-icons-js mapping).
 *
 * Flow per class: SVG name from vscode-icons-js → download from raw.githubusercontent → Edge headless screenshot (256x256, transparent) → ICO + ICNS.
 *
 * Uses ONLY Node.js built-ins + installed Edge (no npm install needed).
 * Output: build/file-icons/<key>.ico + <key>.icns (committed to the repo
 * so installer builds do not need internet/Edge).
 *
 * Run: node build/generate-file-icons.cjs
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DEST = path.join(__dirname, "file-icons");
const VSICONS_B = "https://raw.githubusercontent.com/vscode-icons/vscode-icons/master/icons/";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

// key -> { sample, exts, desc } — SVG resolved from vscode-icons-js via sample
// (exact match like the panel's `getIconForFile`).
const CLASSES = {
  js:        { sample: "app.js",      exts: ["js", "mjs", "cjs"],       desc: "JavaScript source file" },
  react:     { sample: "app.jsx",     exts: ["jsx"],                    desc: "JSX component" },
  ts:        { sample: "app.ts",      exts: ["ts"],                     desc: "TypeScript source file" },
  reactts:   { sample: "app.tsx",     exts: ["tsx"],                    desc: "TSX component" },
  html:      { sample: "index.html",  exts: ["html", "htm"],            desc: "HTML document" },
  css:       { sample: "style.css",   exts: ["css"],                    desc: "CSS stylesheet" },
  scss:      { sample: "style.scss",  exts: ["scss"],                   desc: "SCSS stylesheet" },
  less:      { sample: "style.less",  exts: ["less"],                   desc: "LESS stylesheet" },
  json:      { sample: "data.json",   exts: ["json", "jsonc"],          desc: "JSON document" },
  md:        { sample: "readme.md",   exts: ["md", "markdown"],         desc: "Markdown document" },
  py:        { sample: "main.py",     exts: ["py", "pyw"],              desc: "Python script" },
  c:         { sample: "main.c",      exts: ["c"],                      desc: "C source file" },
  cheader:   { sample: "main.h",      exts: ["h"],                      desc: "C header file" },
  cpp:       { sample: "main.cpp",    exts: ["cpp", "cc", "cxx"],       desc: "C++ source file" },
  cppheader: { sample: "main.hpp",    exts: ["hpp", "hh", "hxx"],       desc: "C++ header file" },
  java:      { sample: "Main.java",   exts: ["java"],                   desc: "Java source file" },
  rust:      { sample: "main.rs",     exts: ["rs"],                     desc: "Rust source file" },
  go:        { sample: "main.go",     exts: ["go"],                     desc: "Go source file" },
  ruby:      { sample: "main.rb",     exts: ["rb"],                     desc: "Ruby script" },
  php:       { sample: "index.php",   exts: ["php"],                    desc: "PHP script" },
  shell:     { sample: "run.sh",      exts: ["sh", "bash", "zsh"],      desc: "Shell script" },
  sql:       { sample: "query.sql",   exts: ["sql"],                    desc: "SQL script" },
  yaml:      { sample: "conf.yml",    exts: ["yml", "yaml"],            desc: "YAML document" },
  xml:       { sample: "data.xml",    exts: ["xml"],                    desc: "XML document" },
  vue:       { sample: "app.vue",     exts: ["vue"],                    desc: "Vue component" },
  svelte:    { sample: "app.svelte",  exts: ["svelte"],                 desc: "Svelte component" },
  toml:      { sample: "conf.toml",   exts: ["toml"],                   desc: "TOML configuration file" },
  txt:       { sample: "notes.txt",   exts: ["txt"],                    desc: "Plain text document" },
  log:       { sample: "app.log",     exts: ["log"],                    desc: "Log file" },
};

// ─── PNG helpers (from generate-icons.cjs: decode + resize + encode) ──────────
function decodePng(buf) {
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error("Not a PNG");
  let pos = 8;
  const chunks = {};
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); pos += 4;
    const type = buf.slice(pos, pos + 4).toString("ascii"); pos += 4;
    const data = buf.slice(pos, pos + len); pos += len;
    pos += 4;
    if (!chunks[type]) chunks[type] = [];
    chunks[type].push(data);
  }
  const ihdr = chunks.IHDR[0];
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8) throw new Error("Unsupported bit depth: " + ihdr[8]);
  const channels = ihdr[9] === 6 || ihdr[9] === 4 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(chunks.IDAT));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * 4);
  let rawPos = 0, pixPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++];
    const row = raw.slice(rawPos, rawPos + stride); rawPos += stride;
    const decoded = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? decoded[x - channels] : 0;
      const b = y > 0 ? pixels[pixPos - width * 4 + ((x / channels) | 0) * 4 + (x % channels)] : 0;
      switch (filter) {
        case 0: decoded[x] = row[x]; break;
        case 1: decoded[x] = (row[x] + a) & 0xff; break;
        case 2: decoded[x] = (row[x] + b) & 0xff; break;
        case 3: decoded[x] = (row[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const xc = (x / channels) | 0, ch = x % channels;
          const c = x >= channels && y > 0 ? pixels[pixPos - width * 4 + (xc - 1) * 4 + ch] : 0;
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          decoded[x] = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
      }
    }
    for (let x = 0; x < width; x++) {
      pixels[pixPos++] = decoded[x * channels];
      pixels[pixPos++] = decoded[x * channels + 1];
      pixels[pixPos++] = decoded[x * channels + 2];
      pixels[pixPos++] = channels === 4 ? decoded[x * channels + 3] : 255;
    }
  }
  return { width, height, pixels };
}
function resizeRGBA(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = y * yr, y0 = Math.min(sy | 0, sh - 1), y1 = Math.min(y0 + 1, sh - 1), fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = x * xr, x0 = Math.min(sx | 0, sw - 1), x1 = Math.min(x0 + 1, sw - 1), fx = sx - x0;
      const di = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const tl = src[(y0 * sw + x0) * 4 + c], tr = src[(y0 * sw + x1) * 4 + c];
        const bl = src[(y1 * sw + x0) * 4 + c], br = src[(y1 * sw + x1) * 4 + c];
        dst[di + c] = Math.round(tl * (1 - fx) * (1 - fy) + tr * fx * (1 - fy) + bl * (1 - fx) * fy + br * fx * fy);
      }
    }
  }
  return dst;
}
function crc32(buf) {
  if (!crc32._t) {
    crc32._t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crc32._t[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crc32._t[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const cv = Buffer.alloc(4); cv.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, cv]);
}
function buildIco(sizes, srcPixels, srcW, srcH) {
  const images = sizes.map((sz) =>
    encodePng(sz === srcW && sz === srcH ? srcPixels : resizeRGBA(srcPixels, srcW, srcH, sz, sz), sz, sz)
  );
  const HEADER = 6, ENTRY = 16;
  let offset = HEADER + ENTRY * images.length;
  const hdr = Buffer.alloc(HEADER);
  hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(ENTRY * images.length);
  images.forEach((img, i) => {
    const sz = sizes[i], d = i * ENTRY;
    dir[d] = sz >= 256 ? 0 : sz;
    dir[d + 1] = sz >= 256 ? 0 : sz;
    dir[d + 2] = 0; dir[d + 3] = 0;
    dir.writeUInt16LE(1, d + 4);
    dir.writeUInt16LE(32, d + 6);
    dir.writeUInt32LE(img.length, d + 8);
    dir.writeUInt32LE(offset, d + 12);
    offset += img.length;
  });
  return Buffer.concat([hdr, dir, ...images]);
}
const ICNS_OST = { 16: "icp4", 32: "icp5", 64: "icp6", 128: "ic07", 256: "ic08", 512: "ic09", 1024: "ic10" };
function buildIcns(sizes, srcPixels, srcW, srcH) {
  const parts = [];
  for (const sz of sizes) {
    const ost = ICNS_OST[sz]; if (!ost) continue;
    const px = sz === srcW && sz === srcH ? srcPixels : resizeRGBA(srcPixels, srcW, srcH, sz, sz);
    const png = encodePng(px, sz, sz);
    const hdr = Buffer.alloc(8);
    Buffer.from(ost, "ascii").copy(hdr, 0);
    hdr.writeUInt32BE(8 + png.length, 4);
    parts.push(hdr, png);
  }
  const body = Buffer.concat(parts);
  const fhdr = Buffer.alloc(8);
  Buffer.from("icns", "ascii").copy(fhdr, 0);
  fhdr.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([fhdr, body]);
}
function encodePng(pixels, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]));
    rows.push(pixels.slice(y * width * 4, (y + 1) * width * 4));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Edge headless: SVG → 256x256 transparent PNG ───────────────────────────
function findEdge() {
  for (const p of EDGE_CANDIDATES) {
    try { if (fs.statSync(p).isFile()) return p; } catch {}
  }
  return null;
}
function rasterizeSvg(edge, svgText, outPng) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ibx-icon-"));
  try {
    const html = `<html><body style="margin:0;padding:0;background:transparent">` +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svgText, "utf8").toString("base64")}" ` +
      `width="256" height="256" style="display:block"></body></html>`;
    const htmlPath = path.join(dir, "icon.html");
    fs.writeFileSync(htmlPath, html, "utf8");
    execFileSync(edge, [
      "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--default-background-color=00000000",
      "--window-size=256,256",
      `--screenshot=${outPng}`,
      "file:///" + htmlPath.replace(/\\/g, "/"),
    ], { stdio: "pipe", timeout: 60000 });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  const { width, height, pixels } = decodePng(fs.readFileSync(outPng));
  if (width !== 256 || height !== 256) throw new Error(`bad size ${width}x${height}`);
  let opaque = 0;
  for (let i = 3; i < pixels.length; i += 401 * 4) if (pixels[i] > 8) opaque++;
  if (!opaque) throw new Error("blank image (fully transparent)");
  return { pixels };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const vsicons = require(path.join(ROOT, "node_modules", "vscode-icons-js"));
  const edge = findEdge();
  if (!edge) throw new Error("Edge not found — Edge is required to rasterize SVGs");
  if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });
  const tmpPng = path.join(os.tmpdir(), "ibx-icon-tmp.png");

  for (const [key, cls] of Object.entries(CLASSES)) {
    const svgName = vsicons.getIconForFile(cls.sample);
    console.log(`[file-icons] ${key}: ${cls.sample} -> ${svgName}`);
    const res = await fetch(VSICONS_B + svgName);
    if (!res.ok) throw new Error(`download failed ${svgName}: ${res.status}`);
    const svg = await res.text();
    if (!svg.includes("<svg")) throw new Error(`not an SVG: ${svgName}`);
    const { pixels } = rasterizeSvg(edge, svg, tmpPng);

    const ico = buildIco([16, 32, 48, 64, 128, 256], pixels, 256, 256);
    fs.writeFileSync(path.join(DEST, `${key}.ico`), ico);
    const icns = buildIcns([16, 32, 64, 128, 256, 512, 1024], pixels, 256, 256);
    fs.writeFileSync(path.join(DEST, `${key}.icns`), icns);
    console.log(`[file-icons]   ${key}.ico ${(ico.length / 1024) | 0} KB, ${key}.icns ${(icns.length / 1024) | 0} KB`);
  }
  try { fs.unlinkSync(tmpPng); } catch {}
  console.log("[file-icons] Done! Files in build/file-icons/");
}

main().catch((e) => { console.error("[file-icons] FAILED:", e.message); process.exit(1); });
