<script setup>
import SmoothMarkdownBlock from './SmoothMarkdownBlock.vue'

const props = defineProps({
  blocks: {
    type: Array,
    default: () => [],
  },
  copiedEntryId: {
    type: String,
    default: '',
  },
  messageId: {
    type: String,
    default: 'live-assistant',
  },
  streaming: {
    type: Boolean,
    default: false,
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
      <SmoothMarkdownBlock
        v-else
        :block="block"
        :stream-key="`${messageId}-${index}`"
        :streaming="streaming"
      />
    </template>
  </article>
</template>
