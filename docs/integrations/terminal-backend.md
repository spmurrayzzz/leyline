# Terminal backend

Leyline uses xterm in the browser and `node-pty` on the server. The two sides
communicate through `/api/pi/terminal` on the active backend.

## Browser lifecycle

`src/composables/useTerminal.js` owns the drawer, xterm instance, fit addon, WebSocket, status, and height.

Opening the terminal creates xterm and then opens the WebSocket with the selected session ID. The browser waits for the server's `ready` message. It then sends input and resize messages. Input entered during connection setup stays queued until the terminal is ready.

Selecting another session closes the current connection. Leyline then opens a new PTY for the selected session when the drawer remains open.

## Server lifecycle

`server/pi-api/terminal.js` accepts the WebSocket upgrade. It resolves the requested session's runtime handle and requires an existing runtime CWD.

The server selects the shell in this order:

1. The `SHELL` environment variable.
2. `/bin/zsh`.
3. `/bin/bash`.
4. `/bin/sh`.

The PTY starts as a login shell. It receives a copy of the server environment without the npm prefix variables that can interfere with shell startup.

The server sends `ready`, `data`, `exit`, and `error` messages. Closing the socket kills the related PTY process.

See the [API reference](../reference/api#terminal-websocket) for message contracts.

## Session boundary

Leyline connects to `/api/pi/terminal?sessionId=<id>`. The backend resolves that session's CWD without changing the process-wide active runtime.

Browser tabs and Electron windows can share one backend without changing each other's terminal targets. A request without `sessionId` uses the active runtime CWD for compatibility.

## Packaged Electron

Packaged builds must unpack the native `node-pty` files and `spawn-helper`. `scripts/electron-build.sh` performs this step.

On macOS, the server can repair the executable bit on `spawn-helper`. A package that leaves these files inside the Electron archive can fail with `ENOTDIR`.
