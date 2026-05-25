# Installation

Clone or open the Leyline project, then install dependencies:

```bash
npm install
```

A successful install creates `node_modules/` and updates the local package lock if dependency versions change.

No separate backend service is required in development. Vite mounts `server/pi-api.js` as middleware for `/api/pi/*`, and the frontend talks to those local routes.

If installation fails, see [troubleshooting](../reference/troubleshooting#dev-server-does-not-start) and confirm your Node.js and native dependency toolchain.
