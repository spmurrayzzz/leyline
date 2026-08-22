# Deep research integration

Leyline implements deep research as a normal pi session with persisted research state. The parent transcript remains the main record of the run.

## Create and bind a research session

`POST /api/pi/sessions` accepts `kind: "research"`. The backend creates a normal pi session and appends a session-ID-bound `leyline-research` marker.

The backend writes the marker before it binds the bundled research extension. This order lets the extension detect the session during `session_start`.

`.pi/extensions/research/index.ts` registers `research_update` only after it finds a valid marker for the current session ID. Normal sessions do not expose this tool.

The backend advertises this feature through `capabilities.research` in `GET /api/pi/info`.

## Lead protocol

The research extension adds a lead protocol before each research turn. The protocol tells the model to:

1. Create two to five independent threads.
2. Persist the plan before delegation.
3. Run the reserved `researcher` agent in parallel mode.
4. Register structured source evidence.
5. Mark the synthesis and report phases.
6. Write numeric Markdown citations that match the source ledger.
7. Write the report immediately after the report checkpoint.

The protocol starts automatically. It does not require plan approval unless the user requests a pause.

The protocol is a model instruction. Leyline cannot guarantee plan quality, source quality, or complete claim coverage.

## Research workers

The bundled subagent extension reserves the `researcher` name for deep research. Project and global agent files cannot replace this definition.

A researcher inherits the parent model and thinking level by default. An explicit model or thinking value on the subagent task takes priority.

Research workers use a strict read and search allowlist. Built-in access is limited to `read`, `grep`, `find`, and `ls`.

Selected external web and memory search tools can also run when they are available. Project-scoped external tools, shell tools, and write tools are excluded.

Each worker returns a bounded `<research_result>` block. The block contains its thread ID, summary, and sources that it read.

Parallel execution runs up to four workers at one time. Additional tasks wait for a later batch.

## Persisted state

`lib/research-state.js` folds `leyline-research` custom entries from the active branch. Each event includes the research session ID.

| Event kind | Persisted data |
| --- | --- |
| `session` | Research marker and creation time |
| `objective` | User research objective |
| `plan` | Strategy and planned threads |
| `phase` | Current phase, note, report title, and intended source IDs |
| `thread` | Thread status, summary, source IDs, and child-session link |
| `source` | Canonical source, evidence, status, threads, and exclusion reason |
| `report` | Valid report entry, title, and cited source IDs |
| `error` | Research failure or incomplete report reason |

Session summaries contain compact phase and count data. Active runtime and session detail DTOs contain the complete state.

Session scans rebuild research state from the active JSONL tree. A refresh or runtime reload does not need a separate database record.

## Source registration and citation checks

A source requires an HTTP or HTTPS URL, or a nonempty path. The ledger deduplicates sources by canonical URL or by the path after it removes a leading `./`.

The backend does not verify that a source path stays inside the project. Do not register a private path that must not appear in the transcript or export.

One structured worker result can return up to 20 sources. A research session can retain up to 60 unique sources through automatic registration.

`lib/research-citations.js` checks numeric Markdown links in the final response. A citation is valid when:

- Its number identifies a ledger source.
- Its URL or path matches that source.
- The source is not excluded.

URL matching uses standard `URL` parsing. It then removes fragments and one trailing slash. Query strings remain significant.

When usable sources exist, the report must contain at least one valid ledger citation. Any invalid numeric citation records a research error.

The check verifies ledger identity only. It does not verify that the cited evidence supports a claim.

## Branches, forks, and resets

Research state is branch-local. `researchStateFromEntries()` ignores events from other session IDs and folds only the supplied branch.

A fork gets a new session ID. The backend replays the retained research state as new events that bind to the fork ID.

The fork process revalidates a retained report before it writes a completed report event. Invalid citations produce an error event instead.

Reset to here reconstructs state from the retained branch. If a valid report remains after its report checkpoint, the backend restores its report event.

Persisted state survives a process restart. In-flight worker calls do not restart automatically.

## Browser projection and export

`server/pi-api/dtos.js` supplies research state to transcript projection. `lib/transcript-projection.js` identifies reserved researcher results and marks the final report entry.

The browser renders:

- A Plan, Gather, Synthesize, and Report phase bar.
- A compact Research threads card with child-session links.
- A report artifact with validated citation targets.
- A source rail with a primary cited view and a complete research ledger.
- An anchored citation preview with claim and evidence details.

Research state also travels in `active_session` snapshots. This state updates progress, counts, and sidebar status during the run.

HTML export renders the report artifact, research-thread results, and every ledger source. Each source shows one evidence summary. An exclusion reason takes priority over evidence and claim text.

See [Deep research](../user-guide/deep-research) for the user workflow and [API reference](../reference/api) for DTO and session-creation contracts.
