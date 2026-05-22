<script setup>
import { formatMode, modelChip } from '../lib/format'

const props = defineProps({
  activeRuntimeState: {
    type: Object,
    default: () => ({}),
  },
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
  currentModeLabel: {
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
  modeDisabled: Boolean,
  modePickerOpen: Boolean,
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
  switchingMode: Boolean,
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
  'select-mode',
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

function updateDraft(event) {
  emit('update:draft', event.target.value)
  emit('show-slash-picker')
}
</script>

<template>
  <form class="start-composer" @submit.prevent="emit('submit')">
    <textarea
      :value="draft"
      placeholder="Ask Leyline anything"
      :disabled="!!creatingSessionCwd"
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
          <div class="model-picker small-picker start-picker">
            <button
              class="composer-chip model-picker-button start-composer-chip"
              type="button"
              :disabled="switchingMode || modeDisabled"
              @click="emit('toggle-picker', 'mode')"
            >
              <span class="model-label">{{ currentModeLabel }}</span>
              <span class="model-caret">▾</span>
            </button>
            <div v-if="modePickerOpen" class="model-menu mode-menu">
              <div class="mode-menu-label">Steering</div>
              <button
                v-for="value in ['one-at-a-time', 'all']"
                :key="`start-steering-${value}`"
                type="button"
                :class="{ active: value === activeRuntimeState.steeringMode }"
                @click="emit('select-mode', 'steeringMode', value)"
              >
                <span>{{ formatMode(value) }}</span>
                <span v-if="value === activeRuntimeState.steeringMode">✓</span>
              </button>
              <div class="mode-menu-label">Follow-up</div>
              <button
                v-for="value in ['one-at-a-time', 'all']"
                :key="`start-follow-up-${value}`"
                type="button"
                :class="{ active: value === activeRuntimeState.followUpMode }"
                @click="emit('select-mode', 'followUpMode', value)"
              >
                <span>{{ formatMode(value) }}</span>
                <span v-if="value === activeRuntimeState.followUpMode">✓</span>
              </button>
            </div>
          </div>
          <button
            class="start-send-button"
            type="submit"
            :disabled="!newSessionCwd.trim() || !!creatingSessionCwd"
          >↑</button>
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
