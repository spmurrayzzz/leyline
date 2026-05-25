# Packaging

Build the desktop app with:

```bash
npm run electron:build
```

The build creates Vite `dist/` first, including the VitePress docs under `/docs`, then Electron Packager writes to `release/`.

App icon sources live in `assets/icon` variants. Packaging must unpack `node-pty` native dependencies and `spawn-helper`; otherwise the terminal can fail in packaged builds.

Relevant files are `scripts/electron-build.sh`, `server/leyline-server.js`, and `electron/main.js`.
