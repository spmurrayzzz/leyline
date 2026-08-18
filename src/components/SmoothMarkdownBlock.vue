<script setup>
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import { useSmoothStreamingText } from '../composables/useSmoothStreamingText'
import { renderedBlock } from '../lib/transcript'

const markdownRenderIntervalMs = 80
const emit = defineEmits(['open-image'])

const props = defineProps({
  block: {
    type: Object,
    required: true,
  },
  streamKey: {
    type: String,
    required: true,
  },
  streaming: {
    type: Boolean,
    default: false,
  },
})

const fullText = computed(() => props.block.text || '')
const { visibleText } = useSmoothStreamingText({
  fullText,
  isStreaming: toRef(props, 'streaming'),
  streamKey: toRef(props, 'streamKey'),
})
const visibleBlock = computed(() => ({
  ...props.block,
  text: props.streaming ? visibleText.value : fullText.value,
}))
const renderedHtml = ref('')
let pendingBlock
let renderTimer = 0
let lastRenderedAt = 0

watch([visibleBlock, () => props.streaming], ([block, streaming]) => {
  pendingBlock = block
  if (!streaming) {
    cancelRender()
    renderMarkdown()
    return
  }
  scheduleRender()
}, { immediate: true })

onBeforeUnmount(cancelRender)

function scheduleRender() {
  if (renderTimer) return
  const delay = Math.max(
    0,
    markdownRenderIntervalMs - (performance.now() - lastRenderedAt),
  )
  if (delay === 0) {
    renderMarkdown()
    return
  }
  renderTimer = window.setTimeout(renderMarkdown, delay)
}

function renderMarkdown() {
  renderTimer = 0
  if (!pendingBlock) return
  renderedHtml.value = renderedBlock(pendingBlock)
  pendingBlock = undefined
  lastRenderedAt = performance.now()
}

function cancelRender() {
  window.clearTimeout(renderTimer)
  renderTimer = 0
}

function openMarkdownImage(event) {
  const image = event.target
  if (image?.tagName !== 'IMG') return
  event.preventDefault()
  emit(
    'open-image',
    image.currentSrc || image.src,
    image.alt || 'Transcript image',
  )
}
</script>

<template>
  <div
    class="entry-text markdown-body assistant-text-block"
    v-html="renderedHtml"
    @click="openMarkdownImage"
  ></div>
</template>
