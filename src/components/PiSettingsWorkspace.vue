<script setup>
import { computed, nextTick, ref } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  items: { type: Array, default: () => [] },
  selectedId: { type: String, default: '' },
  kind: { type: String, default: 'provider' },
  addLabel: { type: String, default: '' },
  loading: Boolean,
  busy: Boolean,
})
const emit = defineEmits(['select', 'add', 'refresh'])
const query = ref('')
const filtered = computed(() => props.items.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(query.value.trim().toLowerCase())))

async function selectItem(event) {
  emit('select', event.target.value)
  await nextTick()
  event.target.value = props.selectedId
}
</script>

<template>
  <div class="pi-settings">
    <div class="pi-settings-heading">
      <h2>{{ title }}</h2>
      <div class="pi-settings-actions">
        <button type="button" class="pi-settings-icon-button" :disabled="busy || loading" :aria-label="`Refresh ${title.toLowerCase()}`" title="Refresh" @click="emit('refresh')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7V2m0 5h-5M4 17v5m0-5h5M5 8a8 8 0 0 1 14-3M19 16a8 8 0 0 1-14 3" /></svg>
        </button>
        <button v-if="addLabel" type="button" class="pi-settings-button" :disabled="busy || loading" @click="emit('add')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>{{ addLabel }}
        </button>
      </div>
    </div>
    <p class="pi-settings-intro">{{ description }}</p>
    <div class="pi-settings-notices"><slot name="notice" /></div>
    <p v-if="loading && !items.length" class="settings-note" role="status">Loading {{ title.toLowerCase() }}…</p>
    <div v-else class="pi-settings-workspace" :aria-busy="loading">
      <aside class="pi-settings-list" :aria-label="kind === 'server' ? 'MCP servers' : 'Providers'">
        <label class="pi-settings-picker">
          <span>{{ kind === 'server' ? 'Server' : 'Provider' }}</span>
          <select :value="selectedId" :disabled="busy" @change="selectItem">
            <option v-if="!items.length" value="">None configured</option>
            <option v-for="item in items" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
        <label class="pi-settings-list-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
          <input v-model="query" :placeholder="kind === 'server' ? 'Find a server' : 'Find a provider'" :aria-label="kind === 'server' ? 'Find a server' : 'Find a provider'" />
        </label>
        <button v-for="item in filtered" :key="item.id" type="button" class="pi-settings-list-item" :class="{ active: selectedId === item.id }" :disabled="busy" :aria-current="selectedId === item.id ? 'true' : undefined" @click="emit('select', item.id)">
          <span class="pi-settings-mark" aria-hidden="true">
            <svg v-if="kind === 'server'" viewBox="0 0 24 24"><rect x="8" y="3" width="8" height="6" rx="1" /><rect x="2" y="16" width="7" height="5" rx="1" /><rect x="15" y="16" width="7" height="5" rx="1" /><path d="M12 9v4M5 16v-3h14v3" /></svg>
            <template v-else>{{ item.name.slice(0, 1).toUpperCase() }}</template>
          </span>
          <span><strong>{{ item.name }}</strong><small>{{ item.subtitle }}</small></span>
        </button>
        <p v-if="!filtered.length" class="pi-settings-list-empty">{{ query ? 'No matches' : 'Nothing configured yet' }}</p>
      </aside>
      <section class="pi-settings-detail" :aria-label="kind === 'server' ? 'Server settings' : 'Provider settings'"><slot /></section>
    </div>
  </div>
</template>
