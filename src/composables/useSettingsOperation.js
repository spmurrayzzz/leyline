import { computed, onBeforeUnmount, ref } from 'vue'
import {
  answerSettingsOperation,
  cancelSettingsOperation,
  fetchSettingsOperation,
  settingsApiBase,
} from '../lib/pi-settings-api'

export function useSettingsOperation({ onComplete } = {}) {
  const operation = ref(null)
  const error = ref('')
  const starting = ref(false)
  const busy = computed(() => starting.value || ['running', 'cancelling'].includes(operation.value?.state))
  let generation = 0
  let sequence = 0
  let timer
  let baseUrl
  let controller

  async function accept(value, token, requestSequence) {
    if (token !== generation || requestSequence !== sequence) return
    clearTimeout(timer)
    operation.value = value
    if (['running', 'cancelling'].includes(value.state)) {
      timer = setTimeout(() => poll(token), 500)
    } else if (value.state === 'completed') {
      await onComplete?.(value.result)
    }
  }

  async function poll(token) {
    if (token !== generation || !operation.value?.id) return
    const requestSequence = ++sequence
    const signal = controller.signal
    try {
      const value = await fetchSettingsOperation(operation.value.id, baseUrl, signal)
      if (token === generation && requestSequence === sequence) error.value = ''
      await accept(value, token, requestSequence)
    } catch (failure) {
      if (token !== generation || requestSequence !== sequence || signal.aborted) return
      error.value = failure.message
      if (failure.status === 404) {
        operation.value = { ...operation.value, state: 'error', error: failure.message }
      } else {
        timer = setTimeout(() => poll(token), 2000)
      }
    }
  }

  async function start(request) {
    if (busy.value) return
    clear()
    const token = generation
    const requestSequence = ++sequence
    const requestBase = settingsApiBase()
    baseUrl = requestBase
    controller = new AbortController()
    starting.value = true
    try {
      const value = await request(requestBase)
      if (token !== generation) {
        void cancelSettingsOperation(value.id, requestBase).catch(() => {})
        return
      }
      await accept(value, token, requestSequence)
    } catch (failure) {
      if (token === generation) error.value = failure.message
    } finally {
      if (token === generation) starting.value = false
    }
  }

  async function answer({ promptId, value }) {
    if (!operation.value?.id || operation.value.state !== 'running') return
    const token = generation
    const requestSequence = ++sequence
    error.value = ''
    clearTimeout(timer)
    try {
      const next = await answerSettingsOperation(operation.value.id, { promptId, value }, baseUrl)
      await accept(next, token, requestSequence)
    } catch (failure) {
      if (token !== generation || requestSequence !== sequence) return
      error.value = failure.message
      timer = setTimeout(() => poll(token), 500)
    }
  }

  async function cancel() {
    if (!operation.value?.id) return clear()
    const token = generation
    const requestSequence = ++sequence
    clearTimeout(timer)
    try {
      const next = await cancelSettingsOperation(operation.value.id, baseUrl)
      await accept(next, token, requestSequence)
    } catch (failure) {
      if (token === generation && requestSequence === sequence) {
        error.value = failure.message
        timer = setTimeout(() => poll(token), 2000)
      }
    }
  }

  function clear() {
    const current = operation.value
    const previousBase = baseUrl
    generation += 1
    clearTimeout(timer)
    controller?.abort()
    if (current?.id && ['running', 'cancelling'].includes(current.state)) {
      void cancelSettingsOperation(current.id, previousBase).catch(() => {})
    }
    operation.value = null
    starting.value = false
    error.value = ''
  }

  onBeforeUnmount(clear)
  return { operation, busy, error, start, answer, cancel, clear }
}
