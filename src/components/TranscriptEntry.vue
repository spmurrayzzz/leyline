<script setup>
import { ref } from 'vue'
import PierrePreview from './PierrePreview.vue'
import {
  entryClass,
  imageBlocksFor,
  imageSrc,
  messageBlocksFor,
  renderedBlock,
  renderedMessage,
  renderedToolJson,
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
  'edit',
  'fork',
  'mark-feedback',
  'navigate-child-session',
  'reset',
  'retry',
  'open-tool-fullscreen',
  'toggle-skill',
  'toggle-tool',
])

const feedbackDraft = ref('')
const noteOpen = ref(false)
const thinkingExpanded = ref(false)
const helpfulThumbPaths = [
  'M7 10v11',
  'M15 5.2 14 10h5.2a2 2 0 0 1 2 2.4l-1.4 6.8'
    + 'A2.2 2.2 0 0 1 17.6 21H7',
  'M7 10H4a1.5 1.5 0 0 0-1.5 1.5v8'
    + 'A1.5 1.5 0 0 0 4 21h3',
  'M14 10V5.2a2.2 2.2 0 0 0-2.2-2.2L7 10',
]
const unhelpfulThumbPaths = [
  'M17 14V3',
  'M9 18.8 10 14H4.8a2 2 0 0 1-2-2.4l1.4-6.8'
    + 'A2.2 2.2 0 0 1 6.4 3H17',
  'M17 14h3a1.5 1.5 0 0 0 1.5-1.5v-8'
    + 'A1.5 1.5 0 0 0 20 3h-3',
  'M10 14v4.8a2.2 2.2 0 0 0 2.2 2.2L17 14',
]

function toggleThinking() {
  thinkingExpanded.value = !thinkingExpanded.value
}

function copyTitle(id) {
  return props.copiedEntryId === id ? 'Copied' : 'Copy'
}

function copyGlyph(id) {
  return props.copiedEntryId === id ? '✓' : '⧉'
}

function isLocalEntry(entry) {
  return entry?.persisted === false
    || String(entry?.id || '').startsWith('local-')
}

function canEditEntry(entry) {
  return entry.role === 'user' && !isLocalEntry(entry)
}

function canMarkFeedback(entry) {
  return entry.role === 'assistant' && !isLocalEntry(entry)
}

function feedbackTitle(entry, label) {
  if (entry.rolloutFeedback === label) return 'Clear rollout mark'
  return label === 'helpful' ? 'Mark helpful' : 'Mark not helpful'
}

function feedbackClass(entry, label) {
  return {
    'is-selected': entry.rolloutFeedback === label,
    'is-helpful': label === 'helpful',
    'is-unhelpful': label === 'unhelpful',
  }
}

function markFeedback(entry, label) {
  const nextLabel = entry.rolloutFeedback === label ? '' : label
  if (!nextLabel) noteOpen.value = false
  emit('mark-feedback', entry, nextLabel, entry.rolloutFeedbackText || '')
}

function openFeedbackNote(entry) {
  feedbackDraft.value = entry.rolloutFeedbackText || ''
  noteOpen.value = true
}

function saveFeedbackNote(entry) {
  if (!entry.rolloutFeedback) return
  emit('mark-feedback', entry, entry.rolloutFeedback, feedbackDraft.value)
  noteOpen.value = false
}

function isSubagentEntry(entry) {
  return entry.type === 'tool' && entry.toolName === 'subagent'
}

function subagentStatus(result) {
  if (result.error || result.exitCode !== 0) return 'error'
  if (!result.messages.length && !result.childSession) return 'running'
  return 'completed'
}

function entrySubagentStatus(entry) {
  if (entry.subagentDetails?.background) return 'running'
  if (entry.isError || entry.subagentDetails?.results?.some((result) => subagentStatus(result) === 'error')) return 'error'
  return 'completed'
}

function subagentFinalOutput(result) {
  if (result.error) return result.error
  for (let i = result.messages.length - 1; i >= 0; i--) {
    const message = result.messages[i]
    if (message.role === 'assistant' || message.role === 'error') return message.content.trim()
  }
  return ''
}

function navigateChildSession(childSession) {
  if (!childSession) return
  emit('navigate-child-session', childSession)
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
    v-else-if="isSubagentEntry(entry)"
    class="tool-card subagent-card transcript-tool"
    :class="{ 'is-expanded': toolExpanded }"
    @click="emit('toggle-tool', entry)"
  >
    <div class="subagent-header">
      <span class="chevron">›</span>
      <span class="subagent-icon">↳</span>
      <span class="subagent-agent-name">{{ entry.label.replace('Subagent · ', '') }}</span>
      <code v-if="entry.code">{{ entry.code }}</code>
      <span
        class="subagent-status"
        :class="`status-${entrySubagentStatus(entry)}`"
      >
        {{ entrySubagentStatus(entry) }}
      </span>
      <button
        class="copy-button"
        type="button"
        :title="copyTitle(entry.id)"
        @click.stop="emit('copy', entry)"
      >
        {{ copyGlyph(entry.id) }}
      </button>
    </div>

    <div
      v-if="entry.subagentDetails?.results?.length"
      class="subagent-results"
    >
      <div
        v-for="(result, index) in entry.subagentDetails.results"
        :key="index"
        class="subagent-result-item"
        :class="{ 'has-session': result.childSession }"
        @click.stop="navigateChildSession(result.childSession)"
      >
        <span class="subagent-result-agent">{{ result.agent }}</span>
        <span class="subagent-result-task">{{ result.task }}</span>
        <span
          v-if="result.childSession"
          class="subagent-child-link"
        >
          → view session
        </span>
      </div>
    </div>

    <div class="tool-expand-wrapper" :class="{ 'is-expanded': toolExpanded }">
      <div class="tool-expand-inner">
        <div class="tool-expanded-body subagent-expanded" @click.stop>
          <div
            v-if="entry.isError && entry.text"
            class="tool-error-summary"
          >
            <strong>Error</strong>
            <pre>{{ entry.text }}</pre>
          </div>
          <template v-if="entry.subagentDetails?.results?.length">
            <div
              v-for="(result, index) in entry.subagentDetails.results"
              :key="index"
              class="subagent-detail-block"
            >
              <div class="subagent-detail-header">
                <strong>{{ result.agent }}</strong>
                <span class="subagent-detail-task">{{ result.task }}</span>
              </div>
              <pre v-if="subagentFinalOutput(result)" class="subagent-detail-output">{{ subagentFinalOutput(result) }}</pre>
              <div v-if="result.childSession" class="subagent-child-meta">
                <span>Session: {{ result.childSession.id }}</span>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="tool-preview-clip tool-plain-preview">
              <pre
                v-if="renderedToolJson(entry)"
                class="tool-output json-output"
                v-html="renderedToolJson(entry)"
              ></pre>
              <pre v-else class="tool-output">{{ entry.text }}</pre>
            </div>
          </template>
        </div>
      </div>
    </div>
  </article>

  <article
    v-else-if="entry.type === 'tool'"
    class="tool-card transcript-tool"
    :class="{ 'is-expanded': toolExpanded, 'error-card': entry.isError }"
    @click="emit('toggle-tool', entry)"
  >
    <div class="tool-card-header">
      <span class="chevron">›</span>
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
        title="Fork from here"
        @click.stop="emit('fork', entry)"
      >
        ⎇
      </button>
      <button
        class="copy-button reset-button"
        type="button"
        title="Reset to here"
        aria-label="reset this thread to this message"
        @click.stop="emit('reset', entry)"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="M6 19h12" />
        </svg>
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
    <div class="tool-expand-wrapper" :class="{ 'is-expanded': toolExpanded }">
      <div class="tool-expand-inner">
        <div class="tool-expanded-body" @click.stop>
          <div
            v-if="entry.isError && entry.preview && entry.text"
            class="tool-error-summary"
          >
            <strong>Error</strong>
            <pre>{{ entry.text }}</pre>
          </div>
          <template v-if="entry.preview?.kind === 'image'">
            <div class="tool-preview-clip tool-image-preview">
              <img :src="imageSrc(entry.preview)" alt="Read image preview" />
            </div>
          </template>
          <template v-else-if="entry.preview">
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
          <template v-else>
            <div class="tool-preview-clip tool-plain-preview">
              <pre
                v-if="renderedToolJson(entry)"
                class="tool-output json-output"
                v-html="renderedToolJson(entry)"
              ></pre>
              <pre v-else class="tool-output">{{ entry.text }}</pre>
            </div>
            <button
              class="tool-preview-cta"
              type="button"
              @click="emit('open-tool-fullscreen', entry)"
            >
              Open full screen
            </button>
          </template>
        </div>
      </div>
    </div>
  </article>

  <article
    v-else
    class="message compact-message transcript-message"
    :class="entryClass(entry)"
  >
    <div class="message-meta message-meta-row">
      <span>{{ entry.label }}</span>
      <div
        v-if="canMarkFeedback(entry)"
        class="turn-feedback"
        aria-label="rollout feedback"
      >
        <button
          class="feedback-button"
          :class="feedbackClass(entry, 'helpful')"
          type="button"
          :title="feedbackTitle(entry, 'helpful')"
          aria-label="mark helpful"
          @click="markFeedback(entry, 'helpful')"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              v-for="path in helpfulThumbPaths"
              :key="path"
              :d="path"
            />
          </svg>
        </button>
        <button
          class="feedback-button"
          :class="feedbackClass(entry, 'unhelpful')"
          type="button"
          :title="feedbackTitle(entry, 'unhelpful')"
          aria-label="mark not helpful"
          @click="markFeedback(entry, 'unhelpful')"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              v-for="path in unhelpfulThumbPaths"
              :key="path"
              :d="path"
            />
          </svg>
        </button>
        <button
          v-if="entry.rolloutFeedback"
          class="feedback-note-button"
          type="button"
          :title="entry.rolloutFeedbackText ? 'Edit note' : 'Add note'"
          :aria-label="entry.rolloutFeedbackText ? 'edit note' : 'add note'"
          @click="openFeedbackNote(entry)"
        >
          {{ entry.rolloutFeedbackText ? 'note' : '+ note' }}
        </button>
      </div>
      <button
        v-if="canEditEntry(entry)"
        class="copy-button"
        type="button"
        title="Edit message"
        @click="emit('edit', entry)"
      >
        ✎
      </button>
      <button
        v-if="canEditEntry(entry)"
        class="copy-button"
        type="button"
        title="Retry request"
        aria-label="retry this request"
        @click="emit('retry', entry)"
      >
        ↻
      </button>
      <button
        class="copy-button"
        type="button"
        title="Fork from here"
        @click="emit('fork', entry)"
      >
        ⎇
      </button>
      <button
        class="copy-button reset-button"
        type="button"
        title="Reset to here"
        aria-label="reset this thread to this message"
        @click="emit('reset', entry)"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="M6 19h12" />
        </svg>
      </button>
      <button
        class="copy-button"
        type="button"
        :title="copyTitle(entry.id)"
        @click="emit('copy', entry)"
      >
        {{ copyGlyph(entry.id) }}
      </button>
    </div>
    <div
      v-if="canMarkFeedback(entry) && entry.rolloutFeedback && noteOpen"
      class="feedback-note-popover"
    >
      <textarea
        v-model="feedbackDraft"
        placeholder="Optional rollout feedback..."
        rows="3"
      ></textarea>
      <div class="feedback-note-actions">
        <button type="button" @click="noteOpen = false">Cancel</button>
        <button type="button" @click="saveFeedbackNote(entry)">Save</button>
      </div>
    </div>
    <template v-if="entry.role === 'assistant' && entry.blocks?.length">
      <template
        v-for="(block, index) in messageBlocksFor(entry)"
        :key="`${entry.id}-${index}`"
      >
        <div
          v-if="block.type === 'thinking'"
          class="thinking-block"
          :class="{ 'is-expanded': thinkingExpanded }"
        >
          <button
            class="thinking-trigger"
            type="button"
            @click="toggleThinking"
          >
            <span class="chevron">›</span>
            <span class="thinking-label">Thought</span>
          </button>
          <div class="thinking-expand-wrapper" :class="{ 'is-expanded': thinkingExpanded }">
            <div class="thinking-expand-inner">
              <pre>{{ block.text }}</pre>
            </div>
          </div>
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
      <div class="skill-expand-wrapper" :class="{ 'is-expanded': skillExpanded }">
        <div class="skill-expand-inner">
          <div
            class="skill-expanded entry-text markdown-body"
            v-html="renderedMessage(entry)"
          ></div>
        </div>
      </div>
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
