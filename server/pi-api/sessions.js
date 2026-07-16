import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getAgentDir,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { goalStateFromEntries } from './goal-state.js'

const SESSION_DIR_ENV = 'PI_CODING_AGENT_SESSION_DIR'
export const SUBAGENT_SESSION_CUSTOM_TYPE = 'leyline-subagent-session'

export async function listPersistedSessions() {
  const sessionDir = configuredSessionDir(process.cwd())
  if (!sessionDir) return markSubagentSessions(await SessionManager.listAll())

  return listSessionsFromConfiguredDir(sessionDir)
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
