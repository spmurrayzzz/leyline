<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import PierrePreview from './components/PierrePreview.vue'
import LiveAssistantMessage from './components/LiveAssistantMessage.vue'
import ProjectBrowser from './components/ProjectBrowser.vue'
import SessionComposer from './components/SessionComposer.vue'
import StartComposer from './components/StartComposer.vue'
import SessionSidebar from './components/SessionSidebar.vue'
import TranscriptEntry from './components/TranscriptEntry.vue'
import { useLiveTurnProjection } from './composables/useLiveTurnProjection'
import { useRuntimeEvents } from './composables/useRuntimeEvents'
import { useSessionWorkspace } from './composables/useSessionWorkspace'
import { useTerminal } from './composables/useTerminal'
import { fuzzyScore } from './lib/fuzzy'
import {
  eventTime,
  formatDate,
  formatMode,
  modelChip,
  projectName,
  toolLabel,
  toolTarget,
} from './lib/format'
import {
  compactPiSession,
  editPrompt,
  interruptPiSession,
  runShellCommand,
  setEntryFeedback,
  submitPrompt,
} from './lib/pi-api'
import {
  imageBlocksFor,
  imageSrc,
  messageBlocksFor,
  renderedToolJson,
  textFromBlocks,
} from './lib/transcript'

const projectBrowserOpen = ref(false)
const projectBrowserInitialPath = ref('')
const startProjectPickerOpen = ref(false)
const startProjectQuery = ref('')
const expandedProjects = ref(new Set())
const sidebarOpen = ref(false)
const desktopSidebarHidden = ref(false)
const expandedTools = ref(new Set())
const expandedSkills = ref(new Set())
const copiedEntryId = ref('')
const draft = ref('')
const attachedImages = ref([])
const workbench = ref(null)
const eventLogOpen = ref(false)
const settingsOpen = ref(false)
const fullscreenTool = ref(null)
const promptSubmitting = ref(false)
const interrupting = ref(false)
const goalCommandSubmitting = ref('')
const editingEntry = ref(null)
const seenEntryIds = ref(new Set())
const animatingEntryIds = ref(new Set())
const composerRef = ref(null)
const composerHeight = ref(0)
const modelPickerOpen = ref(false)
const thinkingPickerOpen = ref(false)
const toolsPickerOpen = ref(false)
const slashActiveIndex = ref(0)
const slashPickerDismissed = ref(false)
const promptError = ref('')
const composerScannerSettling = ref(false)
const composerCommitPulse = ref(false)
const newSessionSettling = ref(false)
const startupComposerDocking = ref(false)
const startupRevealHold = ref(false)
const startupRevealSettling = ref(false)
const startupRevealCwd = ref('')
const inProjectNewSessionRun = ref(false)
const inProjectComposerDocking = ref(false)
const inProjectNewSessionSettling = ref(false)
const stickToBottom = ref(true)
const userScrollActive = ref(false)
const hasNewOutput = ref(false)
const {
  closeTerminalPanel,
  connectTerminal,
  terminalCwd,
  terminalEl,
  terminalOpen,
  terminalStatus,
  resizeTerminal,
  toggleTerminal,
} = useTerminal()
const terminalDrawerHeight = ref(310)
let terminalResizeStartY = 0
let terminalResizeStartHeight = 0
let terminalResizeFrame = 0
let scrollFrame
let scrollAnimationFrame
let scrollSettleFrame
let userScrollTimer
let composerResizeObserver
let copiedTimer
const bottomStickBufferPx = 160
const maxScrollTravelPx = 480
const scrollAnimationMs = 220
const scrollSettleMs = 900
const userScrollIdleMs = 450
const startupAcceptedFloorMs = 420
const inProjectNewSessionFloorMs = 1240
const initPhaseFloorMs = 340
const composerReservedHeight = computed(() => {
  return `${Math.max(240, composerHeight.value + 78)}px`
})

const selectedSessionExportUrl = computed(() => {
  if (!selectedSession.value?.id) return ''
  return `/api/pi/sessions/${encodeURIComponent(selectedSession.value.id)}/export`
})
const settingsSessionId = computed(() => {
  return selectedSession.value?.id || activeRuntimeSession.value?.id || ''
})
const settingsCwd = computed(() => selectedSession.value?.cwd || '')
const settingsPath = computed(() => {
  return selectedSession.value?.path || activeRuntimeSession.value?.path || ''
})
let initPhaseTimer = null
let composerScannerSettlingTimer = null
let composerCommitTimer = null
let startupDockTimer = null
let startupRevealTimer = null
let newSessionSettlingTimer = null
let inProjectDockTimer = null
let inProjectSettlingTimer = null
let inProjectNewSessionStartedAt = 0
const liveTurn = useLiveTurnProjection({ onIntent: handleLiveTurnIntent })
const {
  addTool: upsertLiveTool,
  agentRunning,
  beginUserTurn,
  clearLiveOutput,
  compactingContext,
  dispose: disposeLiveTurn,
  entries,
  finishTools: finishLiveTools,
  liveActivity,
  liveAssistantBlocks,
  liveItems,
  liveTurnActive,
  reconcileCurrentDetail,
  removeOptimisticEntry,
  reset: resetLiveState,
  setActivity: setLiveActivity,
  setAgentRunning,
} = liveTurn
const liveFlowItems = computed(() => {
  return liveItems.value.filter((item) => item.type !== 'activity')
})
const sessionWorkspace = useSessionWorkspace({
  liveTurn,
  terminal: {
    isOpen: () => terminalOpen.value,
    reconnect: connectTerminal,
  },
  scrollToLatest,
  shouldFollowOutput: () => stickToBottom.value,
  markNewOutput: () => { hasNewOutput.value = true },
})
const {
  activeGoal,
  activeRuntimeSession,
  availableModels,
  availableThinkingLevels,
  beginStartupRun,
  cancelDeleteSession,
  composerRuntime,
  confirmDeleteSession,
  contextUsage,
  createSession: workspaceCreateSession,
  createSessionForCwd: workspaceCreateSessionForCwd,
  creatingSessionCwd,
  currentModelLabel,
  currentThinkingLabel,
  deleteConfirmSession,
  deleteSessionButtonLabel,
  deleteSessionError,
  deleteSessionPhase,
  deletingSessionId,
  finishStartupRun,
  forkSession,
  handleNativeNewSession,
  handleRouteChange,
  highlightedText,
  initPhase,
  initializing,
  loadSessions,
  loadStartRuntimeState,
  navigateHome: workspaceNavigateHome,
  newSessionCwd,
  patchRuntimeExtensionUi,
  reloadSession,
  reloadingSession,
  requestDeleteSession,
  resetSessionToEntry,
  runStartupPhase,
  scheduleSessionRefresh,
  selectModel: selectWorkspaceModel,
  selectedModelKey,
  selectedSession,
  selectedSessionId,
  selectSession: workspaceSelectSession,
  selectThinkingLevel: selectWorkspaceThinkingLevel,
  sessionActivating,
  sessionDetail,
  sessionError,
  sessionHandoff,
  sessionIdFromRoute,
  sessionLoading,
  sessionQuery,
  sessionRuntimeStatus,
  sessions,
  sessionsError,
  sessionsLoading,
  sessionSwitching,
  sessionTitle,
  sidebarRuntimeSummary,
  startSelectedModel,
  startSelectedThinkingLevel,
  startupRun,
  switchingModel,
  switchingThinking,
  updateRuntimeEventState,
  updateRuntimeQueue,
  updateRuntimeSessionSnapshot,
  visibleProjects,
} = sessionWorkspace
const {
  appendRuntimeEvent,
  closeEventStream,
  eventLog,
  eventStreamConnected,
  eventStreamError,
  openEventStream,
  runtimeEvents,
} = useRuntimeEvents({
  onActiveSession(activeSession) {
    updateRuntimeSessionSnapshot(activeSession)
    if (activeSession.id === selectedSessionId.value) {
      activeRuntimeSession.value = activeSession
    }
    appendRuntimeEvent({
      type: 'active_session',
      summary: projectName(activeSession.cwd),
    })
  },
  onRuntimeEvent(data) {
    console.log('pi runtime event', data)
    updateRuntimeEventState(data)
    liveTurn.handle({ kind: 'runtime', ...data })
  },
  onExtensionUi(data) {
    if (data.activeSessionId !== selectedSessionId.value) return
    patchRuntimeExtensionUi(data.state, data.goal)
    surfaceExtensionNotification(data.state)
  },
})
const currentMobileModelLabel = computed(() => {
  return modelChip(composerRuntime.value?.state?.model)
})
const currentMobileThinkingLabel = computed(() => {
  const level = composerRuntime.value?.state?.thinkingLevel
  if (!level) return 'think'
  return `think ${level === 'medium' ? 'med' : formatMode(level)}`
})
const composerChips = computed(() => {
  return [
    compactingContext.value ? 'Compacting context' : '',
    sessionActivating.value ? 'Activating runtime' : '',
  ].filter(Boolean)
})
const activeToolNames = computed(() => {
  const state = composerRuntime.value?.state || {}
  if (Array.isArray(state.activeToolNames)) return state.activeToolNames
  if (typeof state.activeToolCount !== 'number') return []
  return Array.from({ length: state.activeToolCount }, (_, index) => {
    return `Tool ${index + 1}`
  })
})
const toolsChipLabel = computed(() => {
  const state = composerRuntime.value?.state || {}
  const count = Array.isArray(state.activeToolNames)
    ? state.activeToolNames.length
    : state.activeToolCount
  if (typeof count !== 'number') return 'tools unknown'
  return `${count} tools`
})
const queuedMessages = computed(() => {
  const queue = activeRuntimeSession.value?.state?.queuedMessages || {}
  return {
    steering: queue.steering || [],
    followUp: queue.followUp || [],
  }
})
const contextUsageLabel = computed(() => {
  const usage = contextUsage.value
  if (!usage?.contextWindow) return ''

  const limit = compactNumber(usage.contextWindow)
  if (usage.tokens === null) return `context — / ${limit}`

  return `context ${compactNumber(usage.tokens)} / ${limit}`
})
const contextUsageTitle = computed(() => {
  const usage = contextUsage.value
  if (!usage?.contextWindow) return ''
  if (usage.tokens === null) return 'Context usage unknown until next response'

  return `${Math.round(usage.percent || 0)}% context used`
})
const contextUsagePercent = computed(() => {
  const percent = contextUsage.value?.percent
  if (!Number.isFinite(percent)) return 0
  return Math.max(0, Math.min(100, percent))
})
const contextUsageLevel = computed(() => {
  const percent = contextUsagePercent.value
  if (percent >= 95) return 'danger'
  if (percent >= 80) return 'warning'
  return 'normal'
})
const goalWidgetLines = computed(() => {
  const ui = activeRuntimeSession.value?.state?.extensionUi
  return ui?.widgets?.goal?.lines || []
})
const goalPillLabel = computed(() => {
  const status = activeGoal.value?.status
  if (!status) return ''
  if (status === 'budget_limited') return 'goal: budget'
  if (status === 'continuation_limited') return 'goal: limit'
  return `goal: ${formatMode(status)}`
})
const goalBudgetLabel = computed(() => {
  const goal = activeGoal.value
  if (!goal) return ''
  const parts = []
  if (goal.tokenBudget) {
    const used = compactNumber(goal.tokensUsed)
    const budget = compactNumber(goal.tokenBudget)
    parts.push(`${used}/${budget} tokens`)
  }
  if (goal.continuationLimit > 0) {
    parts.push(`${goal.continuationsUsed}/${goal.continuationLimit} turns`)
  }
  return parts.join(' · ')
})
const goalPrimaryAction = computed(() => {
  const status = activeGoal.value?.status
  if (status === 'active') return { label: 'Pause', command: 'pause' }
  if (status === 'paused') return { label: 'Resume', command: 'resume' }
  return null
})
const shellModeDraft = computed(() => draft.value.trimStart().startsWith('!'))
const shellDraft = computed(() => shellCommandFromText(draft.value.trim()))
const imageSupportWarning = computed(() => {
  if (shellModeDraft.value && attachedImages.value.length) {
    return 'Shell commands cannot include image attachments.'
  }
  const model = composerRuntime.value?.state?.model
  if (!attachedImages.value.length || !model || model.supportsImages) return ''
  return `${modelChip(model)} does not support images.`
})
const canSubmitDraft = computed(() => {
  if (imageSupportWarning.value) return false
  if (shellModeDraft.value) return Boolean(shellDraft.value)
  return draft.value.trim() || attachedImages.value.length > 0
})
const eventStreamLabel = computed(() => {
  if (eventStreamConnected.value) return 'Connected'
  if (eventStreamError.value) return 'Error'
  return 'Connecting'
})
const topbarTitle = computed(() => {
  if (initializing.value) return 'Loading workspace'
  if (selectedSession.value) return projectName(selectedSession.value.cwd)
  return 'Leyline'
})
const topbarSubtitle = computed(() => {
  if (initializing.value) return 'Reading local pi state'
  return selectedSession.value?.cwd || 'Choose a session or start fresh'
})
const isEmptySelectedSession = computed(() => {
  return Boolean(selectedSession.value)
    && entries.value.length === 0
    && !liveTurnActive.value
})
const startProjectOptions = computed(() => {
  const query = startProjectQuery.value.trim().toLowerCase()
  return visibleProjects.value.filter((project) => {
    return !query || fuzzyScore(project.name, query) > 0
  })
})
const startProjectLabel = computed(() => {
  return newSessionCwd.value ? projectName(newSessionCwd.value) : 'Choose project'
})
const sendButtonLabel = computed(() => {
  if (compactingContext.value) return '…'
  if (agentRunning.value) return '■'
  if (promptSubmitting.value || reloadingSession.value || sessionActivating.value) {
    return '…'
  }
  if (shellModeDraft.value) return 'Run'
  return '↑'
})
const composerPlaceholder = computed(() => {
  if (compactingContext.value) return 'Compacting context before continuing…'
  if (sessionActivating.value) return 'Activating pi runtime…'
  if (agentRunning.value) {
    return 'Type to steer the current run; Option+Enter queues follow-up'
  }
  if (isEmptySelectedSession.value) return 'Describe the first task or attach images'
  return 'Ask for follow-up changes or attach images'
})
const startupShellVisible = computed(() => {
  return Boolean(startupRun.value || startupRevealHold.value)
})
const startFlowVisible = computed(() => {
  if (startupRun.value) return true
  if (sessionLoading.value || sessionSwitching.value) return false
  return !selectedSession.value
})
const newSessionTransitionActive = computed(() => {
  return Boolean(
    startupShellVisible.value || newSessionSettling.value,
  )
})
const inProjectTransitionActive = computed(() => {
  return Boolean(
    inProjectNewSessionRun.value || inProjectNewSessionSettling.value,
  )
})
const emptySessionShellVisible = computed(() => {
  return Boolean(isEmptySelectedSession.value || inProjectNewSessionRun.value)
})
const runtimeChromeVisible = computed(() => {
  return initializing.value || selectedSession.value
})
const composerScannerSourceActive = computed(() => {
  return Boolean(
    (promptSubmitting.value && !composerCommitPulse.value)
      || agentRunning.value
      || sessionHandoff.value
      || inProjectNewSessionRun.value,
  )
})
const composerScannerVisible = computed(() => {
  return Boolean(
    composerScannerSourceActive.value || composerScannerSettling.value,
  )
})
const editingLabel = computed(() => {
  if (!editingEntry.value) return ''
  return 'Editing earlier message · send to replace the current branch'
})
const slashQuery = computed(() => {
  const match = draft.value.match(/^\/([^\s]*)$/)
  return match ? match[1].toLowerCase() : ''
})
const slashPickerOpen = computed(() => {
  return !slashPickerDismissed.value
    && /^\/[^\s]*$/.test(draft.value)
    && slashCommandItems.value.length > 0
})
const slashCommands = computed(() => {
  return composerRuntime.value?.state?.slashCommands || []
})
const slashCommandItems = computed(() => {
  const query = slashQuery.value
  return slashCommands.value
    .map((command) => ({
      ...command,
      score: query ? slashCommandScore(command, query) : 1,
    }))
    .filter((command) => command.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 8)
})

watch(newSessionCwd, (cwd) => {
  loadStartRuntimeState(cwd)
  updateNativeWindowCwd()
})

watch(slashCommandItems, () => {
  slashActiveIndex.value = 0
})

watch(sessionDetail, (detail) => {
  liveTurn.setPersistedDetail(detail)
  if (detail?.session?.cwd) expandProject(detail.session.cwd)
  updateNativeWindowCwd()
})

watch(activeRuntimeSession, (session) => {
  if (session?.id !== selectedSessionId.value) return
  liveTurn.setRuntimeState(session.state)
})

watch(selectedSessionId, () => {
  updateNativeWindowCwd()
  expandedTools.value = new Set()
  expandedSkills.value = new Set()
  editingEntry.value = null
  promptError.value = ''
  seenEntryIds.value = new Set()
  animatingEntryIds.value = new Set()
  resetWorkbenchScrollState()
})

watch(entries, (newEntries) => {
  const skip = sessionSwitching.value || sessionLoading.value
    || seenEntryIds.value.size === 0
  for (const entry of newEntries) {
    if (!seenEntryIds.value.has(entry.id)) {
      seenEntryIds.value.add(entry.id)
      if (!skip) {
        animatingEntryIds.value.add(entry.id)
        setTimeout(() => animatingEntryIds.value.delete(entry.id), 300)
      }
    }
  }
})

watch(composerScannerSourceActive, (active, wasActive) => {
  clearTimeout(composerScannerSettlingTimer)
  if (active) {
    composerScannerSettling.value = false
    return
  }
  if (!wasActive) return

  composerScannerSettling.value = true
  composerScannerSettlingTimer = window.setTimeout(() => {
    composerScannerSettling.value = false
  }, 420)
})

watch(() => composerRef.value?.form, (el) => {
  observeComposer(el)
}, { flush: 'post' })

onMounted(async () => {
  window.addEventListener('keydown', closeMenusOnEscape, true)
  window.addEventListener('click', closeMenusOnOutsideClick)
  window.addEventListener('popstate', handleRouteChange)
  window.addEventListener('leyline:new-session', handleNativeNewSession)
  window.addEventListener('leyline:toggle-terminal', handleNativeToggleTerminal)
  window.addEventListener('leyline:open-settings', handleNativeOpenSettings)
  window.addEventListener('leyline:toggle-sidebar', handleNativeToggleSidebar)
  window.addEventListener('leyline:escape', handleNativeEscape)
  updateNativeWindowCwd()
  openEventStream()
  initPhase.value = 'sessions'
  const initialNativeCwd = consumeInitialNativeNewSessionCwd()
  if (initialNativeCwd) newSessionCwd.value = initialNativeCwd
  await waitInitPhaseFloor()
  if (initialNativeCwd) {
    try {
      await handleNativeNewSession({ detail: { cwd: initialNativeCwd } })
    } finally {
      sessionsLoading.value = false
      initPhase.value = 'sessions'
    }
    return
  }
  await loadSessions({ routeSessionId: sessionIdFromRoute() })
})

onUnmounted(() => {
  window.removeEventListener('keydown', closeMenusOnEscape, true)
  window.removeEventListener('click', closeMenusOnOutsideClick)
  window.removeEventListener('popstate', handleRouteChange)
  window.removeEventListener('leyline:new-session', handleNativeNewSession)
  window.removeEventListener('leyline:toggle-terminal', handleNativeToggleTerminal)
  window.removeEventListener('leyline:open-settings', handleNativeOpenSettings)
  window.removeEventListener('leyline:toggle-sidebar', handleNativeToggleSidebar)
  window.removeEventListener('leyline:escape', handleNativeEscape)
  delete window.__leylineCurrentCwd
  stopTerminalResize()
  closeEventStream()
  sessionWorkspace.dispose()
  closeTerminalPanel()
  clearTimeout(copiedTimer)
  clearTimeout(userScrollTimer)
  composerResizeObserver?.disconnect()
  disposeLiveTurn()
  cancelAnimationFrame(scrollFrame)
  cancelAnimationFrame(scrollAnimationFrame)
  cancelAnimationFrame(scrollSettleFrame)
  cancelAnimationFrame(terminalResizeFrame)
  clearTimeout(initPhaseTimer)
  clearTimeout(composerScannerSettlingTimer)
  clearTimeout(composerCommitTimer)
  clearTimeout(startupDockTimer)
  clearTimeout(startupRevealTimer)
  clearTimeout(newSessionSettlingTimer)
  clearTimeout(inProjectDockTimer)
  clearTimeout(inProjectSettlingTimer)
})

async function markEntryFeedback(entry, label, feedbackText) {
  const session = sessionDetail.value?.session
  if (!session || entry.role !== 'assistant') return

  const previousLabel = entry.rolloutFeedback || ''
  const previousText = entry.rolloutFeedbackText || ''
  const nextText = label ? feedbackText ?? previousText : ''

  patchEntryFeedback(entry.id, label, nextText)

  try {
    await setEntryFeedback(session, entry.id, label, nextText)
  } catch (error) {
    patchEntryFeedback(entry.id, previousLabel, previousText)
    promptError.value = error.message
  }
}

function patchEntryFeedback(entryId, label, feedbackText = '') {
  const detail = sessionDetail.value
  if (!detail?.entries) return

  sessionDetail.value = {
    ...detail,
    entries: detail.entries.map((entry) => {
      if (entry.id !== entryId) return entry
      return {
        ...entry,
        rolloutFeedback: label,
        rolloutFeedbackText: feedbackText,
      }
    }),
  }
}

function handleLiveTurnIntent(intent) {
  if (intent.type === 'refresh-session') {
    scheduleSessionRefresh(intent.activeSessionId, intent.event)
  }
  if (intent.type === 'runtime-queue') updateRuntimeQueue(intent.event)
  if (intent.type === 'surface-error') promptError.value = intent.message
  if (intent.type === 'scroll-live') scheduleLiveScroll(intent.activeSessionId)
}

async function waitInitPhaseFloor() {
  return new Promise((resolve) => {
    initPhaseTimer = setTimeout(resolve, initPhaseFloorMs)
  })
}

function startTerminalResize(event) {
  terminalResizeStartY = event.clientY
  terminalResizeStartHeight = terminalDrawerHeight.value
  window.addEventListener('pointermove', resizeTerminalDrawer)
  window.addEventListener('pointerup', stopTerminalResize)
  window.addEventListener('pointercancel', stopTerminalResize)
  document.body.style.userSelect = 'none'
}

function resizeTerminalDrawer(event) {
  const nextHeight = terminalResizeStartHeight + terminalResizeStartY
    - event.clientY
  setTerminalDrawerHeight(nextHeight)
}

function stopTerminalResize() {
  window.removeEventListener('pointermove', resizeTerminalDrawer)
  window.removeEventListener('pointerup', stopTerminalResize)
  window.removeEventListener('pointercancel', stopTerminalResize)
  document.body.style.userSelect = ''
}

function nudgeTerminalHeight(amount) {
  setTerminalDrawerHeight(terminalDrawerHeight.value + amount)
}

function setTerminalDrawerHeight(height) {
  const max = Math.max(220, Math.round(window.innerHeight * 0.72))
  terminalDrawerHeight.value = Math.min(max, Math.max(180, Math.round(height)))
  cancelAnimationFrame(terminalResizeFrame)
  terminalResizeFrame = requestAnimationFrame(resizeTerminal)
}

async function createSession(project) {
  await workspaceCreateSession(project)
  projectBrowserOpen.value = false
  sidebarOpen.value = false
}

async function createSessionForCwd(cwd) {
  await workspaceCreateSessionForCwd(cwd)
  projectBrowserOpen.value = false
  sidebarOpen.value = false
}

async function selectSession(session, options) {
  await workspaceSelectSession(session, options)
  sidebarOpen.value = false
}

async function handleNativeToggleTerminal() {
  if (!selectedSession.value || initializing.value) return

  await toggleTerminal()
}

function handleNativeOpenSettings() {
  toggleSettingsDrawer()
}

function handleNativeToggleSidebar() {
  if (window.matchMedia('(max-width: 760px)').matches) {
    sidebarOpen.value = !sidebarOpen.value
    return
  }

  desktopSidebarHidden.value = !desktopSidebarHidden.value
}

function handleNativeEscape() {
  handleEscape()
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function navigateHome() {
  workspaceNavigateHome()
  sidebarOpen.value = false
}

function eventType(item) {
  return item.event?.type || item.type || 'event'
}

function eventSummary(item) {
  if (item.summary) return item.summary
  if (item.type === 'extension_ui') return 'extension UI'
  const event = item.event || item
  const type = event.type || item.type

  if (type === 'tool_call') return toolLabel(event.toolName)
  if (type === 'tool_execution_start') {
    return `${toolLabel(event.toolName)}${toolTarget(event.args)}`
  }
  if (type === 'tool_execution_end') return toolLabel(event.toolName)
  if (type === 'message_update') return event.message?.role || 'message'
  if (type === 'message_end') return event.message?.role || 'message'
  if (type === 'error') return event.error?.message || event.message || 'error'
  return item.activeSessionId ? item.activeSessionId.slice(0, 8) : 'runtime'
}

function liveToolStatus(tool) {
  if (tool.status === 'preparing') return 'preparing'
  if (tool.status === 'running') return 'running'
  if (tool.status === 'reading') return 'reading result'
  if (tool.status === 'error') return 'error'
  if (tool.status === 'aborted') return 'aborted'
  return 'completed'
}

function liveItemClass(item) {
  return [
    `live-${item.type}-item`,
    item.status ? `is-${item.status}` : '',
    item.persistedEntry ? 'is-persisted' : '',
    item.streaming ? 'is-streaming' : '',
  ]
}

function isProjectExpanded(project) {
  return expandedProjects.value.has(project.cwd)
}

function expandProject(cwd) {
  if (!cwd) return
  expandedProjects.value = new Set([...expandedProjects.value, cwd])
}

function toggleProject(project) {
  const next = new Set(expandedProjects.value)
  if (next.has(project.cwd)) next.delete(project.cwd)
  else next.add(project.cwd)
  expandedProjects.value = next
}

function selectStartProject(cwd) {
  newSessionCwd.value = cwd
  startProjectPickerOpen.value = false
  startProjectQuery.value = ''
}

function openProjectBrowser(path = '') {
  startProjectPickerOpen.value = false
  projectBrowserInitialPath.value =
    path || newSessionCwd.value || selectedSession.value?.cwd || ''
  projectBrowserOpen.value = true
}

function closeProjectBrowser() {
  projectBrowserOpen.value = false
}

function toggleSettingsDrawer() {
  settingsOpen.value = !settingsOpen.value
  eventLogOpen.value = false
}

function toggleEventDrawer() {
  eventLogOpen.value = !eventLogOpen.value
  settingsOpen.value = false
}

function isToolExpanded(entry) {
  return expandedTools.value.has(entry.id)
}

function toggleTool(entry) {
  const next = new Set(expandedTools.value)
  if (next.has(entry.id)) next.delete(entry.id)
  else next.add(entry.id)
  expandedTools.value = next
}

function openToolFullscreen(entry) {
  fullscreenTool.value = entry
}

function closeToolFullscreen() {
  fullscreenTool.value = null
}

function isSkillExpanded(entry) {
  return expandedSkills.value.has(entry.id)
}

function isEnteringEntry(entry) {
  return animatingEntryIds.value.has(entry.id)
}

function toggleSkill(entry) {
  const next = new Set(expandedSkills.value)
  if (next.has(entry.id)) next.delete(entry.id)
  else next.add(entry.id)
  expandedSkills.value = next
}

function entryCopyText(entry) {
  return entry.copyText || entry.preview?.fallbackText || entry.text || ''
}

function liveAssistantDisplayBlocks(item) {
  if (item?.persistedEntry) return messageBlocksFor(item.persistedEntry)
  return item?.blocks || []
}

function liveAssistantCopyText(blocks = liveAssistantBlocks.value) {
  return blocks.map((block) => block.text).join('\n\n')
}

function liveAssistantDisplayCopyText(item) {
  return liveAssistantCopyText(liveAssistantDisplayBlocks(item))
}

async function copyEntry(entry) {
  await copyTranscriptItem(entry.id, entryCopyText(entry))
}

async function copyTranscriptItem(id, text) {
  if (!text) return

  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }

  copiedEntryId.value = id
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    if (copiedEntryId.value === id) copiedEntryId.value = ''
  }, 1200)
}

function copyTitle(id) {
  return copiedEntryId.value === id ? 'Copied' : 'Copy to clipboard'
}

function copyGlyph(id) {
  return copiedEntryId.value === id ? '✓' : '⧉'
}

function scheduleBottomScroll() {
  cancelAnimationFrame(scrollFrame)
  scrollFrame = requestAnimationFrame(() => {
    scrollToLatest()
  })
}

function scheduleLiveScroll(activeSessionId) {
  if (activeSessionId !== selectedSessionId.value) return
  if (!liveItems.value.length) return

  if (!stickToBottom.value || userScrollActive.value) {
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

function handleWorkbenchScroll() {
  if (!workbench.value) return
  const distance = distanceFromWorkbenchBottom()
  if (distance >= bottomStickBufferPx) stickToBottom.value = false
  else if (!userScrollActive.value) stickToBottom.value = true
  if (stickToBottom.value) hasNewOutput.value = false
}

function handleWorkbenchWheel(event) {
  markUserScrolling()
  if (event.deltaY < 0) stickToBottom.value = false
}

function handleWorkbenchTouchMove() {
  markUserScrolling()
  stickToBottom.value = false
}

function markUserScrolling() {
  userScrollActive.value = true
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

async function jumpToLatest() {
  await scrollToLatest()
}

function resetWorkbenchScrollState() {
  clearTimeout(userScrollTimer)
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
    if (!workbench.value) return
    const target = workbenchBottom()
    const progress = Math.min(1, (now - startedAt) / scrollAnimationMs)
    const eased = 1 - Math.pow(1 - progress, 3)
    workbench.value.scrollTop = start + (target - start) * eased
    if (progress < 1) {
      scrollAnimationFrame = requestAnimationFrame(tick)
    } else {
      workbench.value.scrollTop = target
      settleWorkbenchAtBottom()
    }
  }
  scrollAnimationFrame = requestAnimationFrame(tick)
}

function settleWorkbenchAtBottom() {
  cancelAnimationFrame(scrollSettleFrame)
  const startedAt = performance.now()
  const settle = (now) => {
    if (!workbench.value || !stickToBottom.value) return
    workbench.value.scrollTop = workbenchBottom()
    if (now - startedAt < scrollSettleMs) {
      scrollSettleFrame = requestAnimationFrame(settle)
    }
  }
  scrollSettleFrame = requestAnimationFrame(settle)
}

async function scrollToLatest() {
  resetWorkbenchScrollState()
  await nextTick()
  await new Promise(requestAnimationFrame)
  setWorkbenchScrollToBottom()
}

function surfaceExtensionNotification(state) {
  const notification = state?.notifications?.at?.(-1)
  if (!notification) return
  if (notification.type === 'error' || notification.type === 'warning') {
    promptError.value = notification.message
  }
}

function compactNumber(value) {
  const number = Number(value || 0)
  if (number >= 1_000_000) return `${trimNumber(number / 1_000_000)}M`
  if (number >= 1_000) return `${trimNumber(number / 1_000)}K`
  return String(number)
}

function trimNumber(value) {
  return value.toFixed(1).replace(/\.0$/, '')
}

async function refocusComposer() {
  await nextTick()
  composerRef.value?.focus()
}

function beginInProjectNewSessionRun() {
  clearTimeout(inProjectDockTimer)
  clearTimeout(inProjectSettlingTimer)
  inProjectNewSessionSettling.value = false
  inProjectNewSessionStartedAt = Date.now()
  inProjectNewSessionRun.value = true
  inProjectComposerDocking.value = false
  inProjectDockTimer = window.setTimeout(() => {
    inProjectComposerDocking.value = true
  }, 320)
}

async function finishInProjectNewSessionRun() {
  if (!inProjectNewSessionRun.value) return

  clearTimeout(inProjectDockTimer)
  inProjectComposerDocking.value = true

  const elapsed = Date.now() - inProjectNewSessionStartedAt
  const remaining = Math.max(0, inProjectNewSessionFloorMs - elapsed)
  if (remaining) await wait(remaining)

  inProjectNewSessionSettling.value = true
  inProjectNewSessionRun.value = false
  inProjectComposerDocking.value = false
  clearTimeout(inProjectSettlingTimer)
  inProjectSettlingTimer = window.setTimeout(() => {
    inProjectNewSessionSettling.value = false
  }, 720)
}

function cancelInProjectNewSessionRun() {
  clearTimeout(inProjectDockTimer)
  clearTimeout(inProjectSettlingTimer)
  inProjectNewSessionRun.value = false
  inProjectComposerDocking.value = false
  inProjectNewSessionSettling.value = false
}

function pulseComposerCommit() {
  composerCommitPulse.value = true
  clearTimeout(composerCommitTimer)
  composerCommitTimer = window.setTimeout(() => {
    composerCommitPulse.value = false
  }, 240)
}

async function submitDraft(streamingBehavior) {
  const text = draft.value.trim()
  const submittedAttachments = attachedImages.value
  const images = submittedAttachments.map(({ preview, ...image }) => image)
  const shellCommand = shellCommandFromText(text)
  const compactCommand = compactCommandFromText(text)
  if (!text && images.length === 0) return
  if (promptSubmitting.value
    || reloadingSession.value
    || sessionLoading.value
    || sessionSwitching.value
    || sessionActivating.value
    || compactingContext.value) {
    return
  }

  if (compactCommand) {
    await submitCompactCommand(compactCommand, images)
    return
  }

  if (shellCommand) {
    await submitShellCommand(shellCommand, images)
    return
  }

  if (agentRunning.value && !editingEntry.value) {
    const sessionId = selectedSessionId.value
    const submittedDraft = draft.value
    promptSubmitting.value = true
    promptError.value = ''
    draft.value = ''
    attachedImages.value = []
    try {
      const data = await submitPrompt(
        sessionId,
        text,
        images,
        streamingBehavior || 'steer',
      )
      if (data.active && selectedSessionId.value === sessionId) {
        activeRuntimeSession.value = data.active
      }
    } catch (error) {
      if (selectedSessionId.value === sessionId) {
        if (!draft.value && !attachedImages.value.length) {
          draft.value = submittedDraft
          attachedImages.value = submittedAttachments
        }
        promptError.value = error.message
      }
    } finally {
      promptSubmitting.value = false
      refocusComposer()
    }
    return
  }

  const sessionId = selectedSessionId.value
  const editing = persistedEditingEntry(editingEntry.value)
  if (editingEntry.value && !editing) {
    promptError.value = 'Wait for this message to finish saving before editing.'
    return
  }
  if (editing && editing !== editingEntry.value) editingEntry.value = editing
  const previousDetail = sessionDetail.value
  const shouldFollowOutput = editing || stickToBottom.value
  const startsTurn = !isHandledSlashCommand(text)
    || slashCommandStartsTurn(text)
  const startsEmptySession = !startupRun.value
    && isEmptySelectedSession.value
    && !editing
    && startsTurn
  if (editing) {
    resetLiveState()
    trimSessionToEntry(editing.id)
    stickToBottom.value = true
    hasNewOutput.value = false
  } else {
    reconcileCurrentDetail()
  }
  if (startsEmptySession) beginInProjectNewSessionRun()
  pulseComposerCommit()
  const localEntry = beginUserTurn(text, images)
  const submittedDraft = draft.value
  promptSubmitting.value = true
  promptError.value = ''
  draft.value = ''
  attachedImages.value = []
  if (shouldFollowOutput) await scrollToLatest()
  else hasNewOutput.value = true

  let promptAccepted = false
  try {
    const data = editing
      ? await editPrompt(sessionId, editing.id, text, images)
      : await submitPrompt(sessionId, text, images)
    if (selectedSessionId.value === sessionId) {
      if (data.active) activeRuntimeSession.value = data.active
      if (isHandledSlashCommand(text)) removeOptimisticEntry(localEntry)
      editingEntry.value = null
      if (startsTurn) setAgentRunning(true, 'Thinking…')
      promptAccepted = true
    }
  } catch (error) {
    if (selectedSessionId.value === sessionId) {
      if (editing) {
        sessionDetail.value = previousDetail
        resetLiveState()
      }
      removeOptimisticEntry(localEntry)
      if (!draft.value && !attachedImages.value.length) {
        draft.value = submittedDraft
        attachedImages.value = submittedAttachments
      }
      promptError.value = error.message
    }
  } finally {
    if (startsEmptySession) {
      if (promptAccepted) await finishInProjectNewSessionRun()
      else cancelInProjectNewSessionRun()
    }
    promptSubmitting.value = false
    refocusComposer()
  }
}

function shellCommandFromText(text) {
  if (!text.startsWith('!')) return null
  const excludeFromContext = text.startsWith('!!')
  const command = text.slice(excludeFromContext ? 2 : 1).trim()
  if (!command) return null
  return { command, excludeFromContext }
}

function compactCommandFromText(text) {
  if (text !== '/compact' && !text.startsWith('/compact ')) return null
  return { customInstructions: text.slice('/compact'.length).trim() }
}

async function submitCompactCommand(compactCommand, images) {
  if (editingEntry.value) {
    promptError.value = 'Cancel editing before compacting.'
    return
  }
  if (agentRunning.value) {
    promptError.value = 'Wait for the current response to finish before compacting.'
    return
  }
  if (images.length) {
    promptError.value = 'Compaction cannot include image attachments.'
    return
  }

  promptSubmitting.value = true
  promptError.value = ''
  resetLiveState()
  draft.value = ''
  upsertLiveTool({
    type: 'tool_execution_start',
    toolName: 'compact',
    args: { customInstructions: compactCommand.customInstructions },
  }, 'running')

  const sessionId = selectedSessionId.value
  try {
    const data = await compactPiSession(
      sessionId,
      compactCommand.customInstructions,
    )
    if (data.active && selectedSessionId.value === sessionId) {
      activeRuntimeSession.value = data.active
    }
    if (data.detail && selectedSessionId.value === sessionId) {
      sessionDetail.value = data.detail
    }
    if (selectedSessionId.value === sessionId) finishLiveTools('completed')
    await loadSessions({ selectFirst: false, showLoading: false })
    if (selectedSessionId.value === sessionId) await scrollToLatest()
  } catch (error) {
    if (selectedSessionId.value === sessionId) {
      finishLiveTools('error')
      promptError.value = error.message
    }
  } finally {
    promptSubmitting.value = false
    refocusComposer()
  }
}

async function submitShellCommand(shellCommand, images) {
  if (editingEntry.value) {
    promptError.value = 'Cancel editing before running a shell command.'
    return
  }
  if (images.length) {
    promptError.value = 'Shell commands cannot include image attachments.'
    return
  }

  const submittedDraft = draft.value
  promptSubmitting.value = true
  promptError.value = ''
  draft.value = ''
  if (!agentRunning.value) resetLiveState()
  upsertLiveTool({
    type: 'tool_execution_start',
    toolName: 'bash',
    args: { command: shellCommand.command },
  }, 'running')

  const sessionId = selectedSessionId.value
  try {
    const data = await runShellCommand(
      sessionId,
      shellCommand.command,
      shellCommand.excludeFromContext,
    )
    if (data.active && selectedSessionId.value === sessionId) {
      activeRuntimeSession.value = data.active
    }
    if (data.detail && selectedSessionId.value === sessionId) {
      sessionDetail.value = data.detail
    }
    await loadSessions({ selectFirst: false, showLoading: false })
    if (selectedSessionId.value === sessionId) await scrollToLatest()
  } catch (error) {
    if (selectedSessionId.value === sessionId) {
      finishLiveTools('error')
      draft.value = submittedDraft
      promptError.value = error.message
    }
  } finally {
    promptSubmitting.value = false
    if (selectedSessionId.value === sessionId) setLiveActivity('')
    refocusComposer()
  }
}

function isHandledSlashCommand(text) {
  return /^\/(goal|compact)(?:\s|$)/.test(text)
}

function slashCommandStartsTurn(text) {
  return /^\/goal\s+/.test(text) && !/^\/goal\s+(clear|pause)\s*$/i.test(text)
}

function startEditingEntry(entry) {
  if (agentRunning.value
    || compactingContext.value
    || promptSubmitting.value
    || !entry?.id) return

  const target = persistedEditingEntry(entry)
  if (!target) {
    promptError.value = 'Wait for this message to finish saving before editing.'
    return
  }
  if (target.role !== 'user') return

  editingEntry.value = target
  draft.value = target.text || textFromBlocks(messageBlocksFor(target))
  attachedImages.value = imageBlocksFor(target).map((image) => ({
    ...image,
    preview: imageSrcForComposer(image),
  }))
  promptError.value = ''
  closePickerMenus()
  nextTick(() => composerRef.value?.focus())
}

function persistedEditingEntry(entry) {
  if (!entry) return null
  if (!isLocalEntry(entry)) return entry
  return matchingPersistedUserEntry(entry)
}

function isLocalEntry(entry) {
  return entry?.persisted === false
    || String(entry?.id || '').startsWith('local-')
}

function matchingPersistedUserEntry(entry) {
  const entries = sessionDetail.value?.entries || []
  return entries.find((candidate) => {
    if (candidate.type !== 'message' || candidate.role !== 'user') return false
    if (candidate.text !== entry.text) return false
    if (imageBlocksFor(candidate).length !== imageBlocksFor(entry).length) {
      return false
    }
    if (!entry.createdAt) return true
    const timestamp = new Date(candidate.timestamp).getTime()
    return !Number.isFinite(timestamp) || timestamp >= entry.createdAt - 1000
  }) || null
}

function cancelEditingEntry() {
  editingEntry.value = null
}

function trimSessionToEntry(entryId) {
  const detail = sessionDetail.value
  const index = detail?.entries?.findIndex((entry) => entry.id === entryId)
  if (!detail || index < 0) return
  const nextDetail = {
    ...detail,
    entries: detail.entries.slice(0, index),
  }
  sessionDetail.value = nextDetail
  liveTurn.setPersistedDetail(nextDetail)
}

function imageSrcForComposer(image) {
  return `data:${image.mimeType};base64,${image.data}`
}

async function runGoalCommand(command) {
  if (!activeGoal.value || goalCommandSubmitting.value) return
  if (!selectedSession.value) return

  goalCommandSubmitting.value = command
  promptError.value = ''

  const sessionId = selectedSessionId.value
  try {
    if ((command === 'pause' || command === 'clear') && agentRunning.value) {
      setLiveActivity('Stopping…')
      await interruptPiSession(sessionId)
      setAgentRunning(false)
    }
    await submitPrompt(sessionId, `/goal ${command}`)
    if (command === 'resume') {
      setAgentRunning(true, 'Thinking…')
    }
  } catch (error) {
    if (selectedSessionId.value === sessionId) promptError.value = error.message
  } finally {
    goalCommandSubmitting.value = ''
  }
}

async function interruptAgent() {
  if (!agentRunning.value || interrupting.value) return

  interrupting.value = true
  promptError.value = ''
  setLiveActivity('Stopping…')

  const sessionId = selectedSessionId.value
  try {
    await interruptPiSession(sessionId)
    if (selectedSessionId.value === sessionId) setAgentRunning(false)
  } catch (error) {
    if (selectedSessionId.value === sessionId) {
      promptError.value = error.message
      setLiveActivity('')
    }
  } finally {
    interrupting.value = false
  }
}

async function selectModel(model) {
  modelPickerOpen.value = false
  promptError.value = ''
  await selectWorkspaceModel(model)
}

async function selectThinkingLevel(level) {
  thinkingPickerOpen.value = false
  promptError.value = ''
  await selectWorkspaceThinkingLevel(level)
}

function togglePicker(name) {
  modelPickerOpen.value = name === 'model' && !modelPickerOpen.value
  thinkingPickerOpen.value = name === 'thinking' && !thinkingPickerOpen.value
  toolsPickerOpen.value = name === 'tools' && !toolsPickerOpen.value
}

function modelKey(model) {
  return JSON.stringify([model.provider, model.id])
}

function slashCommandScore(command, query) {
  return Math.max(
    fuzzyScore(command.name, query),
    fuzzyScore(command.description || '', query),
  )
}

function slashCommandSourceLabel(source) {
  if (source === 'prompt') return 'Prompt'
  if (source === 'skill') return 'Skill'
  if (source === 'extension') return 'Command'
  return 'Command'
}

function selectSlashCommand(command) {
  if (!command?.name) return
  draft.value = `/${command.name} `
  slashActiveIndex.value = 0
  slashPickerDismissed.value = true
}

function showSlashPicker() {
  slashPickerDismissed.value = false
}

function handleSlashPickerKeydown(event) {
  if (!slashPickerOpen.value) return false

  if (event.key === 'Escape') {
    event.preventDefault()
    slashPickerDismissed.value = true
    return true
  }

  if (!slashCommandItems.value.length) return false

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    slashActiveIndex.value = (
      slashActiveIndex.value + 1
    ) % slashCommandItems.value.length
    return true
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    slashActiveIndex.value = (
      slashActiveIndex.value - 1 + slashCommandItems.value.length
    ) % slashCommandItems.value.length
    return true
  }

  if (event.key === 'Tab' || event.key === 'Enter') {
    event.preventDefault()
    selectSlashCommand(slashCommandItems.value[slashActiveIndex.value])
    return true
  }

  return false
}

function handleComposerKeydown(event) {
  if (handleSlashPickerKeydown(event)) return
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submitDraft(event.altKey ? 'followUp' : 'steer')
}

async function handleComposerPaste(event) {
  const files = Array.from(event.clipboardData?.files || [])
    .filter((file) => file.type.startsWith('image/'))
  if (!files.length) return

  event.preventDefault()
  promptError.value = ''

  try {
    const images = await Promise.all(files.map(fileToImageContent))
    attachedImages.value = [...attachedImages.value, ...images]
  } catch (error) {
    promptError.value = error.message
  }
}

function removeAttachedImage(index) {
  attachedImages.value = attachedImages.value.filter((_, itemIndex) => {
    return itemIndex !== index
  })
}

function fileToImageContent(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      if (comma === -1) reject(new Error('Could not read image'))
      else resolve({
        type: 'image',
        data: result.slice(comma + 1),
        mimeType: file.type,
        preview: result,
      })
    })
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

function handleStartComposerKeydown(event) {
  if (handleSlashPickerKeydown(event)) return
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submitStartDraft()
}

async function submitStartDraft() {
  const text = draft.value.trim()
  const model = startSelectedModel.value
  const thinkingLevel = startSelectedThinkingLevel.value
  const targetCwd = newSessionCwd.value.trim()
  const hasPrompt = Boolean(text || attachedImages.value.length)
  if (!targetCwd || creatingSessionCwd.value) return

  clearTimeout(startupDockTimer)
  startupComposerDocking.value = false
  beginStartupRun(targetCwd, { hasPrompt, model, thinkingLevel })
  startupDockTimer = window.setTimeout(() => {
    startupComposerDocking.value = true
  }, 320)

  try {
    await wait(startupAcceptedFloorMs)
    await runStartupPhase('creating', () => createSessionForCwd(targetCwd))
    if (model && selectedSession.value) {
      await runStartupPhase('model', () => selectWorkspaceModel(model))
    }
    if (thinkingLevel && selectedSession.value) {
      await runStartupPhase('thinking', () => {
        return selectWorkspaceThinkingLevel(thinkingLevel)
      })
    }
    if (hasPrompt) await runStartupPhase('submitting', submitDraft)
  } finally {
    await wait(260)
    clearTimeout(startupDockTimer)
    clearTimeout(startupRevealTimer)
    const shouldRevealSession = Boolean(selectedSession.value)
    startupRevealHold.value = shouldRevealSession
    startupRevealSettling.value = shouldRevealSession
    startupRevealCwd.value = targetCwd
    newSessionSettling.value = true
    finishStartupRun()
    startupComposerDocking.value = false
    startupRevealTimer = window.setTimeout(() => {
      startupRevealHold.value = false
      startupRevealCwd.value = ''
    }, 180)
    clearTimeout(newSessionSettlingTimer)
    newSessionSettlingTimer = window.setTimeout(() => {
      newSessionSettling.value = false
      startupRevealSettling.value = false
    }, 720)
  }
}

function closeMenusOnEscape(event) {
  if (event.key !== 'Escape') return
  handleEscape(event)
}

function handleEscape(event) {
  if (agentRunning.value) {
    event?.preventDefault?.()
    void interruptAgent()
  }
  settingsOpen.value = false
  eventLogOpen.value = false
  closeToolFullscreen()
  closeProjectBrowser()
  cancelDeleteSession()
  cancelEditingEntry()
  closePickerMenus()
}

function consumeInitialNativeNewSessionCwd() {
  const url = new URL(window.location.href)
  const cwd = url.searchParams.get('leylineNewSessionCwd')?.trim() || ''
  if (!cwd) return ''

  url.searchParams.delete('leylineNewSessionCwd')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState({}, '', next)
  return cwd
}

function updateNativeWindowCwd() {
  window.__leylineCurrentCwd = selectedSession.value?.cwd || ''
}

function closeMenusOnOutsideClick(event) {
  if (event.target.closest('.project-browser-modal')) return
  if (event.target.closest('.model-picker')) return
  if (event.target.closest('.start-project-button, .start-project-menu')) return
  closePickerMenus()
}

function closePickerMenus() {
  modelPickerOpen.value = false
  thinkingPickerOpen.value = false
  toolsPickerOpen.value = false
  startProjectPickerOpen.value = false
}

</script>

<template>
  <main
    class="leyline-app"
    :class="{
      'sidebar-open': sidebarOpen,
      'sidebar-hidden': desktopSidebarHidden,
      'start-state': !initializing && startFlowVisible,
      'new-session-transition': newSessionTransitionActive,
      'startup-composer-docking': startupComposerDocking || startupRevealHold,
      'startup-reveal-hold': startupRevealHold,
      'startup-reveal-settling': startupRevealSettling,
      'in-project-new-session-transition': inProjectTransitionActive,
      'in-project-composer-docking': inProjectComposerDocking,
      'session-handoff': sessionHandoff,
      'terminal-open': terminalOpen,
      'event-log-open': eventLogOpen,
    }"
    :style="{
      '--composer-reserved-height': composerReservedHeight,
      '--terminal-drawer-height': `${terminalDrawerHeight}px`,
    }"
  >
    <button
      v-if="sidebarOpen"
      class="sidebar-scrim"
      type="button"
      aria-label="Close sessions"
      @click="sidebarOpen = false"
    ></button>

    <button
      v-if="desktopSidebarHidden"
      class="sidebar-reveal-button"
      type="button"
      aria-label="Show sessions"
      @click="desktopSidebarHidden = false"
    >›</button>

    <ProjectBrowser
      v-if="projectBrowserOpen"
      :active-cwd="selectedSession?.cwd || ''"
      :busy="!!creatingSessionCwd"
      :initial-path="projectBrowserInitialPath"
      @close="closeProjectBrowser"
      @select="createSessionForCwd"
    />

    <SessionSidebar
      v-model:query="sessionQuery"
      :agent-running="agentRunning"
      :creating-session-cwd="creatingSessionCwd"
      :deleting-session-id="deletingSessionId"
      :expanded-project="isProjectExpanded"
      :highlighted-text="highlightedText"
      :reloading-session="reloadingSession"
      :selected-session="selectedSession"
      :selected-session-id="selectedSessionId"
      :session-status="sessionRuntimeStatus"
      :session-title="sessionTitle"
      :sessions-error="sessionsError"
      :sessions-loading="sessionsLoading"
      :summary="sidebarRuntimeSummary"
      :visible-projects="visibleProjects"
      @create-session="createSession"
      @hide="desktopSidebarHidden = true"
      @navigate-home="navigateHome"
      @open-project-browser="openProjectBrowser"
      @open-settings="toggleSettingsDrawer"
      @reload-session="reloadSession"
      @request-delete-session="requestDeleteSession"
      @retry-sessions="loadSessions"
      @select-session="selectSession"
      @toggle-project="toggleProject"
    />

    <section class="main-pane">
      <div v-if="runtimeChromeVisible" class="runtime-chrome">
        <header class="topbar">
        <button
          class="mobile-sidebar-button"
          type="button"
          aria-label="Open sessions"
          @click="sidebarOpen = true"
        >☰</button>
        <div class="topbar-project">
          <strong>{{ topbarTitle }}</strong>
          <span>{{ topbarSubtitle }}</span>
        </div>
        <div v-if="selectedSession" class="topbar-meta">
          <span v-if="compactingContext" class="running-pill">compacting</span>
          <span v-else-if="agentRunning" class="running-pill">running</span>
          <span v-if="goalPillLabel" class="goal-pill">
            {{ goalPillLabel }}
          </span>
          <span class="topbar-runtime-pill">{{ currentModelLabel }}</span>
          <span class="topbar-runtime-pill">{{ currentThinkingLabel }}</span>
          <template v-if="!isEmptySelectedSession">
            <button
              class="event-log-button"
              type="button"
              @click="toggleEventDrawer"
            >
              Events {{ runtimeEvents.length }}
            </button>
            <a
              class="event-log-button"
              :href="selectedSessionExportUrl"
            >Export</a>
            <button
              class="delete-session-button"
              type="button"
              title="Delete session"
              aria-label="Delete session"
              :disabled="deletingSessionId === selectedSession.id"
              @click="requestDeleteSession(selectedSession)"
            >
              <span v-if="deletingSessionId === selectedSession.id">…</span>
              <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3.5 4.5h9"></path>
                <path d="M6.5 4.5v-2h3v2"></path>
                <path d="M5 6.5l.5 6h5l.5-6"></path>
                <path d="M7 7.5v4"></path>
                <path d="M9 7.5v4"></path>
              </svg>
            </button>
            <span>{{ selectedSession.messageCount }} messages</span>
            <span>modified {{ formatDate(selectedSession.modified) }}</span>
          </template>
        </div>
        </header>

        <section v-if="activeGoal" class="goal-control-plane">
          <div class="goal-control-main">
            <span class="goal-control-kicker">Goal</span>
            <strong>{{ activeGoal.objective }}</strong>
            <span v-if="goalBudgetLabel">{{ goalBudgetLabel }}</span>
          </div>
          <div class="goal-control-actions">
            <button
              v-if="goalPrimaryAction"
              type="button"
              :disabled="!!goalCommandSubmitting"
              @click="runGoalCommand(goalPrimaryAction.command)"
            >
              {{ goalCommandSubmitting === goalPrimaryAction.command
                ? '…'
                : goalPrimaryAction.label }}
            </button>
            <button
              type="button"
              :disabled="!!goalCommandSubmitting"
              @click="runGoalCommand('clear')"
            >{{ goalCommandSubmitting === 'clear' ? '…' : 'Clear' }}</button>
          </div>
        </section>
      </div>


      <div
        ref="workbench"
        class="workbench"
        :class="{
          'init-workbench': initializing,
          'session-loading-workbench': sessionLoading,
          'session-handoff-workbench': sessionHandoff,
          'session-switching': sessionSwitching,
          'start-workbench-shell': !initializing && startFlowVisible,
          'startup-workbench': startupShellVisible,
          'in-project-startup-workbench': inProjectNewSessionRun,
          'empty-selected-workbench': emptySessionShellVisible && !startupRun,
        }"
        @scroll="handleWorkbenchScroll"
        @touchmove.passive="handleWorkbenchTouchMove"
        @wheel.passive="handleWorkbenchWheel"
      >
        <div
          v-if="initializing"
          class="init-panel transcript-skeleton-panel"
          aria-label="Loading workspace"
          aria-hidden="true"
        >
          <div class="transcript-skeleton-row skeleton-user-row">
            <div class="transcript-skeleton-bubble skeleton-user-bubble">
              <div class="skeleton-line skeleton-title"></div>
              <div class="skeleton-line"></div>
            </div>
          </div>
          <div class="transcript-skeleton-row skeleton-assistant-row">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
            <div class="skeleton-line shorter"></div>
          </div>
          <div class="transcript-skeleton-row skeleton-tool-row">
            <div class="skeleton-line skeleton-tool-title"></div>
            <div class="skeleton-line skeleton-tool-target"></div>
          </div>
          <div class="transcript-skeleton-row skeleton-assistant-row tail">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
        <div
          v-else-if="sessionHandoff"
          class="init-panel transcript-skeleton-panel session-handoff-init-panel"
          aria-label="Starting new session"
          aria-hidden="true"
        >
          <div class="transcript-skeleton-row skeleton-user-row">
            <div class="transcript-skeleton-bubble skeleton-user-bubble">
              <div class="skeleton-line skeleton-title"></div>
              <div class="skeleton-line"></div>
            </div>
          </div>
          <div class="transcript-skeleton-row skeleton-assistant-row">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
            <div class="skeleton-line shorter"></div>
          </div>
          <div class="transcript-skeleton-row skeleton-tool-row">
            <div class="skeleton-line skeleton-tool-title"></div>
            <div class="skeleton-line skeleton-tool-target"></div>
          </div>
          <div class="transcript-skeleton-row skeleton-assistant-row tail">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
        <div v-else-if="sessionError" class="empty-workbench error-note">
          {{ sessionError }}
        </div>
        <div
          v-else-if="startFlowVisible || startupRevealHold"
          class="start-panel"
        >
          <h2 class="start-headline-text">What should we work on?</h2>
          <div
            v-if="startupShellVisible"
            class="init-panel transcript-skeleton-panel startup-init-panel"
            aria-label="Starting new session"
            aria-hidden="true"
          >
            <div class="transcript-skeleton-row skeleton-user-row">
              <div class="transcript-skeleton-bubble skeleton-user-bubble">
                <div class="skeleton-line skeleton-title"></div>
                <div class="skeleton-line"></div>
              </div>
            </div>
            <div class="transcript-skeleton-row skeleton-assistant-row">
              <div class="skeleton-line skeleton-title"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line short"></div>
              <div class="skeleton-line shorter"></div>
            </div>
            <div class="transcript-skeleton-row skeleton-tool-row">
              <div class="skeleton-line skeleton-tool-title"></div>
              <div class="skeleton-line skeleton-tool-target"></div>
            </div>
            <div class="transcript-skeleton-row skeleton-assistant-row tail">
              <div class="skeleton-line skeleton-title"></div>
              <div class="skeleton-line"></div>
              <div class="skeleton-line short"></div>
            </div>
          </div>
          <StartComposer
            v-model:draft="draft"
            :class="{ 'activity-scanning-composer': startupShellVisible }"
            v-model:start-project-query="startProjectQuery"
            :attached-images="attachedImages"
            :available-models="availableModels"
            :available-thinking-levels="availableThinkingLevels"
            :chips="composerChips"
            :creating-session-cwd="creatingSessionCwd
              || startupRun?.cwd
              || startupRevealCwd
              || ''"
            :current-model-label="currentModelLabel"
            :current-thinking-label="currentThinkingLabel"
            :image-support-warning="imageSupportWarning"
            :model-key="modelKey"
            :model-picker-open="modelPickerOpen"
            :new-session-cwd="newSessionCwd"
            :selected-model-key="selectedModelKey"
            :slash-active-index="slashActiveIndex"
            :slash-command-items="slashCommandItems"
            :slash-command-source-label="slashCommandSourceLabel"
            :slash-picker-open="slashPickerOpen"
            :start-project-label="startProjectLabel"
            :start-project-options="startProjectOptions"
            :start-project-picker-open="startProjectPickerOpen"
            :switching-model="switchingModel"
            :switching-thinking="switchingThinking"
            :thinking-level="composerRuntime?.state?.thinkingLevel"
            :thinking-picker-open="thinkingPickerOpen"
            :tool-names="activeToolNames"
            :tools-chip-label="toolsChipLabel"
            :tools-picker-open="toolsPickerOpen"
            @keydown="handleStartComposerKeydown"
            @open-project-browser="openProjectBrowser"
            @paste="handleComposerPaste"
            @remove-image="removeAttachedImage"
            @select-model="selectModel"
            @select-project="selectStartProject"
            @select-slash-command="selectSlashCommand"
            @select-thinking="selectThinkingLevel"
            @show-slash-picker="showSlashPicker"
            @submit="submitStartDraft"
            @toggle-picker="togglePicker"
            @toggle-project-picker="startProjectPickerOpen = !startProjectPickerOpen"
          />
        </div>
        <div
          v-if="emptySessionShellVisible && !startupRun"
          class="empty-session-panel"
        >
          <h2>What should we work on in {{ topbarTitle }}?</h2>
        </div>
        <div
          v-if="inProjectNewSessionRun && !startupRun && !startupRevealHold"
          class="init-panel transcript-skeleton-panel in-project-init-panel"
          aria-label="Starting new session"
          aria-hidden="true"
        >
          <div class="transcript-skeleton-row skeleton-user-row">
            <div class="transcript-skeleton-bubble skeleton-user-bubble">
              <div class="skeleton-line skeleton-title"></div>
              <div class="skeleton-line"></div>
            </div>
          </div>
          <div class="transcript-skeleton-row skeleton-assistant-row">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
            <div class="skeleton-line shorter"></div>
          </div>
          <div class="transcript-skeleton-row skeleton-tool-row">
            <div class="skeleton-line skeleton-tool-title"></div>
            <div class="skeleton-line skeleton-tool-target"></div>
          </div>
          <div class="transcript-skeleton-row skeleton-assistant-row tail">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>

        <template
          v-if="selectedSession
            && !startupRun
            && !inProjectNewSessionRun
            && entries.length > 0"
        >
          <TranscriptEntry
            v-for="entry in entries"
            :key="entry.id"
            :class="{ 'message-enter': isEnteringEntry(entry) }"
            :copied-entry-id="copiedEntryId"
            :entry="entry"
            :skill-expanded="isSkillExpanded(entry)"
            :tool-expanded="isToolExpanded(entry)"
            @copy="copyEntry"
            @edit="startEditingEntry"
            @fork="forkSession"
            @mark-feedback="markEntryFeedback"
            @reset="resetSessionToEntry"
            @open-tool-fullscreen="openToolFullscreen"
            @toggle-skill="toggleSkill"
            @toggle-tool="toggleTool"
          />
        </template>

        <TransitionGroup
          v-if="!startupRun && !inProjectNewSessionRun"
          name="live-row"
          tag="div"
          class="live-stack"
          :class="{ 'is-active': liveTurnActive, 'is-running': agentRunning }"
        >
          <div
            v-for="item in liveFlowItems"
            :key="item.id"
            class="live-item"
            :class="liveItemClass(item)"
          >
            <TranscriptEntry
              v-if="item.type === 'message'"
              :copied-entry-id="copiedEntryId"
              :entry="item.persistedEntry || item"
              :skill-expanded="isSkillExpanded(item.persistedEntry || item)"
              @copy="copyEntry"
              @edit="startEditingEntry"
              @fork="forkSession"
              @mark-feedback="markEntryFeedback"
              @reset="resetSessionToEntry"
              @toggle-skill="toggleSkill"
            />

            <TranscriptEntry
              v-else-if="item.type === 'tool' && item.persistedEntry"
              :copied-entry-id="copiedEntryId"
              :entry="item.persistedEntry"
              :tool-expanded="isToolExpanded(item.persistedEntry)"
              @copy="copyEntry"
              @fork="forkSession"
              @mark-feedback="markEntryFeedback"
              @reset="resetSessionToEntry"
              @open-tool-fullscreen="openToolFullscreen"
              @toggle-tool="toggleTool"
            />

            <article
              v-else-if="item.type === 'tool'"
              class="tool-card transcript-tool live-tool-card"
              :class="{
                'is-running': item.status === 'running',
                'is-completed': item.status === 'completed',
                'error-card': item.status === 'error',
              }"
            >
              <div class="tool-card-header">
                <span class="live-tool-spinner"></span>
                <span>{{ item.label }}</span>
                <code v-if="item.code">{{ item.code }}</code>
                <em>{{ liveToolStatus(item) }}</em>
              </div>
            </article>

            <LiveAssistantMessage
              v-else-if="item.type === 'assistant'"
              :blocks="liveAssistantDisplayBlocks(item)"
              :copied-entry-id="copiedEntryId"
              :message-id="item.id"
              :persisted-entry="item.persistedEntry"
              :streaming="item.streaming"
              @copy="copyTranscriptItem(item.id, liveAssistantDisplayCopyText(item))"
              @fork="forkSession"
              @reset="resetSessionToEntry"
            />

          </div>
        </TransitionGroup>
      </div>

      <button
        v-if="hasNewOutput"
        class="jump-latest-button"
        type="button"
        @click="jumpToLatest"
      >
        <strong>Jump to latest</strong>
        <span aria-hidden="true">↓</span>
      </button>

      <Transition name="terminal-drawer">
        <section
          v-if="terminalOpen"
          class="terminal-panel"
        >
          <div
            class="terminal-resize-handle"
            role="separator"
            aria-label="Resize terminal"
            aria-orientation="horizontal"
            tabindex="0"
            @keydown.down.prevent="nudgeTerminalHeight(-24)"
            @keydown.up.prevent="nudgeTerminalHeight(24)"
            @pointerdown.prevent="startTerminalResize"
          ></div>
          <div class="terminal-header">
            <strong>Terminal</strong>
            <code>{{ terminalCwd || selectedSession?.cwd }}</code>
            <span>{{ terminalStatus }}</span>
            <button type="button" @click="closeTerminalPanel">×</button>
          </div>
          <div ref="terminalEl" class="terminal-frame"></div>
        </section>
      </Transition>

      <div
        v-if="selectedSession
          && !initializing
          && !emptySessionShellVisible
          && !startupRun"
        class="composer-fade"
        :class="{ 'is-switching': sessionLoading || sessionSwitching }"
      ></div>

      <SessionComposer
        v-if="selectedSession
          && !initializing
          && !startupRun"
        ref="composerRef"
        v-model:draft="draft"
        :agent-running="agentRunning"
        :attached-images="attachedImages"
        :compacting="compactingContext"
        :available-models="availableModels"
        :available-thinking-levels="availableThinkingLevels"
        :can-submit-draft="canSubmitDraft"
        :chips="composerChips"
        :current-mobile-model-label="currentMobileModelLabel"
        :current-mobile-thinking-label="currentMobileThinkingLabel"
        :current-model-label="currentModelLabel"
        :current-thinking-label="currentThinkingLabel"
        :context-usage-label="contextUsageLabel"
        :context-usage-level="contextUsageLevel"
        :context-usage-percent="contextUsagePercent"
        :context-usage-title="contextUsageTitle"
        :editing-label="editingLabel"
        :error="promptError || eventStreamError || imageSupportWarning"
        :interrupting="interrupting"
        :class="{
          'empty-session-composer': emptySessionShellVisible,
          'session-handoff-composer': sessionHandoff,
          'activity-scanning-composer': composerScannerVisible,
          'activity-scanner-settling': composerScannerSettling,
          'composer-committing': composerCommitPulse,
          'is-switching': sessionLoading || sessionSwitching,
        }"
        :model-key="modelKey"
        :model-picker-open="modelPickerOpen"
        :placeholder="composerPlaceholder"
        :prompt-submitting="promptSubmitting"
        :reloading-session="reloadingSession || sessionActivating"
        :queued-messages="queuedMessages"
        :selected-model-key="selectedModelKey"
        :send-button-label="sendButtonLabel"
        :slash-active-index="slashActiveIndex"
        :slash-command-items="slashCommandItems"
        :slash-command-source-label="slashCommandSourceLabel"
        :slash-picker-open="slashPickerOpen"
        :switching-model="switchingModel"
        :switching-thinking="switchingThinking"
        :terminal-open="terminalOpen"
        :terminal-status="terminalStatus"
        :thinking-level="composerRuntime?.state?.thinkingLevel"
        :thinking-picker-open="thinkingPickerOpen"
        :tool-names="activeToolNames"
        :tools-chip-label="toolsChipLabel"
        :tools-picker-open="toolsPickerOpen"
        @cancel-edit="cancelEditingEntry"
        @interrupt="interruptAgent"
        @keydown="handleComposerKeydown"
        @paste="handleComposerPaste"
        @remove-image="removeAttachedImage"
        @select-model="selectModel"
        @select-slash-command="selectSlashCommand"
        @select-thinking="selectThinkingLevel"
        @show-slash-picker="showSlashPicker"
        @submit="submitDraft"
        @toggle-picker="togglePicker"
        @toggle-terminal="toggleTerminal"
      />
    </section>

    <div
      v-if="deleteConfirmSession"
      class="confirm-backdrop"
      role="presentation"
      @click.self="cancelDeleteSession"
    >
      <section
        class="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-session-title"
      >
        <div class="confirm-icon">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 4.5h9"></path>
            <path d="M6.5 4.5v-2h3v2"></path>
            <path d="M5 6.5l.5 6h5l.5-6"></path>
            <path d="M7 7.5v4"></path>
            <path d="M9 7.5v4"></path>
          </svg>
        </div>
        <div class="confirm-copy">
          <h2 id="delete-session-title">Delete session?</h2>
          <p>
            Move “{{ sessionTitle(deleteConfirmSession) }}” to Leyline trash.
          </p>
          <p v-if="deleteSessionError" class="confirm-error">
            {{ deleteSessionError }}
          </p>
        </div>
        <div class="confirm-actions">
          <button
            type="button"
            class="confirm-cancel"
            :disabled="!!deletingSessionId"
            @click="cancelDeleteSession"
          >Cancel</button>
          <button
            type="button"
            class="confirm-delete"
            :disabled="!!deletingSessionId"
            @click="confirmDeleteSession"
          >{{ deleteSessionButtonLabel() }}</button>
        </div>
      </section>
    </div>

    <Transition name="event-drawer">
      <div v-if="settingsOpen" class="settings-drawer-slot">
        <aside class="settings-drawer" aria-label="Settings">
          <header class="settings-drawer-header">
            <div>
              <strong>Settings</strong>
              <span>Runtime and session state</span>
            </div>
            <button type="button" @click="settingsOpen = false">×</button>
          </header>

          <section class="settings-group">
            <h2>Runtime</h2>
            <dl>
              <div>
                <dt>Model</dt>
                <dd>{{ currentModelLabel }}</dd>
              </div>
              <div>
                <dt>Thinking</dt>
                <dd>{{ currentThinkingLabel }}</dd>
              </div>
              <div>
                <dt>Tools</dt>
                <dd>{{ toolsChipLabel }}</dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd>{{ contextUsageLabel || 'Unknown' }}</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{{ eventStreamLabel }}</dd>
              </div>
            </dl>
          </section>

          <section class="settings-group">
            <h2>Session</h2>
            <dl>
              <div>
                <dt>Project</dt>
                <dd>{{ projectName(selectedSession?.cwd) }}</dd>
              </div>
              <div>
                <dt>Session ID</dt>
                <dd class="settings-copy-row">
                  <span>{{ settingsSessionId || '—' }}</span>
                  <button
                    v-if="settingsSessionId"
                    type="button"
                    class="copy-button"
                    :title="copyTitle('settings-session-id')"
                    aria-label="Copy session ID"
                    @click="copyTranscriptItem('settings-session-id', settingsSessionId)"
                  >{{ copyGlyph('settings-session-id') }}</button>
                </dd>
              </div>
              <div>
                <dt>CWD</dt>
                <dd class="settings-copy-row">
                  <span>{{ settingsCwd || 'No session selected' }}</span>
                  <button
                    v-if="settingsCwd"
                    type="button"
                    class="copy-button"
                    :title="copyTitle('settings-cwd')"
                    aria-label="Copy CWD"
                    @click="copyTranscriptItem('settings-cwd', settingsCwd)"
                  >{{ copyGlyph('settings-cwd') }}</button>
                </dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd class="settings-copy-row">
                  <span>{{ settingsPath || '—' }}</span>
                  <button
                    v-if="settingsPath"
                    type="button"
                    class="copy-button"
                    :title="copyTitle('settings-path')"
                    aria-label="Copy path"
                    @click="copyTranscriptItem('settings-path', settingsPath)"
                  >{{ copyGlyph('settings-path') }}</button>
                </dd>
              </div>
              <div>
                <dt>Messages</dt>
                <dd>{{ selectedSession?.messageCount ?? '—' }}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </Transition>

    <Transition name="event-drawer">
      <div v-if="eventLogOpen" class="event-log-slot">
        <aside class="event-log-drawer" aria-label="Runtime events">
          <header class="event-log-drawer-header">
            <div>
              <strong>Runtime events</strong>
              <span>{{ runtimeEvents.length }} total</span>
            </div>
            <button type="button" @click="eventLogOpen = false">×</button>
          </header>
          <div v-if="eventLog.length === 0" class="event-log-empty">
            No events yet
          </div>
          <div
            v-for="item in eventLog"
            :key="item.loggedAt"
            class="event-log-row"
          >
            <time>{{ eventTime(item) }}</time>
            <code>{{ eventType(item) }}</code>
            <span>{{ eventSummary(item) }}</span>
          </div>
        </aside>
      </div>
    </Transition>

    <Transition name="tool-fullscreen">
      <div
        v-if="fullscreenTool"
        class="tool-fullscreen-backdrop"
        @click="closeToolFullscreen"
      >
        <section class="tool-fullscreen" @click.stop>
          <header class="tool-fullscreen-header">
            <div>
              <span>{{ fullscreenTool.label }}</span>
              <code v-if="fullscreenTool.code">{{ fullscreenTool.code }}</code>
            </div>
            <div>
              <button
                class="copy-button"
                type="button"
                :title="copyTitle(fullscreenTool.id)"
                @click="copyTranscriptItem(fullscreenTool.id, entryCopyText(fullscreenTool))"
              >
                {{ copyGlyph(fullscreenTool.id) }}
              </button>
              <button type="button" @click="closeToolFullscreen">×</button>
            </div>
          </header>
          <div class="tool-fullscreen-body">
            <div
              v-if="
                fullscreenTool.isError &&
                fullscreenTool.preview &&
                fullscreenTool.text
              "
              class="tool-error-summary"
            >
              <strong>Error</strong>
              <pre>{{ fullscreenTool.text }}</pre>
            </div>
            <div
              v-if="fullscreenTool.preview?.kind === 'image'"
              class="tool-fullscreen-image"
            >
              <img :src="imageSrc(fullscreenTool.preview)" alt="Read image preview" />
            </div>
            <PierrePreview
              v-else-if="fullscreenTool.preview"
              :preview="fullscreenTool.preview"
              :clipped="false"
            />
            <div v-else class="tool-fullscreen-plain">
              <pre
                v-if="renderedToolJson(fullscreenTool)"
                class="tool-output json-output"
                v-html="renderedToolJson(fullscreenTool)"
              ></pre>
              <pre v-else class="tool-output">{{ fullscreenTool.text }}</pre>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </main>
</template>
