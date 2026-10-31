import { backendConnectionsHandler, readNetworkAccessSettings } from '../backend-connections.js'
import { configureNetworkAccess, localServerUrl } from '../network-access.js'
import { configureDictationWebSocketServer } from '../dictation-sockets.js'
import { createPiRuntimeApi } from './runtime.js'
import { applyTlsTrustAtStartup } from './tls-trust.js'
import { createPiApiHandler } from './router.js'
import { configureEventWebSocketServer } from './event-sockets.js'
import {
  configurePiWebSocketServer as configureTerminalWebSocketServer,
} from './terminal.js'

const runtime = createPiRuntimeApi()
const eventServers = new Set()

export function piApi() {
  let closeNetworkAccess
  let closeDictation
  return {
    name: 'pi-api',
    closeBundle: () => Promise.all([closeDictation?.(), closeNetworkAccess?.(), shutdownPiRuntime()]),
    configureServer(server) {
      applyTlsTrustAtStartup()
      configurePiWebSocketServer(server.httpServer)
      const protocol = server.config.server.https ? 'https' : 'http'
      closeDictation = configureDictationWebSocketServer(server.httpServer, { protocol })
      server.httpServer.once('listening', () => {
        const url = localServerUrl(server.httpServer, protocol)
        const owner = JSON.stringify(['vite', server.config.root, url])
        closeNetworkAccess = configureNetworkAccess(server.httpServer, {
          ...readNetworkAccessSettings(owner),
          protocol,
        })
        process.env.LEYLINE_SERVER_URL = url
      })
      server.middlewares.use('/api/leyline', backendConnectionsHandler)
      server.middlewares.use('/api/pi', piApiHandler)
    },
  }
}

export function configurePiWebSocketServer(httpServer) {
  const closeEvents = configureEventWebSocketServer(httpServer, runtime)
  eventServers.add(closeEvents)
  httpServer.once('close', () => eventServers.delete(closeEvents))
  configureTerminalWebSocketServer(
    httpServer,
    runtime.activeRuntimeCwd,
    async (sessionId) => {
      const handle = await runtime.runtimeHandleForId(sessionId)
      return handle?.runtime.cwd
    },
  )
}

export const piApiHandler = createPiApiHandler(runtime)
export function shutdownPiRuntime() {
  for (const close of eventServers) close()
  eventServers.clear()
  return runtime.shutdownRuntime()
}
