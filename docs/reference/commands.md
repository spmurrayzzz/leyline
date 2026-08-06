# Commands

## Install dependencies

| Command | Purpose |
| --- | --- |
| `npm install` | Install project dependencies in `node_modules/`. |

The repository does not include a package lock.

## Run the app and documentation

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite, the pi API middleware, and the VitePress middleware. |
| `npm run build` | Build the Vue app and the VitePress site. |
| `npm run preview` | Preview the built Vue app. |
| `npm run docs:dev` | Start the VitePress development server. |
| `npm run docs:build` | Build only the VitePress site. |
| `npm run docs:preview` | Preview the built VitePress site. |

`npm run build` writes the Vue app to `dist/` and the documentation to
`dist/docs/`. `npm run preview` does not mount the pi API or terminal backend.

## Run and package Electron

| Command | Purpose |
| --- | --- |
| `npm run electron:dev` | Open Electron at `http://localhost:5173`. Start Vite first. |
| `npm run electron:build` | Build the app and documentation, then package Electron in `release/`. |
| `npm run local-publish` | Build the Apple silicon app, copy it to `/Applications/`, and link the CLI. |

## Capture screenshots and video

| Command | Purpose |
| --- | --- |
| `npm run screenshot` | Save a live browser capture to `screenshots/current.png` by default. |
| `npm run docs:screenshots` | Refresh sanitized VitePress and README product images. |
| `npm run video` | Save a browser walkthrough to `screenshots/walkthrough.webm` by default. |
| `npm run video:mp4` | Use `ffmpeg` to convert the walkthrough to MP4. |

The screenshot and video commands require a running app. The documentation
capture uses intercepted fixture data. See [Environment variables](./environment#capture-variables)
for URL, path, and video size overrides.

## Use the packaged CLI

Run `npm run local-publish` before you use the global command.

```bash
leyline
```

This command opens or focuses Electron. It creates a pi session for the current
shell directory in the active window.

```bash
leyline -n
```

The `-n` option creates the session in a new Electron window. It is the only
supported CLI option. The CLI does not accept a directory argument.

Set `LEYLINE_CWD` to select a different directory. Set `LEYLINE_APP` to select a
different app package. See [Environment variables](./environment#cli-variables).
