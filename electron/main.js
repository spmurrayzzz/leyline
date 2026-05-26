import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, BrowserWindow } from 'electron'

const execFileAsync = promisify(execFile)

let leylineServer
let mainWindow

async function createWindow() {
  const url = await appUrl()
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

function sendWindowCommand(window, name) {
  if (!window || window.isDestroyed()) return

  window.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('${name}'))`,
  ).catch(() => {})
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

async function appUrl() {
  if (process.env.LEYLINE_DEV_SERVER_URL) {
    return process.env.LEYLINE_DEV_SERVER_URL
  }

  const { startLeylineServer } = await import('../server/leyline-server.js')
  leylineServer = await startLeylineServer()
  return leylineServer.url
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

app.whenReady().then(async () => {
  await loadLoginShellEnvironment()
  await createWindow()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await leylineServer?.close()
})
