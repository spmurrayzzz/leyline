# Frontend state

`src/App.vue` is the composition root. It connects feature state, runtime events, API operations, and focused UI components.

## State ownership

| Owner | State and behavior |
| --- | --- |
| `App.vue` | Global Settings and contextual drawer visibility, fixed agent scope and request targets, sidebar navigation, Git review and research sources, composer/queue drafts, attachments, prompt edits and submission, session kind, goals, project selection, and startup motion |
| `useSessionWorkspace.js` | Session list, project grouping, routes, selected detail, activation, runtime snapshots, sidebar activity rows, model, thinking, and Ultrafast controls, rename, delete, fork, reset, and reload |
| `useBackendConnections.js` | App-wide connection records, window-specific selection, connection tests, and default selection |
| `useTranscriptPreferences.js` | App-wide transcript display settings, loading state, and save errors |
| `GlobalSettingsModal.vue` | Category navigation, capability filtering, modal focus, and scope labels |
| `AgentSettings.vue` | Fixed-scope subagent and vision controls, inheritance display, and available model choices |
| `ProviderSettings.vue` / `McpSettings.vue` | Inventories, selection, drafts, revisions, mutation errors, connection tests or MCP checks, and leave guards |
| `PiSettingsWorkspace.vue` | Searchable list, narrow-layout selector, and bounded detail pane |
| `useSettingsOperation.js` | Private operation polling, answers, cancellation, and backend-bound cleanup |
| `useLiveTurnProjection.js` | Optimistic user entries, live assistant blocks, System rows, tools, compaction activity, and live-to-persisted reconciliation |
| `PromptQueue.vue` | Queue expansion, active edit, action menus, queue mutations, and tray width measurement |
| `useRuntimeEvents.js` | EventSource lifecycle, connection state, and the local event log |
| `useMemoryInspector.js` | Visible Memory data, loading, optimistic mutations, dirty-state guards, and drawer state |
| `useProjectBrowser.js` | Project picker state, folder expansion, and project-browser visibility |
| `useToolExpansion.js` | Tool and skill expansion, copy state, and fullscreen previews |
| `SystemPromptInspector.vue` | Tabs, raw view, event actions, and rendering for the System event selected by `App.vue` |
| `useWorkbenchScroll.js` | Bottom following, composer space, new-output state, and Jump to latest |
| `useTerminal.js` | xterm, WebSocket, PTY status, focus, fit, and drawer height |
| `useDictation.js` | Browser speech-recognition state inside both composer components |
| `useSmoothStreamingText.js` | Incremental text reveal for live Markdown blocks |

## App composition

`App.vue` creates the composables and passes narrow props and events to components. Components do not own session runtime objects.

`SessionSidebar.vue` renders the current project and its virtualized session list. It owns session search, navigator search, stable project order, and cross-project activity groups.

`SessionComposer.vue` and `StartComposer.vue` own local input mechanics and dictation adapters.

`PromptQueue.vue` displays backend queue state. It does not schedule model work. Its attached tab opens a bounded corner tray, with a measured full-width layout when the composer is narrow. Opening it leaves the input and footer fixed.

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

The snapshots also retain pending tool descriptors, detailed runtime errors, diagnostics, and activity timestamps for supervision UI.

The selected session route is `/sessions/:id`. Browser history changes call the same selection flow.

## Active runtime state

`activeRuntimeSession` contains the selected session's runtime DTO. It includes model, thinking, tools, context, queues, extension UI, goal state, and research state.

SSE can send snapshots for all server handles. `App.vue` updates the selected runtime only when the IDs match. Both selected and background state reject older `snapshotRevision` values. This prevents a late HTTP response from restoring stale queue state.

Background event summaries remain in `runtimeSessionsById`. They supply current-project row status and the **Activity** navigator for all nonselected live sessions.

Activity derives shared-CWD warnings from active or unheld queued work. Its **Stop** action uses the session-scoped interrupt route and stays unavailable during compaction.

## Ultrafast and confirmations

Both composers show a lowercase `ultrafast` chip beside the model and thinking controls for eligible models. A click changes the mode directly, without a confirmation modal.

`useSessionWorkspace.js` owns eligibility, mutation state, and the staged Home choice. Home reads only project-matched runtime previews. Project and model changes clear its staged Ultrafast choice. A same-project refresh retains it only for the same model with current Ultrafast eligibility.

Selected sessions read the extension status from revision-accepted runtime snapshots. The renderer does not construct provider tier fields or calculate Ultrafast costs. See [Ultrafast](./backend-api#ultrafast) for eligibility, reset, and request rules.

`ExtensionConfirmations.vue` displays pending extension confirmations from the selected runtime snapshot. It sends **Confirm** or **Cancel** replies through the session-scoped API. The panel remains outside the fading and inert composer layers during startup motion.

## Composer queue

During a run, Enter adds an editable **Up next** task. Option+Enter or the send-options menu selects native steering. When idle with no pending queue, Enter sends normally.

`activeRuntimeSession.state.promptQueue` supplies pending items, held state, errors, and the mutation revision. Compact background snapshots supply counts instead of items. The renderer takes queue state from snapshots, not raw `queue_update` arrays.

`PromptQueue.vue` calls the session-scoped queue route with an item ID and the current queue revision. It emits the returned runtime snapshot through `SessionComposer.vue` to `App.vue`.

Opening an editor first holds the queue. Saving changes only text and retains attachments. Closing the tray retains the local edit. Resume remains explicit. The separate **Sent to agent** section is read-only native input.

`App.vue` owns the queue-edit draft cache. Session changes and composer unmount save the active edit there. Returning from Home restores it. Deleting a session removes its cached draft. Browser reload discards local edits, while the backend retains accepted queue tasks.

The tray height limit includes the terminal drawer height. Its list scrolls within the space above the composer, keeping the attached tab accessible.

The global Escape handler dismisses queue surfaces before it can interrupt a run. Outside-click handling uses `composedPath()` because an action can remove its clicked node before the window listener runs.

Stop applies its returned snapshot through the revision guard. Expected cancellations do not create composer error banners. Genuine failures and raw runtime events remain available.

## Persisted and live transcript state

`sessionDetail.entries` is the persisted projected branch from the backend. `useLiveTurnProjection.js` keeps live state separate.

An immediate prompt creates an optimistic user entry. An **Up next** task stays outside the transcript until pi emits its user-message events. Runtime events add live user, assistant, System, and tool items.

A queued request retains its original handoff ID through dispatch. If user events arrive before the queued HTTP response, retiring the optimistic entry keeps the confirmed live row. This also supports input transformations.

The composable matches live items to refreshed persisted entries. It keeps matched live rows until visual timing and persistence conditions settle.

A reactive anchor length prevents duplicate or reordered transcript rows during a live turn. The anchor releases after user, assistant, System, tool, and activity state settles.

At the next turn start, the composable clears the previous turn's matched live rows. They then render from the persisted list in branch order. See [Live reconciliation and settlement](./transcript-projection#live-reconciliation-and-settlement).

`message_update` events update live assistant output. They do not trigger a detail refresh.

Settlement, reconnect, and manual compaction schedule immediate detail refreshes. Idle session-info and custom-message changes use a 250 ms debounce. Streaming tool and message events use live projection instead of per-event detail fetches.

## Project browser and Project settings

`useProjectBrowser.js` owns the start-screen project menu and opens the folder browser.

`ProjectBrowser.vue` owns filesystem query text, directory rows, keyboard selection, loading state, and the selected path. It calls the backend filesystem route.

`App.vue` owns `projectDetailCwd` and derives the selected project from the session list.

`ProjectDetailDrawer.vue` renders Project settings with **Settings** and **Sessions** tabs. It owns the tab, filter, and sort mode. The Settings tab receives project-scoped `AgentSettings.vue` through its slot. Session create, open, rename, and delete operations return to `App.vue` and `useSessionWorkspace.js`.

## Memory Inspector

`useMemoryInspector.js` loads memories for the selected cwd and session file. A request token rejects results for a previous selection.

The composable applies optimistic updates for edit, archive, restore, and delete. It restores prior state when a request fails.

`MemoryInspector.vue` owns form drafts, scope sections, search, archived visibility, selection, and delete confirmation.

Dirty Memory state can block session changes and drawer changes. Memory Changes affect later turns because in-flight prompt context is already built.

## Settings surfaces

`App.vue` owns three distinct surfaces. The gear and native Settings command open `GlobalSettingsModal.vue`. Project actions open Project settings. The session header opens Session details, which contains read-only runtime metadata and session overrides.

The global modal has Display, Connections, Files, Agent defaults, Models & providers, and MCP servers categories. Display and Connections use the native app backend. The other categories use the selected backend. Files requires `fileLinks`. Models & providers and MCP servers require `piSettings`.

`GlobalSettingsModal.vue` groups categories by owner, fixes the scope label, and uses a selector on narrow layouts. It makes the app root inert, contains keyboard focus, handles Escape, and restores focus on close. Initial focus goes to the dialog container without a visible category highlight.

Electron's `CommandOrControl+,` command opens global Settings idempotently. Command+Shift+E toggles Session details, not global Settings. It does nothing on Home or while blocking overlays are open.

### Agent defaults and overrides

`AgentSettings.vue` replaces the former Subagents and Vision configuration drawers. The containing surface fixes `scope`: global in Agent defaults, project in Project settings, and session in Session details. There is no scope picker inside global Settings.

`App.vue` loads settings against an explicit cwd and optional session path. Request generations and backend/scope/target keys reject stale results. Mutations use the loaded target and require its displayed scope. Session overrides require a saved session context and copy to forks.

The component resolves values from the displayed scope toward broader scopes. A global or project editor must not display a narrower session override as its effective value. Subagent models fall back to the agent definition. Vision model and thinking inherit independently. The vision picker contains only image-capable models.

These overrides use the existing subagent and vision APIs and Leyline SQLite. They are separate from pi `models.json` overrides. See [Settings surfaces and ownership](./architecture#settings-surfaces-and-ownership).

### Provider and MCP workspaces

`ProviderSettings.vue` and `McpSettings.vue` use `PiSettingsWorkspace.vue` for searchable lists and detail panes. Lists and details scroll independently inside the stable modal frame. Notices have a bounded area. Narrow layouts use a selector instead of the list.

`App.vue` captures the provider target when Settings opens. Components own local drafts, inventory revisions, selected entries, and operation state. Generation and backend guards reject late responses. Leave guards cover unsaved drafts, pending operations, and non-cancellable saves.

`src/lib/pi-settings-api.js` sends Settings requests to the selected backend with caching disabled. `useSettingsOperation.js` retains the starting backend URL, polls every 500 ms, and retries most polling errors after two seconds. It sequences answers and poll responses, and cancels owned work during cleanup. A late action response after navigation also receives cancellation.

`PiSettingsOperation.vue` displays private prompts and controlled progress messages. It clears submitted values and uses password inputs for secret and manual-code prompts. Operations never use shared session SSE or extension-confirmation cards. See [Settings operations](../reference/api#settings-operations) for exact shapes.

`ProviderSettings.vue` offers **Test connection** per saved model and beside **Save** in provider and model editors. Editor tests send unsaved form values and the inventory revision without saving configuration or changing live runtimes or transcripts. The provider editor has a separate test-only model ID that is never saved. API keys stay optional, and removing a key reference does not sign out a stored credential.

Draft progress, results, errors, and the operation's **Cancel** control appear beside **Save** and **Test connection** inside `.pi-settings-draft-actions`. A state change uses `scrollIntoView({ block: 'nearest' })` only when that group already intersects the detail viewport. It does not jump to the form's top or pull the user back after they scroll away. Saved-provider authentication and non-draft operations keep their separate placement above the form.

Changing draft values or the test-only model ID clears the previous test result. Operation ownership ties feedback to the current draft, provider, and request generation. Navigation and backend changes clear owned operations, while server revision checks reject draft tests against changed configuration. Test completion does not emit a settings-change event or request a runtime reload. A failed test does not block saving or model selection. See [Provider connection tests](./backend-api#provider-connection-tests) for probe limits, refused APIs, and shared OAuth-token refresh.

Provider Refresh sends `refresh=1` to `/settings/providers`, which reloads settings extension registrations. Catalog refresh is a separate provider action. On Home, provider changes trigger `/state` with an explicit cwd and `refresh=1`. Same-project previews retain valid explicit model/thinking choices and recheck Ultrafast eligibility. Request identity and cwd checks reject stale previews.

Settings changes do not refresh a live conversation catalog. The explicit reload control uses the existing session reload path and then refreshes the settings pane. It is unavailable when the selected session cannot reload. Other open sessions remain unchanged.

## Vision image delegation

The composer's `visionConfigData` is separate from `visionSettingsData` in the editor. `loadVisionConfig()` always uses the selected session or staged Home project. Loading or saving editor settings refreshes this effective composer configuration through its own target and request token.

When the parent model cannot receive attached images, `App.vue` shows the effective vision model. The backend saves attachments and gives the parent a `vision_agent` instruction. The parent calls the tool during its turn, and the result appears in the transcript.

## Deep research

`App.vue` keeps the staged start-session kind as `session` or `research`. Start-composer creation uses this value. Other creation flows use `session`.

`selectedResearch` uses the active runtime state first and persisted session state second. It drives the phase bar, report state, source count, and composer language.

`App.vue` owns source-pane visibility and citation-preview state. `ResearchSourcesPane.vue` owns the **Cited** and **Research ledger** views.

A valid citation event resolves the source, closes an open third rail, and opens an anchored preview after the layout settles. Desktop source-pane state also controls the third app-grid column.

## Git review

`App.vue` enables review only when `/api/pi/info` reports the `review` capability and the viewport is wider than 1120 pixels.

The selected desktop session mounts `ReviewPane.vue` while the pane is closed. It loads Git status for the header, but waits for `open` or `prepare` before fetching and preparing the selected diff. Status readiness alone does not emit a successful `prepared` state.

When the backend reports `reviewWatch`, `ReviewPane.vue` subscribes to `/api/pi/review/events?cwd=...` only after Git status reports `available`. Non-Git directories receive no watcher. Stream open and `review_change` events queue status refreshes that preserve selection. While closed, changes mark the diff for refresh without rebuilding its preview. The stream closes when the repository becomes unavailable, its cwd changes, or the component unmounts.

A settled runtime event for the selected project and a completed composer shell command still increment the review refresh token. These triggers and the manual refresh control remain available when filesystem watching is unavailable.

Expanded review hides the transcript and uses the full workspace after the sidebar. Collapse restores the saved review width.

## Tool expansion and previews

`useToolExpansion.js` stores tool and skill expansion state, clipboard fallback state, and the selected fullscreen tool. System rows instead open `SystemPromptInspector.vue`. `App.vue` owns the selected event and follows its live-to-persisted handoff without resetting inspector tabs or raw view. See [System messages](./transcript-projection#system-messages).

Expansion state resets when the selected session changes. Preview content remains part of the projected transcript entry.

## Workbench scrolling

`useWorkbenchScroll.js` observes the composer height and reserves matching workbench space. It tracks whether the user remains near the bottom.

Live output follows the bottom only when bottom sticking is active. Otherwise, the composable sets `hasNewOutput` for Jump to latest.

A selected-session change resets scroll state. The terminal height and composer height also change the reserved layout space.

## Drawer coordination

`App.vue` coordinates global Settings, Project settings, Session details, Runtime events, Memory, research sources, and sidebar navigators. Opening global Settings closes contextual drawers and conflicting overlays. Opening a navigator closes conflicting drawers and configuration surfaces. Subagent and vision controls belong to the fixed-scope settings surfaces, not separate drawers.

Git review, research sources, and the prompt inspector share the desktop third rail. Opening one closes the others. The rail can remain open with contextual drawer state.

The terminal is independent and can remain open below the workbench. Session changes reconnect it so the PTY uses the selected session CWD.

## Cleanup

`App.vue` closes SSE, WebSocket, timers, observers, and composable resources during unmount.

Keep external listeners and timers in their owning composable where possible. Let `App.vue` own only cross-feature coordination.
