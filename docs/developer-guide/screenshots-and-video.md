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

- Backend connections, live network-access state, switch and port changes, backend information and capabilities, file editor settings, the thought display setting, and pinned session IDs
- Provider/model and MCP inventories with the `piSettings` capability; saved secret values are absent
- Certificate trust settings with two synthetic PEM files and the operating-system store enabled
- Catalog search results for three Qwen3.8-27B provider variants, with model details, thinking maps, and compatibility metadata
- Projects, folder browsing, session lists, detail, activation, and runtime state
- Git status and selected-file diffs
- Memory records, subagent configuration, vision configuration, and automatic-title settings
- Saved child transcripts, tool arguments, and child-scoped runtime events for subagent ledgers
- Queue, research, shell, and image-delegation transcript states
- Runtime snapshots and events, Git review notices, and terminal traffic through mock WebSockets, plus exported HTML
- Trace summaries, paged detail, bookmarks, capture configuration, and trace capability data

Unrecognized API requests fail the capture instead of reaching live data.

The registry contains the native backend and a fictional saved connection. The thought display setting is **Collapsed**.

The visible native address is `localhost:5173`, even when the capture uses another server URL. The command does not change local data or model configuration.

The command writes product images to `docs/assets/screenshots/`. It also refreshes the README images in `assets/readme/`, including `tracing.png` and `header.png`.

`header.png` keeps the 1440 by 480 pixel banner layout and approved wording. Its workspace crop comes from the same sanitized workbench fixture, including the pin filter and child sessions. Refresh it with `DOCS_SCREENSHOT_FILTER=header.png npm run docs:screenshots`.

Set a different app URL with:

```bash
DOCS_SCREENSHOT_URL=http://localhost:5173/ npm run docs:screenshots
```

Refresh selected assets with `DOCS_SCREENSHOT_FILTER`, a comma-separated list of basenames. A basename selects matching files in either output directory:

```bash
DOCS_SCREENSHOT_FILTER=composer-queue.png,composer-queue-held.png,activity.png,activity-mobile.png npm run docs:screenshots
```

For mobile header and composer changes:

```bash
DOCS_SCREENSHOT_FILTER=mobile-session.png,dictation-mobile.png,mobile-sidebar.png,subagent-inspector-mobile.png,subagent-live-tail-mobile.png,deep-research-mobile.png,trace-mobile.png npm run docs:screenshots
```

These captures include the mobile header or composer, sometimes behind a sheet. Check the 48-pixel header targets and the 32-pixel gray capsule with separate model, thinking, and speed controls. Each capsule control has a touch target of at least 44 by 44 pixels. The speed bolt is outlined gray for Standard and filled lavender for Fast or Ultrafast. For composer-only changes, refresh `mobile-session.png` and `dictation-mobile.png`. The other captures hide the capsule behind a sidebar, sheet, or full-screen view.

For service-tier controls:

```bash
DOCS_SCREENSHOT_FILTER=home.png,workbench.png,composer-controls.png,mobile-session.png,service-tiers.png,mobile-speed.png npm run docs:screenshots
```

| Asset | Captured state |
| --- | --- |
| `home.png` in both output directories | Standard selected in the closed desktop tier chip. |
| `workbench.png` in both output directories | Ultrafast selected beside the model and thinking controls. |
| `docs/assets/screenshots/composer-controls.png` | The same Ultrafast state, cropped to the composer. |
| `docs/assets/screenshots/mobile-session.png` | Mobile composer with the filled premium-speed bolt. |
| `docs/assets/screenshots/service-tiers.png` | Desktop menu with lowercase `standard`, `fast`, and `ultrafast` choices, with `fast` selected. |
| `docs/assets/screenshots/mobile-speed.png` | Mobile Speed sheet with Standard, Fast, and Ultrafast choices, with Fast selected. |

These captures use the eligible `openai-codex/gpt-6.1-sol` fixture. General captures retain `local/glm-5.3-flash`. The helper checks the available choices and selected tier before capture. The open desktop menu keeps focus so it stays visible. No tier change or provider request reaches a live backend.

Existing images keep their dimensions. Desktop captures use 1440 by 900 CSS pixels, with composer images cropped to their controls. Mobile uses 390 by 844. README captures use 1503 by 818 before framing. All use device scale factor 2. The README header and social-card crops do not show the composer, so tier-only changes do not require their replacement.

For expanded tool previews:

```bash
DOCS_SCREENSHOT_FILTER=tool-activity.png,vision-tool-call.png,preview-fullscreen.png npm run docs:screenshots
```

`tool-activity.png` shows an integrated skill-prompt header, an expanded skill read with **Loaded**, and a collapsed shell call. The skill row uses a plain name without a path pill. The helper checks that the file preview and **Open full screen** align with the skill name. It also keeps the action above the composer and rejects a duplicate desktop path line.

For the settings overview and connection-test captures:

```bash
DOCS_SCREENSHOT_FILTER=backend-connections.png,network-access.png,certificates.png,certificates-mobile.png,models-providers.png,provider-models.png,model-catalog.png,model-editor.png,model-thinking.png,provider-connection-test.png,model-connection-test.png,mcp-servers.png,subagents.png,vision-agent.png,session-title-settings.png,dictation-settings.png,project-details.png,session-details.png,settings-mobile.png npm run docs:screenshots
```

These images cover Settings pages, connection checks, and project/session drawers. The Certificates captures show the same two PEM files on desktop and mobile. Provider fixtures include a keyless local endpoint. Refresh the full set when the Settings category list changes.

For subagent batch configuration:

```bash
DOCS_SCREENSHOT_FILTER=subagents.png,vision-agent.png,session-details.png,subagent-batch-size.png,subagent-batch-size-mobile.png npm run docs:screenshots
```

| Asset in `docs/assets/screenshots/` | Captured state |
| --- | --- |
| `subagents.png` | Agent defaults with global batch size 4 and subagent model choices. |
| `vision-agent.png` | Agent defaults with automatic titles off, vision controls, and the Subagents section. |
| `session-details.png` | Session drawer with runtime state, inherited batch size, and model overrides. |
| `subagent-batch-size.png` | Desktop Session details with session batch size 2 and **Use global default (4)**. |
| `subagent-batch-size-mobile.png` | The same session override in the mobile drawer. |

Desktop captures use 1440 by 900 CSS pixels. Mobile uses 390 by 844 CSS pixels. All captures use device scale factor 2. Keep the parent model at `local/glm-5.3-flash` and the image-capable vision fixture unchanged.

Use intercepted fixtures for configuration reads, saves, and resets. No request may change real backend settings or start a model run. Keep paths and session content synthetic. Check the saved value, source label, and reset control before capture. Batch size has no project override, so do not show a project control.

See [Configure batch size](../user-guide/subagents#configure-batch-size) and [Mobile batch settings](../user-guide/mobile#set-a-session-batch-size) for the image references.

For subagent inspection and the affected research views:

```bash
DOCS_SCREENSHOT_FILTER=subagent-live-tail.png,subagent-live-tail-mobile.png,subagent-outcomes.png,subagent-inspector-mobile.png,subagent-inspector-export.png,deep-research.png,deep-research-mobile.png npm run docs:screenshots
```

| Asset | Captured state |
| --- | --- |
| `docs/assets/screenshots/subagent-live-tail.png` | Desktop action ledger with one running child, saved file reads, a search, and live command output. |
| `docs/assets/screenshots/subagent-live-tail-mobile.png` | The same ledger in a mobile bottom sheet with the follow control and child-session link. |
| `docs/assets/screenshots/subagent-outcomes.png` | Desktop action ledger with four completed tasks, one stopped task, and saved verification activity. |
| `docs/assets/screenshots/subagent-inspector-mobile.png` | Mobile entry reader with two completed tasks, one stopped task, and a formatted result. |
| `docs/assets/screenshots/subagent-inspector-export.png` | Offline entry reader with the five-task fixture and no child-session navigation. |
| `docs/assets/screenshots/deep-research.png` | Completed report with the compact Research threads row in Activity. |
| `docs/assets/screenshots/deep-research-mobile.png` | The same report with a mobile citation preview. |
| `assets/readme/deep-research.png` | The research view in the README frame. |

The fixtures give every child an explicit `title`, separate from its full `task` prompt. Research children use their planned thread titles. Inspector captures show `local/glm-5.3-flash`, `high` thinking, and the `inherited` source. Saved task results carry the same model metadata as live snapshots.

The inspector helpers open a single-call Activity card from its header, check task titles, stopped outcomes, and the full prompt, then reopen it from its row. Both entry points must keep the card collapsed and preserve its height and position. Desktop captures show the ledger; mobile and export captures open a full result. The helpers wait for one active reader with no outgoing reader or footer layers. The export capture blocks the external preview renderer to verify that the inspector works offline.

For inspector layout changes, refresh only the five inspector images:

```bash
DOCS_SCREENSHOT_FILTER=subagent-live-tail.png,subagent-live-tail-mobile.png,subagent-outcomes.png,subagent-inspector-mobile.png,subagent-inspector-export.png npm run docs:screenshots
```

Check the Header dock treatment: the agent in the small header label, Model and Thinking chips beside the status and research-count facts, and **Full task prompt** beside the Copy and Close controls. On mobile, **Full task prompt** becomes a full-width 44-pixel header row below the title, and Model text truncates only when space runs out. The connection state sits beside the **Activity** counts, and the footer keeps the following and reading states.

One inset latest-response card keeps **Read full**. Ledger captures show the compact **Activity** counts and flat rows with icons, outcomes, and character counts. Reader captures show the intended entry title and **Back to activity** above the scroll sections. On mobile, check that task details and the latest card remain reachable without displacing the ledger or footer.

PNG captures show the settled layout with reduced motion enabled. Use separate fixture-based visual checks with motion enabled for cold previews, overlapping reader transitions, and rapid task changes. Also check manual scrollback, reduced motion, and closure during a handoff. Do not infer smooth motion from a static capture.

Live captures use a synthetic release-review child. Saved messages pass through `projectTranscriptEntries()` with tool arguments retained. A child-scoped `tool_execution_update` supplies the running command output. The helper opens that row to check full output and arguments, checks the task prompt, and verifies that closing releases the child socket. It then reopens the ledger for capture. Exactly one child subscription may remain open, and the parent route must stay selected. No child activation or model request reaches the backend.

For pinned sessions:

```bash
DOCS_SCREENSHOT_FILTER=pinned-sessions.png,pinned-only.png,mobile-sidebar.png npm run docs:screenshots
```

| Asset in `docs/assets/screenshots/` | Captured state |
| --- | --- |
| `pinned-sessions.png` | Two pinned sessions above the normal time groups, with the filter off. |
| `pinned-only.png` | The active lavender pin filter, **Search pinned sessions**, and **2 of 7** visible sessions. |
| `mobile-sidebar.png` | The mobile search field with its pin filter off, above the expanded subagent branch. |

The pinned-only capture uses the real filter button. It checks the active state, search label, visible count, and pin markers in the right metadata group before capture. The selected unpinned conversation stays open. No pin or session mutation reaches the backend.

Changes to the desktop header, sidebar controls, or row alignment affect screenshots throughout the guides and README. Refresh those images at their existing dimensions. Update the workspace share card from the refreshed workbench image and use a new filename to avoid stale previews.

For sidebar child sessions:

```bash
DOCS_SCREENSHOT_FILTER=subagent-sidebar.png,mobile-sidebar.png,workbench.png,subagent-outcomes.png,deep-research.png npm run docs:screenshots
```

| Asset | Captured state |
| --- | --- |
| `docs/assets/screenshots/subagent-sidebar.png` | Expanded parent with one completed child and two running children, beside the live subagent Activity card. |
| `docs/assets/screenshots/mobile-sidebar.png` | The same child branch in the mobile sidebar. |
| `workbench.png` in both output directories | Two settled children under the selected parent. |
| `docs/assets/screenshots/subagent-outcomes.png` | Five settled children beside the desktop task inspector. |
| `deep-research.png` in both output directories | Three research workers under their parent, beside the completed report and sources. |

The fixtures include marked child sessions, parent paths, and task metadata keyed by child ID. Running children use mock runtime snapshots. The helper waits for folding to finish, then checks the inset nodes, aligned parent titles, 18-pixel chevron gutter, and 4-pixel title gap. General captures retain `local/glm-5.3-flash`; workbench captures keep the approved service-tier model.

Use local visual checks for fold motion, rapid reversals, and reduced-motion behavior. PNG captures show only the settled layout.

For network access:

```bash
DOCS_SCREENSHOT_FILTER=backend-connections.png,network-access.png,network-access-mobile.png npm run docs:screenshots
```

| Asset in `docs/assets/screenshots/` | Captured state |
| --- | --- |
| `backend-connections.png` | Connections with sharing off, **Proxy port** set to **Automatic**, and saved backends. |
| `network-access.png` | Desktop Connections with sharing on, saved proxy port `52342`, and copyable fixture URLs. |
| `network-access-mobile.png` | The same fixed-port state at 390 by 844 CSS pixels. |

The helper enters `52342`, selects **Apply**, checks that sharing remains off, and then uses the real switch to enable it. Capture waits for the saved field, enabled state, and both URL rows. Intercepted requests change only browser fixture state. They never open a real listener or change local settings. The example IPv4 addresses use documentation ranges. The port is a capture example, not a product default.

For the model editor and catalog workflow:

```bash
DOCS_SCREENSHOT_FILTER=model-catalog.png,model-editor.png,model-thinking.png,model-catalog-mobile.png,provider-connection-test.png,model-connection-test.png npm run docs:screenshots
```

| Asset in `docs/assets/screenshots/` | Captured state |
| --- | --- |
| `model-catalog.png` | Search results beside the selected OpenRouter entry and checked import groups. |
| `model-editor.png` | Copied model details, with the catalog ID still editable and the Model section selected. |
| `model-thinking.png` | Imported thinking map and developer-role flag after local ID and limit edits. |
| `model-catalog-mobile.png` | Catalog-match selector above the review, with Back/Copy controls fixed below. |
| `provider-connection-test.png` | Unsaved provider settings and synthetic test feedback. |
| `model-connection-test.png` | Unsaved model settings and synthetic test feedback in the fixed footer. |

The catalog capture helper follows the real search, selection, and copy controls. It checks the copied ID, limits, thinking map, and developer role. Existing overview captures keep their fixture inventory.

Inventories, catalog matches, and connection-test responses are synthetic. Catalog metadata is fixed capture data, not a statement of current provider limits. The handler accepts only the expected fixture test action. It never sends a real provider request or submits configuration or authentication changes.

Use these fixed settings and fixture requirements for refreshed documentation images:

- Desktop viewport: 1440 by 900 CSS pixels
- Mobile viewport: 390 by 844 CSS pixels
- README viewport: 1503 by 818 CSS pixels
- Device scale factor: 2
- Locale: `en-US`
- Time zone: UTC
- Reduced motion: enabled
- General model label: `local/glm-5.3-flash`
- Service-tier exception: eligible `openai-codex` Responses or API-key `openai` Responses with `gpt-6-astra` or `gpt-6.1-sol`
- Vision selector: `local/qwen3.6-27b`, with actual image-input support
- Catalog/editor example: Qwen3.8 27B metadata inside Settings only; the parent composer remains `local/glm-5.3-flash`
- Thought display default: **Collapsed**
- Project captures: `harbor`, `field-notes`, and three sanitized matching folders
- Git review captures: `release-safety` with four sanitized changed files
- Queue captures: the open **Up next** corner tray and the closed **Held** tab with **Resume**
- Activity captures: one selected run, one same-project run, one runtime error, one session with an editable queued task, and a shared-CWD warning
- Settled subagent captures: compact Activity rows and separate Contained Graphite inspectors; five tasks on desktop/export, three on mobile, with one stopped task in each group. Desktop shows saved activity rows; mobile and export show the entry reader.
- Live subagent captures: one running explorer, two reads and one search in the ledger, active verification output, and **Following live** in the footer
- Subagent batch captures: global default 4, desktop/mobile session override 2, the effective source, and **Use global default (4)**
- Sidebar child captures: an inset guide with hollow nodes, a fixed chevron gutter on every parent row, and one completed child beside two running children
- Deep research captures: three completed threads, six ledger sources, four citations, one excluded source, and a mobile citation preview
- Other fixtures: Home, workbench, pinned sessions, project navigation and details, backend settings, composer controls and shell mode, transcript actions, fullscreen previews, memory, subagents, vision delegation, terminal, export, and mobile navigation

Home shows the `standard` chip. Workbench and composer-control captures show `ultrafast`; the mobile-session capture shows its filled bolt. The new speed-menu captures show Fast selected. All use `openai-codex/gpt-6.1-sol`. Both pinned-session captures use two older sanitized sessions in the current project. Other captures return no pinned IDs. The workbench and export include initial and later System dividers. `system-message.png` shows the initial declaration and a later event open in the prompt inspector. The capture waits for real added and removed lines in the diff renderer. Unchanged instructions stay collapsed. That image crops to the dividers and inspector. The export capture checks the instruction-file diff and exact raw event text with the external preview module blocked, then closes the inspector before capture.

These models and settings exist only in the capture fixtures. The command does not change local model configuration.

Each state uses a new browser context. The script uses a fixed date with increasing millisecond ticks and waits for a state selector. `MockWebSocket` replaces the runtime, Git review, and terminal transports. Only the `vite-hmr` protocol uses the native WebSocket. No session, model, or terminal traffic reaches a live backend. The tick prevents Vue's event timestamp guard from dropping interactions.

The capture disables remaining motion.

The script blocks unrecognized `/api/` requests instead of sending them to a live backend. Before capture, it checks visible text and form values for home paths, usernames, repository paths, email addresses, and common credential prefixes.

## Composer issue captures

Refresh the composer issue images with:

```bash
DOCS_SCREENSHOT_FILTER=composer-issue.png,composer-issue-mobile.png,composer-send-unavailable.png npm run docs:screenshots
```

| Asset in `docs/assets/screenshots/` | Captured state |
| --- | --- |
| `composer-issue.png` | Desktop issue chip and open details, with the full error message and Dismiss control. |
| `composer-issue-mobile.png` | The same error above the mobile composer controls. |
| `composer-send-unavailable.png` | A dismissed image warning with the attachment retained, Send disabled, and **Send unavailable** details accessible. |

Desktop captures use a 1440 by 900 CSS-pixel viewport and crop to the composer and open details. Mobile uses 390 by 844 CSS pixels. All captures use device scale factor 2 and the `local/glm-5.3-flash` fixture.

The helper sends a synthetic extension error through the mock runtime WebSocket. The image-warning fixture has no vision model and uses the real attachment chooser. Checks confirm that dismissal retains the draft, attachment, and disabled Send state. No provider request or configuration change reaches a backend.

## Certificate captures

Refresh the desktop and mobile Certificates images with:

```bash
DOCS_SCREENSHOT_FILTER=certificates.png,certificates-mobile.png npm run docs:screenshots
```

| Asset in `docs/assets/screenshots/` | Captured state |
| --- | --- |
| `certificates.png` | Sources beside two saved PEM files, with the system store enabled and the add button in the panel header. |
| `certificates-mobile.png` | The same file list above Sources, with Category set to Certificates. |

The helper checks the file names, per-file counts, trusted total, and enabled controls before capture. `GET /api/pi/settings/tls` returns fixture data. The capture does not read PEM files, inspect the host's certificate stores, or save TLS settings. Counts are illustrative.

Desktop uses 1440 by 900 CSS pixels. Mobile uses 390 by 844. Both use device scale factor 2 and retain `local/glm-5.3-flash` in the composer. See [Trust certificate authorities](../user-guide/settings#trust-certificate-authorities) for the user procedure.

## Automatic-title captures

Refresh the title settings, pending state, and affected Agent defaults overview with:

```bash
DOCS_SCREENSHOT_FILTER=session-title-settings.png,session-title-settings-mobile.png,session-title-generating.png,vision-agent.png npm run docs:screenshots
```

| Asset in `docs/assets/screenshots/` | Captured state |
| --- | --- |
| `session-title-settings.png` | Desktop Agent defaults with automatic titles enabled, `local/glm-5.3-flash`, and the lowest supported thinking mode. |
| `session-title-settings-mobile.png` | The same title controls in mobile Settings. |
| `session-title-generating.png` | A new conversation with its first accepted message and **Generating title…** in the header and sidebar. |
| `vision-agent.png` | Agent defaults with automatic titles off above the configured vision controls. |

The settings helper selects the model and enables titles through the real controls. GET and PUT requests change only intercepted fixture state. The pending capture uses a synthetic runtime snapshot with `state.titleGenerating: true`, one user message, and no existing session name. No title request reaches a model provider.

Desktop captures use 1440 by 900 CSS pixels. Mobile uses 390 by 844. Both use device scale factor 2. Check the title model, independent thinking selection, switch state, and both pending labels.

## Dictation captures

Refresh the dictation images with:

```bash
DOCS_SCREENSHOT_FILTER=dictation.png,dictation-settings.png,dictation-mobile.png npm run docs:screenshots
```

| Output | Captured state |
| --- | --- |
| `docs/assets/screenshots/dictation.png` | Desktop composer showing local dictation in progress, the responsive audio waveform, and the Finish control. |
| `docs/assets/screenshots/dictation-settings.png` | Desktop Dictation settings showing the local speech model, language, and microphone controls. |
| `docs/assets/screenshots/dictation-mobile.png` | Mobile composer showing local dictation in progress and its recording controls. |
| `assets/readme/dictation.png` | Composer dictation state in the README frame. |

Desktop captures use 1440 by 900 CSS pixels. Mobile uses 390 by 844. The README uses 1503 by 818. All captures use device scale factor 2.

Use a mock dictation host and test audio or meter data. Keep the chat model at `local/glm-5.3-flash`, separate from the Parakeet speech model. Do not request microphone access, download model files, or send a live model request during capture.

## Trace captures

Refresh the tracing set with:

```bash
DOCS_SCREENSHOT_FILTER=trace-inspector.png,trace-workspace.png,trace-explorer.png,trace-capture.png,trace-mobile.png,tracing.png npm run docs:screenshots
```

| Output | Captured state |
| --- | --- |
| `docs/assets/screenshots/trace-inspector.png` | Session Inspector with a selected observation and retained payload. |
| `docs/assets/screenshots/trace-workspace.png` | Workspace timeline and detail for the same session run. |
| `docs/assets/screenshots/trace-explorer.png` | Selected-backend Explorer across sanitized projects, with a selected preview. |
| `docs/assets/screenshots/trace-capture.png` | Expanded capture controls and selected model observation. |
| `docs/assets/screenshots/trace-mobile.png` | Mobile Inspector with reachable detail and capture footer. |
| `assets/readme/tracing.png` | Workspace in the README frame. |

Desktop documentation images use 1440 by 900 CSS pixels. Mobile uses 390 by 844. The README uses 1503 by 818. All captures use device scale factor 2.

Trace fixtures supply summaries, observations, pagination, and capture status. Capture controls and bookmarks change only intercepted fixture state. Trace routes, runtime streams, and other API requests must never fall through to real backend data or model requests.

Keep the general model label `local/glm-5.3-flash`. Preserve the approved eligible service-tier model and image-capable vision fixture exceptions. Do not use local trace records, private paths, or operational performance reports as documentation fixtures.

Review trace labels, usage, timing, omission markers, selected observations, mobile panel switches, and the capture footer. Check that Explorer identifies the selected backend and does not imply aggregation across connections. See [Tracing](../user-guide/tracing) and [Elune integration](../integrations/elune).

## Review documentation images

Open every changed image. Check these items:

1. All text is readable and correct.
2. No text or control is clipped.
3. The image has no private path, project, prompt, account, or credential data.
4. Hover, focus, loading, menu, and animation states appear only when they explain the documented action.
5. General model selectors show `local/glm-5.3-flash`. Service-tier captures use an eligible OpenAI model and authentication path.
6. The vision selector shows `local/qwen3.6-27b` and excludes text-only models.
7. System captures show the intended prompt and tool deltas without clipping.
8. Subagent inspectors show the selected task, its outcome, and live activity or a saved result without inline task bodies in Activity.
9. Sidebar children sit inside the parent and use hollow nodes. Parent titles align across rows with and without chevrons. Pin markers sit beside the time or status on the right.
10. Each Markdown image reference resolves in both documentation base paths.

Run the PNG structure audit from the documentation screenshot skill when it is available. Check whitespace and both documentation base paths:

```bash
git diff --check
npm run docs:build
VITEPRESS_BASE=/ npm run docs:build
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
