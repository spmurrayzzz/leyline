# pi SDK integration

Leyline discovers sessions by scanning pi JSONL files with bounded concurrent readers. It caches unchanged summaries by file modification time and size.

`PI_CODING_AGENT_SESSION_DIR` selects a different session root. Leyline uses `SessionManager.open(path)` and `getBranch()` for transcript detail.

`AgentSessionRuntime` owns execution. Leyline keeps one runtime handle for each loaded session and tracks one selected active handle. Scoped API actions can run in background sessions without changing the selected session.

Unobserved idle handles are eligible for disposal after 5 minutes by default. The selected backend's runtime setting accepts 0 through 1440 minutes. 0 disables cleanup. Active work, queued inputs, pending approvals, lifecycle operations, and matching session WebSocket observers protect handles. Disposal shuts down extensions and MCP resources without deleting history.

Reopening or a scoped action restores retained branch/model/thinking state with fresh connections. The exact premium tier restores only for the same provider/model, with current eligibility and the service-tier command available. See [Idle runtime cleanup](../developer-guide/backend-api#idle-runtime-cleanup) for restoration limits.

`ModelRuntime` is the current SDK boundary for model access and authentication. Leyline uses `services.modelRuntime` and `session.modelRuntime` for lookup, available snapshots, and subscription state. `custom-providers.js` wraps public authentication and streaming methods without patching SDK internals.

Upstream references include [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [Configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md), [Provider Authentication](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md), and [MCP Servers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md). These pages can describe versions newer than the ones Leyline installs.

`AgentSession.prompt()` handles commands, skills, templates, native input delivery, authentication, compaction, and persistence. Native steering and follow-up delivery remain `one-at-a-time`.

Leyline holds editable prompts and shell commands in one **Up next** queue on each runtime handle. It dispatches one task when `session.isIdle` and lifecycle guards permit it. Prompt tasks use `session.prompt()`, with `preflightResult` marking acceptance. **Steer** uses native delivery and cannot be edited afterward. Ordinary prompt requests during model or service-tier changes remain accepted in the editable queue until dispatch is safe.

Both bash routes confirm queue acceptance with `{ ok: true, queued: true, active }`, not command completion. Multiple commands can queue. Shell items expose `shell: true`, have no images, require `!` or `!!` when edited, and cannot steer. Shell dispatch first emits native `user_bash` hooks. Returned operations go to `session.executeBash()`. A supplied result goes to `session.recordBashResult()`. Hook failures block execution. No assistant reply starts automatically.

Shell preparation and execution use `isBashRunning`, full-snapshot `bashExecution`, and `bash_execution_start`, `bash_execution_update`, and `bash_execution_end` events. Live execution IDs differ from the exact native `bashExecution` message `entryId` supplied after the message enters the session manager. Pi can defer writing it to disk. Reconciliation uses that entry ID. Pre-execution failures retain the task and hold the queue. Cancellation, nonzero exits, and later errors hold remaining tasks.

Stop holds remaining unsent tasks without clearing pi's native queues. An empty queue returns to normal Send. Runtime reload retains pending tasks held; backend restart discards them. See [Pending prompts](../developer-guide/backend-api#pending-prompts) for queue ownership and acceptance rules.

For a parent model without image support, Leyline validates the vision model and saves pasted images before it calls `AgentSession.prompt()`. A session `agent.transformContext` wrapper keeps the original images in JSONL history. It replaces them in parent-model context with saved file paths and `vision_agent` instructions. The parent calls the tool during its turn.

Forking opens a separate `SessionManager`, calls `createBranchedSession(entryId)`, and starts a new runtime. The source runtime and its queues remain intact. Prompt edits use `session.navigateTree(entryId)` before Leyline submits replacement content. Rename appends pi session information. Delete moves the JSONL file to Leyline trash.

Pi session logs are tree-structured JSONL records. Normal writes use runtime and session-manager primitives. Reset to here is an explicit exception. It rewrites the file so that the selected active branch ends at the target entry.

Normal runtimes load output-budget, ultrafast, memory, subagent, research, and vision-agent. They also append the Leyline system prompt. Conversation runtimes also install Elune through a named inline factory. Isolated custom-prompt children retain output-budget and inline capture.

Bundled extensions replace matching conflicts. The service-tier extension keeps its `ultrafast` directory name and runs last. See [Runtime construction](../developer-guide/backend-api#runtime-construction) for the loading contract.

Normal runtimes add native MCP and tool search through SDK factories. Leyline enables `tool_search` unless settings explicitly disable it. Codemode is not loaded and remains excluded.

## Service tiers

`.pi/extensions/ultrafast/index.js` owns Standard/Fast/Ultrafast selection. `lib/ultrafast.js` defines explicit eligibility, and model DTOs expose `serviceTiers`. No dynamic Codex catalog controls eligibility. Standard is the runtime-local default, with no durable tier setting.

`POST /api/pi/sessions/:id/service-tier` accepts `{ tier }` and invokes the `leyline-service-tier` command through `session.prompt()`. The matching status key contains `standard`, `fast`, or `ultrafast`. The legacy `leyline-ultrafast` command/status and `POST /api/pi/sessions/:id/ultrafast` with `{ enabled }` remain for compatibility only.

Model changes, explicit reloads, and reset navigation select Standard. New forks start Standard. Same-runtime, same-model retries and edits retain the exact tier. The edit path restores it through the command after extension binding, including rollback. Idle restoration applies the same current eligibility checks.

The runtime wraps `agent.streamFunction` and copies request options before it emits `leyline:provider-request`. It uses `AsyncLocalStorage` to retain the options object's identity. Through `leyline:request-boundary-ready`, the extension receives a function that reads that identity. Its `WeakMap` stores the request's model, costs, signal, and tier snapshot. Header hooks require that identity, while payload and response hooks verify the captured model and signal.

This boundary excludes compaction and branch summaries, including concurrent summary calls. Both premium tiers stop cache warming. Fast sends `service_tier: "priority"`, and Codex routing headers match the request tier.

The extension resolves public `calculateCost()` and `cleanupSessionResources()` from the coding-agent package's own `@earendil-works/pi-ai` dependency. The separate direct dependency can have a different cleanup registry. Safe-boundary cleanup closes cached transports for tier changes and model switches, including Standard-to-Standard switches.

Final response fields determine cost adjustment, subject to provider-specific fallback rules. The extension recalculates base costs before it applies one multiplier, avoiding double counting of native tier pricing. Fast uses native factors of 2, or 2.5 for exact `gpt-5.5`. Ultrafast uses 6. These are cost estimates, not authoritative billing amounts. See [Service tiers](../developer-guide/backend-api#service-tiers) for response fields, Codex fallback, direct OpenAI downgrades, and the complete request contract.

Browser/Vite and packaged Electron share this runtime path. Packaged runtimes execute in the backend utility process.

## Automatic session titles

`GET` and `PUT /api/pi/settings/session-titles` use the selected backend's Leyline SQLite settings, not pi configuration files. Defaults are disabled, an empty model, and an empty thinking value for the lowest supported level. There are no project/session overrides or conversation-model fallback. Runtime cleanup settings likewise use selected-backend SQLite through `/api/pi/settings/runtime`.

A generator belongs only to a newly created ordinary conversation. After pi accepts its first user message, it runs a separate `ModelRuntime.streamSimple()` request beside the conversation. It uses an independent title model/thinking choice, its own short instruction, and at most 1,024 submitted text characters. It includes no session prompt, history, context files, tools, or images. It does not call `session.prompt()` or change the conversation model/thinking.

A valid result uses native `session.setSessionName()` rather than an assistant message. Full and compact runtime snapshots carry `titleGenerating` separately from conversation streaming, plus the current `session` summary. Manual names and explicit clears win. Existing/resumed sessions, forks, research sessions, and children do not receive generators. Failures preserve the normal label. See [Automatic session titles](../developer-guide/backend-api#automatic-session-titles) for limits and cancellation, and the [settings contract](../reference/api#session-title-settings) for validation and storage keys.

## Trace capture integration

`@elune/embedded/pi` supplies `createPiTracingExtension()`. Leyline installs its factory through `resourceLoaderOptions.extensionFactories` and binds a subscription to the current `AgentSession`. Replacement sessions require fresh binding and capture cleanup.

Capture uses extension hooks and runtime events for provider identity, finalized messages, nested tools, retries, settlement, and compaction. Host wrappers return without waiting for storage. A capture failure reports an error without blocking pi execution.

Home preview runtimes disable capture. Provider Settings runtimes and private probes do not install the capture factory. Conversation, research, subagent, and isolated vision runtimes retain capture independently of trace view lifetime. See [Elune integration](./elune) for usage accounting and durability limits.

## Settings integration

The selected backend advertises `piSettings` for Runtime, Certificates, Models & providers, and MCP servers. Pi's global files remain authoritative for provider/model/MCP configuration. `getAgentDir()` selects their directory. Leyline stores runtime, title, and certificate settings in SQLite, along with subagent and vision overrides.

Provider Settings uses leased, cwd-bound runtimes with an in-memory session and a resource loader. It loads provider extensions through SDK resources rather than copying their registrations from a conversation. Each extension set has a session owner and shutdown path, including failed and cold reloads.

Custom compatible providers can omit an API key. Their saved models remain selectable, and the endpoint reports authentication failures. Leyline registers native adapters only where built-in, extension, and OAuth registrations do not already own the provider. Native credentials, extensions, and OAuth remain authoritative. Removing a `models.json` key reference does not remove a stored credential.

Each custom adapter implements native `refreshModels()` and publishes configured metadata through `context.publish()`. Direct SDK refresh calls therefore synchronize the adapter catalog too. The public `ModelRuntime` wrapper resolves native authentication before streaming. SDK-required placeholders never reach HTTP requests or persistent storage. Keyless Google requests use an empty `x-goog-api-key` header.

Settings runtime wrappers bound credential metadata reads, authentication checks, asynchronous model-availability requests, and catalog refreshes to 15 seconds. Inventory requests also have a 15-second signal.

Native `ModelRuntime.login()` and `logout()` handle provider credentials. Private operations adapt SDK prompts and notifications for polling, answers, and cancellation. `CredentialSynchronizationError` can mean credentials were saved even though catalog synchronization failed. The operation reports a warning in that case.

Native authentication can update shared credentials before an operation finishes. Leyline serializes provider changes against runtime construction and blocks login while another runtime retains different provider routes. It never refreshes a live conversation's `ModelRuntime` after endpoint or authentication edits. Explicit reload applies changes to that session.

Catalog lookup uses the settings runtime's `getAllModels()`, not the authenticated `getAvailable()` list. It returns at most 20 matching chat models from the backend cache. Explicit lookup refresh replaces the settings runtime and calls `ModelRuntime.refresh({ allowNetwork: true, force: true })`. A resolved refresh can still fail: check returned `errors`, `aborted`, and runtime errors, as well as exceptions. If the SDK refresh fails, lookup reports a warning and uses cached results. Runtime acquisition failures remain request errors.

Provider inventory refresh and catalog refresh operate on settings runtimes. Home refresh uses a separate `/state?cwd=...&refresh=1` preview. Pi retains cached Radius gateway URLs, so Leyline blocks changes to existing Radius base URLs. See [Pi Settings](../developer-guide/backend-api#pi-settings) for lease limits, cleanup, routing checks, and refresh boundaries.

`provider-connection-test.js` probes saved models or unsaved form values through private settings operations. Drafts require the current configuration revision and use temporary runtimes. Tests do not write configuration, change live runtimes, or add transcript entries. Draft API-key replacements stay runtime-only. OAuth tests can refresh shared tokens, so route guards precede authentication and virtual-model routing. Draft endpoint or API changes cannot reuse stored OAuth credentials.

Draft `thinkingLevelMap` replacement and `compat.supportsDeveloperRole` reset must preserve SDK inheritance. `getModel()` contains effective metadata, including saved overrides. Reset recovery uses custom definitions, raw native models, or static legacy extension definitions rather than treating the effective model as defaults.

Built-in reset recovery uses a separate offline `ModelRuntime` and the public `InMemoryModelsStore` from `@earendil-works/pi-ai`. Leyline reads the provider's `models-store.json` entry into that store and explicitly refreshes with `allowNetwork: false`. The SDK applies its catalog timestamp rules. With `modelsPath: null`, a `modelsStorePath` alone does not restore this cache. Recovery writes neither drafts nor credentials nor the live cache.

Override edits that remove no saved entries can use the effective model. Pi does not expose inherited metadata from dynamic legacy extension hooks. Resets that need those defaults refuse the draft test and direct the user to Save, then test the saved model. See [Provider connection tests](../developer-guide/backend-api#provider-connection-tests) for recovery ownership.

Probes request 16 output tokens, set `maxRetries: 0`, and use a 30-second deadline after settings runtime acquisition. Tests refuse Codex, direct OpenAI Responses subscription authentication, `openai-responses` with `supportsMaxOutputTokens: false`, and Bedrock. These paths cannot enforce the output limit or disable retries. See [Provider connection tests](../developer-guide/backend-api#provider-connection-tests) for ownership and result handling.

MCP inventory reads only global `mcp.json`. Checks and OAuth use a disposable worker with native `createMcpExtension()` and owned native transports. The worker binds its private UI context and runs the native `/mcp` command. It does not use a conversation runtime or publish authentication prompts through the runtime WebSocket. Each worker applies the parent's active CA snapshot before connecting. See [Backend TLS trust](../developer-guide/backend-api#backend-tls-trust) for trust-store ownership.

The transport adapter resolves the public `@earendil-works/pi-mcp` package from the coding-agent package context. This preserves native error-class identity for OAuth handling. Cancellation reaches connections still initializing, and bounded cleanup owns transport shutdown and child processes. Logout needs no live connection or secret resolution. HTTP aliases share an operation lock by normalized URL, matching native credential identity.

Leyline exposes only the [documented Settings API fields](../reference/api#pi-settings-routes), not every field in the upstream configuration schema. Codemode stays excluded, including in MCP management workers.

## Browser extension UI

The browser supports extension `ctx.ui.confirm()` requests through session-bound confirmation cards. See [Browser confirmations](../developer-guide/backend-api#browser-confirmations) for reply and cancellation rules.

Pi persists initial prompt and tool declarations and later deltas as system-role messages. Leyline projects these into System dividers with a prompt inspector in the browser and HTML export. See [System messages](../developer-guide/transcript-projection#system-messages).

Research sessions add a `leyline-research` marker before extension binding. Their state remains in custom JSONL entries and follows the active branch. See [Deep research integration](./deep-research), the [integration overview](./index), and the [API reference](../reference/api).
