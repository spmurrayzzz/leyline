# Electron windows and state

## Start from the CLI

After local publication, run this command in a project directory:

```bash
leyline
```

Leyline opens or focuses the app. It creates a session for the current shell
directory in the active window.

Use the only supported CLI option to open the home workspace in a new window:

```bash
leyline -n
```

This command does not create a pi session. The CLI accepts no path argument.
`LEYLINE_CWD` changes the directory for plain `leyline`; it does not affect
`leyline -n`.

## Use multiple windows

Electron uses one app instance. A later CLI launch sends its request to the
running instance and then exits.

A normal `leyline` request uses the active window and creates a session for the
requested directory. `leyline -n` and `Command+Shift+N` open the home workspace
in a foreground window without creating a session.

## Open a target in another window

Command-click an internal target to open it in a foreground Leyline window. Use
Ctrl-click on other platforms or middle-click with a mouse.

This behavior applies to sessions, projects, **New session**, and backend
choices. A modified **New session** action creates one session in the target
window. A modified backend choice opens the home workspace on that backend.
The source window does not change.

Electron sends external links to the system browser. In the browser build, the
browser controls whether a modified click opens a tab or a window.

The Electron main process provides one packaged native backend to all windows.
Each window can select a different saved backend. A new window inherits the
active backend from its source window unless the selected target specifies a
backend.

## Saved window state

Electron saves window bounds, maximized state, and full-screen state in
`window-state.json` under Electron's `app.getPath('userData')` directory.

Each new window reads the saved state. Electron validates the saved size and
position before use. The default size is 1320 by 900 pixels, and the minimum
size is 900 by 640 pixels.
