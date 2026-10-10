# pi SDK integration

Leyline discovers sessions by scanning pi JSONL files with bounded concurrent readers. It caches unchanged summaries by file modification time and size.

`PI_CODING_AGENT_SESSION_DIR` selects a different session root. Leyline uses `SessionManager.open(path)` and `getBranch()` for transcript detail.

`AgentSessionRuntime` owns execution. Leyline keeps one runtime handle for each open session and tracks one selected active handle. Scoped API actions can run in background sessions without changing the selected session.

`ModelRuntime` is the current SDK boundary for model access and authentication. Leyline uses `services.modelRuntime` and `session.modelRuntime` for lookup, available snapshots, and subscription state.

The integration currently uses pi SDK 0.99.1. Public upstream references include [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [Configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/configuration.md), [Provider Authentication](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md), and [MCP Servers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md). These upstream pages can describe versions newer than Leyline's pinned dependency.

`AgentSession.prompt()` handles commands, skills, templates, native input delivery, authentication, compaction, and persistence. `session.executeBash()` runs shell commands. Native steering and follow-up delivery remain `one-at-a-time`.

Leyline holds editable **Up next** tasks on each runtime handle before pi submission. It dispatches one task through the normal prompt path when `session.isIdle`. A pi `preflightResult` disposition marks acceptance; **Steer** uses native delivery and cannot be edited afterward.

Stop holds remaining unsent tasks without clearing pi's native queues. An empty queue returns to normal Send. Runtime reload retains pending tasks held; backend restart discards them. See [Pending prompts](../developer-guide/backend-api#pending-prompts) for queue ownership and acceptance rules.

For a parent model without image support, Leyline validates the vision model and saves pasted images before it calls `AgentSession.prompt()`. A session `agent.transformContext` wrapper keeps the original images in JSONL history. It replaces them in parent-model context with saved file paths and `vision_agent` instructions. The parent calls the tool during its turn.

Forking opens a separate `SessionManager`, calls `createBranchedSession(entryId)`, and starts a new runtime. The source runtime and its queues remain intact. Prompt edits use `session.navigateTree(entryId)` before Leyline submits replacement content. Rename appends pi session information. Delete moves the JSONL file to Leyline trash.

Pi session logs are tree-structured JSONL records. Normal writes use runtime and session-manager primitives. Reset to here is an explicit exception. It rewrites the file so that the selected active branch ends at the target entry.

Normal runtimes load output-budget, ultrafast, goal, memory, subagent, research, and vision-agent. They also append the Leyline system prompt. Isolated custom-prompt children retain only output-budget.

Bundled extensions replace matching conflicts, and Ultrafast runs last. See [Runtime construction](../developer-guide/backend-api#runtime-construction) and [Ultrafast](../developer-guide/backend-api#ultrafast) for the implementation contracts.

Normal runtimes add native MCP and tool search through SDK factories. Leyline enables `tool_search` unless settings explicitly disable it. Codemode is not loaded and remains excluded.

## Settings integration

The selected backend advertises `piSettings` for Models & providers and MCP servers. Pi's global files remain authoritative. `getAgentDir()` selects their directory. Leyline's global/project/session subagent and vision overrides remain separate SQLite records.

Provider Settings uses leased, cwd-bound runtimes with an in-memory session and a resource loader. It loads provider extensions through SDK resources rather than copying their registrations from a conversation. Each extension set has a session owner and shutdown path, including failed and cold reloads.

Native `ModelRuntime.login()` and `logout()` handle provider credentials. Private operations adapt SDK prompts and notifications for polling, answers, and cancellation. `CredentialSynchronizationError` can mean credentials were saved even though catalog synchronization failed. The operation reports a warning in that case.

Native authentication can update shared credentials before an operation finishes. Leyline serializes provider changes against runtime construction and blocks login while another runtime retains different provider routes. It never refreshes a live conversation's `ModelRuntime` after endpoint or authentication edits. Explicit reload applies changes to that session.

Provider inventory refresh and catalog refresh operate on settings runtimes. Home refresh uses a separate `/state?cwd=...&refresh=1` preview. Pi 0.99.1 retains cached Radius gateway URLs, so Leyline blocks changes to existing Radius base URLs. See [Pi Settings](../developer-guide/backend-api#pi-settings) for lease limits, cleanup, routing checks, and refresh boundaries.

MCP inventory reads only global `mcp.json`. Checks and OAuth use a disposable worker with native `createMcpExtension()` and owned native transports. The worker binds its private UI context and runs the native `/mcp` command. It does not use a conversation runtime or publish authentication prompts through session SSE.

The transport adapter resolves the public `@earendil-works/pi-mcp` package from the coding-agent package context. This preserves native error-class identity for OAuth handling. Cancellation reaches connections still initializing, and bounded cleanup owns transport shutdown and child processes. Logout needs no live connection or secret resolution. HTTP aliases share an operation lock by normalized URL, matching native credential identity.

Leyline exposes only the [documented Settings API fields](../reference/api#pi-settings-routes), not every field in the upstream configuration schema. Codemode stays excluded, including in MCP management workers.

## Browser extension UI

The browser supports extension `ctx.ui.confirm()` requests through session-bound confirmation cards. See [Browser confirmations](../developer-guide/backend-api#browser-confirmations) for reply and cancellation rules.

Pi persists initial prompt and tool declarations and later deltas as system-role messages. Leyline projects these into System dividers with a prompt inspector in the browser and HTML export. See [System messages](../developer-guide/transcript-projection#system-messages).

Research sessions add a `leyline-research` marker before extension binding. Their state remains in custom JSONL entries and follows the active branch. See [Deep research integration](./deep-research), the [integration overview](./index), and the [API reference](../reference/api).
