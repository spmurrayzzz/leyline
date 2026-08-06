# Manage memory

The **Memory** drawer shows memories that are visible to the selected session.

![Memory Inspector with project, session, and global memory scopes](/screenshots/memory-inspector.png)

*Visible Memory is grouped by the scope that controls where each record applies.*

## Open Memory

Select **Memory** in the workbench header. In Electron on macOS, press **Command+Shift+M**.

The header count shows active visible memories. The drawer header shows active and archived totals.

## Understand memory scopes

Leyline groups memory into three scopes:

- **Project** applies to sessions in the current project root.
- **Session** applies only to the selected session.
- **Global** applies across projects.

The **Session** section is unavailable until a session exists. The drawer shows only global memories and memories that match the current project or session.

## Search visible memory

1. Enter text in **Search visible memory**.
2. Review the matching cards.

Search matches content, tags, reason, and source. All entered words must match the same memory.

A search also shows matching archived memories. Clear the search to restore the normal archived sections.

## Create a memory

1. Select **+ Project**, **+ Session**, or **+ Global**.
2. Enter the memory in **Memory markdown…**.
3. Add optional comma-separated tags.
4. Select **Save**.

New memories are active. Only one create or edit form can be open at a time.

## Edit a memory

1. Select **Edit** on a memory card.
2. Change the Markdown or tags.
3. Select **Save**.

Select **Cancel** to discard the form. Leyline asks before you close the drawer with unsaved form changes.

## Inspect memory details

Select **Details** on a card. The details include the ID, source, dates, and optional reason.

Select **Copy** beside the ID to copy it.

## Archive and restore memory

Select **Archive** to make an active memory inactive. Archived memory remains stored but does not apply to later turns.

Select **Show archived** in a scope to view its archived cards. Select **Restore** to make an archived memory active again.

## Delete a memory

**Delete** permanently removes the memory. The Memory Inspector does not provide a restore action for deleted memory.

1. Select **Delete** on the memory card.
2. Review **Delete permanently?**.
3. Select **Delete**.

## Change multiple memories

1. Select **Select** in the drawer header.
2. Select the required memory cards.
3. Select **Archive**, **Restore**, or **Delete** in the bulk bar.
4. Select **Done** when the work is complete.

Bulk **Delete** asks for confirmation and permanently removes all selected memories.

## Apply changes to later turns

Memory changes affect future turns only. Earlier transcript context can still contain memory text that pi already received.

Select **Refresh** to reload the visible memory list. The drawer also refreshes after an active turn ends while the drawer is open.
