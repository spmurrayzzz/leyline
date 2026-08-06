# Manage subagents

Subagents run delegated tasks in child sessions with separate context.

![Subagents drawer with transcript-scoped model overrides](/screenshots/subagents.png)

*The drawer shows stored overrides and each agent's effective model.*

## Open Subagents

1. Select **Open settings** at the bottom of the sidebar.
2. Find **Agents**.
3. Select **Manage** beside **Subagents**.

The drawer lists available project and global agent definitions. Each card shows the definition source, configured model, description, and tool list.

## Select a model scope

Use one of these scope tabs:

- **Transcript** changes only the current session. Leyline copies this override to forks.
- **Project** changes sessions in the current project.
- **Global** supplies the default across projects.

Select a model in the agent card. The option label contains the model name and `provider/model-id`.

Select **Inherit lower scope** to remove the override at the current scope. The next applicable scope or agent definition then applies.

Select **Parent session model** to store `inherit`. The child uses the parent session model when that override applies.

The **Effective** row shows the selected result and its source.

## Understand model precedence

Leyline selects a child model in this order:

1. A model requested for the specific subagent tool call.
2. The **Transcript** override.
3. The **Project** override.
4. The **Global** override.
5. The model in the agent definition.
6. The child runtime default.

An applicable `inherit` value uses the parent session model.

## Understand thinking precedence

The **Subagents** drawer manages model overrides only. Thinking comes from the subagent request or agent definition.

A thinking level requested for one child run takes priority. Otherwise, the agent definition applies. The child runtime default applies when neither value exists.

The `inherit` thinking value uses the parent session thinking level.

## Understand execution modes

The agent can use three subagent modes:

- **single** runs one agent for one task.
- **parallel** runs task groups concurrently, with up to four tasks in each batch.
- **chain** runs steps in order and replaces `{previous}` with the prior output.

A model or thinking value on one task takes priority over the mode-level value.

## Read a subagent card

A subagent tool call appears as a card in the parent transcript. It shows the agent name, task results, and status.

Select the card to expand final output. Select **→ view session** to open a child session.

## Return to the parent session

Child sessions are hidden from the sidebar. Their header shows **← parent session**.

Select **← parent session** to return to the parent transcript.
