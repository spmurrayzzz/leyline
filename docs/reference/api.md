# API reference

Leyline serves the runtime API under `/api/pi`. The native backend also serves the connection registry and app settings under `/api/leyline`.

These APIs have no authentication or cross-user access control.

Successful runtime requests usually return `200`. A connection create request
returns `201`. A CORS preflight request (`OPTIONS`) returns `204`.

## Conventions and status behavior

JSON requests use `Content-Type: application/json`. Most routes ignore extra fields. Pi Settings rejects unsupported provider, model, target, and editable MCP fields. A field marked `?` can be omitted. JSON serialization omits object properties whose value is `undefined`. The current JSON reader has no explicit body-size limit.

Most errors have this envelope:

```json
{ "error": "Error message" }
```

Status behavior is:

- `400` is used for connection, setting, queue, file-action, or confirmation validation. Missing required query values on session lookup or Git review routes also return `400`.
- `403` rejects a browser origin that the server does not allow.
- `404` is used for an unknown runtime, native app route, setting key, or session.
- `405` is used when a known route receives an unsupported method.
- `409` rejects stale queue or configuration revisions, expired confirmation replies, and conflicting Settings operations.
- Pi Settings also uses `429` for its operation limit and `503` for unavailable or busy runtime resources. See [Pi Settings routes](#pi-settings-routes).
- `500` is used for thrown runtime errors. This includes malformed JSON on most runtime routes, SDK errors, missing memories, and some missing sessions.

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
  research: ResearchSummary | null,
  firstMessage: string,
  messageCount: number,
  modified?: string,
  timestamp?: string
}
```

`timestamp` is the session creation time as an ISO string. `modified` is the latest user or assistant message time.

For persisted sessions without message times, `modified` uses the session creation time or file modification time. `messageCount` counts all message records. `firstMessage` is limited to 140 characters.

Session detail and open-runtime summaries use the research objective for `firstMessage` when the branch has no user message.

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
  state: {
    model?: Model,
    availableModels: Model[],
    thinkingLevel: string,
    availableThinkingLevels: string[],
    isStreaming: boolean,
    isCompacting: boolean,
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
    goal: Goal | null,
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
    status: "pending" | "sending"
  }>
}

Model = {
  id: string,
  name: string,
  provider: string,
  supportsImages: boolean,
  supportsUltrafast: boolean,
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

`Model.supportsUltrafast` reports model and authentication eligibility, not whether Ultrafast is on. Eligible models are `gpt-6-astra` and `gpt-6.1-sol` on these transports:

- `openai-codex` with `openai-codex-responses`.
- `openai` with `openai-responses` and API-key authentication. Subscription authentication is excluded.

The bundled extension publishes `extensionUi.statuses["leyline-ultrafast"]` as `"on"` or `"off"`. A missing status does not mean the extension is available. Ultrafast starts off and applies to the current runtime only. Model changes and runtime reload reset it to off. A new fork starts off.

Retry and prompt edits preserve Ultrafast when the runtime and model stay unchanged. Compaction and branch summaries do not use Ultrafast.

If an extension changes the model during a run, reset waits for a safe turn or provider boundary.

Open-runtime snapshots carry `snapshotRevision`. Clients reject older snapshots for the same session, whether they arrive through HTTP or SSE. Start-screen previews can omit this field and `promptQueue`.

`promptQueue` contains editable, unsent tasks. Full images stay on the backend; each item exposes only `imageCount`. Use `promptQueue.revision` for queue mutations, not `snapshotRevision`.

`queuedMessages` contains read-only display text for inputs already accepted by pi. It is separate from the editable queue.

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
    research: true,
    review: true,
    reviewWatch: true,
    terminal: true,
    fileLinks: true,
    piSettings: true
  }
}
```

The frontend rejects a backend when `name` or `apiVersion` is incompatible. It shows the research control only when `capabilities.research` is `true`.

It shows the desktop review control only when `capabilities.review` is `true`. It opens the automatic review stream only when `capabilities.reviewWatch` is `true`.

Local file actions and the Files settings section require `capabilities.fileLinks: true`.

Models & providers and MCP servers require `capabilities.piSettings: true`. These categories use the selected backend, even inside the global Settings modal.

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

## Pi Settings routes

These routes use `/api/pi/settings` on the selected backend. Every response sets `Cache-Control: no-store`. Successful requests return `200` without an `ok` envelope.

Configuration is global to that backend's pi agent directory, resolved through `getAgentDir()`. Provider and model edits change `models.json`. MCP edits change `mcp.json`. Native authentication owns `auth.json` and `mcp-auth.json`. These files are separate from Leyline's SQLite overrides.

The API does not edit project MCP files, general pi preferences, model-picker visibility, or Codemode settings. Edits preserve unrelated fields. Explicit deletion and MCP transport changes can remove stored fields that the editor does not display.

### Targets and revisions

Provider reads accept these query parameters:

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
  kind: "custom" | "override" | "catalog",
  overrides: ModelMetadata
}

ModelMetadata = {
  name?: string,
  contextWindow?: number,
  maxTokens?: number,
  reasoning?: boolean,
  input?: Array<"text" | "image">,
  cost?: ModelCost
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

`configured` reports credential-source metadata, not a successful model request. Stored keys, tokens, header values, and API-key commands are omitted. Unsafe base URLs appear as an empty string. Model records contain only the listed metadata, not their full SDK configuration. Pricing tiers are read-only here.

Ordinary reads refresh the settings runtime's authentication snapshot with `allowNetwork: false`. Loading project extensions can still run their startup work. `refresh=1` replaces that cwd's settings runtime and reloads extension registrations. It does not refresh an open conversation's catalog. Use the provider `refresh` action for a forced network catalog refresh.

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

A base URL must use HTTP or HTTPS without credentials, query, fragment, or surrounding whitespace. API keys accept nonempty text, including pi environment references or `!command`. An empty command is invalid.

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

Omitted fields remain unchanged. Null values do not clear model fields. Model API, endpoint, compatibility, input limits, cache policy, and pricing tiers are not editable here.

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

### Provider authentication and catalog actions

#### `POST /api/pi/settings/providers/action`

Request:

```text
{
  target?: { sessionId?: string, cwd?: string },
  providerId: string,
  action: "login" | "logout" | "refresh",
  authType?: "api_key" | "oauth"
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

`credentialChanged` occurs for login and logout, not refresh. A warning can mean credentials were saved but catalog synchronization or installation-settings persistence failed.

Provider writes, authentication, and conversation runtime construction share a lock. Before login, Leyline compares provider routes across open, background, and constructing runtimes. A missing model or different API/base URL blocks login before new credentials can reach an old endpoint. This failure occurs inside the operation, with `state: "error"`, rather than as an HTTP `409` from the action request. Reload all affected sessions after active work finishes, or restart the backend.

Saving or authenticating does not refresh live conversation catalogs, abort runs, or reload sessions. Explicit session reload remains separate. Home can request a fresh [`/state` preview](#get-api-pi-state) with `cwd` and `refresh=1`.

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

Provider and MCP actions return a private, polled operation. These operations do not appear in session SSE, extension confirmations, or transcript entries. Private describes this transport separation, not access control. The API still has no authentication.

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
| `400` | Invalid target, fields, values, configuration changes, or action. |
| `400` | Answer is not a string or is too long: `Invalid response`. |
| `400` | Select answer is unavailable: `Select an available option`. |
| `404` | Missing provider/model configuration, missing MCP action target, or unknown Settings path. |
| `404` | Unknown or expired operation: `This settings operation expired. Start it again.` |
| `405` | Unsupported method on inventory, model, or operation routes: `Method not allowed`. |
| `409` | Missing/stale file revision, invalid stored configuration, duplicate creation, unavailable MCP edit target, Radius URL change, or conflicting settings target. |
| `409` | Stale answer: `This prompt is no longer active.` |
| `409` | Duplicate active operation: `An operation for this provider or server is already in progress.` |
| `429` | Eight active operations already exist: `Too many settings operations are in progress.` |
| `503` | Settings runtime cannot load, refresh authentication, or acquire capacity, or the backend is shutting down. |
| `500` | Malformed JSON or unexpected filesystem, SDK, or worker error outside an operation. |

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

### `GET /api/pi/review/events`

**Designation:** Browser review stream.

Query:

```text
cwd: string
```

Response headers include `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `Connection: keep-alive`.

The stream starts with:

```text
: connected
```

Event frames use these names and data:

```text
review_change: {
  root: string
}

review_watch_error: {
  message: string
}
```

The backend shares one recursive watcher for clients that resolve to the same repository root. It closes the watcher after the last client disconnects. Ordinary `.git` activity and ignored working-tree paths do not emit `review_change`; relevant Git metadata does.

A new connection starts after watcher setup, so the frontend can use it as a catch-up boundary. A watcher setup or runtime error sends `review_watch_error` and closes the response. `EventSource` clients can reconnect automatically.

Changes can share one `review_change` event. The event contains no status list or diff. Clients fetch current data from the review routes.

A missing `cwd` returns `400` before the stream starts. Other setup failures use `review_watch_error` in the `200` SSE response.

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

Prompt preflight and model or Ultrafast changes share a per-runtime submission lock. A prompt during either change returns `500`, including while model authentication resolves. It does not enter the editable queue. Automatic queue dispatch waits until the change finishes.

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
| `edit` | `id`, `text` | Replace pending text, retain attachments, and hold the queue. Cancel any unaccepted queue submission. |
| `remove` | `id` | Remove the pending task. Removing the last task clears the hold and queue error. |
| `move` | `id`, `direction` | Move the pending task one position up or down. |
| `steer` | `id` | Submit the pending task through pi's steering path. Requires an unheld queue. |

Item mutations require `status: "pending"`. The UI calls `hold` before opening an editor, then `edit` on Save. Empty replacement text is valid only if the item has images.

Invalid actions, missing items, changes to a sending item, or blocked lifecycle operations return `400`. Dispatch failures remain in `promptQueue.error`; inspect the returned snapshot after Resume or Steer.

Pi acceptance removes the task from the editable queue. These routes do not edit, clear, or replay native pi queues.

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

The runtime must be idle, with no pending prompt setup or interrupt. Initialization, extension binding, reload, or another model or Ultrafast change also blocks the request. Missing fields, an unknown model, authentication failure, or a blocked change returns `500`.

The model change holds the submission lock through pi's authentication check and model selection. Prompt preflight and Ultrafast changes cannot run concurrently. Automatic queue dispatch waits until the change finishes.

### Set Ultrafast

`POST /api/pi/sessions/:id/ultrafast` changes the mode on that runtime. There is no legacy active-session equivalent.

Request:

```text
{ enabled: boolean }
```

Response:

```text
{ ok: true, active: Active }
```

Enabling requires `active.state.model.supportsUltrafast: true` and the bundled command in the runtime. Disabling does not require an eligible model, but still requires the command.

The runtime must be idle, with no pending prompt setup or interrupt. Initialization, extension binding, reload, or another model or Ultrafast change blocks the request. Invalid `enabled`, unavailable support, or a blocked change returns `500` with `{ error }`. An unknown session returns `404`.

Read `active.state.extensionUi.statuses["leyline-ultrafast"]` for the resulting mode. The response has no separate `enabled` field. A cancelled setup or runtime replacement can leave the mode unchanged despite `ok: true`. If the HTTP response closes before completion, the server cancels pending Ultrafast setup when possible.

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

Pending extension UI confirmations appear in `active.state.extensionUi.confirmations`. The runtime publishes changes through `extension_ui` and `active_session` SSE events. Compact snapshots for other sessions retain `pendingConfirmationCount`, without confirmation records.

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

## Subagent routes

These routes store Leyline overrides in SQLite on the selected backend. Agent defaults uses `global`, Project settings uses `project`, and Session details uses `session`. The UI surface fixes the scope. These overrides are separate from pi `models.json` definitions and overrides.

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
  excludeTools?: string[],
  systemPrompt?: string
}
```

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
  thinkingLevel?: string,
  stopReason?: string
}
```

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
  model?: string | { provider: string, id: string },
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
  image: { type: "image", data: string, mimeType: string }
}
```

Success response: The same object as `POST /api/pi/subagent`.

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

It then sends one `active_session` event for each open runtime, followed by `runtime_roster`.

The browser supplies `?sessionId=<id>`. That session receives full snapshots; other sessions receive compact snapshots. Compact `promptQueue` state contains `count`, `held`, and `error`, without item content.

Event frames use this format:

```text
event: <event name>
data: <JSON value>
```

Implemented event names and data are:

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
