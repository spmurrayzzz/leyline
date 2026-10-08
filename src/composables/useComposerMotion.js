import { computed, onUnmounted, ref, watch } from 'vue'

export function useComposerMotion({
  frame, homeAnchor, dockAnchor, startComposer, sessionComposer,
  workbench, homeVisible, isSessionVisible, onReveal, onFinish,
}) {
  const state = ref(null)
  const homeHeight = ref(164)
  const coverVisible = ref(false)
  const homeStyle = ref({})
  const motionStyle = ref({})
  const style = computed(() => state.value
    ? motionStyle.value
    : homeVisible.value ? homeStyle.value : {})
  const timers = new Set()
  let token = null
  let runtimeReady = false
  let revealAllowed = false
  let reducedMotion = false
  let glideEnd = 0
  let heightEnd = 0
  let glideAnimation
  let heightAnimation
  let observer
  let measureFrame
  let disposed = false

  function isCurrent(candidate) {
    return candidate != null && candidate === token
  }

  function later(callback, duration) {
    const current = token
    const timer = setTimeout(() => {
      timers.delete(timer)
      if (isCurrent(current)) callback()
    }, reducedMotion ? 0 : duration)
    timers.add(timer)
  }

  function position(rect) {
    const pane = frame.value.parentElement
    const bounds = pane.getBoundingClientRect()
    return {
      position: 'absolute',
      boxSizing: 'border-box',
      left: `${rect.left - bounds.left - pane.clientLeft + pane.scrollLeft}px`,
      bottom: `${bounds.top + pane.clientTop + pane.clientHeight - rect.bottom - pane.scrollTop}px`,
      top: 'auto',
      right: 'auto',
      width: `${rect.width}px`,
      maxWidth: 'none',
      transform: 'none',
      transition: 'none',
    }
  }

  function formHeight(form) {
    const css = getComputedStyle(frame.value)
    return form.offsetHeight
      + (parseFloat(css.borderTopWidth) || 0)
      + (parseFloat(css.borderBottomWidth) || 0)
  }

  function measureHome() {
    const anchor = homeAnchor.value
    const form = startComposer.value?.form
    if (!homeVisible.value || !anchor || !form || !frame.value) return
    const height = formHeight(form)
    if (homeHeight.value !== height) {
      homeHeight.value = height
      scheduleMeasure()
      return
    }
    const rect = anchor.getBoundingClientRect()
    const pane = frame.value.parentElement
    const bounds = pane.getBoundingClientRect()
    homeStyle.value = {
      ...position(rect),
      top: `${rect.top - bounds.top - pane.clientTop + pane.scrollTop}px`,
      bottom: 'auto',
    }
  }

  function retargetGlide() {
    if (!frame.value || !dockAnchor.value) return
    const target = dockAnchor.value.getBoundingClientRect()
    const next = position(target)
    if (['left', 'bottom', 'width'].every(key => next[key] === motionStyle.value[key])) return
    const source = frame.value.getBoundingClientRect()
    glideAnimation?.cancel()
    motionStyle.value = { ...next, height: motionStyle.value.height }
    const duration = reducedMotion ? 0 : Math.max(0, glideEnd - performance.now())
    if (!duration) return
    const easing = getComputedStyle(frame.value).getPropertyValue('--ease-dock').trim() || 'ease'
    glideAnimation = frame.value.animate([
      {
        transform: `translate(${source.left - target.left}px, ${source.bottom - target.bottom}px)`,
        width: `${source.width}px`,
      },
      { transform: 'none', width: next.width },
    ], { duration, easing })
  }

  function retargetHeight() {
    const form = sessionComposer.value?.form
    if (!form || !frame.value) return
    const height = `${formHeight(form)}px`
    if (height === motionStyle.value.height) return
    const source = frame.value.getBoundingClientRect().height
    heightAnimation?.cancel()
    motionStyle.value = { ...motionStyle.value, height }
    const duration = reducedMotion ? 0 : Math.max(0, heightEnd - performance.now())
    if (duration) {
      heightAnimation = frame.value.animate([
        { height: `${source}px` },
        { height },
      ], { duration, easing: 'ease-in-out' })
    }
  }

  function reveal() {
    if (!state.value || state.value.phase !== 'docking'
      || !runtimeReady || !revealAllowed || !sessionComposer.value?.form) return
    const current = token
    const kind = state.value.kind
    state.value = { kind, phase: 'revealing' }
    heightEnd = performance.now() + (reducedMotion ? 0 : 420)
    retargetHeight()
    onReveal?.(kind)
    if (!isCurrent(current)) return
    later(() => { coverVisible.value = false }, 420)
    later(() => {
      cancel()
      onFinish?.(kind)
    }, 640)
  }

  function startGlide() {
    if (glideEnd || !frame.value || !dockAnchor.value) return
    glideEnd = performance.now() + (reducedMotion ? 0 : 900)
    retargetGlide()
    later(() => {
      revealAllowed = true
      reveal()
    }, 630)
  }

  function measure() {
    if (disposed) return
    if (!state.value) {
      measureHome()
    } else {
      if (isSessionVisible()) {
        if (!heightEnd) heightEnd = performance.now() + (reducedMotion ? 0 : 420)
        retargetHeight()
      }
      if (state.value.phase !== 'lead') {
        if (!glideEnd) startGlide()
        else retargetGlide()
        if (state.value.phase === 'revealing') retargetHeight()
        else reveal()
      }
    }
  }

  function scheduleMeasure() {
    if (disposed || measureFrame != null) return
    measureFrame = requestAnimationFrame(() => {
      measureFrame = null
      measure()
    })
  }

  function observe() {
    observer?.disconnect()
    observer = null
    if (disposed || (!state.value && !homeVisible.value)) return
    observer = new ResizeObserver(scheduleMeasure)
    const elements = new Set([
      frame.value?.parentElement, homeAnchor.value,
      workbench.value, startComposer.value?.form,
      state.value && dockAnchor.value,
      state.value && sessionComposer.value?.form,
    ])
    for (const element of elements) {
      if (element) observer.observe(element)
    }
    measure()
  }

  function begin(kind) {
    const source = frame.value?.getBoundingClientRect()
    cancel()
    token = Symbol(kind)
    reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    motionStyle.value = source ? { ...position(source), height: `${source.height}px` } : {}
    state.value = { kind, phase: 'lead' }
    coverVisible.value = true
    observe()
    later(() => {
      state.value = { kind, phase: 'docking' }
      startGlide()
    }, 160)
    return token
  }

  function ready(candidate) {
    if (!isCurrent(candidate)) return
    runtimeReady = true
    reveal()
  }

  function cancel() {
    token = null
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    cancelAnimationFrame(measureFrame)
    measureFrame = null
    observer?.disconnect()
    glideAnimation?.cancel()
    heightAnimation?.cancel()
    glideAnimation = heightAnimation = null
    runtimeReady = revealAllowed = false
    glideEnd = heightEnd = 0
    state.value = null
    coverVisible.value = false
    motionStyle.value = {}
    observe()
  }

  watch([
    frame, homeAnchor, dockAnchor, workbench, homeVisible,
    () => startComposer.value?.form,
    () => sessionComposer.value?.form,
    () => state.value && isSessionVisible(),
  ], observe, { flush: 'post', immediate: true })

  onUnmounted(() => {
    disposed = true
    cancel()
  })

  return { state, style, homeHeight, coverVisible, begin, ready, cancel, isCurrent }
}
