import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const SCOPES = new Set(['global', 'project', 'session'])

export function listSubagentConfigs({ cwd, sessionPath }) {
  const context = subagentContext(cwd, sessionPath)
  const agents = discoverAgents(context.cwd)
  const db = openDb()
  try {
    const overrides = visibleOverrides(db, context)
    return {
      context,
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

export function setSubagentModelOverride({ agentKey, cwd, model, scope, sessionPath }) {
  if (!SCOPES.has(scope)) throw new Error('Invalid subagent override scope')
  const value = String(model || '').trim()
  if (!value) throw new Error('Model is required')
  const context = subagentContext(cwd, sessionPath)
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
  const context = subagentContext(cwd, sessionPath)
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

export function resolveSubagentConfig({ agentKey, cwd, sessionPath, staticModel }) {
  const context = subagentContext(cwd, sessionPath)
  const agent = discoverAgents(context.cwd).find((item) => item.key === agentKey)
  const db = openDb()
  try {
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
    }
  } finally {
    db.close()
  }
}

export function copySessionSubagentOverrides({ cwd, fromSessionPath, toSessionPath }) {
  if (!fromSessionPath || !toSessionPath) return
  const source = subagentContext(cwd, fromSessionPath)
  const target = subagentContext(cwd, toSessionPath)
  if (!source.sessionId || !target.sessionId) return
  const db = openDb()
  try {
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
  loadAgents(join(homedir(), '.pi', 'agent', 'agents'), 'user', agents)
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

function subagentContext(cwd, sessionPath) {
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

function scopeIdentity(context, scope) {
  if (scope === 'global') return { scopeId: 'global', sessionId: null, sessionFile: null }
  if (scope === 'project') return { scopeId: context.projectId, sessionId: null, sessionFile: null }
  if (!context.sessionId) throw new Error('Session override is unavailable before a session is created')
  return { scopeId: context.sessionId, sessionId: context.sessionId, sessionFile: context.sessionFile }
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

function dbPath() {
  return join(homedir(), '.local', 'share', 'leyline', 'memory.sqlite')
}
