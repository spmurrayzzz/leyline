# Goal Extension

Adds a Codex-style `/goal` command for long-running autonomous work.

## Commands

```text
/goal <objective>
```

Starts a goal and immediately begins working toward it.

```text
/goal --tokens 80K <objective>
```

Starts a goal with a loop budget. The budget is not a hard provider limit: the
current turn finishes, then the extension marks the goal `budget_limited` and
queues one wrap-up turn.

```text
/goal --limit 5 <objective>
```

Starts a goal with a hard cap on automatic continuation turns. The initial goal
turn does not count against the limit. A limit of `0` disables the cap.

```text
/goal --tokens 80K --limit 5 <objective>
```

Combines token and continuation budgets. Flags can appear in either order before
the objective.

```text
/goal
```

Shows the current goal, status, elapsed time, token usage, and continuation
usage.

```text
/goal pause
/goal resume
/goal clear
```

Pauses, resumes, or clears the current goal.

## Model tools

The extension exposes these tools to the agent:

- `get_goal`: read the current goal and budget usage.
- `update_goal`: mark the goal `complete` only after the objective is achieved.

Goals can only be started by the user with `/goal <objective>` by default. Set
`PI_ENABLE_CREATE_GOAL=1` to expose the Codex-style `create_goal` model tool.

## Behavior

While a goal is active, the extension queues hidden continuation turns after the
agent becomes idle. Continuations ask the agent to choose the next concrete
action, audit completion against real evidence, and call `update_goal` only when
all requirements are satisfied.

If a continuation turn makes no tool calls, automatic continuation is suppressed
so the agent does not spin indefinitely.

If the continuation limit is reached, the extension marks the goal
`continuation_limited` and stops queueing automatic continuations.

Goal state is persisted in the pi session via `appendEntry`, so it survives
reloads and resumes.

## Examples

```text
/goal --tokens 20K --limit 3 create /tmp/pi-goal-test.txt containing success, verify it exists, then mark complete
```

```text
/goal --tokens 60K audit .pi/agent/extensions/goal/index.ts against ./codex, implement the smallest high-value gap, validate it, then mark complete
```
