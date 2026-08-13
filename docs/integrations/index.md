# Integrations

Leyline connects the Vue interface to pi runtimes, bundled extensions, local SQLite data, and a PTY terminal.

- [pi SDK integration](./pi-sdk) covers session discovery, runtime actions, and JSONL history.
- [Goal extension](./goal-extension) covers long-running goals and browser goal state.
- [Memory integration](./memory-integration) covers durable context, the Memory Inspector, and rollout feedback.
- [Subagent integration](./subagents) covers agent definitions, model overrides, and child sessions.
- [Vision agent integration](./vision-agent) covers image delegation, scoped model selection, and context replacement.
- [Terminal backend](./terminal-backend) covers the PTY WebSocket.
- [API reference](../reference/api) lists all HTTP and WebSocket contracts.

## Bundled runtime resources

Each Leyline runtime adds the goal, memory, subagent, and vision-agent extensions through pi resource loading. Leyline prefers its bundled goal and memory commands when a global extension registers the same command.

The runtime also appends `.pi/LEYLINE_SYSTEM.md` to the system prompt. This prompt describes Leyline's operating context. It does not replace pi or project instructions.

## Local metadata

Backend connections, the configured default, memory records, rollout feedback,
subagent model overrides, and vision model overrides use SQLite under
`~/.local/share/leyline/`. Pi session history remains in pi JSONL session
files.

## Browser and Electron servers

Vite mounts the native backend as development middleware. A packaged Electron
process starts one native HTTP server for all Leyline windows. Both paths use
the same router, runtime registry, SSE stream, and terminal WebSocket
implementation. Each window can select a saved backend instead.
