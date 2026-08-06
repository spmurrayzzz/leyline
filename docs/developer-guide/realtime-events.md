# Realtime events

Leyline uses server-sent events (SSE) for pi runtime and extension updates. It uses a separate WebSocket for terminal traffic.

## Server stream

`GET /api/pi/events` opens the SSE stream. `server/pi-api/events.js` owns the connected response set.

A new connection receives one `active_session` event for each existing runtime handle. The server does not provide replay IDs or persisted event history.

The server sends these event types:

| SSE type | Payload |
| --- | --- |
| `active_session` | A runtime session DTO for one handle |
| `runtime_event` | `{ activeSessionId, event }` from the pi session subscription |
| `extension_ui` | `{ activeSessionId, state, goal }` after an extension UI change |
| `extension_error` | `{ activeSessionId, error }` after an extension binding error |

`extension-ui.js` binds each runtime handle to its pi session subscription. It broadcasts every pi event as `runtime_event`.

Queue changes and goal-state messages also trigger a new `active_session` snapshot. Extension UI changes trigger both `extension_ui` and `active_session`.

## Frontend adapter

`useRuntimeEvents.js` creates one `EventSource('/api/pi/events')`. It handles `active_session`, `runtime_event`, and `extension_ui`.

Connection open and error callbacks update the visible stream status. EventSource performs its standard reconnect behavior after a disconnection.

The adapter keeps the latest 100 local log items. The Runtime Events drawer displays the newest 20.

The current frontend does not register an `extension_error` listener. Those server events do not appear in the Runtime Events drawer.

## Runtime state updates

`App.vue` sends each `active_session` snapshot to `useSessionWorkspace.js`. The composable updates background status for that session ID.

If the snapshot belongs to the selected session, `App.vue` also replaces `activeRuntimeSession`.

`runtime_event` payloads update background running, compacting, queue, unread, and error state. The same payload enters `useLiveTurnProjection.js`.

## Live transcript projection

`useLiveTurnProjection.js` handles these event families:

- agent and turn start or end
- message start, update, and end
- tool call, execution start, and execution end
- compaction start and end
- queue updates
- errors and aborts

`message_update` drives live assistant blocks through one animation-frame batch. It does not fetch persisted detail.

Other runtime events schedule a session-detail refresh. Normal refreshes use a 250 ms debounce, and compaction completion refreshes immediately.

Live user, assistant, and tool rows reconcile with projected persisted entries after refresh. This prevents duplicate rows during the handoff.

## Goal and extension UI state

The backend derives the latest goal from `goal-state` custom entries. It includes goal state in runtime snapshots and extension UI events.

`App.vue` applies extension UI state only when `activeSessionId` matches the selected session. Warning and error notifications become composer errors.

The goal controls use projected state. The browser does not parse goal text from transcript messages.

## Concurrent sessions

Each runtime event includes `activeSessionId`. Keep this field when adding event handling.

Live transcript updates apply only to the selected session. Background events update sidebar status and unread state.

All connected browser tabs and packaged Electron windows receive all broadcasts. SSE clients are process-wide, as are runtime handles.

## Terminal events

The terminal endpoint is `/api/pi/terminal`. It sends JSON WebSocket messages with `ready`, `data`, `error`, or `exit` types.

The browser sends `input` and `resize` messages. Closing the socket kills its PTY process.

Do not send terminal bytes through SSE. Terminal ordering and backpressure are independent from runtime events.

## Adding an event consumer

1. Preserve `activeSessionId` at the server boundary.
2. Add the named SSE listener in `useRuntimeEvents.js`.
3. Route cross-feature state through `App.vue`.
4. Keep selected-session filtering in the feature owner.
5. Decide whether the event needs live projection, persisted refresh, or both.
6. Keep the Runtime Events drawer log bounded.
