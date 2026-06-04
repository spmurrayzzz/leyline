# Architecture

The Vue UI calls `src/lib/pi-api.js`. During browser development, Vite routes `/api/pi/*` to `server/pi-api.js`. The backend uses pi SDK runtime and session primitives, streams runtime events through SSE, and backs the terminal with a WebSocket PTY.

`useSessionWorkspace.js` owns session list, selected transcript detail, runtime activation, and session operations. Runtime handles are kept in a session-id keyed map so background sessions can continue.

Scoped session routes are preferred over legacy active-session routes. The browser dev path and Electron production path should both keep working. Use SDK/runtime primitives rather than manually appending session files, and keep transcript projection shared between the UI and export.

## Persistent App Metadata (SQLite)

In addition to pi's JSONL session logs (which live in project working directories), Leyline maintains local persistent application metadata such as rollout feedback. 

- **Database**: Saved in a local SQLite file at `~/.local/share/leyline/memory.sqlite`.
- **Implementation**: Managed using Node.js's built-in `node:sqlite` module via the synchronous `DatabaseSync` API.
- **Rollout Feedback Schema**:
  - Table: `rollout_feedback`
  - Columns: `cwd` (text), `session_path` (text), `session_id` (text), `entry_id` (text), `label` (text, check: helpful/unhelpful), `feedback_text` (text), `updated_at` (integer timestamp).
  - Primary Key: Composite key of `(cwd, session_path, session_id, entry_id)`.

