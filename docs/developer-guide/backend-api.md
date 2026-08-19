# Backend API design

Leyline exposes runtime routes under `/api/pi`. The same handler runs in Vite and in the packaged Electron server.

The native backend also exposes the app connection registry and app settings under `/api/leyline`.

## Request flow

During browser development, `server/pi-api/index.js` mounts `piApiHandler` as Vite middleware. Vite removes the `/api/pi` prefix before routing.

In a packaged app, `server/leyline-server.js` removes the same prefix. It sends the remaining path to `piApiHandler`.

Vite and the packaged server route `/api/leyline/*` to `server/backend-connections.js`.

`server/pi-api/router.js` parses JSON request bodies and dispatches operations.
Successful JSON responses use explicit envelopes such as `{ sessions }`,
`{ active }`, or `{ ok: true }`.

The router returns JSON for HTTP errors. It uses explicit 400, 404, and 405 responses in some branches, and its outer handler maps other errors to 500.

The terminal does not use the HTTP router. It uses a WebSocket upgrade at `/api/pi/terminal`.

## Module ownership

| Module | Ownership |
| --- | --- |
| `server/backend-connections.js` | Named connections, the default connection, and app settings on the native backend |
| `lib/leyline-settings.js` | Setting keys that the native backend and browser share |
| `server/pi-api/index.js` | Shared runtime instance, Vite integration, and WebSocket setup |
| `server/pi-api/router.js` | HTTP method and path dispatch |
| `server/pi-api/cors.js` | Shared HTTP and WebSocket origin policy |
| `server/pi-api/runtime.js` | `AgentSessionRuntime` lifecycle, runtime handles, session operations, bundled resources, subagent execution, and vision execution |
| `server/pi-api/sessions.js` | Session discovery, configured session directories, list metadata, and subagent markers |
| `server/pi-api/dtos.js` | Runtime, session state, session detail, model, command, and transcript DTOs |
| `server/pi-api/events.js` | SSE clients and event serialization |
| `server/pi-api/extension-ui.js` | Browser-compatible extension UI context and runtime event binding |
| `server/pi-api/goal-state.js` | Goal custom-entry projection |
| `server/pi-api/fs-browser.js` | Local directory browsing and path normalization |
| `server/pi-api/git-review.js` | Read-only Git status and bounded per-file diffs |
| `server/pi-api/memories.js` | Memory Inspector queries and mutations |
| `server/pi-api/rollout-feedback.js` | Assistant-entry feedback storage and DTO application |
| `server/pi-api/subagents.js` | Agent discovery, scoped model overrides, and effective configuration |
| `server/pi-api/vision.js` | Vision-model overrides, delegation records, and parent-context replacement |
| `server/pi-api/export-renderer.js` | HTML export rendering, export CSS, and preview code |
| `server/pi-api/terminal.js` | PTY and terminal WebSocket lifecycle |
| `server/pi-api/http.js` | JSON body, JSON response, and HTML response helpers |

## Route groups

The router has these main route groups:

- session list, creation, detail, lookup by path, rename, delete, and export
- runtime state and active-session selection
- prompt, shell, compaction, edit, fork, Reset to here, reload, model, thinking, mode, and interrupt
- filesystem browsing
- read-only Git review
- Memory Inspector operations
- rollout feedback
- subagent configuration and subagent execution
- vision configuration, resolution, and child execution
- SSE events

See the [API reference](../reference/api) for route contracts. Compare that page with `server/pi-api/router.js` when route behavior changes.

## Scoped and legacy operations

The frontend uses `/sessions/:id/<action>` for most runtime operations. The server resolves or creates a runtime handle for that ID.

Legacy routes such as `/prompt`, `/bash`, and `/compact` use `requireActiveHandle()`. Keep them for compatibility, but do not use them for new frontend work.

Fork and Reset to here currently use active-session routes. The terminal also uses the process-wide active runtime cwd.

This distinction matters when windows use the same backend. Scoped operations
select the requested handle. Active operations depend on the latest selection
in that backend process.

## Git review

The review routes run Git against the requested project directory on the selected backend. They do not use a pi runtime handle.

The status response keeps at most 500 changed paths. A text diff larger than 1 MiB or 5,000 lines returns metadata without a patch body.

Git commands disable external diff drivers and text conversion. The browser keeps staged and working-tree patches in separate sections.

## Runtime construction

`runtime.js` creates cwd-bound pi services with `createAgentSessionServices()`. It then creates the session through `createAgentSessionFromServices()`.

`createAgentSessionRuntime()` wraps the session and services in `AgentSessionRuntime`. Runtime handles keep these objects alive for background work.

Each runtime loads the bundled goal, memory, subagent, and vision-agent extensions. It also appends the Leyline system prompt.

Runtime creation installs a vision context transform on the session agent. The transform replaces matched images with saved file paths and `vision_agent` instructions. After matching tool calls exist, it uses neutral text instead of another instruction.

Leyline forces steering and follow-up modes to `one-at-a-time`. Prompt requests can still select `steer` or `followUp` as their streaming behavior.

## Session writes

Use pi runtime and session methods for normal writes:

- `session.prompt()` for prompts and queued messages
- `session.executeBash()` for shell commands after extension hooks
- `session.compact()` for compaction
- `session.navigateTree()` for edits
- `runtime.fork()` for forks
- `session.setModel()` and `session.setThinkingLevel()` for runtime controls

Rename appends a `session_info` record. Delete moves the JSONL file to Leyline trash.

Reset to here is the explicit exception. It replaces the manager entries with the retained branch and rewrites the current file.

## Application metadata

`backend-connections.js`, `memories.js`, `rollout-feedback.js`, `subagents.js`,
and `vision.js` share `~/.local/share/leyline/memory.sqlite`.

Backend connection definitions, the default connection, and UI settings are app-wide. A window stores its active connection ID in `sessionStorage`.

Memory operations enforce global, project, and session visibility. The Memory Inspector can create, update, archive, restore, and permanently delete visible rows.

Rollout feedback stores `helpful` or `unhelpful` for an assistant entry. It can also store an optional feedback note.

Subagent configuration discovers definitions in `~/.pi/agent/agents` and the nearest project `.pi/agents` directory.

Subagent model precedence is session, project, global, then the agent definition. Vision-model precedence is session, project, then global. Session overrides for both features copy to a new fork.

The subagent and vision execution routes create child pi sessions. They write an explicit marker before they start each child runtime. Vision children use an empty tool allowlist and a session-local image setting override.

## Goal state projection

The goal extension writes `goal-state` custom entries. `goal-state.js` finds the latest entry and normalizes budgets, status, and elapsed time.

Session DTOs include the normalized goal. Extension events also trigger active-session and extension UI broadcasts.

The browser does not reconstruct goal state from transcript text. It uses the projected backend state.

## Frontend client

`src/lib/backend.js` supplies the active backend base URL for runtime HTTP,
SSE, terminal WebSocket, and export requests. `src/lib/pi-api.js` owns runtime fetch
calls and request field names.

`src/lib/leyline-api.js` manages the native connection registry and app settings. It also checks `GET /api/pi/info` before a switch.

The backend information response gates the review control with the `review` capability. `ReviewPane.vue` loads data through `src/lib/pi-api.js`.

Vision configuration and parent prompt requests use `src/lib/pi-api.js`. For a parent model without image input, the backend saves attachments and the parent calls `vision_agent` during its turn.

`useTranscriptPreferences.js` reads and writes the thought display default. UI components and composables do not construct transport URLs directly.
