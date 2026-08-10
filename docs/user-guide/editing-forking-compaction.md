# Editing, forking, resetting, and compaction

Transcript actions change the active branch or create a new session. Use **Fork from here** when you must keep both paths.

![User message actions for editing, retrying, forking, resetting, and copying](../assets/screenshots/transcript-actions.png)

*A saved user-message header contains the history actions.*

## Edit a user message

1. Find the user message.
2. Select **Edit message** in its header.
3. Change the text or attached images in the composer.
4. Send the replacement prompt.

The composer shows **Editing earlier message · send to replace the current branch**. Select **Cancel** to leave edit mode.

Editing moves the active branch to that user message. The replacement prompt then starts a new branch from that point.

You cannot edit during a run or compaction. Only saved user messages can be edited.

## Retry a user request

1. Find the user message.
2. Select **Retry request**.

Leyline resubmits the same text and images from that point. The active branch changes to the new response path.

Retry is unavailable during a run, compaction, reload, or session activation.

## Fork from an entry

1. Find the message or tool entry.
2. Select **Fork from here**.

Leyline creates and selects a new session at that entry. The original session and its later history remain unchanged.

Forking is unavailable while the selected session runs or compacts. Transcript-level subagent cards do not provide this action.

## Reset to here

**Reset to here** permanently removes every later record from the current session file. It also removes later state from that file.

1. Find the target message or tool entry on the active branch.
2. Select **Reset to here**.

Leyline performs this action immediately. It does not show a confirmation dialog.

Reset is unavailable during a run or compaction. Use **Fork from here** first when you must keep the later history.

## Copy an entry

Select **Copy** in a message or tool header. Leyline copies message text or the available tool output.

## Compact the session context

1. Enter `/compact` in the composer.
2. Add optional custom instructions after the command.
3. Press **Enter**.

Pi creates a **Compaction** summary in the transcript. Compaction reduces the context that later turns must carry.

Compaction requires existing messages. It cannot run during a response, edit operation, or other compaction.
