import { startLeylineServer } from '../server/leyline-server.js'

const parentPort = process.parentPort
let leylineServer
let stopping

if (!parentPort) {
  throw new Error('Leyline backend must run as an Electron utility process')
}

parentPort.on('message', (event) => {
  if (event.data?.type !== 'close') return
  void stopServer().finally(() => process.exit(0))
})

try {
  leylineServer = await startLeylineServer()
  parentPort.postMessage({ type: 'ready', url: leylineServer.url })
} catch (error) {
  parentPort.postMessage({
    type: 'startup-error',
    message: error?.message || String(error),
  })
  setTimeout(() => process.exit(1), 0)
}

function stopServer() {
  if (stopping) return stopping
  if (!leylineServer) return Promise.resolve()

  stopping = leylineServer.close()
  leylineServer.server.closeAllConnections?.()
  return stopping
}
