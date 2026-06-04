# Windows and State Management

Leyline supports running multiple sessions across multiple Electron windows, with advanced single-instance handling, keyboard shortcuts, and window-state persistence.

## Single Instance & CLI Launching

When you launch the packaged app or run the `leyline` command in a terminal:
1. **Single-Instance Lock**: The main process requests a single-instance lock. If an instance of Leyline is already running, the arguments (such as a target folder path or a new window flag) are forwarded to the running instance, and the second process exits gracefully.
2. **IPC Dispatching**: The running instance intercepts these arguments. Depending on the flags passed:
   - It will either dispatch a `leyline:new-session` event to the active window to open the new session in the current window.
   - Or, if `--leyline-new-window` (`leyline -n`) is specified, it will instantiate a brand-new BrowserWindow.

## Multi-Window & Shortcuts

Leyline uses native keyboard-shortcut listening in the main process to facilitate fast multi-window management:

- **New Session (`Cmd+N`)**: Triggers a new session in the current, active window.
- **New Session in New Window (`Cmd+Shift+N`)**: Queries the active window's current working directory via `window.__leylineCurrentCwd` and launches a new Electron window opened to that same workspace.
- **Close Window (`Cmd+W`)**: Closes the current, active window.

## Window State Persistence

Electron persists window bounds, maximized state, and fullscreen state under `app.getPath('userData')` in a file named `window-state.json`.

Default bounds are used when no valid saved state exists. Saved bounds are validated before use so stale or invalid monitor layouts do not strand the window.

