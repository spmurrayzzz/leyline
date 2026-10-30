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
| `transcript.css` | Messages, skill-prompt headers, System dividers, Markdown, thinking, feedback, and entry actions |
| `tools.css` | Prompt and subagent inspectors, Activity cards, compact tool and skill-read rows, files, diffs, and fullscreen previews |
| `composer.css` | Composer, menus, attachments, context, and send states |
| `memory.css` | Memory Inspector |
| `review.css` | Git review rail, file list, diff states, resizing, and expanded layout |
| `research.css` | Research progress, reports, source rail, citation preview, and sidebar markers |
| `settings.css` | Global Settings, provider/MCP workspaces, scoped agent controls, and contextual drawers |
| `modals.css` | Project browser and confirmation dialogs |
| `terminal.css` | Terminal drawer |
| `responsive.css` | Reduced-motion and viewport overrides |

Put a rule in the narrowest owning module. Keep `src/style.css` free of component rules.

System events use muted, centered dividers with document and panel icons and plain summary text. Keep them separate from tool cards. The prompt inspector uses **Prompt**/**Changes** and **Tools** tabs, readable Markdown, and simple section separators. Do not add nested section cards.

The app's System prompt inspector always overlays the right side below the header. At 760 pixels or less, it fills the width below the header. The export's System prompt inspector reserves space above 1120 pixels and uses a full-height overlay below that width. It fills the viewport width at 760 pixels or less.

## Sidebar subagent tree

All regular session rows reserve an 18-pixel chevron gutter with a 4-pixel gap before the title. Rows without children leave the gutter empty. Pin markers sit beside the time or status in the right metadata group. On desktop, row actions replace these details on hover or keyboard focus. The research marker stays after the title.

The entire child branch sits inset under its parent, with a vertical guide and hollow nodes.

Explicit chevron toggles unfold or collapse the branch as one unit in up to 180 ms, with a shared fade and no stagger. Animated heights drive virtualized row positions and spacers so following rows move with the branch. Reduced motion disables the fold animation. Scroll, search, and reload do not start it.

## Activity and subagent inspector layout

Activity cards retain full message width and assistant-message colors. The collapsed card shows only the newest call in a fixed-height row, with outcome counts in its header. When the only top-level call is `subagent`, the header and row open the inspector without expansion, even for parallel tasks. Multi-call groups retain expansion.

The subagent inspector floats on the right, with a 700-pixel width cap and 16-pixel desktop margins. At 760 pixels or less, it becomes a full-width bottom sheet at roughly 90 percent of the available viewport height. Its bounded task list and reader scroll independently. Opening the inspector does not expand the transcript layout.

The Contained Graphite treatment uses `#242427` for chrome and `#1c1c1f` for the reading area. The small header label above the title carries the agent name. The meta row shows Model, Thinking, task status, and research source counts as chips. **Full task prompt** sits beside the Copy and Close controls in the desktop header and becomes a full-width 44-pixel row below the title at 760 pixels or less. Model text truncates only when the chip runs out of room, with no fixed character cap.

The connection state appears beside the **Activity** counts, and the footer keeps the following and reading states. One neutral bordered inset card contains the latest response or thought, an icon, and **Read full**. A compact **Activity** heading shows entry and call counts.

Task selection uses a flat neutral background. Ledger rows use small icon tiles, action labels, targets or excerpts, outcome pills, and secondary character counts. Keep rows flat with fine separators, without raised cards or inner shadows. Only the outer sheet has a shadow.

Single-task inspectors use the task title directly, without a duplicate summary strip. Each ledger row shows an action, source-derived content or target, outcome, and character count. Full entries and the full task prompt open in the same sheet. The follow control stays in the footer. New output must not move a paused reader.

`tools.css` owns these styles, including research-thread results in the subagent inspector. `research.css` no longer contains legacy subagent result-row styles. Export uses matching shell and result rules in `exportCss()` for its native dialog. Keep this layout separate from the System prompt inspector and trace Inspector layouts.

## Settings layout

Global Settings uses one stable frame, up to 1180 by 820 pixels, with 24-pixel desktop margins. Mobile layouts fill the viewport and replace category navigation with a selector.

Provider and MCP lists and details scroll independently within bounded flex/grid containers. Use `min-height: 0` and keep notices bounded. Do not add fixed pane-height caps or an outer content scroller that extends behind the footer.

The modal initially focuses its container without a visible category highlight. Tab reveals thin neutral focus outlines. Active categories retain their gray selected background. Preserve focus containment, Escape handling, and focus restoration.

## Tokens

Add shared values to `tokens.css` only when more than one surface needs them. Prefer existing `--motion-*`, `--ease-*`, and color tokens.

Do not add a token to avoid one clear local value. Do not duplicate syntax colors between app modules.

The current base colors are neutral. The primary accent is `--accent: #8a78ff`.

## Motion

Motion must explain state change. Coordinate opacity and transform changes for entry, drawer, picker, and handoff states.

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

The subagent inspector uses opacity and horizontal transforms on desktop, with vertical transforms for the mobile bottom sheet. Its local reduced-motion rules remove transitions. Export uses corresponding dialog entry animations and disables them for reduced motion.

### Subagent task changes

`SubagentInspector.vue` uses the Web Animations API for reader and footer handoffs. The outgoing reader remains visible until the next preview is ready. Its 250 ms exit overlaps the incoming reader's 420 ms entrance. Task changes start the incoming reader 8 pixels below its final position and move the outgoing reader upward by 4 pixels. Entry uses `cubic-bezier(.22,1,.36,1)`. Exit uses `cubic-bezier(.2,0,0,1)`.

Opening a full entry starts the incoming reader 14 pixels to the right and moves the outgoing reader 5 pixels left. **Back to activity** starts the incoming reader 14 pixels to the left and moves the outgoing reader 5 pixels right.

Footer changes take 250 ms. The task-selection marker tracks the selected button without a timed transition. Grid layers keep the modal frame and reader viewport fixed during each handoff.

Rapid selections target the latest task without waiting for prior exits. An interrupted entrance starts its exit from its current opacity and transform. Live text updates do not restart the handoff. Task selection, saved scroll positions, and paused scrollback remain intact.

Reduced motion sets the scripted animation duration to zero. HTML exports keep the same settled layout without the app's staged live-preview handoff.

### Subagent ledger updates

New and removed rows open or close their space over 300 ms. Neighboring rows move with them. Status changes fade in place, with the outgoing label fading sooner. An excerpt can reveal when it first becomes available. Text changes within an existing excerpt do not replay that reveal.

The inspector shares a six-row motion budget across entrances, removals, status changes, excerpt changes, and small reorders. Other rows update immediately, without an animation queue. Initial history, reloads, task or reader changes, paused scrollback, and reduced motion do not replay row entrances. Live-to-saved reconciliation and late saved results preserve row identity rather than restarting entrances.

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
- Activity cards, outcome counts, compact tool rows, and skill rows
- subagent inspector layout, Action ledger, full-entry and prompt readers, task selection, following, and Markdown results
- research reports, threads, citations, and source ledgers
- image, file, patch, and diff previews
- responsive and reduced-motion behavior

The export has extra header and standalone-page rules. It does not need to match the application shell.

## Visual validation

Run the browser app at `http://localhost:5173/`. Use `npm run screenshot` for a local visual check.

Inspect the live workbench and an HTML export when transcript CSS changes. The screenshot command does not validate export CSS.

Do not promote a local capture into documentation without a privacy and currency review.
