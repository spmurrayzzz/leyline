# Editing, forking, and compaction

Editing a user message navigates the pi session tree to that entry before submitting the replacement prompt through the same-session edit flow.

Forking creates a new session at an entry with `runtime.fork(entryId, { position: 'at' })`. Forking is refused while the selected session is streaming or compacting.

Compaction controls create compaction cards and pills, and can include custom compaction instructions.
