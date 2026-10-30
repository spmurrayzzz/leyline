---
description: Find Leyline's frontend, backend, shared modules, Electron shell, extensions, styles, and development scripts.
---

# Project layout

## Frontend

- `src/main.js`: Creates the Vue app and loads the CSS entry file.
- `src/App.vue`: Composes the workspace and coordinates cross-feature state.
- `src/components/`: Contains focused Vue surfaces for sessions, composers, transcript entries, drawers, pickers, and previews.
- `src/components/TracePanel.vue`: Lazily mounts one embedded Elune surface and adds selected-backend capture controls.
- `src/components/ReviewPane.vue`: Renders changed files and prepared Pierre diffs for the selected project.
- `src/components/SystemPromptInspector.vue`: Renders prompt sections, tool changes, raw text, and actions for a selected System event.
- `src/components/MobileToolActivity.vue`: Renders shared Activity cards on desktop and mobile, including direct inspector access for a single subagent call.
- `src/components/SubagentInspector.vue`: Owns task selection, Action ledger, full-entry and prompt readers, display snapshots, following, scroll restoration, and bounded row motion.
- `src/components/SubagentTailEntry.vue`: Renders one Action ledger row with an action, source-derived target and excerpt, outcome, character count, and reader-open event.
- `src/components/ResearchSourcesPane.vue`: Renders cited sources and the complete research ledger.
- `src/components/ResearchCitationPreview.vue`: Renders the anchored citation preview and mobile bottom sheet.
- `src/components/GlobalSettingsModal.vue`: Owns global category navigation, capability gates, focus containment, and owner labels.
- `src/components/NetworkAccessSettings.vue`: Controls native-backend sharing and its proxy port, with copyable URLs and access warnings.
- `src/components/AgentSettings.vue`: Renders fixed-scope subagent and vision overrides, plus global-only session-title settings.
- `src/components/SessionTitleSettings.vue`: Manages the selected backend's automatic-title switch, model, and independent thinking level.
- `src/components/SettingsSelect.vue`: Supplies the filterable selectors used by session-title settings.
- `src/components/RuntimeSettings.vue`: Manages the selected backend's idle-timeout draft, validation, save, and leave guard.
- `src/components/ProjectDetailDrawer.vue`: Renders Project settings and its Sessions tab. Session details lives in `App.vue`.
- `src/components/ProviderSettings.vue`: Manages provider/model inventories, edits, authentication, catalog refresh, and saved/draft connection tests with feedback beside draft actions.
- `src/components/McpSettings.vue`: Manages global MCP configuration and temporary native checks/authentication.
- `src/components/PiSettingsWorkspace.vue`: Supplies the searchable list, narrow selector, and bounded detail layout.
- `src/components/PiSettingsOperation.vue`: Displays private authentication prompts, progress, connection-test results, and cancellation.
- `src/components/ExtensionConfirmations.vue`: Displays pending extension confirmations and sends session-scoped replies.
- `src/components/ServiceTierPicker.vue`: Owns the desktop Standard/Fast/Ultrafast chip, menu, keyboard selection, and focus handling for both composers.
- `src/components/MobileComposerControls.vue`: Owns shared Home/session mobile controls and the Speed sheet, with separate eligible service-tier choices.
- `src/composables/useSessionWorkspace.js`: Owns session, route, activation, and runtime-control state.
- `src/composables/useBackendConnections.js`: Owns connection records, the default, and window-specific backend selection.
- `src/composables/usePinnedSessions.js`: Owns backend-scoped pinned session IDs, pending pin state, and cleanup requests.
- `src/composables/useTranscriptPreferences.js`: Owns app-wide transcript display settings.
- `src/composables/useSettingsOperation.js`: Owns backend-bound operation polling, answers, and cancellation.
- `src/composables/useLiveTurnProjection.js`: Owns optimistic and live transcript state.
- `src/composables/useSubagentPreview.js`: Reads the selected saved or active child with tool arguments, and observes a running child through its own runtime socket.
- `src/composables/useRuntimeEvents.js`: Adapts runtime WebSocket events to frontend callbacks and trace subscribers.
- `src/composables/useMemoryInspector.js`: Owns Memory Inspector requests and optimistic state.
- `src/composables/useProjectBrowser.js`: Owns project picker and folder-browser visibility.
- `src/composables/useToolExpansion.js`: Owns transcript expansion, copy, and fullscreen state.
- `src/composables/useFileLinks.js`: Resolves file actions, including child-result origins from `data-file-session-id`.
- `src/composables/useWorkbenchScroll.js`: Owns transcript following and Jump to latest.
- `src/composables/useTerminal.js`: Owns xterm and terminal WebSocket state.
- `src/composables/useDictation.js`: Supplies the shared dictation controller, which routes browser speech recognition or local dictation through the preload bridge or same-origin speech WebSocket.
- `src/composables/useSmoothStreamingText.js`: Controls incremental live text display.
- `src/lib/backend.js`: Builds runtime HTTP and WebSocket URLs for the active backend.
- `src/lib/event-socket.js`: Supplies the shared runtime/review WebSocket client with reconnect backoff, timeouts, heartbeat replies, stale-socket guards, and cleanup.
- `src/lib/leyline-api.js`: Manages the native connection registry, app settings, pinned sessions, and backend identity checks.
- `src/lib/pi-api.js`: Contains frontend runtime API functions.
- `src/lib/trace-client.js`: Supplies selected-backend trace requests, cancellation, and subscriptions through the runtime WebSocket.
- `src/lib/pi-settings-api.js`: Contains selected-backend provider/model/MCP requests and private operation transport.
- `src/lib/transcript.js`: Configures Markdown and syntax highlighting, then re-exports shared projection helpers.
- `src/lib/format.js`: Contains UI labels and value formatting.
- `src/lib/fuzzy.js`: Contains fuzzy search helpers.

## Shared library

- `lib/leyline-settings.js`: Defines shared setting keys and defaults, including automatic titles and idle runtime cleanup.
- `lib/research-state.js`: Folds branch-local research events and normalizes threads and sources.
- `lib/research-citations.js`: Validates numbered report links against the research source ledger.
- `lib/transcript-projection.js`: Projects pi branch entries, including System events, into shared transcript DTOs.
- `lib/tool-activity.js`: Groups top-level tools, excludes nested child tools, counts outcomes, and identifies direct inspector access through `singleSubagentEntry()`.
- `lib/subagent-ledger.js`: Projects source-derived ledger rows and supplies an optional current-rows cache for unchanged previews and row objects.
- `lib/subagent-view.js`: Supplies shared task, title, output, and fallback presentation helpers.
- `lib/subagent-status.js`: Defines subagent status semantics and task outcome counts.
- `lib/ultrafast.js`: Defines explicit service-tier eligibility, tier values, command/status identifiers, and legacy Ultrafast status fallback.

These files are outside `src/` because Node.js backend code and browser code import them.

`lib/system-prompt.js` supplies shared System event titles and display metadata for the app and export.

## Styles

- `src/style.css`: Imports style modules only.
- `src/styles/tokens.css`: Defines colors, dimensions, typography, syntax colors, and motion tokens.
- `src/styles/motion.css`: Defines keyframes.
- `src/styles/shell.css`: Defines the app grid, header, sidebar, and start-shell surfaces.
- `src/styles/topbar.css`: Defines runtime chrome and workbench header controls.
- `src/styles/workbench.css`: Defines scrolling, start state, empty state, and loading state.
- `src/styles/transcript.css`: Defines messages, Markdown, thinking, feedback, and transcript actions.
- `src/styles/tools.css`: Defines Activity cards, compact subagent rows, prompt inspectors, Graphite subagent ledgers and readers, skills, and previews.
- `src/styles/composer.css`: Defines composer layout, menus, attachments, and submission states.
- `src/styles/memory.css`: Defines the Memory Inspector.
- `src/styles/review.css`: Defines the resizable and expanded Git review pane.
- `src/styles/research.css`: Defines research progress, reports, source navigation, and sidebar markers. Subagent inspector styles belong to `tools.css`.
- `src/styles/settings.css`: Defines global Settings, contextual settings drawers, agent controls, and provider/MCP workspaces.
- `src/styles/modals.css`: Defines the project browser and confirmation dialogs.
- `src/styles/terminal.css`: Defines the terminal drawer.
- `src/styles/responsive.css`: Defines reduced-motion and responsive overrides.

## Backend

- `server/backend-connections.js`: Stores named backend connections, the default, native app settings, and pinned session IDs. Exposes live network-access routes.
- `server/network-access.js`: Forwards TCP connections from an independent network listener to the existing origin without restarting it.
- `server/pi-api/index.js`: Creates the shared runtime and exports server adapters.
- `server/pi-api/router.js`: Routes runtime HTTP requests.
- `server/pi-api/pi-settings-routes.js`: Routes runtime cleanup, session-title, provider/model/MCP settings, and private operations.
- `server/pi-api/pi-config.js`: Reads pi global files and applies locked, revision-checked atomic edits.
- `server/pi-api/provider-settings.js`: Builds redacted provider inventory, performs configuration/authentication actions, and validates and dispatches connection tests.
- `server/pi-api/provider-settings-runtime.js`: Leases cwd-bound settings runtimes, bounds inventory checks, and owns extension cleanup.
- `server/pi-api/custom-providers.js`: Registers native custom-provider adapters, synchronizes metadata through `refreshModels()`, and wraps public `ModelRuntime` streaming for optional credentials.
- `server/pi-api/provider-connection-test.js`: Owns saved/draft probes, temporary runtimes, authentication and route checks, output/time limits, and controlled errors.
- `server/pi-api/settings-operations.js`: Stores private operation state and serializes provider work.
- `server/pi-api/mcp-settings.js`: Manages global MCP configuration and worker actions.
- `server/pi-api/mcp-settings-worker.js`: Runs disposable sessions with native MCP management.
- `server/pi-api/mcp-settings-transports.js`: Owns native MCP transports, secret resolution, and process cleanup.
- `server/pi-api/cors.js`: Applies the shared HTTP and WebSocket origin policy.
- `server/pi-api/runtime.js`: Owns runtime handles, idle suspension/restoration, and pi operations.
- `server/pi-api/prompt-queue.js`: Owns the shared editable prompt/shell queue, revisions, hold/resume, and dispatch.
- `server/pi-api/idle-runtimes.js`: Stores idle-timeout settings and schedules cleanup checks.
- `server/pi-api/session-titles.js`: Stores automatic-title settings and runs bounded requests separate from conversation turns.
- `server/pi-api/sessions.js`: Discovers session JSONL files and session metadata.
- `server/pi-api/dtos.js`: Builds runtime and session DTOs.
- `server/pi-api/events.js`: Projects runtime events and sends WebSocket frames through bounded queues, including small trace commit and configuration notices.
- `server/pi-api/event-sockets.js`: Installs runtime and Git review WebSocket upgrades, origin checks, heartbeats, and shutdown cleanup.
- `server/pi-api/tracing.js`: Owns the lazy Elune store, inline capture bindings, backend configuration, and child usage reconciliation.
- `server/pi-api/tracing-routes.js`: Routes trace summaries, paged detail, bookmarks, and capture configuration.
- `server/pi-api/extension-ui.js`: Adapts extension UI state for the browser.
- `server/pi-api/fs-browser.js`: Browses local directories.
- `server/pi-api/git-review.js`: Reads Git status, bounded per-file diffs, and watcher Git state.
- `server/pi-api/git-review-watch.js`: Shares recursive review watchers and sends review-change WebSocket events.
- `server/pi-api/memories.js`: Implements Memory Inspector storage.
- `server/pi-api/rollout-feedback.js`: Implements rollout feedback storage.
- `server/pi-api/subagents.js`: Implements subagent discovery and overrides.
- `server/pi-api/vision.js`: Implements vision overrides and persisted parent-context replacement.
- `server/pi-api/export-renderer.js`: Renders HTML exports with shared Activity groups, a lazy subagent dialog, and matching ledger and reader styles for recorded task output.
- `server/pi-api/terminal.js`: Runs PTYs over WebSocket.
- `server/pi-api/http.js`: Contains HTTP response helpers.
- `server/leyline-server.js`: Serves the packaged frontend and native backend.
- `server/shutdown-deadlines.js`: Shares runtime and packaged-backend shutdown deadlines.

## Electron and CLI

- `electron/main.js`: Owns windows, internal target validation, native shortcuts, window state, and backend utility-process supervision.
- `electron/leyline-server-process.js`: Starts and closes the shared packaged backend in an Electron utility process.
- `bin/leyline`: Opens a session in the installed macOS app, or opens the home workspace in a new window with `-n`.
- `scripts/electron-build.sh`: Builds and packages the Electron app.
- `scripts/local-publish.sh`: Installs a local Apple Silicon macOS build and CLI link.

## Bundled pi resources

- `.pi/LEYLINE_SYSTEM.md`: Adds Leyline operating context to normal runtimes.
- `.pi/extensions/output-budget/`: Implements one bounded retry for explicit OpenAI-compatible completion-budget errors.
- `.pi/extensions/ultrafast/`: Owns runtime-local Standard/Fast/Ultrafast controls, request snapshots, provider hooks, SDK-matched connection cleanup, and cost estimates.
- `.pi/extensions/memory/`: Implements memory injection, commands, and tools.
- `.pi/extensions/subagent/`: Implements single, parallel, and chain subagent tools, including the reserved researcher.
- `.pi/extensions/research/`: Implements research-session binding, state updates, orchestration protocol, and report checks.
- `.pi/extensions/vision-agent/`: Implements image-file inspection through an isolated vision child.

Normal runtimes load all six bundled extensions plus inline Elune capture. Isolated custom-prompt children retain output-budget and inline capture. Native MCP and tool search use SDK factories in `runtime.js`. Leyline does not load Codemode.

## Embedded Elune dependency

`@elune/embedded` uses the GitHub dependency `spmurrayzzz/elune`. Its independent package exports the core, `/pi`, `/vue`, and `/vue/style.css`. It needs no sibling checkout or separate service. See [Elune integration](../integrations/elune) for host ownership and worker storage.

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
- `package.json`: Defines runtime dependencies and commands. It pins `@earendil-works/pi-coding-agent` to `1.2.0` and the direct `@earendil-works/pi-ai` dependency to `0.99.1`.
- `.nvmrc`: Pins Node.js `v22.19.0` for local work.
