import { computed, ref } from 'vue'

export function useRuntimeEvents({ onActiveSession, onRuntimeEvent } = {}) {
  const runtimeEvents = ref([])
  const eventStreamError = ref('')
  const eventStreamConnected = ref(false)
  const eventLog = computed(() => runtimeEvents.value.slice(-20).reverse())
  let eventSource

  function openEventStream() {
    closeEventStream()
    eventSource = new EventSource('/api/pi/events')

    eventSource.addEventListener('active_session', (event) => {
      const data = JSON.parse(event.data)
      onActiveSession?.(data)
    })

    eventSource.addEventListener('runtime_event', (event) => {
      const data = JSON.parse(event.data)
      appendRuntimeEvent(data)
      onRuntimeEvent?.(data)
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
