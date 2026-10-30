# Realtime events

Leyline uses WebSockets for runtime, extension, and Git review updates. The terminal uses a separate WebSocket. Commands and file transfers remain HTTP.

Event WebSockets avoid the browser's per-origin six-connection limit for HTTP/1.1 requests across tabs. Frontend and backend must both use API v2. There is no SSE fallback.

## Server stream

`WS /api/pi/events` opens the runtime stream. `server/pi-api/event-sockets.js` handles upgrades, origin checks, heartbeats, and shutdown. `server/pi-api/events.js` owns runtime subscriptions and event delivery.

Each event is one JSON text message with `type` and `data` fields:

```json
{"type":"runtime_roster","data":{"sessionIds":[]}}
```

A connection can request full snapshots and live updates for one session with the `sessionId` query parameter. Other runtimes receive compact payloads. This parameter scopes the connection; it does not activate a session.

A new connection receives one `active_session` event per runtime, followed by `runtime_roster`. The server does not provide replay IDs or persisted event history.

The server sends these event types:

| `type` | `data` |
| --- | --- |
| `active_session` | A runtime session DTO for one handle |
| `runtime_roster` | `{ sessionIds }` for the backend's open runtimes |
| `runtime_removed` | `{ id }` when a runtime is removed, including idle disposal without session deletion |
| `runtime_event` | `{ activeSessionId, event, handoffId? }` from pi or the queued shell executor |
| `extension_ui` | `{ activeSessionId, state }` after an extension UI change |
| `extension_error` | `{ activeSessionId, error }` after an extension binding error |
| `trace_updated` | `{ traceId, sessionId, revision, activeSessionId }` after a trace storage commit |
| `trace_config` | `{ enabled, error? }` after capture configuration changes or capture failures |

`extension-ui.js` binds each runtime handle to its pi session subscription. It broadcasts every pi event as `runtime_event`. `runtime.js` also publishes queued shell start/end events through that envelope.

Queue changes also trigger a new `active_session` snapshot. Extension UI changes trigger both `extension_ui` and `active_session`.

Editable queue mutations broadcast snapshots through the runtime handle. Native `queue_update` snapshots run in a microtask because pi emits the event before inserting the input into its low-level queue. DTOs ignore stale native display arrays when pi has no queued inputs.

Snapshots include `snapshotRevision` for ordering and `session` for the live name and summary. Full `promptQueue` state contains the mutation revision and pending items, including each item's `shell` flag. Compact snapshots contain its count, held state, and error. Both snapshot forms retain `titleGenerating` and `isBashRunning`. Only full snapshots include `bashExecution`.

Research updates change the extension status after they append state. The resulting snapshot includes the latest branch research state.

## Queued shell events

Both bash routes return queue acceptance before completion. Prompts and multiple shell commands share **Up next**. Shell dispatch runs native `user_bash` hooks, then `executeBash()` or `recordBashResult()` for a hook-supplied result. It does not start an assistant reply.

Shell progress uses `runtime_event.event`:

- `bash_execution_start` carries the execution record, including `id`, `command`, `excludeFromContext`, `anchorId`, `startedAt`, `status`, `output`, `entryId`, and `revision`.
- `bash_execution_update` carries `id`, `delta`, the current `output` tail, and `revision`. A supplied hook result can complete without these updates.
- `bash_execution_end` carries the final execution record, result fields, and optional `error`.

`isBashRunning` includes hook preparation and native execution. The latest `bashExecution` snapshot restores shell progress after reconnect, without event replay. Streaming output retains the last 65,536 characters. Completion supplies the native result and its truncation metadata.

The execution UUID identifies the live row. `entryId` identifies the exact new native `bashExecution` message in the session manager, not a matching command string. It stays empty until the manager contains that message. Pi can defer writing the entry to disk. A deferred result can emit an early end event, followed by another with the entry ID. Clients use execution revisions to reject older updates.

Background streams omit shell updates and execution payloads. They retain `isBashRunning` plus start/end summaries with `id`, `status`, `entryId`, and optional `error`. See the [shell API contract](../reference/api#shell-command) for acceptance and queue failure rules.

## Frontend adapter

`useRuntimeEvents.js` uses `src/lib/event-socket.js` to open one runtime WebSocket on the selected backend. It handles `active_session`, `runtime_roster`, `runtime_removed`, `runtime_event`, `extension_ui`, `extension_error`, `trace_updated`, and `trace_config`. Session changes close the old stream before opening its replacement.

Connection callbacks update the visible stream status. The adapter passes event messages to `handleEvent(type, data)`.

An open subagent inspector uses `useSubagentPreview.js` to read only the selected child with `toolArguments=1`, including saved children. While that child runs, the preview opens a separate child-scoped socket through the same helper. Observation never activates the child or changes the parent's subscription and selection. Closing the inspector releases its child observer without aborting the run.

The adapter forwards extension errors to `onExtensionError`. Composer error handling filters expected cancellations.

## Connection recovery

The runtime and Git review streams share `src/lib/event-socket.js`. It reconnects after errors, closes, or timeouts. Retry delay starts at one second and doubles to 15 seconds, with less than 500 ms of additional random delay. A successful connection resets this delay.

Connection setup has a 10-second timeout. An open connection has a 65-second inactivity timeout. The server sends `{"type":"ping"}` every 30 seconds. The helper replies with `{"type":"pong"}`. The server terminates the connection if the previous ping has no reply at the next check.

These heartbeats are application messages, not WebSocket control frames. Custom clients must send the exact pong text because the server matches it literally. See the [event connection contract](../reference/api#event-websockets).

Reconnect receives fresh runtime snapshots and a roster. It also requests a selected-session refresh and notifies trace subscribers to refresh. The server does not replay missed events. Explicit close cancels reconnect and heartbeat timers, and the helper ignores callbacks from replaced sockets.

The event hub combines `message_update` events within 50 ms and flushes pending updates before later runtime events for the same session. Slow clients have bounded queues that combine replaceable updates. Queue overflow disconnects that client so it can reconnect and refresh current state.

## Trace notices

Trace notices reuse the runtime WebSocket. They do not open another connection or include full trace payloads. `trace_updated` follows a storage commit and carries the trace revision. `trace_config` reports backend capture status and optional controlled errors.

`useRuntimeEvents.js` routes these notices to dedicated subscribers, without adding them to transcript projection. Notices for background sessions remain available to Explorer. Open views fetch only the required summary or detail page and ignore older revisions.

The event hub coalesces queued notices by trace ID and capture configuration. Reconnect tells subscribers to refresh because the stream has no replay history. Closing traces removes view subscriptions without stopping backend capture. See [Elune integration](../integrations/elune).

## Runtime state updates

`App.vue` sends each `active_session` snapshot to `useSessionWorkspace.js`. The composable updates background status for that session ID.

If the snapshot belongs to the selected session, `App.vue` also updates `activeRuntimeSession`. Revision guards reject older snapshots from either HTTP or WebSocket messages.

`runtime_event` payloads update background model/shell running, compacting, unread, and error state. Queue state and branch research progress come from `active_session` snapshots. Runtime events also enter `useLiveTurnProjection.js`.

Automatic title requests use `titleGenerating`, separate from `isStreaming`. Native `session_info_changed` and full/compact `session` summaries keep generated or manual names current, including names received through HTTP snapshots. Title generation creates no assistant transcript row.

## Live transcript projection

`useLiveTurnProjection.js` handles these event families:

- agent and turn start or end
- message start, update, and end, including system-role start and end
- tool call, execution start, and execution end
- shell execution start, update, and end
- compaction start and end
- errors and aborts

`message_update` drives live assistant blocks through one animation-frame batch. It does not fetch persisted detail.

Settlement, shell completion, reconnect, and manual compaction schedule immediate session-detail refreshes. Idle session-info and custom-message changes use a 250 ms debounce. Streaming message, shell output, and tool events do not fetch main-transcript detail individually.

The child preview coalesces its own refreshes after message and tool completion. It queues new reads behind an in-flight request. Reconnect recovery reconciles saved messages before resetting the child projection and replaying post-open events. Its live projection opts into tool arguments for **Output**/**Arguments** readers without changing the main transcript's default projection.

The inspector combines display snapshots into at most one commit per animation frame, after the preview applies authoritative runtime events. This display batch does not delay runtime event handling or discard projected output. The current-rows cache and six-row motion budget affect presentation only. See [Subagent inspector state](./frontend-state#subagent-inspector-state) for reader identity and scroll ownership.

Live user, assistant, System, and tool rows reconcile with projected persisted entries after refresh. The last saved entry ID anchors the merged saved tail. Saved-only rows, including compaction summaries, keep branch order beside matched live rows. The next turn clears matched rows from the previous turn.

See [Live reconciliation and settlement](./transcript-projection#live-reconciliation-and-settlement) for matching and expansion keys.

## Research and extension UI state

The backend folds research state from matching `leyline-research` entries on the active branch.

Runtime snapshots include research state. `App.vue` applies extension UI state only when `activeSessionId` matches the selected session.

The research surfaces use projected state. The browser does not parse this state from transcript text.

<a id="ultrafast-and-confirmation-state"></a>

## Service tiers and confirmation state

The service-tier extension publishes `extensionUi.statuses["leyline-service-tier"]` as `"standard"`, `"fast"`, or `"ultrafast"`. It also publishes legacy `leyline-ultrafast`: `"on"` only for Ultrafast and `"off"` otherwise.

The existing `extension_ui` event and full `active_session` snapshots carry these statuses. Full snapshots also include model DTO `serviceTiers` for eligibility. Compact background snapshots omit extension UI and model DTOs. Reconnect restores the selected session's current state without a separate tier event.

Selection uses HTTP `POST /api/pi/sessions/:id/service-tier` with `{ tier }`, not the WebSocket. The client confirms the result from the revision-accepted runtime snapshot. This prevents a late HTTP response from replacing newer tier state. Legacy status and route fallback provide compatibility only. See [Service tiers](./backend-api#service-tiers) and [Frontend state](./frontend-state#service-tiers-and-confirmations).

Pending browser confirmations also travel in `extensionUi.confirmations`. Compact snapshots include `pendingConfirmationCount` for background supervision. Replies use the session-scoped HTTP route, not the event WebSocket. See [Browser confirmations](./backend-api#browser-confirmations).

## Concurrent sessions

Each runtime event includes `activeSessionId`. Keep this field when adding event handling.

Main-transcript updates apply only to the selected session. Background events update sidebar status and unread state. The subagent inspector separately projects the child requested by its own socket.

All windows connected to one backend receive its broadcasts. Runtime subscriptions and
runtime handles are process-wide within that backend. Windows on another
backend receive a different stream.

An open runtime WebSocket protects only its exact selected `sessionId` from idle cleanup. An unscoped stream or compact snapshots for other sessions do not protect those handles. Cleanup emits `runtime_removed` without deleting history. Reopening or a scoped action restores the runtime and connections. See [Idle runtime cleanup](./backend-api#idle-runtime-cleanup).

## Git review events

`ReviewPane.vue` opens a separate WebSocket at `/api/pi/review/events?cwd=...` when Git review is available and automatic updates are enabled. The backend shares watchers for the same watch root and releases them when the last client disconnects.

`review_ready` confirms watcher setup. The frontend waits for this event before its initial or reconnect refresh, rather than using socket open as the refresh boundary. `review_change` queues another status refresh. These events contain no diff data.

`review_unavailable` closes the subscription and causes the frontend to reload Git status. A watcher failure sends `review_watch_error` and closes with code `1011`. The helper reconnects. A cwd change, disabled automatic updates, or component unmount closes the subscription and cancels retries.

## Terminal events

The terminal endpoint is `/api/pi/terminal` on the active backend. The renderer supplies the selected session ID in the query string.

The endpoint sends JSON WebSocket messages with `ready`, `data`, `error`, or `exit` types. The browser waits for `ready` before it sends `input` and `resize` messages. Closing the socket kills its PTY process.

Keep terminal bytes on the terminal WebSocket. Terminal ordering and backpressure are independent from runtime and Git review events.

## Adding an event consumer

1. Preserve `activeSessionId` at the server boundary.
2. Handle the event type in `handleEvent()` in `useRuntimeEvents.js`.
3. Route cross-feature state through `App.vue`.
4. Keep selected-session filtering in the feature owner.
5. Decide whether the event needs live projection, persisted refresh, or both.
