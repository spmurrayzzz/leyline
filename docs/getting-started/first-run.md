# First run

## Start Leyline

If you followed [Linux installation](./linux-installation), open **Leyline**
from your application menu and continue at step 3. The packaged app does not
need a development server.

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

The optional `ultrafast` chip is off by default. On Home, clicks stage the
choice without a confirmation dialog. It uses premium pricing for supported
OpenAI Responses models. See [Runtime controls](../user-guide/runtime-controls#use-ultrafast)
for model and authentication limits.

If no usable model is available, open **Settings → Models & providers**.
Sign in to a provider or add a custom endpoint and model. See
[Provider settings](../user-guide/settings#manage-models-and-providers).

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

Use **Session details**, **Memory**, **Events**, and **Export transcript** in
the workbench header. Use **Reload runtime** at the bottom of the sidebar when
pi resources or saved provider/MCP configuration must reload.
