# Terminal

The terminal is a PTY-backed xterm bottom drawer connected through `/api/pi/terminal`.

It follows session and project cwd behavior and reconnects when the selected session or project changes. In Electron on macOS, Cmd+Shift+T toggles the terminal.

If the terminal fails in a packaged Electron app with `ENOTDIR`, check the `node-pty` `spawn-helper` unpacking requirement in the packaging docs.
