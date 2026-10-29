<script>
import { defineAsyncComponent } from 'vue'

const PierrePreview = defineAsyncComponent(() => import('./PierrePreview.vue'))
</script>

<script setup>
import { computed, ref, watch } from 'vue'
import CopyIcon from './CopyIcon.vue'
import { mobileToolStatus, toolStatusTone } from '../../lib/tool-activity.js'
import { researchSourcesMatch } from '../../lib/research-state.js'
import { systemPromptInfo } from '../../lib/system-prompt.js'
import { subagentCallTitle } from '../../lib/subagent-view.js'
import {
  entryClass,
  imageBlocksFor,
  imageSrc,
  messageBlocksFor,
  parseSkillPrompt,
  renderedBlock,
  renderedMessage,
  renderedText,
  renderedToolJson,
  skillReadName,
  skillSummaries,
  toolCommandCode,
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
  researchCwd: {
    type: String,
    default: '',
  },
  skillExpanded: Boolean,
  systemPromptSelected: Boolean,
  subagentInspectorSelected: Boolean,
  thinkingInitiallyExpanded: Boolean,
  toolExpanded: Boolean,
  toolStatus: {
    type: String,
    default: '',
  },
})

const emit = defineEmits([
  'copy',
  'edit',
  'fork',
  'mark-feedback',
  'inspect-subagent',
  'open-image',
  'open-research-source',
  'open-system-prompt',
  'reset',
  'retry',
  'open-tool-fullscreen',
  'toggle-skill',
  'toggle-tool',
])

const feedbackDraft = ref('')
const noteOpen = ref(false)
const thinkingExpanded = ref(props.thinkingInitiallyExpanded)
const thinkingContentMounted = ref(props.thinkingInitiallyExpanded)
const skillContentMounted = ref(props.skillExpanded)
const toolContentMounted = ref(props.toolExpanded)
const systemInfo = computed(() => systemPromptInfo(props.entry))
const toolJsonHtml = computed(() => renderedToolJson(props.entry))
const skills = computed(() => skillSummaries(props.entry))
const skillName = computed(() => skillReadName(props.entry))

watch(thinkingExpanded, (expanded) => {
  if (expanded) thinkingContentMounted.value = true
})

watch(() => props.skillExpanded, (expanded) => {
  if (expanded) skillContentMounted.value = true
})

watch(() => props.toolExpanded, (expanded) => {
  if (expanded) toolContentMounted.value = true
})
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

function skillContent(entry) {
  return parseSkillPrompt(entry.text)?.content || entry.text || ''
}

function skillUserMessage(entry) {
  return parseSkillPrompt(entry.text)?.userMessage || ''
}

function copyTitle(id) {
  return props.copiedEntryId === id ? 'Copied' : 'Copy'
}

function isLocalEntry(entry) {
  return entry?.persisted === false
    || String(entry?.id || '').startsWith('local-')
}

function hasToolResult(entry) {
  return Boolean(entry.text || entry.preview)
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

function entryToolStatus(entry) {
  return mobileToolStatus(entry, props.toolStatus)
}

const toolTone = computed(() => toolStatusTone(entryToolStatus(props.entry)))
const skillStatus = computed(() => ({
  completed: 'Loaded',
  running: 'Loading',
  error: 'Failed',
  stopped: 'Stopped',
  unknown: 'Unknown',
})[toolTone.value])

function citationTarget(value) {
  try {
    return decodeURI(value)
  } catch {
    return value
  }
}

function openMarkdownContent(event) {
  const image = event.target?.closest?.('img')
  if (image) {
    event.preventDefault()
    emit(
      'open-image',
      image.currentSrc || image.src,
      image.alt || 'Transcript image',
    )
    return
  }

  const link = event.target?.closest?.('a')
  if (!link || !props.entry.researchReport) return
  const match = link.textContent?.trim().match(/^\[?(\d+)\]?$/)
  if (!match) return
  const id = Number(match[1])
  const source = props.entry.researchReport.sources?.find((item) => {
    return item.id === id
  })
  if (!source) return
  const target = citationTarget(link.getAttribute('data-local-file') || link.getAttribute('href') || '')
  const targetSource = /^https?:\/\//i.test(target)
    ? { url: target }
    : { path: target }
  if (!researchSourcesMatch(source, targetSource, props.researchCwd)) return
  event.preventDefault()
  const rect = link.getBoundingClientRect()
  emit('open-research-source', {
    anchor: link,
    id,
    origin: 'citation',
    rect: {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width,
    },
    source,
    url: link.href,
  })
}
</script>

<template>
  <div v-if="entry.type === 'model-change'" class="model-change-row">
    <span class="model-change-label">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z" />
        <path d="m3 8 9 5 9-5M12 13v8M8 5l9 5" />
      </svg>
      <span>
        Model changed from
        <strong :title="`${entry.fromModel.provider}/${entry.fromModel.id}`">{{ entry.fromModel.name }}</strong>
        to
        <strong :title="`${entry.toModel.provider}/${entry.toModel.id}`">{{ entry.toModel.name }}</strong>
      </span>
    </span>
  </div>

  <div v-else-if="entry.type === 'event'" class="event-row">
    <span>{{ entry.label }}</span>
    <strong>{{ entry.text }}</strong>
    <button
      class="copy-button"
      type="button"
      :title="copyTitle(entry.id)"
      @click="emit('copy', entry)"
    >
      <CopyIcon :copied="copiedEntryId === entry.id" />
    </button>
  </div>

  <div v-else-if="entry.type === 'system'" class="system-prompt-row">
    <button
      class="system-prompt-trigger"
      type="button"
      :aria-expanded="systemPromptSelected"
      :aria-controls="systemPromptSelected ? 'system-prompt-inspector' : undefined"
      :title="`${systemInfo.title} · ${systemInfo.summary}`"
      @click="emit('open-system-prompt', entry, $event.currentTarget)"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 3H5v18h14V8l-5-5Z" />
        <path d="M14 3v5h5M8 12h8M8 16h6" />
      </svg>
      <span class="system-prompt-label">{{ systemInfo.title }}</span>
      <span class="system-prompt-meta">· {{ systemInfo.summary }}</span>
      <svg class="system-prompt-open-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </svg>
    </button>
  </div>

  <article
    v-else-if="isSubagentEntry(entry)"
    class="tool-card subagent-card transcript-tool"
    :class="{ 'is-inspected': subagentInspectorSelected }"
  >
    <div class="subagent-header">
      <button
        class="tool-inspect-button"
        type="button"
        aria-haspopup="dialog"
        :aria-expanded="subagentInspectorSelected"
        :aria-controls="subagentInspectorSelected ? 'subagent-inspector' : undefined"
        @click="emit('inspect-subagent', entry, $event)"
      >
        <span class="subagent-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M3 2.5v4A3.5 3.5 0 0 0 6.5 10H13" />
            <path d="m10 7 3 3-3 3" />
          </svg>
        </span>
        <span class="subagent-label">{{ entry.researchThreads ? 'Research threads' : 'Subagent' }}</span>
        <span class="subagent-call-title" :title="subagentCallTitle(entry)">{{ subagentCallTitle(entry) }}</span>
        <svg class="subagent-inspect-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13 4h7v7M20 4 10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" />
        </svg>
      </button>
    </div>
  </article>

  <article
    v-else-if="entry.type === 'tool'"
    class="tool-card transcript-tool"
    :class="{ 'is-expanded': toolExpanded, 'skill-tool-card': skillName, 'error-card': ['error', 'failed'].includes(entryToolStatus(entry)) }"
  >
    <div class="tool-card-header">
      <button
        class="tool-expand-button"
        type="button"
        :aria-expanded="toolExpanded"
        @click="emit('toggle-tool', entry)"
      >
        <svg v-if="skillName" class="skill-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m8 5-4 7 4 7m8-14 4 7-4 7M14 4l-4 16" />
        </svg>
        <span v-else class="chevron">›</span>
        <span class="tool-label" :title="skillName ? entry.preview?.path || entry.code : undefined">{{ skillName || entry.label }}</span>
        <svg v-if="skillName" class="chevron skill-tool-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 5 7 7-7 7" />
        </svg>
        <code v-if="entry.code && !skillName" :title="entry.code">{{ entry.code }}</code>
        <span
          v-if="entry.contextLabel"
          class="tool-context-pill"
          :class="{ 'is-excluded': entry.excludeFromContext }"
        >
          {{ entry.contextLabel }}
        </span>
        <span
          class="tool-status-mark"
          :class="`status-${toolTone}`"
          :title="skillName ? skillStatus : entryToolStatus(entry)"
          role="img"
          :aria-label="skillName ? skillStatus : entryToolStatus(entry)"
        >
          <span v-if="toolTone === 'running'" class="tool-status-spinner" aria-hidden="true"></span>
          <svg v-else-if="toolTone === 'completed'" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.1 8.5 6.4 11.7 12.9 4.4" />
          </svg>
          <svg v-else-if="toolTone === 'error'" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.3 4.3 11.7 11.7M11.7 4.3 4.3 11.7" />
          </svg>
          <svg v-else-if="toolTone === 'stopped'" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 5h6v6H5z" />
          </svg>
          <span v-else class="tool-status-question" aria-hidden="true">?</span>
          <span v-if="skillName" class="skill-tool-status" aria-hidden="true">{{ skillStatus }}</span>
        </span>
      </button>
      <button
        v-if="hasToolResult(entry)"
        class="copy-button"
        type="button"
        title="Open full screen"
        @click.stop="emit('open-tool-fullscreen', entry, $event)"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <path d="M8 3H3v5m13-5h5v5m0 8v5h-5M3 16v5h5" />
        </svg>
      </button>
      <button
        v-if="!isLocalEntry(entry)"
        class="copy-button"
        type="button"
        title="Fork from here"
        @click.stop="emit('fork', entry)"
      >
        ⎇
      </button>
      <button
        v-if="!isLocalEntry(entry)"
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
        v-if="hasToolResult(entry)"
        class="copy-button"
        type="button"
        :title="copyTitle(entry.id)"
        @click.stop="emit('copy', entry)"
      >
        <CopyIcon :copied="copiedEntryId === entry.id" />
      </button>
    </div>
    <div class="tool-expand-wrapper" :class="{ 'is-expanded': toolExpanded }">
      <div class="tool-expand-inner">
        <div
          v-if="toolContentMounted"
          class="tool-expanded-body"
          @click.stop
        >
          <div v-if="entry.code && !toolCommandCode(entry)" class="mobile-tool-target"><code>{{ entry.preview?.path || entry.code }}</code></div>
          <div v-if="toolCommandCode(entry)" class="tool-command-block">
            <strong>Command</strong>
            <pre>{{ entry.code }}</pre>
          </div>
          <div
            v-if="entry.isError && entry.preview && entry.text"
            class="tool-error-summary"
          >
            <strong>Error</strong>
            <pre>{{ entry.text }}</pre>
          </div>
          <template v-if="entry.preview?.kind === 'image'">
            <button
              class="tool-preview-clip tool-image-preview tool-image-preview-button"
              type="button"
              aria-label="Open read image preview"
              @click="emit(
                'open-image',
                imageSrc(entry.preview),
                'Read image preview',
                $event,
                entry.preview,
              )"
            >
              <img :src="imageSrc(entry.preview)" alt="Read image preview" />
            </button>
          </template>
          <template v-else-if="entry.preview">
            <div class="tool-preview-clip">
              <PierrePreview :preview="entry.preview" clipped />
              <div class="tool-preview-fade"></div>
            </div>
            <button
              class="tool-preview-cta"
              type="button"
              @click="emit('open-tool-fullscreen', entry, $event)"
            >
              Open full screen
            </button>
          </template>
          <template v-else-if="hasToolResult(entry)">
            <div class="tool-preview-clip tool-plain-preview">
              <pre
                v-if="toolJsonHtml"
                class="tool-output json-output"
                v-html="toolJsonHtml"
              ></pre>
              <pre v-else class="tool-output">{{ entry.text }}</pre>
            </div>
            <button
              class="tool-preview-cta"
              type="button"
              @click="emit('open-tool-fullscreen', entry, $event)"
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
    :class="[entryClass(entry), { 'has-feedback-note': noteOpen, 'skill-message': skills.length }]"
  >
    <div v-if="skills.length" class="skill-message-header">
      <button
        v-for="skill in skills"
        :key="skill.name"
        class="skill-summary"
        type="button"
        :title="skill.location"
        :aria-expanded="skillExpanded"
        @click="emit('toggle-skill', entry)"
      >
        <svg class="skill-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m8 5-4 7 4 7m8-14 4 7-4 7M14 4l-4 16" />
        </svg>
        <strong>{{ skill.name }}</strong>
        <span class="skill-kind">Skill</span>
        <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 5 7 7-7 7" />
        </svg>
      </button>
      <div class="skill-expand-wrapper" :class="{ 'is-expanded': skillExpanded }">
        <div class="skill-expand-inner">
          <div
            v-if="skillContentMounted"
            class="skill-expanded entry-text markdown-body"
            v-html="renderedText(skillContent(entry))"
            @click="openMarkdownContent"
          ></div>
        </div>
      </div>
    </div>
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
        <CopyIcon :copied="copiedEntryId === entry.id" />
      </button>
    </div>
    <div
      v-if="entry.researchReport"
      class="research-report-heading"
    >
      <span class="research-report-icon">R</span>
      <span>
        <strong>{{ entry.researchReport.title }}</strong>
        <small>
          Markdown report · {{ entry.researchReport.sourceCount }} sources ·
          {{ entry.researchReport.citedSourceCount }} cited
        </small>
      </span>
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
              <pre v-if="thinkingContentMounted">{{ block.text }}</pre>
            </div>
          </div>
        </div>
        <div
          v-else
          class="entry-text markdown-body assistant-text-block"
          v-html="renderedBlock(block)"
          @click="openMarkdownContent"
        ></div>
      </template>
    </template>
    <div v-else-if="skills.length">
      <div
        v-if="skillUserMessage(entry)"
        class="entry-text markdown-body"
        v-html="renderedText(skillUserMessage(entry))"
        @click="openMarkdownContent"
      ></div>
    </div>
    <div
      v-else
      class="entry-text markdown-body"
      v-html="renderedMessage(entry)"
      @click="openMarkdownContent"
    ></div>
    <div v-if="imageBlocksFor(entry).length" class="message-images">
      <button
        v-for="(image, index) in imageBlocksFor(entry)"
        :key="`${entry.id}-image-${index}`"
        class="message-image-button"
        type="button"
        :aria-label="`Open attached image ${index + 1}`"
        @click="emit(
          'open-image',
          imageSrc(image),
          `Attached image ${index + 1}`,
        )"
      >
        <img :src="imageSrc(image)" alt="Attached image" />
      </button>
    </div>
  </article>
</template>
