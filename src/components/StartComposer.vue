<script setup>
import { computed } from 'vue'
import { formatMode, modelChip } from '../lib/format'

const props = defineProps({
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
  chips: {
    type: Array,
    default: () => [],
  },
  creatingSessionCwd: {
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
  imageSupportWarning: {
    type: String,
    default: '',
  },
  modelKey: {
    type: Function,
    required: true,
  },
  modelPickerOpen: Boolean,
  newSessionCwd: {
    type: String,
    default: '',
  },
  selectedModelKey: {
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
  startProjectLabel: {
    type: String,
    default: '',
  },
  startProjectOptions: {
    type: Array,
    default: () => [],
  },
  startProjectPickerOpen: Boolean,
  startProjectQuery: {
    type: String,
    default: '',
  },
  switchingModel: Boolean,
  switchingThinking: Boolean,
  thinkingLevel: {
    type: String,
    default: '',
  },
  thinkingPickerOpen: Boolean,
})

const emit = defineEmits([
  'keydown',
  'open-project-browser',
  'paste',
  'remove-image',
  'select-model',
  'select-project',
  'select-slash-command',
  'select-thinking',
  'show-slash-picker',
  'submit',
  'toggle-picker',
  'toggle-project-picker',
  'update:draft',
  'update:startProjectQuery',
])

const shellMode = computed(() => props.draft.trimStart().startsWith('!'))
const hiddenShellMode = computed(() => props.draft.trimStart().startsWith('!!'))
const shellCommand = computed(() => {
  const text = props.draft.trimStart()
  if (!text.startsWith('!')) return ''
  return text.slice(text.startsWith('!!') ? 2 : 1).trim()
})
const shellModeLabel = computed(() => {
  return hiddenShellMode.value ? 'shell · hidden' : 'shell · context'
})

function updateDraft(event) {
  emit('update:draft', event.target.value)
  emit('show-slash-picker')
}
</script>

<template>
  <form
    class="start-composer"
    :class="{
      'shell-mode-composer': shellMode,
      'hidden-shell-mode-composer': hiddenShellMode,
    }"
    @submit.prevent="emit('submit')"
  >
    <div class="composer-input-shell">
      <span v-if="shellMode" class="shell-prompt-glyph">$</span>
      <textarea
        :value="draft"
        placeholder="Ask Leyline anything"
        :disabled="!!creatingSessionCwd"
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
    <div v-if="imageSupportWarning" class="composer-error">
      {{ imageSupportWarning }}
    </div>
    <div class="start-composer-bar">
      <div class="composer-primary-row">
        <div class="composer-row-spacer"></div>
        <div class="composer-actions">
          <div class="model-picker start-picker">
            <button
              class="composer-chip model-picker-button start-composer-chip"
              type="button"
              :disabled="switchingModel || availableModels.length === 0"
              @click="emit('toggle-picker', 'model')"
            >
              <span class="model-label">{{ currentModelLabel }}</span>
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
          <div class="model-picker small-picker start-picker">
            <button
              class="composer-chip model-picker-button start-composer-chip"
              type="button"
              :disabled="switchingThinking || !availableThinkingLevels.length"
              @click="emit('toggle-picker', 'thinking')"
            >
              <span class="model-label">{{ currentThinkingLabel }}</span>
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
            class="start-send-button"
            :class="{ 'shell-run-button': shellMode }"
            type="submit"
            :title="shellMode ? 'Run shell command' : 'Send message'"
            :disabled="!newSessionCwd.trim()
              || !!creatingSessionCwd
              || (shellMode && (!shellCommand || attachedImages.length))"
          >{{ shellMode ? 'Run' : '↑' }}</button>
        </div>
      </div>
      <div class="composer-context-row">
        <button
          class="start-project-button"
          type="button"
          @click="emit('toggle-project-picker')"
        >
          <span class="start-project-icon">▱</span>
          <span class="start-project-label">{{ startProjectLabel }}</span>
          <span class="model-caret">▾</span>
        </button>
        <span
          v-if="shellMode"
          class="composer-chip start-composer-chip shell-mode-chip"
          :class="{ 'hidden-shell-mode-chip': hiddenShellMode }"
        >
          {{ shellModeLabel }}
        </span>
        <span
          v-for="chip in chips"
          :key="chip"
          class="composer-chip start-composer-chip"
        >
          {{ chip }}
        </span>
      </div>
    </div>
    <div v-if="startProjectPickerOpen" class="start-project-menu">
      <label>
        <span>⌕</span>
        <input
          :value="startProjectQuery"
          placeholder="Search projects"
          @input="emit('update:startProjectQuery', $event.target.value)"
        />
      </label>
      <button
        v-for="project in startProjectOptions"
        :key="project.cwd"
        type="button"
        @click="emit('select-project', project.cwd)"
      >
        <span>▱</span>
        <strong>{{ project.name }}</strong>
        <em v-if="project.cwd === newSessionCwd">✓</em>
      </button>
      <div class="start-project-divider"></div>
      <button type="button" @click="emit('open-project-browser')">
        <span>＋</span>
        <strong>Add new project</strong>
      </button>
    </div>
  </form>
</template>
