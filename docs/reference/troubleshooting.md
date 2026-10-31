---
description: Resolve Leyline startup, backend connection, live update, model, terminal, and trace capture problems.
---

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
server returns `name: "Leyline"` and `apiVersion: 2`.

API v2 uses WebSockets for runtime and Git review events. Update the frontend and backend together. After the update, restart the backend and reload existing browser tabs. An installed Electron app needs a rebuilt package and a restart.

When the UI and backend use different non-loopback origins, set
`LEYLINE_SERVER_ALLOWED_ORIGINS` on the backend. Restart the backend after you
change the variable. A page that uses HTTPS cannot connect to an HTTP backend
when the browser blocks mixed content.

Select **Retry** in the sidebar after the backend becomes available. Retry
checks the backend again and reconnects the runtime event stream.

## Live updates stop or disconnect

1. Check that the selected backend returns API v2 from `/api/pi/info`.
2. Reload the browser tab to replace an older client.
3. In the browser's Network panel, check the WebSocket connection to `/api/pi/events`.
4. If a reverse proxy is present, confirm that it forwards WebSocket upgrades for both event paths.

The event paths are `/api/pi/events` and `/api/pi/review/events`. The review connection opens only when automatic Git review updates are available. Successful upgrades return HTTP `101`. Opening either path as an ordinary HTTP page is not a WebSocket check. An HTTP `426` means that the route requires an upgrade.

Use a secure WebSocket (`wss://`) with an HTTPS backend. Keep proxy idle timeouts longer than the 30-second heartbeat interval. If the browser requests local-network permission, grant it only for a backend that you trust.

The client reconnects automatically after a dropped connection. It then refreshes runtime snapshots and the selected session. Git review refresh waits for `review_ready`. Missed events are not replayed. Custom clients must implement reconnect and heartbeat replies. See [Event WebSockets](./api#event-websockets).

## Another device cannot reach a sharing URL

1. On the host computer, open **Settings → Connections**.
2. Confirm that **Allow network access** is on.
3. Copy a current sharing URL. An automatic port can change after sharing starts again.
4. Use an address that the other device can reach.
5. Check the host firewall and network access rules for that address and port.

For Tailscale, use the host's Tailscale interface address and check the tailnet access policy. The toggle listens on all IPv4 interfaces. It does not limit access to Tailscale.

Open the sharing URL directly in the other device's browser. The app and API then use the same origin. No extra allowed-origin setting is necessary. A UI on a different non-loopback origin still needs `LEYLINE_SERVER_ALLOWED_ORIGINS` on the backend.

If the port is in use, choose another **Proxy port** and select **Apply**. If sharing is off, turn it on afterward. A failed live port change keeps the previous listener and saved port. Local clients and agent runs continue during sharing changes.

Changing the active port or turning sharing off disconnects remote clients and terminals. Neither action closes an origin that startup configuration separately exposes. Settings shows a notice for that configuration.

Use trusted networks only. The API has no authentication. See [Network access](../user-guide/settings#share-the-native-backend).

## No sessions appear

Confirm that pi has created session JSONL files. By default, Leyline uses the
session directory from pi settings for the project.

If you use a different directory, set `PI_CODING_AGENT_SESSION_DIR` before you
start Vite or Electron. Leyline searches that directory and its subdirectories
for JSONL files.

Reload the page after you change the session directory variable.

## Trace controls are missing

**Session traces** and the sidebar **Trace explorer** button require the selected backend's `tracing` capability. Confirm that the window uses the intended backend. Update and restart that backend if it predates tracing.

After a dependency update, restart Vite for browser development. For an installed Electron app, rebuild, install, and restart the package. Reloading its window does not replace the embedded library or worker.

Leyline includes Elune. A standalone Go server or `PI_TRACE_URL` will not enable these controls. See [Tracing](../user-guide/tracing).

## A session has no recorded runs

Earlier pi JSONL files are not backfilled. Only new runs under capture produce traces.

Check the backend name above the trace view. Expand **Capture new runs** in the footer to check its setting. Capture is on by default, but each backend keeps its own setting. Turning capture on does not reconstruct a previous run.

In the explorer, clear search, status, and project filters if necessary. The explorer does not combine traces across backend connections.

## Trace capture fails or a change is unconfirmed

Read the error in the trace footer. Use **Retry** when available, then check the backend log. Confirm that the backend can access its trace database. See [Elune integration](../integrations/elune) for storage details.

Agent work can continue when capture fails. A failed or partial capture is not a complete run record.

If you close the view during a pending capture change, reopen traces on the same backend to check the result. A failed confirmation does not prove that the backend rejected the change.

## A trace observation or payload appears incomplete

Read the loaded range below the observations. Use **Previous batch** or **Next batch** to load another batch. **Find in loaded batch** searches only the current batch, not all observations or their payloads.

Recording limits can omit observations or truncate content. The view reports these limits only when the trace producer includes the corresponding flags or markers. Storage or capture failures can leave partial traces without a stored warning. A temporary backend error can disappear after restart. The absence of a warning does not prove that a trace is complete.

**Fields clipped on read** is a separate limit and does not change stored content. Long displayed payloads also use character pages.

If a selected observation is outside the loaded batch, load its batch or select another observation. See [Partial records](../user-guide/tracing#read-partial-records).

## A trace link cannot find a session entry

A reset, branch change, or session deletion can make a trace target unavailable. **Open session** does not reconstruct missing history. Traces remain separate from the session file.

Deleting a session, trashing a project, or resetting history does not delete its traces. Leyline has no trace deletion or export control or API. Turning capture off affects future runs only. See [Trace privacy](../user-guide/tracing#keep-trace-data-private).

## Prompt submission fails

Check the selected session, model, and provider credentials. Select **1 issue**
in the composer to read the full error. Dismissing the notice does not retry the
request or resolve the cause. If **Send unavailable** remains visible, select
**Details** to read the blocking requirement. See [Composer issues](../user-guide/composer#read-and-dismiss-an-issue).

The composer cannot submit while the runtime activates. During a run or compaction, new tasks enter **Up next**. During reload, new tasks enter the held queue. Select **Resume** after reload.

During an active run, use these keys:

- Enter adds an editable task to **Up next**.
- Option+Enter steers the active run.
- Shift+Enter adds a line break.

If the queue is held, select **Resume** before you steer.

## Queued tasks do not start

Check the attached queue tab for **Held** or **Needs attention**. Stop, queue edits,
and failed or cancelled shell commands hold remaining unsent tasks. Save or cancel
an open edit, then select **Resume**. Closing the tray does not cancel the edit or
resume the queue.

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

## The endpoint rejects a thinking level or developer role

Open **Settings → Models & providers**, edit the model, then open **Thinking & compatibility**.

- Select **Not supported** for **Developer role** if the template requires system messages.
- Mark rejected thinking levels as **Unsupported**, or supply the exact values that your server accepts.
- Use **Provider default** to remove an explicit override. This differs from `null`, which marks a level as unsupported.

**Find in catalog** can supply a starting map, but entries describe specific provider deployments. Check the imported model ID, token limits, and reasoning support before saving. Reload the affected session after saving. See [Thinking and compatibility](../user-guide/settings#set-thinking-and-developer-role-compatibility).

A successful connection test confirms one short request. It does not verify every thinking level or chat-template behavior.

## Catalog lookup has no match or cannot refresh

Use a more specific model name or ID. Lookup searches the backend's cached pi catalog and returns up to 20 matches. Each provider variant remains separate.

Select **Refresh** inside lookup to request a network update. A refresh failure can leave cached matches available with a warning. You can return to the editor and configure the model manually. Refresh does not discard the draft or reload an open conversation.

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

## A provider or MCP connection fails with a certificate error

For a private certificate authority, configure trust on the backend that makes the connection.

1. Confirm that Settings uses the intended backend.
2. Open **Settings → Certificates**.
3. Select **Add certificate**.
4. Enter an absolute or `~/` PEM path on that backend.
5. Select **Add file**.
6. Select **Save**.

If that computer's certificate store contains the required CA, turn on **Operating system** instead of adding a custom file. Select **Save** after the change.

Each file must be readable on that backend and contain at least one complete PEM certificate. Every certificate must parse with Node's `X509Certificate`. An unmatched certificate BEGIN or END marker rejects the file. The list accepts at most 32 files, each at most 1 MiB.

Read the error beside any invalid file. Correct its path or contents. Keep certificate verification enabled.

Save affects new backend Node TLS connections, including provider tests and MCP management checks. Existing connections can remain open. Wait for active work to finish before using Reload runtime to recreate an affected session's connections.

If the error remains, check the endpoint hostname, certificate validity, and server certificate chain. The Certificates pane does not change browser trust for a saved backend's HTTPS URL. Configure browser or operating-system trust for that connection. The pane also does not configure inbound server HTTPS or the separate dictation process.

See [TLS certificate trust](./environment#tls-certificate-trust) for startup CA sources and [Certificate settings](./api#certificate-settings) for validation and errors.

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

A draft reset can also require inherited metadata that pi cannot expose for a
legacy provider extension. In that case, save the model and use **Test connection**
from its **Models** row. Leyline does not guess those defaults or rerun extension
hooks to reconstruct them.

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

Runtime, Certificates, Models & providers, and MCP servers require the selected backend's `piSettings` capability. Update and restart that backend if it predates these routes. Rebuild and restart a packaged Electron app after backend changes.
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
6. Confirm that every child has a nonblank `title`, including each parallel task and chain step.

If any title is missing or blank, the call stops before any children start. Ask the parent agent to retry with titles. Reload an existing session if its tool schema still lacks the `title` field.

A project agent definition replaces a global definition with the same agent
name.

## Child sessions appear in the sidebar

Nested child rows under a parent are expected. See [Subagent sessions](../user-guide/sessions#open-a-subagent-session) for sidebar controls.

A child at the top level can indicate missing metadata. New children contain a `leyline-subagent-session` marker. Leyline also recognizes child paths from persisted subagent tool results for compatibility.

Without either form of metadata, Leyline cannot identify a session as a subagent child. A parent session path alone does not identify a subagent. Normal forks remain regular sessions.

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

## Dictation does not start or finish

Open **Settings → Dictation** and check the selected method. Browser dictation is the default in a normal web browser. It depends on browser support and may use an online service. Leyline does not switch to browser dictation when a selected local model fails.

For local dictation, select a model and use **Download** before recording. Parakeet supports English. Whisper Turbo is multilingual, with English or language detection in Settings. In Electron, local speech runs on this device. In a browser, it runs on the computer that serves the Leyline app, even when the selected agent backend is elsewhere. See [Dictation](../user-guide/dictation).

Parakeet first downloads from `leyline.download`, then tries Hugging Face if that source fails. Progress can restart when the source changes. Whisper downloads from Hugging Face. If a download fails, check the speech host's connection to these services and retry. Leyline rejects files with an incorrect size or SHA-256 checksum.

Check these items:

- Allow microphone access in the browser or operating system.
- Open the browser app over HTTPS or `localhost`. Browsers require a secure context for microphone access.
- Confirm that the chosen browser supports its browser-managed speech recognition method. Vendor support can vary.
- Check that the recording contains speech and that the microphone is not muted.
- If local dictation disconnects, retry from **Dictation** settings. A disconnected recording is cancelled.

If dictation finishes but does not change the draft, check whether the draft changed during recording. Leyline leaves the draft unchanged in that case and can show recognized text for recovery. Copy that text before you dismiss it.

For an Electron app, install the latest rebuilt package and restart it after a dictation bridge update. If the method is **Browser dictation**, Electron does not provide that browser-managed service. Select **Local models** instead.

## macOS cannot verify Leyline

Downloaded macOS builds use ad-hoc signing and have no Apple notarization.
macOS can show **“Leyline” Not Opened** or say Apple could not verify that the
app is free of malware.

For a verified release you trust, use **System Settings → Privacy & Security →
Open Anyway**. Follow the [macOS installation guide](../getting-started/installation#macos-security-warning)
for the complete steps and the app-specific quarantine fallback.

This approval can be necessary again after an update. Leyline does not remove
quarantine automatically.

## macOS says Leyline is damaged

Download the current official release and verify its DMG against the matching
`SHA256SUMS`. Copy the app to Applications, then check its signature:

```bash
codesign --verify --deep --strict --verbose=2 "/Applications/Leyline.app"
```

A valid bundle reports `valid on disk` and `satisfies its Designated Requirement`.
Errors such as `code has no resources but signature indicates they must be present`
or `a sealed resource is missing or invalid` indicate a signature or resource
integrity failure. Do not remove quarantine to bypass a failed signature check.
Download a fresh release and report the release version and exact error if the
failure continues.

If the checksum and signature checks pass, follow the
[security approval steps](../getting-started/installation#macos-security-warning).
Use the [quarantine fallback](../getting-started/installation#quarantine-fallback)
only for a verified release you trust.

Signature verification checks bundle integrity. It does not establish Apple
notarization or a trusted publisher identity.

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
