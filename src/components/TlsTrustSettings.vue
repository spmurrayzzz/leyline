<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { fetchTlsTrustSettings, saveTlsTrustSettings } from '../lib/pi-api'

const props = defineProps({ backendName: { type: String, required: true } })
const files = ref([])
const useSystemCa = ref(false)
const baseline = ref({ files: [], useSystemCa: false })
const bundledCount = ref(0)
const systemCount = ref(0)
const appliedCount = ref(0)
const systemAvailable = ref(false)
const envCaFile = ref('')
const envCaCount = ref(0)
const draftPath = ref('')
const draftInput = ref(null)
const adding = ref(false)
const busy = ref(true)
const loaded = ref(false)
const error = ref('')
const saved = ref(false)
const customCount = computed(() => files.value.reduce((sum, file) => sum + (file.certificateCount || 0), 0))
const dirty = computed(() => {
  const paths = files.value.map((file) => file.path).join('\n')
  const baselinePaths = baseline.value.files.map((file) => file.path).join('\n')
  return paths !== baselinePaths || useSystemCa.value !== baseline.value.useSystemCa
})
const hasPendingPath = computed(() => adding.value && draftPath.value.trim() !== '')
const hasUnsavedInput = computed(() => dirty.value || hasPendingPath.value)

onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload)
  void load()
})
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))

function beforeUnload(event) {
  if (!hasUnsavedInput.value && !busy.value) return
  event.preventDefault()
  event.returnValue = ''
}

function confirmLeave() {
  if (busy.value) return false
  if (hasUnsavedInput.value && !window.confirm('Discard your unsaved certificate changes?')) return false
  discard()
  return true
}

defineExpose({ confirmLeave })

function apply(data) {
  files.value = (data.extraCaFiles || []).map((file) => ({ ...file }))
  baseline.value = {
    files: files.value.map((file) => ({ ...file })),
    useSystemCa: data.useSystemCa === true,
  }
  useSystemCa.value = baseline.value.useSystemCa
  bundledCount.value = Number.isInteger(data.bundledCount) ? data.bundledCount : 0
  systemCount.value = Number.isInteger(data.systemCount) ? data.systemCount : 0
  appliedCount.value = Number.isInteger(data.appliedCount) ? data.appliedCount : 0
  systemAvailable.value = data.systemAvailable === true
  envCaFile.value = data.envCaFile || ''
  envCaCount.value = Number.isInteger(data.envCaCount) ? data.envCaCount : 0
  error.value = data.error || ''
  adding.value = false
  draftPath.value = ''
}

async function load() {
  busy.value = true
  error.value = ''
  try {
    apply(await fetchTlsTrustSettings())
    loaded.value = true
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}

function beginAdd() {
  if (adding.value) {
    draftInput.value?.focus()
    return
  }
  adding.value = true
  error.value = ''
  saved.value = false
  nextTick(() => draftInput.value?.focus())
}

function cancelAdd() {
  adding.value = false
  draftPath.value = ''
  error.value = ''
}

function addFile() {
  const path = draftPath.value.trim()
  if (!path) return
  if (files.value.some((file) => file.path === path)) {
    error.value = 'That certificate file is already in the list.'
    return
  }
  files.value.push({
    path,
    name: path.split(/[\\/]/).pop() || path,
    certificateCount: 0,
    error: '',
  })
  draftPath.value = ''
  adding.value = false
  error.value = ''
  saved.value = false
}

function removeFile(index) {
  files.value.splice(index, 1)
  error.value = ''
  saved.value = false
}

function toggleSystem() {
  useSystemCa.value = !useSystemCa.value
  error.value = ''
  saved.value = false
}

function discard() {
  files.value = baseline.value.files.map((file) => ({ ...file }))
  useSystemCa.value = baseline.value.useSystemCa
  adding.value = false
  draftPath.value = ''
  error.value = ''
  saved.value = false
}

async function save() {
  if (busy.value || !loaded.value || !dirty.value || hasPendingPath.value) return
  saved.value = false
  busy.value = true
  error.value = ''
  try {
    apply(await saveTlsTrustSettings({
      extraCaFiles: files.value.map((file) => file.path),
      useSystemCa: useSystemCa.value,
    }))
    saved.value = !error.value && !files.value.some((file) => file.error)
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="settings-group cert-settings" aria-label="Certificates" :aria-busy="busy">
    <div class="cert-split">
      <div class="cert-sources">
        <h3>Sources</h3>
        <p class="cert-source-description">What makes up the trust store.</p>
        <div class="cert-source-list">
          <div class="cert-source-row">
            <span>Bundled roots<small>Always trusted</small></span>
            <strong>{{ bundledCount }}</strong>
          </div>
          <div class="cert-source-row">
            <span>Operating system<small>System keychain</small></span>
            <div class="cert-source-control">
              <span>{{ systemCount }}</span>
              <button
                type="button"
                class="pi-settings-switch"
                role="switch"
                aria-label="Use the operating system certificate store"
                :aria-checked="useSystemCa"
                :disabled="busy || !loaded || !systemAvailable"
                @click="toggleSystem"
              />
            </div>
          </div>
          <div class="cert-source-row">
            <span>Custom files<small>{{ files.length }} {{ files.length === 1 ? 'file' : 'files' }}</small></span>
            <strong>{{ customCount }} <span class="cert-count-unit">{{ customCount === 1 ? 'cert' : 'certs' }}</span></strong>
          </div>
          <div v-if="envCaFile" class="cert-source-row">
            <span>Environment<small :title="envCaFile">NODE_EXTRA_CA_CERTS</small></span>
            <strong>{{ envCaCount }}</strong>
          </div>
        </div>
        <p class="cert-total"><strong>{{ appliedCount }}</strong> <span>authorities trusted</span></p>
      </div>

      <div class="cert-custom">
        <div class="cert-panel">
          <div class="cert-section-head">
            <div>
              <h3>Custom files</h3>
              <p>PEM files on {{ props.backendName }}. Applies to new connections.</p>
            </div>
            <button type="button" class="pi-settings-button" :disabled="busy || !loaded || adding" @click="beginAdd">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Add certificate
            </button>
          </div>

          <div class="cert-panel-scroll">
            <form v-if="adding" class="cert-add-form" @submit.prevent="addFile">
              <label class="pi-settings-field">
                <span>PEM file path</span>
                <input
                  ref="draftInput"
                  v-model="draftPath"
                  type="text"
                  spellcheck="false"
                  maxlength="4096"
                  placeholder="/absolute/path/ca.pem"
                  :disabled="busy || !loaded"
                  @keydown.esc.prevent="cancelAdd"
                />
                <small>Use an absolute path on {{ props.backendName }}.</small>
              </label>
              <div class="cert-buttons">
                <button type="button" class="pi-settings-button" :disabled="busy || !loaded" @click="cancelAdd">Cancel</button>
                <button type="submit" class="pi-settings-button primary" :disabled="busy || !loaded || !draftPath.trim()">Add file</button>
              </div>
            </form>

            <div v-if="files.length" class="cert-list">
              <div v-for="(file, index) in files" :key="`${file.path}:${index}`" class="cert-row">
                <span class="cert-glyph" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 3 19 5.5v5c0 4.2-2.9 6.4-7 7.5-4.1-1.1-7-3.3-7-7.5v-5z" /><path d="m9.5 10.5 1.7 1.7 3.3-3.3" /></svg>
                </span>
                <span class="cert-meta">
                  <strong>{{ file.name }}</strong>
                  <small>{{ file.path }}</small>
                  <small v-if="file.error" class="cert-file-error">{{ file.error }}</small>
                </span>
                <span v-if="file.error" class="cert-badge error">Invalid</span>
                <span v-else-if="file.certificateCount" class="cert-badge">{{ file.certificateCount }} {{ file.certificateCount === 1 ? 'cert' : 'certs' }}</span>
                <span v-else class="cert-badge pending">Pending</span>
                <button type="button" class="cert-remove" :aria-label="`Remove ${file.name}`" :disabled="busy || !loaded" @click="removeFile(index)">×</button>
              </div>
            </div>
            <div v-else-if="!adding" class="cert-empty">
              <svg class="cert-empty-icon" viewBox="0 0 32 40" aria-hidden="true"><path d="M19 2H6a3 3 0 0 0-3 3v30a3 3 0 0 0 3 3h20a3 3 0 0 0 3-3V12zM19 2v10h10M9 18h14M9 23h9M9 28h5" /></svg>
              <div>
                <strong>No custom certificates</strong>
                <p>Add a PEM file if this backend needs to trust a private certificate authority.</p>
              </div>
            </div>
          </div>
        </div>

        <div v-if="dirty || saved" class="cert-actions">
          <span class="cert-status" :class="{ saved: !dirty }" role="status">{{ dirty ? 'Unsaved changes' : 'Saved' }}</span>
          <div class="cert-buttons">
            <button v-if="dirty" type="button" class="pi-settings-button" :disabled="busy" @click="discard">Discard</button>
            <button v-if="dirty" type="button" class="pi-settings-button primary" :disabled="busy || !loaded || hasPendingPath" @click="save">{{ busy ? 'Saving…' : 'Save' }}</button>
          </div>
        </div>

        <p v-if="error" class="settings-error" role="alert">{{ error }}</p>
      </div>
    </div>
  </section>
</template>
