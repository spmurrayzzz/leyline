# Keyboard shortcuts

Leyline provides composer, browser, rename, terminal, and Electron shortcuts.

## Use composer shortcuts

| Shortcut | Action |
| --- | --- |
| **Enter** | Submit a prompt. During a run, queue **Steering**. |
| **Option+Enter** | During a run, queue **Follow-up**. |
| **Shift+Enter** | Add a line break. |
| **Escape** | Close an open menu, drawer, dialog, preview, or edit mode. With no open surface, stop the active run. |

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

## Use project folder shortcuts

These shortcuts apply in **Add project folder**.

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

## Use Electron shortcuts on macOS

| Shortcut | Action |
| --- | --- |
| **Command+N** | Create a session in the current session CWD. |
| **Command+Shift+N** | Open a new window for a session in the current CWD. |
| **Command+W** | Close the current window. |
| **Command+Shift+T** | Open or close the terminal. |
| **Command+Shift+E** | Open or close **Settings**. |
| **Command+Shift+M** | Open or close **Memory**. |
| **Command+E** | Hide or show the desktop sidebar. On mobile, open or close it. |
| **Escape** | Close an open transient surface. With no open surface, stop the active run. |

The new-session shortcuts require a current session CWD. Leyline ignores the same-window new-session command during an active run or session creation.
