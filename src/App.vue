<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import PierrePreview from './components/PierrePreview.vue'
import ProjectBrowser from './components/ProjectBrowser.vue'
import SessionSidebar from './components/SessionSidebar.vue'
import { useRuntimeEvents } from './composables/useRuntimeEvents'
import { useTerminal } from './composables/useTerminal'
import { fuzzyScore, highlightedText as highlightFuzzyText } from './lib/fuzzy'
import {
  eventTime,
  formatDate,
  formatMode,
  modeChip,
  modelChip,
  projectName,
  toolLabel,
  toolTarget,
} from './lib/format'
import {
  activatePiSession,
  createPiSession,
  deletePiSession,
  fetchPiRuntimeState,
  fetchSessionDetail,
  fetchSessions,
  interruptPiSession,
  reloadPiSession,
  submitPrompt,
  switchPiMode,
  switchPiModel,
  switchPiThinkingLevel,
} from './lib/pi-api'
import {
  entryClass,
  imageBlocksFor,
  imageSrc,
  messageBlocks,
  messageBlocksFor,
  renderedBlock,
  renderedMessage,
  skillSummaries,
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
const interrupting = ref(false)
const switchingModel = ref(false)
const switchingThinking = ref(false)
const switchingMode = ref(false)
const reloadingSession = ref(false)
const deletingSessionId = ref('')
const deleteConfirmSession = ref(null)
const modelPickerOpen = ref(false)
const thinkingPickerOpen = ref(false)
const modePickerOpen = ref(false)
const slashActiveIndex = ref(0)
const slashPickerDismissed = ref(false)
const promptError = ref('')
const agentRunning = ref(false)
const liveActivity = ref('')
const liveAssistantText = ref('')
const liveAssistantBlocks = ref([])
const stickToBottom = ref(true)
const hasNewOutput = ref(false)
const {
  closeTerminalPanel,
  connectTerminal,
  terminalCwd,
  terminalEl,
  terminalOpen,
  terminalStatus,
  toggleTerminal,
} = useTerminal()
let refreshTimer
let scrollFrame
let copiedTimer

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
const initializing = computed(() => sessionsLoading.value && !selectedSession.value)
const entries = computed(() => [
  ...(sessionDetail.value?.entries || []),
  ...localEntries.value,
])
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

    agentRunning.value = isRunningEvent(data.event)
    liveActivity.value = activityText(data.event)
    updateLiveAssistant(data.event)
    surfaceRuntimeError(data.event)
    scheduleLiveScroll(data.activeSessionId)
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
  const model = composerRuntime.value?.state?.model
  if (!model?.id) return 'Model'
  return formatMode(model.id).replace(/^Gpt\b/, 'GPT')
})
const availableThinkingLevels = computed(() => {
  return composerRuntime.value?.state?.availableThinkingLevels || []
})
const currentThinkingLabel = computed(() => {
  const level = composerRuntime.value?.state?.thinkingLevel
  return level ? `Thinking · ${formatMode(level)}` : 'Thinking'
})
const currentMobileThinkingLabel = computed(() => {
  const level = composerRuntime.value?.state?.thinkingLevel
  if (!level) return 'Think'
  return `Think ${level === 'medium' ? 'Med' : formatMode(level)}`
})
const currentModeLabel = computed(() => {
  const state = composerRuntime.value?.state || {}
  return modeChip(
    state.steeringMode && formatMode(state.steeringMode),
    state.followUpMode && formatMode(state.followUpMode),
  ) || 'Mode'
})
const currentMobileModeLabel = computed(() => {
  const state = composerRuntime.value?.state || {}
  const mode = state.followUpMode || state.steeringMode
  if (mode === 'one-at-a-time') return 'One'
  return mode ? formatMode(mode) : 'Mode'
})
const composerChips = computed(() => {
  const state = composerRuntime.value?.state || {}

  return [
    typeof state.activeToolCount === 'number'
      ? `${state.activeToolCount} tools`
      : '',
  ].filter(Boolean)
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
const initEventLabel = computed(() => {
  return eventStreamConnected.value
    ? 'Runtime events connected'
    : 'Connecting runtime events'
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
  openEventStream()
  await loadSessions({ routeSessionId: sessionIdFromRoute() })
})

onUnmounted(() => {
  window.removeEventListener('keydown', closeMenusOnEscape)
  window.removeEventListener('click', closeMenusOnOutsideClick)
  window.removeEventListener('popstate', handleRouteChange)
  closeEventStream()
  closeTerminalPanel()
  clearTimeout(refreshTimer)
  clearTimeout(copiedTimer)
  cancelAnimationFrame(scrollFrame)
})

async function loadSessions({
  routeSessionId = '',
  selectFirst = false,
  showLoading = true,
} = {}) {
  if (showLoading) sessionsLoading.value = true
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
    if (showLoading) sessionsLoading.value = false
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

async function createSessionForCwd(cwd) {
  const targetCwd = cwd?.trim() || ''
  if (!targetCwd) return

  creatingSessionCwd.value = targetCwd
  sessionError.value = ''

  try {
    const data = await createPiSession(targetCwd)

    await loadSessions({ selectFirst: false, showLoading: false })
    activeRuntimeSession.value = data.active
    sessionDetail.value = data.detail
    selectedSessionId.value = data.detail.session.id
    updateSessionRoute(data.detail.session.id)
    expandedTools.value = new Set()
    expandedSkills.value = new Set()
    localEntries.value = []
    liveActivity.value = ''
    liveAssistantText.value = ''
    liveAssistantBlocks.value = []
    expandProject(targetCwd)
    newSessionCwd.value = ''
    projectBrowserOpen.value = false
    stickToBottom.value = true
    hasNewOutput.value = false
    await scrollToLatest()
    sidebarOpen.value = false
    if (terminalOpen.value) await connectTerminal()
  } catch (error) {
    sessionError.value = error.message
  } finally {
    creatingSessionCwd.value = ''
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
    liveActivity.value = ''
    liveAssistantText.value = ''
    liveAssistantBlocks.value = []
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
  liveActivity.value = ''
  liveAssistantText.value = ''
  liveAssistantBlocks.value = []
}

function navigateHome() {
  clearSelectedSession()
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
      if (shouldClearLiveAssistant(event)) {
        liveAssistantText.value = ''
        liveAssistantBlocks.value = []
      }
      if (wasStuck) await scrollToLatest()
      else hasNewOutput.value = true
    } catch (error) {
      sessionError.value = error.message
    }
  }, 250)
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
  if (type === 'tool_call') return `Preparing ${toolLabel(event.toolName)}…`
  if (type === 'tool_execution_start') {
    return `Running ${toolLabel(event.toolName)}${toolTarget(event.args)}`
  }
  if (type === 'tool_execution_end') return 'Reading result…'
  if (type === 'agent_end' || type === 'error' || type === 'aborted') return ''
  return liveActivity.value
}

function surfaceRuntimeError(event) {
  if (event?.type !== 'error') return
  promptError.value = event.error?.message || event.message || 'Runtime error'
}

function updateLiveAssistant(event) {
  if (event?.type === 'message_update' && event.message?.role === 'assistant') {
    liveAssistantBlocks.value = messageBlocks(event.message.content)
    liveAssistantText.value = textFromBlocks(liveAssistantBlocks.value)
    return
  }

  if (['error', 'aborted'].includes(event?.type)) {
    liveAssistantText.value = ''
    liveAssistantBlocks.value = []
  }
}

function shouldClearLiveAssistant(event) {
  if (event?.type === 'message_end' && event.message?.role === 'assistant') {
    return true
  }

  return event?.type === 'agent_end'
}

async function activateSession(session) {
  activeRuntimeSession.value = await activatePiSession(session.id)
}

function sessionTitle(session) {
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

function liveAssistantCopyText() {
  return liveAssistantBlocks.value.map((block) => block.text).join('\n\n')
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
  if (!liveAssistantText.value && !liveActivity.value) return

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

async function submitDraft() {
  const text = draft.value.trim()
  const images = attachedImages.value.map(({ preview, ...image }) => image)
  if (!text && images.length === 0) return
  if (promptSubmitting.value || agentRunning.value) return
  if (reloadingSession.value) return

  const localEntry = pendingUserEntry(text, images)
  localEntries.value = [...localEntries.value, localEntry]
  promptSubmitting.value = true
  promptError.value = ''
  if (stickToBottom.value) await scrollToLatest()
  else hasNewOutput.value = true

  try {
    await submitPrompt(text, images)
    draft.value = ''
    attachedImages.value = []
    agentRunning.value = true
    liveActivity.value = 'Thinking…'
  } catch (error) {
    localEntries.value = localEntries.value.filter((entry) => {
      return entry.id !== localEntry.id
    })
    promptError.value = error.message
    liveActivity.value = ''
    liveAssistantText.value = ''
    liveAssistantBlocks.value = []
  } finally {
    promptSubmitting.value = false
  }
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
  const blocks = []
  if (text) blocks.push({ type: 'text', text })
  blocks.push(...images)

  return {
    id: `local-${Date.now()}`,
    type: 'message',
    role: 'user',
    label: 'You',
    text,
    blocks,
  }
}

function reconcileLocalEntries(detail) {
  localEntries.value = localEntries.value.filter((localEntry) => {
    return !detail.entries.some((entry) => {
      return entry.type === 'message'
        && entry.role === localEntry.role
        && entry.text === localEntry.text
        && imageBlocksFor(entry).length === imageBlocksFor(localEntry).length
    })
  })
}

function updateSelectedSessionSummary(session) {
  sessions.value = sessions.value.map((item) => {
    if (item.id !== session.id) return item
    return {
      ...item,
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

async function selectMode(key, value) {
  const state = activeRuntimeSession.value?.state || {}
  if (!key || !value || state[key] === value) {
    modePickerOpen.value = false
    return
  }

  switchingMode.value = true
  modePickerOpen.value = false
  promptError.value = ''

  try {
    activeRuntimeSession.value = await switchPiMode({ [key]: value })
  } catch (error) {
    promptError.value = error.message
  } finally {
    switchingMode.value = false
  }
}

function togglePicker(name) {
  modelPickerOpen.value = name === 'model' && !modelPickerOpen.value
  thinkingPickerOpen.value = name === 'thinking' && !thinkingPickerOpen.value
  modePickerOpen.value = name === 'mode' && !modePickerOpen.value
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
  if (!newSessionCwd.value.trim() || creatingSessionCwd.value) return
  await createSessionForCwd(newSessionCwd.value)
  if (model && selectedSession.value) {
    activeRuntimeSession.value = await switchPiModel(model.provider, model.id)
  }
  if (thinkingLevel && selectedSession.value) {
    activeRuntimeSession.value = await switchPiThinkingLevel(thinkingLevel)
  }
  if (text || attachedImages.value.length) await submitDraft()
}

function closeMenusOnEscape(event) {
  if (event.key !== 'Escape') return
  settingsOpen.value = false
  closeToolFullscreen()
  closeProjectBrowser()
  cancelDeleteSession()
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
  modePickerOpen.value = false
  startProjectPickerOpen.value = false
}

</script>

<template>
  <main
    class="leyline-app"
    :class="{
      'sidebar-open': sidebarOpen,
      'sidebar-hidden': desktopSidebarHidden,
      'start-state': !initializing && !selectedSession,
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
      <header v-if="initializing || selectedSession" class="topbar">
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
          <button
            class="event-log-button"
            type="button"
            @click="toggleTerminal"
          >
            Terminal {{ terminalStatus }}
          </button>
          <button
            class="event-log-button"
            type="button"
            @click="eventLogOpen = !eventLogOpen"
          >
            Events {{ runtimeEvents.length }}
          </button>
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
        </div>
      </header>

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

      <div
        ref="workbench"
        class="workbench"
        :class="{
          'init-workbench': initializing,
          'session-loading-workbench': sessionLoading,
          'start-workbench-shell': !initializing && !selectedSession,
        }"
        @scroll="handleWorkbenchScroll"
      >
        <div v-if="initializing" class="init-panel">
          <div class="init-kicker">Starting Leyline</div>
          <h2>Loading workspace…</h2>
          <div class="init-steps">
            <div class="init-step active">
              <span></span>
              <strong>Loading sessions</strong>
            </div>
            <div class="init-step" :class="{ done: eventStreamConnected }">
              <span></span>
              <strong>{{ initEventLabel }}</strong>
            </div>
            <div class="init-step">
              <span></span>
              <strong>Preparing transcript view</strong>
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
        <div v-else-if="!selectedSession" class="start-panel">
          <h2>What should we work on?</h2>
          <form class="start-composer" @submit.prevent="submitStartDraft">
            <textarea
              v-model="draft"
              placeholder="Ask Leyline anything"
              :disabled="!!creatingSessionCwd"
              @keydown="handleStartComposerKeydown"
              @input="showSlashPicker"
              @paste="handleComposerPaste"
            ></textarea>
            <div v-if="slashPickerOpen" class="slash-picker">
              <button
                v-for="(command, index) in slashCommandItems"
                :key="`${command.source}-${command.name}`"
                type="button"
                :class="{ active: index === slashActiveIndex }"
                @mousedown.prevent="selectSlashCommand(command)"
              >
                <span class="slash-command-name">/{{ command.name }}</span>
                <span class="slash-command-description">
                  {{ command.description || 'No description' }}
                </span>
                <span class="slash-command-source">
                  {{ slashCommandSourceLabel(command.source) }}
                </span>
              </button>
            </div>
            <div v-if="attachedImages.length" class="attachment-tray">
              <div
                v-for="(image, index) in attachedImages"
                :key="`${image.mimeType}-${index}`"
                class="attachment-chip"
              >
                <img :src="image.preview" alt="Pasted image" />
                <button type="button" @click="removeAttachedImage(index)">×</button>
              </div>
            </div>
            <div v-if="imageSupportWarning" class="composer-error">
              {{ imageSupportWarning }}
            </div>
            <div class="start-composer-bar">
              <div class="composer-primary-row">
                <div class="composer-row-spacer"></div>
                <div class="composer-actions">
                  <div class="model-picker start-picker">
                    <button
                      class="composer-chip model-picker-button start-composer-chip"
                      type="button"
                      :disabled="switchingModel || availableModels.length === 0"
                      @click="togglePicker('model')"
                    >
                      <span class="model-label">{{ currentModelLabel }}</span>
                      <span class="model-caret">▾</span>
                    </button>
                    <div v-if="modelPickerOpen" class="model-menu">
                      <button
                        v-for="model in availableModels"
                        :key="modelKey(model)"
                        type="button"
                        :class="{ active: modelKey(model) === selectedModelKey }"
                        @click="selectModel(model)"
                      >
                        <span>{{ modelChip(model) }}</span>
                        <span v-if="modelKey(model) === selectedModelKey">✓</span>
                      </button>
                    </div>
                  </div>
                  <div class="model-picker small-picker start-picker">
                    <button
                      class="composer-chip model-picker-button start-composer-chip"
                      type="button"
                      :disabled="switchingThinking || !availableThinkingLevels.length"
                      @click="togglePicker('thinking')"
                    >
                      <span class="model-label">{{ currentThinkingLabel }}</span>
                      <span class="model-caret">▾</span>
                    </button>
                    <div v-if="thinkingPickerOpen" class="model-menu small-menu">
                      <button
                        v-for="level in availableThinkingLevels"
                        :key="level"
                        type="button"
                        :class="{
                          active: level === composerRuntime?.state?.thinkingLevel,
                        }"
                        @click="selectThinkingLevel(level)"
                      >
                        <span>{{ formatMode(level) }}</span>
                        <span
                          v-if="level === composerRuntime?.state?.thinkingLevel"
                        >✓</span>
                      </button>
                    </div>
                  </div>
                  <div class="model-picker small-picker start-picker">
                    <button
                      class="composer-chip model-picker-button start-composer-chip"
                      type="button"
                      :disabled="switchingMode || !activeRuntimeSession"
                      @click="togglePicker('mode')"
                    >
                      <span class="model-label">{{ currentModeLabel }}</span>
                      <span class="model-caret">▾</span>
                    </button>
                    <div v-if="modePickerOpen" class="model-menu mode-menu">
                      <div class="mode-menu-label">Steering</div>
                      <button
                        v-for="value in ['one-at-a-time', 'all']"
                        :key="`start-steering-${value}`"
                        type="button"
                        :class="{
                          active: value === activeRuntimeSession?.state?.steeringMode,
                        }"
                        @click="selectMode('steeringMode', value)"
                      >
                        <span>{{ formatMode(value) }}</span>
                        <span
                          v-if="value === activeRuntimeSession?.state?.steeringMode"
                        >✓</span>
                      </button>
                      <div class="mode-menu-label">Follow-up</div>
                      <button
                        v-for="value in ['one-at-a-time', 'all']"
                        :key="`start-follow-up-${value}`"
                        type="button"
                        :class="{
                          active: value === activeRuntimeSession?.state?.followUpMode,
                        }"
                        @click="selectMode('followUpMode', value)"
                      >
                        <span>{{ formatMode(value) }}</span>
                        <span
                          v-if="value === activeRuntimeSession?.state?.followUpMode"
                        >✓</span>
                      </button>
                    </div>
                  </div>
                  <button
                    class="start-send-button"
                    type="submit"
                    :disabled="!newSessionCwd.trim() || !!creatingSessionCwd"
                  >↑</button>
                </div>
              </div>
              <div class="composer-context-row">
                <button
                  class="start-project-button"
                  type="button"
                  @click="startProjectPickerOpen = !startProjectPickerOpen"
                >
                  <span class="start-project-icon">▱</span>
                  <span class="start-project-label">{{ startProjectLabel }}</span>
                  <span class="model-caret">▾</span>
                </button>
                <span
                  v-for="chip in composerChips"
                  :key="chip"
                  class="composer-chip start-composer-chip"
                >
                  {{ chip }}
                </span>
              </div>
            </div>
            <div v-if="startProjectPickerOpen" class="start-project-menu">
              <label>
                <span>⌕</span>
                <input
                  v-model="startProjectQuery"
                  placeholder="Search projects"
                />
              </label>
              <button
                v-for="project in startProjectOptions"
                :key="project.cwd"
                type="button"
                @click="selectStartProject(project.cwd)"
              >
                <span>▱</span>
                <strong>{{ project.name }}</strong>
                <em v-if="project.cwd === newSessionCwd">✓</em>
              </button>
              <div class="start-project-divider"></div>
              <button type="button" @click="openProjectBrowser()">
                <span>＋</span>
                <strong>Add new project</strong>
              </button>
            </div>
          </form>
        </div>
        <div v-else-if="entries.length === 0" class="empty-workbench">
          No transcript entries found.
        </div>

        <template v-else>
          <template v-for="entry in entries" :key="entry.id">
            <div v-if="entry.type === 'event'" class="event-row">
              <span>{{ entry.label }}</span>
              <strong>{{ entry.text }}</strong>
              <button
                class="copy-button"
                type="button"
                :title="copyTitle(entry.id)"
                @click="copyTranscriptItem(entry.id, entryCopyText(entry))"
              >
                {{ copyGlyph(entry.id) }}
              </button>
            </div>

            <article
              v-else-if="entry.type === 'tool'"
              class="tool-card transcript-tool"
              :class="{ 'error-card': entry.isError }"
              @click="toggleTool(entry)"
            >
              <div class="tool-card-header">
                <span>{{ isToolExpanded(entry) ? '⌄' : '›' }}</span>
                <span>{{ entry.label }}</span>
                <code v-if="entry.code">{{ entry.code }}</code>
                <span
                  v-if="entry.contextLabel"
                  class="tool-context-pill"
                  :class="{ 'is-excluded': entry.excludeFromContext }"
                >
                  {{ entry.contextLabel }}
                </span>
                <em>{{ entry.isError ? 'error' : 'completed' }}</em>
                <button
                  v-if="entry.preview"
                  class="copy-button"
                  type="button"
                  title="Open full screen"
                  @click.stop="openToolFullscreen(entry)"
                >
                  ⛶
                </button>
                <button
                  class="copy-button"
                  type="button"
                  :title="copyTitle(entry.id)"
                  @click.stop="copyTranscriptItem(entry.id, entryCopyText(entry))"
                >
                  {{ copyGlyph(entry.id) }}
                </button>
              </div>
              <div
                v-if="isToolExpanded(entry)"
                class="tool-expanded-body"
                @click.stop
              >
                <template v-if="entry.preview">
                  <div class="tool-preview-clip">
                    <PierrePreview :preview="entry.preview" clipped />
                    <div class="tool-preview-fade"></div>
                  </div>
                  <button
                    class="tool-preview-cta"
                    type="button"
                    @click="openToolFullscreen(entry)"
                  >
                    Open full screen
                  </button>
                </template>
                <pre v-else class="tool-output">{{ entry.text }}</pre>
              </div>
            </article>

            <article
              v-else
              class="message compact-message transcript-message"
              :class="entryClass(entry)"
            >
              <div class="message-meta message-meta-row">
                <span>{{ entry.label }}</span>
                <button
                  class="copy-button"
                  type="button"
                  :title="copyTitle(entry.id)"
                  @click="copyTranscriptItem(entry.id, entryCopyText(entry))"
                >
                  {{ copyGlyph(entry.id) }}
                </button>
              </div>
              <template v-if="entry.role === 'assistant' && entry.blocks?.length">
                <template
                  v-for="(block, index) in messageBlocksFor(entry)"
                  :key="`${entry.id}-${index}`"
                >
                  <div
                    v-if="block.type === 'thinking'"
                    class="thinking-block"
                  >
                    <div class="thinking-label">Thinking</div>
                    <pre>{{ block.text }}</pre>
                  </div>
                  <div
                    v-else
                    class="entry-text markdown-body assistant-text-block"
                    v-html="renderedBlock(block)"
                  ></div>
                </template>
              </template>
              <div
                v-else-if="skillSummaries(entry).length"
                class="skill-summary-list"
              >
                <button
                  v-for="skill in skillSummaries(entry)"
                  :key="skill.name"
                  class="skill-summary"
                  type="button"
                  :title="skill.location"
                  @click="toggleSkill(entry)"
                >
                  <span>[skill]</span>
                  <strong>{{ skill.name }}</strong>
                  <em>{{ isSkillExpanded(entry) ? 'hide' : 'expand' }}</em>
                </button>
                <div
                  v-if="isSkillExpanded(entry)"
                  class="skill-expanded entry-text markdown-body"
                  v-html="renderedMessage(entry)"
                ></div>
              </div>
              <div
                v-else
                class="entry-text markdown-body"
                v-html="renderedMessage(entry)"
              ></div>
              <div v-if="imageBlocksFor(entry).length" class="message-images">
                <img
                  v-for="(image, index) in imageBlocksFor(entry)"
                  :key="`${entry.id}-image-${index}`"
                  :src="imageSrc(image)"
                  alt="Attached image"
                />
              </div>
            </article>
          </template>
        </template>

        <article
          v-if="liveAssistantBlocks.length"
          class="message compact-message transcript-message assistant-message live-message"
        >
          <div class="message-meta message-meta-row">
            <span>Agent</span>
            <button
              class="copy-button"
              type="button"
              :title="copyTitle('live-assistant')"
              @click="copyTranscriptItem('live-assistant', liveAssistantCopyText())"
            >
              {{ copyGlyph('live-assistant') }}
            </button>
          </div>
          <template
            v-for="(block, index) in liveAssistantBlocks"
            :key="`live-${index}`"
          >
            <div v-if="block.type === 'thinking'" class="thinking-block">
              <div class="thinking-label">Thinking</div>
              <pre>{{ block.text }}</pre>
            </div>
            <div
              v-else
              class="entry-text markdown-body assistant-text-block"
              v-html="renderedBlock(block)"
            ></div>
          </template>
        </article>

        <div v-if="liveActivity" class="event-row live-activity">
          <span>Live</span>
          <strong>{{ liveActivity }}</strong>
        </div>
      </div>

      <button
        v-if="hasNewOutput"
        class="jump-latest-button"
        type="button"
        @click="jumpToLatest"
      >
        Jump to latest
      </button>

      <section v-if="terminalOpen" class="terminal-panel">
        <div class="terminal-header">
          <strong>Terminal</strong>
          <code>{{ terminalCwd || selectedSession?.cwd }}</code>
          <span>{{ terminalStatus }}</span>
          <button type="button" @click="closeTerminalPanel">×</button>
        </div>
        <div ref="terminalEl" class="terminal-frame"></div>
      </section>

      <div v-if="selectedSession && !initializing" class="composer-fade"></div>

      <form
        v-if="selectedSession && !initializing"
        class="composer"
        @submit.prevent="submitDraft"
      >
        <textarea
          v-model="draft"
          :disabled="promptSubmitting || reloadingSession"
          placeholder="Ask for follow-up changes or attach images"
          @keydown="handleComposerKeydown"
          @input="showSlashPicker"
          @paste="handleComposerPaste"
        ></textarea>
        <div v-if="slashPickerOpen" class="slash-picker">
          <button
            v-for="(command, index) in slashCommandItems"
            :key="`${command.source}-${command.name}`"
            type="button"
            :class="{ active: index === slashActiveIndex }"
            @mousedown.prevent="selectSlashCommand(command)"
          >
            <span class="slash-command-name">/{{ command.name }}</span>
            <span class="slash-command-description">
              {{ command.description || 'No description' }}
            </span>
            <span class="slash-command-source">
              {{ slashCommandSourceLabel(command.source) }}
            </span>
          </button>
        </div>
        <div v-if="attachedImages.length" class="attachment-tray">
          <div
            v-for="(image, index) in attachedImages"
            :key="`${image.mimeType}-${index}`"
            class="attachment-chip"
          >
            <img :src="image.preview" alt="Pasted image" />
            <button type="button" @click="removeAttachedImage(index)">×</button>
          </div>
        </div>
        <div
          v-if="promptError || eventStreamError || imageSupportWarning"
          class="composer-error"
        >
          {{ promptError || eventStreamError || imageSupportWarning }}
        </div>
        <div class="composer-bar">
          <div class="composer-primary-row">
            <div class="composer-row-spacer"></div>
            <div class="composer-actions">
              <div class="model-picker">
                <button
                  class="composer-chip model-picker-button"
                  type="button"
                  :disabled="agentRunning
                    || promptSubmitting
                    || reloadingSession
                    || switchingModel"
                  @click="togglePicker('model')"
                >
                  <span class="model-label desktop-label">{{ currentModelLabel }}</span>
                  <span class="model-label mobile-label">
                    {{ currentMobileModelLabel }}
                  </span>
                  <span class="model-caret">▾</span>
                </button>
                <div v-if="modelPickerOpen" class="model-menu">
                  <button
                    v-for="model in availableModels"
                    :key="modelKey(model)"
                    type="button"
                    :class="{ active: modelKey(model) === selectedModelKey }"
                    @click="selectModel(model)"
                  >
                    <span>{{ modelChip(model) }}</span>
                    <span v-if="modelKey(model) === selectedModelKey">✓</span>
                  </button>
                </div>
              </div>
              <div class="model-picker small-picker">
                <button
                  class="composer-chip model-picker-button"
                  type="button"
                  :disabled="agentRunning
                    || promptSubmitting
                    || reloadingSession
                    || switchingThinking"
                  @click="togglePicker('thinking')"
                >
                  <span class="model-label desktop-label">
                    {{ currentThinkingLabel }}
                  </span>
                  <span class="model-label mobile-label">
                    {{ currentMobileThinkingLabel }}
                  </span>
                  <span class="model-caret">▾</span>
                </button>
                <div v-if="thinkingPickerOpen" class="model-menu small-menu">
                  <button
                    v-for="level in availableThinkingLevels"
                    :key="level"
                    type="button"
                    :class="{
                      active: level === composerRuntime?.state?.thinkingLevel,
                    }"
                    @click="selectThinkingLevel(level)"
                  >
                    <span>{{ formatMode(level) }}</span>
                    <span
                      v-if="level === composerRuntime?.state?.thinkingLevel"
                    >
                      ✓
                    </span>
                  </button>
                </div>
              </div>
              <div class="model-picker small-picker">
                <button
                  class="composer-chip model-picker-button"
                  type="button"
                  :disabled="agentRunning
                    || promptSubmitting
                    || reloadingSession
                    || switchingMode"
                  @click="togglePicker('mode')"
                >
                  <span class="model-label desktop-label">{{ currentModeLabel }}</span>
                  <span class="model-label mobile-label">
                    {{ currentMobileModeLabel }}
                  </span>
                  <span class="model-caret">▾</span>
                </button>
                <div v-if="modePickerOpen" class="model-menu mode-menu">
                  <div class="mode-menu-label">Steering</div>
                  <button
                    v-for="value in ['one-at-a-time', 'all']"
                    :key="`steering-${value}`"
                    type="button"
                    :class="{
                      active: value === activeRuntimeSession?.state?.steeringMode,
                    }"
                    @click="selectMode('steeringMode', value)"
                  >
                    <span>{{ formatMode(value) }}</span>
                    <span
                      v-if="value === activeRuntimeSession?.state?.steeringMode"
                    >
                      ✓
                    </span>
                  </button>
                  <div class="mode-menu-label">Follow-up</div>
                  <button
                    v-for="value in ['one-at-a-time', 'all']"
                    :key="`follow-up-${value}`"
                    type="button"
                    :class="{
                      active: value === activeRuntimeSession?.state?.followUpMode,
                    }"
                    @click="selectMode('followUpMode', value)"
                  >
                    <span>{{ formatMode(value) }}</span>
                    <span
                      v-if="value === activeRuntimeSession?.state?.followUpMode"
                    >
                      ✓
                    </span>
                  </button>
                </div>
              </div>
              <button
                class="send-button"
                :class="{ 'stop-button': agentRunning }"
                :type="agentRunning ? 'button' : 'submit'"
                :disabled="agentRunning
                  ? interrupting
                  : promptSubmitting || reloadingSession || !canSubmitDraft"
                :title="agentRunning ? 'Stop Leyline' : 'Send message'"
                @click="agentRunning && interruptAgent()"
              >
                {{ sendButtonLabel }}
              </button>
            </div>
          </div>
          <div class="composer-context-row">
            <span
              v-for="chip in composerChips"
              :key="chip"
              class="composer-chip"
            >
              {{ chip }}
            </span>
          </div>
        </div>
      </form>
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
            <dt>Mode</dt>
            <dd>{{ currentModeLabel }}</dd>
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
          <PierrePreview
            v-if="fullscreenTool.preview"
            :preview="fullscreenTool.preview"
            :clipped="false"
          />
          <pre v-else class="tool-output">{{ fullscreenTool.text }}</pre>
        </div>
      </section>
    </div>
  </main>
</template>
