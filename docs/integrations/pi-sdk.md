# pi SDK integration

Leyline discovers sessions by scanning pi JSONL files with bounded concurrent readers. It caches unchanged summaries by file modification time and size.

`PI_CODING_AGENT_SESSION_DIR` selects a different session root. Leyline uses `SessionManager.open(path)` and `getBranch()` for transcript detail.

`AgentSessionRuntime` owns execution. Leyline keeps one runtime handle for each open session and tracks one selected active handle. Scoped API actions can run in background sessions without changing the selected session.

`AgentSession.prompt()` handles commands, skills, templates, native input delivery, authentication, compaction, and persistence. `session.executeBash()` runs shell commands. Native steering and follow-up delivery remain `one-at-a-time`.

Leyline holds editable **Up next** tasks on each runtime handle before pi submission. It dispatches one task through the normal prompt path when `session.isIdle`. A pi `preflightResult` disposition marks acceptance; **Steer** uses native delivery and cannot be edited afterward.

Stop holds remaining unsent tasks without clearing pi's native queues. An empty queue returns to normal Send. Runtime reload retains pending tasks held; backend restart discards them. See [Pending prompts](../developer-guide/backend-api#pending-prompts) for queue ownership and acceptance rules.

For a parent model without image support, Leyline validates the vision model and saves pasted images before it calls `AgentSession.prompt()`. A session `agent.transformContext` wrapper keeps the original images in JSONL history. It replaces them in parent-model context with saved file paths and `vision_agent` instructions. The parent calls the tool during its turn.

Forking opens a separate `SessionManager`, calls `createBranchedSession(entryId)`, and starts a new runtime. The source runtime and its queues remain intact. Prompt edits use `session.navigateTree(entryId)` before Leyline submits replacement content. Rename appends pi session information. Delete moves the JSONL file to Leyline trash.

Pi session logs are tree-structured JSONL records. Normal writes use runtime and session-manager primitives. Reset to here is an explicit exception. It rewrites the file so that the selected active branch ends at the target entry.

Each runtime loads the bundled goal, memory, subagent, research, and vision-agent extensions. It also appends the bundled Leyline system prompt.

Research sessions add a `leyline-research` marker before extension binding. Their state remains in custom JSONL entries and follows the active branch. See [Deep research integration](./deep-research), the [integration overview](./index), and the [API reference](../reference/api).
