# Tools and thinking

Assistant text is rendered as markdown with raw HTML disabled. Thinking and model rows show reasoning traces and model context where available.

Tool rows are collapsed by default and can be expanded. Labels are matched to assistant `toolCall` blocks where possible, with path and command chips for reads, writes, edits, and bash calls. Skill prompt payloads render as compact rows that can unfurl.

Live tool rows reconcile with persisted transcript entries when the session detail refreshes.

## Rollout Feedback

To help evaluate and improve assistant performance, you can rate and add notes to assistant turns directly within the transcript.

- **Ratings (Helpful / Unhelpful)**: Hover over any assistant message block to reveal the feedback thumbs. Click the thumb up (helpful) or thumb down (unhelpful) icon to mark your rating.
- **Feedback Notes**: After marking a rating, a "+ note" button will appear next to the thumbs. Click it to open an optional text box where you can add detailed comments, context, or feedback on that specific response.
- **Storage**: Unlike session logs (which live in your project's `pi` session directories), all rollout ratings and written notes are saved locally to Leyline's app data directory, ensuring they persist independently of your session's file lifecycle.

