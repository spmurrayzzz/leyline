# Memory integration

Leyline bundles the memory extension from `.pi/extensions/memory/index.ts`. The runtime loads it through `resourceLoaderOptions.additionalExtensionPaths`.

The extension stores durable Markdown memory. The Memory Inspector uses server routes in `server/pi-api/memories.js` to read and change the same records.

## Storage and scope

The default database is:

```text
~/.local/share/leyline/memory.sqlite
```

The `memories` table uses three scopes:

- `global` records are visible in all projects and sessions.
- `project` records are visible under one project root.
- `session` records are visible only for one session file.

Leyline finds the nearest parent directory that contains `.git`. If it finds no Git root, it uses the current working directory. It derives project and session IDs from SHA-256 hashes of canonical paths.

The database also contains `subagent_overrides` and `rollout_feedback` tables. Rollout labels can be `helpful` or `unhelpful`, with an optional note. Leyline adds this feedback to transcript entries when it builds session detail.

## Runtime context

At session start, the extension loads active memory into three caches. Before each agent turn, it adds a bounded memory block to the system prompt.

The current limits are:

- 8 global records
- 12 project records
- 16 session records
- 16 KiB for the complete injected block

New and changed records affect future turns. They do not change context that the model already received.

Memory has lower priority than system and developer instructions, the current request, project instructions, and verified repository data.

## Agent tools and command

The extension registers these tools:

- `list_memory` lists visible active or archived records.
- `search_memory` searches visible content, reasons, and tags.
- `record_memory` creates a record.
- `update_memory` replaces the content, reason, and tags of a visible record.
- `archive_memory` archives visible records without deleting them.

The `/memory` command shows the database and context. `/memory list` lists active records. `/memory search <query>` searches active records.

The browser API also supports create, edit, archive, restore, and permanent delete operations. See the [API reference](../reference/api#memory-inspector-routes).

## Path override

Set `LEYLINE_MEMORY_DIR` before Leyline starts to use a different data directory. The memory extension, Memory Inspector, subagent overrides, and rollout feedback then use `memory.sqlite` in that directory.
