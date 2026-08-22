# Architecture

Leyline has one Vue frontend and two server startup paths. Both paths use the same backend modules and pi runtime integration.

## Browser and Vite flow

`npm run dev` starts Vite at `http://localhost:5173/`. `vite.config.js` loads the Vue plugin, the VitePress middleware, and `piApi()`.

The `piApi()` plugin mounts runtime routes at `/api/pi`. It mounts native app routes at `/api/leyline`.

The plugin also attaches the terminal WebSocket server to the Vite HTTP server.

The browser loads the Vue app from Vite. The native backend uses the same
origin. A window can select another saved backend for runtime HTTP commands,
server-sent events (SSE), terminal WebSocket traffic, and exports. Connection management and app settings stay on the native backend.

## Electron development flow

`npm run electron:dev` sets `LEYLINE_DEV_SERVER_URL=http://localhost:5173` and starts Electron. Start Vite before Electron.

Electron loads the Vite URL into a `BrowserWindow`. The Vite process owns the backend and all runtime handles in this flow.

The renderer has context isolation enabled and Node.js integration disabled. Electron sends native commands through browser `CustomEvent` objects.

## Packaged Electron flow

A packaged app does not start Vite. `electron/main.js` starts `server/leyline-server.js` once in the Electron main process.

By default, the server listens on an ephemeral loopback port. The server host
and port environment variables can change this address. It serves `dist/`,
routes `/api/pi/*` and `/api/leyline/*`, and attaches the terminal WebSocket
server.

All Electron windows load the same native server. A window can select another
saved backend without changing the active backend in other windows.

Electron uses a single-instance lock. A `leyline -n` request creates another window in the first Electron process.

## Backend boundaries

`server/pi-api/index.js` creates one backend runtime and exports the Vite and
standalone server adapters. `server/pi-api/router.js` handles HTTP routing.

`server/pi-api/runtime.js` owns pi sessions and runtime handles. Other backend
modules own DTOs, events, storage, export, filesystem access, Git review, and
the terminal.

`src/lib/pi-api.js` is the frontend HTTP client. `useRuntimeEvents.js` owns the
SSE connection, and `useTerminal.js` owns the terminal WebSocket.

## Backend connections, app settings, and transport routing

`server/backend-connections.js` stores named connections, the default connection, and app settings. Its routes use `/api/leyline` on the native backend.

`src/composables/useBackendConnections.js` loads the registry and keeps the active connection ID in window `sessionStorage`.

Saved definitions and the default are app-wide. The active connection is window-specific.

`src/composables/useTranscriptPreferences.js` loads the thought display default from the native backend. All windows use this app-wide setting.

`src/lib/backend.js` supplies the base URL for runtime HTTP, Git review, SSE,
terminal WebSocket, and export requests. The native backend uses the current
app origin. Saved connections can use hostnames, IPv4 or IPv6 addresses, ports,
and base paths.

Electron passes the source window's connection ID when it creates a window. A
fresh window uses the configured default. `GET /api/pi/info` verifies the
backend name and API version before Leyline switches to it. The response also
reports transport capabilities.

`server/pi-api/cors.js` applies one origin policy to pi HTTP routes, native app routes, and terminal WebSocket upgrades.

`server/pi-api/git-review.js` reads status and per-file diffs from the selected
backend's filesystem. The review API does not change Git state.

Same-origin and loopback clients work by default. Other frontend origins must be listed in `LEYLINE_SERVER_ALLOWED_ORIGINS`.

## Runtime handles and active selection

Leyline creates an `AgentSessionRuntime` when it activates a persisted session. The runtime owns the current `AgentSession` and its cwd-bound services.

A server runtime handle contains:

- the `AgentSessionRuntime`
- the session ID
- the runtime-event unsubscribe function
- the projected extension UI state

`runtimeHandles` keeps handles by session ID. `runtimeHandlePromises` prevents duplicate activation work for the same session.

Handles remain available after the user selects another session. This permits background sessions to continue and send events.

`activeHandle`, `activeRuntime`, and `activeSessionId` identify the process-wide active session. Legacy routes and the terminal use this selection.

Scoped session routes resolve a handle by session ID. Use scoped routes for prompt, shell, compaction, edit, interrupt, reload, model, and thinking operations.

Active session selection is process-wide within one backend. Two windows that
use the same backend can change its terminal target and all legacy
active-session routes. Windows that use different backends do not share this
selection.

## Session storage and projection

Pi sessions are tree-structured JSONL files. The default directory is `~/.pi/agent/sessions/--encoded-cwd--/`, not the project working directory.

`PI_CODING_AGENT_SESSION_DIR` overrides session discovery and creation. Otherwise, Leyline uses pi's configured `sessionDir` or pi's default directory.

Session discovery reads JSONL files with a bounded worker pool. It caches summaries by file modification time and size and combines concurrent list requests.

Persisted summaries use the latest user or assistant message time for ordering. Session names come from the latest `session_info` entry.

Normal session changes use pi session and runtime methods. Transcript detail opens the file with `SessionManager.open(path)` and reads `getBranch()`.

Leyline projects the branch through `lib/transcript-projection.js`. The same projected DTO supplies the browser transcript and HTML export.

`lib/research-state.js` folds session-ID-bound `leyline-research` entries from the active branch. Session summaries keep compact phase and count data. Detail and runtime DTOs keep the complete research state.

## Session lineage and child agents

A parent session path records lineage for forks and subagent sessions. The parent path alone does not identify a subagent session.

New subagent and vision-child sessions contain a `leyline-subagent-session` custom entry. The entry records the child session ID and parent session path.

Session discovery uses this explicit marker. It also has a compatibility fallback that finds child paths in parent `subagent` tool results.

Deep research uses the same child-session runtime path. A reserved researcher definition limits workers to approved read and search tools.

Vision delegation adds `leyline-vision-delegation` records to the parent branch. A session context transform replaces image blocks with saved file paths and a `vision_agent` instruction. This applies when the parent model cannot receive images. After matching tool calls exist, the transform uses neutral context text. It does not request another inspection. The persisted user message keeps the images.

Pasted delegated images are stored in `LEYLINE_MEMORY_DIR/attachments/<session-id>/`. Without `LEYLINE_MEMORY_DIR`, the path is `~/.local/share/leyline/attachments/<session-id>/`. The session and project trash operations remove the related attachment directory after they move the JSONL file.

Forks use `AgentSessionRuntime.fork(entryId, { position: 'at' })`. A fork gets a new JSONL file and keeps normal session visibility. It copies session-level subagent and vision-model overrides.

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
- `memories`
- `rollout_feedback`
- `subagent_overrides`
- `vision_overrides`

`backend_connections` stores named backend URLs. `leyline_settings` stores the default connection ID and UI settings.

Memory, subagent, and vision scopes use canonical project roots and hashed scope IDs. Rollout feedback uses the cwd, session path, session ID, and entry ID.

These modules honor `LEYLINE_MEMORY_DIR`. When set, they use `memory.sqlite` in
that directory.

## Bundled extensions and prompt

Each runtime loads the bundled goal, memory, subagent, research, and vision-agent extensions from `.pi/extensions/`. It also appends `.pi/LEYLINE_SYSTEM.md` to the system prompt.

A new research session gets its marker before extension binding. The research extension exposes `research_update` only when the active branch contains a marker for that session ID.

Vision children use the normal subagent runtime path with no active tools. A session-local settings override permits image input without changing the user's persisted pi image setting.

Reload creates replacement cwd-bound services. It then binds the new session, extensions, event subscription, and extension UI state to the existing handle.

The goal extension stores `goal-state` custom entries. Backend projection finds the latest goal state and includes it in session state.

The research extension stores objective, plan, phase, thread, source, report, and error entries. Citation checks require numbered report links to match non-excluded ledger sources.

SSE updates carry goal, research, and extension UI changes to `App.vue`. The workbench uses this state for controls, progress, source navigation, and session titles.

## Terminal boundary

`server/pi-api/terminal.js` handles WebSocket upgrades at `/api/pi/terminal`. It starts one `node-pty` process per connection.

The PTY uses the process-wide active runtime cwd. Closing the browser terminal connection kills that PTY.

Packaged builds unpack native `node-pty` files. On macOS, the server also repairs the `spawn-helper` executable bit when necessary.
