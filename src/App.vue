<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
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
  sessionTime,
  toolLabel,
  toolTarget,
} from './lib/format'
import {
  activatePiSession,
  createPiSession,
  fetchSessionDetail,
  fetchSessions,
  interruptPiSession,
  submitPrompt,
  switchPiMode,
  switchPiModel,
  switchPiThinkingLevel,
} from './lib/pi-api'
import {
  entryClass,
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
const newSessionFormOpen = ref(false)
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
const localEntries = ref([])
const draft = ref('')
const workbench = ref(null)
const activeRuntimeSession = ref(null)
const eventLogOpen = ref(false)
const settingsOpen = ref(false)
const promptSubmitting = ref(false)
const interrupting = ref(false)
const switchingModel = ref(false)
const switchingThinking = ref(false)
const switchingMode = ref(false)
const modelPickerOpen = ref(false)
const thinkingPickerOpen = ref(false)
const modePickerOpen = ref(false)
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
const availableModels = computed(() => {
  return activeRuntimeSession.value?.state?.availableModels || []
})
const selectedModelKey = computed(() => {
  const model = activeRuntimeSession.value?.state?.model
  if (!model) return ''
  return modelKey(model)
})
const currentModelLabel = computed(() => {
  return modelChip(activeRuntimeSession.value?.state?.model)
})
const currentMobileModelLabel = computed(() => {
  const model = activeRuntimeSession.value?.state?.model
  if (!model?.id) return 'Model'
  return formatMode(model.id).replace(/^Gpt\b/, 'GPT')
})
const availableThinkingLevels = computed(() => {
  return activeRuntimeSession.value?.state?.availableThinkingLevels || []
})
const currentThinkingLabel = computed(() => {
  const level = activeRuntimeSession.value?.state?.thinkingLevel
  return level ? `Thinking · ${formatMode(level)}` : 'Thinking'
})
const currentMobileThinkingLabel = computed(() => {
  const level = activeRuntimeSession.value?.state?.thinkingLevel
  if (!level) return 'Think'
  return `Think ${level === 'medium' ? 'Med' : formatMode(level)}`
})
const currentModeLabel = computed(() => {
  const state = activeRuntimeSession.value?.state || {}
  return modeChip(
    state.steeringMode && formatMode(state.steeringMode),
    state.followUpMode && formatMode(state.followUpMode),
  ) || 'Mode'
})
const currentMobileModeLabel = computed(() => {
  const state = activeRuntimeSession.value?.state || {}
  const mode = state.followUpMode || state.steeringMode
  if (mode === 'one-at-a-time') return 'One'
  return mode ? formatMode(mode) : 'Mode'
})
const composerChips = computed(() => {
  const state = activeRuntimeSession.value?.state || {}

  return [
    typeof state.activeToolCount === 'number'
      ? `${state.activeToolCount} tools`
      : '',
  ].filter(Boolean)
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

onMounted(async () => {
  window.addEventListener('keydown', closeSettingsOnEscape)
  window.addEventListener('popstate', handleRouteChange)
  openEventStream()
  await loadSessions({ routeSessionId: sessionIdFromRoute() })
})

onUnmounted(() => {
  window.removeEventListener('keydown', closeSettingsOnEscape)
  window.removeEventListener('popstate', handleRouteChange)
  closeEventStream()
  closeTerminalPanel()
  clearTimeout(refreshTimer)
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
    newSessionFormOpen.value = false
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

function isToolExpanded(entry) {
  return expandedTools.value.has(entry.id)
}

function toggleTool(entry) {
  const next = new Set(expandedTools.value)
  if (next.has(entry.id)) next.delete(entry.id)
  else next.add(entry.id)
  expandedTools.value = next
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
  if (!text || promptSubmitting.value || agentRunning.value) return

  const localEntry = pendingUserEntry(text)
  localEntries.value = [...localEntries.value, localEntry]
  promptSubmitting.value = true
  promptError.value = ''
  if (stickToBottom.value) await scrollToLatest()
  else hasNewOutput.value = true

  try {
    await submitPrompt(text)
    draft.value = ''
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

function pendingUserEntry(text) {
  return {
    id: `local-${Date.now()}`,
    type: 'message',
    role: 'user',
    label: 'You',
    text,
  }
}

function reconcileLocalEntries(detail) {
  localEntries.value = localEntries.value.filter((localEntry) => {
    return !detail.entries.some((entry) => {
      return entry.type === 'message'
        && entry.role === localEntry.role
        && entry.text === localEntry.text
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

  try {
    activeRuntimeSession.value = await switchPiModel(model.provider, model.id)
  } catch (error) {
    promptError.value = error.message
  } finally {
    switchingModel.value = false
  }
}

async function selectThinkingLevel(level) {
  if (!level || level === activeRuntimeSession.value?.state?.thinkingLevel) {
    thinkingPickerOpen.value = false
    return
  }

  switchingThinking.value = true
  thinkingPickerOpen.value = false
  promptError.value = ''

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

function handleComposerKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submitDraft()
}

function handleStartComposerKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submitStartDraft()
}

async function submitStartDraft() {
  const text = draft.value.trim()
  if (!newSessionCwd.value.trim() || creatingSessionCwd.value) return
  await createSessionForCwd(newSessionCwd.value)
  if (text) await submitDraft()
}

function closeSettingsOnEscape(event) {
  if (event.key === 'Escape') settingsOpen.value = false
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

    <aside class="sidebar">
      <div class="brand-row">
        <button
          class="brand-home"
          type="button"
          aria-label="Go to home"
          @click="navigateHome"
        >
          <span class="brand-mark">⌁</span>
          <span class="brand-name">
            <strong>Leyline</strong>
          </span>
        </button>
        <button
          class="sidebar-collapse-button"
          type="button"
          aria-label="Hide sessions"
          @click="desktopSidebarHidden = true"
        >‹</button>
      </div>

      <label class="search-field">
        <span>⌕</span>
        <input v-model="sessionQuery" placeholder="Search sessions" />
      </label>

      <section class="sidebar-section">
        <div class="section-header">
          <span>Sessions</span>
          <button
            type="button"
            class="section-action"
            title="New session"
            @click="newSessionFormOpen = !newSessionFormOpen"
          >＋</button>
        </div>

        <form
          v-if="newSessionFormOpen"
          class="new-session-form"
          @submit.prevent="createSessionForCwd(newSessionCwd)"
        >
          <input
            v-model="newSessionCwd"
            placeholder="Project cwd"
            :disabled="!!creatingSessionCwd"
          />
          <button
            type="submit"
            :disabled="!newSessionCwd.trim() || !!creatingSessionCwd"
          >Create</button>
        </form>

        <div v-if="sessionsLoading" class="sidebar-skeleton">
          <div v-for="index in 3" :key="index" class="skeleton-project">
            <div class="skeleton-line skeleton-title"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
        <div v-else-if="sessionsError" class="sidebar-note error-note">
          {{ sessionsError }}
          <button type="button" @click="loadSessions()">Retry</button>
        </div>
        <div v-else-if="visibleProjects.length === 0" class="sidebar-note">
          No sessions found
        </div>

        <div
          v-for="project in visibleProjects"
          v-else
          :key="project.cwd"
          class="project"
        >
          <div class="project-title">
            <button @click="toggleProject(project)">
              <span class="project-label">
                <span
                  class="project-caret"
                  :class="{ expanded: isProjectExpanded(project) }"
                >›</span>
                <span v-html="highlightedText(project.name)"></span>
              </span>
              <time>{{ project.sessions.length }}</time>
            </button>
            <button
              class="new-session-button"
              :disabled="creatingSessionCwd === project.cwd"
              title="New session"
              @click="createSession(project)"
            >
              +
            </button>
          </div>

          <template v-if="isProjectExpanded(project)">
            <button
              v-for="session in project.sessions.slice(0, 5)"
              :key="session.path || session.id"
              class="session"
              :class="{ active: session.id === selectedSessionId }"
              @click="selectSession(session)"
            >
              <span v-html="highlightedText(sessionTitle(session))"></span>
              <time>{{ sessionTime(session) }}</time>
            </button>
          </template>
        </div>
      </section>

      <button
        class="settings-button"
        type="button"
        title="Settings"
        aria-label="Open settings"
        @click="settingsOpen = true"
      >⚙</button>
    </aside>

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
            ></textarea>
            <div class="start-composer-bar">
              <button
                class="start-project-button"
                type="button"
                @click="startProjectPickerOpen = !startProjectPickerOpen"
              >
                <span>▱</span>
                {{ startProjectLabel }}
                <em>⌄</em>
              </button>
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
                      active: level === activeRuntimeSession?.state?.thinkingLevel,
                    }"
                    @click="selectThinkingLevel(level)"
                  >
                    <span>{{ formatMode(level) }}</span>
                    <span
                      v-if="level === activeRuntimeSession?.state?.thinkingLevel"
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
              <span
                v-for="chip in composerChips"
                :key="chip"
                class="composer-chip start-composer-chip"
              >
                {{ chip }}
              </span>
              <button
                class="start-send-button"
                type="submit"
                :disabled="!newSessionCwd.trim() || !!creatingSessionCwd"
              >↑</button>
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
              <button type="button" @click="newSessionFormOpen = true">
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
                <em>{{ entry.isError ? 'error' : 'completed' }}</em>
              </div>
              <pre v-if="isToolExpanded(entry)" class="tool-output">{{ entry.text }}</pre>
            </article>

            <article
              v-else
              class="message compact-message transcript-message"
              :class="entryClass(entry)"
            >
              <div class="message-meta">{{ entry.label }}</div>
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
            </article>
          </template>
        </template>

        <article
          v-if="liveAssistantBlocks.length"
          class="message compact-message transcript-message assistant-message live-message"
        >
          <div class="message-meta">Leyline</div>
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
          :disabled="promptSubmitting"
          placeholder="Ask for follow-up changes or attach images"
          @keydown="handleComposerKeydown"
        ></textarea>
        <div v-if="promptError || eventStreamError" class="composer-error">
          {{ promptError || eventStreamError }}
        </div>
        <div class="composer-bar">
          <div class="model-picker">
            <button
              class="composer-chip model-picker-button"
              type="button"
              :disabled="agentRunning || promptSubmitting || switchingModel"
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
              :disabled="agentRunning || promptSubmitting || switchingThinking"
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
                  active: level === activeRuntimeSession?.state?.thinkingLevel,
                }"
                @click="selectThinkingLevel(level)"
              >
                <span>{{ formatMode(level) }}</span>
                <span
                  v-if="level === activeRuntimeSession?.state?.thinkingLevel"
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
              :disabled="agentRunning || promptSubmitting || switchingMode"
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
          <span
            v-for="chip in composerChips"
            :key="chip"
            class="composer-chip"
          >
            {{ chip }}
          </span>
          <button
            class="send-button"
            :class="{ 'stop-button': agentRunning }"
            :type="agentRunning ? 'button' : 'submit'"
            :disabled="agentRunning ? interrupting : promptSubmitting || !draft.trim()"
            :title="agentRunning ? 'Stop Leyline' : 'Send message'"
            @click="agentRunning && interruptAgent()"
          >
            {{ agentRunning ? '■' : promptSubmitting ? '…' : '↑' }}
          </button>
        </div>
      </form>
    </section>

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
  </main>
</template>
