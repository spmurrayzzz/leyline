import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'

const overscanTopPx = 600
const overscanBottomPx = 1800
const tailRows = 24
const defaultEstimatePx = 180
const revealHoldMs = 1200

export function useTranscriptWindow({ container, items, follow }) {
  const scrollTop = ref(0)
  const viewportHeight = ref(0)
  const metrics = ref(new Map())
  const forcedId = ref('')
  const categories = new Map()
  const observedRows = new Set()
  const resizedRows = new Set()
  let marginsDirty = true
  let scrollFrame = 0
  let measureFrame = 0
  let measuring = false
  let revealTimer = 0
  let containerObserver
  let rowObserver
  let childObserver

  function categoryFor(item) {
    if (!item) return undefined
    return categories.get(item.role || item.type)
  }

  function boxFor(item, measured) {
    return measured.get(item.id) || categoryFor(item)
  }

  const layout = computed(() => {
    const list = items.value
    const measured = metrics.value
    let knownSum = 0
    for (const entry of measured.values()) knownSum += entry.height
    const estimate = measured.size ? knownSum / measured.size : defaultEstimatePx
    const offsets = new Array(list.length + 1)
    offsets[0] = 0
    for (let index = 0; index < list.length; index++) {
      const item = list[index]
      const own = measured.get(item.id)
      const height = own ? own.height : estimate
      const bottom = boxFor(item, measured)?.marginBottom ?? 0
      const next = list[index + 1]
      const nextTop = next ? boxFor(next, measured)?.marginTop ?? 0 : 0
      offsets[index + 1] = offsets[index] + height + Math.max(bottom, nextTop)
    }
    return { offsets, total: offsets[list.length] }
  })

  const visible = computed(() => {
    const list = items.value
    const { offsets, total } = layout.value
    if (!list.length) return { start: 0, end: 0, topPad: 0, bottomPad: 0, rows: [] }

    const measured = metrics.value
    const forcedIndex = forcedId.value
      ? list.findIndex(item => item.id === forcedId.value)
      : -1
    const viewport = viewportHeight.value || 800
    let start
    let end

    if (forcedIndex >= 0) {
      start = Math.max(0, forcedIndex - 1)
      end = Math.min(list.length, offsetIndexAt(offsets, offsets[forcedIndex] + viewport + overscanBottomPx) + 2)
    } else if (follow.value) {
      end = list.length
      start = Math.max(0, end - tailRows)
    } else {
      const top = Math.max(0, scrollTop.value - overscanTopPx)
      const bottom = scrollTop.value + viewport + overscanBottomPx
      start = Math.max(0, offsetIndexAt(offsets, top) - 1)
      end = Math.min(list.length, offsetIndexAt(offsets, bottom) + 4)
      if (end <= start) end = Math.min(list.length, start + 1)
    }

    const rows = []
    for (let index = start; index < end; index++) {
      rows.push({ item: list[index], index })
    }

    const startTop = boxFor(list[start], measured)?.marginTop ?? 0
    const lastBox = boxFor(list[end - 1], measured)
    const lastBottom = lastBox?.marginBottom ?? 0
    const nextTop = list[end] ? boxFor(list[end], measured)?.marginTop ?? 0 : 0
    const gapAfterEnd = Math.max(lastBottom, nextTop)

    return {
      start,
      end,
      topPad: Math.max(0, Math.round(offsets[start] - startTop)),
      bottomPad: Math.max(0, Math.round(total - offsets[end] + gapAfterEnd - lastBottom)),
      rows,
    }
  })

  function offsetIndexAt(offsets, value) {
    let low = 0
    let high = offsets.length - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (offsets[mid] <= value) low = mid
      else high = mid - 1
    }
    return low
  }

  function scheduleScrollRead() {
    if (scrollFrame) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0
      const el = container.value
      if (!el) return
      scrollTop.value = el.scrollTop
      viewportHeight.value = el.clientHeight
    })
  }

  function scheduleMeasure() {
    if (measureFrame) return
    measureFrame = requestAnimationFrame(() => {
      measureFrame = 0
      measure()
    })
  }

  function syncObservedRows(nodes) {
    if (!rowObserver) return
    for (const node of observedRows) {
      if (nodes.includes(node)) continue
      rowObserver.unobserve(node)
      observedRows.delete(node)
    }
    for (const node of nodes) {
      if (observedRows.has(node)) continue
      rowObserver.observe(node)
      observedRows.add(node)
    }
  }

  function measure() {
    const el = container.value
    if (!el || measuring) return
    measuring = true
    const nodes = [...el.querySelectorAll(':scope > [data-entry-id]')]
    const indexById = new Map(visible.value.rows.map(row => [row.item.id, row.index]))
    const current = metrics.value
    const before = layout.value.offsets
    const next = new Map(current)
    const scrollPosition = el.scrollTop
    let changed = false
    let anchorIndex = -1

    for (const node of nodes) {
      const id = node.dataset.entryId
      if (!id) continue
      const index = indexById.get(id)
      if (index === undefined) continue
      const item = items.value[index]
      const previous = current.get(id)
      if (anchorIndex < 0 && (before[index + 1] ?? 0) > scrollPosition) anchorIndex = index
      const needsMargins = marginsDirty || !previous || !observedRows.has(node)
      const needsHeight = resizedRows.has(id) || !previous
      if (!needsMargins && !needsHeight) continue

      let marginTop = previous?.marginTop
      let marginBottom = previous?.marginBottom
      if (needsMargins) {
        const style = getComputedStyle(node)
        marginTop = parseFloat(style.marginTop || '0') || 0
        marginBottom = parseFloat(style.marginBottom || '0') || 0
        categories.set(item?.role || item?.type, { marginTop, marginBottom })
      }
      let height = previous?.height
      if (needsHeight) height = node.offsetHeight
      if (!(height > 0)) continue
      if (previous
        && previous.height === height
        && previous.marginTop === marginTop
        && previous.marginBottom === marginBottom) continue
      next.set(id, { height, marginTop, marginBottom })
      changed = true
    }

    syncObservedRows(nodes)
    resizedRows.clear()
    marginsDirty = false

    if (changed) {
      metrics.value = next
      if (anchorIndex >= 0 && !follow.value) {
        const after = layout.value.offsets
        const delta = after[anchorIndex] - before[anchorIndex]
        if (delta !== 0) {
          const target = scrollPosition + delta
          nextTick(() => {
            if (container.value) container.value.scrollTop = target
          })
        }
      }
    }
    measuring = false
  }

  function revealEntry(id) {
    clearTimeout(revealTimer)
    forcedId.value = id || ''
    revealTimer = setTimeout(clearReveal, revealHoldMs)
    return nextTick()
  }

  function clearReveal() {
    clearTimeout(revealTimer)
    forcedId.value = ''
  }

  function reset() {
    clearReveal()
    metrics.value = new Map()
    categories.clear()
    resizedRows.clear()
    marginsDirty = true
    scrollTop.value = 0
    viewportHeight.value = 0
    if (scrollFrame) cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
    if (measureFrame) cancelAnimationFrame(measureFrame)
    measureFrame = 0
    scheduleMeasure()
  }

  watch(container, (el, previous) => {
    if (previous) {
      previous.removeEventListener('scroll', scheduleScrollRead)
      containerObserver?.unobserve(previous)
      childObserver?.disconnect()
    }
    if (!el) return
    el.addEventListener('scroll', scheduleScrollRead, { passive: true })
    containerObserver ||= new ResizeObserver(() => {
      marginsDirty = true
      scheduleScrollRead()
      scheduleMeasure()
    })
    rowObserver ||= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.dataset.entryId
        if (id) resizedRows.add(id)
      }
      scheduleMeasure()
    })
    childObserver ||= new MutationObserver(scheduleMeasure)
    containerObserver.observe(el)
    childObserver.observe(el, { childList: true })
    scheduleScrollRead()
    scheduleMeasure()
  }, { flush: 'post' })

  watch(() => {
    const { start, end } = visible.value
    return `${start}:${end}`
  }, scheduleMeasure, { flush: 'post' })

  watch(follow, scheduleMeasure, { flush: 'post' })

  onScopeDispose(() => {
    clearTimeout(revealTimer)
    cancelAnimationFrame(scrollFrame)
    cancelAnimationFrame(measureFrame)
    containerObserver?.disconnect()
    rowObserver?.disconnect()
    childObserver?.disconnect()
    observedRows.clear()
    container.value?.removeEventListener('scroll', scheduleScrollRead)
  })

  return {
    topPad: computed(() => visible.value.topPad),
    bottomPad: computed(() => visible.value.bottomPad),
    rows: computed(() => visible.value.rows),
    clearReveal,
    reset,
    revealEntry,
    measure,
  }
}
