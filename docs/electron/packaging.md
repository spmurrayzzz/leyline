# Packaging

## Build the desktop app

Run:

```bash
npm run electron:build
```

The script runs `npm run build` first. This creates the app in `dist/` and the
VitePress site in `dist/docs/`. Electron Packager then writes the desktop
package to `release/`.

The package uses icon files under `assets/icon`. The build unpacks native
`node-pty` files and `spawn-helper`. The packaged terminal can fail with
`ENOTDIR` if these files stay inside the Electron archive.

The packaging flow uses these files:

- `scripts/electron-build.sh`
- `electron/main.js`
- `server/leyline-server.js`
- `server/pi-api/`

## Install the local package

Run:

```bash
npm run local-publish
```

This command builds the app and copies it to `/Applications/Leyline.app`. It
also links `bin/leyline` at `~/.local/bin/leyline`.

The local publish script expects `release/Leyline-darwin-arm64/Leyline.app`.
Thus, the current local publication flow supports Apple silicon macOS builds.
