# Styling and motion

Leyline uses plain CSS modules under `src/styles/`. `src/style.css` is an imports-only entry file.

## Visual direction

Use neutral near-black backgrounds and charcoal surfaces. Use the purple accent for selection, focus, and small status details.

Keep panels quiet and borders low contrast. Do not turn the workspace into a purple dashboard.

Use `Agent` for assistant labels. Do not use `Leyline` as the speaker label.

Avoid decorative glow, gradients, and extra panels. Existing gradients serve fades, masks, previews, or compact visual structure.

## Style module ownership

| File | Ownership |
| --- | --- |
| `tokens.css` | Color, syntax, type, dimensions, easing, and duration tokens |
| `motion.css` | Shared keyframes |
| `shell.css` | App grid, header, sidebar, and start shell |
| `topbar.css` | Runtime chrome and workbench header |
| `workbench.css` | Workbench layout, loading, start, and empty states |
| `transcript.css` | Messages, System dividers, Markdown, thinking, feedback, and entry actions |
| `tools.css` | Prompt inspector, tools, skills, subagents, files, diffs, and fullscreen previews |
| `composer.css` | Composer, menus, attachments, context, and send states |
| `memory.css` | Memory Inspector |
| `review.css` | Git review rail, file list, diff states, resizing, and expanded layout |
| `research.css` | Research progress, reports, thread cards, source rail, citation preview, and sidebar markers |
| `settings.css` | Global Settings, provider/MCP workspaces, scoped agent controls, contextual drawers, and Runtime events |
| `modals.css` | Project browser and confirmation dialogs |
| `terminal.css` | Terminal drawer |
| `responsive.css` | Reduced-motion and viewport overrides |

Put a rule in the narrowest owning module. Keep `src/style.css` free of component rules.

System events use muted, centered dividers with document and panel icons and plain summary text. Keep them separate from tool cards. The prompt inspector uses **Prompt**/**Changes** and **Tools** tabs, readable Markdown, and simple section separators. Do not add nested section cards.

Above 1120 pixels, the app reserves a column for the inspector. From 761 to 1120 pixels, the inspector overlays the right side below the header. At 760 pixels or less, it fills the width below the header. Export reserves space above 1120 pixels and uses a full-height overlay below that width. Its inspector fills the viewport width at 760 pixels or less.

## Settings layout

Global Settings uses one stable frame, up to 1180 by 820 pixels, with 24-pixel desktop margins. Mobile layouts fill the viewport and replace category navigation with a selector.

Provider and MCP lists and details scroll independently within bounded flex/grid containers. Use `min-height: 0` and keep notices bounded. Do not add fixed pane-height caps or an outer content scroller that extends behind the footer.

The modal initially focuses its container without a visible category highlight. Tab reveals thin neutral focus outlines. Active categories retain their gray selected background. Preserve focus containment, Escape handling, and focus restoration.

## Tokens

Add shared values to `tokens.css` only when more than one surface needs them. Prefer existing `--motion-*`, `--ease-*`, and color tokens.

Do not add a token to avoid one clear local value. Do not duplicate syntax colors between app modules.

The current base colors are neutral. The primary accent is `--accent: #8a78ff`.

## Motion

Motion must explain state change. Use short opacity and transform changes for entry, drawer, picker, and handoff states.

Use explicit transition properties. Do not use `transition: all`.

Prefer opacity, transform, color, border color, and background color. Avoid animating layout unless the motion explains docking, resizing, or reserved space.

The current motion families include:

- session shell, composer docking, and review-pane grid changes
- optimistic user-message handoff
- live assistant start
- live tool progress and settle
- drawer and picker entry
- loading skeleton reveal

`App.vue` tracks newly persisted entry IDs for 300 ms. The current stylesheet does not apply a normal-motion entry animation to that class.

The prompt inspector uses short opacity and horizontal transform transitions in `tools.css`. Its local reduced-motion rule removes those transitions.

## Reduced motion

`responsive.css` starts with the `prefers-reduced-motion: reduce` rules. These rules shorten transitions and remove keyframe animation.

Add every new animation to this section. Preserve state visibility when motion is removed.

JavaScript scrolling also checks the reduced-motion preference. Do not rely only on CSS for scripted motion.

## Transcript and export synchronization

The app transcript uses `src/styles/transcript.css` and `src/styles/tools.css`. Shared colors and syntax tokens come from `src/styles/tokens.css`.

HTML export cannot import the app style modules. `server/pi-api/export-renderer.js` contains a separate `exportCss()` string.

When transcript visuals change, compare and update both implementations. Check these areas:

- user and assistant messages
- thinking blocks
- summary cards
- Markdown and code blocks
- syntax colors
- System dividers and prompt inspectors
- collapsed tool, skill, and subagent rows
- research reports, threads, citations, and source ledgers
- image, file, patch, and diff previews
- responsive and reduced-motion behavior

The export has extra header and standalone-page rules. It does not need to match the application shell.

## Visual validation

Run the browser app at `http://localhost:5173/`. Use `npm run screenshot` for a local visual check.

Inspect the live workbench and an HTML export when transcript CSS changes. The screenshot command does not validate export CSS.

Do not promote a local capture into documentation without a privacy and currency review.
