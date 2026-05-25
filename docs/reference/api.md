# API reference

Routes return JSON unless otherwise noted. Important errors include missing sessions, invalid request bodies, unavailable runtime state, provider or pi SDK failures, and unsafe operations while streaming or compacting.

## `GET /api/pi/sessions`

List sessions.

- Request body: None.
- Response: Array of session summaries plus active runtime merge where applicable.

## `POST /api/pi/sessions`

Create a session in a cwd.

- Request body: `{ cwd, prompt?, images?, model?, thinking? }`.
- Response: Created session summary and runtime state.

## `GET /api/pi/sessions/:id`

Load transcript detail.

- Request body: None.
- Response: Session detail with current branch entries.

## `DELETE /api/pi/sessions/:id`

Trash a session.

- Request body: None.
- Response: Success response.

## `POST /api/pi/active-session`

Activate runtime for a session.

- Request body: `{ id }`.
- Response: Runtime/session state.

## `GET /api/pi/state?cwd=...`

Read runtime state for a cwd.

- Request body: Query string cwd.
- Response: Runtime state without switching active session.

## `GET /api/pi/fs?path=...`

List folder browser entries.

- Request body: Query string path.
- Response: Directory children.

## `GET /api/pi/events`

Open SSE runtime events.

- Request body: None.
- Response: Event stream.

## `POST /api/pi/prompt`

Legacy active-session prompt.

- Request body: `{ prompt, images? }`.
- Response: Accepted/submitted response.

## `POST /api/pi/sessions/:id/prompt`

Scoped prompt.

- Request body: `{ prompt, images? }`.
- Response: Accepted/submitted response.

## `POST /api/pi/bash`

Legacy active-session shell command.

- Request body: `{ command }`.
- Response: Execution accepted response.

## `POST /api/pi/sessions/:id/bash`

Scoped shell command.

- Request body: `{ command }`.
- Response: Execution accepted response.

## `POST /api/pi/compact`

Legacy active-session compaction.

- Request body: `{ instructions? }`.
- Response: Compaction accepted response.

## `POST /api/pi/sessions/:id/compact`

Scoped compaction.

- Request body: `{ instructions? }`.
- Response: Compaction accepted response.

## `POST /api/pi/interrupt`

Legacy active-session stop.

- Request body: None.
- Response: Success response.

## `POST /api/pi/sessions/:id/interrupt`

Scoped stop.

- Request body: None.
- Response: Success response.

## `POST /api/pi/reload`

Legacy active-session reload.

- Request body: None.
- Response: Reload state.

## `POST /api/pi/sessions/:id/reload`

Scoped reload.

- Request body: None.
- Response: Reload state.

## `POST /api/pi/model`

Legacy active-session model switch.

- Request body: `{ model }`.
- Response: Selected model state.

## `POST /api/pi/sessions/:id/model`

Scoped model switch.

- Request body: `{ model }`.
- Response: Selected model state.

## `POST /api/pi/thinking`

Legacy active-session thinking switch.

- Request body: `{ thinking }`.
- Response: Selected thinking state.

## `POST /api/pi/sessions/:id/thinking`

Scoped thinking switch.

- Request body: `{ thinking }`.
- Response: Selected thinking state.

## `POST /api/pi/edit-prompt`

Edit active prompt.

- Request body: `{ entryId, prompt, images? }`.
- Response: Accepted/submitted response.

## `POST /api/pi/fork`

Fork active session at an entry.

- Request body: `{ entryId }`.
- Response: Forked session summary.

## `GET /api/pi/sessions/:id/export`

Export self-contained transcript HTML.

- Request body: None.
- Response: HTML document.

## `POST /api/pi/mode`

No-op that reapplies one-at-a-time mode.

- Request body: Optional mode body.
- Response: Success response.

## `WS /api/pi/terminal`

PTY terminal.

- Request body: WebSocket messages.
- Response: Terminal stream.
