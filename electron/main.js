import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow } from 'electron'

const execFileAsync = promisify(execFile)

let leylineServer
let mainWindow
const pendingWindowCommands = []

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const command = nativeCommandFromArgv(argv)
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow(command)
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  app.focus({ steal: true })
  mainWindow.focus()
  if (command) sendWindowCommand(mainWindow, command.name, command.detail)
})

async function createWindow(initialCommand) {
  const url = await appUrl(initialCommand)
  const windowState = await readWindowState()

  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b0b10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (windowState.isMaximized) mainWindow.maximize()
  if (windowState.isFullScreen) mainWindow.setFullScreen(true)

  mainWindow.on('close', () => {
    void saveWindowState(mainWindow).catch(() => {})
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key?.toLowerCase()
    const isNewSession = input.type === 'keyDown'
      && key === 'n'
      && (input.meta || input.control)
    const isToggleTerminal = input.type === 'keyDown'
      && key === 't'
      && input.meta
      && input.shift
    const isOpenSettings = input.type === 'keyDown'
      && key === 'e'
      && input.meta
      && input.shift
    const isToggleSidebar = input.type === 'keyDown'
      && key === 'e'
      && input.meta
      && !input.shift
    const isEscape = input.type === 'keyDown' && key === 'escape'

    if (
      !isNewSession
      && !isToggleTerminal
      && !isOpenSettings
      && !isToggleSidebar
      && !isEscape
    ) return

    if (isEscape) {
      sendEscapeCommand(mainWindow)
      return
    }

    event.preventDefault()
    if (isNewSession) sendNewSessionCommand(mainWindow)
    if (isToggleTerminal) sendToggleTerminalCommand(mainWindow)
    if (isOpenSettings) sendOpenSettingsCommand(mainWindow)
    if (isToggleSidebar) sendToggleSidebarCommand(mainWindow)
  })

  await mainWindow.loadURL(url)
  flushWindowCommands(mainWindow)
  if (initialCommand) {
    sendWindowCommand(mainWindow, initialCommand.name, initialCommand.detail)
  }
}

function sendEscapeCommand(window) {
  sendWindowCommand(window, 'leyline:escape')
}

function sendNewSessionCommand(window) {
  sendWindowCommand(window, 'leyline:new-session')
}

function sendToggleTerminalCommand(window) {
  sendWindowCommand(window, 'leyline:toggle-terminal')
}

function sendOpenSettingsCommand(window) {
  sendWindowCommand(window, 'leyline:open-settings')
}

function sendToggleSidebarCommand(window) {
  sendWindowCommand(window, 'leyline:toggle-sidebar')
}

function sendWindowCommand(window, name, detail = null) {
  if (!window || window.isDestroyed()) return

  if (window.webContents.isLoading()) {
    pendingWindowCommands.push({ name, detail })
    return
  }

  const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(name)}, `
    + `{ detail: ${JSON.stringify(detail)} }))`
  window.webContents.executeJavaScript(script).catch(() => {})
}

function flushWindowCommands(window) {
  const commands = pendingWindowCommands.splice(0)
  for (const command of commands) {
    sendWindowCommand(window, command.name, command.detail)
  }
}

function nativeCommandFromArgv(argv) {
  if (!argv.includes('--leyline-new-session')) return null

  const cwd = argvValue(argv, '--leyline-cwd')
  return {
    name: 'leyline:new-session',
    detail: { cwd: validCwdArg(cwd) ? resolve(cwd) : '' },
  }
}

function argvValue(argv, name) {
  const inline = argv.find((item) => item.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)

  const index = argv.indexOf(name)
  if (index === -1 || index + 1 >= argv.length) return ''
  return argv[index + 1]
}

function validCwdArg(value) {
  return Boolean(value && !value.startsWith('--'))
}

async function readWindowState() {
  try {
    const state = JSON.parse(await readFile(windowStatePath(), 'utf8'))
    return {
      bounds: validBounds(state.bounds) ?? defaultBounds(),
      isMaximized: Boolean(state.isMaximized),
      isFullScreen: Boolean(state.isFullScreen),
    }
  } catch {
    return {
      bounds: defaultBounds(),
      isMaximized: false,
      isFullScreen: false,
    }
  }
}

async function saveWindowState(window) {
  if (!window || window.isDestroyed()) return

  const state = {
    bounds: window.getNormalBounds(),
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen(),
  }

  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(windowStatePath(), `${JSON.stringify(state, null, 2)}\n`)
}

function windowStatePath() {
  return join(app.getPath('userData'), 'window-state.json')
}

function defaultBounds() {
  return {
    width: 1320,
    height: 900,
  }
}

function validBounds(bounds) {
  if (!bounds || !validSize(bounds.width) || !validSize(bounds.height)) {
    return null
  }

  return {
    ...(validPosition(bounds.x) ? { x: bounds.x } : {}),
    ...(validPosition(bounds.y) ? { y: bounds.y } : {}),
    width: bounds.width,
    height: bounds.height,
  }
}

function validSize(value) {
  return Number.isInteger(value) && value >= 100
}

function validPosition(value) {
  return Number.isInteger(value)
}

async function appUrl(initialCommand) {
  const url = process.env.LEYLINE_DEV_SERVER_URL
    || await packagedAppUrl()
  return urlWithInitialCommand(url, initialCommand)
}

async function packagedAppUrl() {
  const { startLeylineServer } = await import('../server/leyline-server.js')
  leylineServer = await startLeylineServer()
  return leylineServer.url
}

function urlWithInitialCommand(url, command) {
  if (command?.name !== 'leyline:new-session' || !command.detail?.cwd) {
    return url
  }

  const next = new URL(url)
  next.searchParams.set('leylineNewSessionCwd', command.detail.cwd)
  return next.toString()
}

async function loadLoginShellEnvironment() {
  if (process.platform !== 'darwin') return

  const shell = process.env.SHELL || '/bin/zsh'

  try {
    const { stdout } = await execFileAsync(
      shell,
      ['-ilc', '/usr/bin/env -0'],
      { encoding: 'buffer', maxBuffer: 1024 * 1024, timeout: 5000 },
    )

    for (const entry of stdout.toString('utf8').split('\0')) {
      const index = entry.indexOf('=')
      if (index <= 0) continue

      const key = entry.slice(0, index)
      const value = entry.slice(index + 1)
      if (key === 'PATH' || !process.env[key]) process.env[key] = value
    }
  } catch {
  }
}

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    await loadLoginShellEnvironment()
    await createWindow(nativeCommandFromArgv(process.argv))
  })
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await leylineServer?.close()
})
