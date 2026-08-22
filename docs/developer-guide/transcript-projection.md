# Transcript projection

Transcript projection converts the current pi branch into entries that the browser and HTML export can render.

## Shared projection

The shared implementation is `lib/transcript-projection.js`. Browser code imports it through `src/lib/transcript.js`. Backend DTO and export code import it directly.

The projection performs these operations:

- Extract text, image, and thinking blocks.
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

`src/lib/transcript.js` configures `markdown-it` with raw HTML disabled. It also exports projection helpers for Vue components.

`TranscriptEntry.vue` renders persisted messages, thoughts, tools, skills, subagents, research threads, report artifacts, feedback, and previews. `useLiveTurnProjection.js` supplies separate live rows while a turn runs.

A valid report citation emits a source-open event only when its numeric label and target match the report's projected ledger source.

The live controller matches new persisted entries to visible live rows. It removes duplicate persisted rows until the handoff settles.

## Syntax highlighting

Leyline imports pi's bundled `highlight.min.js` source as a Vite raw asset. The bundle declares a local `hljs` variable.

`src/lib/transcript.js` evaluates that trusted bundled source with `new Function()` and returns the declared value. It does not load syntax code from a network URL.

The Markdown renderer uses explicit language aliases first. It uses automatic detection when a code fence has no language.

Syntax colors live in `src/styles/tokens.css`. Highlight rules live in `src/styles/transcript.css`.

## Preview rendering

`PierrePreview.vue` uses `@pierre/diffs` for file, diff, and patch data. Inline file previews show at most 400 lines.

Fullscreen previews use the complete projected data. Image previews use session data URLs.

HTML export contains its own preview renderer. The current export module loads `@pierre/diffs` from `esm.sh` when the HTML runs.

## Keep app and export output aligned

The app transcript uses these files:

- `src/styles/transcript.css`
- `src/styles/tools.css`
- `src/styles/tokens.css`

The export renderer and export CSS live in `server/pi-api/export-renderer.js`.

Compare both renderers when you change messages, thoughts, tools, skills, subagents, research artifacts, Markdown, syntax colors, or previews. The standalone export header can remain different from the app shell.
