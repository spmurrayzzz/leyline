const MESSAGE_UPDATE_INTERVAL_MS = 50
const MAX_PENDING_EVENTS = 128
const MAX_PENDING_CHARS = 4 * 1024 * 1024
const COMPACT_TEXT_LIMIT = 240

export function createEventHub(options) {
  const clients = new Set()
  const pendingMessageUpdates = new Map()

  function openEventStream(req, res) {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')

    const client = {
      res,
      selectedSessionId: requestedSessionId(req),
      blocked: false,
      closed: false,
      queue: [],
      queuedChars: 0,
      onDrain: undefined,
    }
    client.onDrain = () => flushClient(client)
    clients.add(client)

    req.on('close', () => closeClient(client))
    res.on('error', () => closeClient(client))

    writeClientChunk(client, ': connected\n\n')
    for (const handle of options.getRuntimeHandles()) {
      sendClientEvent(
        client,
        'active_session',
        options.activeSessionDto(handle),
      )
    }
  }

  function broadcastActiveSession(handle) {
    if (!handle) return
    broadcastEvent('active_session', options.activeSessionDto(handle))
  }

  function broadcastEvent(type, data) {
    if (isMessageUpdate(type, data)) {
      queueMessageUpdate(data)
      return
    }

    if (type === 'runtime_event' && data?.activeSessionId) {
      flushMessageUpdate(data.activeSessionId)
    }
    broadcastNow(type, data)
  }

  function queueMessageUpdate(data) {
    const sessionId = data?.activeSessionId
    if (!sessionId || !hasFullRuntimeClient(sessionId)) return

    const pending = pendingMessageUpdates.get(sessionId)
    if (pending) {
      pending.data = data
      return
    }

    const timer = setTimeout(() => {
      flushMessageUpdate(sessionId)
    }, MESSAGE_UPDATE_INTERVAL_MS)
    timer.unref?.()
    pendingMessageUpdates.set(sessionId, { data, timer })
  }

  function flushMessageUpdate(sessionId) {
    const pending = pendingMessageUpdates.get(sessionId)
    if (!pending) return
    clearTimeout(pending.timer)
    pendingMessageUpdates.delete(sessionId)
    broadcastNow('runtime_event', pending.data)
  }

  function hasFullRuntimeClient(sessionId) {
    for (const client of clients) {
      if (client.selectedSessionId === null
        || client.selectedSessionId === sessionId) return true
    }
    return false
  }

  function broadcastNow(type, data) {
    for (const client of clients) sendClientEvent(client, type, data)
  }

  function sendClientEvent(client, type, data) {
    if (client.closed) return
    const prepared = dataForClient(client, type, data)
    if (prepared === null) return

    const chunk = `event: ${type}\ndata: ${stringifyEvent(prepared)}\n\n`
    if (client.blocked) {
      enqueueClientChunk(client, {
        chunk,
        key: coalesceKey(type, prepared),
      })
      return
    }
    writeClientChunk(client, chunk)
  }

  function writeClientChunk(client, chunk) {
    if (client.closed) return false
    try {
      if (client.res.write(chunk)) return true
    } catch {
      closeClient(client)
      return false
    }

    client.blocked = true
    client.res.once('drain', client.onDrain)
    return false
  }

  function enqueueClientChunk(client, item) {
    if (item.key) {
      const index = client.queue.findIndex((queued) => queued.key === item.key)
      if (index !== -1) removeQueuedChunk(client, index)
    }

    if (client.queue.length >= MAX_PENDING_EVENTS
      || client.queuedChars + item.chunk.length > MAX_PENDING_CHARS) {
      closeClient(client, true)
      return
    }

    client.queue.push(item)
    client.queuedChars += item.chunk.length
  }

  function removeQueuedChunk(client, index) {
    const [removed] = client.queue.splice(index, 1)
    client.queuedChars -= removed?.chunk.length || 0
  }

  function flushClient(client) {
    if (client.closed) return
    client.blocked = false

    while (client.queue.length) {
      const item = client.queue.shift()
      client.queuedChars -= item.chunk.length
      if (!writeClientChunk(client, item.chunk)) return
    }
  }

  function closeClient(client, end = false) {
    if (client.closed) return
    client.closed = true
    clients.delete(client)
    client.res.removeListener('drain', client.onDrain)
    client.queue = []
    client.queuedChars = 0
    if (end && !client.res.writableEnded) {
      try {
        client.res.end()
      } catch {}
    }
  }

  function stringifyEvent(data) {
    try {
      return JSON.stringify(data)
    } catch (error) {
      return JSON.stringify({
        activeSessionId: options.getActiveSessionId(),
        event: {
          type: 'unserializable',
          error: error.message,
        },
      })
    }
  }

  return {
    broadcastActiveSession,
    broadcastEvent,
    openEventStream,
  }
}

function requestedSessionId(req) {
  const url = new URL(req.url || '/', 'http://localhost')
  if (!url.searchParams.has('sessionId')) return null
  return cleanText(url.searchParams.get('sessionId'), 200)
}

function isMessageUpdate(type, data) {
  return type === 'runtime_event' && data?.event?.type === 'message_update'
}

function dataForClient(client, type, data) {
  const sessionId = type === 'active_session'
    ? data?.id
    : data?.activeSessionId
  if (!sessionId
    || client.selectedSessionId === null
    || client.selectedSessionId === sessionId) {
    return data
  }

  if (type === 'active_session') return compactActiveSession(data)
  if (type === 'runtime_event') return compactRuntimeEnvelope(data)
  if (type === 'extension_ui' || type === 'extension_error') return null
  return data
}

function compactActiveSession(session) {
  const state = session?.state || {}
  const pendingToolCalls = Array.isArray(state.pendingToolCalls)
    ? state.pendingToolCalls.slice(0, 32)
    : []
  const pendingTools = Array.isArray(state.pendingTools)
    ? state.pendingTools.slice(0, 32).map(compactPendingTool)
    : []

  return {
    id: session?.id,
    path: session?.path,
    cwd: session?.cwd,
    diagnostics: compactDiagnostics(session?.diagnostics),
    state: {
      isStreaming: state.isStreaming === true,
      isCompacting: state.isCompacting === true,
      pendingToolCalls,
      pendingTools,
      pendingToolCount: Math.max(
        pendingToolCalls.length,
        pendingTools.length,
        finiteCount(state.activeToolCount),
      ),
      activeToolCount: finiteCount(state.activeToolCount),
      activeToolNames: Array.isArray(state.activeToolNames)
        ? state.activeToolNames.slice(0, 32)
        : [],
      queuedMessages: compactQueue(state.queuedMessages),
      research: compactResearch(state.research),
    },
  }
}

function compactRuntimeEnvelope(data) {
  const event = compactRuntimeEvent(data?.event)
  if (!event) return null
  return {
    activeSessionId: data.activeSessionId,
    ...(data.handoffId ? { handoffId: data.handoffId } : {}),
    event,
  }
}

function compactRuntimeEvent(event) {
  if (!event?.type
    || event.type === 'message_update'
    || event.type === 'tool_execution_update') return null
  const compact = { type: event.type }

  if (event.type === 'message_start' || event.type === 'message_end') {
    compact.message = compactMessage(event.message)
    return compact
  }

  if (event.type === 'tool_call'
    || event.type === 'tool_execution_start'
    || event.type === 'tool_execution_end') {
    copyTextFields(compact, event, [
      'toolCallId',
      'id',
      'callId',
      'toolName',
    ])
    if (event.args !== undefined) compact.args = compactToolArgs(event.args)
    if (event.input !== undefined) compact.input = compactToolArgs(event.input)
    if (event.isError !== undefined) compact.isError = event.isError === true
    if (event.error !== undefined) compact.error = compactError(event.error)
    return compact
  }

  if (event.type === 'queue_update') {
    const queue = compactQueue(event)
    compact.steeringCount = queue.steeringCount
    compact.followUpCount = queue.followUpCount
    return compact
  }

  if (event.type === 'error') {
    if (event.error !== undefined) compact.error = compactError(event.error)
    if (event.message !== undefined) {
      compact.message = cleanText(event.message, COMPACT_TEXT_LIMIT)
    }
    return compact
  }

  if (event.type === 'compaction_end') {
    copyTextFields(compact, event, ['reason', 'errorMessage'])
  }

  return compact
}

function compactMessage(message) {
  if (!message || typeof message !== 'object') {
    return cleanText(message, COMPACT_TEXT_LIMIT)
  }

  const compact = {}
  copyTextFields(compact, message, [
    'role',
    'stopReason',
    'errorMessage',
    'id',
    'entryId',
    'toolCallId',
    'toolName',
  ])
  if (message.isError !== undefined) compact.isError = message.isError === true
  if (message.timestamp !== undefined) compact.timestamp = message.timestamp
  return compact
}

function compactPendingTool(tool) {
  return {
    toolCallId: cleanText(tool?.toolCallId, COMPACT_TEXT_LIMIT),
    toolName: cleanText(tool?.toolName, COMPACT_TEXT_LIMIT) || 'tool',
    args: compactToolArgs(tool?.args),
  }
}

function compactToolArgs(args) {
  if (!args || typeof args !== 'object') return {}
  const compact = {}
  copyTextFields(compact, args, ['command', 'path', 'query', 'id', 'scope'])
  if (Array.isArray(args.ids)) {
    compact.ids = args.ids.slice(0, 20).map((id) => {
      return cleanText(id, COMPACT_TEXT_LIMIT)
    })
  }
  return compact
}

function compactQueue(queue) {
  return {
    steeringCount: queueCount(queue?.steering, queue?.steeringCount),
    followUpCount: queueCount(queue?.followUp, queue?.followUpCount),
  }
}

function queueCount(messages, count) {
  if (Array.isArray(messages)) return messages.length
  return finiteCount(count)
}

function compactResearch(research) {
  if (!research || typeof research !== 'object') return null
  return {
    status: cleanText(research.status, 40),
    phase: cleanText(research.phase, 40),
    threadCount: finiteCount(research.threadCount),
    completedThreadCount: finiteCount(research.completedThreadCount),
    sourceCount: finiteCount(research.sourceCount),
    error: cleanText(research.error, 1000),
  }
}

function compactDiagnostics(diagnostics) {
  if (!Array.isArray(diagnostics)) return []
  return diagnostics.slice(-5).map((diagnostic) => ({
    type: cleanText(diagnostic?.type, 40),
    message: cleanText(diagnostic?.message, 1000),
  }))
}

function compactError(error) {
  if (typeof error === 'string') return cleanText(error, 1000)
  if (!error || typeof error !== 'object') return cleanText(error, 1000)
  return { message: cleanText(error.message, 1000) }
}

function copyTextFields(target, source, fields) {
  for (const field of fields) {
    if (source?.[field] === undefined) continue
    target[field] = cleanText(source[field], COMPACT_TEXT_LIMIT)
  }
}

function cleanText(value, limit) {
  if (value === undefined || value === null) return ''
  return String(value).slice(0, limit)
}

function finiteCount(value) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0
}

function coalesceKey(type, data) {
  if (type === 'active_session' && data?.id) return `active:${data.id}`
  if (type === 'extension_ui' && data?.activeSessionId) {
    return `extension:${data.activeSessionId}`
  }
  if (type !== 'runtime_event' || !data?.activeSessionId) return ''

  const event = data.event || {}
  if (event.type === 'message_update') {
    const messageId = event.message?.entryId
      || event.message?.id
      || event.message?.timestamp
      || 'current'
    return `runtime:${data.activeSessionId}:${event.type}:${messageId}`
  }
  if (event.type === 'queue_update') {
    return `runtime:${data.activeSessionId}:${event.type}`
  }
  if (event.type === 'tool_execution_update') {
    const toolCallId = event.toolCallId || event.id || event.callId || ''
    return `runtime:${data.activeSessionId}:${event.type}:${toolCallId}`
  }
  return ''
}
