import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from '@earendil-works/pi-coding-agent'

let activeRuntime
let activeSessionId
let unsubscribeActiveSession

const sseClients = new Set()

const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({ cwd })
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  }
}

export function piApi() {
  return {
    name: 'pi-api',
    configureServer(server) {
      server.middlewares.use('/api/pi', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')

        try {
          if (url.pathname === '/sessions') {
            if (req.method === 'GET') {
              const sessions = await listSessions()
              return json(res, { sessions: sessions.map(toSessionDto) })
            }

            if (req.method === 'POST') {
              const body = await readJson(req)
              const active = await createNewSession(body.cwd)
              return json(res, {
                active,
                detail: toActiveSessionDetailDto(),
              })
            }

            return json(res, { error: 'Method not allowed' }, 405)
          }

          if (url.pathname === '/active-session') {
            if (req.method !== 'POST') {
              return json(res, { error: 'Method not allowed' }, 405)
            }

            const body = await readJson(req)
            const session = await findSession(body.id)
            if (!session) return json(res, { error: 'Session not found' }, 404)

            const active = await switchActiveSession(session)
            return json(res, { active })
          }

          if (url.pathname === '/prompt') {
            if (req.method !== 'POST') {
              return json(res, { error: 'Method not allowed' }, 405)
            }

            const body = await readJson(req)
            await promptActiveSession(body.text)
            return json(res, { ok: true, active: activeSessionDto() })
          }

          if (url.pathname === '/events') {
            if (req.method !== 'GET') {
              return json(res, { error: 'Method not allowed' }, 405)
            }

            return openEventStream(req, res)
          }

          const match = url.pathname.match(/^\/sessions\/([^/]+)$/)
          if (match) {
            if (isActiveSession(match[1])) {
              return json(res, toActiveSessionDetailDto())
            }

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

async function listSessions() {
  const sessions = await SessionManager.listAll()
  if (!activeRuntime) return sessions
  if (sessions.some((session) => session.id === activeSessionId)) return sessions
  return [activeSessionInfo(), ...sessions]
}

async function findSession(id) {
  if (isActiveSession(id)) return activeSessionInfo()
  const sessions = await SessionManager.listAll()
  return sessions.find((session) => session.id === id)
}

function isActiveSession(id) {
  return activeRuntime && id === activeSessionId
}

async function switchActiveSession(session) {
  if (isActiveSession(session.id)) return activeSessionDto()

  if (!activeRuntime) {
    activeRuntime = await createAgentSessionRuntime(createRuntime, {
      cwd: session.cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.open(session.path),
    })
  } else if (activeRuntime.session.sessionFile !== session.path) {
    await activeRuntime.switchSession(session.path)
  }

  activeSessionId = session.id
  await bindActiveSession()

  return activeSessionDto()
}

async function promptActiveSession(text) {
  if (!activeRuntime) throw new Error('No active session')
  if (!text?.trim()) throw new Error('text is required')

  let preflightSucceeded = false
  await new Promise((resolve, reject) => {
    activeRuntime.session
      .prompt(text, {
        source: 'api',
        preflightResult: (didSucceed) => {
          if (!didSucceed) return
          preflightSucceeded = true
          resolve()
        },
      })
      .catch((error) => {
        if (!preflightSucceeded) reject(error)
      })
  })
}

async function createNewSession(cwd) {
  if (!cwd) throw new Error('cwd is required')

  if (activeRuntime && activeRuntime.cwd === cwd) {
    const result = await activeRuntime.newSession()
    if (result.cancelled) throw new Error('New session cancelled')
  } else {
    unsubscribeActiveSession?.()
    activeRuntime?.session.dispose()
    activeRuntime = await createAgentSessionRuntime(createRuntime, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.create(cwd),
    })
  }

  activeSessionId = activeRuntime.session.sessionManager.getSessionId()
  await bindActiveSession()
  return activeSessionDto()
}

function activeSessionDto() {
  return {
    id: activeSessionId,
    path: activeRuntime.session.sessionFile,
    cwd: activeRuntime.cwd,
    diagnostics: activeRuntime.diagnostics,
  }
}

async function bindActiveSession() {
  unsubscribeActiveSession?.()
  await activeRuntime.session.bindExtensions({})
  unsubscribeActiveSession = activeRuntime.session.subscribe((event) => {
    broadcastEvent('runtime_event', {
      activeSessionId,
      event,
    })
  })
  broadcastEvent('active_session', {
    id: activeSessionId,
    path: activeRuntime.session.sessionFile,
    cwd: activeRuntime.cwd,
  })
}

function openEventStream(req, res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.write(': connected\n\n')

  sseClients.add(res)

  if (activeRuntime) {
    sendEvent(res, 'active_session', {
      id: activeSessionId,
      path: activeRuntime.session.sessionFile,
      cwd: activeRuntime.cwd,
    })
  }

  req.on('close', () => {
    sseClients.delete(res)
  })
}

function broadcastEvent(type, data) {
  for (const client of sseClients) sendEvent(client, type, data)
}

function sendEvent(res, type, data) {
  res.write(`event: ${type}\n`)
  res.write(`data: ${stringifyEvent(data)}\n\n`)
}

function stringifyEvent(data) {
  try {
    return JSON.stringify(data)
  } catch (error) {
    return JSON.stringify({
      activeSessionId,
      event: {
        type: 'unserializable',
        error: error.message,
      },
    })
  }
}

function toSessionDetailDto(session) {
  return toSessionDetailFromManager(SessionManager.open(session.path), session)
}

function toActiveSessionDetailDto() {
  return toSessionDetailFromManager(
    activeRuntime.session.sessionManager,
    activeSessionInfo(),
  )
}

function toSessionDetailFromManager(manager, session) {
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

function activeSessionInfo() {
  const manager = activeRuntime.session.sessionManager
  const header = manager.getHeader()
  const entries = manager.getBranch()
  const messageCount = entries.filter((entry) => entry.type === 'message').length
  const created = new Date(header.timestamp)

  return {
    id: manager.getSessionId(),
    path: manager.getSessionFile(),
    cwd: header.cwd || activeRuntime.cwd,
    name: undefined,
    firstMessage: '(no messages)',
    created,
    modified: created,
    messageCount,
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
    text,
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      if (!data) return resolve({})

      try {
        resolve(JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function json(res, data, status = 200) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}
