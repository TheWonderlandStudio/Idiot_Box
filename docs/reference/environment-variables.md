# Environment variables

## Runtime (app)

| Variable | Purpose |
|---|---|
| `IDIOT_BOX_MCP_PORT` | Preferred port for the MCP HTTP server (default 39271, +20 fallback) |
| `IDIOT_BOX_MCP_TOKEN` | Bearer token required for MCP requests when set |
| `OPENCODE_DB` | Override the OpenCode panel database path (default `<userData>/opencode/opencode.db`) |
| `DEVTUNNEL_CLI` | Override the `devtunnel` executable path |
| `IBX_PROTOCOL` | Deep-link protocol scheme (default `idiotbox`) |
| `ESBUILD_BINARY_PATH` | Fix-up for the packaged esbuild binary (set internally) |
| `JAVA_HOME` | Optional JDK hint for Android (the bundled Temurin 17 wins if present) |
| `ANDROID_SDK_ROOT` / `ANDROID_HOME` / `ANDROID_AVD_HOME` / `ANDROID_EMULATOR_HOME` | Android layout — set by the app itself under `<userData>/.appdata/android` |

## Build

| Variable | Purpose |
|---|---|
| `IBX_FORCE_BUILD` | Force the renderer build to skip its mtime cache (`build-renderer.cjs`) |

## Signing & packaging (electron-builder / release)

| Variable | Purpose |
|---|---|
| `CSC_LINK` | Windows Authenticode certificate (pfx path or base64 for CI) |
| `CSC_KEY_PASSWORD` | Password for the certificate |
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows-specific aliases |
| `APPLE_ID` | Apple ID for notarization (`build/notarize.cjs`) |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID for notarization |
| `CSC_IDENTITY_AUTO_DISCOVERY` | Set to `false` in CI for unsigned builds |
| `GH_TOKEN` | GitHub token for electron-builder publishing and release notes |
| `ELECTRON_BUILDER_NS_UUID` | Namespace for deterministic Windows ProgIDs (used by `print-progids.cjs`) |

## Release notes script (`.github/scripts/build-release-notes.cjs`)

| Variable | Purpose |
|---|---|
| `GITHUB_REF_NAME` | Release tag (e.g. `v0.1.32`) |
| `GITHUB_TOKEN` | GitHub API token |
| `RELEASE_NOTES_FILE` | Output path (default `release-notes.md`) |

Template for local signing setups: `.env.signing.example` (PowerShell dot-source or `set -a; source …`).
