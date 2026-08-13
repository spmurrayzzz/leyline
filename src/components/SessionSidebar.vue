<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
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
  expandedProject: {
    type: Function,
    required: true,
  },
  highlightedText: {
    type: Function,
    required: true,
  },
  query: {
    type: String,
    default: '',
  },
  reloadingSession: Boolean,
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
  summary: {
    type: Object,
    default: () => ({ label: '' }),
  },
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
  'select-session',
  'toggle-project',
  'update:query',
  'update:renameDraft',
])

const defaultVisibleSessionCount = 5
const expandedSessionProjects = ref(new Set())
const olderProjectsExpanded = ref(false)
const olderProjectsToggle = ref(null)
const backendMenu = ref(null)
const backendMenuOpen = ref(false)
const sidebarProjects = computed(() => {
  if (props.query.trim()) return props.visibleProjects

  const recent = props.visibleProjects.filter((project) => !project.isOlder)
  const older = props.visibleProjects.filter((project) => project.isOlder)
  if (!older.length) return recent

  return [
    ...recent,
    {
      type: 'older-projects-toggle',
      cwd: '__leyline-older-projects__',
      count: older.length,
    },
    ...(olderProjectsExpanded.value ? older : []),
  ]
})

onMounted(() => document.addEventListener('click', closeBackendMenuOnOutsideClick))
onUnmounted(() => document.removeEventListener('click', closeBackendMenuOnOutsideClick))

function closeBackendMenuOnOutsideClick(event) {
  if (!backendMenu.value?.contains(event.target)) backendMenuOpen.value = false
}

function setOlderProjectsToggle(element) {
  olderProjectsToggle.value = element
}

async function toggleOlderProjects() {
  olderProjectsExpanded.value = !olderProjectsExpanded.value
  if (!olderProjectsExpanded.value) return
  await nextTick()
  olderProjectsToggle.value?.scrollIntoView({ block: 'start' })
}

function selectBackend(connection) {
  backendMenuOpen.value = false
  emit('select-backend', connection)
}

function openBackendSettings() {
  backendMenuOpen.value = false
  emit('open-settings')
}

const vFocusSelect = {
  mounted(el) {
    requestAnimationFrame(() => {
      el.focus()
      el.select()
    })
  },
}

function displayedSessions(project) {
  if (props.query.trim() || expandedSessionProjects.value.has(project.cwd)) {
    return project.sessions
  }

  const sessions = project.sessions.slice(0, defaultVisibleSessionCount)
  const selected = project.sessions.find((session) => {
    return session.id === props.selectedSessionId
      && !sessions.some((item) => item.id === session.id)
  })

  return selected ? [...sessions, selected] : sessions
}

function canToggleSessionList(project) {
  return !props.query.trim()
    && project.sessions.length > defaultVisibleSessionCount
}

function sessionListExpanded(project) {
  return expandedSessionProjects.value.has(project.cwd)
}

function toggleSessionList(project) {
  const next = new Set(expandedSessionProjects.value)
  if (next.has(project.cwd)) next.delete(project.cwd)
  else next.add(project.cwd)
  expandedSessionProjects.value = next
}

function sessionListToggleLabel(project) {
  if (sessionListExpanded(project)) return 'Show fewer'
  return `Show all ${project.sessions.length} sessions`
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

const onEnter = (el) => {
  el.style.maxHeight = '0'
  el.offsetHeight
  el.style.maxHeight = `${el.scrollHeight}px`
}

const onAfterEnter = (el) => {
  el.style.maxHeight = ''
}

const onBeforeLeave = (el) => {
  el.style.maxHeight = `${el.scrollHeight}px`
  el.offsetHeight
}

const onLeave = (el) => {
  el.style.maxHeight = '0'
}

const onAfterLeave = (el) => {
  el.style.maxHeight = ''
}
</script>

<template>
  <aside class="sidebar">
    <label class="search-field">
      <span>⌕</span>
      <input
        :value="query"
        placeholder="Search sessions"
        @input="emit('update:query', $event.target.value)"
      />
    </label>

    <section class="sidebar-section">
      <div class="section-header">
        <span>Sessions</span>
        <span v-if="summary.label" class="section-runtime-summary">
          {{ summary.label }}
        </span>
        <button
          type="button"
          class="section-action"
          title="New session"
          @click="emit('open-project-browser')"
        >＋</button>
      </div>

      <div
        v-if="sessionsLoading"
        class="sidebar-skeleton"
        aria-hidden="true"
      >
        <div class="skeleton-project">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
        </div>
        <div class="skeleton-project">
          <div class="skeleton-line skeleton-title"
            style="width: 44%"
          ></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line shorter"></div>
          <div class="skeleton-line short"></div>
        </div>
        <div class="skeleton-project">
          <div class="skeleton-line skeleton-title"
            style="width: 68%"
          ></div>
          <div class="skeleton-line short"></div>
          <div class="skeleton-line"></div>
        </div>
      </div>
      <div v-else-if="sessionsError" class="sidebar-note error-note">
        {{ sessionsError }}
        <button type="button" @click="emit('retry-sessions')">Retry</button>
      </div>
      <div
        v-else-if="visibleProjects.length === 0
          && !sessionsHydrated
          && !sessionsHydrationError"
        class="sidebar-note"
        role="status"
      >
        {{ query.trim() ? 'Searching session history…' : 'Loading sessions…' }}
      </div>
      <div
        v-else-if="visibleProjects.length === 0 && !sessionsHydrationError"
        class="sidebar-note"
        role="status"
      >
        No sessions found
      </div>

      <div
        v-for="project in sidebarProjects"
        v-else
        :key="project.cwd"
        :class="project.type === 'older-projects-toggle'
          ? 'older-projects'
          : 'project'"
      >
        <button
          v-if="project.type === 'older-projects-toggle'"
          :ref="setOlderProjectsToggle"
          class="older-projects-toggle"
          type="button"
          :aria-label="`Older projects, ${project.count}`"
          :aria-expanded="olderProjectsExpanded"
          @click="toggleOlderProjects"
        >
          <svg
            class="project-caret"
            :class="{ expanded: olderProjectsExpanded }"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <path d="M6 4l4 4-4 4"></path>
          </svg>
          <span class="older-projects-label">Older projects</span>
          <span class="older-projects-count">{{ project.count }}</span>
        </button>
        <div v-else class="project-title">
          <button @click="emit('toggle-project', project)">
            <span class="project-label">
              <svg
                class="project-caret"
                :class="{ expanded: expandedProject(project) }"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path d="M6 4l4 4-4 4"></path>
              </svg>
              <svg
                class="project-folder"
                viewBox="0 0 16 16"
                aria-hidden="true"
              >
                <path
                  d="M2.2 5.2c0-1 .8-1.8 1.8-1.8h2l1.6 1.8h4.6c1 0 1.8.8 1.8 1.8v4.6c0 1-.8 1.8-1.8 1.8H4c-1 0-1.8-.8-1.8-1.8z"
                ></path>
              </svg>
              <span v-html="highlightedText(project.name)"></span>
            </span>
          </button>
          <button
            class="project-detail-button"
            type="button"
            title="Project details"
            aria-label="Project details"
            :disabled="project.sessions.length === 0"
            @click="emit('open-project-detail', project)"
          >⋯</button>
          <button
            class="new-session-button"
            type="button"
            :disabled="creatingSessionCwd === project.cwd"
            title="New session"
            @click="emit('create-session', project)"
          >
            +
          </button>
          <button
            class="project-delete-button"
            type="button"
            :disabled="deletingProjectCwd === project.cwd"
            title="Trash project"
            aria-label="Trash project"
            @click="emit('request-delete-project', project)"
          >
            <span v-if="deletingProjectCwd === project.cwd">…</span>
            <svg v-else viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 4.5h9"></path>
              <path d="M6.5 4.5v-2h3v2"></path>
              <path d="M5 6.5l.5 6h5l.5-6"></path>
              <path d="M7 7.5v4"></path>
              <path d="M9 7.5v4"></path>
            </svg>
          </button>
        </div>

        <Transition
          v-if="project.type !== 'older-projects-toggle'"
          name="project-sessions"
          @enter="onEnter"
          @after-enter="onAfterEnter"
          @before-leave="onBeforeLeave"
          @leave="onLeave"
          @after-leave="onAfterLeave"
        >
          <div v-if="expandedProject(project)" class="project-session-list">
            <div
              v-if="sessionsHydrating"
              class="project-session-skeleton"
              aria-hidden="true"
            >
              <div class="session-skeleton-row">
                <div class="skeleton-line"></div>
                <div class="skeleton-line short"></div>
              </div>
              <div class="session-skeleton-row">
                <div class="skeleton-line"></div>
                <div class="skeleton-line short"></div>
              </div>
            </div>
            <div
              v-for="session in displayedSessions(project)"
              :key="session.path || session.id"
              class="session"
              :class="{
                active: session.id === selectedSessionId,
                'is-renaming': isRenaming(session),
              }"
              role="button"
              :tabindex="isRenaming(session) ? -1 : 0"
              @click="!isRenaming(session) && emit('select-session', session)"
              @keydown.enter="!isRenaming(session)
                && emit('select-session', session)"
              @keydown.space.prevent="!isRenaming(session)
                && emit('select-session', session)"
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
                  v-html="highlightedText(sessionTitle(session))"
                ></span>
                <div class="session-meta">
                  <span class="session-meta-details">
                    <span>{{ sessionMessageLabel(session) }}</span>
                    <span class="session-meta-separator" aria-hidden="true">
                      ·
                    </span>
                    <time>{{ sessionTime(session) }}</time>
                  </span>
                  <span
                    v-if="sessionStatus(session.id).label"
                    class="session-status"
                    :class="`status-${sessionStatus(session.id).tone}`"
                  >
                    {{ sessionStatus(session.id).label }}
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
            <button
              v-if="canToggleSessionList(project)"
              class="session-list-toggle"
              type="button"
              :aria-expanded="sessionListExpanded(project)"
              @click="toggleSessionList(project)"
            >{{ sessionListToggleLabel(project) }}</button>
          </div>
        </Transition>
      </div>

      <div
        v-if="!sessionsLoading && sessionsHydrationError"
        class="sidebar-note error-note session-hydration-error"
      >
        Session history unavailable
        <button type="button" @click="emit('retry-sessions')">Retry</button>
      </div>
    </section>

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
  </aside>
</template>
