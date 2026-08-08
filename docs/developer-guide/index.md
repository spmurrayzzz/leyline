# Developer guide

This section is for contributors who work on Leyline's Vue app, modular backend, Electron shell, pi runtimes, and bundled extensions.

Start with [local development](./local-development). Then read [architecture](./architecture), [frontend state](./frontend-state), and [backend API](./backend-api).

The current implementation includes concurrent runtimes, named backend
connections, SSE updates, transcript projection, scoped memory, rollout
feedback, subagents, goals, HTML export, and a PTY WebSocket. Packaged Electron
windows share one native backend process and select their active backend
independently.

Use these references for implementation details:

- [Integrations](../integrations/) describes the pi SDK, goals, memory, subagents, and terminal.
- [Realtime events](./realtime-events) describes live runtime delivery.
- [API reference](../reference/api) gives each HTTP and WebSocket contract.
- [Project layout](./project-layout) maps the repository modules.
