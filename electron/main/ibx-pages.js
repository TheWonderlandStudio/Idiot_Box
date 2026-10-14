"use strict";

// ─── idiotbox:// internal pages ─────────────────────────────────────────────
// Purpose-built Chrome-style internal pages for the Electron app.
// chrome://extensions cannot load in Electron, so `idiotbox://extensions`
// is a self-hosted clone served from this custom protocol handler.
//
// This module is intentionally decoupled from app internals: the host
// (electron/main/index.js) injects everything it needs via `api`, so this
// file never touches sessions, dialogs, the filesystem layout, or windows.
//
// Wiring (done by the host, NOT here):
//   1. BEFORE app ready:
//        protocol.registerSchemesAsPrivileged([
//          { scheme: "ibx-file", privileges: { ... } },           // existing
//          { scheme: "idiotbox", privileges: { standard: true, secure: true, supportFetchAPI: true } },
//        ]);
//   2. AFTER app ready (inside the app.whenReady() block, next to the
//      existing `protocol.handle("ibx-file", ...)` registration):
//        const { registerIbxPages } = require("./ibx-pages");
//        registerIbxPages({ protocol, api: { ... } });
//
// Routes served:
//   GET  idiotbox://extensions/ (or empty path)  → extensions HTML page
//   GET  idiotbox://extensions/api/list           → { ok, extensions: [...] }
//   GET  idiotbox://extensions/api/details?id=   → { ok, details: {...} }
//   POST idiotbox://extensions/api/enable        → body { id, on }
//   POST idiotbox://extensions/api/uninstall     → body { id }
//   POST idiotbox://extensions/api/load-unpacked → body {} (host opens dialog)
//   POST idiotbox://extensions/api/reload        → body {} (host reloads all)
// Anything else → 404 plain text.

const fs = require("fs");
const path = require("path");

// Absolute path of the bundled HTML page. electron/**/* is packaged by
// electron-builder (package.json "build.files"), so this file ships
// automatically in both dev and packaged (asar) builds.
const EXTENSIONS_PAGE_FILE = path.join(__dirname, "..", "renderer", "ibx-pages", "extensions.html");

// Privileges the host must register for the `idiotbox` scheme BEFORE app
// ready (mirrors the existing `ibx-file` entry). `standard: true` makes
// `new URL("idiotbox://...")` parse with a real host/path and gives the
// page a stable origin so fetch() + localStorage just work same-origin.
const IDIOTBOX_SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
});

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function textResponse(text, status) {
  return new Response(String(text), {
    status: status || 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// POST bodies are parsed leniently: malformed / empty bodies become {} and
// each route then reports the missing field as a 400 instead of throwing.
async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function errorStatus(message, fallback) {
  if (message && /not found/i.test(String(message))) return 404;
  return fallback || 500;
}

// Pass through a host result object. Host callbacks may return either
// `{ ok, ... }` or a bare value; normalize to `{ ok: true, ... }` JSON.
function passThrough(result, wrapKey) {
  if (result && typeof result === "object" && typeof result.ok === "boolean") {
    return jsonResponse(result, result.ok ? 200 : errorStatus(result.error, 500));
  }
  if (result === undefined || result === null) {
    return jsonResponse({ ok: false, error: "No result from host" }, 500);
  }
  if (wrapKey) return jsonResponse({ ok: true, [wrapKey]: result });
  return jsonResponse({ ok: true, result });
}

function registerIbxPages({ protocol, api }) {
  if (!protocol || typeof protocol.handle !== "function") {
    throw new TypeError("[ibx-pages] registerIbxPages requires { protocol } with a handle() method");
  }
  const a = api || {};
  // Stubs keep the page loadable (with a clear error) even if the host
  // forgets to inject a callback — never crash the protocol handler.
  const listExtensions = typeof a.listExtensions === "function" ? a.listExtensions : async () => ({ ok: false, error: "listExtensions not wired" });
  const getDetails = typeof a.getDetails === "function" ? a.getDetails : async () => ({ ok: false, error: "getDetails not wired" });
  const setEnabled = typeof a.setEnabled === "function" ? a.setEnabled : async () => ({ ok: false, error: "setEnabled not wired" });
  const uninstall = typeof a.uninstall === "function" ? a.uninstall : async () => ({ ok: false, error: "uninstall not wired" });
  const loadUnpacked = typeof a.loadUnpacked === "function" ? a.loadUnpacked : async () => ({ ok: false, error: "loadUnpacked not wired" });
  const reloadAll = typeof a.reloadAll === "function" ? a.reloadAll : async () => ({ ok: false, error: "reloadAll not wired" });

  return protocol.handle("idiotbox", async (request) => {
    let url = null;
    try {
      url = new URL(request.url);
    } catch {
      return textResponse("Bad request", 400);
    }
    const method = String(request.method || "GET").toUpperCase();
    // With `standard: true`, idiotbox://extensions/... parses like http(s):
    // hostname === "extensions", pathname === "/..." .
    const host = String(url.hostname || "").toLowerCase();
    const pathname = url.pathname || "/";

    if (host !== "extensions") return textResponse("Not found", 404);

    // ── Page ──────────────────────────────────────────────────────────
    if (pathname === "/" || pathname === "") {
      if (method !== "GET" && method !== "HEAD") return textResponse("Method not allowed", 405);
      try {
        const html = await fs.promises.readFile(EXTENSIONS_PAGE_FILE, "utf8");
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      } catch (err) {
        console.error("[ibx-pages] failed to read extensions page:", (err && err.message) || err);
        return textResponse("Extensions page missing", 500);
      }
    }

    // ── JSON API (same host ⇒ same origin, no CORS needed) ───────────
    try {
      // GET /api/list → { ok, extensions: [{ id, name, version, description, enabled, icons?... }] }
      if (pathname === "/api/list") {
        if (method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        const result = await listExtensions();
        if (result && typeof result === "object" && typeof result.ok === "boolean") {
          if (!result.ok) return jsonResponse(result, errorStatus(result.error, 500));
          const exts = Array.isArray(result.extensions) ? result.extensions : [];
          return jsonResponse({ ok: true, extensions: exts });
        }
        const exts = Array.isArray(result) ? result : [];
        return jsonResponse({ ok: true, extensions: exts });
      }

      // GET /api/details?id= → { ok, details }
      if (pathname === "/api/details") {
        if (method !== "GET") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        const id = url.searchParams.get("id");
        if (!id) return jsonResponse({ ok: false, error: "Missing ?id=" }, 400);
        return passThrough(await getDetails(id), "details");
      }

      // POST /api/enable { id, on } → { ok }
      if (pathname === "/api/enable") {
        if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        const body = await readJsonBody(request);
        if (typeof body.id !== "string" || !body.id) {
          return jsonResponse({ ok: false, error: "Missing string field: id" }, 400);
        }
        return passThrough(await setEnabled(body.id, !!body.on));
      }

      // POST /api/uninstall { id } → { ok }
      if (pathname === "/api/uninstall") {
        if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        const body = await readJsonBody(request);
        if (typeof body.id !== "string" || !body.id) {
          return jsonResponse({ ok: false, error: "Missing string field: id" }, 400);
        }
        return passThrough(await uninstall(body.id));
      }

      // POST /api/load-unpacked {} → host opens the folder dialog itself
      if (pathname === "/api/load-unpacked") {
        if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        await readJsonBody(request); // drain; no fields required
        return passThrough(await loadUnpacked());
      }

      // POST /api/reload {} → host re-checks / re-loads enabled extensions
      if (pathname === "/api/reload") {
        if (method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        await readJsonBody(request); // drain; no fields required
        return passThrough(await reloadAll());
      }
    } catch (err) {
      console.error("[ibx-pages] api handler failed:", (err && err.message) || err);
      return jsonResponse({ ok: false, error: String((err && err.message) || err).slice(0, 300) }, 500);
    }

    return textResponse("Not found", 404);
  });
}

module.exports = { registerIbxPages, EXTENSIONS_PAGE_FILE, IDIOTBOX_SCHEME_PRIVILEGES };
