<script setup>
import { computed, ref } from 'vue'
import { sessionTime } from '../lib/format'

const renameSource = 'project-detail'

const props = defineProps({
  creatingSessionCwd: {
    type: String,
    default: '',
  },
  deletingSessionId: {
    type: String,
    default: '',
  },
  project: {
    type: Object,
    required: true,
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
})

const emit = defineEmits([
  'begin-rename-session',
  'cancel-rename-session',
  'close',
  'commit-rename-session',
  'create-session',
  'request-delete-session',
  'select-session',
  'update:renameDraft',
])

const query = ref('')
const sortMode = ref('recent')

const visibleSessions = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const sessions = props.project.sessions.filter((session) => {
    if (!needle) return true
    const title = props.sessionTitle(session).toLowerCase()
    const id = String(session.id || '').toLowerCase()
    return title.includes(needle) || id.includes(needle)
  })

  return [...sessions].sort((a, b) => {
    if (sortMode.value === 'title') {
      return props.sessionTitle(a).localeCompare(props.sessionTitle(b))
    }
    return sessionTimestamp(b) - sessionTimestamp(a)
  })
})

const selectedInProject = computed(() => {
  return props.project.sessions.some((session) => {
    return session.id === props.selectedSessionId
  })
})
const currentLabel = computed(() => {
  if (!props.selectedSessionId) return 'No session selected'
  return selectedInProject.value ? 'In project' : 'Outside project'
})

const vFocusSelect = {
  mounted(el) {
    requestAnimationFrame(() => {
      el.focus()
      el.select()
    })
  },
}

function sessionTimestamp(session) {
  const time = new Date(session?.timestamp || 0).getTime()
  return Number.isNaN(time) ? 0 : time
}

function isRenaming(session) {
  return props.renamingSessionId === session.id
    && props.renamingSessionSource === renameSource
}

function beginRename(session) {
  emit('begin-rename-session', session, renameSource)
}

function statusFor(session) {
  return props.sessionStatus(session.id) || { label: '', tone: '' }
}

function renameButtonLabel(session) {
  if (props.renamingSessionSavingId === session.id) return 'Saving…'
  return 'Rename'
}

function deleteButtonLabel(session) {
  if (props.deletingSessionId === session.id) return 'Deleting…'
  return 'Delete'
}
</script>

<template>
  <aside class="project-detail-drawer" aria-label="Project details">
    <header class="project-detail-header">
      <div>
        <strong>{{ project.name }}</strong>
        <span>Project sessions</span>
      </div>
      <button
        class="project-detail-close"
        type="button"
        aria-label="Close project details"
        @click="emit('close')"
      >×</button>
    </header>

    <section class="project-detail-meta">
      <div>
        <span>CWD</span>
        <strong>{{ project.cwd }}</strong>
      </div>
      <div>
        <span>Sessions</span>
        <strong>{{ project.sessions.length }}</strong>
      </div>
      <div>
        <span>Current</span>
        <strong>{{ currentLabel }}</strong>
      </div>
    </section>

    <div class="project-detail-toolbar">
      <label class="project-detail-search">
        <span>Filter sessions</span>
        <input
          v-model="query"
          placeholder="Name or session id"
        />
      </label>
      <button
        class="project-detail-primary"
        type="button"
        :disabled="creatingSessionCwd === project.cwd"
        @click="emit('create-session', project)"
      >
        {{ creatingSessionCwd === project.cwd ? 'Creating…' : 'New session' }}
      </button>
    </div>

    <div class="project-detail-list-head">
      <span>{{ visibleSessions.length }} visible</span>
      <div class="project-detail-sort">
        <button
          type="button"
          :class="{ active: sortMode === 'recent' }"
          @click="sortMode = 'recent'"
        >Recent</button>
        <button
          type="button"
          :class="{ active: sortMode === 'title' }"
          @click="sortMode = 'title'"
        >Title</button>
      </div>
    </div>

    <div v-if="visibleSessions.length === 0" class="project-detail-empty">
      No matching sessions
    </div>
    <div v-else class="project-detail-list">
      <article
        v-for="session in visibleSessions"
        :key="session.path || session.id"
        class="project-session-card"
        :class="{ active: session.id === selectedSessionId }"
      >
        <div class="project-session-main">
          <input
            v-if="isRenaming(session)"
            v-focus-select
            class="project-session-title-input"
            :value="renameDraft"
            aria-label="Session name"
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
          <strong v-else>{{ sessionTitle(session) }}</strong>
          <span>
            {{ sessionTime(session) || 'new' }}
            <template v-if="statusFor(session).label">
              · {{ statusFor(session).label }}
            </template>
          </span>
        </div>
        <div v-if="!isRenaming(session)" class="project-session-actions">
          <button
            type="button"
            :disabled="session.id === selectedSessionId"
            @click="emit('select-session', session)"
          >{{ session.id === selectedSessionId ? 'Selected' : 'Open' }}</button>
          <button
            type="button"
            :disabled="renamingSessionSavingId === session.id"
            @click="beginRename(session)"
          >{{ renameButtonLabel(session) }}</button>
          <button
            type="button"
            :disabled="deletingSessionId === session.id"
            @click="emit('request-delete-session', session)"
          >{{ deleteButtonLabel(session) }}</button>
        </div>
      </article>
    </div>
  </aside>
</template>
