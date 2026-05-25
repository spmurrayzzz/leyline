# Transcript projection

Transcript projection turns pi session entries from the current branch into UI-ready transcript entries.

Shared projection lives in `src/lib/transcript-projection.js`. It matches tool results to assistant `toolCall` blocks, renders markdown with raw HTML disabled, and supports export. In-app transcript styles in `src/style.css` and export styles in `server/pi-api.js` should stay visually in sync for message, tool, and thinking output.
