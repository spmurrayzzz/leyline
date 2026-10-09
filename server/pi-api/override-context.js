import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export function overrideContext(cwd, sessionPath) {
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

export function scopeIdentity(context, scope) {
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

export function safeRealpath(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function hashId(prefix, value) {
  return `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}
