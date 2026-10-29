import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { DEFAULT_SUBAGENT_BATCH_SIZE, SUBAGENT_BATCH_SIZE_SETTING_KEY } from '../../lib/leyline-settings.js'
import { openMemoryDb } from './leyline-db.js'
import { overrideContext, safeRealpath, scopeIdentity } from './override-context.js'

const SCOPES = new Set(['global', 'project', 'session'])

export function listSubagentConfigs({ cwd, sessionPath }) {
  const context = overrideContext(cwd, sessionPath)
  const agents = discoverAgents(context.cwd)
  const db = openDb()
  try {
    const overrides = visibleOverrides(db, context)
    return {
      context,
      batching: batchConfig(db, context),
      agents: agents.map((agent) => ({
        ...agent,
        overrides: Object.fromEntries(overrides
          .filter((item) => overrideMatches(agent, item))
          .map((item) => [item.scope, item.model])),
        ...effectiveConfig(agent, overrides),
      })),
    }
  } finally {
    db.close()
  }
}

export function setSubagentBatchSize({ batchSize, cwd, scope, sessionPath }) {
  if (!['global', 'session'].includes(scope)) throw new Error('Invalid subagent batch size scope')
  if (batchSize !== null && (!Number.isSafeInteger(batchSize) || batchSize < 1)) {
    throw new Error('Batch size must be a positive safe integer')
  }
  if (scope === 'global' && batchSize === null) throw new Error('Global batch size is required')
  const context = overrideContext(cwd, sessionPath)
  const identity = scopeIdentity(context, scope)
  const db = openDb()
  try {
    if (scope === 'global') {
      db.prepare(`
        INSERT INTO leyline_settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(SUBAGENT_BATCH_SIZE_SETTING_KEY, String(batchSize), Date.now())
    } else if (batchSize === null) {
      db.prepare('DELETE FROM subagent_batch_overrides WHERE session_id = ?').run(identity.sessionId)
    } else {
      db.prepare(`
        INSERT INTO subagent_batch_overrides (session_id, project_id, session_file, batch_size, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET batch_size = excluded.batch_size, updated_at = excluded.updated_at
      `).run(identity.sessionId, context.projectId, identity.sessionFile, batchSize, Date.now())
    }
    return listSubagentConfigs({ cwd, sessionPath })
  } finally {
    db.close()
  }
}

export function deleteSessionSubagentBatchOverride({ cwd, sessionPath }) {
  if (!sessionPath) return
  const context = overrideContext(cwd, sessionPath)
  const db = openDb()
  try {
    db.prepare('DELETE FROM subagent_batch_overrides WHERE session_id = ?').run(context.sessionId)
  } finally {
    db.close()
  }
}

export function setSubagentModelOverride({ agentKey, cwd, model, scope, sessionPath }) {
  if (!SCOPES.has(scope)) throw new Error('Invalid subagent override scope')
  const value = String(model || '').trim()
  if (!value) throw new Error('Model is required')
  const context = overrideContext(cwd, sessionPath)
  const agent = discoverAgents(context.cwd).find((item) => item.key === agentKey)
  if (!agent) throw new Error('Subagent definition not found')
  const identity = scopeIdentity(context, scope)
  const overrideKey = scope === 'global' ? globalAgentKey(agent.name) : agentKey
  const db = openDb()
  try {
    db.prepare(`
      INSERT INTO subagent_overrides (
        scope, scope_id, project_id, session_id, session_file,
        agent_key, model, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, scope_id, agent_key) DO UPDATE SET
        model = excluded.model,
        updated_at = excluded.updated_at
    `).run(
      scope,
      identity.scopeId,
      context.projectId,
      identity.sessionId,
      identity.sessionFile,
      overrideKey,
      value,
      Date.now(),
    )
    return listSubagentConfigs({ cwd, sessionPath })
  } finally {
    db.close()
  }
}

export function deleteSubagentModelOverride({ agentKey, cwd, scope, sessionPath }) {
  if (!SCOPES.has(scope)) throw new Error('Invalid subagent override scope')
  const context = overrideContext(cwd, sessionPath)
  const agent = discoverAgents(context.cwd).find((item) => item.key === agentKey)
  if (!agent) throw new Error('Subagent definition not found')
  const identity = scopeIdentity(context, scope)
  const overrideKey = scope === 'global' ? globalAgentKey(agent.name) : agentKey
  const db = openDb()
  try {
    db.prepare(`
      DELETE FROM subagent_overrides
      WHERE scope = ? AND scope_id = ? AND agent_key = ?
    `).run(scope, identity.scopeId, overrideKey)
    return listSubagentConfigs({ cwd, sessionPath })
  } finally {
    db.close()
  }
}

export function resolveSubagentConfig({ agentKey, cwd, sessionPath, staticModel, staticThinking }) {
  const context = overrideContext(cwd, sessionPath)
  const agent = agentKey ? discoverAgents(context.cwd).find((item) => item.key === agentKey) : undefined
  const db = openDb()
  try {
    if (!agentKey) return { batchSize: batchConfig(db, context).effective }
    const overrides = visibleOverrides(db, context)
    const match = ['session', 'project', 'global']
      .map((scope) => overrides.find((item) => {
        if (item.scope !== scope) return false
        if (scope === 'global') return item.agentKey === globalAgentKey(agent?.name)
        return item.agentKey === agentKey
      }))
      .find(Boolean)
    return {
      model: match?.model || String(staticModel || '').trim() || undefined,
      modelSource: match?.scope || 'definition',
      thinking: String(staticThinking || '').trim() || undefined,
      thinkingSource: 'definition',
    }
  } finally {
    db.close()
  }
}

export function copySessionSubagentOverrides({ cwd, fromSessionPath, toSessionPath }) {
  if (!fromSessionPath || !toSessionPath) return
  const source = overrideContext(cwd, fromSessionPath)
  const target = overrideContext(cwd, toSessionPath)
  if (!source.sessionId || !target.sessionId) return
  const db = openDb()
  try {
    db.prepare(`
      INSERT INTO subagent_batch_overrides (session_id, project_id, session_file, batch_size, updated_at)
      SELECT ?, ?, ?, batch_size, ? FROM subagent_batch_overrides WHERE session_id = ?
      ON CONFLICT(session_id) DO UPDATE SET batch_size = excluded.batch_size, updated_at = excluded.updated_at
    `).run(target.sessionId, target.projectId, target.sessionFile, Date.now(), source.sessionId)
    const rows = db.prepare(`
      SELECT agent_key, model FROM subagent_overrides
      WHERE scope = 'session' AND scope_id = ?
    `).all(source.sessionId)
    const insert = db.prepare(`
      INSERT INTO subagent_overrides (
        scope, scope_id, project_id, session_id, session_file,
        agent_key, model, updated_at
      ) VALUES ('session', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, scope_id, agent_key) DO UPDATE SET
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
        row.agent_key,
        row.model,
        time,
      )
    }
  } finally {
    db.close()
  }
}

function discoverAgents(cwd) {
  const agents = new Map()
  loadAgents(join(getAgentDir(), 'agents'), 'user', agents)
  const projectDir = findNearestAgentsDir(cwd)
  if (projectDir) loadAgents(projectDir, 'project', agents)
  return [...agents.values()]
}

function loadAgents(dir, source, agents) {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const path = join(dir, entry.name)
      const agent = parseAgent(readFileSync(path, 'utf8'), source, path)
      if (agent) agents.set(agent.name, agent)
    }
  } catch {}
}

function parseAgent(content, source, path) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) return null
  const name = field(match[1], 'name')
  const description = field(match[1], 'description')
  if (!name || !description) return null
  const canonicalPath = safeRealpath(path)
  return {
    key: `${source}:${canonicalPath}:${name}`,
    name,
    description,
    source,
    path: canonicalPath,
    model: field(match[1], 'model') || '',
    thinking: field(match[1], 'thinking') || '',
    tools: (field(match[1], 'tools') || '').split(',').map((item) => item.trim()).filter(Boolean),
  }
}

function field(frontmatter, name) {
  return frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim() || ''
}

function findNearestAgentsDir(cwd) {
  let current = cwd
  while (true) {
    const candidate = join(current, '.pi', 'agents')
    if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function globalAgentKey(name) {
  return `name:${name || ''}`
}

function overrideMatches(agent, override) {
  if (override.scope === 'global') {
    return override.agentKey === globalAgentKey(agent.name)
  }
  return override.agentKey === agent.key
}

function effectiveConfig(agent, overrides) {
  const match = ['session', 'project', 'global']
    .map((scope) => overrides.find((item) => {
      return item.scope === scope && overrideMatches(agent, item)
    }))
    .find(Boolean)
  return {
    effectiveModel: match?.model || agent.model || '',
    modelSource: match?.scope || 'definition',
  }
}

function visibleOverrides(db, context) {
  return db.prepare(`
    SELECT scope, agent_key, model FROM subagent_overrides
    WHERE (scope = 'global' AND scope_id = 'global')
      OR (scope = 'project' AND scope_id = ?)
      OR (scope = 'session' AND scope_id = ?)
  `).all(context.projectId, context.sessionId).map((row) => ({
    scope: row.scope,
    agentKey: row.agent_key,
    model: row.model,
  }))
}

function batchConfig(db, context) {
  const stored = Number(db.prepare('SELECT value FROM leyline_settings WHERE key = ?')
    .get(SUBAGENT_BATCH_SIZE_SETTING_KEY)?.value)
  const global = Number.isSafeInteger(stored) && stored >= 1 ? stored : DEFAULT_SUBAGENT_BATCH_SIZE
  const session = db.prepare('SELECT batch_size FROM subagent_batch_overrides WHERE session_id = ?')
    .get(context.sessionId)?.batch_size ?? null
  return { global, session, effective: session ?? global, source: session === null ? 'global' : 'session' }
}

function openDb() {
  const db = openMemoryDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS leyline_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subagent_batch_overrides (
      session_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_file TEXT NOT NULL,
      batch_size INTEGER NOT NULL CHECK (batch_size >= 1 AND batch_size <= 9007199254740991),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subagent_overrides (
      scope TEXT NOT NULL CHECK (scope IN ('global', 'project', 'session')),
      scope_id TEXT NOT NULL,
      project_id TEXT,
      session_id TEXT,
      session_file TEXT,
      agent_key TEXT NOT NULL,
      model TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (scope, scope_id, agent_key)
    );
    CREATE INDEX IF NOT EXISTS idx_subagent_overrides_project
      ON subagent_overrides(project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_subagent_overrides_session
      ON subagent_overrides(session_id, updated_at DESC);
  `)
  return db
}
