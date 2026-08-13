import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import {
  getAgentDir,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { goalStateFromEntries } from './goal-state.js'

const SESSION_DIR_ENV = 'PI_CODING_AGENT_SESSION_DIR'
const PROJECT_HEADER_SCAN_LIMIT = 1024 * 1024
const PROJECT_SCAN_CONCURRENCY = 24
export const SUBAGENT_SESSION_CUSTOM_TYPE = 'leyline-subagent-session'

export async function listPersistedSessions() {
  const sessionDir = configuredSessionDir(process.cwd())
  if (!sessionDir) return markSubagentSessions(await SessionManager.listAll())

  return listSessionsFromConfiguredDir(sessionDir)
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

async function listSessionsFromConfiguredDir(sessionDir) {
  const files = await sessionFiles(sessionDir)
  const sessions = (await Promise.all(files.map(buildSessionInfo))).filter(Boolean)
  const marked = await markSubagentSessions(sessions)
  return marked.sort((a, b) => b.modified.getTime() - a.modified.getTime())
}

async function markSubagentSessions(sessions) {
  const metadata = await Promise.all(sessions.map(async (session) => {
    if (session.subagentChildPaths) {
      return {
        childPaths: session.subagentChildPaths,
        marked: session.isSubagentSession === true,
      }
    }
    return subagentMetadataFromFile(session.path)
  }))
  const subagentPaths = new Set(metadata.flatMap((item) => item.childPaths))

  return sessions.map(({ subagentChildPaths, ...session }, index) => ({
    ...session,
    isSubagentSession: metadata[index].marked || subagentPaths.has(session.path),
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

async function buildSessionInfo(filePath) {
  try {
    const [content, stats] = await Promise.all([
      readFile(filePath, 'utf8'),
      stat(filePath),
    ])
    const entries = parseSessionEntries(content)
    const header = entries[0]

    if (header?.type !== 'session' || typeof header.id !== 'string') {
      return null
    }

    let messageCount = 0
    let firstMessage = ''
    let name
    const allMessages = []
    const goal = goalStateFromEntries(entries)

    for (const entry of entries) {
      if (entry.type === 'session_info') {
        name = entry.name?.trim() || undefined
      }
      if (entry.type !== 'message') continue
      messageCount++

      const message = entry.message
      if (!message || !('content' in message)) continue
      if (message.role !== 'user' && message.role !== 'assistant') continue

      const text = messageText(message.content)
      if (!text) continue
      allMessages.push(text)
      if (!firstMessage && message.role === 'user') firstMessage = text
    }

    return {
      path: filePath,
      id: header.id,
      cwd: typeof header.cwd === 'string' ? header.cwd : '',
      name,
      parentSessionPath: header.parentSession,
      isSubagentSession: hasSubagentSessionMarker(entries, header.id),
      subagentChildPaths: subagentChildPaths(entries),
      created: new Date(header.timestamp),
      modified: sessionModifiedDate(entries, header, stats.mtime),
      messageCount,
      firstMessage: firstMessage || goal?.objective || '(no messages)',
      allMessagesText: allMessages.join(' '),
    }
  } catch {
    return null
  }
}

function parseSessionEntries(content) {
  const entries = []
  for (const line of content.trim().split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {}
  }
  return entries
}

async function subagentMetadataFromFile(path) {
  try {
    const entries = parseSessionEntries(await readFile(path, 'utf8'))
    return {
      childPaths: subagentChildPaths(entries),
      marked: hasSubagentSessionMarker(entries, entries[0]?.id),
    }
  } catch {
    return { childPaths: [], marked: false }
  }
}

export function hasSubagentSessionMarker(entries, sessionId) {
  return entries.some((entry) => {
    return entry.type === 'custom'
      && entry.customType === SUBAGENT_SESSION_CUSTOM_TYPE
      && entry.data?.sessionId === sessionId
  })
}

function subagentChildPaths(entries) {
  const paths = []
  for (const entry of entries) {
    const message = entry.message
    if (entry.type !== 'message' || message?.role !== 'toolResult') continue
    if (message.toolName !== 'subagent') continue

    for (const result of message.details?.results || []) {
      const path = result.childSession?.path
      if (typeof path === 'string' && path) paths.push(path)
    }
  }
  return paths
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
