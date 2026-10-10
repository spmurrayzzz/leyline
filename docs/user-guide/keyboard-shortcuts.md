# Keyboard shortcuts

Leyline provides composer, browser, rename, terminal, and Electron shortcuts.

## Use composer shortcuts

| Shortcut | Action |
| --- | --- |
| **Enter** | Send a prompt when idle with an empty queue. During a run, add a task to **Up next**. |
| **Option+Enter** | During a run, **Steer current run**. |
| **Shift+Enter** | Add a line break. |
| **Escape** | Close an open menu, queue tray, drawer, dialog, preview, or edit mode. With no open surface, stop the active run. |

When pending tasks remain, **Enter** adds to the queue. A held queue stays held until you select **Resume**. Resume the queue before you use **Option+Enter** to steer.

## Use slash command shortcuts

These shortcuts apply while the slash command picker is open.

| Shortcut | Action |
| --- | --- |
| **Arrow Down** | Select the next result. |
| **Arrow Up** | Select the previous result. |
| **Tab** or **Enter** | Insert the selected command. |
| **Escape** | Close the picker. |

## Use navigation shortcuts

| Shortcut | Action |
| --- | --- |
| **Command+K** or **Ctrl+K** | Open **Go to** for projects and sessions. |
| **Escape** | Close the open navigator. |

Leyline ignores the **Go to** shortcut during deletion confirmation, transcript editing, or session renaming.

## Open a target in another window

Command-click an internal target on macOS. Use Ctrl-click on other platforms or
middle-click with a mouse.

This behavior applies to session and project targets, **New session**, and
backend choices. Electron opens a foreground Leyline window. The browser build
uses the browser's tab or window behavior. The current window does not change.

A modified **New session** action creates one session in the new window. A
modified backend choice opens the home workspace on that backend. External
links keep their normal browser behavior.

## Use project folder shortcuts

These shortcuts apply in **Add project**.

| Shortcut | Action |
| --- | --- |
| **Arrow Down** | Highlight the next folder. |
| **Arrow Up** | Highlight the previous folder. |
| **Enter** | Open the highlighted folder. |
| **Command+Enter** or **Ctrl+Enter** | Add the typed path. |
| **Escape** | Close the folder browser. |

## Use session and rename shortcuts

| Shortcut | Action |
| --- | --- |
| **Enter** or **Space** | Open a focused session row. |
| **Arrow Down** | Focus the next session row. |
| **Arrow Up** | Focus the previous session row. |
| **Enter** while renaming | Save the session name. |
| **Escape** while renaming | Cancel the rename. |

Leaving the rename field also saves the current value.

## Resize Git review with keys

Focus the **Resize review pane** handle first.

| Shortcut | Action |
| --- | --- |
| **Arrow Left** | Increase review width by 24 pixels. |
| **Arrow Right** | Decrease review width by 24 pixels. |
| **Escape** | Collapse expanded review and restore the transcript. |

## Resize the terminal with keys

Focus the **Resize terminal** handle first.

| Shortcut | Action |
| --- | --- |
| **Arrow Up** | Increase terminal height by 24 pixels. |
| **Arrow Down** | Decrease terminal height by 24 pixels. |

When focus is in the terminal, **Escape** stays in the shell unless another surface is open.

## Use Electron shortcuts on macOS

| Shortcut | Action |
| --- | --- |
| **Command+N** | Create a session in the current session CWD. |
| **Command+Shift+N** | Open the home workspace in a new window. |
| **Command+W** | Close the current window. |
| **Command+Shift+T** | Open or close the terminal. |
| **Command+,** | Open global **Settings**. |
| **Command+Shift+E** | Open or close **Session details** for the selected session. |
| **Command+Shift+M** | Open or close **Memory**. |
| **Command+E** | Hide or show the desktop sidebar. On mobile, open or close it. |
| **Escape** | Close an open transient surface. With no open surface, stop the active run. |

**Command+N** requires a current session CWD. Leyline ignores it during session
creation. **Command+Shift+N** does not create a session.

**Command+Shift+E** does nothing on Home or while a blocking overlay is open.
**Command+,** opens Settings without toggling an open modal closed. On Linux,
use **Ctrl+,** or the native **Settings…** menu item.
