# Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies. |
| `npm run dev` | Start the Vite app. |
| `npm run build` | Build the app and VitePress docs. |
| `npm run preview` | Preview the built app. |
| `npm run docs:dev` | Start the VitePress docs server. |
| `npm run electron:dev` | Launch Electron against Vite. |
| `npm run electron:build` | Package Electron app. |
| `npm run screenshot` | Capture `screenshots/current.png`. |
| `npm run video` | Record `screenshots/walkthrough.webm`. |
| `npm run video:mp4` | Convert walkthrough to MP4. |
| `npm run local-publish` | Run the local publish helper. |

## CLI Commands

After running `npm run local-publish` to install the app and link the CLI, the following global command becomes available:

### `leyline`

Opens or focuses the Electron app and creates a new pi session for the current shell directory (`$PWD`).

- **Arguments/Flags**:
  - `leyline` - Create/reveal a session for the current folder.
  - `leyline -n` or `leyline --new-window` - Create and open the session in a brand-new Electron window.

