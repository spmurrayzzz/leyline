# Sessions

A session contains one pi conversation tree. Leyline shows the active branch as a transcript.

## Select a session

1. Expand a project in the sidebar.
2. Select a session name.

You can also focus a session row and press **Enter** or **Space**.

A selected session uses the route `/sessions/<encoded-id>`. The start screen uses `/`.

## Show more sessions

Each expanded project shows its five most recent sessions first. The selected session also remains visible when it is outside that preview.

Select **Show all N sessions** to show the full project list. Select **Show fewer** to restore the preview.

A session search shows all matching sessions and hides this preview control.

## Read runtime status

A session row can show these states:

- **running**: the agent is producing a response.
- **compacting**: pi is compacting the session context.
- **unread**: a background run finished or reported an error.
- **+N queued**: steering or follow-up messages are waiting.
- **error**: the background runtime reported an error.

The **Sessions** heading summarizes running, compacting, and unread sessions. Background sessions continue when you open another session.

## Create a session in a project

Select the **New session** button beside a project. You can also select **New session** in **Project details**.

Leyline creates an empty session in that project's CWD. Use the centered composer to send its first prompt.

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
