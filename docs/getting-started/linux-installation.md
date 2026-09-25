# Linux installation

This guide follows a working x86-64 Omarchy (Arch-based Linux) installation
with Hyprland on Wayland. Other distributions and architectures have not been
validated. It builds Electron from source and installs it for the current user;
it does not produce an AppImage, DEB, or RPM.

For browser development instead, follow [Installation](./installation) and
run `npm run dev`.

::: warning macOS-only helpers
Do not run `npm run local-publish` on Linux or link the repository's
`bin/leyline` as your launcher. Both currently expect a macOS `.app` bundle.
Use the Linux launcher below.
:::

## Prerequisites

- Git, Bash, and rsync.
- The Node.js version in `.nvmrc` (currently 22.19.0), with npm.
- A C/C++ compiler, make, and Python 3 if npm needs to build native dependencies.
- A graphical desktop and Electron runtime libraries, including GTK 3, NSS,
  ALSA, and GBM. These are present on the reference desktop; package names vary
  by distribution. Check for missing libraries after building.
- A [configured pi environment](./requirements), including model-provider
  credentials.

The commands below use [mise](https://mise.jdx.dev/getting-started.html), as on
the reference machine. You can instead select `.nvmrc` with `fnm`, `nvm`, or
another Node version manager and run the npm commands without the
`mise exec "node@$node_version" --` prefix. Do not run npm or install Leyline
with `sudo`.

## 1. Clone and build

Run these commands in Bash:

```bash
git clone https://github.com/spmurrayzzz/leyline.git "$HOME/leyline"
cd "$HOME/leyline"

node_version="$(tr -d '[:space:]' < .nvmrc)"
node_version="${node_version#v}"
mise install "node@$node_version"
mise exec "node@$node_version" -- npm install --no-package-lock
mise exec "node@$node_version" -- npm run electron:build
```

If you already have a checkout, use it instead of cloning again. The repository
does not track a package lock; `--no-package-lock` avoids creating one locally.

The build includes the Vue app, documentation, backend, and Electron runtime.
On x86-64 Linux, the output is `release/Leyline-linux-x64/`. Check it before
installing:

```bash
test -x release/Leyline-linux-x64/Leyline
ldd release/Leyline-linux-x64/Leyline
```

If `ldd` reports any library as `not found`, install the corresponding runtime
package for your distribution before continuing.

## 2. Install the application

Use an external terminal, not Leyline's embedded terminal. If updating an
existing installation, finish or stop active agent runs and quit all Leyline
windows before replacing files. See [Updating](#updating) for the update order.

From the repository directory:

```bash
mkdir -p "$HOME/.local/opt/leyline"
rsync -a --delete release/Leyline-linux-x64/ "$HOME/.local/opt/leyline/"
test -x "$HOME/.local/opt/leyline/Leyline"
```

Copy the whole package, not just the `Leyline` executable. `--delete` removes
obsolete files only within the installation directory. Keep personal files out
of that directory; pi sessions and Leyline's metadata live separately.

The packaged app includes its backend. It does not need a Vite server running.

## 3. Add the CLI launcher

Create `~/.local/bin/leyline`. If you already have a customized launcher, review
it before replacing it with this one. If that path is a symlink to the
repository's macOS launcher, remove the symlink first so you do not overwrite
its target.

```bash
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/leyline" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

cwd="${LEYLINE_CWD:-$PWD}"
executable="${LEYLINE_APP:-$HOME/.local/opt/leyline/Leyline}"
new_window=0

while (($#)); do
  case "$1" in
    -n) new_window=1; shift ;;
    *) echo "usage: leyline [-n]" >&2; exit 2 ;;
  esac
done

if [[ ! -x "$executable" ]]; then
  echo "Leyline executable not found at $executable." >&2
  exit 1
fi

if [[ "$new_window" -eq 1 ]]; then
  args=(--leyline-new-window)
else
  args=(--leyline-new-session "--leyline-cwd=$cwd")
fi

"$executable" "${args[@]}" >/dev/null 2>&1 &
EOF
chmod 0755 "$HOME/.local/bin/leyline"
```

Make sure `~/.local/bin` is on your `PATH`. For the current Bash shell:

```bash
export PATH="$HOME/.local/bin:$PATH"
command -v leyline
```

Add that export to your shell startup file if it is not already configured.

- `leyline` opens or focuses the app and creates a session for the current
  shell directory.
- `leyline -n` opens a new window at the home workspace; it does not create a
  session or use the shell directory.
- `LEYLINE_CWD` overrides the directory for plain `leyline`.
- `LEYLINE_APP` overrides the Linux **executable path**, not a `.app` directory.

## 4. Add an application-menu entry

From the repository directory:

```bash
mkdir -p \
  "$HOME/.local/share/applications" \
  "$HOME/.local/share/icons/hicolor/1024x1024/apps"
install -m 0644 assets/icon.png \
  "$HOME/.local/share/icons/hicolor/1024x1024/apps/leyline.png"

cat > "$HOME/.local/share/applications/leyline.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Leyline
Comment=Web UI for pi coding-agent sessions
Exec="$HOME/.local/opt/leyline/Leyline"
Icon=leyline
Terminal=false
Categories=Development;
Keywords=pi;coding;agent;
StartupNotify=true
StartupWMClass=Leyline
EOF
```

The unquoted `EOF` expands `$HOME` while writing the desktop entry. The saved
`Exec` line must contain an absolute path; desktop entries do not expand `~`
or `$HOME` themselves.

If available, use these optional utilities to validate the entry and refresh
menu/icon caches (`desktop-file-utils` and GTK provide them):

```bash
desktop-file-validate "$HOME/.local/share/applications/leyline.desktop"
update-desktop-database "$HOME/.local/share/applications"
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor"
```

## 5. Verify the installation

Open **Leyline** from the application menu, or launch it directly from an
external terminal to see startup errors:

```bash
"$HOME/.local/opt/leyline/Leyline"
```

Check that you can select a project, submit a prompt with a configured model,
and use the embedded terminal. Then try `leyline` from a project directory and
`leyline -n` to verify the launcher behavior described above.

Electron loads your interactive login-shell environment on Linux, including
provider credentials and tool paths. See [Environment handling](../electron/environment)
if launching from the menu behaves differently from launching in a terminal.
For startup failures, see
[Troubleshooting](../reference/troubleshooting#the-linux-electron-app-does-not-start).

## Updating

1. From an external terminal, inspect `git status --short` in your checkout.
   Resolve local changes before pulling; do not discard work to update.
2. With a clean checkout, run `git pull --ff-only`.
3. Repeat the Node selection, dependency installation, build, and library
   checks from [Clone and build](#_1-clone-and-build). Leave the working app
   installed until the new build succeeds.
4. Finish or stop active agent runs and quit all Leyline windows. Keep a copy
   of `~/.local/opt/leyline` outside that directory for rollback, then follow
   [Install the application](#_2-install-the-application). Do not replace files
   in a running app.
5. Relaunch and repeat the verification checks. Keep the previous package until
   the new one works. If it fails, quit Leyline and restore the previous package.

The launcher and desktop entry only need updating if their paths or contents
change. Replacing `~/.local/opt/leyline` does not remove pi sessions or
Leyline's metadata in `~/.local/share/leyline`.
