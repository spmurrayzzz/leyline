import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCOPES = new Set(['global', 'project', 'session'])
const VISION_DELEGATION_CUSTOM_TYPE = 'leyline-vision-delegation'
const sessionDelegations = new WeakMap()

export function installVisionDelegationContext(session) {
  const state = { pending: [], records: [] }
  const transformContext = session.agent.transformContext
  session.agent.transformContext = async (messages, signal) => {
    const records = [
      ...visionDelegationRecords(session.sessionManager.getBranch()),
      ...state.records,
    ]
    const transformed = applyVisionDelegations(messages, records)
    return transformContext ? transformContext(transformed, signal) : transformed
  }
  session.subscribe((event) => {
    if (event.type !== 'message_end' || event.message?.role !== 'user') return
    const signature = imageSignature(event.message.content)
    const prompt = textContent(event.message.content)
    const exactIndex = state.pending.findIndex((item) => {
      return item.signature === signature && item.prompt === prompt
    })
    const candidates = state.pending
      .map((item, index) => ({ index, item }))
      .filter(({ item }) => {
        return item.signature === signature
          && item.createdAt <= event.message.timestamp
      })
      .sort((a, b) => b.item.createdAt - a.item.createdAt)
    const index = exactIndex === -1 ? candidates[0]?.index ?? -1 : exactIndex
    if (index === -1) return

    const [pending] = state.pending.splice(index, 1)
    const record = {
      signature,
      text: pending.text,
      userTimestamp: event.message.timestamp,
    }
    state.records.push(record)
    pending.bound = true
    queueMicrotask(() => {
      record.userEntryId = session.sessionManager.getLeafId()
      session.sessionManager.appendCustomEntry(
        VISION_DELEGATION_CUSTOM_TYPE,
        record,
      )
    })
  })
  sessionDelegations.set(session, state)
}

export function registerVisionDelegation(session, images, text, prompt) {
  const state = sessionDelegations.get(session)
  if (!state) throw new Error('Vision delegation context is unavailable')
  const pending = {
    bound: false,
    createdAt: Date.now(),
    prompt,
    signature: imageSignature(images),
    text,
  }
  state.pending.push(pending)
  return {
    cancel() {
      if (pending.bound) return
      state.pending = state.pending.filter((item) => item !== pending)
    },
  }
}

export function listVisionConfig({ cwd, sessionPath }) {
  const context = visionContext(cwd, sessionPath)
  const db = openDb()
  try {
    const overrides = visibleOverrides(db, context)
    const match = ['session', 'project', 'global']
      .map((scope) => overrides.find((item) => item.scope === scope))
      .find(Boolean)
    return {
      context,
      overrides: Object.fromEntries(
        overrides.map((item) => [item.scope, item.model]),
      ),
      model: match?.model || '',
      modelSource: match?.scope || 'none',
    }
  } finally {
    db.close()
  }
}

export function setVisionModelOverride({ cwd, model, scope, sessionPath }) {
  if (!SCOPES.has(scope)) throw new Error('Invalid vision override scope')
  const value = String(model || '').trim()
  if (!value) throw new Error('Model is required')
  const context = visionContext(cwd, sessionPath)
  const identity = scopeIdentity(context, scope)
  const db = openDb()
  try {
    db.prepare(`
      INSERT INTO vision_overrides (
        scope, scope_id, project_id, session_id, session_file,
        model, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, scope_id) DO UPDATE SET
        model = excluded.model,
        updated_at = excluded.updated_at
    `).run(
      scope,
      identity.scopeId,
      context.projectId,
      identity.sessionId,
      identity.sessionFile,
      value,
      Date.now(),
    )
    return listVisionConfig({ cwd, sessionPath })
  } finally {
    db.close()
  }
}

export function deleteVisionModelOverride({ cwd, scope, sessionPath }) {
  if (!SCOPES.has(scope)) throw new Error('Invalid vision override scope')
  const context = visionContext(cwd, sessionPath)
  const identity = scopeIdentity(context, scope)
  const db = openDb()
  try {
    db.prepare(`
      DELETE FROM vision_overrides
      WHERE scope = ? AND scope_id = ?
    `).run(scope, identity.scopeId)
    return listVisionConfig({ cwd, sessionPath })
  } finally {
    db.close()
  }
}

export function resolveVisionConfig({ cwd, sessionPath, staticModel }) {
  const context = visionContext(cwd, sessionPath)
  const db = openDb()
  try {
    const overrides = visibleOverrides(db, context)
    const match = ['session', 'project', 'global']
      .map((scope) => overrides.find((item) => item.scope === scope))
      .find(Boolean)
    return {
      model: match?.model || String(staticModel || '').trim() || undefined,
      modelSource: match?.scope || 'static',
    }
  } finally {
    db.close()
  }
}

export function copySessionVisionOverrides({ cwd, fromSessionPath, toSessionPath }) {
  if (!fromSessionPath || !toSessionPath) return
  const source = visionContext(cwd, fromSessionPath)
  const target = visionContext(cwd, toSessionPath)
  if (!source.sessionId || !target.sessionId) return
  const db = openDb()
  try {
    const rows = db.prepare(`
      SELECT model FROM vision_overrides
      WHERE scope = 'session' AND scope_id = ?
    `).all(source.sessionId)
    const insert = db.prepare(`
      INSERT INTO vision_overrides (
        scope, scope_id, project_id, session_id, session_file,
        model, updated_at
      ) VALUES ('session', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, scope_id) DO UPDATE SET
        model = excluded.model,
        updated_at = excluded.updated_at
    `)
    const time = Date.now()
    for (const row of rows) {
      insert.run(
        target.sessionId,
        target.projectId,
        target.sessionId,
        target.sessionFile,
        row.model,
        time,
      )
    }
  } finally {
    db.close()
  }
}

function visionDelegationRecords(entries) {
  return entries
    .filter((entry) => {
      return entry.type === 'custom'
        && entry.customType === VISION_DELEGATION_CUSTOM_TYPE
        && typeof entry.data?.signature === 'string'
        && typeof entry.data?.text === 'string'
        && Number.isFinite(entry.data?.userTimestamp)
    })
    .map((entry) => entry.data)
}

function applyVisionDelegations(messages, records) {
  const unique = new Map(records.map((record) => [
    `${record.userTimestamp}:${record.signature}`,
    record,
  ]))
  return messages.map((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return message
    const signature = imageSignature(message.content)
    const record = [...unique.values()].find((item) => {
      return item.signature === signature
        && item.userTimestamp === message.timestamp
    })
    if (!record) return message
    return {
      ...message,
      content: [
        ...message.content.filter((item) => item.type !== 'image'),
        { type: 'text', text: record.text },
      ],
    }
  })
}

function textContent(content) {
  return (content || [])
    .filter((item) => item?.type === 'text')
    .map((item) => item.text || '')
    .join('\n')
}

function imageSignature(content) {
  const images = (content || []).filter((item) => item?.type === 'image')
  if (!images.length) return ''
  const hash = createHash('sha256')
  for (const image of images) {
    hash.update(image.mimeType || '')
    hash.update('\0')
    hash.update(image.data || '')
    hash.update('\0')
  }
  return hash.digest('hex')
}

function visibleOverrides(db, context) {
  return db.prepare(`
    SELECT scope, model FROM vision_overrides
    WHERE (scope = 'global' AND scope_id = 'global')
      OR (scope = 'project' AND scope_id = ?)
      OR (scope = 'session' AND scope_id = ?)
  `).all(context.projectId, context.sessionId).map((row) => ({
    scope: row.scope,
    model: row.model,
  }))
}

function scopeIdentity(context, scope) {
  if (scope === 'global') return { scopeId: 'global', sessionId: null, sessionFile: null }
  if (scope === 'project') return { scopeId: context.projectId, sessionId: null, sessionFile: null }
  if (!context.sessionId) throw new Error('Session override is unavailable before a session is created')
  return { scopeId: context.sessionId, sessionId: context.sessionId, sessionFile: context.sessionFile }
}

function visionContext(cwd, sessionPath) {
  const resolvedCwd = String(cwd || '').trim()
  if (!resolvedCwd) throw new Error('Project cwd is required')
  const projectRoot = findProjectRoot(resolvedCwd)
  const sessionFile = sessionPath ? safeRealpath(sessionPath) : null
  return {
    cwd: resolvedCwd,
    projectId: hashId('project', projectRoot),
    projectName: basename(projectRoot),
    projectRoot,
    sessionAvailable: Boolean(sessionFile),
    sessionFile,
    sessionId: sessionFile ? hashId('session', sessionFile) : null,
  }
}

function findProjectRoot(cwd) {
  let current = safeRealpath(cwd)
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return safeRealpath(cwd)
    current = parent
  }
}

function safeRealpath(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function hashId(prefix, value) {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

function openDb() {
  mkdirSync(dirname(dbPath()), { recursive: true })
  const db = new DatabaseSync(dbPath())
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(`
    CREATE TABLE IF NOT EXISTS vision_overrides (
      scope TEXT NOT NULL CHECK (scope IN ('global', 'project', 'session')),
      scope_id TEXT NOT NULL,
      project_id TEXT,
      session_id TEXT,
      session_file TEXT,
      model TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, scope_id)
    );
    CREATE INDEX IF NOT EXISTS idx_vision_overrides_project
      ON vision_overrides(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_vision_overrides_session
      ON vision_overrides(session_id, updated_at DESC);
  `)
  return db
}

function dbPath() {
  const dir = process.env.LEYLINE_MEMORY_DIR
    || join(homedir(), '.local', 'share', 'leyline')
  return join(dir, 'memory.sqlite')
}