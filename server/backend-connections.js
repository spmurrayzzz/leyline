import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setCorsHeaders } from './pi-api/cors.js'
import { json, readJson } from './pi-api/http.js'

const BUILTIN_CONNECTION_ID = 'builtin'

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

    return json(res, { error: 'Not found' }, 404)
  } catch (error) {
    return json(res, { error: error.message }, 400)
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
  mkdirSync(dirname(dbPath()), { recursive: true })
  const db = new DatabaseSync(dbPath())
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
  `)
  return db
}

function dbPath() {
  const dir = process.env.LEYLINE_MEMORY_DIR
    || join(homedir(), '.local', 'share', 'leyline')
  return join(dir, 'memory.sqlite')
}
