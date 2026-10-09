# Integrations

Leyline connects the Vue interface to pi runtimes, bundled extensions, local SQLite data, and a PTY terminal.

- [pi SDK integration](./pi-sdk) covers session discovery, runtime actions, and JSONL history.
- [Goal extension](./goal-extension) covers long-running goals and browser goal state.
- [Memory integration](./memory-integration) covers durable context, the Memory Inspector, and rollout feedback.
- [Subagent integration](./subagents) covers agent definitions, model overrides, and child sessions.
- [Deep research integration](./deep-research) covers research-session binding, parallel workers, persisted source state, and citation checks.
- [Vision agent integration](./vision-agent) covers image delegation, scoped model selection, and context replacement.
- [Terminal backend](./terminal-backend) covers the PTY WebSocket.
- [API reference](../reference/api) lists all HTTP and WebSocket contracts.

## Bundled runtime resources

Normal runtimes load the bundled output-budget, ultrafast, goal, memory, subagent, research, and vision-agent extensions. Isolated custom-prompt children retain only output-budget.

Leyline also uses pi's native MCP and tool search. It does not load Codemode. See [Runtime construction](../developer-guide/backend-api#runtime-construction) for conflict filtering and [Ultrafast](../developer-guide/backend-api#ultrafast) for tier behavior.

Normal runtimes also append `.pi/LEYLINE_SYSTEM.md` to the system prompt. This prompt describes Leyline's operating context. It does not replace pi or project instructions.

## Local metadata

Backend connections, app settings, memory, rollout feedback, and model overrides use SQLite under `~/.local/share/leyline/`. Pi session history remains in JSONL files.

See [SQLite metadata](../developer-guide/architecture#sqlite-metadata) for the table inventory and [Environment variables](../reference/environment) for storage overrides.

## Browser and Electron servers

Browser development and packaged Electron use the same backend modules. Each window can select a saved backend. See [Architecture](../developer-guide/architecture) for startup paths and transport routing.
