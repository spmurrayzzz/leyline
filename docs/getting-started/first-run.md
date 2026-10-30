---
description: Create your first Leyline session, select a project and model, check trace capture, and send a prompt.
---

# First run

Trace capture starts on for new runs. Before submitting private data, check
[Capture new runs](#check-trace-capture) in the trace footer.

## Start Leyline

If you installed the [macOS desktop release](./installation#macos-desktop-release)
or followed [Linux installation](./linux-installation), open **Leyline** and
continue at step 3. On macOS, complete the
[security approval steps](./installation#macos-security-warning) first. The
packaged app does not need a development server.

1. Run the development server:

   ```bash
   npm run dev
   ```

2. Open the Vite URL, usually `http://localhost:5173/`.
3. Select a recent project, or select **Add new project**.
4. Select a model and thinking level if you do not want the pi defaults.
5. Enter the first prompt.
6. Press Enter or select the send button.

Leyline creates the session, applies the staged runtime choices, and sends the
prompt. You do not have to create an empty session first.

Standard is the default service tier. For supported models, open the desktop
tier chip to choose `standard`, `fast`, or `ultrafast`. On mobile, use **Speed**.
Fast and Ultrafast use premium pricing. On Home, the choice stays staged until
session creation. See [Choose a service tier](../user-guide/runtime-controls#choose-a-service-tier)
for model, authentication, and account limits.

If no usable model is available, open **Settings → Models & providers**.
Sign in when the provider requires authentication, or add a custom endpoint
and model without a key. **Test connection** can check saved settings or
unsaved editor values before the first prompt. See
[Provider settings](../user-guide/settings#manage-models-and-providers).

## Check trace capture

Capture starts on for new agent runs. Traces can store raw prompts and tool results on the selected backend.

Before the first prompt, select the **Trace explorer** icon button at the bottom of the sidebar. Expand **Capture new runs** in the footer. To prevent capture of new runs, clear the **Capture new runs** checkbox. Turning capture off does not delete existing traces or interrupt capture for an active run. See [Tracing](../user-guide/tracing).

## Use the workbench

The workbench shows the project and session breadcrumb, transcript, live
output, and composer. Thought, skill, and tool rows can expand. Select a
**System** row to inspect recorded prompt and tool changes in the side pane.

The composer stays available during an active run:

- Press Enter to add an editable task to **Up next**.
- Press Option+Enter to steer the current run.
- Press Shift+Enter to add a line break.
- Select the stop button to interrupt the run and hold remaining unsent tasks.

Select the attached **Up next** tab to manage pending tasks. Use **Send options**
beside the send arrow to queue or steer without keyboard shortcuts. If the
queue is held, select **Resume** to continue queued work. See
[Composer](../user-guide/composer) for editing and queue controls.

Select **Session traces** to inspect a captured run.

Use **Session details**, **Memory**, and **Export transcript** in
the workbench header. Use **Reload runtime** at the bottom of the sidebar when
pi resources or saved provider/MCP configuration must reload.
