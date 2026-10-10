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
2. Find the connection in **Connections**.
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

- Enter adds an editable task to **Up next**.
- Option+Enter steers the active run.
- Shift+Enter adds a line break.

If the queue is held, select **Resume** before you steer.

## Queued tasks do not start

Check the attached queue tab for **Held** or **Needs attention**. Stop and queue
edits hold remaining unsent tasks. Save or cancel an open edit, then select
**Resume**. Closing the tray does not cancel the edit or resume the queue.

If the tray shows an error, correct the reported problem before you resume.
Leyline sends pending tasks one at a time when the agent becomes idle.

Inputs under **Sent to agent** have already reached pi. You cannot edit,
reorder, or remove them from the tray. The queue hold does not apply to them.

## Queued tasks disappear after a restart

Pending **Up next** tasks survive a browser refresh, session switch, and runtime
reload. A runtime reload leaves them held until you select **Resume**. A backend
restart clears pending tasks. They are not saved in the session transcript
before the agent accepts them.

## A custom model is missing from the picker

1. Confirm that Settings uses the intended backend.
2. Open **Models & providers** and select the provider.
3. Confirm that its **Models** tab contains a saved model definition.
4. Reload the affected idle session after saving configuration changes.

Saving a provider alone does not add models. **Model ID to test** is also a
test-only field, not a saved definition. Use **Add custom model** to add a model.

Custom compatible models do not need a placeholder API key. Leave the key
unset if the endpoint does not require authentication. Home refreshes model
choices after a save; existing sessions need **Reload runtime**.

## Model or provider authentication fails

Open **Settings → Models & providers** and select **Test connection** beside
the model. In a provider or model editor, the same button tests unsaved values.
Feedback and **Cancel** appear beside the editor's Save/Test controls.

An HTTP 401 means authentication is required or the credentials were rejected.
An HTTP 403 means access was denied. Open **Connection** and use an available
**Sign in** method or edit the API-key reference if the endpoint needs it.
**Configured** means credentials or configuration exist. It does not verify
account access.

Environment credentials must exist on the selected backend. Browser development
inherits the terminal environment. Electron loads the login-shell environment
on macOS and Linux. An API-key reference uses `$NAME` or `${NAME}` for an
environment variable. A bare `NAME` is a literal value.

After sign-in or configuration changes, reload the affected idle session.
A failed connection test does not hide a model or prevent saving.

## A provider connection test is unavailable

The installed pi SDK cannot enforce the test's output limit for Codex,
ChatGPT-subscription access through direct OpenAI Responses, or Responses
models with `supportsMaxOutputTokens: false`. Bedrock also cannot disable its
native retries. Leyline refuses tests whose limits it cannot enforce.
Normal model selection and use remain available.

A provider editor needs a physical **Model ID to test**. Saved virtual models
can route to a physical model for testing. Draft endpoint or API changes cannot
use a stored OAuth login. See [Connection tests](../user-guide/settings#test-a-model-connection)
for limits and credential behavior.

## A provider connection test times out

The probe has a 30-second deadline after settings runtime setup. A local server
can take longer to load its first model. Confirm that the server is ready,
then retry. Check the base URL and backend network access if no request arrives.

Use **Cancel** to stop a pending test. The editor keeps its unsaved fields.
If another process changes configuration, refresh settings before retrying a
draft test. Testing does not save the draft or add conversation messages.

## Provider sign-in is blocked after an endpoint change

An open or background runtime can retain an older provider URL. Pi shares saved
credentials across sessions. Leyline rejects sign-in when those URLs differ,
because an older runtime could send the new credentials to the previous server.

1. Wait for active work to finish.
2. Select each affected session and use **Reload runtime**.
3. Retry sign-in in **Models & providers → Connection**.

A backend restart clears old runtimes too. Finish active work first. A restart
also clears unsent **Up next** tasks. The sign-in guard does not stop running
agents or save the new credential. OAuth connection tests use the same URL
safety check before they can refresh shared tokens.

If settings report that another provider operation is in progress, complete or
cancel that operation before retrying. Provider changes and runtime creation
wait for the current authentication operation.

## Settings categories are missing

**Models & providers** and **MCP servers** require the selected backend's
`piSettings` capability. Update and restart that backend if it predates these
routes. Rebuild and restart a packaged Electron app after backend changes.
**Files** separately requires `fileLinks` support.

## A settings save reports an external change

Another process changed the configuration after the form loaded. Refresh
settings, review the current values, then apply your changes again. Refresh
asks before it discards an unsaved form. Leyline does not overwrite the other
process's edit.

If settings report a parse error or a read-only file, correct the file or its
permissions on the selected backend. Provider/model configuration uses
`models.json`; MCP configuration uses `mcp.json` in pi's agent directory.
See [Pi configuration storage](./environment#pi-configuration-storage).

## A Radius gateway URL cannot change

Pi 0.99.1 can reuse cached model URLs after the configured Radius gateway
changes. Leyline rejects edits that change an existing Radius gateway URL.
Use a different provider ID for a different gateway. Refreshing or reloading
does not make this endpoint change safe.

## MCP connection checks fail

Open **Settings → MCP servers**, select the server, then use **Check connection**.
The report describes a temporary connection, not connections in open sessions.

For stdio, confirm that the command, working directory, and required environment
exist on the selected backend. A check starts that command even if the server's
saved **Enabled** setting is off. Raw process output is not shown because it
can contain secrets.

For HTTP, check the URL, network access, headers, and authentication method.
Native OAuth requires a compatible server without a configured `Authorization`
header. Follow pi's sign-in prompts. For a remote backend, the browser must be
able to reach any required callback listener on that backend.

Use **Cancel** if a check or sign-in does not finish. Cancellation closes the
temporary resources but cannot undo credentials that pi already saved. Saved
aliases for the same normalized URL share native OAuth credentials.

Reload affected sessions after saving configuration or credentials. Saving
**Enabled** alone does not connect or disconnect a server in an open session.

## Runtime resources do not update

Select **Reload runtime** at the bottom of the sidebar. Reload recreates the
selected runtime and reloads pi resources.

Wait for streaming or compaction to finish before you reload. You can also stop
an active run and then reload. Pending **Up next** tasks remain held after
reload. Select **Resume** when you are ready to continue them.

## A subagent fails to start

Confirm these items:

1. Start the task from Leyline so the bundled extension can reach the local API.
2. Confirm that the agent definition exists in `~/.pi/agent/agents/` or the
   nearest `.pi/agents/` directory.
3. Confirm that the selected child model exists.
4. Confirm that its provider has usable credentials if authentication is required.
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

Confirm that your login shell exports the required variables. Electron runs the
shell as an interactive login shell on macOS and Linux and waits up to five
seconds. On Linux, this runs the startup files a desktop entry does not. For
Bash, confirm that `~/.bash_profile`, `~/.bash_login`, or `~/.profile` sources
`~/.bashrc` when your exports live there.

Electron keeps existing process variables, except `PATH`. It replaces `PATH`
with the login-shell value.

## Dictation is unavailable in Electron

This is expected. Leyline disables dictation in Electron because Electron does
not provide the required speech-recognition service.

Use a compatible browser, such as Chrome, for dictation.

## The packaged terminal fails with `ENOTDIR`

Rebuild with `npm run electron:build`. The packaging script must unpack the
`node-pty` native files and `spawn-helper` from the Electron archive.

## The Linux Electron app does not start

Run the installed executable directly from an external terminal to see startup
errors; the CLI launcher discards that output:

```bash
"$HOME/.local/opt/leyline/Leyline"
```

Check for missing shared libraries with:

```bash
ldd "$HOME/.local/opt/leyline/Leyline"
```

Install your distribution's runtime packages for any library marked
`not found`. Confirm that you copied the complete `release/Leyline-linux-x64/`
package, not just its executable, and that you are running as your normal user
in a graphical session. The tested setup and build steps are in
[Linux installation](../getting-started/linux-installation).

## The `leyline` command cannot find the app

Confirm that `~/.local/bin` is on `PATH` and check `command -v leyline`.

On Linux, confirm that `~/.local/opt/leyline/Leyline` is executable and install
the [Linux launcher](../getting-started/linux-installation#_3-add-the-cli-launcher).
Do not use `npm run local-publish` or link the macOS-only `bin/leyline`.

On Apple silicon macOS, run `npm run local-publish` and confirm that
`/Applications/Leyline.app` exists. That CLI also checks
`release/Leyline-darwin-arm64/Leyline.app`.

Use `LEYLINE_APP` only when the app is in a different location: a Linux
executable path or a macOS `.app` bundle path.

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

If the selected model does not support image input, open **Settings → Agent
defaults** and select a **Vision model**. Use **Project settings** or **Session
details** for a narrower override.

You can also select a parent model that supports image input. Shell commands
and `/compact` cannot include image attachments. Vision delegation does not run
for extension slash commands, so do not attach images to those commands.

## Vision delegation fails

Confirm these items:

1. Open **Session details** and check **Vision model** and its inheritance source.
2. Confirm that the model still exists and supports image input.
3. If the provider requires authentication, confirm that its credentials are available to the Leyline server.
4. Select **Reload runtime** after you change pi model configuration.
5. Confirm that the image is PNG, JPEG, GIF, or WebP.

The configured provider receives the image and prompt. Provider limits can
reject a large image even when Leyline accepts its file type.
