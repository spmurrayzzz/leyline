# Project layout

## Frontend

- `src/main.js`: Creates the Vue app and loads the CSS entry file.
- `src/App.vue`: Composes the workspace and coordinates cross-feature state.
- `src/components/`: Contains focused Vue surfaces for sessions, composers, transcript entries, drawers, pickers, and previews.
- `src/components/ReviewPane.vue`: Renders changed files and prepared Pierre diffs for the selected project.
- `src/components/VisionConfigDrawer.vue`: Manages transcript, project, and global vision-model overrides.
- `src/composables/useSessionWorkspace.js`: Owns session, route, activation, and runtime-control state.
- `src/composables/useBackendConnections.js`: Owns connection records, the default, and window-specific backend selection.
- `src/composables/useTranscriptPreferences.js`: Owns app-wide transcript display settings.
- `src/composables/useLiveTurnProjection.js`: Owns optimistic and live transcript state.
- `src/composables/useRuntimeEvents.js`: Adapts SSE to frontend callbacks and the event log.
- `src/composables/useMemoryInspector.js`: Owns Memory Inspector requests and optimistic state.
- `src/composables/useProjectBrowser.js`: Owns project picker and folder-browser visibility.
- `src/composables/useToolExpansion.js`: Owns transcript expansion, copy, and fullscreen state.
- `src/composables/useWorkbenchScroll.js`: Owns transcript following and Jump to latest.
- `src/composables/useTerminal.js`: Owns xterm and terminal WebSocket state.
- `src/composables/useDictation.js`: Wraps browser speech recognition.
- `src/composables/useSmoothStreamingText.js`: Controls incremental live text display.
- `src/lib/backend.js`: Builds runtime HTTP and WebSocket URLs for the active backend.
- `src/lib/leyline-api.js`: Manages the native connection registry, app settings, and backend identity checks.
- `src/lib/pi-api.js`: Contains frontend runtime API functions.
- `src/lib/transcript.js`: Configures Markdown and syntax highlighting, then re-exports shared projection helpers.
- `src/lib/format.js`: Contains UI labels and value formatting.
- `src/lib/fuzzy.js`: Contains fuzzy search helpers.

## Shared library

- `lib/leyline-settings.js`: Defines app setting keys for the native backend and browser.
- `lib/transcript-projection.js`: Projects pi branch entries into shared transcript DTOs.

These files are outside `src/` because Node.js backend code and browser code import them.

## Styles

- `src/style.css`: Imports style modules only.
- `src/styles/tokens.css`: Defines colors, dimensions, typography, syntax colors, and motion tokens.
- `src/styles/motion.css`: Defines keyframes.
- `src/styles/shell.css`: Defines the app grid, header, sidebar, and start-shell surfaces.
- `src/styles/topbar.css`: Defines runtime chrome and workbench header controls.
- `src/styles/workbench.css`: Defines scrolling, start state, empty state, and loading state.
- `src/styles/transcript.css`: Defines messages, Markdown, thinking, feedback, and transcript actions.
- `src/styles/tools.css`: Defines tool rows, skills, subagents, and previews.
- `src/styles/composer.css`: Defines composer layout, menus, attachments, and submission states.
- `src/styles/memory.css`: Defines the Memory Inspector.
- `src/styles/review.css`: Defines the resizable and expanded Git review pane.
- `src/styles/settings.css`: Defines Settings, Runtime Events, subagent configuration, and vision configuration.
- `src/styles/modals.css`: Defines the project browser and confirmation dialogs.
- `src/styles/terminal.css`: Defines the terminal drawer.
- `src/styles/responsive.css`: Defines reduced-motion and responsive overrides.

## Backend

- `server/backend-connections.js`: Stores named backend connections, the default, and native app settings.
- `server/pi-api/index.js`: Creates the shared runtime and exports server adapters.
- `server/pi-api/router.js`: Routes runtime HTTP requests.
- `server/pi-api/cors.js`: Applies the shared HTTP and WebSocket origin policy.
- `server/pi-api/runtime.js`: Owns runtime handles and pi operations.
- `server/pi-api/sessions.js`: Discovers session JSONL files and session metadata.
- `server/pi-api/dtos.js`: Builds runtime and session DTOs.
- `server/pi-api/events.js`: Broadcasts SSE events.
- `server/pi-api/extension-ui.js`: Adapts extension UI state for the browser.
- `server/pi-api/goal-state.js`: Projects goal extension state.
- `server/pi-api/fs-browser.js`: Browses local directories.
- `server/pi-api/git-review.js`: Reads Git status, bounded per-file diffs, and watcher Git state.
- `server/pi-api/git-review-watch.js`: Shares recursive review watchers and sends review-change SSE events.
- `server/pi-api/memories.js`: Implements Memory Inspector storage.
- `server/pi-api/rollout-feedback.js`: Implements rollout feedback storage.
- `server/pi-api/subagents.js`: Implements subagent discovery and overrides.
- `server/pi-api/vision.js`: Implements vision overrides and persisted parent-context replacement.
- `server/pi-api/export-renderer.js`: Renders HTML transcript exports.
- `server/pi-api/terminal.js`: Runs PTYs over WebSocket.
- `server/pi-api/http.js`: Contains HTTP response helpers.
- `server/leyline-server.js`: Serves the packaged frontend and native backend.

## Electron and CLI

- `electron/main.js`: Owns windows, native shortcuts, window state, and the packaged server.
- `bin/leyline`: Opens a new session in the installed macOS app.
- `scripts/electron-build.sh`: Builds and packages the Electron app.
- `scripts/local-publish.sh`: Installs a local Apple Silicon macOS build and CLI link.

## Bundled pi resources

- `.pi/LEYLINE_SYSTEM.md`: Adds Leyline operating context to each runtime.
- `.pi/extensions/goal/`: Implements goal commands, state, and controls.
- `.pi/extensions/memory/`: Implements memory injection, commands, and tools.
- `.pi/extensions/subagent/`: Implements single, parallel, and chain subagent tools.
- `.pi/extensions/vision-agent/`: Implements image-file inspection through a vision child.

## Capture and documentation

- `scripts/screenshot.js`: Captures the current live browser state to a PNG.
- `scripts/docs-screenshots.js`: Captures sanitized documentation and README fixtures.
- `scripts/video.js`: Records the current browser walkthrough to WebM.
- `scripts/video-mp4.js`: Converts the walkthrough with ffmpeg.
- `screenshots/`: Stores ignored local captures.
- `docs/`: Contains the VitePress documentation site.
- `docs/assets/screenshots/`: Contains tracked product images for VitePress and GitHub.
- `assets/`: Contains README and application image sources.
- `public/`: Contains static files copied into the frontend build.

## Build entry points

- `vite.config.js`: Configures Vue, VitePress middleware, and the pi API plugin.
- `index.html`: Provides the frontend HTML entry.
- `package.json`: Defines runtime dependencies and commands.
- `.nvmrc`: Pins Node.js `v22.19.0` for local work.
