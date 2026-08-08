# Electron windows and state

## Start from the CLI

After local publication, run this command in a project directory:

```bash
leyline
```

Leyline opens or focuses the app. It creates a session for the current shell
directory in the active window.

Use the only supported CLI option to request a new window:

```bash
leyline -n
```

The CLI accepts no path argument. Set `LEYLINE_CWD` when the target directory
must differ from the current shell directory.

## Use multiple windows

Electron uses one app instance. A later CLI launch sends its request to the
running instance and then exits.

A normal `leyline` request uses the active window. A `leyline -n` request creates
a window. `Command+Shift+N` also creates a window and uses the active window's
current project directory when one is available.

The Electron main process provides one packaged native backend to all windows.
Each window can select a different saved backend. A new window inherits the
active backend from its source window.

## Saved window state

Electron saves window bounds, maximized state, and full-screen state in
`window-state.json` under Electron's `app.getPath('userData')` directory.

Each new window reads the saved state. Electron validates the saved size and
position before use. The default size is 1320 by 900 pixels, and the minimum
size is 900 by 640 pixels.
