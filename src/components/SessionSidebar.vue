<script setup>
import { ref } from 'vue'
import { sessionTime } from '../lib/format'

const props = defineProps({
  agentRunning: Boolean,
  creatingSessionCwd: {
    type: String,
    default: '',
  },
  deletingSessionId: {
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
  'hide',
  'navigate-home',
  'open-project-browser',
  'open-project-detail',
  'open-settings',
  'reload-session',
  'request-delete-session',
  'retry-sessions',
  'select-session',
  'toggle-project',
  'update:query',
  'update:renameDraft',
])

const defaultVisibleSessionCount = 5
const expandedSessionProjects = ref(new Set())

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
    <div class="brand-row">
      <button
        class="brand-home"
        type="button"
        aria-label="Go to home"
        @click="emit('navigate-home')"
      >
        <img class="brand-mark" src="/brand-mark.svg" alt="" />
        <span class="brand-name">
          <strong>Leyline</strong>
        </span>
      </button>
      <button
        class="sidebar-collapse-button"
        type="button"
        aria-label="Hide sessions"
        @click="emit('hide')"
      >‹</button>
    </div>

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
          <button @click="emit('toggle-project', project)">
            <span class="project-label">
              <span
                class="project-caret"
                :class="{ expanded: expandedProject(project) }"
              >›</span>
              <span v-html="highlightedText(project.name)"></span>
            </span>
            <time>{{ project.sessions.length }}</time>
          </button>
          <button
            class="project-detail-button"
            type="button"
            title="Project details"
            aria-label="Project details"
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
        </div>

        <Transition
          name="project-sessions"
          @enter="onEnter"
          @after-enter="onAfterEnter"
          @before-leave="onBeforeLeave"
          @leave="onLeave"
          @after-leave="onAfterLeave"
        >
          <div v-if="expandedProject(project)" class="project-session-list">
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
              <span
                v-else
                class="session-title"
                @dblclick.stop="beginRename(session)"
                v-html="highlightedText(sessionTitle(session))"
              ></span>
              <span
                v-if="!isRenaming(session) && sessionStatus(session.id).label"
                class="session-status"
                :class="`status-${sessionStatus(session.id).tone}`"
              >
                {{ sessionStatus(session.id).label }}
              </span>
              <time v-else-if="!isRenaming(session)">
                {{ sessionTime(session) }}
              </time>
              <button
                v-if="!isRenaming(session)"
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
                v-if="!isRenaming(session)"
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
    </section>

    <div class="sidebar-actions">
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
  </aside>
</template>
