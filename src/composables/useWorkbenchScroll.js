import { computed, nextTick, ref, watch } from 'vue'

const bottomStickBufferPx = 160
const maxScrollTravelPx = 480
const scrollAnimationMs = 220
const scrollSettleMs = 900
const userScrollIdleMs = 450

export function useWorkbenchScroll({ workbench, composerRef, isActive = () => true, prepareEntry }) {
  const composerHeight = ref(0)
  const stickToBottom = ref(true)
  const userScrollActive = ref(false)
  const hasNewOutput = ref(false)
  let scrollFrame
  let scrollEventFrame
  let scrollAnimationFrame
  let scrollSettleFrame
  let userScrollTimer
  let composerResizeObserver
  let workbenchResizeObserver
  let workbenchResizeFrame
  let scrollRevision = 0
  let bottomScrollActive = false
  let resizePinActive = false
  let selectedSessionIdRef = null
  let liveItemsRef = null

  const composerReservedHeight = computed(() => {
    return `${Math.max(240, composerHeight.value + 78)}px`
  })

  watch(() => composerRef.value?.form, (el) => {
    observeComposer(el)
  }, { flush: 'post' })

  watch(workbench, (el) => {
    observeWorkbench(el)
  }, { flush: 'post' })

  function bind({ selectedSessionId, liveItems }) {
    selectedSessionIdRef = selectedSessionId
    liveItemsRef = liveItems
  }

  function scheduleBottomScroll() {
    if (!isActive()) return
    cancelAnimationFrame(scrollFrame)
    cancelAnimationFrame(scrollEventFrame)
    scrollEventFrame = undefined
    scrollFrame = requestAnimationFrame(() => {
      scrollToLatest()
    })
  }

  function scheduleLiveScroll(activeSessionId) {
    if (!selectedSessionIdRef || !liveItemsRef) return
    if (activeSessionId !== selectedSessionIdRef.value) return
    if (!liveItemsRef.value.length) return

    if (!isActive() || !stickToBottom.value || userScrollActive.value) {
      hasNewOutput.value = true
      return
    }

    scheduleBottomScroll()
  }

  function observeComposer(el) {
    composerResizeObserver?.disconnect()
    composerResizeObserver = null
    composerHeight.value = 0
    if (!el) return

    measureComposer()
    composerResizeObserver = new ResizeObserver(measureComposer)
    composerResizeObserver.observe(el)
  }

  function measureComposer() {
    const el = composerRef.value?.form
    const nextHeight = el ? Math.ceil(el.getBoundingClientRect().height) : 0
    if (nextHeight === composerHeight.value) return
    composerHeight.value = nextHeight
    if (stickToBottom.value && !userScrollActive.value) scheduleBottomScroll()
  }

  function observeWorkbench(el) {
    workbenchResizeObserver?.disconnect()
    workbenchResizeObserver = null
    cancelAnimationFrame(workbenchResizeFrame)
    if (!el) return

    workbenchResizeObserver = new ResizeObserver(pinWorkbenchAfterResize)
    workbenchResizeObserver.observe(el)
  }

  function pinWorkbenchAfterResize() {
    if (!isActive() || !workbench.value || !stickToBottom.value || userScrollActive.value) return
    cancelAnimationFrame(workbenchResizeFrame)
    resizePinActive = true
    let framesRemaining = 5
    const pin = () => {
      if (!isActive() || !workbench.value
        || !stickToBottom.value
        || userScrollActive.value) {
        resizePinActive = false
        return
      }
      workbench.value.scrollTop = Number.MAX_SAFE_INTEGER
      framesRemaining -= 1
      if (framesRemaining > 0) {
        workbenchResizeFrame = requestAnimationFrame(pin)
      } else {
        resizePinActive = false
      }
    }
    workbenchResizeFrame = requestAnimationFrame(pin)
  }

  function handleWorkbenchScroll() {
    if (!isActive() || !workbench.value) return
    if (bottomScrollActive || resizePinActive) {
      stickToBottom.value = true
      hasNewOutput.value = false
      return
    }
    if (scrollEventFrame) return
    scrollEventFrame = requestAnimationFrame(() => {
      scrollEventFrame = undefined
      if (!isActive() || !workbench.value) return
      if (bottomScrollActive || resizePinActive) {
        stickToBottom.value = true
        hasNewOutput.value = false
        return
      }
      const distance = distanceFromWorkbenchBottom()
      if (distance >= bottomStickBufferPx) stickToBottom.value = false
      else if (!userScrollActive.value) stickToBottom.value = true
      if (stickToBottom.value) hasNewOutput.value = false
    })
  }

  function handleWorkbenchWheel(event) {
    markUserScrolling()
    if (event.deltaY < 0) stickToBottom.value = false
  }

  function handleWorkbenchTouchMove() {
    markUserScrolling()
    stickToBottom.value = false
  }

  function handleWorkbenchPointerDown(event) {
    const rect = workbench.value?.getBoundingClientRect()
    if (!rect || event.clientX < rect.right - 16) return
    markUserScrolling()
  }

  function markUserScrolling() {
    scrollRevision++
    bottomScrollActive = false
    resizePinActive = false
    userScrollActive.value = true
    cancelAnimationFrame(scrollFrame)
    cancelAnimationFrame(scrollEventFrame)
    scrollEventFrame = undefined
    cancelAnimationFrame(scrollAnimationFrame)
    cancelAnimationFrame(scrollSettleFrame)
    cancelAnimationFrame(workbenchResizeFrame)
    clearTimeout(userScrollTimer)
    userScrollTimer = setTimeout(() => {
      userScrollActive.value = false
      if (distanceFromWorkbenchBottom() < bottomStickBufferPx) {
        stickToBottom.value = true
        hasNewOutput.value = false
      }
    }, userScrollIdleMs)
  }

  function distanceFromWorkbenchBottom() {
    if (!workbench.value) return 0
    return workbench.value.scrollHeight
      - workbench.value.scrollTop
      - workbench.value.clientHeight
  }

  function resetWorkbenchScrollState() {
    scrollRevision++
    cancelAnimationFrame(scrollFrame)
    cancelAnimationFrame(scrollEventFrame)
    scrollEventFrame = undefined
    clearTimeout(userScrollTimer)
    cancelAnimationFrame(scrollAnimationFrame)
    cancelAnimationFrame(scrollSettleFrame)
    cancelAnimationFrame(workbenchResizeFrame)
    bottomScrollActive = false
    resizePinActive = false
    userScrollActive.value = false
    stickToBottom.value = true
    hasNewOutput.value = false
  }

  function workbenchBottom() {
    if (!workbench.value) return 0
    return Math.max(0, workbench.value.scrollHeight - workbench.value.clientHeight)
  }

  function setWorkbenchScrollToBottom() {
    if (!workbench.value) return
    cancelAnimationFrame(scrollAnimationFrame)
    bottomScrollActive = true
    const bottom = workbenchBottom()
    const minStart = Math.max(0, bottom - maxScrollTravelPx)
    const start = Math.min(Math.max(workbench.value.scrollTop, minStart), bottom)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
      ?.matches
    workbench.value.scrollTop = start
    if (reduceMotion || bottom === start) {
      workbench.value.scrollTop = bottom
      settleWorkbenchAtBottom()
      return
    }
    const startedAt = performance.now()
    const tick = (now) => {
      if (!isActive() || !workbench.value) return
      const target = workbenchBottom()
      const progress = Math.min(1, (now - startedAt) / scrollAnimationMs)
      const eased = 1 - Math.pow(1 - progress, 3)
      const nextTop = start + (target - start) * eased
      if (Math.abs(workbench.value.scrollTop - nextTop) > 0.5) {
        workbench.value.scrollTop = nextTop
      }
      if (progress < 1) {
        scrollAnimationFrame = requestAnimationFrame(tick)
      } else {
        if (workbench.value.scrollTop !== target) workbench.value.scrollTop = target
        settleWorkbenchAtBottom()
      }
    }
    scrollAnimationFrame = requestAnimationFrame(tick)
  }

  function settleWorkbenchAtBottom() {
    cancelAnimationFrame(scrollSettleFrame)
    bottomScrollActive = true
    const startedAt = performance.now()
    const settle = (now) => {
      if (!isActive() || !workbench.value
        || !stickToBottom.value
        || userScrollActive.value) {
        bottomScrollActive = false
        return
      }
      const bottom = workbenchBottom()
      if (workbench.value.scrollTop !== bottom) workbench.value.scrollTop = bottom
      if (now - startedAt < scrollSettleMs) {
        scrollSettleFrame = requestAnimationFrame(settle)
      } else {
        bottomScrollActive = false
      }
    }
    scrollSettleFrame = requestAnimationFrame(settle)
  }

  async function scrollToLatest() {
    if (!isActive()) {
      markNewOutput()
      return
    }
    resetWorkbenchScrollState()
    const revision = scrollRevision
    await nextTick()
    await new Promise(requestAnimationFrame)
    if (isActive() && revision === scrollRevision) setWorkbenchScrollToBottom()
  }

  function pauseScroll() {
    scrollRevision++
    clearTimeout(userScrollTimer)
    cancelAnimationFrame(scrollFrame)
    cancelAnimationFrame(scrollEventFrame)
    scrollEventFrame = undefined
    cancelAnimationFrame(scrollAnimationFrame)
    cancelAnimationFrame(scrollSettleFrame)
    cancelAnimationFrame(workbenchResizeFrame)
    bottomScrollActive = false
    resizePinActive = false
    userScrollActive.value = false
  }

  function resumeScroll() {
    if (stickToBottom.value) scheduleBottomScroll()
  }

  async function scrollToEntry(entryId, isCurrent = () => true) {
    const sessionId = selectedSessionIdRef?.value
    const ownsNavigation = () => isActive() && isCurrent() && sessionId === selectedSessionIdRef?.value
    await nextTick()
    if (!ownsNavigation()) return false
    prepareEntry?.(entryId)
    await nextTick()
    await new Promise(requestAnimationFrame)
    if (!ownsNavigation()) return false
    const entry = workbench.value?.querySelector(`[data-entry-id="${CSS.escape(String(entryId))}"]`)
    if (!entry) return false
    pauseScroll()
    stickToBottom.value = false
    workbench.value.scrollTop += entry.getBoundingClientRect().top - workbench.value.getBoundingClientRect().top - 20
    entry.setAttribute('tabindex', '-1')
    entry.focus({ preventScroll: true })
    return true
  }

  async function jumpToLatest() {
    await scrollToLatest()
  }

  function shouldFollowOutput() {
    return isActive() && stickToBottom.value
  }

  function markNewOutput() {
    hasNewOutput.value = true
  }

  function dispose() {
    scrollRevision++
    clearTimeout(userScrollTimer)
    composerResizeObserver?.disconnect()
    workbenchResizeObserver?.disconnect()
    cancelAnimationFrame(scrollFrame)
    cancelAnimationFrame(scrollEventFrame)
    scrollEventFrame = undefined
    cancelAnimationFrame(scrollAnimationFrame)
    cancelAnimationFrame(scrollSettleFrame)
    cancelAnimationFrame(workbenchResizeFrame)
  }

  return {
    composerHeight,
    stickToBottom,
    hasNewOutput,
    composerReservedHeight,
    scrollToLatest,
    scrollToEntry,
    pauseScroll,
    resumeScroll,
    jumpToLatest,
    scheduleBottomScroll,
    scheduleLiveScroll,
    handleWorkbenchScroll,
    handleWorkbenchWheel,
    handleWorkbenchTouchMove,
    handleWorkbenchPointerDown,
    resetWorkbenchScrollState,
    shouldFollowOutput,
    markNewOutput,
    bind,
    dispose,
  }
}
