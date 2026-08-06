# Settings

The **Settings** drawer shows runtime, agent, and session information.

## Open Settings

Select **Open settings** at the bottom of the sidebar. In Electron on macOS, press **Command+Shift+E**.

## Inspect runtime state

The **Runtime** section shows:

- **Model**: the selected provider and model ID.
- **Thinking**: the selected thinking level.
- **Tools**: the enabled tool count.
- **Context**: used context tokens and the context limit.
- **Events**: **Connected**, **Connecting**, or **Error**.

These values are read-only in **Settings**. Change the model and thinking level in the composer.

## Manage subagent models

1. Find **Agents**.
2. Select **Manage** beside **Subagents**.

The **Subagents** drawer manages model defaults by transcript, project, and global scope. See [Subagents](./subagents).

## Inspect session state

The **Session** section shows:

- **Project**.
- **Session ID**.
- **CWD**.
- **Path**.
- **Messages**.

Select **Copy session ID**, **Copy CWD**, or **Copy path** to copy the related value.

## Reload the runtime

**Reload runtime** is at the bottom of the sidebar, beside **Open settings**. It is not inside the **Settings** drawer.

Select **Reload runtime** to reload keybindings, extensions, skills, prompts, and themes for the selected runtime.

Reload is disabled when no session is selected or while the selected agent runs.
