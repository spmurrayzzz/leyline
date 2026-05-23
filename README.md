# Leyline

Leyline is a local web UI for pi coding-agent sessions. It uses Vue 3 and Vite
for the frontend, with Vite middleware that talks to the pi SDK for session
state, prompts, model controls, runtime events, and an embedded terminal.

| Home View | Workbench |
| --- | --- |
| <img width="1624" height="1056" alt="Home View" src="https://github.com/user-attachments/assets/66b771a5-0b0c-4905-b788-b605dd4ee80b" /> | <img width="1624" height="1056" alt="Workbench" src="https://github.com/user-attachments/assets/d9406f53-c110-43d5-98ed-e08599e2f3a7" /> |


## Features

Browse, search, create, and run pi sessions from a local web UI, with rendered
transcripts, live runtime output, model/mode controls, and an embedded terminal.

## Requirements

- Node.js
- npm
- A configured pi coding-agent environment

## Setup

```sh
npm install
```

## Development

```sh
npm run dev
```

Open the Vite URL shown in the terminal, usually:

```txt
http://localhost:5173/
```

## Optional Electron app

The browser/Vite workflow is the primary development path, but Leyline can also
run as a local Electron desktop app.

For Electron development, start Vite in one terminal:

```sh
npm run dev
```

Then launch Electron in another terminal:

```sh
npm run electron:dev
```

To build a packaged desktop app:

```sh
npm run electron:build
```

The packaged app is written to `release/`. The build first creates the Vite
`dist/` output, then packages Electron with the app icon from `assets/icon` and
unpacks native terminal dependencies needed by `node-pty`.

## Useful commands

```sh
npm run build
npm run preview
npm run electron:dev
npm run electron:build
npm run screenshot
```

`npm run screenshot` expects the dev server to be running and writes the latest
capture to `screenshots/current.png`.
