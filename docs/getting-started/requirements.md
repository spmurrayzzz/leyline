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

Configure a model through
[Settings → Models & providers](../user-guide/settings#manage-models-and-providers).
Supply credentials only when the provider requires them. Custom compatible
endpoints can work without an API key. Credentials can also come from pi's
existing files or the backend environment. Your tools and extensions can
require additional environment variables.

Electron is optional. Use Electron to test the desktop package, desktop
shortcuts, login-shell environment loading, and window state.
