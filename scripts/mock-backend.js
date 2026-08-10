import { createServer } from 'node:http'

const port = Number.parseInt(
  process.env.MOCK_BACKEND_PORT || process.argv[2] || '8787',
  10,
)
const errorDelay = Number.parseInt(
  process.env.MOCK_BACKEND_ERROR_DELAY || '900',
  10,
)
const sessionId = 'mock-session-1'
const sessionPath = '/tmp/leyline-mock-session.jsonl'
const cwd = '/tmp/leyline-mock-project'
const startedAt = new Date().toISOString()
const clients = new Set()
const entries = []
const pendingFailures = new Map()
let activeSessionId = sessionId
let sessionName = 'Mock error session'
let isStreaming = false
let messageSequence = 0

const model = {
  id: 'mock-model',
  name: 'Mock model',
  provider: 'mock',
  supportsImages: false,
  availableThinkingLevels: ['off'],
}

function sessionSummary() {
  return {
    id: sessionId,
    path: sessionPath,
    cwd,
    name: sessionName,
    isSubagentSession: false,
    firstMessage: entries.find((entry) => entry.role === 'user')?.text || sessionName,
    messageCount: entries.length,
    modified: new Date().toISOString(),
    timestamp: startedAt,
  }
}

function activeState() {
  return {
    model,
    availableModels: [model],
    thinkingLevel: 'off',
    availableThinkingLevels: ['off'],
    isStreaming,
    isCompacting: false,
    pendingToolCalls: [],
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    activeToolCount: 0,
    activeToolNames: [],
    contextUsage: null,
    slashCommands: [],
    queuedMessages: { steering: [], followUp: [] },
    extensionUi: { statuses: {}, widgets: {}, notifications: [] },
    goal: null,
  }
}

function activeSession() {
  return {
    id: sessionId,
    path: sessionPath,
    cwd,
    diagnostics: [],
    state: activeState(),
  }
}

function detail() {
  return {
    session: {
      ...sessionSummary(),
      sessionFile: sessionPath,
      contextTokens: null,
      created: startedAt,
      contextUsage: null,
    },
    entries: [...entries],
  }
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(body)
}

function sendSse(res, type, value) {
  res.write(`event: ${type}\n`)
  res.write(`data: ${JSON.stringify(value)}\n\n`)
}

function broadcast(type, value) {
  for (const client of clients) sendSse(client, type, value)
}

function broadcastRuntime(event) {
  broadcast('runtime_event', { activeSessionId, event })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (!body) return resolve({})
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`))
      }
    })
    req.on('error', reject)
  })
}

function scopedSessionId(pathname) {
  const match = pathname.match(/^\/api\/pi\/sessions\/([^/]+)\/(prompt|interrupt|reload|model|thinking)$/)
  return match ? decodeURIComponent(match[1]) : ''
}

function addUserEntry(text) {
  const timestamp = new Date().toISOString()
  const id = `mock-user-${++messageSequence}`
  entries.push({
    id,
    type: 'message',
    role: 'user',
    label: 'You',
    text,
    blocks: [{ type: 'text', text }],
    skillSummaries: [],
    timestamp,
    copyText: text,
  })
}

function failPrompt(promptSequence) {
  const assistantId = `mock-assistant-${promptSequence}`
  isStreaming = true
  broadcast('active_session', activeSession())
  broadcastRuntime({ type: 'agent_start' })
  broadcastRuntime({
    type: 'message_start',
    message: {
      role: 'assistant',
      entryId: assistantId,
      content: [],
    },
  })

  const timer = setTimeout(() => {
    pendingFailures.delete(promptSequence)
    broadcastRuntime({
      type: 'message_end',
      message: {
        role: 'assistant',
        entryId: assistantId,
        content: [],
        stopReason: 'error',
        errorMessage: 'Mock backend model request failed',
      },
    })
    isStreaming = false
    broadcastRuntime({ type: 'agent_end' })
    broadcast('active_session', activeSession())
  }, Math.max(0, errorDelay))
  pendingFailures.set(promptSequence, timer)
}

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    return res.end()
  }

  if (url.pathname === '/api/pi/info' && req.method === 'GET') {
    return sendJson(res, {
      name: 'Leyline',
      version: 'mock',
      apiVersion: 1,
      capabilities: { events: true, exports: false, terminal: false },
    })
  }

  if (url.pathname === '/api/pi/events' && req.method === 'GET') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
    res.write(': connected\n\n')
    clients.add(res)
    sendSse(res, 'active_session', activeSession())
    const ping = setInterval(() => res.write(': ping\n\n'), 15000)
    req.on('close', () => {
      clearInterval(ping)
      clients.delete(res)
    })
    return
  }

  if (url.pathname === '/api/pi/sessions' && req.method === 'GET') {
    return sendJson(res, { sessions: [sessionSummary()] })
  }

  if (url.pathname === '/api/pi/sessions/by-path' && req.method === 'GET') {
    return sendJson(res, url.searchParams.get('path') === sessionPath ? detail() : { error: 'Session not found' }, url.searchParams.get('path') === sessionPath ? 200 : 404)
  }

  if (url.pathname === '/api/pi/sessions' && req.method === 'POST') {
    await readBody(req)
    activeSessionId = sessionId
    const active = activeSession()
    broadcast('active_session', active)
    return sendJson(res, { active, detail: detail() })
  }

  if (url.pathname === '/api/pi/active-session' && req.method === 'POST') {
    const body = await readBody(req)
    if (body.id !== sessionId) return sendJson(res, { error: 'Session not found' }, 404)
    activeSessionId = sessionId
    const active = activeSession()
    broadcast('active_session', active)
    return sendJson(res, { active })
  }

  if (url.pathname === '/api/pi/state' && req.method === 'GET') {
    return sendJson(res, { active: activeSession() })
  }

  const sessionMatch = url.pathname.match(/^\/api\/pi\/sessions\/([^/]+)$/)
  if (sessionMatch) {
    const id = decodeURIComponent(sessionMatch[1])
    if (id !== sessionId) return sendJson(res, { error: 'Session not found' }, 404)
    if (req.method === 'GET') return sendJson(res, detail())
    if (req.method === 'PATCH') {
      const body = await readBody(req)
      sessionName = body.name || sessionName
      return sendJson(res, { ok: true, detail: detail(), session: detail().session })
    }
    return sendJson(res, { error: 'Method not allowed' }, 405)
  }

  const id = scopedSessionId(url.pathname)
  if (id) {
    if (id !== sessionId) return sendJson(res, { error: 'Session not found' }, 404)
    if (req.method !== 'POST') return sendJson(res, { error: 'Method not allowed' }, 405)
    const action = url.pathname.split('/').at(-1)
    const body = await readBody(req)

    if (action === 'prompt') {
      if (!body.text?.trim() && !body.images?.length) {
        return sendJson(res, { error: 'text or image is required' }, 400)
      }
      addUserEntry(body.text || '[image]')
      const promptSequence = messageSequence
      isStreaming = true
      const active = activeSession()
      failPrompt(promptSequence)
      return sendJson(res, { ok: true, active })
    }

    if (action === 'interrupt') {
      for (const timer of pendingFailures.values()) clearTimeout(timer)
      pendingFailures.clear()
      isStreaming = false
      broadcastRuntime({ type: 'aborted' })
      return sendJson(res, { ok: true, active: activeSession() })
    }

    return sendJson(res, { ok: true, active: activeSession() })
  }

  if (url.pathname === '/api/pi/subagents' && req.method === 'GET') {
    return sendJson(res, { agents: [] })
  }

  if (url.pathname === '/api/pi/memories' && req.method === 'GET') {
    return sendJson(res, { memories: [] })
  }

  return sendJson(res, { error: 'Not found' }, 404)
}

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  handle(req, res).catch((error) => {
    if (!res.headersSent) sendJson(res, { error: error.message }, 500)
    else res.destroy(error)
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock Leyline backend listening at http://127.0.0.1:${port}`)
  console.log(`Mock error delay: ${errorDelay}ms`)
})

function shutdown() {
  for (const client of clients) client.end()
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
