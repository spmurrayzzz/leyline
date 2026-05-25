# Troubleshooting

## Dev server does not start

Check Node.js, run `npm install`, and confirm no other process is using the Vite port.

## Browser cannot reach `/api/pi/*`

Use `npm run dev` so Vite mounts `server/pi-api.js` as middleware.

## No sessions appear

Confirm your pi environment is configured and has session storage available.

## Prompt submission fails

Check model/provider auth, selected session state, and runtime error messages.

## Model or provider auth fails

Confirm provider environment variables are present in the shell that launched Leyline.

## Electron cannot see shell environment variables

Check macOS login shell configuration and Electron environment loading.

## Terminal fails in packaged Electron with `ENOTDIR`

Confirm `node-pty` native files and `spawn-helper` are unpacked during packaging.

## Screenshot command cannot connect to Vite URL

Start `npm run dev` before running `npm run screenshot`.

## Export is missing public share metadata

Set `LEYLINE_PUBLIC_URL` before exporting.

## Session switching appears stale or delayed

Transcript detail may render before runtime activation finishes. Wait for the active session state to settle.

## Image input warning for non-vision model

Choose a model with vision support before submitting images.
