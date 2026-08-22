<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue'
const TranscriptEntry = defineAsyncComponent(() => import('./components/TranscriptEntry.vue'))
const LiveAssistantMessage = defineAsyncComponent(() => import('./components/LiveAssistantMessage.vue'))
const PierrePreview = defineAsyncComponent(() => import('./components/PierrePreview.vue'))
const ProjectBrowser = defineAsyncComponent(() => import('./components/ProjectBrowser.vue'))
const ProjectDetailDrawer = defineAsyncComponent(() => import('./components/ProjectDetailDrawer.vue'))
const ReviewPane = defineAsyncComponent(() => import('./components/ReviewPane.vue'))
const ResearchSourcesPane = defineAsyncComponent(() => import('./components/ResearchSourcesPane.vue'))
const MemoryInspector = defineAsyncComponent(() => import('./components/MemoryInspector.vue'))
const SessionComposer = defineAsyncComponent(() => import('./components/SessionComposer.vue'))
const SubagentConfigDrawer = defineAsyncComponent(() => import('./components/SubagentConfigDrawer.vue'))
const VisionConfigDrawer = defineAsyncComponent(() => import('./components/VisionConfigDrawer.vue'))
import StartComposer from './components/StartComposer.vue'
import SessionSidebar from './components/SessionSidebar.vue'
import { useBackendConnections } from './composables/useBackendConnections'
import { useLiveTurnProjection } from './composables/useLiveTurnProjection'
import { useMemoryInspector } from './composables/useMemoryInspector'
import { useProjectBrowser } from './composables/useProjectBrowser'
import { useRuntimeEvents } from './composables/useRuntimeEvents'
import { useSessionWorkspace } from './composables/useSessionWorkspace'
import { useTerminal } from './composables/useTerminal'
import { useToolExpansion } from './composables/useToolExpansion'
import { useTranscriptPreferences } from './composables/useTranscriptPreferences'
import { useWorkbenchScroll } from './composables/useWorkbenchScroll'
import { backendDisplayAddress, backendHttpUrl } from './lib/backend'
import { fuzzyScore } from './lib/fuzzy'
import {
  eventTime,
  formatMode,
  modelChip,
  projectName,
  toolLabel,
  toolTarget,
} from './lib/format'
import {
  compactPiSession,
  editPrompt,
  fetchSessionDetailByPath,
  clearSubagentModelOverride,
  clearVisionOverride,
  fetchSubagentConfigs,
  fetchVisionConfig,
  interruptPiSession,
  runShellCommand,
  setEntryFeedback,
  setSubagentModelOverride,
  setVisionOverride,
  submitPrompt,
} from './lib/pi-api'
import {
  imageBlocksFor,
  imageSrc,
  messageBlocksFor,
  renderedToolJson,
  textFromBlocks,
  toolCommandCode,
} from './lib/transcript'

const sidebarOpen = ref(false)
const sidebarNavigator = ref('')
const desktopSidebarHidden = ref(false)
const draft = ref('')
const attachedImages = ref([])
const fullscreenImage = ref(null)
const workbench = ref(null)
const eventLogOpen = ref(false)
const settingsOpen = ref(false)
const backendConnectionFormOpen = ref(false)
const backendConnectionEditingId = ref('')
const backendConnectionName = ref('')
const backendConnectionUrl = ref('')
const subagentConfigOpen = ref(false)
const subagentConfigLoading = ref(false)
const subagentConfigSaving = ref(false)
const subagentConfigError = ref('')
const subagentConfigData = ref({ context: {}, agents: [] })
let subagentConfigRequestToken = 0
const visionConfigOpen = ref(false)
const visionConfigLoading = ref(false)
const visionConfigSaving = ref(false)
const visionConfigError = ref('')
const visionConfigData = ref({ context: {}, overrides: {}, model: '', modelSource: 'none' })
let visionConfigRequestToken = 0
const projectDetailCwd = ref('')
const reviewOpen = ref(false)
const reviewClosing = ref(false)
const reviewExpanded = ref(false)
const reviewPaneExpanded = ref(false)
const reviewPaneWidth = ref(420)
const reviewReady = ref(false)
const reviewOpenRequested = ref(false)
const reviewDesktopAvailable = ref(false)
const reviewRefreshToken = ref(0)
const reviewSummary = ref(defaultReviewSummary())
const researchSourcesOpen = ref(false)
const selectedResearchSourceId = ref(0)
const researchSourceRevealKey = ref(0)
const startSessionKind = ref('session')
const emptySessionKind = ref('session')
let researchSourcesDismissedSessionId = ''
const reviewLineCountFormatter = new Intl.NumberFormat('en', {
  maximumFractionDigits: 1,
  notation: 'compact',
})
const runtimeCwdBySessionId = new Map()
let reviewCloseTimer = null
let reviewDesktopQuery = null
let reviewExpansionTimer = null
const promptSubmitting = ref(false)
const interrupting = ref(false)
const goalCommandSubmitting = ref('')
const editingEntry = ref(null)
const seenEntryIds = ref(new Set())
const animatingEntryIds = ref(new Set())
const composerRef = ref(null)
const startComposerRef = ref(null)
const startupComposerDockLeft = ref('50%')
const startupComposerDockX = ref('0px')
const startupComposerDockY = ref('0px')
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
const vFocusSelect = {
  mounted(el) {
    requestAnimationFrame(() => {
      el.focus()
      el.select()
    })
  },
}
const {
  activeConnection: activeBackendConnection,
  activeConnectionAddress: activeBackendConnectionAddress,
  activeConnectionId: activeBackendConnectionId,
  activeConnectionInfo: activeBackendConnectionInfo,
  activateConnection: activateBackendConnection,
  busyId: backendConnectionBusyId,
  clearResult: clearBackendConnectionResult,
  connections: backendConnections,
  createConnection: createSavedBackendConnection,
  defaultConnectionId: defaultBackendConnectionId,
  error: backendConnectionError,
  initialize: initializeBackendConnections,
  inspectActiveConnection: inspectActiveBackendConnection,
  loading: backendConnectionsLoading,
  removeConnection: removeSavedBackendConnection,
  setDefault: setDefaultBackendConnection,
  testConnection: testBackendConnection,
  testResult: backendConnectionTestResult,
  updateConnection: updateSavedBackendConnection,
} = useBackendConnections()
const reviewEnabled = computed(() => {
  return activeBackendConnectionInfo.value?.capabilities?.review === true
})
const reviewWatchEnabled = computed(() => {
  return activeBackendConnectionInfo.value?.capabilities?.reviewWatch === true
})
const researchEnabled = computed(() => {
  return activeBackendConnectionInfo.value?.capabilities?.research === true
})
const reviewAvailable = computed(() => {
  return reviewEnabled.value && reviewDesktopAvailable.value
})
const reviewHasLineStats = computed(() => {
  const summary = reviewSummary.value
  return summary.state === 'ready'
    && summary.available
    && summary.lineStatsAvailable
    && (summary.additions > 0 || summary.deletions > 0)
})
const reviewAdditionText = computed(() => {
  if (!reviewHasLineStats.value || reviewSummary.value.additions < 1) return ''
  return `+${reviewLineCountFormatter.format(reviewSummary.value.additions)}`
})
const reviewDeletionText = computed(() => {
  if (!reviewHasLineStats.value || reviewSummary.value.deletions < 1) return ''
  return `−${reviewLineCountFormatter.format(reviewSummary.value.deletions)}`
})
const reviewFallbackBadgeText = computed(() => {
  const { conflicts, filesTruncated, state, totalFiles } = reviewSummary.value
  if (state === 'error') return '!'
  if (state !== 'ready' || totalFiles < 1 || reviewHasLineStats.value) return ''
  const count = filesTruncated || totalFiles > 99 ? '99+' : `${totalFiles}`
  return conflicts ? `!${count}` : count
})
const reviewToggleDescription = computed(() => {
  const summary = reviewSummary.value
  if (summary.state === 'loading') return 'Review changes · Reading Git status'
  if (summary.state === 'error') return 'Review changes · Git status unavailable'
  if (!summary.available) return 'Review changes · No Git repository'

  const parts = ['Review changes']
  if (summary.branch) parts.push(summary.branch)
  if (summary.totalFiles < 1) {
    parts.push('Working tree clean')
  } else {
    const count = summary.filesTruncated
      ? `${summary.totalFiles}+`
      : summary.totalFiles
    const fileLabel = summary.totalFiles === 1 && !summary.filesTruncated
      ? 'file'
      : 'files'
    parts.push(`${count} changed ${fileLabel}`)
    if (summary.conflicts) {
      parts.push(`${summary.conflicts} ${summary.conflicts === 1 ? 'conflict' : 'conflicts'}`)
    }
    if (summary.lineStatsAvailable) {
      if (summary.additions) parts.push(`${summary.additions.toLocaleString()} additions`)
      if (summary.deletions) parts.push(`${summary.deletions.toLocaleString()} deletions`)
    }
    if (!summary.filesTruncated) {
      if (summary.staged) parts.push(`${summary.staged} staged`)
      if (summary.working) parts.push(`${summary.working} working`)
    }
  }
  if (!reviewReady.value) parts.push('Preparing preview')
  return parts.join(' · ')
})
const {
  closeTerminalPanel,
  connectTerminal,
  terminalCwd,
  terminalEl,
  terminalOpen,
  terminalStatus,
  resizeTerminal,
  toggleTerminal,
  startTerminalResize,
  stopTerminalResize,
  nudgeTerminalHeight,
  setTerminalDrawerHeight,
  terminalDrawerHeight,
  disposeTerminalResize,
} = useTerminal()
const startupAcceptedFloorMs = 420
const inProjectNewSessionFloorMs = 1240
const initPhaseFloorMs = 340

const selectedSessionExportUrl = computed(() => {
  if (!selectedSession.value?.id) return ''
  return backendHttpUrl(
    `/api/pi/sessions/${encodeURIComponent(selectedSession.value.id)}/export`,
  )
})
const settingsSessionId = computed(() => {
  return selectedSession.value?.id || activeRuntimeSession.value?.id || ''
})
const settingsCwd = computed(() => selectedSession.value?.cwd || '')
const settingsPath = computed(() => {
  return selectedSession.value?.path || activeRuntimeSession.value?.path || ''
})
let initPhaseTimer = null
let sessionHydrationFrame = null
const pendingInitialNativeCwd = ref('')
let composerScannerSettlingTimer = null
let composerCommitTimer = null
let startupDockTimer = null
let startupRevealTimer = null
let newSessionSettlingTimer = null
let inProjectDockTimer = null
let inProjectSettlingTimer = null
let inProjectNewSessionStartedAt = 0
const workbenchScroll = useWorkbenchScroll({ workbench, composerRef })
const {
  composerHeight,
  stickToBottom,
  userScrollActive,
  hasNewOutput,
  composerReservedHeight,
  scrollToLatest,
  jumpToLatest,
  scheduleLiveScroll,
  handleWorkbenchScroll,
  handleWorkbenchWheel,
  handleWorkbenchTouchMove,
  resetWorkbenchScrollState,
  shouldFollowOutput,
  markNewOutput,
} = workbenchScroll
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
  shouldFollowOutput,
  markNewOutput,
})
const {
  activeGoal,
  activeRuntimeSession,
  availableModels,
  availableThinkingLevels,
  beginRenameSession,
  beginStartupRun,
  cancelDeleteProject,
  cancelDeleteSession,
  cancelRenameSession,
  commitRenameSession,
  composerRuntime,
  confirmDeleteProject,
  confirmDeleteSession,
  contextUsage,
  createSession: workspaceCreateSession,
  createSessionForCwd: workspaceCreateSessionForCwd,
  creatingSessionCwd,
  currentModelLabel,
  currentThinkingLabel,
  deleteConfirmProject,
  deleteConfirmSession,
  deleteProjectError,
  deleteProjectPhase,
  deleteSessionError,
  deleteSessionPhase,
  deletingProjectCwd,
  deletingSessionId,
  finishStartupRun,
  forkSession,
  handleNativeNewSession,
  handleRouteChange,
  hydrateSessions,
  initPhase,
  initializing,
  loadHomeProjects,
  loadRoutedSession,
  loadSessions,
  loadSidebarProjects,
  loadStartRuntimeState,
  navigateHome: workspaceNavigateHome,
  newSessionCwd,
  patchRuntimeExtensionUi,
  reloadSession,
  reloadingSession,
  renameDraft,
  renamingSessionId,
  renamingSessionSavingId,
  renamingSessionSource,
  requestDeleteProject,
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
  sessionHandoffSettling,
  sessionIdFromRoute,
  sessionLoading,
  sessionRuntimeStatus,
  sessions,
  sessionsError,
  sessionsHydrated,
  sessionsHydrating,
  sessionsHydrationError,
  sessionsLoading,
  sessionSwitching,
  sessionTitle,
  sidebarActivitySessions,
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
workbenchScroll.bind({ selectedSessionId, liveItems })
const selectedResearch = computed(() => {
  return activeRuntimeSession.value?.state?.research
    || selectedSession.value?.research
    || null
})
const isResearchSession = computed(() => Boolean(selectedResearch.value))
const researchPhaseSteps = ['plan', 'gather', 'synthesize', 'report']
const researchPhaseIndex = computed(() => {
  return Math.max(0, researchPhaseSteps.indexOf(selectedResearch.value?.phase))
})
const researchPhaseTitle = computed(() => {
  const research = selectedResearch.value
  if (!research) return ''
  if (research.status === 'complete') return 'Research complete'
  if (research.status === 'error') return 'Research interrupted'
  if (research.phase === 'gather') return 'Gathering evidence'
  if (research.phase === 'synthesize') return 'Synthesizing findings'
  if (research.phase === 'report') return 'Writing report'
  return 'Planning research'
})
const researchPhaseSummary = computed(() => {
  const research = selectedResearch.value
  if (!research) return ''
  if (research.phase === 'gather' && research.threadCount) {
    return `${research.completedThreadCount} of ${research.threadCount} threads complete · ${research.sourceCount} sources`
  }
  const parts = []
  if (research.threadCount) parts.push(`${research.threadCount} threads`)
  if (research.sourceCount) parts.push(`${research.sourceCount} sources`)
  if (research.status === 'complete') {
    parts.push(`${research.citedSourceCount} cited`)
    if (research.excludedSourceCount) {
      parts.push(`${research.excludedSourceCount} excluded`)
    }
  }
  return parts.join(' · ') || 'Preparing the research plan'
})
const startHeadline = computed(() => {
  return startSessionKind.value === 'research'
    ? 'What should we investigate?'
    : 'What should we work on?'
})

watch(researchEnabled, (enabled) => {
  if (enabled) return
  startSessionKind.value = 'session'
  emptySessionKind.value = 'session'
})

watch(
  () => [
    selectedSessionId.value,
    selectedResearch.value?.sourceCount || 0,
  ],
  ([sessionId, sourceCount], [previousSessionId] = []) => {
    if (sessionId !== previousSessionId) {
      selectedResearchSourceId.value = selectedResearch.value?.sources?.[0]?.id || 0
      if (researchSourcesDismissedSessionId !== sessionId) {
        researchSourcesDismissedSessionId = ''
      }
    }
    if (!selectedResearch.value || !sourceCount) {
      researchSourcesOpen.value = false
      return
    }
    if (researchSourcesDismissedSessionId === sessionId) return
    if (window.matchMedia('(min-width: 761px)').matches) openResearchSources()
  },
)

watch(
  () => visionSessionKey(scopedConfigTarget()),
  () => {
    if (subagentConfigOpen.value) void loadSubagentConfigs()
    void loadVisionConfig()
  },
)
const {
  projectBrowserOpen,
  projectBrowserInitialPath,
  startProjectPickerOpen,
  startProjectQuery,
  startProjectOptions,
  startProjectLabel,
  selectStartProject,
  openProjectBrowser,
  closeProjectBrowser,
} = useProjectBrowser({
  visibleProjects,
  newSessionCwd,
  selectedSession,
})
const projectDetailProject = computed(() => {
  const cwd = projectDetailCwd.value
  if (!cwd) return null

  const projectSessions = sessions.value
    .filter((session) => (session.cwd || 'unknown') === cwd)
    .sort((a, b) => sessionSortTime(b) - sessionSortTime(a))

  if (!projectSessions.length) return null
  return { cwd, name: projectName(cwd), sessions: projectSessions }
})
const toolExpansion = useToolExpansion({ liveAssistantBlocks })
const {
  expandedTools,
  expandedSkills,
  copiedEntryId,
  fullscreenTool,
  isToolExpanded,
  toggleTool,
  openToolFullscreen,
  closeToolFullscreen,
  isSkillExpanded,
  toggleSkill,
  entryCopyText,
  liveAssistantDisplayBlocks,
  liveAssistantCopyText,
  liveAssistantDisplayCopyText,
  copyEntry,
  copyTranscriptItem,
  copyTitle,
  copyGlyph,
} = toolExpansion
const transcriptPreferences = useTranscriptPreferences()
const {
  error: transcriptPreferencesError,
  load: loadTranscriptPreferences,
  setThinkingDefault,
  thinkingDefault,
} = transcriptPreferences
const thinkingInitiallyExpanded = computed(
  () => thinkingDefault.value === 'expanded',
)
const {
  memoryOpen,
  memoryDirty,
  memoryLoading,
  memorySaving,
  memoryError,
  memoryData,
  memoryEnabled,
  memoryActiveCount,
  toggleMemoryDrawer,
  closeMemoryDrawer,
  confirmDiscardMemoryChanges,
  loadVisibleMemory,
  createMemory,
  updateMemory,
  archiveMemories,
  restoreMemories,
  deleteMemories,
} = useMemoryInspector({
  selectedSession,
  selectedSessionId,
  sessionLoading,
  liveTurnActive,
  settingsOpen,
  eventLogOpen,
})
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
    if (activeSession.id && activeSession.cwd) {
      runtimeCwdBySessionId.set(activeSession.id, activeSession.cwd)
    }
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
    updateRuntimeEventState(data)
    if (runtimeEventSettled(data.event)) {
      invalidateReview(runtimeCwd(data.activeSessionId))
    }
    liveTurn.handle({ kind: 'runtime', ...data })
  },
  onExtensionUi(data) {
    if (data.activeSessionId !== selectedSessionId.value) return
    patchRuntimeExtensionUi(data.state, data.goal)
    surfaceExtensionNotification(data.state)
  },
  onExtensionError(data) {
    if (data.activeSessionId !== selectedSessionId.value) return
    promptError.value = data.error?.message || data.error || 'Extension error'
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
  const command = draft.value.trim().startsWith('/')
    ? draft.value.trim().slice(1).split(/\s/, 1)[0]
    : ''
  if (command && slashCommands.value.some((item) => {
    return item.source === 'extension' && item.name === command
  })) return 'Extension commands cannot include image attachments.'
  if (visionConfigSaving.value) return 'Wait for the vision model setting to finish saving.'
  if (visionConfigData.value?.model) return ''
  return `${modelChip(model)} does not support images and no vision model is configured. Open Settings → Vision to set a default vision model.`
})
const visionDelegationNotice = computed(() => {
  if (shellModeDraft.value || !attachedImages.value.length) return ''
  const model = composerRuntime.value?.state?.model
  if (!model || model.supportsImages) return ''
  const visionModel = visionConfigData.value?.model
  if (!visionModel) return ''
  return `${modelChip(model)} can't read images directly. The model will call the vision subagent (${visionModel}) to inspect the image${attachedImages.value.length > 1 ? 's' : ''} when the prompt runs.`
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
const isEmptySelectedSession = computed(() => {
  return Boolean(selectedSession.value)
    && entries.value.length === 0
    && !liveTurnActive.value
})
const selectedSessionHasMessages = computed(() => {
  return Number(selectedSession.value?.messageCount || 0) > 0
})
const composerResearchMode = computed(() => {
  return isResearchSession.value || emptySessionKind.value === 'research'
})
const canToggleEmptySessionResearch = computed(() => {
  return researchEnabled.value
    && Boolean(selectedSession.value)
    && !isResearchSession.value
    && !selectedSessionHasMessages.value
    && !liveTurnActive.value
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
  if (agentRunning.value && isResearchSession.value) {
    return 'Steer this research; your message reaches the lead at the next checkpoint'
  }
  if (agentRunning.value) {
    return 'Type to steer the current run; Option+Enter queues follow-up'
  }
  if (selectedResearch.value?.status === 'complete') {
    return 'Ask a follow-up or request a report revision'
  }
  if (isEmptySelectedSession.value && composerResearchMode.value) {
    return 'Describe the research question, constraints, and desired report'
  }
  if (isEmptySelectedSession.value) return 'Describe the first task or attach images'
  return 'Ask for follow-up changes or attach images'
})
const startupShellVisible = computed(() => {
  return Boolean(startupRun.value || startupRevealHold.value)
})
const startupLoadingVisible = computed(() => {
  return startupComposerDocking.value
})
const startFlowVisible = computed(() => {
  if (startupRun.value) return true
  if (sessionLoading.value || sessionSwitching.value) return false
  return !selectedSession.value
})
const backendUnavailable = computed(() => {
  return !initializing.value
    && !selectedSession.value
    && sessions.value.length === 0
    && Boolean(sessionsError.value)
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
  updateNativeWindowCwd()
})

watch(activeRuntimeSession, (session) => {
  if (session?.id !== selectedSessionId.value) return
  liveTurn.setRuntimeState(session.state)
})

watch(reviewAvailable, (available) => {
  if (available) return
  reviewReady.value = false
  reviewOpenRequested.value = false
  resetReviewSummary()
  closeReview(true)
})

watch(settingsCwd, (cwd, previousCwd) => {
  if (cwd === previousCwd) return
  reviewReady.value = false
  resetReviewSummary()
  const reopen = reviewOpen.value || reviewOpenRequested.value
  closeReview(true)
  reviewOpenRequested.value = reopen && !!cwd
})

watch(selectedSessionId, () => {
  emptySessionKind.value = 'session'
  updateNativeWindowCwd()
  if (!selectedSessionId.value) {
    reviewReady.value = false
    reviewOpenRequested.value = false
    closeReview(true)
  }
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

onMounted(async () => {
  reviewDesktopQuery = window.matchMedia('(min-width: 1121px)')
  reviewDesktopAvailable.value = reviewDesktopQuery.matches
  reviewDesktopQuery.addEventListener('change', handleReviewDesktopChange)
  window.addEventListener('keydown', handleGlobalKeydown, true)
  window.addEventListener('click', closeMenusOnOutsideClick)
  window.addEventListener('popstate', handleRouteChange)
  window.addEventListener('leyline:new-session', handleNativeNewSession)
  window.addEventListener('leyline:toggle-terminal', handleNativeToggleTerminal)
  window.addEventListener('leyline:open-settings', handleNativeOpenSettings)
  window.addEventListener('leyline:toggle-memory', handleNativeToggleMemory)
  window.addEventListener('leyline:toggle-sidebar', handleNativeToggleSidebar)
  window.addEventListener('leyline:escape', handleNativeEscape)
  await initializeBackendConnections()
  await loadTranscriptPreferences()
  updateNativeWindowCwd()
  pendingInitialNativeCwd.value = consumeInitialNativeNewSessionCwd()
  await loadBackendWorkspace()
})

onUnmounted(() => {
  reviewDesktopQuery?.removeEventListener('change', handleReviewDesktopChange)
  window.removeEventListener('keydown', handleGlobalKeydown, true)
  window.removeEventListener('click', closeMenusOnOutsideClick)
  window.removeEventListener('popstate', handleRouteChange)
  window.removeEventListener('leyline:new-session', handleNativeNewSession)
  window.removeEventListener('leyline:toggle-terminal', handleNativeToggleTerminal)
  window.removeEventListener('leyline:open-settings', handleNativeOpenSettings)
  window.removeEventListener('leyline:toggle-memory', handleNativeToggleMemory)
  window.removeEventListener('leyline:toggle-sidebar', handleNativeToggleSidebar)
  window.removeEventListener('leyline:escape', handleNativeEscape)
  delete window.__leylineBackendConnectionId
  delete window.__leylineCurrentCwd
  disposeTerminalResize()
  closeEventStream()
  sessionWorkspace.dispose()
  closeTerminalPanel()
  disposeLiveTurn()
  workbenchScroll.dispose()
  toolExpansion.dispose()
  clearTimeout(initPhaseTimer)
  cancelAnimationFrame(sessionHydrationFrame)
  clearTimeout(composerScannerSettlingTimer)
  clearTimeout(composerCommitTimer)
  clearTimeout(startupDockTimer)
  clearTimeout(startupRevealTimer)
  clearTimeout(newSessionSettlingTimer)
  clearTimeout(inProjectDockTimer)
  clearTimeout(inProjectSettlingTimer)
  clearTimeout(reviewCloseTimer)
  clearTimeout(reviewExpansionTimer)
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

function setSidebarNavigator(navigator) {
  sidebarNavigator.value = navigator
  if (!navigator) return
  settingsOpen.value = false
  subagentConfigOpen.value = false
  visionConfigOpen.value = false
  eventLogOpen.value = false
  projectDetailCwd.value = ''
  if (memoryOpen.value) closeMemoryDrawer()
}

function selectSidebarProject(project) {
  if (!project?.cwd) return
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  workspaceNavigateHome()
  selectStartProject(project.cwd)
  closeReview(true)
  projectDetailCwd.value = ''
  sidebarNavigator.value = ''
}

async function createSession(project, options = {}) {
  sidebarNavigator.value = ''
  await workspaceCreateSession(project, options)
  projectBrowserOpen.value = false
  projectDetailCwd.value = ''
  sidebarOpen.value = false
}

async function createSessionForCwd(cwd, options = {}) {
  await workspaceCreateSessionForCwd(cwd, options)
  projectBrowserOpen.value = false
  projectDetailCwd.value = ''
  sidebarOpen.value = false
}

async function selectSession(session, options) {
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  sidebarNavigator.value = ''
  await workspaceSelectSession(session, options)
  projectDetailCwd.value = ''
  sidebarOpen.value = false
}

async function navigateParentSession() {
  const parentPath = selectedSession.value?.parentSessionPath
  if (!parentPath) return

  const parent = sessions.value.find((session) => session.path === parentPath)
  if (parent) {
    await selectSession(parent)
    return
  }

  const detail = await fetchSessionDetailByPath(parentPath)
  await selectSession({
    id: detail.session.id,
    path: detail.session.path,
    cwd: detail.session.cwd,
  })
}

async function navigateChildSession(childSession) {
  if (!childSession) return

  const session = sessions.value.find((s) => s.id === childSession.id)
  if (session) {
    await selectSession(session)
    return
  }

  const childSessionObj = {
    id: childSession.id,
    path: childSession.path,
    cwd: childSession.cwd,
  }
  await selectSession(childSessionObj)
}

function openProjectDetail(project) {
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  sidebarNavigator.value = ''
  projectDetailCwd.value = project.cwd
  settingsOpen.value = false
  subagentConfigOpen.value = false
  visionConfigOpen.value = false
  eventLogOpen.value = false
  if (memoryOpen.value) closeMemoryDrawer()
}

function closeProjectDetail() {
  projectDetailCwd.value = ''
}

const deleteConfirmActive = computed(() => {
  return !!deleteConfirmSession.value || !!deleteConfirmProject.value
})
const confirmDeleteBusy = computed(() => {
  return !!(deletingSessionId.value || deletingProjectCwd.value)
})
const confirmDeleteLabel = computed(() => {
  return deleteSessionPhase.value === 'deleting'
    || deleteProjectPhase.value === 'deleting'
    ? 'Deleting…'
    : 'Delete'
})
const confirmDeleteError = computed(() => {
  return deleteSessionError.value || deleteProjectError.value
})
const confirmDeleteTitleId = computed(() => {
  return deleteConfirmProject.value
    ? 'delete-project-title'
    : 'delete-session-title'
})
const projectDeleteSessionCount = computed(() => {
  const project = deleteConfirmProject.value
  if (!project) return 0
  return sessions.value.filter((session) => {
    return session.cwd === project.cwd
  }).length
})
function cancelConfirmDelete() {
  cancelDeleteSession()
  cancelDeleteProject()
}
function confirmPendingDelete() {
  if (deleteConfirmProject.value) confirmDeleteProject()
  else confirmDeleteSession()
}

async function handleNativeToggleTerminal() {
  if (!selectedSession.value || initializing.value) return

  await toggleTerminal()
}

function handleNativeOpenSettings() {
  toggleSettingsDrawer()
}

function handleNativeToggleMemory() {
  toggleMemoryPanel()
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

function sessionSortTime(session) {
  const time = new Date(
    session?.modified || session?.timestamp || 0,
  ).getTime()
  return Number.isNaN(time) ? 0 : time
}

function defaultReviewSummary() {
  return {
    additions: 0,
    available: true,
    branch: '',
    conflicts: 0,
    deletions: 0,
    filesTruncated: false,
    lineStatsAvailable: false,
    staged: 0,
    state: 'loading',
    totalFiles: 0,
    working: 0,
  }
}

function resetReviewSummary() {
  reviewSummary.value = defaultReviewSummary()
}

function handleReviewSummary(summary) {
  reviewSummary.value = { ...defaultReviewSummary(), ...summary }
}

function reviewMotionDuration() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 240
}

function researchPhaseClass(phase) {
  const index = researchPhaseSteps.indexOf(phase)
  return {
    done: selectedResearch.value?.status === 'complete'
      || index < researchPhaseIndex.value,
    current: selectedResearch.value?.status !== 'complete'
      && index === researchPhaseIndex.value,
  }
}

function researchPhaseLabel(phase) {
  return phase.charAt(0).toUpperCase() + phase.slice(1)
}

function openResearchSources(sourceId = 0) {
  if (!selectedResearch.value?.sourceCount) return
  closeReview(true)
  if (sourceId) selectedResearchSourceId.value = Number(sourceId)
  if (!selectedResearchSourceId.value) {
    selectedResearchSourceId.value = selectedResearch.value.sources?.[0]?.id || 0
  }
  researchSourcesDismissedSessionId = ''
  researchSourcesOpen.value = true
}

function closeResearchSources(dismiss = true) {
  researchSourcesOpen.value = false
  if (dismiss) researchSourcesDismissedSessionId = selectedSessionId.value
}

function toggleResearchSources() {
  if (researchSourcesOpen.value) closeResearchSources()
  else openResearchSources()
}

function selectResearchSource(sourceId) {
  selectedResearchSourceId.value = Number(sourceId || 0)
}

function openResearchSource(payload) {
  researchSourceRevealKey.value++
  openResearchSources(payload?.id)
}

function openReview() {
  closeResearchSources(true)
  if (!reviewReady.value) {
    reviewOpenRequested.value = true
    return
  }
  clearTimeout(reviewCloseTimer)
  reviewOpenRequested.value = false
  reviewClosing.value = false
  if (!reviewExpanded.value) reviewPaneExpanded.value = false
  reviewOpen.value = true
}

function closeReview(immediate = false) {
  clearTimeout(reviewCloseTimer)
  clearTimeout(reviewExpansionTimer)
  reviewOpenRequested.value = false
  if (immediate) {
    reviewOpen.value = false
    reviewClosing.value = false
    reviewExpanded.value = false
    reviewPaneExpanded.value = false
    return
  }
  if (!reviewOpen.value) return
  reviewOpen.value = false
  reviewClosing.value = true
  reviewCloseTimer = window.setTimeout(
    finishReviewClose,
    reviewMotionDuration(),
  )
}

function finishReviewClose() {
  clearTimeout(reviewCloseTimer)
  if (!reviewClosing.value) return
  reviewClosing.value = false
  reviewExpanded.value = false
  reviewPaneExpanded.value = false
}

function handleReviewPreparing() {
  reviewReady.value = false
}

function handleReviewPrepared() {
  reviewReady.value = true
  if (reviewOpenRequested.value) openReview()
}

function handleReviewDesktopChange(event) {
  reviewDesktopAvailable.value = event.matches
}

function invalidateReview(cwd) {
  if (!cwd || cwd !== settingsCwd.value || !reviewAvailable.value) return
  reviewRefreshToken.value++
}

function runtimeCwd(sessionId) {
  return runtimeCwdBySessionId.get(sessionId)
    || sessions.value.find((session) => session.id === sessionId)?.cwd
    || ''
}

function runtimeEventSettled(event) {
  return ['agent_end', 'error', 'aborted'].includes(event?.type)
}

function collapseReviewExpanded() {
  if (!reviewPaneExpanded.value) return
  clearTimeout(reviewExpansionTimer)
  reviewExpanded.value = false
  reviewExpansionTimer = window.setTimeout(() => {
    if (!reviewExpanded.value) reviewPaneExpanded.value = false
  }, reviewMotionDuration())
}

function toggleReview() {
  if (reviewOpen.value) {
    closeReview()
    return
  }
  if (reviewOpenRequested.value) {
    reviewOpenRequested.value = false
    return
  }
  openReview()
}

function toggleReviewExpanded() {
  if (!reviewOpen.value) return
  if (reviewExpanded.value) {
    collapseReviewExpanded()
    return
  }
  clearTimeout(reviewExpansionTimer)
  reviewPaneExpanded.value = true
  reviewExpanded.value = true
}

function navigateHome() {
  workspaceNavigateHome()
  closeReview(true)
  closeResearchSources(false)
  sidebarNavigator.value = ''
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
  if (type === 'extension_error') {
    return event.error?.message || event.error || 'extension error'
  }
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

function isLiveSubagentTool(item) {
  return item.toolName === 'subagent'
}

function liveSubagentTarget(item) {
  const agent = item.label?.replace(/^Subagent · /, '') || ''
  if (agent && agent !== 'subagent' && agent !== item.code) return agent
  return item.code || ''
}

function liveItemClass(item) {
  return [
    `live-${item.type}-item`,
    item.status ? `is-${item.status}` : '',
    item.persistedEntry ? 'is-persisted' : '',
    item.streaming ? 'is-streaming' : '',
  ]
}


function openSettingsDrawer() {
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  settingsOpen.value = true
  subagentConfigOpen.value = false
  visionConfigOpen.value = false
  eventLogOpen.value = false
  memoryOpen.value = false
  projectDetailCwd.value = ''
}

function toggleSettingsDrawer() {
  if (settingsOpen.value) {
    settingsOpen.value = false
    return
  }
  openSettingsDrawer()
}

async function verifyActiveBackendConnection() {
  try {
    await inspectActiveBackendConnection()
    return true
  } catch (error) {
    sessionsError.value = error.message
    sessionsLoading.value = false
    initPhase.value = 'sessions'
    return false
  }
}

async function loadBackendWorkspace() {
  if (!await verifyActiveBackendConnection()) return
  if (pendingInitialNativeCwd.value) {
    newSessionCwd.value = pendingInitialNativeCwd.value
  }
  openEventStream()
  initPhase.value = 'sessions'

  if (pendingInitialNativeCwd.value) {
    void loadSidebarProjects()
    scheduleSessionHydration()
    await waitInitPhaseFloor()
    const cwd = pendingInitialNativeCwd.value
    try {
      await handleNativeNewSession({ detail: { cwd } })
      if (selectedSession.value?.cwd === cwd) pendingInitialNativeCwd.value = ''
    } finally {
      sessionsLoading.value = false
      initPhase.value = 'sessions'
    }
    return
  }

  const routeSessionId = sessionIdFromRoute()
  if (!routeSessionId) {
    if (await loadHomeProjects()) {
      scheduleSessionHydration()
      return
    }
    await loadSessions()
    return
  }

  void loadSidebarProjects()
  void loadRoutedSession(routeSessionId)
  scheduleSessionHydration()
}

function scheduleSessionHydration() {
  cancelAnimationFrame(sessionHydrationFrame)
  sessionHydrationFrame = window.requestAnimationFrame(() => {
    sessionHydrationFrame = null
    void hydrateSessions()
  })
}

async function retryBackendConnection() {
  sessionsLoading.value = true
  sessionError.value = ''
  sessionsError.value = ''
  await loadBackendWorkspace()
}

async function retrySessions() {
  if (sessionsHydrationError.value) {
    await hydrateSessions()
    return
  }
  await retryBackendConnection()
}

async function switchBackendConnection(connection) {
  if (!connection || connection.id === activeBackendConnectionId.value) return
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  if (!confirmBackendDisconnect(connection.name)) return

  try {
    await activateBackendConnection(connection.id)
  } catch {
    openSettingsDrawer()
  }
}

function confirmBackendDisconnect(targetName) {
  const notices = []
  if (agentRunning.value) {
    notices.push(`The current run will continue on ${activeBackendConnection.value.name}.`)
  }
  if (draft.value.trim() || attachedImages.value.length) {
    notices.push('The unsent composer draft will be cleared.')
  }
  if (!notices.length) return true
  notices.push(`Switch this window to ${targetName}?`)
  return window.confirm(notices.join('\n\n'))
}

function beginCreateBackendConnection() {
  clearBackendConnectionResult()
  backendConnectionEditingId.value = ''
  backendConnectionName.value = ''
  backendConnectionUrl.value = ''
  backendConnectionFormOpen.value = true
}

function beginEditBackendConnection(connection) {
  clearBackendConnectionResult()
  backendConnectionEditingId.value = connection.id
  backendConnectionName.value = connection.name
  backendConnectionUrl.value = connection.url
  backendConnectionFormOpen.value = true
}

function cancelBackendConnectionForm() {
  backendConnectionFormOpen.value = false
  backendConnectionEditingId.value = ''
  backendConnectionName.value = ''
  backendConnectionUrl.value = ''
  clearBackendConnectionResult()
}

function backendConnectionDraft() {
  const name = backendConnectionName.value.trim()
  const url = backendConnectionUrl.value.trim()
  if (!name) throw new Error('Connection name is required')
  if (!url) throw new Error('Backend URL is required')
  return {
    id: backendConnectionEditingId.value || 'draft',
    name,
    url,
    builtIn: false,
  }
}

async function testBackendConnectionDraft() {
  try {
    await testBackendConnection(backendConnectionDraft())
  } catch (error) {
    backendConnectionError.value = error.message
  }
}

async function saveBackendConnection() {
  let draftConnection
  try {
    draftConnection = backendConnectionDraft()
  } catch (error) {
    backendConnectionError.value = error.message
    return
  }

  const existing = backendConnections.value.find((connection) => {
    return connection.id === backendConnectionEditingId.value
  })
  const reconnectsCurrent = existing?.id === activeBackendConnectionId.value
    && existing.url !== draftConnection.url
  if (reconnectsCurrent && !confirmBackendDisconnect(draftConnection.name)) return

  try {
    await testBackendConnection(draftConnection)
    if (backendConnectionEditingId.value) {
      const result = await updateSavedBackendConnection(
        backendConnectionEditingId.value,
        draftConnection.name,
        draftConnection.url,
      )
      cancelBackendConnectionForm()
      if (result.requiresReconnect) {
        await activateBackendConnection(result.connection.id, { skipTest: true })
      }
      return
    }

    await createSavedBackendConnection(draftConnection.name, draftConnection.url)
    cancelBackendConnectionForm()
  } catch (error) {
    backendConnectionError.value = error.message
  }
}

async function testSavedBackendConnection(connection) {
  try {
    await testBackendConnection(connection)
  } catch {
  }
}

async function makeDefaultBackendConnection(connection) {
  try {
    await setDefaultBackendConnection(connection.id)
  } catch {
  }
}

async function deleteBackendConnection(connection) {
  if (!window.confirm(`Remove the ${connection.name} backend connection?`)) return
  try {
    await removeSavedBackendConnection(connection.id)
  } catch {
  }
}

function toggleEventDrawer() {
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  eventLogOpen.value = !eventLogOpen.value
  settingsOpen.value = false
  subagentConfigOpen.value = false
  visionConfigOpen.value = false
  memoryOpen.value = false
  if (eventLogOpen.value) projectDetailCwd.value = ''
}

function toggleMemoryPanel() {
  const wasOpen = memoryOpen.value
  toggleMemoryDrawer()
  if (!wasOpen && memoryOpen.value) {
    projectDetailCwd.value = ''
    subagentConfigOpen.value = false
    visionConfigOpen.value = false
  }
}

async function openSubagentConfig() {
  settingsOpen.value = false
  eventLogOpen.value = false
  memoryOpen.value = false
  projectDetailCwd.value = ''
  subagentConfigOpen.value = true
  visionConfigOpen.value = false
  if (!scopedConfigTarget()?.cwd) {
    subagentConfigLoading.value = false
    subagentConfigSaving.value = false
    subagentConfigError.value = 'No project selected yet. Open a session or choose a project to manage agents.'
    subagentConfigData.value = { context: {}, agents: [] }
    return
  }
  await loadSubagentConfigs()
}

function scopedConfigTarget() {
  const session = selectedSession.value
  if (session?.cwd) return session
  const cwd = newSessionCwd.value.trim()
  return cwd ? { cwd } : null
}

function subagentSessionKey(session) {
  return `${session?.cwd || ''}:${session?.id || ''}:${session?.sessionFile || session?.path || ''}`
}

let subagentConfigActiveKey = ''

function currentSubagentRequest(token, sessionKey) {
  return token === subagentConfigRequestToken
    && sessionKey === subagentConfigActiveKey
}

async function loadSubagentConfigs() {
  const target = scopedConfigTarget()
  if (!target?.cwd) return
  const token = ++subagentConfigRequestToken
  const sessionKey = subagentSessionKey(target)
  subagentConfigActiveKey = sessionKey
  subagentConfigLoading.value = true
  subagentConfigSaving.value = false
  subagentConfigError.value = ''
  try {
    const data = await fetchSubagentConfigs(target)
    if (currentSubagentRequest(token, sessionKey)) subagentConfigData.value = data
  } catch (error) {
    if (currentSubagentRequest(token, sessionKey)) {
      subagentConfigError.value = error.message || 'Failed to load subagents'
    }
  } finally {
    if (currentSubagentRequest(token, sessionKey)) subagentConfigLoading.value = false
  }
}

async function saveSubagentModel(payload) {
  const target = scopedConfigTarget()
  if (!target?.cwd) return
  const token = ++subagentConfigRequestToken
  const sessionKey = subagentSessionKey(target)
  subagentConfigActiveKey = sessionKey
  subagentConfigSaving.value = true
  subagentConfigError.value = ''
  try {
    const data = await setSubagentModelOverride(
      target,
      payload.agentKey,
      payload.scope,
      payload.model,
    )
    if (currentSubagentRequest(token, sessionKey)) subagentConfigData.value = data
  } catch (error) {
    if (currentSubagentRequest(token, sessionKey)) {
      subagentConfigError.value = error.message || 'Failed to update subagent'
    }
  } finally {
    if (currentSubagentRequest(token, sessionKey)) subagentConfigSaving.value = false
  }
}

async function resetSubagentModel(payload) {
  const target = scopedConfigTarget()
  if (!target?.cwd) return
  const token = ++subagentConfigRequestToken
  const sessionKey = subagentSessionKey(target)
  subagentConfigActiveKey = sessionKey
  subagentConfigSaving.value = true
  subagentConfigError.value = ''
  try {
    const data = await clearSubagentModelOverride(
      target,
      payload.agentKey,
      payload.scope,
    )
    if (currentSubagentRequest(token, sessionKey)) subagentConfigData.value = data
  } catch (error) {
    if (currentSubagentRequest(token, sessionKey)) {
      subagentConfigError.value = error.message || 'Failed to reset subagent'
    }
  } finally {
    if (currentSubagentRequest(token, sessionKey)) subagentConfigSaving.value = false
  }
}

function visionSessionKey(session) {
  return `${session?.cwd || ''}:${session?.id || ''}:${session?.sessionFile || session?.path || ''}`
}

let visionConfigActiveKey = ''

function currentVisionRequest(token, sessionKey) {
  return token === visionConfigRequestToken
    && sessionKey === visionConfigActiveKey
}

async function loadVisionConfig() {
  const target = scopedConfigTarget()
  if (!target?.cwd) {
    ++visionConfigRequestToken
    visionConfigActiveKey = ''
    visionConfigLoading.value = false
    visionConfigSaving.value = false
    visionConfigError.value = ''
    visionConfigData.value = {
      context: {},
      overrides: {},
      model: '',
      modelSource: 'none',
      thinking: '',
      thinkingSource: 'none',
    }
    return
  }
  const token = ++visionConfigRequestToken
  const sessionKey = visionSessionKey(target)
  visionConfigActiveKey = sessionKey
  if (visionConfigOpen.value) visionConfigLoading.value = true
  visionConfigSaving.value = false
  visionConfigError.value = ''
  visionConfigData.value = {
    context: {},
    overrides: {},
    model: '',
    modelSource: 'none',
    thinking: '',
    thinkingSource: 'none',
  }
  try {
    const data = await fetchVisionConfig(target)
    if (currentVisionRequest(token, sessionKey)) visionConfigData.value = data
  } catch (error) {
    if (currentVisionRequest(token, sessionKey)) {
      visionConfigError.value = error.message || 'Failed to load vision config'
    }
  } finally {
    if (currentVisionRequest(token, sessionKey)) visionConfigLoading.value = false
  }
}

async function openVisionConfig() {
  settingsOpen.value = false
  eventLogOpen.value = false
  memoryOpen.value = false
  projectDetailCwd.value = ''
  subagentConfigOpen.value = false
  visionConfigOpen.value = true
  if (!scopedConfigTarget()?.cwd) {
    visionConfigLoading.value = false
    visionConfigSaving.value = false
    visionConfigError.value = 'No project selected yet. Open a session or choose a project to manage the vision model.'
    visionConfigData.value = {
      context: {},
      overrides: {},
      model: '',
      modelSource: 'none',
      thinking: '',
      thinkingSource: 'none',
    }
    return
  }
  await loadVisionConfig()
}

async function saveVisionModel(payload) {
  const target = scopedConfigTarget()
  if (!target?.cwd) return
  const token = ++visionConfigRequestToken
  const sessionKey = visionSessionKey(target)
  visionConfigActiveKey = sessionKey
  visionConfigSaving.value = true
  visionConfigError.value = ''
  try {
    const data = await setVisionOverride(
      target,
      payload.scope,
      payload.model,
      payload.thinking,
    )
    if (currentVisionRequest(token, sessionKey)) visionConfigData.value = data
  } catch (error) {
    if (currentVisionRequest(token, sessionKey)) {
      visionConfigError.value = error.message || 'Failed to update vision agent'
    }
  } finally {
    if (currentVisionRequest(token, sessionKey)) visionConfigSaving.value = false
  }
}

async function resetVisionModel(payload) {
  const target = scopedConfigTarget()
  if (!target?.cwd) return
  const token = ++visionConfigRequestToken
  const sessionKey = visionSessionKey(target)
  visionConfigActiveKey = sessionKey
  visionConfigSaving.value = true
  visionConfigError.value = ''
  try {
    const data = await clearVisionOverride(target, payload.scope)
    if (currentVisionRequest(token, sessionKey)) visionConfigData.value = data
  } catch (error) {
    if (currentVisionRequest(token, sessionKey)) {
      visionConfigError.value = error.message || 'Failed to reset vision agent'
    }
  } finally {
    if (currentVisionRequest(token, sessionKey)) visionConfigSaving.value = false
  }
}

function isEnteringEntry(entry) {
  return animatingEntryIds.value.has(entry.id)
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

function retryComposerFocus(attempt = 0) {
  if (composerRef.value) {
    composerRef.value.focus()
    return
  }
  if (attempt < 40) setTimeout(() => retryComposerFocus(attempt + 1), 50)
}

async function refocusComposer() {
  await nextTick()
  retryComposerFocus()
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
  const initializesResearchSession = !editing
    && !isResearchSession.value
    && !selectedSessionHasMessages.value
    && emptySessionKind.value === 'research'
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
      : await submitPrompt(
        sessionId,
        text,
        images,
        undefined,
        initializesResearchSession ? 'research' : undefined,
      )
    if (selectedSessionId.value === sessionId) {
      if (data.active) activeRuntimeSession.value = data.active
      if (initializesResearchSession) emptySessionKind.value = 'session'
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
  const shellCwd = settingsCwd.value
  try {
    const data = await runShellCommand(
      sessionId,
      shellCommand.command,
      shellCommand.excludeFromContext,
    )
    if (data.active && selectedSessionId.value === sessionId) {
      activeRuntimeSession.value = data.active
      emptySessionKind.value = 'session'
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
    invalidateReview(shellCwd)
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
  nextTick(() => retryComposerFocus())
}

async function retryEntry(entry) {
  if (agentRunning.value
    || compactingContext.value
    || promptSubmitting.value
    || reloadingSession.value
    || sessionLoading.value
    || sessionSwitching.value
    || sessionActivating.value
    || !entry?.id) return

  const target = persistedEditingEntry(entry)
  if (!target) {
    promptError.value = 'Wait for this message to finish saving before retrying.'
    return
  }
  if (target.role !== 'user') return

  const text = (target.text || textFromBlocks(messageBlocksFor(target))).trim()
  const images = imageBlocksFor(target).map(({ preview, ...image }) => image)
  if (!text && images.length === 0) return

  const sessionId = selectedSessionId.value
  const previousDetail = sessionDetail.value
  resetLiveState()
  trimSessionToEntry(target.id)
  stickToBottom.value = true
  hasNewOutput.value = false
  pulseComposerCommit()
  const localEntry = beginUserTurn(text, images)
  promptSubmitting.value = true
  promptError.value = ''
  closePickerMenus()
  await scrollToLatest()

  try {
    const data = await editPrompt(sessionId, target.id, text, images)
    if (selectedSessionId.value === sessionId) {
      if (data.active) activeRuntimeSession.value = data.active
      setAgentRunning(true, 'Thinking…')
    }
  } catch (error) {
    if (selectedSessionId.value === sessionId) {
      sessionDetail.value = previousDetail
      resetLiveState()
      removeOptimisticEntry(localEntry)
      promptError.value = error.message
    }
  } finally {
    promptSubmitting.value = false
    refocusComposer()
  }
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

function toggleStartSessionKind() {
  if (!researchEnabled.value) return
  startSessionKind.value = startSessionKind.value === 'research'
    ? 'session'
    : 'research'
}

function toggleEmptySessionKind() {
  if (!canToggleEmptySessionResearch.value) return
  emptySessionKind.value = emptySessionKind.value === 'research'
    ? 'session'
    : 'research'
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

function openImageFullscreen(src, title = 'Image preview') {
  if (!src) return
  fullscreenImage.value = { src, title }
}

function closeImageFullscreen() {
  fullscreenImage.value = null
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

function measureStartupComposerDock() {
  const form = startComposerRef.value?.form
  const pane = form?.closest('.main-pane')
  if (!form || !pane) return

  const formRect = form.getBoundingClientRect()
  const paneRect = pane.getBoundingClientRect()
  const bottom = window.matchMedia('(max-width: 760px)').matches ? 10 : 22
  const dockLeft = paneRect.left + paneRect.width / 2
  const dockTop = paneRect.bottom - bottom - formRect.height
  startupComposerDockLeft.value = `${dockLeft}px`
  startupComposerDockX.value = `${formRect.left
    - (dockLeft - formRect.width / 2)}px`
  startupComposerDockY.value = `${formRect.top - dockTop}px`
}

async function submitStartDraft() {
  const text = draft.value.trim()
  const model = startSelectedModel.value
  const thinkingLevel = startSelectedThinkingLevel.value
  const targetCwd = newSessionCwd.value.trim()
  const hasPrompt = Boolean(text || attachedImages.value.length)
  const kind = text.startsWith('!') ? 'session' : startSessionKind.value
  if (!targetCwd || creatingSessionCwd.value) return

  clearTimeout(startupDockTimer)
  startupComposerDocking.value = false
  if (hasPrompt) measureStartupComposerDock()
  beginStartupRun(targetCwd, { hasPrompt, model, thinkingLevel })
  if (hasPrompt) {
    startupDockTimer = window.setTimeout(() => {
      startupComposerDocking.value = true
    }, 320)
  }

  try {
    await wait(startupAcceptedFloorMs)
    await runStartupPhase('creating', () => {
      return createSessionForCwd(targetCwd, { kind })
    })
    if (selectedSession.value) startSessionKind.value = 'session'
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
    startupRevealHold.value = shouldRevealSession && hasPrompt
    startupRevealSettling.value = shouldRevealSession && hasPrompt
    startupRevealCwd.value = targetCwd
    newSessionSettling.value = true
    finishStartupRun()
    startupComposerDocking.value = shouldRevealSession && hasPrompt
    startupRevealTimer = window.setTimeout(() => {
      startupRevealHold.value = false
      startupRevealCwd.value = ''
      startupComposerDocking.value = false
    }, 180)
    clearTimeout(newSessionSettlingTimer)
    newSessionSettlingTimer = window.setTimeout(() => {
      newSessionSettling.value = false
      startupRevealSettling.value = false
    }, 720)
  }
}

function handleGlobalKeydown(event) {
  if ((event.metaKey || event.ctrlKey)
    && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (deleteConfirmActive.value || editingEntry.value || renamingSessionId.value) {
      return
    }
    closePickerMenus()
    closeProjectBrowser()
    setSidebarNavigator('quick')
    return
  }
  if (event.key === 'Escape') handleEscape(event)
}

function anyEscapeTargetOpen() {
  return Boolean(
    fullscreenImage.value
    || fullscreenTool.value
    || projectBrowserOpen.value
    || sidebarNavigator.value
    || settingsOpen.value
    || eventLogOpen.value
    || subagentConfigOpen.value
    || visionConfigOpen.value
    || projectDetailCwd.value
    || memoryOpen.value
    || deleteConfirmActive.value
    || editingEntry.value
    || renamingSessionId.value
    || modelPickerOpen.value
    || thinkingPickerOpen.value
    || toolsPickerOpen.value
    || startProjectPickerOpen.value
    || slashPickerOpen.value
    || researchSourcesOpen.value
    || (reviewPaneExpanded.value && window.innerWidth > 1120)
  )
}

function handleEscape(event) {
  if (!anyEscapeTargetOpen() && agentRunning.value) {
    event?.preventDefault?.()
    void interruptAgent()
  }
  settingsOpen.value = false
  eventLogOpen.value = false
  sidebarNavigator.value = ''
  subagentConfigOpen.value = false
  visionConfigOpen.value = false
  projectDetailCwd.value = ''
  collapseReviewExpanded()
  if (researchSourcesOpen.value) closeResearchSources()
  if (memoryOpen.value) closeMemoryDrawer()
  closeImageFullscreen()
  closeToolFullscreen()
  closeProjectBrowser()
  cancelConfirmDelete()
  cancelEditingEntry()
  closePickerMenus()
}

function consumeInitialNativeNewSessionCwd() {
  const url = new URL(window.location.href)
  return url.searchParams.get('leylineNewSessionCwd')?.trim() || ''
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
      'transcript-view': !!selectedSession && !initializing,
      'start-state': !initializing && startFlowVisible,
      'new-session-transition': newSessionTransitionActive,
      'startup-composer-docking': startupComposerDocking,
      'startup-reveal-hold': startupRevealHold,
      'startup-reveal-settling': startupRevealSettling,
      'in-project-new-session-transition': inProjectTransitionActive,
      'in-project-composer-docking': inProjectComposerDocking,
      'session-handoff': sessionHandoff,
      'terminal-open': terminalOpen,
      'event-log-open': eventLogOpen,
      'memory-open': memoryOpen,
      'review-open': reviewAvailable && reviewOpen && !!selectedSession,
      'review-expanded': reviewAvailable && reviewOpen && reviewExpanded
        && !!selectedSession,
      'review-transcript-hidden': reviewAvailable
        && (reviewOpen || reviewClosing) && reviewPaneExpanded
        && !!selectedSession,
      'research-open': researchSourcesOpen
        && isResearchSession
        && !!selectedSession,
    }"
    :style="{
      '--composer-height': `${composerHeight}px`,
      '--composer-reserved-height': composerReservedHeight,
      '--startup-composer-dock-left': startupComposerDockLeft,
      '--startup-composer-dock-x': startupComposerDockX,
      '--startup-composer-dock-y': startupComposerDockY,
      '--terminal-drawer-height': `${terminalDrawerHeight}px`,
      '--review-pane-width': `${reviewPaneWidth}px`,
      '--research-pane-width': '340px',
    }"
  >
    <button
      v-if="sidebarOpen"
      class="sidebar-scrim"
      type="button"
      aria-label="Close sessions"
      @click="sidebarOpen = false"
    ></button>

    <ProjectBrowser
      v-if="projectBrowserOpen"
      :active-cwd="selectedSession?.cwd || ''"
      :busy="!!creatingSessionCwd"
      :initial-path="projectBrowserInitialPath"
      @close="closeProjectBrowser"
      @select="createSessionForCwd"
    />

    <header class="app-header">
      <div class="app-header-brand">
        <button
          class="brand-home"
          type="button"
          aria-label="Go to home"
          @click="navigateHome"
        >
          <img class="brand-mark" src="/brand-mark.svg" alt="" />
          <span class="brand-name">
            <strong>Leyline</strong>
          </span>
        </button>
        <button
          class="sidebar-collapse-button"
          type="button"
          :aria-label="desktopSidebarHidden ? 'Show sessions' : 'Hide sessions'"
          @click="desktopSidebarHidden = !desktopSidebarHidden"
        >{{ desktopSidebarHidden ? '›' : '‹' }}</button>
      </div>
      <div class="app-header-main">
        <button
          v-if="desktopSidebarHidden"
          class="sidebar-collapse-button sidebar-header-reveal-button"
          type="button"
          aria-label="Show sessions"
          @click="desktopSidebarHidden = false"
        >›</button>
        <button
          class="mobile-sidebar-button"
          type="button"
          aria-label="Open sessions"
          @click="sidebarOpen = true"
        >☰</button>
        <div v-if="selectedSession" class="workbench-title-row">
          <button
            v-if="selectedSession.isSubagentSession
              && selectedSession.parentSessionPath"
            class="parent-session-button"
            type="button"
            @click="navigateParentSession"
          >← parent session</button>
          <span class="crumb-project">
            {{ projectName(selectedSession.cwd) }}
          </span>
          <span class="crumb-sep" aria-hidden="true">/</span>
          <input
            v-if="renamingSessionId === selectedSession.id
              && renamingSessionSource === 'workbench'"
            v-focus-select
            class="workbench-title-input"
            :value="renameDraft"
            aria-label="Session name"
            :disabled="renamingSessionSavingId === selectedSession.id"
            @input="renameDraft = $event.target.value"
            @keydown.enter.stop.prevent="commitRenameSession(selectedSession)"
            @keydown.esc.stop.prevent="cancelRenameSession"
            @blur="renamingSessionId === selectedSession.id
              && renamingSessionSource === 'workbench'
              && commitRenameSession(selectedSession)"
          />
          <button
            v-else
            class="workbench-title-button"
            type="button"
            title="Rename session"
            @click="beginRenameSession(selectedSession, 'workbench')"
          >
            <strong>{{ sessionTitle(selectedSession) }}</strong>
            <span class="workbench-title-glyph" aria-hidden="true">
              <svg viewBox="0 0 16 16">
                <path d="M10.8 2.8l2.4 2.4"></path>
                <path d="M4 12l2.1-.4 6.2-6.2-1.7-1.7-6.2 6.2z"></path>
              </svg>
            </span>
          </button>
          <span
            v-if="isResearchSession"
            class="research-session-chip"
          >{{ selectedResearch.status === 'complete'
            ? 'report ready'
            : selectedResearch.phase }}</span>
        </div>
        <div v-if="selectedSession" class="topbar-meta">
          <button
            v-if="isResearchSession && selectedResearch.sourceCount"
            class="topbar-icon-button research-sources-toggle"
            :class="{ active: researchSourcesOpen }"
            type="button"
            :title="`Research sources · ${selectedResearch.sourceCount}`"
            :aria-label="`Research sources · ${selectedResearch.sourceCount}`"
            :aria-pressed="researchSourcesOpen"
            @click="toggleResearchSources"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 3.5h8.5A1.5 1.5 0 0 1 13 5v7.5H4.5A1.5 1.5 0 0 1 3 11z"></path>
              <path d="M3 11a1.5 1.5 0 0 1 1.5-1.5H13"></path>
            </svg>
            <span class="research-source-count">{{ selectedResearch.sourceCount }}</span>
          </button>
          <button
            v-if="reviewAvailable"
            class="topbar-icon-button review-toggle-button"
            :class="{
              active: reviewOpen,
              'has-review-changes': reviewSummary.state === 'ready'
                && reviewSummary.available && reviewSummary.totalFiles > 0,
              preparing: !reviewReady,
              'review-error': reviewSummary.state === 'error',
              'review-unavailable': reviewSummary.state === 'ready'
                && !reviewSummary.available,
            }"
            type="button"
            :title="reviewToggleDescription"
            :aria-label="reviewToggleDescription"
            :aria-busy="!reviewReady"
            :aria-pressed="reviewOpen"
            @click="toggleReview"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M18 15C16.3431 15 15 16.3431 15 18C15 19.6569 16.3431 21 18 21C19.6569 21 21 19.6569 21 18C21 16.3431 19.6569 15 18 15ZM18 15V8C18 7.46957 17.7893 6.96086 17.4142 6.58579C17.0391 6.21071 16.5304 6 16 6H13M6 9C7.65685 9 9 7.65685 9 6C9 4.34315 7.65685 3 6 3C4.34315 3 3 4.34315 3 6C3 7.65685 4.34315 9 6 9ZM6 9V21"
                stroke-width="2"
              ></path>
            </svg>
            <span
              v-if="reviewHasLineStats"
              class="review-line-stats"
              aria-hidden="true"
            >
              <span v-if="reviewSummary.conflicts" class="review-conflict-mark">!</span>
              <span v-if="reviewAdditionText" class="review-line-additions">
                {{ reviewAdditionText }}
              </span>
              <span v-if="reviewDeletionText" class="review-line-deletions">
                {{ reviewDeletionText }}
              </span>
            </span>
            <span
              v-else-if="reviewFallbackBadgeText"
              class="review-state-badge"
              :class="{
                conflict: reviewSummary.conflicts > 0,
                error: reviewSummary.state === 'error',
              }"
              aria-hidden="true"
            >
              {{ reviewFallbackBadgeText }}
            </span>
          </button>
          <button
            class="topbar-icon-button"
            type="button"
            title="Memory"
            aria-label="Memory"
            :disabled="!memoryEnabled"
            @click="toggleMemoryPanel"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <ellipse cx="8" cy="4" rx="5" ry="2.2"></ellipse>
              <path d="M3 4v8c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2V4"></path>
              <path d="M3 8c0 1.2 2.2 2.2 5 2.2s5-1 5-2.2"></path>
            </svg>
            <span v-if="memoryActiveCount" class="topbar-icon-count">
              {{ memoryActiveCount }}
            </span>
          </button>
          <template v-if="!isEmptySelectedSession">
            <button
              class="topbar-icon-button"
              type="button"
              title="Events"
              aria-label="Events"
              @click="toggleEventDrawer"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M1.5 8h3l1.8-4 3.4 8 1.8-4h3"></path>
              </svg>
              <span v-if="runtimeEvents.length" class="topbar-icon-count">
                {{ runtimeEvents.length }}
              </span>
            </button>
            <a
              class="topbar-icon-button"
              title="Export transcript"
              aria-label="Export transcript"
              :href="selectedSessionExportUrl"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 2.5v7"></path>
                <path d="M5 6.5l3 3 3-3"></path>
                <path d="M3 11v1.5c0 .8.7 1.5 1.5 1.5h7c.8 0 1.5-.7 1.5-1.5V11"></path>
              </svg>
            </a>
          </template>
        </div>
      </div>
    </header>

    <SessionSidebar
      :active-backend-connection="activeBackendConnection"
      :agent-running="agentRunning"
      :backend-connection-busy-id="backendConnectionBusyId"
      :backend-connection-error="backendConnectionError"
      :backend-connections="backendConnections"
      :creating-session-cwd="creatingSessionCwd"
      :default-backend-connection-id="defaultBackendConnectionId"
      :deleting-project-cwd="deletingProjectCwd"
      :deleting-session-id="deletingSessionId"
      :navigator="sidebarNavigator"
      :new-session-cwd="newSessionCwd"
      :reloading-session="reloadingSession"
      :runtime-activity-sessions="sidebarActivitySessions"
      v-model:rename-draft="renameDraft"
      :renaming-session-id="renamingSessionId"
      :renaming-session-saving-id="renamingSessionSavingId"
      :renaming-session-source="renamingSessionSource"
      :selected-session="selectedSession"
      :selected-session-id="selectedSessionId"
      :session-status="sessionRuntimeStatus"
      :session-title="sessionTitle"
      :sessions-error="sessionsError"
      :sessions-hydrated="sessionsHydrated"
      :sessions-hydrating="sessionsHydrating"
      :sessions-hydration-error="sessionsHydrationError"
      :sessions-loading="sessionsLoading"
      :visible-projects="visibleProjects"
      @begin-rename-session="beginRenameSession"
      @cancel-rename-session="cancelRenameSession"
      @commit-rename-session="commitRenameSession"
      @create-session="createSession"
      @open-project-browser="openProjectBrowser"
      @open-project-detail="openProjectDetail"
      @open-settings="toggleSettingsDrawer"
      @reload-session="reloadSession"
      @request-delete-project="requestDeleteProject"
      @request-delete-session="requestDeleteSession"
      @retry-sessions="retrySessions"
      @select-backend="switchBackendConnection"
      @select-project="selectSidebarProject"
      @select-session="selectSession"
      @update:navigator="setSidebarNavigator"
    />

    <section class="main-pane">
      <div v-if="runtimeChromeVisible" class="runtime-chrome">

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
        <section
          v-if="isResearchSession"
          class="research-phase-bar"
        >
          <div class="research-phase-summary">
            <strong>{{ researchPhaseTitle }}</strong>
            <span>{{ researchPhaseSummary }}</span>
          </div>
          <div class="research-phase-steps" aria-label="Research progress">
            <span
              v-for="(phase, index) in researchPhaseSteps"
              :key="phase"
              :class="researchPhaseClass(phase)"
            >
              <i>{{ researchPhaseClass(phase).done ? '✓' : index + 1 }}</i>
              <b>{{ researchPhaseLabel(phase) }}</b>
            </span>
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
          v-else-if="sessionHandoff || sessionHandoffSettling"
          class="init-panel transcript-skeleton-panel session-handoff-init-panel"
          :class="{ 'is-settling': sessionHandoffSettling }"
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
        <div v-else-if="sessionError" class="empty-workbench error-note session-error-panel">
          <span>{{ sessionError }}</span>
          <button
            v-if="pendingInitialNativeCwd"
            type="button"
            :disabled="!!backendConnectionBusyId"
            @click="retryBackendConnection"
          >{{ backendConnectionBusyId ? 'Retrying…' : 'Retry' }}</button>
        </div>
        <div v-else-if="backendUnavailable" class="backend-unavailable-panel">
          <span>Backend unavailable</span>
          <strong>Cannot connect to {{ activeBackendConnection.name }}</strong>
          <code>{{ activeBackendConnectionAddress }}</code>
          <p>{{ sessionsError }}</p>
          <div>
            <button
              type="button"
              :disabled="!!backendConnectionBusyId"
              @click="retryBackendConnection"
            >{{ backendConnectionBusyId ? 'Retrying…' : 'Retry' }}</button>
            <button type="button" @click="openSettingsDrawer">Choose backend</button>
            <button
              v-if="!activeBackendConnection.builtIn"
              type="button"
              @click="switchBackendConnection(backendConnections[0])"
            >Use native backend</button>
          </div>
        </div>
        <div
          v-else-if="startFlowVisible || startupRevealHold"
          class="start-panel"
        >
          <h2 class="start-headline-text">{{ startHeadline }}</h2>
          <div
            v-if="startupLoadingVisible"
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
            ref="startComposerRef"
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
            :vision-delegation-notice="visionDelegationNotice"
            :model-key="modelKey"
            :model-picker-open="modelPickerOpen"
            :research-enabled="researchEnabled"
            :session-kind="startSessionKind"
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
            @open-image="openImageFullscreen"
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
            @toggle-session-kind="toggleStartSessionKind"
            @toggle-project-picker="startProjectPickerOpen = !startProjectPickerOpen"
          />
        </div>
        <div
          v-if="emptySessionShellVisible && !startupRun"
          class="empty-session-panel"
        >
          <h2>
            {{ composerResearchMode
              ? `What should we investigate in ${topbarTitle}?`
              : `What should we work on in ${topbarTitle}?` }}
          </h2>
        </div>
        <div
          v-if="(inProjectNewSessionRun || inProjectNewSessionSettling)
            && !startupRun
            && !startupRevealHold"
          class="init-panel transcript-skeleton-panel in-project-init-panel"
          :class="{ 'is-settling': !inProjectNewSessionRun }"
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
            :key="`${selectedSession.id}:${entry.id}`"
            :class="{ 'message-enter': isEnteringEntry(entry) }"
            :copied-entry-id="copiedEntryId"
            :entry="entry"
            :skill-expanded="isSkillExpanded(entry)"
            :thinking-initially-expanded="thinkingInitiallyExpanded"
            :tool-expanded="isToolExpanded(entry)"
            @copy="copyEntry"
            @edit="startEditingEntry"
            @fork="forkSession"
            @mark-feedback="markEntryFeedback"
            @navigate-child-session="navigateChildSession"
            @open-image="openImageFullscreen"
            @open-research-source="openResearchSource"
            @reset="resetSessionToEntry"
            @retry="retryEntry"
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
              :thinking-initially-expanded="thinkingInitiallyExpanded"
              @copy="copyEntry"
              @edit="startEditingEntry"
              @fork="forkSession"
              @mark-feedback="markEntryFeedback"
              @open-image="openImageFullscreen"
              @open-research-source="openResearchSource"
              @reset="resetSessionToEntry"
              @retry="retryEntry"
              @toggle-skill="toggleSkill"
            />

            <TranscriptEntry
              v-else-if="item.type === 'tool'
                && (item.persistedEntry
                  || (item.resultEntry && item.status !== 'reading'))"
              :copied-entry-id="copiedEntryId"
              :entry="item.persistedEntry || item.resultEntry"
              :tool-expanded="isToolExpanded(item.persistedEntry || item.resultEntry)"
              @copy="copyEntry"
              @fork="forkSession"
              @mark-feedback="markEntryFeedback"
              @navigate-child-session="navigateChildSession"
              @open-image="openImageFullscreen"
              @open-research-source="openResearchSource"
              @reset="resetSessionToEntry"
              @open-tool-fullscreen="openToolFullscreen"
              @toggle-tool="toggleTool"
            />

            <article
              v-else-if="item.type === 'tool'"
              class="tool-card transcript-tool live-tool-card"
              :class="{
                'subagent-card': isLiveSubagentTool(item),
                'is-running': item.status === 'running',
                'is-completed': item.status === 'completed',
                'error-card': item.status === 'error',
              }"
            >
              <div v-if="isLiveSubagentTool(item)" class="subagent-header">
                <span class="live-tool-spinner"></span>
                <span class="subagent-icon" aria-hidden="true">
                  <svg viewBox="0 0 16 16" fill="none">
                    <path d="M3 2.5v4A3.5 3.5 0 0 0 6.5 10H13" />
                    <path d="m10 7 3 3-3 3" />
                  </svg>
                </span>
                <span class="subagent-label">Subagent</span>
                <code v-if="liveSubagentTarget(item)" :title="liveSubagentTarget(item)">{{ liveSubagentTarget(item) }}</code>
                <em>{{ liveToolStatus(item) }}</em>
              </div>
              <div v-else class="tool-card-header">
                <span class="live-tool-spinner"></span>
                <span>{{ item.label }}</span>
                <code v-if="item.code" :title="item.code">{{ item.code }}</code>
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
              :thinking-initially-expanded="thinkingInitiallyExpanded"
              @copy="copyTranscriptItem(item.id, liveAssistantDisplayCopyText(item))"
              @fork="forkSession"
              @open-image="openImageFullscreen"
              @reset="resetSessionToEntry"
            />

          </div>
        </TransitionGroup>
      </div>

      <button
        v-if="hasNewOutput"
        class="jump-latest-button"
        type="button"
        title="Jump to latest"
        aria-label="Jump to latest"
        @click="jumpToLatest"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5v9"></path>
          <path d="m4.5 8 3.5 3.5L11.5 8"></path>
        </svg>
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
        :vision-delegation-notice="visionDelegationNotice"
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
        :research="composerResearchMode"
        :research-toggle-enabled="canToggleEmptySessionResearch"
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
        @open-image="openImageFullscreen"
        @paste="handleComposerPaste"
        @remove-image="removeAttachedImage"
        @select-model="selectModel"
        @select-slash-command="selectSlashCommand"
        @select-thinking="selectThinkingLevel"
        @show-slash-picker="showSlashPicker"
        @submit="submitDraft"
        @toggle-picker="togglePicker"
        @toggle-research="toggleEmptySessionKind"
        @toggle-terminal="toggleTerminal"
      />
    </section>

    <ReviewPane
      v-if="reviewAvailable && selectedSession"
      :cwd="selectedSession.cwd"
      :expanded="reviewPaneExpanded"
      :open="reviewOpen"
      :refresh-token="reviewRefreshToken"
      :sidebar-hidden="desktopSidebarHidden"
      :watch-enabled="reviewWatchEnabled"
      :width="reviewPaneWidth"
      @close="closeReview"
      @prepared="handleReviewPrepared"
      @preparing="handleReviewPreparing"
      @resize="reviewPaneWidth = $event"
      @summary="handleReviewSummary"
      @toggle-expand="toggleReviewExpanded"
    />

    <ResearchSourcesPane
      v-if="selectedSession && isResearchSession"
      :open="researchSourcesOpen"
      :research="selectedResearch"
      :reveal-key="researchSourceRevealKey"
      :selected-source-id="selectedResearchSourceId"
      @close="closeResearchSources"
      @select="selectResearchSource"
    />

    <div
      v-if="deleteConfirmActive"
      class="confirm-backdrop"
      role="presentation"
      @click.self="cancelConfirmDelete"
    >
      <section
        class="confirm-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="confirmDeleteTitleId"
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
          <h2 :id="confirmDeleteTitleId">
            {{ deleteConfirmProject ? 'Delete project?' : 'Delete session?' }}
          </h2>
          <p v-if="deleteConfirmProject">
            Move “{{ deleteConfirmProject.name }}”
            <template v-if="projectDeleteSessionCount > 0">
              and its {{ projectDeleteSessionCount }} sessions
            </template>
            to Leyline trash.
          </p>
          <p v-else>
            Move “{{ sessionTitle(deleteConfirmSession) }}” to Leyline trash.
          </p>
          <p v-if="confirmDeleteError" class="confirm-error">
            {{ confirmDeleteError }}
          </p>
        </div>
        <div class="confirm-actions">
          <button
            type="button"
            class="confirm-cancel"
            :disabled="confirmDeleteBusy"
            @click="cancelConfirmDelete"
          >Cancel</button>
          <button
            type="button"
            class="confirm-delete"
            :disabled="confirmDeleteBusy"
            @click="confirmPendingDelete"
          >{{ confirmDeleteLabel }}</button>
        </div>
      </section>
    </div>

    <Transition name="event-drawer">
      <div
        v-if="projectDetailProject"
        class="project-detail-drawer-slot"
      >
        <ProjectDetailDrawer
          v-model:rename-draft="renameDraft"
          :creating-session-cwd="creatingSessionCwd"
          :deleting-session-id="deletingSessionId"
          :project="projectDetailProject"
          :renaming-session-id="renamingSessionId"
          :renaming-session-saving-id="renamingSessionSavingId"
          :renaming-session-source="renamingSessionSource"
          :selected-session-id="selectedSessionId"
          :session-status="sessionRuntimeStatus"
          :session-title="sessionTitle"
          @begin-rename-session="beginRenameSession"
          @cancel-rename-session="cancelRenameSession"
          @close="closeProjectDetail"
          @commit-rename-session="commitRenameSession"
          @create-session="createSession"
          @request-delete-session="requestDeleteSession"
          @select-session="selectSession"
        />
      </div>
    </Transition>

    <Transition name="event-drawer">
      <div v-if="memoryOpen" class="memory-drawer-slot">
        <MemoryInspector
          :context="memoryData.context"
          :counts="memoryData.counts"
          :disabled="!memoryEnabled"
          :error="memoryError"
          :loading="memoryLoading"
          :memories="memoryData.memories"
          :saving="memorySaving"
          @archive="archiveMemories"
          @close="closeMemoryDrawer"
          @create="createMemory"
          @delete="deleteMemories"
          @dirty-change="memoryDirty = $event"
          @refresh="loadVisibleMemory"
          @restore="restoreMemories"
          @update="updateMemory"
        />
      </div>
    </Transition>

    <Transition name="event-drawer">
      <div v-if="settingsOpen" class="settings-drawer-slot">
        <aside class="settings-drawer" aria-label="Settings">
          <header class="settings-drawer-header">
            <div>
              <strong>Settings</strong>
              <span>Connections, runtime, and session state</span>
            </div>
            <button type="button" @click="settingsOpen = false">×</button>
          </header>

          <section class="settings-group backend-settings-group">
            <div class="settings-group-heading">
              <h2>Backend</h2>
              <button
                type="button"
                :disabled="backendConnectionsLoading || !!backendConnectionBusyId"
                @click="beginCreateBackendConnection"
              >Add connection</button>
            </div>

            <div class="backend-current-card">
              <span>Current window</span>
              <strong>{{ activeBackendConnection.name }}</strong>
              <code>{{ activeBackendConnectionAddress }}</code>
            </div>

            <p v-if="backendConnectionError" class="backend-connection-error">
              {{ backendConnectionError }}
            </p>

            <form
              v-if="backendConnectionFormOpen"
              class="backend-connection-form"
              @submit.prevent="saveBackendConnection"
            >
              <div class="backend-connection-form-heading">
                <strong>
                  {{ backendConnectionEditingId ? 'Edit connection' : 'New connection' }}
                </strong>
                <button type="button" @click="cancelBackendConnectionForm">×</button>
              </div>
              <label>
                <span>Name</span>
                <input
                  v-model="backendConnectionName"
                  type="text"
                  maxlength="80"
                  placeholder="Build host"
                  @input="clearBackendConnectionResult"
                />
              </label>
              <label>
                <span>Backend URL</span>
                <input
                  v-model="backendConnectionUrl"
                  type="url"
                  placeholder="http://192.168.1.42:4317"
                  spellcheck="false"
                  @input="clearBackendConnectionResult"
                />
              </label>
              <small>Leyline adds the <code>/api/pi</code> path.</small>
              <span
                v-if="backendConnectionTestResult?.id
                  === (backendConnectionEditingId || 'draft')"
                class="backend-connection-success"
              >{{ backendConnectionTestResult.message }}</span>
              <div class="backend-connection-form-actions">
                <button
                  type="button"
                  :disabled="!!backendConnectionBusyId"
                  @click="testBackendConnectionDraft"
                >{{ backendConnectionBusyId
                  === (backendConnectionEditingId || 'draft') ? 'Testing…' : 'Test' }}</button>
                <button type="submit" :disabled="!!backendConnectionBusyId">
                  {{ backendConnectionBusyId ? 'Saving…' : 'Save' }}
                </button>
              </div>
            </form>

            <div class="backend-connection-list">
              <article
                v-for="connection in backendConnections"
                :key="connection.id"
                class="backend-connection-card"
              >
                <div class="backend-connection-heading">
                  <span>
                    <strong>{{ connection.name }}</strong>
                    <small>
                      <template v-if="connection.id === activeBackendConnectionId">Current window</template>
                      <template v-if="connection.id === activeBackendConnectionId
                        && connection.id === defaultBackendConnectionId"> · </template>
                      <template v-if="connection.id === defaultBackendConnectionId">Default</template>
                    </small>
                  </span>
                  <code>{{ backendDisplayAddress(connection) }}</code>
                </div>
                <span
                  v-if="backendConnectionTestResult?.id === connection.id"
                  class="backend-connection-success"
                >{{ backendConnectionTestResult.message }}</span>
                <div class="backend-connection-actions">
                  <button
                    v-if="connection.id !== activeBackendConnectionId"
                    type="button"
                    :disabled="!!backendConnectionBusyId"
                    @click="switchBackendConnection(connection)"
                  >{{ backendConnectionBusyId === connection.id ? 'Connecting…' : 'Use' }}</button>
                  <button
                    type="button"
                    :disabled="!!backendConnectionBusyId"
                    @click="testSavedBackendConnection(connection)"
                  >Test</button>
                  <button
                    v-if="connection.id !== defaultBackendConnectionId"
                    type="button"
                    :disabled="!!backendConnectionBusyId"
                    @click="makeDefaultBackendConnection(connection)"
                  >Make default</button>
                  <button
                    v-if="!connection.builtIn"
                    type="button"
                    :disabled="!!backendConnectionBusyId"
                    @click="beginEditBackendConnection(connection)"
                  >Edit</button>
                  <button
                    v-if="!connection.builtIn && connection.id !== activeBackendConnectionId"
                    type="button"
                    :disabled="!!backendConnectionBusyId"
                    @click="deleteBackendConnection(connection)"
                  >Remove</button>
                </div>
              </article>
            </div>
          </section>

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
            <h2>Display</h2>
            <div class="settings-choice-group">
              <span>
                <strong>Thoughts</strong>
                <small>How thought rows start in live and saved transcripts</small>
              </span>
              <div class="settings-choice-options" :data-active="thinkingDefault">
                <span class="settings-choice-thumb" aria-hidden="true" />
                <button
                  type="button"
                  :class="{ active: thinkingDefault === 'collapsed' }"
                  @click="setThinkingDefault('collapsed')"
                >Collapsed</button>
                <button
                  type="button"
                  :class="{ active: thinkingDefault === 'expanded' }"
                  @click="setThinkingDefault('expanded')"
                >Expanded</button>
              </div>
              <p v-if="transcriptPreferencesError" class="settings-choice-error">
                {{ transcriptPreferencesError }}
              </p>
            </div>
          </section>

          <section class="settings-group">
            <h2>Agents</h2>
            <button
              type="button"
              class="settings-action-row"
              @click="openSubagentConfig"
            >
              <span>
                <strong>Subagents</strong>
                <small>Model defaults by transcript, project, and global scope</small>
              </span>
              <span>Manage</span>
            </button>
            <button
              type="button"
              class="settings-action-row"
              @click="openVisionConfig"
            >
              <span>
                <strong>Vision agent</strong>
                <small>Vision model for models without image support</small>
              </span>
              <span>Manage</span>
            </button>
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
      <div v-if="subagentConfigOpen" class="settings-drawer-slot">
        <SubagentConfigDrawer
          :agents="subagentConfigData.agents"
          :available-models="availableModels"
          :context="subagentConfigData.context"
          :error="subagentConfigError"
          :loading="subagentConfigLoading"
          :saving="subagentConfigSaving"
          @close="subagentConfigOpen = false"
          @refresh="loadSubagentConfigs"
          @reset-model="resetSubagentModel"
          @set-model="saveSubagentModel"
        />
      </div>
    </Transition>

    <Transition name="event-drawer">
      <div v-if="visionConfigOpen" class="settings-drawer-slot">
        <VisionConfigDrawer
          :available-models="availableModels"
          :config="visionConfigData"
          :error="visionConfigError"
          :loading="visionConfigLoading"
          :saving="visionConfigSaving"
          @close="visionConfigOpen = false"
          @refresh="loadVisionConfig"
          @reset="resetVisionModel"
          @save="saveVisionModel"
        />
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
        v-if="fullscreenImage"
        class="tool-fullscreen-backdrop"
        @click="closeImageFullscreen"
      >
        <section
          class="tool-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fullscreen-image-title"
          @click.stop
        >
          <header class="tool-fullscreen-header">
            <div>
              <span id="fullscreen-image-title">{{ fullscreenImage.title }}</span>
            </div>
            <div>
              <button
                type="button"
                title="Close image preview"
                aria-label="Close image preview"
                @click="closeImageFullscreen"
              >×</button>
            </div>
          </header>
          <div class="tool-fullscreen-body">
            <div class="tool-fullscreen-image">
              <img :src="fullscreenImage.src" :alt="fullscreenImage.title" />
            </div>
          </div>
        </section>
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
              <code v-if="fullscreenTool.code" :title="fullscreenTool.code">{{ fullscreenTool.code }}</code>
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
            <div v-if="toolCommandCode(fullscreenTool)" class="tool-command-block">
              <strong>Command</strong>
              <pre>{{ fullscreenTool.code }}</pre>
            </div>
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
