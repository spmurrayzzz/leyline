# pi SDK integration

Leyline discovers sessions by scanning pi JSONL files with bounded concurrent readers. It caches unchanged summaries by file modification time and size.

`PI_CODING_AGENT_SESSION_DIR` selects a different session root. Leyline uses `SessionManager.open(path)` and `getBranch()` for transcript detail.

`AgentSessionRuntime` owns execution. Leyline keeps one runtime handle for each open session and tracks one selected active handle. Scoped API actions can run in background sessions without changing the selected session.

`ModelRuntime` is the current SDK boundary for model access and authentication. Leyline uses `services.modelRuntime` and `session.modelRuntime` for lookup, available snapshots, and subscription state.

`AgentSession.prompt()` handles commands, skills, templates, native input delivery, authentication, compaction, and persistence. `session.executeBash()` runs shell commands. Native steering and follow-up delivery remain `one-at-a-time`.

Leyline holds editable **Up next** tasks on each runtime handle before pi submission. It dispatches one task through the normal prompt path when `session.isIdle`. A pi `preflightResult` disposition marks acceptance; **Steer** uses native delivery and cannot be edited afterward.

Stop holds remaining unsent tasks without clearing pi's native queues. An empty queue returns to normal Send. Runtime reload retains pending tasks held; backend restart discards them. See [Pending prompts](../developer-guide/backend-api#pending-prompts) for queue ownership and acceptance rules.

For a parent model without image support, Leyline validates the vision model and saves pasted images before it calls `AgentSession.prompt()`. A session `agent.transformContext` wrapper keeps the original images in JSONL history. It replaces them in parent-model context with saved file paths and `vision_agent` instructions. The parent calls the tool during its turn.

Forking opens a separate `SessionManager`, calls `createBranchedSession(entryId)`, and starts a new runtime. The source runtime and its queues remain intact. Prompt edits use `session.navigateTree(entryId)` before Leyline submits replacement content. Rename appends pi session information. Delete moves the JSONL file to Leyline trash.

Pi session logs are tree-structured JSONL records. Normal writes use runtime and session-manager primitives. Reset to here is an explicit exception. It rewrites the file so that the selected active branch ends at the target entry.

Normal runtimes load output-budget, ultrafast, goal, memory, subagent, research, and vision-agent. They also append the Leyline system prompt. Isolated custom-prompt children retain only output-budget.

Bundled extensions replace matching conflicts, and Ultrafast runs last. See [Runtime construction](../developer-guide/backend-api#runtime-construction) and [Ultrafast](../developer-guide/backend-api#ultrafast) for the implementation contracts.

Normal runtimes add native MCP and tool search through SDK factories. Leyline enables `tool_search` unless settings explicitly disable it. Codemode is not loaded and remains excluded.

The browser supports extension `ctx.ui.confirm()` requests through session-bound confirmation cards. See [Browser confirmations](../developer-guide/backend-api#browser-confirmations) for reply and cancellation rules.

Pi persists initial prompt and tool declarations and later deltas as system-role messages. Leyline projects these into collapsed System cards in the browser and HTML export. See [System messages](../developer-guide/transcript-projection#system-messages).

Research sessions add a `leyline-research` marker before extension binding. Their state remains in custom JSONL entries and follows the active branch. See [Deep research integration](./deep-research), the [integration overview](./index), and the [API reference](../reference/api).
