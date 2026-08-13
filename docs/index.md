---
layout: home

hero:
  name: Leyline
  text: UI for your pi coding agent sessions
  tagline: Browse, run, monitor, control, and export pi sessions from a focused browser or Electron workspace.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/
    - theme: alt
      text: User guide
      link: /user-guide/
    - theme: alt
      text: Developer guide
      link: /developer-guide/

features:
  - title: Browse sessions and projects
    details: Search sessions, group them by project, inspect project history, and move between parent and child sessions.
  - title: Run and direct agents
    details: Submit prompts, images, shell commands, steering messages, queued follow-ups, slash commands, and long-running goals.
  - title: Use images with any model
    details: Send images directly to compatible models or configure a vision agent to describe them for models without image support.
  - title: Watch live work
    details: Follow assistant text, thinking, tool calls, runtime events, queues, context use, and goal progress.
  - title: Connect backend hosts
    details: Save named Leyline backends, set an app-wide default, and select an active backend for each window.
  - title: Manage durable memory
    details: Inspect global, project, and session memory. Create, edit, archive, restore, or delete local records.
  - title: Delegate to subagents
    details: Run specialized child agents and set model overrides by global, project, or session scope.
  - title: Review and revise history
    details: Edit prompts, retry turns, fork sessions, reset a thread, label rollouts, and inspect rich file or diff previews.
  - title: Use a terminal
    details: Open the PTY-backed xterm drawer in the active project through the selected backend.
  - title: Export transcripts
    details: Save portable HTML with Markdown, tools, thinking output, images, token data, previews, and optional share metadata.
---

## Leyline workspace

![Leyline workbench showing a sanitized pi session](./assets/screenshots/workbench.png)

## Browser first, Electron optional

The browser and Vite workflow is the primary path. Electron is an optional desktop shell around the same app. It adds packaged use, desktop shortcuts, macOS shell environment loading, multiple windows, and saved window state.

## Quick links

- [Install and run Leyline](/getting-started/)
- [Learn the UI](/user-guide/)
- [Read the motivations](/motivations)
- [Understand the architecture](/developer-guide/)
- [Review integrations](/integrations/)
- [Review API routes](/reference/api)
