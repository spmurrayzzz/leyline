# Windows development

Leyline can be developed and run from a repository checkout on native
Windows (no WSL). This page covers the development build only; there is
no packaged Windows application yet.

## Prerequisites

- **Windows 10 (1809+) or Windows 11, x64.**
- **Git for Windows** — required. Pi runs its agent shell commands through
  Git Bash, and Leyline uses Git for review features.
- **Node.js 22.19.0** (the version in `.nvmrc`) is the supported line.
  Node 24.x is also verified. We recommend
  [fnm](https://github.com/Schniz/fnm) (`winget install Schniz.fnm`) to
  manage versions; note that nvm-windows does not read `.nvmrc`
  automatically.
- npm and GitHub access during `npm install` (one dependency is fetched
  from GitHub).

If PowerShell refuses to run `npm` on a fresh profile, that is the
execution policy blocking `npm.ps1`; use `cmd.exe`, PowerShell 7, or set
the policy for your user. This is a Windows setting, not a Leyline issue.

## Install and run

```powershell
git clone <your fork>
cd leyline
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173/`). You can
start the dev server from PowerShell, cmd, Git Bash, or the VS Code
terminal; Leyline behaves the same in each case.

For the desktop window during development, start `npm run dev` first,
then in a second terminal:

```powershell
npm run electron:dev
```

`electron:build` and `local-publish` are macOS/Linux packaging scripts
and are expected not to work on Windows.

Note: the Electron package downloads its binary on install. If that
download is interrupted, `node node_modules/electron/install.js` retries
it; the binary can also be placed manually under
`node_modules/electron/dist/`.

## Shells on Windows

Three different things run shells, and they are not the same:

| Surface | Shell |
| --- | --- |
| The model's `bash` tool | Git Bash (Pi's resolution; set `shellPath` in `~/.pi/agent/settings.json` for a custom location) |
| The model's `powershell` tool | PowerShell 7, falling back to Windows PowerShell 5.1 |
| Commands you type with a leading `!` | Always Git Bash |
| The terminal drawer | PowerShell 7, then Windows PowerShell 5.1; Git Bash is selectable with the `LEYLINE_TERMINAL_SHELL` environment variable (`pwsh`, `powershell`, `git-bash`, `cmd`, or an absolute path) |

The model is offered both the `bash` and `powershell` tools on Windows
and chooses per task, unless your Pi settings remove one of them.

Verify Git Bash is working by running `!printf ok` in the composer. If
Pi cannot find Bash, install Git for Windows or set `shellPath` (in JSON,
write backslashes doubled, e.g. `"C:\\Program Files\\Git\\bin\\bash.exe"`).

## Where files live

- Leyline data: `%USERPROFILE%\.local\share\leyline\memory.sqlite`
  (override with `LEYLINE_MEMORY_DIR`)
- Pi configuration, credentials, and sessions: `%USERPROFILE%\.pi\agent\`
  (`settings.json`, `models.json`, `auth.json`, `mcp.json`, `sessions\`)

To reset Leyline's own state, stop the dev server, delete the
`.local\share\leyline` folder, and start again.

## Providers and MCP

Provider sign-in and model settings happen on the backend (this
machine). After setting provider API keys as environment variables,
restart the terminal and the dev server so the backend inherits them.

For MCP servers, `npx`-based stdio servers work as documented; do not
wrap commands in `cmd /c`. In `mcp.json`, reference environment values
with the `${VAR}` spelling (for example `${GITHUB_TOKEN}`). The Windows
`%VAR%` spelling is not expanded; rewrite it as `${VAR}`.

## Tracing

Tracing is supported on native Windows. Leyline's pinned Elune dependency
uses Windows ACLs for private trace storage. The trace database is
`%USERPROFILE%\.local\share\leyline\elune\elune.db` by default, or
`elune\elune.db` under `LEYLINE_MEMORY_DIR` when that override is set.

## Known limitations on Windows

- The terminal editor must be a real `.exe` (for example Neovim's
  `nvim.exe`). Editors installed only as `.cmd` shims cannot run inside
  the terminal drawer in this version; use the desktop-editor flow
  instead.
- The backend API has no authentication. Keep the dev server on
  loopback; do not expose it to a network you do not trust.

## Troubleshooting

- **`npm install` fails fetching a GitHub dependency:** the Elune
  dependency is pinned to a commit over HTTPS; check your network/proxy
  and retry.
- **Terminal opens the wrong shell or none:** set
  `LEYLINE_TERMINAL_SHELL` to an absolute shell path and reopen the
  terminal; the error message in the drawer lists what was searched.
- **Git says "dubious ownership":** run
  `git config --global --add safe.directory <path>` for that repository.
- **Vite picked a different port:** if 5173 is busy, Vite moves; use the
  URL it prints, and set `LEYLINE_DEV_SERVER_URL` accordingly for
  Electron.
- **Do not commit screenshots regenerated on Windows** (`npm run
  docs:screenshots`): font rendering differs from the tracked macOS
  assets.
