# Screenshots and video

Leyline has separate workflows for local visual checks and published documentation images.

## Capture the current local state

Start Vite, then run:

```bash
npm run screenshot
```

The command captures `http://localhost:5173/` at 1503 by 818 CSS pixels. The device scale factor is 2.

It writes `screenshots/current.png`. The `screenshots/` directory is ignored because captures can contain private local data.

Use these overrides when necessary:

```bash
SCREENSHOT_URL=http://localhost:5173/ \
SCREENSHOT_PATH=screenshots/current.png \
npm run screenshot
```

The local command waits for a fixed interval and reads live state. Do not publish its output without a complete review.

## Capture documentation fixtures

Start Vite, then run:

```bash
npm run docs:screenshots
```

This command intercepts Leyline API calls and supplies sanitized fixtures. Mock coverage includes:

- Backend connections, backend information and capabilities, file editor settings, and the thought display setting
- Projects, folder browsing, session lists, detail, activation, and runtime state
- Git status and selected-file diffs
- Memory records, subagent configuration, and vision configuration
- Queue, goal, research, shell, and image-delegation transcript states
- SSE runtime snapshots and events, terminal WebSocket traffic, and exported HTML

Unrecognized API requests fail the capture instead of reaching live data.

The registry contains the native backend and a fictional saved connection. The thought display setting is **Collapsed**.

The visible native address is `localhost:5173`, even when the capture uses another server URL. The command does not change local data or model configuration.

The command writes product images to `docs/assets/screenshots/`. It also refreshes the three README images in `assets/readme/`.

Set a different app URL with:

```bash
DOCS_SCREENSHOT_URL=http://localhost:5173/ npm run docs:screenshots
```

Refresh selected assets with `DOCS_SCREENSHOT_FILTER`, a comma-separated list of basenames. A basename selects matching files in either output directory:

```bash
DOCS_SCREENSHOT_FILTER=composer-queue.png,composer-queue-held.png,activity.png,activity-mobile.png npm run docs:screenshots
```

Use these fixed settings and fixture requirements for refreshed documentation images:

- Desktop viewport: 1440 by 900 CSS pixels
- Mobile viewport: 390 by 844 CSS pixels
- README viewport: 1503 by 818 CSS pixels
- Device scale factor: 2
- Locale: `en-US`
- Time zone: UTC
- Reduced motion: enabled
- General model label: `local/minimax-m2.7`
- Ultrafast exception: eligible `openai-codex` Responses or API-key `openai` Responses with `gpt-6-astra` or `gpt-6.1-sol`
- Vision selector: `local/qwen3.6-27b`, with actual image-input support
- Thought display default: **Collapsed**
- Project captures: `harbor`, `field-notes`, and three sanitized matching folders
- Git review captures: `release-safety` with four sanitized changed files
- Queue captures: the open **Up next** corner tray and the closed **Held** tab with **Resume**
- Activity captures: one selected run, one same-project run, one runtime error, one session with an editable queued task, and a shared-CWD warning
- Deep research captures: three completed threads, six ledger sources, four citations, one excluded source, and a mobile citation preview
- Other fixtures: Home, workbench, project navigation and details, backend settings, composer controls and shell mode, transcript actions, fullscreen previews, memory, subagents, vision delegation, goals, events, terminal, export, and mobile navigation

Home shows the `ultrafast` chip off. Workbench, composer-control, and mobile-session captures show it on with `openai-codex/gpt-6.1-sol`. The workbench and export include initial and later System cards. `system-message.png` shows the initial declaration collapsed and a later section and tool change expanded.

These models and settings exist only in the capture fixtures. The command does not change local model configuration.

Each state uses a new browser context. The script uses a fixed date with increasing millisecond ticks, replaces SSE and terminal transports, and waits for a state selector. The tick prevents Vue's event timestamp guard from dropping interactions. The capture disables remaining motion.

The script rejects unrecognized API calls and visible private text. It checks home paths, usernames, repository paths, email addresses, and common credential prefixes.

## Review documentation images

Open every changed image. Check these items:

1. All text is readable and correct.
2. No text or control is clipped.
3. The image has no private path, project, prompt, account, or credential data.
4. Hover, focus, loading, menu, and animation states appear only when they explain the documented action.
5. General model selectors show `local/minimax-m2.7`. Ultrafast captures use an eligible OpenAI model and authentication path.
6. The vision selector shows `local/qwen3.6-27b` and excludes text-only models.
7. System captures show the intended prompt and tool deltas without clipping.
8. Each Markdown image reference resolves in both documentation base paths.

Run the PNG structure audit from the documentation screenshot skill when it is available. Check whitespace and both documentation base paths:

```bash
git diff --check
npm run docs:build
VITEPRESS_BASE=/leyline/ npm run docs:build
```

## Record a walkthrough

Start Vite, then run:

```bash
npm run video
```

The command writes `screenshots/walkthrough.webm` by default. Use `VIDEO_URL`, `VIDEO_PATH`, `VIDEO_DIR`, `VIDEO_WIDTH`, and `VIDEO_HEIGHT` to change the capture.

Convert the result to MP4 with:

```bash
npm run video:mp4
```

This command requires `ffmpeg`. Use `VIDEO_INPUT` and `VIDEO_MP4_PATH` to change its paths.

Walkthroughs use live local state. Review and sanitize them before publication.
