import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import {
  getAgentDir,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { createSummaryPool } from './session-summary-pool.js'
import {
  buildSessionInfo,
  messageText,
  SUBAGENT_SESSION_CUSTOM_TYPE,
} from './session-summary.js'

const SESSION_DIR_ENV = 'PI_CODING_AGENT_SESSION_DIR'
const PROJECT_HEADER_SCAN_LIMIT = 1024 * 1024
const PROJECT_SCAN_CONCURRENCY = 24
const SESSION_SUMMARY_WORKERS = 4
const sessionInfoCache = new Map()
let pendingSessionList
let summaryPool
let summaryShuttingDown = false
let summaryShutdownPromise

export { messageText, SUBAGENT_SESSION_CUSTOM_TYPE }

export async function listPersistedSessions() {
  if (summaryShuttingDown) throw new Error('Summary scanner is shutting down')
  if (pendingSessionList) return pendingSessionList
  const request = (async () => {
    const sessionDir = configuredSessionDir(process.cwd())
    const files = sessionDir
      ? await sessionFiles(sessionDir)
      : await defaultSessionFiles()
    return listSessionsFromFiles(files, !!sessionDir)
  })()
  pendingSessionList = request
  try {
    return await request
  } finally {
    if (pendingSessionList === request) pendingSessionList = null
  }
}

export function closeSessionSummaryWorkers() {
  if (summaryShutdownPromise) return summaryShutdownPromise
  summaryShuttingDown = true
  const current = summaryPool
  const pending = pendingSessionList
  summaryPool = null
  summaryShutdownPromise = Promise.resolve().then(async () => {
    try {
      await current?.close()
    } finally {
      await pending?.catch(() => {})
    }
  }).finally(() => {
    summaryShuttingDown = false
    summaryShutdownPromise = undefined
  })
  return summaryShutdownPromise
}

export async function listPersistedProjects() {
  const sessionDir = configuredSessionDir(process.cwd())
  const files = sessionDir
    ? await sessionFiles(sessionDir)
    : await defaultSessionFiles()
  const records = await readProjectRecords(files)
  const projects = new Map()

  for (const record of records) {
    const current = projects.get(record.cwd)
    if (current && current.modified >= record.modified) continue
    projects.set(record.cwd, record)
  }

  return [...projects.values()]
    .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name))
    .map(({ cwd, name, modified }) => ({ cwd, name, modified }))
}

export async function findPersistedSessionRecord(id) {
  const sessionDir = configuredSessionDir(process.cwd())
  const files = sessionDir
    ? await sessionFiles(sessionDir)
    : await defaultSessionFiles()
  const suffix = `_${id}.jsonl`
  for (const path of files) {
    if (!path.endsWith(suffix)) continue
    const header = await readSessionHeader(path)
    if (header?.id === id) return { id, path, cwd: header.cwd || '' }
  }
  return null
}

export async function listSessionsForProject(cwd) {
  const sessionDir = configuredSessionDir(process.cwd())
  const files = sessionDir
    ? await sessionFiles(sessionDir)
    : await defaultSessionFiles()
  const records = await readSessionFileRecords(files)
  return records.filter((record) => record.cwd === cwd)
}

export function configuredSessionDir(cwd) {
  const envSessionDir = process.env[SESSION_DIR_ENV]
  if (envSessionDir) return expandTildePath(envSessionDir)
  return SettingsManager.create(cwd, getAgentDir()).getSessionDir()
}

function expandTildePath(value) {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return homedir() + value.slice(1)
  return value
}

async function listSessionsFromFiles(files, goalFallback) {
  const sessions = await buildSessionInfos(files, goalFallback)
  const marked = await markSubagentSessions(sessions)
  return marked.sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

function markSubagentSessions(sessions) {
  const subagentPaths = new Set(
    sessions.flatMap((session) => session.subagentChildPaths || []),
  )
  return sessions.map(({ subagentChildPaths, ...session }) => ({
    ...session,
    isSubagentSession: session.isSubagentSession
      || subagentPaths.has(session.path),
  }))
}

async function sessionFiles(sessionDir) {
  try {
    const entries = await readdir(sessionDir, { withFileTypes: true })
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => join(sessionDir, entry.name))
    const dirs = entries.filter((entry) => entry.isDirectory())
    const nested = await Promise.all(
      dirs.map((entry) => sessionFiles(join(sessionDir, entry.name))),
    )
    return [...files, ...nested.flat()]
  } catch {
    return []
  }
}

async function defaultSessionFiles() {
  const root = join(getAgentDir(), 'sessions')
  try {
    const entries = await readdir(root, { withFileTypes: true })
    const directories = entries.filter((entry) => entry.isDirectory())
    const files = await Promise.all(directories.map(async (entry) => {
      const directory = join(root, entry.name)
      try {
        return (await readdir(directory, { withFileTypes: true }))
          .filter((file) => file.isFile() && file.name.endsWith('.jsonl'))
          .map((file) => join(directory, file.name))
      } catch {
        return []
      }
    }))
    return files.flat()
  } catch {
    return []
  }
}

async function readProjectRecords(files) {
  const records = new Array(files.length)
  let nextIndex = 0
  const workerCount = Math.min(PROJECT_SCAN_CONCURRENCY, files.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < files.length) {
      const index = nextIndex++
      records[index] = await readProjectRecord(files[index])
    }
  })
  await Promise.all(workers)
  return records.filter(Boolean)
}

async function readProjectRecord(filePath) {
  try {
    const [header, stats] = await Promise.all([
      readSessionHeader(filePath),
      stat(filePath),
    ])
    if (!header) return null
    return {
      cwd: header.cwd,
      name: basename(header.cwd) || header.cwd,
      modified: stats.mtimeMs,
    }
  } catch {
    return null
  }
}

async function readSessionFileRecords(files) {
  const records = new Array(files.length)
  let nextIndex = 0
  const workerCount = Math.min(PROJECT_SCAN_CONCURRENCY, files.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < files.length) {
      const index = nextIndex++
      records[index] = await readSessionFileRecord(files[index])
    }
  })
  await Promise.all(workers)
  return records.filter(Boolean)
}

async function readSessionFileRecord(filePath) {
  const header = await readSessionHeader(filePath)
  if (!header) return null
  return { id: header.id, path: filePath, cwd: header.cwd }
}

async function readSessionHeader(filePath) {
  let file
  try {
    file = await open(filePath, 'r')
    const decoder = new StringDecoder('utf8')
    const buffer = Buffer.allocUnsafe(4096)
    let pending = ''
    let scanned = 0

    while (scanned < PROJECT_HEADER_SCAN_LIMIT) {
      const length = Math.min(buffer.length, PROJECT_HEADER_SCAN_LIMIT - scanned)
      const { bytesRead } = await file.read(buffer, 0, length, null)
      if (!bytesRead) {
        pending += decoder.end()
        return sessionHeaderFromLine(pending) || null
      }
      scanned += bytesRead
      pending += decoder.write(buffer.subarray(0, bytesRead))

      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        const header = sessionHeaderFromLine(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
        if (header !== undefined) return header
        newline = pending.indexOf('\n')
      }
    }

    return null
  } catch {
    return null
  } finally {
    await file?.close().catch(() => {})
  }
}

function sessionHeaderFromLine(line) {
  if (!line.trim()) return undefined
  try {
    const entry = JSON.parse(line)
    if (entry.type !== 'session' || typeof entry.id !== 'string') return null
    if (typeof entry.cwd !== 'string' || !entry.cwd.trim()) return null
    return entry
  } catch {
    return undefined
  }
}

async function buildSessionInfos(files, goalFallback) {
  const sessions = new Array(files.length)
  const misses = []
  let nextIndex = 0
  const workerCount = Math.min(PROJECT_SCAN_CONCURRENCY, files.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < files.length) {
      const index = nextIndex++
      const filePath = files[index]
      try {
        const stats = await stat(filePath)
        const cached = sessionInfoCache.get(filePath)
        if (cached?.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
          sessions[index] = cached.session
        } else {
          misses.push({
            index,
            path: filePath,
            mtimeMs: stats.mtimeMs,
            size: stats.size,
          })
        }
      } catch {}
    }
  }))
  if (misses.length) {
    misses.sort((a, b) => a.index - b.index)
    const results = await readSessionMisses(misses, goalFallback)
    for (const result of results) {
      sessions[result.index] = result.session
      if (!result.session) continue
      sessionInfoCache.set(result.path, {
        mtimeMs: result.mtimeMs,
        size: result.size,
        session: result.session,
      })
    }
  }
  const currentPaths = new Set(files)
  for (const path of sessionInfoCache.keys()) {
    if (!currentPaths.has(path)) sessionInfoCache.delete(path)
  }
  return sessions.filter(Boolean)
}

async function readSessionMisses(misses, goalFallback) {
  if (summaryShuttingDown) throw new Error('Summary scanner is shutting down')
  try {
    if (!summaryPool) summaryPool = createSummaryPool(SESSION_SUMMARY_WORKERS)
    return await summaryPool.scan(misses, goalFallback)
  } catch (error) {
    if (summaryShuttingDown || isClosedPoolError(error)) throw error
    const failedPool = summaryPool
    summaryPool = null
    await failedPool?.close().catch(() => {})
    if (summaryShuttingDown) throw new Error('Summary scanner is shutting down')
    return readSessionMissesOnThread(misses, goalFallback)
  }
}

async function readSessionMissesOnThread(misses, goalFallback) {
  const results = new Array(misses.length)
  let nextIndex = 0
  const workerCount = Math.min(PROJECT_SCAN_CONCURRENCY, misses.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < misses.length) {
      const index = nextIndex++
      const job = misses[index]
      results[index] = {
        ...job,
        session: await buildSessionInfo(job.path, goalFallback),
      }
    }
  }))
  return results
}

function isClosedPoolError(error) {
  const message = error?.message || ''
  return message.includes('Summary pool closed')
    || message.includes('Summary pool is closed')
}

export function hasSubagentSessionMarker(entries, sessionId) {
  return entries.some((entry) => {
    return entry.type === 'custom'
      && entry.customType === SUBAGENT_SESSION_CUSTOM_TYPE
      && entry.data?.sessionId === sessionId
  })
}

export function sessionModifiedDate(entries, header, statsMtime) {
  let lastActivityTime
  for (const entry of entries) {
    if (entry.type !== 'message') continue

    const message = entry.message
    if (!message || !('content' in message)) continue
    if (message.role !== 'user' && message.role !== 'assistant') continue

    if (typeof message.timestamp === 'number') {
      lastActivityTime = Math.max(lastActivityTime ?? 0, message.timestamp)
      continue
    }

    if (typeof entry.timestamp === 'string') {
      const time = new Date(entry.timestamp).getTime()
      if (!Number.isNaN(time)) lastActivityTime = Math.max(
        lastActivityTime ?? 0,
        time,
      )
    }
  }

  if (typeof lastActivityTime === 'number' && lastActivityTime > 0) {
    return new Date(lastActivityTime)
  }

  const headerTime = new Date(header.timestamp).getTime()
  return Number.isNaN(headerTime) ? statsMtime : new Date(headerTime)
}
