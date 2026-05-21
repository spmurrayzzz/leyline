# Leyline

Leyline is a local web UI for pi coding-agent sessions. It uses Vue 3 and Vite
for the frontend, with Vite middleware that talks to the pi SDK for session
state, prompts, model controls, runtime events, and an embedded terminal.

<img width="1624" height="1056" alt="image" src="https://github.com/user-attachments/assets/55b58463-0641-480c-8dd5-7e07a732014b" />

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

## Useful commands

```sh
npm run build
npm run preview
npm run screenshot
```

`npm run screenshot` expects the dev server to be running and writes the latest
capture to `screenshots/current.png`.
