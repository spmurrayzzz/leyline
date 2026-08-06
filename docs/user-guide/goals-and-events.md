# Use goals and runtime events

A goal lets the agent continue work across automatic turns. Runtime events show activity from the current Leyline page connection.

![Active goal controls with the Runtime events drawer open](/screenshots/goal-events.png)

*Goal state and recent runtime events remain separate from transcript history.*

## Start a goal

Enter a goal command in the composer:

```text
/goal <objective>
```

Leyline starts the goal and begins the first turn. The goal control appears above the transcript.

## Set goal budgets

Add a token budget, continuation limit, or both:

```text
/goal --tokens 80K <objective>
/goal --limit 5 <objective>
/goal --tokens 80K --limit 5 <objective>
```

The token budget is not a hard provider limit. The current turn can finish after usage reaches the budget.

The continuation limit counts automatic continuation turns. It does not count the initial goal turn. A limit of `0` disables this limit.

The goal control shows used and allowed tokens. It also shows used and allowed continuation turns when configured.

## Read goal status

A goal can have these states:

- **active**: automatic work can continue.
- **paused**: automatic continuation stops.
- **limited by budget**: token usage reached the configured budget.
- **limited by continuations**: automatic turns reached the configured limit.
- **complete**: the agent marked the objective complete.

The control shows **Pause** for an active goal and **Resume** for a paused goal. Limited and complete goals show only **Clear**.

The browser control does not print the status name. Use the available action and budget values to read its current control state.

## Pause a goal

Select **Pause**. If a response is active, Leyline stops it before pausing the goal.

You can also enter `/goal pause`.

## Resume a goal

Select **Resume**. Leyline marks the goal active and starts an automatic continuation turn.

You can also enter `/goal resume`.

## Clear a goal

**Clear** removes the current goal state from the session. This action does not delete transcript history.

Select **Clear** in the goal control. If a response is active, Leyline stops it first.

You can also enter `/goal clear`.

## Open Runtime events

1. Open a non-empty session.
2. Select **Events** in the workbench header.

The **Runtime events** drawer shows the 20 newest retained events, newest first. Its header shows the total retained event count.

Leyline retains up to 100 events for the current page connection. Reloading the page starts a new event list.

## Read an event row

Each row shows a time, event type, and short summary. Events can include connection state, runtime activity, tool execution, messages, errors, queue changes, and extension UI changes.

The topbar count shows the retained event count. **Settings** shows the event stream as **Connected**, **Connecting**, or **Error**.

Runtime event rows stay in the drawer. Leyline does not add model-change event rows to the transcript.
