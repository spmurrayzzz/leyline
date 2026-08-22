<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  research: {
    type: Object,
    default: null,
  },
  revealKey: {
    type: Number,
    default: 0,
  },
  selectedSourceId: {
    type: Number,
    default: 0,
  },
})

const emit = defineEmits(['close', 'select'])
const filter = ref('all')
const sourceList = ref(null)
const filters = computed(() => [
  { id: 'all', label: 'All', count: props.research?.sourceCount || 0 },
  { id: 'cited', label: 'Cited', count: props.research?.citedSourceCount || 0 },
  {
    id: 'candidate',
    label: 'Supporting',
    count: (props.research?.sources || []).filter((source) => {
      return source.status === 'candidate'
    }).length,
  },
  {
    id: 'excluded',
    label: 'Excluded',
    count: props.research?.excludedSourceCount || 0,
  },
])
const visibleSources = computed(() => {
  const sources = props.research?.sources || []
  if (filter.value === 'all') return sources
  return sources.filter((source) => source.status === filter.value)
})

watch(() => props.research?.sessionId, () => {
  filter.value = 'all'
})

watch(() => props.revealKey, () => {
  filter.value = 'all'
  revealSelectedSource()
})

async function revealSelectedSource() {
  await nextTick()
  const list = sourceList.value
  if (!props.open || !list || !props.selectedSourceId) return
  const card = list.querySelector(
    `[data-source-id="${props.selectedSourceId}"]`,
  )
  if (!card) return
  const listRect = list.getBoundingClientRect()
  const cardRect = card.getBoundingClientRect()
  const top = list.scrollTop + cardRect.top - listRect.top
    - (listRect.height - cardRect.height) / 2
  list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

function sourceLocation(source) {
  if (source.publisher) return source.publisher
  if (source.url) {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '')
    } catch {}
  }
  return source.path ? 'project file' : 'source'
}

function sourceDate(source) {
  if (!source.publishedAt) return ''
  const value = /^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt)
    ? `${source.publishedAt}T00:00:00`
    : source.publishedAt
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return source.publishedAt
  return date.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })
}

function sourceStatus(source) {
  if (source.status === 'cited') return 'cited'
  if (source.status === 'excluded') return 'excluded'
  return 'supporting'
}

function sourceThread(source) {
  return (source.threadIds || []).join(', ')
}
</script>

<template>
  <aside
    class="research-sources-pane"
    :class="{ open }"
    aria-label="Research sources"
  >
    <header class="research-sources-header">
      <div>
        <strong>Sources</strong>
        <span>
          {{ research?.sourceCount || 0 }} found across
          {{ research?.threadCount || 0 }} threads
        </span>
      </div>
      <button type="button" aria-label="Close sources" @click="emit('close')">
        ×
      </button>
    </header>

    <div class="research-source-filters">
      <button
        v-for="item in filters"
        :key="item.id"
        type="button"
        :class="{ active: filter === item.id }"
        @click="filter = item.id"
      >
        {{ item.label }} {{ item.count }}
      </button>
    </div>

    <div ref="sourceList" class="research-source-list">
      <article
        v-for="source in visibleSources"
        :key="source.id"
        class="research-source-card"
        :data-source-id="source.id"
        :class="{
          selected: selectedSourceId === source.id,
          excluded: source.status === 'excluded',
        }"
      >
        <button
          class="research-source-select"
          type="button"
          @click="emit('select', source.id)"
        >
          <span class="research-source-card-head">
            <b>{{ source.id }}</b>
            <span>
              <strong>{{ source.title }}</strong>
              <small>
                {{ sourceLocation(source) }}
                <template v-if="sourceDate(source)"> · {{ sourceDate(source) }}</template>
              </small>
            </span>
            <em>{{ sourceThread(source) }}</em>
          </span>
          <span class="research-source-card-meta">
            <i>{{ source.kind }}</i>
            <small>{{ sourceStatus(source) }}</small>
          </span>
        </button>
        <span
          v-if="selectedSourceId === source.id"
          class="research-source-evidence"
        >
          <span v-if="source.claim">{{ source.claim }}</span>
          <span v-if="source.evidence">{{ source.evidence }}</span>
          <span v-if="source.exclusionReason">{{ source.exclusionReason }}</span>
          <a
            v-if="source.url"
            :href="source.url"
            target="_blank"
            rel="noreferrer"
          >Open source ↗</a>
          <code v-else-if="source.path">{{ source.path }}</code>
        </span>
      </article>
      <div v-if="!visibleSources.length" class="research-source-empty">
        No sources in this view.
      </div>
    </div>

    <footer class="research-sources-footer">
      Citation numbers resolve to this ledger. Thread use and exclusion reasons
      remain visible after the run.
    </footer>
  </aside>
</template>
