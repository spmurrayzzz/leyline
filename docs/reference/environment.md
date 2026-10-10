# Environment variables

Leyline reads the following supported environment variables. Provider and tool
variables come from the user's pi setup.

## App and session variables

| Variable | Purpose |
| --- | --- |
| `LEYLINE_DEV_SERVER_URL` | URL that Electron loads instead of its packaged server. `npm run electron:dev` sets `http://localhost:5173`. |
| `LEYLINE_PUBLIC_URL` | Base URL for Open Graph and Twitter metadata in HTML exports. A final slash is removed. |
| `LEYLINE_SERVER_HOST` | Host for the packaged Electron server. The default is `127.0.0.1`. Vite does not use this variable. |
| `LEYLINE_SERVER_PORT` | Port for the packaged Electron server. The default is `0`, which selects an available port. Vite does not use this variable. |
| `LEYLINE_SERVER_ALLOWED_ORIGINS` | Comma-separated frontend origins that can use the backend. Same-origin and loopback clients work without this variable. Use `*` to allow all origins. |
| `PI_CODING_AGENT_SESSION_DIR` | Session directory for discovery and new sessions. Leyline expands `~` and searches subdirectories for JSONL files. |
| `PI_CODING_AGENT_DIR` | Pi agent directory resolved by the SDK. Global provider/model/MCP configuration and native credentials use this directory. The default is `~/.pi/agent`. |
| `PI_ENABLE_CREATE_GOAL` | Set to `1` to expose the goal extension's `create_goal` model tool. |
| `LEYLINE_MEMORY_DIR` | Directory for shared app metadata and pasted-image attachments. Backend connections, display and file-editor settings, memory, rollout feedback, subagent overrides, and vision overrides use `memory.sqlite` in this directory. Vision delegation uses its `attachments` subdirectory. |
| `SHELL` | Login shell used by Electron environment loading and the terminal backend. Electron falls back to the account shell; the terminal has additional shell fallbacks. |

Without `PI_CODING_AGENT_SESSION_DIR`, Leyline uses the session directory from
pi settings for the selected project.

Use an absolute path for `LEYLINE_MEMORY_DIR`. Without this variable, Leyline uses:

```text
~/.local/share/leyline/memory.sqlite
~/.local/share/leyline/attachments/<session-id>/
```

The database can contain the `backend_connections`, `leyline_settings`, `memories`, `rollout_feedback`, `subagent_overrides`, and `vision_overrides` tables.

The `leyline_settings` table contains the default backend ID, display preferences, and file-editor settings.

Display and saved connections belong to the native app backend. Files, memory, feedback, and agent overrides belong to the selected backend. Each backend uses its own environment and storage directory. Agent defaults, Project settings, and Session details select global, project, and session override scopes within that backend.

Set `LEYLINE_SERVER_ALLOWED_ORIGINS` on a backend when a browser UI connects
from a different non-loopback origin. Separate origins with commas. Each value
must include its scheme and host. Add a port when the origin uses one.

Changing `LEYLINE_MEMORY_DIR` selects a different connection registry, default connection, and set of UI settings.

It also selects different memory, rollout, subagent, and vision metadata, plus the attachment directory for delegated pasted images.

The backend API does not have authentication. Do not bind the packaged server
to an untrusted network. The origin policy restricts browsers, but it does not
prevent direct network clients from sending requests.

## Pi configuration storage

Models & providers and MCP servers edit pi-owned global files on the selected backend. They do not use `LEYLINE_MEMORY_DIR` or move credentials into Leyline SQLite.

| File under the pi agent directory | Owner |
| --- | --- |
| `models.json` | Provider endpoints, custom model definitions, and catalog metadata overrides. Leyline edits only the supported fields. |
| `auth.json` | Provider credentials written through native `ModelRuntime` authentication. |
| `mcp.json` | Global MCP server configuration. |
| `mcp-auth.json` | Native MCP OAuth credentials. |
| `settings.json` | Pi preferences and installation settings. Leyline has no general editor for this file. Native login can persist installation data. |

The SDK resolves the agent directory through `getAgentDir()`, including `PI_CODING_AGENT_DIR`. A provider Settings target changes extension discovery context, not the global file destination. MCP Settings does not edit project `.pi/mcp.json` or extension registrations.

`models.json` permits line comments and trailing commas. `mcp.json` requires strict JSON. Configuration saves preserve unknown fields and symlink targets and reject stale revisions. See [Pi Settings routes](./api#pi-settings-routes) for accepted fields, secret omissions, and errors.

Provider key references, MCP header/environment values, and secret commands resolve on the selected backend. Saved values are not copied from the browser's native backend. Setting `LEYLINE_MEMORY_DIR` does not relocate pi configuration or change the selected backend's process environment.

Changing provider configuration does not refresh open conversation catalogs. Reload affected sessions explicitly after active work finishes. Settings refresh and Home preview refresh use separate runtimes. See [Provider runtime ownership](../developer-guide/backend-api#provider-runtime-ownership).

## CLI variables

| Variable | Purpose |
| --- | --- |
| `LEYLINE_CWD` | Directory used by plain `leyline` instead of the current shell directory. It does not affect `leyline -n`. |
| `LEYLINE_APP` | macOS: app bundle instead of `/Applications/Leyline.app`. With the documented Linux launcher: executable instead of `~/.local/opt/leyline/Leyline`. |

On macOS, if the app bundle does not exist, the CLI checks the repository path
`release/Leyline-darwin-arm64/Leyline.app`. The
[Linux launcher](../getting-started/linux-installation#_3-add-the-cli-launcher)
requires an executable path and has no repository fallback.

## Documentation variable

| Variable | Purpose |
| --- | --- |
| `VITEPRESS_BASE` | Base path for the VitePress build. The default is `/docs/`. |

Check both the default and deployment base paths:

```bash
npm run docs:build
VITEPRESS_BASE=/leyline/ npm run docs:build
```

## Capture variables

| Variable | Command | Default |
| --- | --- | --- |
| `SCREENSHOT_URL` | `npm run screenshot` | `http://localhost:5173/` |
| `SCREENSHOT_PATH` | `npm run screenshot` | `screenshots/current.png` |
| `DOCS_SCREENSHOT_URL` | `npm run docs:screenshots` | `http://localhost:5173/` |
| `DOCS_SCREENSHOT_FILTER` | `npm run docs:screenshots` | Empty: capture all fixtures. Otherwise, use comma-separated output basenames. |
| `VIDEO_URL` | `npm run video` | `http://localhost:5173/` |
| `VIDEO_PATH` | `npm run video` | `screenshots/walkthrough.webm` |
| `VIDEO_DIR` | `npm run video` | `screenshots/videos` |
| `VIDEO_WIDTH` | `npm run video` | `1503` |
| `VIDEO_HEIGHT` | `npm run video` | `818` |
| `VIDEO_INPUT` | `npm run video:mp4` | `screenshots/walkthrough.webm` |
| `VIDEO_MP4_PATH` | `npm run video:mp4` | `screenshots/walkthrough.mp4` |

The live screenshot viewport is fixed at 1503 by 818 CSS pixels with a device
scale factor of 2. Documentation captures use fixed desktop, mobile, and README
viewports. A filter such as `composer-queue.png,activity.png` selects matching basenames in either output directory.

See [Screenshots and video](../developer-guide/screenshots-and-video) for mocked coverage, model requirements, and focused Ultrafast and System captures.

## Internal variables

Do not set these variables as user configuration.

| Variable | Owner |
| --- | --- |
| `LEYLINE_SERVER_URL` | The local Leyline server sets its URL for the bundled subagent and vision-agent extensions. |
| `PI_CODING_AGENT` | The pi runtime integration sets this to `true` when it is absent. |

## Shell environment

The browser workflow inherits the environment that starts Vite. Electron loads
the login-shell environment before it creates the first window on macOS and
Linux. Electron uses that shell's `PATH` and adds missing provider and tool
variables. On Linux, this runs the interactive login startup files that a
desktop entry does not. For Bash, `~/.bashrc` applies when the login profile
sources it.
