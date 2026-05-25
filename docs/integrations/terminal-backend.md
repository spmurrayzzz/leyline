# Terminal backend

The terminal uses the `/api/pi/terminal` WebSocket, a `node-pty` process, xterm on the frontend, and `@xterm/addon-fit` for sizing.

The backend selects a shell and environment for the PTY process and cleans up the process lifecycle when sockets close. Packaged Electron builds must unpack `spawn-helper` with native `node-pty` files.
