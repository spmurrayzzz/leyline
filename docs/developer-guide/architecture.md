# Architecture

Leyline has one Vue frontend and two server startup paths. Both paths use the same backend modules and pi runtime integration.

## Browser and Vite flow

`npm run dev` starts Vite at `http://localhost:5173/`. `vite.config.js` loads the Vue plugin, the VitePress middleware, and `piApi()`.

The `piApi()` plugin mounts runtime routes at `/api/pi`. It mounts native app routes at `/api/leyline`.

The plugin also attaches the runtime, Git review, and terminal WebSocket servers to the Vite HTTP server.

The browser loads the Vue app from Vite. The native backend uses the same
origin. A window can select another saved backend for runtime HTTP commands,
runtime and Git review events over WebSockets, terminal WebSocket traffic, and exports. Connection management and app settings stay on the native backend.

## Electron development flow

`npm run electron:dev` sets `LEYLINE_DEV_SERVER_URL=http://localhost:5173` and starts Electron. Start Vite before Electron.

Electron loads the Vite URL into a `BrowserWindow`. The Vite process owns the backend and all runtime handles in this flow.

The renderer has context isolation enabled and Node.js integration disabled.
Electron sends native commands through browser `CustomEvent` objects. The main
process validates renderer-opened workspace URLs before it creates a foreground
`BrowserWindow`. It sends other openable links to the system browser.

## Packaged Electron flow

A packaged app does not start Vite. `electron/main.js` starts one utility process through `electron/leyline-server-process.js`. That process runs `server/leyline-server.js`, the pi runtimes, and backend storage. The main process owns windows and supervises backend startup and exit.

By default, the server listens on an ephemeral loopback port. The server host
and port environment variables can change this address. It serves `dist/`,
routes `/api/pi/*` and `/api/leyline/*`, and attaches the runtime, Git review,
and terminal WebSocket servers.

All Electron windows load the same native server. A window can select another
saved backend without changing the active backend in other windows.

Electron uses a single-instance lock. A `leyline -n` request opens the home
workspace in another window in the first Electron process. It does not create a
pi session.

## Backend boundaries

`server/pi-api/index.js` creates one backend runtime and exports the Vite and
standalone server adapters. `server/pi-api/router.js` handles HTTP routing.

`server/pi-api/runtime.js` owns pi sessions and runtime handles. Other backend
modules own DTOs, events, storage, export, filesystem access, Git review, and
the terminal.

`server/pi-api/tracing.js` owns the embedded Elune store, capture bindings, and backend capture configuration. `tracing-routes.js` exposes summary, detail, bookmark, and configuration operations. See [Elune integration](../integrations/elune).

`src/lib/pi-api.js` is the frontend HTTP client. `useRuntimeEvents.js` owns the
runtime WebSocket through `src/lib/event-socket.js`. Git review uses the same
socket client on a separate connection. `useTerminal.js` owns the separate
terminal WebSocket.

Runtime and Git review WebSockets replace server-sent events (SSE) in API v2. These connections avoid
the browser's HTTP/1.1 limit of six connections per origin across tabs. Other
browser connection limits still apply. HTTP commands, file transfers, and the
terminal protocol do not change. Both frontend and backend must use API v2.
There is no HTTP SSE fallback.

See [Realtime events](./realtime-events).

## Backend connections, app settings, and transport routing

`server/backend-connections.js` stores named connections, the default connection, app settings, and pinned session IDs. Its routes use `/api/leyline` on the native backend.

`src/composables/useBackendConnections.js` loads the registry and keeps the active connection ID in window `sessionStorage`.

Saved definitions and the default are app-wide. The active connection is window-specific.

`src/composables/useTranscriptPreferences.js` loads the thought display default from the native backend. All windows use this app-wide setting.

`src/composables/usePinnedSessions.js` loads pinned session IDs for the active backend connection. Individual pin, unpin, and prune operations are atomic at the record level. Windows refresh their pin state when they regain focus.

`src/lib/backend.js` supplies URLs for runtime HTTP, Git review, runtime and review
WebSockets, terminal WebSocket, and export requests. The native backend uses the current
app origin. Saved connections can use hostnames, IPv4 or IPv6 addresses, ports,
and base paths.

Electron passes the source window's connection ID when it creates a window. A
backend target supplies its selected connection ID instead. A fresh window uses
the configured default. `GET /api/pi/info` verifies the
backend name and API version before Leyline switches to it. The response also
reports transport capabilities.

`server/pi-api/cors.js` applies one origin policy to pi HTTP routes, native app routes, and runtime, Git review, and terminal WebSocket upgrades.

`server/pi-api/git-review.js` reads status and per-file diffs from the selected
backend's filesystem. The review API does not change Git state.

Same-origin and loopback clients work by default. Other frontend origins must be listed in `LEYLINE_SERVER_ALLOWED_ORIGINS`.

### Live network access

`server/network-access.js` owns a separate TCP listener for native-backend sharing. Both Vite and `startLeylineServer()` configure it against the existing origin. The listener binds `0.0.0.0` on the configured port, or port `0` for automatic selection. HTTP, runtime and Git review WebSockets, terminal WebSockets, and Vite HMR pass through unchanged.

Switch and port changes never restart or rebind the origin, change the local app URL, or replace runtime handles. Disabling sharing or changing the active port closes only the old relay and its connections. Remote terminal processes end when their WebSockets close. Agent runs and local clients continue.

`GET` and `PUT /api/leyline/network-access` report and change the listener. The switch sends only `{ enabled }`. **Proxy port → Apply** sends only `{ port }`. The serialized operation resolves omitted values from current state, so a port change cannot replay a stale switch value from another client.

A port change binds the replacement and saves both settings before closing the old listener. Bind or persistence failures preserve the previous listener and settings. Selecting the current automatic port as a fixed port keeps the existing listener. Self-disable and self-port-change requests retain their connection long enough to return a response. Backend shutdown disposes relay resources.

`server.network_access` and `server.network_access_port` restore sharing and its configured port at startup. Status separates the actual `port` from `configuredPort`, which is `0` for automatic selection. Automatic ports can change after re-enabling or restarting. Fixed ports remain saved. Explicit origin host and port options stay authoritative. `directAccess` warns when origin configuration creates a separate access path.

Vite sets `LEYLINE_SERVER_URL` from the actual local origin address at startup. Remote request Host headers never replace it, so child-runtime callbacks stay independent of sharing.

## Settings surfaces and ownership

Settings and trace surfaces use distinct owners and storage:

| Surface | Owner and storage |
| --- | --- |
| Display and Connections | Native app backend, in Leyline SQLite. Connections includes live network access for that native backend. The active connection remains per window. |
| Files | Selected backend, with editor values in `leyline_settings`. |
| Certificates | Selected backend, with CA file paths and the system-store preference in `leyline_settings`. |
| Agent defaults | Selected backend, with global subagent models, batch size, vision overrides, and automatic-title settings in SQLite. |
| Runtime | Selected backend, with the backend-wide idle timeout in SQLite. |
| Models & providers | Selected backend's pi global `models.json` and native provider authentication. |
| MCP servers | Selected backend's pi global `mcp.json` and native MCP authentication. |
| Project settings | Selected backend, with project overrides and project/session metadata. |
| Session details | Selected backend, with session overrides and read-only runtime/session metadata. |
| Trace capture and views | Selected backend, with `tracing.enabled` in `memory.sqlite` and trace records in `elune/elune.db`. |

Trace capture controls live in the trace footer, not a global Settings category.

Runtime, Certificates, Models & providers, and MCP servers require the backend capability `piSettings`. Provider targets select a cwd for extension discovery. They do not change global file ownership. The modal does not contain Global/Project/Session scope tabs.

Provider settings use separate leased SDK runtimes. MCP management uses disposable native workers. Neither path silently refreshes conversation catalogs or reloads active sessions. See [Pi Settings](./backend-api#pi-settings) for lifecycle and authentication routing rules, and [Frontend state](./frontend-state#settings-surfaces) for UI ownership.

## Runtime handles and active selection

Leyline creates an `AgentSessionRuntime` when it activates a persisted session. The runtime owns the current `AgentSession` and its cwd-bound services.

A server runtime handle contains:

- the `AgentSessionRuntime`
- the session ID
- the runtime-event unsubscribe function
- the projected extension UI state

`runtimeHandles` keeps handles by session ID. `runtimeHandlePromises` prevents duplicate activation work for the same session.

Handles remain available after the user selects another session while active work or other protections apply. Unobserved idle handles are eligible for disposal after the backend-wide timeout, which defaults to 5 minutes. `0` disables cleanup. The maximum is 1440 minutes.

A 15-second sweep protects active work, pending tasks and approvals, lifecycle operations, and sessions observed through a matching `sessionId` runtime WebSocket. Compact background snapshots and the legacy active selection alone do not protect a handle.

Disposal shuts down extensions and MCP resources and emits `runtime_removed`, without deleting history. Lightweight process-local state retains the branch, model, thinking level, exact service tier, and unsaved manager when necessary. Premium restoration requires the same provider/model, current eligibility, and the service-tier command. Reopening or a scoped action rebuilds services and connections. See [Idle runtime cleanup](./backend-api#idle-runtime-cleanup) for the full protection and restoration rules.

`activeHandle`, `activeRuntime`, and `activeSessionId` identify the process-wide active session. Legacy routes use this selection.

Scoped session routes and Leyline terminal connections resolve a handle by session ID. Use scoped routes for prompt, shell, compaction, edit, interrupt, reload, model, thinking, and service-tier operations.

Active session selection is process-wide within one backend. Two windows that use the same backend can change all legacy active-session routes. Their terminal connections remain independent. Windows that use different backends do not share this selection.

## Session storage and projection

Pi sessions are tree-structured JSONL files. The default directory is `~/.pi/agent/sessions/--encoded-cwd--/`, not the project working directory.

`PI_CODING_AGENT_SESSION_DIR` overrides session discovery and creation. Otherwise, Leyline uses pi's configured `sessionDir` or pi's default directory.

Session discovery reads JSONL files with a bounded worker pool. It caches summaries by file modification time and size and combines concurrent list requests.

Persisted summaries use the latest user or assistant message time for ordering. Session names come from the latest `session_info` entry.

Automatic titles use a separate, bounded model request beside the first accepted conversation request. They do not change the conversation model or append an assistant reply. A valid title uses native `setSessionName()`. Full and compact runtime snapshots carry the current `session` summary and separate `titleGenerating` flag. See [Automatic session titles](./backend-api#automatic-session-titles).

Normal session changes use pi session and runtime methods. Transcript detail opens the file with `SessionManager.open(path)` and reads `getBranch()`.

Leyline projects the branch through `lib/transcript-projection.js`. The same projected DTO supplies the browser transcript and HTML export.

`lib/research-state.js` folds session-ID-bound `leyline-research` entries from the active branch. Session summaries keep compact phase and count data. Detail and runtime DTOs keep the complete research state.

## Session lineage and child agents

A parent session path records lineage for forks and subagent sessions. The parent path alone does not identify a subagent session.

New subagent and vision-child sessions contain a `leyline-subagent-session` custom entry. The entry records the child session ID and parent session path.

Session discovery uses this explicit marker. It also has a compatibility fallback that finds child paths in parent `subagent` tool results.

Deep research uses the same child-session runtime path. A reserved researcher definition enables all tools discovered by the child runtime except `write` and `edit`. Its prompt prohibits file changes through other tools.

Vision delegation adds `leyline-vision-delegation` records to the parent branch. A session context transform replaces image blocks with saved file paths and a `vision_agent` instruction. This applies when the parent model cannot receive images. After matching tool calls exist, the transform uses neutral context text. It does not request another inspection. The persisted user message keeps the images.

Pasted delegated images are stored in `LEYLINE_MEMORY_DIR/attachments/<session-id>/`. Without `LEYLINE_MEMORY_DIR`, the path is `~/.local/share/leyline/attachments/<session-id>/`. The session and project trash operations remove the related attachment directory after they move the JSONL file.

Forks use `AgentSessionRuntime.fork(entryId, { position: 'at' })`. A fork gets a new JSONL file and keeps normal session visibility. It copies session-level subagent model, batch-size, and vision-model overrides.

A research fork replays the retained branch state as events bound to the new session ID. The backend revalidates a retained report before it marks the fork complete.

## Rename, delete, and reset

Rename appends session information through pi. It changes the displayed session name and does not rename the JSONL file.

Delete moves the JSONL file to Leyline trash. The path is `<session-root-parent>/leyline-trash/<timestamp>/<relative-session-path>`.

Reset to here is destructive. The backend retains the session header and active branch through the selected entry, then rewrites the same JSONL file.

Reset removes later entries and other branches from that file. It does not create a backup or a new session.

## SQLite metadata

Leyline uses Node.js `DatabaseSync` for app metadata. The default database is
`~/.local/share/leyline/memory.sqlite`.

The database currently contains these application tables:

- `backend_connections`
- `leyline_settings`
- `pinned_sessions`
- `memories`
- `rollout_feedback`
- `subagent_overrides`
- `subagent_batch_overrides`
- `vision_overrides`

`backend_connections` stores named backend URLs. `leyline_settings` stores the default connection ID, display preferences, `server.network_access`, `server.network_access_port`, and backend file-editor settings. It also stores `subagents.batch_size`, `session_titles.enabled`, `session_titles.model`, `session_titles.thinking`, `runtime.idle_timeout_minutes`, `tls.extra_ca_files`, `tls.use_system_ca`, and `tracing.enabled`. `pinned_sessions` stores sidebar pin IDs by backend connection.

The app reads connection records, display preferences, network-access state, and pinned sessions from the native backend. Files, memory, feedback, agent overrides, automatic-title settings, runtime cleanup settings, and certificate trust use the selected backend's database. Native and selected backends can be the same process.

`subagent_overrides` and `vision_overrides` supply Agent defaults, Project settings, and Session details. Their global scope means all projects on that backend. It does not mean all saved backend connections. Vision model and thinking fields inherit independently.

`subagents.batch_size` supplies the global batch size, defaulting to 4. `subagent_batch_overrides` supplies session values only. There is no project batch-size override. Forks copy session values, and session/project deletion removes values for the deleted sessions. Canonical path hashes retain session identity through symlinked directories, including before the session file exists.

The subagent extension schedules implicit single-call groups and explicit parallel calls independently. Batch size does not limit total concurrent work across a session or backend. See [Subagent scheduling](../integrations/subagents#batch-scheduling-and-configuration).

Pi provider/model configuration, MCP configuration, and native credentials do not use SQLite. They remain in the pi agent directory. See [Pi configuration storage](../reference/environment#pi-configuration-storage) for file ownership and environment boundaries.

Memory, subagent, and vision scopes use canonical project roots and hashed scope IDs. Rollout feedback uses the cwd, session path, session ID, and entry ID.

These modules honor `LEYLINE_MEMORY_DIR`. When set, they use `memory.sqlite` in
that directory. Elune records use a separate `elune/elune.db` under the same data directory. One lazy worker per backend owns that database. Trace records do not use the pi session directory.

## Bundled extensions and prompt

Normal runtimes load output-budget, ultrafast, memory, subagent, research, and vision-agent from `.pi/extensions/`. They load the inline Elune capture factory from `@elune/embedded/pi` and append `.pi/LEYLINE_SYSTEM.md` to the system prompt.

Bundled conflict filtering removes other extensions with matching names or designated commands and tools. The service-tier extension stays in `.pi/extensions/ultrafast/` and runs last, after other provider hooks. It owns runtime-local Standard/Fast/Ultrafast state and publishes `leyline-service-tier`, with legacy `leyline-ultrafast` compatibility.

`lib/ultrafast.js` defines explicit model and authentication eligibility. Model DTOs expose `serviceTiers`. The renderer selects a tier through the session-scoped `service-tier` route and reads the resulting extension status.

Standard is the default. Model changes, explicit reloads, and reset navigation select Standard. New forks start Standard. Same-runtime, same-model retries and edits retain the exact tier.

The shared runtime uses `AsyncLocalStorage` to identify each provider request. The extension's `WeakMap` binds payload, header, and cost handling to that request's model, signal, and tier snapshot. Compaction and branch summaries receive no premium overrides. Both premium tiers stop cache warming.

Public cleanup and cost functions resolve from the coding-agent package's own `pi-ai` dependency. Connection cleanup includes Standard-to-Standard model switches. Browser/Vite and packaged Electron use this same runtime and extension path. Packaged execution stays in the backend utility process, not the Electron main process.

Normal runtimes also load pi's native MCP and tool-search extensions. Leyline excludes `codemode`. See [Runtime construction](./backend-api#runtime-construction) and [Service tiers](./backend-api#service-tiers) for the loading, request, and cost contracts.

A new research session gets its marker before extension binding. The research extension exposes `research_update` only when the active branch contains a marker for that session ID.

Children with an isolated custom system prompt retain the bundled output-budget extension and inline Elune capture. They omit context files, skills, MCP, tool search, and the Leyline prompt. Vision children use this path with no active tools. A session-local settings override permits image input without changing the user's persisted pi image setting.

Reload creates replacement cwd-bound services. It then binds the new session, extensions, event subscription, and extension UI state to the existing handle.

The research extension stores objective, plan, phase, thread, source, report, and error entries. Citation checks require numbered report links to match non-excluded ledger sources.

Runtime WebSocket updates carry research and extension UI changes to `App.vue`. The workbench uses this state for controls, progress, source navigation, and session titles.

## Terminal boundary

`server/pi-api/terminal.js` handles WebSocket upgrades at `/api/pi/terminal`. It starts one `node-pty` process per connection.

The renderer supplies the selected session ID. The backend resolves that runtime handle without changing the active runtime.

Requests without a session ID use the active runtime CWD for compatibility. Closing the browser terminal connection kills that PTY.

Packaged builds unpack native `node-pty` files. On macOS, the server also repairs the `spawn-helper` executable bit when necessary.
