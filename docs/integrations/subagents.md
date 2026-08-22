# Subagent integration

Leyline bundles `.pi/extensions/subagent/index.ts`. The extension registers the `subagent` tool and sends child work to the local Leyline server.

## Agent definitions

Leyline reads Markdown definitions from:

- `~/.pi/agent/agents/` for user definitions
- the nearest `.pi/agents/` directory above the current working directory for project definitions

Each file must have YAML frontmatter with `name` and `description`. It can also set `model`, `thinking`, and a comma-separated `tools` list. The Markdown body supplies the child instructions.

A project definition replaces a user definition with the same name. Resource discovery and session start refresh the definition list.

Deep research adds a reserved bundled `researcher` after normal discovery. This definition cannot be replaced by a user or project file.

The reserved researcher uses a strict read and search allowlist. It returns a structured thread summary and source list for the research extension. See [Deep research integration](./deep-research).

## Execution modes

The `subagent` tool supports these modes:

- `single` runs one agent for one task.
- `parallel` runs tasks concurrently in batches of four.
- `chain` runs tasks in order and replaces `{previous}` with the prior result.

Parallel and chain items can set their own model, thinking level, and working directory. An item setting takes priority over the top-level tool setting.

## Model and thinking selection

Leyline resolves models in this order:

1. The model on the tool call or task item
2. A session override
3. A project override
4. A global override
5. The model in the agent definition
6. The runtime default model

The value `inherit` selects the parent session model. A model value can be a model ID or `provider/model-id`.

Model overrides are stored in the `subagent_overrides` table in `~/.local/share/leyline/memory.sqlite`. A session fork copies its session overrides to the new session.

Thinking selection uses the tool or item setting first, then the agent definition. The value `inherit` selects the parent thinking level. Leyline does not store thinking overrides in SQLite.

## Child runtime

The extension uses two internal integration routes:

1. `POST /api/pi/subagents/resolve` resolves stored model overrides.
2. `POST /api/pi/subagent` creates and runs the child session.

The server creates a pi session with `parentSession` set to the parent session file. It also appends a `leyline-subagent-session` custom record. This explicit marker distinguishes a child session from a normal fork.

For older records without the marker, Leyline also finds child paths in parent `subagent` tool results. The transcript card links to each child session, and the child session links back to its parent.

The server loads the normal Leyline runtime resources for each child. It applies the selected model, thinking level, and tool allowlist. The agent definition body is added before the task text. Provider authentication must be available to the server process.

The child route waits for the child run to finish. If the caller disconnects before the response finishes, the server aborts the child run. See the [API reference](../reference/api#subagent-routes).
