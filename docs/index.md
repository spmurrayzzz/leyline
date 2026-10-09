---
layout: home

hero:
  name: Leyline
  text: UI for your pi coding agent sessions
  tagline: Run pi sessions, supervise background work, and inspect transcripts in a focused browser or Electron workspace.
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
    details: Keep one project in focus, search its sessions, use Go to across projects, and move between parent and child sessions.
  - title: Run and direct agents
    details: Send prompts and images, steer active runs, and queue editable Up next tasks. Select models and optional ultrafast for supported OpenAI Responses models.
  - title: Run deep research
    details: Split a question into parallel research threads, follow source gathering, verify report citations, and inspect the persistent research ledger.
  - title: Use images with any model
    details: Send images directly to compatible models or configure a vision agent to describe them for models without image support.
  - title: Supervise live work
    details: Follow background sessions in Activity and stop individual runs. Inspect native MCP tools and reply to extension confirmation cards.
  - title: Review Git changes
    details: Keep the header summary current with the pane closed. Open a prepared diff to inspect staged and working-tree changes separately.
  - title: Connect backend hosts
    details: Save named Leyline backends, set an app-wide default, and select an active backend for each window.
  - title: Manage durable memory
    details: Inspect global, project, and session memory. Create, edit, archive, restore, or delete local records.
  - title: Delegate to subagents
    details: Run specialized child agents and set model overrides by global, project, or session scope.
  - title: Review and revise history
    details: Edit prompts, retry turns, and fork saved history while the source keeps running. Inspect current local files through transcript links.
  - title: Use a terminal
    details: Open the PTY-backed xterm drawer in the active project through the selected backend.
  - title: Export transcripts
    details: Save readable HTML with messages, tools, thinking output, collapsed System change cards, and images.
---

## Leyline workspace

![Leyline workbench showing a sanitized pi session](./assets/screenshots/workbench.png)

## Browser first, Electron optional

The browser and Vite workflow is the primary path. Electron is an optional desktop shell around the same app. It adds packaged use, desktop shortcuts, login-shell environment loading on macOS and Linux, multiple windows, and saved window state.

## Quick links

- [Install and run Leyline](/getting-started/)
- [Install the Linux desktop app](/getting-started/linux-installation)
- [Learn the UI](/user-guide/)
- [Read the motivations](/motivations)
- [Understand the architecture](/developer-guide/)
- [Review integrations](/integrations/)
- [Review API routes](/reference/api)
