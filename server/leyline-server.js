import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configurePiWebSocketServer, piApiHandler } from './pi-api.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultDist = join(root, 'dist')

export async function startLeylineServer(options = {}) {
  const distDir = resolve(options.distDir || defaultDist)
  const host = options.host || '127.0.0.1'
  const port = options.port || 0

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)

    if (url.pathname.startsWith('/api/pi/')) {
      req.url = url.pathname.slice('/api/pi'.length) + url.search
      return piApiHandler(req, res)
    }

    return serveStatic(req, res, distDir)
  })

  configurePiWebSocketServer(server)

  await new Promise((resolveServer, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolveServer()
    })
  })

  const address = server.address()
  const actualPort = typeof address === 'object' ? address.port : port

  return {
    server,
    url: `http://${host}:${actualPort}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  }
}

async function serveStatic(req, res, distDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    return res.end('Method not allowed')
  }

  const requestUrl = new URL(req.url, 'http://localhost')
  const pathname = decodeURIComponent(requestUrl.pathname)
  const requested = pathname === '/' ? '/index.html' : pathname
  const filePath = safePath(distDir, requested)

  if (!filePath) return notFound(res)

  const found = await existingStaticFile(filePath)
  const fallback = pathname.startsWith('/docs/')
    ? join(distDir, 'docs', 'index.html')
    : join(distDir, 'index.html')
  const resolved = found || fallback
  const file = await existingFile(resolved)

  if (!file) return notFound(res)

  res.statusCode = 200
  res.setHeader('Content-Type', contentType(file))
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

function safePath(rootDir, pathname) {
  const filePath = resolve(rootDir, `.${pathname}`)
  const pathDiff = relative(rootDir, filePath)
  if (pathDiff.startsWith('..') || pathDiff === '..') return undefined
  return filePath
}

async function existingStaticFile(filePath) {
  try {
    const stats = await stat(filePath)
    if (stats.isFile()) return filePath
    if (stats.isDirectory()) return existingFile(join(filePath, 'index.html'))
  } catch {
    if (!extname(filePath)) return existingFile(`${filePath}.html`)
    return undefined
  }
}

async function existingFile(filePath) {
  try {
    const stats = await stat(filePath)
    return stats.isFile() ? filePath : undefined
  } catch {
    return undefined
  }
}

function notFound(res) {
  res.statusCode = 404
  res.end('Not found')
}

function contentType(filePath) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
  }
  return types[extname(filePath)] || 'application/octet-stream'
}
