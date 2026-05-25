# Environment variables

| Variable | Purpose |
| --- | --- |
| `LEYLINE_DEV_SERVER_URL` | Electron dev URL, usually `http://localhost:5173`. |
| `LEYLINE_PUBLIC_URL` | Base URL for export share metadata. |
| `PI_ENABLE_CREATE_GOAL` | Enables the goal extension `create_goal` model tool. |

Provider and tool variables are inherited from the user's pi setup. Electron on macOS loads shell environment values, including PATH, so model and tool commands can be found.
