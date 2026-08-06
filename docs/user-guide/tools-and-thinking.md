# Tools and thinking

The transcript separates assistant text, reasoning, tools, skills, subagents, and feedback.

## Expand a thought

Saved reasoning appears in a collapsed **Thought** row. Select the row to expand or collapse it.

During a live response, the row uses **Thinking** and starts expanded. Saved assistant text appears as rendered Markdown. Raw HTML is disabled.

## Expand a tool row

Tool rows are collapsed by default. Select a row to show its output or preview.

Each row shows a tool label, target when available, and status. Common labels include file paths for file tools and commands for shell tools.

Shell rows also show **in context** or **not in context**. This label tells you whether pi received the command output as session context.

## Open full tool output

Select **Open full screen** in an expanded tool row. You can also select its fullscreen action in the row header.

The fullscreen view shows the complete available output or preview. Select **×** or the backdrop to close it.

## Expand a skill row

A loaded skill prompt appears as a compact row with `[skill]`, the skill name, and **expand**. Select it to show the skill prompt payload.

Select the row again when it shows **hide**.

## Read a subagent card

A subagent tool call appears as a subagent card. The card shows the agent name and **running**, **completed**, or **error**.

Select the card to expand its result. Select **→ view session** on a result to open that child session.

## Copy transcript content

Select **Copy** in a message or tool header. Leyline copies the message text or available tool output.

The action changes to **Copied** for a short time. The fullscreen tool view also has a **Copy** action.

## Add rollout feedback

1. Point to an assistant message.
2. Select **Mark helpful** or **Mark not helpful**.
3. Select **+ note** to add optional details.
4. Enter the note.
5. Select **Save**.

Select the active rating again to clear it. Select **note** to change an existing note.

Leyline stores rollout ratings and notes in local Leyline data. They are separate from the session log.

## Follow live output

Leyline shows assistant and tool rows as the runtime produces them. Saved transcript rows replace the live rows after pi records the turn.

This change preserves your reading position and prevents duplicate output.
