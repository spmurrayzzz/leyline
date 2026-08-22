<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  open: Boolean,
  research: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['close'])
const view = ref('cited')
const views = computed(() => [
  {
    id: 'cited',
    label: 'Cited',
    count: props.research?.citedSourceCount || 0,
  },
  {
    id: 'ledger',
    label: 'Research ledger',
    count: props.research?.sourceCount || 0,
  },
])
const visibleSources = computed(() => {
  const sources = props.research?.sources || []
  if (view.value === 'ledger') return sources
  return sources.filter((source) => source.status === 'cited')
})
const summary = computed(() => {
  if (view.value === 'cited') {
    return `${props.research?.citedSourceCount || 0} cited in this report`
  }
  return `${props.research?.sourceCount || 0} found across ${props.research?.threadCount || 0} threads`
})

watch(() => props.research?.sessionId, setDefaultView)
watch(() => props.open, (open) => {
  if (open) setDefaultView()
})
watch(() => props.research?.citedSourceCount || 0, (count, previousCount) => {
  if (props.open && count && !previousCount) view.value = 'cited'
})

function setDefaultView() {
  view.value = props.research?.citedSourceCount ? 'cited' : 'ledger'
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

function sourceSummary(source) {
  if (source.status === 'excluded' && source.exclusionReason) {
    return source.exclusionReason
  }
  return source.claim || source.evidence || ''
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
        <span>{{ summary }}</span>
      </div>
      <button type="button" aria-label="Close sources" @click="emit('close')">
        ×
      </button>
    </header>

    <div class="research-source-filters">
      <button
        v-for="item in views"
        :key="item.id"
        type="button"
        :class="{ active: view === item.id }"
        :aria-pressed="view === item.id"
        @click="view = item.id"
      >
        {{ item.label }} {{ item.count }}
      </button>
    </div>

    <div class="research-source-list">
      <article
        v-for="source in visibleSources"
        :key="source.id"
        class="research-source-card"
        :class="{ excluded: source.status === 'excluded' }"
      >
        <component
          :is="source.url ? 'a' : 'div'"
          class="research-source-select"
          :href="source.url || undefined"
          :target="source.url ? '_blank' : undefined"
          :rel="source.url ? 'noreferrer' : undefined"
          :title="source.path || source.url || undefined"
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
          </span>
          <span v-if="view === 'ledger'" class="research-source-ledger-meta">
            <span v-if="sourceThread(source)">{{ sourceThread(source) }}</span>
            <span>{{ source.kind }}</span>
            <span>{{ sourceStatus(source) }}</span>
          </span>
          <span v-if="sourceSummary(source)" class="research-source-summary">
            {{ sourceSummary(source) }}
          </span>
        </component>
      </article>
      <div v-if="!visibleSources.length" class="research-source-empty">
        No sources in this view.
      </div>
    </div>
  </aside>
</template>
