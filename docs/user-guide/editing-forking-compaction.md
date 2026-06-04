# Editing, forking, resetting, and compaction

Editing a user message navigates the pi session tree to that entry before submitting the replacement prompt through the same-session edit flow.

Forking creates a new session at an entry with `runtime.fork(entryId, { position: 'at' })`. Forking is refused while the selected session is streaming or compacting.

## Reset to Here

The **Reset to here** action allows you to truncate the current session's timeline back to a specific transcript entry.

- **How it works**: When you click the Reset button (located in the action overlay of a transcript entry), Leyline rewrites the session's underlying append-only log file to discard all subsequent messages and state after that entry.
- **Constraints**: 
  - The target entry must reside on the active thread/branch.
  - Resetting is refused if the session is currently streaming or compacting.
  - This is a destructive operation that physically alters the session file. If you want to keep the subsequent history, use **Forking** instead to start a new parallel session from that point.

## Compaction

Compaction controls create compaction cards and pills, and can include custom compaction instructions.

