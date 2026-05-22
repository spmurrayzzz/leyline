<script setup>
import { onMounted, ref } from 'vue'
import { fetchFsDirectory } from '../lib/pi-api'

const props = defineProps({
  busy: Boolean,
  initialPath: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['browse', 'close', 'select'])

const path = ref('')
const input = ref('')
const parent = ref('')
const home = ref('')
const entries = ref([])
const loading = ref(false)
const error = ref('')

onMounted(() => browsePath(props.initialPath))

async function browsePath(nextPath = '') {
  loading.value = true
  error.value = ''

  try {
    const data = await fetchFsDirectory(nextPath)
    path.value = data.path
    input.value = data.path
    parent.value = data.parent || ''
    home.value = data.home || ''
    entries.value = data.directories || []
    emit('browse', data.path)
  } catch (err) {
    error.value = err.message
    input.value = nextPath || input.value
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="project-browser-backdrop" @click.self="emit('close')">
    <section class="project-browser-modal" aria-label="Choose project folder">
      <header class="project-browser-header">
        <div>
          <strong>Choose project folder</strong>
          <span>{{ path || 'Loading folders…' }}</span>
        </div>
        <button type="button" @click="emit('close')">×</button>
      </header>

      <form class="project-browser-path" @submit.prevent="browsePath(input)">
        <input
          v-model="input"
          placeholder="~/dev/project"
          :disabled="loading"
        />
        <button type="submit" :disabled="loading">Go</button>
      </form>

      <div class="project-browser-shortcuts">
        <button
          type="button"
          :disabled="loading || !home"
          @click="browsePath(home)"
        >Home</button>
        <button
          type="button"
          :disabled="loading || !parent"
          @click="browsePath(parent)"
        >Up</button>
      </div>

      <div v-if="error" class="project-browser-error">
        {{ error }}
      </div>
      <div v-else class="project-browser-list">
        <button
          v-for="entry in entries"
          :key="entry.path"
          type="button"
          :class="{ hidden: entry.hidden }"
          @click="browsePath(entry.path)"
        >
          <span>▱</span>
          <strong>{{ entry.name }}</strong>
        </button>
        <div
          v-if="!loading && entries.length === 0"
          class="project-browser-empty"
        >No folders here</div>
      </div>

      <footer class="project-browser-actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button
          type="button"
          class="project-browser-primary"
          :disabled="!path || busy"
          @click="emit('select', path)"
        >Open here</button>
      </footer>
    </section>
  </div>
</template>
