# Elune integration

Leyline embeds Elune to capture pi runs and inspect their model calls, tools, usage, and timing. Capture runs independently of open trace views. See [Tracing](../user-guide/tracing) for the user workflow and [Trace routes](../reference/api#trace-routes) for the HTTP contract.

## Independent library

Elune remains an independent project. Leyline depends on `@elune/embedded` through the bare GitHub dependency `spmurrayzzz/elune` in `package.json`. Installation requires neither npm registry publication nor a sibling Elune checkout.

The package provides four entry points:

| Import | Responsibility |
| --- | --- |
| `@elune/embedded` | `createElune()`, bounded writes and reads, and a lazy Node.js SQLite worker |
| `@elune/embedded/pi` | `createPiTracingExtension()`, pi event capture, and usage accounting |
| `@elune/embedded/vue` | Optional `TraceInspector`, `TraceWorkspace`, and `TraceExplorer` components |
| `@elune/embedded/vue/style.css` | Explicit styles for the Vue components |

Vue is an optional peer dependency. The core does not require Vue, an HTTP server, or an external Elune service.

Leyline owns runtime binding, HTTP routes, configuration, database location, and backend selection. `server/pi-api/tracing.js` adapts the core and pi entry points. `tracing-routes.js` supplies the host API. The library does not select Leyline storage paths or create a separate service.

## Storage and configuration

Each backend owns one Elune store and one lazy storage worker. The worker starts on the first storage operation, rather than when a trace view loads its JavaScript.

The database path is `$LEYLINE_MEMORY_DIR/elune/elune.db`. Without that variable, it is `~/.local/share/leyline/elune/elune.db`. The worker uses SQLite WAL mode. It creates the Elune directory with private `0700` permissions and requires an existing directory to be private. Database, WAL, and shared-memory files use `0600` permissions.

Capture configuration stays in the existing `memory.sqlite` database, in `leyline_settings` under `tracing.enabled`. An absent value defaults to capture enabled. A configuration-read failure disables capture and produces a visible error. A failed save retains the previous value and reports that failure.

Display preferences and connection records still belong to the native app backend. Trace capture configuration and trace views belong to the selected backend. Explorer spans projects on that backend, not all saved connections.

Turning capture off applies to new runs. It does not interrupt an existing capture or delete stored traces. Opening an older session does not reconstruct its trace history. Leyline does not automatically import old standalone Elune records or pi JSONL history.

Leyline has no automatic retention limit or expiry. Session deletion, project trash, and **Reset to here** do not remove trace records. Leyline has no trace deletion or export control, and no trace deletion or export API. HTML transcript exports do not contain Elune trace data.

Leyline capture requires no `PI_TRACE_URL` or external service. The inline capture extension replaces a discovered legacy `pi-elune` extension in conversation runtimes. Conflict filtering identifies extension names through resource paths and package metadata. It applies during construction and explicit reload. It does not uninstall the external package or change standalone pi configuration. Restart the backend or reload an affected session to replace an already loaded extension set.

## Capture lifecycle

`runtime.js` adds the named inline factory `leyline-elune` when it constructs conversation runtimes. The diagnostic path is `<inline:leyline-elune>`. Normal sessions, research leads, research workers, subagents, and isolated vision children use this factory.

Home preview runtimes use `captureTracing: false`. Provider Settings runtimes and private connection probes do not install this capture factory. Isolated custom-prompt children retain only output-budget and inline capture. They omit project context, skills, MCP, tool search, and the Leyline prompt.

Capture combines extension hooks with a subscription to the bound `AgentSession`. This supplies provider identity, finalized messages and tool results, retries, settlement, and compaction events. The host binds replacement sessions and drains old captures during reload and disposal. Capture handlers return without waiting for storage, so a storage failure does not block pi execution.

Each run has an agent root, turn spans, model generations, and tool observations. Nested tool observations retain their parent tool linkage. Streaming updates use throttled snapshots and changed-row writes, rather than storing every token delta.

Retries remain part of the run until `agent_settled`. Recovery records can identify context omissions without deleting the captured failed observation. Trace metadata keeps session, branch, start, end, and user-entry anchors when available. Generation and tool metadata retain message and tool-result entry IDs. A transcript link can fail when its target is absent from the current branch.

Manual compaction can create a separate `pi-compaction` trace. Automatic compaction can remain within an active run. Compaction observations retain the summary, outcome, available usage, and compaction entry anchors. They become generations when usage is available. Missing usage is not a measured zero-cost model call.

## Usage and child accounting

Generation usage comes from completed pi messages. Input totals include ordinary input, cache reads, and cache writes. Cost uses the usage supplied by pi. Missing provider usage or pricing can make totals incomplete.

Tool observations retain their reported usage. Direct tool usage contributes to the trace total. Nested tool usage does not add again when its parent already represents that work. Metadata includes `usageKnown`, `usageIncluded`, and `includedUsage` to distinguish these cases.

Bundled subagent and vision requests carry the parent session ID and tool-call ID. The child marker records the available parent trace, observation, and entry anchors. Tool results link back to the child session.

When a child capture has committed complete usage, the parent excludes that usage from duplicate tool contributions. A proven child capture can finish after the parent tool result. The library retains bounded accounting state and updates the parent after the child commit. Unknown attribution carries `usageAttributionUnknown` instead of an assumed subtraction. Child reconciliation has a 15-second deadline and reports failures.

Trace totals describe their accounted contributions. Do not sum parent and child trace totals without checking their linkage and included usage.

## Content limits and privacy

Input and output fields have a 32 KiB clipping limit. Structured content also has limits on depth, nodes, keys, and metadata size. Markers such as `[truncated]` and `[omitted]` identify content that capture did not retain.

The library omits recognized credential keys, image payloads, and thinking or reasoning content. It does not provide complete secret redaction. Prompts, tool results, paths, and ordinary text can still contain private data or credentials. SQLite files are not encrypted by this integration.

The Input and Output tabs show retained trace content. They are not a promise of full raw provider requests or responses. Original image attachments and thinking content can remain in pi history even though trace capture omits them. See [Trace privacy](../user-guide/tracing#keep-trace-data-private) for retention and capture controls.

Read limits are separate from capture limits. List queries return summaries without input, output, or full metadata. Detail queries page observations and scores, with a maximum of 200 entries per requested collection. Response byte budgets can produce shorter pages.

Follow `pagination.observations.nextOffset` and `pagination.scores.nextOffset`. Do not infer the next offset from the requested limit. `readTruncation` identifies shortened fields or incomplete collections. The Vue surfaces retain only the loaded observation page. See [Trace routes](../reference/api#trace-routes) for exact signals.

## Bounded work and failures

The pi adapter keeps active observations, dirty rows, an outbox, and any pending child accounting. It releases finalized payloads after queueing their changed rows. It does not retain every finalized observation for the lifetime of a session.

Capture queues and the core pending content each have 16 MiB limits. The core permits 128 pending traces and 64 outstanding worker requests. It splits writes into bounded batches, with at most 512 changed observations per worker write. The worker has a 128 MiB old-generation limit.

Dirty rows remain pending until storage acknowledges them. Retryable capture failures get bounded retries with 100, 500, and 1,500 ms delays. Invalid or unresolved writes fail capture. A durability ledger prevents failed writes from silently becoming successful flushes.

Overload, timeouts, or storage failures can leave incomplete records. These limits do not guarantee zero data loss for unlimited runs. Capture fails open for pi. The backend logs the cause and publishes a controlled error through `trace_config`. Open trace views show capture and request errors, with retry controls where applicable.

The observation-count notice depends on the producer's `observationsTruncated` flag. Capture failures do not always set that flag or save a warning with the trace. The backend keeps its capture error in process memory, so that error can disappear after restart. The absence of a warning does not prove that a trace is complete.

## Realtime delivery

Storage commits publish small `trace_updated` notices containing `traceId`, `sessionId`, and `revision`. The host adds `activeSessionId`. Configuration changes and capture failures publish `trace_config` with `enabled` and optional `error`.

These notices reuse the runtime WebSocket at `/api/pi/events?sessionId=...`. They contain no full trace payload and open no additional connection. Backpressure coalesces notices by trace ID and configuration key. The client fetches the required summary or detail page after a notice. Reconnect marks open views for refresh because the event transport has no replay history.

`useRuntimeEvents.js` sends trace notices to dedicated subscribers. It excludes them from transcript projection. See [Realtime events](../developer-guide/realtime-events#trace-notices).

## Lazy Vue surfaces

`App.vue` loads `TracePanel.vue` asynchronously and mounts only one surface:

- A, Inspector: a session-scoped side overlay for quick checks.
- B, Workspace: a larger session view with timeline and detail.
- C, Explorer: a selected-backend view with cross-project filters and a selected preview.

`src/lib/trace-client.js` supplies an injected client bound to the selected connection. The optional library components do not hard-code Leyline URLs. `TracePanel.vue` adds the backend label, project filter, capture controls, and error notices.

The host retains small selection and return state: trace ID, observation ID, tab, observation offset and limit, list filters, and list page. Opening Workspace preserves selection. Back returns selection to Inspector or Explorer without discarding its list filters.

Closing traces unmounts the surface, aborts owned requests, and removes trace subscriptions. Closed views make no trace queries or render hidden trace trees. Document visibility pauses view requests and subscriptions. A natively hidden Electron window can still report the document as visible, so this check is not a general native-window suspension guarantee.

On narrow layouts, a hidden Explorer preview pauses detail requests. Hidden observation detail does not mount its detail renderer. Workspace and Explorer hide and make the workbench inert, and pause its scroll-following work. Capture continues throughout these view changes.

## Electron and shutdown

Packaged Electron runs the shared backend in a utility process through `electron/leyline-server-process.js`. The main process owns windows and supervises backend startup and exit. All native windows share that utility process.

Packaging unpacks `@elune/embedded` with native dependencies. `tracing.js` resolves the core import to `app.asar.unpacked`, so the core can start its worker from real files.

Shutdown first interrupts and disposes runtimes, then drains captures and closes the store. `server/shutdown-deadlines.js` gives runtime shutdown 15 seconds. Capture flush has a 5-second bound, store close has a 12-second bound, and worker requests have a 10-second deadline. Electron allows 35 seconds for backend exit before it kills the utility process.

A forced process exit can leave incomplete traces. These deadlines bound shutdown work rather than guarantee persistence after a crash. Backend or dependency changes require a restart. Packaged changes require a rebuild and app restart.
