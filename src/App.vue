<script setup>
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
const TranscriptEntry = defineAsyncComponent(() => import('./components/TranscriptEntry.vue'))
const SystemPromptInspector = defineAsyncComponent(() => import('./components/SystemPromptInspector.vue'))
const SubagentInspector = defineAsyncComponent(() => import('./components/SubagentInspector.vue'))
const TracePanel = defineAsyncComponent(() => import('./components/TracePanel.vue'))
const LiveAssistantMessage = defineAsyncComponent(() => import('./components/LiveAssistantMessage.vue'))
const PierrePreview = defineAsyncComponent(() => import('./components/PierrePreview.vue'))
const FilePreview = defineAsyncComponent(() => import('./components/FilePreview.vue'))
const FileContextMenu = defineAsyncComponent(() => import('./components/FileContextMenu.vue'))
const FileLinkSettings = defineAsyncComponent(() => import('./components/FileLinkSettings.vue'))
const NetworkAccessSettings = defineAsyncComponent(() => import('./components/NetworkAccessSettings.vue'))
const RuntimeSettings = defineAsyncComponent(() => import('./components/RuntimeSettings.vue'))
const ProjectBrowser = defineAsyncComponent(() => import('./components/ProjectBrowser.vue'))
const ProjectDetailDrawer = defineAsyncComponent(() => import('./components/ProjectDetailDrawer.vue'))
const ReviewPane = defineAsyncComponent(() => import('./components/ReviewPane.vue'))
const ResearchCitationPreview = defineAsyncComponent(() => import('./components/ResearchCitationPreview.vue'))
const ResearchSourcesPane = defineAsyncComponent(() => import('./components/ResearchSourcesPane.vue'))
const MemoryInspector = defineAsyncComponent(() => import('./components/MemoryInspector.vue'))
const AgentSettings = defineAsyncComponent(() => import('./components/AgentSettings.vue'))
const GlobalSettingsModal = defineAsyncComponent(() => import('./components/GlobalSettingsModal.vue'))
const ProviderSettings = defineAsyncComponent(() => import('./components/ProviderSettings.vue'))
const McpSettings = defineAsyncComponent(() => import('./components/McpSettings.vue'))
const DictationSettings = defineAsyncComponent(() => import('./components/DictationSettings.vue'))
import CopyIcon from './components/CopyIcon.vue'
import CompactionBoundary from './components/CompactionBoundary.vue'
import ExtensionConfirmations from './components/ExtensionConfirmations.vue'
import StartComposer from './components/StartComposer.vue'
import SessionComposer from './components/SessionComposer.vue'
import MobileToolActivity from './components/MobileToolActivity.vue'
import { activityEntry, activityStatus, groupToolActivity, singleSubagentEntry } from '../lib/tool-activity.js'
import SessionSidebar from './components/SessionSidebar.vue'
import { useBackendConnections } from './composables/useBackendConnections'
import { useComposerMotion } from './composables/useComposerMotion'
import { useDictation } from './composables/useDictation'
import { useFileLinks } from './composables/useFileLinks'
import { useLiveTurnProjection } from './composables/useLiveTurnProjection'
import { useMemoryInspector } from './composables/useMemoryInspector'
import { useModalFocus } from './composables/useModalFocus'
import { useVisibleViewport } from './composables/useVisibleViewport'
import { usePinnedSessions } from './composables/usePinnedSessions'
import { useProjectBrowser } from './composables/useProjectBrowser'
import { useRuntimeEvents } from './composables/useRuntimeEvents'
import { useSessionWorkspace } from './composables/useSessionWorkspace'
import { useTerminal } from './composables/useTerminal'
import { useToolExpansion } from './composables/useToolExpansion'
import { useTranscriptPreferences } from './composables/useTranscriptPreferences'
import { useWorkbenchScroll } from './composables/useWorkbenchScroll'
import { backendDisplayAddress, backendHttpUrl } from './lib/backend'
import { fuzzyScore } from './lib/fuzzy'
import { createTraceClient } from './lib/trace-client'
import {
  compactNumber,
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
  fetchPiRuntimeState,
  fetchSubagentConfigs,
  fetchVisionConfig,
  interruptPiSession,
  runShellCommand,
  setEntryFeedback,
  setSubagentBatchSize,
  setSubagentModelOverride,
  setVisionOverride,
  submitPrompt,
} from './lib/pi-api'
import {
  imageBlocksFor,
  imageSrc,
  messageBlocksFor,
  renderedText,
  renderedToolJson,
  textFromBlocks,
  toolCommandCode,
} from './lib/transcript'

const viewport = useVisibleViewport()
const sidebarRef = ref(null)
const mainPane = ref(null)
const imageDialog = ref(null)
const toolDialog = ref(null)
const imageOpener = shallowRef(null)
const toolOpener = shallowRef(null)
const subagentInspector = ref(null)
const subagentOpener = shallowRef(null)
const subagentSelection = ref('')
const reviewPane = ref(null)
const reviewOpener = shallowRef(null)
const headerMoreOpen = ref(false)
const headerActions = ref(null)
const headerMoreButton = ref(null)
const composerImageInput = ref(null)
const composerReadPending = ref(false)
const compositionInputs = new WeakMap()
let imageChooser = null
let layoutObserver
let layoutFrame = 0
const terminalHeightBudget = ref(310)
const confirmationMaxHeight = ref(320)
const terminalKeysOpen = ref(false)
const terminalKeys = [
  ['interrupt', 'Ctrl-C'], ['escape', 'Esc'], ['tab', 'Tab'],
  ['left', 'Left'], ['down', 'Down'], ['up', 'Up'], ['right', 'Right'],
]
const sidebarOpen = ref(false)
const sidebarNavigator = ref('')
const desktopSidebarHidden = ref(false)
const draft = ref('')
const attachedImages = ref([])
const fullscreenImage = ref(null)
const workbench = ref(null)
const eventLogOpen = ref(false)
const settingsOpen = ref(false)
const settingsCategory = ref('display')
const settingsOpener = shallowRef(null)
const piSettingsPane = ref(null)
const piSettingsTarget = shallowRef({})
const piSettingsActionError = ref('')
const sessionDetailsOpen = ref(false)
const backendConnectionFormOpen = ref(false)
const backendConnectionEditingId = ref('')
const backendConnectionName = ref('')
const backendConnectionUrl = ref('')
const subagentConfigLoading = ref(false)
const subagentConfigSaving = ref(false)
const subagentConfigError = ref('')
const subagentConfigData = ref({ context: {}, agents: [] })
const visionSettingsLoading = ref(false)
const visionSettingsError = ref('')
const visionSettingsData = ref({ context: {}, overrides: {} })
const agentSettingsLoadedTarget = ref(null)
const agentSettingsFallbackModels = ref([])
let agentSettingsRequestToken = 0
const visionConfigSaving = ref(false)
const visionConfigData = ref({ model: '' })
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
const traceMode = ref('')
const traceOrigin = ref('')
const traceClient = shallowRef(null)
const tracePane = ref(null)
const traceNavigationError = ref('')
const inspectorTraceState = shallowRef(emptyTraceState())
const explorerTraceState = shallowRef(emptyTraceState())
const workspaceTraceState = shallowRef(emptyTraceState())
const traceState = computed(() => traceMode.value === 'workspace'
  ? workspaceTraceState.value
  : traceMode.value === 'explorer' ? explorerTraceState.value : inspectorTraceState.value)
const traceWorkbenchCovered = computed(() => ['workspace', 'explorer'].includes(traceMode.value))
let traceOpener = null
let traceViewRevision = 0
const systemPromptEntry = shallowRef(null)
const systemPromptPane = ref(null)
const systemPromptSelection = ref(0)
const systemPromptViewport = window.matchMedia('(max-width: 760px)')
const systemPromptMobile = ref(systemPromptViewport.matches)
let systemPromptOpener = null
const researchCitationPreview = ref(null)
let researchCitationAnchor = null
let researchCitationPreviewToken = 0
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
const manualCompactionSessions = ref(new Set())
const interrupting = ref(false)
const activityInterruptingSessionId = ref('')
const activityActionError = ref('')
const editingEntry = ref(null)
const composerDrafts = new Map()
const queueEditDrafts = new Map()
const pendingComposerPastes = new Set()
const startComposerDraftKey = 'start'
let activeComposerDraftKey = startComposerDraftKey
const dictationGeneration = ref(0)
const draftRevision = ref(0)
const composerComposing = ref(false)
const dictationSubmissionPending = ref(false)
let dictationSubmission = null
let dictationEscapeHeld = false
const seenEntryIds = ref(new Set())
const animatingEntryIds = ref(new Set())
const composerRef = ref(null)
const confirmationPanelHeight = ref(0)
const startComposerRef = ref(null)
const composerFrameRef = ref(null)
const startComposerAnchor = ref(null)
const mobileProjectTrigger = ref(null)
const composerDockAnchor = ref(null)
const startupDraftSnapshot = ref(null)
const modelPickerOpen = ref(false)
const thinkingPickerOpen = ref(false)
const toolsPickerOpen = ref(false)
const slashActiveIndex = ref(0)
const slashPickerDismissed = ref(false)
const promptError = ref('')
const dismissedConnectionIssueId = ref('')
const dismissedImageIssueId = ref('')
const composerScannerSettling = ref(false)
const composerCommitPulse = ref(false)
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
const fileLinksAvailable = computed(() => {
  return activeBackendConnectionInfo.value?.capabilities?.fileLinks === true
})
const piSettingsAvailable = computed(() => activeBackendConnectionInfo.value?.capabilities?.piSettings === true)
const reviewEnabled = computed(() => {
  return activeBackendConnectionInfo.value?.capabilities?.review === true
})
const reviewWatchEnabled = computed(() => {
  return activeBackendConnectionInfo.value?.capabilities?.reviewWatch === true
})
const tracingAvailable = computed(() => activeBackendConnectionInfo.value?.capabilities?.tracing === true)
const researchEnabled = computed(() => {
  return activeBackendConnectionInfo.value?.capabilities?.research === true
})
const reviewAvailable = computed(() => {
  return reviewEnabled.value
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
  openEditorTerminal,
  terminalCwd,
  terminalEl,
  terminalOpen,
  terminalStatus,
  resizeTerminal,
  sendKey,
  toggleTerminal,
  startTerminalResize,
  stopTerminalResize,
  nudgeTerminalHeight,
  setTerminalDrawerHeight,
  terminalDrawerHeight,
  terminalResizing,
  disposeTerminalResize,
} = useTerminal({ maxHeight: terminalHeightBudget })
const terminalCompact = computed(() => terminalDrawerHeight.value < 70)
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
const pendingInitialProjectCwd = ref('')
const pendingInitialSessionPath = ref('')
const requiredInitialBackendConnectionId = ref('')
let composerScannerSettlingTimer = null
let composerCommitTimer = null
const workbenchScroll = useWorkbenchScroll({
  workbench, composerRef, isActive: () => !traceWorkbenchCovered.value && !subagentSelection.value,
  prepareEntry: expandEntryActivity,
})
const {
  composerHeight,
  stickToBottom,
  hasNewOutput,
  composerReservedHeight,
  scrollToLatest,
  scrollToEntry,
  pauseScroll,
  resumeScroll,
  jumpToLatest,
  scheduleLiveScroll,
  handleWorkbenchScroll,
  handleWorkbenchWheel,
  handleWorkbenchTouchMove,
  handleWorkbenchPointerDown,
  resetWorkbenchScrollState,
  shouldFollowOutput,
  markNewOutput,
} = workbenchScroll
const liveTurn = useLiveTurnProjection({ onIntent: handleLiveTurnIntent })
const {
  agentRunning,
  beginUserTurn,
  clearLiveOutput,
  compaction,
  compactingContext,
  dispose: disposeLiveTurn,
  entries,
  liveActivity,
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
const persistedTranscriptItems = computed(() => groupToolActivity(
  entries.value.map(entry => ({ ...entry, persistedEntry: entry })),
))
const liveTranscriptItems = computed(() => groupToolActivity(liveFlowItems.value))
const compactionBoundary = computed(() => {
  if (!compactingContext.value) return null
  const cutEntryId = compaction.value?.cutEntryId
  const items = [...persistedTranscriptItems.value, ...liveTranscriptItems.value]
  const index = cutEntryId ? items.findIndex((item) => {
    const calls = item.type === 'tool-activity' ? item.items : [item]
    return calls.some((call) => activityEntry(call).id === cutEntryId)
  }) : -1
  return { index: index < 0 ? items.length : index, resolved: index >= 0 }
})
const inspectedSubagent = computed(() => {
  if (!subagentSelection.value) return null
  for (const group of [...persistedTranscriptItems.value, ...liveTranscriptItems.value]) {
    if (group.type !== 'tool-activity') continue
    const call = group.items.find(item => {
      const entry = activityEntry(item)
      return entry.toolName === 'subagent' && (entry.toolCallId || entry.id) === subagentSelection.value
    })
    if (call) return call
  }
  return null
})
const expandedActivity = ref(new Map())
function isActivityExpanded(group) {
  if (singleSubagentEntry(group)) return false
  return expandedActivity.value.get(group.id)
    ?? group.items.some(item => isToolExpanded(activityEntry(item)))
}
function expandEntryActivity(entryId) {
  const group = [...persistedTranscriptItems.value, ...liveTranscriptItems.value]
    .find(item => item.type === 'tool-activity'
      && item.items.some(call => activityEntry(call).id === entryId))
  if (group && !isActivityExpanded(group)) {
    expandedActivity.value = new Map(expandedActivity.value).set(group.id, true)
  }
}
function toggleActivity(group, event) {
  const subagent = singleSubagentEntry(group)
  if (subagent) {
    openSubagentInspector(subagent, event)
    return
  }
  const next = new Map(expandedActivity.value)
  next.set(group.id, !isActivityExpanded(group))
  expandedActivity.value = next
}
function toggleActivityTool(group, entry) {
  if (isActivityExpanded(group)) toggleTool(entry)
  else toggleActivity(group)
}
function inspectActivitySubagent(group, entry, event) {
  if (isActivityExpanded(group)) openSubagentInspector(entry, event)
  else toggleActivity(group, event)
}
function openSubagentInspector(entry, event) {
  if (extensionConfirmations.value.length) return
  subagentOpener.value = event?.currentTarget || document.activeElement
  subagentSelection.value = entry.toolCallId || entry.id
  closePickerMenus()
  pauseScroll()
}
function closeSubagentInspector() {
  subagentSelection.value = ''
}
const sessionWorkspace = useSessionWorkspace({
  liveTurn,
  terminal: {
    isOpen: () => terminalOpen.value,
    reconnect: connectTerminal,
  },
  scrollToLatest,
  shouldFollowOutput,
  markNewOutput,
  beforeRouteChange: prepareRouteChange,
})
const {
  activeRuntimeSession,
  availableModels,
  availableThinkingLevels,
  beginRenameSession,
  beginSessionTitle,
  beginStartupRun,
  cancelDeleteProject,
  cancelDeleteSession,
  cancelRenameSession,
  commitRenameSession,
  composerRuntime,
  confirmDeleteProject: workspaceConfirmDeleteProject,
  confirmDeleteSession: workspaceConfirmDeleteSession,
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
  forkingEntryId,
  forkSession,
  handleNativeNewSession: workspaceHandleNativeNewSession,
  handleRouteChange: workspaceHandleRouteChange,
  hydrateSessions,
  initPhase,
  initializing,
  invalidateSessionNavigation,
  loadHomeProjects,
  loadRoutedSession,
  loadSessions,
  loadSidebarProjects,
  loadStartRuntimeState,
  navigateHome: workspaceNavigateHome,
  newSessionCwd,
  patchRuntimeExtensionUi,
  reconcileRuntimeSessionRoster,
  reloadSession,
  reloadingSession,
  renameDraft,
  renamingSessionId,
  renamingSessionSavingId,
  renamingSessionSource,
  requestDeleteProject,
  requestDeleteSession,
  removeRuntimeSession,
  resettingEntryId,
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
  sessionTitleGenerating,
  subagentChildrenByParentPath,
  sidebarActivitySessions,
  startSelectedModel,
  startSelectedThinkingLevel,
  startupRun,
  switchingModel,
  switchingThinking,
  switchingServiceTier,
  setServiceTier,
  availableServiceTiers,
  serviceTier,
  updateRuntimeEventState,
  updateRuntimeSessionSnapshot,
  visibleProjects,
} = sessionWorkspace
const piSettingsCanReload = computed(() => Boolean(piSettingsTarget.value.sessionId
  && piSettingsTarget.value.sessionId === selectedSessionId.value
  && !activeRuntimeSession.value?.state?.isStreaming
  && !activeRuntimeSession.value?.state?.isCompacting
  && !promptSubmitting.value && !sessionActivating.value))
workbenchScroll.bind({ selectedSessionId, liveItems })
const homeComposerVisible = computed(() => !initializing.value && Boolean(
  startupRun.value || (!selectedSession.value && !sessionLoading.value && !sessionSwitching.value),
))
const composerMotion = useComposerMotion({
  frame: composerFrameRef,
  homeAnchor: startComposerAnchor,
  mobile: () => systemPromptMobile.value,
  dockAnchor: composerDockAnchor,
  startComposer: startComposerRef,
  sessionComposer: composerRef,
  workbench,
  homeVisible: homeComposerVisible,
  isSessionVisible: () => !homeComposerVisible.value || extensionConfirmations.value.length > 0 || confirmationPanelHeight.value > 0,
  onReveal(kind) {
    if (kind !== 'home') return
    finishStartupRun()
    const activeElement = document.activeElement
    if (activeElement === document.body || startComposerRef.value?.form?.contains(activeElement)) {
      refocusComposer()
    }
  },
  onFinish() {
    startupDraftSnapshot.value = null
  },
})
const {
  state: composerMotionState,
  style: composerFrameStyle,
  homeHeight: homeComposerHeight,
  coverVisible: composerCoverVisible,
} = composerMotion
const startComposerDraft = computed({
  get: () => startupDraftSnapshot.value?.text ?? draft.value,
  set: (value) => { if (!startupDraftSnapshot.value) draft.value = value },
})
const dictationOwner = computed(() => JSON.stringify([
  dictationGeneration.value,
  activeBackendConnectionId.value,
  activeBackendConnection.value?.url || '',
  selectedSessionId.value,
  activeComposerDraftKey,
  editingEntry.value?.id || '',
  homeComposerVisible.value ? newSessionCwd.value : '',
]))
const dictation = reactive(useDictation({
  owner: dictationOwner,
  submitting: () => dictationSubmissionPending.value,
  canStart: () => !composerComposing.value && !initializing.value
    && !sessionLoading.value && !sessionSwitching.value && !sessionActivating.value
    && !creatingSessionCwd.value && !startupRun.value && !startupDraftSnapshot.value
    && !promptSubmitting.value && !settingsOpen.value && !extensionConfirmations.value.length
    && (homeComposerVisible.value || Boolean(selectedSessionId.value)),
  captureDraft: () => {
    const composer = homeComposerVisible.value ? startComposerRef.value : composerRef.value
    const selection = composer?.getSelection()
    const input = composer?.getTextarea()
    if (!input || !selection || selection.text !== draft.value || composerComposing.value) return null
    return {
      owner: dictationOwner.value,
      composer,
      input,
      text: draft.value,
      revision: draftRevision.value,
      start: selection.start,
      end: selection.end,
    }
  },
  commitDraft: (captured, text, restoreFocus) => {
    const composer = homeComposerVisible.value ? startComposerRef.value : composerRef.value
    if (captured.owner !== dictationOwner.value || captured.revision !== draftRevision.value
      || captured.text !== draft.value || composerComposing.value
      || captured.composer !== composer || captured.input !== composer?.getTextarea()) return false
    const before = captured.text.slice(0, captured.start)
    const after = captured.text.slice(captured.end)
    const left = before && !/\s$/.test(before) && !/^[,.;:!?)}\]]/.test(text) ? ' ' : ''
    const right = after && !/^\s|^[,.;:!?)}\]]/.test(after) ? ' ' : ''
    const value = `${before}${left}${text}${right}${after}`
    draft.value = value
    const revision = draftRevision.value
    void composer.restoreSelection(captured.input, value, before.length + left.length + text.length,
      () => captured.owner === dictationOwner.value && revision === draftRevision.value
        && !composerComposing.value && !anyEscapeTargetOpen(false, true), restoreFocus)
    showSlashPicker()
    return true
  },
  openSettings: () => openGlobalSettings('dictation'),
  submit: event => homeComposerVisible.value
    ? handleStartComposerKeydown(event) : handleComposerKeydown(event),
  submitAllowed: dictationInputAllowed,
  focusAllowed: event => {
    const composer = homeComposerVisible.value ? startComposerRef.value : composerRef.value
    return Boolean(composer?.form?.contains(event.target))
  },
  shortcutAllowed: event => !anyEscapeTargetOpen(false, true) && dictationInputAllowed(event, true),
}))
watch(draft, () => { draftRevision.value++ }, { flush: 'sync' })
watch([
  activeBackendConnectionId,
  () => activeBackendConnection.value?.url,
  selectedSessionId,
  newSessionCwd,
  () => editingEntry.value?.id,
  resettingEntryId,
  reloadingSession,
  sessionActivating,
  creatingSessionCwd,
  sessionLoading,
  sessionSwitching,
  homeComposerVisible,
], invalidateDictationOwner, { flush: 'sync' })
watch([settingsOpen, settingsCategory], () => {
  if (dictation.active) dictation.cancel()
}, { flush: 'sync' })
const startupComposerDocking = computed(() => composerMotionState.value?.kind === 'home'
  && composerMotionState.value.phase !== 'lead')
const startupRevealHold = computed(() => composerMotionState.value?.kind === 'home'
  && composerMotionState.value.phase === 'revealing' && composerCoverVisible.value)
const startupRevealSettling = computed(() => composerMotionState.value?.kind === 'home'
  && composerMotionState.value.phase === 'revealing')
const inProjectNewSessionRun = computed(() => composerMotionState.value?.kind === 'session'
  && composerMotionState.value.phase !== 'revealing')
const inProjectNewSessionSettling = computed(() => composerMotionState.value?.kind === 'session'
  && composerMotionState.value.phase === 'revealing')
const selectedResearch = computed(() => {
  return activeRuntimeSession.value?.state?.research
    || selectedSession.value?.research
    || null
})
const isResearchSession = computed(() => Boolean(selectedResearch.value))
const canInspectResearch = computed(() => Boolean(selectedResearch.value?.sourceCount || selectedResearch.value?.invalidLinks?.length))
const researchReportNeedsRepair = computed(() => {
  return selectedResearch.value?.status === 'error'
    && selectedResearch.value?.phase === 'report'
})
const researchPhaseSteps = ['plan', 'gather', 'synthesize', 'report']
const researchPhaseIndex = computed(() => {
  return Math.max(0, researchPhaseSteps.indexOf(selectedResearch.value?.phase))
})
const researchPhaseTitle = computed(() => {
  const research = selectedResearch.value
  if (!research) return ''
  if (research.status === 'complete') return 'Research complete'
  if (researchReportNeedsRepair.value) return 'Report needs repair'
  if (research.status === 'error') return 'Research interrupted'
  if (research.phase === 'gather') return 'Gathering evidence'
  if (research.phase === 'synthesize') return 'Synthesizing findings'
  if (research.phase === 'report') return 'Writing report'
  return 'Planning research'
})
const researchPhaseSummary = computed(() => {
  const research = selectedResearch.value
  if (!research) return ''
  if (researchReportNeedsRepair.value) {
    const count = research.invalidLinkCount || research.invalidLinks?.length || 0
    if (count) return `${count} citation ${count === 1 ? 'target does' : 'targets do'} not match the source ledger`
    if (research.errorCode === 'citation_validation') {
      return 'The report has no citations that match the source ledger'
    }
    return 'The report stopped before validation completed'
  }
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
    canInspectResearch.value,
  ],
  ([sessionId, canInspect], [previousSessionId] = []) => {
    if (sessionId !== previousSessionId) {
      closeResearchCitationPreview()
      if (researchSourcesDismissedSessionId !== sessionId) {
        researchSourcesDismissedSessionId = ''
      }
    }
    if (!canInspect) {
      researchSourcesOpen.value = false
      closeResearchCitationPreview()
      return
    }
    if (researchSourcesDismissedSessionId === sessionId) return
    if (window.matchMedia('(min-width: 761px)').matches) openResearchSources()
  },
)

watch(
  () => visionSessionKey(scopedConfigTarget()),
  () => { void loadVisionConfig() },
)
watch(selectedSessionId, () => { sessionDetailsOpen.value = false })
const agentSettingsScope = computed(() => {
  if (settingsOpen.value) return 'global'
  return projectDetailCwd.value ? 'project' : 'session'
})
const agentSettingsTarget = computed(() => {
  if (settingsOpen.value && settingsCategory.value === 'agents') {
    return { cwd: scopedConfigTarget()?.cwd || '' }
  }
  if (projectDetailCwd.value) return { cwd: projectDetailCwd.value }
  if (sessionDetailsOpen.value) return selectedSession.value || null
  return null
})
const agentSettingsKey = computed(() => {
  if (!agentSettingsTarget.value) return ''
  return `${activeBackendConnectionId.value}:${agentSettingsScope.value}:${visionSessionKey(agentSettingsTarget.value)}`
})
const agentSettingsProps = computed(() => ({
  scope: agentSettingsScope.value,
  backendKey: `${activeBackendConnectionId.value}:${activeBackendConnection.value.url}`,
  availableModels: agentSettingsLoadedTarget.value?.cwd === scopedConfigTarget()?.cwd
    && availableModels.value.length ? availableModels.value : agentSettingsFallbackModels.value,
  subagentData: subagentConfigData.value,
  visionData: visionSettingsData.value,
  subagentLoading: subagentConfigLoading.value,
  visionLoading: visionSettingsLoading.value,
  subagentSaving: subagentConfigSaving.value,
  visionSaving: visionConfigSaving.value,
  subagentError: subagentConfigError.value,
  visionError: visionSettingsError.value,
}))
watch(agentSettingsKey, () => { void loadAgentSettings() })
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

  return { cwd, name: projectName(cwd), sessions: projectSessions }
})
const toolExpansion = useToolExpansion()
const {
  expandedTools,
  expandedSkills,
  copiedEntryId,
  fullscreenTool,
  fullscreenToolView,
  fullscreenToolSupportsMarkdown,
  fullscreenToolMarkdown,
  isToolExpanded,
  toggleTool,
  openToolFullscreen: showToolFullscreen,
  closeToolFullscreen,
  isSkillExpanded,
  toggleSkill,
  liveAssistantDisplayBlocks,
  liveAssistantDisplayCopyText,
  copyEntry,
  copyImageSource,
  copyTranscriptItem,
  copyTitle,
} = toolExpansion
const {
  filePreview,
  fileMenu,
  handleFileClick,
  handleFileContextMenu,
  closeFileMenu,
  closeFilePreview,
  approveFile,
  goBackFile,
  previewFileMenu,
  openFileActionMenu,
  fileMenuAction,
} = useFileLinks({
  sessionId: computed(() => sessionDetail.value?.session?.id || selectedSessionId.value),
  available: fileLinksAvailable,
  copyText: copyTranscriptItem,
  openEditorTerminal: async (...args) => {
    await closeTrace(false)
    const opened = await openEditorTerminal(...args)
    if (opened) closeToolFullscreen()
    return opened
  },
  openSettings: () => {
    closeToolFullscreen()
    openGlobalSettings('files')
  },
})
const transcriptPreferences = useTranscriptPreferences()
const {
  autolinkBareFilenames,
  error: transcriptPreferencesError,
  load: loadTranscriptPreferences,
  setAutolinkBareFilenames,
  setThinkingDefault,
  thinkingDefault,
} = transcriptPreferences
const autolinkPreview = computed(() => renderedText('README.md and example.com'))
const thinkingInitiallyExpanded = computed(
  () => thinkingDefault.value === 'expanded',
)
const {
  error: pinsError,
  load: loadPinnedSessions,
  loadedConnectionId: pinsLoadedConnectionId,
  loadRevision: pinsLoadRevision,
  loading: pinsLoading,
  pendingIds: pinPendingIds,
  pinnedIds: pinnedSessionIds,
  pinnedVersion,
  prune: prunePinnedSessions,
  pruneUnknown: pruneUnknownPins,
  toggle: togglePinnedSession,
  dispose: disposePinnedSessions,
} = usePinnedSessions()
const pinsReady = computed(() => {
  return pinsLoadedConnectionId.value === activeBackendConnectionId.value
    && !pinsLoading.value
})
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
  memoryTarget,
  saveMemory,
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
  eventStreamErrorRevision,
  openEventStream,
  runtimeEvents,
  setEventSessionId,
  subscribeTraces,
} = useRuntimeEvents({
  onActiveSession(activeSession) {
    if (activeSession.id && activeSession.cwd) {
      runtimeCwdBySessionId.set(activeSession.id, activeSession.cwd)
    }
    applyQueueSnapshot(activeSession)
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
  onRuntimeRoster(data) {
    reconcileRuntimeSessionRoster(data.sessionIds)
  },
  onRuntimeRemoved(data) {
    removeRuntimeSession(data.id)
    runtimeCwdBySessionId.delete(data.id)
  },
  onExtensionUi(data) {
    if (data.activeSessionId !== selectedSessionId.value) return
    patchRuntimeExtensionUi(data.state)
    surfaceExtensionNotification(data.state)
  },
  onExtensionError(data) {
    if (data.activeSessionId !== selectedSessionId.value) return
    const error = data.error
    const message = error?.message || error || 'Extension error'
    if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') return
    if (!error?.name && !error?.code && message === 'This operation was aborted') return
    promptError.value = message
  },
  onReconnect() {
    if (!selectedSessionId.value
      || sessionLoading.value
      || sessionSwitching.value) return
    scheduleSessionRefresh(selectedSessionId.value, {
      type: 'stream_reconnected',
    })
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
const promptQueue = computed(() => {
  const session = activeRuntimeSession.value
  return session?.id === selectedSessionId.value && session.state?.promptQueue
    || { revision: 0, held: false, error: '', items: [] }
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
const extensionConfirmations = computed(() => {
  const runtime = activeRuntimeSession.value
  if (!selectedSessionId.value || runtime?.id !== selectedSessionId.value) return []
  return runtime.state?.extensionUi?.confirmations || []
})
const extensionConfirmationNotices = computed(() => {
  const runtime = activeRuntimeSession.value
  if (runtime?.id !== selectedSessionId.value) return []
  return (runtime.state?.extensionUi?.notifications || []).filter(notice => notice.kind === 'confirmation-expired')
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
  return `${modelChip(model)} does not support images and no vision model is configured. Open Settings → Agent defaults to set a default vision model.`
})
const composerIssueScope = computed(() => JSON.stringify([
  activeBackendConnectionId.value,
  selectedSessionId.value || newSessionCwd.value,
]))
const imageComposerIssue = computed(() => {
  const message = imageSupportWarning.value
  const id = JSON.stringify([composerIssueScope.value, 'image', message])
  return message && id !== dismissedImageIssueId.value ? { id, kind: 'image', message } : null
})
const composerIssue = computed(() => {
  if (promptError.value) {
    return { id: `${composerIssueScope.value}:prompt`, kind: 'prompt', message: promptError.value }
  }
  if (eventStreamError.value) {
    const id = JSON.stringify([composerIssueScope.value, 'connection', eventStreamErrorRevision.value])
    if (id !== dismissedConnectionIssueId.value) {
      return { id, kind: 'connection', message: eventStreamError.value }
    }
  }
  return imageComposerIssue.value
})
watch(imageSupportWarning, () => { dismissedImageIssueId.value = '' }, { flush: 'sync' })

function dismissComposerIssue(issue) {
  if (issue.kind === 'prompt' && issue.id === composerIssue.value?.id && issue.message === promptError.value) {
    promptError.value = ''
  } else if (issue.kind === 'connection' && issue.id === composerIssue.value?.id) {
    dismissedConnectionIssueId.value = issue.id
  } else if (issue.kind === 'image' && issue.id === imageComposerIssue.value?.id) {
    dismissedImageIssueId.value = issue.id
  }
}

const visionDelegationNotice = computed(() => {
  if (shellModeDraft.value || !attachedImages.value.length) return ''
  const model = composerRuntime.value?.state?.model
  if (!model || model.supportsImages) return ''
  const visionModel = visionConfigData.value?.model
  if (!visionModel) return ''
  return `${modelChip(model)} can't read images directly. The model will call the vision subagent (${visionModel}) to inspect the image${attachedImages.value.length > 1 ? 's' : ''} when the prompt runs.`
})
const canSubmitDraft = computed(() => {
  if (imageSupportWarning.value || dictationSubmissionPending.value) return false
  if (dictation.active && dictation.phase !== 'testing') return true
  if (shellModeDraft.value) return Boolean(shellDraft.value)
  return Boolean(draft.value.trim()) || attachedImages.value.length > 0
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
const composerCompacting = computed(() => compactingContext.value
  || manualCompactionSessions.value.has(selectedSessionId.value))
const composerShellRunning = computed(() => composerRuntime.value?.state?.isBashRunning === true)
const sendButtonLabel = computed(() => {
  if (promptSubmitting.value || sessionActivating.value) return '…'
  if (shellModeDraft.value) return 'Run'
  return '↑'
})
const composerPlaceholder = computed(() => {
  if (sessionActivating.value) return 'Activating pi runtime…'
  if (promptQueue.value.held) return 'Add a task to the held queue…'
  if (agentRunning.value || composerCompacting.value || reloadingSession.value) return 'Add the next task…'
  if (researchReportNeedsRepair.value) {
    return 'Ask Leyline to repair and revalidate the report'
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
    startupShellVisible.value || startupRevealSettling.value,
  )
})
const inProjectTransitionActive = computed(() => {
  return Boolean(
    inProjectNewSessionRun.value || inProjectNewSessionSettling.value,
  )
})
const emptySessionShellVisible = computed(() => {
  return !extensionConfirmations.value.length
    && Boolean(isEmptySelectedSession.value || inProjectNewSessionRun.value)
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

watch(startupRun, (run) => {
  if (!run && composerMotionState.value?.kind === 'home'
    && composerMotionState.value.phase !== 'revealing') cancelComposerMotion()
})

watch(sessionLoading, (loading) => {
  if (loading) cancelComposerMotion()
})

watch(newSessionCwd, (cwd) => {
  loadStartRuntimeState(cwd)
})

watch(slashCommandItems, () => {
  slashActiveIndex.value = 0
})

watch(sessionDetail, (detail) => {
  switchComposerDraft(detail?.session?.id || '')
  liveTurn.setPersistedDetail(detail)
})

watch(activeRuntimeSession, (session) => {
  if (session?.id !== selectedSessionId.value) return
  liveTurn.setRuntimeState(session.state, session.snapshotRevision)
})

watch(compactingContext, (compacting) => {
  if (compacting) scheduleLiveScroll(selectedSessionId.value)
}, { flush: 'post' })

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

watch(selectedSessionId, (sessionId, previousSessionId) => {
  if (sessionId !== previousSessionId && composerMotionState.value
    && (composerMotionState.value.kind === 'session' || previousSessionId)) {
    cancelComposerMotion()
  }
  resetTracing()
  setEventSessionId(sessionId)
  emptySessionKind.value = 'session'
  if (!selectedSessionId.value) {
    reviewReady.value = false
    reviewOpenRequested.value = false
    closeReview(true)
  }
  expandedTools.value = new Set()
  expandedSkills.value = new Set()
  expandedActivity.value = new Map()
  closeSubagentInspector()
  startComposerRef.value?.dismissMobileSheet()
  composerRef.value?.dismissMobileSheet()
  closeSystemPrompt(false)
  closeToolFullscreen()
  closeFileMenu(false)
  closeFilePreview(false)
  promptError.value = ''
  seenEntryIds.value = new Set()
  animatingEntryIds.value = new Set()
  resetWorkbenchScrollState()
})

watch([activeBackendConnectionId, () => activeBackendConnection.value?.url], () => {
  resetTracing()
  closeSystemPrompt(false)
  closeSubagentInspector()
}, { flush: 'sync' })
watch(inspectedSubagent, call => {
  if (!call) closeSubagentInspector()
})
watch(() => extensionConfirmations.value.length, count => {
  if (count) closeSubagentInspector()
})
watch(activeBackendConnectionId, (connectionId) => {
  if (connectionId) void loadPinnedSessions(connectionId)
})
watch(
  [
    sessionsHydrated,
    pinsLoadRevision,
    () => sessionSnapshotKey(),
  ],
  ([hydrated]) => {
    if (!hydrated) return
    const connectionId = activeBackendConnectionId.value
    if (!connectionId
      || pinsLoadedConnectionId.value !== connectionId) return
    void pruneUnknownPins(connectionId, currentSessionIds())
  },
)
watch(tracingAvailable, (available) => { if (!available) resetTracing() })
watch(traceWorkbenchCovered, (covered) => {
  if (covered) pauseScroll()
  else resumeScroll()
}, { flush: 'sync' })
watch([reviewOpen, researchSourcesOpen, systemPromptEntry, memoryOpen, eventLogOpen, settingsOpen, projectDetailCwd, sessionDetailsOpen], (values) => {
  if (traceMode.value && values.some(Boolean)) void closeTrace(false)
})

watch([sessionDetail, liveFlowItems], () => {
  const id = systemPromptEntry.value?.id
  if (!id) return
  const live = liveFlowItems.value.find((item) => item.type === 'system'
    && (item.id === id || item.persistedEntry?.id === id))
  const entry = live?.persistedEntry || live
    || sessionDetail.value?.entries.find((item) => item.type === 'system' && item.id === id)
  if (entry) systemPromptEntry.value = entry
  else closeSystemPrompt(false)
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

const activeFocusScope = computed(() => {
  if (settingsOpen.value || filePreview.value || fileMenu.value || projectBrowserOpen.value || deleteConfirmProject.value || deleteConfirmSession.value) return 'external'
  if (fullscreenImage.value) return 'image'
  if (fullscreenTool.value) return 'tool'
  if (inspectedSubagent.value) return 'subagent'
  if (['quick', 'activity'].includes(sidebarNavigator.value) || sidebarRef.value?.sessionActionsOpen) return 'sidebar'
  if (!reviewDesktopAvailable.value && reviewOpen.value) return 'review'
  if (headerMoreOpen.value) return 'header'
  return ''
})
const mobileComposerSheetOpen = computed(() => Boolean(startComposerRef.value?.mobileSheetOpen || composerRef.value?.mobileSheetOpen))
const workbenchDialogOpen = computed(() => mobileComposerSheetOpen.value || ['image', 'tool', 'subagent', 'sidebar', 'review'].includes(activeFocusScope.value))
watch(mobileComposerSheetOpen, open => {
  if (open) closePickerMenus()
})
watch([activeFocusScope, () => extensionConfirmations.value.length, sessionLoading, sessionSwitching, composerMotionState], values => {
  if (!values.some(Boolean)) return
  startComposerRef.value?.dismissMobileSheet()
  composerRef.value?.dismissMobileSheet()
})
useModalFocus({ dialog: imageDialog, active: () => activeFocusScope.value === 'image', opener: imageOpener, initialFocus: imageDialog, fallbackSelector: '.header-more-button, .brand-home' })
useModalFocus({ dialog: toolDialog, active: () => activeFocusScope.value === 'tool', opener: toolOpener, initialFocus: toolDialog, fallbackSelector: '.header-more-button, .brand-home' })
useModalFocus({ dialog: () => subagentInspector.value?.element, active: () => activeFocusScope.value === 'subagent', opener: subagentOpener, initialFocus: () => subagentInspector.value?.element, fallbackSelector: '.header-more-button, .brand-home' })
useModalFocus({ dialog: () => !reviewDesktopAvailable.value && reviewOpen.value ? reviewPane.value?.element : null, active: () => activeFocusScope.value === 'review', opener: reviewOpener, fallbackSelector: '.header-more-button, .review-toggle-button' })
useModalFocus({ dialog: () => headerMoreOpen.value ? headerActions.value : null, active: () => activeFocusScope.value === 'header', opener: headerMoreButton, fallbackSelector: '.header-more-button' })

function measureDockSpace() {
  cancelAnimationFrame(layoutFrame)
  layoutFrame = requestAnimationFrame(() => {
    if (!mainPane.value || !composerFrameRef.value) return
    const chrome = mainPane.value.querySelector('.runtime-chrome')?.offsetHeight || 0
    const height = mainPane.value.clientHeight - chrome
    const composer = composerFrameRef.value.offsetHeight
    const available = Math.max(0, height - composer - 34)
    confirmationMaxHeight.value = Math.max(44, Math.min(320, available - (terminalOpen.value ? 48 : 0)))
    const confirmation = Math.min(confirmationPanelHeight.value, confirmationMaxHeight.value)
    terminalHeightBudget.value = Math.max(44, available - (confirmation ? confirmation + 12 : 0))
  })
}
watch([viewport, terminalOpen, confirmationPanelHeight, selectedResearch], measureDockSpace)
watch(terminalOpen, open => { if (!open) terminalKeysOpen.value = false })

onMounted(async () => {
  layoutObserver = new ResizeObserver(measureDockSpace)
  if (mainPane.value) layoutObserver.observe(mainPane.value)
  if (composerFrameRef.value) layoutObserver.observe(composerFrameRef.value)
  measureDockSpace()
  reviewDesktopQuery = window.matchMedia('(min-width: 1121px)')
  reviewDesktopAvailable.value = reviewDesktopQuery.matches
  reviewDesktopQuery.addEventListener('change', handleReviewDesktopChange)
  systemPromptViewport.addEventListener('change', updateSystemPromptViewport)
  window.addEventListener('keydown', handleGlobalKeydown, true)
  window.addEventListener('click', closeMenusOnOutsideClick)
  window.addEventListener('popstate', handleRouteChange)
  window.addEventListener('hashchange', handleRouteChange)
  window.addEventListener('leyline:new-session', handleNativeNewSession)
  window.addEventListener('leyline:toggle-terminal', handleNativeToggleTerminal)
  window.addEventListener('leyline:open-settings', handleNativeOpenSettings)
  window.addEventListener('leyline:toggle-session-details', handleNativeToggleSessionDetails)
  window.addEventListener('leyline:toggle-memory', handleNativeToggleMemory)
  window.addEventListener('leyline:toggle-sidebar', handleNativeToggleSidebar)
  window.addEventListener('focus', refreshPinnedSessions)
  document.addEventListener('visibilitychange', refreshPinnedSessions)
  const backendInitialization = await initializeBackendConnections()
  requiredInitialBackendConnectionId.value = backendInitialization.requestedId
  await loadTranscriptPreferences()
  if (activeBackendConnectionId.value) {
    void loadPinnedSessions(activeBackendConnectionId.value)
  }
  pendingInitialNativeCwd.value = consumeInitialNativeNewSessionCwd()
  pendingInitialProjectCwd.value = initialProjectCwd()
  pendingInitialSessionPath.value = initialSessionPath()
  if (!pendingInitialNativeCwd.value
    && !pendingInitialSessionPath.value
    && pendingInitialProjectCwd.value) {
    newSessionCwd.value = pendingInitialProjectCwd.value
  }
  await loadBackendWorkspace()
})

onUnmounted(() => {
  layoutObserver?.disconnect()
  cancelAnimationFrame(layoutFrame)
  reviewDesktopQuery?.removeEventListener('change', handleReviewDesktopChange)
  systemPromptViewport.removeEventListener('change', updateSystemPromptViewport)
  window.removeEventListener('keydown', handleGlobalKeydown, true)
  window.removeEventListener('click', closeMenusOnOutsideClick)
  window.removeEventListener('popstate', handleRouteChange)
  window.removeEventListener('hashchange', handleRouteChange)
  window.removeEventListener('leyline:new-session', handleNativeNewSession)
  window.removeEventListener('leyline:toggle-terminal', handleNativeToggleTerminal)
  window.removeEventListener('leyline:open-settings', handleNativeOpenSettings)
  window.removeEventListener('leyline:toggle-session-details', handleNativeToggleSessionDetails)
  window.removeEventListener('leyline:toggle-memory', handleNativeToggleMemory)
  window.removeEventListener('leyline:toggle-sidebar', handleNativeToggleSidebar)
  window.removeEventListener('focus', refreshPinnedSessions)
  document.removeEventListener('visibilitychange', refreshPinnedSessions)
  closeResearchCitationPreview()
  resetTracing()
  delete window.__leylineBackendConnectionId
  disposeTerminalResize()
  closeEventStream()
  sessionWorkspace.dispose()
  disposePinnedSessions()
  closeTerminalPanel()
  disposeLiveTurn()
  workbenchScroll.dispose()
  toolExpansion.dispose()
  clearTimeout(initPhaseTimer)
  cancelAnimationFrame(sessionHydrationFrame)
  clearTimeout(composerScannerSettlingTimer)
  clearTimeout(composerCommitTimer)
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

function applyQueueSnapshot(session) {
  if (!session) return
  if (session.id === activeRuntimeSession.value?.id
    && session.snapshotRevision < activeRuntimeSession.value.snapshotRevision) return
  updateRuntimeSessionSnapshot(session)
  if (session.id === selectedSessionId.value) activeRuntimeSession.value = session
}

function handleLiveTurnIntent(intent) {
  if (intent.type === 'refresh-session') {
    scheduleSessionRefresh(intent.activeSessionId, intent.event)
  }
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
  if (navigator === 'activity') activityActionError.value = ''
  if (!navigator) return
  settingsOpen.value = false
  sessionDetailsOpen.value = false
  eventLogOpen.value = false
  projectDetailCwd.value = ''
  if (memoryOpen.value) closeMemoryDrawer()
}

function isNewWindowClick(event) {
  return Boolean(
    event && (event.metaKey || event.ctrlKey || event.button === 1),
  )
}

function openWorkspaceWindow(path = '/', params = {}) {
  const url = new URL(path, window.location.origin)
  const backendConnectionId = params.backendConnectionId
    || activeBackendConnectionId.value
  if (backendConnectionId) {
    url.searchParams.set('leylineBackendConnectionId', backendConnectionId)
  }
  if (params.newSessionCwd) {
    url.searchParams.set('leylineNewSessionCwd', params.newSessionCwd)
  }
  if (params.projectCwd) {
    url.searchParams.set('leylineProjectCwd', params.projectCwd)
  }
  if (params.sessionPath) {
    url.searchParams.set('leylineSessionPath', params.sessionPath)
  }
  window.open(url.toString(), '_blank', 'noopener')
}

function selectStartProjectTarget(cwd, event) {
  if (isNewWindowClick(event)) {
    openWorkspaceWindow('/', { projectCwd: cwd })
    return
  }
  clearPendingWorkspaceTargets()
  resetTracing()
  selectStartProject(cwd)
}

function selectSidebarProject(project, event) {
  if (!project?.cwd) return
  if (isNewWindowClick(event)) {
    openWorkspaceWindow('/', { projectCwd: project.cwd })
    return
  }
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  clearPendingWorkspaceTargets()
  resetTracing()
  workspaceNavigateHome()
  selectStartProject(project.cwd)
  closeReview(true)
  projectDetailCwd.value = ''
  sidebarNavigator.value = ''
}

function createSessionTarget(project, event) {
  if (!project?.cwd || creatingSessionCwd.value === project.cwd) return
  if (isNewWindowClick(event)) {
    openWorkspaceWindow('/', { newSessionCwd: project?.cwd })
    return
  }
  clearPendingWorkspaceTargets()
  void createSession(project)
}

function selectSessionTarget(session, event) {
  if (isNewWindowClick(event)) {
    if (session?.id) {
      openWorkspaceWindow(`/sessions/${encodeURIComponent(session.id)}`)
    }
    return
  }
  clearPendingWorkspaceTargets()
  void selectSession(session)
}

function selectBackendTarget(connection, event) {
  if (!connection || backendConnectionBusyId.value) return
  if (isNewWindowClick(event)) {
    openWorkspaceWindow('/', { backendConnectionId: connection.id })
    return
  }
  if (requiredInitialBackendConnectionId.value
    && connection.id === activeBackendConnectionId.value
    && connection.id !== requiredInitialBackendConnectionId.value) {
    requiredInitialBackendConnectionId.value = ''
    pendingInitialNativeCwd.value = ''
    clearPendingWorkspaceTargets()
    window.location.replace('/')
    return
  }
  void switchBackendConnection(connection)
}

async function createSession(project, options = {}) {
  resetTracing()
  sidebarNavigator.value = ''
  await workspaceCreateSession(project, options)
  projectBrowserOpen.value = false
  projectDetailCwd.value = ''
  sidebarOpen.value = false
}

async function createSessionForCwd(cwd, options = {}) {
  resetTracing()
  const session = await workspaceCreateSessionForCwd(cwd, options)
  projectBrowserOpen.value = false
  projectDetailCwd.value = ''
  sidebarOpen.value = false
  return session
}

async function selectSession(session, options, traceRevision) {
  if (settingsOpen.value && !confirmPiSettingsLeave()) return
  if (!confirmDiscardMemoryChanges()) return
  settingsOpen.value = false
  memoryOpen.value = false
  headerMoreOpen.value = false
  if (traceRevision !== traceViewRevision) resetTracing()
  sidebarNavigator.value = ''
  await workspaceSelectSession(session, options)
  projectDetailCwd.value = ''
  sidebarOpen.value = false
}

async function navigateParentSession(event) {
  const parentPath = selectedSession.value?.parentSessionPath
  if (!parentPath) return

  const parent = sessions.value.find((session) => session.path === parentPath)
  if (parent) {
    if (isNewWindowClick(event)) selectSessionTarget(parent, event)
    else await selectSession(parent)
    return
  }
  if (isNewWindowClick(event)) {
    openWorkspaceWindow('/', { sessionPath: parentPath })
    return
  }

  const detail = await fetchSessionDetailByPath(parentPath)
  const parentSession = {
    id: detail.session.id,
    path: detail.session.path,
    cwd: detail.session.cwd,
  }
  await selectSession(parentSession)
}

async function navigateChildSession(childSession, event) {
  if (!childSession) return
  if (isNewWindowClick(event)) {
    if (childSession.path) {
      openWorkspaceWindow('/', { sessionPath: childSession.path })
    } else {
      selectSessionTarget(childSession, event)
    }
    return
  }

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
  sessionDetailsOpen.value = false
  sidebarOpen.value = false
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
async function confirmDeleteSession() {
  const session = deleteConfirmSession.value
  const connectionId = activeBackendConnectionId.value
  const sessionId = session?.id || ''
  if (!session || !await workspaceConfirmDeleteSession()) return
  discardComposerDraft(session.id)
  if (connectionId && sessionId) {
    void prunePinnedSessions(connectionId, [sessionId])
  }
}
async function confirmDeleteProject() {
  const project = deleteConfirmProject.value
  if (!project) return
  const connectionId = activeBackendConnectionId.value
  const sessionIds = new Set(
    sessions.value
      .filter((session) => session.cwd === project.cwd)
      .map((session) => session.id),
  )
  if (selectedSession.value?.cwd === project.cwd) {
    sessionIds.add(selectedSession.value.id)
  }
  if (!await workspaceConfirmDeleteProject()) return
  for (const sessionId of sessionIds) discardComposerDraft(sessionId)
  if (connectionId && sessionIds.size) {
    void prunePinnedSessions(connectionId, [...sessionIds])
  }
}
function togglePinSessionTarget(session) {
  const connectionId = activeBackendConnectionId.value
  if (!connectionId || !session?.id) return
  void togglePinnedSession(connectionId, session.id)
}
function retryPinnedSessions() {
  const connectionId = activeBackendConnectionId.value
  if (!connectionId) return
  void loadPinnedSessions(connectionId)
}
function currentSessionIds() {
  const knownIds = new Set(sessions.value.map((session) => session.id))
  if (selectedSession.value?.id) knownIds.add(selectedSession.value.id)
  return knownIds
}
function sessionSnapshotKey() {
  const ids = sessions.value.map((session) => session.id)
  if (selectedSession.value?.id) ids.push(selectedSession.value.id)
  return ids.sort().join(',')
}
function refreshPinnedSessions() {
  if (document.hidden) return
  const connectionId = activeBackendConnectionId.value
  if (!connectionId || pinsLoading.value) return
  void loadPinnedSessions(connectionId)
}
function confirmPendingDelete() {
  if (deleteConfirmProject.value) return confirmDeleteProject()
  return confirmDeleteSession()
}

async function handleNativeToggleTerminal() {
  if (settingsOpen.value || filePreview.value || fileMenu.value) return
  if (!selectedSession.value || initializing.value) return

  await toggleForegroundTerminal()
}

async function toggleForegroundTerminal() {
  await closeTrace(false)
  await toggleTerminal(selectedSessionId.value)
}

function openMobileSidebar() {
  void closeTrace(false)
  sidebarOpen.value = true
}

function prepareRouteChange() {
  if (settingsOpen.value && !confirmPiSettingsLeave()) return false
  if (!confirmDiscardMemoryChanges()) return false
  invalidateDictationOwner()
  settingsOpen.value = false
  memoryOpen.value = false
  sidebarNavigator.value = ''
  sidebarOpen.value = false
  sidebarRef.value?.closeSessionActions()
  headerMoreOpen.value = false
  terminalKeysOpen.value = false
  closeSubagentInspector()
  closeImageFullscreen()
  closeToolFullscreen()
  closeReview(true)
  resetTracing()
  return true
}

function handleRouteChange(event) {
  return workspaceHandleRouteChange(event)
}

function handleNativeNewSession(event) {
  resetTracing()
  return workspaceHandleNativeNewSession(event)
}

function handleNativeOpenSettings() {
  if (settingsOpen.value || filePreview.value || fileMenu.value || deleteConfirmActive.value) return
  openGlobalSettings()
}

function handleNativeToggleSessionDetails() {
  if (settingsOpen.value || filePreview.value || fileMenu.value || deleteConfirmActive.value || initializing.value) return
  toggleSessionDetails()
}

function handleNativeToggleMemory() {
  if (settingsOpen.value || filePreview.value || fileMenu.value) return
  toggleMemoryPanel()
}

function handleNativeToggleSidebar() {
  if (settingsOpen.value || filePreview.value || fileMenu.value) return
  if (window.matchMedia('(max-width: 760px)').matches) {
    if (sidebarOpen.value) sidebarOpen.value = false
    else openMobileSidebar()
    return
  }

  desktopSidebarHidden.value = !desktopSidebarHidden.value
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

function emptyTraceState() {
  return { selection: { traceId: null, observationId: null, tab: 'output' }, listState: { q: '', status: '', cwd: '', page: 1, limit: 20 }, sessionId: '' }
}

function updateTraceState(field, value) {
  const state = traceMode.value === 'workspace' ? workspaceTraceState
    : traceMode.value === 'explorer' ? explorerTraceState : inspectorTraceState
  state.value = { ...state.value, [field]: { ...value } }
}

function openTrace(mode, event) {
  if (!tracingAvailable.value || mode === 'inspector' && !selectedSessionId.value) return
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  if (traceMode.value === mode || traceMode.value === 'workspace' && traceOrigin.value === mode) {
    void closeTrace()
    return
  }
  closeSystemPrompt(false)
  closeReview(true)
  closeResearchSources()
  closeResearchCitationPreview()
  if (memoryOpen.value) closeMemoryDrawer()
  closePickerMenus()
  eventLogOpen.value = false
  sessionDetailsOpen.value = false
  projectDetailCwd.value = ''
  sidebarOpen.value = false
  sidebarNavigator.value = ''
  traceOpener = event?.currentTarget || document.activeElement
  traceViewRevision++
  traceOrigin.value = ''
  if (!traceClient.value) traceClient.value = createTraceClient(activeBackendConnection.value, subscribeTraces)
  if (mode === 'inspector') inspectorTraceState.value = { ...inspectorTraceState.value, sessionId: selectedSessionId.value }
  traceNavigationError.value = ''
  traceMode.value = mode
}

function openTraceWorkspace(payload) {
  if (!traceMode.value || traceMode.value === 'workspace' || !payload?.selection?.traceId) return
  traceViewRevision++
  traceOrigin.value = traceMode.value
  workspaceTraceState.value = {
    ...emptyTraceState(),
    selection: { ...payload.selection },
    sessionId: payload.sessionId || '',
    listState: traceMode.value === 'inspector' ? { ...inspectorTraceState.value.listState } : emptyTraceState().listState,
  }
  traceMode.value = 'workspace'
}

async function closeTrace(restoreFocus = true) {
  if (!traceMode.value) return
  if (traceMode.value === 'workspace' && restoreFocus && traceOrigin.value) {
    traceViewRevision++
    const state = traceOrigin.value === 'explorer' ? explorerTraceState : inspectorTraceState
    state.value = { ...state.value, selection: { ...workspaceTraceState.value.selection } }
    traceMode.value = traceOrigin.value
    traceOrigin.value = ''
    return
  }
  const opener = traceOpener
  const focused = tracePane.value?.$el?.contains(document.activeElement)
  const revision = ++traceViewRevision
  traceMode.value = ''
  traceOrigin.value = ''
  traceOpener = null
  traceClient.value?.dispose()
  traceClient.value = null
  await nextTick()
  if (restoreFocus && focused && revision === traceViewRevision && !traceMode.value) {
    const rect = opener?.isConnected && !opener.closest('[inert]') ? opener.getBoundingClientRect() : null
    const visible = rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < window.innerWidth
      && rect.bottom > 0 && rect.top < window.innerHeight && getComputedStyle(opener).visibility !== 'hidden'
      && (!opener.closest('.sidebar') || !systemPromptMobile.value || sidebarOpen.value)
    const target = visible ? opener : document.querySelector('.mobile-sidebar-button')
    target?.focus({ preventScroll: true })
  }
}

function resetTracing() {
  if (traceMode.value) void closeTrace(false)
  else traceViewRevision++
  traceNavigationError.value = ''
  inspectorTraceState.value = emptyTraceState()
  explorerTraceState.value = emptyTraceState()
  workspaceTraceState.value = emptyTraceState()
}

async function openTraceSession(target) {
  if (!target?.sessionId || !traceMode.value) return
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  const connection = activeBackendConnection.value
  const previousSessionId = selectedSessionId.value
  const navigationRevision = sessionWorkspace.getSessionNavigationRevision()
  const revision = traceViewRevision + 1
  const session = sessions.value.find(item => item.id === target.sessionId)
    || { id: target.sessionId, path: target.sessionFile || '', cwd: '' }
  await closeTrace(false)
  if (connection !== activeBackendConnection.value || traceViewRevision !== revision
    || selectedSessionId.value !== previousSessionId || traceMode.value
    || sessionWorkspace.getSessionNavigationRevision() !== navigationRevision) return
  const switching = selectedSessionId.value !== session.id
  const expectedRevision = revision + (switching ? 1 : 0)
  const ownedNavigationRevision = navigationRevision + (switching ? 1 : 0)
  const ownsNavigation = () => connection === activeBackendConnection.value
    && sessionWorkspace.getSessionNavigationRevision() === ownedNavigationRevision
    && traceViewRevision === expectedRevision && selectedSessionId.value === session.id && !traceMode.value
  if (switching) await selectSession(session, { shouldScroll: ownsNavigation }, revision)
  if (!ownsNavigation() || sessionError.value || sessionDetail.value?.session?.id !== session.id) return
  if (target.entryId) {
    const found = await scrollToEntry(target.entryId, ownsNavigation)
    if (ownsNavigation() && !found) traceNavigationError.value = 'This trace entry is unavailable in the current session branch.'
    return
  }
  await nextTick()
  if (ownsNavigation()) composerRef.value?.focus()
}

function updateSystemPromptViewport() {
  systemPromptMobile.value = systemPromptViewport.matches
}

function openSystemPrompt(entry, opener) {
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  closeReview(true)
  closeResearchSources()
  closeResearchCitationPreview()
  if (memoryOpen.value) closeMemoryDrawer()
  eventLogOpen.value = false
  sessionDetailsOpen.value = false
  projectDetailCwd.value = ''
  sidebarOpen.value = false
  systemPromptOpener = opener
  if (systemPromptEntry.value?.id === entry.id) {
    closeSystemPrompt()
    return
  }
  systemPromptSelection.value++
  systemPromptEntry.value = entry
}

async function closeSystemPrompt(restoreFocus = true) {
  if (!systemPromptEntry.value) return
  const opener = systemPromptOpener
  const selection = systemPromptSelection.value
  const focused = systemPromptPane.value?.$el?.contains(document.activeElement)
  systemPromptEntry.value = null
  systemPromptOpener = null
  await nextTick()
  if (restoreFocus && focused && !systemPromptEntry.value
    && systemPromptSelection.value === selection && opener?.isConnected
    && !opener.closest('[inert]') && opener.getClientRects().length) {
    opener.focus({ preventScroll: true })
  }
}

function openResearchSources() {
  if (!canInspectResearch.value) return
  closeSystemPrompt(false)
  closeResearchCitationPreview()
  closeReview(true)
  researchSourcesDismissedSessionId = ''
  researchSourcesOpen.value = true
}

function closeResearchSources(dismiss = true) {
  if (researchCitationPreview.value?.origin === 'ledger') closeResearchCitationPreview()
  researchSourcesOpen.value = false
  if (dismiss) researchSourcesDismissedSessionId = selectedSessionId.value
}

function toggleResearchSources() {
  if (researchSourcesOpen.value) closeResearchSources()
  else openResearchSources()
}

function closeResearchCitationPreview() {
  researchCitationPreviewToken++
  researchCitationAnchor?.classList.remove('citation-preview-active')
  researchCitationAnchor = null
  researchCitationPreview.value = null
}

async function openResearchSource(payload) {
  const id = Number(payload?.id || 0)
  const source = selectedResearch.value?.sources?.find((item) => {
    return item.id === id
  })
  if (!source || !payload?.rect) return
  const ledger = payload.origin === 'ledger'
  const paneWasOpen = (!ledger && researchSourcesOpen.value)
    || reviewOpen.value
    || reviewClosing.value
    || !!systemPromptEntry.value
  closeSystemPrompt(false)
  closeReview(true)
  if (!ledger) closeResearchSources(false)
  closeResearchCitationPreview()
  const token = researchCitationPreviewToken
  researchCitationAnchor = payload.anchor || null
  researchCitationAnchor?.classList.add('citation-preview-active')
  await nextTick()
  if (paneWasOpen) await wait(reviewMotionDuration())
  if (token !== researchCitationPreviewToken) return
  if (researchCitationAnchor && !researchCitationAnchor.isConnected) {
    closeResearchCitationPreview()
    return
  }
  const anchorRect = researchCitationAnchor?.getBoundingClientRect()
    || payload.rect
  researchCitationPreview.value = {
    anchorRect: {
      bottom: anchorRect.bottom,
      height: anchorRect.height,
      left: anchorRect.left,
      top: anchorRect.top,
      width: anchorRect.width,
    },
    origin: ledger ? 'ledger' : 'citation',
    source,
  }
}

function openReview() {
  reviewOpener.value = document.activeElement
  closeSystemPrompt(false)
  closeResearchCitationPreview()
  closeResearchSources(true)
  reviewOpenRequested.value = true
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

function handleReviewPrepared(canOpen) {
  reviewReady.value = true
  if (!reviewOpenRequested.value || !canOpen) return
  clearTimeout(reviewCloseTimer)
  reviewOpenRequested.value = false
  reviewClosing.value = false
  if (!reviewExpanded.value) reviewPaneExpanded.value = false
  reviewOpen.value = true
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
  return ['agent_end', 'error', 'aborted', 'bash_execution_end'].includes(event?.type)
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
  if (!prepareRouteChange()) return
  resetTracing()
  clearPendingWorkspaceTargets()
  workspaceNavigateHome()
  closeSystemPrompt(false)
  closeReview(true)
  closeResearchSources(false)
  closeResearchCitationPreview()
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

function liveItemClass(item) {
  return [
    `live-${item.type}-item`,
    item.status ? `is-${item.status}` : '',
    item.persistedEntry ? 'is-persisted' : '',
    item.streaming ? 'is-streaming' : '',
  ]
}


function confirmPiSettingsLeave() {
  return piSettingsPane.value?.confirmLeave?.() !== false
}

function closeGlobalSettings() {
  if (confirmPiSettingsLeave()) settingsOpen.value = false
}

async function reloadFromSettings() {
  if (!piSettingsCanReload.value || reloadingSession.value) return
  piSettingsActionError.value = ''
  await reloadSession()
  piSettingsActionError.value = sessionError.value || ''
  if (!piSettingsActionError.value) {
    await nextTick()
    piSettingsPane.value?.refresh?.()
  }
}

function refreshModelsFromSettings() {
  if (!selectedSessionId.value) void loadStartRuntimeState(newSessionCwd.value, { refresh: true })
}

function openGlobalSettings(category) {
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  if (settingsOpen.value && category && category !== settingsCategory.value && !confirmPiSettingsLeave()) return
  if (!settingsOpen.value) {
    piSettingsTarget.value = { sessionId: selectedSessionId.value || '', cwd: scopedConfigTarget()?.cwd || '' }
    piSettingsActionError.value = ''
  }
  settingsOpener.value = document.activeElement
  if (typeof category === 'string') settingsCategory.value = category
  closeSubagentInspector()
  closeImageFullscreen()
  closeToolFullscreen()
  closeResearchCitationPreview()
  closePickerMenus()
  closeProjectBrowser()
  sidebarNavigator.value = ''
  sidebarOpen.value = false
  settingsOpen.value = true
  sessionDetailsOpen.value = false
  eventLogOpen.value = false
  memoryOpen.value = false
  projectDetailCwd.value = ''
}

function toggleGlobalSettings(category) {
  if (settingsOpen.value && !category) closeGlobalSettings()
  else openGlobalSettings(category)
}

function toggleSessionDetails() {
  if (!selectedSession.value) return
  if (memoryDirty.value && !confirmDiscardMemoryChanges()) return
  sessionDetailsOpen.value = !sessionDetailsOpen.value
  settingsOpen.value = false
  eventLogOpen.value = false
  memoryOpen.value = false
  projectDetailCwd.value = ''
  sidebarNavigator.value = ''
  sidebarOpen.value = false
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
  if (requiredInitialBackendConnectionId.value
    && activeBackendConnectionId.value
      !== requiredInitialBackendConnectionId.value) {
    sessionError.value = backendConnectionError.value
      || 'Selected backend connection is unavailable'
    sessionsLoading.value = false
    initPhase.value = 'sessions'
    return
  }
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
      await handleNativeNewSession({ detail: { cwd, replaceRoute: true } })
      if (selectedSession.value?.cwd === cwd) pendingInitialNativeCwd.value = ''
    } finally {
      sessionsLoading.value = false
      initPhase.value = 'sessions'
    }
    return
  }

  if (pendingInitialSessionPath.value) {
    void loadSidebarProjects()
    scheduleSessionHydration()
    const path = pendingInitialSessionPath.value
    try {
      const detail = await fetchSessionDetailByPath(path)
      if (pendingInitialSessionPath.value !== path) return
      await selectSession({
        id: detail.session.id,
        path: detail.session.path,
        cwd: detail.session.cwd,
      }, { replaceRoute: true })
      if (sessionDetail.value?.session?.id === detail.session.id) {
        pendingInitialSessionPath.value = ''
      }
    } catch (error) {
      sessionError.value = error.message
    } finally {
      sessionsLoading.value = false
      initPhase.value = 'sessions'
    }
    return
  }

  const routeSessionId = sessionIdFromRoute()
  if (!routeSessionId) {
    if (await loadHomeProjects()) {
      if (pendingInitialProjectCwd.value && !sessionError.value) {
        clearPendingWorkspaceTargets()
      }
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
  if (requiredInitialBackendConnectionId.value
    && activeBackendConnectionId.value
      !== requiredInitialBackendConnectionId.value) {
    await initializeBackendConnections(
      requiredInitialBackendConnectionId.value,
    )
  }
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
    openGlobalSettings('connections')
  }
}

function confirmBackendDisconnect(targetName) {
  const notices = []
  if (agentRunning.value) {
    notices.push(`The current run will continue on ${activeBackendConnection.value.name}.`)
  }
  if (draft.value.trim()
    || attachedImages.value.length
    || editingEntry.value
    || composerDrafts.size
    || queueEditDrafts.size
    || composerRef.value?.hasQueueDrafts?.()
    || [...pendingComposerPastes].some((paste) => paste.valid)) {
    notices.push('Unsent composer drafts will be cleared.')
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
  sessionDetailsOpen.value = false
  memoryOpen.value = false
  if (eventLogOpen.value) projectDetailCwd.value = ''
}

function toggleMemoryPanel() {
  const wasOpen = memoryOpen.value
  toggleMemoryDrawer()
  if (!wasOpen && memoryOpen.value) {
    projectDetailCwd.value = ''
    sessionDetailsOpen.value = false
  }
}

function scopedConfigTarget() {
  const session = selectedSession.value
  if (session?.cwd) return session
  const cwd = newSessionCwd.value.trim()
  return cwd ? { cwd } : null
}

function visionSessionKey(session) {
  return `${session?.cwd || ''}:${session?.id || ''}:${session?.sessionFile || session?.path || ''}`
}

async function loadVisionConfig() {
  const target = scopedConfigTarget()
  const token = ++visionConfigRequestToken
  visionConfigData.value = { model: '' }
  if (!target?.cwd) return
  try {
    const data = await fetchVisionConfig(target)
    if (token === visionConfigRequestToken) visionConfigData.value = data
  } catch {
  }
}

async function loadAgentSettings() {
  const token = ++agentSettingsRequestToken
  const key = agentSettingsKey.value
  let target = agentSettingsTarget.value
  agentSettingsLoadedTarget.value = null
  agentSettingsFallbackModels.value = []
  subagentConfigData.value = { context: {}, agents: [] }
  visionSettingsData.value = { context: {}, overrides: {} }
  subagentConfigError.value = ''
  visionSettingsError.value = ''
  subagentConfigLoading.value = Boolean(target)
  visionSettingsLoading.value = Boolean(target)
  if (!target) return
  const current = () => token === agentSettingsRequestToken && key === agentSettingsKey.value
  try {
    if (!target.cwd || target.cwd !== scopedConfigTarget()?.cwd || !availableModels.value.length) {
      const state = await fetchPiRuntimeState(target.cwd)
      if (!current()) return
      agentSettingsFallbackModels.value = state?.state?.availableModels || []
      if (!target.cwd) target = { cwd: state?.cwd || '' }
    } else {
      agentSettingsFallbackModels.value = availableModels.value
    }
    if (!target.cwd) throw new Error('The backend did not provide a settings directory.')
    agentSettingsLoadedTarget.value = { ...target }
    await Promise.all([
      loadVisionConfig(),
      fetchSubagentConfigs(target).then((data) => {
        if (current()) subagentConfigData.value = data
      }).catch((error) => {
        if (current()) subagentConfigError.value = error.message
      }),
      fetchVisionConfig(target).then((data) => {
        if (current()) visionSettingsData.value = data
      }).catch((error) => {
        if (current()) visionSettingsError.value = error.message
      }),
    ])
  } catch (error) {
    if (current()) {
      subagentConfigError.value = error.message
      visionSettingsError.value = error.message
    }
  } finally {
    if (current()) {
      subagentConfigLoading.value = false
      visionSettingsLoading.value = false
    }
  }
}

async function saveSubagentModel(payload) {
  const target = agentSettingsLoadedTarget.value
  if (!target || payload.scope !== agentSettingsScope.value
    || subagentConfigLoading.value || subagentConfigSaving.value || visionConfigSaving.value) return
  const token = agentSettingsRequestToken
  subagentConfigSaving.value = true
  subagentConfigError.value = ''
  try {
    const data = payload.model
      ? await setSubagentModelOverride(target, payload.agentKey, payload.scope, payload.model)
      : await clearSubagentModelOverride(target, payload.agentKey, payload.scope)
    if (token === agentSettingsRequestToken) subagentConfigData.value = data
    else if (agentSettingsKey.value) void loadAgentSettings()
  } catch (error) {
    if (token === agentSettingsRequestToken) subagentConfigError.value = error.message
  } finally {
    subagentConfigSaving.value = false
  }
}

async function saveSubagentBatchSize(payload) {
  const target = agentSettingsLoadedTarget.value
  if (!target || payload.scope !== agentSettingsScope.value || !['global', 'session'].includes(payload.scope)
    || subagentConfigLoading.value || subagentConfigSaving.value || visionConfigSaving.value) return
  const token = agentSettingsRequestToken
  const key = agentSettingsKey.value
  const current = () => token === agentSettingsRequestToken && key === agentSettingsKey.value
  subagentConfigSaving.value = true
  subagentConfigError.value = ''
  try {
    const data = await setSubagentBatchSize(target, payload.scope, payload.batchSize)
    if (current()) subagentConfigData.value = data
    else if (agentSettingsKey.value) void loadAgentSettings()
  } catch (error) {
    if (current()) subagentConfigError.value = error.message
  } finally {
    subagentConfigSaving.value = false
  }
}

async function saveVisionModel(payload) {
  const target = agentSettingsLoadedTarget.value
  if (!target || payload.scope !== agentSettingsScope.value
    || visionSettingsLoading.value || subagentConfigSaving.value || visionConfigSaving.value) return
  const token = agentSettingsRequestToken
  visionConfigSaving.value = true
  visionSettingsError.value = ''
  try {
    const data = await setVisionOverride(target, payload.scope, payload.model, payload.thinking)
    if (token === agentSettingsRequestToken) visionSettingsData.value = data
    else if (agentSettingsKey.value) void loadAgentSettings()
    await loadVisionConfig()
  } catch (error) {
    if (token === agentSettingsRequestToken) visionSettingsError.value = error.message
  } finally {
    visionConfigSaving.value = false
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

function retryComposerFocus(attempt = 0) {
  const composer = homeComposerVisible.value ? startComposerRef.value : composerRef.value
  if (composer) {
    composer.focus()
    return
  }
  if (attempt < 40) setTimeout(() => retryComposerFocus(attempt + 1), 50)
}

async function refocusComposer() {
  await nextTick()
  retryComposerFocus()
}

async function requestResearchReportRepair() {
  if (!researchReportNeedsRepair.value
    || promptSubmitting.value
    || agentRunning.value
    || reloadingSession.value
    || switchingServiceTier.value
    || sessionLoading.value
    || sessionSwitching.value
    || sessionActivating.value
    || compactingContext.value
    || editingEntry.value
    || draft.value.trim()
    || attachedImages.value.length) return
  draft.value = 'Repair the existing report against the source ledger and write the complete corrected report. Revalidate it without starting a new research cycle.'
  await nextTick()
  await submitDraft()
}

function cancelComposerMotion() {
  const fromHome = composerMotionState.value?.kind === 'home'
  composerMotion.cancel()
  startupDraftSnapshot.value = null
  if (fromHome) finishStartupRun()
}

function pulseComposerCommit() {
  composerCommitPulse.value = true
  clearTimeout(composerCommitTimer)
  composerCommitTimer = window.setTimeout(() => {
    composerCommitPulse.value = false
  }, 240)
}

function composerDraftKey(sessionId) {
  return sessionId ? `session:${sessionId}` : startComposerDraftKey
}

function currentComposerDraft() {
  return {
    text: draft.value,
    images: [...attachedImages.value],
    editingEntry: editingEntry.value,
  }
}

function storeComposerDraft(key, state) {
  if (state.text || state.images.length || state.editingEntry) {
    composerDrafts.set(key, {
      ...state,
      images: [...state.images],
    })
    return
  }
  composerDrafts.delete(key)
}

function invalidateDictationOwner() {
  dictationSubmission = null
  dictationSubmissionPending.value = false
  dictationGeneration.value++
}

function applyComposerDraft(state) {
  invalidateDictationOwner()
  draft.value = state?.text || ''
  attachedImages.value = [...(state?.images || [])]
  editingEntry.value = state?.editingEntry || null
}

function activateComposerDraft(key, state = composerDrafts.get(key)) {
  activeComposerDraftKey = key
  composerDrafts.delete(key)
  applyComposerDraft(state)
}

function switchComposerDraft(sessionId) {
  const nextKey = composerDraftKey(sessionId)
  if (nextKey === activeComposerDraftKey) return
  storeComposerDraft(activeComposerDraftKey, currentComposerDraft())
  activateComposerDraft(nextKey)
}

function composerDraftState(key) {
  if (key === activeComposerDraftKey) return currentComposerDraft()
  return composerDrafts.get(key) || {
    text: '',
    images: [],
    editingEntry: null,
  }
}

function moveComposerDraft(sourceKey, sessionId) {
  if (sourceKey === activeComposerDraftKey) invalidateDictationOwner()
  const targetKey = composerDraftKey(sessionId)
  if (imageChooser?.key === sourceKey) imageChooser.key = targetKey
  const state = composerDraftState(sourceKey)
  for (const paste of pendingComposerPastes) {
    if (paste.valid && paste.key === sourceKey) paste.key = targetKey
  }
  composerDrafts.delete(sourceKey)
  if (selectedSessionId.value === sessionId) {
    activateComposerDraft(targetKey, state)
  } else {
    storeComposerDraft(targetKey, state)
  }
  return targetKey
}

function appendComposerImages(key, images) {
  if (key === activeComposerDraftKey) {
    attachedImages.value = [...attachedImages.value, ...images]
    return
  }
  const state = composerDraftState(key)
  storeComposerDraft(key, {
    ...state,
    images: [...state.images, ...images],
  })
}

function hasPendingComposerPastes(key) {
  return [...pendingComposerPastes].some((paste) => {
    return paste.valid && paste.key === key
  })
}

async function settleComposerPastes(key) {
  while (true) {
    const pending = [...pendingComposerPastes].filter((paste) => {
      return paste.valid && paste.key === key
    })
    if (!pending.length) return
    await Promise.allSettled(pending.map((paste) => paste.promise))
  }
}

function discardComposerDraft(sessionId) {
  const key = composerDraftKey(sessionId)
  if (key === activeComposerDraftKey) invalidateDictationOwner()
  if (imageChooser?.key === key) imageChooser = null
  for (const paste of pendingComposerPastes) {
    if (paste.key === key) paste.valid = false
  }
  if (activeComposerDraftKey === key
    && selectedSessionId.value !== sessionId) {
    activateComposerDraft(composerDraftKey(selectedSessionId.value))
  }
  composerDrafts.delete(key)
  queueEditDrafts.delete(sessionId)
}

function completeComposerEdit(key, entry) {
  if (key === activeComposerDraftKey) {
    if (editingEntry.value?.id === entry.id) editingEntry.value = null
    return
  }
  const state = composerDrafts.get(key)
  if (state?.editingEntry?.id !== entry.id) return
  storeComposerDraft(key, { ...state, editingEntry: null })
}

function restoreComposerEdit(key, entry, text, images) {
  if (key === activeComposerDraftKey) {
    if (editingEntry.value?.id !== entry.id
      || draft.value
      || attachedImages.value.length) return
    draft.value = text
    attachedImages.value = [...images]
    return
  }
  const state = composerDrafts.get(key)
  if (state?.editingEntry?.id !== entry.id
    || state.text
    || state.images.length) return
  storeComposerDraft(key, { ...state, text, images })
}

async function finishDictationForSubmit() {
  if (dictationSubmissionPending.value || composerComposing.value) return false
  const owner = dictationOwner.value
  const submission = {}
  dictationSubmission = submission
  dictationSubmissionPending.value = true
  try {
    return Boolean(await dictation.finish() && owner === dictationOwner.value && !composerComposing.value)
  } catch (error) {
    if (dictationSubmission === submission && owner === dictationOwner.value) promptError.value = error.message
    return false
  } finally {
    if (dictationSubmission === submission) {
      dictationSubmission = null
      dictationSubmissionPending.value = false
    }
  }
}

async function submitDraft(streamingBehavior) {
  if (composerReadPending.value || dictationSubmissionPending.value) return
  const submissionOwner = dictationOwner.value
  if (!await finishDictationForSubmit()) return
  if (submissionOwner !== dictationOwner.value) return
  const owner = activeComposerDraftKey
  if (hasPendingComposerPastes(owner)) {
    composerReadPending.value = true
    try { await settleComposerPastes(owner) }
    finally { composerReadPending.value = false }
    if (owner !== activeComposerDraftKey || submissionOwner !== dictationOwner.value) return
  }
  const submittedDraft = draft.value
  const text = submittedDraft.trim()
  const submittedAttachments = attachedImages.value
  const images = submittedAttachments.map(({ preview, ...image }) => image)
  const shellCommand = shellCommandFromText(text)
  const compactCommand = compactCommandFromText(text)
  if (!text && images.length === 0) return
  if ((promptSubmitting.value && (!composerCompacting.value || editingEntry.value))
    || (reloadingSession.value && editingEntry.value)
    || sessionLoading.value
    || sessionSwitching.value
    || sessionActivating.value
    || !selectedSessionId.value
    || imageSupportWarning.value) {
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

  if (streamingBehavior === 'steer' && promptQueue.value.held && !editingEntry.value) {
    promptError.value = 'Resume the queue before steering.'
    return
  }

  if (!editingEntry.value && (agentRunning.value || composerShellRunning.value || composerCompacting.value
    || reloadingSession.value || switchingModel.value || switchingServiceTier.value
    || promptQueue.value.held || promptQueue.value.items.length)) {
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
        streamingBehavior || 'followUp',
      )
      if (data.active && selectedSessionId.value === sessionId) {
        applyQueueSnapshot(data.active)
      }
    } catch (error) {
      if (selectedSessionId.value === sessionId) {
        if (!draft.value && !attachedImages.value.length) {
          draft.value = submittedDraft
          attachedImages.value = submittedAttachments
        }
        if (error.name !== 'AbortError'
          && !['Prompt cancelled', 'This operation was aborted'].includes(error.message)) {
          promptError.value = error.message
        }
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
  if (editing) {
    draft.value = ''
    attachedImages.value = []
    if (!await stopForPromptEdit(sessionId)) {
      restoreComposerEdit(composerDraftKey(sessionId), editing, submittedDraft, submittedAttachments)
      return
    }
  }
  const previousDetail = sessionDetail.value
  const shouldFollowOutput = editing || stickToBottom.value
  const startsTurn = !isHandledSlashCommand(text)
  const startsEmptySession = !startupRun.value
    && isEmptySelectedSession.value
    && !editing
    && startsTurn
  const initializesResearchSession = !editing
    && !isResearchSession.value
    && !selectedSessionHasMessages.value
    && emptySessionKind.value === 'research'
  if (editing) {
    invalidateSessionNavigation()
    resetLiveState()
    trimSessionToEntry(editing.id)
    stickToBottom.value = true
    hasNewOutput.value = false
  } else {
    reconcileCurrentDetail()
  }
  const motionToken = startsEmptySession ? composerMotion.begin('session') : null
  if (!startsEmptySession && !startupRun.value) pulseComposerCommit()
  let localEntry
  let promptAccepted = false
  const releaseTitle = !editing && startsTurn && !initializesResearchSession
    ? beginSessionTitle(sessionId, text, images)
    : undefined
  try {
    localEntry = beginUserTurn(text, images)
    promptSubmitting.value = true
    promptError.value = ''
    if (!editing) {
      draft.value = ''
      attachedImages.value = []
    }
    if (shouldFollowOutput) await scrollToLatest()
    else hasNewOutput.value = true

    const data = editing
      ? await editPrompt(
        sessionId,
        editing.id,
        text,
        images,
        localEntry.handoffId,
      )
      : await submitPrompt(
        sessionId,
        text,
        images,
        undefined,
        initializesResearchSession ? 'research' : undefined,
        localEntry.handoffId,
      )
    if (editing) completeComposerEdit(composerDraftKey(sessionId), editing)
    if (selectedSessionId.value === sessionId) {
      if (data.active) applyQueueSnapshot(data.active)
      if (initializesResearchSession) emptySessionKind.value = 'session'
      if (isHandledSlashCommand(text) || data.queued) {
        removeOptimisticEntry(localEntry, data.queued === true)
      }
      if (editingEntry.value?.id === editing?.id) editingEntry.value = null
      if (startsTurn && !data.queued
        && activeRuntimeSession.value?.state?.isStreaming) {
        setAgentRunning(true, 'Thinking…')
      }
      promptAccepted = true
    }
  } catch (error) {
    if (editing) {
      restoreComposerEdit(
        composerDraftKey(sessionId),
        editing,
        submittedDraft,
        submittedAttachments,
      )
    }
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
      if (error.name !== 'AbortError'
        && !['Prompt cancelled', 'This operation was aborted'].includes(error.message)) {
        promptError.value = error.message
      }
    }
  } finally {
    releaseTitle?.()
    if (composerMotion.isCurrent(motionToken)) {
      if (promptAccepted) composerMotion.ready(motionToken)
      else cancelComposerMotion()
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
  if (composerCompacting.value) {
    promptError.value = 'Compaction is already running.'
    return
  }
  if (images.length) {
    promptError.value = 'Compaction cannot include image attachments.'
    return
  }

  const sessionId = selectedSessionId.value
  const submittedDraft = draft.value
  manualCompactionSessions.value = new Set([...manualCompactionSessions.value, sessionId])
  promptError.value = ''
  draft.value = ''
  refocusComposer()
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
    await loadSessions({ selectFirst: false, showLoading: false })
    if (selectedSessionId.value === sessionId) await scrollToLatest()
  } catch (error) {
    if (selectedSessionId.value === sessionId && error.name !== 'AbortError'
      && !['Compaction cancelled', 'This operation was aborted'].includes(error.message)) {
      if (!draft.value && !attachedImages.value.length) draft.value = submittedDraft
      promptError.value = error.message
    }
  } finally {
    const pending = new Set(manualCompactionSessions.value)
    pending.delete(sessionId)
    manualCompactionSessions.value = pending
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

  const sessionId = selectedSessionId.value
  const submittedDraft = draft.value
  promptSubmitting.value = true
  promptError.value = ''
  draft.value = ''
  refocusComposer()
  try {
    const data = await runShellCommand(
      sessionId,
      shellCommand.command,
      shellCommand.excludeFromContext,
    )
    if (data.active && selectedSessionId.value === sessionId) {
      applyQueueSnapshot(data.active)
      emptySessionKind.value = 'session'
    }
  } catch (error) {
    if (selectedSessionId.value === sessionId) {
      if (!draft.value && !attachedImages.value.length) draft.value = submittedDraft
      promptError.value = error.message
    }
  } finally {
    promptSubmitting.value = false
    refocusComposer()
  }
}

function isHandledSlashCommand(text) {
  return /^\/compact(?:\s|$)/.test(text)
}

function startEditingEntry(entry) {
  if (!entry?.id) return
  invalidateDictationOwner()

  const target = persistedEditingEntry(entry)
  if (!target) {
    promptError.value = 'Wait for this message to finish saving before editing.'
    return
  }
  if (target.role !== 'user') return

  invalidateSessionNavigation()
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
  if (promptSubmitting.value
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
  invalidateDictationOwner()

  const text = (target.text || textFromBlocks(messageBlocksFor(target))).trim()
  const images = imageBlocksFor(target).map(({ preview, ...image }) => image)
  if (!text && images.length === 0) return

  const sessionId = selectedSessionId.value
  if (!await stopForPromptEdit(sessionId)) return
  const previousDetail = sessionDetail.value
  invalidateSessionNavigation()
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
    const data = await editPrompt(
      sessionId,
      target.id,
      text,
      images,
      localEntry.handoffId,
    )
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

async function stopForPromptEdit(sessionId) {
  if (!agentRunning.value && !composerCompacting.value && !composerShellRunning.value) return true
  promptSubmitting.value = true
  setLiveActivity('Stopping…')
  try {
    const data = await interruptPiSession(sessionId)
    if (selectedSessionId.value !== sessionId) return false
    if (data.active) activeRuntimeSession.value = data.active
    return true
  } catch (error) {
    if (selectedSessionId.value === sessionId) promptError.value = error.message
    return false
  } finally {
    promptSubmitting.value = false
    if (selectedSessionId.value === sessionId && liveActivity.value === 'Stopping…') setLiveActivity('')
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
  if (editingEntry.value) invalidateDictationOwner()
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

async function interruptAgent() {
  if ((!agentRunning.value && !composerCompacting.value && !composerShellRunning.value)
    || interrupting.value) return

  interrupting.value = true
  promptError.value = ''
  setLiveActivity('Stopping…')

  const sessionId = selectedSessionId.value
  try {
    const data = await interruptPiSession(sessionId)
    if (selectedSessionId.value === sessionId) {
      if (data.active) activeRuntimeSession.value = data.active
      setAgentRunning(activeRuntimeSession.value?.state?.isStreaming === true)
    }
  } catch (error) {
    if (selectedSessionId.value === sessionId) {
      promptError.value = error.message
      setLiveActivity('')
    }
  } finally {
    interrupting.value = false
  }
}

async function interruptActivitySession(session) {
  if (!session?.id || activityInterruptingSessionId.value) return

  activityInterruptingSessionId.value = session.id
  activityActionError.value = ''
  try {
    await interruptPiSession(session.id)
  } catch (error) {
    activityActionError.value = `Could not stop ${sessionTitle(session)}: ${error.message}`
  } finally {
    activityInterruptingSessionId.value = ''
  }
}

async function selectModel(model) {
  modelPickerOpen.value = false
  promptError.value = ''
  await selectWorkspaceModel(model)
}

async function selectServiceTier(tier) {
  closePickerMenus()
  promptError.value = ''
  await setServiceTier(tier)
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
  startComposerRef.value?.dismissServiceTierPicker(false)
  composerRef.value?.dismissServiceTierPicker(false)
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

function handleComposerCompositionStart(event) {
  composerComposing.value = true
  dictation.cancel()
  compositionInputs.set(event.target, { key: activeComposerDraftKey, composing: true })
}

function handleComposerCompositionEnd(event) {
  composerComposing.value = false
  const state = compositionInputs.get(event.target)
  if (!state) return
  setTimeout(() => { if (compositionInputs.get(event.target) === state) state.composing = false }, 0)
}

function handleComposerInputBlur(event) {
  composerComposing.value = false
  compositionInputs.delete(event.target)
}

function isComposingInput(event) {
  return event.isComposing || event.keyCode === 229 || compositionInputs.get(event.target)?.composing
}

function dictationInputAllowed(event, allowSession = false) {
  if (isComposingInput(event) || composerComposing.value || settingsOpen.value
    || terminalEl.value?.contains(event.target)) return false
  const composer = homeComposerVisible.value ? startComposerRef.value : composerRef.value
  if (!composer?.form || composer.form.closest('[inert]')) return false
  const target = event.target
  if (target?.closest?.('input, textarea, [contenteditable="true"], [role="dialog"], [role="menu"]')) {
    return target === composer.getTextarea()
  }
  return target === document.body || composer.form.contains(target)
    || (allowSession && Boolean(selectedSessionId.value))
}

function handleComposerKeydown(event) {
  if (isComposingInput(event)) return
  if (handleSlashPickerKeydown(event)) return
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submitDraft(event.altKey ? 'steer' : 'followUp')
}

function openComposerImagePicker() {
  imageChooser = { key: activeComposerDraftKey, valid: true }
  composerImageInput.value.value = ''
  composerImageInput.value.click()
}

function cancelComposerImageSelection() {
  imageChooser = null
}

function handleComposerImageSelection(event) {
  const owner = imageChooser
  imageChooser = null
  if (owner?.valid) void addComposerImages([...event.target.files], owner.key)
  event.target.value = ''
}

function handleComposerPaste(event) {
  const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  void addComposerImages(files, activeComposerDraftKey)
}

async function addComposerImages(files, key) {
  files = files.filter(file => file.type.startsWith('image/'))
  if (!files.length) return
  promptError.value = ''
  const paste = {
    key,
    promise: Promise.all(files.map(fileToImageContent)),
    valid: true,
  }
  pendingComposerPastes.add(paste)

  try {
    const images = await paste.promise
    if (paste.valid) appendComposerImages(paste.key, images)
  } catch (error) {
    if (paste.valid && paste.key === activeComposerDraftKey) {
      promptError.value = error.message
    }
  } finally {
    pendingComposerPastes.delete(paste)
  }
}

function removeAttachedImage(index) {
  attachedImages.value = attachedImages.value.filter((_, itemIndex) => {
    return itemIndex !== index
  })
}

function openImageFullscreen(src, title = 'Image preview', event, file = null) {
  if (!src) return
  imageOpener.value = event?.currentTarget || document.activeElement
  fullscreenImage.value = { src, title, file }
}

function openToolFullscreen(entry, event) {
  toolOpener.value = event?.currentTarget || document.activeElement
  showToolFullscreen(entry)
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
  if (isComposingInput(event)) return
  if (switchingServiceTier.value && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    return
  }
  if (handleSlashPickerKeydown(event)) return
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submitStartDraft()
}

async function submitStartDraft() {
  if (switchingServiceTier.value || dictationSubmissionPending.value) return
  const submissionOwner = dictationOwner.value
  if (!await finishDictationForSubmit()) return
  if (submissionOwner !== dictationOwner.value) return
  if (switchingServiceTier.value || !homeComposerVisible.value || sessionLoading.value
    || sessionSwitching.value || sessionActivating.value) return
  const text = draft.value.trim()
  const requestedServiceTier = serviceTier.value
  const model = startSelectedModel.value
    || (requestedServiceTier !== 'standard' ? composerRuntime.value?.state?.model : null)
  const thinkingLevel = startSelectedThinkingLevel.value
  const targetCwd = newSessionCwd.value.trim()
  const sourceDraftKey = activeComposerDraftKey
  const hasPrompt = Boolean(
    text
      || attachedImages.value.length
      || hasPendingComposerPastes(sourceDraftKey),
  )
  const kind = text.startsWith('!') ? 'session' : startSessionKind.value
  if (!targetCwd || creatingSessionCwd.value || startupRun.value) return

  closePickerMenus()
  const animatePrompt = hasPrompt && !isHandledSlashCommand(text)
  startupDraftSnapshot.value = animatePrompt ? {
    ...currentComposerDraft(),
    cwd: targetCwd,
    modelLabel: currentModelLabel.value,
    thinkingLabel: currentThinkingLabel.value,
  } : null
  const motionToken = animatePrompt ? composerMotion.begin('home') : null
  beginStartupRun(targetCwd, { hasPrompt, model, thinkingLevel })
  let session

  try {
    session = await runStartupPhase('creating', () => createSessionForCwd(targetCwd, { kind }))
    const isCurrent = () => session?.id === selectedSessionId.value
      && (!motionToken || composerMotion.isCurrent(motionToken))
    if (!session || !isCurrent()) return
    if (hasPrompt) {
      const targetDraftKey = moveComposerDraft(sourceDraftKey, session.id)
      await settleComposerPastes(targetDraftKey)
      if (!isCurrent()) return
    }
    startSessionKind.value = 'session'
    if (model) {
      await runStartupPhase('model', () => selectWorkspaceModel(model))
      if (!isCurrent() || sessionError.value) return
    }
    if (thinkingLevel) {
      await runStartupPhase('thinking', () => selectWorkspaceThinkingLevel(thinkingLevel))
      if (!isCurrent() || sessionError.value) return
    }
    if (requestedServiceTier !== 'standard') {
      const applied = await runStartupPhase('service-tier', () => setServiceTier(requestedServiceTier))
      if (!isCurrent() || !applied || sessionError.value) return
    }
    if (hasPrompt) await runStartupPhase('submitting', submitDraft)
  } finally {
    if (!motionToken) finishStartupRun()
    else if (composerMotion.isCurrent(motionToken)) {
      if (session?.id === selectedSessionId.value && !isEmptySelectedSession.value
        && !sessionError.value && !promptError.value) {
        composerMotion.ready(motionToken)
      } else cancelComposerMotion()
    }
  }
}

function handleGlobalKeydown(event) {
  if (isComposingInput(event)) return
  if (event.key === 'Escape') {
    if (dictationEscapeHeld && event.repeat) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    dictationEscapeHeld = false
  }
  if (dictation.handleKeydown(event)) return
  if (settingsOpen.value) {
    if (event.key === 'Escape') {
      dictation.stopTest()
      if (event.target?.closest?.('.global-settings-modal')) return
      event.preventDefault()
      event.stopPropagation()
      closeGlobalSettings()
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
    } else if ((event.metaKey || event.ctrlKey) && event.shiftKey
      && event.key.toLowerCase() === 'a') {
      event.preventDefault()
    }
    return
  }
  if (terminalEl.value?.contains(event.target) && !anyEscapeTargetOpen()) return
  if ((event.metaKey || event.ctrlKey)
    && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (filePreview.value || fileMenu.value
      || deleteConfirmActive.value || editingEntry.value || renamingSessionId.value) {
      return
    }
    closePickerMenus()
    closeProjectBrowser()
    closeResearchCitationPreview()
    sidebarRef.value?.openNavigator('quick', event)
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.shiftKey
    && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    if (filePreview.value || fileMenu.value
      || deleteConfirmActive.value || editingEntry.value || renamingSessionId.value) {
      return
    }
    closePickerMenus()
    closeProjectBrowser()
    closeResearchCitationPreview()
    sidebarRef.value?.openNavigator('activity', event)
    return
  }
  if (event.key === 'Escape') handleEscape(event)
}

function anyEscapeTargetOpen(ignoreQueue = false, ignoreEditing = false) {
  return Boolean(
    mobileComposerSheetOpen.value
    || startComposerRef.value?.serviceTierPickerOpen
    || composerRef.value?.serviceTierPickerOpen
    || startComposerRef.value?.issueDetailsOpen
    || composerRef.value?.issueDetailsOpen
    || (!ignoreQueue && composerRef.value?.queueUiOpen)
    || fullscreenImage.value
    || fullscreenTool.value
    || inspectedSubagent.value
    || filePreview.value
    || fileMenu.value
    || projectBrowserOpen.value
    || sidebarNavigator.value
    || sidebarRef.value?.sessionActionsOpen
    || sidebarOpen.value
    || headerMoreOpen.value
    || terminalKeysOpen.value
    || (!reviewDesktopAvailable.value && (reviewOpen.value || reviewOpenRequested.value))
    || settingsOpen.value
    || eventLogOpen.value
    || sessionDetailsOpen.value
    || projectDetailCwd.value
    || memoryOpen.value
    || deleteConfirmActive.value
    || (!ignoreEditing && editingEntry.value)
    || renamingSessionId.value
    || modelPickerOpen.value
    || thinkingPickerOpen.value
    || toolsPickerOpen.value
    || startProjectPickerOpen.value
    || slashPickerOpen.value
    || researchSourcesOpen.value
    || systemPromptEntry.value
    || traceMode.value
    || researchCitationPreview.value
    || (reviewPaneExpanded.value && window.innerWidth > 1120)
  )
}

function handleEscape(event) {
  if (mobileComposerSheetOpen.value) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    startComposerRef.value?.dismissMobileSheet()
    composerRef.value?.dismissMobileSheet()
    return
  }
  if (fileMenu.value || filePreview.value) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    if (fileMenu.value) closeFileMenu()
    else closeFilePreview()
    return
  }
  if (sidebarNavigator.value || projectBrowserOpen.value || deleteConfirmActive.value || fullscreenImage.value || fullscreenTool.value || inspectedSubagent.value) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    if (deleteConfirmActive.value) cancelConfirmDelete()
    else if (projectBrowserOpen.value) closeProjectBrowser()
    else if (fullscreenImage.value) closeImageFullscreen()
    else if (fullscreenTool.value) closeToolFullscreen()
    else if (inspectedSubagent.value) {
      if (!subagentInspector.value?.dismissReader()) closeSubagentInspector()
    } else sidebarNavigator.value = ''
    return
  }
  if (headerMoreOpen.value || terminalKeysOpen.value || sidebarRef.value?.sessionActionsOpen) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    headerMoreOpen.value = false
    terminalKeysOpen.value = false
    sidebarRef.value?.closeSessionActions()
    return
  }
  if (sidebarOpen.value || (!reviewDesktopAvailable.value && (reviewOpen.value || reviewOpenRequested.value))) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    if (sidebarOpen.value) sidebarOpen.value = false
    else closeReview()
    return
  }
  if (traceMode.value) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    void closeTrace()
    return
  }
  if (systemPromptPane.value?.dismissMenu()) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    return
  }
  const issueCovered = eventLogOpen.value || sessionDetailsOpen.value || projectDetailCwd.value
    || memoryOpen.value || researchSourcesOpen.value || systemPromptEntry.value
    || researchCitationPreview.value || (reviewPaneExpanded.value && window.innerWidth > 1120)
  if (!issueCovered
    && (startComposerRef.value?.dismissIssueDetails() || composerRef.value?.dismissIssueDetails())) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    return
  }
  if (!issueCovered
    && (startComposerRef.value?.dismissServiceTierPicker() || composerRef.value?.dismissServiceTierPicker())) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    return
  }
  if (!anyEscapeTargetOpen(true) && composerRef.value?.dismissQueue?.()) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    return
  }
  if (dictation.active) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    dictationEscapeHeld = true
    void dictation.cancel()
    return
  }
  if (!anyEscapeTargetOpen() && (dictation.phase === 'error' || dictation.error)) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    dictation.dismissError()
    return
  }
  if (!anyEscapeTargetOpen()
    && (agentRunning.value || composerCompacting.value || composerShellRunning.value)) {
    event?.preventDefault?.()
    void interruptAgent()
  }
  settingsOpen.value = false
  eventLogOpen.value = false
  sidebarNavigator.value = ''
  sessionDetailsOpen.value = false
  projectDetailCwd.value = ''
  collapseReviewExpanded()
  if (researchSourcesOpen.value) closeResearchSources()
  closeSystemPrompt()
  closeResearchCitationPreview()
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

function initialProjectCwd() {
  const url = new URL(window.location.href)
  return url.searchParams.get('leylineProjectCwd')?.trim() || ''
}

function initialSessionPath() {
  const url = new URL(window.location.href)
  return url.searchParams.get('leylineSessionPath')?.trim() || ''
}

function clearPendingWorkspaceTargets() {
  pendingInitialProjectCwd.value = ''
  pendingInitialSessionPath.value = ''
  const url = new URL(window.location.href)
  const previous = url.search
  url.searchParams.delete('leylineProjectCwd')
  url.searchParams.delete('leylineSessionPath')
  if (url.search === previous) return
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(window.history.state, '', next)
}

function closeMenusOnOutsideClick(event) {
  if (!event.target.closest('.topbar-meta')) headerMoreOpen.value = false
  if (!event.target.closest('.terminal-header, .terminal-keys')) terminalKeysOpen.value = false
  composerRef.value?.closePopovers?.(event)
  startComposerRef.value?.closePopovers?.(event)
  if (event.target.closest('.project-browser-modal')) return
  if (event.target.closest('.model-picker')) return
  if (event.target.closest('.start-project-button, .start-project-menu')) return
  closePickerMenus()
}

function closePickerMenus() {
  startComposerRef.value?.dismissServiceTierPicker(false)
  composerRef.value?.dismissServiceTierPicker(false)
  modelPickerOpen.value = false
  thinkingPickerOpen.value = false
  toolsPickerOpen.value = false
  startProjectPickerOpen.value = false
}

</script>

<template>
  <main
    class="leyline-app"
    @click.capture="handleFileClick"
    @click="handleFileClick"
    @auxclick.capture="handleFileClick"
    @auxclick="handleFileClick"
    @contextmenu.capture="handleFileContextMenu"
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
      'session-handoff': sessionHandoff,
      'terminal-open': terminalOpen,
      'terminal-resizing': terminalResizing,
      'event-log-open': eventLogOpen,
      'memory-open': memoryOpen,
      'review-open': reviewDesktopAvailable && reviewAvailable && reviewOpen && !!selectedSession,
      'review-expanded': reviewDesktopAvailable && reviewAvailable && reviewOpen && reviewExpanded
        && !!selectedSession,
      'review-transcript-hidden': reviewDesktopAvailable && reviewAvailable
        && (reviewOpen || reviewClosing) && reviewPaneExpanded
        && !!selectedSession,
      'research-open': researchSourcesOpen
        && isResearchSession
        && !!selectedSession,
      'system-prompt-open': !!systemPromptEntry,
      'trace-workbench-covered': traceWorkbenchCovered,
    }"
    :style="{
      '--composer-height': `${composerHeight}px`,
      '--confirmation-max-height': `${confirmationMaxHeight}px`,
      '--composer-reserved-height': confirmationPanelHeight
        ? `calc(${composerReservedHeight} + ${confirmationPanelHeight + 12}px)`
        : composerReservedHeight,
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

    <input ref="composerImageInput" type="file" accept="image/*" multiple hidden @change="handleComposerImageSelection" @cancel="cancelComposerImageSelection" />
    <header class="app-header" :inert="workbenchDialogOpen">
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
          @click="openMobileSidebar"
        ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
        <button v-if="systemPromptMobile && homeComposerVisible" type="button" class="topbar-icon-button mobile-home-details" aria-label="Session details" aria-haspopup="dialog" @click="startComposerRef?.openMobileDetails($event)"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" /></svg></button>
        <div v-if="selectedSession" class="workbench-title-row">
          <button
            v-if="selectedSession.isSubagentSession
              && selectedSession.parentSessionPath"
            class="parent-session-button"
            type="button"
            @click="navigateParentSession"
            @auxclick.middle.prevent="navigateParentSession"
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
            <span
              v-if="sessionTitleGenerating(selectedSession.id)"
              class="session-title-spinner"
              aria-hidden="true"
            ></span>
            <strong
              :class="{ 'session-title-pending': sessionTitleGenerating(selectedSession.id) }"
              aria-live="polite"
              aria-atomic="true"
            >{{ sessionTitleGenerating(selectedSession.id)
              ? 'Generating title…'
              : sessionTitle(selectedSession) }}</strong>
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
            : researchReportNeedsRepair
              ? 'repair'
              : selectedResearch.phase }}</span>
        </div>
        <div v-if="selectedSession" class="topbar-meta">
          <button ref="headerMoreButton" class="header-more-button topbar-icon-button" type="button" aria-label="Session actions" :aria-expanded="headerMoreOpen" @click="headerMoreOpen = !headerMoreOpen"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" /></svg></button>
          <div ref="headerActions" class="header-utilities" :class="{ open: headerMoreOpen }" role="group" aria-label="Session actions" @click="headerMoreOpen = false">
          <button
            v-if="tracingAvailable"
            class="topbar-icon-button trace-inspector-toggle"
            :class="{ active: traceMode === 'inspector' || traceMode === 'workspace' && traceOrigin === 'inspector' }"
            type="button"
            title="Session traces"
            aria-label="Session traces"
            :aria-pressed="traceMode === 'inspector' || traceMode === 'workspace' && traceOrigin === 'inspector'"
            @click="openTrace('inspector', $event)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h4M2 8h8M2 13h12M6 1v4M10 6v4M14 11v4" /></svg>
          </button>
          <button
            class="topbar-icon-button session-details-toggle"
            :class="{ active: sessionDetailsOpen }"
            type="button"
            title="Session details"
            aria-label="Session details"
            :aria-pressed="sessionDetailsOpen"
            @click="toggleSessionDetails"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6"></circle>
              <path d="M8 7v4M8 4.5v.5"></path>
            </svg>
          </button>
          <button
            v-if="canInspectResearch"
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
      </div>
    </header>

    <SessionSidebar
      ref="sidebarRef"
      :navigator-focus-active="activeFocusScope === 'sidebar'"
      :inert="workbenchDialogOpen"
      :activity-action-error="activityActionError"
      :active-backend-connection="activeBackendConnection"
      :agent-running="agentRunning"
      :backend-connection-busy-id="backendConnectionBusyId"
      :backend-connection-error="backendConnectionError"
      :backend-connections="backendConnections"
      :creating-session-cwd="creatingSessionCwd"
      :default-backend-connection-id="defaultBackendConnectionId"
      :deleting-project-cwd="deletingProjectCwd"
      :deleting-session-id="deletingSessionId"
      :interrupting-session-id="activityInterruptingSessionId"
      :navigator="sidebarNavigator"
      :new-session-cwd="newSessionCwd"
      :pin-pending-ids="pinPendingIds"
      :pinned-session-ids="pinnedSessionIds"
      :pinned-version="pinnedVersion"
      :pins-error="pinsError"
      :pins-ready="pinsReady"
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
      :session-title-generating="sessionTitleGenerating"
      :sessions-error="sessionsError"
      :sessions-hydrated="sessionsHydrated"
      :sessions-hydrating="sessionsHydrating"
      :sessions-hydration-error="sessionsHydrationError"
      :sessions-loading="sessionsLoading"
      :subagent-children-by-parent-path="subagentChildrenByParentPath"
      :visible-projects="visibleProjects"
      :tracing-available="tracingAvailable"
      :traces-open="traceMode === 'explorer' || traceMode === 'workspace' && traceOrigin === 'explorer'"
      @open-traces="openTrace('explorer', $event)"
      @begin-rename-session="beginRenameSession"
      @cancel-rename-session="cancelRenameSession"
      @commit-rename-session="commitRenameSession"
      @create-session="createSessionTarget"
      @interrupt-session="interruptActivitySession"
      @open-project-browser="openProjectBrowser"
      @open-project-detail="openProjectDetail"
      @open-settings="toggleGlobalSettings"
      @reload-session="reloadSession"
      @request-delete-project="requestDeleteProject"
      @request-delete-session="requestDeleteSession"
      @retry-pins="retryPinnedSessions"
      @retry-sessions="retrySessions"
      @select-backend="selectBackendTarget"
      @select-child-session="navigateChildSession"
      @select-project="selectSidebarProject"
      @select-session="selectSessionTarget"
      @toggle-pin-session="togglePinSessionTarget"
      @update:navigator="setSidebarNavigator"
    />

    <section ref="mainPane" class="main-pane" :inert="workbenchDialogOpen || traceWorkbenchCovered || (!!systemPromptEntry || traceMode === 'inspector') && systemPromptMobile" :aria-hidden="traceWorkbenchCovered || undefined">
      <div v-if="runtimeChromeVisible" class="runtime-chrome">
        <section
          v-if="isResearchSession"
          class="research-phase-bar"
        >
          <div class="research-phase-summary">
            <div>
              <strong>{{ researchPhaseTitle }}</strong>
              <span>{{ researchPhaseSummary }}</span>
            </div>
            <button
              v-if="researchReportNeedsRepair"
              type="button"
              :disabled="promptSubmitting
                || agentRunning
                || reloadingSession
                || switchingServiceTier
                || sessionLoading
                || sessionSwitching
                || sessionActivating
                || compactingContext
                || !!editingEntry
                || !!draft.trim()
                || !!attachedImages.length"
              :title="editingEntry
                ? 'Finish or cancel the current edit before repairing the report'
                : draft.trim() || attachedImages.length
                  ? 'Send or clear the current draft before repairing the report'
                  : 'Repair and revalidate this report'"
              @click="requestResearchReportRepair"
            >Repair report</button>
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


      <p v-if="traceNavigationError" class="trace-navigation-notice error-note" role="status">
        {{ traceNavigationError }}
        <button type="button" aria-label="Dismiss trace notice" @click="traceNavigationError = ''">Close</button>
      </p>
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
        @pointerdown.passive="handleWorkbenchPointerDown"
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
            v-if="pendingInitialNativeCwd
              || pendingInitialProjectCwd
              || pendingInitialSessionPath
              || requiredInitialBackendConnectionId"
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
            <button type="button" @click="openGlobalSettings('connections')">Choose backend</button>
            <button
              v-if="!activeBackendConnection.builtIn"
              type="button"
              @click="selectBackendTarget(backendConnections[0], $event)"
              @auxclick.middle.prevent="selectBackendTarget(
                backendConnections[0],
                $event,
              )"
            >Use native backend</button>
          </div>
        </div>
        <div
          v-else-if="startFlowVisible || startupRevealHold"
          class="start-panel"
        >
          <h2 class="start-headline-text">{{ startHeadline }}</h2>
          <div v-if="systemPromptMobile && homeComposerVisible" class="mobile-home-context">
            <button ref="mobileProjectTrigger" type="button" class="start-project-button" aria-haspopup="dialog" :aria-expanded="startProjectPickerOpen" @click="startProjectPickerOpen = !startProjectPickerOpen"><span class="start-project-icon">▱</span><span class="start-project-label">{{ startProjectLabel }}</span><span aria-hidden="true">›</span></button>
            <span>{{ activeBackendConnection?.name || 'Local' }}</span>
          </div>
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
          <div
            ref="startComposerAnchor"
            class="start-composer-anchor"
            :style="{ height: `${homeComposerHeight}px` }"
          ></div>
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
            && persistedTranscriptItems.length > 0"
        >
          <template
            v-for="(item, itemIndex) in persistedTranscriptItems"
            :key="`${selectedSession.id}:${item.id}`"
          >
            <MobileToolActivity
              v-if="item.type === 'tool-activity'"
              :class="{ 'is-frozen': compactionBoundary?.resolved && itemIndex < compactionBoundary.index }"
              :group="item"
              :expanded="isActivityExpanded(item)"
              @toggle="toggleActivity"
            >
              <template #default="{ items }">
                <TranscriptEntry
                  v-for="call in items"
                  :key="activityEntry(call).toolCallId || activityEntry(call).id"
                  :data-entry-id="activityEntry(call).id"
                  :copied-entry-id="copiedEntryId"
                  :entry="activityEntry(call)"
                  :research-cwd="selectedSession?.cwd || ''"
                  :tool-expanded="isActivityExpanded(item) && isToolExpanded(activityEntry(call))"
                  :tool-status="activityStatus(call)"
                  :subagent-inspector-selected="subagentSelection === (activityEntry(call).toolCallId || activityEntry(call).id)"
                  @copy="copyEntry"
                  @fork="forkSession"
                  @inspect-subagent="(entry, event) => inspectActivitySubagent(item, entry, event)"
                  @open-image="openImageFullscreen"
                  @open-research-source="openResearchSource"
                  @reset="resetSessionToEntry"
                  @open-tool-fullscreen="openToolFullscreen"
                  @toggle-tool="toggleActivityTool(item, activityEntry(call))"
                />
              </template>
            </MobileToolActivity>

            <TranscriptEntry
              v-else
              :data-entry-id="item.id"
              :class="{
                'message-enter': isEnteringEntry(item),
                'is-frozen': compactionBoundary?.resolved && itemIndex < compactionBoundary.index,
              }"
              :copied-entry-id="copiedEntryId"
              :entry="activityEntry(item)"
              :research-cwd="selectedSession?.cwd || ''"
              :skill-expanded="isSkillExpanded(activityEntry(item))"
              :system-prompt-selected="systemPromptEntry?.id === item.id"
              :thinking-initially-expanded="thinkingInitiallyExpanded"
              :tool-expanded="isToolExpanded(activityEntry(item))"
              :tool-status="activityStatus(item)"
              @copy="copyEntry"
              @edit="startEditingEntry"
              @fork="forkSession"
              @mark-feedback="markEntryFeedback"
              @inspect-subagent="openSubagentInspector"
              @open-image="openImageFullscreen"
              @open-research-source="openResearchSource"
              @open-system-prompt="openSystemPrompt"
              @reset="resetSessionToEntry"
              @retry="retryEntry"
              @open-tool-fullscreen="openToolFullscreen"
              @toggle-skill="toggleSkill"
              @toggle-tool="toggleTool"
            />
          </template>
        </template>

        <TransitionGroup
          v-if="!startupRun && !inProjectNewSessionRun"
          name="live-row"
          tag="div"
          class="live-stack"
          :class="{ 'is-active': liveTurnActive, 'is-running': agentRunning }"
        >
          <div
            v-for="(item, itemIndex) in liveTranscriptItems"
            :key="item.id"
            class="live-item"
            :data-entry-id="item.persistedEntry?.id || item.id"
            :class="[liveItemClass(item), {
              'is-frozen': compactionBoundary?.resolved
                && persistedTranscriptItems.length + itemIndex < compactionBoundary.index,
            }]"
          >
            <MobileToolActivity
              v-if="item.type === 'tool-activity'"
              :group="item"
              :expanded="isActivityExpanded(item)"
              @toggle="toggleActivity"
            >
              <template #default="{ items }">
                <TranscriptEntry
                  v-for="call in items"
                  :key="activityEntry(call).toolCallId || activityEntry(call).id"
                  :data-entry-id="activityEntry(call).id"
                  :copied-entry-id="copiedEntryId"
                  :entry="activityEntry(call)"
                  :research-cwd="selectedSession?.cwd || ''"
                  :tool-expanded="isActivityExpanded(item) && isToolExpanded(activityEntry(call))"
                  :tool-status="activityStatus(call)"
                  :subagent-inspector-selected="subagentSelection === (activityEntry(call).toolCallId || activityEntry(call).id)"
                  @copy="copyEntry"
                  @fork="forkSession"
                  @inspect-subagent="(entry, event) => inspectActivitySubagent(item, entry, event)"
                  @open-image="openImageFullscreen"
                  @open-research-source="openResearchSource"
                  @reset="resetSessionToEntry"
                  @open-tool-fullscreen="openToolFullscreen"
                  @toggle-tool="toggleActivityTool(item, activityEntry(call))"
                />
              </template>
            </MobileToolActivity>

            <TranscriptEntry
              v-else-if="item.type === 'system' || item.type === 'model-change'"
              :copied-entry-id="copiedEntryId"
              :entry="item.persistedEntry || item"
              :system-prompt-selected="systemPromptEntry?.id === (item.persistedEntry || item).id"
              @open-system-prompt="openSystemPrompt"
            />

            <TranscriptEntry
              v-else-if="item.type === 'message' || item.type === 'summary'"
              :copied-entry-id="copiedEntryId"
              :entry="item.persistedEntry || item"
              :research-cwd="selectedSession?.cwd || ''"
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

        <CompactionBoundary
          v-if="!startupRun && !inProjectNewSessionRun && compactingContext"
          :reason="compaction?.reason || ''"
          :started-at="compaction?.startedAt || 0"
          :tokens="contextUsage?.tokens ?? null"
        />
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

      <section
        class="terminal-panel"
        :class="{ 'is-compact': terminalCompact }"
        :inert="!terminalOpen"
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
          <button class="terminal-keys-toggle" type="button" :aria-expanded="terminalKeysOpen" @click="terminalKeysOpen = !terminalKeysOpen">Keys</button>
          <button type="button" aria-label="Close terminal" @click="closeTerminalPanel">×</button>
        </div>
        <div v-if="terminalKeysOpen" class="terminal-keys" role="group" aria-label="Terminal keys">
          <button v-for="[key, label] in terminalKeys" :key="key" type="button" :disabled="terminalStatus !== 'connected'" @click="sendKey(key)">{{ label }}</button>
        </div>
        <div ref="terminalEl" class="terminal-frame"></div>
      </section>

      <div
        v-if="selectedSession
          && !initializing
          && !emptySessionShellVisible
          && !startupRun"
        class="composer-fade"
        :class="{ 'is-switching': sessionLoading || sessionSwitching }"
      ></div>

      <ExtensionConfirmations
        v-if="selectedSession && (extensionConfirmations.length || extensionConfirmationNotices.length)"
        :key="`${activeBackendConnectionId}:${selectedSessionId}`"
        :session-id="selectedSessionId"
        :requests="extensionConfirmations"
        :notices="extensionConfirmationNotices"
        :disabled="!eventStreamConnected"
        @resize="confirmationPanelHeight = $event"
      />

      <div ref="composerDockAnchor" class="composer-dock-anchor" aria-hidden="true"></div>
      <div
        ref="composerFrameRef"
        v-show="!initializing && (selectedSession || homeComposerVisible)
          && (!sessionError || selectedSession)"
        class="composer-frame"
        :class="{
          'is-home': homeComposerVisible,
          'is-positioned': !homeComposerVisible || !!composerFrameStyle.left,
          'is-empty': emptySessionShellVisible && !homeComposerVisible,
          'is-moving': composerMotionState,
          'from-home': composerMotionState?.kind === 'home',
          'is-switching': sessionLoading || sessionSwitching,
          'is-handoff': sessionHandoff,
          'composer-committing': composerCommitPulse,
          'shell-mode-composer': shellModeDraft,
          'hidden-shell-mode-composer': draft.trimStart().startsWith('!!'),
          'research-mode-composer': homeComposerVisible
            ? startSessionKind === 'research'
            : composerResearchMode,
        }"
        :style="composerFrameStyle"
      >
        <div
          class="composer-layer start-composer-layer"
          :class="{ 'is-active': homeComposerVisible && !extensionConfirmations.length && !confirmationPanelHeight }"
          :inert="!!composerMotionState || !homeComposerVisible || !!extensionConfirmations.length || !!confirmationPanelHeight"
        >
          <StartComposer
            v-if="homeComposerVisible || composerMotionState?.kind === 'home'"
            ref="startComposerRef"
            :dictation="dictation"
            :dictation-submitting="dictationSubmissionPending"
            :mobile="systemPromptMobile"
            :settings-error="sessionError"
            v-model:draft="startComposerDraft"
            :class="{ 'activity-scanning-composer': startupShellVisible }"
            v-model:start-project-query="startProjectQuery"
            :attached-images="startupDraftSnapshot?.images || attachedImages"
            :available-models="availableModels"
            :available-thinking-levels="availableThinkingLevels"
            :chips="composerChips"
            :creating-session-cwd="creatingSessionCwd || startupRun?.cwd || startupDraftSnapshot?.cwd || ''"
            :current-model-label="startupDraftSnapshot?.modelLabel || currentModelLabel"
            :current-thinking-label="startupDraftSnapshot?.thinkingLabel || currentThinkingLabel"
            :image-support-warning="imageSupportWarning"
            :issue="imageComposerIssue"
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
            :start-project-label="startupDraftSnapshot?.cwd
              ? projectName(startupDraftSnapshot.cwd)
              : startProjectLabel"
            :start-project-trigger="mobileProjectTrigger"
            :start-project-options="startProjectOptions"
            :start-project-picker-open="startProjectPickerOpen"
            :switching-model="switchingModel"
            :switching-thinking="switchingThinking"
            :switching-service-tier="switchingServiceTier"
            :available-service-tiers="availableServiceTiers"
            :service-tier="serviceTier"
            :thinking-level="composerRuntime?.state?.thinkingLevel"
            :thinking-picker-open="thinkingPickerOpen"
            :tool-names="activeToolNames"
            :tools-chip-label="toolsChipLabel"
            :tools-picker-open="toolsPickerOpen"
            @dismiss-issue="dismissComposerIssue"
            @keydown="handleStartComposerKeydown"
            @composition-start="handleComposerCompositionStart"
            @composition-end="handleComposerCompositionEnd"
            @input-blur="handleComposerInputBlur"
            @pick-images="openComposerImagePicker"
            @open-image="openImageFullscreen"
            @open-project-browser="openProjectBrowser"
            @paste="handleComposerPaste"
            @remove-image="removeAttachedImage"
            @select-model="selectModel"
            @select-project="selectStartProjectTarget"
            @select-slash-command="selectSlashCommand"
            @select-thinking="selectThinkingLevel"
            @show-slash-picker="showSlashPicker"
            @submit="submitStartDraft"
            @toggle-picker="togglePicker"
            @toggle-session-kind="toggleStartSessionKind"
            @select-service-tier="selectServiceTier"
            @toggle-project-picker="startProjectPickerOpen = !startProjectPickerOpen"
          />
        </div>
        <div
          class="composer-layer session-composer-layer"
          :class="{ 'is-active': !homeComposerVisible || extensionConfirmations.length || confirmationPanelHeight }"
          :inert="homeComposerVisible && !extensionConfirmations.length && !confirmationPanelHeight"
        >
          <SessionComposer
            v-if="!initializing && (selectedSession || composerMotionState?.kind === 'home')"
            ref="composerRef"
            :dictation="dictation"
            :dictation-submitting="dictationSubmissionPending"
            :mobile="systemPromptMobile"
            :settings-error="sessionError"
            v-model:draft="draft"
            :agent-running="agentRunning"
            :attached-images="attachedImages"
            :compacting="composerCompacting"
            :shell-running="composerShellRunning"
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
            :issue="composerIssue"
            :image-support-warning="imageSupportWarning"
            :vision-delegation-notice="visionDelegationNotice"
            :interrupting="interrupting"
            :class="{
              'empty-session-composer': emptySessionShellVisible,
              'activity-scanning-composer': composerScannerVisible,
              'activity-scanner-settling': composerScannerSettling,
              'composer-committing': composerCommitPulse,
            }"
            :model-key="modelKey"
            :model-picker-open="modelPickerOpen"
            :placeholder="composerPlaceholder"
            :prompt-submitting="promptSubmitting"
            :reloading-session="reloadingSession || sessionActivating"
            :research="composerResearchMode"
            :research-toggle-enabled="canToggleEmptySessionResearch"
            :queued-messages="queuedMessages"
            :session-id="selectedSessionId"
            :prompt-queue="promptQueue"
            :queue-edit-drafts="queueEditDrafts"
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
            :switching-service-tier="switchingServiceTier"
            :available-service-tiers="availableServiceTiers"
            :service-tier="serviceTier"
            @cancel-edit="cancelEditingEntry"
            @dismiss-issue="dismissComposerIssue"
            @interrupt="interruptAgent"
            @keydown="handleComposerKeydown"
            @composition-start="handleComposerCompositionStart"
            @composition-end="handleComposerCompositionEnd"
            @input-blur="handleComposerInputBlur"
            @pick-images="openComposerImagePicker"
            @open-image="openImageFullscreen"
            @paste="handleComposerPaste"
            @queue-snapshot="applyQueueSnapshot"
            @remove-image="removeAttachedImage"
            @select-model="selectModel"
            @select-slash-command="selectSlashCommand"
            @select-thinking="selectThinkingLevel"
            @show-slash-picker="showSlashPicker"
            @submit="submitDraft"
            @toggle-picker="togglePicker"
            @toggle-research="toggleEmptySessionKind"
            @toggle-terminal="toggleForegroundTerminal"
            @select-service-tier="selectServiceTier"
          />
        </div>
      </div>
    </section>

    <Transition name="event-drawer">
      <TracePanel
        v-if="traceMode && traceClient && tracingAvailable"
        ref="tracePane"
        :mode="traceMode"
        :client="traceClient"
        :session-id="traceState.sessionId"
        :selection="traceState.selection"
        :list-state="traceState.listState"
        :backend-name="activeBackendConnection?.name || 'Selected backend'"
        :return-to="traceOrigin"
        :projects="visibleProjects"
        @update:selection="updateTraceState('selection', $event)"
        @update:list-state="updateTraceState('listState', $event)"
        @open-workspace="openTraceWorkspace"
        @open-session="openTraceSession"
        @close="closeTrace()"
      />
    </Transition>

    <ReviewPane
      v-if="reviewAvailable && selectedSession"
      :cwd="selectedSession.cwd"
      ref="reviewPane"
      :compact="!reviewDesktopAvailable"
      :expanded="reviewDesktopAvailable && reviewPaneExpanded"
      :open="reviewOpen"
      :prepare="reviewOpenRequested"
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
      @close="closeResearchSources"
      @open-source="openResearchSource"
    />

    <Transition name="system-prompt">
      <SystemPromptInspector
        v-if="systemPromptEntry"
        :key="systemPromptSelection"
        ref="systemPromptPane"
        :entry="systemPromptEntry"
        :copied-entry-id="copiedEntryId"
        :branch-busy="!!forkingEntryId || !!resettingEntryId"
        @close="closeSystemPrompt"
        @copy="copyEntry"
        @fork="forkSession"
        @reset="resetSessionToEntry"
      />
    </Transition>

    <ResearchCitationPreview
      v-if="researchCitationPreview"
      :key="researchCitationPreview.source.id"
      :anchor-rect="researchCitationPreview.anchorRect"
      :source="researchCitationPreview.source"
      @close="closeResearchCitationPreview"
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
          @create-session="createSessionTarget"
          @request-delete-session="requestDeleteSession"
          @select-session="selectSessionTarget"
        >
          <AgentSettings
            v-bind="agentSettingsProps"
            @set-model="saveSubagentModel"
            @reset-model="saveSubagentModel"
            @save-vision="saveVisionModel"
            @refresh="loadAgentSettings"
          />
          <button class="settings-text-link" type="button" @click="openGlobalSettings('agents')">Edit global defaults</button>
        </ProjectDetailDrawer>
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
          :target="memoryTarget"
          :save-memory="saveMemory"
          @archive="archiveMemories"
          @close="closeMemoryDrawer"
          @delete="deleteMemories"
          @dirty-change="memoryDirty = $event"
          @refresh="loadVisibleMemory"
          @restore="restoreMemories"
        />
      </div>
    </Transition>

    <GlobalSettingsModal
      v-if="settingsOpen"
      v-model:category="settingsCategory"
      :backend-name="activeBackendConnection.name"
      :file-links-available="fileLinksAvailable"
      :dictation-available="dictation.settingsAvailable"
      :pi-settings-available="piSettingsAvailable"
      :before-navigate="confirmPiSettingsLeave"
      :opener="settingsOpener"
      fallback-selector=".session-details-toggle, [aria-label='Open settings'], [aria-label='Open sessions']"
      @close="closeGlobalSettings"
    >
      <template #dictation>
        <DictationSettings :dictation="dictation" />
      </template>
      <template #connections>
        <NetworkAccessSettings ref="piSettingsPane" :copied-id="copiedEntryId" @copy="copyTranscriptItem" />
        <section class="settings-group backend-settings-group">
          <div class="settings-group-heading">
            <h2>Backend</h2>
            <button
              type="button"
              :disabled="backendConnectionsLoading || !!backendConnectionBusyId"
              @click="beginCreateBackendConnection"
            >Add connection</button>
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
                  @click="selectBackendTarget(connection, $event)"
                  @auxclick.middle.prevent="selectBackendTarget(
                    connection,
                    $event,
                  )"
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

      </template>
      <template #display>
        <div class="settings-choice-group settings-display-card">
          <div class="settings-choice-heading">
            <span>
              <strong>Thought rows</strong>
              <small>Initial state in live and saved transcripts</small>
            </span>
            <div class="settings-choice-options" :data-active="thinkingDefault" role="group" aria-label="Thought display">
              <span class="settings-choice-thumb" aria-hidden="true" />
              <button
                type="button"
                :class="{ active: thinkingDefault === 'collapsed' }"
                :aria-pressed="thinkingDefault === 'collapsed'"
                @click="setThinkingDefault('collapsed')"
              >Collapsed</button>
              <button
                type="button"
                :class="{ active: thinkingDefault === 'expanded' }"
                :aria-pressed="thinkingDefault === 'expanded'"
                @click="setThinkingDefault('expanded')"
              >Expanded</button>
            </div>
          </div>
          <p v-if="transcriptPreferencesError" class="settings-error" role="alert">{{ transcriptPreferencesError }}</p>
          <p class="settings-note">Applies to new rows. Rows already in the transcript keep their current state.</p>
          <div class="settings-thought-preview" aria-label="Thought display preview">
            <span>Preview</span>
            <div>{{ thinkingDefault === 'expanded' ? '⌄' : '›' }} Thought</div>
            <p v-if="thinkingDefault === 'expanded'">I’ll check the active branch and its runtime state before making a change.</p>
          </div>
          <p class="settings-note">This setting does not change the model’s thinking level.</p>
        </div>
        <div class="settings-choice-group settings-display-card settings-display-followup">
          <div class="settings-choice-heading">
            <span>
              <strong>Link bare filenames as web addresses</strong>
              <small>How filenames such as README.md appear in transcripts</small>
            </span>
            <div class="settings-choice-options" :data-active="autolinkBareFilenames ? 'expanded' : 'collapsed'" role="group" aria-label="Bare filename links">
              <span class="settings-choice-thumb" aria-hidden="true" />
              <button
                type="button"
                :class="{ active: !autolinkBareFilenames }"
                :aria-pressed="!autolinkBareFilenames"
                @click="setAutolinkBareFilenames(false)"
              >Off</button>
              <button
                type="button"
                :class="{ active: autolinkBareFilenames }"
                :aria-pressed="autolinkBareFilenames"
                @click="setAutolinkBareFilenames(true)"
              >On</button>
            </div>
          </div>
          <p class="settings-note">Off keeps bare filenames as plain text. On restores Markdown autolinking. Explicit URLs and local-file links are unaffected.</p>
          <div class="settings-thought-preview" aria-label="Filename link preview">
            <span>Preview</span>
            <div class="entry-text markdown-body" v-html="autolinkPreview"></div>
          </div>
        </div>
      </template>
      <template #files>
        <FileLinkSettings ref="piSettingsPane" :backend-name="activeBackendConnection.name" />
      </template>
      <template #runtime>
        <RuntimeSettings
          :key="`${activeBackendConnectionId}:${activeBackendConnection.url}`"
          ref="piSettingsPane"
          :backend-name="activeBackendConnection.name"
        />
      </template>
      <template #providers>
        <p v-if="piSettingsActionError" class="settings-error" role="alert">{{ piSettingsActionError }}</p>
        <ProviderSettings
          ref="piSettingsPane"
          :target="piSettingsTarget"
          :backend-name="activeBackendConnection.name"
          :can-reload="piSettingsCanReload"
          :loading="reloadingSession"
          @changed="refreshModelsFromSettings"
          @reload="reloadFromSettings"
        />
      </template>
      <template #mcp>
        <p v-if="piSettingsActionError" class="settings-error" role="alert">{{ piSettingsActionError }}</p>
        <McpSettings
          ref="piSettingsPane"
          :backend-name="activeBackendConnection.name"
          :can-reload="piSettingsCanReload"
          :reloading="reloadingSession"
          @reload="reloadFromSettings"
        />
      </template>
      <template #agents>
        <AgentSettings
          v-bind="agentSettingsProps"
          @set-model="saveSubagentModel"
          @reset-model="saveSubagentModel"
          @save-batch-size="saveSubagentBatchSize"
          @save-vision="saveVisionModel"
          @refresh="loadAgentSettings"
        />
        <p class="settings-note">Project and session overrides are edited in their own details panels.</p>
      </template>
    </GlobalSettingsModal>

    <Transition name="event-drawer">
      <div v-if="sessionDetailsOpen && selectedSession" class="settings-drawer-slot">
        <aside class="context-settings-drawer" aria-label="Session details">
          <header class="context-settings-header">
            <div>
              <strong>Session details</strong>
              <small>{{ sessionTitle(selectedSession) }}</small>
            </div>
            <button type="button" class="settings-close" aria-label="Close session details" @click="sessionDetailsOpen = false">×</button>
          </header>
          <div class="context-settings-body">
            <p class="context-settings-scope">This transcript only</p>
            <p class="settings-note">Overrides apply to this session and copy to forks.</p>
            <h3 class="settings-section-heading">Runtime <small>Read-only</small></h3>
            <dl class="settings-details-list">
              <div><dt>Model</dt><dd>{{ currentModelLabel }}</dd></div>
              <div><dt>Thinking</dt><dd>{{ currentThinkingLabel }}</dd></div>
              <div><dt>Tools</dt><dd>{{ toolsChipLabel }}</dd></div>
              <div><dt>Context</dt><dd>{{ contextUsageLabel || 'Unknown' }}</dd></div>
              <div><dt>Events</dt><dd>{{ eventStreamLabel }}</dd></div>
            </dl>
            <div v-if="systemPromptMobile" class="mobile-session-tools">
              <details><summary>Enabled tools · {{ activeToolNames.length }}</summary><ul><li v-for="tool in activeToolNames" :key="tool">{{ tool }}</li></ul></details>
              <button type="button" @click="sessionDetailsOpen = false; toggleForegroundTerminal()">{{ terminalOpen ? 'Close terminal' : 'Open terminal' }}</button>
            </div>
            <AgentSettings
              v-bind="agentSettingsProps"
              @set-model="saveSubagentModel"
              @reset-model="saveSubagentModel"
              @save-batch-size="saveSubagentBatchSize"
              @save-vision="saveVisionModel"
              @refresh="loadAgentSettings"
            />
            <button class="settings-text-link" type="button" @click="openGlobalSettings('agents')">Edit global defaults</button>
            <h3 class="settings-section-heading">Session</h3>
            <dl class="settings-details-list settings-metadata-list">
              <div><dt>Project</dt><dd>{{ projectName(selectedSession.cwd) }}</dd></div>
              <div>
                <dt>Session ID</dt>
                <dd class="settings-copy-row">
                  <span>{{ settingsSessionId || '—' }}</span>
                  <button v-if="settingsSessionId" type="button" class="copy-button" :title="copyTitle('settings-session-id')" aria-label="Copy session ID" @click="copyTranscriptItem('settings-session-id', settingsSessionId)"><CopyIcon :copied="copiedEntryId === 'settings-session-id'" /></button>
                </dd>
              </div>
              <div>
                <dt>CWD</dt>
                <dd class="settings-copy-row">
                  <span>{{ settingsCwd }}</span>
                  <button type="button" class="copy-button" :title="copyTitle('settings-cwd')" aria-label="Copy CWD" @click="copyTranscriptItem('settings-cwd', settingsCwd)"><CopyIcon :copied="copiedEntryId === 'settings-cwd'" /></button>
                </dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd class="settings-copy-row">
                  <span>{{ settingsPath || '—' }}</span>
                  <button v-if="settingsPath" type="button" class="copy-button" :title="copyTitle('settings-path')" aria-label="Copy path" @click="copyTranscriptItem('settings-path', settingsPath)"><CopyIcon :copied="copiedEntryId === 'settings-path'" /></button>
                </dd>
              </div>
              <div><dt>Messages</dt><dd>{{ selectedSession.messageCount ?? '—' }}</dd></div>
            </dl>
            <p class="settings-note">Change the active model and thinking level in the composer.</p>
          </div>
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
          <details v-for="item in eventLog" :key="item.loggedAt" class="event-log-entry">
            <summary class="event-log-row">
              <time>{{ eventTime(item) }}</time>
              <code>{{ eventType(item) }}</code>
              <span>{{ eventSummary(item) }}</span>
            </summary>
            <div class="event-log-detail">
              <strong>{{ eventType(item) }}</strong>
              <p>{{ eventSummary(item) }}</p>
              <button type="button" @click="copyTranscriptItem(`event-${item.loggedAt}`, `${eventType(item)}\n${eventSummary(item)}`)">{{ copiedEntryId === `event-${item.loggedAt}` ? 'Copied' : 'Copy event' }}</button>
            </div>
          </details>
        </aside>
      </div>
    </Transition>

    <Transition name="subagent-inspector">
      <div
        v-if="inspectedSubagent"
        class="subagent-inspector-backdrop"
        :inert="activeFocusScope !== 'subagent'"
        @click.self="closeSubagentInspector"
      >
        <SubagentInspector
          :key="subagentSelection"
          ref="subagentInspector"
          :entry="activityEntry(inspectedSubagent)"
          :tool-status="activityStatus(inspectedSubagent)"
          :copied-entry-id="copiedEntryId"
          @close="closeSubagentInspector"
          @copy="copyTranscriptItem"
          @copy-entry="copyEntry"
          @navigate-child-session="navigateChildSession"
          @open-image="openImageFullscreen"
        />
      </div>
    </Transition>

    <Transition name="tool-fullscreen">
      <div
        v-if="fullscreenImage"
        class="tool-fullscreen-backdrop"
        @click="closeImageFullscreen"
      >
        <section
          ref="imageDialog"
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
                v-if="fullscreenImage.file?.path"
                type="button"
                @click="copyTranscriptItem('file-path', fullscreenImage.file.path)"
              >{{ copiedEntryId === 'file-path' ? 'Copied' : 'Copy path' }}</button>
              <button
                v-if="fullscreenImage.file?.path"
                type="button"
                aria-label="Image file actions"
                aria-haspopup="menu"
                @click="openFileActionMenu(fullscreenImage.file, $event)"
              >Actions</button>
              <button
                class="copy-button"
                type="button"
                :title="copiedEntryId === 'fullscreen-image' ? 'Copied' : 'Copy image'"
                aria-label="Copy image"
                @click="copyImageSource(fullscreenImage.src, 'fullscreen-image')"
              >
                <CopyIcon :copied="copiedEntryId === 'fullscreen-image'" />
              </button>
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
        class="tool-fullscreen-backdrop tool-preview-fullscreen-backdrop"
        @click="closeToolFullscreen"
      >
        <section ref="toolDialog" class="tool-fullscreen" role="dialog" aria-modal="true" aria-label="Tool preview" tabindex="-1" @click.stop>
          <header class="tool-fullscreen-header">
            <div>
              <span>{{ fullscreenTool.preview?.kind === 'image'
                ? 'Read image preview'
                : fullscreenTool.preview?.kind === 'file'
                  ? 'Read file preview'
                  : fullscreenTool.label }}</span>
              <code v-if="fullscreenTool.code" :title="fullscreenTool.code">{{ fullscreenTool.code }}</code>
            </div>
            <div>
              <div
                v-if="fullscreenToolSupportsMarkdown"
                class="tool-fullscreen-view-toggle"
                role="group"
                aria-label="Markdown view"
              >
                <button
                  type="button"
                  :class="{ active: fullscreenToolView === 'rendered' }"
                  :aria-pressed="fullscreenToolView === 'rendered'"
                  @click="fullscreenToolView = 'rendered'"
                >
                  Rendered
                </button>
                <button
                  type="button"
                  :class="{ active: fullscreenToolView === 'source' }"
                  :aria-pressed="fullscreenToolView === 'source'"
                  @click="fullscreenToolView = 'source'"
                >
                  Source
                </button>
              </div>
              <button
                v-if="fullscreenTool.preview?.path"
                type="button"
                @click="copyTranscriptItem('file-path', fullscreenTool.preview.path)"
              >{{ copiedEntryId === 'file-path' ? 'Copied' : 'Copy path' }}</button>
              <button
                v-if="fullscreenTool.preview?.path"
                type="button"
                aria-label="Tool file actions"
                aria-haspopup="menu"
                @click="openFileActionMenu(fullscreenTool.preview, $event)"
              >Actions</button>
              <button
                class="copy-button"
                type="button"
                :title="copyTitle(fullscreenTool.id)"
                @click="copyEntry(fullscreenTool)"
              >
                <CopyIcon :copied="copiedEntryId === fullscreenTool.id" />
              </button>
              <button type="button" aria-label="Close tool preview" @click="closeToolFullscreen">×</button>
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
            <div
              v-else-if="fullscreenToolSupportsMarkdown && fullscreenToolView === 'rendered'"
              class="tool-fullscreen-markdown markdown-body"
              :data-file-base="fullscreenTool.preview.path"
              v-html="fullscreenToolMarkdown"
            ></div>
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
    <Transition name="tool-fullscreen">
      <FilePreview
        v-if="filePreview"
        :file="filePreview"
        :copied-id="copiedEntryId"
        @close="closeFilePreview"
        @back="goBackFile"
        @approve="approveFile"
        @copy="copyTranscriptItem"
        @menu="previewFileMenu"
      />
    </Transition>
    <FileContextMenu
      v-if="fileMenu"
      :menu="fileMenu"
      @close="closeFileMenu"
      @action="fileMenuAction"
    />
  </main>
</template>
