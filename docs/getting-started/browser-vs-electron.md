# Browser vs Electron

The browser/Vite path is the primary development workflow. Electron is an optional desktop shell around the same Vue app and backend integration.

| Area | Browser/Vite | Electron |
| --- | --- | --- |
| App serving | Vite dev server | Packaged static `dist/` server |
| Backend | Vite middleware in `server/pi-api.js` | `server/leyline-server.js` plus pi API wiring |
| Environment | Inherits the shell that launched Vite | Loads macOS login shell environment in the main process |
| Terminal | WebSocket to local PTY backend | Same backend, with desktop shortcuts |
| Window state | Browser-managed | Bounds, maximized state, and fullscreen persist |
| Dictation | Supported (via Web Speech API in Chrome) | Disabled (Chromium in Electron lacks Google's speech recognition engines) |

Use browser/Vite for day-to-day development and visual iteration. Use Electron to validate desktop packaging, environment loading, shortcuts, and window persistence.
