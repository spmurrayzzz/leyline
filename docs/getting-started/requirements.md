# Requirements

## Supported systems

Leyline is used on macOS and Linux. The Linux reference setup is x86-64
Omarchy (Arch-based), running Hyprland on Wayland. Other Linux distributions
and architectures have not been validated. Windows is not supported.

The browser workflow is the primary development path. For a Linux desktop app,
follow [Linux installation](./linux-installation), including its build tools
and runtime-library requirements. The local Electron publish script and the
repository's CLI launcher remain Apple silicon macOS-specific; do not use
`npm run local-publish` on Linux.

## Required software

- Node.js 22.19.0, as specified in `.nvmrc`
- npm
- A modern local browser
- A configured pi coding-agent environment

Your pi setup must include credentials for each model provider that you use.
It must also include the environment variables required by your tools and
extensions.

Electron is optional. Use Electron to test the desktop package, desktop
shortcuts, login-shell environment loading, and window state.
