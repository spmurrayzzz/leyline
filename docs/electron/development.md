# Electron development

## Start the app

1. Start Vite in the first terminal:

   ```bash
   npm run dev
   ```

2. Start Electron in a second terminal:

   ```bash
   npm run electron:dev
   ```

The script sets `LEYLINE_DEV_SERVER_URL=http://localhost:5173`. Electron loads
that URL instead of starting the packaged static server.

Restart Electron after changes to `electron/main.js` or the packaged server.
Vite applies normal frontend changes while it continues to run.

## Use desktop shortcuts

| Shortcut | Action |
| --- | --- |
| `Command+N` | Create a session in the current window. |
| `Command+Shift+N` | Open the home workspace in a new window. |
| `Command+W` | Close the current window. |
| `Command+E` | Show or hide the sidebar. |
| `Command+Shift+E` | Open Settings. |
| `Command+Shift+M` | Show or hide Memory. |
| `Command+Shift+T` | Show or hide the terminal. |
| `Escape` | Stop the active run and close open drawers, dialogs, and menus. |

`Command+N` also accepts `Control+N` in the Electron input handler. The other
listed shortcuts use the macOS Command key. `Command+Shift+N` does not create a
pi session.

Command-click, Ctrl-click, or middle-click a session, project, **New session**,
or backend choice to open its target in a foreground Electron window.
