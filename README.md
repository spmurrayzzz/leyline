# Leyline

Leyline is a local web UI for pi coding-agent sessions. It uses Vue 3 and Vite
for the frontend, with Vite middleware that talks to the pi SDK for session
state, prompts, model controls, runtime events, and an embedded terminal.

<img width="1899" height="926" alt="image" src="https://github.com/user-attachments/assets/83fa2bc4-dbf0-4ded-8c49-3b15b2020602" />


## Features

- Browse pi sessions grouped by project
- Fuzzy-search visible sessions and projects
- Read rendered session transcripts with collapsed tool output
- Create or activate pi sessions from the UI
- Submit prompts to the active pi runtime
- Switch model, thinking level, and mode for the active runtime
- Watch live runtime events and assistant output
- Open an embedded terminal over WebSocket

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

