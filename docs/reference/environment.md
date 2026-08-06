# Environment variables

Leyline reads the following supported environment variables. Provider and tool
variables come from the user's pi setup.

## App and session variables

| Variable | Purpose |
| --- | --- |
| `LEYLINE_DEV_SERVER_URL` | URL that Electron loads instead of its packaged server. `npm run electron:dev` sets `http://localhost:5173`. |
| `LEYLINE_PUBLIC_URL` | Base URL for Open Graph and Twitter metadata in HTML exports. A final slash is removed. |
| `PI_CODING_AGENT_SESSION_DIR` | Session directory for discovery and new sessions. Leyline expands `~` and searches subdirectories for JSONL files. |
| `PI_ENABLE_CREATE_GOAL` | Set to `1` to expose the goal extension's `create_goal` model tool. |
| `LEYLINE_MEMORY_DIR` | Directory for the shared `memory.sqlite` database. The memory extension, Memory Inspector, rollout feedback, and subagent overrides use this path. |
| `SHELL` | Login shell used by Electron environment loading and the terminal backend. Electron defaults to `/bin/zsh`; the terminal has additional shell fallbacks. |

Without `PI_CODING_AGENT_SESSION_DIR`, Leyline uses the session directory from
pi settings for the selected project.

Use an absolute path for `LEYLINE_MEMORY_DIR`. Without this variable, Leyline uses:

```text
~/.local/share/leyline/memory.sqlite
```

The database can contain the `memories`, `rollout_feedback`, and
`subagent_overrides` tables.

## CLI variables

| Variable | Purpose |
| --- | --- |
| `LEYLINE_CWD` | Directory used by `leyline` instead of the current shell directory. |
| `LEYLINE_APP` | App package used by `leyline` instead of `/Applications/Leyline.app`. |

If `LEYLINE_APP` does not exist, the CLI checks the repository path
`release/Leyline-darwin-arm64/Leyline.app`.

## Documentation variable

| Variable | Purpose |
| --- | --- |
| `VITEPRESS_BASE` | Base path for the VitePress build. The default is `/docs/`. |

For example:

```bash
VITEPRESS_BASE=/leyline/ npm run docs:build
```

## Capture variables

| Variable | Command | Default |
| --- | --- | --- |
| `SCREENSHOT_URL` | `npm run screenshot` | `http://localhost:5173/` |
| `SCREENSHOT_PATH` | `npm run screenshot` | `screenshots/current.png` |
| `DOCS_SCREENSHOT_URL` | `npm run docs:screenshots` | `http://localhost:5173/` |
| `VIDEO_URL` | `npm run video` | `http://localhost:5173/` |
| `VIDEO_PATH` | `npm run video` | `screenshots/walkthrough.webm` |
| `VIDEO_DIR` | `npm run video` | `screenshots/videos` |
| `VIDEO_WIDTH` | `npm run video` | `1503` |
| `VIDEO_HEIGHT` | `npm run video` | `818` |
| `VIDEO_INPUT` | `npm run video:mp4` | `screenshots/walkthrough.webm` |
| `VIDEO_MP4_PATH` | `npm run video:mp4` | `screenshots/walkthrough.mp4` |

The live screenshot viewport is fixed at 1503 by 818 CSS pixels with a device
scale factor of 2. Documentation captures use fixed desktop, mobile, and README
viewports. See [Screenshots and video](../developer-guide/screenshots-and-video).

## Internal variables

Do not set these variables as user configuration.

| Variable | Owner |
| --- | --- |
| `LEYLINE_SERVER_URL` | The local Leyline server sets its URL for the bundled subagent extension. |
| `PI_CODING_AGENT` | The pi runtime integration sets this to `true` when it is absent. |

## Shell environment

The browser workflow inherits the environment that starts Vite. On macOS,
Electron loads the login-shell environment before it creates the first window.
Electron uses that shell's `PATH` and adds missing provider and tool variables.
