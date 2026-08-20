# Projects and search

Leyline uses each session CWD as a project. The project name is the final folder name.

The sidebar keeps one current project in focus. It shows the project path, session search, session list, and project shortcuts.

## Find a session in the current project

1. Enter text in **Search sessions**.
2. Select a matching session.

Search matches session names and IDs in the current project. Each search term must match one of those values.

Search does not inspect transcript content. Clear the field to restore the full session list.

## Change the current project

![Project navigator with the current project and another available project](../assets/screenshots/project-navigation.png)

*Change project keeps the session list focused on one working directory.*

1. Select **Change project**.
2. Enter text in **Search projects, paths, or sessions** if necessary.
3. Select a project or session.

Without a query, the navigator shows all projects. Search matches project names, CWDs, session names, and session IDs.

When you select a project, Leyline opens the last session that you used in that project. Otherwise, it opens the most recent session.

If the project has no sessions, Leyline opens the start screen for that CWD.

Select **Open another folder** to add a project folder.

## Use Go to

Press **Command+K** or **Ctrl+K** to open **Go to**.

Leyline ignores this shortcut during deletion confirmation, transcript editing, or session renaming.

The default view shows projects and current or recent sessions. Enter a query to search all projects and regular sessions.

Press **Escape** or select the shaded area to close the navigator.

## Follow activity in other projects

Select **Activity across other projects** at the bottom of the sidebar.

The navigator excludes the current project and groups active sessions by state:

- **Needs attention** contains unread sessions and errors.
- **Running** contains running and compacting sessions.
- **Queued** contains sessions with queued messages.

Select an activity result to open that session.

## Open Project details

![Project Details drawer with filtered session cards and sidebar context](../assets/screenshots/project-details.png)

*Project Details provides focused session management for the current project.*

1. Select **Project actions** beside the current project.
2. Select **Project details**.

The drawer shows the CWD, session count, and current-session relationship.

The **Project actions** menu also contains **Trash project**. This action moves all project sessions to Leyline trash after confirmation.

## Filter and sort project sessions

Enter a name or session ID in **Filter sessions**. This filter uses text containment.

Select **Recent** to sort by time. Select **Title** to sort by session title.

## Manage a project session

Each session card provides these actions:

- **Open** selects the session.
- **Rename** changes its displayed name.
- **Delete** opens the session deletion confirmation.

The selected session shows **Selected** instead of **Open**.

Select **New session** to create an empty session in the project CWD.

**Delete** moves the session JSONL file to Leyline trash. Confirm this effect in the **Delete session?** dialog.

## Add a project folder

Select **Change project**, then select **Open another folder**. You can also select **Add new project** on the start screen.

The **Add project folder** browser can open an existing folder or create the typed folder. See [Start screen](./start-screen#add-a-project-folder) for its keyboard controls.

Adding a folder creates a session in that folder. Leyline does not keep a separate project registry.
