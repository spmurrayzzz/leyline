<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  anchorRect: {
    type: Object,
    default: null,
  },
  source: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['close'])
const preview = ref(null)
const placement = ref('below')
const position = ref({})
const primaryText = computed(() => {
  return props.source.claim
    || props.source.evidence
    || props.source.exclusionReason
    || ''
})
const secondaryText = computed(() => {
  if (!props.source.claim) return ''
  return props.source.evidence === props.source.claim
    ? ''
    : props.source.evidence || ''
})

onMounted(async () => {
  await positionPreview()
  window.addEventListener('pointerdown', closeFromOutside, true)
  window.addEventListener('resize', closeFromViewportChange)
  window.addEventListener('scroll', closeFromViewportChange, true)
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', closeFromOutside, true)
  window.removeEventListener('resize', closeFromViewportChange)
  window.removeEventListener('scroll', closeFromViewportChange, true)
})

async function positionPreview() {
  await nextTick()
  const element = preview.value
  if (!element) return
  if (window.innerWidth <= 760) {
    placement.value = 'sheet'
    position.value = {
      bottom: '10px',
      left: '10px',
      top: 'auto',
    }
    return
  }

  const margin = 14
  const gap = 10
  const rect = props.anchorRect || {
    bottom: window.innerHeight / 2,
    height: 0,
    left: window.innerWidth / 2,
    top: window.innerHeight / 2,
    width: 0,
  }
  const width = element.offsetWidth
  const height = element.offsetHeight
  const anchorCenter = rect.left + rect.width / 2
  const left = Math.min(
    Math.max(margin, rect.left),
    window.innerWidth - width - margin,
  )
  let top = rect.bottom + gap
  placement.value = 'below'
  if (top + height > window.innerHeight - margin) {
    const above = rect.top - height - gap
    if (above >= margin) {
      top = above
      placement.value = 'above'
    } else {
      top = Math.max(margin, window.innerHeight - height - margin)
    }
  }
  const arrowLeft = Math.min(
    Math.max(18, anchorCenter - left - 5),
    width - 28,
  )
  position.value = {
    '--citation-preview-arrow-left': `${arrowLeft}px`,
    left: `${left}px`,
    top: `${top}px`,
  }
}

function closeFromOutside(event) {
  if (preview.value?.contains(event.target)) return
  emit('close')
}

function closeFromViewportChange() {
  emit('close')
}

function sourceLocation() {
  if (props.source.publisher) return props.source.publisher
  if (props.source.url) {
    try {
      return new URL(props.source.url).hostname.replace(/^www\./, '')
    } catch {}
  }
  return props.source.path ? 'project file' : 'source'
}

function sourceDate() {
  if (!props.source.publishedAt) return ''
  const value = /^\d{4}-\d{2}-\d{2}$/.test(props.source.publishedAt)
    ? `${props.source.publishedAt}T00:00:00`
    : props.source.publishedAt
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return props.source.publishedAt
  return date.toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  })
}
</script>

<template>
  <section
    ref="preview"
    class="research-citation-preview"
    :class="`is-${placement}`"
    :style="position"
    role="dialog"
    aria-modal="false"
    :aria-label="`Citation ${source.id} source preview`"
  >
    <header class="research-citation-preview-head">
      <b>{{ source.id }}</b>
      <span>
        {{ sourceLocation() }}
        <template v-if="sourceDate()"> · {{ sourceDate() }}</template>
      </span>
      <button type="button" aria-label="Close source preview" @click="emit('close')">
        ×
      </button>
    </header>
    <strong>{{ source.title }}</strong>
    <p v-if="primaryText" class="research-citation-preview-claim">
      {{ primaryText }}
    </p>
    <p v-if="secondaryText" class="research-citation-preview-evidence">
      {{ secondaryText }}
    </p>
    <a
      v-if="source.url"
      :href="source.url"
      target="_blank"
      rel="noreferrer"
      @click="emit('close')"
    >Open source ↗</a>
    <code v-else-if="source.path">{{ source.path }}</code>
  </section>
</template>
