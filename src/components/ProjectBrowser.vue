<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
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
const modalEl = ref(null)
let appRoot = null
let appRootWasInert = false
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
  if (exactMatch.value || canonicalQuery(query.value).endsWith('/')) return 'Add folder'
  return 'Create & add'
})
const exactMatch = computed(() => {
  const leaf = splitBrowseQuery(query.value).filter.toLowerCase()
  if (!leaf) return false
  return entries.value.some((entry) => entry.name.toLowerCase() === leaf)
})

onMounted(() => {
  appRoot = document.getElementById('app')
  if (appRoot) {
    appRootWasInert = appRoot.inert
    appRoot.inert = true
  }
  query.value = props.initialPath || '~/'
  browseQuery()
  nextTick(() => inputEl.value?.focus())
})

onBeforeUnmount(() => {
  if (appRoot) appRoot.inert = appRootWasInert
})

watch(query, () => browseQuery())

async function browseQuery() {
  const generation = ++browseGeneration
  if (isDriveRelativeQuery(query.value)) {
    entries.value = []
    highlightedIndex.value = -1
    loading.value = false
    error.value = 'Drive-relative paths are not supported. Use an absolute path such as C:\\foo'
    return
  }
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
    const data = await fetchFsDirectory(nativeBrowsePath(directory), props.activeCwd)
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
  const canonical = canonicalQuery(query.value)
  const direct = canonical.endsWith('/') || canonical === '~'
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

function trapFocus(event) {
  const focusable = [...modalEl.value.querySelectorAll(
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getClientRects().length)
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function defaultHighlightIndex() {
  if (!rows.value.length) return -1
  return parentParentPath.value && entries.value.length ? 1 : 0
}

// Picker path helpers adapted from OpenCode (MIT) — opencode/packages/app/src/workspaces/selection/domain.ts: normalizePickerPath, normalizePickerDrive, trimPickerPath, joinPickerPath, pickerRoot, pickerParent, canonicalPickerPath, nativePickerPath, displayPickerPath. Internal canonical form is `/`; conversion to native `\` happens only at submit/display/fetch boundaries.
function stripSurroundingQuotes(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}

function canonicalQuery(value) {
  return normalizePickerDrive(stripSurroundingQuotes(value.trim()))
}

function isDriveRelativeQuery(value) {
  return /^[A-Za-z]:[^/\\]/.test(stripSurroundingQuotes(value.trim()))
}

function looksLikePath(value) {
  if (isDriveRelativeQuery(value)) return false
  const path = canonicalQuery(value)
  if (!path) return false
  return (
    path === '~' ||
    path.startsWith('~/') ||
    path.startsWith('/') ||
    path.startsWith('./') ||
    path.startsWith('../') ||
    /^[A-Za-z]:\//.test(path)
  )
}

function splitBrowseQuery(value) {
  const path = canonicalQuery(value) || '~/'
  if (path === '~') return { directory: '~/', filter: '' }
  if (path.endsWith('/')) return { directory: path, filter: '' }
  const root = pickerRoot(path)
  if (root && trimPickerPath(path) === root) {
    return { directory: `${root}/`, filter: '' }
  }
  const index = path.lastIndexOf('/')
  if (index === -1) return { directory: './', filter: path }
  return {
    directory: path.slice(0, index + 1),
    filter: path.slice(index + 1),
  }
}

function ensureTrailingSlash(value) {
  if (!value) return value
  const trimmed = trimPickerPath(value)
  const shown = displayPickerPath(trimmed, '', home.value)
  const separator = /^[A-Za-z]:/.test(shown) || shown.startsWith('\\\\') ? '\\' : '/'
  return shown.endsWith(separator) ? shown : `${shown}${separator}`
}

function resolvedSubmitPath() {
  const path = canonicalQuery(query.value)
  if (!path) return ''
  const { filter } = splitBrowseQuery(path)
  if (path === '~') return normalizeSubmitPath(parentPath.value || home.value)
  if (path.endsWith('/')) return normalizeSubmitPath(parentPath.value || path)

  const match = entries.value.find(
    (entry) => entry.name.toLowerCase() === filter.toLowerCase(),
  )
  if (match) return normalizeSubmitPath(match.fullPath || match.path)
  const parent = parentPath.value
    ? normalizePickerPath(parentPath.value)
    : pickerParent(path)
  if (parent && filter) return normalizeSubmitPath(joinPickerPath(parent, filter))
  return normalizeSubmitPath(path)
}

function appendPathSegment(parent, segment) {
  return joinPickerPath(parent, segment)
}

function normalizeSubmitPath(value) {
  const path = (value || '').trim()
  if (!path) return ''
  const canonical = pickerRoot(path) ? canonicalPickerPath(path) : trimPickerPath(path)
  return nativePickerPath(canonical)
}

function normalizePickerPath(input) {
  const value = input.replaceAll('\\', '/')

  if (value.startsWith('//') && !value.startsWith('///')) {
    return '//' + value.slice(2).replace(/\/+/g, '/')
  }

  return value.replace(/\/+/g, '/')
}

function normalizePickerDrive(input) {
  const value = normalizePickerPath(input)

  if (/^[A-Za-z]:$/.test(value)) return value + '/'

  return value
}

function trimPickerPath(input) {
  const value = normalizePickerDrive(input)

  if (value === '/' || value === '//' || /^[A-Za-z]:\/$/.test(value)) return value

  return value.replace(/\/+$/, '')
}

function joinPickerPath(base, relative) {
  const root = trimPickerPath(base ?? '')
  const path = trimPickerPath(relative).replace(/^\/+/, '')

  if (!root) return path

  if (!path) return root

  if (root.endsWith('/')) return root + path

  return root + '/' + path
}

function pickerRoot(input) {
  const value = normalizePickerDrive(input)

  if (value.startsWith('//')) {
    const [server, share] = value.slice(2).split('/')

    if (server && share) return `//${server}/${share}`

    return '//'
  }

  if (value.startsWith('/')) return '/'

  if (/^[A-Za-z]:\//.test(value)) return value.slice(0, 3)

  return ''
}

function pickerParent(input) {
  const value = trimPickerPath(input)
  const root = pickerRoot(value)

  if (value === root) return value

  if (value === '/' || value === '//' || /^[A-Za-z]:\/$/.test(value)) return value
  const index = value.lastIndexOf('/')

  if (index < root.length) return root

  if (index <= 0) return '/'

  if (index === 2 && /^[A-Za-z]:/.test(value)) return value.slice(0, 3)

  return value.slice(0, index)
}

function canonicalPickerPath(path) {
  const value = normalizePickerDrive(path)
  const root = pickerRoot(value)
  const parts = value.slice(root.length).split('/')

  const resolved = parts.reduce((output, part) => {
    if (!part || part === '.') return output

    if (part === '..') {
      output.pop()

      return output
    }

    output.push(part)

    return output
  }, [])

  return joinPickerPath(root, resolved.join('/'))
}

function nativePickerPath(path) {
  const value = trimPickerPath(path)

  if (/^[A-Za-z]:\//.test(value) || value.startsWith('//')) {
    return value.replaceAll('/', '\\')
  }

  return value
}

// The browse fetch is the one place a picker path is handed to the backend
// (fs-browser.js), whose contract is: a trailing separator means "list this
// directory", while without one the last segment is treated as a name prefix
// matched in the parent directory. nativePickerPath() trims that separator,
// which would make the backend list one level too high, so restore it here —
// and only here; submit/display paths keep the trimmed canonical form.
function nativeBrowsePath(directory) {
  const native = nativePickerPath(directory)
  if (!directory.endsWith('/')) return native
  const separator = /^[A-Za-z]:/.test(native) || native.startsWith('\\\\') ? '\\' : '/'
  return native.endsWith(separator) ? native : `${native}${separator}`
}

function pickerTilde(absolute, homePath) {
  const path = trimPickerPath(absolute)

  if (!homePath) return ''
  const root = trimPickerPath(homePath)

  if (/^[A-Za-z]:\//.test(root)) return ''

  if (path === root) return '~'

  if (path.startsWith(root + '/')) return '~' + path.slice(root.length)

  return ''
}

function displayPickerPath(path, input, homePath) {
  const value = trimPickerPath(path)

  if (/^[A-Za-z]:\//.test(trimPickerPath(homePath)) || /^[A-Za-z]:\//.test(value)) {
    return value.replaceAll('/', '\\')
  }

  return pickerTilde(value, homePath) || value
}
</script>

<template>
  <Teleport to="body">
    <div class="project-browser-backdrop" @click.self="emit('close')">
      <section
        ref="modalEl"
        class="project-browser-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-browser-title"
        @keydown.tab="trapFocus"
      >
        <header class="project-browser-header">
          <div>
            <strong id="project-browser-title">Add project</strong>
            <span>Choose or type a local folder</span>
          </div>
          <button type="button" aria-label="Close" @click="emit('close')">×</button>
        </header>

        <form class="project-browser-path" @submit.prevent="submitPath">
          <span aria-hidden="true">⌕</span>
          <input
            ref="inputEl"
            v-model="query"
            aria-label="Project folder path"
            placeholder="e.g. C:\dev\project or ~/dev/project"
            :disabled="busy"
            @keydown="handleKeydown"
          />
        </form>

        <div class="project-browser-shortcuts">
          <button type="button" :disabled="busy || !home" @click="goHome">
            Home
          </button>
          <span>Enter opens a folder · ⌘/Ctrl+Enter adds the typed path</span>
        </div>

        <div v-if="error" class="project-browser-error">
          {{ error }}
        </div>
        <div v-else class="project-browser-results">
          <div class="project-browser-heading">
            <span>Folders</span>
            <span>{{ entries.length }}</span>
          </div>
          <div class="project-browser-list">
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
              <span class="project-browser-row-icon">
                <svg v-if="row.type === 'up'" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 13V3M4.5 6.5 8 3l3.5 3.5"></path>
                </svg>
                <svg v-else viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M2.2 5.2c0-1 .8-1.8 1.8-1.8h2l1.6 1.8h4.6c1 0 1.8.8 1.8 1.8v4.6c0 1-.8 1.8-1.8 1.8H4c-1 0-1.8-.8-1.8-1.8z"></path>
                </svg>
              </span>
              <strong>{{ row.name }}</strong>
            </button>
            <div
              v-if="!loading && rows.length === 0"
              class="project-browser-empty"
            >No matching folders</div>
          </div>
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
  </Teleport>
</template>
