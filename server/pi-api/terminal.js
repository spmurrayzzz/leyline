import { spawn } from 'node:child_process'
import { chmodSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { getPowerShellConfig, getShellConfig } from '@earendil-works/pi-coding-agent'
import pty from 'node-pty'
import { WebSocket, WebSocketServer } from 'ws'
import { requestOriginAllowed } from './cors.js'
import { terminalEditorOptions } from './files.js'

const require = createRequire(import.meta.url)

export function configurePiWebSocketServer(
  httpServer,
  getActiveCwd,
  getSessionCwd,
) {
  const terminalServer = new WebSocketServer({ noServer: true })

  terminalServer.on('connection', (ws, req) => {
    void openTerminal(ws, req, getActiveCwd, getSessionCwd)
  })
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/pi/terminal') return
    if (!requestOriginAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    terminalServer.handleUpgrade(req, socket, head, (ws) => {
      terminalServer.emit('connection', ws, req)
    })
  })
}

async function openTerminal(ws, req, getActiveCwd, getSessionCwd) {
  const params = new URL(req.url, 'http://localhost').searchParams
  const sessionId = params.get('sessionId')
  const editorRequested = params.has('editorPath')
  let cwd

  if (editorRequested && !sessionId) {
    closeWithError(ws, 'A sessionId is required for an editor terminal')
    return
  }

  try {
    cwd = sessionId
      ? await getSessionCwd?.(sessionId)
      : getActiveCwd?.()
  } catch (error) {
    closeWithError(ws, error.message)
    return
  }

  if (ws.readyState !== WebSocket.OPEN) return
  if (!cwd) {
    closeWithError(ws, sessionId ? 'Session not found' : 'No active session')
    return
  }

  let term

  if (!isDirectory(cwd)) {
    closeWithError(ws, `Invalid cwd: ${cwd}`)
    return
  }

  let editor
  let shellInfo = null
  try {
    if (editorRequested) {
      editor = await terminalEditorOptions(cwd, {
        editorPath: params.get('editorPath'),
        editorLine: params.get('editorLine'),
        allowOutsideProject: params.get('allowOutsideProject') === 'true',
      })
      // Frozen C-EDITOR contract: files.js decides what runs, this module
      // decides how to spawn it. A shell wrapper is not guessed at on win32.
      if (process.platform === 'win32' && editor?.requiresShell === true) {
        throw new Error('editor requires a shell wrapper, not supported on Windows yet')
      }
    }
    if (ws.readyState !== WebSocket.OPEN) return
    try {
      shellInfo = resolveTerminalShell()
    } catch (error) {
      // An editor terminal can still run without a resolvable shell; a
      // plain terminal must surface the structured not-found error.
      if (!editor) throw error
    }
    ensureNodePtyHelperExecutable()
    term = pty.spawn(editor?.executable || shellInfo?.executable, editor?.args || shellInfo?.args || [], {
      name: 'xterm-256color',
      cols: 100,
      rows: 24,
      cwd,
      env: terminalEnv(shellInfo),
    })
  } catch (error) {
    closeWithError(ws, `Failed to start PTY: ${error.message}`)
    return
  }

  let exited = false

  ws.send(JSON.stringify({
    type: 'ready',
    cwd,
    shell: editor?.executable || shellInfo?.executable,
    ...(editor ? { editorPath: editor.path } : {}),
    pty: true,
  }))

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data }))
    }
  })

  term.onExit(({ exitCode }) => {
    exited = true
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', exitCode }))
      ws.close()
    }
  })

  ws.on('message', (message) => {
    let payload
    try {
      payload = JSON.parse(message.toString())
    } catch {
      return
    }

    if (payload.type === 'input') term.write(payload.data || '')
    if (payload.type === 'resize') {
      term.resize(payload.cols || 100, payload.rows || 24)
    }
  })

  ws.on('close', () => {
    if (!exited) {
      term.kill()
      killTerminalTree(term.pid)
    }
  })
}

function closeWithError(ws, message) {
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'error', message }))
  ws.close()
}

function ensureNodePtyHelperExecutable() {
  if (process.platform !== 'darwin') return

  const nodePtyDir = dirname(require.resolve('node-pty/package.json'))
  const helper = join(
    nodePtyDir,
    'prebuilds',
    `darwin-${process.arch}`,
    'spawn-helper',
  ).replace('app.asar', 'app.asar.unpacked')

  if (!existsSync(helper)) return
  const mode = statSync(helper).mode
  if (mode & 0o111) return
  chmodSync(helper, mode | 0o755)
}

// Structured terminal shell resolution (spec TRM-1/TRM-2, contract C-SHELL).
// Exported for testability; the WebSocket frame shapes are unchanged.
// pi's getShellConfig/getPowerShellConfig are reused only as discovery
// sources: they return tool-mode args (e.g. ["-c"], ["-NoProfile",
// "-NonInteractive", ... "-Command"]) which must NOT be reused for an
// interactive terminal, so per-kind interactive args are defined here.
export function resolveTerminalShell({ override } = {}) {
  if (process.platform !== 'win32') {
    const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
    const executable = candidates.find((shell) => shell && existsSync(shell)) || '/bin/sh'
    return { executable, args: ['-l'], kind: 'posix', searched: [...candidates] }
  }

  const searched = []
  const refused = []
  const rawOverride = override !== undefined ? override : process.env.LEYLINE_TERMINAL_SHELL
  if (rawOverride !== undefined && rawOverride !== null && String(rawOverride).trim() !== '') {
    return resolveWindowsOverride(String(rawOverride).trim(), searched, refused)
  }

  const pwsh = firstExisting(pwshCandidates(searched))
  if (pwsh) return { executable: pwsh, args: ['-NoLogo'], kind: 'pwsh', searched }

  const powershell = firstExisting(powershellCandidates(searched))
  if (powershell) return { executable: powershell, args: ['-NoLogo'], kind: 'powershell', searched }

  const bash = firstExisting(gitBashCandidates(searched, refused))
  if (bash) return { executable: bash, args: ['--login', '-i'], kind: 'git-bash', searched }

  const cmd = firstExisting(cmdCandidates(searched))
  if (cmd) return { executable: cmd, args: [], kind: 'cmd', searched }

  throw new Error(windowsShellNotFoundMessage(searched, refused))
}

function resolveWindowsOverride(override, searched, refused) {
  const keyword = override.toLowerCase()
  if (keyword === 'pwsh' || keyword === 'powershell' || keyword === 'git-bash' || keyword === 'cmd') {
    const candidates = keyword === 'pwsh'
      ? pwshCandidates(searched)
      : keyword === 'powershell'
        ? powershellCandidates(searched)
        : keyword === 'git-bash'
          ? gitBashCandidates(searched, refused)
          : cmdCandidates(searched)
    const executable = firstExisting(candidates)
    if (!executable) {
      throw new Error(
        `LEYLINE_TERMINAL_SHELL=${override} did not resolve to an installed shell. `
        + windowsShellNotFoundMessage(searched, refused),
      )
    }
    const kind = keyword
    return { executable, args: interactiveArgs(kind), kind, searched }
  }

  if (!isAbsolute(override)) {
    throw new Error(
      `LEYLINE_TERMINAL_SHELL must be an absolute path or one of git-bash|pwsh|powershell|cmd; got "${override}". `
      + 'Set it to an absolute shell path or install PowerShell 7 or Git for Windows.',
    )
  }

  searched.push(override)
  if (isLegacyWslBash(override)) {
    throw new Error(
      `LEYLINE_TERMINAL_SHELL points to the legacy WSL bash at ${override}, which is refused: `
      + 'Leyline terminals require a native Windows shell. Install Git for Windows or PowerShell 7, '
      + 'or set LEYLINE_TERMINAL_SHELL to a native shell executable.',
    )
  }
  if (!isFile(override)) {
    throw new Error(
      `LEYLINE_TERMINAL_SHELL=${override} does not exist. Searched: ${searched.join('; ')}. `
      + 'Install PowerShell 7 or Git for Windows, or set LEYLINE_TERMINAL_SHELL to an existing shell executable.',
    )
  }
  const kind = kindForExecutable(override)
  return { executable: override, args: interactiveArgs(kind), kind, searched }
}

function interactiveArgs(kind) {
  if (kind === 'git-bash') return ['--login', '-i']
  if (kind === 'pwsh' || kind === 'powershell') return ['-NoLogo']
  return []
}

function kindForExecutable(executable) {
  const name = basename(executable).toLowerCase()
  if (name === 'bash.exe' || name === 'sh.exe') return 'git-bash'
  if (name === 'pwsh.exe') return 'pwsh'
  if (name === 'powershell.exe') return 'powershell'
  if (name === 'cmd.exe') return 'cmd'
  return 'custom'
}

function windowsShellNotFoundMessage(searched, refused) {
  const refusedNote = refused.length
    ? ` Refused legacy WSL bash (never spawned): ${refused.join('; ')}.`
    : ''
  return 'No terminal shell found on Windows. Searched: '
    + `${searched.length ? searched.join('; ') : '(no candidates)'}.`
    + refusedNote
    + ' Install PowerShell 7 or Git for Windows, or set LEYLINE_TERMINAL_SHELL '
    + 'to an absolute shell path (or git-bash|pwsh|powershell|cmd).'
}

function addCandidate(searched, candidates, candidate) {
  if (!candidate) return
  const value = String(candidate)
  if (!candidates.some((entry) => entry.toLowerCase() === value.toLowerCase())) candidates.push(value)
  if (!searched.some((entry) => entry.toLowerCase() === value.toLowerCase())) searched.push(value)
}

function firstExisting(candidates) {
  return candidates.find((candidate) => isFile(candidate)) || null
}

function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isLegacyWslBash(candidate) {
  const value = String(candidate).replace(/\//g, '\\').toLowerCase()
  if (basename(value) !== 'bash.exe') return false
  const systemRoot = (process.env.SystemRoot || 'C:\\Windows').replace(/\//g, '\\').toLowerCase()
  return value === `${systemRoot}\\system32\\bash.exe`
    || value === `${systemRoot}\\sysnative\\bash.exe`
    || /\\windows\\(?:system32|sysnative)\\bash\.exe$/.test(value)
}

function piShellCandidate(getConfig) {
  try {
    const config = getConfig()
    return typeof config?.shell === 'string' && config.shell ? config.shell : null
  } catch {
    return null
  }
}

function pathCandidates(name) {
  const dirs = String(process.env.PATH || '').split(';').filter(Boolean)
  return dirs.map((dir) => join(dir, name))
}

// PATH is searched exhaustively for existence, but reported as one entry so
// not-found messages stay readable instead of listing every PATH directory.
function addPathCandidates(searched, candidates, name) {
  const label = `PATH\\${name}`
  if (!searched.includes(label)) searched.push(label)
  for (const candidate of pathCandidates(name)) {
    if (!candidates.some((entry) => entry.toLowerCase() === candidate.toLowerCase())) candidates.push(candidate)
  }
}

function pwshCandidates(searched) {
  const candidates = []
  addCandidate(searched, candidates, piShellCandidate(getPowerShellConfig))
  // pi may return powershell.exe when pwsh is absent; that belongs to the
  // powershell step, not this one, so only pwsh.exe candidates are kept here.
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (basename(candidates[index]).toLowerCase() !== 'pwsh.exe') candidates.splice(index, 1)
  }
  const programFiles = process.env.ProgramFiles
  if (programFiles) addCandidate(searched, candidates, join(programFiles, 'PowerShell', '7', 'pwsh.exe'))
  addPathCandidates(searched, candidates, 'pwsh.exe')
  return candidates
}

function powershellCandidates(searched) {
  const candidates = []
  const piShell = piShellCandidate(getPowerShellConfig)
  if (piShell && basename(piShell).toLowerCase() === 'powershell.exe') {
    addCandidate(searched, candidates, piShell)
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  addCandidate(searched, candidates, join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  addPathCandidates(searched, candidates, 'powershell.exe')
  return candidates
}

function gitBashCandidates(searched, refused) {
  const candidates = []
  const addBash = (candidate) => {
    if (!candidate) return
    if (isLegacyWslBash(candidate)) {
      if (!refused.some((entry) => entry.toLowerCase() === String(candidate).toLowerCase())) refused.push(String(candidate))
      if (!searched.some((entry) => entry.toLowerCase() === String(candidate).toLowerCase())) searched.push(String(candidate))
      return
    }
    addCandidate(searched, candidates, candidate)
  }
  addBash(piShellCandidate(getShellConfig))
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFiles) addBash(join(programFiles, 'Git', 'bin', 'bash.exe'))
  if (programFilesX86) addBash(join(programFilesX86, 'Git', 'bin', 'bash.exe'))
  // Git-derived location: <Git>\cmd\git.exe or <Git>\bin\git.exe on PATH
  // implies <Git>\bin\bash.exe.
  for (const gitExe of pathCandidates('git.exe')) {
    if (!isFile(gitExe)) continue
    const gitDir = dirname(gitExe)
    const dirName = basename(gitDir).toLowerCase()
    if (dirName === 'cmd' || dirName === 'bin') addBash(join(dirname(gitDir), 'bin', 'bash.exe'))
  }
  if (!searched.includes('PATH\\bash.exe')) searched.push('PATH\\bash.exe')
  for (const candidate of pathCandidates('bash.exe')) {
    // Only existing PATH bash entries matter; legacy WSL entries are
    // recorded as refused, other PATH dirs are covered by the label above.
    if (isLegacyWslBash(candidate) || isFile(candidate)) addBash(candidate)
    else if (!candidates.some((entry) => entry.toLowerCase() === candidate.toLowerCase())) candidates.push(candidate)
  }
  return candidates
}

function cmdCandidates(searched) {
  const candidates = []
  if (process.env.ComSpec) addCandidate(searched, candidates, process.env.ComSpec)
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  addCandidate(searched, candidates, join(systemRoot, 'System32', 'cmd.exe'))
  addPathCandidates(searched, candidates, 'cmd.exe')
  return candidates
}

// Win32 cleanup backstop (shape reimplemented locally from
// mcp-settings-transports.js killMcpProcess; no cross-packet import).
function killTerminalTree(pid) {
  if (process.platform !== 'win32') return
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    spawn(
      join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/F', '/T', '/PID', String(pid)],
      { stdio: 'ignore', windowsHide: true },
    ).on('error', () => {})
  } catch {}
}

function terminalEnv(shellInfo) {
  const env = Object.fromEntries(
    Object.entries(process.env)
      .filter((entry) => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )
  delete env.npm_config_prefix
  delete env.NPM_CONFIG_PREFIX
  env.TERM = 'xterm-256color'
  if (process.platform === 'win32') {
    env.LC_ALL = 'C.UTF-8'
    env.LC_CTYPE = 'C.UTF-8'
    env.LANG = 'C.UTF-8'
    // SHELL is meaningful only for bash kinds on win32; ComSpec, SystemRoot
    // and USERPROFILE are preserved from the inherited environment above.
    if (shellInfo?.kind === 'git-bash') env.SHELL = shellInfo.executable
    else delete env.SHELL
  } else if (shellInfo) {
    env.SHELL = shellInfo.executable
  }
  return env
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
