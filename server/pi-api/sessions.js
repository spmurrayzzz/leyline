import { createReadStream } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { StringDecoder } from 'node:string_decoder'
import {
  getAgentDir,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { goalStateFromEntries } from './goal-state.js'

const SESSION_DIR_ENV = 'PI_CODING_AGENT_SESSION_DIR'
const PROJECT_HEADER_SCAN_LIMIT = 1024 * 1024
const PROJECT_SCAN_CONCURRENCY = 24
const sessionInfoCache = new Map()
let pendingSessionList
export const SUBAGENT_SESSION_CUSTOM_TYPE = 'leyline-subagent-session'

export async function listPersistedSessions() {
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
  let nextIndex = 0
  const workerCount = Math.min(PROJECT_SCAN_CONCURRENCY, files.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < files.length) {
      const index = nextIndex++
      sessions[index] = await buildSessionInfo(files[index], goalFallback)
    }
  })
  await Promise.all(workers)
  const currentPaths = new Set(files)
  for (const path of sessionInfoCache.keys()) {
    if (!currentPaths.has(path)) sessionInfoCache.delete(path)
  }
  return sessions.filter(Boolean)
}

async function buildSessionInfo(filePath, goalFallback) {
  try {
    const stats = await stat(filePath)
    const cached = sessionInfoCache.get(filePath)
    if (cached?.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.session
    }
    const lines = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })
    let header
    let messageCount = 0
    let firstMessage = ''
    let name
    let goalObjective = ''
    let lastActivityTime = 0
    let isSubagentSession = false
    const subagentChildPaths = []

    for await (const line of lines) {
      const prefix = line.slice(0, 192)
      if (!header) {
        let entry
        try {
          entry = JSON.parse(line)
        } catch {
          continue
        }
        if (entry.type !== 'session' || typeof entry.id !== 'string') return null
        header = entry
        continue
      }

      if (prefix.includes('"type":"session_info"')) {
        try {
          const entry = JSON.parse(line)
          name = entry.name?.trim() || undefined
        } catch {}
        continue
      }

      if (prefix.includes('"type":"custom"')) {
        if (!line.includes(`"customType":"${SUBAGENT_SESSION_CUSTOM_TYPE}"`)
          && !line.includes('"customType":"goal-state"')) continue
        try {
          const entry = JSON.parse(line)
          if (entry.customType === SUBAGENT_SESSION_CUSTOM_TYPE
            && entry.data?.sessionId === header.id) {
            isSubagentSession = true
          }
          const goal = goalStateFromEntries([entry])
          if (goal?.objective) goalObjective = goal.objective
        } catch {}
        continue
      }

      if (!prefix.includes('"type":"message"')) continue
      messageCount++
      const role = prefix.match(/"role":"([^"]+)"/)?.[1]
      if (role === 'toolResult' && line.includes('"toolName":"subagent"')) {
        try {
          const entry = JSON.parse(line)
          for (const result of entry.message?.details?.results || []) {
            const path = result.childSession?.path
            if (typeof path === 'string' && path) subagentChildPaths.push(path)
          }
        } catch {}
      }
      if (role !== 'user' && role !== 'assistant') continue

      const messageTimestamp = numericTimestampFromLine(line, role)
      if (messageTimestamp) {
        lastActivityTime = Math.max(lastActivityTime, messageTimestamp)
      } else {
        const timestamp = prefix.match(/"timestamp":"([^"]+)"/)?.[1]
        if (timestamp) {
          const time = new Date(timestamp).getTime()
          if (!Number.isNaN(time)) lastActivityTime = Math.max(
            lastActivityTime,
            time,
          )
        }
      }

      if (!firstMessage && role === 'user') {
        firstMessage = firstMessageTextFromLine(line)
      }
    }

    if (!header) return null
    const headerTime = new Date(header.timestamp).getTime()
    const modified = lastActivityTime > 0
      ? new Date(lastActivityTime)
      : Number.isNaN(headerTime) ? stats.mtime : new Date(headerTime)
    const session = {
      path: filePath,
      id: header.id,
      cwd: typeof header.cwd === 'string' ? header.cwd : '',
      name,
      parentSessionPath: header.parentSession,
      isSubagentSession,
      subagentChildPaths,
      created: new Date(header.timestamp),
      modified,
      messageCount,
      firstMessage: firstMessage
        || (goalFallback ? goalObjective : '')
        || '(no messages)',
    }
    sessionInfoCache.set(filePath, {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      session,
    })
    return session
  } catch {
    return null
  }
}

export function hasSubagentSessionMarker(entries, sessionId) {
  return entries.some((entry) => {
    return entry.type === 'custom'
      && entry.customType === SUBAGENT_SESSION_CUSTOM_TYPE
      && entry.data?.sessionId === sessionId
  })
}

function numericTimestampFromLine(line, role) {
  const marker = ',"timestamp":'
  let index
  if (role === 'assistant') {
    const stopReasonIndex = line.lastIndexOf(',"stopReason":')
    index = stopReasonIndex === -1
      ? -1
      : line.indexOf(marker, stopReasonIndex)
  } else {
    index = line.lastIndexOf(marker)
  }
  if (index === -1) return 0
  const start = index + marker.length
  if (line[start] < '0' || line[start] > '9') return 0
  let end = start + 1
  while (line[end] >= '0' && line[end] <= '9') end++
  return Number(line.slice(start, end)) || 0
}

function firstMessageTextFromLine(line) {
  if (line.length < 256 * 1024) {
    try {
      return messageText(JSON.parse(line).message?.content)
    } catch {
      return ''
    }
  }

  const textMarker = '"type":"text","text":'
  const markerIndex = line.indexOf(textMarker)
  if (markerIndex !== -1) {
    return jsonStringAt(line, markerIndex + textMarker.length)
  }

  const contentMarker = '"content":'
  const contentIndex = line.indexOf(contentMarker)
  if (contentIndex === -1) return ''
  return jsonStringAt(line, contentIndex + contentMarker.length)
}

function jsonStringAt(value, start) {
  if (value[start] !== '"') return ''
  let escaped = false
  for (let index = start + 1; index < value.length; index++) {
    const character = value[index]
    if (character === '"' && !escaped) {
      try {
        return JSON.parse(value.slice(start, index + 1))
      } catch {
        return ''
      }
    }
    if (character === '\\' && !escaped) escaped = true
    else escaped = false
  }
  return ''
}

export function messageText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join(' ')
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
