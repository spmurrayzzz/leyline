# API reference

Leyline serves the runtime API under `/api/pi`. The native backend also serves the connection registry and app settings under `/api/leyline`.

These APIs have no authentication or cross-user access control.

Successful runtime requests usually return `200`. A connection create request
returns `201`. An accepted preflight request returns `204`.

## Conventions and status behavior

JSON requests use `Content-Type: application/json`. Extra request fields are ignored. A field marked `?` can be omitted. JSON serialization omits object properties whose value is `undefined`. The current JSON reader has no explicit body-size limit.

Most errors have this envelope:

```json
{ "error": "Error message" }
```

Status behavior is:

- `400` is used for connection or setting validation and a missing `path` on `GET /sessions/by-path`.
- `403` rejects a browser origin that the server does not allow.
- `404` is used for an unknown runtime, native app route, setting key, or session.
- `405` is used when a known route receives an unsupported method.
- `500` is used for thrown runtime errors. This includes malformed JSON, SDK errors, missing memories, and some missing sessions.

The current status codes do not distinguish all client errors from server
errors. Clients must read the `error` value.

HTTP routes and terminal WebSocket upgrades use the same origin policy.
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
  firstMessage: string,
  timestamp?: string
}
```

`timestamp` is the session creation time as an ISO string. `firstMessage` is limited to 140 characters.

### Session detail

```text
SessionDetail = {
  session: SessionSummary & {
    sessionFile: string,
    messageCount: number,
    contextTokens: number | null,
    modified: string,
    created: string,
    contextUsage?: object
  },
  entries: TranscriptEntry[]
}
```

A transcript entry is a projected `message`, `tool`, `event`, or `summary` object. Each entry has `id`, `type`, `timestamp`, `copyText`, `rolloutFeedback`, and `rolloutFeedbackText` where applicable. Message entries include role, text, and text, image, or thinking blocks. Tool entries can include file, diff, patch, image, bash, and subagent data.

### Active runtime

```text
Active = {
  id: string,
  path: string,
  cwd: string,
  diagnostics: object[],
  state: {
    model?: Model,
    availableModels: Model[],
    thinkingLevel: string,
    availableThinkingLevels: string[],
    isStreaming: boolean,
    isCompacting: boolean,
    pendingToolCalls: object[],
    steeringMode: string,
    followUpMode: string,
    activeToolCount: number,
    activeToolNames: string[],
    contextUsage?: object,
    slashCommands: SlashCommand[],
    queuedMessages: { steering: object[], followUp: object[] },
    extensionUi: {
      statuses: object,
      widgets: object,
      notifications: object[]
    },
    goal: Goal | null
  }
}

Model = {
  id: string,
  name: string,
  provider: string,
  supportsImages: boolean,
  availableThinkingLevels: string[]
}

SlashCommand = {
  name: string,
  description?: string,
  source: "command" | "extension" | "prompt" | "skill"
}

Goal = {
  objective: string,
  status: string,
  tokenBudget: number | null,
  continuationLimit: number,
  continuationsUsed: number,
  tokensUsed: number,
  timeUsedSeconds: number,
  createdAt: number,
  updatedAt: number
}
```

The extension UI objects contain status strings, widget line arrays, and notification records from bundled extensions.

## Backend information

### `GET /api/pi/info`

Leyline uses this route before it selects a saved backend.

Response:

```text
{
  name: "Leyline",
  version: string,
  apiVersion: 1,
  capabilities: {
    events: true,
    exports: true,
    terminal: true
  }
}
```

The frontend rejects a backend when `name` or `apiVersion` is incompatible.

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

The server currently accepts only the `ui.thinking_default` setting key.

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

## Session routes

### `GET /api/pi/sessions`

**Designation:** Browser route.

Response:

```text
{ sessions: SessionSummary[] }
```

The list includes persisted sessions and open runtimes that are not yet in the persisted list.

### `POST /api/pi/sessions`

**Designation:** Browser route.

Request:

```text
{ cwd: string }
```

Response:

```text
{ active: Active, detail: SessionDetail }
```

The route creates the directory if necessary, creates a pi session, loads a runtime, and makes it active. Missing `cwd` produces `500`.

### `GET /api/pi/sessions/:id`

**Designation:** Browser route.

Query:

```text
path?: string
```

Response: `SessionDetail` without an outer envelope.

If `path` is present, Leyline opens that file and verifies that its session ID equals `:id`. A missing session returns `404`. An ID and path mismatch returns `500`.

### `GET /api/pi/sessions/by-path`

**Designation:** Browser route used for parent and child navigation.

Query:

```text
path: string
```

Response: `SessionDetail` without an outer envelope.

A missing query returns `400`. A session that cannot be resolved returns `404`.

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
```

Response:

```text
{ active: Active }
```

For a different `cwd`, Leyline creates a temporary, unpersisted runtime state and then disposes it. If `cwd` is absent, it uses the active runtime directory or the server process directory.

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

## Runtime action routes

The scoped routes act on `:id`. They do not change the selected active session. If the runtime is not open, Leyline loads it. An unknown `:id` returns `404`.

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
  streamingBehavior?: "steer" | "followUp"
}
```

Response:

```text
{ ok: true, active: Active }
```

The response means prompt preflight succeeded. The model response can continue through SSE. Empty text is valid only when at least one valid image is present. Supported MIME types are PNG, JPEG, GIF, and WebP.

A model with image support receives the images directly. For other models, the request waits while the configured vision model describes each image. Leyline persists the original user message and replaces its images with the descriptions in parent-model context. A missing or invalid vision model returns `500`.

A disconnected prompt request or session interrupt cancels unfinished vision preflight.

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
{ ok: true, active: Active, detail: SessionDetail }
```

The response is sent after the shell action finishes. An empty command or a concurrent shell command returns `500`.

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

The entry must be a user message. Leyline moves the active tree position and submits the replacement prompt. The response means prompt preflight succeeded. Replacement images use the same direct-image or vision-delegation behavior as a new prompt.

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

Interrupt also aborts pending vision preflight and its unfinished child runs.

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

Reload recreates the runtime at the current leaf. Streaming or compaction returns `500`.

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

Missing fields, an unknown model, or a provider failure returns `500`.

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

## Active-session history routes

These actions currently have no scoped equivalent.

### `POST /api/pi/fork`

**Designation:** Active-session browser route.

Request:

```text
{ entryId: string }
```

Response:

```text
{ ok: true, active: Active, detail: SessionDetail }
```

The route forks at the specified entry, changes the runtime session ID, and selects the fork. It also copies session-level subagent and vision-model overrides. Streaming or compaction returns `500`.

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

## Subagent routes

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
  agentKey: string,
  cwd: string,
  sessionPath?: string,
  staticModel?: string,
  staticThinking?: string
}
```

Response:

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

Request:

```text
{
  task: string,
  cwd: string,
  parentSessionPath?: string,
  model?: string | { provider: string, id: string },
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
  tools?: string[],
  systemPrompt?: string
}
```

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
  thinkingLevel?: string,
  stopReason?: string
}
```

The route waits for completion. It returns `500` with `{ error }` for child setup or execution failure. If the HTTP connection closes first, the server aborts the child run.

## Vision agent routes

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
  overrides: { global?: string, project?: string, session?: string },
  model: string,
  modelSource: "session" | "project" | "global" | "none"
}
```

The effective model uses session, project, then global precedence. `model` is an empty string when no override applies.

### `PUT /api/pi/vision/model`

**Designation:** Browser configuration route.

Request:

```text
{
  cwd: string,
  sessionPath?: string,
  scope: "global" | "project" | "session",
  model: string
}
```

Response: The same object as `GET /api/pi/vision/config`.

The model must be nonempty. The route stores the value but does not verify model availability or image support. The browser lists only available models with image support.

### `DELETE /api/pi/vision/model`

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

The route removes the override at the requested scope. A session scope requires a nonempty `sessionPath`. The server uses its canonical path when available and its resolved path otherwise.

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
  modelSource: "session" | "project" | "global" | "static"
}
```

Stored session, project, and global values take priority over `staticModel`.

### `POST /api/pi/vision`

**Designation:** Internal bundled-extension execution route.

Request:

```text
{
  question?: string,
  cwd: string,
  parentSessionPath?: string,
  model?: string | { provider: string, id: string },
  image: { type: "image", data: string, mimeType: string }
}
```

Success response: The same child-session, message, usage, model, thinking, and stop-reason object as `POST /api/pi/subagent`.

The route creates one hidden child with an empty tool allowlist. The selected model must exist, have provider authentication, and support image input. The image must be PNG, JPEG, GIF, or WebP.

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

## Server-sent events

### `GET /api/pi/events`

**Designation:** Browser runtime stream.

Response headers include `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `Connection: keep-alive`.

The stream starts with:

```text
: connected
```

It then sends one `active_session` event for each open runtime. Event frames use this format:

```text
event: <event name>
data: <JSON value>
```

Implemented event names and data are:

```text
active_session: Active

runtime_event: {
  activeSessionId: string,
  event: object
}

extension_ui: {
  activeSessionId: string,
  state: Active.state.extensionUi,
  goal: Goal | null
}

extension_error: {
  activeSessionId: string,
  error: unknown
}
```

`runtime_event.event` is the pi SDK runtime event. Its nested fields depend on the event type. The connection stays open until the client or server closes it.

## Terminal WebSocket

### `WS /api/pi/terminal`

**Designation:** Browser and Electron terminal transport.

The server accepts an HTTP WebSocket upgrade only at this exact path. It requires an active runtime with an existing working directory.

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
{ type: "ready", cwd: string, shell: string, pty: true }
{ type: "data", data: string }
{ type: "exit", exitCode: number }
{ type: "error", message: string }
```

The first successful message is `ready`. Terminal output uses `data`. A PTY exit sends `exit` and then closes the socket.

If no active session exists, the server sends `{"type":"error","message":"No active session"}` and closes the socket. An invalid working directory or PTY start failure also sends an error and closes the socket. Closing the client socket kills a running PTY.
