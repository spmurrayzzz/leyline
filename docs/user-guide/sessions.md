# Sessions

A session contains one pi conversation tree. Leyline shows the active branch as a transcript.

## Select a session

1. Find the session in the current project list.
2. Select the session name.

Select **Change project** first when the session belongs to a different project.

You can also focus a session row and press **Enter** or **Space**. Press **Arrow Up** or **Arrow Down** to focus another row.

A selected session uses the route `/sessions/<encoded-id>`. The start screen uses `/`.

## Browse the session list

The sidebar shows all regular sessions in the current project. It orders them from most recent modification to oldest.

The **Sessions** heading shows the session count. The list scrolls when it is longer than the available space.

Enter a session name or ID in **Search sessions** to filter the current project.

A flask after the title identifies a [deep research session](./deep-research). The marker remains visible after the run finishes.

## Read runtime status

A session row can show these states:

- **running**: the agent is producing a response.
- **compacting**: pi is compacting the session context.
- **unread**: a background run finished or reported an error.
- **+N queued**: steering or follow-up messages are waiting.
- **error**: the background runtime reported an error.
- **plan**, **gather**, **synthesize**, or **report**: a research run is in that phase.
- **gather N/N**: that many research threads have finished.
- **ready**: the selected research session has a completed report.

Select **Activity across other projects** to find active sessions outside the current project. Background sessions continue when you open another session.

## Create a session in a project

Select **New session** at the bottom of the sidebar. You can also select **New session** in **Project details**.

Leyline creates an empty normal session in the current project CWD. Use the centered composer to send its first prompt.

To create a research session, return to the start screen and select **research** before you send the prompt.

## Rename a session from the sidebar

1. Point to the session row.
2. Select **Rename session**.
3. Enter the new name.
4. Press **Enter**.

You can also double-click the session name. Press **Escape** to cancel the rename.

To rename the selected session, select its name in the workbench header.

## Delete a session

**Delete** moves the session JSONL file to Leyline trash. The session then disappears from Leyline.

1. Point to the session row.
2. Select **Delete session**.
3. Review the **Delete session?** dialog.
4. Select **Delete**.

You can also start deletion from **Project details**. Leyline does not provide a trash restore control in the interface.

## Open a subagent session

Subagent child sessions do not appear in the sidebar. Open a child session from its subagent card.

The child-session header shows **← parent session**. Select it to return to the parent session.
