# Electron development

Start Vite first:

```bash
npm run dev
```

Then launch Electron:

```bash
npm run electron:dev
```

`LEYLINE_DEV_SERVER_URL=http://localhost:5173` tells the Electron main process to load the dev server.

Main process shortcuts include Cmd/Ctrl+N for a new session, Cmd+Shift+T for terminal toggle on macOS, and Cmd+E for sidebar toggle on macOS. Restart Electron after main-process changes.
