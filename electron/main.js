import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  shell,
  utilityProcess,
} from 'electron'

app.commandLine.appendSwitch(
  'ignore-connections-limit',
  '127.0.0.1,localhost,::1',
)

const execFileAsync = promisify(execFile)
const PACKAGED_SERVER_START_TIMEOUT_MS = 15000
const PACKAGED_SERVER_STOP_TIMEOUT_MS = 2000
const packagedServerProcessPath = fileURLToPath(
  new URL('./leyline-server-process.js', import.meta.url),
)

let leylineServerProcess
let leylineServerUrl
let leylineServerStarting
let leylineServerStopping
let mainWindow
let quitAfterServerStops = false
let serverStoppedForQuit = false
let unexpectedServerExitHandled = false

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

app.on('second-instance', (_event, argv) => {
  const command = nativeCommandFromArgv(argv)
  if (command?.newWindow) {
    void createWindowFromSource(command, activeWindow())
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

async function createWindow(initialCommand, initialUrl = '') {
  const url = initialUrl
    ? urlWithInitialCommand(initialUrl, initialCommand)
    : await appUrl(initialCommand)
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
  const appOrigin = new URL(url).origin

  window.webContents.setWindowOpenHandler(({ url: openedUrl }) => {
    if (isWorkspaceUrl(openedUrl, appOrigin)) {
      void createWindowFromSource(null, window, openedUrl)
    } else {
      openExternalUrl(openedUrl)
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (new URL(navigationUrl).origin === appOrigin) return
    event.preventDefault()
    openExternalUrl(navigationUrl)
  })

  if (windowState.isMaximized) window.maximize()
  if (windowState.isFullScreen) window.setFullScreen(true)

  window.on('focus', () => { mainWindow = window })
  window.on('close', () => {
    void saveWindowState(window).catch(() => {})
  })

  window.webContents.on('before-input-event', (event, input) => {
    const key = input.key?.toLowerCase()
    const isNewWindow = input.type === 'keyDown'
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
      !isNewWindow
      && !isNewSession
      && !isCloseWindow
      && !isToggleTerminal
      && !isOpenSettings
      && !isToggleMemory
      && !isToggleSidebar
      && !isEscape
    ) return

    if (isEscape) {
      event.preventDefault()
      sendEscapeCommand(window)
      return
    }

    event.preventDefault()
    if (isNewWindow) void createWindowFromSource(null, window)
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

function openExternalUrl(url) {
  if (!isOpenableUrl(url)) return
  void shell.openExternal(url).catch(() => {})
}

function isOpenableUrl(url) {
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:'
      || protocol === 'https:'
      || protocol === 'mailto:'
      || protocol === 'tel:'
  } catch {
    return false
  }
}

function isWorkspaceUrl(value, appOrigin) {
  try {
    const url = new URL(value)
    if (url.origin !== appOrigin) return false
    const backendParam = 'leylineBackendConnectionId'
    const actionParams = [
      'leylineNewSessionCwd',
      'leylineProjectCwd',
      'leylineSessionPath',
    ]
    const allowedParams = new Set([backendParam, ...actionParams])
    for (const name of url.searchParams.keys()) {
      if (!allowedParams.has(name)) return false
    }
    for (const name of allowedParams) {
      const values = url.searchParams.getAll(name)
      if (values.length > 1 || values.some((item) => !item.trim())) return false
    }
    const actionCount = actionParams
      .filter((name) => url.searchParams.has(name)).length
    if (url.pathname === '/') return actionCount <= 1
    return actionCount === 0
      && /^\/sessions\/[^/]+\/?$/.test(url.pathname)
  } catch {
    return false
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

async function createWindowFromSource(command, sourceWindow, initialUrl = '') {
  const backendConnectionId = initialBackendConnectionId(initialUrl)
    || await currentWindowBackendConnectionId(sourceWindow)
  await createWindow(
    withBackendConnection(command, backendConnectionId),
    initialUrl,
  )
}

function initialBackendConnectionId(value) {
  if (!value) return ''
  try {
    return new URL(value).searchParams
      .get('leylineBackendConnectionId')?.trim() || ''
  } catch {
    return ''
  }
}

async function currentWindowBackendConnectionId(window) {
  if (!window || window.isDestroyed()) return ''

  try {
    const id = await window.webContents.executeJavaScript(
      'window.__leylineBackendConnectionId || ""',
    )
    return typeof id === 'string' ? id.trim() : ''
  } catch {
    return ''
  }
}

function withBackendConnection(command, backendConnectionId) {
  if (!backendConnectionId) return command
  return {
    ...(command || {}),
    detail: {
      ...(command?.detail || {}),
      backendConnectionId,
    },
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
  const newWindow = argv.includes('--leyline-new-window')
  if (!argv.includes('--leyline-new-session')) {
    return newWindow ? { newWindow: true } : null
  }

  const cwd = argvValue(argv, '--leyline-cwd')
  return newSessionCommand(
    validCwdArg(cwd) ? resolve(cwd) : '',
    { newWindow },
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
  const child = utilityProcess.fork(packagedServerProcessPath, [], {
    cwd: process.cwd(),
    serviceName: 'Leyline Backend',
  })
  let serverReady = false
  leylineServerProcess = child

  child.on('error', (type, location) => {
    console.error(`Leyline backend process error (${type}) at ${location}`)
  })
  child.on('exit', (code) => {
    if (leylineServerProcess !== child) return
    leylineServerProcess = undefined
    leylineServerUrl = undefined
    if (quitAfterServerStops) return
    if (serverReady) {
      handleUnexpectedServerExit(code)
    } else if (code !== 0) {
      console.error(`Leyline backend process exited with code ${code}`)
    }
  })

  try {
    const url = await waitForPackagedServer(child)
    if (leylineServerProcess !== child) {
      throw new Error('Leyline backend stopped during startup')
    }
    serverReady = true
    leylineServerUrl = url
    return url
  } catch (error) {
    if (leylineServerProcess === child) leylineServerProcess = undefined
    child.kill()
    throw error
  } finally {
    leylineServerStarting = null
  }
}

function waitForPackagedServer(child) {
  return new Promise((resolveServer, rejectServer) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish(
        rejectServer,
        new Error('Timed out while starting the Leyline backend'),
      )
    }, PACKAGED_SERVER_START_TIMEOUT_MS)

    const onMessage = (message) => {
      if (message?.type === 'ready') {
        if (!validPackagedServerUrl(message.url)) {
          finish(rejectServer, new Error('Leyline backend returned an invalid URL'))
          return
        }
        finish(resolveServer, message.url)
      }
      if (message?.type === 'startup-error') {
        finish(
          rejectServer,
          new Error(message.message || 'Could not start the Leyline backend'),
        )
      }
    }
    const onExit = (code) => {
      finish(
        rejectServer,
        new Error(`Leyline backend exited during startup with code ${code}`),
      )
    }
    const finish = (settle, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('message', onMessage)
      child.off('exit', onExit)
      settle(value)
    }

    child.on('message', onMessage)
    child.on('exit', onExit)
  })
}

function validPackagedServerUrl(value) {
  try {
    const url = new URL(value)
    const configuredHost = process.env.LEYLINE_SERVER_HOST || '127.0.0.1'
    const expectedHost = configuredHost.includes(':')
      && !configuredHost.startsWith('[')
      ? `[${configuredHost}]`
      : configuredHost
    const expectedHostname = new URL(`http://${expectedHost}`).hostname
    return url.protocol === 'http:' && url.hostname === expectedHostname
  } catch {
    return false
  }
}

function handleUnexpectedServerExit(code) {
  if (unexpectedServerExitHandled) return
  unexpectedServerExitHandled = true

  const message = `Leyline backend process exited with code ${code}`
  console.error(message)
  const options = {
    type: 'error',
    title: 'Leyline backend stopped',
    message: 'The Leyline backend stopped unexpectedly.',
    detail: `${message}. Leyline must close; reopen it to continue.`,
    buttons: ['Close Leyline'],
    defaultId: 0,
    noLink: true,
  }
  const window = activeWindow()
  const prompt = window
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options)

  void prompt
    .catch((error) => {
      console.error('Could not show the backend failure dialog', error)
    })
    .finally(() => app.quit())
}

function stopPackagedAppServer() {
  if (leylineServerStopping) return leylineServerStopping
  const child = leylineServerProcess
  if (!child) return Promise.resolve()

  leylineServerStopping = new Promise((resolveStop) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off('exit', finish)
      if (leylineServerProcess === child) leylineServerProcess = undefined
      leylineServerUrl = undefined
      resolveStop()
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish()
    }, PACKAGED_SERVER_STOP_TIMEOUT_MS)

    child.once('exit', finish)
    try {
      child.postMessage({ type: 'close' })
    } catch {
      child.kill()
      finish()
    }
  }).finally(() => {
    leylineServerStopping = undefined
  })

  return leylineServerStopping
}

function urlWithInitialCommand(url, command) {
  const cwd = command?.name === 'leyline:new-session' ? command.detail?.cwd : ''
  const backendConnectionId = command?.detail?.backendConnectionId
  if (!cwd && !backendConnectionId) return url

  const next = new URL(url)
  if (cwd) next.searchParams.set('leylineNewSessionCwd', cwd)
  if (backendConnectionId) {
    next.searchParams.set('leylineBackendConnectionId', backendConnectionId)
  }
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
    if (process.platform === 'linux') Menu.setApplicationMenu(null)
    await createWindow(nativeCommandFromArgv(process.argv))
  })
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (serverStoppedForQuit || !leylineServerProcess) return
  event.preventDefault()
  if (quitAfterServerStops) return

  quitAfterServerStops = true
  void stopPackagedAppServer().finally(() => {
    serverStoppedForQuit = true
    app.quit()
  })
})
