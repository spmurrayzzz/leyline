<script setup>
import PierrePreview from './PierrePreview.vue'
import {
  entryClass,
  imageBlocksFor,
  imageSrc,
  messageBlocksFor,
  renderedBlock,
  renderedMessage,
  skillSummaries,
} from '../lib/transcript'

const props = defineProps({
  copiedEntryId: {
    type: String,
    default: '',
  },
  entry: {
    type: Object,
    required: true,
  },
  skillExpanded: Boolean,
  toolExpanded: Boolean,
})

const emit = defineEmits([
  'copy',
  'open-tool-fullscreen',
  'toggle-skill',
  'toggle-tool',
])

function copyTitle(id) {
  return props.copiedEntryId === id ? 'Copied' : 'Copy'
}

function copyGlyph(id) {
  return props.copiedEntryId === id ? '✓' : '⧉'
}
</script>

<template>
  <div v-if="entry.type === 'event'" class="event-row">
    <span>{{ entry.label }}</span>
    <strong>{{ entry.text }}</strong>
    <button
      class="copy-button"
      type="button"
      :title="copyTitle(entry.id)"
      @click="emit('copy', entry)"
    >
      {{ copyGlyph(entry.id) }}
    </button>
  </div>

  <article
    v-else-if="entry.type === 'tool'"
    class="tool-card transcript-tool"
    :class="{ 'error-card': entry.isError }"
    @click="emit('toggle-tool', entry)"
  >
    <div class="tool-card-header">
      <span>{{ toolExpanded ? '⌄' : '›' }}</span>
      <span>{{ entry.label }}</span>
      <code v-if="entry.code">{{ entry.code }}</code>
      <span
        v-if="entry.contextLabel"
        class="tool-context-pill"
        :class="{ 'is-excluded': entry.excludeFromContext }"
      >
        {{ entry.contextLabel }}
      </span>
      <em>{{ entry.isError ? 'error' : 'completed' }}</em>
      <button
        v-if="entry.preview"
        class="copy-button"
        type="button"
        title="Open full screen"
        @click.stop="emit('open-tool-fullscreen', entry)"
      >
        ⛶
      </button>
      <button
        class="copy-button"
        type="button"
        :title="copyTitle(entry.id)"
        @click.stop="emit('copy', entry)"
      >
        {{ copyGlyph(entry.id) }}
      </button>
    </div>
    <div v-if="toolExpanded" class="tool-expanded-body" @click.stop>
      <template v-if="entry.preview">
        <div class="tool-preview-clip">
          <PierrePreview :preview="entry.preview" clipped />
          <div class="tool-preview-fade"></div>
        </div>
        <button
          class="tool-preview-cta"
          type="button"
          @click="emit('open-tool-fullscreen', entry)"
        >
          Open full screen
        </button>
      </template>
      <pre v-else class="tool-output">{{ entry.text }}</pre>
    </div>
  </article>

  <article
    v-else
    class="message compact-message transcript-message"
    :class="entryClass(entry)"
  >
    <div class="message-meta message-meta-row">
      <span>{{ entry.label }}</span>
      <button
        class="copy-button"
        type="button"
        :title="copyTitle(entry.id)"
        @click="emit('copy', entry)"
      >
        {{ copyGlyph(entry.id) }}
      </button>
    </div>
    <template v-if="entry.role === 'assistant' && entry.blocks?.length">
      <template
        v-for="(block, index) in messageBlocksFor(entry)"
        :key="`${entry.id}-${index}`"
      >
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
    </template>
    <div v-else-if="skillSummaries(entry).length" class="skill-summary-list">
      <button
        v-for="skill in skillSummaries(entry)"
        :key="skill.name"
        class="skill-summary"
        type="button"
        :title="skill.location"
        @click="emit('toggle-skill', entry)"
      >
        <span>[skill]</span>
        <strong>{{ skill.name }}</strong>
        <em>{{ skillExpanded ? 'hide' : 'expand' }}</em>
      </button>
      <div
        v-if="skillExpanded"
        class="skill-expanded entry-text markdown-body"
        v-html="renderedMessage(entry)"
      ></div>
    </div>
    <div v-else class="entry-text markdown-body" v-html="renderedMessage(entry)">
    </div>
    <div v-if="imageBlocksFor(entry).length" class="message-images">
      <img
        v-for="(image, index) in imageBlocksFor(entry)"
        :key="`${entry.id}-image-${index}`"
        :src="imageSrc(image)"
        alt="Attached image"
      />
    </div>
  </article>
</template>
