export function setCorsHeaders(req, res) {
  const origin = req.headers.origin
  if (!origin) return true
  if (!requestOriginAllowed(req)) return false

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
  )
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
  return true
}

export function requestOriginAllowed(req) {
  const origin = req.headers.origin
  if (!origin) return true

  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }

  if (url.origin === requestOrigin(req)) return true
  if (loopbackHostname(url.hostname)) return true

  const configured = String(process.env.LEYLINE_SERVER_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => normalizedOrigin(value))
    .filter(Boolean)
  return configured.includes('*') || configured.includes(url.origin)
}

function requestOrigin(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
  const protocol = forwarded || (req.socket?.encrypted ? 'https' : 'http')
  return `${protocol}://${req.headers.host}`
}

function normalizedOrigin(value) {
  try {
    return new URL(value.trim()).origin
  } catch {
    return value.trim() === '*' ? '*' : ''
  }
}

function loopbackHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(host)
}
