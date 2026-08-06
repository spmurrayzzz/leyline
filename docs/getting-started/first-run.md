# First run

## Start Leyline

1. Run the development server:

   ```bash
   npm run dev
   ```

2. Open the Vite URL, usually `http://localhost:5173/`.
3. Select a recent project, or select **Add new project**.
4. Select a model and thinking level if you do not want the pi defaults.
5. Enter the first prompt.
6. Press Enter or select the send button.

Leyline creates the session, applies the staged model settings, and sends the
prompt. You do not have to create an empty session first.

## Use the workbench

The workbench shows the project and session breadcrumb, transcript, live
output, and composer. Thought, skill, and tool rows can expand.

The composer stays available during an active run:

- Press Enter to send steering to the current run.
- Press Option+Enter to queue a follow-up.
- Press Shift+Enter to add a line break.
- Select the stop button to interrupt the run.

Use **Memory**, **Events**, and **Export transcript** in the workbench header.
Use **Reload runtime** at the bottom of the sidebar when pi resources must
reload.
