<script setup>
import { renderedBlock } from '../lib/transcript'

const props = defineProps({
  blocks: {
    type: Array,
    default: () => [],
  },
  copiedEntryId: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['copy'])

function copyTitle(id) {
  return props.copiedEntryId === id ? 'Copied' : 'Copy'
}

function copyGlyph(id) {
  return props.copiedEntryId === id ? '✓' : '⧉'
}
</script>

<template>
  <article
    v-if="blocks.length"
    class="message compact-message transcript-message assistant-message live-message"
  >
    <div class="message-meta message-meta-row">
      <span>Agent</span>
      <button
        class="copy-button"
        type="button"
        :title="copyTitle('live-assistant')"
        @click="emit('copy')"
      >
        {{ copyGlyph('live-assistant') }}
      </button>
    </div>
    <template v-for="(block, index) in blocks" :key="`live-${index}`">
      <div v-if="block.type === 'thinking'" class="thinking-block">
        <div class="thinking-label">Thinking</div>
        <pre>{{ block.text }}</pre>
      </div>
      <div
        v-else
        class="entry-text markdown-body assistant-text-block"
        v-html="renderedBlock(block)"
      ></div>
    </template>
  </article>
</template>
