# pi SDK integration

Leyline uses `SessionManager.listAll()` for normal session discovery. If `PI_CODING_AGENT_SESSION_DIR` is set, Leyline scans that directory instead. It uses `SessionManager.open(path)` and `getBranch()` for transcript detail.

`AgentSessionRuntime` owns execution. Leyline keeps one runtime handle for each open session and tracks one selected active handle. Scoped API actions can run in background sessions without changing the selected session.

`AgentSession.prompt()` handles commands, skills, templates, queueing, authentication, compaction, and persistence. `session.executeBash()` runs shell commands. Leyline forces steering and follow-up delivery to `one-at-a-time` mode.

Forking uses `runtime.fork(entryId, { position: 'at' })`. Prompt edits use `session.navigateTree(entryId)` before Leyline submits replacement content. Rename appends pi session information. Delete moves the JSONL file to Leyline trash.

Pi session logs are tree-structured JSONL records. Normal writes use runtime and session-manager primitives. Reset to here is an explicit exception. It rewrites the file so that the selected active branch ends at the target entry.

Each runtime loads the bundled goal, memory, and subagent extensions. It also appends the bundled Leyline system prompt. See the [integration overview](./index) and [API reference](../reference/api).
