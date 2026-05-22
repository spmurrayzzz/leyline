<script setup>
import { ref } from 'vue'
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
  'update:draft',
])

const textarea = ref(null)

function focus() {
  if (props.promptSubmitting || props.reloadingSession) return
  textarea.value?.focus()
}

defineExpose({ focus })

function updateDraft(event) {
  emit('update:draft', event.target.value)
  emit('show-slash-picker')
}
</script>

<template>
  <form class="composer" @submit.prevent="emit('submit')">
    <div v-if="editingLabel" class="editing-banner">
      <span>{{ editingLabel }}</span>
      <button type="button" @click="emit('cancel-edit')">Cancel</button>
    </div>
    <textarea
      ref="textarea"
      :value="draft"
      :disabled="promptSubmitting || reloadingSession"
      placeholder="Ask for follow-up changes or attach images"
      @keydown="emit('keydown', $event)"
      @input="updateDraft"
      @paste="emit('paste', $event)"
    ></textarea>
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
            :class="{ 'stop-button': agentRunning }"
            :type="agentRunning ? 'button' : 'submit'"
            :disabled="agentRunning
              ? interrupting
              : promptSubmitting || reloadingSession || !canSubmitDraft"
            :title="agentRunning ? 'Stop Leyline' : 'Send message'"
            @click="agentRunning && emit('interrupt')"
          >
            {{ sendButtonLabel }}
          </button>
        </div>
      </div>
      <div class="composer-context-row">
        <span v-for="chip in chips" :key="chip" class="composer-chip">
          {{ chip }}
        </span>
      </div>
    </div>
  </form>
</template>
