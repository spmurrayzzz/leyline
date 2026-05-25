# Window state

Electron persists window bounds, maximized state, and fullscreen state under `app.getPath('userData')`.

Default bounds are used when no valid saved state exists. Saved bounds are validated before use so stale or invalid monitor layouts do not strand the window.
