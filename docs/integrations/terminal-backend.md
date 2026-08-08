# Terminal backend

Leyline uses xterm in the browser and `node-pty` on the server. The two sides
communicate through `/api/pi/terminal` on the active backend.

## Browser lifecycle

`src/composables/useTerminal.js` owns the drawer, xterm instance, fit addon, WebSocket, status, and height.

Opening the terminal creates xterm and then opens the WebSocket. Browser input becomes an `input` message. Fit and resize changes become `resize` messages.

Selecting another session closes the current connection. Leyline then opens a new PTY for the newly active session when the drawer remains open.

## Server lifecycle

`server/pi-api/terminal.js` accepts the WebSocket upgrade. It requires a process-wide active runtime and an existing runtime CWD.

The server selects the shell in this order:

1. The `SHELL` environment variable.
2. `/bin/zsh`.
3. `/bin/bash`.
4. `/bin/sh`.

The PTY starts as a login shell. It receives a copy of the server environment without the npm prefix variables that can interfere with shell startup.

The server sends `ready`, `data`, `exit`, and `error` messages. Closing the socket kills the related PTY process.

See the [API reference](../reference/api#terminal-websocket) for message contracts.

## Active-session boundary

The terminal uses the backend's active runtime CWD. It is not a session-scoped API operation.

All browser tabs and Electron windows connected to one backend share its
active-session pointer. A selection in one window can change the CWD for a new
terminal connection in another window on that backend.

## Packaged Electron

Packaged builds must unpack the native `node-pty` files and `spawn-helper`. `scripts/electron-build.sh` performs this step.

On macOS, the server can repair the executable bit on `spawn-helper`. A package that leaves these files inside the Electron archive can fail with `ENOTDIR`.
