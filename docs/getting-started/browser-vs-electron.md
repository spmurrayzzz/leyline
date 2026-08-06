# Browser vs Electron

The browser and Vite workflow is the primary development workflow. Electron is
an optional desktop shell around the same Vue app and API.

| Area | Browser and Vite | Electron |
| --- | --- | --- |
| App files | Vite dev server | Vite dev server or packaged `dist/` files |
| API | `server/pi-api/index.js` as Vite middleware | `server/leyline-server.js` with `server/pi-api/` |
| Environment | Inherits the environment that starts Vite | Loads the macOS login-shell environment |
| Terminal | WebSocket connection to the local PTY | Same local PTY backend |
| Windows | Browser-managed | Multiple native windows with saved state |
| Dictation | Available when the browser supports the Web Speech API | Not supported |

Use the browser for normal development and visual changes. Use Electron to test
packaging, desktop shortcuts, shell environment loading, multiple windows, and
saved window state.

The packaged Electron app starts one local server. All Leyline windows in that
app process use that server.
