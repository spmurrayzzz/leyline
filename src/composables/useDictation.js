import { computed, onBeforeUnmount, ref } from 'vue'

function recognitionConstructor() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function dictationErrorMessage(error) {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Dictation permission was denied'
  }
  if (error === 'no-speech') return 'Dictation did not hear speech'
  if (error === 'audio-capture') return 'No microphone was found'
  if (error === 'network') return 'Dictation network error'
  return 'Dictation stopped'
}

export function useDictation(options) {
  const listening = ref(false)
  const error = ref('')
  const supported = computed(() => Boolean(recognitionConstructor()))
  let recognition = null
  let stopping = false

  function appendText(text) {
    const cleaned = text.trim()
    if (!cleaned) return

    const draft = options.getDraft()
    const separator = draft && !/\s$/.test(draft) ? ' ' : ''
    options.setDraft(`${draft}${separator}${cleaned}`)
    options.onDraftChange?.()
  }

  function buildRecognition() {
    const Recognition = recognitionConstructor()
    if (!Recognition) return null

    const instance = new Recognition()
    instance.continuous = true
    instance.interimResults = false
    instance.lang = typeof navigator === 'undefined'
      ? 'en-US'
      : navigator.language || 'en-US'
    instance.onresult = (event) => {
      let text = ''
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index++
      ) {
        const result = event.results[index]
        if (!result.isFinal) continue
        const transcript = result[0]?.transcript || ''
        text = `${text} ${transcript}`
      }
      appendText(text)
    }
    instance.onerror = (event) => {
      if (stopping && event.error === 'aborted') return
      error.value = dictationErrorMessage(event.error)
    }
    instance.onend = () => {
      listening.value = false
      recognition = null
      stopping = false
    }
    return instance
  }

  function startDictation() {
    if (!supported.value || listening.value) return

    error.value = ''
    stopping = false
    recognition = buildRecognition()
    if (!recognition) return

    try {
      recognition.start()
      listening.value = true
      options.focus?.()
    } catch {
      recognition = null
      listening.value = false
      error.value = 'Dictation could not start'
    }
  }

  function stopDictation() {
    if (!recognition) {
      listening.value = false
      stopping = false
      return
    }

    stopping = true
    try {
      recognition.stop()
    } catch {
      recognition = null
      listening.value = false
      stopping = false
    }
  }

  function toggleDictation() {
    if (listening.value) {
      stopDictation()
      return
    }
    startDictation()
  }

  onBeforeUnmount(stopDictation)

  return {
    dictationError: error,
    dictationListening: listening,
    dictationSupported: supported,
    stopDictation,
    toggleDictation,
  }
}
