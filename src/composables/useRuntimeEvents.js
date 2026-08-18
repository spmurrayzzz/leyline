import { computed, ref } from 'vue'
import { backendHttpUrl } from '../lib/backend'

const transientRuntimeEventTypes = new Set([
  'message_update',
  'tool_execution_update',
])

export function useRuntimeEvents({
  onActiveSession,
  onRuntimeEvent,
  onExtensionUi,
  onExtensionError,
} = {}) {
  const runtimeEvents = ref([])
  const eventStreamError = ref('')
  const eventStreamConnected = ref(false)
  const eventLog = computed(() =>
    [...runtimeEvents.value]
      .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))
      .slice(0, 20),
  )
  let eventSource

  function openEventStream() {
    closeEventStream()
    eventSource = new EventSource(backendHttpUrl('/api/pi/events'))

    eventSource.addEventListener('active_session', (event) => {
      const data = parseEvent(event, 'active session')
      if (data) onActiveSession?.(data)
    })

    eventSource.addEventListener('runtime_event', (event) => {
      const data = parseEvent(event, 'runtime')
      if (!data) return
      if (!transientRuntimeEventTypes.has(data.event?.type)) {
        appendRuntimeEvent(data)
      }
      onRuntimeEvent?.(data)
    })

    eventSource.addEventListener('extension_ui', (event) => {
      const data = parseEvent(event, 'extension UI')
      if (!data) return
      appendRuntimeEvent({ ...data, type: 'extension_ui' })
      onExtensionUi?.(data)
    })

    eventSource.addEventListener('extension_error', (event) => {
      const data = parseEvent(event, 'extension error')
      if (!data) return
      appendRuntimeEvent({ ...data, type: 'extension_error' })
      onExtensionError?.(data)
    })

    eventSource.onopen = () => {
      eventStreamConnected.value = true
      eventStreamError.value = ''
      appendRuntimeEvent({ type: 'connected' })
    }

    eventSource.onerror = () => {
      eventStreamConnected.value = false
      eventStreamError.value = 'Runtime event stream disconnected'
      appendRuntimeEvent({ type: 'disconnected' })
      console.warn('pi event stream disconnected')
    }
  }

  function parseEvent(event, label) {
    try {
      return JSON.parse(event.data)
    } catch (error) {
      const message = `Invalid ${label} event: ${error.message}`
      eventStreamError.value = message
      appendRuntimeEvent({ type: 'error', message })
      return null
    }
  }

  function closeEventStream() {
    eventSource?.close()
    eventSource = undefined
  }

  function appendRuntimeEvent(event) {
    runtimeEvents.value = [
      ...runtimeEvents.value.slice(-99),
      { ...event, loggedAt: new Date().toISOString() },
    ]
  }

  return {
    appendRuntimeEvent,
    closeEventStream,
    eventLog,
    eventStreamConnected,
    eventStreamError,
    openEventStream,
    runtimeEvents,
  }
}
