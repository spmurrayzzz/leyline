<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { fetchFsDirectory } from '../lib/pi-api'

const props = defineProps({
  activeCwd: {
    type: String,
    default: '',
  },
  busy: Boolean,
  initialPath: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close', 'select'])

const query = ref('')
const parentPath = ref('')
const parentParentPath = ref('')
const home = ref('')
const entries = ref([])
const loading = ref(false)
const error = ref('')
const highlightedIndex = ref(0)
const inputEl = ref(null)
let browseGeneration = 0

const rows = computed(() => {
  const up = parentParentPath.value ? [{ type: 'up', name: '..' }] : []
  return [...up, ...entries.value.map((entry) => ({ ...entry, type: 'entry' }))]
})
const selectedPath = computed(() => {
  if (!looksLikePath(query.value)) return ''
  return resolvedSubmitPath()
})
const actionLabel = computed(() => {
  if (loading.value) return 'Checking…'
  if (exactMatch.value || query.value.endsWith('/')) return 'Add folder'
  return 'Create & add'
})
const exactMatch = computed(() => {
  const leaf = splitBrowseQuery(query.value).filter
  return entries.value.some((entry) => entry.name === leaf)
})

onMounted(() => {
  query.value = props.initialPath || '~/'
  browseQuery()
  nextTick(() => inputEl.value?.focus())
})

watch(query, () => browseQuery())

async function browseQuery() {
  const generation = ++browseGeneration
  if (!looksLikePath(query.value)) {
    entries.value = []
    highlightedIndex.value = -1
    error.value = ''
    return
  }

  const { directory } = splitBrowseQuery(query.value)
  loading.value = true
  error.value = ''

  try {
    const data = await fetchFsDirectory(directory, props.activeCwd)
    if (generation !== browseGeneration) return
    parentPath.value = data.parentPath || data.path || ''
    parentParentPath.value = data.parent || ''
    home.value = data.home || ''
    entries.value = filterEntries(data.entries || data.directories || [])
    highlightedIndex.value = defaultHighlightIndex()
  } catch (err) {
    if (generation !== browseGeneration) return
    error.value = err.message
    parentPath.value = ''
    parentParentPath.value = ''
    entries.value = []
    highlightedIndex.value = -1
  } finally {
    if (generation === browseGeneration) loading.value = false
  }
}

function filterEntries(items) {
  const { filter } = splitBrowseQuery(query.value)
  const normalizedFilter = filter.toLowerCase()
  const direct = query.value.trim().endsWith('/') || query.value.trim() === '~'
  return items.filter((entry) => {
    const name = entry.name.toLowerCase()
    if (!direct && entry.name.startsWith('.') && !filter.startsWith('.')) {
      return false
    }
    return name.startsWith(normalizedFilter)
  })
}

function handleKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveHighlight(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveHighlight(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const useModifier = event.metaKey || event.ctrlKey
    if (!useModifier && rows.value[highlightedIndex.value]) {
      chooseRow(rows.value[highlightedIndex.value])
    } else {
      submitPath()
    }
  } else if (event.key === 'Escape') {
    emit('close')
  }
}

function moveHighlight(delta) {
  if (!rows.value.length) return
  highlightedIndex.value = (
    highlightedIndex.value + delta + rows.value.length
  ) % rows.value.length
}

function chooseRow(row) {
  if (row.type === 'up') {
    query.value = ensureTrailingSlash(parentParentPath.value)
    return
  }
  query.value = ensureTrailingSlash(row.fullPath || row.path)
}

function submitPath() {
  const path = selectedPath.value
  if (!path || loading.value || props.busy) return
  emit('select', path)
}

function goHome() {
  if (home.value) query.value = ensureTrailingSlash(home.value)
}

function looksLikePath(value) {
  return /^(~\/?|\/|\.\.?\/)/.test(value.trim())
}

function splitBrowseQuery(value) {
  const path = value.trim() || '~/'
  if (path === '~') return { directory: '~/', filter: '' }
  if (path.endsWith('/')) return { directory: path, filter: '' }
  const index = path.lastIndexOf('/')
  if (index === -1) return { directory: './', filter: path }
  return {
    directory: path.slice(0, index + 1),
    filter: path.slice(index + 1),
  }
}

function ensureTrailingSlash(value) {
  if (!value) return value
  return value.endsWith('/') ? value : `${value}/`
}

function resolvedSubmitPath() {
  const path = query.value.trim()
  if (!path) return ''
  const { filter } = splitBrowseQuery(path)
  if (path === '~') return normalizeSubmitPath(parentPath.value || home.value)
  if (path.endsWith('/')) return normalizeSubmitPath(parentPath.value || path)

  const match = entries.value.find((entry) => entry.name === filter)
  if (match) return normalizeSubmitPath(match.fullPath || match.path)
  if (parentPath.value && filter) {
    return normalizeSubmitPath(appendPathSegment(parentPath.value, filter))
  }
  return normalizeSubmitPath(path)
}

function appendPathSegment(parent, segment) {
  if (parent.endsWith('/')) return `${parent}${segment}`
  return `${parent}/${segment}`
}

function defaultHighlightIndex() {
  if (!rows.value.length) return -1
  return parentParentPath.value && entries.value.length ? 1 : 0
}

function normalizeSubmitPath(value) {
  const path = value.trim()
  if (!path) return ''
  if (path === '/') return path
  return path.replace(/\/+$/, '')
}
</script>

<template>
  <div class="project-browser-backdrop" @click.self="emit('close')">
    <section class="project-browser-modal" aria-label="Choose project folder">
      <header class="project-browser-header">
        <div>
          <strong>Add project folder</strong>
          <span>{{ parentPath || 'Type a local path to browse' }}</span>
        </div>
        <button type="button" @click="emit('close')">×</button>
      </header>

      <form class="project-browser-path" @submit.prevent="submitPath">
        <input
          ref="inputEl"
          v-model="query"
          placeholder="~/dev/project"
          :disabled="busy"
          @keydown="handleKeydown"
        />
        <button type="submit" :disabled="!selectedPath || busy">
          {{ actionLabel }}
        </button>
      </form>

      <div class="project-browser-shortcuts">
        <button type="button" :disabled="busy || !home" @click="goHome">
          Home
        </button>
        <span>Enter opens highlighted folder, ⌘/Ctrl+Enter adds typed path.</span>
      </div>

      <div v-if="error" class="project-browser-error">
        {{ error }}
      </div>
      <div v-else class="project-browser-list">
        <button
          v-for="(row, index) in rows"
          :key="row.type === 'up' ? '..' : row.fullPath"
          type="button"
          :class="{
            hidden: row.hidden,
            highlighted: index === highlightedIndex,
          }"
          @mouseenter="highlightedIndex = index"
          @click="chooseRow(row)"
        >
          <span>{{ row.type === 'up' ? '↥' : '▱' }}</span>
          <strong>{{ row.name }}</strong>
        </button>
        <div
          v-if="!loading && rows.length === 0"
          class="project-browser-empty"
        >No matching folders</div>
      </div>

      <footer class="project-browser-actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button
          type="button"
          class="project-browser-primary"
          :disabled="!selectedPath || busy"
          @click="submitPath"
        >{{ actionLabel }}</button>
      </footer>
    </section>
  </div>
</template>
