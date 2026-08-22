# Frontend state

`src/App.vue` is the composition root. It connects feature state, runtime events, API operations, and focused UI components.

## State ownership

| Owner | State and behavior |
| --- | --- |
| `App.vue` | Drawer and sidebar navigator visibility, Git review and research-source state, composer draft, attachments, edit state, prompt submission, session kind, goal commands, agent settings, project detail selection, and startup motion phases |
| `useSessionWorkspace.js` | Session list, project grouping, routes, selected detail, activation, runtime snapshots, sidebar activity rows, model and thinking controls, rename, delete, fork, reset, and reload |
| `useBackendConnections.js` | App-wide connection records, window-specific selection, connection tests, and default selection |
| `useTranscriptPreferences.js` | App-wide transcript display settings, loading state, and save errors |
| `useLiveTurnProjection.js` | Optimistic user entries, live assistant blocks, live tools, compaction activity, and live-to-persisted reconciliation |
| `useRuntimeEvents.js` | EventSource lifecycle, connection state, and the local event log |
| `useMemoryInspector.js` | Visible Memory data, loading, optimistic mutations, dirty-state guards, and drawer state |
| `useProjectBrowser.js` | Project picker state, folder expansion, and project-browser visibility |
| `useToolExpansion.js` | Tool and skill expansion, copy state, and fullscreen previews |
| `useWorkbenchScroll.js` | Bottom following, composer space, new-output state, and Jump to latest |
| `useTerminal.js` | xterm, WebSocket, PTY status, focus, fit, and drawer height |
| `useDictation.js` | Browser speech-recognition state inside both composer components |
| `useSmoothStreamingText.js` | Incremental text reveal for live Markdown blocks |

## App composition

`App.vue` creates the composables and passes narrow props and events to components. Components do not own session runtime objects.

`SessionSidebar.vue` renders the current project and its virtualized session list. It owns session search, navigator search, stable project order, and cross-project activity groups.

`SessionComposer.vue` and `StartComposer.vue` own local input mechanics and dictation adapters.

`TranscriptEntry.vue` renders persisted entries and emits transcript actions. `LiveAssistantMessage.vue` renders live assistant output.

`ReviewPane.vue` owns the changed-file list, selected diff, preparation state, and resize bounds. `App.vue` owns open and expanded state.

`useTranscriptPreferences.js` loads app-wide display settings. `App.vue` gives the thought display default to both transcript components.

## Backend selection

`useBackendConnections.js` reads connection records from the native backend.
It stores the active ID in window `sessionStorage` and configures
`src/lib/backend.js` before workspace requests begin.

A backend switch verifies `GET /api/pi/info` and reloads the window. `App.vue` then opens SSE and loads sessions from the selected backend.

Retry uses the same connection flow. Transcript preferences always use the native backend, not the selected runtime backend.

## Session selection

`useSessionWorkspace.js` uses a selection token. A stale detail or activation response cannot replace a newer selection.

Selection has two phases:

1. Load persisted detail for quick transcript display.
2. Activate the pi runtime in the background.

A promise queue serializes activation requests. The latest token determines which result can update selected state.

`runtimeSessionsById` stores frontend status snapshots, not server runtime handles. These snapshots drive running, compacting, unread, error, and queued labels.

The selected session route is `/sessions/:id`. Browser history changes call the same selection flow.

## Active runtime state

`activeRuntimeSession` contains the selected session's runtime DTO. It includes model, thinking, tools, context, queues, extension UI, goal state, and research state.

SSE can send snapshots for all server handles. `App.vue` updates the selected runtime only when the IDs match.

Background event summaries remain in `runtimeSessionsById`. They supply row status in the current project and the **Activity across projects** navigator.

## Persisted and live transcript state

`sessionDetail.entries` is the persisted projected branch from the backend. `useLiveTurnProjection.js` keeps live state separate.

A submitted prompt first creates an optimistic user entry. Runtime events then add live user, assistant, and tool items.

The composable matches live items to refreshed persisted entries. It keeps matched live rows until visual timing and persistence conditions settle.

An anchor length prevents duplicate or reordered transcript rows during a live turn. The anchor releases after user, assistant, tool, and activity state settles.

`message_update` events update live assistant output. They do not trigger a detail refresh.

Other runtime events schedule a detail refresh. The normal debounce is 250 ms, while `compaction_end` refreshes immediately.

## Project browser and Project Details

`useProjectBrowser.js` owns the start-screen project menu and opens the folder browser.

`ProjectBrowser.vue` owns filesystem query text, directory rows, keyboard selection, loading state, and the selected path. It calls the backend filesystem route.

`App.vue` owns `projectDetailCwd` and derives the selected project from the session list.

`ProjectDetailDrawer.vue` owns its local filter and sort mode. Session create, open, rename, and delete operations return to `App.vue` and `useSessionWorkspace.js`.

## Memory Inspector

`useMemoryInspector.js` loads memories for the selected cwd and session file. A request token rejects results for a previous selection.

The composable applies optimistic updates for edit, archive, restore, and delete. It restores prior state when a request fails.

`MemoryInspector.vue` owns form drafts, scope sections, search, archived visibility, selection, and delete confirmation.

Dirty Memory state can block session changes and drawer changes. Memory Changes affect later turns because in-flight prompt context is already built.

## Subagent settings

`App.vue` owns subagent drawer state and requests. It rejects stale responses by request token and session key.

`SubagentConfigDrawer.vue` owns the selected override scope. Backend data supplies discovered agents, visible overrides, and effective models.

## Vision settings and image delegation

`App.vue` loads vision configuration for the selected session or staged start-screen project. A request token and target key prevent a response for an old target from replacing current data.

`VisionConfigDrawer.vue` owns the selected scope. It disables **Transcript** before a session exists and lists only models with image support.

When the parent model cannot receive attached images, `App.vue` shows the effective vision model. It tells the user that the model will call the vision subagent when the prompt runs. The backend saves the attachments and gives the parent a `vision_agent` instruction. The tool call and result appear in the transcript.

## Deep research

`App.vue` keeps the staged start-session kind as `session` or `research`. Start-composer creation uses this value. Other creation flows use `session`.

`selectedResearch` uses the active runtime state first and persisted session state second. It drives the phase bar, report state, source count, and composer language.

`App.vue` owns source-pane visibility, selected source ID, and citation reveal keys. `ResearchSourcesPane.vue` owns its filter and list scrolling.

A valid citation event opens the source pane, resets the filter, selects the source, and moves its card into view. Desktop source state also controls the third app-grid column.

## Git review

`App.vue` enables review only when `/api/pi/info` reports the `review` capability and the viewport is wider than 1120 pixels.

The selected desktop session mounts `ReviewPane.vue` while the pane is closed. The component prepares the Git status and first Pierre diff before it emits `prepared`.

When the backend reports `reviewWatch`, `ReviewPane.vue` opens `/api/pi/review/events?cwd=...`. Each connection and `review_change` event queues a refresh that preserves the selected file. The component closes the stream when its cwd changes or it unmounts.

A settled runtime event for the selected project and a completed composer shell command still increment the review refresh token. These triggers and the manual refresh control remain available when filesystem watching is unavailable.

Expanded review hides the transcript and uses the full workspace after the sidebar. Collapse restores the saved review width.

## Tool expansion and previews

`useToolExpansion.js` stores expanded tool IDs and skill IDs. It also owns clipboard fallback state and the selected fullscreen tool.

Expansion state resets when the selected session changes. Preview content remains part of the projected transcript entry.

## Workbench scrolling

`useWorkbenchScroll.js` observes the composer height and reserves matching workbench space. It tracks whether the user remains near the bottom.

Live output follows the bottom only when bottom sticking is active. Otherwise, the composable sets `hasNewOutput` for Jump to latest.

A selected-session change resets scroll state. The terminal height and composer height also change the reserved layout space.

## Drawer coordination

`App.vue` coordinates Project Details, Settings, Runtime Events, Memory, Subagents, Vision agent, research sources, and sidebar navigators. Opening a navigator closes conflicting drawers and configuration surfaces.

Git review and research sources share the desktop third rail. Opening one closes the other. The rail can remain open with contextual drawer state.

The terminal is independent and can remain open below the workbench. Session changes reconnect it so the PTY uses the new active cwd.

## Cleanup

`App.vue` closes SSE, WebSocket, timers, observers, and composable resources during unmount.

Keep external listeners and timers in their owning composable where possible. Let `App.vue` own only cross-feature coordination.
