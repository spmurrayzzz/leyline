<script setup>
import { computed } from 'vue'
import { formatMode } from '../lib/format'

const props = defineProps({
  scope: { type: String, required: true, validator: (value) => ['global', 'project', 'session'].includes(value) },
  availableModels: { type: Array, default: () => [] },
  subagentData: { type: Object, default: () => ({ context: {}, agents: [] }) },
  visionData: { type: Object, default: () => ({ context: {}, overrides: {} }) },
  subagentLoading: Boolean,
  visionLoading: Boolean,
  subagentSaving: Boolean,
  visionSaving: Boolean,
  subagentError: { type: String, default: '' },
  visionError: { type: String, default: '' },
})

const emit = defineEmits(['set-model', 'reset-model', 'save-vision', 'refresh'])
const scopeOrder = computed(() => {
  return ['session', 'project', 'global'].slice(['session', 'project', 'global'].indexOf(props.scope))
})
const modelOptions = computed(() => props.availableModels.map((model) => ({
  value: `${model.provider}/${model.id}`,
  label: model.name ? `${model.name} · ${model.provider}/${model.id}` : `${model.provider}/${model.id}`,
  supportsImages: model.supportsImages,
  levels: model.availableThinkingLevels || [],
})))
const visionModels = computed(() => modelOptions.value.filter((model) => model.supportsImages))
const visionUnavailable = computed(() => props.scope === 'session' && !props.visionData?.context?.sessionAvailable)
const subagentUnavailable = computed(() => props.scope === 'session' && !props.subagentData?.context?.sessionAvailable)
const visionDisabled = computed(() => visionUnavailable.value || busy.value || !props.visionData?.context?.cwd)
const subagentDisabled = computed(() => subagentUnavailable.value || busy.value || !props.subagentData?.context?.cwd)
const busy = computed(() => props.visionLoading || props.subagentLoading || props.visionSaving || props.subagentSaving)
const visionOverride = computed(() => props.visionData?.overrides?.[props.scope] || {})
const selectedVisionModel = computed(() => visionOverride.value.model || '')
const selectedThinking = computed(() => visionOverride.value.thinking || '')
const visionModel = computed(() => resolveVision('model'))
const visionThinking = computed(() => resolveVision('thinking'))
const inheritedVisionModel = computed(() => resolveVision('model', true))
const inheritedThinking = computed(() => resolveVision('thinking', true))
const effectiveLevels = computed(() => {
  return visionModels.value.find((model) => model.value === visionModel.value.value)?.levels || []
})
const thinkingAvailable = computed(() => effectiveLevels.value.some((level) => level !== 'off'))
const unknownVisionModel = computed(() => {
  return selectedVisionModel.value && !visionModels.value.some((model) => model.value === selectedVisionModel.value)
})
const unknownThinking = computed(() => {
  return selectedThinking.value && selectedThinking.value !== 'inherit' && !effectiveLevels.value.includes(selectedThinking.value)
})
const agents = computed(() => (props.subagentData?.agents || []).map((agent) => {
  const selected = agent.overrides?.[props.scope] || ''
  const fallback = { value: agent.model || '', source: 'definition' }
  return {
    ...agent,
    selected,
    effective: resolveValue(agent.overrides || {}, fallback),
    inherited: resolveValue(agent.overrides || {}, fallback, true),
    unknownModel: selected && selected !== 'inherit' && !modelOptions.value.some((model) => model.value === selected),
  }
}))

function resolveValue(values, fallback, lowerOnly = false) {
  const scopes = lowerOnly ? scopeOrder.value.slice(1) : scopeOrder.value
  for (const scope of scopes) {
    if (values[scope]) return { value: values[scope], source: scope }
  }
  return fallback
}

function resolveVision(field, lowerOnly = false) {
  const overrides = props.visionData?.overrides || {}
  const values = Object.fromEntries(scopeOrder.value.map((scope) => [scope, overrides[scope]?.[field]]))
  return resolveValue(values, { value: '', source: 'none' }, lowerOnly)
}

function sourceLabel(source) {
  if (source === 'session') return 'this transcript'
  if (source === 'project') return 'project'
  if (source === 'global') return 'global default'
  if (source === 'definition') return 'agent definition'
  return 'no override'
}

function modelLabel(value, fallback = 'None configured') {
  if (value === 'inherit') return 'Parent session model'
  return props.availableModels.find((model) => `${model.provider}/${model.id}` === value)?.name || value || fallback
}

function thinkingLabel(value) {
  if (value === 'inherit') return 'Match parent session'
  return value ? formatMode(value) : 'Default (no override)'
}

function inheritLabel(resolved, label) {
  return `Inherit from ${sourceLabel(resolved.source)}: ${label}`
}

function metadata(resolved, selected, label) {
  if (resolved.source === 'none') return `Effective: ${label}`
  return `${selected || props.scope === 'global' ? 'Effective' : 'Inherited'}: ${label} · from ${sourceLabel(resolved.source)}`
}

function updateVisionModel(event) {
  if (visionDisabled.value) return
  const model = event.target.value
  const next = visionModels.value.find((item) => item.value === model)
  if (model && !next) return
  const current = selectedThinking.value
  const thinking = model && current && current !== 'inherit' && !next.levels.includes(current) ? '' : current
  emit('save-vision', { scope: props.scope, model, thinking })
}

function updateThinking(event) {
  if (visionDisabled.value) return
  emit('save-vision', {
    scope: props.scope,
    model: selectedVisionModel.value,
    thinking: event.target.value,
  })
}

function updateSubagentModel(agent, event) {
  if (subagentDisabled.value) return
  const model = event.target.value
  if (model) emit('set-model', { agentKey: agent.key, scope: props.scope, model })
  else emit('reset-model', { agentKey: agent.key, scope: props.scope })
}
</script>

<template>
  <div class="agent-settings">
    <section :aria-busy="visionLoading || visionSaving" aria-label="Vision agent">
      <h3 class="settings-section-heading">Vision agent <small>For models without image input</small></h3>
      <p v-if="visionError" class="settings-error" role="alert">{{ visionError }}</p>
      <small v-if="visionLoading" class="settings-note" role="status">Loading vision settings…</small>
      <small v-if="visionUnavailable" class="settings-note">Create a transcript to set vision overrides.</small>
      <div class="settings-rows">
        <label class="settings-row">
          <span>
            <strong>Vision model</strong>
            <small>Describes images for the parent agent</small>
            <small class="settings-inherited">{{ metadata(visionModel, selectedVisionModel, modelLabel(visionModel.value)) }}</small>
          </span>
          <select :value="selectedVisionModel" :disabled="visionDisabled" @change="updateVisionModel">
            <option value="">{{ scope === 'global' ? 'None configured' : inheritLabel(inheritedVisionModel, modelLabel(inheritedVisionModel.value)) }}</option>
            <option v-if="unknownVisionModel" :value="selectedVisionModel" disabled>{{ selectedVisionModel }} · saved, unavailable</option>
            <option v-for="model in visionModels" :key="model.value" :value="model.value">{{ model.label }}</option>
          </select>
        </label>
        <label v-if="thinkingAvailable || selectedThinking" class="settings-row">
          <span>
            <strong>Thinking mode</strong>
            <small class="settings-inherited">{{ metadata(visionThinking, selectedThinking, thinkingLabel(visionThinking.value)) }}</small>
          </span>
          <select :value="selectedThinking" :disabled="visionDisabled" @change="updateThinking">
            <option value="">{{ scope === 'global' ? 'Default (no override)' : inheritLabel(inheritedThinking, thinkingLabel(inheritedThinking.value)) }}</option>
            <option value="inherit">Match parent session</option>
            <option v-if="unknownThinking" :value="selectedThinking" disabled>{{ thinkingLabel(selectedThinking) }} · saved, unavailable for this model</option>
            <option v-for="level in effectiveLevels.filter((value) => value !== 'inherit')" :key="level" :value="level">{{ formatMode(level) }}</option>
          </select>
        </label>
      </div>
      <small v-if="!visionLoading && !visionModels.length" class="settings-note">No image-capable models are available. Add a model with image input support in pi settings.</small>
    </section>

    <section :aria-busy="subagentLoading || subagentSaving" aria-label="Subagents">
      <h3 class="settings-section-heading">Subagents <small>{{ scope === 'global' ? 'Default models' : 'Model overrides' }}</small></h3>
      <p v-if="subagentError" class="settings-error" role="alert">{{ subagentError }}</p>
      <small v-if="subagentLoading" class="settings-note" role="status">Loading subagents…</small>
      <small v-if="subagentUnavailable" class="settings-note">Create a transcript to set subagent overrides.</small>
      <small v-if="!subagentLoading && !agents.length" class="settings-note">No subagent definitions found.</small>
      <div v-if="agents.length" class="settings-rows">
        <label v-for="agent in agents" :key="agent.key" class="settings-row">
          <span>
            <strong>{{ agent.name }}</strong>
            <small class="settings-inherited">{{ metadata(agent.effective, agent.selected, modelLabel(agent.effective.value, 'Runtime default')) }}</small>
          </span>
          <select :value="agent.selected" :disabled="subagentDisabled" @change="updateSubagentModel(agent, $event)">
            <option value="">{{ scope === 'global' ? 'Use agent definition' : inheritLabel(agent.inherited, modelLabel(agent.inherited.value, 'Runtime default')) }}</option>
            <option value="inherit">Parent session model</option>
            <option v-if="agent.unknownModel" :value="agent.selected">{{ agent.selected }} · saved, unavailable</option>
            <option v-for="model in modelOptions" :key="model.value" :value="model.value">{{ model.label }}</option>
          </select>
        </label>
      </div>
      <details v-if="agents.length">
        <summary>Agent definitions and tools</summary>
        <section v-for="agent in agents" :key="agent.key" :aria-label="agent.name">
          <h4>{{ agent.name }}</h4>
          <p>{{ agent.description }}</p>
          <small class="settings-note">{{ agent.source === 'project' ? 'Project definition' : 'Global definition' }}: <code>{{ agent.path }}</code></small>
          <small class="settings-note">Model: {{ modelLabel(agent.model, 'Runtime default') }} · Thinking: {{ thinkingLabel(agent.thinking) }}</small>
          <small class="settings-note">{{ agent.tools?.length || 0 }} tools · {{ agent.tools?.join(', ') || 'Runtime defaults' }}</small>
        </section>
      </details>
    </section>

    <button v-if="visionError || subagentError" type="button" :disabled="busy" @click="emit('refresh')">Retry agent settings</button>
  </div>
</template>
