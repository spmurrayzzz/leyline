# Architecture

The Vue UI calls `src/lib/pi-api.js`. During browser development, Vite routes `/api/pi/*` to `server/pi-api.js`. The backend uses pi SDK runtime and session primitives, streams runtime events through SSE, and backs the terminal with a WebSocket PTY.

`useSessionWorkspace.js` owns session list, selected transcript detail, runtime activation, and session operations. Runtime handles are kept in a session-id keyed map so background sessions can continue.

Scoped session routes are preferred over legacy active-session routes. The browser dev path and Electron production path should both keep working. Use SDK/runtime primitives rather than manually appending session files, and keep transcript projection shared between the UI and export.
