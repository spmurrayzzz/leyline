<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { backendDisplayAddress } from '../lib/backend'
import { sessionTime } from '../lib/format'

const props = defineProps({
  activeBackendConnection: {
    type: Object,
    default: null,
  },
  agentRunning: Boolean,
  backendConnectionBusyId: {
    type: String,
    default: '',
  },
  backendConnectionError: {
    type: String,
    default: '',
  },
  backendConnections: {
    type: Array,
    default: () => [],
  },
  creatingSessionCwd: {
    type: String,
    default: '',
  },
  defaultBackendConnectionId: {
    type: String,
    default: '',
  },
  deletingSessionId: {
    type: String,
    default: '',
  },
  deletingProjectCwd: {
    type: String,
    default: '',
  },
  navigator: {
    type: String,
    default: '',
  },
  newSessionCwd: {
    type: String,
    default: '',
  },
  reloadingSession: Boolean,
  runtimeActivitySessions: {
    type: Array,
    default: () => [],
  },
  renameDraft: {
    type: String,
    default: '',
  },
  renamingSessionId: {
    type: String,
    default: '',
  },
  renamingSessionSavingId: {
    type: String,
    default: '',
  },
  renamingSessionSource: {
    type: String,
    default: '',
  },
  selectedSession: {
    type: Object,
    default: null,
  },
  selectedSessionId: {
    type: String,
    default: '',
  },
  sessionStatus: {
    type: Function,
    default: () => ({ label: '', tone: '' }),
  },
  sessionTitle: {
    type: Function,
    required: true,
  },
  sessionsError: {
    type: String,
    default: '',
  },
  sessionsHydrated: Boolean,
  sessionsHydrating: Boolean,
  sessionsHydrationError: {
    type: String,
    default: '',
  },
  sessionsLoading: Boolean,
  visibleProjects: {
    type: Array,
    default: () => [],
  },
})

const emit = defineEmits([
  'begin-rename-session',
  'cancel-rename-session',
  'commit-rename-session',
  'create-session',
  'open-project-browser',
  'open-project-detail',
  'open-settings',
  'reload-session',
  'request-delete-project',
  'request-delete-session',
  'retry-sessions',
  'select-backend',
  'select-project',
  'select-session',
  'update:navigator',
  'update:renameDraft',
])

const backendMenu = ref(null)
const backendMenuOpen = ref(false)
const projectControl = ref(null)
const navigatorSearch = ref(null)
const navigatorQuery = ref('')
const sessionQuery = ref('')
const navigationProjectCwd = ref('')
const projectOrder = ref([])
const sessionScroll = ref(null)
const sessionScrollTop = ref(0)
const sessionViewportHeight = ref(520)
const lastSessionByProject = new Map()
const SESSION_ROW_HEIGHT = 52
const SESSION_OVERSCAN = 4
let navigatorOpener = null
let sessionResizeObserver

watch(
  () => props.visibleProjects,
  (projects) => {
    const visibleCwds = new Set(projects.map((project) => project.cwd))
    const existing = projectOrder.value.filter((cwd) => visibleCwds.has(cwd))
    const existingCwds = new Set(existing)
    const added = projects
      .map((project) => project.cwd)
      .filter((cwd) => !existingCwds.has(cwd))
    const next = [...added, ...existing]
    if (next.length !== projectOrder.value.length
      || next.some((cwd, index) => cwd !== projectOrder.value[index])) {
      projectOrder.value = next
    }

    if (!visibleCwds.has(navigationProjectCwd.value)) {
      navigationProjectCwd.value = preferredProjectCwd()
        || projects[0]?.cwd
        || ''
    }
  },
  { immediate: true },
)

watch(
  () => [
    props.selectedSession?.id || '',
    props.selectedSession?.cwd || '',
    props.newSessionCwd,
  ],
  ([sessionId, sessionCwd, newSessionCwd]) => {
    if (sessionId && sessionCwd) {
      lastSessionByProject.set(sessionCwd, sessionId)
      navigationProjectCwd.value = sessionCwd
      return
    }
    if (newSessionCwd) navigationProjectCwd.value = newSessionCwd
  },
  { immediate: true },
)

watch(
  () => props.navigator,
  async (navigator, previous) => {
    if (navigator !== previous) navigatorQuery.value = ''
    if (navigator === 'projects'
      || navigator === 'quick'
      || navigator === 'activity') {
      await nextTick()
      navigatorSearch.value?.focus()
      return
    }
    if (!navigator && previous && navigatorOpener?.isConnected) {
      await nextTick()
      navigatorOpener.focus()
    }
  },
)

const orderedProjects = computed(() => {
  const projects = new Map(
    props.visibleProjects.map((project) => [project.cwd, project]),
  )
  return projectOrder.value
    .map((cwd) => projects.get(cwd))
    .filter(Boolean)
})

const currentProject = computed(() => {
  return orderedProjects.value.find((project) => {
    return project.cwd === navigationProjectCwd.value
  }) || orderedProjects.value[0] || null
})

const currentProjectSessions = computed(() => {
  const project = currentProject.value
  if (!project) return []
  const projectSessions = [...project.sessions]
  const selected = props.selectedSession
  if (selected?.cwd === project.cwd
    && !projectSessions.some((session) => session.id === selected.id)) {
    projectSessions.unshift(selected)
  }
  return projectSessions
})

const matchingProjectSessions = computed(() => {
  const query = sessionQuery.value.trim()
  if (!query) return currentProjectSessions.value
  return currentProjectSessions.value
    .map((session) => ({
      session,
      score: navigationScore([
        props.sessionTitle(session),
        session.id,
      ], query),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      return b.score - a.score || sessionTimestamp(b.session)
        - sessionTimestamp(a.session)
    })
    .map((item) => item.session)
})

const virtualSessionWindow = computed(() => {
  const total = matchingProjectSessions.value.length
  const visible = Math.ceil(
    sessionViewportHeight.value / SESSION_ROW_HEIGHT,
  ) + SESSION_OVERSCAN * 2
  const start = Math.max(
    0,
    Math.floor(sessionScrollTop.value / SESSION_ROW_HEIGHT) - SESSION_OVERSCAN,
  )
  const end = Math.min(total, start + visible)
  return {
    sessions: matchingProjectSessions.value.slice(start, end),
    start,
    top: start * SESSION_ROW_HEIGHT,
    bottom: (total - end) * SESSION_ROW_HEIGHT,
  }
})

const navigatorProjects = computed(() => {
  const query = navigatorQuery.value.trim()
  if (!query) {
    return props.navigator === 'quick'
      ? orderedProjects.value.slice(0, 4)
      : orderedProjects.value
  }
  return orderedProjects.value
    .map((project) => ({
      project,
      score: navigationScore([project.name, project.cwd], query),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.project)
})

const quickDefaultSessions = computed(() => {
  if (props.navigator !== 'quick' || navigatorQuery.value.trim()) return []
  const activeIds = new Set(
    props.runtimeActivitySessions.map((item) => item.session.id),
  )
  const recent = orderedProjects.value
    .flatMap((project) => project.sessions.map((session) => ({
      project,
      session,
    })))
    .filter((item) => !activeIds.has(item.session.id))
    .sort((a, b) => sessionTimestamp(b.session)
      - sessionTimestamp(a.session))
  return [...props.runtimeActivitySessions, ...recent].slice(0, 6)
})

const navigatorSessions = computed(() => {
  const query = navigatorQuery.value.trim()
  if (!query) return quickDefaultSessions.value
  const termCount = query.split(/\s+/).filter(Boolean).length
  return orderedProjects.value
    .flatMap((project) => project.sessions.map((session) => {
      const directScore = navigationScore([
        props.sessionTitle(session),
        session.id,
      ], query)
      const contextualScore = termCount > 1
        ? navigationScore([
          props.sessionTitle(session),
          session.id,
          project.name,
          project.cwd,
        ], query)
        : 0
      return {
        project,
        session,
        score: directScore || contextualScore,
      }
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      return b.score - a.score || sessionTimestamp(b.session)
        - sessionTimestamp(a.session)
    })
    .slice(0, 12)
})

const activitySessions = computed(() => {
  const currentCwd = currentProject.value?.cwd || ''
  const query = navigatorQuery.value.trim()
  return props.runtimeActivitySessions
    .filter((item) => item.project.cwd !== currentCwd)
    .filter((item) => {
      if (!query) return true
      return navigationScore([
        props.sessionTitle(item.session),
        item.project.name,
        item.project.cwd,
      ], query) > 0
    })
})

const attentionSessions = computed(() => {
  return activitySessions.value.filter((item) => {
    return item.status.tone === 'error' || item.status.tone === 'unread'
  })
})

const workingSessions = computed(() => {
  return activitySessions.value.filter((item) => {
    return item.status.tone === 'running'
      || item.status.tone === 'compacting'
  })
})

const queuedSessions = computed(() => {
  return activitySessions.value.filter((item) => {
    return item.status.tone === 'queued'
  })
})

const activitySummary = computed(() => {
  const counts = {
    running: 0,
    compacting: 0,
    unread: 0,
    error: 0,
    queued: 0,
  }
  for (const item of activitySessions.value) {
    if (Object.hasOwn(counts, item.status.tone)) counts[item.status.tone] += 1
  }
  const parts = [
    countLabel(counts.running, 'running'),
    countLabel(counts.compacting, 'compacting'),
    countLabel(counts.unread, 'unread'),
    countLabel(counts.error, 'error'),
    countLabel(counts.queued, 'queued'),
  ].filter(Boolean)
  return parts.join(' · ') || 'No activity elsewhere'
})

const projectSessionCount = computed(() => {
  const count = currentProjectSessions.value.length
  if (!props.sessionsHydrated && !count) return '…'
  return count
})

const navigatorTitle = computed(() => {
  if (props.navigator === 'quick') return 'Go to'
  if (props.navigator === 'activity') return 'Activity across projects'
  return 'Projects'
})

const navigatorSubtitle = computed(() => {
  if (props.navigator === 'quick') return 'Sessions and projects'
  if (props.navigator === 'activity') {
    return `${activitySessions.value.length} active outside this project`
  }
  const count = orderedProjects.value.length
  return `${count} ${count === 1 ? 'project' : 'projects'}`
})

watch(
  () => [currentProject.value?.cwd || '', sessionQuery.value],
  async ([cwd], [previousCwd] = []) => {
    if (cwd !== previousCwd) sessionQuery.value = ''
    sessionScrollTop.value = 0
    await nextTick()
    if (sessionScroll.value) sessionScroll.value.scrollTop = 0
    updateSessionViewport()
  },
)

watch(
  () => [
    props.selectedSessionId,
    currentProject.value?.cwd || '',
    matchingProjectSessions.value.length,
  ],
  async () => {
    await nextTick()
    scrollSelectedSessionIntoView()
  },
)

watch(sessionScroll, (element, previous) => {
  if (previous) sessionResizeObserver?.unobserve(previous)
  if (element) sessionResizeObserver?.observe(element)
  updateSessionViewport()
})

onMounted(() => {
  document.addEventListener('click', closeMenusOnOutsideClick)
  sessionResizeObserver = new ResizeObserver(updateSessionViewport)
  if (sessionScroll.value) sessionResizeObserver.observe(sessionScroll.value)
  updateSessionViewport()
})

onUnmounted(() => {
  document.removeEventListener('click', closeMenusOnOutsideClick)
  sessionResizeObserver?.disconnect()
})

function preferredProjectCwd() {
  return props.selectedSession?.cwd || props.newSessionCwd || ''
}

function updateSessionViewport() {
  if (!sessionScroll.value) return
  sessionViewportHeight.value = sessionScroll.value.clientHeight
}

function updateSessionScroll(event) {
  sessionScrollTop.value = event.currentTarget.scrollTop
}

function scrollSelectedSessionIntoView() {
  const index = matchingProjectSessions.value.findIndex((session) => {
    return session.id === props.selectedSessionId
  })
  scrollSessionIntoView(index)
}

function scrollSessionIntoView(index) {
  const element = sessionScroll.value
  if (!element || index < 0) return
  const top = index * SESSION_ROW_HEIGHT
  const bottom = top + SESSION_ROW_HEIGHT
  if (top < element.scrollTop) element.scrollTop = top
  else if (bottom > element.scrollTop + element.clientHeight) {
    element.scrollTop = bottom - element.clientHeight
  }
  sessionScrollTop.value = element.scrollTop
}

async function focusSession(index) {
  const last = matchingProjectSessions.value.length - 1
  const target = Math.max(0, Math.min(index, last))
  scrollSessionIntoView(target)
  await nextTick()
  sessionScroll.value?.querySelector(
    `[aria-posinset="${target + 1}"]`,
  )?.focus()
}

function closeMenusOnOutsideClick(event) {
  if (!backendMenu.value?.contains(event.target)) backendMenuOpen.value = false
  if (props.navigator === 'actions'
    && !projectControl.value?.contains(event.target)) {
    closeNavigator()
  }
}

function openNavigator(navigator, event) {
  navigatorOpener = event?.currentTarget || null
  navigatorQuery.value = ''
  backendMenuOpen.value = false
  emit('update:navigator', navigator)
}

function closeNavigator() {
  emit('update:navigator', '')
}

function selectBackend(connection) {
  backendMenuOpen.value = false
  emit('select-backend', connection)
}

function openBackendSettings() {
  backendMenuOpen.value = false
  closeNavigator()
  emit('open-settings')
}

function selectProject(project) {
  const lastSessionId = lastSessionByProject.get(project.cwd)
  const target = project.sessions.find((session) => {
    return session.id === lastSessionId
  }) || project.sessions[0]
  closeNavigator()
  if (target?.id === props.selectedSessionId) return
  if (target) emit('select-session', target)
  else emit('select-project', project)
}

function selectNavigatorSession(session) {
  closeNavigator()
  emit('select-session', session)
}

function createCurrentProjectSession() {
  const project = currentProject.value
  if (!project) return
  closeNavigator()
  emit('create-session', project)
}

function openProjectBrowser() {
  closeNavigator()
  emit('open-project-browser', currentProject.value?.cwd || '')
}

function openCurrentProjectDetail() {
  const project = currentProject.value
  if (!project?.sessions.length) return
  closeNavigator()
  emit('open-project-detail', project)
}

function requestCurrentProjectDelete() {
  const project = currentProject.value
  if (!project) return
  closeNavigator()
  emit('request-delete-project', project)
}

function isRenaming(session) {
  return props.renamingSessionId === session.id
    && props.renamingSessionSource === 'sidebar'
}

function beginRename(session) {
  emit('begin-rename-session', session, 'sidebar')
}

function sessionMessageLabel(session) {
  const count = Number(session?.messageCount)
  if (!Number.isFinite(count)) return ''
  return `${count} ${count === 1 ? 'message' : 'messages'}`
}

function projectResultMeta(project) {
  const count = project.sessions.length
  const relative = sessionTime(project)
  return [
    `${count} ${count === 1 ? 'session' : 'sessions'}`,
    relative || 'new',
  ].join(' · ')
}

function statusFor(session) {
  return props.sessionStatus(session.id) || { label: '', tone: '' }
}

function countLabel(count, label) {
  return count ? `${count} ${label}` : ''
}

function navigationScore(values, query) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  let total = 0
  for (const term of terms) {
    let best = 0
    for (const value of values) {
      const text = String(value || '').toLowerCase()
      if (text === term) best = Math.max(best, 1000)
      else if (text.startsWith(term)) best = Math.max(best, 800)
      else if (text.includes(` ${term}`)
        || text.includes(`/${term}`)
        || text.includes(`-${term}`)) best = Math.max(best, 650)
      else if (text.includes(term)) best = Math.max(best, 500)
    }
    if (!best) return 0
    total += best
  }
  return total
}

function sessionTimestamp(session) {
  const time = new Date(session?.modified || session?.timestamp || 0).getTime()
  return Number.isNaN(time) ? 0 : time
}

const vFocusSelect = {
  mounted(el) {
    requestAnimationFrame(() => {
      el.focus()
      el.select()
    })
  },
}
</script>

<template>
  <aside class="sidebar project-sidebar">
    <template v-if="sessionsLoading && visibleProjects.length === 0">
      <div
        class="sidebar-project-header sidebar-project-header-skeleton"
        aria-hidden="true"
      >
        <div class="sidebar-project-control">
          <div class="sidebar-project-identity">
            <span class="skeleton-line project-name-skeleton"></span>
            <span class="skeleton-line project-path-skeleton"></span>
          </div>
        </div>
        <div class="skeleton-line session-search-skeleton"></div>
      </div>
      <section class="project-session-section" aria-hidden="true">
        <div class="project-session-heading">
          <span>Sessions</span>
          <span>…</span>
        </div>
        <div class="project-session-scroll">
          <div class="project-session-skeleton">
            <div v-for="index in 7" :key="index" class="session-skeleton-row">
              <div class="skeleton-line"></div>
              <div class="skeleton-line short"></div>
            </div>
          </div>
        </div>
      </section>
      <div
        class="sidebar-project-shortcuts sidebar-project-shortcuts-skeleton"
        aria-hidden="true"
      >
        <div v-for="index in 3" :key="index" class="sidebar-project-shortcut">
          <span class="skeleton-line shortcut-icon-skeleton"></span>
          <span>
            <span class="skeleton-line shortcut-title-skeleton"></span>
            <span class="skeleton-line shortcut-detail-skeleton"></span>
          </span>
        </div>
      </div>
    </template>

    <template v-else-if="currentProject">
      <div class="sidebar-project-header">
        <div ref="projectControl" class="sidebar-project-control">
          <div class="sidebar-project-identity">
            <strong>{{ currentProject.name }}</strong>
            <small :title="currentProject.cwd">{{ currentProject.cwd }}</small>
          </div>
          <button
            class="sidebar-project-more"
            type="button"
            title="Project actions"
            aria-label="Project actions"
            :aria-expanded="navigator === 'actions'"
            @click="openNavigator(
              navigator === 'actions' ? '' : 'actions',
              $event,
            )"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="3.5" cy="8" r="1"></circle>
              <circle cx="8" cy="8" r="1"></circle>
              <circle cx="12.5" cy="8" r="1"></circle>
            </svg>
          </button>
          <div
            v-if="navigator === 'actions'"
            class="sidebar-project-action-menu"
          >
            <button
              type="button"
              :disabled="currentProject.sessions.length === 0"
              @click="openCurrentProjectDetail"
            >Project details</button>
            <button
              class="destructive"
              type="button"
              :disabled="deletingProjectCwd === currentProject.cwd"
              @click="requestCurrentProjectDelete"
            >{{ deletingProjectCwd === currentProject.cwd ? 'Trashing…' : 'Trash project' }}</button>
          </div>
        </div>
        <div class="search-field sidebar-session-search">
          <svg
            class="sidebar-session-search-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.25"></circle>
            <path d="M10.2 10.2l3.3 3.3"></path>
          </svg>
          <input
            v-model="sessionQuery"
            type="text"
            placeholder="Search sessions"
            aria-label="Search sessions in this project"
          />
          <button
            v-if="sessionQuery"
            type="button"
            aria-label="Clear session search"
            @click="sessionQuery = ''"
          >×</button>
        </div>
      </div>

      <section class="project-session-section">
        <div class="project-session-heading">
          <span>Sessions</span>
          <span>{{ projectSessionCount }}</span>
        </div>
        <div
          ref="sessionScroll"
          class="project-session-scroll"
          @scroll.passive="updateSessionScroll"
        >
          <div
            v-if="!sessionsHydrated
              && !sessionsHydrationError
              && currentProjectSessions.length === 0"
            class="project-session-skeleton"
            aria-hidden="true"
          >
            <div v-for="index in 7" :key="index" class="session-skeleton-row">
              <div class="skeleton-line"></div>
              <div class="skeleton-line short"></div>
            </div>
          </div>
          <div v-else-if="sessionsError" class="sidebar-note error-note">
            {{ sessionsError }}
            <button type="button" @click="emit('retry-sessions')">Retry</button>
          </div>
          <div
            v-else-if="currentProjectSessions.length === 0
              && sessionsHydrationError"
            class="sidebar-note error-note"
          >
            Session history unavailable
            <button type="button" @click="emit('retry-sessions')">Retry</button>
          </div>
          <div
            v-else-if="currentProjectSessions.length === 0"
            class="sidebar-note project-session-empty"
          >
            No sessions in this project
          </div>
          <div
            v-else-if="matchingProjectSessions.length === 0"
            class="sidebar-note project-session-empty"
          >
            No matching sessions
          </div>
          <template v-else>
            <div
              v-if="virtualSessionWindow.top"
              class="project-session-virtual-spacer"
              :style="{ height: `${virtualSessionWindow.top}px` }"
              aria-hidden="true"
            ></div>
            <div
              v-for="(session, index) in virtualSessionWindow.sessions"
              :key="session.path || session.id"
              class="session project-session-row"
              :class="{
                active: session.id === selectedSessionId,
                'is-renaming': isRenaming(session),
              }"
              role="button"
              :aria-posinset="virtualSessionWindow.start + index + 1"
              :aria-setsize="matchingProjectSessions.length"
              :tabindex="isRenaming(session) ? -1 : 0"
              @click="!isRenaming(session) && emit('select-session', session)"
              @keydown.enter="!isRenaming(session)
                && emit('select-session', session)"
              @keydown.space.prevent="!isRenaming(session)
                && emit('select-session', session)"
              @keydown.down.prevent="focusSession(
                virtualSessionWindow.start + index + 1,
              )"
              @keydown.up.prevent="focusSession(
                virtualSessionWindow.start + index - 1,
              )"
            >
              <input
              v-if="isRenaming(session)"
              v-focus-select
              class="session-title-input"
              :value="renameDraft"
              aria-label="Session name"
              @click.stop
              @input="emit('update:renameDraft', $event.target.value)"
              @keydown.space.stop
              @keydown.enter.stop.prevent="emit(
                'commit-rename-session',
                session,
              )"
              @keydown.esc.stop.prevent="emit('cancel-rename-session')"
              @blur="isRenaming(session)
                && emit('commit-rename-session', session)"
            />
            <template v-else>
              <span
                class="session-title"
                @dblclick.stop="beginRename(session)"
              >{{ sessionTitle(session) }}</span>
              <div class="session-meta">
                <span class="session-meta-details">
                  <template v-if="sessionMessageLabel(session)">
                    <span>{{ sessionMessageLabel(session) }}</span>
                    <span class="session-meta-separator" aria-hidden="true">
                      ·
                    </span>
                  </template>
                  <time>{{ sessionTime(session) || 'new' }}</time>
                </span>
                <span
                  v-if="statusFor(session).label"
                  class="session-status"
                  :class="`status-${statusFor(session).tone}`"
                >
                  {{ statusFor(session).label }}
                </span>
              </div>
              <div class="session-actions">
                <button
                  class="session-rename-button"
                  type="button"
                  title="Rename session"
                  aria-label="Rename session"
                  :disabled="renamingSessionSavingId === session.id"
                  @click.stop="beginRename(session)"
                >
                  <span v-if="renamingSessionSavingId === session.id">…</span>
                  <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M10.8 2.8l2.4 2.4"></path>
                    <path d="M4 12l2.1-.4 6.2-6.2-1.7-1.7-6.2 6.2z"></path>
                  </svg>
                </button>
                <button
                  class="session-delete-button"
                  type="button"
                  title="Delete session"
                  aria-label="Delete session"
                  :disabled="deletingSessionId === session.id"
                  @click.stop="emit('request-delete-session', session)"
                >
                  <span v-if="deletingSessionId === session.id">…</span>
                  <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 4.5h9"></path>
                    <path d="M6.5 4.5v-2h3v2"></path>
                    <path d="M5 6.5l.5 6h5l.5-6"></path>
                    <path d="M7 7.5v4"></path>
                    <path d="M9 7.5v4"></path>
                  </svg>
                </button>
              </div>
            </template>
            </div>
            <div
              v-if="virtualSessionWindow.bottom"
              class="project-session-virtual-spacer"
              :style="{ height: `${virtualSessionWindow.bottom}px` }"
              aria-hidden="true"
            ></div>
          </template>
          <div
            v-if="currentProjectSessions.length > 0
              && sessionsHydrationError"
            class="sidebar-note error-note session-hydration-error"
          >
            Session history unavailable
            <button type="button" @click="emit('retry-sessions')">Retry</button>
          </div>
        </div>
      </section>

      <div class="sidebar-project-shortcuts">
        <button
          class="sidebar-project-shortcut"
          type="button"
          @click="openNavigator('activity', $event)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M1.5 8h3l1.8-4 3.4 8 1.8-4h3"></path>
          </svg>
          <span>
            <strong>{{ activitySummary }}</strong>
            <small>Activity across other projects</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        <button
          class="sidebar-project-shortcut"
          type="button"
          aria-keyshortcuts="Meta+K Control+K"
          @click="openNavigator('projects', $event)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2.2 5.2c0-1 .8-1.8 1.8-1.8h2l1.6 1.8h4.6c1 0 1.8.8 1.8 1.8v4.6c0 1-.8 1.8-1.8 1.8H4c-1 0-1.8-.8-1.8-1.8z"
            ></path>
          </svg>
          <span>
            <strong>Change project</strong>
            <small>Browse all {{ orderedProjects.length }} projects</small>
          </span>
          <kbd class="sidebar-project-shortcut-key" aria-hidden="true">⌘K</kbd>
        </button>
        <button
          class="sidebar-project-shortcut"
          type="button"
          :disabled="creatingSessionCwd === currentProject.cwd"
          @click="createCurrentProjectSession"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10"></path>
          </svg>
          <span>
            <strong>{{ creatingSessionCwd === currentProject.cwd ? 'Creating…' : 'New session here' }}</strong>
            <small>{{ currentProject.name }} · {{ activeBackendConnection?.name || 'Native backend' }}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </template>

    <div
      v-else
      class="sidebar-note project-sidebar-empty"
      :class="{ 'error-note': !!sessionsError }"
    >
      {{ sessionsError || 'No projects found' }}
      <button v-if="sessionsError" type="button" @click="emit('retry-sessions')">
        Retry
      </button>
      <button v-else type="button" @click="openProjectBrowser">
        Open a folder
      </button>
    </div>

    <div class="sidebar-actions">
      <div ref="backendMenu" class="backend-switcher">
        <button
          class="backend-switcher-trigger"
          type="button"
          :title="activeBackendConnection?.url"
          :aria-expanded="backendMenuOpen"
          @click="backendMenuOpen = !backendMenuOpen"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="4" rx="1"></rect>
            <rect x="2.5" y="9.5" width="11" height="4" rx="1"></rect>
            <path d="M5 4.5h.01M5 11.5h.01"></path>
          </svg>
          <span>
            <strong>{{ activeBackendConnection?.name || 'Native backend' }}</strong>
            <small>{{ backendDisplayAddress(activeBackendConnection) }}</small>
          </span>
          <svg class="backend-switcher-caret" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 6.5l3 3 3-3"></path>
          </svg>
        </button>

        <div v-if="backendMenuOpen" class="backend-switcher-menu">
          <span class="backend-switcher-heading">Backends</span>
          <button
            v-for="connection in backendConnections"
            :key="connection.id"
            type="button"
            :class="{ active: connection.id === activeBackendConnection?.id }"
            :disabled="!!backendConnectionBusyId"
            @click="selectBackend(connection)"
          >
            <span>
              <strong>{{ connection.name }}</strong>
              <small>
                {{ backendDisplayAddress(connection) }}
                <template v-if="connection.id === defaultBackendConnectionId"> · default</template>
              </small>
            </span>
            <span v-if="connection.id === activeBackendConnection?.id">✓</span>
            <span v-else-if="backendConnectionBusyId === connection.id">…</span>
          </button>
          <span v-if="backendConnectionError" class="backend-switcher-error">
            {{ backendConnectionError }}
          </span>
          <button type="button" class="backend-switcher-manage" @click="openBackendSettings">
            Manage backends
          </button>
        </div>
      </div>

      <div class="sidebar-action-buttons">
        <button
          class="settings-button"
          type="button"
          title="Reload runtime"
          aria-label="Reload runtime"
          :disabled="!selectedSession || agentRunning || reloadingSession"
          @click="emit('reload-session')"
        >{{ reloadingSession ? '…' : '↻' }}</button>
        <button
          class="settings-button"
          type="button"
          title="Settings"
          aria-label="Open settings"
          @click="emit('open-settings')"
        >⚙</button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="navigator === 'projects'
          || navigator === 'quick'
          || navigator === 'activity'"
        class="sidebar-navigator-backdrop"
        @mousedown.self="closeNavigator"
      >
        <section
          class="sidebar-navigator-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sidebar-navigator-title"
        >
          <header class="sidebar-navigator-header">
            <div>
              <strong id="sidebar-navigator-title">{{ navigatorTitle }}</strong>
              <span>{{ navigatorSubtitle }}</span>
            </div>
            <button
              type="button"
              aria-label="Close"
              @click="closeNavigator"
            >×</button>
          </header>
          <label class="sidebar-navigator-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref="navigatorSearch"
              v-model="navigatorQuery"
              :placeholder="navigator === 'activity'
                ? 'Search active sessions'
                : navigator === 'quick'
                  ? 'Search sessions or projects'
                  : 'Search projects, paths, or sessions'"
            />
            <kbd>esc</kbd>
          </label>

          <div class="sidebar-navigator-results">
            <template v-if="navigator === 'projects' || navigator === 'quick'">
              <section v-if="navigatorProjects.length" class="navigator-result-section">
                <div class="navigator-result-heading">
                  <span>Projects</span>
                  <span>{{ navigatorProjects.length }}</span>
                </div>
                <button
                  v-for="project in navigatorProjects"
                  :key="project.cwd"
                  class="sidebar-navigator-result"
                  :class="{ selected: project.cwd === currentProject.cwd }"
                  type="button"
                  @click="selectProject(project)"
                >
                  <span class="navigator-result-icon">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path
                        d="M2.2 5.2c0-1 .8-1.8 1.8-1.8h2l1.6 1.8h4.6c1 0 1.8.8 1.8 1.8v4.6c0 1-.8 1.8-1.8 1.8H4c-1 0-1.8-.8-1.8-1.8z"
                      ></path>
                    </svg>
                  </span>
                  <span>
                    <strong>{{ project.name }}</strong>
                    <small>{{ project.cwd }}</small>
                  </span>
                  <time>{{ projectResultMeta(project) }}</time>
                </button>
              </section>

              <section v-if="navigatorSessions.length" class="navigator-result-section">
                <div class="navigator-result-heading">
                  <span>{{ navigator === 'quick' && !navigatorQuery.trim()
                    ? 'Current and recent'
                    : 'Sessions' }}</span>
                  <span>{{ navigatorSessions.length }}</span>
                </div>
                <button
                  v-for="item in navigatorSessions"
                  :key="item.session.path || item.session.id"
                  class="sidebar-navigator-result"
                  type="button"
                  @click="selectNavigatorSession(item.session)"
                >
                  <span class="navigator-result-icon">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 3.5h10v7H7l-3.5 2v-2H3z"></path>
                    </svg>
                  </span>
                  <span>
                    <strong>{{ sessionTitle(item.session) }}</strong>
                    <small>{{ item.project.name }} · {{ item.project.cwd }}</small>
                  </span>
                  <time>{{ sessionTime(item.session) || 'new' }}</time>
                </button>
              </section>

              <div
                v-if="navigatorSessions.length === 0
                  && navigatorProjects.length === 0"
                class="sidebar-navigator-empty"
              >No matching projects or sessions</div>

              <button
                v-if="navigator === 'projects'"
                class="sidebar-navigator-folder"
                type="button"
                @click="openProjectBrowser"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3v10M3 8h10"></path>
                </svg>
                Open another folder
              </button>
            </template>

            <template v-else>
              <section v-if="attentionSessions.length" class="navigator-result-section">
                <div class="navigator-result-heading">
                  <span>Needs attention</span>
                  <span>{{ attentionSessions.length }}</span>
                </div>
                <button
                  v-for="item in attentionSessions"
                  :key="item.session.path || item.session.id"
                  class="sidebar-navigator-result"
                  type="button"
                  @click="selectNavigatorSession(item.session)"
                >
                  <span class="navigator-result-icon">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 3.5h10v7H7l-3.5 2v-2H3z"></path>
                    </svg>
                  </span>
                  <span>
                    <strong>{{ sessionTitle(item.session) }}</strong>
                    <small>{{ item.project.name }} · {{ item.project.cwd }}</small>
                  </span>
                  <span
                    class="navigator-result-status"
                    :class="`status-${item.status.tone}`"
                  >{{ item.status.label }}</span>
                </button>
              </section>

              <section v-if="workingSessions.length" class="navigator-result-section">
                <div class="navigator-result-heading">
                  <span>Running</span>
                  <span>{{ workingSessions.length }}</span>
                </div>
                <button
                  v-for="item in workingSessions"
                  :key="item.session.path || item.session.id"
                  class="sidebar-navigator-result"
                  type="button"
                  @click="selectNavigatorSession(item.session)"
                >
                  <span class="navigator-result-icon">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 3.5h10v7H7l-3.5 2v-2H3z"></path>
                    </svg>
                  </span>
                  <span>
                    <strong>{{ sessionTitle(item.session) }}</strong>
                    <small>{{ item.project.name }} · {{ item.project.cwd }}</small>
                  </span>
                  <span
                    class="navigator-result-status"
                    :class="`status-${item.status.tone}`"
                  >{{ item.status.label }}</span>
                </button>
              </section>

              <section v-if="queuedSessions.length" class="navigator-result-section">
                <div class="navigator-result-heading">
                  <span>Queued</span>
                  <span>{{ queuedSessions.length }}</span>
                </div>
                <button
                  v-for="item in queuedSessions"
                  :key="item.session.path || item.session.id"
                  class="sidebar-navigator-result"
                  type="button"
                  @click="selectNavigatorSession(item.session)"
                >
                  <span class="navigator-result-icon">
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 3.5h10v7H7l-3.5 2v-2H3z"></path>
                    </svg>
                  </span>
                  <span>
                    <strong>{{ sessionTitle(item.session) }}</strong>
                    <small>{{ item.project.name }} · {{ item.project.cwd }}</small>
                  </span>
                  <span class="navigator-result-status status-queued">
                    {{ item.status.label }}
                  </span>
                </button>
              </section>

              <div
                v-if="activitySessions.length === 0"
                class="sidebar-navigator-empty"
              >No activity in other projects</div>
            </template>
          </div>
        </section>
      </div>
    </Teleport>
  </aside>
</template>
