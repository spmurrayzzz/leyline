<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import PierrePreview from './components/PierrePreview.vue'
import LiveAssistantMessage from './components/LiveAssistantMessage.vue'
import ProjectBrowser from './components/ProjectBrowser.vue'
import SessionComposer from './components/SessionComposer.vue'
import StartComposer from './components/StartComposer.vue'
import SessionSidebar from './components/SessionSidebar.vue'
import TranscriptEntry from './components/TranscriptEntry.vue'
import { useRuntimeEvents } from './composables/useRuntimeEvents'
import { useTerminal } from './composables/useTerminal'
import { fuzzyScore, highlightedText as highlightFuzzyText } from './lib/fuzzy'
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
  activatePiSession,
  createPiSession,
  deletePiSession,
  editPrompt,
  fetchPiRuntimeState,
  fetchSessionDetail,
  fetchSessions,
  forkPiSession,
  interruptPiSession,
  reloadPiSession,
  submitPrompt,
  switchPiModel,
  switchPiThinkingLevel,
} from './lib/pi-api'
import {
  imageBlocksFor,
  imageSrc,
  messageBlocks,
  skillSummaries,
  messageBlocksFor,
  renderedToolJson,
  textFromBlocks,
  textFromContent,
} from './lib/transcript'

const sessions = ref([])
const sessionsError = ref('')
const sessionsLoading = ref(true)
const creatingSessionCwd = ref('')
const newSessionCwd = ref('')
const projectBrowserOpen = ref(false)
const projectBrowserInitialPath = ref('')
const startProjectPickerOpen = ref(false)
const startProjectQuery = ref('')
const sessionQuery = ref('')
const selectedSessionId = ref('')
const expandedProjects = ref(new Set())
const sidebarOpen = ref(false)
const desktopSidebarHidden = ref(false)
const sessionDetail = ref(null)
const sessionLoading = ref(false)
const sessionError = ref('')
const expandedTools = ref(new Set())
const expandedSkills = ref(new Set())
const copiedEntryId = ref('')
const localEntries = ref([])
const draft = ref('')
const attachedImages = ref([])
const workbench = ref(null)
const activeRuntimeSession = ref(null)
const startRuntimeState = ref(null)
const startSelectedModel = ref(null)
const startSelectedThinkingLevel = ref(null)
const eventLogOpen = ref(false)
const settingsOpen = ref(false)
const fullscreenTool = ref(null)
const promptSubmitting = ref(false)
const startupRun = ref(null)
const sessionHandoff = ref(null)
const startupPhaseSlow = ref(false)
const promptSubmitSlow = ref(false)
const interrupting = ref(false)
const switchingModel = ref(false)
const switchingThinking = ref(false)
const reloadingSession = ref(false)
const goalCommandSubmitting = ref('')
const deletingSessionId = ref('')
const deleteConfirmSession = ref(null)
const forkingEntryId = ref('')
const editingEntry = ref(null)
const composerRef = ref(null)
const modelPickerOpen = ref(false)
const thinkingPickerOpen = ref(false)
const slashActiveIndex = ref(0)
const slashPickerDismissed = ref(false)
const promptError = ref('')
const agentRunning = ref(false)
const liveActivity = ref('')
const liveAssistantText = ref('')
const liveAssistantBlocks = ref([])
const liveAssistantMessages = ref([])
const liveTools = ref([])
const stickToBottom = ref(true)
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
let refreshTimer
let startupPhaseTimer
let promptSubmitTimer
let scrollFrame
let liveAssistantFrame
let liveToolSeq = 0
let liveItemSeq = 0
let activeLiveAssistantId = ''
let pendingAssistantEvent
let copiedTimer
let liveTurnAnchorLength = null
const liveToolSettleTimers = new Map()
const liveToolVisualFloorMs = 450
const startupPhaseFloorMs = 650
const startupAcceptedFloorMs = 420
const sessionHandoffPhaseFloorMs = 320
const sessionHandoffTotalFloorMs = 860
const initPhaseFloorMs = 340

const visibleProjects = computed(() => {
  const projects = new Map()
  const query = sessionQuery.value.trim().toLowerCase()

  for (const session of sessions.value) {
    const key = session.cwd || 'unknown'
    const name = projectName(key)
    const projectScore = query ? fuzzyScore(name, query) : 1
    const sessionScoreValue = query ? sessionScore(session, query) : 1

    if (query && projectScore === 0 && sessionScoreValue === 0) continue

    if (!projects.has(key)) {
      projects.set(key, {
        cwd: key,
        name,
        score: projectScore,
        sessions: [],
      })
    }

    if (!query || projectScore > 0 || sessionScoreValue > 0) {
      projects.get(key).sessions.push(session)
      projects.get(key).score = Math.max(
        projects.get(key).score,
        projectScore,
        sessionScoreValue,
      )
    }
  }

  return Array.from(projects.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
})
const selectedSession = computed(() => sessionDetail.value?.session)
const selectedSessionExportUrl = computed(() => {
  if (!selectedSession.value?.id) return ''
  return `/api/pi/sessions/${encodeURIComponent(selectedSession.value.id)}/export`
})
const initializing = computed(() => {
  return sessionsLoading.value && !selectedSession.value
})
const initPhase = ref('sessions')
let initPhaseTimer = null
const rawEntries = computed(() => [
  ...(sessionDetail.value?.entries || []),
  ...localEntries.value,
])
const liveItems = computed(() => [
  ...liveAssistantMessages.value,
  ...liveTools.value,
  liveActivity.value ? {
    id: 'live-activity',
    seq: Number.MAX_SAFE_INTEGER,
    type: 'activity',
    text: liveActivity.value,
  } : null,
].filter(Boolean).sort((a, b) => a.seq - b.seq))
const liveTurnActive = computed(() => {
  return agentRunning.value
    || liveTools.value.length > 0
    || liveAssistantMessages.value.length > 0
    || Boolean(liveActivity.value)
})
const entries = computed(() => {
  let list = rawEntries.value
  if (liveTurnActive.value && liveTurnAnchorLength !== null) {
    list = list.slice(0, liveTurnAnchorLength)
  }

  return list.filter((entry) => {
    return isRenderableEntry(entry) && !isCoveredByLiveTool(entry)
  })
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
    activeRuntimeSession.value = activeSession
    appendRuntimeEvent({
      type: 'active_session',
      summary: projectName(activeSession.cwd),
    })
  },
  onRuntimeEvent(data) {
    scheduleSessionRefresh(data.activeSessionId, data.event)
    console.log('pi runtime event', data)

    if (data.activeSessionId !== selectedSessionId.value) return

    markLiveTurnStart(data.event)
    agentRunning.value = isRunningEvent(data.event)
    liveActivity.value = activityText(data.event)
    updateLiveTool(data.event)
    updateLiveAssistant(data.event)
    surfaceRuntimeError(data.event)
    scheduleLiveScroll(data.activeSessionId)
  },
  onExtensionUi(data) {
    if (data.activeSessionId !== selectedSessionId.value) return
    patchRuntimeExtensionUi(data.state, data.goal)
    surfaceExtensionNotification(data.state)
  },
})
const composerRuntime = computed(() => {
  return selectedSession.value
    ? activeRuntimeSession.value
    : startRuntimeState.value
})
const availableModels = computed(() => {
  return composerRuntime.value?.state?.availableModels || []
})
const selectedModelKey = computed(() => {
  const model = composerRuntime.value?.state?.model
  if (!model) return ''
  return modelKey(model)
})
const currentModelLabel = computed(() => {
  return modelChip(composerRuntime.value?.state?.model)
})
const currentMobileModelLabel = computed(() => {
  return modelChip(composerRuntime.value?.state?.model)
})
const availableThinkingLevels = computed(() => {
  return composerRuntime.value?.state?.availableThinkingLevels || []
})
const currentThinkingLabel = computed(() => {
  const level = composerRuntime.value?.state?.thinkingLevel
  return level ? `thinking · ${formatMode(level)}` : 'thinking'
})
const currentMobileThinkingLabel = computed(() => {
  const level = composerRuntime.value?.state?.thinkingLevel
  if (!level) return 'think'
  return `think ${level === 'medium' ? 'med' : formatMode(level)}`
})
const composerChips = computed(() => {
  const state = composerRuntime.value?.state || {}

  return [
    typeof state.activeToolCount === 'number'
      ? `${state.activeToolCount} tools`
      : '',
  ].filter(Boolean)
})
const activeGoal = computed(() => {
  return activeRuntimeSession.value?.state?.goal || null
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
const imageSupportWarning = computed(() => {
  const model = composerRuntime.value?.state?.model
  if (!attachedImages.value.length || !model || model.supportsImages) return ''
  return `${modelChip(model)} does not support images.`
})
const canSubmitDraft = computed(() => {
  if (imageSupportWarning.value) return false
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
const initSteps = computed(() => {
  const phase = initPhase.value

  return [
    {
      id: 'sessions',
      label: 'Loading sessions',
      done: phase !== 'sessions',
      active: phase === 'sessions',
    },
    {
      id: 'events',
      label: eventStreamConnected.value
        ? 'Runtime events connected'
        : 'Connecting runtime events',
      done: phase === 'workspace',
      active: phase === 'events',
    },
    {
      id: 'workspace',
      label: 'Preparing transcript view',
      done: false,
      active: phase === 'workspace',
    },
  ]
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
  if (agentRunning.value) return '■'
  if (promptSubmitting.value || reloadingSession.value) return '…'
  return '↑'
})
const startupSteps = computed(() => {
  const run = startupRun.value
  if (!run) return []

  return [
    startupStep('accepted', 'Prompt accepted'),
    startupStep('creating', `Creating session in ${run.project}`),
    run.model ? startupStep('model', `Applying ${run.model}`) : null,
    run.thinking
      ? startupStep('thinking', `Setting thinking · ${run.thinking}`)
      : null,
    run.hasPrompt
      ? startupStep('submitting', 'Submitting to pi runtime')
      : null,
  ].filter(Boolean)
})
const startupStatus = computed(() => {
  const run = startupRun.value
  if (!run) return null
  const active = startupSteps.value.find((step) => step.active)
    || startupSteps.value.at(-1)

  return {
    title: active?.label || 'Preparing run',
    detail: startupPhaseSlow.value
      ? 'Still working; waiting on local pi runtime.'
      : startupStatusDetail(run.phase),
    steps: startupSteps.value,
  }
})
const promptSubmitStatus = computed(() => {
  if (!promptSubmitting.value || agentRunning.value) return null

  return {
    title: 'Submitting prompt',
    detail: promptSubmitSlow.value
      ? 'Still waiting for runtime preflight to finish.'
      : 'Validating model, context, and tool state before the run starts.',
    steps: [
      { id: 'accepted', label: 'Prompt accepted', done: true, active: false },
      {
        id: 'submitting',
        label: 'Submitting to pi runtime',
        done: false,
        active: true,
      },
    ],
  }
})
const sessionHandoffStatus = computed(() => {
  const handoff = sessionHandoff.value
  if (!handoff) return null

  return {
    title: `Starting a new session in ${handoff.project}`,
    detail: sessionHandoffDetail(handoff.phase),
    steps: [
      sessionHandoffStep(handoff, 'clearing', 'Releasing current view'),
      sessionHandoffStep(handoff, 'creating', 'Opening pi session'),
      sessionHandoffStep(handoff, 'loading', 'Loading fresh transcript'),
    ],
  }
})
const startFlowVisible = computed(() => {
  return !selectedSession.value || Boolean(startupRun.value)
})
const runtimeChromeVisible = computed(() => {
  return initializing.value || (selectedSession.value && !startupRun.value)
})
const workbenchRunStatus = computed(() => {
  if (startupRun.value) return null
  return promptSubmitStatus.value
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
})

watch(slashCommandItems, () => {
  slashActiveIndex.value = 0
})

onMounted(async () => {
  window.addEventListener('keydown', closeMenusOnEscape)
  window.addEventListener('click', closeMenusOnOutsideClick)
  window.addEventListener('popstate', handleRouteChange)
  window.addEventListener('leyline:new-session', handleNativeNewSession)
  window.addEventListener('leyline:toggle-terminal', handleNativeToggleTerminal)
  openEventStream()
  initPhase.value = 'sessions'
  await waitInitPhaseFloor()
  await loadSessions({ routeSessionId: sessionIdFromRoute() })
})

onUnmounted(() => {
  window.removeEventListener('keydown', closeMenusOnEscape)
  window.removeEventListener('click', closeMenusOnOutsideClick)
  window.removeEventListener('popstate', handleRouteChange)
  window.removeEventListener('leyline:new-session', handleNativeNewSession)
  window.removeEventListener('leyline:toggle-terminal', handleNativeToggleTerminal)
  stopTerminalResize()
  closeEventStream()
  closeTerminalPanel()
  clearTimeout(refreshTimer)
  clearTimeout(startupPhaseTimer)
  clearTimeout(promptSubmitTimer)
  clearTimeout(copiedTimer)
  clearLiveToolSettleTimers()
  cancelAnimationFrame(scrollFrame)
  cancelAnimationFrame(liveAssistantFrame)
  cancelAnimationFrame(terminalResizeFrame)
  clearTimeout(initPhaseTimer)
})

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

async function loadSessions({
  routeSessionId = '',
  selectFirst = false,
  showLoading = true,
} = {}) {
  if (showLoading) sessionsLoading.value = true

  initPhase.value = 'events'
  sessionsError.value = ''

  try {
    const nextSessions = await fetchSessions()
    sessions.value = nextSessions
    if (!newSessionCwd.value && sessions.value[0]?.cwd) {
      newSessionCwd.value = sessions.value[0].cwd
      await loadStartRuntimeState(newSessionCwd.value)
    }
    const routedSession = routeSessionId
      ? sessions.value.find((session) => session.id === routeSessionId)
      : null

    if (routedSession) await selectSession(routedSession, { replaceRoute: true })
    else if (routeSessionId) sessionError.value = 'Session not found'
    else if (selectFirst && sessions.value[0]) {
      await selectSession(sessions.value[0])
    }
  } catch (error) {
    if (showLoading || sessions.value.length === 0) {
      sessionsError.value = error.message
    }
  } finally {
    if (showLoading) {
      initPhase.value = 'workspace'
      await waitInitPhaseFloor()
      sessionsLoading.value = false
      initPhase.value = 'sessions'
    }
  }
}

async function loadStartRuntimeState(cwd) {
  const targetCwd = cwd?.trim()
  if (!targetCwd || selectedSession.value) return

  try {
    const state = await fetchPiRuntimeState(targetCwd)
    if (newSessionCwd.value !== targetCwd || selectedSession.value) return
    startRuntimeState.value = state
    startSelectedModel.value = null
    startSelectedThinkingLevel.value = null
  } catch (error) {
    if (!startRuntimeState.value) promptError.value = error.message
  }
}

async function createSession(project) {
  await createSessionForCwd(project.cwd)
}

async function handleNativeNewSession() {
  if (!selectedSession.value) return
  if (agentRunning.value || creatingSessionCwd.value) return

  await createSessionForCwd(selectedSession.value.cwd)
}

async function handleNativeToggleTerminal() {
  if (!selectedSession.value || initializing.value) return

  await toggleTerminal()
}

async function createSessionForCwd(cwd) {
  const targetCwd = cwd?.trim() || ''
  if (!targetCwd) return

  creatingSessionCwd.value = targetCwd
  sessionError.value = ''

  const handoff = selectedSession.value && !startupRun.value
    ? beginSessionHandoff(targetCwd)
    : null

  try {
    if (handoff) await waitSessionHandoffPhaseFloor(handoff)
    const data = handoff
      ? await runSessionHandoffPhase(handoff, 'creating', () => {
        return createPiSession(targetCwd)
      })
      : await createPiSession(targetCwd)

    if (handoff) setSessionHandoffPhase(handoff, 'loading')
    await loadSessions({ selectFirst: false, showLoading: false })
    activeRuntimeSession.value = data.active
    sessionDetail.value = data.detail
    selectedSessionId.value = data.detail.session.id
    updateSessionRoute(data.detail.session.id)
    expandedTools.value = new Set()
    expandedSkills.value = new Set()
    localEntries.value = []
    editingEntry.value = null
    resetLiveState()
    expandProject(targetCwd)
    newSessionCwd.value = ''
    projectBrowserOpen.value = false
    stickToBottom.value = true
    hasNewOutput.value = false
    await scrollToLatest()
    if (handoff) await finishSessionHandoffFloor(handoff)
    sidebarOpen.value = false
    if (terminalOpen.value) await connectTerminal()
  } catch (error) {
    sessionError.value = error.message
  } finally {
    creatingSessionCwd.value = ''
    if (handoff) finishSessionHandoff(handoff)
  }
}

async function selectSession(session, options = {}) {
  selectedSessionId.value = session.id
  sessionLoading.value = true
  sessionError.value = ''
  promptError.value = ''

  try {
    const data = await loadSessionDetail(session.id)
    await activateSession(session)
    sessionDetail.value = data
    expandedTools.value = new Set()
    expandedSkills.value = new Set()
    localEntries.value = []
    editingEntry.value = null
    resetLiveState()
    expandProject(session.cwd)
    stickToBottom.value = true
    hasNewOutput.value = false
    updateSessionRoute(session.id, options)
  } catch (error) {
    sessionError.value = error.message
  } finally {
    sessionLoading.value = false
    await scrollToLatest()
    sidebarOpen.value = false
    if (terminalOpen.value && !sessionError.value) await connectTerminal()
  }
}

async function loadSessionDetail(id) {
  return fetchSessionDetail(id)
}

async function handleRouteChange() {
  const id = sessionIdFromRoute()
  if (!id) {
    clearSelectedSession()
    return
  }

  const session = sessions.value.find((item) => item.id === id)
  if (session) await selectSession(session, { replaceRoute: true })
  else await loadSessions({ routeSessionId: id })
}

function sessionIdFromRoute() {
  const url = new URL(window.location.href)
  const match = url.pathname.match(/^\/sessions\/([^/]+)\/?$/)
  if (match) return decodeURIComponent(match[1])
  return url.searchParams.get('session') || ''
}

function updateSessionRoute(id, { replaceRoute = false } = {}) {
  const hash = window.location.hash
  const next = id ? `/sessions/${encodeURIComponent(id)}${hash}` : `/${hash}`
  const current = window.location.pathname
    + window.location.search
    + window.location.hash
  if (next === current) return
  const method = replaceRoute ? 'replaceState' : 'pushState'
  window.history[method]({}, '', next)
}

function clearSelectedSession() {
  selectedSessionId.value = ''
  sessionDetail.value = null
  sessionError.value = ''
  promptError.value = ''
  expandedTools.value = new Set()
  expandedSkills.value = new Set()
  localEntries.value = []
  editingEntry.value = null
  sessionHandoff.value = null
  finishStartupRun()
  resetLiveState()
}

function resetLiveState() {
  liveTurnAnchorLength = null
  liveActivity.value = ''
  liveAssistantText.value = ''
  liveAssistantBlocks.value = []
  liveAssistantMessages.value = []
  liveTools.value = []
  activeLiveAssistantId = ''
  pendingAssistantEvent = undefined
  clearLiveToolSettleTimers()
  cancelAnimationFrame(liveAssistantFrame)
}

function beginStartupRun(cwd, options = {}) {
  startupRun.value = {
    cwd,
    project: projectName(cwd),
    hasPrompt: options.hasPrompt,
    model: options.model ? modelChip(options.model) : '',
    thinking: options.thinkingLevel ? formatMode(options.thinkingLevel) : '',
    phase: 'accepted',
  }
  setStartupPhase('accepted')
}

function beginSessionHandoff(cwd) {
  const handoff = {
    id: `${Date.now()}-${Math.random()}`,
    cwd,
    project: projectName(cwd),
    startedAt: Date.now(),
    phase: 'clearing',
    phaseStartedAt: Date.now(),
  }
  sessionHandoff.value = handoff
  return handoff
}

function sessionHandoffStep(handoff, id, label) {
  const phases = ['clearing', 'creating', 'loading']
  const activeIndex = Math.max(0, phases.indexOf(handoff.phase))
  const index = phases.indexOf(id)

  return {
    id,
    label,
    active: index === activeIndex,
    done: index < activeIndex,
  }
}

function sessionHandoffDetail(phase) {
  if (phase === 'clearing') return 'Clearing the current transcript view.'
  if (phase === 'creating') return 'Opening a fresh pi session.'
  if (phase === 'loading') return 'Loading the fresh transcript shell.'
  return 'Preparing a fresh runtime.'
}

function setSessionHandoffPhase(handoff, phase) {
  if (sessionHandoff.value?.id !== handoff.id) return
  sessionHandoff.value = {
    ...sessionHandoff.value,
    phase,
    phaseStartedAt: Date.now(),
  }
}

async function runSessionHandoffPhase(handoff, phase, task) {
  setSessionHandoffPhase(handoff, phase)
  const result = await task()
  await waitSessionHandoffPhaseFloor(handoff)
  return result
}

async function waitSessionHandoffPhaseFloor(handoff) {
  const current = sessionHandoff.value
  if (current?.id !== handoff.id) return
  const elapsed = Date.now() - current.phaseStartedAt
  const remaining = Math.max(0, sessionHandoffPhaseFloorMs - elapsed)
  if (remaining) await wait(remaining)
}

async function finishSessionHandoffFloor(handoff) {
  await waitSessionHandoffPhaseFloor(handoff)
  const elapsed = Date.now() - handoff.startedAt
  const remaining = Math.max(0, sessionHandoffTotalFloorMs - elapsed)
  if (remaining) await wait(remaining)
}

function finishSessionHandoff(handoff) {
  if (sessionHandoff.value?.id === handoff.id) sessionHandoff.value = null
}

function setStartupPhase(phase) {
  if (!startupRun.value) return

  startupRun.value = { ...startupRun.value, phase }
  startupPhaseSlow.value = false
  clearTimeout(startupPhaseTimer)
  startupPhaseTimer = setTimeout(() => {
    if (startupRun.value?.phase === phase) startupPhaseSlow.value = true
  }, 4500)
}

async function runStartupPhase(phase, task) {
  setStartupPhase(phase)
  const started = Date.now()
  const result = await task()
  const elapsed = Date.now() - started
  const remaining = Math.max(0, startupPhaseFloorMs - elapsed)
  if (remaining) await wait(remaining)
  return result
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function finishStartupRun() {
  startupRun.value = null
  startupPhaseSlow.value = false
  clearTimeout(startupPhaseTimer)
}

function startupStep(id, label) {
  const phases = startupStepsForRun(startupRun.value)
  const activeIndex = Math.max(0, phases.indexOf(startupRun.value?.phase))
  const index = phases.indexOf(id)

  return {
    id,
    label,
    active: index === activeIndex,
    done: index < activeIndex,
  }
}

function startupStepsForRun(run) {
  if (!run) return []
  return [
    'accepted',
    'creating',
    run.model ? 'model' : '',
    run.thinking ? 'thinking' : '',
    run.hasPrompt ? 'submitting' : '',
  ].filter(Boolean)
}

function startupStatusDetail(phase) {
  if (phase === 'accepted') return 'Request received; preparing the run.'
  if (phase === 'creating') {
    return 'Opening a fresh pi session for this project.'
  }
  if (phase === 'model') {
    return 'Syncing the selected model before the first turn.'
  }
  if (phase === 'thinking') return 'Applying the selected reasoning level.'
  if (phase === 'submitting') return 'Handing the prompt to the active runtime.'
  return 'Preparing run.'
}

function startPromptSubmitTimer() {
  promptSubmitSlow.value = false
  clearTimeout(promptSubmitTimer)
  promptSubmitTimer = setTimeout(() => {
    if (promptSubmitting.value && !agentRunning.value) {
      promptSubmitSlow.value = true
    }
  }, 4500)
}

function stopPromptSubmitTimer() {
  promptSubmitSlow.value = false
  clearTimeout(promptSubmitTimer)
}

function navigateHome() {
  const cwd = selectedSession.value?.cwd
    || newSessionCwd.value
    || sessions.value[0]?.cwd
    || ''

  clearSelectedSession()
  if (cwd) {
    newSessionCwd.value = cwd
    loadStartRuntimeState(cwd)
  }
  updateSessionRoute('')
  sidebarOpen.value = false
}

function scheduleSessionRefresh(activeSessionId, event) {
  if (activeSessionId !== selectedSessionId.value) return
  if (event?.type === 'message_update') return

  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    const wasStuck = stickToBottom.value

    try {
      const detail = await loadSessionDetail(selectedSessionId.value)
      sessionDetail.value = detail
      reconcileLocalEntries(detail)
      updateSelectedSessionSummary(detail.session)
      reconcileLiveTools(detail)
      if (wasStuck) await scrollToLatest()
      else hasNewOutput.value = true
    } catch (error) {
      sessionError.value = error.message
    }
  }, 250)
}

function markLiveTurnStart(event) {
  if (event?.type !== 'agent_start' && event?.type !== 'turn_start') return
  if (liveTurnAnchorLength !== null) return
  liveTurnAnchorLength = rawEntries.value.length
}

function isRunningEvent(event) {
  const type = event?.type || ''
  if (['agent_start', 'message_start', 'tool_call'].includes(type)) return true
  if (type === 'tool_execution_start') return true
  if (['agent_end', 'error', 'aborted'].includes(type)) return false
  return agentRunning.value
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

function activityText(event) {
  const type = event?.type || ''
  if (type === 'agent_start' || type === 'turn_start') return 'Thinking…'
  if (type === 'message_update' && !liveAssistantText.value) {
    return 'Writing response…'
  }
  if (type === 'message_update') return ''
  if (type === 'tool_call') return ''
  if (type === 'tool_execution_start') return ''
  if (type === 'tool_execution_end') return ''
  if (type === 'agent_end' || type === 'error' || type === 'aborted') return ''
  return liveActivity.value
}

function surfaceRuntimeError(event) {
  if (event?.type !== 'error') return
  promptError.value = event.error?.message || event.message || 'Runtime error'
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
  return args.command || args.path || ''
}

function liveToolStatus(tool) {
  if (tool.status === 'preparing') return 'preparing'
  if (tool.status === 'running') return 'running'
  if (tool.status === 'reading') return 'reading result'
  if (tool.status === 'error') return 'error'
  if (tool.status === 'aborted') return 'aborted'
  return 'completed'
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

function updateLiveAssistant(event) {
  if (event?.type === 'message_start') activeLiveAssistantId = ''

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
  const id = activeLiveAssistantId || `live-assistant-${++liveItemSeq}`
  activeLiveAssistantId = id
  const existing = liveAssistantMessages.value.find((item) => item.id === id)
  const next = {
    id,
    seq: existing?.seq || liveItemSeq,
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

function clearLiveAssistant() {
  pendingAssistantEvent = undefined
  cancelAnimationFrame(liveAssistantFrame)
  liveAssistantText.value = ''
  liveAssistantBlocks.value = []
  liveAssistantMessages.value = []
  activeLiveAssistantId = ''
}

async function activateSession(session) {
  activeRuntimeSession.value = await activatePiSession(session.id)
}

function sessionTitle(session) {
  if (session?.messageCount === 0
    || session?.name === '(no messages)'
    || session?.firstMessage === '(no messages)') {
    return 'New session'
  }
  return session?.name || session?.firstMessage || 'Untitled session'
}

function sessionScore(session, query) {
  return fuzzyScore(sessionTitle(session), query)
}

function highlightedText(value) {
  return highlightFuzzyText(value, sessionQuery.value)
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

function handleProjectBrowserBrowse(cwd) {
  newSessionCwd.value = cwd
}

function closeProjectBrowser() {
  projectBrowserOpen.value = false
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

function toggleSkill(entry) {
  const next = new Set(expandedSkills.value)
  if (next.has(entry.id)) next.delete(entry.id)
  else next.add(entry.id)
  expandedSkills.value = next
}

function entryCopyText(entry) {
  if (entry.type === 'event') return `${entry.label} ${entry.text}`.trim()
  if (entry.type === 'tool') return toolCopyText(entry)
  if (entry.blocks?.length) {
    return messageBlocksFor(entry).map((block) => block.text).join('\n\n')
  }
  return entry.text || ''
}

function toolCopyText(entry) {
  const preview = entry.preview
  if (!preview) return entry.text || ''
  if (preview.kind === 'patch') return preview.patch || entry.text || ''
  if (preview.kind === 'file') return preview.content || entry.text || ''
  if (preview.kind === 'diff') return previewDiffText(preview)
  return entry.text || ''
}

function previewDiffText(preview) {
  const path = preview.path || 'tool-output.txt'
  const oldLines = splitDiffLines(preview.oldText || '')
  const newLines = splitDiffLines(preview.newText || '')
  const oldCount = Math.max(oldLines.length, 1)
  const newCount = Math.max(newLines.length, 1)

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join('\n')
}

function splitDiffLines(text) {
  return text.replace(/\n$/, '').split('\n')
}

function liveAssistantCopyText(blocks = liveAssistantBlocks.value) {
  return blocks.map((block) => block.text).join('\n\n')
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

function scheduleLiveScroll(activeSessionId) {
  if (activeSessionId !== selectedSessionId.value) return
  if (!liveAssistantMessages.value.length
    && !liveActivity.value
    && !liveTools.value.length) {
    return
  }

  if (!stickToBottom.value) {
    hasNewOutput.value = true
    return
  }

  cancelAnimationFrame(scrollFrame)
  scrollFrame = requestAnimationFrame(() => {
    scrollToLatest()
  })
}

function handleWorkbenchScroll() {
  if (!workbench.value) return
  const distance = workbench.value.scrollHeight
    - workbench.value.scrollTop
    - workbench.value.clientHeight
  stickToBottom.value = distance < 80
  if (stickToBottom.value) hasNewOutput.value = false
}

async function jumpToLatest() {
  stickToBottom.value = true
  hasNewOutput.value = false
  await scrollToLatest()
}

async function scrollToLatest() {
  await nextTick()
  if (!workbench.value) return
  workbench.value.scrollTop = workbench.value.scrollHeight
}

function patchRuntimeExtensionUi(extensionUi, goal) {
  if (!activeRuntimeSession.value) return
  activeRuntimeSession.value = {
    ...activeRuntimeSession.value,
    state: {
      ...activeRuntimeSession.value.state,
      extensionUi,
      goal,
    },
  }
  if (goal?.objective) patchGoalSessionTitle(goal.objective)
}

function patchGoalSessionTitle(objective) {
  const id = selectedSessionId.value
  if (!id) return

  sessions.value = sessions.value.map((session) => {
    if (session.id !== id) return session
    if (session.firstMessage && session.firstMessage !== '(no messages)') {
      return session
    }
    return { ...session, firstMessage: objective }
  })

  const detail = sessionDetail.value
  if (!detail || detail.session.id !== id) return
  const firstMessage = detail.session.firstMessage
  if (firstMessage && firstMessage !== '(no messages)') return
  sessionDetail.value = {
    ...detail,
    session: { ...detail.session, firstMessage: objective },
  }
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

async function submitDraft() {
  const text = draft.value.trim()
  const images = attachedImages.value.map(({ preview, ...image }) => image)
  if (!text && images.length === 0) return
  if (promptSubmitting.value || agentRunning.value) return
  if (reloadingSession.value) return

  const editing = editingEntry.value
  const previousDetail = sessionDetail.value
  if (previousDetail) reconcileLocalEntries(previousDetail)
  liveAssistantMessages.value = []
  liveTools.value = []
  activeLiveAssistantId = ''
  clearLiveToolSettleTimers()
  const localEntry = pendingUserEntry(text, images)
  const shouldFollowOutput = editing || stickToBottom.value
  if (editing) {
    trimSessionToEntry(editing.id)
    stickToBottom.value = true
    hasNewOutput.value = false
  }
  localEntries.value = [...localEntries.value, localEntry]
  liveTurnAnchorLength = rawEntries.value.length
  promptSubmitting.value = true
  startPromptSubmitTimer()
  promptError.value = ''
  if (shouldFollowOutput) await scrollToLatest()
  else hasNewOutput.value = true

  try {
    if (editing) await editPrompt(editing.id, text, images)
    else await submitPrompt(text, images)
    if (isHandledSlashCommand(text)) {
      localEntries.value = localEntries.value.filter((entry) => {
        return entry.id !== localEntry.id
      })
      liveTurnAnchorLength = rawEntries.value.length
    }
    draft.value = ''
    attachedImages.value = []
    editingEntry.value = null
    if (!isHandledSlashCommand(text) || slashCommandStartsTurn(text)) {
      agentRunning.value = true
      liveActivity.value = 'Thinking…'
    }
  } catch (error) {
    if (editing) sessionDetail.value = previousDetail
    localEntries.value = localEntries.value.filter((entry) => {
      return entry.id !== localEntry.id
    })
    promptError.value = error.message
    resetLiveState()
  } finally {
    promptSubmitting.value = false
    stopPromptSubmitTimer()
  }
}

function isHandledSlashCommand(text) {
  return /^\/(goal)(?:\s|$)/.test(text)
}

function slashCommandStartsTurn(text) {
  return /^\/goal\s+/.test(text) && !/^\/goal\s+(clear|pause)\s*$/i.test(text)
}

function startEditingEntry(entry) {
  if (agentRunning.value || promptSubmitting.value || !entry?.id) return
  if (entry.role !== 'user') return

  editingEntry.value = entry
  draft.value = entry.text || textFromBlocks(messageBlocksFor(entry))
  attachedImages.value = imageBlocksFor(entry).map((image) => ({
    ...image,
    preview: imageSrcForComposer(image),
  }))
  promptError.value = ''
  closePickerMenus()
  nextTick(() => composerRef.value?.focus())
}

function cancelEditingEntry() {
  editingEntry.value = null
}

function trimSessionToEntry(entryId) {
  const detail = sessionDetail.value
  const index = detail?.entries?.findIndex((entry) => entry.id === entryId)
  if (!detail || index < 0) return
  sessionDetail.value = {
    ...detail,
    entries: detail.entries.slice(0, index),
  }
}

function imageSrcForComposer(image) {
  return `data:${image.mimeType};base64,${image.data}`
}

function requestDeleteSession(session) {
  if (!session || deletingSessionId.value) return
  deleteConfirmSession.value = session
}

function cancelDeleteSession() {
  if (deletingSessionId.value) return
  deleteConfirmSession.value = null
}

async function confirmDeleteSession() {
  const session = deleteConfirmSession.value
  if (!session || deletingSessionId.value) return

  deletingSessionId.value = session.id
  sessionError.value = ''
  promptError.value = ''

  try {
    await deletePiSession(session.id)
    deleteConfirmSession.value = null
    sessions.value = sessions.value.filter((item) => item.id !== session.id)
    if (selectedSessionId.value === session.id) {
      clearSelectedSession()
      updateSessionRoute('')
    }
  } catch (error) {
    if (selectedSessionId.value === session.id) promptError.value = error.message
    else sessionError.value = error.message
  } finally {
    deletingSessionId.value = ''
  }
}

async function forkSession(entry) {
  if (!entry?.id || forkingEntryId.value || agentRunning.value) return

  forkingEntryId.value = entry.id
  sessionError.value = ''
  promptError.value = ''
  liveActivity.value = 'Forking session…'

  try {
    const data = await forkPiSession(entry.id)
    activeRuntimeSession.value = data.active
    sessionDetail.value = data.detail
    selectedSessionId.value = data.detail.session.id
    expandedTools.value = new Set()
    expandedSkills.value = new Set()
    localEntries.value = []
    editingEntry.value = null
    resetLiveState()
    expandProject(data.detail.session.cwd)
    updateSessionRoute(data.detail.session.id)
    stickToBottom.value = true
    hasNewOutput.value = false
    await loadSessions({ selectFirst: false, showLoading: false })
    await scrollToLatest()
    if (terminalOpen.value) await connectTerminal()
  } catch (error) {
    promptError.value = error.message
    liveActivity.value = ''
  } finally {
    forkingEntryId.value = ''
  }
}

async function reloadSession() {
  if (reloadingSession.value) return

  reloadingSession.value = true
  promptError.value = ''
  liveActivity.value = [
    'Reloading keybindings, extensions, skills, prompts, themes…',
  ].join('')

  try {
    activeRuntimeSession.value = await reloadPiSession()
    liveActivity.value = ''
    await loadSessions({ selectFirst: false, showLoading: false })
    if (selectedSessionId.value) {
      sessionDetail.value = await loadSessionDetail(selectedSessionId.value)
    }
  } catch (error) {
    promptError.value = error.message
    liveActivity.value = ''
  } finally {
    reloadingSession.value = false
  }
}

async function runGoalCommand(command) {
  if (!activeGoal.value || goalCommandSubmitting.value) return
  if (!selectedSession.value) return

  goalCommandSubmitting.value = command
  promptError.value = ''

  try {
    if ((command === 'pause' || command === 'clear') && agentRunning.value) {
      liveActivity.value = 'Stopping…'
      await interruptPiSession()
      agentRunning.value = false
      liveActivity.value = ''
    }
    await submitPrompt(`/goal ${command}`)
    if (command === 'resume') {
      agentRunning.value = true
      liveActivity.value = 'Thinking…'
    }
  } catch (error) {
    promptError.value = error.message
  } finally {
    goalCommandSubmitting.value = ''
  }
}

async function interruptAgent() {
  if (!agentRunning.value || interrupting.value) return

  interrupting.value = true
  promptError.value = ''
  liveActivity.value = 'Stopping…'

  try {
    await interruptPiSession()
    agentRunning.value = false
    liveActivity.value = ''
  } catch (error) {
    promptError.value = error.message
    liveActivity.value = ''
  } finally {
    interrupting.value = false
  }
}

function pendingUserEntry(text, images = []) {
  const now = Date.now()
  const blocks = []
  if (text) blocks.push({ type: 'text', text })
  blocks.push(...images)

  return {
    id: `local-${now}`,
    createdAt: now,
    type: 'message',
    role: 'user',
    label: 'You',
    text,
    blocks,
  }
}

function reconcileLocalEntries(detail) {
  localEntries.value = localEntries.value.filter((localEntry) => {
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

function updateSelectedSessionSummary(session) {
  sessions.value = sessions.value.map((item) => {
    if (item.id !== session.id) return item
    return {
      ...item,
      name: session.name,
      firstMessage: session.firstMessage,
      messageCount: session.messageCount,
      modified: session.modified,
      timestamp: session.modified || item.timestamp,
    }
  })
}

async function selectModel(model) {
  if (!model || modelKey(model) === selectedModelKey.value) {
    modelPickerOpen.value = false
    return
  }

  switchingModel.value = true
  modelPickerOpen.value = false
  promptError.value = ''

  if (!selectedSession.value) {
    const state = startRuntimeState.value?.state || {}
    const levels = model.availableThinkingLevels || []
    const selectedThinking = startSelectedThinkingLevel.value
    const thinkingLevel = clampThinkingLevel(
      selectedThinking || state.thinkingLevel,
      levels,
    )

    if (selectedThinking !== null) {
      startSelectedThinkingLevel.value = thinkingLevel
    }
    startSelectedModel.value = model
    startRuntimeState.value = {
      ...startRuntimeState.value,
      state: {
        ...state,
        model,
        availableThinkingLevels: levels,
        thinkingLevel,
      },
    }
    switchingModel.value = false
    return
  }

  try {
    activeRuntimeSession.value = await switchPiModel(model.provider, model.id)
  } catch (error) {
    promptError.value = error.message
  } finally {
    switchingModel.value = false
  }
}

async function selectThinkingLevel(level) {
  if (!level || level === composerRuntime.value?.state?.thinkingLevel) {
    thinkingPickerOpen.value = false
    return
  }

  switchingThinking.value = true
  thinkingPickerOpen.value = false
  promptError.value = ''

  if (!selectedSession.value) {
    startSelectedThinkingLevel.value = level
    startRuntimeState.value = {
      ...startRuntimeState.value,
      state: { ...startRuntimeState.value?.state, thinkingLevel: level },
    }
    switchingThinking.value = false
    return
  }

  try {
    activeRuntimeSession.value = await switchPiThinkingLevel(level)
  } catch (error) {
    promptError.value = error.message
  } finally {
    switchingThinking.value = false
  }
}

function togglePicker(name) {
  modelPickerOpen.value = name === 'model' && !modelPickerOpen.value
  thinkingPickerOpen.value = name === 'thinking' && !thinkingPickerOpen.value
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

function clampThinkingLevel(level, levels) {
  if (!levels.length) return 'off'
  if (levels.includes(level)) return level

  const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
  const index = order.indexOf(level)
  if (index === -1) return levels[0]

  for (let i = index; i < order.length; i++) {
    if (levels.includes(order[i])) return order[i]
  }
  for (let i = index - 1; i >= 0; i--) {
    if (levels.includes(order[i])) return order[i]
  }
  return levels[0]
}

function handleComposerKeydown(event) {
  if (handleSlashPickerKeydown(event)) return
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submitDraft()
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

  beginStartupRun(targetCwd, { hasPrompt, model, thinkingLevel })

  try {
    await wait(startupAcceptedFloorMs)
    await runStartupPhase('creating', () => createSessionForCwd(targetCwd))
    if (model && selectedSession.value) {
      activeRuntimeSession.value = await runStartupPhase('model', () => {
        return switchPiModel(model.provider, model.id)
      })
    }
    if (thinkingLevel && selectedSession.value) {
      activeRuntimeSession.value = await runStartupPhase('thinking', () => {
        return switchPiThinkingLevel(thinkingLevel)
      })
    }
    if (hasPrompt) await runStartupPhase('submitting', submitDraft)
  } finally {
    await wait(260)
    finishStartupRun()
  }
}

function closeMenusOnEscape(event) {
  if (event.key !== 'Escape') return
  settingsOpen.value = false
  closeToolFullscreen()
  closeProjectBrowser()
  cancelDeleteSession()
  cancelEditingEntry()
  closePickerMenus()
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
      'session-handoff': sessionHandoff,
      'terminal-open': terminalOpen,
    }"
    :style="{ '--terminal-drawer-height': `${terminalDrawerHeight}px` }"
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
      :busy="!!creatingSessionCwd"
      :initial-path="projectBrowserInitialPath"
      @browse="handleProjectBrowserBrowse"
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
      :session-title="sessionTitle"
      :sessions-error="sessionsError"
      :sessions-loading="sessionsLoading"
      :visible-projects="visibleProjects"
      @create-session="createSession"
      @hide="desktopSidebarHidden = true"
      @navigate-home="navigateHome"
      @open-project-browser="openProjectBrowser"
      @open-settings="settingsOpen = true"
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
          <span v-if="agentRunning" class="running-pill">running</span>
          <span v-if="goalPillLabel" class="goal-pill">
            {{ goalPillLabel }}
          </span>
          <span class="topbar-runtime-pill">{{ currentModelLabel }}</span>
          <span class="topbar-runtime-pill">{{ currentThinkingLabel }}</span>
          <template v-if="!isEmptySelectedSession">
            <button
              class="event-log-button"
              type="button"
              @click="eventLogOpen = !eventLogOpen"
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

      <section v-if="eventLogOpen" class="event-log-panel">
        <div class="event-log-header">
          <strong>Runtime events</strong>
          <button type="button" @click="eventLogOpen = false">×</button>
        </div>
        <div v-if="eventLog.length === 0" class="event-log-empty">
          No events yet
        </div>
        <div v-for="item in eventLog" :key="item.loggedAt" class="event-log-row">
          <time>{{ eventTime(item) }}</time>
          <code>{{ eventType(item) }}</code>
          <span>{{ eventSummary(item) }}</span>
        </div>
      </section>

      <Transition name="run-status">
        <section
          v-if="sessionHandoffStatus"
          class="run-status-card session-handoff-card"
          aria-live="polite"
        >
          <div class="run-status-orb" aria-hidden="true"></div>
          <div class="run-status-main">
            <strong>{{ sessionHandoffStatus.title }}</strong>
            <span>{{ sessionHandoffStatus.detail }}</span>
            <div class="run-status-progress" aria-hidden="true">
              <i></i>
            </div>
            <div class="run-status-steps">
              <span
                v-for="step in sessionHandoffStatus.steps"
                :key="step.id"
                :class="{
                  done: step.done,
                  active: step.active,
                }"
              >{{ step.label }}</span>
            </div>
          </div>
        </section>
      </Transition>

      <div
        ref="workbench"
        class="workbench"
        :class="{
          'init-workbench': initializing,
          'session-loading-workbench': sessionLoading,
          'session-handoff-workbench': sessionHandoff,
          'start-workbench-shell': !initializing && startFlowVisible,
          'empty-selected-workbench': isEmptySelectedSession && !startupRun,
        }"
        @scroll="handleWorkbenchScroll"
      >
        <div v-if="initializing" class="init-panel">
          <div class="init-kicker">Starting Leyline</div>
          <h2>Loading workspace…</h2>
          <div class="init-steps">
            <div
              v-for="step in initSteps"
              :key="step.id"
              class="init-step"
              :class="{ active: step.active, done: step.done }"
            >
              <span></span>
              <strong>{{ step.label }}</strong>
            </div>
          </div>
        </div>
        <div v-else-if="sessionLoading" class="session-loading-panel">
          <div class="session-loading-mark" aria-hidden="true"></div>
          <div>
            <strong>Opening session</strong>
            <span>Reading transcript and activating pi runtime…</span>
          </div>
        </div>
        <div v-else-if="sessionError" class="empty-workbench error-note">
          {{ sessionError }}
        </div>
        <div v-else-if="startFlowVisible" class="start-panel">
          <h2>What should we work on?</h2>
          <StartComposer
            v-model:draft="draft"
            v-model:start-project-query="startProjectQuery"
            :attached-images="attachedImages"
            :available-models="availableModels"
            :available-thinking-levels="availableThinkingLevels"
            :chips="composerChips"
            :creating-session-cwd="creatingSessionCwd || startupRun?.cwd || ''"
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
          <Transition name="run-status">
            <section
              v-if="startupStatus"
              class="run-status-card start-run-status"
              aria-live="polite"
            >
              <div class="run-status-orb" aria-hidden="true"></div>
              <div class="run-status-main">
                <strong>{{ startupStatus.title }}</strong>
                <span>{{ startupStatus.detail }}</span>
                <div class="run-status-progress" aria-hidden="true">
                  <i></i>
                </div>
                <div class="run-status-steps">
                  <span
                    v-for="step in startupStatus.steps"
                    :key="step.id"
                    :class="{
                      done: step.done,
                      active: step.active,
                    }"
                  >{{ step.label }}</span>
                </div>
              </div>
            </section>
          </Transition>
        </div>
        <div
          v-if="isEmptySelectedSession && !startupRun"
          class="empty-session-panel"
        >
          <h2>What should we work on in {{ topbarTitle }}?</h2>
        </div>

        <Transition name="run-status">
          <section
            v-if="workbenchRunStatus"
            class="run-status-card workbench-run-status"
            aria-live="polite"
          >
            <div class="run-status-orb" aria-hidden="true"></div>
            <div class="run-status-main">
              <strong>{{ workbenchRunStatus.title }}</strong>
              <span>{{ workbenchRunStatus.detail }}</span>
              <div class="run-status-progress" aria-hidden="true">
                <i></i>
              </div>
              <div class="run-status-steps">
                <span
                  v-for="step in workbenchRunStatus.steps"
                  :key="step.id"
                  :class="{
                    done: step.done,
                    active: step.active,
                  }"
                >{{ step.label }}</span>
              </div>
            </div>
          </section>
        </Transition>

        <template v-if="selectedSession && !startupRun && entries.length > 0">
          <TranscriptEntry
            v-for="entry in entries"
            :key="entry.id"
            :copied-entry-id="copiedEntryId"
            :entry="entry"
            :skill-expanded="isSkillExpanded(entry)"
            :tool-expanded="isToolExpanded(entry)"
            @copy="copyEntry"
            @edit="startEditingEntry"
            @fork="forkSession"
            @open-tool-fullscreen="openToolFullscreen"
            @toggle-skill="toggleSkill"
            @toggle-tool="toggleTool"
          />
        </template>

        <TransitionGroup
          v-if="!startupRun"
          name="live-row"
          tag="div"
          class="live-stack"
        >
          <div v-for="item in liveItems" :key="item.id" class="live-item">
            <TranscriptEntry
              v-if="item.type === 'tool' && item.persistedEntry"
              :copied-entry-id="copiedEntryId"
              :entry="item.persistedEntry"
              :tool-expanded="isToolExpanded(item.persistedEntry)"
              @copy="copyEntry"
              @fork="forkSession"
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
              :blocks="item.blocks"
              :copied-entry-id="copiedEntryId"
              :message-id="item.id"
              :streaming="item.streaming"
              @copy="copyTranscriptItem(item.id, liveAssistantCopyText(item.blocks))"
            />

            <div v-else class="live-status-card">
              <span></span>
              <strong>{{ item.text }}</strong>
            </div>
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
          && !isEmptySelectedSession
          && !startupRun"
        class="composer-fade"
      ></div>

      <SessionComposer
        v-if="selectedSession && !initializing && !startupRun"
        ref="composerRef"
        v-model:draft="draft"
        :agent-running="agentRunning"
        :attached-images="attachedImages"
        :available-models="availableModels"
        :available-thinking-levels="availableThinkingLevels"
        :can-submit-draft="canSubmitDraft"
        :chips="composerChips"
        :current-mobile-model-label="currentMobileModelLabel"
        :current-mobile-thinking-label="currentMobileThinkingLabel"
        :current-model-label="currentModelLabel"
        :current-thinking-label="currentThinkingLabel"
        :editing-label="editingLabel"
        :error="promptError || eventStreamError || imageSupportWarning"
        :interrupting="interrupting"
        :class="{
          'empty-session-composer': isEmptySelectedSession,
          'session-handoff-composer': sessionHandoff,
        }"
        :model-key="modelKey"
        :model-picker-open="modelPickerOpen"
        :placeholder="isEmptySelectedSession
          ? 'Describe the first task or attach images'
          : 'Ask for follow-up changes or attach images'"
        :prompt-submitting="promptSubmitting"
        :reloading-session="reloadingSession"
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
          >{{ deletingSessionId ? 'Deleting…' : 'Delete' }}</button>
        </div>
      </section>
    </div>

    <button
      v-if="settingsOpen"
      class="settings-backdrop"
      type="button"
      aria-label="Close settings"
      @click="settingsOpen = false"
    ></button>
    <aside v-if="settingsOpen" class="settings-drawer" aria-label="Settings">
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
            <dd>{{ composerChips[0] || 'Unknown' }}</dd>
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
            <dt>CWD</dt>
            <dd>{{ selectedSession?.cwd || 'No session selected' }}</dd>
          </div>
          <div>
            <dt>Path</dt>
            <dd>
              {{ selectedSession?.path || activeRuntimeSession?.path || '—' }}
            </dd>
          </div>
          <div>
            <dt>Messages</dt>
            <dd>{{ selectedSession?.messageCount ?? '—' }}</dd>
          </div>
        </dl>
      </section>
    </aside>

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
  </main>
</template>
