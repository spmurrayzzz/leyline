import { SessionManager } from '@earendil-works/pi-coding-agent'

export function piApi() {
  return {
    name: 'pi-api',
    configureServer(server) {
      server.middlewares.use('/api/pi', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')

        try {
          if (url.pathname === '/sessions') {
            const sessions = await SessionManager.listAll()
            return json(res, { sessions: sessions.map(toSessionDto) })
          }

          const match = url.pathname.match(/^\/sessions\/([^/]+)$/)
          if (match) {
            const session = await findSession(match[1])
            if (!session) return json(res, { error: 'Session not found' }, 404)
            return json(res, toSessionDetailDto(session))
          }

          return json(res, { error: 'Not found' }, 404)
        } catch (error) {
          return json(res, { error: error.message }, 500)
        }
      })
    },
  }
}

async function findSession(id) {
  const sessions = await SessionManager.listAll()
  return sessions.find((session) => session.id === id)
}

function toSessionDetailDto(session) {
  const manager = SessionManager.open(session.path)
  const header = manager.getHeader()
  const entries = manager.getBranch()

  const toolCalls = collectToolCalls(entries)

  return {
    session: {
      ...toSessionDto(session),
      cwd: header.cwd || session.cwd,
      sessionFile: manager.getSessionFile(),
      messageCount: session.messageCount,
      modified: session.modified,
      created: session.created,
    },
    entries: entries.map((entry) => toEntryDto(entry, toolCalls)).filter(Boolean),
  }
}

function collectToolCalls(entries) {
  const calls = new Map()

  for (const entry of entries) {
    if (entry.type !== 'message') continue
    if (entry.message.role !== 'assistant') continue
    if (!Array.isArray(entry.message.content)) continue

    for (const block of entry.message.content) {
      if (block.type === 'toolCall') calls.set(block.id, block)
    }
  }

  return calls
}

function toEntryDto(entry, toolCalls) {
  if (entry.type === 'message') return toMessageEntryDto(entry, toolCalls)

  if (entry.type === 'model_change') {
    return {
      id: entry.id,
      type: 'event',
      label: 'Model',
      text: `${entry.provider}/${entry.modelId}`,
      timestamp: entry.timestamp,
    }
  }

  if (entry.type === 'thinking_level_change') {
    return {
      id: entry.id,
      type: 'event',
      label: 'Thinking',
      text: entry.thinkingLevel,
      timestamp: entry.timestamp,
    }
  }

  if (entry.type === 'compaction') {
    return {
      id: entry.id,
      type: 'summary',
      label: 'Compaction',
      text: entry.summary,
      timestamp: entry.timestamp,
    }
  }

  if (entry.type === 'branch_summary') {
    return {
      id: entry.id,
      type: 'summary',
      label: 'Branch summary',
      text: entry.summary,
      timestamp: entry.timestamp,
    }
  }

  return undefined
}

function toMessageEntryDto(entry, toolCalls) {
  const message = entry.message
  const text = textFromContent(message.content || message.output || message.summary)

  if (message.role === 'toolResult') {
    const call = toolCalls.get(message.toolCallId)
    const annotation = toolAnnotation(message.toolName, call)

    return {
      id: entry.id,
      type: 'tool',
      label: annotation.label,
      code: annotation.code,
      text: truncate(text, 900),
      isError: message.isError,
      timestamp: entry.timestamp,
    }
  }

  if (message.role === 'bashExecution') {
    return {
      id: entry.id,
      type: 'tool',
      label: 'Bash',
      code: message.command,
      text: truncate(message.output || '', 900),
      isError: message.exitCode && message.exitCode !== 0,
      timestamp: entry.timestamp,
    }
  }

  return {
    id: entry.id,
    type: 'message',
    role: message.role,
    label: labelForRole(message.role),
    text: truncate(text, 1600),
    timestamp: entry.timestamp,
  }
}

function toolAnnotation(toolName, call) {
  const args = call?.arguments || {}

  if (toolName === 'read' && args.path) {
    const skill = skillNameFromPath(args.path)
    if (skill) return { label: `Skill · ${skill}`, code: shortPath(args.path) }
    return { label: 'Read', code: shortPath(args.path) }
  }

  if (toolName === 'bash' && args.command) {
    return { label: 'Bash', code: truncate(args.command, 80) }
  }

  if ((toolName === 'edit' || toolName === 'write') && args.path) {
    return { label: titleCase(toolName), code: shortPath(args.path) }
  }

  if ((toolName === 'grep' || toolName === 'find' || toolName === 'ls') && args.path) {
    return { label: titleCase(toolName), code: shortPath(args.path) }
  }

  return { label: `Tool · ${toolName}` }
}

function skillNameFromPath(path) {
  const match = path.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/)
  return match?.[1]
}

function shortPath(path) {
  return path.replace(`${process.env.HOME}/`, '~/')
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function textFromContent(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)

  return content
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'thinking') return block.thinking
      if (block.type === 'toolCall') return ''
      if (block.type === 'image') return '[image]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function labelForRole(role) {
  if (role === 'user') return 'You'
  if (role === 'assistant') return 'Agent'
  if (role === 'custom') return 'Custom'
  if (role === 'compactionSummary') return 'Compaction summary'
  if (role === 'branchSummary') return 'Branch summary'
  return role
}

function toSessionDto(session) {
  return {
    id: session.id,
    path: session.path,
    cwd: session.cwd,
    name: session.name,
    firstMessage: truncate(session.firstMessage || '', 140),
    timestamp: session.created || timestampFromPath(session.path),
  }
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1)}…`
}

function timestampFromPath(path) {
  const match = path?.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_/)
  if (!match) return undefined
  return match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z')
}

function json(res, data, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}
