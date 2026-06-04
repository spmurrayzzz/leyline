import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow } from 'electron'

const execFileAsync = promisify(execFile)

let leylineServer
let leylineServerUrl
let leylineServerStarting
let mainWindow

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const command = nativeCommandFromArgv(argv)
  if (command?.newWindow) {
    void createWindow(command)
    return
  }

  const window = activeWindow()
  if (!window) {
    void createWindow(command)
    return
  }

  focusWindow(window)
  if (command) sendWindowCommand(window, command.name, command.detail)
})

async function createWindow(initialCommand) {
  const url = await appUrl(initialCommand)
  const windowState = await readWindowState()

  const window = new BrowserWindow({
    ...windowState.bounds,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b0b10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = window

  if (windowState.isMaximized) window.maximize()
  if (windowState.isFullScreen) window.setFullScreen(true)

  window.on('focus', () => { mainWindow = window })
  window.on('close', () => {
    void saveWindowState(window).catch(() => {})
  })

  window.webContents.on('before-input-event', (event, input) => {
    const key = input.key?.toLowerCase()
    const isNewSessionWindow = input.type === 'keyDown'
      && key === 'n'
      && input.meta
      && input.shift
    const isNewSession = input.type === 'keyDown'
      && key === 'n'
      && (input.meta || input.control)
      && !input.shift
    const isCloseWindow = input.type === 'keyDown'
      && key === 'w'
      && input.meta
    const isToggleTerminal = input.type === 'keyDown'
      && key === 't'
      && input.meta
      && input.shift
    const isOpenSettings = input.type === 'keyDown'
      && key === 'e'
      && input.meta
      && input.shift
    const isToggleMemory = input.type === 'keyDown'
      && key === 'm'
      && input.meta
      && input.shift
    const isToggleSidebar = input.type === 'keyDown'
      && key === 'e'
      && input.meta
      && !input.shift
    const isEscape = input.type === 'keyDown' && key === 'escape'

    if (
      !isNewSessionWindow
      && !isNewSession
      && !isCloseWindow
      && !isToggleTerminal
      && !isOpenSettings
      && !isToggleMemory
      && !isToggleSidebar
      && !isEscape
    ) return

    if (isEscape) {
      sendEscapeCommand(window)
      return
    }

    event.preventDefault()
    if (isNewSessionWindow) void createNewSessionWindow(window)
    if (isNewSession) sendNewSessionCommand(window)
    if (isCloseWindow) window.close()
    if (isToggleTerminal) sendToggleTerminalCommand(window)
    if (isOpenSettings) sendOpenSettingsCommand(window)
    if (isToggleMemory) sendToggleMemoryCommand(window)
    if (isToggleSidebar) sendToggleSidebarCommand(window)
  })

  await window.loadURL(url)
  focusWindow(window)
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

function sendToggleMemoryCommand(window) {
  sendWindowCommand(window, 'leyline:toggle-memory')
}

function sendToggleSidebarCommand(window) {
  sendWindowCommand(window, 'leyline:toggle-sidebar')
}

function sendWindowCommand(window, name, detail = null) {
  if (!window || window.isDestroyed()) return

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => {
      sendWindowCommand(window, name, detail)
    })
    return
  }

  const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(name)}, `
    + `{ detail: ${JSON.stringify(detail)} }))`
  window.webContents.executeJavaScript(script).catch(() => {})
}

async function createNewSessionWindow(sourceWindow) {
  const cwd = await currentWindowCwd(sourceWindow)
  await createWindow(cwd ? newSessionCommand(cwd, { newWindow: true }) : null)
}

async function currentWindowCwd(window) {
  if (!window || window.isDestroyed()) return ''

  try {
    const cwd = await window.webContents.executeJavaScript(
      'window.__leylineCurrentCwd || ""',
    )
    return typeof cwd === 'string' ? cwd.trim() : ''
  } catch {
    return ''
  }
}

function activeWindow() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed()) return focused
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
}

function focusWindow(window) {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  app.focus({ steal: true })
  window.focus()
  mainWindow = window
}

function nativeCommandFromArgv(argv) {
  if (!argv.includes('--leyline-new-session')) return null

  const cwd = argvValue(argv, '--leyline-cwd')
  return newSessionCommand(
    validCwdArg(cwd) ? resolve(cwd) : '',
    { newWindow: argv.includes('--leyline-new-window') },
  )
}

function newSessionCommand(cwd, options = {}) {
  return {
    name: 'leyline:new-session',
    detail: { cwd },
    newWindow: Boolean(options.newWindow),
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
  if (leylineServerUrl) return leylineServerUrl
  if (leylineServerStarting) return leylineServerStarting

  leylineServerStarting = startPackagedAppServer()
  return leylineServerStarting
}

async function startPackagedAppServer() {
  try {
    const { startLeylineServer } = await import('../server/leyline-server.js')
    leylineServer = await startLeylineServer()
    leylineServerUrl = leylineServer.url
    return leylineServerUrl
  } finally {
    leylineServerStarting = null
  }
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
