# Requirements

## Supported system

Leyline is developed and tested on macOS only. Linux and Windows are not
supported.

The local Electron publish script expects an Apple silicon package named
`Leyline-darwin-arm64`. The browser workflow is the primary development path.

## Required software

- Node.js 22.19.0, as specified in `.nvmrc`
- npm
- A modern local browser
- A configured pi coding-agent environment

Your pi setup must include credentials for each model provider that you use.
It must also include the environment variables required by your tools and
extensions.

Electron is optional. Use Electron to test the desktop package, desktop
shortcuts, macOS login-shell environment loading, and window state.
