export const BUILTIN_BACKEND_CONNECTION_ID = 'builtin'
export const BACKEND_API_VERSION = 1

let activeBackendBaseUrl = ''

export function builtInBackendConnection() {
  return {
    id: BUILTIN_BACKEND_CONNECTION_ID,
    name: 'Native backend',
    url: window.location.origin,
    builtIn: true,
  }
}

export function setActiveBackendConnection(connection) {
  activeBackendBaseUrl = connection?.builtIn ? '' : cleanBaseUrl(connection?.url)
}

export function backendHttpUrl(path, connection) {
  const baseUrl = connection === undefined
    ? activeBackendBaseUrl
    : connection?.builtIn
      ? ''
      : cleanBaseUrl(connection?.url)
  return `${baseUrl}${apiPath(path)}`
}

export function backendWebSocketUrl(path) {
  const url = new URL(backendHttpUrl(path), window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export function backendDisplayAddress(connection) {
  if (!connection) return ''
  try {
    const url = new URL(connection.url)
    const path = url.pathname.replace(/\/$/, '')
    return `${url.host}${path}`
  } catch {
    return connection.url || ''
  }
}

function cleanBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '')
}

function apiPath(path) {
  const value = String(path || '')
  return value.startsWith('/') ? value : `/${value}`
}
