# Electron environment

On macOS, Electron starts the login shell and reads its environment before it
creates the first window. The operation has a five-second timeout.

Electron replaces `PATH` with the login-shell value. For other variables, it
keeps an existing process value and adds only missing values. This behavior
makes provider credentials and tool paths available to pi.

The shell comes from `SHELL`. Electron uses `/bin/zsh` when `SHELL` is not set.

Browser development uses a different rule. The Vite process inherits the
environment of the terminal that starts `npm run dev`.

If Electron cannot load the shell environment, it continues to start. Provider
or tool operations can then fail because a variable is absent. See
[Troubleshooting](../reference/troubleshooting#electron-does-not-have-shell-environment-variables).
