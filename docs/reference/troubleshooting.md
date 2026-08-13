# Troubleshooting

## The dev server does not start

1. Run `node --version`.
2. Confirm that the result is `v22.19.0`.
3. Run `npm install`.
4. Confirm that no other process uses the Vite port.

## The browser cannot reach `/api/pi/*`

Start Leyline with `npm run dev`. Vite mounts `server/pi-api/index.js` and the
modules under `server/pi-api/` for local API routes.

If you use a separate static server, it does not include the pi API unless you
also start the Leyline backend.

## A saved backend connection fails

1. Open **Settings**.
2. Find the connection in **Backend**.
3. Select **Test**.
4. Confirm that the URL contains the scheme, host, and applicable port.
5. Remove `/api/pi` from the saved URL. Leyline adds this path.

Open `<backend-url>/api/pi/info` to check the server directly. A compatible
server returns `name: "Leyline"` and `apiVersion: 1`.

When the UI and backend use different non-loopback origins, set
`LEYLINE_SERVER_ALLOWED_ORIGINS` on the backend. Restart the backend after you
change the variable. A page that uses HTTPS cannot connect to an HTTP backend
when the browser blocks mixed content.

Select **Retry** in the sidebar after the backend becomes available. Retry
checks the backend again and reconnects the runtime event stream.

## No sessions appear

Confirm that pi has created session JSONL files. By default, Leyline uses the
session directory from pi settings for the project.

If you use a different directory, set `PI_CODING_AGENT_SESSION_DIR` before you
start Vite or Electron. Leyline searches that directory and its subdirectories
for JSONL files.

Reload the page after you change the session directory variable.

## Prompt submission fails

Check the selected session, model, provider credentials, and error text in the
composer. The composer cannot submit while the runtime activates, reloads, or
compacts.

During an active run, use these keys:

- Enter sends steering to the active run.
- Option+Enter queues a follow-up.
- Shift+Enter adds a line break.

## Model or provider authentication fails

Set the provider credentials in the environment that starts Leyline. Browser
development inherits the terminal environment. Electron loads the macOS
login-shell environment.

Select a model that has configured credentials. The backend rejects a child
model when its provider has no API key.

## Runtime resources do not update

Select **Reload runtime** at the bottom of the sidebar. Reload recreates the
selected runtime and reloads pi resources.

Wait for streaming or compaction to finish before you reload. You can also stop
an active run and then reload.

## A subagent fails to start

Confirm these items:

1. Start the task from Leyline so the bundled extension can reach the local API.
2. Confirm that the agent definition exists in `~/.pi/agent/agents/` or the
   nearest `.pi/agents/` directory.
3. Confirm that the selected child model exists.
4. Confirm that its provider has an API key.
5. Confirm that each tool in the agent definition is available.

A project agent definition replaces a global definition with the same agent
name.

## Child sessions appear in the sidebar

New child sessions contain a `leyline-subagent-session` marker and are hidden
from the sidebar. Leyline also recognizes child paths from persisted subagent
tool results for compatibility.

If an old child session has neither form of metadata, Leyline cannot identify
it as a child session.

## Memory does not match the Memory Inspector

Confirm that every Leyline process has the same `LEYLINE_MEMORY_DIR` value.
Restart Vite or Electron after you change it.

Without this variable, the memory extension, Memory Inspector, rollout feedback,
subagent overrides, and vision overrides use `~/.local/share/leyline/memory.sqlite`.

## Electron does not have shell environment variables

Confirm that your macOS login shell exports the required variables. Electron
runs the shell as an interactive login shell and waits up to five seconds.

Electron keeps existing process variables, except `PATH`. It replaces `PATH`
with the login-shell value.

## Dictation is unavailable in Electron

This is expected. Leyline disables dictation in Electron because Electron does
not provide the required speech-recognition service.

Use a compatible browser, such as Chrome, for dictation.

## The packaged terminal fails with `ENOTDIR`

Rebuild with `npm run electron:build`. The packaging script must unpack the
`node-pty` native files and `spawn-helper` from the Electron archive.

## The `leyline` command cannot find the app

Run `npm run local-publish`. Confirm that `/Applications/Leyline.app` exists and
that `~/.local/bin` is on `PATH`.

The CLI also checks `release/Leyline-darwin-arm64/Leyline.app`. Use
`LEYLINE_APP` only when the package is in a different location.

## The screenshot command cannot connect

1. Start the app with `npm run dev`.
2. Wait until `http://localhost:5173/` shows the start screen or workbench.
3. Run `npm run screenshot`.

Set `SCREENSHOT_URL` when the app uses a different URL. Set `SCREENSHOT_PATH`
when you need a different output file.

## The video command fails

Start the app before you run `npm run video`. Set `VIDEO_URL` when the app uses
a different URL.

The `npm run video:mp4` command also requires `ffmpeg` on `PATH`.

## Export is missing public share metadata

Set `LEYLINE_PUBLIC_URL` before you start Leyline. Then export the transcript
again.

## Session switching appears stale or delayed

Leyline can show persisted transcript data before runtime activation finishes.
Wait until the composer no longer shows **Activating runtime**.

Background sessions can continue to run while you view another session.

## A session was deleted by mistake

Leyline moves the JSONL file instead of permanently deleting it. Look in the
`leyline-trash` directory next to the configured pi session directory.

The file is under a timestamped subdirectory. Move it back to the session
directory while Leyline is stopped, then start Leyline again.

## An image cannot be submitted

If the selected model does not support image input, open **Settings**. Find
**Agents**, then select **Manage** beside **Vision agent**. Configure a
transcript, project, or global vision model.

You can also select a parent model that supports image input. Shell commands
and `/compact` cannot include image attachments. Vision delegation does not run
for extension slash commands, so do not attach images to those commands.

## Vision delegation fails

Confirm these items:

1. Open the **Vision agent** drawer and check the effective model.
2. Confirm that the model still exists and supports image input.
3. Confirm that its provider credentials are available to the Leyline server.
4. Select **Reload runtime** after you change pi model configuration.
5. Confirm that the image is PNG, JPEG, GIF, or WebP.

The configured provider receives the image and prompt. Provider limits can
reject a large image even when Leyline accepts its file type.
