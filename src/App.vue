<script setup>
import MarkdownIt from 'markdown-it'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

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
let eventSource
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

onMounted(async () => {
  openEventStream()
  await loadSessions()
})

onUnmounted(() => {
  eventSource?.close()
  clearTimeout(refreshTimer)
  cancelAnimationFrame(scrollFrame)
})

function openEventStream() {
  eventSource?.close()
  eventSource = new EventSource('/api/pi/events')

  eventSource.addEventListener('active_session', (event) => {
    activeRuntimeSession.value = JSON.parse(event.data)
  })

  eventSource.addEventListener('runtime_event', (event) => {
    const data = JSON.parse(event.data)
    runtimeEvents.value = [...runtimeEvents.value.slice(-99), data]
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
  }

  eventSource.onerror = () => {
    eventStreamConnected.value = false
    eventStreamError.value = 'Runtime event stream disconnected'
    console.warn('pi event stream disconnected')
  }
}

async function loadSessions({ selectFirst = true } = {}) {
  sessionsLoading.value = true
  sessionsError.value = ''

  try {
    const response = await fetch('/api/pi/sessions')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to load sessions')
    sessions.value = data.sessions || []
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
    const response = await fetch('/api/pi/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: project.cwd }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to create session')

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
  }
}

async function loadSessionDetail(id) {
  const response = await fetch(`/api/pi/sessions/${id}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to load session')
  return data
}

function scheduleSessionRefresh(activeSessionId, event) {
  if (activeSessionId !== selectedSessionId.value) return
  if (event?.type === 'message_update') return

  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    const wasStuck = stickToBottom.value

    try {
      sessionDetail.value = await loadSessionDetail(selectedSessionId.value)
      await loadSessions({ selectFirst: false })
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

function textFromContent(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  return textFromBlocks(messageBlocks(content))
}

function messageBlocks(content) {
  if (!Array.isArray(content)) return []

  return content
    .map((block) => {
      if (block.type === 'text') return { type: 'text', text: block.text }
      if (block.type === 'thinking') {
        return { type: 'thinking', text: block.thinking }
      }
      return undefined
    })
    .filter((block) => block?.text)
}

function textFromBlocks(blocks) {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function toolLabel(toolName) {
  if (!toolName) return 'tool'
  if (toolName === 'bash') return 'bash'
  return toolName
}

function toolTarget(args) {
  if (!args) return ''
  const value = args.command || args.path
  if (!value) return ''
  return ` · ${String(value).slice(0, 80)}`
}

async function activateSession(session) {
  const response = await fetch('/api/pi/active-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: session.id }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Failed to activate session')
}

function sessionTitle(session) {
  return session?.name || session?.firstMessage || 'Untitled session'
}

function sessionScore(session, query) {
  return fuzzyScore(sessionTitle(session), query)
}

function fuzzyScore(value, query) {
  const text = value.toLowerCase()
  const terms = query.split(/\s+/).filter(Boolean)
  let total = 0

  for (const term of terms) {
    const score = fuzzyTermScore(text, term)
    if (score === 0) return 0
    total += score
  }

  return total
}

function fuzzyTermScore(text, term) {
  let position = -1
  let score = 0
  let streak = 0

  for (const char of term) {
    const next = text.indexOf(char, position + 1)
    if (next === -1) return 0

    streak = next === position + 1 ? streak + 1 : 1
    score += 1 + streak * 2
    if (next === 0 || /[\/\-_\s]/.test(text[next - 1])) score += 4
    position = next
  }

  if (text.includes(term)) score += 20
  if (text.startsWith(term)) score += 30
  return score
}

function highlightedText(value) {
  const query = sessionQuery.value.trim().toLowerCase()
  if (!query) return escapeHtml(value)

  const indexes = fuzzyMatchIndexes(value, query)
  if (!indexes.size) return escapeHtml(value)

  return Array.from(value)
    .map((char, index) => ({ char, matched: indexes.has(index) }))
    .reduce((html, item, index, items) => {
      const previous = items[index - 1]
      const next = items[index + 1]
      const open = item.matched && !previous?.matched
      const close = item.matched && !next?.matched
      return `${html}${open ? '<mark>' : ''}${escapeHtml(item.char)}${close ? '</mark>' : ''}`
    }, '')
}

function fuzzyMatchIndexes(value, query) {
  const text = value.toLowerCase()
  const indexes = new Set()
  let start = 0

  for (const term of query.split(/\s+/).filter(Boolean)) {
    let position = start - 1
    const termIndexes = []

    for (const char of term) {
      const next = text.indexOf(char, position + 1)
      if (next === -1) return new Set()
      termIndexes.push(next)
      position = next
    }

    for (const index of termIndexes) indexes.add(index)
    start = position + 1
  }

  return indexes
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
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

function projectName(cwd) {
  if (!cwd) return 'unknown'
  return cwd.split('/').filter(Boolean).at(-1) || cwd
}

function formatDate(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function sessionTime(session) {
  if (!session.timestamp) return ''

  const then = new Date(session.timestamp).getTime()
  const diff = Date.now() - then
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}m`
  if (diff < day) return `${Math.round(diff / hour)}h`
  return `${Math.round(diff / day)}d`
}

function entryClass(entry) {
  return {
    'user-message': entry.role === 'user',
    'assistant-message': entry.role === 'assistant',
    'summary-message': entry.type === 'summary',
  }
}

function messageText(entry) {
  return entry.text || ''
}

function renderedMessage(entry) {
  return markdown.render(messageText(entry))
}

function renderedBlock(block) {
  return markdown.render(block.text || '')
}

function messageBlocksFor(entry) {
  return entry.blocks?.length ? entry.blocks : [{ type: 'text', text: entry.text }]
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

  promptSubmitting.value = true
  promptError.value = ''

  try {
    const response = await fetch('/api/pi/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to submit prompt')
    draft.value = ''
    agentRunning.value = true
    liveActivity.value = 'Thinking…'
  } catch (error) {
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
    const response = await fetch('/api/pi/interrupt', { method: 'POST' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to stop agent')
    agentRunning.value = false
    liveActivity.value = ''
  } catch (error) {
    promptError.value = error.message
    liveActivity.value = ''
  } finally {
    interrupting.value = false
  }
}

function handleComposerKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  submitDraft()
}
</script>

<template>
  <main class="agent-app">
    <aside class="sidebar">
      <div class="brand-row">
        <strong>Agent</strong>
        <span>local</span>
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
          <span>{{ selectedSession.messageCount }} messages</span>
          <span>modified {{ formatDate(selectedSession.modified) }}</span>
        </div>
      </header>

      <div
        ref="workbench"
        class="workbench"
        :class="{ 'init-workbench': initializing }"
        @scroll="handleWorkbenchScroll"
      >
        <div v-if="initializing" class="init-panel">
          <div class="init-kicker">Starting Agent</div>
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
          <div class="message-meta">Agent</div>
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
          <button type="button">✳ Claude Opus 4.5</button>
          <button type="button">High · Normal</button>
          <button type="button">⚒ Build</button>
          <button type="button">▢ Full access</button>
          <button
            class="send-button"
            :class="{ 'stop-button': agentRunning }"
            :type="agentRunning ? 'button' : 'submit'"
            :disabled="agentRunning ? interrupting : promptSubmitting || !draft.trim()"
            :title="agentRunning ? 'Stop agent' : 'Send message'"
            @click="agentRunning && interruptAgent()"
          >
            {{ agentRunning ? '■' : promptSubmitting ? '…' : '↑' }}
          </button>
        </div>
      </form>
    </section>
  </main>
</template>
