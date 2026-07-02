# Subagent Extension

Delegate tasks to specialized child agents with isolated context windows.

## Architecture

This extension communicates with Leyline's server via a local API endpoint
(`POST /api/pi/subagent`). The server creates child sessions directly via
the pi SDK — no subprocess spawning needed. This means:

- Child sessions have proper `parentSession` set via `SessionManager.newSession()`
- No `--parent-session` CLI flag dependency
- No subprocess overhead

## Modes

- **single**: One child agent for one task (default)
- **parallel**: Multiple agents running concurrently
- **chain**: Sequential agents where each receives prior output via `{previous}`

## Agent definitions

Place `.md` files with YAML frontmatter in:

- `~/.pi/agent/agents/` (global)
- `.pi/agents/` (project-local, found by walking up from cwd)

See `.pi/agents/` for examples.

## Leyline rendering

Subagent tool calls appear as clickable cards in the transcript. Clicking
navigates to the child session. Child sessions are hidden from the sidebar
(filtered by `parentSessionPath`).
