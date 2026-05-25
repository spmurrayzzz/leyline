# Backend API

`piApi()` integrates the backend as a Vite plugin. `piApiHandler()` handles routes for session listing, detail loading, creation, deletion, prompt submission, shell commands, compaction, interrupt, reload, model, thinking, fork, edit, export, state, filesystem browsing, and SSE.

Runtime handles are managed by lifecycle code in `server/pi-api.js`. Errors are returned as JSON with meaningful status codes where possible.

See the [API reference](../reference/api) for endpoint-by-endpoint details.
