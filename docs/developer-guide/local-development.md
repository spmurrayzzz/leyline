# Local development

Leyline requires macOS, npm, and Node.js 22.19.0. The repository records the Node.js version in `.nvmrc`.

## Install dependencies

Use `fnm`, `nvm`, or another version manager to select the required Node.js version. Then install dependencies:

```bash
npm install
```

The repository does not include a package lock.

## Run the browser app

Start Vite:

```bash
npm run dev
```

Open `http://localhost:5173/`. Vite mounts the Vue app, VitePress site, pi API, SSE endpoint, and terminal WebSocket.

Keep this process running during browser work and screenshot capture.

## Run the documentation site

Vite serves the documentation at `http://localhost:5173/docs/` during normal development.

Use the dedicated VitePress commands when you only work on documentation:

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

Set `VITEPRESS_BASE` when you must test a deployment base:

```bash
VITEPRESS_BASE=/leyline/ npm run docs:build
```

## Run Electron

Start Vite first. Then start Electron in another terminal:

```bash
npm run electron:dev
```

Restart Electron after changes to `electron/main.js` or packaged-server code. Vite applies normal frontend changes without an Electron restart.

Build the packaged app with:

```bash
npm run electron:build
```

## Preview limitations

`npm run preview` previews the built Vue files. It does not mount the pi API plugin or terminal WebSocket.

Use `npm run dev` when you must operate sessions or validate runtime behavior.

## Validate changes

Use the smallest command that covers the changed files:

```bash
npm run docs:build
npm run build
git diff --check
```

Use `npm run docs:build` for documentation-only changes. Use `npm run build` when application or shared source changes.

For visual work, run `npm run screenshot` or `npm run docs:screenshots` against the running Vite app. Inspect each result before you finish.
