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
let eventSource

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
    console.log('pi runtime event', data)
  })

  eventSource.onerror = () => {
    console.warn('pi event stream disconnected')
  }
}

async function loadSessions() {
  try {
    const response = await fetch('/api/pi/sessions')
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to load sessions')
    sessions.value = data.sessions || []
    if (sessions.value[0]) await selectSession(sessions.value[0])
  } catch (error) {
    sessionsError.value = error.message
  } finally {
    sessionsLoading.value = false
  }
}

async function selectSession(session) {
  selectedSessionId.value = session.id
  sessionLoading.value = true
  sessionError.value = ''

  try {
    const response = await fetch(`/api/pi/sessions/${session.id}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Failed to load session')
    await activateSession(session)
    sessionDetail.value = data
    expandedTools.value = new Set()
    localEntries.value = []
    expandProject(session.cwd)
  } catch (error) {
    sessionError.value = error.message
  } finally {
    sessionLoading.value = false
    await scrollToLatest()
  }
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
  if (!entry.text) return ''
  if (entry.text.length <= 1200) return entry.text
  return `${entry.text.slice(0, 1199)}…`
}

function renderedMessage(entry) {
  return markdown.render(messageText(entry))
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

async function scrollToLatest() {
  await nextTick()
  if (!workbench.value) return
  workbench.value.scrollTop = workbench.value.scrollHeight
}

async function submitDraft() {
  const text = draft.value.trim()
  if (!text) return

  localEntries.value.push({
    id: `local-user-${Date.now()}`,
    type: 'message',
    role: 'user',
    label: 'You',
    text,
  })
  localEntries.value.push({
    id: `local-note-${Date.now()}`,
    type: 'summary',
    label: 'Not wired',
    text: 'Prompt submission is local-only for now. No pi session state was changed.',
  })
  draft.value = ''
  await scrollToLatest()
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

        <div v-if="sessionsLoading" class="sidebar-note">Loading…</div>
        <div v-else-if="sessionsError" class="sidebar-note error-note">
          {{ sessionsError }}
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
          <button class="project-title" @click="toggleProject(project)">
            <span>
              {{ isProjectExpanded(project) ? '⌄' : '›' }}
              <span v-html="highlightedText(project.name)"></span>
            </span>
            <time>{{ project.sessions.length }}</time>
          </button>

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
          <strong>{{ projectName(selectedSession?.cwd) }}</strong>
          <span>{{ selectedSession?.cwd }}</span>
        </div>
        <div v-if="selectedSession" class="topbar-meta">
          <span>{{ selectedSession.messageCount }} messages</span>
          <span>modified {{ formatDate(selectedSession.modified) }}</span>
        </div>
      </header>

      <div ref="workbench" class="workbench">
        <div v-if="sessionLoading" class="empty-workbench">Loading session…</div>
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
              <div class="entry-text markdown-body" v-html="renderedMessage(entry)"></div>
            </article>
          </template>
        </template>
      </div>

      <div class="composer-fade"></div>

      <form class="composer" @submit.prevent="submitDraft">
        <textarea
          v-model="draft"
          placeholder="Ask for follow-up changes or attach images"
          @keydown="handleComposerKeydown"
        ></textarea>
        <div class="composer-bar">
          <button type="button">✳ Claude Opus 4.5</button>
          <button type="button">High · Normal</button>
          <button type="button">⚒ Build</button>
          <button type="button">▢ Full access</button>
          <button class="send-button" type="submit">↑</button>
        </div>
      </form>
    </section>
  </main>
</template>
