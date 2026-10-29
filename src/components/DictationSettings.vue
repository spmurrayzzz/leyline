<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { formatDictationShortcut, normalizeDictationSettings } from '../../lib/dictation.js'
import '../styles/dictation.css'

const props = defineProps({ dictation: { type: Object, required: true } })
const pending = reactive(new Set())
const localError = ref('')
const loading = ref(false)
const capturingShortcut = ref(false)
const shortcutError = ref('')
const testOwned = ref(false)
const platform = computed(() => props.dictation.platform)
const engine = computed(() => props.dictation.engine)
const localSelected = computed(() => engine.value === 'local')
const localAvailable = computed(() => props.dictation.localAvailable && props.dictation.state?.supported !== false)
const desktop = computed(() => props.dictation.desktopAvailable)
const host = computed(() => desktop.value ? 'this computer' : 'Leyline server')
const processingLocation = computed(() => localSelected.value ? props.dictation.processingLocation : 'Browser-managed service')
const settings = computed(() => props.dictation.settings || {})
const models = computed(() => props.dictation.models || [])
const model = computed(() => models.value.find((item) => item.id === settings.value.modelId))
const languages = computed(() => model.value?.languageOptions || [])
const inputs = computed(() => (props.dictation.inputs || []).filter((input) => input.deviceId && input.deviceId !== 'default'))
const inUse = computed(() => props.dictation.clientBusy || props.dictation.active
  || ['preparing', 'listening', 'finishing', 'testing'].includes(props.dictation.phase))
const hostInUse = computed(() => props.dictation.hostBusy)
const clientLocked = computed(() => pending.has('settings') || pending.has('engine') || inUse.value)
const locked = computed(() => clientLocked.value || hostInUse.value || loading.value || pending.has('refresh') || !localAvailable.value)
const testing = computed(() => props.dictation.phase === 'testing' || (testOwned.value && props.dictation.phase === 'preparing'))
const error = computed(() => props.dictation.error || localError.value)
const shortcutLabel = computed(() => {
  try {
    return formatDictationShortcut(settings.value.shortcut, platform.value)
  } catch {
    return 'Set shortcut'
  }
})
const progress = computed(() => Math.round(Math.min(1, Math.max(0, Number(model.value?.progress) || 0)) * 100))
const level = computed(() => Math.min(1, Math.max(0, Number(props.dictation.level) || 0)))
const elapsed = computed(() => Math.min(10, Math.max(0, Math.floor(Number(props.dictation.elapsed) || 0))))
const licenseUrl = computed(() => {
  try {
    const url = new URL(model.value?.licenseUrl || model.value?.url)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
})

let feedbackGeneration = 0
let disposed = false

async function run(key, action) {
  if (pending.has(key)) return false
  const generation = ++feedbackGeneration
  const selectedEngine = engine.value
  pending.add(key)
  localError.value = ''
  shortcutError.value = ''
  try {
    return await action() !== false
  } catch (failure) {
    if (!disposed && selectedEngine === engine.value && generation === feedbackGeneration && !props.dictation.error) {
      localError.value = failure?.message || 'Could not complete this action. Try again.'
    }
    return false
  } finally {
    pending.delete(key)
  }
}

async function refresh() {
  if (!localSelected.value || pending.has('refresh') || disposed) return
  loading.value = true
  await run('refresh', () => props.dictation.refresh())
  if (disposed) return
  loading.value = false
  if (localSelected.value) await run('inputs', () => props.dictation.listInputs())
}

function changeEngine(event) {
  const value = event.target.value
  event.target.value = engine.value
  if (clientLocked.value || value === engine.value) return
  void run('engine', () => props.dictation.setEngine(value))
}

onMounted(() => {
  if (localSelected.value) void refresh()
})
watch(engine, () => {
  feedbackGeneration++
  localError.value = ''
  shortcutError.value = ''
  loading.value = localSelected.value && pending.has('refresh')
  if (localSelected.value) void refresh()
})
watch(() => props.dictation.phase, (phase) => {
  feedbackGeneration++
  localError.value = ''
  shortcutError.value = ''
  if (!['testing', 'preparing'].includes(phase)) testOwned.value = false
}, { flush: 'sync' })
onBeforeUnmount(() => {
  disposed = true
  feedbackGeneration++
  if (testOwned.value && ['testing', 'preparing'].includes(props.dictation.phase)) {
    void Promise.resolve().then(() => props.dictation.stopTest()).catch(() => {})
  }
})

async function save(patch) {
  const clientPreference = Object.keys(patch).every((key) => ['deviceId', 'mode', 'shortcut'].includes(key))
  if (clientPreference ? clientLocked.value : locked.value) return false
  return run('settings', () => props.dictation.updateSettings(patch))
}

function changeModel(event) {
  const next = models.value.find((item) => item.id === event.target.value)
  event.target.value = settings.value.modelId
  if (!next) return
  const options = next.languageOptions || []
  const language = options.some((item) => item.value === settings.value.language)
    ? settings.value.language
    : options.find((item) => item.value === 'auto')?.value || options.find((item) => item.value === 'en')?.value || options[0]?.value
  if (!language) {
    localError.value = 'This model has no supported language. Refresh the model list.'
    return
  }
  void save({ modelId: next.id, language })
}

function changeSetting(key, event) {
  const checkbox = event.target.type === 'checkbox'
  const value = checkbox ? event.target.checked : event.target.value
  if (checkbox) event.target.checked = settings.value[key]
  else event.target.value = settings.value[key]
  void save({ [key]: value })
}

function changeIdle(event) {
  const value = event.target.value === '' ? NaN : Number(event.target.value)
  event.target.value = settings.value.idleMinutes
  if (!Number.isInteger(value) || value < 0 || value > 60) {
    localError.value = 'Enter a whole number from 0 to 60 minutes.'
    return
  }
  void save({ idleMinutes: value })
}

function bytesLabel(bytes) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format((Number(bytes) || 0) / 1000000)} MB`
}

function removeModel() {
  if (!model.value || locked.value || model.value.downloading) return
  const selected = model.value
  if (!window.confirm(`Remove ${selected.name} from ${host.value}? This deletes ${bytesLabel(selected.bytes)} of model files. You can download it again.`)) return
  void run(`remove:${selected.id}`, () => props.dictation.removeModel(selected.id))
}

async function testMicrophone() {
  if (locked.value || pending.has('test')) return
  testOwned.value = true
  const started = await run('test', () => props.dictation.testMicrophone())
  if (!started) testOwned.value = false
  else await run('inputs', () => props.dictation.listInputs())
}

async function stopTest() {
  if (await run('stop-test', () => props.dictation.stopTest())) testOwned.value = false
}

function captureShortcut(event) {
  if (!capturingShortcut.value) return
  if (event.key === 'Tab') {
    capturingShortcut.value = false
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    capturingShortcut.value = false
    shortcutError.value = ''
    return
  }
  if (event.repeat || /^(Meta|Control|Alt|Shift)/.test(event.code) || event.isComposing) return
  const { code, metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift } = event
  if ((meta || ctrl) && ['KeyK', 'KeyN', 'KeyW', 'KeyE', 'KeyM', 'KeyT', 'Comma'].includes(code)) {
    shortcutError.value = 'Leyline already uses this shortcut. Choose another combination.'
    return
  }
  if ((!meta && !ctrl && !/^F(1[3-9]|2[0-4])$/.test(code))
    || (platform.value !== 'darwin' && meta)
    || ((meta || ctrl) && !alt && ['KeyG', 'KeyY'].includes(code))) {
    shortcutError.value = 'Use a Control or Command combination without a system conflict, or F13–F24.'
    return
  }
  try {
    const { shortcut } = normalizeDictationSettings({ ...settings.value, shortcut: { code, meta, ctrl, alt, shift } }, platform.value)
    capturingShortcut.value = false
    shortcutError.value = ''
    void save({ shortcut })
  } catch (failure) {
    shortcutError.value = failure.message
  }
}
</script>

<template>
  <div class="dictation-settings">
    <section class="dictation-section" aria-labelledby="dictation-method-heading">
      <h3 id="dictation-method-heading" class="dictation-heading">Dictation method</h3>
      <div class="dictation-rows">
        <label class="dictation-row">
          <span><strong>Method</strong><small>Separate from your agent backend and pi models</small></span>
          <select :value="engine" :disabled="clientLocked" aria-describedby="dictation-method-help dictation-method-status" @change="changeEngine">
            <option value="browser">Browser dictation</option>
            <option value="local">Local models</option>
          </select>
        </label>
        <div class="dictation-row">
          <span><strong>Speech processing</strong></span>
          <span class="dictation-value">{{ processingLocation }}</span>
        </div>
      </div>
      <p id="dictation-method-help" class="dictation-note">
        <template v-if="!localSelected">The browser handles speech recognition and may use an online service. Availability depends on the browser. The browser controls the microphone and recognition language.</template>
        <template v-else-if="desktop">Speech stays on this computer.</template>
        <template v-else>Speech runs on the computer serving Leyline. Microphone audio is sent there. Choosing another agent backend does not change where speech runs.</template>
      </p>
      <p id="dictation-method-status" class="dictation-note" role="status">
        <template v-if="!localSelected && !dictation.browserAvailable">Browser dictation is unavailable in this browser or app. You can still choose Local models and configure shortcuts.</template>
        <template v-else-if="localSelected && loading">Loading settings from {{ host }}…</template>
        <template v-else-if="localSelected && !localAvailable">Local models are unavailable on {{ host }}. Retry or choose Browser dictation. Shortcuts remain available.</template>
        <template v-else-if="localSelected && hostInUse">Local dictation is in use on {{ host }}. Browser dictation and client shortcuts remain available.</template>
        <template v-else-if="localSelected && !models.length">No speech models are available from {{ host }}. Retry to load the model list.</template>
      </p>
      <div v-if="localSelected && !loading && (!localAvailable || hostInUse || !models.length || error)" class="dictation-actions">
        <button class="dictation-button" type="button" :disabled="pending.has('refresh') || inUse" @click="refresh">Retry local models</button>
      </div>
    </section>
    <p v-if="error" class="dictation-error" role="alert">{{ error }}</p>
    <p v-if="inUse && !testing" class="dictation-note">Dictation is in use. Stop it before changing settings.</p>

    <section v-if="localSelected" class="dictation-section" aria-labelledby="dictation-model-heading">
      <h3 id="dictation-model-heading" class="dictation-heading">Speech model</h3>
      <div class="dictation-rows">
        <label class="dictation-row">
          <span><strong>Model</strong><small>Runs on {{ host }}, separate from your pi models</small></span>
          <select :value="settings.modelId" :disabled="locked || !models.length" @change="changeModel">
            <option v-if="!model" :value="settings.modelId" disabled>{{ loading ? 'Loading models…' : localAvailable ? 'Select a model' : 'Models unavailable' }}</option>
            <option v-for="item in models" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <div v-if="model" class="dictation-model-details">
          <p>{{ model.description }}</p>
          <div class="dictation-model-meta">
            <span>{{ bytesLabel(model.bytes) }} on {{ host }}</span>
            <span v-if="model.license && !model.licenseUrl">{{ model.license }}</span>
            <a v-if="licenseUrl" :href="licenseUrl" target="_blank" rel="noopener noreferrer">{{ model.licenseUrl ? model.license || 'Model license' : 'Model source' }} ↗</a>
          </div>
          <div v-if="model.downloading || pending.has(`download:${model.id}`)" class="dictation-download">
            <div class="dictation-download-caption">
              <span>{{ model.downloading ? `Downloading · ${progress}%` : 'Preparing download…' }}</span>
              <button class="dictation-button" type="button" :disabled="locked || pending.has(`cancel:${model.id}`)" @click="run(`cancel:${model.id}`, () => dictation.cancelDownload(model.id))">Cancel</button>
            </div>
            <progress class="dictation-progress" :value="progress" max="100" aria-label="Model download" />
          </div>
          <div v-else class="dictation-model-actions">
            <span class="dictation-note">{{ model.installed ? `Downloaded on ${host}` : `Download this model on ${host} before using the composer microphone.` }}</span>
            <button v-if="!model.installed" class="dictation-button" type="button" :disabled="locked || pending.has(`remove:${model.id}`)" @click="run(`download:${model.id}`, () => dictation.downloadModel(model.id))">Download · {{ bytesLabel(model.bytes) }}</button>
            <button v-else class="dictation-button" type="button" :disabled="locked || pending.has(`remove:${model.id}`)" @click="removeModel">{{ pending.has(`remove:${model.id}`) ? 'Removing…' : `Remove model from ${host}` }}</button>
          </div>
          <small class="dictation-note">Model files stay on {{ host }} until you remove them. Selecting a model does not download it.</small>
        </div>
        <label v-if="languages.length > 1" class="dictation-row">
          <span><strong>Language</strong><small>Supported by the selected speech model</small></span>
          <select :value="settings.language" :disabled="locked" @change="changeSetting('language', $event)">
            <option v-for="language in languages" :key="language.value" :value="language.value">{{ language.label }}</option>
          </select>
        </label>
        <div v-else-if="languages.length === 1" class="dictation-row">
          <span><strong>Language</strong></span><span class="dictation-value">{{ languages[0].label }}</span>
        </div>
      </div>
    </section>

    <section v-if="localSelected" class="dictation-section" aria-labelledby="dictation-microphone-heading">
      <h3 id="dictation-microphone-heading" class="dictation-heading">Microphone</h3>
      <div class="dictation-rows">
        <label class="dictation-row">
          <span><strong>Input</strong><small>Microphone on this client. Only opens for dictation or an explicit test.</small></span>
          <select :value="settings.deviceId" :disabled="clientLocked || pending.has('inputs')" @change="changeSetting('deviceId', $event)">
            <option value="">System default</option>
            <option v-if="settings.deviceId && !inputs.some((input) => input.deviceId === settings.deviceId)" :value="settings.deviceId" disabled>Saved input · unavailable</option>
            <option v-for="(input, index) in inputs" :key="input.deviceId" :value="input.deviceId">{{ input.label || `Microphone ${index + 1}` }}</option>
          </select>
        </label>
        <div class="dictation-row dictation-test-row">
          <span><strong>{{ testing ? 'Testing microphone' : 'Check input level' }}</strong><small>Test for up to 10 seconds. Device names may appear after permission.</small></span>
          <div class="dictation-test-controls">
            <template v-if="testing">
              <span class="dictation-timer">{{ elapsed }}s / 10s</span>
              <span class="dictation-meter" aria-hidden="true"><span :style="{ transform: `scaleX(${level})` }" /></span>
              <button class="dictation-button" type="button" :disabled="pending.has('stop-test')" @click="stopTest">Stop test</button>
            </template>
            <button v-else class="dictation-button" type="button" :disabled="locked || pending.has('test')" @click="testMicrophone">Test microphone</button>
          </div>
        </div>
      </div>
      <p class="dictation-note">The microphone closes when dictation or a test ends. Keeping a model ready does not keep the microphone open.</p>
    </section>

    <section class="dictation-section" aria-labelledby="dictation-shortcut-heading">
      <h3 id="dictation-shortcut-heading" class="dictation-heading">Shortcut</h3>
      <div class="dictation-rows">
        <div class="dictation-row">
          <span><strong>In-app shortcut</strong><small>Saved for this client. Works only while Leyline is focused.</small></span>
          <button
            class="dictation-button dictation-shortcut"
            type="button"
            data-dictation-shortcut
            :class="{ 'dictation-shortcut-capturing': capturingShortcut }"
            :disabled="clientLocked"
            :aria-pressed="capturingShortcut"
            aria-describedby="dictation-shortcut-help"
            :aria-label="capturingShortcut ? 'Press a shortcut. Escape cancels.' : `Change dictation shortcut, ${shortcutLabel}`"
            @click="capturingShortcut = !capturingShortcut; shortcutError = ''"
            @keydown="captureShortcut"
            @blur="capturingShortcut = false"
          >{{ capturingShortcut ? 'Press a shortcut…' : shortcutLabel || 'Set shortcut' }}</button>
        </div>
        <label class="dictation-row">
          <span><strong>Shortcut behavior</strong><small>{{ settings.mode === 'hold' ? 'Hold to speak. Release to finish.' : 'Press to start. Press again to finish.' }}</small></span>
          <select :value="settings.mode" :disabled="clientLocked" @change="changeSetting('mode', $event)">
            <option value="toggle">Press to toggle</option>
            <option value="hold">Hold to speak</option>
          </select>
        </label>
      </div>
      <p id="dictation-shortcut-help" class="dictation-note">Select the shortcut, then press a key combination with Control or Command, or F13–F24. Escape cancels.</p>
      <p v-if="shortcutError" class="dictation-error" role="alert">{{ shortcutError }}</p>
    </section>

    <section v-if="localSelected" class="dictation-section" aria-labelledby="dictation-memory-heading">
      <h3 id="dictation-memory-heading" class="dictation-heading">Model memory</h3>
      <div class="dictation-rows">
        <label class="dictation-row">
          <span><strong>Keep model ready</strong><small>Uses memory on {{ host }} between recordings for a faster start</small></span>
          <input class="dictation-checkbox" type="checkbox" :checked="settings.keepModelWarm" :disabled="locked" @change="changeSetting('keepModelWarm', $event)" />
        </label>
        <label v-if="settings.keepModelWarm" class="dictation-row">
          <span><strong>Unload after idle</strong><small>Use a value above 0 to unload the model after inactivity. Use 0 to leave it loaded.</small></span>
          <span class="dictation-number-field"><input type="number" :value="settings.idleMinutes" min="0" max="60" step="1" required :disabled="locked" @change="changeIdle" /><span>minutes</span></span>
        </label>
      </div>
    </section>
    <p v-if="localSelected" class="dictation-note">Model, language, and memory settings apply to the speech service on {{ host }}. Microphone and shortcut preferences belong to this client.</p>
    <div v-if="error" class="dictation-actions"><button class="dictation-button" type="button" :disabled="pending.has('dismiss-error')" @click="run('dismiss-error', () => { dictation.dismissError(); localError = '' })">Dismiss error</button></div>
  </div>
</template>
