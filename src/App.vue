<script setup>
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
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
} from './lib/pi-api'
import {
  entryClass,
  messageBlocks,
  messageBlocksFor,
  renderedBlock,
  renderedMessage,
  textFromBlocks,
  textFromContent,
} from './lib/transcript'

const sessions = ref([])
const sessionsError = ref('')
const sessionsLoading = ref(true)
const creatingSessionCwd = ref('')
const sessionQuery = ref('')
const selectedSessionId = ref('')
const expandedProjects = ref(new Set())
const sessionDetail = ref(null)
const sessionLoading = ref(false)
const sessionError = ref('')
const expandedTools = ref(new Set())
const localEntries = ref([])
const draft = ref('')
const workbench = ref(null)
const activeRuntimeSession = ref(null)
const runtimeEvents = ref([])
const eventLogOpen = ref(false)
const promptSubmitting = ref(false)
const interrupting = ref(false)
const promptError = ref('')
const eventStreamError = ref('')
const eventStreamConnected = ref(false)
const agentRunning = ref(false)
const liveActivity = ref('')
const liveAssistantText = ref('')
const liveAssistantBlocks = ref([])
const stickToBottom = ref(true)
const hasNewOutput = ref(false)
const terminalOpen = ref(false)
const terminalEl = ref(null)
const terminalStatus = ref('closed')
const terminalCwd = ref('')
let eventSource
let refreshTimer
let scrollFrame
let terminalInstance
let terminalSocket
let terminalInputDisposable
let terminalRunId = 0

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
const eventLog = computed(() => runtimeEvents.value.slice(-20).reverse())
const composerChips = computed(() => {
  const state = activeRuntimeSession.value?.state || {}
  const steeringMode = state.steeringMode && formatMode(state.steeringMode)
  const followUpMode = state.followUpMode && formatMode(state.followUpMode)

  return [
    modelChip(state.model),
    state.thinkingLevel ? `Thinking · ${formatMode(state.thinkingLevel)}` : '',
    modeChip(steeringMode, followUpMode),
    typeof state.activeToolCount === 'number'
      ? `${state.activeToolCount} tools`
      : '',
  ].filter(Boolean)
})

onMounted(async () => {
  openEventStream()
  await loadSessions()
})

onUnmounted(() => {
  eventSource?.close()
  closeTerminalPanel()
  clearTimeout(refreshTimer)
  cancelAnimationFrame(scrollFrame)
})

function openEventStream() {
  eventSource?.close()
  eventSource = new EventSource('/api/pi/events')

  eventSource.addEventListener('active_session', (event) => {
    activeRuntimeSession.value = JSON.parse(event.data)
    appendRuntimeEvent({
      type: 'active_session',
      summary: projectName(activeRuntimeSession.value.cwd),
    })
  })

  eventSource.addEventListener('runtime_event', (event) => {
    const data = JSON.parse(event.data)
    appendRuntimeEvent(data)
    scheduleSessionRefresh(data.activeSessionId, data.event)
    console.log('pi runtime event', data)

    if (data.activeSessionId !== selectedSessionId.value) return

    agentRunning.value = isRunningEvent(data.event)
    liveActivity.value = activityText(data.event)
    updateLiveAssistant(data.event)
    surfaceRuntimeError(data.event)
    scheduleLiveScroll(data.activeSessionId)
  })

  eventSource.onopen = () => {
    eventStreamConnected.value = true
    eventStreamError.value = ''
    appendRuntimeEvent({ type: 'connected' })
  }

  eventSource.onerror = () => {
    eventStreamConnected.value = false
    eventStreamError.value = 'Runtime event stream disconnected'
    appendRuntimeEvent({ type: 'disconnected' })
    console.warn('pi event stream disconnected')
  }
}

function appendRuntimeEvent(event) {
  runtimeEvents.value = [
    ...runtimeEvents.value.slice(-99),
    { ...event, loggedAt: new Date().toISOString() },
  ]
}

async function loadSessions({ selectFirst = true } = {}) {
  sessionsLoading.value = true
  sessionsError.value = ''

  try {
    sessions.value = await fetchSessions()
    if (selectFirst && sessions.value[0]) await selectSession(sessions.value[0])
  } catch (error) {
    sessionsError.value = error.message
  } finally {
    sessionsLoading.value = false
  }
}

async function createSession(project) {
  creatingSessionCwd.value = project.cwd
  sessionError.value = ''

  try {
    const data = await createPiSession(project.cwd)

    await loadSessions({ selectFirst: false })
    sessionDetail.value = data.detail
    selectedSessionId.value = data.detail.session.id
    expandedTools.value = new Set()
    localEntries.value = []
    liveActivity.value = ''
    liveAssistantText.value = ''
    liveAssistantBlocks.value = []
    expandProject(project.cwd)
    stickToBottom.value = true
    hasNewOutput.value = false
    await scrollToLatest()
    if (terminalOpen.value) await connectTerminal()
  } catch (error) {
    sessionError.value = error.message
  } finally {
    creatingSessionCwd.value = ''
  }
}

async function selectSession(session) {
  selectedSessionId.value = session.id
  sessionLoading.value = true
  sessionError.value = ''
  promptError.value = ''

  try {
    const data = await loadSessionDetail(session.id)
    await activateSession(session)
    sessionDetail.value = data
    expandedTools.value = new Set()
    localEntries.value = []
    liveActivity.value = ''
    liveAssistantText.value = ''
    liveAssistantBlocks.value = []
    expandProject(session.cwd)
    stickToBottom.value = true
    hasNewOutput.value = false
  } catch (error) {
    sessionError.value = error.message
  } finally {
    sessionLoading.value = false
    await scrollToLatest()
    if (terminalOpen.value && !sessionError.value) await connectTerminal()
  }
}

async function loadSessionDetail(id) {
  return fetchSessionDetail(id)
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

function isToolExpanded(entry) {
  return expandedTools.value.has(entry.id)
}

function toggleTool(entry) {
  const next = new Set(expandedTools.value)
  if (next.has(entry.id)) next.delete(entry.id)
  else next.add(entry.id)
  expandedTools.value = next
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

async function toggleTerminal() {
  if (terminalOpen.value) {
    closeTerminalPanel()
    return
  }

  terminalOpen.value = true
  await connectTerminal()
}

function closeTerminalPanel() {
  terminalRunId += 1
  terminalOpen.value = false
  terminalStatus.value = 'closed'
  terminalInputDisposable?.dispose()
  terminalInputDisposable = undefined
  terminalSocket?.close()
  terminalSocket = undefined
  terminalInstance?.dispose()
  terminalInstance = undefined
  window.removeEventListener('resize', resizeTerminal)
}

async function connectTerminal() {
  terminalStatus.value = 'connecting'
  await nextTick()
  if (!terminalEl.value) return

  const runId = terminalRunId + 1
  terminalRunId = runId
  terminalInputDisposable?.dispose()
  terminalSocket?.close()
  terminalInstance?.dispose()
  window.removeEventListener('resize', resizeTerminal)

  terminalInstance = new Terminal({
    cursorBlink: true,
    fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.25,
    theme: {
      background: '#0b0c0f',
      foreground: '#d8dbe3',
      cursor: '#cfc5ff',
      selectionBackground: '#3d3650',
    },
  })
  const term = terminalInstance
  term.open(terminalEl.value)
  resizeTerminal()

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/api/pi/terminal`,
  )
  terminalSocket = socket

  terminalInputDisposable = term.onData((data) => {
    if (socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'input', data }))
  })

  socket.addEventListener('open', () => {
    if (runId !== terminalRunId) return
    terminalStatus.value = 'connected'
    resizeTerminal()
  })

  socket.addEventListener('message', (event) => {
    if (runId !== terminalRunId) return
    let payload
    try {
      payload = JSON.parse(event.data)
    } catch {
      return
    }
    if (payload.type === 'ready') {
      terminalCwd.value = payload.cwd
      terminalStatus.value = 'connected'
    }
    if (payload.type === 'data') term.write(payload.data)
    if (payload.type === 'error') {
      terminalStatus.value = 'error'
      term.write(`\r\n${payload.message}\r\n`)
    }
    if (payload.type === 'exit') terminalStatus.value = 'exited'
  })

  socket.addEventListener('close', () => {
    if (runId !== terminalRunId) return
    if (terminalStatus.value === 'connected') terminalStatus.value = 'closed'
  })

  window.addEventListener('resize', resizeTerminal)
}

function resizeTerminal() {
  if (!terminalInstance || !terminalEl.value) return
  const cols = Math.max(40, Math.floor(terminalEl.value.clientWidth / 7.4))
  const rows = Math.max(8, Math.floor(terminalEl.value.clientHeight / 15))
  terminalInstance.resize(cols, rows)
  if (terminalSocket?.readyState === WebSocket.OPEN) {
    terminalSocket.send(JSON.stringify({ type: 'resize', cols, rows }))
  }
}

function handleComposerKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submitDraft()
}
</script>

<template>
  <main class="leyline-app">
    <aside class="sidebar">
      <div class="brand-row">
        <div class="brand-mark">⌁</div>
        <div>
          <strong>Leyline</strong>
        </div>
      </div>

      <label class="search-field">
        <span>⌕</span>
        <input v-model="sessionQuery" placeholder="Search" />
        <kbd>⌘K</kbd>
      </label>

      <section class="sidebar-section">
        <div class="section-header">
          <span>Sessions</span>
          <span>↕ ＋</span>
        </div>

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

      <button class="settings-button">⚙ Settings</button>
    </aside>

    <section class="main-pane">
      <header class="topbar">
        <div class="topbar-project">
          <strong>
            {{ initializing ? 'Loading workspace' : projectName(selectedSession?.cwd) }}
          </strong>
          <span>
            {{ initializing ? 'Reading local pi state' : selectedSession?.cwd }}
          </span>
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
        :class="{ 'init-workbench': initializing }"
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
              <strong>
                {{ eventStreamConnected ? 'Runtime events connected' : 'Connecting runtime events' }}
              </strong>
            </div>
            <div class="init-step">
              <span></span>
              <strong>Preparing transcript view</strong>
            </div>
          </div>
        </div>
        <div v-else-if="sessionLoading" class="empty-workbench">
          Loading session…
        </div>
        <div v-else-if="sessionError" class="empty-workbench error-note">
          {{ sessionError }}
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

      <div v-if="!initializing" class="composer-fade"></div>

      <form v-if="!initializing" class="composer" @submit.prevent="submitDraft">
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
  </main>
</template>
