---
layout: home

hero:
  name: Leyline
  text: UI for your pi coding agent sessions
  tagline: Browse, run, monitor, control, and export local pi sessions from a focused browser or Electron workspace.
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
  - title: Browse pi sessions
    details: Review existing sessions grouped by project cwd and quickly switch between transcript detail views.
  - title: Run in projects
    details: Create sessions in project directories and submit prompts through the selected runtime session.
  - title: Watch live work
    details: Follow assistant text, tool rows, model output, and thinking traces while a run is active.
  - title: Control runtime state
    details: Adjust model and thinking level, stop work, reload pi resources, and monitor context and tool counts.
  - title: Use a local terminal
    details: Open the PTY-backed xterm drawer connected through the same local server.
  - title: Export transcripts
    details: Save self-contained HTML exports with markdown, tools, thinking output, images, and previews.
---

## Browser first, Electron optional

The browser and Vite workflow is the primary path. Electron is an optional
desktop shell around the same app for packaged use, desktop shortcuts, macOS
shell environment loading, and window-state persistence.

## Quick links

- [Install and run Leyline](/getting-started/)
- [Learn the UI](/user-guide/)
- [Understand the architecture](/developer-guide/)
- [Review API routes](/reference/api)
