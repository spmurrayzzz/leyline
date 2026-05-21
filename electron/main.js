import { app, BrowserWindow } from 'electron'

let leylineServer
let mainWindow

async function createWindow() {
  const url = await appUrl()

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b0b10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await mainWindow.loadURL(url)
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
