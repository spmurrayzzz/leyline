# Environment variables

Leyline reads the following supported environment variables. Provider and tool
variables come from the user's pi setup.

## App and session variables

| Variable | Purpose |
| --- | --- |
| `LEYLINE_DEV_SERVER_URL` | URL that Electron loads instead of its packaged server. `npm run electron:dev` sets `http://localhost:5173`. |
| `LEYLINE_PUBLIC_URL` | Base URL for Open Graph and Twitter metadata in HTML exports. A final slash is removed. |
| `LEYLINE_SERVER_HOST` | Origin host for the packaged Electron server. The default is `127.0.0.1`. The network-access toggle does not change this binding. Vite does not use this variable. |
| `LEYLINE_SERVER_PORT` | Origin port for the packaged Electron server. The default is `0`, which selects an available port. Set the separate sharing port through **Settings → Connections → Proxy port**. Vite does not use this variable. |
| `LEYLINE_SERVER_ALLOWED_ORIGINS` | Comma-separated frontend origins that can use the backend. Same-origin and loopback clients work without this variable. `*` allows all origins for standard API CORS checks. Dictation requires exact origins. |
| `PI_CODING_AGENT_SESSION_DIR` | Session directory for discovery and new sessions. Leyline expands `~` and searches subdirectories for JSONL files. |
| `PI_CODING_AGENT_DIR` | Pi agent directory resolved by the SDK. Global provider/model/MCP configuration and native credentials use this directory. The default is `~/.pi/agent`. |
| `LEYLINE_MEMORY_DIR` | Backend data directory. App metadata, certificate trust, and dictation settings use `memory.sqlite`. Dictation models use `dictation/models/`. Embedded trace records use `elune/elune.db`. Vision delegation uses `attachments/<session-id>/`. |
| `SHELL` | Login shell used by Electron environment loading and the terminal backend. Electron falls back to the account shell; the terminal has additional shell fallbacks. |

Without `PI_CODING_AGENT_SESSION_DIR`, Leyline uses the session directory from
pi settings for the selected project.

Use an absolute path for `LEYLINE_MEMORY_DIR`. Without this variable, Leyline uses:

```text
~/.local/share/leyline/memory.sqlite
~/.local/share/leyline/attachments/<session-id>/
~/.local/share/leyline/dictation/models/
~/.local/share/leyline/elune/elune.db
```

The database can contain the `backend_connections`, `leyline_settings`, `pinned_sessions`, `memories`, `rollout_feedback`, `subagent_overrides`, `subagent_batch_overrides`, and `vision_overrides` tables.

The `leyline_settings` table contains the default backend ID, display preferences, `server.network_access`, `server.network_access_port`, and file-editor settings. It also contains `subagents.batch_size`, `session_titles.enabled`, `session_titles.model`, `session_titles.thinking`, `runtime.idle_timeout_minutes`, `tls.extra_ca_files`, `tls.use_system_ca`, and `tracing.enabled`. The `pinned_sessions` table contains sidebar pin IDs scoped by backend connection.

Display, network access, saved connections, and pinned sessions belong to the native app backend. Files, memory, feedback, agent overrides, automatic-title settings, runtime cleanup settings, and certificate trust belong to the selected backend. Each backend uses its own environment and storage directory. Agent defaults, Project settings, and Session details select global, project, and session override scopes within that backend.

Automatic titles default to off, with an empty model and thinking value. An empty thinking value selects the title model's lowest supported level. Runtime cleanup defaults to 5 minutes. Integers from 0 through 1440 are valid, and 0 disables cleanup. These settings are backend-wide, with no project or session overrides. They use Leyline SQLite, not pi configuration files, and require no environment variables. See [Session-title settings](./api#session-title-settings) and [Runtime settings](./api#runtime-settings).

Subagent batch size defaults to 4 on each backend. `subagent_batch_overrides` stores session overrides. There is no project batch-size override. See [Batch configuration](../user-guide/subagents#configure-batch-size).

Set `LEYLINE_SERVER_ALLOWED_ORIGINS` on a backend when a browser UI connects
from a different non-loopback origin. Separate origins with commas. Each value
must include its scheme and host. Add a port when the origin uses one. For
example, use `https://ui.example.org`, without a path.

Browser local dictation sends microphone audio to the Leyline server that
serves the app. Its WebSocket accepts same-origin requests or exact origins
listed in `LEYLINE_SERVER_ALLOWED_ORIGINS`. Do not use `*` for dictation. Use
HTTPS for the browser app, or serve it from `localhost`, to allow microphone
access. See [Dictation](../user-guide/dictation).

For network sharing, use **Settings → Connections → Allow network access**. No environment variable is necessary. The switch defaults to off and persists as `server.network_access` in `memory.sqlite`.

Set **Proxy port** and select **Apply** for a fixed port. A blank field selects an available port automatically. The saved `server.network_access_port` value is `0` for automatic selection, or an integer from 1 through 65535. Both settings survive restarts.

Sharing uses a separate TCP listener on `0.0.0.0`. Switch and port changes apply immediately without changing the origin host, port, local clients, or running agents. Changing the active sharing port or turning sharing off disconnects remote clients. **Apply** does not enable or disable sharing.

Opening a sharing URL serves the app and API from the same origin, so no additional allowed-origin value is necessary. `LEYLINE_SERVER_ALLOWED_ORIGINS` still applies to a UI on another non-loopback origin.

Explicit origin host and port configuration remains authoritative. If that configuration exposes the origin, turning sharing off does not close origin access. Settings shows a notice. See [Network access](../user-guide/settings#share-the-native-backend).

Changing `LEYLINE_MEMORY_DIR` selects a different connection registry, default connection, set of UI settings, network-access settings, and set of pinned sessions.

It also selects different memory, rollout, subagent, vision, automatic-title, runtime cleanup, certificate trust, and dictation settings. Capture metadata, attachment and dictation model directories, and the embedded trace database also use that directory.

## TLS certificate trust

Settings → Certificates configures TLS trust on the selected backend. The trust store combines Node's bundled roots, startup environment certificates, optional operating-system roots, and saved custom PEM files. Leyline always keeps the bundled roots.

The setting applies to new backend Node TLS connections, including provider requests and provider/MCP management checks. Existing connections can remain open. It does not change Chromium networking, inbound server HTTPS, or the separate dictation process.

Set Node CA variables before the backend process starts. Restart Vite or Electron after startup CA variables or flags change. Saving Certificates settings applies without a restart.

| Variable | Purpose |
| --- | --- |
| `NODE_EXTRA_CA_CERTS` | PEM file that Node reads at process startup. Leyline adds these certificates to the trust store. The Certificates pane shows this source read-only. |
| `NODE_USE_SYSTEM_CA` | `1` enables operating-system roots when `tls.use_system_ca` is unset. Leyline also accepts `true` without case sensitivity. |
| `NODE_OPTIONS` | Use `--use-system-ca` to include operating-system roots when `tls.use_system_ca` is unset. |

The same fallback applies to a direct Node `--use-system-ca` startup flag. A saved system-store preference takes precedence over these startup options. It does not remove certificates from `NODE_EXTRA_CA_CERTS`.

The `leyline_settings` table in the selected backend's `memory.sqlite` stores these values:

| Key | Value |
| --- | --- |
| `tls.extra_ca_files` | JSON array of absolute PEM paths on that backend. The default is an empty list. |
| `tls.use_system_ca` | `"true"` or `"false"`. An unset value follows the startup system-CA options above. |
| `tls.extra_ca_file` | Legacy single-file fallback when the list has no paths. Save clears this value. |

Custom paths accept absolute paths or `~/` paths. The backend expands `~` to its own home directory. Save accepts at most 32 files, each at most 1 MiB. There are no project or session overrides.

SQLite stores paths and the system-store preference. The PEM files stay on that backend. Provider and MCP configuration and credentials stay in pi-owned files.

See [Certificate settings](./api#certificate-settings) for the GET/PUT contract and PEM validation rules.

## Embedded trace storage

Capture configuration and trace records belong to the selected backend. Display preferences and connection records still use the native app backend. Each backend resolves `LEYLINE_MEMORY_DIR` in its own process environment.

One lazy Elune worker owns `elune/elune.db` on that backend. The Elune directory uses private `0700` permissions. Its database, WAL, and shared-memory files use `0600`. The integration does not encrypt these files or guarantee complete secret redaction.

Capture defaults to enabled for new runs. Change it through the trace view controls or `PUT /api/pi/traces/config`. It is not a supported `/api/leyline/settings/:key` setting. There is no `PI_TRACE_URL` to configure for embedded capture and no external Elune service to start.

Existing standalone Elune records and pi JSONL history are not automatically imported. See [Elune integration](../integrations/elune) for content limits, legacy extension filtering, and errors.

The backend API does not have authentication. Do not bind the packaged server
to an untrusted network. The origin policy restricts browsers, but it does not
prevent direct network clients from sending requests.

## Pi configuration storage

Models & providers and MCP servers edit pi-owned global files on the selected backend. They do not use `LEYLINE_MEMORY_DIR` or move credentials into Leyline SQLite.

| File under the pi agent directory | Owner |
| --- | --- |
| `models.json` | Provider endpoints, custom model definitions, and catalog metadata overrides, including thinking maps and developer-role support. Leyline edits only the supported fields. |
| `models-store.json` | Pi's catalog cache. Draft reset recovery reads a snapshot into a separate in-memory store without changing this file. |
| `auth.json` | Provider credentials written through native `ModelRuntime` authentication. |
| `mcp.json` | Global MCP server configuration. |
| `mcp-auth.json` | Native MCP OAuth credentials. |
| `settings.json` | Pi preferences and installation settings. Leyline has no general editor for this file. Native login can persist installation data. |

The SDK resolves the agent directory through `getAgentDir()`, including `PI_CODING_AGENT_DIR`. A provider Settings target changes extension discovery context, not the global file destination. MCP Settings does not edit project `.pi/mcp.json` or extension registrations.

`models.json` permits line comments and trailing commas. `mcp.json` requires strict JSON. Configuration saves preserve unknown fields and symlink targets and reject stale revisions. See [Pi Settings routes](./api#pi-settings-routes) for accepted fields, secret omissions, and errors.

Provider key references, MCP header/environment values, and secret commands resolve on the selected backend. Saved values are not copied from the browser's native backend. Setting `LEYLINE_MEMORY_DIR` does not relocate pi configuration or change the selected backend's process environment.

Provider API keys are optional. Draft connection tests resolve the current form values on that backend without writing them to these files. Native OAuth token refresh remains a credential operation and can update `auth.json`.

Catalog lookup searches the selected backend's settings runtime cache. Explicit lookup Refresh reloads that runtime and requests a network catalog refresh. If the SDK refresh fails, lookup can return cached results with a warning. Lookup adds no environment variable or separate browser catalog.

Draft thinking-map and developer-role resets recover built-in defaults through a separate offline `ModelRuntime`, seeded from this backend's `models-store.json`. Recovery respects SDK catalog timestamps and never writes drafts, credentials, or the live cache.

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

See [Screenshots and video](../developer-guide/screenshots-and-video) for mocked coverage, model requirements, and focused service-tier, System, and trace captures.

## Internal variables

Do not set these variables as user configuration.

| Variable | Owner |
| --- | --- |
| `LEYLINE_SERVER_URL` | The local Leyline server sets its origin URL for the bundled subagent and vision-agent extensions. Sharing never replaces it with a relay URL or a remote request's Host header. |
| `PI_CODING_AGENT` | The pi runtime integration sets this to `true` when it is absent. |

## Shell environment

The browser workflow inherits the environment that starts Vite. Electron loads
the login-shell environment before it creates the first window on macOS and
Linux. Electron uses that shell's `PATH` and adds missing provider and tool
variables. On Linux, this runs the interactive login startup files that a
desktop entry does not. For Bash, `~/.bashrc` applies when the login profile
sources it.
