# API reference

Leyline serves the runtime API under `/api/pi`. The native backend also serves the connection registry and app settings under `/api/leyline`.

These APIs have no authentication or cross-user access control.

Successful runtime requests usually return `200`. A connection create request
returns `201`. A CORS preflight request (`OPTIONS`) returns `204`.

## Conventions and status behavior

JSON requests use `Content-Type: application/json`. Most routes ignore extra fields. Pi Settings rejects unsupported provider, model, target, and editable MCP fields. A field marked `?` can be omitted. JSON serialization omits object properties whose value is `undefined`. Most routes have no explicit JSON body-size limit. Network-access and pinned-session routes set their own limits.

Most errors have this envelope:

```json
{ "error": "Error message" }
```

Status behavior is:

- `400` is used for connection, setting, queue, file-action, or confirmation validation. Missing required query values on session lookup or Git review routes also return `400`.
- `403` rejects a browser origin that the server does not allow.
- `404` is used for an unknown runtime, native app route, setting key, session, or trace.
- `405` is used when a known route receives an unsupported method.
- `409` rejects stale queue or configuration revisions, expired confirmation replies, and conflicting Settings operations.
- `426` rejects an ordinary HTTP `GET` to an event endpoint that requires a WebSocket upgrade.
- Pi Settings also uses `429` for its operation limit and `503` for unavailable or busy runtime resources. See [Pi Settings routes](#pi-settings-routes).
- Trace routes use `400` for invalid requests and `503` for unavailable storage, configuration failures, or shutdown. See [Trace routes](#trace-routes).
- `500` is used for thrown runtime errors. This includes malformed JSON on most runtime routes, SDK errors, missing memories, and some missing sessions.

The current status codes do not distinguish all client errors from server
errors. Clients must read the `error` value.

HTTP routes and all WebSocket upgrades use the same origin policy.
Same-origin and loopback browser clients work by default. Use
`LEYLINE_SERVER_ALLOWED_ORIGINS` for other frontend origins. Requests without
an `Origin` header remain allowed.

## Common response objects

### Session summary

```text
SessionSummary = {
  id: string,
  path: string,
  cwd: string,
  name?: string,
  parentSessionPath?: string,
  isSubagentSession: boolean,
  subagentChildren?: { id: string, agent: string, task: string }[],
  research: ResearchSummary | null,
  firstMessage: string,
  messageCount: number,
  modified?: string,
  timestamp?: string
}
```

`timestamp` is the session creation time as an ISO string. `modified` is the latest user or assistant message time.

For persisted sessions without message times, `modified` uses the session creation time or file modification time. `messageCount` counts all message records. `firstMessage` is limited to 140 characters.

Session detail and open-runtime summaries use the research objective for `firstMessage` when the branch has no user message. For marked children, `firstMessage` removes the agent prompt wrapper when it contains a `Task:` marker.

`subagentChildren` contains up to 50 child IDs, agent names, and display labels from persisted subagent results. The `task` field uses the explicit title when available, with older task labels as a fallback. Labels are limited to 120 characters. Runtime snapshots omit the field when no task metadata is available. Clients should preserve existing metadata when the field is absent.

Use `isSubagentSession` with `parentSessionPath` to identify sidebar children. A parent path alone can describe a normal fork.

```text
ResearchSummary = {
  sessionId: string,
  status: "running" | "complete" | "error",
  phase: "plan" | "gather" | "synthesize" | "report",
  objective: string,
  reportTitle: string,
  reportEntryId: string,
  threadCount: number,
  completedThreadCount: number,
  sourceCount: number,
  citedSourceCount: number,
  excludedSourceCount: number,
  updatedAt: number
}

ResearchThread = {
  id: string,
  title: string,
  task: string,
  status: "queued" | "running" | "done" | "error",
  summary: string,
  sourceIds: number[],
  childSession: { id: string, path: string, cwd: string } | null,
  error: string,
  startedAt: number,
  completedAt: number
}

ResearchSource = {
  id: number,
  key: string,
  url: string,
  path: string,
  title: string,
  publisher: string,
  publishedAt: string,
  kind: string,
  status: "candidate" | "cited" | "excluded",
  threadIds: string[],
  claim: string,
  evidence: string,
  exclusionReason: string
}

ResearchState = ResearchSummary & {
  version: 1,
  strategy: string,
  note: string,
  threads: ResearchThread[],
  sources: ResearchSource[],
  citedSourceIds: number[],
  error: string,
  createdAt: number,
  completedAt: number,
  reportRequestedAt: number,
  lastEventId: string
}
```

`ResearchSummary` omits thread and source records from session-list responses. Session detail and active runtime responses use `ResearchState`.

### Session detail

```text
SessionDetail = {
  session: SessionSummary & {
    sessionFile: string,
    messageCount: number,
    contextTokens: number | null,
    modified: string,
    created: string,
    contextUsage?: object,
    research: ResearchState | null
  },
  entries: TranscriptEntry[]
}
```

A transcript entry is a projected `message`, `tool`, `system`, `model-change`, `event`, or `summary` object. Entries include `id`, `type`, `timestamp`, `copyText`, `rolloutFeedback`, and `rolloutFeedbackText` where applicable.

Message entries include role, text, and text, image, or thinking blocks. A completed report message can include `researchReport`. Tool entries can include file, diff, patch, image, bash, subagent, and research-thread data.

System messages use this projection:

```text
SystemTranscriptEntry = {
  id: string,
  type: "system",
  label: "System",
  code: string,
  sections: Array<{ name: string, text: string, removed: boolean }>,
  toolsAdded: Array<{ name: string, description: string }>,
  toolsRemoved: string[],
  text: string,
  messageTimestamp?: number,
  timestamp: string,
  rolloutFeedback: "helpful" | "unhelpful" | "",
  rolloutFeedbackText: string
}
```

`sections` contains prompt-section changes. A removed section has `removed: true` and empty `text`. Tool changes use name-and-description records for additions and names for removals.

`code` is a summary, such as `tools added: vision_agent`. A nonremoved `preamble` section produces a `full prompt` summary with section and optional tool counts.

`text` joins string message content and readable descriptions of prompt and tool changes. Content arrays do not contribute to `text`. System entries have no `role`, `blocks`, or `copyText` field. The browser uses `text` for copying.

`messageTimestamp` comes from the system message and uses milliseconds since the Unix epoch. `timestamp` comes from the session-log entry and is an ISO string.

### Active runtime

```text
Active = {
  id: string,
  snapshotRevision?: number,
  path: string,
  cwd: string,
  diagnostics: object[],
  session?: SessionSummary,
  state: {
    model?: Model,
    availableModels: Model[],
    thinkingLevel: string,
    availableThinkingLevels: string[],
    isStreaming: boolean,
    isBashRunning?: boolean,
    isCompacting: boolean,
    titleGenerating?: boolean,
    bashExecution?: BashExecution | null,
    pendingToolCalls: string[],
    pendingConfirmationCount: number,
    steeringMode: string,
    followUpMode: string,
    activeToolCount: number,
    activeToolNames: string[],
    contextUsage?: object,
    slashCommands: SlashCommand[],
    promptQueue?: PromptQueue,
    queuedMessages: { steering: string[], followUp: string[] },
    extensionUi: {
      statuses: object,
      widgets: object,
      notifications: object[],
      confirmations: ExtensionConfirmation[]
    },
    research: ResearchState | null
  }
}

PromptQueue = {
  revision: number,
  held: boolean,
  error: string,
  items: Array<{
    id: string,
    text: string,
    imageCount: number,
    shell: boolean,
    status: "pending" | "sending"
  }>
}

BashExecution = {
  id: string,
  command: string,
  excludeFromContext: boolean,
  anchorId: string,
  startedAt: number,
  status: "running" | "completed" | "error" | "aborted",
  output: string,
  entryId: string,
  revision: number,
  exitCode?: number,
  cancelled?: boolean,
  truncated?: boolean,
  fullOutputPath?: string,
  error?: string
}

Model = {
  id: string,
  name: string,
  provider: string,
  supportsImages: boolean,
  serviceTiers: Array<"standard" | "fast" | "ultrafast">,
  supportsUltrafast: boolean,
  availableThinkingLevels: string[]
}

SlashCommand = {
  name: string,
  description?: string,
  source: "command" | "extension" | "prompt" | "skill"
}
```

The extension UI objects contain status strings, widgets with line arrays, notification records, and pending confirmations.

```text
ExtensionConfirmation = {
  id: string,
  title: string,
  message: string,
  createdAt: number,
  expiresAt: number | null
}
```

Confirmation times use milliseconds since the Unix epoch. `expiresAt: null` means no timeout. `pendingConfirmationCount` counts `extensionUi.confirmations`.

`Model.serviceTiers` lists tiers that the model and authentication method support. It always includes `"standard"`. It does not show the current tier or confirm runtime command availability. `Model.supportsUltrafast` remains a compatibility field. It is `true` when `serviceTiers` includes `"ultrafast"`.

Fast and Ultrafast require a supported model on one of these transports:

- `openai-codex` with `openai-codex-responses`.
- `openai` with `openai-responses` and API-key authentication. Subscription authentication excludes Fast and Ultrafast on this transport.

Ultrafast-capable models also support Fast. See [Choose a service tier](../user-guide/runtime-controls#choose-a-service-tier) for the supported model IDs.

The bundled extension publishes these values in `extensionUi.statuses`:

| Key | Values | Meaning |
| --- | --- | --- |
| `leyline-service-tier` | `"standard"`, `"fast"`, `"ultrafast"` | Authoritative, exact current choice. |
| `leyline-ultrafast` | `"on"`, `"off"` | Compatibility status. Only Ultrafast gives `"on"`. Standard and Fast give `"off"`. |

Use a valid `leyline-service-tier` status first. Without a valid new status, legacy `"on"` means Ultrafast. All other legacy values mean Standard. Missing statuses do not confirm command availability. The bundled `leyline-service-tier` and `leyline-ultrafast` commands do not appear in `slashCommands`.

Standard is the default. The choice applies only to the current runtime. Model changes, explicit runtime reloads, and reset navigation select Standard. A new fork starts at Standard. Retry and prompt edits keep the exact tier when the runtime and model stay unchanged.

Compaction and branch summaries do not receive Fast or Ultrafast overrides. If an extension changes the model during a run, the tier resets at a safe turn or provider boundary. See [Service tiers](../developer-guide/backend-api#service-tiers) for implementation details.

Open-runtime snapshots carry `snapshotRevision` and `session`, including the current session name. Clients reject older snapshots for the same session, from HTTP or WebSockets. Start-screen previews can omit these fields, `promptQueue`, `isBashRunning`, `bashExecution`, and `titleGenerating`.

`titleGenerating` reports the separate automatic-title request, not conversation streaming. Full and compact snapshots retain this flag and the session summary. See [Session-title settings](#session-title-settings).

`isBashRunning` includes shell preparation and execution. Full snapshots include the latest `bashExecution`, or `null` before execution. Rebinding clears completed execution state. Compact snapshots omit `bashExecution` but retain `isBashRunning`.

`BashExecution.startedAt` uses milliseconds since the Unix epoch. `anchorId` is the session leaf before execution. `entryId` is empty until the native `bashExecution` message enters the session manager, then identifies that exact entry. Pi can defer writing it to disk. Use this ID for reconciliation, not command-text matching. During streaming, `output` retains the last 65,536 characters. Completion supplies the executor result, including truncation metadata.

`promptQueue` contains editable, unsent prompts and shell commands. Full images stay on the backend. Each item exposes only `imageCount`. `shell: true` identifies a command with no images. Use `promptQueue.revision` for queue mutations, not `snapshotRevision`.

`queuedMessages` contains read-only display text for inputs already accepted by pi. It is separate from the editable queue.

## Backend information

### `GET /api/pi/info`

Leyline uses this route before it selects a saved backend.

Response:

```text
{
  name: "Leyline",
  version: string,
  apiVersion: 2,
  capabilities: {
    events: true,
    exports: true,
    research: true,
    review: true,
    reviewWatch: true,
    terminal: true,
    fileLinks: true,
    piSettings: true,
    tracing: true
  }
}
```

The frontend rejects a backend when `name` or `apiVersion` is incompatible. API v2 replaces the runtime and Git review SSE streams with WebSockets. Update both frontend and backend together. HTTP commands and the terminal protocol remain unchanged.

The frontend shows the research control only when `capabilities.research` is `true`.

It shows the desktop review control only when `capabilities.review` is `true`. It opens the automatic review stream only when `capabilities.reviewWatch` is `true`.

Local file actions and the Files settings section require `capabilities.fileLinks: true`.

Runtime, Certificates, Models & providers, and MCP servers require `capabilities.piSettings: true`. These categories use the selected backend, even inside the global Settings modal.

Trace views require `capabilities.tracing: true`. Capture configuration and records belong to the selected backend, not the native connection registry.

## Connection registry

The connection registry is part of the native backend. A selected remote
backend does not store the app's connection definitions.

```text
BackendConnection = {
  id: string,
  name: string,
  url: string,
  createdAt: number,
  updatedAt: number
}

BackendRegistry = {
  connections: BackendConnection[],
  defaultConnectionId: string
}
```

`connections` contains saved records. The native backend uses the reserved ID
`builtin` and does not occur in this array.

### `GET /api/leyline/connections`

Response: `BackendRegistry`.

### `POST /api/leyline/connections`

Request:

```text
{ name: string, url: string }
```

Response: `BackendRegistry` with status `201`.

The name is limited to 80 characters. The URL must use HTTP or HTTPS and must
contain a hostname or IP address. It can contain a port and a base path. It
cannot contain credentials, a query, or a fragment.

### `PATCH /api/leyline/connections/:id`

Request:

```text
{ name?: string, url?: string }
```

Response: `BackendRegistry`.

### `DELETE /api/leyline/connections/:id`

Response: `BackendRegistry`.

The native backend and the current window's active connection cannot be removed
through the UI. Another window can remove a saved connection that is active in
this window. Deleting the default saved connection resets the default to
`builtin`.

### `PUT /api/leyline/connections/default`

Request:

```text
{ id: string }
```

Response: `BackendRegistry`.

The ID can identify a saved connection or the native `builtin` connection.

## App settings

App settings are part of the native backend. A selected remote backend does not store these settings.

The `/api/leyline/settings/:key` routes accept only `ui.thinking_default`. Network access uses its own routes below.

### `GET /api/leyline/settings/ui.thinking_default`

Response:

```text
{ key: "ui.thinking_default", value: "" | "collapsed" | "expanded" }
```

An empty value means that no value is stored. The frontend uses `collapsed` for an empty value.

### `PUT /api/leyline/settings/ui.thinking_default`

Request:

```text
{ value: "collapsed" | "expanded" }
```

Response:

```text
{ key: "ui.thinking_default", value: "collapsed" | "expanded" }
```

The route rejects other values with `400`. An unknown setting key returns `404`.

## Network access

These routes control sharing for the native backend, not the window's selected remote backend. Sharing defaults to off. Leyline SQLite stores `server.network_access` and `server.network_access_port`. Neither is a supported `/api/leyline/settings/:key` key.

Every successful response uses this shape:

```text
NetworkAccess = {
  available: boolean,
  enabled: boolean,
  port: number | null,
  configuredPort: number,
  urls: string[],
  directAccess: boolean,
  error: string
}
```

- `available` reports whether the origin is available for sharing.
- `enabled` reports the current sharing listener, not the saved startup preference.
- `port` is the active sharing port, or `null` when sharing is off.
- `configuredPort` is the saved port, or `0` for automatic selection. It remains available when sharing is off.
- `urls` lists sharing URLs for non-internal IPv4 interfaces. It can be empty even when the listener is enabled.
- `directAccess` reports an origin binding outside loopback. Sharing off does not close that separate access path.
- `error` reports the last listener or setting-change failure, or an empty string.

### `GET /api/leyline/network-access`

Response: `NetworkAccess`.

The response waits for earlier network-access operations to finish. It does not start a listener or change the saved preference.

### `PUT /api/leyline/network-access`

Request:

```text
{ enabled?: boolean, port?: number }
```

Response: `NetworkAccess`.

At least one field is required. `enabled` must be a boolean when supplied. `port` must be an integer from 0 through 65535. `0` selects an available port automatically. Null values are invalid.

The switch sends only `{ enabled }`. Port **Apply** sends only `{ port }`. Omitted fields keep their current values. The backend resolves them inside the serialized operation, so a port-only request preserves sharing changes made by another client. Both fields may be supplied together.

JSON bodies cannot exceed 1 KiB. Invalid fields or an empty update return `400`. Oversized bodies return `413`. Unsupported methods return `405`. Listener and persistence failures return `400` with the standard error envelope.

Enabling starts a separate TCP listener on `0.0.0.0` at the configured port. The listener forwards bytes unchanged to the existing origin. It handles HTTP, event and terminal WebSockets, and Vite HMR without path routing or header rewriting.

The operation never restarts or rebinds the origin, changes its URL, or stops local clients and agents. A port update while sharing is off only saves the port. Repeated enable requests without a port change reuse the current listener. Selecting the active automatic port as a fixed port also keeps that listener.

A live port change binds the replacement and saves both settings before closing the old listener. Bind or persistence failures preserve the previous listener and settings. An automatic port can change after a disable/enable cycle or restart. A fixed port is reused.

Disabling or changing the active port closes the old relay's remote connections, including terminals. A request through that relay can disable sharing or change the port and receive its response before its connection closes.

Startup restores the saved switch and port without changing the origin binding. Backend shutdown closes relay resources.

These routes add no authentication or network restrictions. Any client that can reach the listener has the same backend access as a local client.

## Pinned sessions

Pinned session IDs are part of the native backend. They are stored in the `pinned_sessions` table and scoped by backend connection ID. A selected remote backend does not store these records.

Every pinned-session response uses this shape:

```text
{ connectionId: string, pinnedIds: string[] }
```

IDs must be strings. Leyline trims each ID and requires 1 to 128 characters. JSON request bodies must be objects and cannot exceed 64 KiB. An oversized body returns `413`.

### `GET /api/leyline/pinned-sessions?connectionId=:id`

Response: the pinned IDs for that connection.

### `POST /api/leyline/pinned-sessions`

Request:

```text
{ connectionId: string, sessionId: string }
```

Response: the updated pinned IDs with status `201`.

Each connection can store at most 200 pins.

### `DELETE /api/leyline/pinned-sessions?connectionId=:id&sessionId=:id`

Response: the updated pinned IDs.

### `POST /api/leyline/pinned-sessions/prune`

Request:

```text
{ connectionId: string, sessionIds: string[] }
```

Response: the updated pinned IDs.

A prune request can contain at most 500 session IDs. The frontend sends larger confirmed deletions in batches.

## Pi Settings routes

These routes use `/api/pi/settings` on the selected backend. Every response sets `Cache-Control: no-store`. Successful requests return `200` without an `ok` envelope.

Provider, model, and MCP configuration is global to that backend's pi agent directory, resolved through `getAgentDir()`. Provider and model edits change `models.json`. MCP edits change `mcp.json`. Native authentication owns `auth.json` and `mcp-auth.json`. Runtime, session-title, and certificate settings instead use Leyline SQLite on the selected backend.

The API does not edit project MCP files, general pi preferences, model-picker visibility, or Codemode settings. Edits preserve unrelated fields. Explicit deletion and MCP transport changes can remove stored fields that the editor does not display.

### Runtime settings

#### `GET /api/pi/settings/runtime`

Response:

```text
{ idleTimeoutMinutes: number }
```

The default is `5`. An absent or invalid stored value uses this default. `0` disables idle cleanup.

#### `PUT /api/pi/settings/runtime`

Request:

```text
{ idleTimeoutMinutes: number }
```

Response: the same object as GET, with the saved value.

`idleTimeoutMinutes` is required and must be an integer from 0 through 1440. Numeric strings, booleans, null, missing values, and unsupported fields return `400` with `Idle timeout must be a whole number from 0 to 1440 minutes.`

The value persists as a decimal string under `runtime.idle_timeout_minutes` in `leyline_settings`. Storage is `memory.sqlite` under the selected backend's `LEYLINE_MEMORY_DIR`, or `~/.local/share/leyline/`. It has no project or session override.

Cleanup checks every 15 seconds and reads the current setting without a restart. Active work, queued tasks, pending approvals, lifecycle operations, and sessions observed through an exact `sessionId` runtime WebSocket stay loaded. An unscoped WebSocket or compact background snapshots do not protect every runtime.

Cleanup disposes eligible runtimes and their MCP resources without deleting session history. It emits `runtime_removed`. Reopening or a scoped action rebuilds the runtime and connections. Process-local restoration retains the branch leaf, model, thinking level, and exact service-tier choice when still supported. See [Idle runtime cleanup](../developer-guide/backend-api#idle-runtime-cleanup) for protections and restoration limits.

### Session-title settings

#### `GET /api/pi/settings/session-titles`

Response:

```text
{
  enabled: boolean,
  model: string,
  thinking: "" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
}
```

Defaults are `{ enabled: false, model: "", thinking: "" }`. Only stored `"true"` enables titles. An absent or invalid stored thinking value becomes `""`.

#### `PUT /api/pi/settings/session-titles`

Request:

```text
{
  enabled: boolean,
  model: string,
  thinking?: "" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
}
```

Response: the same configuration object as GET. It does not return a generated title.

`enabled` and `model` are required. The server trims `model`. A nonempty model must match `^[^/\s]+/\S+$` and contain at most 512 characters after trimming. This is `provider/model` format: the provider cannot contain `/`, but the model ID can. Enabling requires a nonempty model. Disabling permits an empty model.

Omitting `thinking` preserves its saved value. `""` selects the title model's lowest supported level. If a saved level is unsupported, generation also uses the lowest supported level, or `off` when none exists. Save validates the listed values, not model availability, credentials, or support for that model.

Validation returns `400` with one of these messages:

- Missing or invalid required fields, or unsupported fields: `Provide automatic titles and a title model.`
- Invalid thinking value, including null: `Choose a valid title thinking mode.`
- Invalid model format, excessive length, or an empty model with titles enabled: `Choose a title model in provider/model format.`

The three values persist as strings under `session_titles.enabled`, `session_titles.model`, and `session_titles.thinking` in the selected backend's `leyline_settings` table. They use the same SQLite location as runtime settings. They have no project or session override and no conversation-model fallback.

Generation runs once for a newly created ordinary conversation, after pi accepts its first user message. It runs beside the conversation request, not after the reply. Blank first-message text, including image-only input, suppresses generation. Existing or resumed sessions, forks, research sessions, and children do not receive a generator. Manual names and explicit clears take precedence. Failures keep the normal label. See [Automatic session titles](../developer-guide/backend-api#automatic-session-titles) for request limits and cancellation.

### Certificate settings

#### `GET /api/pi/settings/tls`

Response:

```text
TlsTrustSettings = {
  extraCaFiles: Array<{
    path: string,
    name: string,
    certificateCount: number,
    error: string
  }>,
  useSystemCa: boolean,
  envCaFile: string,
  envCaCount: number,
  systemAvailable: boolean,
  bundledCount: number,
  systemCount: number,
  customCount: number,
  appliedCount: number,
  error: string
}
```

GET reads saved settings and inspects custom files without changing active TLS trust. It does not apply the store that it builds.

Each file record contains its path, basename, certificate count, and an error string. An unreadable or invalid file has `certificateCount: 0` and a nonempty `error`. The built store excludes all certificates from that file. The top-level `error` joins file errors. These errors do not change the `200` response status. An empty error string means no file error.

| Field | Meaning |
| --- | --- |
| `useSystemCa` | Whether Leyline adds operating-system roots to the built store. An unset preference follows the [startup CA options](./environment#tls-certificate-trust). |
| `envCaFile` | The backend's `NODE_EXTRA_CA_CERTS` value, or `""` when absent. |
| `envCaCount` | Certificates that Node loaded from `NODE_EXTRA_CA_CERTS` at process startup. |
| `systemAvailable` | Whether the runtime can read the operating-system certificate store. |
| `bundledCount` | Node's bundled root count. |
| `systemCount` | Operating-system root count, even when `useSystemCa` is false. |
| `customCount` | Sum of valid custom-file certificate counts, before deduplication. |
| `appliedCount` | Total after deduplication in the built store. GET does not measure or change the active default store. |

#### `PUT /api/pi/settings/tls`

Request:

```text
{ extraCaFiles: string[], useSystemCa: boolean }
```

Response: `TlsTrustSettings`, with the same fields as GET.

Both fields are required. PUT replaces the complete file list and system-store preference. `extraCaFiles: []` removes saved custom files. It does not remove certificates from `NODE_EXTRA_CA_CERTS`.

A missing array or boolean, or an unsupported field, returns `400` with `Provide CA certificate files and the system store preference.`

Custom files have these limits:

- The list accepts at most 32 files.
- Each path must be nonempty text with at most 4,096 characters after trimming.
- Paths must be absolute or start with `~/`. The backend expands `~` to its own home directory and saves absolute paths.
- Duplicate path strings after trimming and home expansion are invalid.
- Each path must name a readable regular file of at most 1 MiB, or 1,048,576 bytes.

Each file needs at least one complete PEM certificate block. Every block must parse with Node's `X509Certificate`. An unmatched `-----BEGIN CERTIFICATE-----` or `-----END CERTIFICATE-----` marker rejects the file. These validation failures return `400`. An unsupported runtime or a failure to apply trust also returns `400`.

The store combines Node's bundled roots, startup `NODE_EXTRA_CA_CERTS` certificates, optional operating-system roots, and custom certificates. Save validates and applies this store before persistence. A database write failure restores the exact prior active CA list and returns `500`.

Save writes `tls.extra_ca_files` as a JSON array and `tls.use_system_ca` as `"true"` or `"false"` in `leyline_settings`. The database is the selected backend's `memory.sqlite`, at the same location as runtime settings. Reads fall back to legacy `tls.extra_ca_file` when the list has no paths. Save clears that legacy value.

Changes affect new backend Node TLS connections, including provider requests and MCP management checks. Existing connections can remain open. The setting does not affect Chromium networking, inbound server HTTPS, or the separate dictation process.

PUT bodies for runtime, session-title, and certificate settings must be objects. Null or array bodies return `400` with `Expected a settings request object`. An optional `target` must be an object with only string `sessionId` and/or `cwd` fields. Invalid targets return `400` with `Invalid settings target`. These settings ignore a valid target and remain backend-wide.

None of these settings requires a revision. Unsupported methods return `405`. Malformed JSON or unexpected storage errors return `500` with `{ error }`.

### Targets and revisions

Provider inventory and catalog reads accept these target and refresh query parameters:

```text
sessionId?: string
cwd?: string
refresh?: "1"
```

Provider/model writes and provider actions accept an optional body field:

```text
target?: { sessionId?: string, cwd?: string }
```

Without a body target, query `sessionId` and `cwd` supply the target. A target selects the extension context, not a configuration scope. A supplied cwd takes precedence. Without cwd, an open `sessionId` supplies its directory. If neither resolves a directory, the backend uses its process directory. An unknown session ID does not activate a session. A supplied cwd that differs from the open target session returns `409`.

Configuration writes require the latest `revision` from the corresponding inventory. The revision covers the whole file. Missing or stale revisions return `409`. Re-read the inventory before another save.

Revision errors are:

- Missing revision: `Refresh settings before saving.`
- Stale revision: `This configuration changed outside this editor. Refresh it before saving.`
- A change during save: `This configuration changed while saving. Refresh it before saving again.`

Writes preserve unknown fields, supported comments, formatting, and existing symlinks. They use a file lock, a second revision check, and atomic replacement. `models.json` permits line comments and trailing commas, but not block comments. `mcp.json` requires JSON without comments or trailing commas. Invalid files, duplicate keys, broken symlinks, and existing files over 2 MiB block writes. Invalid provider configuration can still return a read-only inventory with a warning.

### Provider inventory

#### `GET /api/pi/settings/providers`

Response:

```text
ProviderInventory = {
  revision: string | null,
  providers: ProviderSettings[],
  warning?: string
}

ProviderSettings = {
  id: string,
  name: string,
  kind: "builtin" | "extension" | "custom",
  configured: boolean,
  authSource: "stored" | "runtime" | "environment" | "fallback"
    | "models_json_key" | "models_json_command" | null,
  authLabel: string,
  authMethods: Array<{ id: "oauth" | "api_key", label: string }>,
  config: {
    name: string,
    baseUrl: string,
    api: string,
    authHeader: boolean | null,
    apiKeyConfigured: boolean,
    headersConfigured: boolean,
    canEdit: boolean,
    hasConfiguration: boolean
  },
  models: ProviderModel[],
  error?: string
}

ProviderModel = {
  id: string,
  name: string,
  contextWindow: number | null,
  maxTokens: number | null,
  reasoning: boolean,
  input: Array<"text" | "image">,
  cost: ModelCost,
  thinkingLevelMap?: ThinkingLevelMap,
  compat?: { supportsDeveloperRole: boolean },
  kind: "custom" | "override" | "catalog",
  overrides: ModelMetadata
}

ModelMetadata = {
  name?: string,
  contextWindow?: number,
  maxTokens?: number,
  reasoning?: boolean,
  input?: Array<"text" | "image">,
  cost?: ModelCost,
  thinkingLevelMap?: ThinkingLevelMap,
  compat?: { supportsDeveloperRole: boolean }
}

ThinkingLevelMap = {
  off?: string | null,
  minimal?: string | null,
  low?: string | null,
  medium?: string | null,
  high?: string | null,
  xhigh?: string | null,
  max?: string | null
}

ModelCost = {
  input?: number,
  output?: number,
  cacheRead?: number,
  cacheWrite?: number,
  tiers?: Array<{
    inputTokensAbove: number,
    input?: number,
    output?: number,
    cacheRead?: number,
    cacheWrite?: number
  }>
}
```

`configured` reports saved configuration or available credentials, not a successful model request. Custom compatible models can be available without an API key. Stored keys, tokens, header values, and API-key commands are omitted. Unsafe base URLs appear as an empty string. Model records contain only the listed metadata, not their full SDK configuration. Pricing tiers are read-only here.

Ordinary reads refresh the settings runtime's authentication snapshot with `allowNetwork: false`. Loading project extensions can still run their startup work. `refresh=1` replaces that cwd's settings runtime and reloads extension registrations. It does not refresh an open conversation's catalog. Use the provider `refresh` action for a forced network catalog refresh.

### Catalog lookup

#### `GET /api/pi/settings/catalog/models?q=&refresh=`

Query:

```text
q?: string
refresh?: "1"
sessionId?: string
cwd?: string
```

The [target rules](#targets-and-revisions) also apply here. `q` accepts at most 256 characters. A longer query returns `400`. An omitted, empty, or whitespace-only query returns `{ models: [] }` without acquiring or refreshing a runtime.

Search splits `q` into whitespace-separated words. Each word must match a substring of the combined model ID, name, and provider ID, without case sensitivity. Only chat models qualify, including models without an explicit type. Results sort by model ID, then provider ID, and contain at most 20 entries. Search does not filter by authentication availability.

Response:

```text
{
  models: Array<{
    providerId: string,
    id: string,
    name: string,
    api: string,
    reasoning: boolean,
    input: Array<"text" | "image">,
    contextWindow: number,
    maxTokens: number,
    thinkingLevelMap?: ThinkingLevelMap,
    compat?: object
  }>,
  warning?: string
}
```

Entries contain runtime metadata, API format, and compatibility fields. They omit costs, base URLs, authentication, and headers. Unlike provider inventory, catalog lookup can return compatibility fields beyond `supportsDeveloperRole`. These fields are not all editable or copied by the UI.

Ordinary search uses the selected backend's settings runtime cache through `getAllModels()`. It does not query a separate browser catalog. `refresh=1` replaces that settings runtime, reloads extensions, and requests `ModelRuntime.refresh({ allowNetwork: true, force: true })`. Neither search nor refresh changes a live conversation.

A refresh exception, returned `errors` or `aborted` state, or runtime error adds this warning while lookup uses the cached catalog:

```text
The catalog could not be fully refreshed. Results come from the cached catalog.
```

Runtime acquisition failures remain HTTP errors rather than cached-result responses.

### Provider configuration

#### `PUT /api/pi/settings/providers`

Request:

```text
{
  target?: { sessionId?: string, cwd?: string },
  id: string,
  revision: string,
  create?: boolean,
  values: {
    name?: string,
    baseUrl?: string,
    api?: string,
    authHeader?: boolean,
    apiKey?: string | null
  }
}
```

Response: `ProviderInventory`.

`create: true` adds a custom provider and requires `baseUrl` and `api`. Its initial `models` array is empty. Otherwise, the provider must already exist in configuration or the runtime. Omitted fields remain unchanged. At least one field is required. Only `apiKey: null` removes an individual provider field.

IDs have at most 512 characters and cannot contain whitespace, control characters, or reserved prototype names. **Provider IDs cannot contain `/`. Model IDs can contain `/`.** IDs cannot be renamed through these routes.

A base URL must use HTTP or HTTPS without credentials, query, fragment, or surrounding whitespace. API keys are optional. When supplied, they accept nonempty text, including pi environment references or `!command`. An empty command is invalid. Omitting a key does not hide a saved custom compatible model, and no placeholder key needs to be stored.

Supported `api` selections are:

```text
openai-completions, mistral-conversations, openai-responses,
azure-openai-responses, openai-codex-responses, anthropic-messages,
bedrock-converse-stream, google-generative-ai, google-vertex, pi-messages
```

An API already used by a model on that provider is also accepted. Provider headers, compatibility fields, and OAuth configuration are preserved but are not editable through this route.

#### `DELETE /api/pi/settings/providers`

Request:

```text
{ target?: { sessionId?: string, cwd?: string }, id: string, revision: string }
```

Response: `ProviderInventory`.

This removes the entire `models.json` provider entry, including custom models and overrides. It does not remove a built-in or extension registration or delete stored credentials. Use `logout` separately.

For provider `radius`, or an existing entry with `oauth: "radius"`, changes cannot alter or remove its saved base URL. Pi 0.99.1 retains cached Radius gateway URLs after reload. Such changes return `409`. Use a different provider ID for a different gateway through pi configuration. This editor does not create Radius OAuth configuration.

### Model definitions and overrides

#### `PUT /api/pi/settings/models`

Request:

```text
{
  target?: { sessionId?: string, cwd?: string },
  providerId: string,
  modelId: string,
  revision: string,
  kind: "custom" | "override",
  create?: boolean,
  values: {
    id?: string,
    name?: string,
    contextWindow?: number,
    maxTokens?: number,
    reasoning?: boolean,
    input?: Array<"text" | "image">,
    thinkingLevelMap?: ThinkingLevelMap,
    compat?: { supportsDeveloperRole?: boolean | null },
    cost?: {
      input?: number,
      output?: number,
      cacheRead?: number,
      cacheWrite?: number
    }
  }
}
```

Response: `ProviderInventory`.

`kind: "custom"` edits `models`. `kind: "override"` edits `modelOverrides`. New custom models require explicit provider `baseUrl` and `api`. A catalog model requires an override instead of a new custom definition. A new override requires an existing catalog model. Existing custom definitions cannot receive an override through this route.

`create: true` requires absent configuration of that kind. Otherwise, that configuration must exist. `values.id`, if supplied, must equal `modelId`.

Token limits must be finite positive numbers. Costs must be finite nonnegative numbers. `input` must be a nonempty list of `text` and/or `image`, without duplicates. A new custom definition with `cost` requires all four rates. Existing custom definitions fill missing rates from existing or effective costs. Override cost changes merge only the supplied rates.

Omitted fields remain unchanged. A supplied `thinkingLevelMap` replaces the map on the custom definition or override. It accepts only the seven keys in `ThinkingLevelMap`.

A string specifies the provider value. It must be nonempty, at most 256 characters, and contain no surrounding spaces or control characters. `null` marks that level unsupported. Missing keys inherit pi/provider behavior. `{}` removes the map from that definition or override.

`compat` accepts only `supportsDeveloperRole`. A boolean sets the flag. `null` removes only that flag from the definition or override, preserving other compatibility fields. An empty compatibility object is removed after the flag reset. Writes also remove empty model overrides and otherwise empty provider entries. A new override still requires a change beyond reset-only values.

Other null model values are invalid. Model API, endpoint, other compatibility fields, input limits, cache policy, and pricing tiers are not editable here.

#### `DELETE /api/pi/settings/models`

Request:

```text
{
  target?: { sessionId?: string, cwd?: string },
  providerId: string,
  modelId: string,
  revision: string,
  kind: "custom" | "override"
}
```

Response: `ProviderInventory`.

This deletes the custom definition or the whole override, including fields not shown by the editor. It does not delete catalog models. Removing the last model configuration can remove an otherwise empty provider entry.

### Provider authentication, catalog, and connection tests

#### `POST /api/pi/settings/providers/action`

Request:

```text
{
  target?: { sessionId?: string, cwd?: string },
  providerId: string,
  action: "login" | "logout" | "refresh" | "test",
  authType?: "api_key" | "oauth",
  modelId?: string,
  draft?: ProviderTestDraft | ModelTestDraft
}
```

Response: `SettingsOperation`, defined [below](#settings-operations).

Login requires an `authType` listed in that provider's `authMethods`. The SDK supplies private prompts and sign-in events. Logout removes stored credentials only. Environment credentials and `models.json` key references remain. Refresh reloads extension registrations and forces a network catalog refresh in the settings runtime.

Completed result:

```text
{
  providerId: string,
  action: "login" | "logout" | "refresh",
  credentialChanged?: true,
  warning?: string
}
```

This result shape applies to login, logout, and refresh. `credentialChanged` occurs for login and logout, not refresh or connection tests. A warning can mean credentials were saved but catalog synchronization or installation-settings persistence failed.

Provider writes, authentication, and conversation runtime construction share a lock. Before login, Leyline compares provider routes across open, background, and constructing runtimes. A missing model or different API/base URL blocks login before new credentials can reach an old endpoint. This failure occurs inside the operation, with `state: "error"`, rather than as an HTTP `409` from the action request. Reload all affected sessions after active work finishes, or restart the backend.

Saving or authenticating does not refresh live conversation catalogs, abort runs, or reload sessions. Explicit session reload remains separate. Home can request a fresh [`/state` preview](#get-api-pi-state) with `cwd` and `refresh=1`.

#### Connection test requests

`action: "test"` requires `modelId`. Without `draft`, it tests the saved model and provider settings. `modelId` and `draft` are rejected for other actions.

Editor tests supply one of these drafts:

```text
ProviderTestDraft = {
  type: "provider",
  create: boolean,
  revision: string,
  values: {
    name?: string,
    baseUrl?: string,
    api?: string,
    authHeader?: boolean,
    apiKey?: string | null
  }
}

ModelTestDraft = {
  type: "model",
  create: boolean,
  revision: string,
  kind: "custom" | "override",
  values: {
    name?: string,
    contextWindow?: number,
    maxTokens?: number,
    reasoning?: boolean,
    input?: Array<"text" | "image">,
    thinkingLevelMap?: ThinkingLevelMap,
    compat?: { supportsDeveloperRole?: boolean | null },
    cost?: {
      input?: number,
      output?: number,
      cacheRead?: number,
      cacheWrite?: number
    }
  }
}
```

`revision` is the current `ProviderInventory.revision`. A mismatch fails the operation before the probe. It appears in a polled `state: "error"` snapshot, not as HTTP `409` from the initial action request. Draft values use the same field validation as configuration edits. `values` can be empty to test an unchanged form.

Model drafts use the same map-replacement and developer-role reset rules as Save. Resets recover inherited metadata instead of retaining the removed override's effective value. If a dynamic legacy extension does not expose the required defaults, the operation refuses the draft test. Its error directs the user to save the model and test the saved settings instead.

Provider drafts overlay the saved provider configuration in memory. `create: true` permits a new, unique provider ID; a new provider needs a base URL and API format. The root `modelId` is its physical test model, not a saved definition. Model drafts overlay a custom definition or catalog override. The root `modelId` is the current model form's ID.

Tests do not save configuration, select a conversation model, reload live runtimes, or append transcript entries. A draft key replacement applies only to the test runtime. `apiKey: null` removes the draft's `models.json` reference but retains any stored credential. Native extension authentication and credential precedence remain authoritative.

Successful result:

```text
{
  providerId: string,
  modelId: string,
  action: "test",
  durationMs: number,
  httpStatus?: number
}
```

`durationMs` measures the probe, including its draft preparation and authentication. It excludes queueing and settings runtime acquisition. `httpStatus` is present when the transport supplies it. Failures use the operation's `error` field; raw response bodies and secrets are not returned. When only a structured provider error code is available, the message identifies it as a provider-reported error rather than an observed HTTP status.

The probe requests 16 output tokens, disables retries, and has a 30-second deadline after settings runtime setup. It can incur a charge or load a local model. Cancellation uses the normal route under [Settings operations](#settings-operations). A failed test does not block saving or model selection.

Tests reject these paths before sending the test generation request:

- `openai-codex-responses`: the output limit cannot be enforced.
- Direct OpenAI Responses with ChatGPT-subscription authentication: the output limit cannot be enforced.
- `openai-responses` with `compat.supportsMaxOutputTokens: false`: the output limit would be omitted.
- `bedrock-converse-stream`: native automatic retries cannot be disabled.

Virtual models resolve to physical models before the probe. OAuth route guards run before virtual routing and before physical authentication. Token resolution can refresh shared OAuth credentials. Cancellation cannot undo a refresh that already completed. Provider drafts require a physical model and cannot change an OAuth provider's endpoint or API while using its stored login.

### MCP inventory

#### `GET /api/pi/settings/mcp`

Response:

```text
McpInventory = {
  revision: string,
  servers: Array<{
    name: string,
    transport: "http" | "stdio",
    enabled: boolean,
    exposure: string,
    url?: string,
    command?: string,
    cwd?: string,
    argsConfigured?: true,
    argsCount?: number,
    timeout?: number,
    headers: Array<{ name: string, configured: true }>,
    env: Array<{ name: string, configured: true }>,
    oauth: {
      clientId?: string,
      scope?: string,
      callbackUrl?: string,
      callbackPort?: number,
      clientSecretConfigured?: boolean
    },
    error?: string
  }>,
  warning?: string
}
```

Listing reads global `mcp.json` only. It does not connect, resolve secret commands, load project entries, or report conversation connection status. Header values, environment values, arguments, and OAuth client secrets are omitted. URL credentials are removed. URL queries, fragments, and known secrets in display metadata are redacted. `oauth` is empty when no OAuth object exists.

`exposure` defaults to `codemode` for existing entries without a value, matching pi configuration. Leyline still excludes Codemode. New entries default to `deferred`.

### MCP configuration

#### `PUT /api/pi/settings/mcp`

Request:

```text
{
  name: string,
  revision: string,
  create?: boolean,
  values: {
    url?: string,
    command?: string,
    args?: string[] | null,
    cwd?: string | null,
    enabled?: boolean,
    exposure?: "deferred" | "direct" | "hidden",
    timeout?: number | null,
    headers?: { [name: string]: string },
    env?: { [name: string]: string },
    removeHeaders?: string[],
    removeEnv?: string[],
    oauth?: {
      clientId?: string | null,
      clientSecret?: string | null,
      scope?: string | null,
      callbackPort?: number | null,
      callbackUrl?: string | null
    }
  }
}
```

Response: `McpInventory`.

Server names permit letters, digits, underscores, and hyphens. `create: true` requires a new name. Otherwise, the entry must exist. Renaming requires a separate create and delete.

Supply `url` for streamable HTTP or `command` for stdio, never both. HTTP URLs require HTTP or HTTPS. A command is a nonempty executable string. Legacy SSE transport is unsupported. Transport changes remove incompatible fields: stdio fields for HTTP, or HTTP fields for stdio.

`args`, `cwd`, and `env` apply only to stdio. `headers` and `oauth` apply only to HTTP. `timeout` is a finite positive number of seconds. Null removes `args`, `cwd`, `timeout`, or an individual OAuth field.

Header and environment maps merge supplied entries. Removal arrays delete named entries. A request cannot set and remove the same entry. Omit unchanged secrets and arguments. Do not send redacted display values as replacements. A new URL must be complete.

OAuth callback ports are integers from 1 to 65535. Callback URLs require HTTP on `localhost`, `127.0.0.1`, or `[::1]`, without credentials, query, or fragment. An explicit URL port must match `callbackPort` when both are supplied.

Only `deferred`, `direct`, and `hidden` are new exposure selections. An existing exposure can be preserved unchanged, including a legacy value. `type`, `toolExposure`, and top-level `autoEnableCodemode` are not editable through this API. Unknown existing fields remain unless transport conversion or explicit deletion removes them.

#### `DELETE /api/pi/settings/mcp`

Request:

```text
{ name: string, revision: string }
```

Response: `McpInventory`.

This removes the global entry, including unknown fields. It does not sign out or close conversation connections. Reload open sessions explicitly to apply configuration changes.

### MCP actions

#### `POST /api/pi/settings/mcp/action`

Request:

```text
{ name: string, action: "check" | "login" | "logout" }
```

Response: `SettingsOperation`.

Check and login open a temporary native MCP connection, even for a disabled server. They do not change the saved enabled setting. Logout removes native stored credentials without connecting or resolving secrets. Login and logout require HTTP without an `Authorization` header.

Completed result:

```text
{
  report: string,
  tools: Array<{ name: string, description: string, exposure: string }>
}
```

The report describes the temporary operation, not conversation connections. Tool metadata excludes resolved configuration secrets and OAuth access tokens. Native diagnostics are limited to controlled messages. The backend process directory supplies the probe's cwd, not a selected session directory.

HTTP actions share an operation lock by normalized server URL, so aliases cannot authenticate concurrently against the same native credential record. Stdio actions use the configuration path and server name. Non-login worker operations have a two-minute deadline. Login has a ten-minute deadline. Cancellation stops prompts, connection setup, and owned processes, but cannot roll back credentials already saved.

### Settings operations

Provider and MCP actions return a private, polled operation. These operations do not appear in session WebSocket messages, extension confirmations, or transcript entries. Private describes this transport separation, not access control. The API still has no authentication.

```text
SettingsOperation = {
  id: string,
  state: "running" | "cancelling" | "completed" | "cancelled" | "error",
  prompt: SettingsPrompt | null,
  events: SettingsEvent[],
  result: object | null,
  error: string
}

SettingsPrompt = {
  id: string,
  type: "text" | "secret" | "select" | "manual_code",
  message: string,
  placeholder: string,
  options?: Array<{ id: string, label: string, description: string }>
}

SettingsEvent =
  { type: "auth_url", url: string, instructions: string }
  | { type: "device_code", verificationUri: string, userCode: string,
      expiresInSeconds?: number }
  | { type: "info", message: string, level: string,
      links?: Array<{ url: string, label: string }> }
```

`options` occurs only for `select`. `result` uses the action-specific shapes above. `error` is empty until failure. A successful answer or cancellation request does not mean the operation has finished.

Events retain at most 20 entries. Public links require HTTP or HTTPS without URL credentials. Submitted non-select values are redacted from later operation text. Terminal cleanup removes authorization URLs, device codes, and informational links. Terminal operation snapshots remain available for one minute after cleanup. Still-running operations receive cancellation after ten minutes.

#### `GET /api/pi/settings/operations/:id`

Request body: none. Response: `SettingsOperation`.

#### `POST /api/pi/settings/operations/:id`

Request:

```text
{ promptId: string, value: string }
```

Response: `SettingsOperation`.

Use the current `prompt.id`. Values can contain at most 32,768 characters. A select value must match an offered option ID. Text values can be empty. Answers are not returned in the snapshot.

#### `DELETE /api/pi/settings/operations/:id`

Request body: none. Response: `SettingsOperation`.

A running operation changes to `cancelling`, clears its events, and receives an abort signal. Poll until a terminal state. Repeated cancellation returns the current snapshot. Cancellation after completion does not undo results.

### Settings errors

HTTP failures use `{ error: string }`. Asynchronous action failures instead use HTTP `200` snapshots with `state: "error"` and an `error` string.

| Status | Condition or exact operation error |
| --- | --- |
| `400` | Invalid target, fields, values, CA files, configuration changes, or action. |
| `400` | Answer is not a string or is too long: `Invalid response`. |
| `400` | Select answer is unavailable: `Select an available option`. |
| `404` | Missing provider/model configuration, missing MCP action target, or unknown Settings path. |
| `404` | Unknown or expired operation: `This settings operation expired. Start it again.` |
| `405` | Unsupported method on runtime, session-title, certificate, inventory, model, or operation routes: `Method not allowed`. |
| `409` | Missing/stale file revision, invalid stored configuration, duplicate creation, unavailable MCP edit target, Radius URL change, or conflicting settings target. |
| `409` | Stale answer: `This prompt is no longer active.` |
| `409` | Duplicate active operation: `An operation for this provider or server is already in progress.` |
| `429` | Eight active operations already exist: `Too many settings operations are in progress.` |
| `503` | Settings runtime cannot load, refresh authentication, or acquire capacity, or the backend is shutting down. |
| `500` | Malformed JSON or unexpected storage, filesystem, SDK, or worker error outside an operation. |

Action paths accept only POST. Other methods on those paths return `404` with `Not found`.

Provider lock waits can return `409` with `Provider settings are busy. Finish or cancel sign-in, then try again.` Errors raised after an action starts remain operation errors regardless of their internal status code.

## Session routes

### `GET /api/pi/sessions`

**Designation:** Browser route.

Response:

```text
{ sessions: SessionSummary[] }
```

The list includes persisted sessions and open runtimes that are not yet in the persisted list.

Persisted sessions use descending `modified` order. Runtime-only sessions appear before the persisted list.

### `POST /api/pi/sessions`

**Designation:** Browser route.

Request:

```text
{ cwd: string, kind?: "session" | "research" }
```

Response:

```text
{ active: Active, detail: SessionDetail }
```

The route creates the directory if necessary, creates a pi session, loads a runtime, and makes it active. The default kind is `session`.

For `research`, the route appends a session-ID-bound research marker before extension binding. Missing `cwd` or an invalid kind produces `500`.

### `GET /api/pi/sessions/:id`

**Designation:** Browser route.

Query:

```text
path?: string
compact?: "1"
toolArguments?: "1"
```

Response: `SessionDetail` without an outer envelope. This read does not activate the session.

If `path` is present, Leyline opens that file and verifies that its session ID equals `:id`. A missing session returns `404`. An ID and path mismatch returns `500`.

`compact=1` removes tool `copyText`. Without `toolArguments=1`, it also omits tool `text` when a non-error tool has nonempty `preview.fallbackText`.

`toolArguments=1` includes `args` from the paired original tool call when available. It also retains the original projected tool `text` when combined with `compact=1`. Missing recorded arguments remain absent. Without this option, ordinary session-detail payloads remain unchanged.

Child previews request `compact=1&toolArguments=1` for full output and arguments in their readers. Neither option imposes an entry-count limit.

### `GET /api/pi/sessions/by-path`

**Designation:** Browser route used for parent and child navigation.

Query:

```text
path: string
compact?: "1"
toolArguments?: "1"
```

Response: `SessionDetail` without an outer envelope. This read does not activate the session.

The `compact` and `toolArguments` options use the rules above. A missing `path` query returns `400`. A session that cannot be resolved returns `404`.

### `PATCH /api/pi/sessions/:id`

**Designation:** Browser route.

Request:

```text
{ name: string }
```

Response:

```text
{ ok: true, detail: SessionDetail, session: SessionDetail.session }
```

Leyline collapses whitespace in `name`. A non-string value becomes an empty name. An unknown session currently returns `500`.

### `DELETE /api/pi/sessions/:id`

**Designation:** Browser route.

Request body: none.

Response:

```text
{ ok: true, trashed: { path: string | null } }
```

The route moves the JSONL file to a `leyline-trash` directory near the configured session directory. `path` is `null` when no file exists for an open runtime. Streaming or compacting sessions and unknown sessions currently return `500`.

### `POST /api/pi/active-session`

**Designation:** Browser route.

Request:

```text
{ id?: string, path?: string, cwd?: string }
```

Response:

```text
{ active: Active }
```

A missing resolved session returns `404`. Runtime load errors return `500`.

### `GET /api/pi/state`

**Designation:** Browser route for start-screen runtime options.

Query:

```text
cwd?: string
refresh?: "1"
```

Response:

```text
{ active: Active }
```

Without refresh, a matching cwd returns the process-wide active runtime snapshot. Otherwise, Leyline creates a temporary runtime preview and then disposes it. `refresh=1` always creates a fresh preview, even for the active cwd. It does not reload or refresh the live conversation catalog.

If `cwd` is absent, Leyline uses the active runtime directory or the server process directory. Home Settings refreshes send an explicit cwd. A temporary preview has an empty `id` and does not become the active session.

## Filesystem route

### `GET /api/pi/fs`

**Designation:** Browser route.

Query:

```text
path?: string
cwd?: string
```

Response:

```text
{
  parentPath: string,
  path: string,
  parent: string,
  home: string,
  entries: DirectoryEntry[],
  directories: DirectoryEntry[],
  root: string
}

DirectoryEntry = {
  name: string,
  fullPath: string,
  path: string,
  hidden: boolean
}
```

`entries` and `directories` contain the same directory list. The default `path` is `~/`. Paths that start with `./` or `../` require `cwd`. Other relative paths resolve from the server process directory. Invalid paths return `500`.

## Local file routes

These routes use files and editor settings on the selected backend. They are separate from native app settings under `/api/leyline`.

### `GET /api/pi/files/settings`

**Designation:** Browser Files settings route.

Response:

```text
FileSettings = {
  editor: string,
  environmentEditor: string,
  effectiveEditor: string,
  editorMode: "auto" | "desktop" | "terminal",
  terminalEditor: boolean,
  revealLabel: string | null,
  error?: string
}
```

`editor` is the stored command. `environmentEditor` comes from the backend's `EDITOR` variable. `effectiveEditor` uses nonempty `editor`, then `environmentEditor`. The default mode is `auto`, which detects known terminal editors. `revealLabel` is `null` when desktop reveal is unavailable. An invalid effective command produces `error` in the `200` response.

### `PUT /api/pi/files/settings`

Request:

```text
{ editor?: string, editorMode?: "auto" | "desktop" | "terminal" }
```

Response: `FileSettings`.

Omitted fields retain their values. `editor` accepts at most 4,096 characters. The server trims the command. An empty command uses `EDITOR`. Commands permit quoted arguments but reject shell operators, expansions, substitutions, and control characters. Desktop launch does not use a shell.

Invalid input or malformed JSON returns `400` with the current `FileSettings` fields and `error`. An unavailable executable can instead produce `error` in a `200` response after the settings save.

### `POST /api/pi/sessions/:id/file`

**Designation:** Browser session file route. This route resolves the session without requiring an open runtime or changing active-session selection.

Request:

```text
{
  action: "resolve" | "preview" | "editor" | "reveal",
  href: string,
  basePath?: string,
  allowOutsideProject?: boolean,
  approvedPath?: string
}
```

The server resolves relative links from the session's `cwd`. If `basePath` is nonempty, it uses that file's parent directory instead. Supported links include local paths, `file:` URLs with empty or `localhost` authority, `:line[:column]` suffixes, and `#Lline[-LendLine]` fragments.

Only regular files are supported. The server resolves symlinks and checks whether the resulting path is outside the project. It rejects network paths and control characters. Windows paths require a Windows backend.

File-action responses use this descriptor:

```text
FileDescriptor = {
  path: string,
  line?: number,
  endLine?: number,
  column?: number,
  anchor?: string,
  outsideProject: boolean,
  needsApproval: boolean,
  editorAvailable: boolean,
  terminalEditor: boolean,
  revealLabel: string | null,
  error?: string
}
```

| Action | Response beyond `FileDescriptor` |
| --- | --- |
| `resolve` | None. Resolve the path without reading content or launching an application. |
| `preview` | Text: `{ kind: "file", content: string, language: "markdown" | "text", source: "disk", modifiedAt: string, size: number }`. Image: `{ kind: "image", mimeType: string, data: string, source: "disk", modifiedAt: string, size: number }`. |
| `editor` | `{ terminal: true }` for a terminal editor. `{ ok: true }` after desktop launch. |
| `reveal` | `{ ok: true }` after desktop reveal launch. |

Preview `modifiedAt` is an ISO timestamp. `size` counts bytes. Image `data` is base64. Text previews require UTF-8 and permit at most 2 MiB and 20,000 lines. PNG, JPEG, GIF, WebP, and BMP previews permit at most 10 MiB.

If `error` is present or `needsApproval` is `true`, the server returns the descriptor without performing the action. Check `error` before requesting approval. After user approval, repeat the action with `allowOutsideProject: true` and `approvedPath` equal to the returned canonical `path`. The server resolves the path again and returns `error` if it differs from `approvedPath`.

Approval applies to that request. These fields do not provide authentication or access control.

Invalid action or field types return `400` with `{ error }`. An unknown session returns `404`. Malformed JSON and unexpected thrown errors return `500`. Resolution, approval-path, preview, and application-launch errors normally return `200` with `FileDescriptor.error`, not an HTTP error status.

## Git review routes

These routes read the working tree on the selected backend. They do not change Git state or require an active runtime.

```text
GitReviewFile = {
  conflicted: boolean,
  indexStatus: string,
  kind: "added" | "conflicted" | "copied" | "deleted" | "modified" | "renamed" | "replaced" | "untracked",
  oldPath: string,
  path: string,
  staged: boolean,
  unstaged: boolean,
  untracked: boolean,
  worktreeStatus: string
}

GitReviewDiff = {
  binary: boolean,
  bytes: number,
  directory?: boolean,
  lines: number,
  patch: string,
  scope: "staged" | "working" | "conflict",
  tooLarge: boolean
}
```

### `GET /api/pi/review`

**Designation:** Browser route.

Query:

```text
cwd: string
```

Response:

```text
{
  additions: number,
  available: boolean,
  branch: string,
  conflicts: number,
  deletions: number,
  files: GitReviewFile[],
  filesTruncated: boolean,
  lineStatsAvailable: boolean,
  root: string,
  totalFiles: number | null
}
```

`available` is `false` when `cwd` is not inside a Git repository. In that state, `files` is empty and `root` is the resolved project directory.

`additions` and `deletions` sum staged and working-tree line changes. Additions also include untracked text files. Binary files do not contribute line counts. `conflicts` counts conflicted paths.

The response keeps at most 500 changed paths. When more paths exist, `filesTruncated` is `true`, `totalFiles` is `null`, and `lineStatsAvailable` is `false`.

If line counting fails, `lineStatsAvailable` is also `false`. In either case, `additions` and `deletions` are zero placeholders. `conflicts` remains a separate count. Outside a repository, all counts are zero and `lineStatsAvailable` is `true`.

A missing `cwd` returns `400`. An invalid directory or Git failure returns `500`.

### `WS /api/pi/review/events`

**Designation:** Browser and Electron review stream.

Query:

```text
cwd: string
```

The server accepts a WebSocket upgrade. Messages use the `{ type, data }` envelope and heartbeat protocol described under [Event WebSockets](#event-websockets).

Event types and their `data` values are:

```text
review_ready: {}

review_change: {
  root: string
}

review_unavailable: {}

review_watch_error: {
  message: string
}
```

The backend shares one recursive watcher for clients that resolve to the same watch root. It closes the watcher after the last client disconnects. Ordinary `.git` activity and ignored working-tree paths do not emit `review_change`. Relevant Git metadata does.

`review_ready` follows watcher setup. Fetch current status after this event, both on initial connection and reconnect, to catch changes since the previous HTTP response. Socket open alone does not confirm watcher readiness.

Changes can share one `review_change` event. The event contains no status list or diff. Clients fetch current data from the review routes.

A non-Git directory or a repository that disappears produces `review_unavailable`, then closes the socket. A watcher setup or runtime error sends `review_watch_error` and closes with code `1011`. The frontend stops its subscription on `review_unavailable` and reconnects after watcher errors.

A missing `cwd` returns HTTP `400` before upgrade. An ordinary HTTP `GET` with `cwd` returns `426`. There is no SSE response.

### `GET /api/pi/review/diff`

**Designation:** Browser route.

Query:

```text
cwd: string
path: string
```

Response:

```text
{ path: string, diffs: GitReviewDiff[] }
```

The path must match a changed file from the bounded status list. A file can return separate `staged` and `working` sections.

A conflict returns one `conflict` section. An untracked nested repository returns a `working` section with `directory: true`.

A text diff larger than 1 MiB or 5,000 lines has `tooLarge: true` and an empty `patch`. Binary changes have `binary: true`.

Missing query values return `400`. A missing repository, stale file path, invalid directory, or Git failure returns `500`.

## Runtime action routes

Scoped routes resolve their source from `:id`. If the runtime is not open, Leyline loads it. An unknown `:id` returns `404`. Fork selects a new runtime; other scoped actions leave the active-session selection unchanged.

The matching top-level routes act on the selected active session. They are legacy routes. If no session is active, they return `500` with `No active session`.

### Prompt

| Route | Designation |
| --- | --- |
| `POST /api/pi/sessions/:id/prompt` | Scoped browser route |
| `POST /api/pi/prompt` | Legacy active-session route |

Request:

```text
{
  text: string,
  images?: Array<{ type: "image", data: string, mimeType: string }>,
  streamingBehavior?: "steer" | "followUp",
  kind?: "session" | "research",
  handoffId?: string
}
```

Response (`200`):

```text
{ ok: true, queued: boolean, active: Active }
```

The response confirms queue acceptance, successful pi preflight, or input handling by an extension. It does not wait for the model run to finish.

- `followUp` adds a task to Leyline's editable **Up next** queue. An idle, unheld queue can dispatch it immediately.
- `steer` passes input to pi for the current run. An idle session can start a new run instead.
- Without `streamingBehavior`, an idle session with no pending tasks starts normally. A busy session or a nonempty queue retains the task for later dispatch.
- A held queue retains ordinary new prompts until Resume, including requests with `steer`. The browser disables steering while held.
- Recognized extension commands execute through pi directly rather than entering the editable queue.

`queued: true` can mean either an editable task or a native pi input. Inspect `promptQueue` and `queuedMessages` to distinguish them. `queued: false` does not guarantee a model run: an extension can consume the input.

Empty text is valid only with at least one image. Supported MIME types are PNG, JPEG, GIF, and WebP.

Image preparation runs when the task is submitted to pi. An image-capable model receives the images directly. Otherwise, Leyline validates the vision model and saves the attachments. The original images remain in the transcript. Parent-model context receives paths and instructions to call `vision_agent`.

A missing or invalid vision model returns `500` for immediate submission. For a queued task, failed preparation retains the item, holds the queue, and sets `promptQueue.error`.

The prompt response does not wait for `vision_agent` execution.

Prompt preflight and model or service-tier changes use a per-runtime submission lock outside active compaction. Ordinary prompts during either change remain accepted in the editable queue, including while model authentication resolves. Automatic dispatch waits until the change finishes. Recognized extension commands retain their direct pi path.

### Editable prompt queue

`POST /api/pi/sessions/:id/queue` changes pending tasks on that runtime handle. There is no legacy active-session equivalent.

Request:

```text
{
  action: "hold" | "resume" | "edit" | "remove" | "move" | "steer",
  revision: number,
  id?: string,
  text?: string,
  direction?: "up" | "down"
}
```

Response:

```text
{ ok: true, active: Active }
```

Send the current `active.state.promptQueue.revision` with every mutation. A stale or missing revision returns `409`.

| Action | Required fields beyond `revision` | Behavior |
| --- | --- | --- |
| `hold` | None | Hold remaining tasks and cancel unaccepted queue submission. An empty queue stays unheld. |
| `resume` | None | Release the hold, clear the queue error, and schedule the next task when pi is idle. |
| `edit` | `id`, `text` | Replace pending text, retain attachments and task type, and hold the queue. Cancel any unaccepted queue submission. |
| `remove` | `id` | Remove the pending task. Removing the last task clears the hold and queue error. |
| `move` | `id`, `direction` | Move the pending task one position up or down. |
| `steer` | `id` | Submit a pending prompt through pi's steering path. Requires an unheld queue. Shell commands cannot steer. |

Item mutations require `status: "pending"`. The UI calls `hold` before opening an editor, then `edit` on Save. Empty replacement text is valid only if the item has images. A shell edit must retain a `!` or `!!` prefix and a nonblank command. `!!` sets `excludeFromContext`; `!` clears it.

Invalid actions, missing items, changes to a sending item, or blocked lifecycle operations return `400`. Dispatch failures remain in `promptQueue.error`; inspect the returned snapshot after Resume or Steer.

Pi prompt acceptance removes a prompt from the editable queue. A shell command leaves the queue after its `user_bash` hooks finish and execution starts. Hook or setup failure before this point retains the command, holds the queue, and sets `promptQueue.error`. A nonzero exit, cancellation, or later execution error holds remaining tasks. These routes do not edit, clear, or replay native pi queues.

Pending tasks survive browser refresh and session switching. Runtime reload retains them in a held state. Backend restart discards them.

### Shell command

| Route | Designation |
| --- | --- |
| `POST /api/pi/sessions/:id/bash` | Scoped browser route |
| `POST /api/pi/bash` | Legacy active-session route |

Request:

```text
{ command: string, excludeFromContext?: boolean }
```

Response:

```text
{ ok: true, queued: true, active: Active }
```

Both routes confirm acceptance into the shared **Up next** queue, not command completion. They return no `detail`. Multiple commands can queue during a model run or another shell command. Prompts and shell commands run in queue order when the runtime is ready.

`command` must be a string with non-whitespace content. The server trims it. Empty or non-string commands return `500`. Only `excludeFromContext: true` excludes output from future model context. Other values act as false.

Shell dispatch calls native `user_bash` hooks, then `session.executeBash()` with any returned operations. A hook can supply a result for `session.recordBashResult()` instead. Hook failure blocks execution. The native result enters the session manager as a `bashExecution` message. Pi can defer writing it to disk. Shell execution does not request an assistant reply.

Use `active.state.isBashRunning`, full-snapshot `bashExecution`, and the `bash_execution_start`, `bash_execution_update`, and `bash_execution_end` runtime events to observe progress. Interrupt stops execution and holds remaining tasks.

### Compaction

| Route | Designation |
| --- | --- |
| `POST /api/pi/sessions/:id/compact` | Scoped browser route |
| `POST /api/pi/compact` | Legacy active-session route |

Request:

```text
{ customInstructions?: string }
```

Response:

```text
{ ok: true, active: Active, detail: SessionDetail }
```

The response is sent after compaction finishes. Active streaming, active compaction, or fewer than two message entries returns `500`.

### Edit prompt

| Route | Designation |
| --- | --- |
| `POST /api/pi/sessions/:id/edit-prompt` | Scoped browser route |
| `POST /api/pi/edit-prompt` | Legacy active-session route |

Request:

```text
{
  entryId: string,
  text: string,
  images?: Array<{ type: "image", data: string, mimeType: string }>
}
```

Response:

```text
{ ok: true, active: Active }
```

The entry must be a user message. Leyline moves the active tree position and submits the replacement prompt. The response means prompt preflight succeeded. Replacement images use the same direct-image or `vision_agent` tool-call behavior as a new prompt.

### Interrupt

| Route | Designation |
| --- | --- |
| `POST /api/pi/sessions/:id/interrupt` | Scoped browser route |
| `POST /api/pi/interrupt` | Legacy active-session route |

Request body: none.

Response:

```text
{ ok: true, active: Active }
```

Interrupt holds remaining unsent tasks, aborts pending prompt setup, and stops the active parent run. With no pending tasks, the queue remains unheld. It does not clear native pi queues.

The response includes the resulting runtime snapshot. Resume is rejected while Stop is still in progress.

### Reload resources

| Route | Designation |
| --- | --- |
| `POST /api/pi/sessions/:id/reload` | Scoped browser route |
| `POST /api/pi/reload` | Legacy active-session route |

Request body: none.

Response:

```text
{ ok: true, active: Active }
```

Reload recreates the runtime at the current leaf. Streaming, compaction, or pending prompt setup returns `500`. Unsent tasks remain on the handle in a held state.

### Select model

| Route | Designation |
| --- | --- |
| `POST /api/pi/sessions/:id/model` | Scoped browser route |
| `POST /api/pi/model` | Legacy active-session route |

Request:

```text
{ provider: string, id: string }
```

Response:

```text
{ ok: true, active: Active }
```

Initialization, extension binding, reload, branch changes, or another model or service-tier change blocks the request. The API does not require an idle model run. Missing fields, an unknown model, authentication failure, or a blocked change returns `500`.

Outside active compaction, the model change holds the submission lock through pi's authentication check and model selection. Ordinary new prompts remain accepted in the editable queue. Automatic queue dispatch waits until the change finishes.

### Set service tier

`POST /api/pi/sessions/:id/service-tier` selects a tier for that runtime. There is no legacy active-session equivalent.

Request:

```text
{ tier: "standard" | "fast" | "ultrafast" }
```

Response (`200`):

```text
{ ok: true, active: Active }
```

Every tier requires the runtime's bundled `leyline-service-tier` command. Fast and Ultrafast also require the requested value in `active.state.model.serviceTiers`.

Initialization, extension binding, reload, branch changes, or another model or service-tier change blocks the request. Session deletion, disposal, or shutdown also blocks requests. The API does not require an idle model run.

Outside active compaction, tier changes use the prompt-submission lock. Ordinary new prompts enter the editable queue during the change. Automatic dispatch waits until the change finishes.

Errors use `{ error }`:

| Status | Condition or exact error |
| --- | --- |
| `500` | Missing or invalid `tier`: `tier must be standard, fast, or ultrafast`. |
| `500` | Missing command: `Service tier selection is not available in this runtime.` |
| `500` | Unsupported model or authentication: `The service tier is not available for this model and authentication method.` |
| `500` | Blocked changes, malformed JSON, or runtime errors. |
| `404` | Unknown session: `Session not found`. |
| `405` | Unsupported method: `Method not allowed`. |

Use `active.state.extensionUi.statuses["leyline-service-tier"]` from the latest accepted snapshot for the resulting tier. Apply the `snapshotRevision` rules under [Active runtime](#active-runtime). The response has no separate `tier` field. Cancellation or runtime replacement can prevent a change despite `ok: true`.

If the HTTP response closes early, the server cancels pending setup when possible. It does not undo a tier change that already took effect.

### Set Ultrafast

`POST /api/pi/sessions/:id/ultrafast` remains a compatibility route. There is no legacy active-session equivalent.

Request:

```text
{ enabled: boolean }
```

Response (`200`):

```text
{ ok: true, active: Active }
```

- `enabled: true` selects `"ultrafast"`.
- `enabled: false` selects `"standard"`, including when the current tier is `"fast"`.

A missing or nonboolean `enabled` returns `500` with `enabled must be a boolean`. Other errors, command requirements, cancellation, and snapshot rules match [Set service tier](#set-service-tier). The response has no separate `enabled` field.

### Select thinking level

| Route | Designation |
| --- | --- |
| `POST /api/pi/sessions/:id/thinking` | Scoped browser route |
| `POST /api/pi/thinking` | Legacy active-session route |

Request:

```text
{ level: string }
```

Response:

```text
{ ok: true, active: Active }
```

The level must occur in `active.state.availableThinkingLevels`.

## Extension confirmations

Pending extension UI confirmations appear in `active.state.extensionUi.confirmations`. The runtime publishes changes through `extension_ui` and `active_session` WebSocket events. Compact snapshots for other sessions retain `pendingConfirmationCount`, without confirmation records.

### `POST /api/pi/sessions/:id/extension-confirmations/:requestId`

**Designation:** Scoped browser response route. There is no legacy active-session equivalent.

Request:

```text
{ confirmed: boolean }
```

Response:

```text
{ ok: true }
```

The route responds to the request identified by `ExtensionConfirmation.id` on the specified session. Both `true` and `false` return the same success response for a valid pending request. A reply removes the request. The response contains no runtime snapshot or confirmation result.

A missing or nonboolean `confirmed` returns `400` with `confirmed must be a boolean`. An unknown session returns `404` with `Session not found`. A missing, expired, cancelled, or invalidated request returns `409` with `Confirmation is no longer pending`. Malformed JSON and thrown runtime errors return `500`. Errors use the `{ error }` envelope.

Timeout, an abort signal, Interrupt, runtime replacement, or disposal resolves the confirmation as `false` and removes it. Switching the selected session does not approve or cancel the request.

## Active-session history routes

Fork has both scoped and legacy endpoints. Reset to here remains active-session-only.

### `POST /api/pi/fork`

**Designation:** Legacy active-session route. The browser uses `POST /api/pi/sessions/:id/fork` to identify the source session.

Request:

```text
{ entryId: string }
```

Response:

```text
{ ok: true, active: Active, detail: SessionDetail }
```

The route creates and selects a separate runtime at the specified entry. The source runtime, pending tasks, and native inputs remain intact. The new fork has an empty editable queue. Session-level subagent and vision overrides copy to the fork.

For a research session, the route rebinds retained research state to the new session ID. It revalidates a retained report before marking the fork complete. Forking is allowed during streaming. Compaction, an unsaved source session, or extension cancellation returns `500`.

### `POST /api/pi/reset-to-entry`

**Designation:** Active-session browser route. This route is destructive.

Request:

```text
{ entryId: string }
```

Response:

```text
{ ok: true, active: Active, detail: SessionDetail }
```

The entry must be on the active branch. The route rewrites the JSONL file so that it ends at that entry. It does not keep later branch records.

For a research session, the route rebuilds state from retained entries. It can restore a valid report marker when the report remains after its checkpoint.

### `POST /api/pi/mode`

**Designation:** Legacy compatibility route.

Request: Any JSON object or no body.

Response:

```text
{ ok: true, active: Active }
```

The route ignores the request body and reapplies `one-at-a-time` steering and follow-up modes.

## Rollout feedback route

### `POST /api/pi/sessions/:id/feedback`

**Designation:** Browser route backed by local SQLite metadata.

Request:

```text
{
  cwd: string,
  entryId: string,
  feedbackText?: string,
  label?: "helpful" | "unhelpful" | "",
  sessionPath: string
}
```

Response when a label is set:

```text
{
  ok: true,
  feedback: {
    cwd: string,
    sessionId: string,
    sessionPath: string,
    entryId: string,
    label: "helpful" | "unhelpful",
    feedbackText: string,
    updatedAt: number
  }
}
```

Response when `label` is empty:

```text
{ ok: true, feedback: null }
```

The `:id` value becomes `sessionId`. The route does not verify the session or entry against JSONL data. Missing fields and invalid labels return `500`.

## Memory Inspector routes

These browser routes use `memory.sqlite` in `LEYLINE_MEMORY_DIR`. Without that variable, they use `~/.local/share/leyline/memory.sqlite`. `cwd` is required for all operations. `sessionPath` is optional, but session scope requires it.

```text
MemoryContext = {
  cwd: string,
  projectId: string,
  projectName: string,
  projectRoot: string,
  sessionAvailable: boolean,
  sessionFile: string | null,
  sessionId: string | null
}

Memory = {
  id: string,
  scope: "global" | "project" | "session",
  projectId: string | null,
  projectRoot: string | null,
  projectName: string | null,
  sessionId: string | null,
  sessionFile: string | null,
  cwd: string | null,
  contentMd: string,
  reasonMd: string,
  tags: string[],
  status: "active" | "archived",
  source: "agent" | "user" | "system" | "import",
  createdAt: number,
  updatedAt: number,
  archivedAt: number | null,
  lastAccessedAt: number | null
}
```

### `GET /api/pi/memories`

Query:

```text
cwd: string
sessionPath?: string
```

Response:

```text
{
  context: MemoryContext,
  memories: Memory[],
  counts: {
    active: number,
    archived: number,
    scopes: {
      global: { active: number, archived: number },
      project: { active: number, archived: number },
      session: { active: number, archived: number }
    }
  }
}
```

The result includes visible active and archived records, newest update first.

### `POST /api/pi/memories`

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  scope: "global" | "project" | "session",
  contentMd: string,
  tags?: string[]
}
```

Response:

```text
{ ok: true, memory: Memory }
```

The created record has `source: "user"`, `status: "active"`, and an empty `reasonMd`.

### `PATCH /api/pi/memories/:id`

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  contentMd: string,
  tags?: string[]
}
```

Response:

```text
{ ok: true, memory: Memory }
```

The route does not change scope, source, reason, or status.

### `POST /api/pi/memories/status`

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  ids: string[],
  status: "active" | "archived"
}
```

Response:

```text
{ ok: true, memories: Memory[] }
```

The response contains all visible records after the transaction. Setting `active` restores archived records.

### `DELETE /api/pi/memories`

Request:

```text
{ cwd: string, sessionPath?: string, ids: string[] }
```

Response:

```text
{ ok: true, memories: Memory[] }
```

The route permanently deletes all specified visible records in one transaction.

### `DELETE /api/pi/memories/:id`

Request:

```text
{ cwd: string, sessionPath?: string }
```

Response:

```text
{ ok: true, memories: Memory[] }
```

The route permanently deletes one visible record.

## Trace routes

These routes use embedded Elune on the selected backend. They do not require a separate service or a `PI_TRACE_URL`. Capture does not depend on an open view. See [Elune integration](../integrations/elune) for storage, content limits, and usage accounting.

### `GET /api/pi/traces/config`

Response:

```text
{ enabled: boolean, error?: string }
```

An absent `tracing.enabled` setting defaults to `true`. A configuration-read failure returns `enabled: false` with a controlled `error`. This GET still returns `200`. Reading configuration alone does not start the Elune worker.

### `PUT /api/pi/traces/config`

Request:

```json
{ "enabled": false }
```

Response: The same configuration object as GET. The setting applies to new runs on this backend. Turning capture off does not delete traces or interrupt an existing capture. Saving configuration broadcasts `trace_config` on the existing runtime stream.

### `GET /api/pi/traces`

Query:

| Field | Behavior |
| --- | --- |
| `sessionId` | Exact session ID filter. An empty string applies no filter. |
| `cwd` | Exact recorded project directory filter. An empty string applies no filter. |
| `q` | Case-insensitive substring search with whitespace-separated terms. Every term must match a searched field or tag. Maximum 2,048 characters and 32 terms. |
| `status` | `running`, `completed`, `error`, or `aborted`. An empty string applies no filter. |
| `page` | Positive safe integer. Default `1`. |
| `limit` | Positive safe integer. Default `50`, clamped to `200`. |

String filters other than `q` permit at most 4,096 characters. Search checks ID, name, user ID, session ID, input, output, model, session name, cwd, and tags. It does not search observations. Results sort by descending timestamp, then ID. The computed page offset must remain a safe integer.

Response:

```text
{
  traces: TraceSummary[],
  total: number,
  page: number,
  limit: number
}
```

A `TraceSummary` contains these fields:

```text
{
  id: string,
  source: "pi",
  status: "running" | "completed" | "error" | "aborted",
  revision: number,
  name: string,
  timestamp: string,
  environment: string,
  userId: string,
  sessionId: string,
  latency: number,
  totalTokens: number,
  inputTokens: number,
  outputTokens: number,
  cost: number,
  level: string,
  tags: string[],
  bookmarked: boolean,
  model: string,
  version: string,
  metadata: {
    cwd: string | null,
    sessionName: string | null,
    sessionFile: string | null,
    branchId: string | null,
    startEntryId: string | null,
    endEntryId: string | null,
    userEntryId: string | null,
    parentSessionFile: string | null,
    parent: {
      traceId: string | null,
      sessionId: string | null,
      toolCallId: string | null
    }
  },
  readTruncation?: object
}
```

Summaries omit `input`, `output`, full metadata, observations, and scores. A synthetic empty result is:

```json
{ "traces": [], "total": 0, "page": 1, "limit": 50 }
```

### `GET /api/pi/traces/:id`

A decoded ID must match `[a-zA-Z0-9_.:-]{1,160}`. For example, `/api/pi/traces/trace-demo` uses a safe placeholder ID.

Query:

| Field | Default | Allowed value |
| --- | --- | --- |
| `observationOffset` | `0` | Non-negative safe integer |
| `observationLimit` | `200` | Positive safe integer, clamped to `200` |
| `scoreOffset` | `0` | Non-negative safe integer |
| `scoreLimit` | `200` | Positive safe integer, clamped to `200` |

Response: `{ trace: Trace }`. A missing trace returns `404` with `{ "error": "Trace not found" }`.

A detail trace includes the summary's scalar fields, `input`, `output`, full retained `metadata`, `observations`, `scores`, and `pagination`. Detail metadata can contain additional capture and usage fields. It is not restricted to summary metadata.

Observation fields are `id`, `parentId`, `name`, `type`, `startTime`, `duration`, `level`, `status`, `model`, `input`, `output`, `inputTokens`, `outputTokens`, `cost`, and `metadata`. Each observation can also have `readTruncation`. `startTime` is relative to trace start. Durations and trace latency use seconds.

Score fields are `id`, `traceName`, `name`, `value`, `comment`, `source`, `timestamp`, and `dataType`, plus optional `readTruncation`. The detail route exposes stored scores. Leyline has no score-create route or separate observation or score paging route.

Collections use this pagination shape:

```text
pagination: {
  observations: {
    total: number,
    offset: number,
    limit: number,
    nextOffset: number | null,
    truncated: boolean
  },
  scores: {
    total: number,
    offset: number,
    limit: number,
    nextOffset: number | null,
    truncated: boolean
  }
}
```

Follow each collection's `nextOffset` on another detail request. A null value marks the end. Read byte budgets can return fewer items than `limit`. `truncated` is true when more items remain or a returned item has shortened fields.

Reads clip text fields to 32 KiB. Collection reads have an 8 MiB combined budget, with up to 2 MiB reserved for scores. A shortened field adds `readTruncation.fields` and `readTruncation.fieldBytes` to its record. A detail trace can also report `readTruncation.observations: true` or `readTruncation.scores: true` for incomplete collections. Capture-time omission and clipping are separate from these read signals.

### `PATCH /api/pi/traces/:id`

Request:

```json
{ "bookmarked": true }
```

Response: `{ trace: Trace }`, with the updated bookmark and revision. The response loads the first observation and score pages, each limited to 200 items. Bookmark changes publish a committed `trace_updated` notice.

This route changes only the bookmark. There is no trace-delete or general trace-edit endpoint.

### Trace errors

Errors use `{ error: string }`. Unsupported methods return `405` with `Method not allowed`. Unknown trace subpaths return `404` with `Not found`.

Explicit validation returns `400` with one of these messages:

- `enabled must be a boolean`
- `bookmarked must be a boolean`
- `Invalid trace status`
- `Invalid trace identifier`
- `page must be a positive integer` or `limit must be a positive integer`
- `<pagination key> must be a positive integer` for limits
- `<pagination key> must be a non-negative integer` for offsets

Malformed JSON, URI errors, and library type validation return `400` with `Invalid trace request`. Missing records return `404` with `Trace not found`.

Storage and other capture failures return `503` with `Tracing is unavailable. Check the backend log.` Configuration failures use `Could not read or save trace settings. Check the backend log.` Shutdown uses `Tracing is shutting down`.

A configuration response can return `200` with an `error`, even when `enabled` is true. Clients must show this error instead of treating enabled capture as healthy.

## Subagent routes

These routes store Leyline configuration in SQLite on the selected backend, separate from pi `models.json`. Model overrides use `global`, `project`, or `session` scope. Batch size uses only `global` or `session`. Agent defaults sets global values, Project settings sets project models, and Session details sets session overrides.

### `GET /api/pi/subagents`

**Designation:** Browser configuration route.

Query:

```text
cwd: string
sessionPath?: string
```

Response:

```text
{
  context: {
    cwd: string,
    projectId: string,
    projectName: string,
    projectRoot: string,
    sessionAvailable: boolean,
    sessionFile: string | null,
    sessionId: string | null
  },
  batching: {
    global: number,
    session: number | null,
    effective: number,
    source: "global" | "session"
  },
  agents: Array<{
    key: string,
    name: string,
    description: string,
    source: "user" | "project",
    path: string,
    model: string,
    thinking: string,
    tools: string[],
    overrides: { global?: string, project?: string, session?: string },
    effectiveModel: string,
    modelSource: "session" | "project" | "global" | "definition"
  }>
}
```

`batching.global` defaults to 4. A null `batching.session` means that the session inherits the global value. `effective` and `source` identify the applicable size. Without `sessionPath`, the response uses the global value. There is no project batch-size override.

### `PUT /api/pi/subagents/batching`

**Designation:** Browser configuration route.

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  scope: "global" | "session",
  batchSize: number | null
}
```

Response: The same object as `GET /api/pi/subagents`, including `batching`.

A numeric value must be a safe integer from 1 through 9007199254740991. Numeric strings are invalid. `null` removes only a session override. Global scope requires a numeric value. Session scope requires `sessionPath`.

The global value uses `subagents.batch_size` in `leyline_settings`. Session values use `subagent_batch_overrides`. Forks copy session values. Session and project deletion remove batch overrides for the deleted sessions.

Each implicit group or explicit parallel call reads its effective size once. Changes apply to future groups and calls without reload. Running groups retain their size. This setting does not limit total concurrent work across a session or backend.

Unsupported methods return `405`. Validation errors and malformed JSON currently return `500` with `{ error }`. This includes invalid scope or batch size, missing cwd, and missing sessionPath for session scope.

### `PUT /api/pi/subagents/:agentKey/model`

**Designation:** Browser configuration route.

URL-encode `:agentKey`. Agent keys contain a source, canonical file path, and agent name.

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  scope: "global" | "project" | "session",
  model: string
}
```

Response: The same object as `GET /api/pi/subagents`.

The model must be nonempty. The route verifies the agent definition, but it does not verify that the model exists.

### `DELETE /api/pi/subagents/:agentKey/model`

**Designation:** Browser configuration route.

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  scope: "global" | "project" | "session"
}
```

Response: The same object as `GET /api/pi/subagents`.

### `POST /api/pi/subagents/resolve`

**Designation:** Internal bundled-extension route.

Request:

```text
{
  agentKey?: string,
  cwd: string,
  sessionPath?: string,
  staticModel?: string,
  staticThinking?: string
}
```

Without `agentKey`, the response contains only the effective batch size:

```text
{ batchSize: number }
```

With `agentKey`, the response retains the model and thinking fields:

```text
{
  model?: string,
  modelSource: "session" | "project" | "global" | "definition",
  thinking?: string,
  thinkingSource: "definition"
}
```

Stored model precedence is session, project, global, then `staticModel`. Thinking currently comes only from `staticThinking`.

### `POST /api/pi/subagent`

**Designation:** Internal bundled-extension execution route.

The extension schedules batches before it calls this route. Direct requests run one child each without a backend batch limiter.

Request:

```text
{
  title: string,
  task: string,
  cwd: string,
  parentSessionPath?: string,
  parentSessionId?: string,
  _toolCallId?: string,
  model?: string | { provider: string, id: string },
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
  tools?: string[],
  excludeTools?: string[],
  systemPrompt?: string
}
```

`title` is required and must contain a non-whitespace character. The server normalizes whitespace and saves the title as the child's native session name before runtime startup. An invalid title returns `500` with `{ error }` before the server creates a child session.

`parentSessionId` and `_toolCallId` supply capture linkage to the parent session and tool observation. The backend can also resolve the parent by `parentSessionPath`.

`tools` sets an allowlist. `excludeTools` enables all tools discovered by the child runtime except the listed names. A request cannot contain both fields.

Success response:

```text
{
  childSession: { path: string, id: string, cwd: string },
  messages: Array<{ role: string, content: string }>,
  usage: {
    inputTokens: number,
    outputTokens: number,
    totalTokens: number,
    cost: number,
    turns: number
  },
  model?: string,
  modelProvider?: string,
  modelName?: string,
  thinkingLevel?: string,
  stopReason?: string
}
```

`model` and `modelProvider` come from the final assistant message. `modelName` carries the child session model's display name, recorded only when that session model matches the final response model and provider.

The route waits for completion. It returns `500` with `{ error }` for child setup or execution failure. If the HTTP connection closes first, the server aborts the child run.

## Vision agent routes

Vision settings use the same fixed surfaces and selected-backend SQLite storage as [subagent overrides](#subagent-routes). Model and thinking inherit independently. The composer loads its effective configuration separately from the Settings editor.

### `GET /api/pi/vision/config`

**Designation:** Browser configuration route.

Query:

```text
cwd: string
sessionPath?: string
```

Response:

```text
{
  context: {
    cwd: string,
    projectId: string,
    projectName: string,
    projectRoot: string,
    sessionAvailable: boolean,
    sessionFile: string | null,
    sessionId: string | null
  },
  overrides: {
    global?: { model: string, thinking: string },
    project?: { model: string, thinking: string },
    session?: { model: string, thinking: string }
  },
  model: string,
  modelSource: "session" | "project" | "global" | "none",
  thinking: string,
  thinkingSource: "session" | "project" | "global" | "none"
}
```

The server resolves `model` and `thinking` independently. Each field uses session, project, then global precedence. A field is an empty string when no override applies.

### `PUT /api/pi/vision/override`

**Designation:** Browser configuration route.

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  scope: "global" | "project" | "session",
  model?: string,
  thinking?: "inherit" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | ""
}
```

Response: The same object as `GET /api/pi/vision/config`.

The `model` and `thinking` fields are independent. An omitted or empty field clears that field at this scope. If both fields are empty, the route deletes the scope row. Thus, a scope can contain only a model or only a thinking setting.

The `inherit` value uses the parent session's current thinking level when the child starts. The route does not verify model availability, image support, or thinking-level support. The browser lists only available models with image support.

### `DELETE /api/pi/vision/override`

**Designation:** Browser configuration route.

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  scope: "global" | "project" | "session"
}
```

Response: The same object as `GET /api/pi/vision/config`.

The route removes the model and thinking override at the requested scope. A session scope requires a nonempty `sessionPath`. The server uses its canonical path when available and its resolved path otherwise.

### `POST /api/pi/vision/resolve`

**Designation:** Internal bundled-extension route.

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  staticModel?: string
}
```

Response:

```text
{
  model?: string,
  modelSource: "session" | "project" | "global" | "static",
  thinking?: string,
  thinkingSource: "session" | "project" | "global" | "none"
}
```

Stored model values use session, project, global, then `staticModel` precedence. Stored thinking values use session, project, then global precedence. The route returns `inherit` unchanged.

### `POST /api/pi/vision`

**Designation:** Internal bundled-extension execution route.

Request:

```text
{
  question?: string,
  cwd: string,
  parentSessionPath?: string,
  parentSessionId?: string,
  _toolCallId?: string,
  model?: string | { provider: string, id: string },
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
  image: { type: "image", data: string, mimeType: string }
}
```

Success response: The same object as `POST /api/pi/subagent`.

`parentSessionId` and `_toolCallId` supply capture linkage, as on the subagent route. The isolated child retains output-budget and inline Elune capture.

The route creates one isolated child with an empty tool allowlist. The selected model must exist, have provider authentication, and support image input. The image must be PNG, JPEG, GIF, or WebP.

The route waits for completion and returns `500` with `{ error }` for setup or execution failure. If the HTTP connection closes first, the server aborts the child run.

## Export route

### `GET /api/pi/sessions/:id/export`

**Designation:** Browser route.

Query:

```text
disposition?: "inline" | string
```

Response: An HTML document with `Content-Type: text/html; charset=utf-8`.

`disposition=inline` sets `Content-Disposition: inline`. All other values use `attachment`. Both forms include a sanitized export filename. An unknown session currently returns `500`.

Subagent inspectors use matching Action ledger and reader styles for task text already available in the parent's tool result. Export does not fetch or embed the full child transcript or subscribe to live child events.

## Event WebSockets

Runtime and Git review events use separate WebSockets on the selected backend. Use `ws://` with an HTTP backend and `wss://` with an HTTPS backend. A successful upgrade returns HTTP `101`. An ordinary HTTP `GET` returns `426` instead of an SSE stream.

Each event is one JSON text message:

```json
{"type":"runtime_roster","data":{"sessionIds":[]}}
```

These sockets accept heartbeat replies, not API commands. Continue to send prompts, session actions, and file requests through HTTP.

Every 30 seconds, the server sends this application heartbeat:

```json
{"type":"ping"}
```

Reply with this exact text before the next heartbeat check:

```json
{"type":"pong"}
```

The current server matches the pong text literally, so whitespace or additional fields will not match. These are application messages, not WebSocket ping/pong control frames. Client messages have a 1 KiB payload limit. A missing heartbeat reply terminates the socket.

Clients must implement reconnect and state refresh. The server supplies no replay IDs or event history. Leyline's helper owns retries, timeouts, and cleanup. See [Connection recovery](../developer-guide/realtime-events#connection-recovery).

### `WS /api/pi/events`

**Designation:** Browser and Electron runtime stream.

Query:

```text
sessionId?: string
```

Each connection sends one `active_session` event for every open runtime, followed by `runtime_roster`. This includes reconnects.

The browser supplies `?sessionId=<id>` to select full snapshots and live updates for one session. Other sessions receive compact snapshots and filtered runtime events. Compact `promptQueue` state contains `count`, `held`, and `error`, without item content. Compact snapshots retain `session`, `titleGenerating`, and `isBashRunning`, but omit `bashExecution`.

An empty `sessionId` selects no full runtime. Omitting the parameter selects full events for all runtimes, for protocol compatibility.

This query controls payloads for one connection. It does not activate the requested runtime. The subagent inspector opens a separate child-scoped connection only for its selected running child. Closing this connection does not abort the child run. Saved child previews use read-only session detail without a runtime connection. Snapshots omit transcript entries and in-flight assistant content, so child observers also request saved [session detail](#session-routes) with `toolArguments=1`.

Implemented event types and their `data` values are:

```text
active_session: Active

runtime_roster: { sessionIds: string[] }

runtime_removed: { id: string }

runtime_event: {
  activeSessionId: string,
  event: object,
  handoffId?: string
}

extension_ui: {
  activeSessionId: string,
  state: Active.state.extensionUi
}

extension_error: {
  activeSessionId: string,
  error: unknown
}

trace_updated: {
  traceId: string,
  sessionId: string,
  revision: number,
  activeSessionId: string
}

trace_config: {
  enabled: boolean,
  error?: string
}
```

Trace notices reuse this stream without full trace payloads. `trace_updated` follows a storage commit. Trace views refresh paged HTTP data after notices or reconnect. These notices do not enter transcript projection.

`runtime_event.event` contains a pi SDK event or a Leyline shell lifecycle event. Its nested fields depend on the event type. The connection stays open until the client or server closes it.

For queued shell commands, full events use these shapes:

```text
bash_execution_start: { type: "bash_execution_start", ...BashExecution }
bash_execution_update: {
  type: "bash_execution_update",
  id: string,
  delta: string,
  output: string,
  revision: number
}
bash_execution_end: { type: "bash_execution_end", ...BashExecution }
```

Start and end events come from the queue executor. Updates come from native `executeBash()` and include the current output tail and revision. An extension-supplied result can complete without update events. A deferred native result can produce an end event before it enters the session manager, then another with the exact `entryId`.

Background connections receive start/end summaries with `id`, `status`, `entryId`, and optional `error`, but no shell updates. `runtime_removed` can report idle disposal. It does not mean that the session was deleted.

## Terminal WebSocket

### `WS /api/pi/terminal`

**Designation:** Browser and Electron terminal transport.

The server accepts an HTTP WebSocket upgrade at this path. Leyline supplies the selected session in the query string:

```text
/api/pi/terminal?sessionId=<session-id>
```

The `sessionId` parameter is optional for protocol compatibility. When present, the server resolves that runtime handle without changing the process-wide active session. Without `sessionId`, the server uses the active runtime.

A file action with `terminal: true` requires an editor terminal connection:

```text
sessionId: string
editorPath: string
editorLine?: positive integer
allowOutsideProject?: "true"
```

`editorPath` must be the absolute canonical file path. An editor terminal requires `sessionId` and a configured terminal editor. For an approved outside-project file, send `allowOutsideProject=true`. The server resolves the path again and checks that it still equals `editorPath`. Editor setup errors send an `error` message and close the socket.

Client messages:

```json
{ "type": "input", "data": "ls\r" }
```

```json
{ "type": "resize", "cols": 120, "rows": 32 }
```

Malformed JSON and unknown message types are ignored. Missing resize values use 100 columns and 24 rows.

Server messages:

```text
{ type: "ready", cwd: string, shell: string, editorPath?: string, pty: true }
{ type: "data", data: string }
{ type: "exit", exitCode: number }
{ type: "error", message: string }
```

The first successful message is `ready`. For an editor terminal, `shell` identifies the editor executable and `editorPath` identifies the file. Terminal output uses `data`. A PTY exit sends `exit` and then closes the socket.

If the requested session does not exist, the server sends `{"type":"error","message":"Session not found"}` and closes the socket. An unscoped request with no active session sends `{"type":"error","message":"No active session"}`.

An invalid working directory or PTY start failure also sends an error and closes the socket. Closing the client socket kills a running PTY.
