<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PiSettingsOperation from './PiSettingsOperation.vue'
import PiSettingsWorkspace from './PiSettingsWorkspace.vue'
import { useSettingsOperation } from '../composables/useSettingsOperation'
import { deleteMcpSettings, fetchMcpSettings, runMcpSettingsAction, saveMcpSettings, settingsApiBase } from '../lib/pi-settings-api'

const props = defineProps({
  backendName: { type: String, default: '' },
  canReload: Boolean,
  reloading: Boolean,
})
const emit = defineEmits(['changed', 'reload'])
const servers = ref([])
const revision = ref(null)
const warning = ref('')
const error = ref('')
const notice = ref('')
const loading = ref(false)
const saving = ref(false)
const selectedId = ref('')
const form = ref(null)
const baseline = ref(null)
const checks = ref(new Map())
const exposures = ['deferred', 'direct', 'hidden']
const oauthFields = [
  { key: 'clientId', label: 'Client ID' },
  { key: 'scope', label: 'Scope' },
  { key: 'callbackPort', label: 'Callback port' },
  { key: 'callbackUrl', label: 'Callback URL' },
]
let generation = 0
let loadedBase = ''
let returnId = ''
let actionContext = null

const { operation, busy: operationBusy, error: operationError, start, answer, cancel, clear } = useSettingsOperation({
  onComplete: async (result) => {
    const context = actionContext
    if (!context || !isCurrent(context)) return
    checks.value.set(context.name, { ...result, action: context.action, time: new Date().toLocaleString() })
    if (context.action !== 'check') {
      notice.value = 'The sign-in operation finished. Review pi’s report and reload sessions to use any saved changes.'
      emit('changed')
    }
  },
})
const selected = computed(() => servers.value.find((server) => server.name === selectedId.value))
const busy = computed(() => loading.value || saving.value || operationBusy.value || props.reloading)
const dirty = computed(() => form.value !== null && JSON.stringify(form.value) !== JSON.stringify(baseline.value))
const items = computed(() => servers.value.map((server) => ({
  id: server.name,
  name: server.name,
  subtitle: `${server.transport === 'http' ? 'HTTP' : 'Local process'} · ${server.enabled ? 'Enabled' : 'Disabled'}`,
})))
const lastCheck = computed(() => checks.value.get(selectedId.value))
const oauthAllowed = computed(() => selected.value?.transport === 'http'
  && !selected.value.headers.some((header) => header.name.toLowerCase() === 'authorization'))
const transportChanged = computed(() => selected.value && form.value?.transport !== selected.value.transport)
const secretField = computed(() => form.value?.transport === 'http' ? 'headers' : 'env')
const secretLabel = computed(() => secretField.value === 'headers' ? 'Header' : 'Environment variable')

function context() {
  return { generation, baseUrl: settingsApiBase(), name: selectedId.value }
}

function isCurrent(value) {
  return value.generation === generation && value.baseUrl === settingsApiBase() && value.name === selectedId.value
}

function confirmLeave() {
  const warnings = []
  if (dirty.value) warnings.push('Discard unsaved server changes?')
  if (operationBusy.value) warnings.push('Stop the current connection operation? Credential changes may already have completed.')
  if (saving.value || props.reloading) warnings.push('A save or reload is in progress and cannot be cancelled. Leave while it finishes?')
  if (warnings.length && !window.confirm(warnings.join('\n\n'))) return false
  if (operationBusy.value) {
    generation += 1
    actionContext = null
    clear()
  }
  return true
}

defineExpose({ confirmLeave, refresh: () => { notice.value = ''; refresh() } })

function settingsReady() {
  if (revision.value && loadedBase === settingsApiBase()) return true
  error.value = 'Refresh settings for the selected backend before continuing.'
  return false
}

function resetEditor() {
  form.value = null
  baseline.value = null
  error.value = ''
}

function applySettings(data, preferred) {
  loadedBase = settingsApiBase()
  servers.value = data.servers
  revision.value = data.revision
  warning.value = data.warning || ''
  selectedId.value = data.servers.some((server) => server.name === preferred) ? preferred : data.servers[0]?.name || ''
  resetEditor()
}

async function load() {
  generation += 1
  const request = context()
  loading.value = true
  error.value = ''
  try {
    const data = await fetchMcpSettings()
    if (isCurrent(request)) applySettings(data, request.name)
  } catch (failure) {
    if (isCurrent(request)) error.value = failure.message
  } finally {
    if (request.generation === generation) {
      loading.value = false
      if (request.baseUrl !== settingsApiBase()) error.value = 'The backend changed. Refresh settings before continuing.'
    }
  }
}

function refresh() {
  if (busy.value || !confirmLeave()) return
  clear()
  resetEditor()
  if (loadedBase !== settingsApiBase()) {
    servers.value = []
    selectedId.value = ''
    revision.value = null
    checks.value.clear()
    notice.value = ''
    warning.value = ''
  }
  void load()
}

function select(name) {
  if (busy.value || (!form.value && name === selectedId.value) || !confirmLeave()) return
  generation += 1
  clear()
  selectedId.value = name
  resetEditor()
}

function openEditor(create = false) {
  if (busy.value || !settingsReady() || !confirmLeave()) return
  const server = create ? null : selected.value
  if (!create && !server) return
  generation += 1
  clear()
  returnId = selectedId.value
  if (create) selectedId.value = ''
  const oauth = server?.oauth || {}
  form.value = {
    name: server?.name || '',
    transport: server?.transport || 'http',
    enabled: server?.enabled ?? true,
    url: server?.url || '',
    command: server?.command || '',
    args: '',
    removeArgs: false,
    cwd: server?.cwd || '',
    exposure: server?.exposure ?? 'deferred',
    timeout: server?.timeout === undefined ? '' : String(server.timeout),
    headers: (server?.headers || []).map(({ name }) => ({ name, value: '', saved: true, remove: false })),
    env: (server?.env || []).map(({ name }) => ({ name, value: '', saved: true, remove: false })),
    oauth: Object.fromEntries(oauthFields.map(({ key }) => [key, { value: String(oauth[key] ?? ''), remove: false }])),
    clientSecret: '',
    removeClientSecret: false,
  }
  baseline.value = JSON.parse(JSON.stringify(form.value))
  error.value = ''
}

function closeEditor() {
  if (busy.value || !confirmLeave()) return
  generation += 1
  selectedId.value = returnId
  resetEditor()
}

function escapeEditor(event) {
  if (!form.value) return
  event.preventDefault()
  event.stopPropagation()
  closeEditor()
}

function completeValue(value, label) {
  if (/\[redacted(?: URL)?\]|%5bredacted%5d/i.test(value)) {
    throw new Error(`Supply the complete new ${label}, or leave it unchanged to keep the saved value.`)
  }
  return value
}

function parseUrl(value, label) {
  try {
    return new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL.`)
  }
}

function buildValues() {
  const draft = form.value
  const original = baseline.value
  const create = !selected.value
  const switched = !create && draft.transport !== selected.value.transport
  if (!/^[A-Za-z0-9_-]+$/.test(draft.name)) {
    throw new Error('Server names must contain only letters, digits, underscores, and hyphens.')
  }
  if (create && servers.value.some((server) => server.name === draft.name)) throw new Error('This server name already exists.')
  const values = {}
  const changed = (field) => create || draft[field] !== original[field]
  const endpoint = draft.transport === 'http' ? 'url' : 'command'
  if (changed(endpoint) || switched) {
    const value = completeValue(draft[endpoint], endpoint)
    if (endpoint === 'url') {
      if (!['http:', 'https:'].includes(parseUrl(value, 'Server URL').protocol)) throw new Error('Server URL must use HTTP or HTTPS.')
    } else if (!value.trim()) throw new Error('A local server needs a command.')
    values[endpoint] = value
  }
  if (changed('enabled')) values.enabled = draft.enabled
  if (changed('exposure')) {
    if (!exposures.includes(draft.exposure)) throw new Error('Select deferred, direct, or hidden exposure.')
    values.exposure = draft.exposure
  }
  if (changed('timeout')) {
    const value = String(draft.timeout).trim() === '' ? null : Number(draft.timeout)
    if (value !== null && (!Number.isFinite(value) || value <= 0)) throw new Error('Timeout must be a positive number of seconds.')
    if (!create || value !== null) values.timeout = value
  }
  if (draft.transport === 'stdio') {
    for (const field of ['args', 'cwd']) {
      if (field === 'args' && draft.removeArgs) {
        values.args = null
        continue
      }
      if (!changed(field) && !switched) continue
      const value = completeValue(draft[field], field)
      if (create && !value) continue
      values[field] = value === '' ? null : field === 'args' ? value.split('\n') : value
    }
  }
  const field = secretField.value
  const additions = []
  const removals = []
  const names = new Set()
  for (const row of draft[field]) {
    if (!row.saved && !row.name && !row.value) continue
    if (!row.name) throw new Error(`${secretLabel.value} name is required.`)
    if (names.has(row.name)) throw new Error(`Duplicate ${secretLabel.value.toLowerCase()} name: ${row.name}`)
    names.add(row.name)
    if (row.remove || row.value !== '') completeValue(row.name, `${secretLabel.value.toLowerCase()} name`)
    if (row.saved && row.remove) removals.push(row.name)
    else if (row.value !== '') additions.push([row.name, row.value])
    else if (!row.saved) throw new Error(`Enter a value for ${row.name}, or remove the new row.`)
  }
  if (additions.length) values[field] = Object.fromEntries(additions)
  if (removals.length) values[field === 'headers' ? 'removeHeaders' : 'removeEnv'] = removals
  if (draft.transport === 'http') {
    const oauth = {}
    for (const { key, label } of oauthFields) {
      const input = draft.oauth[key]
      if (input.remove) oauth[key] = null
      else if (input.value !== original.oauth[key].value) {
        const value = completeValue(input.value, label)
        oauth[key] = value === '' ? null : key === 'callbackPort' ? Number(value) : value
      }
    }
    if (draft.removeClientSecret) oauth.clientSecret = null
    else if (draft.clientSecret !== '') oauth.clientSecret = draft.clientSecret
    const effective = { ...(switched ? {} : selected.value?.oauth), ...oauth }
    const port = effective.callbackPort
    if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new Error('OAuth callback port must be an integer from 1 to 65535.')
    }
    if (effective.callbackUrl && !/\[redacted\]|%5bredacted%5d/i.test(effective.callbackUrl)) {
      const url = parseUrl(effective.callbackUrl, 'OAuth callback URL')
      if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || url.search || url.hash || url.username || url.password) {
        throw new Error('OAuth callback URL must use HTTP on localhost, 127.0.0.1, or [::1], without credentials, query, or fragment.')
      }
      if (url.port && port != null && Number(url.port) !== port) throw new Error('OAuth callback URL and callback port must use the same port.')
    }
    if (Object.keys(oauth).length) values.oauth = oauth
  }
  return values
}

async function mutate(requestFn, preferred, message) {
  if (!settingsReady()) return
  const request = context()
  saving.value = true
  error.value = ''
  try {
    const data = await requestFn()
    if (!isCurrent(request)) return
    checks.value.delete(request.name)
    clear()
    applySettings(data, preferred)
    notice.value = message
    emit('changed')
  } catch (failure) {
    if (isCurrent(request)) error.value = `${failure.message}${failure.status === 409 ? ' Refresh settings before trying again.' : ''}`
  } finally {
    if (request.generation === generation) {
      saving.value = false
      if (request.baseUrl !== settingsApiBase()) error.value = 'The backend changed. Refresh settings before continuing.'
    }
  }
}

async function save() {
  if (busy.value || !form.value) return
  let values
  try {
    values = buildValues()
  } catch (failure) {
    error.value = failure.message
    return
  }
  if (!Object.keys(values).length) {
    closeEditor()
    return
  }
  const body = { name: form.value.name, revision: revision.value, create: !selected.value, values }
  await mutate(() => saveMcpSettings(body), body.name, 'Server configuration saved. Reload open sessions to apply the change.')
}

async function toggleEnabled() {
  if (busy.value || form.value || !selected.value) return
  const body = { name: selected.value.name, revision: revision.value, values: { enabled: !selected.value.enabled } }
  await mutate(() => saveMcpSettings(body), body.name, 'Enabled setting saved. Reload open sessions to apply the change.')
}

async function removeServer() {
  if (busy.value || !selected.value || !confirmLeave()) return
  const name = selected.value.name
  if (!window.confirm(`Delete MCP server "${name}" from this backend’s configuration? This does not sign out or stop connections in open sessions.`)) return
  const body = { name, revision: revision.value }
  await mutate(() => deleteMcpSettings(body), '', 'Server removed. Reload open sessions to apply the change.')
}

async function runAction(action) {
  if (busy.value || form.value || !selected.value || selected.value.error || !settingsReady()) return
  if (action !== 'check' && !oauthAllowed.value) return
  if (selected.value.transport === 'stdio'
    && !window.confirm(`Check "${selected.value.name}"? This executes its saved command on ${props.backendName || 'the selected backend'} and closes the temporary connection afterward.`)) return
  if (action === 'logout' && !window.confirm(`Sign out of "${selected.value.name}"? Reload open sessions afterward to apply the credential change.`)) return
  error.value = ''
  const request = { ...context(), action }
  actionContext = request
  await start((baseUrl) => runMcpSettingsAction({ name: request.name, action }, baseUrl))
}

function reloadSessions() {
  if (busy.value || !props.canReload || !settingsReady() || !confirmLeave()) return
  if (form.value) {
    generation += 1
    selectedId.value = returnId
    resetEditor()
  }
  emit('reload')
}

watch(() => operation.value?.state, (state) => {
  if (!['cancelled', 'error'].includes(state) || !actionContext || actionContext.action === 'check' || !isCurrent(actionContext)) return
  notice.value = 'The sign-in operation did not complete. Credentials may have changed. Reload open sessions if needed.'
  emit('changed')
})

watch(() => props.backendName, () => {
  generation += 1
  clear()
  actionContext = null
  loadedBase = ''
  saving.value = false
  servers.value = []
  revision.value = null
  selectedId.value = ''
  warning.value = ''
  notice.value = ''
  checks.value.clear()
  resetEditor()
  void load()
}, { immediate: true })

onBeforeUnmount(() => { generation += 1 })
</script>

<template>
  <PiSettingsWorkspace
    title="MCP servers"
    description="Choose a server to manage its connection and tools."
    :items="items"
    :selected-id="selectedId"
    kind="server"
    add-label="Add server"
    :loading="loading"
    :busy="busy"
    @select="select"
    @add="openEditor(true)"
    @refresh="refresh"
    @keydown.esc="escapeEditor"
  >
    <template #notice>
      <p v-if="warning" class="pi-settings-warning" role="status">{{ warning }}</p>
      <p v-if="error" class="pi-settings-warning" role="alert">{{ error }}</p>
      <div v-if="notice" class="pi-settings-status" role="status">
        <p>{{ notice }}</p>
        <button v-if="canReload" type="button" class="pi-settings-text-button" :disabled="busy" @click="reloadSessions">{{ reloading ? 'Reloading…' : 'Reload selected session' }}</button>
      </div>
    </template>

    <form v-if="form" class="pi-settings-form" autocomplete="off" novalidate @submit.prevent="save">
      <div class="pi-settings-heading"><h3>{{ selected ? `Edit ${selected.name}` : 'Add an MCP server' }}</h3></div>
      <p v-if="selected" class="pi-settings-status">Safe values are shown below. Unchanged fields keep their saved values, including redacted content.</p>
      <p v-if="selected?.error" class="pi-settings-warning">{{ selected.error }}</p>
      <div class="pi-settings-form-grid">
        <label class="pi-settings-field">
          <span>Server name</span>
          <input v-model="form.name" :readonly="!!selected" :disabled="busy" spellcheck="false" required />
          <small>{{ selected ? 'The saved name cannot change.' : 'Letters, digits, underscores, and hyphens only.' }}</small>
        </label>
        <label class="pi-settings-field">
          <span>Transport</span>
          <select v-model="form.transport" :disabled="busy"><option value="http">Remote HTTP</option><option value="stdio">Local process (stdio)</option></select>
        </label>
        <label v-if="form.transport === 'http'" class="pi-settings-field full">
          <span>Server URL</span>
          <input v-model="form.url" :disabled="busy" spellcheck="false" type="text" inputmode="url" required />
          <small>HTTP or HTTPS. To change a redacted URL, enter the complete replacement.</small>
        </label>
        <template v-else>
          <label class="pi-settings-field full"><span>Command</span><input v-model="form.command" :disabled="busy" spellcheck="false" required /><small>This command runs on the selected backend, not necessarily this computer.</small></label>
          <label class="pi-settings-field full"><span>{{ selected?.argsConfigured ? 'Replacement arguments' : 'Arguments' }}</span><textarea v-model="form.args" :disabled="busy || form.removeArgs" rows="4" spellcheck="false" /><small>One argument per line, without shell quotes. {{ selected?.argsConfigured ? `${selected.argsCount} saved arguments are hidden because they can contain credentials. Leave blank to keep them.` : 'Arguments are not shown after saving.' }}</small></label>
          <label v-if="selected?.argsConfigured" class="pi-settings-field full"><span>Remove saved arguments</span><input v-model="form.removeArgs" type="checkbox" :disabled="busy" /></label>
          <label class="pi-settings-field full"><span>Working directory</span><input v-model="form.cwd" :disabled="busy" spellcheck="false" /><small>Clear this field to remove the saved directory.</small></label>
        </template>
        <label class="pi-settings-field">
          <span>Tool exposure</span>
          <select v-model="form.exposure" :disabled="busy">
            <option v-if="!exposures.includes(baseline.exposure)" :value="baseline.exposure" disabled>Existing pi setting ({{ baseline.exposure }})</option>
            <option value="deferred">Deferred (tool search)</option><option value="direct">Direct (always available)</option><option value="hidden">Hidden</option>
          </select>
          <small v-if="!exposures.includes(baseline.exposure)">The existing pi setting stays unchanged unless you choose another value.</small>
        </label>
        <label class="pi-settings-field"><span>Timeout (seconds)</span><input v-model="form.timeout" :disabled="busy" type="number" step="any" /><small>A positive number. Blank removes the saved timeout and uses pi’s default.</small></label>
        <label class="pi-settings-field"><span>Enabled</span><input v-model="form.enabled" :disabled="busy" type="checkbox" /><small>Saving does not start or stop a connection.</small></label>
      </div>
      <p v-if="transportChanged" class="pi-settings-warning">Changing transport removes {{ form.transport === 'http' ? 'the saved command, arguments, working directory, and environment variables' : 'the saved URL, headers, and OAuth configuration' }} when you save.</p>

      <section :aria-label="form.transport === 'http' ? 'Request headers' : 'Environment variables'">
        <h4>{{ form.transport === 'http' ? 'Request headers' : 'Environment variables' }}</h4>
        <p class="pi-settings-status">Saved values are never shown. Blank replacement values keep them. Select Remove to delete a saved entry.</p>
        <div v-for="(row, index) in form[secretField]" :key="`${secretField}-${index}`" class="pi-settings-form-grid">
          <label class="pi-settings-field"><span>{{ secretLabel }} name{{ row.saved ? ' · Saved' : '' }}</span><input v-model="row.name" :readonly="row.saved" :disabled="busy" spellcheck="false" /></label>
          <label class="pi-settings-field"><span>{{ row.saved ? 'Replacement value' : 'Value' }}</span><input v-model="row.value" type="password" :disabled="busy || row.remove" :placeholder="row.saved ? 'Blank keeps the saved value' : ''" autocomplete="new-password" /></label>
          <label v-if="row.saved" class="pi-settings-field full"><span>Remove {{ row.name }}</span><input v-model="row.remove" type="checkbox" :disabled="busy" /></label>
          <button v-else type="button" class="pi-settings-text-button" :disabled="busy" @click="form[secretField].splice(index, 1)">Remove new {{ secretLabel.toLowerCase() }}</button>
        </div>
        <button type="button" class="pi-settings-text-button" :disabled="busy" @click="form[secretField].push({ name: '', value: '', saved: false, remove: false })">Add {{ secretLabel.toLowerCase() }}</button>
      </section>

      <details v-if="form.transport === 'http'">
        <summary>Advanced OAuth configuration</summary>
        <p class="pi-settings-status">These fields configure native pi sign-in. They do not confirm that the server supports OAuth. Sign-in requires no Authorization header.</p>
        <div class="pi-settings-form-grid">
          <div v-for="field in oauthFields" :key="field.key" class="pi-settings-field" :class="{ full: field.key === 'callbackUrl' }">
            <label class="pi-settings-field"><span>{{ field.label }}</span><input v-model="form.oauth[field.key].value" :type="field.key === 'callbackPort' ? 'number' : 'text'" :disabled="busy || form.oauth[field.key].remove" spellcheck="false" /></label>
            <label v-if="selected?.oauth[field.key] !== undefined" class="pi-settings-field"><span>Remove saved {{ field.label.toLowerCase() }}</span><input v-model="form.oauth[field.key].remove" type="checkbox" :disabled="busy" /></label>
          </div>
          <label class="pi-settings-field full"><span>Client secret{{ selected?.oauth.clientSecretConfigured ? ' · Saved' : '' }}</span><input v-model="form.clientSecret" type="password" :disabled="busy || form.removeClientSecret" autocomplete="new-password" /><small>Blank keeps the saved secret. Its value is never shown.</small></label>
          <label v-if="selected?.oauth.clientSecretConfigured" class="pi-settings-field full"><span>Remove saved client secret</span><input v-model="form.removeClientSecret" type="checkbox" :disabled="busy" /></label>
        </div>
        <p class="pi-settings-status">Clear a non-secret field to remove its saved value. Callback ports must be 1–65535. Callback URLs must use HTTP loopback without credentials, query, or fragment.</p>
      </details>
      <div class="pi-settings-actions">
        <button type="button" class="pi-settings-button" :disabled="busy" @click="closeEditor">Cancel</button>
        <button type="submit" class="pi-settings-button primary" :disabled="busy || (!!selected && !dirty)">{{ saving ? 'Saving…' : 'Save server' }}</button>
      </div>
    </form>

    <template v-else-if="selected">
      <div class="pi-settings-heading">
        <h3>{{ selected.name }}</h3>
        <div class="pi-settings-actions"><button type="button" class="pi-settings-button" :disabled="busy" @click="openEditor()">Edit server</button><button type="button" class="pi-settings-button danger" :disabled="busy" @click="removeServer">Delete</button></div>
      </div>
      <p v-if="selected.error" class="pi-settings-warning" role="alert">{{ selected.error }}</p>
      <dl class="pi-settings-metadata">
        <div><dt>Transport</dt><dd>{{ selected.transport === 'http' ? 'Remote HTTP' : 'Local process (stdio)' }}</dd></div>
        <div v-if="selected.transport === 'http'"><dt>Server URL</dt><dd>{{ selected.url }}</dd></div>
        <template v-else>
          <div><dt>Command</dt><dd>{{ selected.command }}</dd></div>
          <div><dt>Arguments</dt><dd>{{ selected.argsConfigured ? `${selected.argsCount} saved (values hidden)` : 'None saved' }}</dd></div>
          <div><dt>Working directory</dt><dd>{{ selected.cwd || 'Not set' }}</dd></div>
        </template>
        <div><dt>Tool access</dt><dd>{{ { deferred: 'On demand', direct: 'Always available', hidden: 'Hidden' }[selected.exposure] || 'Existing pi setting' }}</dd></div>
        <div><dt>Enabled</dt><dd><button type="button" class="pi-settings-switch" role="switch" :aria-checked="selected.enabled" :aria-label="`Enable ${selected.name}`" :disabled="busy" @click="toggleEnabled" /></dd></div>
      </dl>
      <div class="pi-settings-actions">
        <button type="button" class="pi-settings-button" :disabled="busy || !!selected.error" :aria-describedby="selected.transport === 'stdio' ? 'mcp-check-process-warning' : undefined" @click="runAction('check')">Check connection</button>
        <button v-if="oauthAllowed" type="button" class="pi-settings-button" :disabled="busy || !!selected.error" @click="runAction('login')">Sign in</button>
        <button v-if="oauthAllowed" type="button" class="pi-settings-button" :disabled="busy || !!selected.error" @click="runAction('logout')">Sign out</button>
      </div>
      <p v-if="selected.transport === 'stdio'" id="mcp-check-process-warning" class="pi-settings-warning">Checking starts this command on {{ backendName || 'the selected backend' }}.</p>
      <p class="pi-settings-status">Checks use a temporary connection. Connections in open sessions are unchanged.</p>
      <p v-if="!selected.enabled" class="pi-settings-status">A check can connect this disabled server without changing its saved setting.</p>
      <details class="pi-settings-extra">
        <summary>Saved connection details</summary>
        <dl class="pi-settings-metadata">
          <div><dt>Timeout</dt><dd>{{ selected.timeout === undefined ? 'pi default' : `${selected.timeout} seconds` }}</dd></div>
          <div><dt>Headers</dt><dd>{{ selected.headers.map((entry) => entry.name).join(', ') || 'None' }}</dd></div>
          <div><dt>Environment variables</dt><dd>{{ selected.env.map((entry) => entry.name).join(', ') || 'None' }}</dd></div>
          <template v-if="selected.transport === 'http'">
            <template v-for="field in oauthFields" :key="field.key"><div v-if="selected.oauth[field.key] !== undefined"><dt>OAuth {{ field.label.toLowerCase() }}</dt><dd>{{ selected.oauth[field.key] }}</dd></div></template>
            <div><dt>OAuth client secret</dt><dd>{{ selected.oauth.clientSecretConfigured ? 'Saved (value hidden)' : 'Not configured' }}</dd></div>
          </template>
        </dl>
        <p class="pi-settings-status">Secret values stay on the backend. Native OAuth requires a compatible HTTP server without an Authorization header. Credentials can change before cancellation completes.</p>
      </details>
      <PiSettingsOperation :operation="operation" :busy="operationBusy" :error="operationError" @answer="answer" @cancel="cancel" />
      <section v-if="lastCheck" aria-label="Last check">
        <div class="pi-settings-heading"><h4>Last check</h4><small>{{ lastCheck.time }} · {{ lastCheck.action === 'login' ? 'Sign in' : lastCheck.action === 'logout' ? 'Sign out' : 'Check connection' }}</small></div>
        <p class="pi-settings-status">The temporary probe has closed. This report does not show the status of open sessions.</p>
        <pre class="pi-settings-report">{{ lastCheck.report }}</pre>
        <h4>Tools reported by this probe</h4>
        <div v-if="lastCheck.tools?.length" class="pi-settings-tool-list">
          <div v-for="tool in lastCheck.tools" :key="tool.name" class="pi-settings-tool-row"><div><strong>{{ tool.name }}</strong><p>{{ tool.description }}</p></div><small>{{ tool.exposure }}</small></div>
        </div>
        <p v-else class="pi-settings-empty">The probe reported no tools.</p>
      </section>
      <p v-else class="pi-settings-empty">No check report yet. Use Check connection to request a temporary probe.</p>
    </template>
    <p v-else class="pi-settings-empty">{{ loading ? 'Loading servers…' : 'Select a server or add one. No connection starts until you request it.' }}</p>
  </PiSettingsWorkspace>
</template>
