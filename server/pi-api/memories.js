import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCOPES = new Set(['global', 'project', 'session'])
const STATUSES = new Set(['active', 'archived'])

export async function listVisibleMemories({ cwd, sessionPath }) {
  const context = await memoryContext(cwd, sessionPath)
  const db = openDb()
  try {
    const rows = queryVisibleRows(db, context)
    return {
      context,
      memories: rows.map(memoryDto),
      counts: memoryCounts(rows),
    }
  } finally {
    db.close()
  }
}

export async function createMemory({ contentMd, cwd, scope, sessionPath, tags }) {
  if (!SCOPES.has(scope)) throw new Error('Invalid memory scope')
  const content = validateContent(contentMd)
  const context = await memoryContext(cwd, sessionPath)
  const values = scopedValues(context, scope)
  const db = openDb()
  try {
    const id = `mem_${randomUUID()}`
    const time = Date.now()
    db.prepare(`
      INSERT INTO memories (
        id, scope, project_id, project_root, project_name, session_id,
        session_file, cwd, content_md, reason_md, tags_json, status,
        source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active', 'user', ?, ?)
    `).run(
      id,
      scope,
      values.projectId,
      values.projectRoot,
      values.projectName,
      values.sessionId,
      values.sessionFile,
      values.cwd,
      content,
      tagJson(tags),
      time,
      time,
    )
    return memoryDto(requireVisibleRow(db, context, id))
  } finally {
    db.close()
  }
}

export async function updateMemory({ contentMd, cwd, id, sessionPath, tags }) {
  const content = validateContent(contentMd)
  const context = await memoryContext(cwd, sessionPath)
  const db = openDb()
  try {
    requireVisibleRow(db, context, id)
    db.prepare(`
      UPDATE memories
      SET content_md = ?, tags_json = ?, updated_at = ?
      WHERE id = ?
    `).run(content, tagJson(tags), Date.now(), id)
    return memoryDto(requireVisibleRow(db, context, id))
  } finally {
    db.close()
  }
}

export async function setMemoryStatus({ cwd, ids, sessionPath, status }) {
  if (!STATUSES.has(status)) throw new Error('Invalid memory status')
  const context = await memoryContext(cwd, sessionPath)
  const uniqueIds = uniqueMemoryIds(ids)
  const db = openDb()
  try {
    const time = Date.now()
    const archivedAt = status === 'archived' ? time : null
    const update = db.prepare(`
      UPDATE memories
      SET status = ?, archived_at = ?, updated_at = ?
      WHERE id = ?
    `)
    db.exec('BEGIN')
    try {
      for (const id of uniqueIds) {
        const row = requireVisibleRow(db, context, id)
        if (row.status === status) continue
        update.run(status, archivedAt, time, id)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return queryVisibleRows(db, context).map(memoryDto)
  } finally {
    db.close()
  }
}

export async function deleteMemories({ cwd, ids, sessionPath }) {
  const context = await memoryContext(cwd, sessionPath)
  const uniqueIds = uniqueMemoryIds(ids)
  const db = openDb()
  try {
    const remove = db.prepare('DELETE FROM memories WHERE id = ?')
    db.exec('BEGIN')
    try {
      for (const id of uniqueIds) {
        requireVisibleRow(db, context, id)
        remove.run(id)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return queryVisibleRows(db, context).map(memoryDto)
  } finally {
    db.close()
  }
}

async function memoryContext(cwd, sessionPath) {
  const resolvedCwd = String(cwd || '').trim()
  if (!resolvedCwd) throw new Error('Project cwd is required')
  const projectRoot = await findProjectRoot(resolvedCwd)
  const resolvedSession = sessionPath ? await safeRealpath(sessionPath) : ''
  return {
    cwd: resolvedCwd,
    projectId: hashId('project', projectRoot),
    projectName: basename(projectRoot),
    projectRoot,
    sessionAvailable: Boolean(resolvedSession),
    sessionFile: resolvedSession || null,
    sessionId: resolvedSession ? hashId('session', resolvedSession) : null,
  }
}

async function findProjectRoot(cwd) {
  let current = await safeRealpath(cwd)
  while (true) {
    try {
      const entries = await readdir(current)
      if (entries.includes('.git')) return current
    } catch {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return await safeRealpath(cwd)
    current = parent
  }
}

async function safeRealpath(path) {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

function hashId(prefix, value) {
  const hash = createHash('sha256').update(value).digest('hex').slice(0, 16)
  return `${prefix}_${hash}`
}

function scopedValues(context, scope) {
  if (scope === 'global') {
    return {
      projectId: null,
      projectRoot: null,
      projectName: null,
      sessionId: null,
      sessionFile: null,
      cwd: context.cwd,
    }
  }
  if (scope === 'project') {
    return {
      projectId: context.projectId,
      projectRoot: context.projectRoot,
      projectName: context.projectName,
      sessionId: null,
      sessionFile: null,
      cwd: context.cwd,
    }
  }
  if (!context.sessionId || !context.sessionFile) {
    throw new Error('Session memory is unavailable before a session is created')
  }
  return {
    projectId: context.projectId,
    projectRoot: context.projectRoot,
    projectName: context.projectName,
    sessionId: context.sessionId,
    sessionFile: context.sessionFile,
    cwd: context.cwd,
  }
}

function queryVisibleRows(db, context) {
  return db.prepare(`
    SELECT * FROM memories
    WHERE scope = 'global'
      OR (scope = 'project' AND project_id = ?)
      OR (scope = 'session' AND session_id = ?)
    ORDER BY updated_at DESC
  `).all(context.projectId, context.sessionId)
}

function requireVisibleRow(db, context, id) {
  if (!id) throw new Error('Memory id is required')
  const row = db.prepare(`
    SELECT * FROM memories
    WHERE id = ?
      AND (
        scope = 'global'
        OR (scope = 'project' AND project_id = ?)
        OR (scope = 'session' AND session_id = ?)
      )
    LIMIT 1
  `).get(id, context.projectId, context.sessionId)
  if (!row) throw new Error(`Memory not found: ${id}`)
  return row
}

function uniqueMemoryIds(ids) {
  if (!Array.isArray(ids)) throw new Error('Memory ids are required')
  const unique = [...new Set(ids.map((id) => String(id || '').trim()))]
    .filter(Boolean)
  if (!unique.length) throw new Error('Memory ids are required')
  return unique
}

function validateContent(contentMd) {
  const content = String(contentMd || '').trim()
  if (!content) throw new Error('Memory content is required')
  return content
}

function tagJson(tags) {
  if (!Array.isArray(tags)) return '[]'
  return JSON.stringify(tags.map((tag) => String(tag).trim()).filter(Boolean))
}

function parseTags(value) {
  try {
    const tags = JSON.parse(value || '[]')
    return Array.isArray(tags)
      ? tags.filter((tag) => typeof tag === 'string')
      : []
  } catch {
    return []
  }
}

function memoryDto(row) {
  return {
    id: row.id,
    scope: row.scope,
    projectId: row.project_id,
    projectRoot: row.project_root,
    projectName: row.project_name,
    sessionId: row.session_id,
    sessionFile: row.session_file,
    cwd: row.cwd,
    contentMd: row.content_md,
    reasonMd: row.reason_md || '',
    tags: parseTags(row.tags_json),
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    lastAccessedAt: row.last_accessed_at,
  }
}

function memoryCounts(rows) {
  const counts = {
    active: 0,
    archived: 0,
    scopes: {
      project: { active: 0, archived: 0 },
      session: { active: 0, archived: 0 },
      global: { active: 0, archived: 0 },
    },
  }
  for (const row of rows) {
    if (!counts[row.status]) continue
    counts[row.status] += 1
    counts.scopes[row.scope][row.status] += 1
  }
  return counts
}

function openDb() {
  mkdirSync(dirname(dbPath()), { recursive: true })
  const db = new DatabaseSync(dbPath())
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL CHECK (scope IN ('global', 'project', 'session')),
      project_id TEXT,
      project_root TEXT,
      project_name TEXT,
      session_id TEXT,
      session_file TEXT,
      cwd TEXT,
      content_md TEXT NOT NULL,
      reason_md TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived')),
      source TEXT NOT NULL DEFAULT 'agent'
        CHECK (source IN ('agent', 'user', 'system', 'import')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER,
      last_accessed_at INTEGER,
      CHECK (
        (scope = 'global'
          AND project_id IS NULL
          AND project_root IS NULL
          AND session_id IS NULL
          AND session_file IS NULL)
        OR (scope = 'project'
          AND project_id IS NOT NULL
          AND project_root IS NOT NULL
          AND session_id IS NULL
          AND session_file IS NULL)
        OR (scope = 'session'
          AND project_id IS NOT NULL
          AND project_root IS NOT NULL
          AND session_id IS NOT NULL
          AND session_file IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_memories_scope_status
      ON memories(scope, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_project_status
      ON memories(project_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_session_status
      ON memories(session_id, status, updated_at DESC);
    PRAGMA user_version = 1;
  `)
  db.prepare(`
    UPDATE memories
    SET tags_json = '[]'
    WHERE tags_json IS NULL OR tags_json = ''
  `).run()
  return db
}

function dbPath() {
  return join(homedir(), '.local', 'share', 'leyline', 'memory.sqlite')
}
