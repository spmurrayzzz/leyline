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

This command intercepts Leyline API calls and supplies sanitized fixtures. It replaces backend, session, Git review, and thought display data.

The registry contains the native backend and a fictional saved connection. The thought display setting is **Collapsed**.

The visible native address is `localhost:5173`, even when the capture uses another server URL. The command does not change local data or model configuration.

The command writes product images to `docs/assets/screenshots/`. It also refreshes the three README images in `assets/readme/`.

Set a different app URL with:

```bash
DOCS_SCREENSHOT_URL=http://localhost:5173/ npm run docs:screenshots
```

The documentation workflow uses these fixed settings:

- Desktop viewport: 1440 by 900 CSS pixels
- Mobile viewport: 390 by 844 CSS pixels
- README viewport: 1503 by 818 CSS pixels
- Device scale factor: 2
- Locale: `en-US`
- Time zone: UTC
- Reduced motion: enabled
- Model label: `local/deepseek-v4-flash`
- Thought display default: **Collapsed**
- Git review captures: `release-safety` with four sanitized changed files
- Deep research captures: three completed threads, six ledger sources, four citations, and one excluded source

Each state uses a new browser context. The script freezes time, replaces SSE and terminal transports, waits for a state selector, and disables remaining motion.

The script rejects unrecognized API calls and visible private text. It checks home paths, usernames, repository paths, email addresses, and common credential prefixes.

## Review documentation images

Open every changed image. Check these items:

1. All text is readable and correct.
2. No text or control is clipped.
3. The image has no private path, project, prompt, account, or credential data.
4. Hover, focus, loading, menu, and animation states appear only when they explain the documented action.
5. Each visible model selector shows `local/deepseek-v4-flash`.
6. Each Markdown image reference resolves in both documentation base paths.

Run the PNG structure audit from the documentation screenshot skill when it is available. Also run `git diff --check` and both documentation builds.

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
