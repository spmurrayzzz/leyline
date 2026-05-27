# Agent UI Project Notes

- Work iteratively: discuss the next change, set expectations, implement only
  after approval, then let the user validate in the browser.
- For visual UI work, the user will keep the Vite dev server running for you,
  so that you can validate with screenshots/browser before moving on. You may
  need to tell them to restart on config changes.
- Use Vue 3, Vite, Node.js, and JavaScript. Do not introduce TypeScript.
- Use `docs/motivations.md` as an alignment vector for product direction:
  reduce agent workflow pain, keep the interface malleable, avoid noisy
  dashboards, and do not drift toward IDE replacement.
- Prefer simple CSS and small focused changes. No component library unless the
  user asks.
- Keep in-app transcript styles in `src/style.css` and export transcript styles
  in `server/pi-api.js` visually in sync. When changing message/tool/thinking
  transcript CSS in one place, compare and update the other unless the user
  explicitly wants them to differ.
- The UI should rely on pi SDK/state instead of reinventing pi state management.
- Current backend integration uses Vite middleware in `server/pi-api.js`.
- Current pi SDK usage:
  - `SessionManager.listAll()` for sidebar sessions.
  - `SessionManager.open(path)` and `getBranch()` for selected transcripts.
  - Tool results are matched to assistant `toolCall` blocks for better labels.
- Current UI state:
  - Sidebar groups sessions by cwd/project.
  - Sidebar search uses fzf-style fuzzy matching against visible labels only.
  - Main pane renders selected session transcript and auto-scrolls to latest.
  - Markdown is rendered with `markdown-it` and raw HTML disabled.
  - Tool rows are collapsed by default and expandable on click.
  - Composer is enabled, but local-only; it does not change pi session state.
- Screenshot workflow:
  - `npm run screenshot`
  - writes `screenshots/current.png`
  - assumes dev server is running at `http://localhost:5173/`.
- Build check:
  - `npm run build`
- Do not add tests, docs, or broad refactors unless explicitly requested.
- If the user asks what to work on next, and you haven't ready any of the code,
  you need to research the codebase to ground your recommendation. Do not guess
  or assume based on the last notes or MEMORY.md file.
- `fnm` is used for Node.js version management.

## Memory maintenance

- At the start of a new session, use `list_memory` to review relevant injected
  global/project/session context before making recommendations or edits.
- Use Leyline memory tools for durable local memory instead of editing
  `MEMORY.md`.
- Use `list_memory` or `search_memory` when you need prior project/session/global
  context that was not injected automatically.
- Use `record_memory` when project direction, architecture, pi SDK learnings,
  workflows, or important UI decisions change.
- Choose scope intentionally:
  - `session`: transient current-thread facts, pending work, failed attempts, or
    decisions that should survive compaction but not leak to other sessions.
  - `project`: stable Leyline repo facts, architecture direction, workflows,
    gotchas, or project-specific user preferences.
  - `global`: stable user or Leyline/pi preferences that apply across projects.
- Record concise Markdown with the reason when useful. Capture decisions and
  rationale, not every line-by-line edit.
- Use `update_memory` to correct an existing memory and `archive_memory` when a
  memory is stale or the user asks to forget it.
- If `AGENTS.md` and memory disagree, ask the user or inspect recent code; do not
  silently assume the older note is correct.
