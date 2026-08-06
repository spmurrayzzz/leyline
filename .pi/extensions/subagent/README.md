# Subagent Extension

This extension delegates tasks to child pi sessions with isolated context.

## Requirements

The extension calls Leyline's local API at `POST /api/pi/subagent`. Run it in a
Leyline-managed pi runtime. It does not start a pi subprocess.

The server creates each child with `SessionManager.newSession()` and sets the
parent session path. It also appends a `leyline-subagent-session` custom marker
to the child session.

Leyline uses the explicit marker to hide child sessions from the sidebar. For
older compatible sessions, it also matches child paths stored in subagent tool
results. A session without either form of metadata can appear as a normal
session.

## Modes

- `single`: Run one agent for one task. This is the default.
- `parallel`: Run concurrent tasks in batches of up to four.
- `chain`: Run tasks in order. Each step can use `{previous}` to include the
  prior step output.

A chain stops when a step fails. Parallel mode returns all results, including
individual failures.

## Agent definitions

Put Markdown files with YAML frontmatter in one of these directories:

- `~/.pi/agent/agents/` for global definitions
- `.pi/agents/` for project definitions

The extension searches upward from the working directory for the nearest
project `.pi/agents/` directory. A project definition replaces a global
definition with the same `name`.

Required frontmatter fields:

```yaml
---
name: reviewer
description: Review a focused code change
model: inherit
thinking: inherit
tools: read,grep
---
```

The Markdown body is added before the delegated task as child instructions.
The `model`, `thinking`, and `tools` fields are optional.

## Model overrides

A model value can be one of these forms:

- `inherit` to use the parent session model
- A model ID, such as `claude-sonnet-4-6`
- A provider and model ID, such as `anthropic/claude-sonnet-4-6`

Single mode accepts top-level `model` and `thinking` values. Parallel and chain
modes accept top-level values and values on each task or step. A task or step
value has priority over the top-level value.

Leyline Settings can save model overrides in session, project, or global scope.
The complete model precedence is:

1. Task or chain-step `model`
2. Top-level tool-call `model`
3. Session model override
4. Project model override
5. Global model override
6. Agent definition `model`
7. Pi runtime default

`inherit` at an explicit or definition level selects the parent model. A model
must exist in the child runtime, and its provider must have configured
credentials.

## Thinking overrides

Thinking values can be `inherit`, `off`, `minimal`, `low`, `medium`, `high`,
`xhigh`, or `max`.

The thinking precedence is:

1. Task or chain-step `thinking`
2. Top-level tool-call `thinking`
3. Agent definition `thinking`
4. Pi runtime default

`inherit` selects the parent session's current thinking level. Leyline Settings
currently stores model overrides only. It does not store thinking overrides.

## Tool-call forms

Single mode:

```json
{
  "agent": "reviewer",
  "task": "Review the current diff",
  "model": "inherit",
  "thinking": "high"
}
```

Parallel mode:

```json
{
  "mode": "parallel",
  "model": "inherit",
  "tasks": [
    { "agent": "reviewer", "task": "Review correctness" },
    { "agent": "researcher", "task": "Check the API contract" }
  ]
}
```

Chain mode:

```json
{
  "mode": "chain",
  "chain": [
    { "agent": "researcher", "task": "Find the relevant source" },
    { "agent": "reviewer", "task": "Review this evidence:\n{previous}" }
  ]
}
```

Each mode also accepts a `cwd` override. Each parallel task or chain step can
supply its own `cwd`, `model`, and `thinking` value.

## Leyline rendering

Subagent tool calls appear as cards in the transcript. Select a child card to
open that child session. A child workbench with a valid parent path shows the
**parent session** control.
