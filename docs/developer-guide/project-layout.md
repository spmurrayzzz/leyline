# Project layout

- `src/App.vue`: composition root.
- `src/components/`: focused UI components.
- `src/composables/`: session workspace, live turn projection, events, terminal, and smooth streaming.
- `src/lib/`: API wrappers, transcript rendering and projection, formatting, and fuzzy search.
- `src/style.css`: app styling and motion tokens.
- `server/pi-api.js`: Vite middleware, API, WebSocket, and export renderer.
- `server/leyline-server.js`: production static/API server for Electron.
- `electron/main.js`: Electron shell.
- `.pi/extensions/goal/`: bundled goal extension.
- `scripts/`: build, screenshot, and video helpers.
- `assets/` and `public/`: icons and static brand assets.
