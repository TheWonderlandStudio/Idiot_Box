# MCP server — let AI drive Idiot Box

Idiot Box runs a built-in **MCP (Model Context Protocol) server** so external AI clients
(Claude Desktop, Cursor, opencode, or anything that speaks MCP) can inspect and control the IDE:
read/write files, run git, execute shell commands, open tabs, scan the project, drive the
Android emulator, and more.

## Endpoint

- URL: `http://127.0.0.1:39271/mcp` (Streamable HTTP)
- Binds to **loopback only**. Requests with a non-local `Host` or a foreign `Origin` are rejected (403).
- The port falls back to `39272`, `39273`, … (up to +20) if the preferred one is busy, then to an
  ephemeral port. Override the preferred port with the `IDIOT_BOX_MCP_PORT` environment variable.
- On every start the effective endpoint is written to
  `%APPDATA%/idiot-box/mcp.json` (macOS: `~/Library/Application Support/idiot-box/mcp.json`,
  Linux: `~/.config/idiot-box/mcp.json`):

  ```json
  {
    "name": "idiot-box",
    "url": "http://127.0.0.1:39271/mcp",
    "port": 39271,
    "pid": 12345,
    "startedAt": "2026-10-11T13:49:51.188Z",
    "tokenRequired": false
  }
  ```

- `GET http://127.0.0.1:39271/` returns a small JSON info document; the file is removed on a
  graceful quit.
- The server only runs while Idiot Box is running.

## Client configuration

### Claude Desktop

```json
{
  "mcpServers": {
    "idiot-box": {
      "url": "http://127.0.0.1:39271/mcp"
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "idiot-box": {
      "url": "http://127.0.0.1:39271/mcp"
    }
  }
}
```

### opencode (`opencode.json`)

OpenCode 1.19+ uses the `mcp.servers` shape:

```json
{
  "mcp": {
    "servers": {
      "idiot-box": {
        "type": "remote",
        "url": "http://127.0.0.1:39271/mcp"
      }
    }
  }
}
```

Idiot Box writes and refreshes this entry automatically when it starts the OpenCode
panel, so normally you do not need to edit the file by hand.

Any other client: point a **Streamable HTTP** MCP transport at that URL.

## Security

- Loopback-only listener; `Host`/`Origin` are validated against `127.0.0.1` / `localhost` / `[::1]`.
- Optional bearer auth: set `IDIOT_BOX_MCP_TOKEN` before launching Idiot Box — every `/mcp`
  request must then send `Authorization: Bearer <token>` (clients that can't add headers should
  not enable this).
- Tools run with the same powers as the IDE itself (full file access, shell, git). Only connect
  MCP clients you trust.
- Browser tools act inside your real browser panel, including sites where you are signed in.
  Page content is untrusted: do not let an agent follow instructions found on a website, and
  keep confirmation enabled for payments, posting, deleting or sending messages. For sensitive
  accounts, use a separate browser profile or a dedicated machine.

## Token economy

Tool list and tool output dominate LLM context cost. This server is deliberately lean:

- **13 grouped tools** (was 66): cost is paid once per tool definition, so 66 verbose
  schemas plus per-field descriptions would be re-charged on every turn. Groups share
  one schema and one `action` enum instead of repeating field descriptions per tool.
- No `title` fields and no per-field `.describe()` text — the field name plus the
  one-line tool description carry the meaning.
- Outputs are capped and compacted: per-call output is truncated to 8000 chars,
  long strings/arrays are shrunk, and list/search/diff results are projected down
  to the fields a model actually needs (relative paths, ids, short previews).
- Large reads are paged (file read uses `offset`/`limit` lines, default 500 lines)
  rather than returning whole files; page read defaults to 8000 chars and snapshot
  to 120 nodes, both raisable explicitly.

## Tools

Most tools take an `action` enum. Full parameter lists are in `electron/main/mcp-server.js`.

| Tool | Actions |
| --- | --- |
| `project` | `status`, `open` (path), `scan`, `settings` (page) |
| `file` | `list`, `read` (paged), `write`, `create`, `rename`, `delete`, `find`, `search` |
| `git` | `status`, `diff`, `log`, `branches`, `stage`, `unstage`, `commit`, `push`, `pull`, `fetch`, `init`, `branch_create`, `branch_switch` |
| `tabs` | `list`, `open`, `close`, `select`, `edit` (open file in editor) |
| `shell` | `command` (+ `cwd`, `timeoutMs`) — real PTY, capped output |
| `servers` | `list` (ports), `start` (live preview server) |
| `extensions` | `list`, `commands`, `invoke` (commandId+args), `views`, `status` |
| `notebook` | `execute` (code), `restart` |
| `android` | `state`, `avds`, `start`, `stop`, `screenshot`, `input`, `install` |
| `ai` | `prompt` (+ optional `system`) |
| `opencode` | `start`, `stop` (leaseId) |
| `runtime` | install the mise runtime |
| `browser` | `open`, `tabs`, `navigate`, `read`, `snapshot`, `click`, `type`, `press`, `scroll`, `screenshot`, `eval`, `wait`, `back`, `forward`, `reload` |

### Browser

These actions drive the **real Idiot Box browser panel** through the Chrome DevTools
Protocol. The agent uses the same cookies, saved logins and extensions as the panel
you see on screen — there is no second, isolated browser.

Workflow: `browser open` → `browser snapshot` (returns `e1`, `e2`, … refs) →
`browser click`/`browser type` with the ref. Refs belong to that snapshot and
expire after navigation or a new snapshot. If DevTools is open for the browser
panel, close it before using these actions — Electron allows only one debugger
attachment per `webContents`.

### Files

- `file read` is paged: `offset` is a 1-based line number, `limit` lines (default 500,
  max 2000). Continue with a larger offset to read the rest — no need to fetch
  whole files into context at once.
- `file list` returns names (with `/` for folders), searches return compact
  `path:line:preview` strings. Default `limit` for `find`/`search` is 30.
- `file delete` moves to the Recycle Bin unless `permanent: true`.

### Git

`git diff` honors `staged` / `filePath`; `git stage`/`unstage` accept `paths`
(`["*"]` = all). Output is truncated, so prefer diffing a single file for large
changes.

## Architecture

`electron/main/mcp-server.js` hosts the HTTP transport (official
`@modelcontextprotocol/sdk`) and translates tools onto the app's existing IPC surface.
`electron/main/ipc-invoke.js` captures every `ipcMain.handle` registration at boot, so MCP
tools call **the exact same handlers** the renderer uses — behaviour always matches the UI,
with no duplicated logic. Tools that need the UI (opening tabs, project switching) are handed
the main window's `webContents` as the event sender; everything else works headless.

The server starts in `app.whenReady()` and shuts down on `will-quit`.
