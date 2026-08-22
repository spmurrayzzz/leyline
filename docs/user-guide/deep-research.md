# Deep research

Deep research turns one question into a source-backed report. A lead agent plans the work, runs bounded research threads, and synthesizes their evidence.

![Completed deep research session with phase progress, a cited report, and the source ledger](../assets/screenshots/deep-research.png)

*The report stays in the transcript while the source ledger keeps cited, supporting, and excluded evidence visible.*

## Start a research session

1. Open the start screen and select a project.
2. Select **research** below the composer.
3. Enter the question that Leyline must investigate.
4. Press **Enter** or select **Send message**.

The heading changes to **What should we investigate?** when research mode is active. The research control appears only when the selected backend supports research sessions.

Leyline creates a new research session and starts the run immediately. The lead records a short plan before it delegates work. It does not wait for plan approval unless you ask it to pause.

The sidebar **New session** action creates a normal session. Shell mode also creates a normal session.

## Follow the research phases

The phase bar shows four steps:

- **Plan**: The lead divides the question into independent threads.
- **Gather**: Research workers collect and assess source evidence.
- **Synthesize**: The lead compares the thread results and builds the citation ledger.
- **Report**: The lead writes the final cited report.

A research plan normally contains two to five threads. The **Research threads** card shows each thread ID, title, source count, and status.

Select a thread row to open its child session. The child transcript contains the worker's tool calls, source work, and final result.

The sidebar marks each research session with a flask. During a run, the row can show its current phase or **gather N/N**. A selected completed session shows **ready**.

## Direct an active run

Enter a message and press **Enter** to steer the lead. The lead receives steering at its next accepted checkpoint.

Press **Option+Enter** to queue a follow-up after the active run. Select **Stop generation** to interrupt the parent run.

A stopped or failed run keeps its persisted plan, threads, and sources. Send another prompt when you want the lead to continue.

## Use the source ledger

The desktop source pane opens when a research session has sources. Use the source control in the header to close or reopen it.

The ledger has these filters:

- **All** shows every source.
- **Cited** shows sources that the final report cites.
- **Supporting** shows retained sources that the report does not cite.
- **Excluded** shows rejected sources and their exclusion reasons.

Select a source card to read its claim, evidence, thread IDs, and exclusion reason. Web sources include **Open source**. Local sources show their path.

A numbered report citation opens the matching ledger source. Leyline resets the filter, selects the source, and moves it into view.

A valid citation uses a numeric Markdown link such as `[3](https://example.com/source)`. The number and target must match a non-excluded ledger source.

Leyline checks citation identity. It does not determine whether the source proves the report's claim.

## Use sources on mobile

![Full-width research source ledger on mobile](../assets/screenshots/deep-research-mobile.png)

*The mobile source control opens the same ledger as a full-width overlay.*

Select the source control in the mobile header. Select **×** to return to the report.

The filters, evidence, and external source links work the same as on desktop.

## Read and revise the report

A valid final response becomes a **research artifact** in the transcript. Its heading shows the report title and source counts.

If a numeric citation is invalid, Leyline marks the research session as interrupted. The response remains in the transcript, but it does not become a completed research artifact.

Use the composer to ask a follow-up question or request a report revision. The lead receives the persisted research state with the next turn.

Research sessions support normal prompt edits, forks, resets, and refreshes. Forks keep branch research state and bind it to the new session. Resets rebuild state from the retained branch.

A backend process restart does not restart interrupted worker calls. Reopen the session and send a prompt to continue.

## Export the research

**Export transcript** writes the report, research-thread cards, and every ledger source to the HTML file. It keeps cited, supporting, and excluded sources.

Exported citations are normal links. The standalone file does not focus a ledger card when you select a citation.
