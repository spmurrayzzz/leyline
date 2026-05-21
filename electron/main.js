import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

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

  await mainWindow.loadURL(url)
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

app.whenReady().then(createWindow)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await leylineServer?.close()
})
