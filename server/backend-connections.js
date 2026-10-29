import { createHash, randomUUID } from 'node:crypto'
import { AUTOLINK_BARE_FILENAMES_SETTING_KEY, NETWORK_ACCESS_PORT_SETTING_KEY, NETWORK_ACCESS_SETTING_KEY, THINKING_DEFAULT_SETTING_KEY } from '../lib/leyline-settings.js'
import { networkAccessStatus, setNetworkAccess } from './network-access.js'
import { setCorsHeaders } from './pi-api/cors.js'
import { json, readJson } from './pi-api/http.js'
import { openMemoryDb } from './pi-api/leyline-db.js'

const BUILTIN_CONNECTION_ID = 'builtin'
const THINKING_DEFAULT_VALUES = new Set(['collapsed', 'expanded'])
const DISPLAY_SETTING_VALUES = new Map([
  [THINKING_DEFAULT_SETTING_KEY, THINKING_DEFAULT_VALUES],
  [AUTOLINK_BARE_FILENAMES_SETTING_KEY, new Set(['on', 'off'])],
])
const PINNED_CONNECTION_ID_MAX_LENGTH = 128
const PINNED_SESSION_ID_MAX_LENGTH = 128
const PINNED_MAX_PER_CONNECTION = 200
const PINNED_BULK_MAX_IDS = 500
const PINNED_BODY_MAX_BYTES = 64 * 1024

export async function backendConnectionsHandler(req, res) {
  if (!setCorsHeaders(req, res)) {
    return json(res, { error: 'Cross-origin request denied' }, 403)
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    return res.end()
  }

  const url = new URL(req.url, 'http://localhost')

  try {
    if (url.pathname === '/network-access') {
      if (req.method === 'GET') return json(res, await networkAccessStatus())
      if (req.method !== 'PUT') return json(res, { error: 'Method not allowed' }, 405)
      const body = await readJson(req, { maxBytes: 1024 })
      if (body?.enabled === undefined && body?.port === undefined) {
        return json(res, { error: 'Enabled or port is required' }, 400)
      }
      if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
        return json(res, { error: 'Enabled must be a boolean' }, 400)
      }
      if (body.port !== undefined && (!Number.isInteger(body.port) || body.port < 0 || body.port > 65535)) {
        return json(res, { error: 'Port must be an integer from 0 through 65535' }, 400)
      }
      return json(res, await setNetworkAccess(body, res))
    }

    if (url.pathname === '/connections') {
      if (req.method === 'GET') return json(res, readRegistry())
      if (req.method === 'POST') {
        const body = await readJson(req)
        return json(res, createConnection(body), 201)
      }
      return json(res, { error: 'Method not allowed' }, 405)
    }

    if (url.pathname === '/connections/default') {
      if (req.method !== 'PUT') {
        return json(res, { error: 'Method not allowed' }, 405)
      }
      const body = await readJson(req)
      return json(res, setDefaultConnection(body.id))
    }

    const match = url.pathname.match(/^\/connections\/([^/]+)$/)
    if (match) {
      const id = decodeURIComponent(match[1])
      if (id === BUILTIN_CONNECTION_ID) {
        return json(res, { error: 'The native backend cannot be changed' }, 400)
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req)
        return json(res, updateConnection(id, body))
      }
      if (req.method === 'DELETE') return json(res, deleteConnection(id))
      return json(res, { error: 'Method not allowed' }, 405)
    }

    if (url.pathname === '/pinned-sessions') {
      if (req.method === 'GET') {
        const connectionId = validPinnedConnectionId(
          url.searchParams.get('connectionId'),
        )
        return json(res, listPinnedSessions(connectionId))
      }
      if (req.method === 'POST') {
        const body = await readJson(req, { maxBytes: PINNED_BODY_MAX_BYTES })
        validPinnedBody(body)
        const connectionId = validPinnedConnectionId(body.connectionId)
        const sessionId = validPinnedSessionId(body.sessionId)
        return json(res, pinSession(connectionId, sessionId), 201)
      }
      if (req.method === 'DELETE') {
        const connectionId = validPinnedConnectionId(
          url.searchParams.get('connectionId'),
        )
        const sessionId = validPinnedSessionId(
          url.searchParams.get('sessionId'),
        )
        return json(res, unpinSession(connectionId, sessionId))
      }
      return json(res, { error: 'Method not allowed' }, 405)
    }

    if (url.pathname === '/pinned-sessions/prune') {
      if (req.method !== 'POST') {
        return json(res, { error: 'Method not allowed' }, 405)
      }
      const body = await readJson(req, { maxBytes: PINNED_BODY_MAX_BYTES })
      validPinnedBody(body)
      const connectionId = validPinnedConnectionId(body.connectionId)
      const sessionIds = validPinnedSessionIds(body.sessionIds)
      return json(res, prunePinnedSessions(connectionId, sessionIds))
    }

    const settingsMatch = url.pathname.match(/^\/settings\/([^/]+)$/)
    if (settingsMatch) {
      const key = decodeURIComponent(settingsMatch[1])
      const allowedValues = DISPLAY_SETTING_VALUES.get(key)
      if (!allowedValues) {
        return json(res, { error: 'Unknown setting' }, 404)
      }
      const db = openDb()
      try {
        if (req.method === 'GET') {
          return json(res, { key, value: settingValue(db, key) })
        }
        if (req.method !== 'PUT') {
          return json(res, { error: 'Method not allowed' }, 405)
        }
        const body = await readJson(req)
        const value = String(body?.value ?? '')
        if (!allowedValues.has(value)) {
          const message = key === THINKING_DEFAULT_SETTING_KEY
            ? 'Value must be "collapsed" or "expanded"'
            : 'Value must be "on" or "off"'
          return json(res, { error: message }, 400)
        }
        setSetting(db, key, value)
        return json(res, { key, value })
      } finally {
        db.close()
      }
    }

    return json(res, { error: 'Not found' }, 404)
  } catch (error) {
    return json(res, { error: error.message }, error.status || 400)
  }
}

function readRegistry() {
  const db = openDb()
  try {
    return registryDto(db)
  } finally {
    db.close()
  }
}

function createConnection(input) {
  const connection = {
    id: randomUUID(),
    name: validName(input.name),
    url: validUrl(input.url),
  }
  const now = Date.now()
  const db = openDb()
  try {
    db.prepare(`
      INSERT INTO backend_connections (id, name, url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(connection.id, connection.name, connection.url, now, now)
    return registryDto(db)
  } finally {
    db.close()
  }
}

function updateConnection(id, input) {
  const db = openDb()
  try {
    const existing = db.prepare(`
      SELECT id, name, url
      FROM backend_connections
      WHERE id = ?
    `).get(id)
    if (!existing) throw new Error('Backend connection not found')

    const name = input.name === undefined ? existing.name : validName(input.name)
    const url = input.url === undefined ? existing.url : validUrl(input.url)
    db.prepare(`
      UPDATE backend_connections
      SET name = ?, url = ?, updated_at = ?
      WHERE id = ?
    `).run(name, url, Date.now(), id)
    return registryDto(db)
  } finally {
    db.close()
  }
}

function deleteConnection(id) {
  const db = openDb()
  try {
    const result = db.prepare('DELETE FROM backend_connections WHERE id = ?').run(id)
    if (!result.changes) throw new Error('Backend connection not found')

    const defaultId = settingValue(db, 'default_backend_connection')
    if (defaultId === id) setSetting(db, 'default_backend_connection', BUILTIN_CONNECTION_ID)
    return registryDto(db)
  } finally {
    db.close()
  }
}

function setDefaultConnection(id) {
  const connectionId = String(id || '').trim()
  const db = openDb()
  try {
    if (connectionId !== BUILTIN_CONNECTION_ID) {
      const found = db.prepare('SELECT 1 FROM backend_connections WHERE id = ?').get(connectionId)
      if (!found) throw new Error('Backend connection not found')
    }
    setSetting(db, 'default_backend_connection', connectionId)
    return registryDto(db)
  } finally {
    db.close()
  }
}

function registryDto(db) {
  const connections = db.prepare(`
    SELECT id, name, url, created_at AS createdAt, updated_at AS updatedAt
    FROM backend_connections
    ORDER BY name COLLATE NOCASE, created_at
  `).all()
  const storedDefault = settingValue(db, 'default_backend_connection')
  const defaultConnectionId = storedDefault === BUILTIN_CONNECTION_ID
    || connections.some((connection) => connection.id === storedDefault)
    ? storedDefault
    : BUILTIN_CONNECTION_ID
  return { connections, defaultConnectionId }
}

export function readNetworkAccessSettings(owner) {
  const scope = createHash('sha256').update(owner).digest('hex')
  const enabledKey = `${NETWORK_ACCESS_SETTING_KEY}.${scope}`
  const portKey = `${NETWORK_ACCESS_PORT_SETTING_KEY}.${scope}`
  const values = readBackendSettings([enabledKey, portKey])
  const port = Number(values[portKey])
  return {
    enabled: values[enabledKey] === 'true',
    port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0,
    persist: ({ enabled, port }) => writeBackendSettings({
      [enabledKey]: String(enabled),
      [portKey]: String(port),
    }),
  }
}

export function readBackendSettings(keys) {
  const db = openDb()
  try {
    return Object.fromEntries(keys.map((key) => [key, settingValue(db, key)]))
  } finally {
    db.close()
  }
}

export function writeBackendSettings(values) {
  const db = openDb()
  try {
    db.exec('BEGIN')
    for (const [key, value] of Object.entries(values)) setSetting(db, key, value)
    db.exec('COMMIT')
  } finally {
    db.close()
  }
}

function settingValue(db, key) {
  return db.prepare('SELECT value FROM leyline_settings WHERE key = ?').get(key)?.value || ''
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO leyline_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, Date.now())
}

function listPinnedSessions(connectionId) {
  const db = openDb()
  try {
    return pinnedDto(db, connectionId)
  } finally {
    db.close()
  }
}

function pinSession(connectionId, sessionId) {
  const db = openDb()
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const existing = db.prepare(`
        SELECT 1 FROM pinned_sessions
        WHERE connection_id = ? AND session_id = ?
      `).get(connectionId, sessionId)
      if (!existing) {
        const count = db.prepare(`
          SELECT COUNT(*) AS count FROM pinned_sessions
          WHERE connection_id = ?
        `).get(connectionId)?.count || 0
        if (count >= PINNED_MAX_PER_CONNECTION) {
          throw new Error('Pin limit reached')
        }
      }
      db.prepare(`
        INSERT INTO pinned_sessions (connection_id, session_id, pinned_at)
        VALUES (?, ?, ?)
        ON CONFLICT(connection_id, session_id) DO UPDATE SET
          pinned_at = excluded.pinned_at
      `).run(connectionId, sessionId, Date.now())
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {}
      throw error
    }
    return pinnedDto(db, connectionId)
  } finally {
    db.close()
  }
}

function unpinSession(connectionId, sessionId) {
  const db = openDb()
  try {
    db.prepare(`
      DELETE FROM pinned_sessions
      WHERE connection_id = ? AND session_id = ?
    `).run(connectionId, sessionId)
    return pinnedDto(db, connectionId)
  } finally {
    db.close()
  }
}

function prunePinnedSessions(connectionId, sessionIds) {
  const db = openDb()
  try {
    if (sessionIds.length) {
      const placeholders = sessionIds.map(() => '?').join(',')
      db.prepare(`
        DELETE FROM pinned_sessions
        WHERE connection_id = ? AND session_id IN (${placeholders})
      `).run(connectionId, ...sessionIds)
    }
    return pinnedDto(db, connectionId)
  } finally {
    db.close()
  }
}

function pinnedDto(db, connectionId) {
  const rows = db.prepare(`
    SELECT session_id AS id FROM pinned_sessions
    WHERE connection_id = ?
    ORDER BY pinned_at DESC, session_id
  `).all(connectionId)
  return {
    connectionId,
    pinnedIds: rows.map((row) => row.id),
  }
}

function validPinnedBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Request body must be an object')
  }
}

function validPinnedConnectionId(value) {
  if (value === undefined || value === null) {
    throw new Error('Connection id is required')
  }
  if (typeof value !== 'string') throw new Error('Connection id must be a string')
  const id = value.trim()
  if (!id) throw new Error('Connection id is required')
  if (id.length > PINNED_CONNECTION_ID_MAX_LENGTH) {
    throw new Error('Connection id is too long')
  }
  return id
}

function validPinnedSessionId(value) {
  if (value === undefined || value === null) {
    throw new Error('Session id is required')
  }
  if (typeof value !== 'string') throw new Error('Session id must be a string')
  const id = value.trim()
  if (!id) throw new Error('Session id is required')
  if (id.length > PINNED_SESSION_ID_MAX_LENGTH) {
    throw new Error('Session id is too long')
  }
  return id
}

function validPinnedSessionIds(value) {
  if (!Array.isArray(value)) throw new Error('Session ids must be an array')
  if (value.length > PINNED_BULK_MAX_IDS) {
    throw new Error('Too many session ids')
  }
  return [...new Set(value.map(validPinnedSessionId))]
}

function validName(value) {
  const name = String(value || '').trim()
  if (!name) throw new Error('Connection name is required')
  if (name.length > 80) throw new Error('Connection name is too long')
  return name
}

function validUrl(value) {
  const input = String(value || '').trim()
  if (!input) throw new Error('Backend URL is required')

  let url
  try {
    url = new URL(input)
  } catch {
    throw new Error('Enter a valid backend URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Backend URL must use http or https')
  }
  if (!url.hostname) throw new Error('Backend URL must include a hostname or IP address')
  if (url.username || url.password) throw new Error('Backend URL cannot include credentials')
  if (url.search || url.hash) throw new Error('Backend URL cannot include a query or fragment')

  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname === '/' ? '' : pathname
  return url.toString().replace(/\/$/, '')
}

function openDb() {
  const db = openMemoryDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS backend_connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backend_connections_name
      ON backend_connections(name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS leyline_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pinned_sessions (
      connection_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      pinned_at INTEGER NOT NULL,
      PRIMARY KEY (connection_id, session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pinned_sessions_connection
      ON pinned_sessions(connection_id, pinned_at DESC);
  `)
  return db
}
