<script setup>
import { computed, toRef } from 'vue'
import { useSmoothStreamingText } from '../composables/useSmoothStreamingText'
import { renderedBlock } from '../lib/transcript'

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
    v-html="renderedBlock(visibleBlock)"
    @click="openMarkdownImage"
  ></div>
</template>
