import { computed, ref } from 'vue'
import { toolLabel } from '../lib/format'
import {
  imageBlocksFor,
  messageBlocks,
  skillSummaries,
  textFromBlocks,
} from '../lib/transcript'

export function useLiveTurnProjection({ onIntent } = {}) {
  const selectedSessionId = ref('')
  const persistedDetail = ref(null)
  const optimisticEntries = ref([])
  const agentRunning = ref(false)
  const compactingContext = ref(false)
  const liveActivity = ref('')
  const liveAssistantText = ref('')
  const liveAssistantBlocks = ref([])
  const liveAssistantMessages = ref([])
  const liveUserMessages = ref([])
  const liveTools = ref([])
  const rawEntries = computed(() => [
    ...(persistedDetail.value?.entries || []),
    ...optimisticEntries.value,
  ])
  const liveItems = computed(() => [
    ...liveAssistantMessages.value,
    ...liveUserMessages.value,
    ...liveTools.value,
    compactingContext.value ? {
      id: 'live-compaction',
      seq: Number.MAX_SAFE_INTEGER - 1,
      type: 'activity',
      text: 'Working…',
    } : null,
    liveActivity.value ? {
      id: 'live-activity',
      seq: Number.MAX_SAFE_INTEGER,
      type: 'activity',
      text: liveActivity.value,
    } : null,
  ].filter(Boolean).sort((a, b) => a.seq - b.seq))
  const liveTurnActive = computed(() => {
    return agentRunning.value
      || compactingContext.value
      || liveTools.value.length > 0
      || liveAssistantMessages.value.length > 0
      || liveUserMessages.value.length > 0
      || Boolean(liveActivity.value)
  })
  const entries = computed(() => {
    let list = rawEntries.value
    if (liveTurnActive.value && liveTurnAnchorLength !== null) {
      list = list.slice(0, liveTurnAnchorLength)
    }

    return list.filter((entry) => {
      return isRenderableEntry(entry)
        && !isCoveredByLiveTool(entry)
        && !isCoveredByLiveAssistant(entry)
        && !isCoveredByLiveUser(entry)
    })
  })
  const liveToolSettleTimers = new Map()
  const liveToolVisualFloorMs = 450
  let liveToolSeq = 0
  let liveItemSeq = 0
  let liveTurnAnchorLength = null
  let activeLiveAssistantId = ''
  let pendingAssistantEvent
  let liveAssistantFrame

  function handle(input) {
    if (input.kind === 'runtime') handleRuntimeEvent(input)
  }

  function handleRuntimeEvent({ activeSessionId, event }) {
    emit({ type: 'refresh-session', activeSessionId, event })
    if (activeSessionId !== selectedSessionId.value) return

    markLiveTurnStart(event)
    updateCompactionState(event)
    agentRunning.value = isRunningEvent(event)
    liveActivity.value = activityText(event)
    updateLiveTool(event)
    updateLiveUser(event)
    updateLiveAssistant(event)
    releaseLiveAnchorIfSettled()
    emit({ type: 'runtime-queue', event })
    surfaceRuntimeError(event)
    if (hasLiveOutput()) emit({ type: 'scroll-live', activeSessionId })
  }

  function selectSession(id) {
    selectedSessionId.value = id || ''
    reset()
  }

  function clearSession() {
    selectedSessionId.value = ''
    persistedDetail.value = null
    reset()
  }

  function setPersistedDetail(detail) {
    persistedDetail.value = detail
    if (!detail) return
    reconcileOptimisticEntries(detail)
    reconcileLiveUsers(detail)
    reconcileLiveAssistants(detail)
    reconcileLiveTools(detail)
    releaseLiveAnchorIfSettled()
  }

  function beginUserTurn(text, images = []) {
    activeLiveAssistantId = ''
    clearLiveToolSettleTimers()
    const entry = pendingUserEntry(text, images)
    optimisticEntries.value = [...optimisticEntries.value, entry]
    if (hasLiveTranscriptOutput()) {
      liveUserMessages.value = [
        ...liveUserMessages.value,
        { ...entry, seq: ++liveItemSeq },
      ]
    }
    liveTurnAnchorLength = rawEntries.value.length
    return entry
  }

  function removeOptimisticEntry(entry) {
    optimisticEntries.value = optimisticEntries.value.filter((item) => {
      return item.id !== entry?.id
    })
    liveUserMessages.value = liveUserMessages.value.filter((item) => {
      return item.id !== entry?.id
    })
  }

  function reconcileCurrentDetail() {
    if (persistedDetail.value) reconcileOptimisticEntries(persistedDetail.value)
  }

  function clearLiveOutput() {
    liveAssistantMessages.value = []
    liveUserMessages.value = []
    liveTools.value = []
    activeLiveAssistantId = ''
    clearLiveToolSettleTimers()
  }

  function setAgentRunning(value, activity = '') {
    agentRunning.value = value
    liveActivity.value = activity
  }

  function setActivity(text) {
    liveActivity.value = text || ''
  }

  function setRuntimeState(state) {
    if (!state) return
    compactingContext.value = state.isCompacting === true
    agentRunning.value = state.isStreaming === true
    if (!agentRunning.value && !compactingContext.value) return
    if (liveActivity.value || liveAssistantMessages.value.length) return
    liveActivity.value = 'Working…'
  }

  function addTool(event, status) {
    upsertLiveTool(event, status)
  }

  function finishTools(status) {
    finishLiveTools(status)
  }

  function reset() {
    liveTurnAnchorLength = null
    compactingContext.value = false
    liveActivity.value = ''
    liveAssistantText.value = ''
    liveAssistantBlocks.value = []
    liveAssistantMessages.value = []
    liveUserMessages.value = []
    liveTools.value = []
    optimisticEntries.value = []
    agentRunning.value = false
    activeLiveAssistantId = ''
    pendingAssistantEvent = undefined
    clearLiveToolSettleTimers()
    cancelAnimationFrame(liveAssistantFrame)
  }

  function dispose() {
    reset()
  }

  function markLiveTurnStart(event) {
    if (!startsLiveTurn(event)) return
    if (liveTurnAnchorLength !== null) return
    liveTurnAnchorLength = rawEntries.value.length
  }

  function startsLiveTurn(event) {
    const type = event?.type
    if (type === 'agent_start' || type === 'turn_start') return true
    return ['message_start', 'message_update', 'message_end'].includes(type)
      && event.message?.role === 'assistant'
  }

  function updateCompactionState(event) {
    if (event?.type === 'compaction_start') compactingContext.value = true
    if (event?.type === 'compaction_end') compactingContext.value = false
  }

  function isRunningEvent(event) {
    const type = event?.type || ''
    if (['agent_start', 'message_start', 'tool_call'].includes(type)) return true
    if (type === 'tool_execution_start') return true
    if (['agent_end', 'error', 'aborted'].includes(type)) return false
    return agentRunning.value
  }

  function activityText(event) {
    const type = event?.type || ''
    if (type === 'agent_end' || type === 'error' || type === 'aborted') return ''
    if (type === 'compaction_end') return ''
    if (agentRunning.value || compactingContext.value) return 'Working…'
    return liveActivity.value
  }

  function surfaceRuntimeError(event) {
    if (event?.type === 'compaction_end' && event.errorMessage) {
      emit({ type: 'surface-error', message: event.errorMessage })
      return
    }
    if (event?.type !== 'error') return
    emit({
      type: 'surface-error',
      message: event.error?.message || event.message || 'Runtime error',
    })
  }

  function updateLiveTool(event) {
    const type = event?.type || ''

    if (type === 'tool_call') {
      upsertLiveTool(event, 'preparing')
      return
    }

    if (type === 'tool_execution_start') {
      upsertLiveTool(event, 'running')
      return
    }

    if (type === 'tool_execution_end') {
      upsertLiveTool(event, event.error || event.isError ? 'error' : 'reading')
      return
    }

    if (type === 'agent_end') finishLiveTools('completed')
    if (type === 'error') finishLiveTools('error')
    if (type === 'aborted') finishLiveTools('aborted')
  }

  function upsertLiveTool(event, status) {
    const key = liveToolKey(event)
    const existing = findLiveTool(event, key)
    const id = existing?.id || key || `live-tool-${++liveToolSeq}`
    const now = Date.now()
    const next = {
      id,
      seq: existing?.seq || ++liveItemSeq,
      type: 'tool',
      toolCallId: event.toolCallId || event.id || event.callId || '',
      toolName: event.toolName || 'tool',
      label: toolLabel(event.toolName),
      code: liveToolCode(event) || existing?.code || '',
      status,
      startedAt: existing?.startedAt || now,
    }

    if (existing) {
      liveTools.value = liveTools.value.map((tool) => {
        return tool.id === existing.id ? { ...tool, ...next } : tool
      })
      return
    }

    liveTools.value = [...liveTools.value, next]
  }

  function findLiveTool(event, key) {
    if (key) {
      const keyed = liveTools.value.find((tool) => tool.toolCallId === key)
      if (keyed) return keyed
    }

    const toolName = event.toolName || 'tool'
    const code = liveToolCode(event)
    return [...liveTools.value].reverse().find((tool) => {
      if (tool.toolName !== toolName) return false
      if (tool.toolCallId) return false
      if (code && tool.code && tool.code !== code) return false
      return !['completed', 'error', 'aborted'].includes(tool.status)
    })
  }

  function liveToolKey(event) {
    return event.toolCallId || event.id || event.callId || ''
  }

  function liveToolCode(event) {
    const args = event.args || event.input || {}
    return args.command || args.path || args.customInstructions || ''
  }

  function finishLiveTools(status) {
    liveTools.value = liveTools.value.map((tool) => {
      if (tool.persistedEntry) return tool
      return { ...tool, status }
    })
  }

  function reconcileLiveTools(detail) {
    const persisted = (detail.entries || []).filter((entry) => {
      return entry.type === 'tool'
    })

    liveTools.value = liveTools.value.map((tool) => {
      const entry = persisted.find((item) => liveToolMatchesEntry(tool, item))
      if (!entry) return tool
      if (!liveToolFloorElapsed(tool)) {
        scheduleLiveToolSettle(tool.id)
        return { ...tool, persistedEntry: entry }
      }
      return settledLiveTool(tool, entry)
    })
  }

  function liveToolFloorElapsed(tool) {
    return Date.now() - (tool.startedAt || 0) >= liveToolVisualFloorMs
  }

  function scheduleLiveToolSettle(id) {
    if (liveToolSettleTimers.has(id)) return
    const tool = liveTools.value.find((item) => item.id === id)
    const remaining = Math.max(
      0,
      liveToolVisualFloorMs - (Date.now() - (tool?.startedAt || 0)),
    )
    const timer = setTimeout(() => {
      liveToolSettleTimers.delete(id)
      settleLiveTool(id)
    }, remaining)
    liveToolSettleTimers.set(id, timer)
  }

  function settleLiveTool(id) {
    liveTools.value = liveTools.value.map((tool) => {
      if (tool.id !== id || !tool.persistedEntry) return tool
      return settledLiveTool(tool, tool.persistedEntry)
    })
  }

  function settledLiveTool(tool, entry) {
    return {
      ...tool,
      label: entry.label || tool.label,
      code: entry.code || tool.code,
      status: entry.isError ? 'error' : 'completed',
      persistedEntry: entry,
    }
  }

  function clearLiveToolSettleTimers() {
    for (const timer of liveToolSettleTimers.values()) clearTimeout(timer)
    liveToolSettleTimers.clear()
  }

  function isRenderableEntry(entry) {
    if (entry.type === 'event') return false
    if (entry.type !== 'message') return true
    if (entry.role !== 'assistant') return true
    return Boolean(entry.blocks?.length || entry.text?.trim())
  }

  function isCoveredByLiveTool(entry) {
    if (entry.type !== 'tool') return false
    return liveTools.value.some((tool) => liveToolMatchesEntry(tool, entry))
  }

  function isCoveredByLiveAssistant(entry) {
    if (entry.type !== 'message' || entry.role !== 'assistant') return false
    return liveAssistantMessages.value.some((message) => {
      return liveAssistantMatchesEntry(message, entry)
    })
  }

  function isCoveredByLiveUser(entry) {
    if (entry.type !== 'message' || entry.role !== 'user') return false
    return liveUserMessages.value.some((message) => {
      return liveUserMatchesEntry(message, entry)
    })
  }

  function liveToolMatchesEntry(tool, entry) {
    if (tool.toolCallId && entry.toolCallId) {
      return tool.toolCallId === entry.toolCallId
    }

    if (tool.toolName && entry.toolName && tool.toolName !== entry.toolName) {
      return false
    }

    if (tool.code && entry.code) return tool.code === entry.code
    return Boolean(tool.toolName && entry.toolName)
  }

  function releaseLiveAnchorIfSettled() {
    if (liveTurnAnchorLength === null) return
    if (agentRunning.value || compactingContext.value || liveActivity.value) {
      return
    }
    if (liveUserMessages.value.some((message) => !message.persistedEntry)) {
      return
    }
    if (liveAssistantMessages.value.some((message) => {
      return message.streaming || !message.persistedEntry
    })) return
    if (liveTools.value.some((tool) => !liveToolSettled(tool))) return
    liveTurnAnchorLength = null
  }

  function liveToolSettled(tool) {
    if (tool.persistedEntry) return true
    return ['completed', 'error', 'aborted'].includes(tool.status)
  }

  function updateLiveUser(event) {
    if (!['message_start', 'message_end'].includes(event?.type)) return
    if (event.message?.role !== 'user') return

    const entry = liveUserEntry(event)
    const existing = findLiveUser(entry)
    if (existing) {
      liveUserMessages.value = liveUserMessages.value.map((item) => {
        if (item.id !== existing.id) return item
        return {
          ...entry,
          id: item.id,
          seq: item.seq,
          createdAt: item.createdAt,
          persistedEntry: item.persistedEntry,
        }
      })
      return
    }

    if (optimisticEntries.value.some((item) => localEntryMatches(item, entry))) {
      return
    }

    const seq = ++liveItemSeq
    liveUserMessages.value = [
      ...liveUserMessages.value,
      { ...entry, id: entry.id || `live-user-${seq}`, seq },
    ]
  }

  function liveUserEntry(event) {
    const blocks = messageBlocks(event.message.content)
    const text = textFromBlocks(blocks)
    return {
      id: messageEventId(event),
      createdAt: Date.now(),
      type: 'message',
      role: 'user',
      label: 'You',
      text,
      blocks,
      copyText: text,
    }
  }

  function findLiveUser(entry) {
    return liveUserMessages.value.find((message) => {
      return liveUserMatchesEntry(message, entry)
    })
  }

  function reconcileLiveUsers(detail) {
    const persisted = (detail.entries || []).filter((entry) => {
      return entry.type === 'message' && entry.role === 'user'
    })
    const matchedIds = new Set()

    liveUserMessages.value = liveUserMessages.value.map((message) => {
      const entry = persisted.find((item) => {
        return !matchedIds.has(item.id) && liveUserMatchesEntry(message, item)
      })
      if (!entry) return message
      matchedIds.add(entry.id)
      return { ...message, persistedEntry: entry }
    })
  }

  function liveUserMatchesEntry(message, entry) {
    if (message.persistedEntry?.id) {
      return message.persistedEntry.id === entry.id
    }
    return localEntryMatches(message, entry)
  }

  function reconcileLiveAssistants(detail) {
    const persisted = (detail.entries || []).filter((entry) => {
      return entry.type === 'message' && entry.role === 'assistant'
    })
    const matchedIds = new Set()

    liveAssistantMessages.value = liveAssistantMessages.value.map((message) => {
      const entry = persisted.find((item) => {
        return !matchedIds.has(item.id)
          && liveAssistantMatchesEntry(message, item)
      })
      if (!entry) return message
      matchedIds.add(entry.id)
      return { ...message, persistedEntry: entry, streaming: false }
    })
  }

  function liveAssistantMatchesEntry(message, entry) {
    if (message.persistedEntry?.id) {
      return message.persistedEntry.id === entry.id
    }
    if (message.streaming) return false
    if (message.id && message.id === entry.id) return true
    if (!entryIsNearLiveMessage(entry, message)) return false
    return blocksSignature(message.blocks) === blocksSignature(entry.blocks)
  }

  function entryIsNearLiveMessage(entry, message) {
    if (!message.createdAt) return true
    const entryTime = new Date(entry.timestamp).getTime()
    if (!Number.isFinite(entryTime)) return true
    return entryTime >= message.createdAt - 120000
  }

  function updateLiveAssistant(event) {
    if (event?.type === 'message_start' && event.message?.role === 'assistant') {
      activeLiveAssistantId = messageEventId(event)
    }

    if (event?.type === 'message_update' && event.message?.role === 'assistant') {
      pendingAssistantEvent = event
      cancelAnimationFrame(liveAssistantFrame)
      liveAssistantFrame = requestAnimationFrame(flushLiveAssistant)
      return
    }

    if (event?.type === 'message_end' && event.message?.role === 'assistant') {
      if (pendingAssistantEvent) flushLiveAssistant()
      finishLiveAssistant()
    }

    if (['error', 'aborted'].includes(event?.type)) clearLiveAssistant()
  }

  function flushLiveAssistant() {
    const event = pendingAssistantEvent
    pendingAssistantEvent = undefined
    if (!event) return
    const blocks = messageBlocks(event.message.content)
    if (!blocks.length) return
    const text = textFromBlocks(blocks)
    const requestedId = activeLiveAssistantId || messageEventId(event)
    const existing = findLiveAssistant(requestedId, blocks)
    const seq = existing?.seq || ++liveItemSeq
    const id = existing?.id || requestedId || `live-assistant-${seq}`
    activeLiveAssistantId = id
    const next = {
      id,
      seq,
      createdAt: existing?.createdAt || Date.now(),
      type: 'assistant',
      blocks,
      text,
      streaming: true,
    }

    if (existing) {
      liveAssistantMessages.value = liveAssistantMessages.value.map((item) => {
        return item.id === id ? next : item
      })
    } else {
      liveAssistantMessages.value = [...liveAssistantMessages.value, next]
    }

    liveAssistantBlocks.value = blocks
    liveAssistantText.value = text
  }

  function finishLiveAssistant() {
    const id = activeLiveAssistantId
    if (id) {
      liveAssistantMessages.value = liveAssistantMessages.value.map((item) => {
        return item.id === id ? { ...item, streaming: false } : item
      })
    }
    activeLiveAssistantId = ''
  }

  function findLiveAssistant(id, blocks) {
    if (id) {
      const byId = liveAssistantMessages.value.find((item) => item.id === id)
      if (byId) return byId
    }

    const streaming = [...liveAssistantMessages.value].reverse().find((item) => {
      return item.streaming
    })
    if (streaming) return streaming

    if (liveUserMessages.value.length) return null

    const signature = blocksSignature(blocks)
    return [...liveAssistantMessages.value].reverse().find((item) => {
      return blocksSignature(item.blocks) === signature
    })
  }

  function messageEventId(event) {
    return event?.message?.entryId
      || event?.entryId
      || event?.message?.id
      || event?.id
      || ''
  }

  function blocksSignature(blocks = []) {
    return blocks.map((block) => {
      return `${block.type}:${block.text || block.data || ''}`
    }).join('\n')
  }

  function clearLiveAssistant() {
    pendingAssistantEvent = undefined
    cancelAnimationFrame(liveAssistantFrame)
    liveAssistantText.value = ''
    liveAssistantBlocks.value = []
    liveAssistantMessages.value = liveAssistantMessages.value.filter((item) => {
      if (activeLiveAssistantId && item.id === activeLiveAssistantId) {
        return false
      }
      return !item.streaming
    })
    activeLiveAssistantId = ''
  }

  function pendingUserEntry(text, images = []) {
    const now = Date.now()
    const blocks = []
    if (text) blocks.push({ type: 'text', text })
    blocks.push(...images)

    return {
      id: `local-${now}`,
      createdAt: now,
      persisted: false,
      type: 'message',
      role: 'user',
      label: 'You',
      text,
      blocks,
      copyText: text,
    }
  }

  function reconcileOptimisticEntries(detail) {
    optimisticEntries.value = optimisticEntries.value.filter((localEntry) => {
      return !detail.entries.some((entry) => localEntryMatches(localEntry, entry))
    })
  }

  function localEntryMatches(localEntry, entry) {
    if (entry.type !== 'message' || entry.role !== localEntry.role) return false
    if (!entryIsAfterLocalEntry(entry, localEntry)) return false

    if (entry.text === localEntry.text
      && imageBlocksFor(entry).length === imageBlocksFor(localEntry).length) {
      return true
    }

    const skillName = localSkillCommandName(localEntry.text)
    if (!skillName) return false
    return skillSummaries(entry).some((skill) => skill.name === skillName)
  }

  function entryIsAfterLocalEntry(entry, localEntry) {
    if (!localEntry.createdAt) return true
    const entryTime = new Date(entry.timestamp).getTime()
    if (!Number.isFinite(entryTime)) return true
    return entryTime >= localEntry.createdAt - 1000
  }

  function localSkillCommandName(text) {
    return text?.trim().match(/^\/skill:([^\s]+)/)?.[1] || ''
  }

  function hasLiveOutput() {
    return liveAssistantMessages.value.length
      || liveUserMessages.value.length
      || liveActivity.value
      || liveTools.value.length
  }

  function hasLiveTranscriptOutput() {
    return liveAssistantMessages.value.length || liveTools.value.length
  }

  function emit(intent) {
    onIntent?.(intent)
  }

  return {
    addTool,
    agentRunning,
    beginUserTurn,
    clearLiveOutput,
    clearSession,
    compactingContext,
    dispose,
    entries,
    finishTools,
    handle,
    liveActivity,
    liveAssistantBlocks,
    liveItems,
    liveTurnActive,
    reconcileCurrentDetail,
    removeOptimisticEntry,
    reset,
    selectSession,
    setActivity,
    setAgentRunning,
    setPersistedDetail,
    setRuntimeState,
  }
}
