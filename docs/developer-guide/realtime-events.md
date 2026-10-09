# Realtime events

Leyline uses server-sent events (SSE) for pi runtime and extension updates. It uses a separate WebSocket for terminal traffic.

## Server stream

`GET /api/pi/events` opens the SSE stream. `server/pi-api/events.js` owns the connected response set.

The browser supplies the selected `sessionId` in the query string. That runtime receives full snapshots; other runtimes receive compact snapshots.

A new connection receives one `active_session` event per runtime, followed by `runtime_roster`. The server does not provide replay IDs or persisted event history.

The server sends these event types:

| SSE type | Payload |
| --- | --- |
| `active_session` | A runtime session DTO for one handle |
| `runtime_roster` | `{ sessionIds }` for the backend's open runtimes |
| `runtime_removed` | `{ id }` when a runtime is removed |
| `runtime_event` | `{ activeSessionId, event, handoffId? }` from the pi session subscription |
| `extension_ui` | `{ activeSessionId, state, goal }` after an extension UI change |
| `extension_error` | `{ activeSessionId, error }` after an extension binding error |

`extension-ui.js` binds each runtime handle to its pi session subscription. It broadcasts every pi event as `runtime_event`.

Queue changes and goal-state messages also trigger a new `active_session` snapshot. Extension UI changes trigger both `extension_ui` and `active_session`.

Editable queue mutations broadcast snapshots through the runtime handle. Native `queue_update` snapshots run in a microtask because pi emits the event before inserting the input into its low-level queue. DTOs ignore stale native display arrays when pi has no queued inputs.

Snapshots include `snapshotRevision` for ordering. Full `promptQueue` state contains the mutation revision and pending items. Compact snapshots contain its count, held state, and error.

Research updates change the extension status after they append state. The resulting snapshot includes the latest branch research state.

## Frontend adapter

`useRuntimeEvents.js` creates one `EventSource` for `/api/pi/events` on the
active backend. It handles `active_session`, `runtime_roster`, `runtime_removed`,
`runtime_event`, `extension_ui`, and `extension_error`. Session changes close the old stream before opening its replacement.

Connection open and error callbacks update the visible stream status. EventSource performs its standard reconnect behavior after a disconnection.

The adapter keeps the latest 100 local log items. The Runtime Events drawer displays the newest 20.

The adapter logs extension errors. Composer error handling filters expected cancellations without removing their raw event records.

## Runtime state updates

`App.vue` sends each `active_session` snapshot to `useSessionWorkspace.js`. The composable updates background status for that session ID.

If the snapshot belongs to the selected session, `App.vue` also updates `activeRuntimeSession`. Revision guards reject older snapshots from either HTTP or SSE.

`runtime_event` payloads update background running, compacting, unread, and error state. Queue state and branch research progress come from `active_session` snapshots. Runtime events also enter `useLiveTurnProjection.js`.

## Live transcript projection

`useLiveTurnProjection.js` handles these event families:

- agent and turn start or end
- message start, update, and end, including system-role start and end
- tool call, execution start, and execution end
- compaction start and end
- errors and aborts

`message_update` drives live assistant blocks through one animation-frame batch. It does not fetch persisted detail.

Settlement, reconnect, and manual compaction schedule immediate session-detail refreshes. Idle session-info and custom-message changes use a 250 ms debounce. Streaming message and tool events do not fetch detail individually.

Live user, assistant, System, and tool rows reconcile with projected persisted entries after refresh. The reactive anchor waits for System persistence before release. The next turn clears matched rows from the previous turn, so branch order remains intact.

See [Live reconciliation and settlement](./transcript-projection#live-reconciliation-and-settlement) for matching and expansion keys.

## Goal, research, and extension UI state

The backend derives the latest goal from `goal-state` custom entries. It folds research state from matching `leyline-research` entries on the active branch.

Runtime snapshots include both states. `App.vue` applies extension UI state only when `activeSessionId` matches the selected session.

The goal controls and research surfaces use projected state. The browser does not parse this state from transcript text.

## Ultrafast and confirmation state

Ultrafast publishes its runtime-local mode through extension statuses. The browser receives changes through the existing extension UI and runtime snapshots.

Pending browser confirmations also travel in `extensionUi.confirmations`. Compact snapshots include `pendingConfirmationCount` for background supervision. Replies use the session-scoped HTTP route, not SSE. See [Browser confirmations](./backend-api#browser-confirmations).

## Concurrent sessions

Each runtime event includes `activeSessionId`. Keep this field when adding event handling.

Live transcript updates apply only to the selected session. Background events update sidebar status and unread state.

All windows connected to one backend receive its broadcasts. SSE clients and
runtime handles are process-wide within that backend. Windows on another
backend receive a different stream.

## Terminal events

The terminal endpoint is `/api/pi/terminal` on the active backend. The renderer supplies the selected session ID in the query string.

The endpoint sends JSON WebSocket messages with `ready`, `data`, `error`, or `exit` types. The browser waits for `ready` before it sends `input` and `resize` messages. Closing the socket kills its PTY process.

Do not send terminal bytes through SSE. Terminal ordering and backpressure are independent from runtime events.

## Adding an event consumer

1. Preserve `activeSessionId` at the server boundary.
2. Add the named SSE listener in `useRuntimeEvents.js`.
3. Route cross-feature state through `App.vue`.
4. Keep selected-session filtering in the feature owner.
5. Decide whether the event needs live projection, persisted refresh, or both.
6. Keep the Runtime Events drawer log bounded.
