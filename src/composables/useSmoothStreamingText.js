import { onBeforeUnmount, ref, watch } from 'vue'

const minCharsPerSecond = 80
const maxCharsPerSecond = 420
const maxVisualLag = 120
const maxCharsPerFrame = 48

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null

export function useSmoothStreamingText(options) {
  const initialText = options.fullText.value || ''
  const visibleText = ref(options.isStreaming.value ? '' : initialText)
  let sourceText = initialText
  let segments = splitText(initialText)
  let visibleCount = options.isStreaming.value ? 0 : segments.length
  let frame = 0
  let lastTime = 0
  let budget = 0

  watch(options.streamKey, () => {
    resetText(options.fullText.value || '')
  })

  watch(options.fullText, (value) => {
    const text = value || ''
    const previousText = sourceText
    sourceText = text

    if (text.startsWith(previousText)) {
      appendSegments(text.slice(previousText.length))
    } else {
      replaceSegments(text, text.length < previousText.length)
    }

    if (!options.isStreaming.value) {
      visibleCount = segments.length
      visibleText.value = text
      return
    }

    scheduleFrame()
  }, { immediate: true })

  watch(options.isStreaming, (streaming) => {
    if (!streaming) {
      cancelFrame()
      visibleCount = segments.length
      visibleText.value = sourceText
      return
    }

    scheduleFrame()
  }, { immediate: true })

  onBeforeUnmount(cancelFrame)

  function resetText(text) {
    cancelFrame()
    sourceText = text
    segments = splitText(text)
    budget = 0
    lastTime = 0
    visibleCount = options.isStreaming.value ? 0 : segments.length
    visibleText.value = options.isStreaming.value ? '' : text
    scheduleFrame()
  }

  function appendSegments(text) {
    if (!text) return
    if (!segments.length) {
      segments = splitText(text)
      return
    }

    const previousLast = segments[segments.length - 1]
    const tailSegments = splitText(previousLast + text)
    if (tailSegments[0] === previousLast) {
      for (let index = 1; index < tailSegments.length; index++) {
        segments.push(tailSegments[index])
      }
      return
    }

    const replaceIndex = segments.length - 1
    segments.length = replaceIndex
    for (const segment of tailSegments) segments.push(segment)
    if (visibleCount > replaceIndex) {
      visibleCount = replaceIndex
      visibleText.value = visibleText.value.slice(0, -previousLast.length)
    }
  }

  function replaceSegments(text, resetVisible) {
    segments = splitText(text)
    if (resetVisible) {
      visibleCount = 0
      visibleText.value = ''
      budget = 0
      return
    }

    visibleCount = Math.min(visibleCount, segments.length)
    visibleText.value = segments.slice(0, visibleCount).join('')
  }

  function scheduleFrame() {
    if (frame || !options.isStreaming.value) return
    if (visibleCount >= segments.length) return
    frame = requestAnimationFrame(tick)
  }

  function tick(time) {
    frame = 0
    if (!options.isStreaming.value) {
      visibleCount = segments.length
      visibleText.value = sourceText
      return
    }

    if (!lastTime) lastTime = time
    const elapsed = Math.min(time - lastTime, 100)
    lastTime = time

    let backlog = segments.length - visibleCount
    if (backlog <= 0) return

    if (backlog > maxVisualLag) {
      appendVisibleText(segments.length - maxVisualLag)
      backlog = segments.length - visibleCount
    }

    const pressure = Math.min(backlog / maxVisualLag, 1)
    const rate = minCharsPerSecond
      + (maxCharsPerSecond - minCharsPerSecond) * pressure
    budget += rate * elapsed / 1000

    const count = Math.min(
      Math.floor(budget),
      maxCharsPerFrame,
      segments.length - visibleCount,
    )

    if (count > 0) {
      appendVisibleText(visibleCount + count)
      budget -= count
    }

    scheduleFrame()
  }

  function appendVisibleText(end) {
    const nextCount = Math.min(end, segments.length)
    if (nextCount <= visibleCount) return
    visibleText.value += segments.slice(visibleCount, nextCount).join('')
    visibleCount = nextCount
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
