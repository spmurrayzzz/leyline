# Leyline Memory Extension

This extension gives Leyline and pi agents persistent local memory.

## Storage

By default, the extension uses this SQLite database:

```text
~/.local/share/leyline/memory.sqlite
```

The default database is shared with the Leyline Memory Inspector, rollout
feedback, and subagent model overrides. It can contain these application
tables:

- `memories`
- `rollout_feedback`
- `subagent_overrides`

The extension creates and uses the `memories` table. Memory content is Markdown
in a row. Global, project, and session scopes are row attributes.

### Custom data directory

Set this variable before Leyline starts to change the shared data directory:

```bash
LEYLINE_MEMORY_DIR=/path/to/dir
```

The memory extension, Memory Inspector, rollout feedback, and subagent model
overrides then use `/path/to/dir/memory.sqlite`.

## Scopes

- `global`: Stable user or Leyline and pi preferences across projects.
- `project`: Stable repository facts, architecture, workflows, known problems,
  or project-specific preferences.
- `session`: Current-thread facts, pending work, failed attempts, or decisions
  that must survive compaction without affecting other sessions.

Project scope uses the nearest Git root. If no Git root exists, it uses the
current working directory. Session scope uses the canonical session-file path.

## Tools

### `list_memory`

List active or archived memory that is visible to the current session. The tool
accepts a scope, status, and limit.

### `search_memory`

Search visible memory content, reasons, and tags.

### `record_memory`

Create one Markdown memory row.

Use this tool for an explicit request to remember information or for a durable
fact that can help a later session. Do not store credentials, tokens, passwords,
private keys, or unnecessary personal data.

### `update_memory`

Replace the content, reason, or tags of one visible memory row by ID.

### `archive_memory`

Archive one or more visible rows without deleting them.

## Command

```text
/memory
```

Show the database path, project path, session path, and active memory counts.

```text
/memory list [global|project|session|all]
/memory search <query>
```

The list and search commands show active memory only and return up to 20 rows.

## Prompt injection

The extension reads active memory when a session starts. Before each agent turn,
it refreshes the cache and adds a bounded memory block to the system prompt.

The prompt includes at most 8 global rows, 12 project rows, and 16 session rows.
The complete injected block has a 16 KiB limit.

Memory is context. It does not override system or developer instructions, the
current user request, `AGENTS.md`, repository documentation, or current code
evidence.
