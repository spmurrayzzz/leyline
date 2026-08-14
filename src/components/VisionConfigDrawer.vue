<script setup>
import { computed, ref, watch } from 'vue'
import { formatMode } from '../lib/format'

const props = defineProps({
  availableModels: { type: Array, default: () => [] },
  config: { type: Object, default: () => ({}) },
  error: { type: String, default: '' },
  loading: Boolean,
  saving: Boolean,
})

const emit = defineEmits(['close', 'refresh', 'reset', 'save'])
const scope = ref('session')
const scopes = [
  { key: 'session', label: 'Transcript' },
  { key: 'project', label: 'Project' },
  { key: 'global', label: 'Global' },
]

const visionModels = computed(() => props.availableModels
  .filter((model) => model.supportsImages)
  .map((model) => ({
    label: model.name || `${model.provider}/${model.id}`,
    value: `${model.provider}/${model.id}`,
    availableThinkingLevels: model.availableThinkingLevels || [],
  })))

const overrides = computed(() => props.config?.overrides || {})

const scopeOverride = computed(() => {
  return overrides.value[scope.value] || { model: '', thinking: '' }
})

const effectiveModel = computed(() => props.config?.model || '')

const effectiveLevels = computed(() => {
  const match = visionModels.value.find((item) => item.value === effectiveModel.value)
  return match?.availableThinkingLevels || []
})

const thinkingAvailable = computed(() => {
  return effectiveLevels.value.some((level) => level !== 'off')
})

watch(
  () => props.config?.context?.sessionAvailable,
  (available) => {
    if (available === false && scope.value === 'session') scope.value = 'project'
  },
  { immediate: true },
)

function selectedModel() {
  return scopeOverride.value.model || ''
}

function selectedThinking() {
  return scopeOverride.value.thinking || ''
}

function formatThinking(value) {
  if (!value) return 'Default'
  if (value === 'inherit') return 'Parent session'
  return formatMode(value)
}

function sourceLabel() {
  const source = props.config?.modelSource || 'none'
  if (source === 'session') return 'Transcript'
  if (source === 'project') return 'Project'
  if (source === 'global') return 'Global default'
  return 'None configured'
}

function thinkingSourceLabel() {
  const source = props.config?.thinkingSource || 'none'
  if (source === 'session') return 'Transcript'
  if (source === 'project') return 'Project'
  if (source === 'global') return 'Global default'
  return 'None configured'
}

function updateModel(event) {
  const model = event.target.value
  if (!model) {
    emit('save', { scope: scope.value, model: '', thinking: selectedThinking() })
    return
  }
  const next = visionModels.value.find((item) => item.value === model)
  const levels = next?.availableThinkingLevels || []
  const current = selectedThinking()
  const thinking = current && current !== 'inherit' && !levels.includes(current)
    ? ''
    : current
  emit('save', { scope: scope.value, model, thinking })
}

function updateThinking(event) {
  emit('save', {
    scope: scope.value,
    model: selectedModel(),
    thinking: event.target.value,
  })
}
</script>

<template>
  <aside class="settings-drawer subagent-config-drawer" aria-label="Vision agent">
    <header class="settings-drawer-header">
      <div>
        <strong>Vision agent</strong>
        <span>Descriptions for models without vision</span>
      </div>
      <button type="button" @click="emit('close')">×</button>
    </header>

    <div class="subagent-scope-tabs" role="tablist" aria-label="Override scope">
      <button
        v-for="item in scopes"
        :key="item.key"
        type="button"
        :class="{ active: scope === item.key }"
        :disabled="item.key === 'session' && !config?.context?.sessionAvailable"
        @click="scope = item.key"
      >{{ item.label }}</button>
    </div>

    <p class="subagent-scope-note">
      <template v-if="scope === 'session'">Overrides only this transcript and copies to forks.</template>
      <template v-else-if="scope === 'project'">Overrides all transcripts in this project.</template>
      <template v-else>Default used when a model without vision support receives images.</template>
    </p>

    <p class="vision-config-description">
      When the active model cannot receive images directly, the model calls the
      <code>vision_agent</code> tool to inspect attached images. The tool runs
      the configured vision model and returns a description. The images stay in
      the transcript.
    </p>

    <div v-if="error" class="memory-error">{{ error }}</div>
    <div v-if="loading" class="event-log-empty">Loading vision config…</div>

    <div v-else class="subagent-config-list">
      <section class="subagent-config-card">
        <div class="subagent-config-heading">
          <div>
            <strong>Vision model</strong>
            <span>{{
              scope === 'global'
                ? 'Default used across projects'
                : scopes.find((item) => item.key === scope)?.label + ' override'
            }}</span>
          </div>
          <code>{{ selectedModel() || 'inherit' }}</code>
        </div>
        <label>
          <span>{{ scopes.find((item) => item.key === scope)?.label }} model</span>
          <select
            :value="selectedModel()"
            :disabled="saving"
            @change="updateModel"
          >
            <option value="">{{ scope === 'global' ? 'None configured' : 'Inherit from lower scope' }}</option>
            <option
              v-for="model in visionModels"
              :key="model.value"
              :value="model.value"
            >{{ model.label }} · {{ model.value }}</option>
          </select>
        </label>
        <div class="subagent-effective-model">
          Effective: <strong>{{ config?.model || 'not configured' }}</strong>
          <span>from {{ sourceLabel() }}</span>
        </div>
        <div v-if="!visionModels.length" class="subagent-tool-summary">
          No vision-capable models found. Add a model that supports image input in pi settings.
        </div>
      </section>

      <section v-if="thinkingAvailable" class="subagent-config-card">
        <div class="subagent-config-heading">
          <div>
            <strong>Thinking mode</strong>
            <span>{{ scopes.find((item) => item.key === scope)?.label }} override</span>
          </div>
          <code>{{ selectedThinking() || 'inherit' }}</code>
        </div>
        <label>
          <span>{{ scopes.find((item) => item.key === scope)?.label }} thinking</span>
          <select
            :value="selectedThinking()"
            :disabled="saving"
            @change="updateThinking"
          >
            <option value="">Default (no override)</option>
            <option value="inherit">Match parent session</option>
            <option
              v-for="level in effectiveLevels"
              :key="level"
              :value="level"
            >{{ formatMode(level) }}</option>
          </select>
        </label>
        <div class="subagent-effective-model">
          Effective: <strong>{{ formatThinking(config?.thinking) }}</strong>
          <span>from {{ thinkingSourceLabel() }}</span>
        </div>
        <div class="subagent-tool-summary">
          Only shown when the effective vision model supports reasoning.
        </div>
      </section>
    </div>
  </aside>
</template>