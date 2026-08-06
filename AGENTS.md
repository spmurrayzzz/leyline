# Agent UI Project Notes

- Work iteratively: discuss the next change, set expectations, implement only
  after approval, then let the user validate in the browser.
- For visual UI work, the user will keep the Vite dev server running for you.
  Use the screenshot workflow to validate changes. Tell the user when a config
  change requires a Vite or Electron restart.
- Use Vue 3, Vite, Node.js, and JavaScript. Do not introduce TypeScript.
- Use `docs/motivations.md` as an alignment vector for product direction:
  reduce agent workflow pain, keep the interface malleable, avoid noisy
  dashboards, and do not drift toward IDE replacement.
- Prefer simple CSS and small focused changes. Do not add a component library
  unless the user asks.
- Keep transcript styles in `src/styles/transcript.css` and
  `src/styles/tools.css` visually in sync with export styles in
  `server/pi-api/export-renderer.js`.
- The UI must use pi SDK and runtime state instead of reimplementing session management.
- Browser development mounts the modular `server/pi-api/` backend through
  `vite.config.js`. Packaged Electron uses the same API through
  `server/leyline-server.js`.
- Current pi SDK usage includes:
  - `SessionManager.listAll()` for standard session discovery.
  - `SessionManager.open(path)` and `getBranch()` for persisted transcripts.
  - `AgentSessionRuntime` handles for prompts, shell commands, edits, forks,
    compaction, reload, and background runtime state.
  - Runtime primitives for session creation, navigation, and child sessions.
- Current UI state includes:
  - The sidebar groups sessions by cwd and supports fuzzy search against visible
    labels.
  - The workbench shows the selected branch and live runtime output.
  - Markdown uses `markdown-it` with raw HTML disabled.
  - Thought, skill, and tool rows can expand. Tool rows start collapsed.
  - The composer submits prompts, images, shell commands, slash commands,
    steering messages, and follow-up messages to pi.
  - The composer stays available during active runs. Enter sends steering,
    Option+Enter sends a follow-up, and Shift+Enter adds a line break.
  - Memory, Project Details, Settings, Runtime events, previews, and the terminal
    use focused drawers or overlays.
- Screenshot workflows assume the dev server is running at `http://localhost:5173/`:
  - `npm run screenshot` writes the current local state to `screenshots/current.png`.
  - `npm run docs:screenshots` refreshes sanitized tracked documentation assets.
- Build check:
  - `npm run build`
- Do not add tests, docs, or broad refactors unless explicitly requested.
- If the user asks what to work on next and you have not read the code, research
  the codebase before you recommend work. Do not guess from old notes or
  `MEMORY.md`.
- `fnm` is used for Node.js version management.

## Memory maintenance

- At the start of a new session, use `list_memory` to review relevant injected
  global, project, and session context before you recommend or edit.
- Use Leyline memory tools for durable local memory instead of editing
  `MEMORY.md`.
- Use `list_memory` or `search_memory` when prior context was not injected.
- Use `record_memory` when project direction, architecture, pi SDK knowledge,
  workflows, or important UI decisions change.
- Choose scope intentionally:
  - `session`: current-thread facts, pending work, failed attempts, or decisions
    that must survive compaction but must not affect other sessions.
  - `project`: stable Leyline facts, architecture direction, workflows,
    project-specific problems, or project-specific user preferences.
  - `global`: stable user or Leyline and pi preferences that apply across
    projects.
- Record concise Markdown. Save durable decisions, reasons, and reusable facts.
  Do not save each code edit.
- When the user asks which lessons to remember after a fix, prefer the reusable
  lesson. Save implementation details only when they change architecture or
  workflow.
- If the scope or text of a proposed memory is unclear, summarize it and ask the
  user before you record it.
- Use `update_memory` to correct memory. Use `archive_memory` when memory is
  obsolete or the user asks you to forget it.
- If `AGENTS.md` and memory disagree, ask the user or inspect current code. Do
  not silently use the older information.
