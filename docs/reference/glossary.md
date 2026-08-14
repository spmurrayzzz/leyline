# Glossary

- **Active run**: Work that a pi runtime is currently generating or executing.
- **Backend connection**: A named Leyline server URL that a window can use for
  sessions, runtime events, terminal traffic, and exports.
- **Compaction**: A pi operation that replaces older context with a shorter
  summary to reduce context use.
- **Composer**: The input area for prompts, images, shell commands, slash
  commands, steering, and follow-up messages.
- **Context usage**: The current number and percentage of model context tokens.
- **Follow-up**: A message that pi runs after the active turn finishes. Use
  Option+Enter during an active run.
- **Fork**: A new pi session that starts from a selected transcript entry.
- **Leyline trash**: The directory where Leyline moves a deleted session JSONL
  file. It is a timestamped `leyline-trash` directory next to the configured pi
  session directory.
- **Memory**: Local Markdown context in global, project, or session scope.
- **Native backend**: The backend that supplied the current Leyline app.
- **Memory Inspector**: The **Memory** drawer for creating, editing, archiving,
  restoring, and deleting visible memory.
- **Pi session**: A persisted, tree-structured JSONL conversation log managed by
  pi.
- **Project**: A working directory that groups sessions in Leyline.
- **Project Details**: A project drawer for filtering, sorting, creating,
  opening, renaming, and deleting sessions.
- **Runtime**: The live pi session object that runs prompts, tools, shell
  commands, and model operations.
- **Runtime events**: The **Events** drawer data from the selected backend's
  event stream.
- **Session scope**: Data that applies to one session file.
- **Steering**: A message sent to the current active run. Use Enter during an
  active run.
- **Subagent**: A child pi session that runs a delegated task with isolated
  context.
- **Thought**: A collapsed or expanded transcript row that contains available
  model reasoning output.
- **Tool row**: A collapsed or expanded transcript row for a tool call and its
  result.
- **Transcript**: The selected branch of a pi session as Leyline displays it.
- **Vision agent**: The `vision_agent` tool. It starts a hidden child session
  to inspect an image for a parent model that cannot receive images.
- **Vision model**: The image-capable model selected for vision delegation.
- **Workbench**: The selected-session area with the header, transcript,
  composer, drawers, and terminal.
