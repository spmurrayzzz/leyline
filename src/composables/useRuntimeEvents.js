import { ref } from 'vue'
import { openEventSocket } from '../lib/event-socket'

export function useRuntimeEvents({
  onActiveSession,
  onRuntimeEvent,
  onRuntimeRoster,
  onRuntimeRemoved,
  onExtensionUi,
  onExtensionError,
  onReconnect,
} = {}) {
  const eventStreamError = ref('')
  const eventStreamErrorRevision = ref(0)
  const eventStreamConnected = ref(false)
  let eventSocket
  let eventSessionId = ''
  let streamOpened = false
  const traceSubscribers = new Set()

  function publishTraceNotice(notice) {
    for (const listener of traceSubscribers) listener(notice)
  }

  function subscribeTraces(listener) {
    traceSubscribers.add(listener)
    return () => traceSubscribers.delete(listener)
  }

  function openEventStream() {
    closeEventStream()
    const params = new URLSearchParams({ sessionId: eventSessionId })
    eventSocket = openEventSocket(`/api/pi/events?${params}`, {
      onEvent: handleEvent,
      onOpen() {
        const reconnected = streamOpened
        streamOpened = true
        eventStreamConnected.value = true
        eventStreamError.value = ''
        if (reconnected) {
          publishTraceNotice({ type: 'reconnect' })
          onReconnect?.()
        }
      },
      onDisconnect() {
        const message = 'Runtime event stream disconnected'
        if (eventStreamError.value !== message) eventStreamErrorRevision.value++
        eventStreamConnected.value = false
        eventStreamError.value = message
        console.warn('pi event stream disconnected')
      },
      onError(error) {
        const message = `Invalid runtime event: ${error.message}`
        eventStreamError.value = message
        eventStreamErrorRevision.value++
      },
    })
  }

  function handleEvent(type, data) {
    if (!data) return
    if (type === 'trace_updated' || type === 'trace_config') {
      publishTraceNotice({ ...data, type, activeSessionId: data.sessionId })
      return
    }
    if (type === 'active_session') {
      onActiveSession?.(data)
    } else if (type === 'runtime_event') {
      if (data.event?.type === 'trace_updated' || data.event?.type === 'trace_config') {
        publishTraceNotice({ ...data.event, activeSessionId: data.event.sessionId })
        return
      }
      onRuntimeEvent?.(data)
    } else if (type === 'runtime_roster') {
      onRuntimeRoster?.(data)
    } else if (type === 'runtime_removed') {
      onRuntimeRemoved?.(data)
    } else if (type === 'extension_ui') {
      onExtensionUi?.(data)
    } else if (type === 'extension_error') {
      onExtensionError?.(data)
    }
  }

  function setEventSessionId(sessionId) {
    const next = String(sessionId || '')
    if (next === eventSessionId) return
    eventSessionId = next
    if (eventSocket) openEventStream()
  }

  function closeEventStream() {
    eventSocket?.close()
    eventSocket = undefined
    eventStreamConnected.value = false
  }

  return {
    closeEventStream,
    eventStreamConnected,
    eventStreamError,
    eventStreamErrorRevision,
    openEventStream,
    setEventSessionId,
    subscribeTraces,
  }
}
