# Frontend state

`useSessionWorkspace.js` owns workspace lifecycle, route selection, selected transcript detail, active runtime session, startup phases, runtime controls, and terminal reconnect intents.

`App.vue` is the composition root for visual-only state and DOM mechanics. `useRuntimeEvents.js` is the EventSource adapter. `useLiveTurnProjection.js` projects live assistant and tool output. `useTerminal.js` owns xterm and WebSocket lifecycle.

Session activation is tokenized and latest-wins. Optimistic user entries reconcile when persisted transcript detail refreshes.
