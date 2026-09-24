# Electron environment

Electron starts the login shell and reads its environment before it creates the
first window. The operation has a five-second timeout. It runs on macOS and
Linux.

Electron replaces `PATH` with the login-shell value. For other variables, it
keeps an existing process value and adds only missing values. This behavior
makes provider credentials and tool paths available to pi.

The shell comes from `SHELL`, or from the account shell when `SHELL` is not
set.

The shell runs interactively, so its login startup files apply. On Linux, this
is how a desktop entry picks up shell exports. For Bash, `~/.bashrc` applies
when `~/.bash_profile`, `~/.bash_login`, or `~/.profile` sources it, as most
Linux distributions configure.

Browser development uses a different rule. The Vite process inherits the
environment of the terminal that starts `npm run dev`.

If Electron cannot load the shell environment, it continues to start. Provider
or tool operations can then fail because a variable is absent. See
[Troubleshooting](../reference/troubleshooting#electron-does-not-have-shell-environment-variables).
