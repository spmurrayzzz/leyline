<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PiSettingsOperation from './PiSettingsOperation.vue'
import PiSettingsWorkspace from './PiSettingsWorkspace.vue'
import { useSettingsOperation } from '../composables/useSettingsOperation'
import {
  deleteModelSettings,
  deleteProviderSettings,
  fetchProviderSettings,
  runProviderSettingsAction,
  saveModelSettings,
  saveProviderSettings,
} from '../lib/pi-settings-api'

const props = defineProps({
  target: { type: Object, default: () => ({}) },
  backendName: { type: String, default: '' },
  canReload: Boolean,
  loading: Boolean,
})
const emit = defineEmits(['changed', 'reload'])
const apis = ['openai-completions', 'mistral-conversations', 'openai-responses', 'azure-openai-responses', 'openai-codex-responses', 'anthropic-messages', 'bedrock-converse-stream', 'google-generative-ai', 'google-vertex', 'pi-messages']
const tokenFormatter = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const costs = [
  { id: 'input', label: 'Input' },
  { id: 'output', label: 'Output' },
  { id: 'cacheRead', label: 'Cache read' },
  { id: 'cacheWrite', label: 'Cache write' },
]
const inventory = ref(null)
const selectedId = ref('')
const tab = ref('models')
const fetching = ref(false)
const saving = ref(false)
const error = ref('')
const conflict = ref(false)
const reloadRequired = ref(false)
const draft = ref(null)
const modelQuery = ref('')
const modelLimit = ref(80)
const operationOwner = ref(null)
let generation = 0

const { operation, busy, error: operationError, start, answer, cancel, clear } = useSettingsOperation({
  async onComplete(result) {
    const owner = operationOwner.value
    if (!owner || owner.generation !== generation || owner.id !== selectedId.value || result?.providerId !== owner.id) return
    reloadRequired.value = true
    emit('changed')
    if (owner.generation === generation) await load(owner.id)
  },
})

const providers = computed(() => [...(inventory.value?.providers || [])].sort((a, b) =>
  Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)))
const items = computed(() => providers.value.map((provider) => ({
  id: provider.id,
  name: provider.name,
  subtitle: `${provider.configured ? 'Configured' : 'Not configured'} · ${provider.models.length} ${provider.models.length === 1 ? 'model' : 'models'}`,
})))
const selected = computed(() => providers.value.find((provider) => provider.id === selectedId.value))
const locked = computed(() => fetching.value || saving.value || props.loading)
const writable = computed(() => inventory.value?.revision != null && providers.value.every((provider) => provider.config.canEdit))
const dirty = computed(() => Boolean(draft.value && JSON.stringify(draft.value.values) !== JSON.stringify(draft.value.initial)))
const filteredModels = computed(() => {
  const query = modelQuery.value.trim().toLowerCase()
  return (selected.value?.models || []).filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query))
})
const visibleModels = computed(() => filteredModels.value.slice(0, modelLimit.value))
const apiOptions = computed(() => {
  const current = draft.value?.initial.api
  return current && !apis.includes(current) ? [current, ...apis] : apis
})
const operationVisible = computed(() => operationOwner.value?.id === selectedId.value && (operation.value || busy.value || operationError.value))
const canAddModel = computed(() => writable.value && selected.value?.config.baseUrl && selected.value?.config.api)

watch(modelQuery, () => { modelLimit.value = 80 })
watch(() => [props.target, props.backendName], () => {
  resetLocal()
  inventory.value = null
  selectedId.value = ''
  tab.value = 'models'
  modelQuery.value = ''
  modelLimit.value = 80
  reloadRequired.value = false
  void load()
}, { deep: true, immediate: true, flush: 'sync' })

onBeforeUnmount(() => { generation += 1 })

function resetLocal() {
  generation += 1
  clear()
  operationOwner.value = null
  draft.value = null
  error.value = ''
  conflict.value = false
  fetching.value = false
  saving.value = false
}

function confirmLeave() {
  const warnings = []
  if (dirty.value) warnings.push('Discard your unsaved changes?')
  if (busy.value) warnings.push('Stop the current provider operation? Credential changes may already have completed.')
  if (saving.value) warnings.push('A configuration save is in progress and cannot be cancelled. Leave while it finishes?')
  if (warnings.length && !window.confirm(warnings.join('\n\n'))) return false
  resetLocal()
  return true
}

defineExpose({ confirmLeave, refresh: () => { reloadRequired.value = false; refreshSettings() } })

function acceptInventory(value, preferredId) {
  inventory.value = value
  selectedId.value = providers.value.some((provider) => provider.id === preferredId) ? preferredId : providers.value[0]?.id || ''
  if (operationOwner.value && operationOwner.value.id !== selectedId.value) {
    clear()
    operationOwner.value = null
  }
}

function showError(failure) {
  error.value = failure.message || 'The settings request failed.'
  conflict.value = failure.status === 409
}

async function load(preferredId = selectedId.value, refresh = false) {
  const token = ++generation
  const target = { ...props.target }
  fetching.value = true
  error.value = ''
  conflict.value = false
  try {
    const value = await fetchProviderSettings(target, { refresh })
    if (token !== generation) return
    acceptInventory(value, preferredId)
  } catch (failure) {
    if (token === generation) showError(failure)
  } finally {
    if (token === generation) fetching.value = false
  }
}

function refreshSettings() {
  if (locked.value || !confirmLeave()) return
  void load(selectedId.value, true)
}

function selectProvider(id) {
  if (locked.value || (id === selectedId.value && !draft.value) || !confirmLeave()) return
  selectedId.value = id
  modelQuery.value = ''
  modelLimit.value = 80
}

function selectTab(value) {
  if (locked.value || value === tab.value || !confirmLeave()) return
  tab.value = value
}

function openDraft(value, values) {
  draft.value = { ...value, values, initial: structuredClone(values) }
}

function editProvider(create = false) {
  if (locked.value || !writable.value || !confirmLeave()) return
  const provider = create ? null : selected.value
  if (!create && !provider) return
  const config = provider?.config
  tab.value = 'connection'
  openDraft({ type: 'provider', create, providerId: provider?.id }, {
    id: provider?.id || '',
    name: config?.name || '',
    baseUrl: config?.baseUrl || '',
    api: config?.api || '',
    authHeader: config?.authHeader == null ? '' : String(config.authHeader),
    apiKeyAction: 'keep',
    apiKey: '',
  })
}

function editModel(model = null) {
  if (locked.value || !writable.value || !selected.value || (!model && !canAddModel.value) || !confirmLeave()) return
  const overrides = model?.kind === 'override' ? model.overrides : {}
  const metadata = { ...model, ...overrides, cost: { ...model?.cost, ...overrides?.cost } }
  tab.value = 'models'
  openDraft({
    type: 'model',
    providerId: selectedId.value,
    model,
    kind: model && model.kind !== 'custom' ? 'override' : 'custom',
    create: !model || model.kind === 'catalog',
  }, {
    id: model?.id || '',
    name: metadata.name || '',
    contextWindow: metadata.contextWindow ?? '',
    maxTokens: metadata.maxTokens ?? '',
    reasoning: metadata.reasoning ?? false,
    input: metadata.input?.length ? [...metadata.input].sort().join(',') : model ? '' : 'text',
    cost: Object.fromEntries(costs.map(({ id }) => [id, metadata.cost[id] ?? (model ? '' : 0)])),
  })
}

function cancelForm() {
  if (!locked.value) confirmLeave()
}

function handleEscape(event) {
  if (!draft.value) return
  event.preventDefault()
  event.stopPropagation()
  cancelForm()
}

function validId(value) {
  if (!value || value.length > 512 || /[\s\u0000-\u001f\u007f]/u.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) {
    throw new Error('Use an ID without spaces or control characters (up to 512 characters).')
  }
}

function providerValues(form) {
  const values = {}
  for (const key of ['name', 'baseUrl', 'api']) {
    if (!form.create && form.values[key] === form.initial[key]) continue
    const value = form.values[key].trim()
    if (form.create && !value) continue
    if (!value) throw new Error(`${key} cannot be removed individually. Remove the provider configuration to restore its defaults.`)
    values[key] = value
  }
  if (form.create && (!values.baseUrl || !values.api)) throw new Error('A custom provider requires a base URL and API format.')
  if (form.values.authHeader !== form.initial.authHeader) {
    if (form.values.authHeader === '') throw new Error('A saved auth-header setting cannot be removed individually.')
    values.authHeader = form.values.authHeader === 'true'
  }
  if (form.values.apiKeyAction === 'remove') values.apiKey = null
  if (form.values.apiKeyAction === 'replace') {
    if (!form.values.apiKey.trim()) throw new Error('Enter an API-key reference or select Keep unchanged.')
    values.apiKey = form.values.apiKey
  }
  return values
}

function modelValues(form) {
  const values = {}
  const custom = form.create && form.kind === 'custom'
  for (const key of ['name', 'contextWindow', 'maxTokens', 'reasoning', 'input']) {
    const value = form.values[key]
    if (!custom && value === form.initial[key]) continue
    if (key === 'name') {
      if (!value.trim()) throw new Error('Enter a model display name.')
      values.name = value.trim()
    } else if (key === 'contextWindow' || key === 'maxTokens') {
      if (!Number.isFinite(value) || value <= 0) throw new Error('Token limits must be positive numbers.')
      values[key] = value
    } else if (key === 'input') {
      if (!value) throw new Error('Select the model input types.')
      values.input = value.split(',')
    } else values[key] = value
  }
  const changedCosts = {}
  for (const { id } of costs) {
    const value = form.values.cost[id]
    if (!custom && value === form.initial.cost[id]) continue
    if (!Number.isFinite(value) || value < 0) throw new Error('Costs must be zero or a positive number.')
    changedCosts[id] = value
  }
  if (Object.keys(changedCosts).length) values.cost = changedCosts
  return values
}

async function writeConfig(request, preferredId = selectedId.value) {
  const token = ++generation
  const target = { ...props.target }
  saving.value = true
  error.value = ''
  conflict.value = false
  try {
    const value = await request(target)
    if (token !== generation) return
    acceptInventory(value, preferredId)
    draft.value = null
    reloadRequired.value = true
    emit('changed')
  } catch (failure) {
    if (token === generation) showError(failure)
  } finally {
    if (token === generation) saving.value = false
  }
}

function saveDraft() {
  if (locked.value || !draft.value || !writable.value) return
  try {
    const form = draft.value
    validId(form.values.id)
    if (form.type === 'provider' && form.values.id.includes('/')) throw new Error('Provider IDs cannot contain slashes.')
    const values = form.type === 'provider' ? providerValues(form) : modelValues(form)
    if (!Object.keys(values).length) throw new Error('Change at least one field before saving.')
    const body = { revision: inventory.value.revision, create: form.create, values }
    if (form.type === 'provider') {
      body.id = form.values.id
      void writeConfig((target) => saveProviderSettings(target, body), body.id)
    } else {
      Object.assign(body, { providerId: form.providerId, modelId: form.values.id, kind: form.kind })
      void writeConfig((target) => saveModelSettings(target, body))
    }
  } catch (failure) {
    showError(failure)
  }
}

function removeProvider() {
  if (locked.value || !writable.value || !selected.value) return
  const provider = selected.value
  if (!window.confirm(`Remove all models.json configuration for ${provider.name}? This also removes its custom models and overrides. Built-in and extension providers remain available. Credentials are not removed; sign out separately.`)) return
  if (!confirmLeave()) return
  const body = { id: provider.id, revision: inventory.value.revision }
  void writeConfig((target) => deleteProviderSettings(target, body))
}

function removeModel(model) {
  if (locked.value || !writable.value || !model || model.kind === 'catalog') return
  const label = model.kind === 'override' ? `Reset all saved overrides for ${model.name}, including settings not shown here? Catalog defaults will apply.` : `Delete the custom model definition for ${model.name}?`
  if (!window.confirm(label) || !confirmLeave()) return
  const body = { providerId: selectedId.value, modelId: model.id, kind: model.kind, revision: inventory.value.revision }
  void writeConfig((target) => deleteModelSettings(target, body))
}

function beginAction(action, authType) {
  if (locked.value || !selected.value) return
  const provider = selected.value
  if (action === 'logout' && !window.confirm(`Sign out of ${provider.name}? This removes its stored credential. Environment credentials and models.json API-key references are unchanged.`)) return
  if (!confirmLeave()) return
  const target = { ...props.target }
  const body = { providerId: provider.id, action, ...(authType ? { authType } : {}) }
  const labels = { login: 'Sign in', logout: 'Sign out', refresh: 'Refresh catalog' }
  operationOwner.value = { id: provider.id, generation, title: `${provider.name} · ${labels[action]}` }
  void start((baseUrl) => runProviderSettingsAction(target, body, baseUrl))
}

function requestReload() {
  if (!props.canReload || locked.value || !confirmLeave()) return
  emit('reload')
}

function sourceLabel(kind) {
  return { catalog: 'Catalog', override: 'Catalog with saved overrides', custom: 'Custom definition', builtin: 'Built-in', extension: 'Extension' }[kind] || kind
}

function modelSummary(model) {
  return [
    model.contextWindow ? `${tokenFormatter.format(model.contextWindow)} context` : 'Context unknown',
    model.input?.length ? model.input.join(' + ') : 'Input types unknown',
    model.reasoning ? 'Reasoning' : '',
    model.kind === 'custom' ? 'Custom' : model.kind === 'override' ? 'Override' : 'Catalog',
  ].filter(Boolean).join(' · ')
}

function metadataRows(value) {
  const rows = []
  for (const [key, label] of [['name', 'Name'], ['contextWindow', 'Context window'], ['maxTokens', 'Maximum output'], ['reasoning', 'Reasoning'], ['input', 'Input types']]) {
    if (value?.[key] == null) continue
    const entry = value[key]
    rows.push({ label, value: Array.isArray(entry) ? entry.join(' + ') || 'Unknown' : typeof entry === 'boolean' ? entry ? 'Yes' : 'No' : entry })
  }
  for (const { id, label } of costs) {
    if (value?.cost?.[id] != null) rows.push({ label: `${label} / million tokens`, value: `$${value.cost[id]}` })
  }
  if (value?.cost?.tiers?.length) rows.push({ label: 'Additional pricing tiers', value: value.cost.tiers.length })
  return rows
}
</script>

<template>
  <PiSettingsWorkspace
    title="Models & providers"
    description="Keep each provider’s models and connection settings together."
    :items="items"
    :selected-id="selectedId"
    kind="provider"
    :add-label="writable ? 'Add provider' : ''"
    :loading="fetching"
    :busy="locked"
    @select="selectProvider"
    @add="editProvider(true)"
    @refresh="refreshSettings"
    @keydown.esc="handleEscape"
  >
    <template #notice>
      <p v-if="inventory?.warning" class="pi-settings-warning" role="status">{{ inventory.warning }}</p>
      <div v-if="error" class="settings-error" role="alert">
        <p>{{ error }}</p>
        <p v-if="conflict">Refresh settings before retrying. You will be asked before any unsaved changes are discarded.</p>
        <button type="button" class="pi-settings-text-button" :disabled="locked" @click="refreshSettings">Refresh settings</button>
      </div>
      <div v-if="reloadRequired" class="pi-settings-status" role="status">
        <p>Configuration saved. Reload the selected session to apply the changes to its runtime.</p>
        <button v-if="canReload" type="button" class="pi-settings-button" :disabled="locked" @click="requestReload">{{ loading ? 'Reloading…' : 'Reload selected session' }}</button>
      </div>
    </template>

    <template v-if="selected || draft">
      <div class="pi-settings-heading">
        <div>
          <h3>{{ draft?.type === 'provider' && draft.create ? 'Add a custom provider' : selected?.name }}</h3>
          <p v-if="selected && !(draft?.type === 'provider' && draft.create)" class="settings-note">{{ selected.id }} · {{ sourceLabel(selected.kind) }}</p>
        </div>
        <span v-if="selected && !(draft?.type === 'provider' && draft.create)" class="pi-settings-status">{{ selected.configured ? 'Configured' : 'Not configured' }}</span>
      </div>
      <nav v-if="selected && !(draft?.type === 'provider' && draft.create)" class="pi-settings-tabs" aria-label="Provider details">
        <button type="button" :class="{ active: tab === 'models' }" :aria-current="tab === 'models' ? 'page' : undefined" :disabled="locked" @click="selectTab('models')">Models {{ selected.models.length }}</button>
        <button type="button" :class="{ active: tab === 'connection' }" :aria-current="tab === 'connection' ? 'page' : undefined" :disabled="locked" @click="selectTab('connection')">Connection</button>
      </nav>
      <p v-if="selected?.error" class="pi-settings-warning">{{ selected.error }}</p>

      <section v-if="operationVisible" :aria-label="operationOwner.title">
        <div class="pi-settings-heading"><h4>{{ operationOwner.title }}</h4></div>
        <PiSettingsOperation :operation="operation" :busy="busy" :error="operationError" @answer="answer" @cancel="cancel" />
      </section>

      <form v-if="draft" class="pi-settings-form" autocomplete="off" @submit.prevent="saveDraft">
        <div class="pi-settings-heading">
          <h4>{{ draft.type === 'provider' ? draft.create ? 'Provider configuration' : 'Edit provider configuration' : draft.kind === 'custom' ? draft.create ? 'Add a custom model' : 'Edit custom model' : 'Edit catalog overrides' }}</h4>
        </div>
        <template v-if="draft.type === 'provider'">
          <p class="settings-note">Changes are saved to pi’s models.json on this backend.</p>
          <div class="pi-settings-form-grid">
            <label class="pi-settings-field">
              <span>Provider ID</span>
              <input v-model="draft.values.id" required maxlength="512" :readonly="!draft.create" :disabled="locked" spellcheck="false" />
              <small>{{ draft.create ? 'Use a unique ID without spaces.' : 'Provider IDs cannot be changed.' }}</small>
            </label>
            <label class="pi-settings-field">
              <span>Display name</span>
              <input v-model="draft.values.name" :disabled="locked" />
              <small>An empty unchanged field uses the provider default.</small>
            </label>
            <label class="pi-settings-field full">
              <span>Base URL</span>
              <input v-model="draft.values.baseUrl" type="url" :required="draft.create" :disabled="locked" placeholder="http://localhost:8000/v1" spellcheck="false" />
              <small>HTTP or HTTPS, without credentials, query parameters, or fragments.</small>
            </label>
            <label class="pi-settings-field">
              <span>API format</span>
              <select v-model="draft.values.api" :required="draft.create" :disabled="locked">
                <option value="" :disabled="Boolean(draft.initial.api)">{{ draft.create ? 'Select an API format' : 'Provider default' }}</option>
                <option v-for="api in apiOptions" :key="api" :value="api">{{ api }}</option>
              </select>
            </label>
            <label class="pi-settings-field">
              <span>Authorization header</span>
              <select v-model="draft.values.authHeader" :disabled="locked">
                <option value="" :disabled="draft.initial.authHeader !== ''">Provider default</option>
                <option value="true">Send Authorization header</option>
                <option value="false">Do not send Authorization header</option>
              </select>
            </label>
            <label class="pi-settings-field full">
              <span>API-key reference</span>
              <select v-model="draft.values.apiKeyAction" :disabled="locked" @change="draft.values.apiKey = ''">
                <option value="keep">{{ !draft.create && selected?.config.apiKeyConfigured ? 'Keep existing value (not shown)' : 'Leave unset' }}</option>
                <option value="replace">Set a new value</option>
                <option v-if="!draft.create && selected?.config.apiKeyConfigured" value="remove">Remove from models.json</option>
              </select>
              <small>Credentials are never returned. Removing this reference does not sign out a stored credential.</small>
            </label>
            <label v-if="draft.values.apiKeyAction === 'replace'" class="pi-settings-field full">
              <span>New API-key reference or value</span>
              <input v-model="draft.values.apiKey" type="password" required :disabled="locked" autocomplete="new-password" spellcheck="false" />
              <small>Use $NAME or ${NAME} for an environment variable, a literal key, or !command. Commands execute on the backend when pi resolves the key.</small>
            </label>
          </div>
          <p class="settings-note">Unchanged fields keep their saved values.</p>
        </template>
        <template v-else>
          <p class="settings-note">{{ draft.kind === 'override' ? 'Only changed fields are saved as overrides. Other catalog values remain inherited.' : 'Only changed fields are updated on existing definitions.' }} Unknown settings, compatibility options, and nested pricing tiers are preserved.</p>
          <details v-if="draft.model">
            <summary>Effective metadata and saved overrides</summary>
            <p class="settings-note">Effective metadata reported by the selected runtime. It can be incomplete when the provider is not loaded.</p>
            <dl class="pi-settings-metadata">
              <div v-for="row in metadataRows(draft.model)" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
            </dl>
            <template v-if="draft.model.kind === 'override'">
              <h4>Saved overrides</h4>
              <dl class="pi-settings-metadata">
                <div v-for="row in metadataRows(draft.model.overrides)" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
              </dl>
              <p v-if="!metadataRows(draft.model.overrides).length" class="settings-note">No editable metadata overrides. Other saved settings may exist.</p>
            </template>
            <p class="settings-note">Source: {{ sourceLabel(draft.model.kind) }}. Original catalog values are not returned separately.</p>
          </details>
          <div class="pi-settings-form-grid">
            <label class="pi-settings-field full">
              <span>Model ID</span>
              <input v-model="draft.values.id" required maxlength="512" :readonly="Boolean(draft.model)" :disabled="locked" spellcheck="false" />
              <small>{{ draft.model ? 'Model IDs cannot be changed.' : 'Must match the model ID served by the endpoint. To override a catalog model, cancel and select it from the list.' }}</small>
            </label>
            <label class="pi-settings-field full">
              <span>Display name</span>
              <input v-model="draft.values.name" required :disabled="locked" />
            </label>
            <label class="pi-settings-field">
              <span>Context window</span>
              <input v-model.number="draft.values.contextWindow" type="number" min="1" step="any" :required="!draft.model" :disabled="locked" />
              <small>Input and output tokens combined.</small>
            </label>
            <label class="pi-settings-field">
              <span>Maximum output tokens</span>
              <input v-model.number="draft.values.maxTokens" type="number" min="1" step="any" :required="!draft.model" :disabled="locked" />
            </label>
            <label class="pi-settings-field">
              <span>Reasoning support</span>
              <select v-model="draft.values.reasoning" :disabled="locked"><option :value="false">No</option><option :value="true">Yes</option></select>
            </label>
            <label class="pi-settings-field">
              <span>Supported input</span>
              <select v-model="draft.values.input" :disabled="locked">
                <option v-if="!draft.initial.input" value="" disabled>Unknown (unchanged)</option>
                <option value="text">Text</option>
                <option value="image,text">Text and images</option>
                <option value="image">Images</option>
              </select>
            </label>
            <label v-for="rate in costs" :key="rate.id" class="pi-settings-field">
              <span>{{ rate.label }} cost</span>
              <input v-model.number="draft.values.cost[rate.id]" type="number" min="0" step="any" :required="!draft.model" :disabled="locked" />
              <small>USD per million tokens{{ draft.model && draft.initial.cost[rate.id] === '' ? '; blank keeps the current setting' : '' }}.</small>
            </label>
          </div>
        </template>
        <div class="pi-settings-actions">
          <button type="button" class="pi-settings-button" :disabled="locked" @click="cancelForm">Cancel</button>
          <button type="submit" class="pi-settings-button primary" :disabled="locked || (!draft.create && !dirty)">{{ saving ? 'Saving…' : draft.type === 'provider' ? 'Save provider' : draft.kind === 'override' ? 'Save override' : 'Save model' }}</button>
          <button v-if="draft.type === 'model' && draft.model && draft.model.kind !== 'catalog'" type="button" class="pi-settings-button danger" :disabled="locked" @click="removeModel(draft.model)">{{ draft.model.kind === 'override' ? 'Reset override' : 'Delete custom model' }}</button>
        </div>
      </form>

      <template v-else-if="selected && tab === 'models'">
        <div class="pi-settings-actions">
          <button type="button" class="pi-settings-button" :disabled="locked || !canAddModel" @click="editModel()">Add custom model</button>
          <button type="button" class="pi-settings-button" :disabled="locked || busy || Boolean(selected.error)" @click="beginAction('refresh')">Refresh catalog</button>
        </div>
        <p v-if="writable && !canAddModel" class="settings-note">Set a base URL and API format in Connection before adding a custom model. Catalog models can be overridden below.</p>
        <label class="pi-settings-field">
          <span>Find a model</span>
          <input v-model="modelQuery" type="search" placeholder="Search model names or IDs" />
        </label>
        <div class="pi-settings-model-list">
          <div v-for="model in visibleModels" :key="model.id" class="pi-settings-model-row">
            <div class="pi-settings-model-info">
              <strong>{{ model.name }}</strong>
              <small :title="model.id">{{ modelSummary(model) }}</small>
            </div>
            <div class="pi-settings-model-actions">
              <button type="button" class="pi-settings-text-button" :disabled="locked || !writable" :aria-label="`${model.kind === 'catalog' ? 'Override' : 'Edit'} ${model.name}`" @click="editModel(model)">{{ model.kind === 'catalog' ? 'Override' : 'Edit' }}</button>
            </div>
          </div>
        </div>
        <p v-if="!filteredModels.length" class="pi-settings-empty">{{ modelQuery ? 'No matching models.' : 'No models are reported for this provider. Sign in, refresh its catalog, or add a custom definition.' }}</p>
        <button v-if="filteredModels.length > modelLimit" type="button" class="pi-settings-text-button" @click="modelLimit += 80">Show more ({{ visibleModels.length }} of {{ filteredModels.length }})</button>
      </template>

      <template v-else-if="selected">
        <div class="pi-settings-actions">
          <button v-for="method in selected.authMethods" :key="method.id" type="button" class="pi-settings-button primary" :disabled="locked || busy" @click="beginAction('login', method.id)">Sign in · {{ method.label }}</button>
          <button v-if="['stored', 'runtime'].includes(selected.authSource)" type="button" class="pi-settings-button" :disabled="locked || busy" @click="beginAction('logout')">Sign out</button>
        </div>
        <p v-if="!selected.authMethods.length" class="settings-note">This provider uses environment credentials or an API-key reference. Configure a reference below.</p>
        <p class="settings-note">Credentials stay on this backend. Signing in does not change the selected model.</p>
        <dl class="pi-settings-metadata">
          <div><dt>Authentication</dt><dd>{{ selected.authLabel }}</dd></div>
          <div><dt>Saved endpoint</dt><dd>{{ selected.config.baseUrl || 'Provider default' }}</dd></div>
          <div><dt>API format</dt><dd>{{ selected.config.api || 'Provider default' }}</dd></div>
        </dl>
        <div class="pi-settings-actions">
          <button type="button" class="pi-settings-button" :disabled="locked || !writable" @click="editProvider()">Edit configuration</button>
          <button type="button" class="pi-settings-button" :disabled="locked || busy || Boolean(selected.error)" @click="beginAction('refresh')">Refresh catalog</button>
        </div>
        <details class="pi-settings-extra">
          <summary>Saved configuration details</summary>
          <dl class="pi-settings-metadata">
            <div><dt>Provider ID</dt><dd>{{ selected.id }}</dd></div>
            <div><dt>Source</dt><dd>models.json on {{ backendName || 'this backend' }}</dd></div>
            <div><dt>Display name</dt><dd>{{ selected.config.name || 'Provider default' }}</dd></div>
            <div><dt>Authorization header</dt><dd>{{ selected.config.authHeader === null ? 'Provider default' : selected.config.authHeader ? 'Send' : 'Do not send' }}</dd></div>
            <div><dt>API-key reference</dt><dd>{{ selected.config.apiKeyConfigured ? 'Saved (value hidden)' : 'Not set' }}</dd></div>
            <div><dt>Additional headers</dt><dd>{{ selected.config.headersConfigured ? 'Saved (values hidden)' : 'Not set' }}</dd></div>
          </dl>
          <p class="settings-note">Configured means pi found credentials or configuration. It does not verify account access.</p>
          <button v-if="selected.config.hasConfiguration" type="button" class="pi-settings-button danger" :disabled="locked || !writable" @click="removeProvider">Remove provider configuration</button>
        </details>
      </template>
    </template>
    <p v-else class="pi-settings-empty">{{ fetching ? 'Loading providers…' : 'No providers are available. Refresh settings or add a custom provider.' }}</p>
  </PiSettingsWorkspace>
</template>
