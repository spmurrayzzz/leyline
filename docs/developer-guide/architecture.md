# Architecture

Leyline has one Vue frontend and two server startup paths. Both paths use the same backend modules and pi runtime integration.

## Browser and Vite flow

`npm run dev` starts Vite at `http://localhost:5173/`. `vite.config.js` loads the Vue plugin, the VitePress middleware, and `piApi()`.

The `piApi()` plugin mounts HTTP routes at `/api/pi`. It also attaches the terminal WebSocket server to the Vite HTTP server.

The browser loads the Vue app from Vite. The browser uses HTTP for commands, server-sent events (SSE) for runtime events, and WebSocket for the terminal.

## Electron development flow

`npm run electron:dev` sets `LEYLINE_DEV_SERVER_URL=http://localhost:5173` and starts Electron. Start Vite before Electron.

Electron loads the Vite URL into a `BrowserWindow`. The Vite process owns the backend and all runtime handles in this flow.

The renderer has context isolation enabled and Node.js integration disabled. Electron sends native commands through browser `CustomEvent` objects.

## Packaged Electron flow

A packaged app does not start Vite. `electron/main.js` starts `server/leyline-server.js` once in the Electron main process.

The server listens on an ephemeral loopback port. It serves `dist/`, routes `/api/pi/*`, and attaches the terminal WebSocket server.

All Electron windows load the same loopback server. They share one backend module instance, one runtime handle map, and one active-session pointer.

Electron uses a single-instance lock. A `leyline -n` request creates another window in the first Electron process.

## Backend boundaries

`server/pi-api/index.js` creates one backend runtime and exports the Vite and standalone server adapters. `server/pi-api/router.js` handles HTTP routing.

`server/pi-api/runtime.js` owns pi sessions and runtime handles. Other backend modules own DTOs, events, storage, export, filesystem access, and the terminal.

`src/lib/pi-api.js` is the frontend HTTP client. `useRuntimeEvents.js` owns the SSE connection, and `useTerminal.js` owns the terminal WebSocket.

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

Active selection is not window-specific. A selection in one browser or Electron window changes the terminal target and all legacy active-session routes.

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

The Memory Inspector, rollout feedback, and subagent model overrides use Node.js `DatabaseSync`. They open `~/.local/share/leyline/memory.sqlite`.

The database currently contains these application tables:

- `memories`
- `rollout_feedback`
- `subagent_overrides`

Memory and subagent scopes use canonical project roots and hashed scope IDs. Rollout feedback uses cwd, session path, session ID, and entry ID.

The bundled memory extension and all three backend modules honor `LEYLINE_MEMORY_DIR`. When set, they use `memory.sqlite` in that directory.

## Bundled extensions and prompt

Each runtime loads the bundled goal, memory, and subagent extensions from `.pi/extensions/`. It also appends `.pi/LEYLINE_SYSTEM.md` to the system prompt.

Reload creates replacement cwd-bound services. It then binds the new session, extensions, event subscription, and extension UI state to the existing handle.

The goal extension stores `goal-state` custom entries. Backend projection finds the latest goal state and includes it in session state.

SSE updates carry goal and extension UI changes to `App.vue`. The workbench uses this state for goal controls and an empty session title.

## Terminal boundary

`server/pi-api/terminal.js` handles WebSocket upgrades at `/api/pi/terminal`. It starts one `node-pty` process per connection.

The PTY uses the process-wide active runtime cwd. Closing the browser terminal connection kills that PTY.

Packaged builds unpack native `node-pty` files. On macOS, the server also repairs the `spawn-helper` executable bit when necessary.
