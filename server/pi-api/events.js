export function createEventHub(options) {
  const clients = new Set()

  function openEventStream(req, res) {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.write(': connected\n\n')

    clients.add(res)

    for (const handle of options.getRuntimeHandles()) {
      sendEvent(res, 'active_session', options.activeSessionDto(handle))
    }

    req.on('close', () => {
      clients.delete(res)
    })
  }

  function broadcastActiveSession(handle) {
    if (!handle) return
    broadcastEvent('active_session', options.activeSessionDto(handle))
  }

  function broadcastEvent(type, data) {
    for (const client of clients) sendEvent(client, type, data)
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
