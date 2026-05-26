import { chmodSync, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import pty from 'node-pty'
import { WebSocket, WebSocketServer } from 'ws'

const require = createRequire(import.meta.url)

export function configurePiWebSocketServer(httpServer, getCwd) {
  const terminalServer = new WebSocketServer({ noServer: true })

  terminalServer.on('connection', (ws) => openTerminal(ws, getCwd))
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname !== '/api/pi/terminal') return

    terminalServer.handleUpgrade(req, socket, head, (ws) => {
      terminalServer.emit('connection', ws, req)
    })
  })
}

function openTerminal(ws, getCwd) {
  const cwd = getCwd?.()
  if (!cwd) {
    ws.send(JSON.stringify({ type: 'error', message: 'No active session' }))
    ws.close()
    return
  }

  const shell = terminalShell()
  const env = terminalEnv()
  let term

  if (!isDirectory(cwd)) {
    ws.send(JSON.stringify({ type: 'error', message: `Invalid cwd: ${cwd}` }))
    ws.close()
    return
  }

  try {
    ensureNodePtyHelperExecutable()
    term = pty.spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: 100,
      rows: 24,
      cwd,
      env,
    })
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Failed to start PTY: ${error.message}`,
    }))
    ws.close()
    return
  }

  let exited = false

  ws.send(JSON.stringify({
    type: 'ready',
    cwd,
    shell,
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
    if (!exited) term.kill()
  })
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

function terminalShell() {
  const candidates = [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh']
  return candidates.find((shell) => shell && existsSync(shell)) || '/bin/sh'
}

function terminalEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env)
      .filter((entry) => entry[1] !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )
  delete env.npm_config_prefix
  delete env.NPM_CONFIG_PREFIX
  env.SHELL = terminalShell()
  return env
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
