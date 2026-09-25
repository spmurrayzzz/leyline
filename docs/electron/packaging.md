# Packaging

## Build the desktop app

Run:

```bash
npm run electron:build
```

The script runs `npm run build` first. This creates the app in `dist/` and the
VitePress site in `dist/docs/`. Electron Packager then writes the desktop
package to `release/` for the host platform and architecture. The x86-64 Linux
output is `release/Leyline-linux-x64/`.

The package uses icon files under `assets/icon`. The build unpacks native
`node-pty` files and `spawn-helper`. The packaged terminal can fail with
`ENOTDIR` if these files stay inside the Electron archive.

The packaging flow uses these files:

- `scripts/electron-build.sh`
- `electron/main.js`
- `server/leyline-server.js`
- `server/pi-api/`

## Install on Linux

Follow [Linux installation](../getting-started/linux-installation) to copy the
complete package to `~/.local/opt/leyline`, create a Linux CLI launcher, and add
an application-menu entry. That guide also covers verification and updates.

Do not use `npm run local-publish` or the repository's `bin/leyline` on Linux;
both currently assume a macOS app bundle.

## Install on Apple silicon macOS

Run:

```bash
npm run local-publish
```

This command builds the app and copies it to `/Applications/Leyline.app`. It
also links `bin/leyline` at `~/.local/bin/leyline`.

The local publish script expects `release/Leyline-darwin-arm64/Leyline.app`.
Thus, the current local publication flow supports Apple silicon macOS builds.
