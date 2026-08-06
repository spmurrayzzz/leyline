# Goal extension

Leyline bundles `.pi/extensions/goal/index.ts` and loads it through `resourceLoaderOptions.additionalExtensionPaths`.

User commands include:

```text
/goal <objective>
/goal --tokens 80K <objective>
/goal --limit 5 <objective>
/goal pause
/goal resume
/goal clear
```

The extension registers `get_goal` and `update_goal`. It also registers `create_goal` when `PI_ENABLE_CREATE_GOAL=1`.

An active goal can queue hidden continuation turns after the runtime becomes idle. A token budget lets the current turn finish and then queues one wrap-up turn. A continuation limit stops new automatic turns when the limit is reached.

The extension stores each state change as a `goal-state` custom session entry. This keeps the goal with the pi session after reload or resume.

`server/pi-api/goal-state.js` reads the latest valid goal entry. Leyline includes the projected goal in runtime state and `extension_ui` events. The browser uses this projection for objective, status, budget, elapsed-time, pause, resume, and clear controls.
