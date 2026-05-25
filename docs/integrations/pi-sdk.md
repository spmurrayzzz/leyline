# pi SDK integration

Leyline uses `SessionManager.listAll()` for sidebar sessions and `SessionManager.open(path)` plus `getBranch()` for selected transcript detail.

`AgentSessionRuntime` owns runtime execution. `AgentSession.prompt()` handles commands, skills, templates, queueing, auth, compaction, and persistence. `session.executeBash()` runs shell commands. Forking uses `runtime.fork(entryId, { position: 'at' })`, and edits call `session.navigateTree(entryId)` before submitting the replacement prompt.

`buildSessionContext()` is available for LLM context construction. Sessions are JSONL tree-structured append-only logs. No file lock protects session appends, so writes should go through runtime primitives.
