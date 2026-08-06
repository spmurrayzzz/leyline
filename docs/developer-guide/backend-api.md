# Backend API design

Leyline exposes local HTTP routes under `/api/pi`. The same handler runs in Vite and in the packaged Electron server.

## Request flow

During browser development, `server/pi-api/index.js` mounts `piApiHandler` as Vite middleware. Vite removes the `/api/pi` prefix before routing.

In a packaged app, `server/leyline-server.js` removes the same prefix. It sends the remaining path to `piApiHandler`.

`server/pi-api/router.js` parses JSON request bodies and dispatches operations. Successful JSON responses use explicit envelopes such as `{ sessions }`, `{ active }`, or `{ ok: true }`.

The router returns JSON for HTTP errors. It uses explicit 400, 404, and 405 responses in some branches, and its outer handler maps other errors to 500.

The terminal does not use the HTTP router. It uses a WebSocket upgrade at `/api/pi/terminal`.

## Module ownership

| Module | Ownership |
| --- | --- |
| `server/pi-api/index.js` | Shared runtime instance, Vite integration, and WebSocket setup |
| `server/pi-api/router.js` | HTTP method and path dispatch |
| `server/pi-api/runtime.js` | `AgentSessionRuntime` lifecycle, runtime handles, session operations, bundled resources, and subagent execution |
| `server/pi-api/sessions.js` | Session discovery, configured session directories, list metadata, and subagent markers |
| `server/pi-api/dtos.js` | Runtime, session state, session detail, model, command, and transcript DTOs |
| `server/pi-api/events.js` | SSE clients and event serialization |
| `server/pi-api/extension-ui.js` | Browser-compatible extension UI context and runtime event binding |
| `server/pi-api/goal-state.js` | Goal custom-entry projection |
| `server/pi-api/fs-browser.js` | Local directory browsing and path normalization |
| `server/pi-api/memories.js` | Memory Inspector queries and mutations |
| `server/pi-api/rollout-feedback.js` | Assistant-entry feedback storage and DTO application |
| `server/pi-api/subagents.js` | Agent discovery, scoped model overrides, and effective configuration |
| `server/pi-api/export-renderer.js` | HTML export rendering, export CSS, and preview code |
| `server/pi-api/terminal.js` | PTY and terminal WebSocket lifecycle |
| `server/pi-api/http.js` | JSON body, JSON response, and HTML response helpers |

## Route groups

The router has these main route groups:

- session list, creation, detail, lookup by path, rename, delete, and export
- runtime state and active-session selection
- prompt, shell, compaction, edit, fork, Reset to here, reload, model, thinking, mode, and interrupt
- filesystem browsing
- Memory Inspector operations
- rollout feedback
- subagent configuration and subagent execution
- SSE events

See the [API reference](../reference/api) for route contracts. Compare that page with `server/pi-api/router.js` when route behavior changes.

## Scoped and legacy operations

The frontend uses `/sessions/:id/<action>` for most runtime operations. The server resolves or creates a runtime handle for that ID.

Legacy routes such as `/prompt`, `/bash`, and `/compact` use `requireActiveHandle()`. Keep them for compatibility, but do not use them for new frontend work.

Fork and Reset to here currently use active-session routes. The terminal also uses the process-wide active runtime cwd.

This distinction matters in concurrent browser tabs and Electron windows. Scoped operations select the requested handle, while active operations depend on the latest selection.

## Runtime construction

`runtime.js` creates cwd-bound pi services with `createAgentSessionServices()`. It then creates the session through `createAgentSessionFromServices()`.

`createAgentSessionRuntime()` wraps the session and services in `AgentSessionRuntime`. Runtime handles keep these objects alive for background work.

Each runtime loads the bundled goal, memory, and subagent extensions. It also appends the Leyline system prompt.

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

## Memory, feedback, and subagent storage

`memories.js`, `rollout-feedback.js`, and `subagents.js` share `~/.local/share/leyline/memory.sqlite`.

Memory operations enforce global, project, and session visibility. The Memory Inspector can create, update, archive, restore, and permanently delete visible rows.

Rollout feedback stores `helpful` or `unhelpful` for an assistant entry. It can also store an optional feedback note.

Subagent configuration discovers definitions in `~/.pi/agent/agents` and the nearest project `.pi/agents` directory.

Model override precedence is session, project, global, then the agent definition. Session overrides copy to a new fork.

The subagent execution route creates a child pi session. It writes an explicit marker before it starts the child runtime.

## Goal state projection

The goal extension writes `goal-state` custom entries. `goal-state.js` finds the latest entry and normalizes budgets, status, and elapsed time.

Session DTOs include the normalized goal. Extension events also trigger active-session and extension UI broadcasts.

The browser does not reconstruct goal state from transcript text. It uses the projected backend state.

## Frontend client

`src/lib/pi-api.js` owns frontend fetch calls and request field names. Keep path construction and response-envelope handling in this module.

UI components and composables call this client instead of calling `fetch()` directly. The EventSource and terminal WebSocket are the two exceptions.
