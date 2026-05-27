# Leyline Memory Extension

Persistent local memory for Leyline/pi agents.

## Storage

Memory is stored in one SQLite database:

```txt
~/.local/share/leyline/memory.sqlite
```

Override the directory with:

```bash
LEYLINE_MEMORY_DIR=/path/to/dir
```

The database uses one application table, `memories`. Global, project, and
session memory are row scopes, not separate tables or documents.

Memory content is stored as Markdown in each row.

## Scopes

- `global`: stable user or Leyline/pi preferences that apply across projects.
- `project`: stable repo facts, architecture direction, workflows, gotchas, or
  project-specific user preferences.
- `session`: transient current-thread facts, pending work, failed attempts, or
  decisions that should survive compaction but not leak to other sessions.

## Tools

### `list_memory`

List active or archived memory entries visible to the current session.

### `search_memory`

Search visible memory entries with text matching.

### `record_memory`

Create one new Markdown memory row.

Use it when the user asks to remember something or when a durable fact is likely
to help future sessions. Do not store secrets, credentials, tokens, passwords,
private keys, or unnecessary personal data.

### `update_memory`

Correct an existing visible memory entry by id.

### `archive_memory`

Archive obsolete visible memory entries without deleting them.

## Command

```txt
/memory
```

Shows the database path, project path, session path, and active memory counts.

```txt
/memory list [global|project|session|all]
/memory search <query>
```

## Prompt injection

At session start, the extension reads active global, project, and session
memories. Before each agent turn, it injects a bounded memory block into the
system prompt when memories are available.

Memory is context, not higher-priority instruction. It does not override system
or developer instructions, the current user request, `AGENTS.md`, repository
docs, or direct code evidence.
