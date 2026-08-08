# Architecture

Leyline has one Vue frontend and two server startup paths. Both paths use the same backend modules and pi runtime integration.

## Browser and Vite flow

`npm run dev` starts Vite at `http://localhost:5173/`. `vite.config.js` loads the Vue plugin, the VitePress middleware, and `piApi()`.

The `piApi()` plugin mounts runtime routes at `/api/pi` and connection routes
at `/api/leyline`. It also attaches the terminal WebSocket server to the Vite
HTTP server.

The browser loads the Vue app from Vite. The native backend uses the same
origin. A window can select another saved backend for runtime HTTP commands,
server-sent events (SSE), terminal WebSocket traffic, and exports. Connection
management stays on the native backend.

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
modules own DTOs, events, storage, export, filesystem access, and the terminal.

`src/lib/pi-api.js` is the frontend HTTP client. `useRuntimeEvents.js` owns the
SSE connection, and `useTerminal.js` owns the terminal WebSocket.

## Backend connections and transport routing

`server/backend-connections.js` stores named connections and the default. Its
routes use `/api/leyline/connections` on the native backend.

`src/composables/useBackendConnections.js` loads the registry and keeps the
active connection ID in window `sessionStorage`. Saved definitions and the
default are app-wide. The active connection is window-specific.

`src/lib/backend.js` supplies the base URL for runtime HTTP, SSE, terminal
WebSocket, and export requests. The native backend uses the current app origin. Saved
connections can use hostnames, IPv4 or IPv6 addresses, ports, and base paths.

Electron passes the source window's connection ID when it creates a window. A
fresh window uses the configured default. `GET /api/pi/info` verifies the
backend name and API version before Leyline switches to it. The response also
reports transport capabilities.

`server/pi-api/cors.js` applies one origin policy to pi HTTP routes, the
connection registry, and terminal WebSocket upgrades. Same-origin and loopback
clients work by default. Other frontend origins must be listed in
`LEYLINE_SERVER_ALLOWED_ORIGINS`.

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

Normal session changes use pi session and runtime methods. Transcript detail opens the file with `SessionManager.open(path)` and reads `getBranch()`.

Leyline projects the branch through `lib/transcript-projection.js`. The same projected DTO supplies the browser transcript and HTML export.

## Session lineage and subagents

A parent session path records lineage for forks and subagent sessions. The parent path alone does not identify a subagent session.

New subagent sessions contain a `leyline-subagent-session` custom entry. The entry records the child session ID and parent session path.

Session discovery uses this explicit marker. It also has a compatibility fallback that finds child paths in parent `subagent` tool results.

Forks use `AgentSessionRuntime.fork(entryId, { position: 'at' })`. A fork gets a new JSONL file and keeps normal session visibility.

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

`backend_connections` stores named backend URLs. `leyline_settings` stores the
default connection ID. Memory and subagent scopes use canonical project roots
and hashed scope IDs. Rollout feedback uses the cwd, session path, session ID,
and entry ID.

These modules honor `LEYLINE_MEMORY_DIR`. When set, they use `memory.sqlite` in
that directory.

## Bundled extensions and prompt

Each runtime loads the bundled goal, memory, and subagent extensions from `.pi/extensions/`. It also appends `.pi/LEYLINE_SYSTEM.md` to the system prompt.

Reload creates replacement cwd-bound services. It then binds the new session, extensions, event subscription, and extension UI state to the existing handle.

The goal extension stores `goal-state` custom entries. Backend projection finds the latest goal state and includes it in session state.

SSE updates carry goal and extension UI changes to `App.vue`. The workbench uses this state for goal controls and an empty session title.

## Terminal boundary

`server/pi-api/terminal.js` handles WebSocket upgrades at `/api/pi/terminal`. It starts one `node-pty` process per connection.

The PTY uses the process-wide active runtime cwd. Closing the browser terminal connection kills that PTY.

Packaged builds unpack native `node-pty` files. On macOS, the server also repairs the `spawn-helper` executable bit when necessary.
