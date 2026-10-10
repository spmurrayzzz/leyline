# Transcript projection

Transcript projection converts the current pi branch into entries that the browser and HTML export can render.

## Shared projection

The shared implementation is `lib/transcript-projection.js`. Browser code imports it through `src/lib/transcript.js`. Backend DTO and export code import it directly.

The projection performs these operations:

- Extract text, image, and thinking blocks.
- Project system-role prompt sections and tool changes for System dividers and the prompt inspector.
- Coalesce native model-selection records into net-change dividers.
- Pair each tool result with its assistant `toolCall` block.
- Create tool labels and targets.
- Detect skill prompt rows.
- Parse subagent results and child-session links.
- Detect research-thread results and annotate the final research report.
- Map validated report citations to canonical source-ledger entries.
- Create image, file, diff, and patch preview data.
- Create copy text for messages and tools.

Keep facts in the shared projection when both the app and export need them. Do not parse the same tool result separately in each renderer.

## Backend detail DTO

`server/pi-api/dtos.js` reads the active branch from `SessionManager`. It passes the branch and folded research state to the shared projection.

The backend then adds rollout feedback to the projected entries. `GET /api/pi/sessions/:id` returns these entries in `SessionDetail`.

Persisted runtime event entries can exist in a detail response. The current live-turn view filters `event` entries from the transcript.

## Browser rendering

`src/lib/transcript.js` configures `markdown-it` with raw HTML disabled. Fullscreen Markdown previews block automatic image requests. Web links open in a new tab. Local and relative file links open current-file previews on the selected backend. The module also exports projection helpers for Vue components.

`TranscriptEntry.vue` renders persisted messages, System dividers, thoughts, tools, skills, subagents, research threads, report artifacts, feedback, and previews. `useLiveTurnProjection.js` supplies separate live rows while a turn runs.

A valid report citation emits a source-open event only when its numeric label and target match the report's projected ledger source.

The live controller matches new persisted entries to visible live rows. It removes duplicate persisted rows until the handoff settles.

## Model changes

`projectModelChanges()` reads native `model_change` records from the active branch. It does not infer selections from assistant response metadata, which can name a physical model behind a virtual selection.

Repeated selections between non-System conversation messages produce one `model-change` entry. The entry retains the first change ID and the latest native `selectionId`. Returning to the original provider/model removes the divider. Initial setup remains hidden. System messages and other metadata do not split a group.

Catalog names replace IDs when available. A provider change adds provider names to distinguish the selections. The browser, saved history, and HTML export use this projection without changing raw session records.

## System messages

Pi persists `role: "system"` messages for prompt and tool declarations. The first request records the full prompt and initial tools. Later messages record changes.

`systemMessageEntry()` projects each message as `type: 'system'` with the label **System**. It normalizes these fields:

- `sections`: Entries with `name`, `text`, and `removed`. A `null` source value sets `removed` to true.
- `toolsAdded`: Tool names and descriptions.
- `toolsRemoved`: Removed tool names.
- `text`: Readable copy text for the recorded changes.

A `preamble` update produces a `full prompt` summary. Other summaries identify section and tool deltas. Older sessions can have no system messages.

`lib/system-prompt.js` supplies shared section titles and display metadata. A nonremoved `preamble` selects **System prompt**, **Prompt**, and the initial-declaration treatment. Other events use **System updated** and **Changes**. These display labels are separate from the projected `label` and `code` fields.

`TranscriptEntry.vue` renders a muted, centered divider with document and panel icons. Its `open-system-prompt` event passes the entry and opener to `App.vue`. System rows do not use tool expansion controls.

`SystemPromptInspector.vue` renders prompt sections and tool descriptions as Markdown in **Prompt**/**Changes** and **Tools** tabs. Removed sections and tools retain their names and removal labels. An event with only tool changes opens **Tools**. Later entries show only that event's changes, not a reconstructed full prompt.

**Raw text** displays `entry.text` exactly. **Copy** uses the same text in either view. This projected text combines string content and readable change descriptions. It is not the original JSONL record.

Saved entries expose **Fork from here** and **Reset to here** in a secondary menu. Fork, reset, or compaction activity disables both actions. An active run also disables reset. Live entries do not expose these actions until they match a persisted entry.

`App.vue` owns inspector selection, opener focus restoration, and exclusion with Review and Sources. The inspector closes on session or backend changes, or when its entry leaves the selected branch. Wide layouts reserve transcript space. Narrow layouts overlay the right side. Mobile layouts fill the width below the header and make the main pane inert.

HTML export renders the same divider and inspector content through `renderExportSystem()`. Its `<details>` element controls the inspector, not an inline tool card. The embedded `systemInspectorJs()` handles tabs, raw view, exact copy, close, and keyboard controls independently of the external Pierre module. Exports omit fork and reset actions.

## Live reconciliation and settlement

`useLiveTurnProjection.js` keeps live System rows beside user, assistant, and tool rows in sequence order. System `message_start` and `message_end` events use the shared projection.

A reactive `liveTurnAnchorLength` limits the persisted list during a turn. Covered persisted entries stay hidden while their live counterparts remain visible.

Settlement waits for System rows to match persisted entries, as well as user, assistant, tool, and activity state. It then releases the anchor.

When the next turn starts, `clearSettledLiveItems()` removes the previous turn's matched rows from live state. Those rows return to the persisted list in branch order. This prevents older live rows from appearing below newer system deltas.

`reconcileLiveSystems()` attaches each matching persisted entry as `persistedEntry`. Matching uses entry IDs, then `messageTimestamp` plus text, or nearby timestamps plus text when message timestamps are unavailable.

`App.vue` watches session detail and live rows to replace the selected live entry with its `persistedEntry`. The inspector selection key stays unchanged during this handoff, so its tab and raw-view state survive. When settled live rows disappear, selection follows the persisted ID in session detail. `useToolExpansion.js` does not control inspector selection.

## Syntax highlighting

Leyline imports pi's bundled `highlight.min.js` source as a Vite raw asset. The bundle declares a local `hljs` variable.

`src/lib/transcript.js` evaluates that trusted bundled source with `new Function()` and returns the declared value. It does not load syntax code from a network URL.

The Markdown renderer uses explicit language aliases first. It uses automatic detection when a code fence has no language.

Syntax colors live in `src/styles/tokens.css`. Highlight rules live in `src/styles/transcript.css`.

## Preview rendering

`PierrePreview.vue` uses `@pierre/diffs` for file, diff, and patch data. Inline file previews show at most 400 lines.

Fullscreen previews use the complete projected data. Markdown reads open as rendered content. Users can switch to the Pierre source view. Image previews use session data URLs.

HTML export contains its own preview renderer. The current export module loads `@pierre/diffs` from `esm.sh` when the HTML runs.

## Keep app and export output aligned

The app transcript uses these files:

- `src/styles/transcript.css`
- `src/styles/tools.css`
- `src/styles/tokens.css`

The export renderer and export CSS live in `server/pi-api/export-renderer.js`.

Compare both renderers when you change messages, System dividers or inspectors, thoughts, tools, skills, subagents, research artifacts, Markdown, syntax colors, or previews. The standalone export header can remain different from the app shell.
