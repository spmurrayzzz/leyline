<script setup>
import { computed, ref } from 'vue'
import { formatMode, modelChip } from '../lib/format'

const props = defineProps({
  agentRunning: Boolean,
  attachedImages: {
    type: Array,
    default: () => [],
  },
  availableModels: {
    type: Array,
    default: () => [],
  },
  availableThinkingLevels: {
    type: Array,
    default: () => [],
  },
  canSubmitDraft: Boolean,
  compacting: Boolean,
  chips: {
    type: Array,
    default: () => [],
  },
  currentMobileModelLabel: {
    type: String,
    default: '',
  },
  currentMobileThinkingLabel: {
    type: String,
    default: '',
  },
  currentModelLabel: {
    type: String,
    default: '',
  },
  currentThinkingLabel: {
    type: String,
    default: '',
  },
  contextUsageLabel: {
    type: String,
    default: '',
  },
  contextUsageLevel: {
    type: String,
    default: 'normal',
  },
  contextUsagePercent: {
    type: Number,
    default: 0,
  },
  contextUsageTitle: {
    type: String,
    default: '',
  },
  draft: {
    type: String,
    default: '',
  },
  editingLabel: {
    type: String,
    default: '',
  },
  error: {
    type: String,
    default: '',
  },
  interrupting: Boolean,
  modelKey: {
    type: Function,
    required: true,
  },
  modelPickerOpen: Boolean,
  promptSubmitting: Boolean,
  queuedMessages: {
    type: Object,
    default: () => ({ steering: [], followUp: [] }),
  },
  placeholder: {
    type: String,
    default: 'Ask for follow-up changes or attach images',
  },
  reloadingSession: Boolean,
  selectedModelKey: {
    type: String,
    default: '',
  },
  sendButtonLabel: {
    type: String,
    default: '',
  },
  slashActiveIndex: {
    type: Number,
    default: 0,
  },
  slashCommandItems: {
    type: Array,
    default: () => [],
  },
  slashCommandSourceLabel: {
    type: Function,
    required: true,
  },
  slashPickerOpen: Boolean,
  switchingModel: Boolean,
  switchingThinking: Boolean,
  terminalOpen: Boolean,
  terminalStatus: {
    type: String,
    default: 'closed',
  },
  thinkingLevel: {
    type: String,
    default: '',
  },
  thinkingPickerOpen: Boolean,
})

const emit = defineEmits([
  'cancel-edit',
  'interrupt',
  'keydown',
  'paste',
  'remove-image',
  'select-model',
  'select-slash-command',
  'select-thinking',
  'show-slash-picker',
  'submit',
  'toggle-picker',
  'toggle-terminal',
  'update:draft',
])

const form = ref(null)
const textarea = ref(null)
const shellMode = computed(() => props.draft.trimStart().startsWith('!'))
const hiddenShellMode = computed(() => props.draft.trimStart().startsWith('!!'))
const shellModeLabel = computed(() => {
  return hiddenShellMode.value ? 'shell · hidden' : 'shell · context'
})

function focus() {
  if (props.promptSubmitting
    || props.reloadingSession
    || props.compacting) return
  textarea.value?.focus()
}

defineExpose({ focus, form })

function updateDraft(event) {
  emit('update:draft', event.target.value)
  emit('show-slash-picker')
}
</script>

<template>
  <form
    ref="form"
    class="composer"
    :class="{
      'shell-mode-composer': shellMode,
      'hidden-shell-mode-composer': hiddenShellMode,
    }"
    @submit.prevent="emit('submit')"
  >
    <div v-if="editingLabel" class="editing-banner">
      <span>{{ editingLabel }}</span>
      <button type="button" @click="emit('cancel-edit')">Cancel</button>
    </div>
    <div
      v-if="queuedMessages.steering.length || queuedMessages.followUp.length"
      class="queued-message-drawer"
    >
      <div
        v-for="(message, index) in queuedMessages.steering"
        :key="`steering-${index}-${message}`"
        class="queued-message-row"
      >
        <span>Steering</span>
        <strong>{{ message }}</strong>
      </div>
      <div
        v-for="(message, index) in queuedMessages.followUp"
        :key="`follow-up-${index}-${message}`"
        class="queued-message-row"
      >
        <span>Follow-up</span>
        <strong>{{ message }}</strong>
      </div>
      <div class="queued-message-hint">
        Enter queues steering · Option+Enter queues follow-up
      </div>
    </div>
    <div class="composer-input-shell">
      <span v-if="shellMode" class="shell-prompt-glyph">$</span>
      <textarea
        ref="textarea"
        :value="draft"
        :disabled="promptSubmitting || reloadingSession || compacting"
        :placeholder="placeholder"
        @keydown="emit('keydown', $event)"
        @input="updateDraft"
        @paste="emit('paste', $event)"
      ></textarea>
    </div>
    <div v-if="slashPickerOpen" class="slash-picker">
      <button
        v-for="(command, index) in slashCommandItems"
        :key="`${command.source}-${command.name}`"
        type="button"
        :class="{ active: index === slashActiveIndex }"
        @mousedown.prevent="emit('select-slash-command', command)"
      >
        <span class="slash-command-name">/{{ command.name }}</span>
        <span class="slash-command-description">
          {{ command.description || 'No description' }}
        </span>
        <span class="slash-command-source">
          {{ slashCommandSourceLabel(command.source) }}
        </span>
      </button>
    </div>
    <div v-if="attachedImages.length" class="attachment-tray">
      <div
        v-for="(image, index) in attachedImages"
        :key="`${image.mimeType}-${index}`"
        class="attachment-chip"
      >
        <img :src="image.preview" alt="Pasted image" />
        <button type="button" @click="emit('remove-image', index)">×</button>
      </div>
    </div>
    <div v-if="error" class="composer-error">{{ error }}</div>
    <div class="composer-bar">
      <div class="composer-primary-row">
        <div class="composer-row-spacer"></div>
        <div class="composer-actions">
          <div class="model-picker">
            <button
              class="composer-chip model-picker-button"
              type="button"
              :disabled="agentRunning
                || compacting
                || promptSubmitting
                || reloadingSession
                || switchingModel"
              @click="emit('toggle-picker', 'model')"
            >
              <span class="model-label desktop-label">
                {{ currentModelLabel }}
              </span>
              <span class="model-label mobile-label">
                {{ currentMobileModelLabel }}
              </span>
              <span class="model-caret">▾</span>
            </button>
            <div v-if="modelPickerOpen" class="model-menu">
              <button
                v-for="model in availableModels"
                :key="modelKey(model)"
                type="button"
                :class="{ active: modelKey(model) === selectedModelKey }"
                @click="emit('select-model', model)"
              >
                <span>{{ modelChip(model) }}</span>
                <span v-if="modelKey(model) === selectedModelKey">✓</span>
              </button>
            </div>
          </div>
          <div class="model-picker small-picker">
            <button
              class="composer-chip model-picker-button"
              type="button"
              :disabled="agentRunning
                || compacting
                || promptSubmitting
                || reloadingSession
                || switchingThinking"
              @click="emit('toggle-picker', 'thinking')"
            >
              <span class="model-label desktop-label">
                {{ currentThinkingLabel }}
              </span>
              <span class="model-label mobile-label">
                {{ currentMobileThinkingLabel }}
              </span>
              <span class="model-caret">▾</span>
            </button>
            <div v-if="thinkingPickerOpen" class="model-menu small-menu">
              <button
                v-for="level in availableThinkingLevels"
                :key="level"
                type="button"
                :class="{ active: level === thinkingLevel }"
                @click="emit('select-thinking', level)"
              >
                <span>{{ formatMode(level) }}</span>
                <span v-if="level === thinkingLevel">✓</span>
              </button>
            </div>
          </div>
          <button
            class="send-button"
            :class="{
              'stop-button': agentRunning,
              'shell-run-button': shellMode,
            }"
            :type="agentRunning ? 'button' : 'submit'"
            :disabled="agentRunning
              ? interrupting || compacting
              : compacting
                || promptSubmitting
                || reloadingSession
                || !canSubmitDraft"
            :title="agentRunning
              ? 'Stop generation'
              : shellMode ? 'Run shell command' : 'Send message'"
            @click="agentRunning && emit('interrupt')"
          >
            {{ sendButtonLabel }}
          </button>
        </div>
      </div>
      <div class="composer-context-row">
        <span
          v-if="shellMode"
          class="composer-chip shell-mode-chip"
          :class="{ 'hidden-shell-mode-chip': hiddenShellMode }"
        >
          {{ shellModeLabel }}
        </span>
        <span v-for="chip in chips" :key="chip" class="composer-chip">
          {{ chip }}
        </span>
        <span
          v-if="contextUsageLabel"
          class="composer-chip context-usage-pill composer-context-usage"
          :class="`is-${contextUsageLevel}`"
          :title="contextUsageTitle"
        >
          <span>{{ contextUsageLabel }}</span>
          <i>
            <b :style="{ width: `${contextUsagePercent}%` }"></b>
          </i>
        </span>
        <button
          class="terminal-toggle-button"
          type="button"
          :class="{ active: terminalOpen }"
          :title="terminalOpen
            ? `Close terminal (${terminalStatus})`
            : 'Open terminal'"
          :aria-label="terminalOpen ? 'Close terminal' : 'Open terminal'"
          @click="emit('toggle-terminal')"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M17 15H12M7 10L10 12.5L7 15M3 15.8002V8.2002C3 7.08009 3 6.51962 3.21799 6.0918C3.40973 5.71547 3.71547 5.40973 4.0918 5.21799C4.51962 5 5.08009 5 6.2002 5H17.8002C18.9203 5 19.4796 5 19.9074 5.21799C20.2837 5.40973 20.5905 5.71547 20.7822 6.0918C21 6.5192 21 7.07899 21 8.19691V15.8031C21 16.921 21 17.48 20.7822 17.9074C20.5905 18.2837 20.2837 18.5905 19.9074 18.7822C19.48 19 18.921 19 17.8031 19H6.19691C5.07899 19 4.5192 19 4.0918 18.7822C3.71547 18.5905 3.40973 18.2837 3.21799 17.9074C3 17.4796 3 16.9203 3 15.8002Z"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            ></path>
          </svg>
        </button>
      </div>
    </div>
  </form>
</template>
