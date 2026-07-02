import { createPiRuntimeApi } from './runtime.js'
import { createPiApiHandler } from './router.js'
import {
  configurePiWebSocketServer as configureTerminalWebSocketServer,
} from './terminal.js'

const runtime = createPiRuntimeApi()

export function piApi() {
  return {
    name: 'pi-api',
    configureServer(server) {
      configurePiWebSocketServer(server.httpServer)
      server.middlewares.use('/api/pi', (req, res, next) => {
        if (req.headers.host) process.env.LEYLINE_SERVER_URL = `http://${req.headers.host}`
        piApiHandler(req, res, next)
      })
    },
  }
}

export function configurePiWebSocketServer(httpServer) {
  configureTerminalWebSocketServer(httpServer, runtime.activeRuntimeCwd)
}

export const piApiHandler = createPiApiHandler(runtime)
