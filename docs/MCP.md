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

## Tools

### IDE & project

| Tool | Description |
| --- | --- |
| `ide_status` | Active project, recent/pinned projects, version, platform, channel count |
| `project_open` | Open a folder as the active project |
| `project_scan` | Framework detection + page/component file tree (Canvas scan) |
| `editor_open_file` | Open a file in the editor (creates or focuses an editor tab) |
| `tab_open` | Open any tab or tool panel: terminal, browser, git, problems, ports, output, runDebug, canvas, openPencil, androidEmulator, extensions, componentPreview, community, settings, or file |
| `tabs_list` | List all open tabs with their id, component type, name, file path/url, and active status |
| `tab_close` | Close an open tab by tabId, title/name, or file path |
| `tab_select` | Focus / switch to an open tab by tabId, title/name, or file path |
| `settings_open` | Open the Settings window (general, editor, terminal, ai, appearance, etc.) |

### Browser

These tools drive the **real Idiot Box browser panel** through the Chrome DevTools
Protocol. The agent uses the same cookies, saved logins and extensions as the panel
you see on screen — there is no second, isolated browser.

| Tool | Description |
| --- | --- |
| `browser_open` | Open a browser panel and optionally navigate it; returns its `webContents` id |
| `browser_tabs` | List open browser panels with id, URL, title and focus state |
| `browser_navigate` | Navigate the panel to an http(s) URL and wait for the load |
| `browser_read` | Read the page title, URL and visible text |
| `browser_snapshot` | Accessibility snapshot of clickable/readable elements with `e1`, `e2`, … refs |
| `browser_click` | Click an element by snapshot ref using real mouse events |
| `browser_type` | Focus an element by ref and type text (optionally replacing existing text) |
| `browser_press` | Press Enter, Tab, Escape, arrows and other named keys |
| `browser_scroll` | Scroll by a pixel delta |
| `browser_screenshot` | Capture the panel as a PNG image |
| `browser_eval` | Evaluate a JavaScript expression in the page |
| `browser_wait` | Wait for a selector or text to appear |
| `browser_back` / `browser_forward` / `browser_reload` | Browser history and reload |

Refs from `browser_snapshot` belong to that page and expire after navigation or a
new snapshot. Call `browser_snapshot` again after a page change. If DevTools is
open for the browser panel, close it before using these tools — Electron allows
only one debugger attachment per `webContents`.

### Files

| Tool | Description |
| --- | --- |
| `file_list` | List a directory |
| `file_read` | Read a text file |
| `file_write` | Create/overwrite a file (makes parent folders) |
| `file_create` | New file or folder |
| `file_rename` | Rename in place |
| `file_delete` | Delete (Recycle Bin by default, `permanent` to bypass) |
| `file_find` | Fuzzy filename search |
| `file_search` | Full-text search across the project |

### Git

`git_status`, `git_diff` (staged/file/whole tree), `git_log`, `git_branches`,
`git_stage` / `git_unstage` (paths or `["*"]`), `git_commit` (with `amend`),
`git_push`, `git_pull`, `git_fetch`, `git_init`, `git_create_branch`, `git_switch_branch`

### Shell & dev servers

| Tool | Description |
| --- | --- |
| `shell_exec` | Run a command in a real PTY, returns output + exit code (timeout aware) |
| `ports_list` | Listening ports, including terminal-sniffed dev servers |
| `live_server_start` | Start the static live-reload preview server, returns its URL |

### Extensions

`extensions_list`, `extension_commands`, `extension_invoke` (run by command id),
`extension_views`, `extension_status_items`

### Notebooks

`notebook_execute` (persistent Python kernel), `notebook_restart`

### Android emulator

`android_state`, `android_list_avds`, `android_start_avd`, `android_stop_avd`,
`android_screenshot`, `android_input` (tap/swipe/key/text/rotate), `android_install_package`

### AI & agents

| Tool | Description |
| --- | --- |
| `ai_ask` | One-shot question to the built-in keyless Hub assistant |
| `opencode_start` / `opencode_stop` | Lease the per-project OpenCode agent server |
| `runtime_ensure` | Install the on-demand runtime tool (mise) |

### Resource

- `idiotbox://project-structure` — Canvas scan of the open project as JSON.

## Architecture
  
`electron/main/mcp-server.js` hosts the HTTP transport (official
`@modelcontextprotocol/sdk`) and translates tools onto the app's existing IPC surface.
`electron/main/ipc-invoke.js` captures every `ipcMain.handle` registration at boot, so MCP
tools call **the exact same handlers** the renderer uses — behaviour always matches the UI,
with no duplicated logic. Tools that need the UI (opening tabs, project switching) are handed
the main window's `webContents` as the event sender; everything else works headless.

The server starts in `app.whenReady()` and shuts down on `will-quit`.
