<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  agents: { type: Array, default: () => [] },
  availableModels: { type: Array, default: () => [] },
  context: { type: Object, default: () => ({}) },
  error: { type: String, default: '' },
  loading: Boolean,
  saving: Boolean,
})

const emit = defineEmits(['close', 'refresh', 'reset-model', 'set-model'])
const scope = ref('session')
const scopes = [
  { key: 'session', label: 'Transcript' },
  { key: 'project', label: 'Project' },
  { key: 'global', label: 'Global' },
]

const modelOptions = computed(() => props.availableModels.map((model) => ({
  label: model.name || `${model.provider}/${model.id}`,
  value: `${model.provider}/${model.id}`,
})))

function selectedModel(agent) {
  return agent.overrides?.[scope.value] || ''
}

function updateModel(agent, event) {
  const model = event.target.value
  if (model) emit('set-model', { agentKey: agent.key, model, scope: scope.value })
  else emit('reset-model', { agentKey: agent.key, scope: scope.value })
}

function sourceLabel(agent) {
  return agent.source === 'project' ? 'Project definition' : 'Global definition'
}
</script>

<template>
  <aside class="settings-drawer subagent-config-drawer" aria-label="Subagents">
    <header class="settings-drawer-header">
      <div>
        <strong>Subagents</strong>
        <span>Model defaults by scope</span>
      </div>
      <button type="button" @click="emit('close')">×</button>
    </header>

    <div class="subagent-scope-tabs" role="tablist" aria-label="Override scope">
      <button
        v-for="item in scopes"
        :key="item.key"
        type="button"
        :class="{ active: scope === item.key }"
        :disabled="item.key === 'session' && !context.sessionAvailable"
        @click="scope = item.key"
      >{{ item.label }}</button>
    </div>

    <p class="subagent-scope-note">
      <template v-if="scope === 'session'">Overrides only this transcript and copies to forks.</template>
      <template v-else-if="scope === 'project'">Overrides all transcripts in this project.</template>
      <template v-else>Provides the default across projects.</template>
    </p>

    <div v-if="error" class="memory-error">{{ error }}</div>
    <div v-if="loading" class="event-log-empty">Loading subagents…</div>
    <div v-else-if="!agents.length" class="event-log-empty">No subagent definitions found.</div>

    <div v-else class="subagent-config-list">
      <section v-for="agent in agents" :key="agent.key" class="subagent-config-card">
        <div class="subagent-config-heading">
          <div>
            <strong>{{ agent.name }}</strong>
            <span>{{ sourceLabel(agent) }}</span>
          </div>
          <code>{{ agent.model || 'runtime default' }}</code>
        </div>
        <p>{{ agent.description }}</p>
        <label>
          <span>{{ scopes.find((item) => item.key === scope)?.label }} model</span>
          <select
            :value="selectedModel(agent)"
            :disabled="saving"
            @change="updateModel(agent, $event)"
          >
            <option value="">Inherit lower scope</option>
            <option value="inherit">Parent session model</option>
            <option
              v-for="model in modelOptions"
              :key="model.value"
              :value="model.value"
            >{{ model.label }} · {{ model.value }}</option>
          </select>
        </label>
        <div class="subagent-effective-model">
          Effective: <strong>{{ agent.effectiveModel === 'inherit' ? 'Parent session model' : agent.effectiveModel || 'runtime default' }}</strong>
          <span>from {{ agent.modelSource }}</span>
        </div>
        <div class="subagent-tool-summary">{{ agent.tools.length }} tools · {{ agent.tools.join(', ') || 'runtime defaults' }}</div>
      </section>
    </div>
  </aside>
</template>
