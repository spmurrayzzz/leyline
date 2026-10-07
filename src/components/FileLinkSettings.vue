<script setup>
import { onMounted, ref } from 'vue'
import { fetchFileSettings, saveFileSettings } from '../lib/pi-api'

const props = defineProps({ backendName: { type: String, required: true } })
const editor = ref('')
const editorMode = ref('auto')
const environmentEditor = ref('')
const effectiveEditor = ref('')
const terminalEditor = ref(false)
const busy = ref(true)
const error = ref('')
const saved = ref(false)

onMounted(async () => {
  try {
    apply(await fetchFileSettings())
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
})

function apply(data) {
  editor.value = data.editor
  editorMode.value = data.editorMode
  environmentEditor.value = data.environmentEditor
  effectiveEditor.value = data.effectiveEditor
  terminalEditor.value = data.terminalEditor
  error.value = data.error || ''
}

async function save() {
  busy.value = true
  error.value = ''
  saved.value = false
  try {
    apply(await saveFileSettings({ editor: editor.value, editorMode: editorMode.value }))
    saved.value = !error.value
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="settings-group">
    <h2>Files</h2>
    <form class="backend-connection-form file-settings-form" @submit.prevent="save" @input="saved = false">
      <label>
        <span>Editor command</span>
        <input v-model="editor" type="text" :placeholder="environmentEditor || 'Use $EDITOR'" :disabled="busy" maxlength="4096" spellcheck="false" />
      </label>
      <small>Leave blank to use <code>$EDITOR</code> on {{ props.backendName }}. Commands run on that backend.</small>
      <label>
        <span>Open editor in</span>
        <select v-model="editorMode" :disabled="busy">
          <option value="auto">Automatic</option>
          <option value="desktop">Desktop</option>
          <option value="terminal">Leyline terminal</option>
        </select>
      </label>
      <small>Use a command with optional arguments, such as <code>code --wait</code> or <code>nvim</code>. Leyline appends the file path. Shell operators and substitutions are not supported.</small>
      <small v-if="effectiveEditor">Current: <code>{{ effectiveEditor }}</code> · {{ terminalEditor ? 'Leyline terminal' : 'Desktop' }}</small>
      <small v-else>No editor is configured, and this backend has no <code>$EDITOR</code>.</small>
      <p v-if="error" class="backend-connection-error" role="alert">{{ error }}</p>
      <div class="backend-connection-form-actions">
        <span v-if="saved" class="backend-connection-success" role="status">Saved</span>
        <button type="submit" :disabled="busy">{{ busy ? 'Loading…' : 'Save' }}</button>
      </div>
    </form>
  </section>
</template>
