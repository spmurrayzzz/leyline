# Agent UI Project Notes

- Work iteratively: discuss the next change, set expectations, implement only
  after approval, then let the user validate in the browser.
- For visual UI work, the user will keep the Vite dev server running for you,
  so that you can validate with screenshots/browser before moving on. You may
  need to tell them to restart on config changes.
- Use Vue 3, Vite, Node.js, and JavaScript. Do not introduce TypeScript.
- Prefer simple CSS and small focused changes. No component library unless the
  user asks.
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

## Memory maintenance

- Read `MEMORY.md` at the start of future sessions before making changes.
- Keep `MEMORY.md` up to date when project direction, architecture, pi SDK
  learnings, workflows, or important UI decisions change.
- Update `MEMORY.md` at natural checkpoints or when the user asks for a memory
  refresh. Be detailed but concise: capture decisions and rationale, not every
  line-by-line edit.
- If `AGENTS.md` and `MEMORY.md` disagree, ask the user or inspect recent code;
  do not silently assume the older note is correct.
