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

The router returns JSON for HTTP errors. It uses explicit 400, 404, 405, and 409 responses in some branches. Its outer handler maps other errors to 500.

The terminal does not use the HTTP router. It uses a WebSocket upgrade at `/api/pi/terminal`.

## Module ownership

| Module | Ownership |
| --- | --- |
| `server/backend-connections.js` | Named connections, the default connection, and app settings on the native backend |
| `lib/leyline-settings.js` | Setting keys that the native backend and browser share |
| `lib/research-state.js` | Branch-local research state folding and source normalization |
| `lib/research-citations.js` | Report citation checks against canonical ledger sources |
| `server/pi-api/index.js` | Shared runtime instance, Vite integration, and WebSocket setup |
| `server/pi-api/router.js` | HTTP method and path dispatch |
| `server/pi-api/pi-settings-routes.js` | Provider, model, MCP, and private operation routes |
| `server/pi-api/pi-config.js` | Pi configuration parsing, revisions, file locks, and atomic edits |
| `server/pi-api/provider-settings.js` | Redacted provider inventory, model/provider edits, and native authentication |
| `server/pi-api/provider-settings-runtime.js` | Cwd-bound settings runtime leases and resource cleanup |
| `server/pi-api/settings-operations.js` | Private prompts, operation snapshots, cancellation, and provider serialization |
| `server/pi-api/mcp-settings.js` | Global MCP configuration, redacted inventory, and worker ownership |
| `server/pi-api/mcp-settings-worker.js` | Disposable native MCP management session |
| `server/pi-api/mcp-settings-transports.js` | Owned native transports, secret resolution, and bounded cleanup |
| `server/pi-api/cors.js` | Shared HTTP and WebSocket origin policy |
| `server/pi-api/runtime.js` | `AgentSessionRuntime` lifecycle, runtime handles, session operations, bundled resources, subagent execution, and vision execution |
| `server/pi-api/prompt-queue.js` | Editable unsent tasks, queue revisions, hold/resume, and submission when pi is idle |
| `server/pi-api/sessions.js` | Session discovery, configured session directories, list metadata, and subagent markers |
| `server/pi-api/dtos.js` | Runtime, session state, session detail, model, command, and transcript DTOs |
| `server/pi-api/events.js` | SSE clients and event serialization |
| `server/pi-api/extension-ui.js` | Browser-compatible extension UI context and runtime event binding |
| `server/pi-api/goal-state.js` | Goal custom-entry projection |
| `server/pi-api/fs-browser.js` | Local directory browsing and path normalization |
| `server/pi-api/git-review.js` | Read-only Git status, bounded per-file diffs, and watcher Git queries |
| `server/pi-api/git-review-watch.js` | Shared recursive review watchers and review-change SSE clients |
| `server/pi-api/memories.js` | Memory Inspector queries and mutations |
| `server/pi-api/rollout-feedback.js` | Assistant-entry feedback storage and DTO application |
| `server/pi-api/subagents.js` | Agent discovery, scoped model overrides, and effective configuration |
| `server/pi-api/vision.js` | Vision-model overrides, delegation records, and parent-context replacement |
| `server/pi-api/export-renderer.js` | HTML export rendering, export CSS, and preview code |
| `server/pi-api/terminal.js` | PTY and terminal WebSocket lifecycle |
| `server/pi-api/http.js` | JSON body, JSON response, and HTML response helpers |

## Route groups

The router has these main route groups:

- session list, normal or research creation, detail, lookup by path, rename, delete, and export
- runtime state and active-session selection
- prompt, queue mutation, shell, compaction, edit, fork, Reset to here, reload, model, thinking, mode, and interrupt
- filesystem browsing
- read-only Git review and review-change SSE
- Memory Inspector operations
- rollout feedback
- subagent configuration and subagent execution
- vision configuration, resolution, and child execution
- global pi provider/model/MCP configuration and private authentication operations
- SSE events

See the [API reference](../reference/api) for route contracts. Compare that page with `server/pi-api/router.js` when route behavior changes.

## Scoped and legacy operations

The frontend uses `/sessions/:id/<action>` for most runtime operations. The server resolves or creates a runtime handle for that ID.

Legacy routes such as `/prompt`, `/bash`, and `/compact` use `requireActiveHandle()`. Keep them for compatibility, but do not use them for new frontend work.

Fork uses a session-scoped route and creates a separate runtime. Reset to here still uses an active-session route. Leyline terminal connections resolve the requested session ID. Unscoped terminal requests use the active runtime CWD for compatibility.

This distinction matters when windows use the same backend. Scoped operations and Leyline terminal connections select the requested handle. Active operations depend on the latest selection in that backend process.

## Git review

The review routes run Git against the requested project directory on the selected backend. They do not use a pi runtime handle.

The status response keeps at most 500 changed paths. A text diff larger than 1 MiB or 5,000 lines returns metadata without a patch body.

Git commands disable external diff drivers and text conversion. The browser keeps staged and working-tree patches in separate sections.

`git-review-watch.js` shares one reference-counted recursive watcher per resolved repository root. It batches filesystem events, filters ignored paths, and watches the index, HEAD, current ref, and relevant Git configuration paths separately. This metadata coverage also supports linked worktrees.

`GET /api/pi/review/events` sends `review_change` events to subscribed clients. Watchers close after their last client disconnects. Runtime-settled events, completed composer shell commands, and manual refresh remain fallback triggers.

## Runtime construction

`runtime.js` creates cwd-bound pi services with `createAgentSessionServices()`. It then creates the session through `createAgentSessionFromServices()`.

`createAgentSessionRuntime()` wraps the session and services in `AgentSessionRuntime`. Runtime handles keep these objects alive for background work.

Normal runtimes load the bundled output-budget, ultrafast, goal, memory, subagent, research, and vision-agent extensions. They also append the Leyline system prompt.

`preferBundledExtensions()` filters conflicts by extension name and designated command or tool names. It puts the bundled Ultrafast extension last, so later hooks cannot overwrite its enabled tier.

Children with an isolated custom system prompt retain only output-budget. They omit context files, skills, native extension factories, and the Leyline prompt. Vision children use this isolated path.

`services.modelRuntime` is pi's `ModelRuntime`. It supplies model lookup, available snapshots, and authentication state. Use this current SDK terminology in new integration work.

Research creation writes a `leyline-research` marker before extension binding. The bound extension adds its lead protocol and exposes `research_update` only for that session.

Runtime creation installs a vision context transform on the session agent. The transform replaces matched images with saved file paths and `vision_agent` instructions. After matching tool calls exist, it uses neutral text instead of another instruction.

Leyline retains `one-at-a-time` delivery for native pi steering and follow-up inputs.

## Native MCP and tool search

Normal runtimes add `createMcpExtension()` and `createToolSearchExtension()` as replaceable built-in extensions through `extensionFactories`. Pi owns server configuration, connections, discovery, and tool execution.

Leyline activates `tool_search` at session start unless `defaultTools` contains `-tool_search`. Tools that it loads produce normal system-role tool deltas.

Leyline does not load Codemode and always excludes `codemode` from the active tool set. Do not reintroduce it when updating SDK integration.

## Pi Settings

`capabilities.piSettings` enables Models & providers and MCP servers. These routes run on the selected backend. Display preferences and connection records remain on the native app backend.

Pi owns the global configuration files resolved through `getAgentDir()`. Leyline edits `models.json` and `mcp.json`, while native SDK authentication owns credentials. Subagent and vision overrides remain in Leyline SQLite. A provider target selects a cwd for extension discovery, not a project configuration file.

`pi-config.js` preserves unknown fields, supported comments, formatting, and symlink targets. Writes require the whole-file revision, acquire a lock, and replace the file atomically after another revision check. Invalid files block saves. Provider/model inventories omit saved secrets. MCP inventories omit arguments and header/environment values and redact sensitive URL parts.

See [Pi Settings routes](../reference/api#pi-settings-routes) for exact fields, methods, revisions, operation shapes, and errors. This API is deliberately smaller than pi's configuration schema. General preferences, model-picker visibility, project MCP editing, and Codemode configuration are outside this surface.

### Provider runtime ownership

`provider-settings-runtime.js` caches separate settings runtimes by resolved cwd. Each request acquires a lease and releases it in `finally`. These runtimes never replace conversation handles.

The pool permits four contexts, including contexts still retiring. It retires unused contexts for capacity. A leased context cannot be replaced by Refresh. Construction, authentication-status reads, and catalog refresh have 15-second bounds. Interactive authentication uses the longer operation lifetime. Disposal waits up to three seconds before session disposal. A late or failed creation remains owned until cleanup finishes.

Each resource-loader extension set receives an in-memory session owner, including failed creation and cold Refresh paths. `AgentSessionRuntime.dispose()` supplies shutdown before replacement. Reusing a loader does not permit an extension set to escape shutdown. Lifetime signals block late provider publication after retirement.

Ordinary provider reads refresh authentication snapshots with `allowNetwork: false`. `GET /settings/providers?refresh=1` replaces the settings runtime and reloads extension registrations. The provider `refresh` action also requests a forced network catalog refresh. Neither action refreshes live conversation catalogs.

Provider mutations, authentication, and conversation construction share a process-level lock. Native login can write shared credentials immediately. Before login, `assertProviderRoutes()` compares provider model APIs and URLs across open, background, hidden, and constructing runtimes. A mismatch blocks login until affected sessions reload or the backend restarts. This prevents new credentials from reaching an old endpoint.

Existing work is not silently aborted or reloaded. A save refreshes only its settings runtime. `GET /state?cwd=...&refresh=1` builds and disposes a fresh Home preview without changing conversation catalogs.

Pi 0.99.1 retains cached Radius gateway URLs after reload. Leyline rejects changes that alter or remove an existing Radius base URL. A different gateway requires a different provider identity. Provider IDs cannot contain `/`, but model IDs can.

### Private authentication operations

`settings-operations.js` owns bounded, process-local operations. Clients poll snapshots and answer the current prompt ID, or request cancellation. The SDK supplies provider text, secret, select, manual-code, authorization-URL, and device-code interactions.

Settings prompts do not use `extension-ui.js`, shared SSE, or transcript entries. The initiating component retains its backend URL throughout polling and cancellation. A credential write can finish before cancellation, so cancellation cannot promise rollback.

### Native MCP management

MCP listing reads global configuration without connecting or resolving secrets. Check and login use a disposable worker with an in-memory session and only `createMcpExtension()`. The worker invokes the native `/mcp` command through a private UI context. It reports temporary connections, not conversation connection status. Logout neither connects nor resolves configuration secrets.

The worker owns native `StdioTransport` and `StreamableHttpTransport` adapters. It tracks adapters before connection setup, command processes, prompts, and child processes. Cancellation reaches initialization as well as established connections. Deadlines bound native OAuth work and secret commands. Normal HTTP cleanup keeps a bounded signal available for session DELETE requests.

Resolve the public `@earendil-works/pi-mcp` package from the coding-agent package context. This keeps transport error classes identical to those used by native MCP authentication. A separate dependency instance can break native error checks.

Only controlled native diagnostics reach operation snapshots. Tool metadata excludes resolved configuration secrets and OAuth access tokens. HTTP operation locks use normalized server URLs, so aliases share the lock used for the same native credential identity.

New MCP entries default to `deferred`. The editor offers `deferred`, `direct`, and `hidden`, while preserving existing exposure values. Leyline never loads or enables Codemode.

## Browser confirmations

`extension-ui.js` adapts `ctx.ui.confirm()` to pending requests in `extensionUi.confirmations`. Each request has an ID, title, message, and optional expiry.

`ExtensionConfirmations.vue` shows **Confirm** and **Cancel**. Replies use the session-scoped `/sessions/:id/extension-confirmations/:requestId` route. HTTP and SSE snapshots carry the current pending requests.

Confirmation replies apply only to the current session binding. Abort, expiry, reload, or disposal resolves pending requests as false. Stale replies cannot approve replacement runtimes.

## Ultrafast

The bundled `.pi/extensions/ultrafast/index.js` owns the mode and provider hooks. Its `leyline-ultrafast` command is for composer controls and stays hidden from the slash picker.

Eligibility requires `gpt-6-astra` or `gpt-6.1-sol` on one of these paths:

- `openai-codex` with `openai-codex-responses`
- `openai` with `openai-responses` and API-key authentication

The `openai` subscription path is ineligible. Ultrafast defaults to off and belongs to the current runtime. Model changes and explicit reloads reset it. New forks start with it off.

Retry and prompt edits retain the choice when runtime and model identity stay unchanged. Their internal navigation can rebind extensions, so the edit path restores the tier through the extension command before generation and after rollback.

Ultrafast applies only to normal agent turns. Compaction and branch summaries stay Standard, including automatic compaction during a turn. Cache warming stops while Ultrafast is enabled.

When enabled, normal agent requests use `service_tier: "ultrafast"`. Codex requests also use `x-codex-routing-hint: model=<id>;tier=ultrafast`. Direct OpenAI Astra requests add `OpenAI-Service-Tier: ultrafast`.

Tier changes call pi's public `cleanupSessionResources(sessionId)` to obtain a fresh connection and routing headers. An external model change during a run defers cleanup to a safe turn or provider boundary.

Cost changes require a matching response ID, provider, and model. The extension recalculates base costs and multiplies each cost field by six for confirmed Ultrafast requests. Codex confirmation also accepts an Ultrafast request when the response tier is absent or `default`. Token counts do not change.

Model and Ultrafast changes require an idle session and share the prompt-submission lock. Model changes hold that lock until asynchronous authentication finishes. Prompt preflight and queue dispatch stay blocked during either change. Both paths release their flags and reschedule the queue in `finally`.

## Pending prompts

Each runtime handle owns an editable **Up next** queue from `prompt-queue.js`. Items retain stable IDs, text, images, and submission metadata until pi accepts them.

Ordinary input during a run enters this queue. A `followUp` request also enters the queue when idle. Registered extension commands still execute through pi directly.

The queue submits one task when `session.isIdle` and no prompt setup, Stop, reload, or initialization blocks dispatch. Settlement, compaction, and completed or cancelled edit navigation schedule another dispatch check.

Submission uses the existing prompt lock, vision preparation, and `session.prompt()` path. Queued items retain the original prompt handoff ID for transformed-input reconciliation.

At final settlement, the recorded runtime outcome determines whether failed work holds the queue. Do not infer success from the last projected assistant message: recovery can omit failed responses from model context.

`preflightResult` marks acceptance. `started` checks cancellation before a new run begins. `queued` and `handled` are irreversible acceptance, even if cancellation arrived during an input hook. Accepted items leave the editable queue.

Steer hands an item to pi's native delivery path. Leyline does not clear or replay native queues to implement edits or reordering.

Stop holds unsent tasks. Editing also holds the queue and cancels any unaccepted queue submission; saving does not resume it. An empty queue clears its hold and error. Runtime reload retains pending tasks held, but backend restart discards them.

Queue mutations use `promptQueue.revision` and reject stale requests with `409`. Runtime snapshots have a separate `snapshotRevision` for HTTP/SSE ordering. Snapshot DTOs expose pending text and image counts, not image bytes.

## Session writes

Use pi runtime and session methods for normal writes:

- `session.prompt()` for prompts and queued messages
- `session.executeBash()` for shell commands after extension hooks
- `session.compact()` for compaction
- `session.navigateTree()` for edits
- `SessionManager.createBranchedSession()` and a new runtime for forks, without replacing the source runtime
- `session.setModel()` and `session.setThinkingLevel()` for runtime controls

Rename appends a `session_info` record. Delete moves the JSONL file to Leyline trash.

Research state uses custom JSONL entries for its objective, plan, phase, threads, sources, report, and errors. The backend folds these entries from the active branch.

Reset to here is the explicit exception. It replaces the manager entries with the retained branch and rewrites the current file.

## Application metadata

`backend-connections.js`, `memories.js`, `rollout-feedback.js`, `subagents.js`,
and `vision.js` share `~/.local/share/leyline/memory.sqlite`.

Backend connection definitions, the default connection, and display preferences belong to the native app backend. A window stores its active connection ID in `sessionStorage`. File editor settings, memory, feedback, and agent overrides belong to the selected backend.

Global Agent defaults, Project settings, and Session details fix the override scope in the UI. They use the existing subagent and vision routes. Pi provider/model/MCP configuration remains in pi-owned global files, not these SQLite tables.

Memory operations enforce global, project, and session visibility. The Memory Inspector can create, update, archive, restore, and permanently delete visible rows.

Rollout feedback stores `helpful` or `unhelpful` for an assistant entry. It can also store an optional feedback note.

Subagent configuration discovers definitions in `~/.pi/agent/agents` and the nearest project `.pi/agents` directory.

Subagent model precedence is session, project, global, then the agent definition. Vision-model precedence is session, project, then global. Session overrides for both features copy to a new fork.

The subagent and vision execution routes create child pi sessions. They write an explicit marker before they start each child runtime. Normal subagents retain the normal runtime resources and their tool policy. Vision children use an isolated prompt, output-budget only, an empty tool allowlist, and a session-local image setting override.

## Goal and research state projection

The goal extension writes `goal-state` custom entries. `goal-state.js` finds the latest entry and normalizes budgets, status, and elapsed time.

The research extension writes `leyline-research` custom entries. `research-state.js` folds matching entries, normalizes source identity, and derives progress counts.

Session DTOs include normalized goal and research state. Extension events also trigger active-session and extension UI broadcasts.

Before research completion, `research-citations.js` checks each numeric Markdown citation against a non-excluded ledger source.

The browser does not reconstruct goal state from transcript text. It uses the projected backend state.

## Frontend client

`src/lib/backend.js` supplies the active backend base URL for runtime HTTP,
SSE, terminal WebSocket, and export requests. `src/lib/pi-api.js` owns runtime fetch
calls and request field names. `src/lib/pi-settings-api.js` owns selected-backend Settings requests and private operation transport.

`src/lib/leyline-api.js` manages the native connection registry and app settings. It also checks `GET /api/pi/info` before a switch.

The backend information response gates the research control with `research`. It gates Git review with `review` and automatic watching with `reviewWatch`. Models & providers and MCP servers require `piSettings`.

`ReviewPane.vue` loads review data through `src/lib/pi-api.js` and opens the review stream through `backendHttpUrl()`.

Vision configuration and parent prompt requests use `src/lib/pi-api.js`. For a parent model without image input, the backend saves attachments and the parent calls `vision_agent` during its turn.

`useTranscriptPreferences.js` reads and writes the thought display default. UI components and composables do not construct transport URLs directly.
