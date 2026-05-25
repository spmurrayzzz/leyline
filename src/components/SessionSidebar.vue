<script setup>
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
  'create-session',
  'hide',
  'navigate-home',
  'open-project-browser',
  'open-settings',
  'reload-session',
  'request-delete-session',
  'retry-sessions',
  'select-session',
  'toggle-project',
  'update:query',
])
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

      <div v-if="sessionsLoading" class="sidebar-skeleton">
        <div v-for="index in 3" :key="index" class="skeleton-project">
          <div class="skeleton-line skeleton-title"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
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
            class="new-session-button"
            :disabled="creatingSessionCwd === project.cwd"
            title="New session"
            @click="emit('create-session', project)"
          >
            +
          </button>
        </div>

        <Transition name="project-sessions">
          <div v-if="expandedProject(project)" class="project-session-list">
            <div
              v-for="session in project.sessions.slice(0, 5)"
              :key="session.path || session.id"
              class="session"
              :class="{ active: session.id === selectedSessionId }"
              role="button"
              tabindex="0"
              @click="emit('select-session', session)"
              @keydown.enter="emit('select-session', session)"
              @keydown.space.prevent="emit('select-session', session)"
            >
              <span
                class="session-title"
                v-html="highlightedText(sessionTitle(session))"
              ></span>
              <span
                v-if="sessionStatus(session.id).label"
                class="session-status"
                :class="`status-${sessionStatus(session.id).tone}`"
              >
                <span class="session-status-dot"></span>
                {{ sessionStatus(session.id).label }}
              </span>
              <time v-else>{{ sessionTime(session) }}</time>
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
