# Installation

Open the Leyline repository. Then install the dependencies:

```bash
npm install
```

A successful installation creates `node_modules/`. This repository does not
include a package lock.

No separate backend process is necessary for browser development. Vite mounts
`server/pi-api/index.js` for `/api/pi/*` routes and the terminal WebSocket.

If installation fails, confirm that `node --version` returns `v22.19.0`. Then
see [Troubleshooting](../reference/troubleshooting#the-dev-server-does-not-start).
