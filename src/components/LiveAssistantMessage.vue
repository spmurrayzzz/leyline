<script setup>
import { ref, watch } from 'vue'
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
  persistedEntry: {
    type: Object,
    default: null,
  },
  streaming: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['copy', 'fork'])

const thinkingExpanded = ref(true)

watch(
  () => props.streaming,
  (streaming) => {
    thinkingExpanded.value = true
  },
)

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
      <span
        v-if="streaming"
        class="live-message-status"
        aria-label="Thinking"
      >
        <span aria-hidden="true">thinking</span>
        <span class="thought-ellipsis" aria-hidden="true">
          <span>.</span><span>.</span><span>.</span>
        </span>
      </span>
      <button
        v-if="persistedEntry?.id"
        class="copy-button"
        type="button"
        title="Fork from here"
        @click="emit('fork', persistedEntry)"
      >
        ⎇
      </button>
      <button
        class="copy-button"
        type="button"
        :title="copyTitle(messageId)"
        @click="emit('copy')"
      >
        {{ copyGlyph(messageId) }}
      </button>
    </div>
    <template v-for="(block, index) in blocks" :key="`live-${index}`">
      <div
        v-if="block.type === 'thinking'"
        class="thinking-block"
        :class="{
          'is-expanded': thinkingExpanded,
          'is-streaming': streaming,
        }"
      >
        <button
          class="thinking-trigger"
          type="button"
          @click="thinkingExpanded = !thinkingExpanded"
        >
          <span class="chevron">›</span>
          <span class="thinking-label">
            {{ streaming ? 'Thinking' : 'Thought' }}
          </span>
        </button>
        <div class="thinking-expand-wrapper" :class="{ 'is-expanded': thinkingExpanded }">
          <div class="thinking-expand-inner">
            <pre>{{ block.text }}</pre>
          </div>
        </div>
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
