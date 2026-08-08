# Electron

Electron is the optional desktop path for Leyline. It uses the same Vue app and
pi API as the browser workflow.

Electron adds these functions:

- Native windows and desktop shortcuts
- A packaged native backend available to all app windows
- macOS login-shell environment loading
- Saved window size, position, maximized state, and full-screen state
- Independent backend selection in each window
- The `leyline` command after local publication

Dictation is not available in Electron. Use a compatible browser when you need
dictation.

See [Development](./development), [Packaging](./packaging),
[Environment](./environment), and [Windows and state](./window-state).
