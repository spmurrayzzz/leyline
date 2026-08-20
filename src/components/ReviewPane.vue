<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PierrePreview from './PierrePreview.vue'
import { backendHttpUrl } from '../lib/backend'
import { fetchGitReview, fetchGitReviewDiff } from '../lib/pi-api'

const props = defineProps({
  cwd: { type: String, default: '' },
  expanded: Boolean,
  open: Boolean,
  refreshToken: { type: Number, default: 0 },
  sidebarHidden: Boolean,
  watchEnabled: Boolean,
  width: { type: Number, default: 420 },
})

const emit = defineEmits([
  'close',
  'prepared',
  'preparing',
  'resize',
  'summary',
  'toggle-expand',
])

const MIN_REVIEW_WIDTH = 340
const review = ref({
  additions: 0,
  available: true,
  branch: '',
  conflicts: 0,
  deletions: 0,
  files: [],
  filesTruncated: false,
  lineStatsAvailable: false,
  root: '',
  totalFiles: 0,
})
const maximumPaneWidth = ref(720)
const selectedPath = ref('')
const diff = ref({ diffs: [], path: '' })
const loading = ref(true)
const refreshing = ref(false)
const diffLoading = ref(false)
const diffRendering = ref(false)
const error = ref('')
const diffError = ref('')
const hasLoaded = ref(false)
let reviewGeneration = 0
let diffGeneration = 0
let diffRenderGeneration = 0
let pendingPreviewKeys = new Set()
let resizeCleanup
let reviewEventSource
let watchedRefreshQueued = false
let watchedRefreshTimer

const files = computed(() => review.value.files || [])
const filesTruncated = computed(() => review.value.filesTruncated === true)
const totalFiles = computed(() => {
  return Number.isInteger(review.value.totalFiles)
    ? review.value.totalFiles
    : files.value.length
})
const selectedFile = computed(() => {
  return files.value.find((file) => file.path === selectedPath.value) || null
})
const diffSections = computed(() => diff.value.diffs || [])
const renderedDiffSections = computed(() => {
  const generation = diffRenderGeneration
  return diffSections.value.map((section, index) => ({
    ...section,
    renderKey: `${generation}:${index}`,
    preview: section.patch && !section.binary && !section.tooLarge
      ? { kind: 'patch', patch: section.patch }
      : null,
  }))
})
const stagedCount = computed(() => {
  return files.value.filter((file) => file.staged).length
})
const workingCount = computed(() => {
  return files.value.filter((file) => file.unstaged).length
})
const conflictCount = computed(() => {
  return files.value.filter((file) => file.conflicted).length
})
const panelSubtitle = computed(() => {
  if (loading.value && !hasLoaded.value) return 'Loading project changes'
  if (!review.value.available) return 'No Git repository'
  const count = filesTruncated.value
    ? `${files.value.length}+ files`
    : `${totalFiles.value} ${plural(totalFiles.value, 'file')}`
  return review.value.branch ? `${review.value.branch} · ${count}` : count
})

onMounted(() => {
  emit('resize', constrainWidth(props.width))
  window.addEventListener('resize', constrainCurrentWidth)
  openReviewEventStream()
  void loadReview()
})

onBeforeUnmount(() => {
  reviewGeneration++
  diffGeneration++
  closeReviewEventStream()
  window.removeEventListener('resize', constrainCurrentWidth)
  resizeCleanup?.()
})

watch(() => props.cwd, () => {
  selectedPath.value = ''
  diff.value = { diffs: [], path: '' }
  hasLoaded.value = false
  closeReviewEventStream()
  openReviewEventStream()
  void loadReview()
})

watch(() => props.watchEnabled, (enabled) => {
  if (enabled) openReviewEventStream()
  else closeReviewEventStream()
})

watch(() => props.refreshToken, () => {
  void loadReview({ preserveSelection: true })
})

watch(() => props.sidebarHidden, constrainCurrentWidth)

function openReviewEventStream() {
  if (!props.watchEnabled || !props.cwd) return
  closeReviewEventStream()
  const params = new URLSearchParams({ cwd: props.cwd })
  const source = new EventSource(
    backendHttpUrl(`/api/pi/review/events?${params}`),
  )
  reviewEventSource = source
  source.addEventListener('open', () => {
    if (reviewEventSource === source) requestWatchedRefresh()
  })
  source.addEventListener('review_change', () => {
    if (reviewEventSource === source) requestWatchedRefresh()
  })
}

function closeReviewEventStream() {
  reviewEventSource?.close()
  reviewEventSource = undefined
  clearTimeout(watchedRefreshTimer)
  watchedRefreshTimer = undefined
  watchedRefreshQueued = false
}

function requestWatchedRefresh() {
  watchedRefreshQueued = true
  scheduleWatchedRefresh()
}

function scheduleWatchedRefresh() {
  if (!watchedRefreshQueued || watchedRefreshTimer || refreshing.value) return
  watchedRefreshTimer = window.setTimeout(() => {
    watchedRefreshTimer = undefined
    if (refreshing.value) return
    watchedRefreshQueued = false
    void loadReview({ preserveSelection: true })
  }, 80)
}

async function loadReview({ preserveSelection = false } = {}) {
  const generation = ++reviewGeneration
  emit('preparing')
  if (error.value) hasLoaded.value = false
  loading.value = !hasLoaded.value
  refreshing.value = true
  error.value = ''
  if (!hasLoaded.value) emit('summary', { state: 'loading' })

  try {
    const data = await fetchGitReview(props.cwd)
    if (generation !== reviewGeneration) return
    review.value = data
    announceSummary()
    const preferredPath = preserveSelection ? selectedPath.value : ''
    const nextPath = files.value.some((file) => file.path === preferredPath)
      ? preferredPath
      : files.value[0]?.path || ''
    selectedPath.value = nextPath
    hasLoaded.value = true
    if (nextPath) void loadDiff(nextPath)
    else clearDiff()
  } catch (err) {
    if (generation !== reviewGeneration) return
    error.value = err.message
    hasLoaded.value = true
    emit('summary', { state: 'error' })
    clearDiff()
  } finally {
    if (generation === reviewGeneration) {
      loading.value = false
      refreshing.value = false
      announcePrepared()
      scheduleWatchedRefresh()
    }
  }
}

async function loadDiff(path) {
  const generation = ++diffGeneration
  emit('preparing')
  diffLoading.value = true
  diffRendering.value = false
  diffError.value = ''
  pendingPreviewKeys = new Set()
  diff.value = { diffs: [], path }

  try {
    const data = await fetchGitReviewDiff(props.cwd, path)
    if (generation !== diffGeneration || selectedPath.value !== path) return
    const renderGeneration = ++diffRenderGeneration
    pendingPreviewKeys = new Set(
      (data.diffs || [])
        .map((section, index) => {
          return section.patch && !section.binary && !section.tooLarge
            ? `${renderGeneration}:${index}`
            : ''
        })
        .filter(Boolean),
    )
    diffRendering.value = pendingPreviewKeys.size > 0
    diff.value = data
  } catch (err) {
    if (generation !== diffGeneration || selectedPath.value !== path) return
    diffError.value = err.message
  } finally {
    if (generation === diffGeneration) {
      diffLoading.value = false
      announcePrepared()
    }
  }
}

function selectFile(file) {
  if (selectedPath.value === file.path && !diffError.value) return
  selectedPath.value = file.path
  void loadDiff(file.path)
}

function clearDiff() {
  diffGeneration++
  diffLoading.value = false
  diffRendering.value = false
  diffError.value = ''
  pendingPreviewKeys = new Set()
  diff.value = { diffs: [], path: '' }
  announcePrepared()
}

function announcePrepared() {
  if (
    loading.value
    || refreshing.value
    || diffLoading.value
    || diffRendering.value
    || pendingPreviewKeys.size
  ) return
  emit('prepared')
}

function announceSummary() {
  emit('summary', {
    additions: Number.isInteger(review.value.additions)
      ? review.value.additions
      : 0,
    available: review.value.available,
    branch: review.value.branch,
    conflicts: Number.isInteger(review.value.conflicts)
      ? review.value.conflicts
      : conflictCount.value,
    deletions: Number.isInteger(review.value.deletions)
      ? review.value.deletions
      : 0,
    filesTruncated: filesTruncated.value,
    lineStatsAvailable: review.value.lineStatsAvailable === true,
    staged: stagedCount.value,
    state: 'ready',
    totalFiles: totalFiles.value,
    working: workingCount.value,
  })
}

function markPreviewReady(key) {
  if (!pendingPreviewKeys.delete(key)) return
  diffRendering.value = pendingPreviewKeys.size > 0
}

function startResize(event) {
  const startX = event.clientX
  const startWidth = props.width
  document.body.classList.add('review-resizing')

  const move = (moveEvent) => {
    emit('resize', constrainWidth(startWidth + startX - moveEvent.clientX))
  }
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    document.body.classList.remove('review-resizing')
    resizeCleanup = undefined
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
  window.addEventListener('pointercancel', stop)
  resizeCleanup = stop
}

function resizeFromKeyboard(event) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  const delta = event.key === 'ArrowLeft' ? 24 : -24
  emit('resize', constrainWidth(props.width + delta))
}

function constrainCurrentWidth() {
  emit('resize', constrainWidth(props.width))
}

function constrainWidth(width) {
  const sidebarWidth = props.sidebarHidden ? 0 : 264
  const available = window.innerWidth - sidebarWidth - 400
  const maximum = Math.max(MIN_REVIEW_WIDTH, Math.min(720, available))
  maximumPaneWidth.value = maximum
  return Math.max(MIN_REVIEW_WIDTH, Math.min(maximum, width))
}

function fileName(path) {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  return normalized.split('/').pop() || normalized
}

function fileDirectory(path) {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : `${normalized.slice(0, index)}/`
}

function statusGlyph(file) {
  return {
    added: 'A',
    conflicted: '!',
    copied: 'C',
    deleted: 'D',
    modified: 'M',
    renamed: 'R',
    replaced: '±',
    untracked: '?',
  }[file.kind] || 'M'
}

function diffScopeLabel(scope) {
  if (scope === 'staged') return 'Staged changes'
  if (scope === 'conflict') return 'Conflict'
  return 'Working tree changes'
}

function diffSize(section) {
  const parts = []
  if (section.bytes >= 1024 * 1024) {
    parts.push(`${(section.bytes / (1024 * 1024)).toFixed(1)} MB`)
  } else if (section.bytes > 0) {
    parts.push(`${Math.ceil(section.bytes / 1024)} KB`)
  }
  if (section.lines > 0) parts.push(`${section.lines.toLocaleString()} lines`)
  return parts.join(' · ')
}

function changeScope(file) {
  if (file.conflicted) return 'Conflict'
  if (file.staged && file.untracked) return 'Staged + untracked'
  if (file.untracked) return 'Untracked'
  if (file.staged && file.unstaged) return 'Staged + working'
  if (file.staged) return 'Staged'
  return 'Working tree'
}

function plural(count, word) {
  return count === 1 ? word : `${word}s`
}
</script>

<template>
  <aside
    class="review-pane"
    :class="{ expanded, open }"
    :aria-hidden="!open"
    :inert="!open"
    aria-label="Review project changes"
  >
    <div
      v-if="!expanded"
      class="review-pane-resize-handle"
      role="separator"
      aria-label="Resize review pane"
      aria-orientation="vertical"
      :aria-valuemax="Math.round(maximumPaneWidth)"
      :aria-valuemin="MIN_REVIEW_WIDTH"
      :aria-valuenow="Math.round(width)"
      :aria-valuetext="`${Math.round(width)} pixels`"
      tabindex="0"
      @keydown="resizeFromKeyboard"
      @pointerdown.prevent="startResize"
    ></div>

    <header class="review-pane-header">
      <div>
        <strong>Changes</strong>
        <span :title="review.root">{{ panelSubtitle }}</span>
      </div>
      <div>
        <button
          type="button"
          title="Refresh changes"
          aria-label="Refresh changes"
          :class="{ refreshing }"
          :disabled="refreshing"
          @click="loadReview({ preserveSelection: true })"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M13 5.5V2.8l-1.7 1.7A5.5 5.5 0 1 0 13.2 10"></path>
          </svg>
        </button>
        <button
          type="button"
          :title="expanded ? 'Collapse review' : 'Expand review'"
          :aria-label="expanded ? 'Collapse review' : 'Expand review'"
          :aria-pressed="expanded"
          @click="emit('toggle-expand')"
        >
          <svg v-if="expanded" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.5 6H6V2.5M13.5 6H10V2.5M2.5 10H6v3.5M13.5 10H10v3.5"></path>
          </svg>
          <svg v-else viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 2.5H2.5V6M10 2.5h3.5V6M6 13.5H2.5V10M10 13.5h3.5V10"></path>
          </svg>
        </button>
        <button
          type="button"
          title="Close review"
          aria-label="Close review"
          @click="emit('close')"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8"></path>
          </svg>
        </button>
      </div>
    </header>

    <div
      class="review-pane-body"
      :class="{
        'has-files': hasLoaded && !error && review.available && files.length,
      }"
    >
      <div v-if="loading && !hasLoaded" class="review-pane-state">
        <span class="review-loading-mark"></span>
        <strong>Reading working tree</strong>
      </div>

      <div v-else-if="error" class="review-pane-state review-pane-error">
        <strong>Could not load changes</strong>
        <span>{{ error }}</span>
        <button type="button" @click="loadReview">Retry</button>
      </div>

      <div v-else-if="!review.available" class="review-pane-state">
        <strong>Git review is unavailable</strong>
        <span>This project is not inside a Git repository.</span>
      </div>

      <template v-else-if="files.length">
        <section class="review-files">
          <div class="review-files-heading">
            <span v-if="filesTruncated" title="More changed files are not shown">
              {{ files.length }}+ changed files
            </span>
            <span v-else>
              {{ files.length }} changed {{ plural(files.length, 'file') }}
            </span>
            <span v-if="!filesTruncated && stagedCount">{{ stagedCount }} staged</span>
            <span v-if="!filesTruncated && workingCount">{{ workingCount }} working</span>
          </div>
          <ul class="review-file-list" aria-label="Changed files">
            <li v-for="file in files" :key="file.path">
              <button
                type="button"
                :aria-current="selectedPath === file.path ? 'true' : undefined"
                :class="{ selected: selectedPath === file.path }"
                @click="selectFile(file)"
              >
                <span class="review-file-status" :class="`status-${file.kind}`">
                  {{ statusGlyph(file) }}
                </span>
                <span class="review-file-name">
                  <strong>{{ fileName(file.path) }}</strong>
                  <small v-if="file.oldPath" :title="`${file.oldPath} → ${file.path}`">
                    {{ file.oldPath }} → {{ file.path }}
                  </small>
                  <small v-else>{{ fileDirectory(file.path) || 'Project root' }}</small>
                </span>
                <span class="review-file-scope">{{ changeScope(file) }}</span>
              </button>
            </li>
          </ul>
        </section>

        <section v-if="selectedFile" class="review-diff">
          <div class="review-diff-scroll">
            <div v-if="diffLoading" class="review-diff-state">
              <span class="review-loading-mark"></span>
              <span>Loading diff</span>
            </div>
            <div v-else-if="diffError" class="review-diff-state review-pane-error">
              <span>{{ diffError }}</span>
              <button type="button" @click="loadDiff(selectedPath)">Retry</button>
            </div>
            <div v-else-if="renderedDiffSections.length" class="review-diff-sections">
              <Transition
                name="review-diff-ready"
                @after-leave="announcePrepared"
              >
                <div v-if="diffRendering" class="review-diff-rendering">
                  <span class="review-loading-mark"></span>
                  <span>Rendering diff</span>
                </div>
              </Transition>
              <section
                v-for="section in renderedDiffSections"
                :key="section.renderKey"
                class="review-diff-section"
              >
                <header>{{ diffScopeLabel(section.scope) }}</header>
                <div v-if="section.directory" class="review-diff-state">
                  <strong>Nested repository</strong>
                  <span>{{ selectedFile.path }} is an untracked Git repository.</span>
                </div>
                <div v-else-if="section.tooLarge" class="review-diff-state">
                  <strong>Diff is too large to render</strong>
                  <span>
                    {{ diffSize(section) }}. Use the terminal to inspect the complete diff.
                  </span>
                </div>
                <div v-else-if="section.binary" class="review-diff-state">
                  <strong>Binary file changed</strong>
                  <span>{{ selectedFile.path }} has no text diff.</span>
                </div>
                <PierrePreview
                  v-else-if="section.preview"
                  :preview="section.preview"
                  :clipped="false"
                  @ready="markPreviewReady(section.renderKey)"
                />
                <div v-else class="review-diff-state">
                  <strong>No text changes</strong>
                  <span>The file metadata changed without a text diff.</span>
                </div>
              </section>
            </div>
            <div v-else class="review-diff-state">
              <strong>No text changes</strong>
              <span>The file metadata changed without a text diff.</span>
            </div>
          </div>
        </section>
      </template>

      <div v-else class="review-pane-state review-clean-state">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 12 4 4 8-9"></path>
        </svg>
        <strong>Working tree is clean</strong>
        <span>There are no staged, unstaged, or untracked files.</span>
      </div>
    </div>
  </aside>
</template>
