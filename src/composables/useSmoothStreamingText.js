import { computed, onBeforeUnmount, ref, watch } from 'vue'

const minCharsPerSecond = 80
const maxCharsPerSecond = 420
const maxVisualLag = 120
const maxCharsPerFrame = 48

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null

export function useSmoothStreamingText(options) {
  const visibleCount = ref(0)
  const segments = ref(splitText(options.fullText.value || ''))
  let frame = 0
  let lastTime = 0
  let budget = 0

  const visibleText = computed(() => {
    return segments.value.slice(0, visibleCount.value).join('')
  })

  watch(options.streamKey, () => {
    cancelFrame()
    budget = 0
    lastTime = 0
    segments.value = splitText(options.fullText.value || '')
    visibleCount.value = options.isStreaming.value ? 0 : segments.value.length
    scheduleFrame()
  })

  watch(options.fullText, (text, previous) => {
    const nextSegments = splitText(text || '')
    const previousText = previous || ''
    segments.value = nextSegments

    if (!options.isStreaming.value) {
      visibleCount.value = nextSegments.length
      return
    }

    if ((text || '').length < previousText.length) {
      visibleCount.value = 0
      budget = 0
    }

    if (visibleCount.value > nextSegments.length) {
      visibleCount.value = nextSegments.length
    }

    scheduleFrame()
  }, { immediate: true })

  watch(options.isStreaming, (streaming) => {
    if (!streaming) {
      cancelFrame()
      visibleCount.value = segments.value.length
      return
    }

    scheduleFrame()
  }, { immediate: true })

  onBeforeUnmount(cancelFrame)

  function scheduleFrame() {
    if (frame || !options.isStreaming.value) return
    if (visibleCount.value >= segments.value.length) return
    frame = requestAnimationFrame(tick)
  }

  function tick(time) {
    frame = 0
    if (!options.isStreaming.value) {
      visibleCount.value = segments.value.length
      return
    }

    if (!lastTime) lastTime = time
    const elapsed = Math.min(time - lastTime, 100)
    lastTime = time

    const backlog = segments.value.length - visibleCount.value
    if (backlog <= 0) return

    if (backlog > maxVisualLag) {
      visibleCount.value = segments.value.length - maxVisualLag
    }

    const pressure = Math.min(backlog / maxVisualLag, 1)
    const rate = minCharsPerSecond
      + (maxCharsPerSecond - minCharsPerSecond) * pressure
    budget += rate * elapsed / 1000

    const count = Math.min(
      Math.floor(budget),
      maxCharsPerFrame,
      segments.value.length - visibleCount.value,
    )

    if (count > 0) {
      visibleCount.value += count
      budget -= count
    }

    scheduleFrame()
  }

  function cancelFrame() {
    if (!frame) return
    cancelAnimationFrame(frame)
    frame = 0
  }

  return { visibleText }
}

function splitText(text) {
  if (!text) return []
  if (!segmenter) return Array.from(text)
  return Array.from(segmenter.segment(text), (part) => part.segment)
}
