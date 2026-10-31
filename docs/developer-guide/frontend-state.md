# Frontend state

`src/App.vue` is the composition root. It connects feature state, runtime events, API operations, and focused UI components.

## State ownership

| Owner | State and behavior |
| --- | --- |
| `App.vue` | Global Settings and contextual drawer visibility, fixed agent scope and request targets, sidebar navigation, Git review and research sources, composer/queue drafts, attachments, prompt edits and submission, session kind, project selection, and startup motion |
| `useSessionWorkspace.js` | Session list, project grouping, routes, selected detail, activation, runtime snapshots, sidebar activity rows, model, thinking, and service-tier controls, rename, delete, fork, reset, and reload |
| `useBackendConnections.js` | App-wide connection records, window-specific selection, connection tests, and default selection |
| `usePinnedSessions.js` | Pinned session IDs for the active connection, load revisions, pending toggles, errors, and batched cleanup |
| `useTranscriptPreferences.js` | App-wide transcript display settings, loading state, and save errors |
| `GlobalSettingsModal.vue` | Category navigation, capability filtering, modal focus, and scope labels |
| `AgentSettings.vue` | Fixed-scope subagent models, global/session batch size, vision controls, global-only session titles, inheritance display, and available model choices |
| `SessionTitleSettings.vue` / `SettingsSelect.vue` | Automatic-title settings, model filtering, and model/thinking selectors on the selected backend |
| `RuntimeSettings.vue` | Selected-backend idle-timeout draft, validation, save state, and leave guard |
| `ServiceTierPicker.vue` | Desktop service-tier chip, menu, keyboard selection, and focus handling |
| `MobileComposerControls.vue` | Shared Home/session controls and sheets for model, thinking, and speed |
| `ProviderSettings.vue` / `McpSettings.vue` | Inventories, selection, drafts, revisions, mutation errors, connection tests or MCP checks, and leave guards |
| `PiSettingsWorkspace.vue` | Searchable list, narrow-layout selector, and bounded detail pane |
| `useSettingsOperation.js` | Private operation polling, answers, cancellation, and backend-bound cleanup |
| `useLiveTurnProjection.js` | Optimistic user entries, live assistant blocks, System rows, tools, shell execution, compaction activity, and live-to-persisted reconciliation |
| `PromptQueue.vue` | Queue expansion, active edit, action menus, queue mutations, and tray width measurement |
| `useRuntimeEvents.js` | Runtime WebSocket subscription, connection state, and dedicated trace notice subscribers |
| `src/lib/event-socket.js` | Shared runtime/review WebSocket client, selected-backend URLs, reconnect backoff, timeouts, heartbeat replies, and stale-socket guards |
| `App.vue` / `TracePanel.vue` | Trace surface mode, small selection and return state, selected-backend client, capture controls, and view cleanup |
| `useMemoryInspector.js` | Visible Memory data, loading, optimistic mutations, dirty-state guards, and drawer state |
| `useProjectBrowser.js` | Project picker state, folder expansion, and project-browser visibility |
| `useToolExpansion.js` | Tool and skill expansion, copy state, and fullscreen previews |
| `SystemPromptInspector.vue` | Tabs, raw view, event actions, and rendering for the System event selected by `App.vue` |
| `SubagentInspector.vue` | Selected task, displayed snapshots, Action ledger, full-entry readers, scroll anchors, following, and bounded row motion |
| `SubagentTailEntry.vue` | One ledger row with an action, source-derived target and excerpt, outcome, character count, and reader-open event |
| `useSubagentPreview.js` | Selected saved or active child detail, runtime subscription, refresh queue, recovery, and stable preview identities |
| `useWorkbenchScroll.js` | Bottom following, composer space, new-output state, and Jump to latest |
| `useTerminal.js` | xterm, WebSocket, PTY status, focus, fit, and drawer height |
| `App.vue` / `useDictation.js` | One shared dictation controller for both composers; routes browser speech recognition or local dictation through the preload bridge or same-origin speech WebSocket |
| `useSmoothStreamingText.js` | Incremental text reveal for live Markdown blocks |

## App composition

`App.vue` creates the composables and passes narrow props and events to components. Components do not own session runtime objects.

`SessionSidebar.vue` renders the current project and its virtualized session list. It owns session search, navigator search, stable project order, and cross-project activity groups. It flattens ordered parents and visible children into positioned rows for virtualization and arrow-key focus. Outside search, parents remain pinned-first. Row buttons expose `aria-current`, and parent chevrons expose `aria-expanded`. Collapsing or partially revealed child rows are inert and use `aria-hidden`.

`useSessionWorkspace.js` supplies `subagentChildrenByParentPath` for sessions with both `isSubagentSession` and `parentSessionPath`. A parent path alone does not classify a subagent. The map joins child IDs to task labels and agent names from the parent's `subagentChildren` metadata. `session-summary.js` reads this metadata from persisted subagent tool results. Session DTOs include child IDs, task labels, and agent names without child paths.

`SessionSidebar.vue` prefers the child's current session `name` over its task metadata label. The inspector and HTML export prefer the explicit result `title`, while keeping the full `task` prompt separate. Older records retain their existing title fallbacks.

Runtime summary merges preserve existing `subagentChildren` when a snapshot omits it. Children stay in creation order, independent of runtime activity. Sidebar search keeps parent context and shows only matching children. Children remain outside regular session counts, pin controls, and the **Activity** navigator.

`SessionComposer.vue` and `StartComposer.vue` own local input mechanics. `App.vue` creates one dictation controller and passes it to both composers.

`PromptQueue.vue` displays backend queue state. It does not schedule model work. Its attached tab opens a bounded corner tray, with a measured full-width layout when the composer is narrow. Opening it leaves the input and footer fixed.

`TranscriptEntry.vue` renders persisted entries and emits transcript actions. `LiveAssistantMessage.vue` renders live assistant output.

`ReviewPane.vue` owns the changed-file list, selected diff, preparation state, and resize bounds. `App.vue` owns open and expanded state.

`useTranscriptPreferences.js` loads app-wide display settings. `App.vue` gives the thought display default to both transcript components.

## Backend selection

`useBackendConnections.js` reads connection records from the native backend.
It stores the active ID in window `sessionStorage` and configures
`src/lib/backend.js` before workspace requests begin.

A backend switch verifies `GET /api/pi/info` and reloads the window. `App.vue` then opens the runtime WebSocket and loads sessions from the selected backend.

Retry uses the same connection flow. Transcript preferences always use the native backend, not the selected runtime backend.

Pinned sessions also use the native backend. `App.vue` captures the active connection ID for each pin operation and supplies the resulting ID set to the sidebar. Pins stay separate from session DTOs. Confirmed session and project deletions prune their IDs. After full session hydration and a successful pin load, `App.vue` removes pin IDs that no session claims.

## Trace surfaces

`capabilities.tracing` enables session traces and the sidebar Explorer. `App.vue` loads `TracePanel.vue` asynchronously and mounts only one Inspector, Workspace, or Explorer at a time. The components come from optional `@elune/embedded/vue` bindings with an explicit style import.

Inspector scopes its list to the selected session. Workspace retains that session and the selected trace. Explorer searches across projects on the selected backend. It does not merge saved connections.

`src/lib/trace-client.js` receives the selected connection and the existing runtime WebSocket subscription adapter. Views receive the client through props. Display and connection settings still use the native backend, while capture settings use this trace client's selected backend.

The host retains selection, tab, observation offset and limit, list filters, page, and return origin. It preserves selection between Inspector or Explorer and Workspace without retaining complete trace trees. Backend and ordinary session navigation reset trace state.

Closing traces unmounts the surface, aborts requests, and removes subscriptions. Closed views make no trace queries. Document visibility pauses requests and subscriptions. Native hidden Electron windows can still report visible documents.

A hidden narrow-layout Explorer preview pauses detail requests. Hidden observation detail does not mount its renderer. Workspace and Explorer make the covered workbench inert and pause scroll following. Capture continues regardless of view lifetime.

Trace notices bypass transcript projection. See [Elune integration](../integrations/elune) for the capture boundary and [Trace routes](../reference/api#trace-routes) for pagination.

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

`activeRuntimeSession` contains the selected session's runtime DTO. It includes model, thinking, tools, context, queues, extension UI, research state, `isBashRunning`, and the latest `bashExecution`.

Open-runtime HTTP and WebSocket snapshots also carry `session` and `state.titleGenerating`. Summary merges update names in both the session list and selected detail. Full and compact snapshots retain the title flag. The header and sidebar show **Generating title…** while retaining real labels for search and rename drafts. This flag describes a separate title request, not conversation streaming.

The runtime WebSocket can send snapshots for all server handles. `App.vue` updates the selected runtime only when the IDs match. Both selected and background state reject older `snapshotRevision` values. This prevents a late HTTP response from restoring stale queue state.

Background event summaries remain in `runtimeSessionsById`. They supply current-project row status and the **Activity** navigator for all nonselected live sessions.

Activity derives shared-CWD warnings from active or unheld queued work. Its **Stop** action uses the session-scoped interrupt route and stays unavailable during compaction.

<a id="ultrafast-and-confirmations"></a>

## Service tiers and confirmations

Both desktop composers use `ServiceTierPicker.vue` when a premium tier is available. Its chip shows the current tier. The menu uses lowercase labels: `standard`, `fast`, and `ultrafast`, with only eligible choices shown. Fast remains available on Ultrafast-capable models. Selection needs no confirmation modal.

`MobileComposerControls.vue` keeps the speed bolt visible in the shared Home/session capsule. The bolt opens **Speed** directly. Standard uses an outlined gray bolt. Fast and Ultrafast use a filled lavender bolt. The sheet lists each available tier or explains that Fast and Ultrafast are unavailable. Failed asynchronous changes keep error feedback visible.

`useSessionWorkspace.js` reads model DTO `serviceTiers`, owns mutation state, and stages the Home choice. Standard is the default. Home reads only project-matched runtime previews. Project and model changes reset its staged tier to Standard. A same-project refresh retains the exact tier only for the same available model with current eligibility.

Home submission captures the staged tier and model. `App.vue` creates the session, applies model and thinking choices, then applies the premium tier before it submits the prompt. A failed or unconfirmed tier change stops that submission.

Selected sessions read `extensionUi.statuses["leyline-service-tier"]`, whose values are `standard`, `fast`, and `ultrafast`. Tier changes use `setPiServiceTier()` and the session-scoped `service-tier` route. The composable confirms the result from the revision-accepted snapshot, rather than a stale HTTP response. Ordinary session prompts can still enter **Up next** during the change.

For compatibility, models without `serviceTiers` fall back to `supportsUltrafast`. A runtime with only the legacy `leyline-ultrafast` status offers Standard and eligible Ultrafast, never Fast. That path uses `setPiUltrafast()` and the legacy `ultrafast` route. Missing both statuses does not establish premium support.

The renderer does not construct provider tier fields or calculate tier costs. See [Service tiers](./backend-api#service-tiers) for eligibility, lifecycle resets, exact-tier restoration, request isolation, and cost estimates. The user-facing control is documented at [Choose a service tier](../user-guide/runtime-controls#choose-a-service-tier).

`ExtensionConfirmations.vue` displays pending extension confirmations from the selected runtime snapshot. It sends **Confirm** or **Cancel** replies through the session-scoped API. The panel remains outside the fading and inert composer layers during startup motion.

## Composer queue

During a run, Enter adds an editable **Up next** task. Option+Enter or the send-options menu selects native steering. When idle with no pending queue, Enter sends normally.

`activeRuntimeSession.state.promptQueue` supplies pending prompts and shell commands, held state, errors, and the mutation revision. Compact background snapshots supply counts instead of items. The renderer takes queue state from snapshots, not raw `queue_update` arrays.

Shell items expose `shell: true`. Their text keeps a `!` or `!!` prefix, and they cannot include images or use **Steer now**. Multiple commands can queue beside prompts. A shell HTTP response confirms acceptance, not completion. Runtime state and shell events supply progress and completion. Execution does not request an assistant reply.

`PromptQueue.vue` calls the session-scoped queue route with an item ID and the current queue revision. It emits the returned runtime snapshot through `SessionComposer.vue` to `App.vue`.

Opening an editor first holds the queue. Saving changes only text and retains attachments. Closing the tray retains the local edit. Resume remains explicit. The separate **Sent to agent** section is read-only native input.

`App.vue` owns the queue-edit draft cache. Session changes and composer unmount save the active edit there. Returning from Home restores it. Deleting a session removes its cached draft. Browser reload discards local edits, while the backend retains accepted queue tasks.

The tray height limit includes the terminal drawer height. Its list scrolls within the space above the composer, keeping the attached tab accessible.

The global Escape handler dismisses queue surfaces before it can interrupt a run. Outside-click handling uses `composedPath()` because an action can remove its clicked node before the window listener runs.

Stop applies its returned snapshot through the revision guard. Expected cancellations do not create composer error banners. Genuine failures still create composer error banners.

## Persisted and live transcript state

`sessionDetail.entries` is the persisted projected branch from the backend. `useLiveTurnProjection.js` keeps live state separate.

An immediate prompt creates an optimistic user entry. An **Up next** prompt stays outside the transcript until pi emits its user-message events. Shell tasks instead create live bash rows from `bash_execution_start`, `bash_execution_update`, and `bash_execution_end`.

`bashExecution` snapshots restore the latest shell row after reconnect. The execution ID keeps live rows stable. The exact native `entryId` matches the persisted `bashExecution` message. Command text is not a reconciliation key. Runtime events add live user, assistant, System, and tool items.

A queued request retains its original handoff ID through dispatch. If user events arrive before the queued HTTP response, retiring the optimistic entry keeps the confirmed live row. This also supports input transformations.

The composable matches live items to refreshed persisted entries. It keeps matched live rows until visual timing and persistence conditions settle.

An anchor stores the last saved entry ID at turn start. Projection merges the saved tail in branch order with retained live rows keyed by `persistedEntry.id`. Saved-only rows, including compaction summaries, remain in that merged tail after settlement.

At the next turn start, the composable clears the previous turn's matched live rows. They then render from the persisted list in branch order. See [Live reconciliation and settlement](./transcript-projection#live-reconciliation-and-settlement).

`message_update` events update live assistant output. They do not trigger a detail refresh.

Each runtime WebSocket connection receives snapshots and the runtime roster. On reconnect, `useRuntimeEvents.js` also invokes the existing refresh callbacks. See [Realtime events](./realtime-events).

Settlement, shell completion, reconnect, and manual compaction schedule immediate detail refreshes. Idle session-info and custom-message changes use a 250 ms debounce. Streaming tool, shell output, and message events use live projection instead of per-event detail fetches.

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

The global modal includes Display, Connections, Dictation, Files, Certificates, Agent defaults, Runtime, Models & providers, and MCP servers. Display and Connections use the native app backend. Files, Certificates, Agent defaults, Runtime, Models & providers, and MCP servers use the selected backend. Files requires `fileLinks`. Runtime, Certificates, Models & providers, and MCP servers require `piSettings`.

`GlobalSettingsModal.vue` groups categories by owner, fixes the scope label, and uses a selector on narrow layouts. It makes the app root inert, contains keyboard focus, handles Escape, and restores focus on close. Initial focus goes to the dialog container without a visible category highlight.

Electron's `CommandOrControl+,` command opens global Settings idempotently. Command+Shift+E toggles Session details, not global Settings. It does nothing on Home or while blocking overlays are open.

### Network access

`NetworkAccessSettings.vue` mounts lazily inside Connections. It loads native-backend state on mount and window focus through `src/lib/leyline-api.js`. The switch sends only `{ enabled }`. **Proxy port → Apply** sends only `{ port }`, with a blank field represented as `0`. The backend resolves omitted values inside its serialized operation, preserving concurrent changes from other clients.

The controls wait for the live response before changing saved state. The port draft survives focus refreshes and switch changes. Failed requests retain the previous saved state and the draft, and show an error.

The component shows actual sharing URLs and the unauthenticated full-access warning. It warns separately when startup configuration exposes the origin. The toggle does not reload the window or change the selected backend, composer drafts, or runtime subscriptions. The current window's saved remote selection never redirects this native setting.

### Agent defaults and overrides

`AgentSettings.vue` replaces the former Subagents and Vision configuration drawers. The containing surface fixes `scope`: global in Agent defaults, project in Project settings, and session in Session details. There is no scope picker inside global Settings.

`App.vue` loads settings against an explicit cwd and optional session path. Request generations and backend/scope/target keys reject stale results. Mutations use the loaded target and require its displayed scope. Session overrides require a saved session context and copy to forks.

The component resolves values from the displayed scope toward broader scopes. A global or project editor must not display a narrower session override as its effective value. Subagent models fall back to the agent definition. Vision model and thinking inherit independently. The vision picker contains only image-capable models.

Batch size appears under **Subagents** only in Agent defaults and Session details. Project settings retains model controls without batch size. `AgentSettings.vue` displays `batching.global` in global scope and `batching.effective` in session scope. A field change emits `save-batch-size`. **Use global default** sends a null session value through `PUT /api/pi/subagents/batching`.

`App.vue` saves against the loaded target and rejects stale responses through the existing generation and target guards. Successful saves replace the subagent configuration, including `batching`. Batch changes do not reload the runtime. The extension reads the size for each future group or parallel call.

These overrides use the existing subagent and vision APIs and Leyline SQLite. They are separate from pi `models.json` overrides. See [Settings surfaces and ownership](./architecture#settings-surfaces-and-ownership).

`SessionTitleSettings.vue` mounts only in global Agent defaults. It uses `src/lib/pi-api.js` for the selected backend's title settings and `SettingsSelect.vue` for model and thinking choices. Titles default to off, with no model selected. Enabling requires an explicit title model. Thinking defaults to that model's lowest supported level. Saving does not change the conversation model or thinking. There are no project/session title overrides. See [Session-title settings](../reference/api#session-title-settings).

### Certificate settings

`TlsTrustSettings.vue` keeps a draft file list, system-store preference, and saved baseline for the selected backend. It loads and saves through `src/lib/pi-api.js`. `App.vue` keys the component by connection ID and URL so another backend gets a new draft.

A typed path joins the file list only after **Add file**. Save stays disabled until the path is added or cancelled. Navigation and window-close guards also include typed paths. A successful save replaces the baseline with the backend response. See [Certificate settings](../reference/api#certificate-settings) for the API contract.

### Runtime cleanup

`RuntimeSettings.vue` owns the selected backend's idle-timeout draft and saved baseline. It accepts integers from 0 through 1440, defaults to 5, and uses 0 to disable cleanup. Save uses `src/lib/pi-api.js`. Navigation and window-close guards protect unsaved or pending changes.

The component does not dispose sessions itself. The backend protects active work, queued tasks, pending approvals, and sessions observed by matching runtime WebSockets. `runtime_removed` removes live status, not saved history. Reopening activates fresh connections. See [Idle runtime cleanup](./backend-api#idle-runtime-cleanup).

### Provider and MCP workspaces

`ProviderSettings.vue` and `McpSettings.vue` use `PiSettingsWorkspace.vue` for searchable lists and detail panes. Lists and details scroll independently inside the stable modal frame. Notices have a bounded area. Narrow layouts use a selector instead of the list.

`App.vue` captures the provider target when Settings opens. Components own local drafts, inventory revisions, selected entries, and operation state. Generation and backend guards reject late responses. Leave guards cover unsaved drafts, pending operations, and non-cancellable saves.

`src/lib/pi-settings-api.js` sends Settings requests to the selected backend with caching disabled. `useSettingsOperation.js` retains the starting backend URL, polls every 500 ms, and retries most polling errors after two seconds. It sequences answers and poll responses, and cancels owned work during cleanup. A late action response after navigation also receives cancellation.

`PiSettingsOperation.vue` displays private prompts and controlled progress messages. It clears submitted values and uses password inputs for secret and manual-code prompts. Operations never use the shared runtime WebSocket or extension-confirmation cards. See [Settings operations](../reference/api#settings-operations) for exact shapes.

`ProviderSettings.vue` offers **Test connection** per saved model and beside **Save** in provider and model editors. Editor tests send unsaved form values and the inventory revision without saving configuration or changing live runtimes or transcripts. The provider editor has a separate test-only model ID that is never saved. API keys stay optional, and removing a key reference does not sign out a stored credential.

Model Add/Edit hides the provider list and redundant headings within the existing modal. **Model**, **Thinking & compatibility**, and **Pricing** use one draft and a bounded body. **Save**, **Test connection**, and bounded test feedback stay in the fixed footer. Native validity checks and JavaScript field errors reveal the correct section and focus its field before Save or Test proceeds.

**Find in catalog** replaces the editor body. Search and the **Back to editor**/**Copy into draft** footer stay fixed. Results and review scroll independently. Narrow layouts use a catalog-match selector instead of stacking results above review. `catalogGeneration` rejects stale results, and returning to the editor preserves draft values. Escape returns from lookup before another Escape can cancel the draft.

Catalog import offers separate **Model details**, **Thinking level map**, and **Developer role** groups. Model details is selected by default when valid fields exist. It copies name, supported input, token limits, and reasoning support, skipping missing or invalid detail fields. New custom models also receive the exact catalog ID, including provider prefixes, as an editable value. Existing model IDs and override IDs remain unchanged. Copy never changes costs, endpoint, API format, credentials, or other compatibility fields.

Copy opens **Model** when Model details is selected and has fields to copy. Otherwise, it opens **Thinking & compatibility**. The thinking map has seven levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. **Provider default** omits a key, **Unsupported** sets `null`, and **Send value** sets a string. Developer-role choices map to a boolean or a `null` reset. See [Model definitions and overrides](../reference/api#model-definitions-and-overrides) for write semantics.

Draft progress, results, errors, and the operation's **Cancel** control appear inside `.pi-settings-draft-actions` beside **Save** and **Test connection**. The model editor uses its fixed footer without scroll adjustment. Provider-form state changes use `scrollIntoView({ block: 'nearest' })` only when that group already intersects the detail viewport. This does not jump to the form's top or pull the user back after they scroll away. Saved-provider authentication and non-draft operations keep their separate placement above the form.

Changing draft values or the test-only model ID clears the previous test result. Operation ownership ties feedback to the current draft, provider, and request generation. Navigation and backend changes clear owned operations, while server revision checks reject draft tests against changed configuration. Test completion does not emit a settings-change event or request a runtime reload. A failed test does not block saving or model selection. See [Provider connection tests](./backend-api#provider-connection-tests) for probe limits, refused APIs, and shared OAuth-token refresh.

Provider Refresh sends `refresh=1` to `/settings/providers`, which reloads settings extension registrations. Catalog refresh is a separate provider action. Editor lookup uses `/settings/catalog/models` with the captured target and query. Ordinary search uses the backend runtime cache. Lookup **Refresh** sends `refresh=1` to request a fresh settings runtime and network catalog refresh. Lookup displays any warning when the backend falls back to cached results.

On Home, provider changes trigger `/state` with an explicit cwd and `refresh=1`. Same-project previews retain valid explicit model/thinking choices and recheck eligibility for the exact staged service tier. Request identity and cwd checks reject stale previews.

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

When the backend reports `reviewWatch`, `ReviewPane.vue` opens `/api/pi/review/events?cwd=...` through `openEventSocket()` only after Git status reports `available`. Non-Git directories receive no watcher. `review_ready` and `review_change` events queue status refreshes that preserve selection. The server sends `review_ready` after watcher setup, so socket open does not trigger a refresh. While the pane is closed, changes mark the diff for refresh without rebuilding its preview. The socket closes when the repository becomes unavailable, its cwd changes, or the component unmounts.

A settled runtime event for the selected project and a completed composer shell command still increment the review refresh token. These triggers and the manual refresh control remain available when filesystem watching is unavailable.

Expanded review hides the transcript and uses the full workspace after the sidebar. Collapse restores the saved review width.

## Tool expansion and previews

`useToolExpansion.js` stores tool and skill expansion state, clipboard fallback state, and the selected fullscreen tool. System rows instead open `SystemPromptInspector.vue`. `App.vue` owns the selected event and follows its live-to-persisted handoff without resetting inspector tabs or raw view. See [System messages](./transcript-projection#system-messages).

Expansion state resets when the selected session changes. Preview content remains part of the projected transcript entry.

## Subagent inspector state

`App.vue` owns `subagentSelection`, the opener, and the modal focus scope. It resolves the selected call across persisted and live Activity projections by `toolCallId`, with `id` as the fallback. The component key stays stable during live updates and saved-entry reconciliation, preserving task selection and reader position.

`SubagentInspector.vue` separates the requested task (`selectedIndex` and `requestedView`) from the displayed task (`presentation`). The child observer changes immediately, but the outgoing reader stays visible until the target preview is ready. A post-render watcher combines pending display snapshots into at most one commit per animation frame. Runtime event handling remains separate and does not wait for this display commit.

The header agent label and the Model and Thinking chips derive from the displayed task. Chips prefer the child's live effective model and thinking level, then the recorded result, then the requested tool-call values. The display snapshot carries model and thinking with the task, so the chips change together with the agent label.

Task changes restore each task's following state and ledger position. A new ledger starts at its latest entry. Full-entry readers start at a saved position or at the top. Reader and footer transitions share fixed grid layers. Outgoing content is inert and hidden from assistive technology.

`singleSubagentEntry()` bypasses Activity expansion when the group's only top-level tool call is `subagent`. Both its header and compact row open the inspector directly, including calls with parallel tasks. Multi-call groups still expand before individual subagent rows open the inspector. `useToolExpansion.js` does not own subagent inspector selection.

`useSubagentPreview.js` reads only the selected child, including saved children, through `fetchSessionDetail()` with `toolArguments: true` on the selected backend. While the child runs, it also uses a separate child-scoped runtime WebSocket. Its `useLiveTurnProjection.js` instance opts into tool arguments without changing the main transcript's default projection. Observation never activates the child or changes the parent selection. Task changes and unmount close the observer and cancel its outstanding reads. Completion or runtime removal closes the child socket and refreshes the saved activity.

Detail reads run one at a time, with the next refresh queued behind the current request. Response epochs reject reads from before reconnect or settlement. Recovery reconciles finished messages before resetting the projection, retains rendered-ID aliases, and replays events received after socket open. Snapshots alone cannot restore in-flight assistant content.

`useSubagentPreview.js` caches up to four child previews within the inspector, with a combined serialized-size estimate of 4 MiB. Each preview stores a saved baseline, message/tool identities, and up to 128 native runtime frames. Returning to a cached child restores the shared live projection before exposing new updates. A failed detail read leaves that projection available. Reconciliation removes saved assistant frames from the replay buffer to prevent duplicate answers on a later return. Unmount clears the cache.

A changed branch or an assistant message after the cached anchor causes a rebase. This removes stale streaming content when the child completed a response while another task was selected.

`lib/subagent-ledger.js` projects the displayed entries into flat rows. Its optional current-rows cache reuses unchanged previews and row objects, and removes entries outside the displayed set. Stable message aliases, tool-call IDs, and result keys preserve row identity through live-to-persisted updates and late saved results.

`SubagentInspector.vue` owns the full-entry reader, format, last-read marker, and scroll positions per task, entry, and format. **Back to activity** restores the ledger position. An open reader retains its entry if that entry leaves the preview tail. Scrolling up pauses following. **New output** and **Jump to latest** return to the tail. Live updates preserve task selection and manual scrollback.

Task details and the latest-activity summary have bounded scroll containers that preserve space for the ledger. The reader keeps **Back to activity** outside `.subagent-entry-sections`, so it stays visible while the sections scroll. The `body` ref remains on the ledger or full-entry content for scroll tracking and restoration.

`useModalFocus()` contains focus and restores the opener on close. Opening the subagent inspector pauses transcript auto-follow.

Both the component and global Escape handlers call `dismissReader()` before closing the inspector. Escape returns from an entry reader to the ledger. From the ledger, Escape closes the inspector. The close button, backdrop, session or backend changes, selected-call removal, and new pending extension confirmations also close it. An existing pending confirmation prevents it from opening.

This state is separate from the System prompt inspector and trace Inspector. See [Tool Activity and subagent inspector](./transcript-projection#tool-activity-and-subagent-inspector) for renderer boundaries.

## Workbench scrolling

`useWorkbenchScroll.js` observes the composer height and reserves matching workbench space. It tracks whether the user remains near the bottom.

Live output follows the bottom only when bottom sticking is active. Otherwise, the composable sets `hasNewOutput` for Jump to latest.

A selected-session change resets scroll state. The terminal height and composer height also change the reserved layout space.

## Drawer coordination

`App.vue` coordinates global Settings, Project settings, Session details, Memory, research sources, and sidebar navigators. Opening global Settings closes contextual drawers and conflicting overlays. Opening a navigator closes conflicting drawers and configuration surfaces. Subagent and vision controls belong to the fixed-scope settings surfaces, not separate drawers.

Git review and research sources use the desktop third rail. The prompt inspector overlays the workbench. Opening one closes the others.

Trace surfaces also close conflicting inspectors, drawers, previews, and settings surfaces. Inspector overlays the right side. Workspace and Explorer cover the workbench after the sidebar. Mobile traces fill the width below the header. Closing Workspace returns to its originating trace surface.

The terminal is independent and can remain open below the workbench. Session changes reconnect it so the PTY uses the selected session CWD.

## Cleanup

`App.vue` and its components close runtime, review, and terminal WebSockets, timers, observers, and composable resources during unmount.

Keep external listeners and timers in their owning composable where possible. Let `App.vue` own only cross-feature coordination.
