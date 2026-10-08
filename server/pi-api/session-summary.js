import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { byteLines } from './session-lines.js'
import { goalStateFromEntries } from './goal-state.js'
import {
  RESEARCH_CUSTOM_TYPE,
  researchStateFromEntries,
} from '../../lib/research-state.js'

export const SUBAGENT_SESSION_CUSTOM_TYPE = 'leyline-subagent-session'

export async function buildSessionInfo(filePath, goalFallback) {
  try {
    const stats = await stat(filePath)
    const lines = byteLines(createReadStream(filePath))
    let header
    let messageCount = 0
    let firstMessage = ''
    let name
    let goalObjective = ''
    let lastActivityTime = 0
    let isSubagentSession = false
    const subagentChildPaths = []
    const researchTree = new Map()
    let researchLeafId = ''

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

      const treeLink = sessionTreeLinkFromLine(line)
      if (treeLink) {
        researchTree.set(treeLink.id, treeLink)
        researchLeafId = treeLink.id
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
          && !line.includes(`"customType":"${RESEARCH_CUSTOM_TYPE}"`)
          && !line.includes('"customType":"goal-state"')) continue
        try {
          const entry = JSON.parse(line)
          if (entry.customType === SUBAGENT_SESSION_CUSTOM_TYPE
            && entry.data?.sessionId === header.id) {
            isSubagentSession = true
          }
          if (entry.customType === RESEARCH_CUSTOM_TYPE) {
            const node = researchTree.get(entry.id)
            if (node) node.researchEntry = entry
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
    return {
      path: filePath,
      id: header.id,
      cwd: typeof header.cwd === 'string' ? header.cwd : '',
      name,
      parentSessionPath: header.parentSession,
      isSubagentSession,
      subagentChildPaths,
      research: researchStateFromEntries(
        activeResearchEntries(researchTree, researchLeafId),
        header.id,
      ),
      created: new Date(header.timestamp),
      modified,
      messageCount,
      firstMessage: firstMessage
        || (goalFallback ? goalObjective : '')
        || '(no messages)',
    }
  } catch {
    return null
  }
}

function sessionTreeLinkFromLine(line) {
  const structural = line.length > 4096
    ? `${line.slice(0, 2048)}${line.slice(-2048)}`
    : line
  const match = structural.match(/"id":"([^"]+)","parentId":(null|"([^"]+)")/)
  if (!match) return null
  return {
    id: match[1],
    parentId: match[2] === 'null' ? null : match[3],
    researchEntry: null,
  }
}

function activeResearchEntries(tree, leafId) {
  const entries = []
  const seen = new Set()
  let currentId = leafId
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const node = tree.get(currentId)
    if (!node) break
    if (node.researchEntry) entries.push(node.researchEntry)
    currentId = node.parentId
  }
  return entries.reverse()
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
