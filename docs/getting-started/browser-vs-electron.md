# Browser vs Electron

The browser and Vite workflow is the primary development workflow. Electron is
an optional desktop shell around the same Vue app and API.

| Area | Browser and Vite | Electron |
| --- | --- | --- |
| App files | Vite dev server | Vite dev server or packaged `dist/` files |
| Native backend | `server/pi-api/index.js` as Vite middleware | Vite middleware or `server/leyline-server.js` in a packaged app |
| Environment | Inherits the environment that starts Vite | Loads the macOS login-shell environment |
| Terminal | WebSocket connection to the selected backend | WebSocket connection to the selected backend |
| Windows | Browser-managed | Multiple native windows with saved state |
| Dictation | Available when the browser supports the Web Speech API | Not supported |

Use the browser for normal development and visual changes. Use Electron to test
packaging, desktop shortcuts, shell environment loading, multiple windows, and
saved window state.

## Backend selection

The native backend is the server that supplied the current app. In browser
development, Vite owns it. A packaged Electron app starts one native backend.
By default, it uses an ephemeral loopback port. Server environment variables
can change the host and port.

Leyline stores named connections and the configured default for the full app.
Each window selects its active backend independently. A fresh window uses the
default. A new Electron window inherits the source window's active backend.

Runtime HTTP commands, runtime events, terminal traffic, and exports use the
active backend. Connection management stays on the native backend. The native
backend remains available when a window selects another connection.
