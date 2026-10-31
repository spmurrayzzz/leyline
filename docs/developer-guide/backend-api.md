# Backend API design

Leyline exposes runtime routes under `/api/pi`. The same handler runs in Vite and in the packaged Electron server.

The native backend also exposes the app connection registry, app settings, live network access, and pinned session IDs under `/api/leyline`.

## Request flow

During browser development, `server/pi-api/index.js` mounts `piApiHandler` as Vite middleware. Vite removes the `/api/pi` prefix before routing.

In a packaged app, `server/leyline-server.js` removes the same prefix. It sends the remaining path to `piApiHandler`.

Vite and the packaged server route `/api/leyline/*` to `server/backend-connections.js`.

`server/pi-api/router.js` parses JSON request bodies and dispatches operations.
Successful JSON responses use explicit envelopes such as `{ sessions }`,
`{ active }`, or `{ ok: true }`.

The router returns JSON for HTTP errors. It uses explicit 400, 404, 405, and 409 responses in some branches. Its outer handler maps other errors to 500. Trace routes use their own controlled validation and availability errors. See [Trace routes](../reference/api#trace-routes).

Runtime and Git review events use WebSocket upgrades at `/api/pi/events?sessionId=...` and `/api/pi/review/events?cwd=...`. `event-sockets.js` installs these handlers for Vite and standalone/Electron servers.

API v2 requires WebSockets for these events, with no HTTP SSE fallback. Direct HTTP GET requests to these endpoints return `426`. A review request without `cwd` returns `400`. Event frames use `{ type, data }`. See [Realtime events](./realtime-events) for heartbeat, reconnect, and queue behavior.

The terminal uses a separate WebSocket upgrade at `/api/pi/terminal`. Its protocol does not change.

Network sharing adds a TCP relay before the origin, without another HTTP router. `server/network-access.js` forwards all connection bytes unchanged. The `/api/leyline/network-access` routes control only that relay. They leave the origin and active runtimes intact. See [Live network access](./architecture#live-network-access) and the [route contract](../reference/api#network-access).

## Module ownership

| Module | Ownership |
| --- | --- |
| `server/backend-connections.js` | Named connections, the default connection, app settings, live network-access routes, and pinned session IDs on the native backend |
| `server/network-access.js` | Configurable TCP relay, serialized partial updates, live status, self-change response handling, and relay cleanup |
| `lib/leyline-settings.js` | Shared setting keys and defaults, including subagent batch size, automatic titles, idle cleanup, and certificate trust |
| `lib/research-state.js` | Branch-local research state folding and source normalization |
| `lib/research-citations.js` | Report citation checks against canonical ledger sources |
| `server/pi-api/index.js` | Shared runtime instance, Vite integration, and WebSocket setup |
| `server/pi-api/router.js` | HTTP method and path dispatch |
| `server/pi-api/pi-settings-routes.js` | Runtime cleanup, session-title, certificate, provider, model, MCP, and private operation routes |
| `server/pi-api/tls-trust.js` | CA file validation, trust-store construction, startup application, and backend certificate settings |
| `server/pi-api/pi-config.js` | Pi configuration parsing, revisions, file locks, and atomic edits |
| `server/pi-api/provider-settings.js` | Redacted provider inventory, catalog lookup, model/provider edits, native authentication, and connection-test dispatch |
| `server/pi-api/provider-settings-runtime.js` | Cwd-bound settings runtime leases, bounded inventory checks, and resource cleanup |
| `server/pi-api/custom-providers.js` | Optional credentials, native custom-provider registration, catalog synchronization, and public `ModelRuntime` wrapper |
| `server/pi-api/provider-connection-test.js` | Saved and draft connection probes, authentication resolution, routing guards, request limits, and controlled errors |
| `server/pi-api/settings-operations.js` | Private prompts, operation snapshots, cancellation, and provider serialization |
| `server/pi-api/mcp-settings.js` | Global MCP configuration, redacted inventory, and worker ownership |
| `server/pi-api/mcp-settings-worker.js` | Disposable native MCP management session |
| `server/pi-api/mcp-settings-transports.js` | Owned native transports, secret resolution, and bounded cleanup |
| `server/pi-api/cors.js` | Shared HTTP and WebSocket origin policy |
| `server/pi-api/runtime.js` | `AgentSessionRuntime` lifecycle, runtime handles, session operations, bundled resources, subagent execution, and vision execution |
| `server/pi-api/prompt-queue.js` | Shared prompt/shell queue, revisions, hold/resume, and submission when pi is idle |
| `server/pi-api/idle-runtimes.js` | Backend idle-timeout settings, access tracking, and periodic cleanup checks |
| `server/pi-api/session-titles.js` | Backend title settings and bounded, cancellable title generation |
| `server/pi-api/sessions.js` | Session discovery, configured session directories, list metadata, and subagent markers |
| `server/pi-api/dtos.js` | Runtime, session state, session detail, model, command, and transcript DTOs |
| `server/pi-api/events.js` | Runtime event projection, coalescing, bounded queues, and WebSocket serialization |
| `server/pi-api/event-sockets.js` | Runtime and Git review WebSocket upgrades, origin checks, heartbeats, and shutdown |
| `server/pi-api/tracing.js` | Lazy embedded Elune store, capture bindings, usage reconciliation, and backend capture configuration |
| `server/pi-api/tracing-routes.js` | Trace summary, paged detail, bookmark, and capture configuration routes |
| `server/pi-api/extension-ui.js` | Browser-compatible extension UI context and runtime event binding |
| `server/pi-api/fs-browser.js` | Local directory browsing and path normalization |
| `server/pi-api/git-review.js` | Read-only Git status, bounded per-file diffs, and watcher Git queries |
| `server/pi-api/git-review-watch.js` | Shared recursive review watchers and review-change WebSocket clients |
| `server/pi-api/memories.js` | Memory Inspector queries and mutations |
| `server/pi-api/rollout-feedback.js` | Assistant-entry feedback storage and DTO application |
| `server/pi-api/subagents.js` | Agent discovery, scoped model overrides, global/session batch size, and effective configuration |
| `server/pi-api/vision.js` | Vision-model overrides, delegation records, and parent-context replacement |
| `server/pi-api/export-renderer.js` | HTML export rendering, export CSS, and preview code |
| `server/pi-api/terminal.js` | PTY and terminal WebSocket lifecycle |
| `server/pi-api/http.js` | JSON body, JSON response, and HTML response helpers |

## Route groups

The router has these main route groups:

- session list, normal or research creation, detail, lookup by path, rename, delete, and export
- runtime state and active-session selection
- prompt, queue mutation, shell, compaction, edit, fork, Reset to here, reload, model, thinking, service tier, mode, and interrupt
- filesystem browsing
- read-only Git review
- Memory Inspector operations
- rollout feedback
- selected-backend trace summaries, paged detail, bookmarks, and capture configuration
- subagent configuration and subagent execution
- vision configuration, resolution, and child execution
- backend-wide runtime cleanup, automatic-title, and certificate settings, global pi provider/model/MCP configuration, and private authentication operations
- HTTP rejection of event requests without a WebSocket upgrade

See the [API reference](../reference/api) for route contracts. Compare that page with `server/pi-api/router.js` when route behavior changes.

## Scoped and legacy operations

The frontend uses `/sessions/:id/<action>` for most runtime operations. The server resolves or creates a runtime handle for that ID.

Legacy routes such as `/prompt`, `/bash`, and `/compact` use `requireActiveHandle()`. Keep them for compatibility, but do not use them for new frontend work.

Fork uses a session-scoped route and creates a separate runtime. Reset to here also uses a session-scoped route. Both retain legacy active-session routes for compatibility. Leyline terminal connections resolve the requested session ID. Unscoped terminal requests use the active runtime CWD for compatibility.

This distinction matters when windows use the same backend. Scoped operations and Leyline terminal connections select the requested handle. Active operations depend on the latest selection in that backend process.

## Git review

The review routes run Git against the requested project directory on the selected backend. They do not use a pi runtime handle.

The status response keeps at most 500 changed paths. A text diff larger than 1 MiB or 5,000 lines returns metadata without a patch body.

Git commands disable external diff drivers and text conversion. The browser keeps staged and working-tree patches in separate sections.

`git-review-watch.js` shares one reference-counted recursive watcher per resolved repository root. It batches filesystem events, filters ignored paths, and watches the index, HEAD, current ref, and relevant Git configuration paths separately. This metadata coverage also supports linked worktrees.

The WebSocket at `/api/pi/review/events?cwd=...` sends `review_ready` only after watcher setup, then `review_change` events. `ReviewPane.vue` refreshes on `review_ready`, not socket open. Watchers close after their last client disconnects. Runtime-settled events, completed composer shell commands, and manual refresh remain fallback triggers.

## Runtime construction

`runtime.js` creates cwd-bound pi services with `createAgentSessionServices()`. It then creates the session through `createAgentSessionFromServices()`.

`createAgentSessionRuntime()` wraps the session and services in `AgentSessionRuntime`. Runtime handles retain these objects for background work until explicit or eligible idle disposal.

Normal runtimes load the bundled output-budget, ultrafast, memory, subagent, research, and vision-agent extensions. They also append the Leyline system prompt.

`preferBundledExtensions()` filters conflicts by extension name and designated command or tool names. The service-tier extension keeps its `ultrafast` directory name and runs last, after other provider hooks. Conflict checks include both `leyline-service-tier` and legacy `leyline-ultrafast` commands.

Conversation runtimes also install the named inline Elune capture factory. Home previews use `captureTracing: false`. Settings runtimes and private probes do not install this factory.

Children with an isolated custom system prompt retain output-budget and inline Elune capture. They omit context files, skills, MCP, tool search, and the Leyline prompt. Vision children use this isolated path.

Conflict filtering removes discovered legacy `pi-elune` extensions while inline capture is present. Construction and explicit reload apply the filter. See [Elune integration](../integrations/elune) for capture lifecycle, usage, durability, and shutdown limits.

`services.modelRuntime` wraps pi's public `ModelRuntime` through `custom-providers.js`. It supplies model lookup, available snapshots, authentication state, and streaming with optional credentials. The wrapper uses public SDK methods and native providers, without patching SDK internals.

Research creation writes a `leyline-research` marker before extension binding. The bound extension adds its lead protocol and exposes `research_update` only for that session.

Runtime creation installs a vision context transform on the session agent. The transform replaces matched images with saved file paths and `vision_agent` instructions. After matching tool calls exist, it uses neutral text instead of another instruction.

Leyline retains `one-at-a-time` delivery for native pi steering and follow-up inputs.

## Idle runtime cleanup

`idle-runtimes.js` owns `GET` and `PUT /api/pi/settings/runtime` values and a 15-second cleanup sweep. `runtime.idle_timeout_minutes` uses the selected backend's `leyline_settings` table. The default is 5 minutes. Integers from 0 through 1440 are valid. `0` disables cleanup. See [Runtime settings](../reference/api#runtime-settings) for validation and responses.

Runtime access and events update the last-used time. Each sweep also resets that time for protected handles. Protections include:

- an open runtime WebSocket whose selected `sessionId` exactly matches the handle
- in-flight scoped API requests, initialization, extension binding, reload, branch changes, model or service-tier changes, and disposal
- prompt locks, pending prompt setup or handoff, Stop, compaction, and shell execution
- subagent execution controllers or signals
- editable tasks, including held tasks, native queued inputs, and pending bash messages
- a non-idle or retrying session, pending tool calls, or pending extension confirmations

An unscoped WebSocket, compact background snapshots, or the legacy active selection alone does not protect a handle. The sweep starts with runtime construction and stops during backend shutdown. Settings changes apply without a restart.

`runtime.js` suspends eligible handles through the normal interruption and disposal path. Disposal shuts down extensions and native MCP resources, releases capture bindings, and emits `runtime_removed`. It clears the legacy active selection if that handle was active. It does not delete JSONL history.

`idleSessions` retains lightweight session metadata, the branch leaf and last entry ID, model, thinking level, exact service tier, and activity state. For a session without an existing file, it also retains the manager. List and detail reads use this state without recreating connections.

Reopening or a scoped action rebuilds cwd-bound services and MCP connections. The saved leaf restores only when the persisted last entry still matches. Otherwise, the updated file takes precedence over temporary restoration state. Model restoration depends on availability and configured authentication.

The exact premium tier restores only for the same provider/model, with eligible current authentication and the `leyline-service-tier` command available. Otherwise, the runtime stays Standard. Backend restart discards these temporary records, but retains persisted history and settings.

## Native MCP and tool search

Normal runtimes add `createMcpExtension()` and `createToolSearchExtension()` as replaceable built-in extensions through `extensionFactories`. Pi owns server configuration, connections, discovery, and tool execution.

Leyline activates `tool_search` at session start unless `defaultTools` contains `-tool_search`. Tools that it loads produce normal system-role tool deltas.

Leyline does not load Codemode and always excludes `codemode` from the active tool set. Do not reintroduce it when updating SDK integration.

## Pi Settings

`capabilities.piSettings` enables Runtime, Certificates, Models & providers, and MCP servers. These routes run on the selected backend. Display preferences and connection records remain on the native app backend.

Pi owns the global configuration files resolved through `getAgentDir()`. Leyline edits `models.json` and `mcp.json`, while native SDK authentication owns credentials. Subagent and vision overrides, automatic-title settings, runtime cleanup settings, and certificate trust remain in Leyline SQLite. A provider target selects a cwd for extension discovery, not a project configuration file.

`pi-config.js` preserves unknown fields, supported comments, formatting, and symlink targets. Writes require the whole-file revision, acquire a lock, and replace the file atomically after another revision check. Invalid files block saves. Provider/model inventories omit saved secrets. MCP inventories omit arguments and header/environment values and redact sensitive URL parts.

See [Pi Settings routes](../reference/api#pi-settings-routes) for exact fields, methods, revisions, operation shapes, and errors. This API is deliberately smaller than pi's configuration schema. General preferences, model-picker visibility, project MCP editing, and Codemode configuration are outside this surface.

### Backend TLS trust

`tls-trust.js` owns `GET` and `PUT /api/pi/settings/tls`. Its `tls.*` keys use `leyline_settings` in the selected backend's `memory.sqlite`. They have no project or session overrides. See [Certificate settings](../reference/api#certificate-settings) for fields, limits, validation, and errors.

Both startup paths call `applyTlsTrustAtStartup()` before accepting requests. Vite calls it in `piApi().configureServer()` in `server/pi-api/index.js`. The standalone/Electron server calls it in `startLeylineServer()` in `server/leyline-server.js`. The helper reads saved settings and applies the merged trust store. Startup logs report certificate totals and any saved-file errors.

Store rebuilds start from the immutable `rootCertificates` list. They add `getCACertificates('extra')` captured at module load, optional `getCACertificates('system')` roots, and validated custom PEM blocks. The store deduplicates normalized PEM text. It does not use mutable `getCACertificates('default')` as the bundled baseline. This prevents removed custom authorities from returning during later rebuilds.

GET builds a settings view without applying trust. Its `appliedCount` describes that built store. PUT validates the candidate store and snapshots the actual active CA list through `getCACertificates('default')`. It applies the candidate before the SQLite write. A database write failure restores that exact snapshot.

Changes apply to new backend Node TLS connections, including provider requests and provider/MCP management checks. Existing connections can remain open. Chromium networking, inbound server HTTPS, and the separate dictation process use other configuration. See [TLS certificate trust](../reference/environment#tls-certificate-trust) for startup CA variables and flags.

### Model metadata and catalog lookup

`provider-settings.js` exposes effective model metadata and saved overrides, including `thinkingLevelMap` and `compat.supportsDeveloperRole`. Model writes and connection-test drafts accept both fields. A supplied map replaces the holder's map, and `{}` removes it. Missing levels inherit pi/provider behavior. Developer-role `null` removes only that flag, preserving other compatibility fields. Writes remove empty overrides and otherwise empty provider entries. See [Model definitions and overrides](../reference/api#model-definitions-and-overrides) for accepted values.

`GET /settings/catalog/models` uses the target's settings runtime and `getAllModels()`. It matches each whitespace-separated query word against model ID, name, and provider ID without case sensitivity. Queries allow at most 256 characters. Chat-only results sort by model ID and provider ID, then stop at 20 entries. The response includes metadata, API format, and compatibility fields, but no costs, URLs, authentication, or headers.

Ordinary lookup uses the backend runtime cache. Explicit `refresh=1` replaces the settings runtime, reloads extensions, and requests a forced network refresh. Refresh checks returned `errors`, `aborted`, and runtime errors, as well as thrown errors. If the SDK refresh fails, lookup adds a warning and searches the cached catalog. Runtime acquisition failures remain request errors. Neither lookup nor refresh changes a live conversation. See [Catalog lookup](../reference/api#catalog-lookup) for the target and response contract.

### Optional provider credentials

API keys are optional for custom compatible providers. Saved models remain selectable without credentials, and the endpoint reports any authentication failure. Removing an `apiKey` reference from `models.json` does not remove a stored credential.

`custom-providers.js` registers native adapters only for custom providers without an existing built-in, extension, or OAuth registration. Native credentials, extension behavior, and OAuth remain authoritative. Each adapter's native `refreshModels()` reloads configured metadata and publishes it through `context.publish()`. This keeps the catalog synchronized even when an extension calls SDK refresh directly.

The public `ModelRuntime` wrapper resolves native authentication and streams through the selected provider. SDK-required placeholders stay internal: Leyline never persists them or sends them over HTTP. Request cleanup removes placeholders even with duplicate or case-variant headers or an explicit empty caller key. Keyless Google requests use an empty `x-goog-api-key` header.

### Provider runtime ownership

`provider-settings-runtime.js` caches separate settings runtimes by resolved cwd. Each request acquires a lease and releases it in `finally`. These runtimes never replace conversation handles.

The pool permits four contexts, including contexts still retiring. It retires unused contexts for capacity. A leased context cannot be replaced by Refresh. Construction, credential metadata reads, `checkAuth()`, `getAvailable()`, and catalog refresh have 15-second bounds. Inventory requests also use a 15-second signal. Interactive authentication uses the longer operation lifetime. Disposal waits up to three seconds before session disposal. A late or failed creation remains owned until cleanup finishes.

Each resource-loader extension set receives an in-memory session owner, including failed creation and cold Refresh paths. `AgentSessionRuntime.dispose()` supplies shutdown before replacement. Reusing a loader does not permit an extension set to escape shutdown. Lifetime signals block late provider publication after retirement.

Ordinary provider reads refresh authentication snapshots with `allowNetwork: false`. `GET /settings/providers?refresh=1` replaces the settings runtime and reloads extension registrations. The provider `refresh` action also requests a forced network catalog refresh. Neither action refreshes live conversation catalogs.

Provider mutations, authentication, and conversation construction share a process-level lock. Native login can write shared credentials immediately. Before login, `assertProviderRoutes()` compares provider model APIs and URLs across open, background, hidden, and constructing runtimes. A mismatch blocks login until affected sessions reload or the backend restarts. This prevents new credentials from reaching an old endpoint.

Existing work is not silently aborted or reloaded. A save refreshes only its settings runtime. `GET /state?cwd=...&refresh=1` builds and disposes a fresh Home preview without changing conversation catalogs.

Pi retains cached Radius gateway URLs after reload. Leyline rejects changes that alter or remove an existing Radius base URL. A different gateway requires a different provider identity. Provider IDs cannot contain `/`, but model IDs can.

### Provider connection tests

The provider `test` action runs as a private, cancellable settings operation. `provider-settings.js` validates requests and acquires the settings runtime lease. `provider-connection-test.js` owns the probe, temporary draft runtimes, authentication resolution, request limits, and controlled result messages.

Saved tests use the selected model's saved settings. Draft tests combine current configuration with unsaved provider or model form values. The draft carries the whole-file revision, and a mismatch fails the operation before the probe. A provider editor supplies a test-only model ID, which is not saved.

Draft map and developer-role resets must match Save. `source.getModel()` already includes saved overrides, so it cannot supply a removed override's inherited value. `inheritedMetadata()` recovers defaults from custom definitions, raw native models, or static legacy extension definitions. Override changes that remove no saved entries can use the effective model.

For built-in defaults, the probe creates a separate offline `ModelRuntime` with a public `InMemoryModelsStore`. It seeds that store from a read-only snapshot of the selected backend's pi `models-store.json`. SDK refresh applies the normal catalog timestamp rules. This recovery never writes drafts, credentials, or the live catalog cache. Dynamic legacy extensions with unavailable defaults cannot test resets. The error directs the user to Save, then test the saved model, without rerunning extension hooks.

Draft tests do not write configuration, change live runtimes, or add transcript entries. A draft API-key replacement stays runtime-only. Removing a draft key reference still preserves native stored credentials. Native extensions and OAuth continue to control authentication. OAuth resolution can refresh shared tokens, so route guards run before authentication and virtual-model routing. Draft endpoint or API changes cannot reuse a stored OAuth credential.

The probe requests 16 output tokens with `maxRetries: 0` and a 30-second deadline. This deadline starts inside the probe, after queueing and settings runtime acquisition. Tests refuse these paths rather than make an unsafe request:

- Codex (`openai-codex-responses`), which cannot enforce the output limit
- direct OpenAI Responses with ChatGPT-subscription authentication, for the same reason
- OpenAI Responses models (`openai-responses`) with `supportsMaxOutputTokens: false`
- Bedrock (`bedrock-converse-stream`), whose native retries cannot be disabled

Virtual models resolve to a physical model before its support checks and probe. Provider drafts require a physical test model. Tests can incur a charge or load a local model. Failure does not block saving or model selection. Results expose duration and HTTP status when available, with controlled errors instead of raw provider payloads.

### Private authentication operations

`settings-operations.js` owns bounded, process-local operations. Clients poll snapshots and answer the current prompt ID, or request cancellation. The SDK supplies provider text, secret, select, manual-code, authorization-URL, and device-code interactions.

Settings prompts do not use `extension-ui.js`, the shared runtime WebSocket, or transcript entries. The initiating component retains its backend URL throughout polling and cancellation. A credential write can finish before cancellation, so cancellation cannot promise rollback.

### Native MCP management

MCP listing reads global configuration without connecting or resolving secrets. Check and login use a disposable worker with an in-memory session and only `createMcpExtension()`. The worker invokes the native `/mcp` command through a private UI context. It reports temporary connections, not conversation connection status. Logout neither connects nor resolves configuration secrets.

Node's default CA configuration is thread-local. For each management worker, `mcp-settings.js` passes the parent's actual `getCACertificates('default')` snapshot in `workerData.caCertificates`. `mcp-settings-worker.js` applies that array through `setDefaultCACertificates()` before connection setup. Workers do not rebuild trust from saved paths. The snapshot preserves the parent's active trust and startup choices.

The worker owns native `StdioTransport` and `StreamableHttpTransport` adapters. It tracks adapters before connection setup, command processes, prompts, and child processes. Cancellation reaches initialization as well as established connections. Deadlines bound native OAuth work and secret commands. Normal HTTP cleanup keeps a bounded signal available for session DELETE requests.

Resolve the public `@earendil-works/pi-mcp` package from the coding-agent package context. This keeps transport error classes identical to those used by native MCP authentication. A separate dependency instance can break native error checks.

Only controlled native diagnostics reach operation snapshots. Tool metadata excludes resolved configuration secrets and OAuth access tokens. HTTP operation locks use normalized server URLs, so aliases share the lock used for the same native credential identity.

New MCP entries default to `deferred`. The editor offers `deferred`, `direct`, and `hidden`, while preserving existing exposure values. Leyline never loads or enables Codemode.

## Browser confirmations

`extension-ui.js` adapts `ctx.ui.confirm()` to pending requests in `extensionUi.confirmations`. Each request has an ID, title, message, and optional expiry.

`ExtensionConfirmations.vue` shows **Confirm** and **Cancel**. Replies use the session-scoped `/sessions/:id/extension-confirmations/:requestId` route. HTTP and WebSocket snapshots carry the current pending requests.

Confirmation replies apply only to the current session binding. Abort, expiry, reload, or disposal resolves pending requests as false. Stale replies cannot approve replacement runtimes.

<a id="ultrafast"></a>

## Service tiers

The bundled `.pi/extensions/ultrafast/index.js` owns service-tier state and provider hooks for Standard, Fast, and Ultrafast.

### Eligibility and controls

`lib/ultrafast.js` defines explicit model and authentication eligibility. Leyline does not discover tier eligibility from a dynamic Codex catalog.

| Tier | Exact model IDs |
| --- | --- |
| Standard | All models |
| Fast | `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` |
| Ultrafast | `gpt-6-astra`, `gpt-6.1-sol` |

Both premium tiers require one of these paths:

- `openai-codex` with `openai-codex-responses`
- `openai` with `openai-responses` and API-key authentication

The `openai` subscription path is ineligible. Ultrafast-capable models also offer Fast. Model DTOs expose the available values in `serviceTiers`, always starting with `"standard"`. The legacy `supportsUltrafast` boolean remains for compatibility and reports eligibility, not the selected tier.

`POST /api/pi/sessions/:id/service-tier` accepts `{ tier }`, where `tier` is `"standard"`, `"fast"`, or `"ultrafast"`. The runtime validates eligibility and calls `/leyline-service-tier <tier>` through `session.prompt()`. Every change requires the command, including selection of Standard. The command and status key are both `leyline-service-tier`. The status contains the selected lowercase tier.

The response is `{ ok: true, active }`. Read `active.state.extensionUi.statuses["leyline-service-tier"]` from the revision-accepted snapshot to confirm the result. Cancellation or runtime replacement can leave the tier unchanged despite `ok: true`.

The legacy `/leyline-ultrafast on|off` command and `POST /api/pi/sessions/:id/ultrafast` with `{ enabled }` remain only for compatibility. `on` or `true` selects Ultrafast. `off` or `false` selects Standard, including from Fast. The legacy `leyline-ultrafast` status is `"on"` only for Ultrafast and `"off"` otherwise. Both commands stay hidden from the slash picker.

### Lifecycle

Standard is the default. The choice belongs to the current runtime, not durable settings or session history.

- Model changes, explicit reloads, and reset navigation select Standard. New sessions and forks start Standard.
- Same-runtime, same-model retries and prompt edits retain the exact tier. The edit path restores it through the extension command before generation and after rollback.
- Idle-runtime restoration retains the exact tier only when the provider/model, current eligibility, and command availability permit it. See [Idle runtime cleanup](#idle-runtime-cleanup).

Model and service-tier changes use the prompt-submission lock outside active compaction. They do not require an idle model run. Model changes hold the lock through asynchronous authentication. Ordinary new prompts remain accepted in the editable queue during either change. Automatic dispatch waits for the change to finish. Both paths release their flags and reschedule the queue in `finally`.

### Request boundary and cleanup

Tier overrides apply only to normal agent turns. Compaction and branch summaries receive no premium overrides, including automatic compaction during a turn. Fast and Ultrafast stop cache warming through `cache_warming_decision`.

`runtime.js` copies each request's options and emits `leyline:provider-request` only when the session ID and active agent signal match. `AsyncLocalStorage` retains that options object's identity during the provider call. `leyline:request-boundary-ready` supplies the extension with a function that reads the current object.

The extension uses that object as a `WeakMap` key for a request snapshot of the model, base costs, signal, and tier. Payload and response hooks check the captured model and signal. Header hooks require the same request identity. These checks prevent concurrent summary requests from inheriting premium headers. Premium selection requires the Leyline request boundary.

For eligible normal requests, the payload and Codex routing header agree:

| Choice | `service_tier` | Codex `x-codex-routing-hint` |
| --- | --- | --- |
| Standard | `"default"` | `model=<id>` |
| Fast | `"priority"` | `model=<id>;tier=priority` |
| Ultrafast | `"ultrafast"` | `model=<id>;tier=ultrafast` |

Direct OpenAI `gpt-6-astra` requests add `OpenAI-Service-Tier: ultrafast` only for Ultrafast. Standard and Fast clear that header.

The extension resolves public `calculateCost()` and `cleanupSessionResources()` from the coding-agent package's own `@earendil-works/pi-ai` dependency. A separate root dependency can have a different cleanup registry. This resolution reaches the SDK's cached transports without private imports or dependency patches.

Tier transitions and model changes request `cleanupSessionResources(sessionId)`, including Standard-to-Standard model switches. Cleanup closes cached connections so later requests use current routing headers. Connection cleanup runs immediately when the session is idle. Active requests defer cleanup to safe turn, provider, compaction-completion, or settlement boundaries.

### Cost estimates

The response hook reads `response.id` and `response.service_tier` from `response.completed`, `response.done`, or `response.incomplete`. Recognized response tiers are `default`, `priority`, `fast`, and `ultrafast`.

- Codex uses the requested tier when the response tier is absent or `default`.
- Direct OpenAI honors an explicit `default` downgrade. If the tier is absent, only a Fast request falls back to its requested `priority` tier. An absent tier does not confirm direct OpenAI Ultrafast.
- Other recognized response tiers take precedence over the requested tier.

At `message_end`, cost adjustment requires matching `message.responseId`, provider, and model, plus usage data. `calculateCost()` first recalculates base costs from the request snapshot. The extension then applies one multiplier to each cost field, including the total. It does not multiply already-adjusted native costs or change token counts.

| Resolved response tier | Cost multiplier |
| --- | --- |
| `default` | 1 |
| `priority` or `fast` | 2, or 2.5 for the exact model ID `gpt-5.5` |
| `ultrafast` | 6 |

The Fast factors match native pi pricing. The extension supplies the Ultrafast factor. These values produce cost estimates, not authoritative billing amounts.

## Pending prompts

Each runtime handle owns a shared, editable **Up next** queue from `prompt-queue.js` for prompts and shell commands. Items retain stable IDs, text, images, shell metadata, and prompt handoff IDs until submission acceptance.

Ordinary input during a run enters this queue. A `followUp` request also enters the queue when idle. Registered extension commands still execute through pi directly.

The queue submits one task when `session.isIdle`. Shell execution, prompt setup, Stop, reload, initialization, compaction, branch changes, and model or service-tier changes block automatic dispatch. Settlement and lifecycle completion schedule another dispatch check.

Prompt tasks use the prompt lock, vision preparation, and `session.prompt()`. They retain the original handoff ID for transformed-input reconciliation. Shell tasks use native bash execution instead.

At final settlement, the recorded runtime outcome determines whether failed work holds the queue. Do not infer success from the last projected assistant message: recovery can omit failed responses from model context.

`preflightResult` marks acceptance. `started` checks cancellation before a new run begins. `queued` and `handled` are irreversible acceptance, even if cancellation arrived during an input hook. Accepted items leave the editable queue.

Steer hands an item to pi's native delivery path. Leyline does not clear or replay native queues to implement edits or reordering.

Stop holds unsent tasks. Editing also holds the queue and cancels any unaccepted queue submission; saving does not resume it. An empty queue clears its hold and error. Runtime reload retains pending tasks held, but backend restart discards them.

Queue mutations use `promptQueue.revision` and reject stale requests with `409`. Runtime snapshots have a separate `snapshotRevision` for HTTP/WebSocket ordering. Snapshot DTOs expose pending text and image counts, not image bytes.

### Shell tasks

Both `POST /api/pi/sessions/:id/bash` and legacy `POST /api/pi/bash` return `{ ok: true, queued: true, active }`. This confirms queue acceptance, not completion. Multiple commands can wait beside prompts while another command or model run is active.

Shell items expose `shell: true` and `imageCount: 0` in queue DTOs. Edits must keep `!` or `!!` and a nonblank command. Commands can move or be removed but cannot steer. `!!` excludes the recorded output from future model context.

`executeQueuedBash()` first calls native `extensionRunner.emitUserBash()` with `user_bash`, command, cwd, and context exclusion. A hook failure blocks execution. Returned operations go to `session.executeBash()`. A supplied result goes to `session.recordBashResult()`. Neither path calls `session.prompt()` or starts an assistant reply.

Acceptance removes the item after hooks succeed and just before execution starts. Pre-execution failure retains it, holds the queue, and sets its error. Cancellation, nonzero exit, or later execution failure holds remaining tasks. Stop aborts native bash execution.

Full snapshots expose `isBashRunning` and the latest `bashExecution`. Start/end events carry that execution record. Native update events carry deltas plus the current output tail and revision. Its `id` identifies the live execution. Its `entryId` identifies the exact new native `bashExecution` message in the session manager. Pi can defer writing that entry to disk. Reconciliation uses that entry ID, not matching command text. See [Queued shell events](./realtime-events#queued-shell-events).

## Automatic session titles

`session-titles.js` stores backend-wide settings through `GET` and `PUT /api/pi/settings/session-titles`. Titles default to off, with no model selected and the lowest supported thinking level. The three `session_titles.*` keys use `leyline_settings` on the selected backend. There are no project/session overrides or conversation-model fallback. See [Session-title settings](../reference/api#session-title-settings) for exact fields and validation.

Only a newly created ordinary conversation receives a generator. Its first `started` prompt preflight prepares the generator once. Generation starts after that user message ends, beside the conversation request. Blank text, existing user or session-info records, and research markers suppress generation. Existing/resumed sessions, forks, research sessions, and children do not receive a generator.

The request calls `ModelRuntime.streamSimple()` with its own short instruction and at most 1,024 characters of the submitted text. It includes no session prompt, history, context files, tools, or images. It does not call `session.prompt()`, append an assistant message, or change the conversation model or thinking level.

A 30-second deadline starts at preparation. The request sets `maxRetries: 0`, and streamed text and thinking have limits. The prompt requests 3 to 7 words and at most 80 characters. The response guard requires a normal stop and nonempty title text of at most 100 characters without control characters. It removes a leading `Title:` or Markdown heading prefix and surrounding quote or backtick characters.

A valid result uses native `session.setSessionName()`. Manual rename or explicit clear cancels pending work and takes precedence. Reload, edit, reset, disposal, disabling titles, or changing the title model/thinking also cancels pending work. Failures leave the normal label. Runtime snapshots expose `titleGenerating` separately from `isStreaming` and include the live name in `session`.

## Session writes

Use pi runtime and session methods for normal writes:

- `session.prompt()` for prompts and queued prompt messages
- `session.executeBash()` for queued shell commands after native `user_bash` hooks, or `session.recordBashResult()` for a hook-supplied result
- `session.compact()` for compaction
- `session.navigateTree()` for edits
- `SessionManager.createBranchedSession()` and a new runtime for forks, without replacing the source runtime
- `session.setModel()` and `session.setThinkingLevel()` for runtime controls

Rename appends a `session_info` record. Delete moves the JSONL file to Leyline trash.

Research state uses custom JSONL entries for its objective, plan, phase, threads, sources, report, and errors. The backend folds these entries from the active branch.

Reset to here is the explicit exception. It replaces the manager entries with the retained branch and rewrites the current file.

## Application metadata

Leyline metadata uses `memory.sqlite` under each backend's `LEYLINE_MEMORY_DIR`, or `~/.local/share/leyline/`.

Backend connection definitions, the default connection, and display preferences belong to the native app backend. A window stores its active connection ID in `sessionStorage`. File editor settings, memory, feedback, agent overrides, automatic-title settings, runtime cleanup settings, and certificate trust belong to the selected backend.

Trace capture configuration also belongs to the selected backend. Its `tracing.enabled` key uses `leyline_settings`, while trace records use a separate `elune/elune.db`. See [Elune integration](../integrations/elune#storage-and-configuration).

Global Agent defaults, Project settings, and Session details fix the override scope in the UI. They use the existing subagent and vision routes. Pi provider/model/MCP configuration remains in pi-owned global files, not these SQLite tables.

Memory operations enforce global, project, and session visibility. The Memory Inspector can create, update, archive, restore, and permanently delete visible rows.

Rollout feedback stores `helpful` or `unhelpful` for an assistant entry. It can also store an optional feedback note.

Subagent configuration discovers definitions in `~/.pi/agent/agents` and the nearest project `.pi/agents` directory.

Subagent model precedence is session, project, global, then the agent definition. Vision-model precedence is session, project, then global. Session overrides for both features copy to a new fork.

Subagent batch size uses only global and session scopes. `subagents.js` validates positive safe integers and resolves session values before the global default of 4. The global key `subagents.batch_size` uses `leyline_settings`. Session values use `subagent_batch_overrides`, copy to forks, and clear when session/project deletion removes those sessions.

The subagent extension owns batch scheduling. Each implicit single-call group or explicit parallel call reads its effective size once. Changes affect future groups and calls without reload. Direct child execution has no backend batch limiter. See [Subagent scheduling](../integrations/subagents#batch-scheduling-and-configuration) and the [API contract](../reference/api#subagent-routes).

The subagent and vision execution routes create child pi sessions. They write an explicit marker before they start each child runtime. Normal subagents retain the normal runtime resources and their tool policy. Vision children use an isolated prompt, output-budget and inline capture, an empty tool allowlist, and a session-local image setting override.

The subagent route requires a nonblank `title`. It saves the title through `SessionManager.appendSessionInfo()` before runtime startup. The isolated vision path supplies `Image inspection` as its title.

`session-summary.js` reads child titles and agent names from parent subagent results, with task labels as a fallback for older sessions. `toSessionDto()` includes this data as `subagentChildren` for sidebar grouping. Runtime snapshots omit unavailable metadata so client merges can retain known labels.

## Research state projection

The research extension writes `leyline-research` custom entries. `research-state.js` folds matching entries, normalizes source identity, and derives progress counts.

Session DTOs include normalized research state. Extension events also trigger active-session and extension UI broadcasts.

Before research completion, `research-citations.js` checks each numeric Markdown citation against a non-excluded ledger source.

The browser does not reconstruct research state from transcript text. It uses the projected backend state.

## Frontend client

`src/lib/backend.js` supplies the active backend base URL for runtime HTTP,
runtime and Git review WebSockets, terminal WebSocket, and export requests. `src/lib/pi-api.js` owns runtime fetch
calls and request field names. `TlsTrustSettings.vue` uses `src/lib/pi-api.js` for certificate settings. `src/lib/pi-settings-api.js` owns provider, model, MCP, and private operation requests.

`src/lib/leyline-api.js` manages the native connection registry and app settings. It also checks `GET /api/pi/info` before a switch.

`src/lib/trace-client.js` binds trace requests to the selected backend and subscribes to notices through the existing runtime WebSocket adapter. It aborts owned requests and removes subscriptions when the view closes. Trace capture settings use `/api/pi/traces/config`, not the native app settings routes.

The backend information response gates trace views with `tracing`. It gates the research control with `research`. It gates Git review with `review` and automatic watching with `reviewWatch`. Runtime, Certificates, Models & providers, and MCP servers require `piSettings`.

`ReviewPane.vue` loads review data through `src/lib/pi-api.js` and opens the review WebSocket through `openEventSocket()` in `src/lib/event-socket.js`.

Vision configuration and parent prompt requests use `src/lib/pi-api.js`. For a parent model without image input, the backend saves attachments and the parent calls `vision_agent` during its turn.

`useTranscriptPreferences.js` reads and writes the thought display default. UI components and composables do not construct transport URLs directly.
